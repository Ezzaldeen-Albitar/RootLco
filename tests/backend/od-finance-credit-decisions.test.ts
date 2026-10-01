/**
 * P1-32-PRE-OD-FD2A — credit-note withdrawal and rejection (ADR-023, D3), the
 * credit request a return raises (D9), and refusals by business rule recorded so
 * they survive the refused command (D12), end to end through the route handlers.
 *
 * Every case counts a side effect — a state, a row, an audit record, a security
 * event, a financial event — and is written so it FAILS when the control it names
 * is removed:
 *
 *  - D3: the requester alone withdraws; another person rejects, with a reason;
 *    every decided note is terminal; a stale `If-Match` is a conflict; a replay
 *    under the same key records nothing twice; another tenant and another branch
 *    are refused; an approval racing a rejection has exactly one winner.
 *  - D9: a return raises a PENDING note and audits it as a credit request naming
 *    the return; a retried return — even once its transport record is gone —
 *    returns the first return and moves no second stock; a second return of
 *    quantities already returned is refused.
 *  - D12: each refused attempt leaves exactly ONE security event naming the
 *    operation, the entity and the rule, after the rollback; a success and the
 *    replay of a success leave none; the event is readable in its own tenant only.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.credit-note-withdraw: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 *   sal.credit-note-reject: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  PARTNER_A,
  establishP1_19Fixtures,
  waitForBlockedBackends,
  type Principal,
} from './p1-19-helpers';
import {
  INV_COUNTER,
  ITEM_A,
  cleanP1_21Fixtures,
  establishP1_21Fixtures,
  freshLocation,
  seedStock,
} from './p1-21-helpers';
import {
  PAYMENT_METHOD_A,
  SAL_APPROVER,
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
import { POST as SALE_PRICE_SET } from '@/app/api/v1/items/[itemId]/sale-prices/route';
import { POST as COUNTER_SALE_CREATE } from '@/app/api/v1/counter-sales/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { POST as REQUEST_CREDIT_NOTE } from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import { POST as APPROVE_CREDIT_NOTE } from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import {
  CREDIT_NOTE_REJECT_OPERATION,
  POST as REJECT_CREDIT_NOTE,
} from '@/app/api/v1/credit-notes/[creditNoteId]/rejection/route';
import {
  CREDIT_NOTE_WITHDRAW_OPERATION,
  POST as WITHDRAW_CREDIT_NOTE,
} from '@/app/api/v1/credit-notes/[creditNoteId]/withdrawal/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { POST as SALES_RETURN_CREATE } from '@/app/api/v1/sales-returns/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface CreditNoteBody {
  readonly id: string;
  readonly approvalState: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
  readonly approvedBy: string | null;
  readonly issuedAt: string | null;
  readonly recordVersion: number;
}

interface CreditNoteResultBody {
  readonly creditNote: CreditNoteBody;
  readonly replayed: boolean;
}

interface ReturnBody {
  readonly id: string;
  readonly creditNoteId: string | null;
  readonly status: string;
  readonly replayed?: boolean;
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

function commandHeaders(key: string, version?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': key,
  };
  if (version !== undefined) headers['if-match'] = String(version);
  return headers;
}

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: commandHeaders(key),
      body: JSON.stringify(body),
    })
  );

const noteRoute = (
  handler: unknown,
  creditNoteId: string,
  suffix: string,
  init: { readonly body?: unknown; readonly key?: string; readonly version?: number }
): Promise<Response> =>
  (handler as ParamHandler<{ creditNoteId: string }>)(
    new Request(`http://localhost/api/v1/credit-notes/${creditNoteId}/${suffix}`, {
      method: 'POST',
      headers: commandHeaders(init.key ?? randomUUID(), init.version),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    { params: Promise.resolve({ creditNoteId }) }
  );

const withdraw = (creditNoteId: string, version?: number, key?: string) =>
  noteRoute(WITHDRAW_CREDIT_NOTE, creditNoteId, 'withdrawal', {
    ...(version === undefined ? {} : { version }),
    ...(key === undefined ? {} : { key }),
  });

const reject = (creditNoteId: string, version: number | undefined, body: unknown, key?: string) =>
  noteRoute(REJECT_CREDIT_NOTE, creditNoteId, 'rejection', {
    body,
    ...(version === undefined ? {} : { version }),
    ...(key === undefined ? {} : { key }),
  });

const approve = (creditNoteId: string, key?: string) =>
  noteRoute(APPROVE_CREDIT_NOTE, creditNoteId, 'approval', key === undefined ? {} : { key });

/** A pending credit note raised through the route by `requester`. */
async function pendingNote(
  invoiceId: string,
  amount: string,
  requester: Principal = SAL_FULL
): Promise<{ id: string; version: number }> {
  authAs(requester);
  const response = await (REQUEST_CREDIT_NOTE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/credit-notes`, {
      method: 'POST',
      headers: commandHeaders(randomUUID()),
      body: JSON.stringify({ amount, reason: 'credit decisions probe' }),
    }),
    { params: Promise.resolve({ invoiceId }) }
  );
  if (response.status !== 201) {
    throw new Error(`fixture credit note failed with ${response.status}: ${await response.text()}`);
  }
  const note = (await bodyOf<CreditNoteResultBody>(response)).creditNote;
  return { id: note.id, version: note.recordVersion };
}

/** The stored state and version of a note, read on the owner connection. */
async function storedNote(creditNoteId: string): Promise<{ state: string; version: number }> {
  const result = await admin.query<{ approval_state: string; record_version: number }>(
    `SELECT approval_state, record_version FROM sal.credit_notes WHERE id = $1`,
    [creditNoteId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`credit note ${creditNoteId} is not stored`);
  return { state: row.approval_state, version: row.record_version };
}

/** Business-rule refusal events recorded for one entity, optionally one rule. */
const refusalEvents = (entityType: string, entityId: string, rule?: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
    [`%entity=${entityType}/${entityId} ${rule === undefined ? '' : `rule=${rule} `}%`]
  );

const creditEvents = (creditNoteId: string, rule?: string) =>
  refusalEvents('sal.credit_note', creditNoteId, rule);

const approvedCreditEvents = (creditNoteId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.financial_events
      WHERE source_id = $1 AND event_type = 'credit_note_issued'`,
    [creditNoteId]
  );

/** Runs requests with the race FORCED behind a held row lock, as `od-finance-controls` does. */
async function race(
  hold: { readonly sql: string; readonly values: readonly unknown[] },
  senders: readonly (() => Promise<Response>)[]
): Promise<readonly Response[]> {
  const gate = await admin.connect();
  const inFlight: Promise<Response>[] = [];
  try {
    await gate.query('BEGIN');
    await gate.query(hold.sql, [...hold.values]);
    try {
      let arrived = 0;
      for (const send of senders) {
        inFlight.push(send());
        arrived += 1;
        await waitForBlockedBackends(arrived);
      }
    } finally {
      await gate.query('ROLLBACK');
    }
    return await Promise.all(inFlight);
  } catch (error) {
    await Promise.allSettled(inFlight);
    throw error;
  } finally {
    gate.release();
  }
}

const holdCreditNote = (creditNoteId: string) => ({
  sql: 'SELECT id FROM sal.credit_notes WHERE id = $1 FOR UPDATE',
  values: [creditNoteId],
});

/** Two principals holding `iam.audit.view` only — one per tenant — to read the security log. */
const AUDIT_A: Principal = {
  roleId: 'f1320000-0000-4000-8000-00000000fa01',
  userId: 'f1320000-0000-4000-8000-00000000fa02',
  subject: 'fx_od_fd2a_audit_a',
  tenantId: TENANT_A,
  permissions: ['iam.audit.view'],
};
const AUDIT_B: Principal = {
  roleId: 'f1320000-0000-4000-8000-00000000fb01',
  userId: 'f1320000-0000-4000-8000-00000000fb02',
  subject: 'fx_od_fd2a_audit_b',
  tenantId: TENANT_B,
  permissions: ['iam.audit.view'],
};

async function seedAuditReader(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'fixture',$3,$3||'@example.test','FD2A audit reader','active',$4)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'FD2A audit reader',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = 'iam.audit.view'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [principal.tenantId, principal.roleId, USER_A]
  );
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [principal.tenantId, principal.userId, principal.roleId]
  );
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
  }
}

