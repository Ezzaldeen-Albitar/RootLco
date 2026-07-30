/**
 * Payment recording, allocation and reads (Phase 1-22 — P1-22-BE-009…012).
 *
 * These are the operations that record money the workshop has actually received and
 * apply it to what a customer owes, so the assertions are on the LEDGER and on the
 * DERIVED BALANCES, not on the HTTP status. A 201 proves a row was written; only
 * `sal.receipt_unallocated`, `sal.invoice_open_receivable` and the audit and outbox
 * counts prove the right one was.
 *
 * ## Three properties every assertion here respects
 *
 *  - **Money is compared as an exact decimal STRING.** `numeric(18,4)` holds values
 *    IEEE-754 cannot represent, and PostgreSQL silently ROUNDS a fifth decimal away
 *    on the cast rather than erroring. `Number`, `parseFloat`, `toFixed` and
 *    arithmetic on a money value appear nowhere in this file: a `Number`-based
 *    assertion would keep passing against an implementation that lost a digit, in the
 *    suite whose purpose is to prove it does not.
 *  - **Every count assertion is a DELTA.** The fixtures themselves write real audit
 *    and outbox rows, so a tenant-wide absolute count measures the fixture rather than
 *    the command. Each "exactly once" claim is measured before and after, and is also
 *    pinned to the specific aggregate the command created.
 *  - **A refusal is asserted with its catalog code, not merely as "not 2xx".** The
 *    problem document's `code` is the field a client branches on, and a 409 from the
 *    idempotency fingerprint and a 409 from an over-allocation are different answers.
 *
 * COVERAGE-EVIDENCE (P1-22 payments):
 *   sal.payment-record: route service authorization success denial audit outbox idempotency isolation cross-tenant
 *   sal.payment-allocate: route service authorization success denial audit outbox idempotency isolation cross-tenant
 *   sal.receipt-detail: route service authorization success denial isolation cross-tenant
 *   sal.payment-method-list: route service authorization success
 *
 * `sal.payment-method-list` declares no `denial`, and that is deliberate rather than an
 * omission: the operation takes no path parameter, no query parameter and no body, so
 * it has nothing to validate and no state to refuse. A `denial` flag on it could only
 * be backed by pointing at a refusal that belongs to another operation.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import { establishP1_19Fixtures } from './p1-19-helpers';
import {
  BRANCH_A2,
  BRANCH_A9,
  PARTNER_A,
  PAYMENT_METHOD_A,
  PAYMENT_METHOD_A_CODE,
  PAYMENT_METHOD_A_INACTIVE,
  PAYMENT_METHOD_B_CODE,
  SAL_COMPANY_SCOPED,
  SAL_FULL,
  SAL_NO_FINANCE,
  SAL_PERMISSION_ELSEWHERE,
  SAL_READER,
  SAL_SCOPED_A2,
  SAL_TENANT_B,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  outboxCountFor,
  platformPaymentMethodId,
  receiptUnallocated,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { GET as READ_RECEIPT } from '@/app/api/v1/payments/[paymentId]/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { GET as LIST_PAYMENT_METHODS } from '@/app/api/v1/payment-methods/route';

let admin: Pool;

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface ReceiptBody {
  readonly id: string;
  readonly reference: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly money: MoneyBody;
  readonly status: string;
  readonly replayed: boolean;
}

interface AllocationBody {
  readonly id: string;
  readonly receiptId: string;
  readonly invoiceId: string;
  readonly money: MoneyBody;
  readonly receiptStatus: string;
  readonly receiptUnallocated: MoneyBody;
}

interface ReceiptDetailBody {
  readonly id: string;
  readonly reference: string;
  readonly money: MoneyBody;
  readonly unallocated: MoneyBody;
  readonly status: string;
  readonly method: { readonly id: string; readonly scope: string } | null;
  readonly allocations: readonly { readonly invoiceId: string; readonly money: MoneyBody }[];
  readonly allocationsTruncated: boolean;
}

interface MethodListBody {
  readonly items: readonly {
    readonly id: string;
    readonly scope: string;
    readonly methodCode: string;
    readonly status: string;
    readonly recordable: boolean;
  }[];
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/** Every P1-22 command declares `idempotent: true`, so the header is mandatory. */
const recordPayment = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  RECORD_PAYMENT(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const allocatePayment = (
  paymentId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  ALLOCATE_PAYMENT(
    new Request(`http://localhost/api/v1/payments/${paymentId}/allocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ paymentId }) }
  );

const readReceipt = (paymentId: string): Promise<Response> =>
  READ_RECEIPT(new Request(`http://localhost/api/v1/payments/${paymentId}`), {
    params: Promise.resolve({ paymentId }),
  });

const listMethods = (): Promise<Response> =>
  LIST_PAYMENT_METHODS(new Request('http://localhost/api/v1/payment-methods'));

/** A well-formed recording request in the provisioned company and branch. */
const validPayment = (amount: string, currency = 'USD'): Record<string, string> => ({
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  paymentMethodId: PAYMENT_METHOD_A,
  payerPartnerId: PARTNER_A,
  currency,
  amount,
});

/** Audit rows for ONE action across the whole database, for a before/after delta. */
const auditTotalFor = (action: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1`, [action]);

/** Outbox rows for ONE event type, for a before/after delta. */
const outboxTotalFor = (eventType: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_type = $1`, [
    eventType,
  ]);

const receiptRowsWithKey = (key: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts WHERE idempotency_key = $1`, [key]);

const allocationRowsFor = (receiptId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`, [
    receiptId,
  ]);

/** Records a receipt as `SAL_FULL` and fails loudly if the fixture path breaks. */
async function recordedReceipt(amount: string, currency = 'USD'): Promise<ReceiptBody> {
  authAs(SAL_FULL);
  const response = await recordPayment(validPayment(amount, currency));
  if (response.status !== 201) {
    throw new Error(
      `fixture receipt of ${amount} ${currency} failed with ${response.status}: ` +
        `${await response.text()}`
    );
  }
  return bodyOf<ReceiptBody>(response);
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

describe('sal.payment-record', () => {
  it('records money received and labels it with an explicit currency (success)', async () => {
    authAs(SAL_FULL);
    const response = await recordPayment(validPayment('100.00'));
    expect(response.status).toBe(201);
    const receipt = await bodyOf<ReceiptBody>(response);

    // The receipt reference is the artefact the caller needs, allocated by
    // `shared.next_display_number('receipt', …)` and frozen by
    // `sal.guard_receipt_freeze`. Asserted as a non-empty string and NOT parsed: the
    // schema and the seeds define no format, so a test that matched a prefix would be
    // inventing a contract.
    expect(typeof receipt.reference).toBe('string');
    expect(receipt.reference.length).toBeGreaterThan(0);
    // Money crosses as a fixed-scale decimal STRING beside its currency. `'100.00'`
    // went in; `'100.0000'` is the canonical `numeric(18,4)` form that came back, and
    // the difference is exactly what a JSON number would have hidden.
    expect(receipt.money.amount).toBe('100.0000');
    expect(receipt.money.currency).toBe('USD');
    expect(receipt.status).toBe('recorded');
    expect(receipt.replayed).toBe(false);
    expect(receipt.companyId).toBe(COMPANY_A1);
    expect(receipt.branchId).toBe(BRANCH_A1);

    // The row really carries the money, in the same exact form.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.receipts
          WHERE id = $1 AND amount::text = '100.0000' AND currency_code = 'USD'`,
        [receipt.id]
      )
    ).toBe(1);
    // Nothing is allocated yet, so the whole receipt remains.
    expect(await receiptUnallocated(receipt.id)).toBe('100.0000');
  });

  it('writes exactly one audit record and exactly one event (audit, outbox)', async () => {
    const auditBefore = await auditTotalFor('sal.receipt.recorded');
    const outboxBefore = await outboxTotalFor('receipt.recorded');

    authAs(SAL_FULL);
    const response = await recordPayment(validPayment('25.5000'));
    expect(response.status).toBe(201);
    const receipt = await bodyOf<ReceiptBody>(response);

    // DELTAS, not totals: the fixtures write real rows of their own, so an absolute
    // tenant-wide count would be measuring arrangement.
    expect((await auditTotalFor('sal.receipt.recorded')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('receipt.recorded')) - outboxBefore).toBe(1);
    // And the one row that moved is THIS receipt's, keyed on the aggregate.
    expect(await auditCountFor('sal.receipt.recorded', receipt.id)).toBe(1);
    expect(await outboxCountFor(`receipt.recorded:${receipt.id}`)).toBe(1);
  });

  it('TC-P1-22-004 replays an idempotency key without recording a second receipt (idempotency)', async () => {
    const key = randomUUID();
    const payload = validPayment('42.0000');
    const auditBefore = await auditTotalFor('sal.receipt.recorded');
    const outboxBefore = await outboxTotalFor('receipt.recorded');

    authAs(SAL_FULL);
    const first = await recordPayment(payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<ReceiptBody>(first);

    authAs(SAL_FULL);
    const replay = await recordPayment(payload, key);
    // 200 rather than 201: the stored response is replayed and the handler is never
    // re-entered, so a retrying client can tell it did not take a second payment.
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<ReceiptBody>(replay);
    expect(replayed.id).toBe(original.id);
    // The NUMBER, not only the id. `shared.next_display_number` advances a sequence,
    // so a replay that re-entered the command would hand back a second receipt number
    // for one payment — and the id would still have matched if the service resolved
    // the row afterwards.
    expect(replayed.reference).toBe(original.reference);
    expect(replayed.money.amount).toBe('42.0000');

    expect(await receiptRowsWithKey(key)).toBe(1);
    expect((await auditTotalFor('sal.receipt.recorded')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('receipt.recorded')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.receipt.recorded', original.id)).toBe(1);
    expect(await outboxCountFor(`receipt.recorded:${original.id}`)).toBe(1);
  });

  it('refuses the same idempotency key with a different payload (denial)', async () => {
    const key = randomUUID();
    authAs(SAL_FULL);
    expect((await recordPayment(validPayment('10.0000'), key)).status).toBe(201);

    authAs(SAL_FULL);
    const conflicting = await recordPayment(validPayment('11.0000'), key);
    // A stable conflict, not a silent success under someone else's receipt: the
    // fingerprint is bound to the resolved principal and the parsed body, so a reused
    // key for a different amount is `ERR-INT-001`.
    expect(conflicting.status).toBe(409);
    expect((await bodyOf<ProblemBody>(conflicting)).code).toBe('ERR-INT-001');
    // One receipt for the key, not two.
    expect(await receiptRowsWithKey(key)).toBe(1);
  });

  it('refuses a zero, negative, over-scale amount and a missing currency (denial)', async () => {
    authAs(SAL_FULL);
    const before = await countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts`);

    // `'0'` is a well-formed decimal string and the boundary regex accepts it, so
    // only `parsePositive` refuses it — `ck_receipts_amount` would otherwise be the
    // first thing to notice, as a 409 carrying a constraint name.
    for (const amount of ['0', '0.0000', '-1', '-0.0001']) {
      authAs(SAL_FULL);
      const response = await recordPayment(validPayment(amount));
      expect(response.status, `amount ${amount}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }

    // A FIFTH decimal place is the one that matters most: exceeding scale is not an
    // error in PostgreSQL, it is silently rounded away on the cast, so a caller would
    // never learn its amount had changed.
    authAs(SAL_FULL);
    const overScale = await recordPayment(validPayment('1.00005'));
    expect(overScale.status).toBe(422);

    // A missing currency, and a lower-case one. There is no DEFAULT on any
    // `currency_code` column in `sal` and the platform ships no jurisdiction default,
    // so this can never be inferred.
    authAs(SAL_FULL);
    const missing = { ...validPayment('5.0000') } as Record<string, string | undefined>;
    delete missing.currency;
    expect((await recordPayment(missing)).status).toBe(422);
    authAs(SAL_FULL);
    expect((await recordPayment(validPayment('5.0000', 'usd'))).status).toBe(422);

    // Not one of the six wrote a row.
    expect(await countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts`)).toBe(before);
  });

  it('refuses an inactive method and a PLATFORM method (denial)', async () => {
    const before = await countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts`);

    authAs(SAL_FULL);
    const inactive = await recordPayment({
      ...validPayment('7.0000'),
      paymentMethodId: PAYMENT_METHOD_A_INACTIVE,
    });
    expect(inactive.status).toBe(422);
    const inactiveProblem = await bodyOf<ProblemBody>(inactive);
    expect(inactiveProblem.code).toBe('ERR-VAL-001');
    expect(inactiveProblem.violations?.[0]?.path).toBe('body.paymentMethodId');

    // The platform method is the one that must not reach the database.
    // `fk_receipts_method` is `(tenant_id, payment_method_id)` and a platform row's
    // `tenant_id` is NULL, so `sal.record_receipt` would raise a bare `23503` — which
    // reads as "that method does not exist" about a method the caller can see in
    // `GET /payment-methods`. This is a controlled refusal naming the field instead.
    authAs(SAL_FULL);
    const platform = await recordPayment({
      ...validPayment('7.0000'),
      paymentMethodId: platformPaymentMethodId(),
    });
    expect(platform.status).toBe(422);
    const platformProblem = await bodyOf<ProblemBody>(platform);
    expect(platformProblem.code).toBe('ERR-VAL-001');
    expect(platformProblem.violations?.[0]?.path).toBe('body.paymentMethodId');
    // Emphatically NOT a 500, and emphatically no row.
    expect(await countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts`)).toBe(before);
  });

  it('reports an unprovisioned receipt sequence as configuration, not a number (denial)', async () => {
    // SB3 / P1-22-L-03. `sal.record_receipt` hard-codes the sequence code `'receipt'`
    // and `shared.next_display_number` matches the (company, branch) scope EXACTLY
    // with no fallback, so BRANCH_A2 — deliberately left unprovisioned by the
    // fixtures — raises `no_data_found`. Runtime holds no INSERT grant on
    // `shared.number_sequences`, so this cannot be self-healed, and the one thing the
    // service must never do is invent a receipt number to get past it.
    authAs(SAL_SCOPED_A2);
    const response = await recordPayment({
      ...validPayment('9.0000'),
      branchId: BRANCH_A2,
    });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts WHERE branch_id = $1`, [
        BRANCH_A2,
      ])
    ).toBe(0);
  });

  it('refuses a caller lacking sal.payment.record (authorization)', async () => {
    authAs(SAL_READER);
    const response = await recordPayment(validPayment('12.0000'));
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
  });

  it('refuses a caller holding sal.payment.record but not sal.finance.view (authorization)', async () => {
    // This principal holds EVERY other sal/wty permission. It is refused because
    // `sal.receipts` is gated WHOLE-ROW by `iam.has_permission('sal.finance.view')`
    // on INSERT as well as SELECT (`ins_receipts_gated`) — RLS, not the route, is what
    // makes the write impossible, and that is precisely why the operation DECLARES
    // both codes. Without the declaration the caller would reach the primitive and
    // get a `42501` the catalog has no honest mapping for; with it, the refusal is the
    // uniform 403 every other authorization failure produces.
    authAs(SAL_NO_FINANCE);
    const response = await recordPayment(validPayment('13.0000'));
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    // The declaration is what the assertion above depends on, so pin it: a future
    // edit that dropped `sal.finance.view` from the operation would turn this 403 into
    // an unmapped privilege error from inside the primitive.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.receipts WHERE amount::text = '13.0000'`
      )
    ).toBe(0);
  });

  it('refuses a branch the caller holds no payment permission in (isolation)', async () => {
    // BRANCH_A1 IS inside this principal's permission-blind `iam.allowed_branch_ids()`
    // union, because a SECOND grant carrying only `org.tenant.read` names it. So RLS
    // cannot answer 404 here and the row would be perfectly visible: the ONLY thing
    // that can refuse this request is the scoped permission evaluation against the
    // company and branch the caller named (P1-18-A-01).
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await recordPayment(validPayment('14.0000'));
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.receipts WHERE amount::text = '14.0000'`
      )
    ).toBe(0);
  });

  it('refuses an INCOHERENT company and branch pair (isolation, H6)', async () => {
    // H6. `iam.has_permission_in_scope` matches
    //   (scope_type='company' AND company_id = p_company)
    //   OR (scope_type='branch' AND branch_id = p_branch)
    // so this caller — company-scoped to COMPANY_A1, with an unrelated BRANCH grant on
    // BRANCH_A9 of the OTHER company — satisfies the authorization check on the
    // COMPANY half while pointing the write at a branch that does not belong to the
    // named company. RLS admits it too: A1 is in its company union and A9 is in its
    // branch union. `POST /payments` is the ONE P1-22 operation where the caller names
    // the pair (both other write paths read it off a row), so this is where the
    // incoherent pair is expressible at all.
    const before = await countRowsOf(
      `SELECT count(*)::text AS n FROM sal.receipts WHERE branch_id = $1`,
      [BRANCH_A9]
    );
    authAs(SAL_COMPANY_SCOPED);
    const response = await recordPayment({
      ...validPayment('15.0000'),
      companyId: COMPANY_A1,
      branchId: BRANCH_A9,
    });
    // Refused, and refused in a controlled way rather than as a fault: nothing about
    // an incoherent pair may reach the caller as a 500 carrying a constraint name.
    expect(response.status).toBeLessThan(500);
    expect([403, 404, 409, 422]).toContain(response.status);
    // The decisive assertion: no receipt exists in a branch of the other company.
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts WHERE branch_id = $1`, [
        BRANCH_A9,
      ])
    ).toBe(before);
  });

  it('is unreachable from the other tenant (cross-tenant)', async () => {
    // A REAL tenant-A receipt, so the refusal below has a row behind it: an empty
    // result proves nothing about the tenant boundary.
    const receipt = await recordedReceipt('16.0000');
    authAs(SAL_TENANT_B);
    // Tenant B holds every sal permission IN ITS OWN TENANT and its own provisioned
    // method, so a refusal here is RLS rather than a missing grant.
    const response = await readReceipt(receipt.id);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
  });
});

