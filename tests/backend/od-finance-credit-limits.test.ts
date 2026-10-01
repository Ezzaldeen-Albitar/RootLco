/**
 * P1-32-PRE-OD-FD2C — the credit-approval permission and credit-note approval limits
 * (ADR-023, D13), end to end through the route handlers.
 *
 * Every case counts a side effect — a state, an audit record, a security event, a
 * financial event, an approval-limit row — and is written so it FAILS when the
 * control it names is removed:
 *
 *  - The decision codes: `sal.credit-note-approve` and `sal.credit-note-reject`
 *    declare `sal.credit.approve` with `sal.finance.view`; requesting and withdrawing
 *    keep `sal.credit.manage`. A caller holding the request code alone is refused
 *    both decisions; a caller holding the approval code in another branch only is
 *    refused and the refusal is recorded.
 *  - The limit: an approver with a credit-note limit set by somebody else, through
 *    the shipped limit operation, approves within it; no limit, a discount limit
 *    only, a limit in another currency and a limit the approver set themselves are
 *    each refused with their own rule; a note over the limit is refused.
 *  - Anti-splitting: the limit covers every approved credit on the invoice, this
 *    note included, so two notes each under it whose total exceeds it are not both
 *    approved — sequentially, and when the two approvals are FORCED to race behind a
 *    held invoice row lock.
 *  - Rejection needs the approval code and no limit; withdrawal is unchanged.
 *  - Another tenant is a 404.
 *  - D12: each refused attempt leaves exactly ONE security event naming the
 *    operation, the note and the rule, and no amount.
 *  - The limit operation files a sub-minor-unit amount and a zero credit-note limit
 *    on the amount field.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.credit-note-approve: route service authorization success denial audit isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { establishP1_19Fixtures, waitForBlockedBackends, type Principal } from './p1-19-helpers';
import {
  CREDIT_APPROVE,
  CREDIT_MANAGE,
  FINANCE_VIEW,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_TENANT_B,
  auditCountFor,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  invoiceOpenReceivable,
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { POST as REQUEST_CREDIT_NOTE } from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import {
  CREDIT_NOTE_APPROVE_OPERATION,
  POST as APPROVE_CREDIT_NOTE,
} from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import {
  CREDIT_NOTE_REJECT_OPERATION,
  POST as REJECT_CREDIT_NOTE,
} from '@/app/api/v1/credit-notes/[creditNoteId]/rejection/route';
import {
  CREDIT_NOTE_WITHDRAW_OPERATION,
  POST as WITHDRAW_CREDIT_NOTE,
} from '@/app/api/v1/credit-notes/[creditNoteId]/withdrawal/route';
import { POST as CREATE_APPROVAL_LIMIT } from '@/app/api/v1/iam/approval-limits/route';
import { FakeIdentityProvider, iamModule, setIdentityProvider } from '@/modules/iam';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly requiredPermissions?: readonly string[];
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface CreditNoteResultBody {
  readonly creditNote: {
    readonly id: string;
    readonly approvalState: string;
    readonly approvedBy: string | null;
    readonly recordVersion: number;
  };
  readonly replayed: boolean;
}

const DECIDING = [FINANCE_VIEW, CREDIT_MANAGE, CREDIT_APPROVE];

/** A deterministic principal of this suite, unrestricted in tenant A. */
const principal = (suffix: string, permissions: readonly string[]): Principal => ({
  roleId: `f1330000-0000-4000-8000-00000000${suffix}1`,
  userId: `f1330000-0000-4000-8000-00000000${suffix}2`,
  subject: `fx_od_fd2c_${suffix}`,
  tenantId: TENANT_A,
  permissions,
});

/** B: decides credit notes; its USD limit is set by C through the shipped operation. */
const APPROVER = principal('0a0', DECIDING);
/** C: sets approval limits (`iam.approval.manage`) and holds nothing else. */
const LIMIT_SETTER = principal('0b0', ['iam.approval.manage']);
/** Requests and reads credit notes, and may not decide them. */
const MANAGE_ONLY = principal('0c0', [FINANCE_VIEW, CREDIT_MANAGE]);
/** Decides, with no limit at all. */
const NO_LIMIT = principal('0d0', DECIDING);
/** Decides, with only a discount limit. */
const DISCOUNT_ONLY = principal('0e0', DECIDING);
/** Decides, with a credit-note limit in JOD only. */
const OTHER_CURRENCY = principal('0f0', DECIDING);
/** Decides, with a credit-note limit it set itself. */
const SELF_SET = principal('1a0', DECIDING);