/** What a principal of `tenantId` can read of the security log for one detail, through RLS. */
async function visibleRefusals(reader: Principal, detailLike: string): Promise<number> {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`,
      [reader.tenantId, reader.userId]
    );
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.security_events WHERE detail LIKE $1`,
      [detailLike]
    );
    return Number(result.rows[0]?.n ?? '0');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

let taxClassThird = '';

async function provisionTaxClass(): Promise<string> {
  const code = `fx_odfd2a_${randomUUID().slice(0, 8)}`;
  const taxClass = await admin.query<{ id: string }>(
    `INSERT INTO org.tax_classes (tenant_id, company_id, tax_class_code, name, created_by)
     VALUES ($1,$2,$3,'Credit decisions third',$4) RETURNING id`,
    [TENANT_A, COMPANY_A1, code, USER_A]
  );
  const id = taxClass.rows[0]?.id ?? '';
  await admin.query(
    `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
     VALUES ($1,$2,$3,0.333333,DATE '2020-01-01',$4)`,
    [TENANT_A, COMPANY_A1, id, USER_A]
  );
  return id;
}

/** An ISSUED counter sale of three units on one line, sold from a fresh cell. */
async function issuedThreeUnitSale(): Promise<{ invoiceId: string; lineId: string; cell: string }> {
  const cell = await freshLocation();
  await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '10' });
  authAs(INV_COUNTER);
  const price = await (SALE_PRICE_SET as ParamHandler<{ itemId: string }>)(
    new Request(`http://localhost/api/v1/items/${ITEM_A}/sale-prices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        currencyCode: 'USD',
        unitPrice: '5.0000',
        taxClassId: taxClassThird,
      }),
    }),
    { params: Promise.resolve({ itemId: ITEM_A }) }
  );
  if (price.status >= 300) throw new Error(`fixture price failed: ${await price.text()}`);
  const sale = await bodyOf<{
    invoice: { id: string };
    lines: readonly { id: string }[];
    recordVersion: number;
  }>(
    await post(COUNTER_SALE_CREATE, '/api/v1/counter-sales', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A, locationId: cell, quantity: '3' }],
    })
  );
  const issued = await (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${sale.invoice.id}/issuance`, {
      method: 'POST',
      headers: commandHeaders(randomUUID(), sale.recordVersion),
    }),
    { params: Promise.resolve({ invoiceId: sale.invoice.id }) }
  );
  if (issued.status !== 200) throw new Error(`fixture issue failed: ${await issued.text()}`);
  return { invoiceId: sale.invoice.id, lineId: sale.lines[0]?.id ?? '', cell };
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimeAppPool(10);
  __setPrimaryPoolForTests(runtime);
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await establishP1_22Fixtures(admin);
  await seedAuditReader(AUDIT_A);
  await seedAuditReader(AUDIT_B);
  taxClassThird = await provisionTaxClass();
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.end();
});