describe('sal.receipt-detail', () => {
  it('returns the receipt, its remainder and its allocation history (success)', async () => {
    const invoice = await seedIssuedInvoice('pay_detail');
    const receipt = await recordedReceipt('100.0000');

    authAs(SAL_FULL);
    const allocated = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    expect(allocated.status).toBe(201);

    authAs(SAL_FULL);
    const response = await readReceipt(receipt.id);
    expect(response.status).toBe(200);
    const detail = await bodyOf<ReceiptDetailBody>(response);

    expect(detail.id).toBe(receipt.id);
    // The SAME reference the recording command reported. `receipt_number` is frozen by
    // `sal.guard_receipt_freeze`, so there is no path that mints a second one.
    expect(detail.reference).toBe(receipt.reference);
    expect(detail.money.amount).toBe('100.0000');
    expect(detail.money.currency).toBe('USD');
    // Derived by the database on every call — nothing stores a balance.
    expect(detail.unallocated.amount).toBe('40.0000');
    expect(detail.unallocated.currency).toBe('USD');
    expect(detail.status).toBe('partially_allocated');
    expect(detail.method?.id).toBe(PAYMENT_METHOD_A);
    expect(detail.method?.scope).toBe('tenant');

    expect(detail.allocations).toHaveLength(1);
    expect(detail.allocations[0]?.invoiceId).toBe(invoice.invoiceId);
    expect(detail.allocations[0]?.money.amount).toBe('60.0000');
    expect(detail.allocationsTruncated).toBe(false);
  });

  it('refuses a malformed receipt id before reading anything (denial)', async () => {
    authAs(SAL_FULL);
    const response = await readReceipt('not-a-uuid');
    // The path schema is `schemas.uuid` and it is parsed INSIDE the handler, so this is
    // the operation's own validation refusal rather than a framework 404. It matters
    // that it is a 422 naming the field: a non-uuid reaching the repository would be a
    // `22P02` from PostgreSQL, which the catalog has no honest mapping for.
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('path.paymentId');
  });

  it('refuses a caller lacking sal.finance.view (authorization)', async () => {
    const receipt = await recordedReceipt('17.0000');
    // Otherwise fully authorized. `sal.receipts` is gated WHOLE-ROW rather than
    // column-masked, so there is no honest "receipt without amounts" projection to
    // return and the operation truthfully declares the permission it needs.
    authAs(SAL_NO_FINANCE);
    const response = await readReceipt(receipt.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
  });

  it('refuses a caller scoped to another branch although the row is visible (isolation)', async () => {
    const receipt = await recordedReceipt('18.0000');
    // The decisive isolation case. This principal's second grant puts BRANCH_A1 into
    // `iam.allowed_branch_ids()`, so `sal.receipts` really is selectable for it and
    // the read reaches the row. Only the scoped permission check against the ROW's own
    // company and branch can refuse it — a scope-blind implementation would have
    // disclosed the amount.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await readReceipt(receipt.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');

    // The row really is visible to that caller's RLS union — otherwise the refusal
    // above would be a 404 dressed up as a 403 and would prove nothing.
    const visible = await countRowsOf(
      `SELECT count(*)::text AS n FROM sal.receipts
        WHERE id = $1 AND branch_id = ANY(
          SELECT s.branch_id FROM iam.grant_scopes s
            JOIN iam.role_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
           WHERE g.user_id = $2 AND s.branch_id IS NOT NULL)`,
      [receipt.id, SAL_PERMISSION_ELSEWHERE.userId]
    );
    expect(visible).toBe(1);
  });

  it('is unreachable from the other tenant (cross-tenant)', async () => {
    const receipt = await recordedReceipt('19.0000');
    authAs(SAL_TENANT_B);
    expect((await readReceipt(receipt.id)).status).toBe(404);
    // And an unknown id answers identically, so the code discloses nothing about
    // whether the receipt exists.
    authAs(SAL_TENANT_B);
    expect((await readReceipt(randomUUID())).status).toBe(404);
  });
});

describe('sal.payment-allocate', () => {
  it('applies part of a receipt and reduces the invoice outstanding exactly (success)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_ok');
    expect(invoice.gross).toBe('100.0000');
    // The invoice starts fully open, in exact decimal form.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
    const receipt = await recordedReceipt('100.0000');

    const auditBefore = await auditTotalFor('sal.payment.allocated');
    const outboxBefore = await outboxTotalFor('payment.allocated');

    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(201);
    const allocation = await bodyOf<AllocationBody>(response);

    expect(allocation.receiptId).toBe(receipt.id);
    expect(allocation.invoiceId).toBe(invoice.invoiceId);
    expect(allocation.money.amount).toBe('60.0000');
    expect(allocation.money.currency).toBe('USD');
    // The primitive re-summed and set the status itself; the service reports what it
    // decided rather than recomputing it.
    expect(allocation.receiptStatus).toBe('partially_allocated');
    expect(allocation.receiptUnallocated.amount).toBe('40.0000');

    // The invoice outstanding fell by EXACTLY the allocated amount, compared as an
    // exact decimal string. 100.0000 - 60.0000 = 40.0000, and `Number` never touches
    // any of the three.
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('40.0000');
    expect(await receiptUnallocated(receipt.id)).toBe('40.0000');

    expect((await auditTotalFor('sal.payment.allocated')) - auditBefore).toBe(1);
    expect((await outboxTotalFor('payment.allocated')) - outboxBefore).toBe(1);
    expect(await auditCountFor('sal.payment.allocated', allocation.id)).toBe(1);
    expect(await outboxCountFor(`payment.allocated:${allocation.id}`)).toBe(1);
  });

  it('refuses an allocation beyond the receipt remainder (denial)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_over_receipt');
    const receipt = await recordedReceipt('50.0000');

    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    // Σ allocations ≤ receipt.amount is bounded ONLY inside `sal.allocate_receipt`;
    // the service's pre-check exists so the refusal is a caller-safe 409 rather than a
    // constraint message.
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-TRN-001');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
    expect(await receiptUnallocated(receipt.id)).toBe('50.0000');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('refuses an allocation beyond the invoice outstanding (denial)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_over_invoice', { net: '40.0000' });
    expect(invoice.gross).toBe('40.0000');
    const receipt = await recordedReceipt('100.0000');

    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '60.0000',
      currency: 'USD',
    });
    // A separate bound from the one above, and a separate case: this receipt has 100
    // remaining, so only the invoice's own open receivable can refuse it.
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-TRN-001');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('40.0000');
  });

  it('refuses a declared currency that differs from the receipt (denial)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_declared_ccy');
    const receipt = await recordedReceipt('100.0000');

    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'EUR',
    });
    // `sal.allocate_receipt` compares receipt against invoice and NEVER sees what the
    // caller believed, so without this the request would have succeeded in USD for a
    // client that thought it was allocating EUR.
    expect(response.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(response);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.path).toBe('body.currencyCode');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
  });

  it('refuses a receipt currency that differs from the invoice (denial)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_invoice_ccy', { currency: 'EUR' });
    expect(invoice.currencyCode).toBe('EUR');
    const receipt = await recordedReceipt('100.0000', 'USD');

    authAs(SAL_FULL);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(422);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('replays an idempotency key without allocating twice (idempotency)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_replay');
    const receipt = await recordedReceipt('100.0000');
    const key = randomUUID();
    const payload = { invoiceId: invoice.invoiceId, amount: '30.0000', currency: 'USD' };
    const auditBefore = await auditTotalFor('sal.payment.allocated');

    authAs(SAL_FULL);
    const first = await allocatePayment(receipt.id, payload, key);
    expect(first.status).toBe(201);
    const original = await bodyOf<AllocationBody>(first);

    authAs(SAL_FULL);
    const replay = await allocatePayment(receipt.id, payload, key);
    expect(replay.status).toBe(200);
    expect((await bodyOf<AllocationBody>(replay)).id).toBe(original.id);

    // One allocation row, one audit record, and the money moved once — the invoice
    // outstanding fell by 30 and not by 60.
    expect(await allocationRowsFor(receipt.id)).toBe(1);
    expect((await auditTotalFor('sal.payment.allocated')) - auditBefore).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('70.0000');
    expect(await receiptUnallocated(receipt.id)).toBe('70.0000');
  });

  it('refuses the same idempotency key with a different amount (denial)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_key_conflict');
    const receipt = await recordedReceipt('100.0000');
    const key = randomUUID();

    authAs(SAL_FULL);
    expect(
      (
        await allocatePayment(
          receipt.id,
          { invoiceId: invoice.invoiceId, amount: '10.0000', currency: 'USD' },
          key
        )
      ).status
    ).toBe(201);

    authAs(SAL_FULL);
    const conflicting = await allocatePayment(
      receipt.id,
      { invoiceId: invoice.invoiceId, amount: '20.0000', currency: 'USD' },
      key
    );
    expect(conflicting.status).toBe(409);
    expect((await bodyOf<ProblemBody>(conflicting)).code).toBe('ERR-INT-001');
    // The first allocation stands alone. An allocation is one of the least reversible
    // rows in the platform: `sal.payment_allocations` has no UPDATE or DELETE grant.
    expect(await allocationRowsFor(receipt.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('90.0000');
  });

  it('refuses a caller lacking sal.payment.allocate (authorization)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_authz');
    const receipt = await recordedReceipt('100.0000');
    authAs(SAL_READER);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
  });

  it('refuses a receipt in a branch the caller is not scoped to (isolation)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_isolation');
    const receipt = await recordedReceipt('100.0000');
    // The path names a receipt, not a branch. The deferred check reads the RECEIPT's
    // own company and branch, and BRANCH_A1 is inside this caller's RLS union, so the
    // refusal is the scoped permission evaluation and nothing else.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(403);
    expect(await allocationRowsFor(receipt.id)).toBe(0);
  });

  it('cannot reach a tenant-A receipt from tenant B (cross-tenant)', async () => {
    const invoice = await seedIssuedInvoice('pay_alloc_cross_tenant');
    const receipt = await recordedReceipt('100.0000');
    authAs(SAL_TENANT_B);
    const response = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '10.0000',
      currency: 'USD',
    });
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect(await allocationRowsFor(receipt.id)).toBe(0);
  });
});

