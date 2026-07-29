/**
 * Credit-note request and dual-control approval (Phase 1-22 — P1-22-BE-008).
 *
 * A credit note is the only instrument in this platform that reduces what a customer
 * owes on a document that has already been shown to them, so the assertions here are
 * about WHO may do it, WHEN it starts counting, and by exactly HOW MUCH the receivable
 * moves. A 201 proves a row was written; only `sal.invoice_open_receivable`, the audit
 * delta and the outbox delta prove the right one was.
 *
 * ## Four properties every assertion respects
 *
 *  - **Money is compared as an exact decimal STRING, beside its currency.**
 *    `numeric(18,4)` holds values IEEE-754 cannot represent, and PostgreSQL silently
 *    ROUNDS a fifth decimal away on the cast rather than erroring. `Number`,
 *    `parseFloat`, `toFixed` and arithmetic on a money value appear nowhere in this
 *    file. An amount without its currency is half an assertion, and on this surface it
 *    is the dangerous half: `sal.invoice_open_receivable` has no currency predicate at
 *    all.
 *  - **Every count is a DELTA.** The fixtures write real audit and outbox rows, so a
 *    tenant-wide absolute total measures arrangement rather than the command. Each
 *    "exactly once" claim is measured before and after AND pinned to the aggregate the
 *    command created.
 *  - **A refusal is asserted with its catalog code.** A 409 from the amount ceiling, a
 *    409 from self-approval and a 409 from a reused idempotency key are three different
 *    answers, and `code` is the field a client branches on.
 *  - **Caller-safe means caller-safe in the RESPONSE.** `problemFor` assembles the
 *    problem document from the catalog entry plus `safeDetails` and reads no other
 *    field of the failure, so the developer-facing message never crosses the boundary.
 *    Two things are therefore asserted separately: the response carries only the RFC
 *    9457 keys and no constraint name, trigger name or SQLSTATE anywhere in its bytes;
 *    and the sentence a maintainer will read is asserted where it actually exists, by
 *    driving the wired service inside a real transaction (`serviceRefusal`).
 *
 * ## `sal.credit-note-create` declares no `outbox`, deliberately
 *
 * Requesting a credit publishes NOTHING, because nothing has been credited yet — an
 * event named `credit-note.issued` fired at request time would tell every consumer the
 * receivable had fallen when it had not. The success test measures the outbox before
 * and after and asserts the delta is **0**, but the `outbox` evidence flag means "one
 * event row is read back and counted", so declaring it here would claim an event was
 * verified to be published. It is asserted and not declared.
 *
 * COVERAGE-EVIDENCE (P1-22 credit notes):
 *   sal.credit-note-create: route service authorization success denial audit idempotency isolation cross-tenant
 *   sal.credit-note-approve: route service authorization success denial audit outbox idempotency isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  SAL_APPROVER,
  SAL_FULL,
  SAL_NO_FINANCE,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_TENANT_B,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  outboxCountFor,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { billingModule } from '@/modules/billing';
import { requireScopedPermissions, type ScopeAuthorizer } from '@/server/auth/authorization';
import type { RegisteredOperation } from '@/server/auth/operation-registry';
import { resolveRequestContext } from '@/server/context/resolve-context';
import { withTransaction, type DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import {
  CREDIT_NOTE_CREATE_OPERATION,
  POST as REQUEST_CREDIT_NOTE,
} from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import {
  CREDIT_NOTE_APPROVE_OPERATION,
  POST as APPROVE_CREDIT_NOTE,
} from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';

let admin: Pool;

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface CreditNoteBody {
  readonly id: string;
  readonly invoiceId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly amount: MoneyBody;
  readonly reason: string;
  readonly approvalState: string;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly issuedAt: string | null;
  readonly recordVersion: number;
}

interface CreditNoteResultBody {
  readonly creditNote: CreditNoteBody;
  readonly replayed: boolean;
}

interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/** Both P1-22 credit-note commands declare `idempotent: true`, so the header is mandatory. */
const requestCreditNote = (
  invoiceId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  REQUEST_CREDIT_NOTE(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/credit-notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

/**
 * Approves with NO body at all.
 *
 * That is the operation's contract rather than a shortcut: the approver is the session
 * and `sal.guard_dual_control_approval` freezes `amount` once the state leaves
 * `pending`, so a body field would be an input the database refuses to honour.
 */
const approveCreditNote = (creditNoteId: string, key: string = randomUUID()): Promise<Response> =>
  APPROVE_CREDIT_NOTE(
    new Request(`http://localhost/api/v1/credit-notes/${creditNoteId}/approval`, {
      method: 'POST',
      headers: { 'idempotency-key': key },
    }),
    { params: Promise.resolve({ creditNoteId }) }
  );

/** Audit rows for ONE action across the database, for a before/after delta. */
const auditTotalFor = (action: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1`, [action]);

/** Outbox rows for ONE event type, for a before/after delta. */
const outboxTotalFor = (eventType: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_type = $1`, [
    eventType,
  ]);

const creditNotesFor = (invoiceId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.credit_notes WHERE invoice_id = $1`, [
    invoiceId,
  ]);

const creditNotesWithKey = (key: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.credit_notes WHERE idempotency_key = $1`, [key]);

/**
 * The protected `sal.financial_events` row `sal.approve_credit_note` writes.
 *
 * Counted separately from the outbox because they are different guarantees: the outbox
 * is this service's published event, and the financial event is the one
 * `sal.guard_event_completeness` refuses an approval without.
 */
const financialEventsFor = (creditNoteId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.financial_events
      WHERE source_id = $1 AND event_type = 'credit_note_issued'`,
    [creditNoteId]
  );

/** Every key an RFC 9457 problem document may carry on a bare state refusal. */
const REFUSAL_KEYS = ['code', 'correlationId', 'status', 'title', 'type'];

/**
 * Asserts a state refusal is a controlled 409 that discloses no database vocabulary.
 *
 * The regex is over the RAW response bytes rather than a parsed field, so a future edit
 * that started echoing `error.message` into the document would fail here rather than
 * quietly ship a constraint name to a customer-facing client.
 */
async function expectCallerSafeConflict(response: Response): Promise<void> {
  expect(response.status).toBe(409);
  const raw = await response.text();
  expect(raw).not.toMatch(/ck_|uq_|tg_|guard_|check_violation|23514|sal\./);
  const problem = JSON.parse(raw) as ProblemBody;
  expect(problem.code).toBe('ERR-TRN-001');
  expect(Object.keys(problem).sort()).toEqual(REFUSAL_KEYS);
}

/**
 * Drives the WIRED service inside a real transaction and returns the failure it threw.
 *
 * The problem document deliberately carries no free-text detail, so the sentence a
 * caller-safe message is supposed to say cannot be read off an HTTP response. It is
 * asserted here instead, against the same code path the route uses: the context is
 * resolved from the session claims exactly as `handleOperation` resolves it, and the
 * scope authorizer is the operation's own `requireScopedPermissions` rather than a
 * stub — so a refusal measured here is the refusal the route produces, with its
 * message intact.
 */
async function serviceRefusal(
  principal: Principal,
  operation: RegisteredOperation,
  work: (db: DbHandle, authorizeScope: ScopeAuthorizer) => Promise<unknown>
): Promise<AppFailure> {
  const context = await resolveRequestContext({
    claims: {
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    },
    correlationId: randomUUID(),
    operation: operation.id,
    module: operation.module,
  });
  try {
    await withTransaction(context, (db) =>
      work(db, (target) => requireScopedPermissions(db, operation, target))
    );
  } catch (error) {
    if (error instanceof AppFailure) return error;
    throw error;
  }
  throw new Error(`${operation.id} was expected to refuse and did not`);
}

/** Requests a pending credit note as `SAL_FULL`, failing loudly if the path breaks. */
async function pendingNote(invoiceId: string, amount: string): Promise<CreditNoteBody> {
  authAs(SAL_FULL);
  const response = await requestCreditNote(invoiceId, {
    amount,
    reason: `P1-22 fixture credit of ${amount}`,
  });
  if (response.status !== 201) {
    throw new Error(
      `fixture credit note of ${amount} failed with ${response.status}: ${await response.text()}`
    );
  }
  return (await bodyOf<CreditNoteResultBody>(response)).creditNote;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
}, 180_000);

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

describe('sal.credit-note-create', () => {
  it('is born pending with a maker taken from the session, crediting nothing (success, audit)', async () => {
    const invoice = await seedIssuedInvoice('cn_request');
    expect(invoice.gross).toBe('100.0000');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    const auditBefore = await auditTotalFor('sal.credit_note.requested');
    const outboxBefore = await outboxTotalFor('credit-note.issued');

    authAs(SAL_FULL);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '40.00',
      reason: 'A part was billed twice on the same job',
    });
    expect(response.status).toBe(201);
    const { creditNote, replayed } = await bodyOf<CreditNoteResultBody>(response);

    expect(replayed).toBe(false);
    expect(creditNote.invoiceId).toBe(invoice.invoiceId);
    expect(creditNote.companyId).toBe(COMPANY_A1);
    expect(creditNote.branchId).toBe(BRANCH_A1);
    // `'40.00'` went in; `'40.0000'` is the canonical `numeric(18,4)` form that came
    // back, beside its currency. The difference is exactly what a JSON number hides.
    expect(creditNote.amount.amount).toBe('40.0000');
    expect(creditNote.amount.currency).toBe('USD');

    // Born pending, and born WORTHLESS: `sal.stamp_dual_control_maker` nulls the
    // approval fields on INSERT, so a request cannot arrive pre-approved.
    expect(creditNote.approvalState).toBe('pending');
    expect(creditNote.approvedBy).toBeNull();
    expect(creditNote.approvedAt).toBeNull();
    expect(creditNote.issuedAt).toBeNull();

    // The maker is the SESSION's user. The request body carried `amount` and `reason`
    // and nothing else — there is no `requestedBy` field to send, and the next test
    // proves sending one is refused rather than dropped. So this equality can only
    // have come from `iam.current_user_id()`.
    expect(creditNote.requestedBy).toBe(SAL_FULL.userId);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND requested_by = $2 AND approved_by IS NULL
            AND approval_state = 'pending' AND amount::text = '40.0000'
            AND currency_code = 'USD'`,
        [creditNote.id, SAL_FULL.userId]
      )
    ).toBe(1);

    // Exactly one audit record, measured as a delta and pinned to this aggregate.
    expect((await auditTotalFor('sal.credit_note.requested')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.credit_note.requested', creditNote.id)).toBe(1);
    // And the money is MASKED in the trail: `sal.credit_notes` is gated in its
    // entirety by `sal.finance.view` while `iam.audit_records` is not, so a clear
    // amount there would route restricted money around its own policy.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n
           FROM iam.audit_records r
           JOIN iam.audit_record_details d
             ON d.tenant_id = r.tenant_id AND d.audit_record_id = r.id
          WHERE r.action = 'sal.credit_note.requested' AND r.entity_id = $1
            AND r.request_ref = 'sal.credit-note-request'
            AND d.field_name = 'amount' AND d.value_classification = 'restricted'
            AND d.new_value_masked = '***'`,
        [creditNote.id]
      )
    ).toBe(1);

    // NO event, and the delta is what says so. Nothing is credited by a request, so a
    // `credit-note.issued` here would tell consumers the receivable had fallen.
    expect((await outboxTotalFor('credit-note.issued')) - outboxBefore).toBe(0);
    expect(await outboxCountFor(`credit-note.issued:${creditNote.id}`)).toBe(0);
    expect(await financialEventsFor(creditNote.id)).toBe(0);

    // The decisive assertion of the whole request path: the customer still owes the
    // full amount, as an exact decimal string.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('refuses a body naming the maker or the approval state, a blank reason and a bad amount (denial)', async () => {
    const invoice = await seedIssuedInvoice('cn_reject');

    // `.strict()` is what makes dual control unforgeable at the boundary: the maker
    // and the approval fields are not "ignored", there is no field to put them in, so
    // a caller that tries is told rather than silently corrected.
    for (const body of [
      { amount: '10.0000', reason: 'r', requestedBy: SAL_APPROVER.userId },
      { amount: '10.0000', reason: 'r', approvalState: 'approved' },
      { amount: '10.0000', reason: 'r', approvedBy: SAL_APPROVER.userId },
    ]) {
      authAs(SAL_FULL);
      const response = await requestCreditNote(invoice.invoiceId, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      const problem = await bodyOf<ProblemBody>(response);
      expect(problem.code).toBe('ERR-VAL-001');
      expect(problem.violations?.[0]?.path).toBe('body');
      expect(problem.violations?.[0]?.rule).toBe('unrecognized_keys');
    }

    // A reason of blanks passes `z.string().min(1)` and is refused by `requireReason`,
    // which is the ONLY defence: `sal.credit_notes.reason` is `NOT NULL` with no
    // `btrim(...) <> ''` CHECK, so `'   '` would otherwise be stored as the recorded
    // justification for reducing a receivable.
    authAs(SAL_FULL);
    const blank = await requestCreditNote(invoice.invoiceId, { amount: '10.0000', reason: '   ' });
    expect(blank.status).toBe(422);
    const blankProblem = await bodyOf<ProblemBody>(blank);
    expect(blankProblem.code).toBe('ERR-VAL-001');
    expect(blankProblem.violations?.[0]?.path).toBe('body.reason');
    expect(blankProblem.violations?.[0]?.rule).toBe('too_small');

    // `'0'` and `'0.0000'` are well-formed decimals the boundary regex accepts, so
    // only `parseInstrumentAmount` refuses them — `ck_credit_notes_amount` would
    // otherwise be the first thing to notice, as a 409 carrying a constraint name. The
    // FIFTH decimal place is the one that matters most: exceeding scale is not an
    // error in PostgreSQL, it is silently rounded away on the cast, so a caller would
    // never learn its amount had changed.
    for (const amount of ['0', '0.0000', '-1', '-0.0001', '1.00005']) {
      authAs(SAL_FULL);
      const response = await requestCreditNote(invoice.invoiceId, { amount, reason: 'r' });
      expect(response.status, `amount ${amount}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code, `amount ${amount}`).toBe('ERR-VAL-001');
    }

    // Not one of the nine wrote a row.
    expect(await creditNotesFor(invoice.invoiceId)).toBe(0);
  });

  it('inherits the invoice currency and REFUSES a different one (denial, P1-22-L-02)', async () => {
    // A JOD invoice, deliberately not the USD default: "inherited from the parent" is
    // indistinguishable from "hard-coded USD" against a USD invoice.
    const invoice = await seedIssuedInvoice('cn_currency', { currency: 'JOD' });
    expect(invoice.currencyCode).toBe('JOD');

    authAs(SAL_FULL);
    const inherited = await requestCreditNote(invoice.invoiceId, {
      amount: '30.0000',
      reason: 'Currency comes from the parent invoice',
    });
    expect(inherited.status).toBe(201);
    const { creditNote } = await bodyOf<CreditNoteResultBody>(inherited);
    expect(creditNote.amount.amount).toBe('30.0000');
    expect(creditNote.amount.currency).toBe('JOD');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND currency_code = 'JOD' AND amount::text = '30.0000'`,
        [creditNote.id]
      )
    ).toBe(1);

    // ---- The case that matters most in this file --------------------------------
    //
    // `assertCurrencyMatches` is the ONLY defence in the entire system. Measured, not
    // assumed: `tests/db/p1-22-protected-residuals.test.ts` inserts a JOD credit note
    // against a USD invoice as admin, approves it, and shows 40 JOD subtracted from a
    // USD gross — 100.0000 becomes 60.0000 — because five triggers fire on
    // `sal.credit_notes` and not one reads `sal.invoices.currency_code`,
    // `sal.approve_credit_note` compares the amount and never the currency, and
    // `sal.invoice_open_receivable` has no currency predicate either. So the DATABASE
    // still accepts the mismatch this test refuses: the application refusal is the
    // whole guard (P1-22-L-02, change-control candidate CC-1), and if it is deleted
    // nothing else objects.
    const before = await creditNotesFor(invoice.invoiceId);
    authAs(SAL_FULL);
    const mismatch = await requestCreditNote(invoice.invoiceId, {
      amount: '10.0000',
      reason: 'A caller that believes it is crediting USD',
      currency: 'USD',
    });
    expect(mismatch.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(mismatch);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.currency');
    // NO row was created — the refusal happens before the INSERT, so there is no
    // mismatched credit note anywhere for an approval to later subtract.
    expect(await creditNotesFor(invoice.invoiceId)).toBe(before);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE invoice_id = $1 AND currency_code <> 'JOD'`,
        [invoice.invoiceId]
      )
    ).toBe(0);
  });

  it('refuses a credit above the open receivable and accepts one exactly equal (denial)', async () => {
    const invoice = await seedIssuedInvoice('cn_ceiling');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    // The caller-safe sentence, asserted where it exists. `sal.approve_credit_note`
    // would raise `check_violation` for the same overrun, and that message is not a
    // contract a caller can act on; this one names the ceiling.
    const refusal = await serviceRefusal(
      SAL_FULL,
      CREDIT_NOTE_CREATE_OPERATION,
      (db, authorizeScope) =>
        billingModule().invoices.requestCreditNote(
          db,
          {
            invoiceId: invoice.invoiceId,
            amount: '100.0001',
            reason: 'One ten-thousandth over the ceiling',
          },
          authorizeScope
        )
    );
    expect(refusal.code).toBe('ERR-TRN-001');
    expect(refusal.message).toContain("exceeds the invoice's open amount of 100.0000");
    expect(refusal.message).not.toMatch(/ck_|uq_|tg_|guard_|check_violation|23514|SELECT|INSERT/);

    // The same overrun through the route: a controlled 409 whose bytes carry no
    // constraint name, no trigger name and no SQLSTATE.
    authAs(SAL_FULL);
    const over = await requestCreditNote(invoice.invoiceId, {
      amount: '100.0001',
      reason: 'One ten-thousandth over the ceiling',
    });
    await expectCallerSafeConflict(over);
    expect(await creditNotesFor(invoice.invoiceId)).toBe(0);

    // Exactly equal to the open amount is ACCEPTED — the bound is `>`, not `>=`, and a
    // fully credited invoice is a legitimate outcome.
    authAs(SAL_FULL);
    const exact = await requestCreditNote(invoice.invoiceId, {
      amount: '100.0000',
      reason: 'The whole invoice is credited',
    });
    expect(exact.status).toBe(201);
    const { creditNote } = await bodyOf<CreditNoteResultBody>(exact);
    expect(creditNote.amount.amount).toBe('100.0000');
    expect(creditNote.amount.currency).toBe('USD');
    expect(creditNote.approvalState).toBe('pending');
    // Still pending, so the receivable has not moved by a hundredth.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('replays an idempotency key and refuses that key with a different amount (idempotency, denial)', async () => {
    const invoice = await seedIssuedInvoice('cn_replay');
    const key = randomUUID();
    const payload = { amount: '25.0000', reason: 'Duplicate labour line' };
    const auditBefore = await auditTotalFor('sal.credit_note.requested');

    authAs(SAL_FULL);
    const first = await requestCreditNote(invoice.invoiceId, payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<CreditNoteResultBody>(first);

    authAs(SAL_FULL);
    const replay = await requestCreditNote(invoice.invoiceId, payload, key);
    // 200 rather than 201: the stored response is replayed and the handler is never
    // re-entered, so a retrying client can tell it did not request a second credit.
    expect(replay.status).toBe(200);
    // The WHOLE document, not just the id: a replay that re-entered the command would
    // have produced a second row whose id would still have matched had the service
    // resolved the key afterwards.
    expect(await bodyOf<CreditNoteResultBody>(replay)).toEqual(original);

    expect(await creditNotesWithKey(key)).toBe(1);
    expect(await creditNotesFor(invoice.invoiceId)).toBe(1);
    expect((await auditTotalFor('sal.credit_note.requested')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.credit_note.requested', original.creditNote.id)).toBe(1);

    // The same key for a DIFFERENT amount is a stable conflict, never a silent success
    // under the first request's row: the fingerprint binds the parsed body.
    authAs(SAL_FULL);
    const conflicting = await requestCreditNote(
      invoice.invoiceId,
      { ...payload, amount: '26.0000' },
      key
    );
    expect(conflicting.status).toBe(409);
    expect((await bodyOf<ProblemBody>(conflicting)).code).toBe('ERR-INT-001');
    expect(await creditNotesWithKey(key)).toBe(1);
    expect(await creditNotesFor(invoice.invoiceId)).toBe(1);
  });

  it('refuses a caller lacking either declared permission (authorization)', async () => {
    const invoice = await seedIssuedInvoice('cn_authz');
    const body = { amount: '10.0000', reason: 'Not permitted' };

    // Holds `sal.finance.view` and NOT `sal.credit.manage`.
    authAs(SAL_READER);
    const reader = await requestCreditNote(invoice.invoiceId, body);
    expect(reader.status).toBe(403);
    expect((await bodyOf<ProblemBody>(reader)).code).toBe('ERR-IAM-001');

    // Holds every other `sal`/`wty` code and NOT `sal.finance.view`. The operation
    // declares both, and it has to: `ins_credit_notes_gated` requires the finance
    // permission on INSERT as well as SELECT, so a caller admitted here would reach
    // the primitive and get a `42501` the catalog has no honest mapping for.
    authAs(SAL_NO_FINANCE);
    const noFinance = await requestCreditNote(invoice.invoiceId, body);
    expect(noFinance.status).toBe(403);
    expect((await bodyOf<ProblemBody>(noFinance)).code).toBe('ERR-IAM-001');

    expect(await creditNotesFor(invoice.invoiceId)).toBe(0);
  });

  it('refuses a branch the caller holds no credit permission in although the row is visible (isolation)', async () => {
    const invoice = await seedIssuedInvoice('cn_isolation');

    // BRANCH_A1 IS inside this principal's permission-blind `iam.allowed_branch_ids()`
    // union, because a SECOND grant carrying only `org.tenant.read` names it. So RLS
    // cannot answer 404 here and the invoice is perfectly readable: the ONLY thing
    // that can refuse this request is the deferred scoped permission evaluation
    // against the company and branch the loaded invoice names (P1-18-A-01).
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '10.0000',
      reason: 'Out of scope',
    });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await creditNotesFor(invoice.invoiceId)).toBe(0);

    // The invoice really is inside that caller's RLS union — otherwise the refusal
    // above would be a 404 dressed up as a 403 and would prove nothing.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices
          WHERE id = $1 AND branch_id = ANY(
            SELECT s.branch_id FROM iam.grant_scopes s
              JOIN iam.role_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
             WHERE g.user_id = $2 AND s.branch_id IS NOT NULL)`,
        [invoice.invoiceId, SAL_PERMISSION_ELSEWHERE.userId]
      )
    ).toBe(1);
  });

  it('cannot credit a tenant-A invoice from tenant B (cross-tenant)', async () => {
    const invoice = await seedIssuedInvoice('cn_cross_tenant');

    // Tenant B holds every `sal` permission IN ITS OWN TENANT, so a refusal here is
    // RLS rather than a missing grant.
    authAs(SAL_TENANT_B);
    const response = await requestCreditNote(invoice.invoiceId, {
      amount: '10.0000',
      reason: 'Another tenant',
    });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect(await creditNotesFor(invoice.invoiceId)).toBe(0);

    // An unknown id answers identically, so the code is not an existence oracle for
    // another tenant's financial documents.
    authAs(SAL_TENANT_B);
    const unknown = await requestCreditNote(randomUUID(), {
      amount: '10.0000',
      reason: 'Another tenant',
    });
    expect(unknown.status).toBe(404);
    expect((await bodyOf<ProblemBody>(unknown)).code).toBe('ERR-RES-001');
  });
});

describe('sal.credit-note-approve', () => {
  it('approves under dual control and reduces the receivable by exactly the credit (success, audit, outbox)', async () => {
    const invoice = await seedIssuedInvoice('cn_approve');
    const note = await pendingNote(invoice.invoiceId, '40.0000');
    expect(note.requestedBy).toBe(SAL_FULL.userId);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    const auditBefore = await auditTotalFor('sal.credit_note.approved');
    const outboxBefore = await outboxTotalFor('credit-note.issued');

    // A DIFFERENT principal. `sal.guard_dual_control_approval` stamps `approved_by`
    // from the session and refuses `approved_by = requested_by`, so the split needs
    // two real accounts and cannot be satisfied by one used twice.
    authAs(SAL_APPROVER);
    const response = await approveCreditNote(note.id);
    expect(response.status).toBe(200);
    const { creditNote, replayed } = await bodyOf<CreditNoteResultBody>(response);

    expect(replayed).toBe(false);
    expect(creditNote.id).toBe(note.id);
    expect(creditNote.approvalState).toBe('approved');
    expect(creditNote.requestedBy).toBe(SAL_FULL.userId);
    expect(creditNote.approvedBy).toBe(SAL_APPROVER.userId);
    expect(creditNote.approvedAt).not.toBeNull();
    expect(creditNote.issuedAt).not.toBeNull();
    expect(creditNote.amount.amount).toBe('40.0000');
    expect(creditNote.amount.currency).toBe('USD');

    // Both stamps are the SERVER's: the request carried no body at all, so neither
    // the approver nor the timestamp could have come from the caller.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND approval_state = 'approved' AND approved_by = $2
            AND requested_by = $3 AND approved_at IS NOT NULL AND issued_at IS NOT NULL`,
        [note.id, SAL_APPROVER.userId, SAL_FULL.userId]
      )
    ).toBe(1);

    expect((await auditTotalFor('sal.credit_note.approved')) - auditBefore).toBe(1);
    expect(await auditCountFor('sal.credit_note.approved', note.id)).toBe(1);
    // The audit CLASS is `approval` rather than `financial`, because the fact recorded
    // is a second person's decision. `iam.audit_records` has no class column — the
    // class is a property of the registration and `iam.audit_append` never sees it —
    // so it is asserted on the registration, and the stored `request_ref` is the
    // discriminator that distinguishes this trail from the request's.
    expect(CREDIT_NOTE_APPROVE_OPERATION.auditClass).toBe('approval');
    expect(CREDIT_NOTE_APPROVE_OPERATION.auditAction).toBe('sal.credit_note.approved');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM iam.audit_records
          WHERE entity_id = $1 AND request_ref = 'sal.credit-note-approve'`,
        [note.id]
      )
    ).toBe(1);

    expect((await outboxTotalFor('credit-note.issued')) - outboxBefore).toBe(1);
    expect(await outboxCountFor(`credit-note.issued:${note.id}`)).toBe(1);
    // And the protected financial event the completeness trigger demands.
    expect(await financialEventsFor(note.id)).toBe(1);

    // The point of the whole operation: 100.0000 − 40.0000 = 60.0000, compared as
    // exact decimal strings, with `Number` touching none of the three.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('60.0000');
  });

  it('refuses the maker approving its own request (denial)', async () => {
    const invoice = await seedIssuedInvoice('cn_self_approval');
    const note = await pendingNote(invoice.invoiceId, '15.0000');
    const auditBefore = await auditTotalFor('sal.credit_note.approved');
    const outboxBefore = await outboxTotalFor('credit-note.issued');

    // The sentence, asserted where it exists: the database refuses this twice —
    // `ck_credit_notes_approved_distinct` structurally and
    // `sal.guard_dual_control_approval` with a `check_violation` — and neither answer
    // tells the caller what to do about it.
    const refusal = await serviceRefusal(
      SAL_FULL,
      CREDIT_NOTE_APPROVE_OPERATION,
      (db, authorizeScope) =>
        billingModule().invoices.approveCreditNote(db, note.id, authorizeScope)
    );
    expect(refusal.code).toBe('ERR-TRN-001');
    expect(refusal.message).toContain(
      'The approver of a credit note must differ from the requester'
    );
    expect(refusal.message).toContain('Ask a second');
    expect(refusal.message).not.toMatch(/ck_|uq_|tg_|guard_|check_violation|23514|UPDATE/);

    // The same attempt through the route: a controlled 409 leaking no constraint name.
    authAs(SAL_FULL);
    const response = await approveCreditNote(note.id);
    await expectCallerSafeConflict(response);

    // Still pending — which is the safe outcome, because a pending credit note
    // credits nothing.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND approval_state = 'pending' AND approved_by IS NULL
            AND approved_at IS NULL AND issued_at IS NULL`,
        [note.id]
      )
    ).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
    expect((await auditTotalFor('sal.credit_note.approved')) - auditBefore).toBe(0);
    expect((await outboxTotalFor('credit-note.issued')) - outboxBefore).toBe(0);
    expect(await financialEventsFor(note.id)).toBe(0);
  });

  it('replays an approval without crediting the invoice twice (idempotency)', async () => {
    const invoice = await seedIssuedInvoice('cn_approve_replay');
    const note = await pendingNote(invoice.invoiceId, '20.0000');
    const key = randomUUID();

    authAs(SAL_APPROVER);
    const first = await approveCreditNote(note.id, key);
    expect(first.status).toBe(200);
    const original = await bodyOf<CreditNoteResultBody>(first);
    expect(original.creditNote.approvalState).toBe('approved');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('80.0000');

    const auditBefore = await auditTotalFor('sal.credit_note.approved');
    const outboxBefore = await outboxTotalFor('credit-note.issued');

    authAs(SAL_APPROVER);
    const replay = await approveCreditNote(note.id, key);
    expect(replay.status).toBe(200);
    // The same result, byte for byte: the stored response is returned and the handler
    // is never re-entered.
    expect(await bodyOf<CreditNoteResultBody>(replay)).toEqual(original);

    expect((await auditTotalFor('sal.credit_note.approved')) - auditBefore).toBe(0);
    expect((await outboxTotalFor('credit-note.issued')) - outboxBefore).toBe(0);
    expect(await auditCountFor('sal.credit_note.approved', note.id)).toBe(1);
    expect(await outboxCountFor(`credit-note.issued:${note.id}`)).toBe(1);
    expect(await financialEventsFor(note.id)).toBe(1);
    // The receivable did not fall twice: still 100.0000 − 20.0000.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('80.0000');

    // A FRESH key on an already-approved note. The idempotency store cannot answer
    // this one — the key is new — so what protects the invoice is the service's own
    // `approval_state === 'approved'` short-circuit, which reports `replayed: true`
    // and writes neither an audit record nor an event.
    authAs(SAL_APPROVER);
    const again = await approveCreditNote(note.id, randomUUID());
    expect(again.status).toBe(200);
    const second = await bodyOf<CreditNoteResultBody>(again);
    expect(second.replayed).toBe(true);
    expect(second.creditNote.approvedBy).toBe(SAL_APPROVER.userId);
    expect(second.creditNote.amount.amount).toBe('20.0000');
    expect(second.creditNote.amount.currency).toBe('USD');

    expect((await auditTotalFor('sal.credit_note.approved')) - auditBefore).toBe(0);
    expect((await outboxTotalFor('credit-note.issued')) - outboxBefore).toBe(0);
    expect(await financialEventsFor(note.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('80.0000');
  });

  it('refuses a caller lacking either declared permission (authorization)', async () => {
    const invoice = await seedIssuedInvoice('cn_approve_authz');
    const note = await pendingNote(invoice.invoiceId, '10.0000');

    authAs(SAL_READER);
    const reader = await approveCreditNote(note.id);
    expect(reader.status).toBe(403);
    expect((await bodyOf<ProblemBody>(reader)).code).toBe('ERR-IAM-001');

    authAs(SAL_NO_FINANCE);
    const noFinance = await approveCreditNote(note.id);
    expect(noFinance.status).toBe(403);
    expect((await bodyOf<ProblemBody>(noFinance)).code).toBe('ERR-IAM-001');

    // Neither refusal moved the note or the money.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND approval_state = 'pending'`,
        [note.id]
      )
    ).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('refuses an approver holding no credit permission in the note branch (isolation)', async () => {
    const invoice = await seedIssuedInvoice('cn_approve_isolation');
    const note = await pendingNote(invoice.invoiceId, '10.0000');

    // The path names a credit note, not a branch. The deferred check reads the NOTE's
    // own company and branch, and BRANCH_A1 is inside this caller's RLS union, so the
    // refusal is the scoped permission evaluation and nothing else.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await approveCreditNote(note.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND approval_state = 'pending'`,
        [note.id]
      )
    ).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('cannot approve a tenant-A credit note from tenant B (cross-tenant)', async () => {
    const invoice = await seedIssuedInvoice('cn_approve_cross_tenant');
    const note = await pendingNote(invoice.invoiceId, '10.0000');

    authAs(SAL_TENANT_B);
    const response = await approveCreditNote(note.id);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');

    // An unknown id answers identically — `sel_credit_notes_gated` gates the whole
    // row, so "not visible" and "does not exist" must be one answer.
    authAs(SAL_TENANT_B);
    const unknown = await approveCreditNote(randomUUID());
    expect(unknown.status).toBe(404);
    expect((await bodyOf<ProblemBody>(unknown)).code).toBe('ERR-RES-001');

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE id = $1 AND approval_state = 'pending'`,
        [note.id]
      )
    ).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });
});