describe('D3 — the two decisions are declared as the Owner rule requires', () => {
  it('declares withdrawal for the credit code and rejection for the approval code (D13) and the finance view', () => {
    expect(CREDIT_NOTE_WITHDRAW_OPERATION).toMatchObject({
      id: 'sal.credit-note-withdraw',
      permissions: ['sal.credit.manage'],
      scope: 'branch',
      auditClass: 'financial',
      auditAction: 'sal.credit_note.withdrawn',
      idempotent: true,
      versionGuarded: true,
    });
    expect(CREDIT_NOTE_REJECT_OPERATION).toMatchObject({
      id: 'sal.credit-note-reject',
      permissions: ['sal.credit.approve', 'sal.finance.view'],
      scope: 'branch',
      auditClass: 'approval',
      auditAction: 'sal.credit_note.rejected',
      idempotent: true,
      versionGuarded: true,
    });
  });
});

describe('D3 — the requester withdraws their own pending request', () => {
  it('withdraws, audits once, credits nothing, and refuses approving afterwards', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_withdraw');
    const note = await pendingNote(invoice.invoiceId, '30.0000');

    authAs(SAL_FULL);
    const response = await withdraw(note.id, note.version);
    expect(response.status).toBe(200);
    const result = await bodyOf<CreditNoteResultBody>(response);
    expect(result.replayed).toBe(false);
    expect(result.creditNote).toMatchObject({
      approvalState: 'withdrawn',
      decidedBy: SAL_FULL.userId,
      approvedBy: null,
      issuedAt: null,
      decisionReason: null,
    });
    expect(result.creditNote.decidedAt).not.toBeNull();
    expect(await auditCountFor('sal.credit_note.withdrawn', note.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
    expect(await creditEvents(note.id)).toBe(0);

    // Terminal: the second person can no longer approve it, and the refusal is recorded.
    authAs(SAL_APPROVER);
    const late = await approve(note.id);
    expect(late.status).toBe(409);
    expect((await bodyOf<ProblemBody>(late)).code).toBe('ERR-TRN-001');
    expect(await approvedCreditEvents(note.id)).toBe(0);
    expect(await creditEvents(note.id, 'credit_note_decision_frozen')).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
  });

  it('refuses anyone but the requester, by name, and records one refusal', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_withdraw_other');
    const note = await pendingNote(invoice.invoiceId, '30.0000');

    authAs(SAL_APPROVER);
    const refused = await withdraw(note.id, note.version);
    expect(refused.status).toBe(409);
    const body = await bodyOf<ProblemBody>(refused);
    expect(body.code).toBe('ERR-TRN-001');
    expect(body.violations).toEqual([
      { path: 'path.creditNoteId', rule: 'credit_note_withdraw_not_requester' },
    ]);
    expect(await storedNote(note.id)).toEqual({ state: 'pending', version: note.version });
    expect(await creditEvents(note.id, 'credit_note_withdraw_not_requester')).toBe(1);
    expect(await auditCountFor('sal.credit_note.withdrawn', note.id)).toBe(0);
  });

  it('replays the same key without a second audit record or any refusal event', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_withdraw_replay');
    const note = await pendingNote(invoice.invoiceId, '30.0000');
    const key = randomUUID();

    authAs(SAL_FULL);
    const first = await withdraw(note.id, note.version, key);
    expect(first.status).toBe(200);
    authAs(SAL_FULL);
    const again = await withdraw(note.id, note.version, key);
    expect(again.status).toBe(200);
    expect(await bodyOf<CreditNoteResultBody>(again)).toEqual(
      await bodyOf<CreditNoteResultBody>(first)
    );
    expect(await auditCountFor('sal.credit_note.withdrawn', note.id)).toBe(1);
    expect(await creditEvents(note.id)).toBe(0);
  });
});