const SUITE_PRINCIPALS = [
  APPROVER,
  LIMIT_SETTER,
  MANAGE_ONLY,
  NO_LIMIT,
  DISCOUNT_ONLY,
  OTHER_CURRENCY,
  SELF_SET,
];

async function seedPrincipal(p: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'test_harness',$3,$3||'@example.test','FD2C principal','active',$4)
     ON CONFLICT (id) DO NOTHING`,
    [p.userId, p.tenantId, p.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'FD2C fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [p.roleId, p.tenantId, p.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,perm.id,'allow',$3::uuid FROM iam.permissions perm
      WHERE perm.permission_code = ANY($4)
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [p.tenantId, p.roleId, USER_A, p.permissions]
  );
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [p.tenantId, p.userId, p.roleId]
  );
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [p.tenantId, p.userId, p.roleId, USER_A]
    );
  }
}

/** A limit written on the owner connection, attributed to `setBy`. */
async function seedLimit(
  p: Principal,
  limitType: string,
  amount: string,
  currency: string,
  setBy: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
     SELECT $1,$2,$3,$4,$5::numeric,$6,'2020-01-01'::date,$7
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1 AND company_id = $2 AND user_id = $3
           AND limit_type = $4 AND currency_code = $6)`,
    [TENANT_A, COMPANY_A1, p.userId, limitType, amount, currency, setBy]
  );
}

/**
 * B's USD 50.00 limit, set by C. The limit-operation case creates it through the
 * shipped route; a case that runs on its own finds it written the same way here.
 */
const approverLimit = () => seedLimit(APPROVER, 'credit_note', '50.00', 'USD', LIMIT_SETTER.userId);

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

function commandHeaders(key: string, version?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': key,
  };
  if (version !== undefined) headers['if-match'] = String(version);
  return headers;
}