describe('sal.payment-method-list', () => {
  it('reports the tenant method as recordable and every platform method as not', async () => {
    authAs(SAL_FULL);
    const response = await listMethods();
    expect(response.status).toBe(200);
    const { items } = await bodyOf<MethodListBody>(response);

    const tenantMethod = items.find((item) => item.id === PAYMENT_METHOD_A);
    expect(tenantMethod?.methodCode).toBe(PAYMENT_METHOD_A_CODE);
    expect(tenantMethod?.scope).toBe('tenant');
    // `recordable` is the field that matters: only a tenant-scoped row can be cited by
    // a receipt, because `fk_receipts_method` resolves `(tenant_id, payment_method_id)`
    // and a platform row's `tenant_id` is NULL. Listing a platform method as a
    // selectable option would make the list actively misleading.
    expect(tenantMethod?.recordable).toBe(true);

    const platformMethods = items.filter((item) => item.scope === 'platform');
    // The three seeded platform methods are visible to every tenant, and that is the
    // point: a tenant with no method of a given kind has to be able to see that the
    // platform defines one and that its own row is missing.
    expect(platformMethods.length).toBeGreaterThan(0);
    expect(platformMethods.some((item) => item.id === platformPaymentMethodId())).toBe(true);
    for (const method of platformMethods) {
      expect(method.recordable, `${method.methodCode} must not be recordable`).toBe(false);
    }

    // Inactive rows are not options at all, and the other tenant's row is invisible.
    expect(items.some((item) => item.id === PAYMENT_METHOD_A_INACTIVE)).toBe(false);
    expect(items.some((item) => item.methodCode === PAYMENT_METHOD_B_CODE)).toBe(false);
    for (const method of items) expect(method.status).toBe('active');
  });

  it('refuses a caller lacking sal.payment.record (authorization)', async () => {
    // The recording authority rather than `sal.finance.view`: this is a reference list
    // with no amount on it, and gating a catalogue behind a money permission would be
    // the wrong control. `SAL_READER` holds the money permission and not this one, so
    // the refusal proves which of the two the operation actually requires.
    authAs(SAL_READER);
    const response = await listMethods();
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
  });
});