describe('D3 — only another authorised person rejects, with a reason', () => {
  it('rejects with the reason, audits once, and refuses approving afterwards', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_reject');
    const note = await pendingNote(invoice.invoiceId, '40.0000');

    authAs(SAL_APPROVER);
    const response = await reject(note.id, note.version, { reason: '  Raised twice  ' });
    expect(response.status).toBe(200);
    const result = await bodyOf<CreditNoteResultBody>(response);
    expect(result.creditNote).toMatchObject({
      approvalState: 'rejected',
      decidedBy: SAL_APPROVER.userId,
      decisionReason: 'Raised twice',
      approvedBy: null,
      issuedAt: null,
    });
    expect(await auditCountFor('sal.credit_note.rejected', note.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    authAs(SAL_APPROVER);
    const late = await approve(note.id);
    expect(late.status).toBe(409);
    expect(await approvedCreditEvents(note.id)).toBe(0);
  });

  it('refuses the requester rejecting their own request, by name', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_self_reject');
    const note = await pendingNote(invoice.invoiceId, '40.0000');

    authAs(SAL_FULL);
    const refused = await reject(note.id, note.version, { reason: 'Mine to drop' });
    expect(refused.status).toBe(409);
    expect((await bodyOf<ProblemBody>(refused)).violations).toEqual([
      { path: 'path.creditNoteId', rule: 'credit_note_self_rejection' },
    ]);
    expect(await storedNote(note.id)).toEqual({ state: 'pending', version: note.version });
    expect(await creditEvents(note.id, 'credit_note_self_rejection')).toBe(1);
  });

  it('refuses a missing or blank reason on the reason field, and records no refusal', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_reject_reason');
    const note = await pendingNote(invoice.invoiceId, '40.0000');

    for (const body of [{}, { reason: '' }, { reason: '    ' }]) {
      authAs(SAL_APPROVER);
      const refused = await reject(note.id, note.version, body);
      expect(refused.status, JSON.stringify(body)).toBe(422);
      const problem = await bodyOf<ProblemBody>(refused);
      expect(problem.code).toBe('ERR-VAL-001');
      expect(problem.violations?.[0]?.path).toBe('body.reason');
    }
    expect(await storedNote(note.id)).toEqual({ state: 'pending', version: note.version });
    expect(await creditEvents(note.id)).toBe(0);
  });
});