const noteRoute = (
  handler: unknown,
  creditNoteId: string,
  suffix: string,
  init: { readonly body?: unknown; readonly version?: number }
): Promise<Response> =>
  (handler as ParamHandler<{ creditNoteId: string }>)(
    new Request(`http://localhost/api/v1/credit-notes/${creditNoteId}/${suffix}`, {
      method: 'POST',
      headers: commandHeaders(randomUUID(), init.version),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    { params: Promise.resolve({ creditNoteId }) }
  );

const approve = (creditNoteId: string) =>
  noteRoute(APPROVE_CREDIT_NOTE, creditNoteId, 'approval', {});

const reject = (creditNoteId: string, version: number) =>
  noteRoute(REJECT_CREDIT_NOTE, creditNoteId, 'rejection', {
    version,
    body: { reason: 'Raised against the wrong invoice' },
  });

const withdraw = (creditNoteId: string, version: number) =>
  noteRoute(WITHDRAW_CREDIT_NOTE, creditNoteId, 'withdrawal', { version });

/** A pending note raised through the route by SAL_FULL. */
async function pendingNote(
  invoiceId: string,
  amount: string
): Promise<{ id: string; version: number }> {
  authAs(SAL_FULL);
  const response = await (REQUEST_CREDIT_NOTE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/credit-notes`, {
      method: 'POST',
      headers: commandHeaders(randomUUID()),
      body: JSON.stringify({ amount, reason: 'credit limits probe' }),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );
  if (response.status !== 201) {
    throw new Error(`fixture credit note failed with ${response.status}: ${await response.text()}`);
  }
  const note = (await bodyOf<CreditNoteResultBody>(response)).creditNote;
  return { id: note.id, version: note.recordVersion };
}

async function stateOf(creditNoteId: string): Promise<string> {
  const result = await admin.query<{ approval_state: string }>(
    `SELECT approval_state FROM sal.credit_notes WHERE id = $1`,
    [creditNoteId]
  );
  return result.rows[0]?.approval_state ?? '';
}

/** Business-rule refusal events recorded for one note, optionally one rule. */
const refusals = (creditNoteId: string, rule?: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
    [`%entity=sal.credit_note/${creditNoteId} ${rule === undefined ? '' : `rule=${rule} `}%`]
  );

const issuedEvents = (creditNoteId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.financial_events
      WHERE source_id = $1 AND event_type = 'credit_note_issued'`,
    [creditNoteId]
  );

/** Asserts a D13 refusal: 403, the rule on the path parameter, one event, nothing moved. */
async function expectRefused(
  response: Response,
  creditNoteId: string,
  rule: string
): Promise<void> {
  expect(response.status).toBe(403);
  const problem = await bodyOf<ProblemBody>(response);
  expect(problem.code).toBe('ERR-IAM-001');
  expect(problem.violations).toEqual([{ path: 'path.creditNoteId', rule }]);
  expect(await stateOf(creditNoteId)).toBe('pending');
  expect(await issuedEvents(creditNoteId)).toBe(0);
  expect(await refusals(creditNoteId, rule)).toBe(1);
  expect(await refusals(creditNoteId)).toBe(1);
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimeAppPool(10);
  __setPrimaryPoolForTests(runtime);
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
  for (const p of SUITE_PRINCIPALS) await seedPrincipal(p);
  // The limit operation lives in the iam module, whose composition root reads
  // identity-provider credentials unless a provider is installed first (ADR-019),
  // and replaces the session authenticator once when composed. Both happen here, so
  // every request below runs as the principal `authAs` names.
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'od-fd2c-limits-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );
  iamModule();
  await seedLimit(DISCOUNT_ONLY, 'discount', '1000.00', 'USD', LIMIT_SETTER.userId);
  await seedLimit(OTHER_CURRENCY, 'credit_note', '1000.000', 'JOD', LIMIT_SETTER.userId);
  await seedLimit(SELF_SET, 'credit_note', '1000.00', 'USD', SELF_SET.userId);
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  await admin.query(`DELETE FROM iam.approval_limits WHERE tenant_id = $1 AND user_id = ANY($2)`, [
    TENANT_A,
    SUITE_PRINCIPALS.map((p) => p.userId),
  ]);
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.end();
});

describe('D13 — the decision codes are declared as the Owner rule requires', () => {
  it('approve and reject declare sal.credit.approve; withdraw keeps sal.credit.manage', () => {
    expect(CREDIT_NOTE_APPROVE_OPERATION.permissions).toEqual([CREDIT_APPROVE, FINANCE_VIEW]);
    expect(CREDIT_NOTE_REJECT_OPERATION.permissions).toEqual([CREDIT_APPROVE, FINANCE_VIEW]);
    expect(CREDIT_NOTE_WITHDRAW_OPERATION.permissions).toEqual([CREDIT_MANAGE]);
    for (const operation of [CREDIT_NOTE_APPROVE_OPERATION, CREDIT_NOTE_REJECT_OPERATION]) {
      expect(operation.scope).toBe('branch');
      expect(operation.auditClass).toBe('approval');
    }
  });
});

describe('D13 — the limit operation', () => {
  it('lets an administrator set a credit-note limit for somebody else, audited, and files amount refusals on the amount', async () => {
    const before = await countRowsOf(
      `SELECT count(*)::text AS n FROM iam.audit_records WHERE tenant_id = $1 AND action = 'iam.approval_limit.created'`,
      [TENANT_A]
    );
    const send = (body: Record<string, unknown>) => {
      authAs(LIMIT_SETTER);
      return CREATE_APPROVAL_LIMIT(
        new Request('http://localhost/api/v1/iam/approval-limits', {
          method: 'POST',
          headers: commandHeaders(randomUUID()),
          body: JSON.stringify({
            companyId: COMPANY_A1,
            userId: APPROVER.userId,
            limitType: 'credit_note',
            currency: 'USD',
            effectiveFrom: '2020-01-01',
            ...body,
          }),
        })
      );
    };

    const finer = await send({ amount: '50.005' });
    expect(finer.status).toBe(422);
    expect((await bodyOf<ProblemBody>(finer)).violations).toEqual([
      { path: 'body.amount', rule: 'minor_unit_scale' },
    ]);
    const zero = await send({ amount: '0.00' });
    expect(zero.status).toBe(422);
    expect((await bodyOf<ProblemBody>(zero)).violations).toEqual([
      { path: 'body.amount', rule: 'not_positive' },
    ]);

    const created = await send({ amount: '50.00' });
    expect(created.status).toBe(201);
    const stored = await admin.query<{ amount: string; created_by: string; limit_type: string }>(
      `SELECT amount::text AS amount, created_by, limit_type FROM iam.approval_limits
        WHERE tenant_id = $1 AND user_id = $2 AND limit_type = 'credit_note'`,
      [TENANT_A, APPROVER.userId]
    );
    expect(stored.rows).toEqual([
      { amount: '50.0000', created_by: LIMIT_SETTER.userId, limit_type: 'credit_note' },
    ]);
    const after = await countRowsOf(
      `SELECT count(*)::text AS n FROM iam.audit_records WHERE tenant_id = $1 AND action = 'iam.approval_limit.created'`,
      [TENANT_A]
    );
    expect(after - before).toBe(1);
  });
});

describe('D13 — an approval within a limit somebody else set', () => {
  it('approves, audits once and reduces the receivable', async () => {
    await approverLimit();
    const invoice = await seedIssuedInvoice('fd2c_within');
    const note = await pendingNote(invoice.invoiceId, '50.00');
    authAs(APPROVER);
    const response = await approve(note.id);
    expect(response.status).toBe(200);
    const body = await bodyOf<CreditNoteResultBody>(response);
    expect(body.creditNote.approvalState).toBe('approved');
    expect(body.creditNote.approvedBy).toBe(APPROVER.userId);
    expect(await auditCountFor('sal.credit_note.approved', note.id)).toBe(1);
    expect(await issuedEvents(note.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('50.0000');
    expect(await refusals(note.id)).toBe(0);
  });
});

describe('D13 — the refusals, each named and recorded once', () => {
  it('refuses a caller holding sal.credit.manage only, before any service runs', async () => {
    const invoice = await seedIssuedInvoice('fd2c_manage_only');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(MANAGE_ONLY);
    const approved = await approve(note.id);
    expect(approved.status).toBe(403);
    expect((await bodyOf<ProblemBody>(approved)).requiredPermissions).toContain(CREDIT_APPROVE);
    authAs(MANAGE_ONLY);
    const rejected = await reject(note.id, note.version);
    expect(rejected.status).toBe(403);
    expect((await bodyOf<ProblemBody>(rejected)).requiredPermissions).toContain(CREDIT_APPROVE);
    expect(await stateOf(note.id)).toBe('pending');
  });

  it('refuses a caller holding the approval code in another branch only, and records it', async () => {
    const invoice = await seedIssuedInvoice('fd2c_elsewhere');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(SAL_PERMISSION_ELSEWHERE);
    const response = await approve(note.id);
    expect(response.status).toBe(403);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-IAM-001');
    expect(await stateOf(note.id)).toBe('pending');
    expect(await refusals(note.id, 'credit_approval_permission_missing')).toBe(1);
    expect(await refusals(note.id)).toBe(1);
  });

  it('refuses an approver with no credit-note limit', async () => {
    const invoice = await seedIssuedInvoice('fd2c_no_limit');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(NO_LIMIT);
    await expectRefused(await approve(note.id), note.id, 'credit_no_approval_limit');
  });

  it('refuses an approver whose only limit is a discount limit', async () => {
    const invoice = await seedIssuedInvoice('fd2c_discount_only');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(DISCOUNT_ONLY);
    await expectRefused(await approve(note.id), note.id, 'credit_no_approval_limit');
  });

  it('refuses an approver whose credit-note limit is in another currency', async () => {
    const invoice = await seedIssuedInvoice('fd2c_other_currency');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(OTHER_CURRENCY);
    await expectRefused(await approve(note.id), note.id, 'credit_limit_currency_mismatch');
  });

  it('refuses an approver whose only credit-note limit is one they set themselves', async () => {
    const invoice = await seedIssuedInvoice('fd2c_self_set');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(SELF_SET);
    await expectRefused(await approve(note.id), note.id, 'credit_limit_self_created');
  });

  it('refuses a note over the limit, and records no amount', async () => {
    await approverLimit();
    const invoice = await seedIssuedInvoice('fd2c_over');
    const note = await pendingNote(invoice.invoiceId, '50.01');
    authAs(APPROVER);
    await expectRefused(await approve(note.id), note.id, 'credit_limit_exceeded');
    const details = await admin.query<{ detail: string }>(
      `SELECT detail FROM iam.security_events WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
      [`%${note.id}%`]
    );
    expect(details.rows.map((row) => row.detail)).toEqual([
      `operation=sal.credit-note-approve entity=sal.credit_note/${note.id} rule=credit_limit_exceeded outcome=refused`,
    ]);
  });
});

describe('D13 — anti-splitting', () => {
  it('refuses the second of two notes each under the limit whose total exceeds it', async () => {
    await approverLimit();
    const invoice = await seedIssuedInvoice('fd2c_split');
    const first = await pendingNote(invoice.invoiceId, '30.00');
    const second = await pendingNote(invoice.invoiceId, '30.00');
    authAs(APPROVER);
    expect((await approve(first.id)).status).toBe(200);
    authAs(APPROVER);
    await expectRefused(await approve(second.id), second.id, 'credit_limit_exceeded');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('70.0000');
  });

  it('approves at most the limit-covered total when two approvals are forced to race', async () => {
    await approverLimit();
    const invoice = await seedIssuedInvoice('fd2c_race');
    const first = await pendingNote(invoice.invoiceId, '30.00');
    const second = await pendingNote(invoice.invoiceId, '30.00');
    const gate = await admin.connect();
    const inFlight: Promise<Response>[] = [];
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT id FROM sal.invoices WHERE id = $1 FOR UPDATE', [invoice.invoiceId]);
      try {
        let arrived = 0;
        for (const id of [first.id, second.id]) {
          authAs(APPROVER);
          inFlight.push(approve(id));
          arrived += 1;
          await waitForBlockedBackends(arrived);
        }
      } finally {
        await gate.query('ROLLBACK');
      }
      const responses = await Promise.all(inFlight);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
    } finally {
      await Promise.allSettled(inFlight);
      gate.release();
    }
    const states = [await stateOf(first.id), await stateOf(second.id)].sort();
    expect(states).toEqual(['approved', 'pending']);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('70.0000');
    expect(
      (await refusals(first.id, 'credit_limit_exceeded')) +
        (await refusals(second.id, 'credit_limit_exceeded'))
    ).toBe(1);
  });
});

describe('D13 — rejection needs the code and no limit; withdrawal is unchanged', () => {
  it('lets a holder of the approval code with no limit reject', async () => {
    const invoice = await seedIssuedInvoice('fd2c_reject_no_limit');
    const note = await pendingNote(invoice.invoiceId, '99.00');
    authAs(NO_LIMIT);
    const response = await reject(note.id, note.version);
    expect(response.status).toBe(200);
    expect((await bodyOf<CreditNoteResultBody>(response)).creditNote.approvalState).toBe(
      'rejected'
    );
    expect(await auditCountFor('sal.credit_note.rejected', note.id)).toBe(1);
  });

  it('still lets only the requester withdraw', async () => {
    const invoice = await seedIssuedInvoice('fd2c_withdraw');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(APPROVER);
    const refused = await withdraw(note.id, note.version);
    expect(refused.status).toBe(409);
    expect((await bodyOf<ProblemBody>(refused)).violations).toEqual([
      { path: 'path.creditNoteId', rule: 'credit_note_withdraw_not_requester' },
    ]);
    authAs(SAL_FULL);
    expect((await withdraw(note.id, note.version)).status).toBe(200);
    expect(await stateOf(note.id)).toBe('withdrawn');
  });
});

describe('D13 — isolation', () => {
  it('refuses another tenant with the answer an unknown note gets', async () => {
    const invoice = await seedIssuedInvoice('fd2c_tenant');
    const note = await pendingNote(invoice.invoiceId, '10.00');
    authAs(SAL_TENANT_B);
    const response = await approve(note.id);
    expect(response.status).toBe(404);
    expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-RES-001');
    expect(await stateOf(note.id)).toBe('pending');
  });
});