// ===========================================================================
/**
 * The outbox carries no money — asserted on the payloads themselves.
 *
 * `shared.event_outbox` has exactly ONE runtime SELECT policy,
 * `sel_event_outbox_producer`, whose qualifier is `tenant_id = iam.current_tenant_id()`:
 * no permission predicate and no company/branch predicate. `sal.receipts.amount` and
 * `sal.payment_allocations.amount` are classified `restricted` and their tables are gated
 * whole-row by `iam.has_permission('sal.finance.view')` plus both scope predicates. So an
 * amount in a payload is a copy of restricted money behind a strictly weaker policy — a
 * per-receipt shadow of the cash ledger readable by every principal in the tenant. The
 * policy comparison itself is pinned in `tests/db/p1-22-protected-residuals.test.ts`.
 *
 * `billing`'s three events state this rule for themselves in comments and keep it. These
 * two did not, and carried `amount`, `currency`, `receiptNumber` and — worst of the four —
 * `receiptUnallocated`, which is `sal.receipt_unallocated()`: a SECURITY INVOKER derived
 * financial position that a caller without `sal.finance.view` cannot compute by any
 * legitimate query, so the outbox row was its only source.
 */
describe('P1-22 outbox payloads carry no money', () => {
  const MONEY_OR_NUMBER_KEY = /amount|currency|total|balance|unallocated|number|money/i;

  const payloadFor = async (eventKey: string): Promise<Record<string, unknown>> => {
    const row = await admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM shared.event_outbox WHERE event_key = $1`,
      [eventKey]
    );
    const payload = row.rows[0]?.payload;
    if (payload === undefined) throw new Error(`no outbox row for ${eventKey}`);
    return payload;
  };

  it('receipt.recorded and payment.allocated name no figure and no receipt number', async () => {
    const invoice = await seedIssuedInvoice('outbox_no_money', { net: '12500.0000' });
    const receipt = await recordedReceipt('12500.0000');

    authAs(SAL_FULL);
    const allocated = await allocatePayment(receipt.id, {
      invoiceId: invoice.invoiceId,
      amount: '12500.0000',
      currency: 'USD',
    });
    expect(allocated.status).toBe(201);
    const allocation = await bodyOf<AllocationBody>(allocated);

    // The money IS returned to the caller that asked for it — the route is gated by
    // `sal.finance.view`, so this is the amount arriving where the policy allows it. The
    // event is a different audience with a different policy, and that is the distinction.
    expect(allocation.money.amount).toBe('12500.0000');

    // The receipt number (exposed as reference) exists and is deliberately not published, on the same rule
    // `invoice.created` states for the invoice number.
    expect(receipt.reference).not.toBe('');

    for (const [eventKey, label] of [
      [`receipt.recorded:${receipt.id}`, 'receipt.recorded'],
      [`payment.allocated:${allocation.id}`, 'payment.allocated'],
    ] as const) {
      const payload = await payloadFor(eventKey);

      // Not vacuous: the payload must still identify its aggregate, or "carries no money"
      // would be satisfied by an empty object.
      expect(
        Object.keys(payload).length,
        `${label} must still identify its aggregate`
      ).toBeGreaterThan(1);

      for (const key of Object.keys(payload)) {
        expect(key, `${label}.${key} must not name money or a document number`).not.toMatch(
          MONEY_OR_NUMBER_KEY
        );
      }
      // And the figures themselves appear nowhere in the serialised row, under any key —
      // a key-name predicate alone would miss `{ detail: '12500.0000 received' }`.
      const serialised = JSON.stringify(payload);
      expect(serialised).not.toContain('12500');
      expect(serialised).not.toContain(receipt.reference);

      // What DOES survive: the aggregate id, so a consumer can go and read the record
      // under its own policy rather than being handed the money.
      expect(serialised).toContain(receipt.id);
    }

    // `receiptStatus` is retained on purpose and is the one lifecycle value a consumer
    // needs. It states no figure, and `sal.receipts.status` is classified `internal`.
    expect((await payloadFor(`payment.allocated:${allocation.id}`))['receiptStatus']).toBe(
      'allocated'
    );
  });
});