describe('D3 — a decided note is terminal, and the version guards every decision', () => {
  it('refuses withdrawing or rejecting an approved note, recording each refusal', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_terminal');
    const note = await pendingNote(invoice.invoiceId, '20.0000');
    authAs(SAL_APPROVER);
    expect((await approve(note.id)).status).toBe(200);
    const { version } = await storedNote(note.id);

    authAs(SAL_FULL);
    const withdrawn = await withdraw(note.id, version);
    expect(withdrawn.status).toBe(409);
    expect((await bodyOf<ProblemBody>(withdrawn)).violations).toEqual([
      { path: 'path.creditNoteId', rule: 'credit_note_decision_frozen' },
    ]);
    authAs(SAL_APPROVER);
    const rejected = await reject(note.id, version, { reason: 'Too late' });
    expect(rejected.status).toBe(409);
    expect(await storedNote(note.id)).toEqual({ state: 'approved', version });
    expect(await creditEvents(note.id, 'credit_note_decision_frozen')).toBe(2);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('80.0000');
  });

  it('answers a stale version with a conflict and a missing one with 428, recording neither', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_stale');
    const note = await pendingNote(invoice.invoiceId, '20.0000');

    authAs(SAL_FULL);
    const stale = await withdraw(note.id, note.version + 1);
    expect(stale.status).toBe(409);
    expect((await bodyOf<ProblemBody>(stale)).code).toBe('ERR-CON-001');
    authAs(SAL_APPROVER);
    const staleReject = await reject(note.id, note.version + 5, { reason: 'Old read' });
    expect((await bodyOf<ProblemBody>(staleReject)).code).toBe('ERR-CON-001');
    authAs(SAL_FULL);
    const missing = await withdraw(note.id);
    expect(missing.status).toBe(428);
    expect(await storedNote(note.id)).toEqual({ state: 'pending', version: note.version });
    expect(await creditEvents(note.id)).toBe(0);
  });

  it('refuses another tenant as not found and another branch as not permitted', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_isolation');
    const note = await pendingNote(invoice.invoiceId, '20.0000');

    authAs(SAL_TENANT_B);
    const foreign = await reject(note.id, note.version, { reason: 'Not mine' });
    expect(foreign.status).toBe(404);
    authAs(SAL_TENANT_B);
    expect((await withdraw(note.id, note.version)).status).toBe(404);

    authAs(SAL_PERMISSION_ELSEWHERE);
    const elsewhere = await reject(note.id, note.version, { reason: 'Other branch' });
    expect(elsewhere.status).toBe(403);
    expect((await bodyOf<ProblemBody>(elsewhere)).code).toBe('ERR-IAM-001');
    expect(await storedNote(note.id)).toEqual({ state: 'pending', version: note.version });
  });

  it('lets exactly one of an approval and a rejection win the same note, in either order', async () => {
    for (const first of ['approve', 'reject'] as const) {
      const invoice = await seedIssuedInvoice(`odfd2a_race_${first}`);
      const note = await pendingNote(invoice.invoiceId, '25.0000');
      const approveSender = () => {
        authAs(SAL_APPROVER);
        return approve(note.id);
      };
      const rejectSender = () => {
        authAs(SAL_APPROVER);
        return reject(note.id, note.version, { reason: 'Racing the approval' });
      };
      const responses = await race(
        holdCreditNote(note.id),
        first === 'approve' ? [approveSender, rejectSender] : [rejectSender, approveSender]
      );
      expect(
        responses.map((response) => response.status),
        first
      ).toEqual([200, 409]);
      const stored = await storedNote(note.id);
      expect(stored.state, first).toBe(first === 'approve' ? 'approved' : 'rejected');
      expect(await approvedCreditEvents(note.id), first).toBe(first === 'approve' ? 1 : 0);
      expect(await invoiceOpenReceivable(invoice.invoiceId), first).toBe(
        first === 'approve' ? '75.0000' : '100.0000'
      );
    }
  });
});

describe('D12 — refusals by business rule are recorded after the rollback', () => {
  it('records a refused self-approval once, leaves the note unchanged, and reads only in its tenant', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_self_approval');
    const note = await pendingNote(invoice.invoiceId, '10.0000');

    authAs(SAL_FULL);
    const refused = await approve(note.id);
    expect(refused.status).toBe(409);
    expect((await bodyOf<ProblemBody>(refused)).violations).toEqual([
      { path: 'path.creditNoteId', rule: 'credit_note_self_approval' },
    ]);
    expect(await storedNote(note.id)).toEqual({ state: 'pending', version: note.version });

    const events = await admin.query<{
      tenant_id: string;
      actor_id: string;
      severity: string;
      detail: string;
    }>(
      `SELECT tenant_id, actor_id, severity, detail FROM iam.security_events
        WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
      [`%entity=sal.credit_note/${note.id} %`]
    );
    expect(events.rows).toEqual([
      {
        tenant_id: TENANT_A,
        actor_id: SAL_FULL.userId,
        severity: 'warning',
        detail:
          `operation=sal.credit-note-approve entity=sal.credit_note/${note.id} ` +
          'rule=credit_note_self_approval outcome=refused',
      },
    ]);
    // Nothing but the rule: no amount, no reason text, no name.
    expect(events.rows[0]?.detail).not.toContain('10.00');
    expect(events.rows[0]?.detail).not.toContain('credit decisions probe');

    // The record is readable in its own tenant, and not from another one.
    const like = `%entity=sal.credit_note/${note.id} %`;
    expect(await visibleRefusals(AUDIT_A, like)).toBe(1);
    expect(await visibleRefusals(AUDIT_B, like)).toBe(0);
  });

  it('records nothing for a successful approval or for its replay', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_success');
    const note = await pendingNote(invoice.invoiceId, '10.0000');
    const key = randomUUID();
    authAs(SAL_APPROVER);
    expect((await approve(note.id, key)).status).toBe(200);
    authAs(SAL_APPROVER);
    expect((await approve(note.id, key)).status).toBe(200);
    expect(await approvedCreditEvents(note.id)).toBe(1);
    expect(await creditEvents(note.id)).toBe(0);
  });

  it('records a refused over-allocation once, naming the receipt and nothing of the money', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_over_allocation');
    authAs(SAL_FULL);
    const receipt = await post(RECORD_PAYMENT, '/api/v1/payments', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency: 'USD',
      amount: '150.00',
    });
    expect(receipt.status).toBe(201);
    const receiptId = (await bodyOf<{ id: string }>(receipt)).id;

    authAs(SAL_FULL);
    const refused = await (ALLOCATE_PAYMENT as ParamHandler<{ paymentId: string }>)(
      new Request(`http://localhost/api/v1/payments/${receiptId}/allocations`, {
        method: 'POST',
        headers: commandHeaders(randomUUID()),
        body: JSON.stringify({ invoiceId: invoice.invoiceId, amount: '120.00', currency: 'USD' }),
      }),
      { params: Promise.resolve({ paymentId: receiptId }) }
    );
    expect(refused.status).toBe(409);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`,
        [receiptId]
      )
    ).toBe(0);
    expect(await refusalEvents('sal.receipt', receiptId, 'payment_over_allocation')).toBe(1);
    const detail = await admin.query<{ detail: string }>(
      `SELECT detail FROM iam.security_events WHERE detail LIKE $1`,
      [`%entity=sal.receipt/${receiptId} %`]
    );
    expect(detail.rows[0]?.detail).toBe(
      `operation=sal.payment-allocate entity=sal.receipt/${receiptId} ` +
        'rule=payment_over_allocation outcome=refused'
    );
  });
});

describe('D9 — a return raises a pending credit request, audited, and never twice', () => {
  it('audits the credit request with the return, keeps it pending, and replays a retry exactly once', async () => {
    const sale = await issuedThreeUnitSale();
    const key = randomUUID();
    const attempt = {
      sourceKind: 'invoice_line',
      sourceId: sale.lineId,
      quantity: '3',
      condition: 'restockable',
      receivedLocationId: sale.cell,
      reason: 'All three back',
    } as const;

    // The counter holds the inventory code and the finance view, and NOT the
    // credit code: receiving a return needs no credit authority.
    authAs(INV_COUNTER);
    const first = await post(SALES_RETURN_CREATE, '/api/v1/sales-returns', attempt, key);
    expect(first.status).toBe(201);
    const received = await bodyOf<ReturnBody>(first);
    expect(received.status).toBe('credit_requested');
    const noteId = received.creditNoteId ?? '';
    expect(noteId).not.toBe('');
    expect((await storedNote(noteId)).state).toBe('pending');

    // The credit request is audited as one, naming the return.
    expect(await auditCountFor('sal.credit_note.requested', noteId)).toBe(1);
    const linked = await admin.query<{ value: string }>(
      `SELECT d.new_value_masked AS value
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = 'sal.credit_note.requested' AND r.entity_id = $1
          AND d.field_name = 'salesReturnId'`,
      [noteId]
    );
    expect(linked.rows.map((row) => row.value)).toEqual([received.id]);

    const movements = () =>
      countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_movements
          WHERE reference_kind = 'sales_return' AND reference_id = $1`,
        [received.id]
      );
    const notesOnInvoice = () =>
      countRowsOf(`SELECT count(*)::text AS n FROM sal.credit_notes WHERE invoice_id = $1`, [
        sale.invoiceId,
      ]);
    const movementsBefore = await movements();
    expect(movementsBefore).toBeGreaterThan(0);

    // A double submission under the same key.
    authAs(INV_COUNTER);
    const doubled = await post(SALES_RETURN_CREATE, '/api/v1/sales-returns', attempt, key);
    expect((await bodyOf<ReturnBody>(doubled)).id).toBe(received.id);

    // The retry after an uncertain outcome, once the transport record is gone: the
    // return took the last unit, and it must still answer with itself rather than
    // refuse as "nothing left to return" or receive a second time.
    await admin.query(
      `DELETE FROM shared.idempotency_keys WHERE tenant_id = $1 AND idempotency_key = $2`,
      [TENANT_A, key]
    );
    authAs(INV_COUNTER);
    const retried = await post(SALES_RETURN_CREATE, '/api/v1/sales-returns', attempt, key);
    expect(retried.status).toBe(200);
    expect((await bodyOf<ReturnBody>(retried)).id).toBe(received.id);

    expect(await movements()).toBe(movementsBefore);
    expect(await notesOnInvoice()).toBe(1);
    expect(await auditCountFor('sal.credit_note.requested', noteId)).toBe(1);

    // A second, distinct return of quantities already returned is refused.
    authAs(INV_COUNTER);
    const again = await post(SALES_RETURN_CREATE, '/api/v1/sales-returns', {
      ...attempt,
      quantity: '1',
    });
    expect(again.status).toBe(409);
    expect(await notesOnInvoice()).toBe(1);
    // Never approved by the return itself.
    expect(await approvedCreditEvents(noteId)).toBe(0);
  });
});
