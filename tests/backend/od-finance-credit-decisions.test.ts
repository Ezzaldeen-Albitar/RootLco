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
 *    A credit-note REQUEST above what remains creditable is one of them (finance
 *    checkpoint DF-3), and an over-allocation names the bound it broke on the
 *    amount (DF-7) without the figures.
 *
 *  - Finance checkpoint fixes B (DF-B1, DF-B3, DF-B4): the credit-note detail
 *    names the invoice, its payer, the return that raised the note and the
 *    people on it — names only for a reader who may read customers and users —
 *    and stays refused to another tenant and another branch; the balance read
 *    states the moment it was read on the database clock; the invoice list
 *    narrows to one kind of sale.
 *
 *  - D2, part 1 (P1-32-PRE-OD-FD2A): a credit is bounded by what the invoice can
 *    still be credited — its gross less the credits already approved — so a paid
 *    invoice is creditable, and the excess over what it still owed is one open
 *    refund obligation, audited, with its financial event, shown on the approval,
 *    the note's detail and the settlement view (`refundStatus` `owed`). Nothing is
 *    paid. A refused approval past the ceiling is named and recorded once; the
 *    payment behind an open obligation is not reversed (interim rule); the branch
 *    list narrows and pages, and refuses a caller without the finance view, another
 *    branch and another tenant.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.credit-note-withdraw: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 *   sal.credit-note-reject: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 *   sal.refund-obligation-list: route service authorization success denial isolation cross-tenant pagination
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
  SAL_CREDIT_TRACE,
  SAL_FULL,
  SAL_NO_FINANCE,
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
import { GET as CREDIT_NOTE_DETAIL } from '@/app/api/v1/credit-notes/[creditNoteId]/route';
import { GET as INVOICE_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import { GET as INVOICE_LIST } from '@/app/api/v1/invoices/route';
import { POST as REQUEST_REVERSAL } from '@/app/api/v1/payments/[paymentId]/reversals/route';
import {
  GET as REFUND_OBLIGATION_LIST,
  REFUND_OBLIGATION_LIST_OPERATION,
} from '@/app/api/v1/refund-obligations/route';

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
    expect((await bodyOf<ProblemBody>(elsewhere.clone())).code).toBe('ERR-IAM-001');
    expect(await storedNote(note.id)).toEqual({ state: 'pending', version: note.version });
    // Recorded since the D12 extension (Owner decision 2026-10-03): one
    // `authorization.denied` row for the attempt, and no business-rule row.
    const attempt = elsewhere.headers.get('x-correlation-id');
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM iam.security_events
          WHERE correlation_id = $1 AND event_type = 'authorization.denied'`,
        [attempt]
      )
    ).toBe(1);
    expect(await creditEvents(note.id)).toBe(0);
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
    // DF-7: the bound is named on the amount, and the figures are not on the answer.
    expect((await bodyOf<ProblemBody>(refused.clone())).violations).toEqual([
      { path: 'body.amount', rule: 'allocation_exceeds_invoice_open' },
    ]);
  });

  it('names the receipt bound on the amount when the receipt has less left than asked (DF-7)', async () => {
    const invoice = await seedIssuedInvoice('odfqa_receipt_bound');
    authAs(SAL_FULL);
    const receipt = await post(RECORD_PAYMENT, '/api/v1/payments', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency: 'USD',
      amount: '10.00',
    });
    expect(receipt.status).toBe(201);
    const receiptId = (await bodyOf<{ id: string }>(receipt)).id;

    authAs(SAL_FULL);
    const refused = await (ALLOCATE_PAYMENT as ParamHandler<{ paymentId: string }>)(
      new Request(`http://localhost/api/v1/payments/${receiptId}/allocations`, {
        method: 'POST',
        headers: commandHeaders(randomUUID()),
        body: JSON.stringify({ invoiceId: invoice.invoiceId, amount: '20.00', currency: 'USD' }),
      }),
      { params: Promise.resolve({ paymentId: receiptId }) }
    );
    expect(refused.status).toBe(409);
    const body = await bodyOf<ProblemBody>(refused);
    expect(body.violations).toEqual([
      { path: 'body.amount', rule: 'allocation_exceeds_receipt_remaining' },
    ]);
    expect(JSON.stringify(body)).not.toContain('10.00');
    expect(await refusalEvents('sal.receipt', receiptId, 'payment_over_allocation')).toBe(1);
  });

  it('records a credit-note request above what remains creditable once, naming the invoice and nothing of the money (DF-3)', async () => {
    const invoice = await seedIssuedInvoice('odfqa_over_credit');
    const before = await countRowsOf(
      `SELECT count(*)::text AS n FROM sal.credit_notes WHERE invoice_id = $1`,
      [invoice.invoiceId]
    );
    authAs(SAL_FULL);
    const refused = await (REQUEST_CREDIT_NOTE as ParamHandler<{ invoiceId: string }>)(
      new Request(`http://localhost/api/v1/invoices/${invoice.invoiceId}/credit-notes`, {
        method: 'POST',
        headers: commandHeaders(randomUUID()),
        // The invoice is 100.0000: one cent above what remains creditable.
        body: JSON.stringify({ amount: '100.01', reason: 'over credit probe' }),
      }),
      { params: Promise.resolve({ invoiceId: invoice.invoiceId }) }
    );
    expect(refused.status).toBe(409);
    // ADR-023 D2: the rule is named on the amount, and no figure is.
    expect((await bodyOf<ProblemBody>(refused)).violations).toEqual([
      { path: 'body.amount', rule: 'credit_note_exceeds_creditable' },
    ]);
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM sal.credit_notes WHERE invoice_id = $1`, [
        invoice.invoiceId,
      ])
    ).toBe(before);

    const events = await admin.query<{ tenant_id: string; actor_id: string; detail: string }>(
      `SELECT tenant_id, actor_id, detail FROM iam.security_events
        WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
      [`%entity=sal.invoice/${invoice.invoiceId} %`]
    );
    expect(events.rows).toEqual([
      {
        tenant_id: TENANT_A,
        actor_id: SAL_FULL.userId,
        detail:
          `operation=sal.credit-note-create entity=sal.invoice/${invoice.invoiceId} ` +
          'rule=credit_note_exceeds_creditable outcome=refused',
      },
    ]);
    // Nothing but the rule: no amount, no reason text.
    expect(events.rows[0]?.detail).not.toContain('100.01');
    expect(events.rows[0]?.detail).not.toContain('over credit probe');
    // Readable in its own tenant only.
    const like = `%entity=sal.invoice/${invoice.invoiceId} %`;
    expect(await visibleRefusals(AUDIT_A, like)).toBe(1);
    expect(await visibleRefusals(AUDIT_B, like)).toBe(0);
  });

  it('records nothing for a credit-note request within the open amount, or for its replay (DF-3)', async () => {
    const invoice = await seedIssuedInvoice('odfqa_credit_success');
    const key = randomUUID();
    const raise = () =>
      (REQUEST_CREDIT_NOTE as ParamHandler<{ invoiceId: string }>)(
        new Request(`http://localhost/api/v1/invoices/${invoice.invoiceId}/credit-notes`, {
          method: 'POST',
          headers: commandHeaders(key),
          body: JSON.stringify({ amount: '100.00', reason: 'whole credit probe' }),
        }),
        { params: Promise.resolve({ invoiceId: invoice.invoiceId }) }
      );
    authAs(SAL_FULL);
    const first = await raise();
    expect(first.status).toBe(201);
    const noteId = (await bodyOf<CreditNoteResultBody>(first)).creditNote.id;
    authAs(SAL_FULL);
    const replay = await raise();
    expect(replay.status).toBeLessThan(300);
    // The same note answers the retry, and no second note exists.
    expect((await bodyOf<CreditNoteResultBody>(replay)).creditNote.id).toBe(noteId);
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM sal.credit_notes WHERE invoice_id = $1`, [
        invoice.invoiceId,
      ])
    ).toBe(1);
    expect(await refusalEvents('sal.invoice', invoice.invoiceId)).toBe(0);
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

/*
 * Finance checkpoint fixes B (P1-32-PRE-OD-FQB). The reads behind a printed copy
 * and behind a credit note's detail: additive fields only, under the same gates.
 */
interface TraceBody {
  readonly id: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly requestedByName: string | null;
  readonly approvedByName: string | null;
  readonly decidedByName: string | null;
  readonly invoice: {
    readonly invoiceNumber: string | null;
    readonly saleKind: string;
    readonly workOrderId: string | null;
    readonly payerName: string | null;
  } | null;
  readonly sourceReturn: {
    readonly id: string;
    readonly itemCode: string | null;
    readonly itemName: string | null;
    readonly quantity: string;
    readonly receivedAt: string;
  } | null;
}

const readDetail = (creditNoteId: string): Promise<Response> =>
  (CREDIT_NOTE_DETAIL as ParamHandler<{ creditNoteId: string }>)(
    new Request(`http://localhost/api/v1/credit-notes/${creditNoteId}`, { method: 'GET' }),
    { params: Promise.resolve({ creditNoteId }) }
  );

describe('finance checkpoint fixes B — what a credit note is traceable to (DF-B4)', () => {
  it('names the invoice, its payer, the return that raised it and the requester — to a reader who may read them', async () => {
    const sale = await issuedThreeUnitSale();
    authAs(INV_COUNTER);
    const received = await bodyOf<ReturnBody>(
      await post(SALES_RETURN_CREATE, '/api/v1/sales-returns', {
        sourceKind: 'invoice_line',
        sourceId: sale.lineId,
        quantity: '1',
        condition: 'restockable',
        receivedLocationId: sale.cell,
        reason: 'One came back',
      })
    );
    const noteId = received.creditNoteId ?? '';
    expect(noteId).not.toBe('');
    const stored = await admin.query<{
      invoice_number: string;
      payer_name: string;
      sku: string;
      item_name: string;
      requester_name: string;
    }>(
      `SELECT i.invoice_number, bp.display_name AS payer_name, im.sku, im.name AS item_name,
              ua.display_name AS requester_name
         FROM sal.credit_notes c
         JOIN sal.invoices i ON i.id = c.invoice_id
         JOIN crm.business_partners bp ON bp.id = i.payer_partner_id
         JOIN inv.sales_returns r ON r.credit_note_id = c.id
         JOIN inv.item_master im ON im.id = r.item_id
         JOIN iam.user_accounts ua ON ua.id = c.requested_by
        WHERE c.id = $1`,
      [noteId]
    );
    const expected = stored.rows[0];
    expect(expected).toBeDefined();

    authAs(SAL_CREDIT_TRACE);
    const named = await readDetail(noteId);
    expect(named.status).toBe(200);
    const body = await bodyOf<TraceBody>(named);
    expect(body.invoice).toEqual({
      invoiceNumber: expected?.invoice_number,
      saleKind: 'counter_sale',
      workOrderId: null,
      payerName: expected?.payer_name,
    });
    expect(body.sourceReturn).toEqual({
      id: received.id,
      itemCode: expected?.sku,
      itemName: expected?.item_name,
      quantity: '1.000',
      receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(body.requestedByName).toBe(expected?.requester_name);
    expect(body.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.approvedByName).toBeNull();
    expect(body.decidedByName).toBeNull();

    // Without the customer and user reads, the same note names nobody — the
    // fields keep their shape and say null, never an id in a name's place.
    authAs(SAL_FULL);
    const plain = await bodyOf<TraceBody>(await readDetail(noteId));
    expect(plain.invoice?.payerName).toBeNull();
    expect(plain.requestedByName).toBeNull();
    expect(plain.invoice?.invoiceNumber).toBe(expected?.invoice_number);
    expect(plain.sourceReturn?.id).toBe(received.id);
  });

  it('says a note raised by hand has no return, names who decided it, and stays refused across tenant and branch', async () => {
    const invoice = await seedIssuedInvoice('odfqb_trace_by_hand');
    const note = await pendingNote(invoice.invoiceId, '10.00', SAL_FULL);
    // Somebody other than the requester rejects it (D3).
    authAs(SAL_APPROVER);
    const rejected = await reject(note.id, note.version, { reason: 'Not owed' });
    expect(rejected.status).toBe(200);

    authAs(SAL_CREDIT_TRACE);
    const body = await bodyOf<TraceBody>(await readDetail(note.id));
    expect(body.sourceReturn).toBeNull();
    expect(body.invoice?.invoiceNumber).toBe(invoice.invoiceNumber);
    // The person who rejected it, by the name the directory holds.
    const decider = await admin.query<{ display_name: string }>(
      `SELECT ua.display_name FROM sal.credit_notes c
         JOIN iam.user_accounts ua ON ua.id = c.decided_by WHERE c.id = $1`,
      [note.id]
    );
    expect(body.decidedByName).toBe(decider.rows[0]?.display_name ?? 'missing');

    authAs(SAL_TENANT_B);
    expect((await readDetail(note.id)).status).toBe(404);
    authAs(SAL_PERMISSION_ELSEWHERE);
    expect((await readDetail(note.id)).status).toBe(403);
  });
});

describe('finance checkpoint fixes B — the balance says when it was read (DF-B1)', () => {
  it('states the moment on the database clock, with every other field unchanged', async () => {
    const invoice = await seedIssuedInvoice('odfqb_as_of');
    const before = Date.now();
    authAs(SAL_FULL);
    const response = await (INVOICE_OUTSTANDING as ParamHandler<{ invoiceId: string }>)(
      new Request(`http://localhost/api/v1/invoices/${invoice.invoiceId}/outstanding`, {
        method: 'GET',
      }),
      { params: Promise.resolve({ invoiceId: invoice.invoiceId }) }
    );
    const after = Date.now();
    expect(response.status).toBe(200);
    const body = await bodyOf<{
      outstanding: { amount: string; currency: string };
      asOf: string;
      settlement: unknown;
    }>(response);
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The database's clock and this process's agree to within a minute here;
    // the point is that it is the moment of THIS read, not a stored date.
    const moment = Date.parse(body.asOf);
    expect(moment).toBeGreaterThan(before - 60_000);
    expect(moment).toBeLessThan(after + 60_000);
    expect(body.outstanding.amount).toBe(await invoiceOpenReceivable(invoice.invoiceId));
    expect(body.settlement).not.toBeNull();

    // Still refused to another tenant: the new field opens nothing.
    authAs(SAL_TENANT_B);
    const foreign = await (INVOICE_OUTSTANDING as ParamHandler<{ invoiceId: string }>)(
      new Request(`http://localhost/api/v1/invoices/${invoice.invoiceId}/outstanding`, {
        method: 'GET',
      }),
      { params: Promise.resolve({ invoiceId: invoice.invoiceId }) }
    );
    expect(foreign.status).toBe(404);
  });
});

describe('finance checkpoint fixes B — the counter finds its issued sales (DF-B3)', () => {
  const list = (query: Record<string, string>): Promise<Response> =>
    INVOICE_LIST(
      new Request(
        `http://localhost/api/v1/invoices?${new URLSearchParams({
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          ...query,
        }).toString()}`,
        { method: 'GET' }
      )
    );
  const ids = async (response: Response): Promise<readonly string[]> =>
    (await bodyOf<{ items: readonly { id: string; saleKind: string }[] }>(response)).items.map(
      (row) => row.id
    );

  it('narrows to counter sales or to jobs, refuses another value, and keeps the branch boundary', async () => {
    const sale = await issuedThreeUnitSale();
    const job = await seedIssuedInvoice('odfqb_list_kind');
    authAs(SAL_FULL);
    const counter = await list({ saleKind: 'counter_sale', status: 'issued', limit: '100' });
    expect(counter.status).toBe(200);
    const counterIds = await ids(counter);
    expect(counterIds).toContain(sale.invoiceId);
    expect(counterIds).not.toContain(job.invoiceId);
    authAs(SAL_FULL);
    const jobs = await list({ saleKind: 'work_order', limit: '100' });
    const jobIds = await ids(jobs);
    expect(jobIds).not.toContain(sale.invoiceId);
    authAs(SAL_FULL);
    expect((await list({ saleKind: 'refund' })).status).toBe(422);
    // A caller whose authority is in another branch cannot list this one.
    authAs(SAL_PERMISSION_ELSEWHERE);
    expect((await list({ saleKind: 'counter_sale' })).status).toBe(403);
    authAs(SAL_TENANT_B);
    const foreign = await list({ saleKind: 'counter_sale' });
    expect(foreign.status === 403 || foreign.status === 200).toBe(true);
    if (foreign.status === 200) expect(await ids(foreign)).not.toContain(sale.invoiceId);
  });
});

// ---------------------------------------------------------------------------
// ADR-023 D2, part 1 (P1-32-PRE-OD-FD2A): the ceiling is what the invoice can
// still be credited, the excess of an approved credit over what was still owed is
// a refund obligation the customer is owed — never paid automatically — and a
// payment behind an open obligation is not reversed (interim rule).
// ---------------------------------------------------------------------------

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface RefundObligationBody {
  readonly id: string;
  readonly invoiceId: string;
  readonly creditNoteId: string;
  readonly partnerId: string;
  readonly amount: MoneyBody;
  readonly source: string;
  readonly state: string;
}

interface ApprovalResultBody extends CreditNoteResultBody {
  readonly refundObligation: RefundObligationBody | null;
}

interface RefundObligationPage {
  readonly items: readonly RefundObligationBody[];
  readonly nextCursor?: string | null;
}

/** An issued invoice of 100.0000 paid in full through the routes; returns the receipt too. */
async function paidInvoice(tag: string): Promise<{ invoiceId: string; receiptId: string }> {
  const invoice = await seedIssuedInvoice(tag);
  authAs(SAL_FULL);
  const recorded = await post(RECORD_PAYMENT, '/api/v1/payments', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    paymentMethodId: PAYMENT_METHOD_A,
    payerPartnerId: PARTNER_A,
    currency: 'USD',
    amount: '100.00',
  });
  if (recorded.status !== 201) throw new Error(`fixture receipt failed: ${await recorded.text()}`);
  const receiptId = (await bodyOf<{ id: string }>(recorded)).id;
  authAs(SAL_FULL);
  const allocated = await (ALLOCATE_PAYMENT as ParamHandler<{ paymentId: string }>)(
    new Request(`http://localhost/api/v1/payments/${receiptId}/allocations`, {
      method: 'POST',
      headers: commandHeaders(randomUUID()),
      body: JSON.stringify({ invoiceId: invoice.invoiceId, amount: '100.00', currency: 'USD' }),
    }),
    { params: Promise.resolve({ paymentId: receiptId }) }
  );
  if (allocated.status !== 201) {
    throw new Error(`fixture allocation failed: ${await allocated.text()}`);
  }
  return { invoiceId: invoice.invoiceId, receiptId };
}

const listObligations = (
  query: Record<string, string>,
  principal: Principal = SAL_FULL
): Promise<Response> => {
  authAs(principal);
  const search = new URLSearchParams({
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    ...query,
  });
  return (REFUND_OBLIGATION_LIST as (request: Request) => Promise<Response>)(
    new Request(`http://localhost/api/v1/refund-obligations?${search.toString()}`)
  );
};

const readNote = (creditNoteId: string, principal: Principal = SAL_FULL): Promise<Response> => {
  authAs(principal);
  return (CREDIT_NOTE_DETAIL as ParamHandler<{ creditNoteId: string }>)(
    new Request(`http://localhost/api/v1/credit-notes/${creditNoteId}`),
    { params: Promise.resolve({ creditNoteId }) }
  );
};

const readOutstanding = (invoiceId: string): Promise<Response> => {
  authAs(SAL_FULL);
  return (INVOICE_OUTSTANDING as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`),
    { params: Promise.resolve({ invoiceId }) }
  );
};

describe('D2 — a paid invoice is creditable, and the excess is owed back', () => {
  it('previews the split, approves, and leaves exactly one open obligation with its audit record', async () => {
    const { invoiceId } = await paidInvoice('odfd2a_paid');
    const note = await pendingNote(invoiceId, '30.00');

    // Before the approval the detail says what it would do: nothing left to reduce,
    // all of it owed back.
    const preview = await readNote(note.id);
    expect(preview.status).toBe(200);
    const previewBody = await bodyOf<{
      approvalEffect: { reducesBalanceBy: MoneyBody; refundOwed: MoneyBody } | null;
      refundObligation: RefundObligationBody | null;
    }>(preview);
    expect(previewBody.approvalEffect?.reducesBalanceBy.amount).toBe('0.0000');
    expect(previewBody.approvalEffect?.refundOwed.amount).toBe('30.0000');
    expect(previewBody.refundObligation).toBeNull();

    authAs(SAL_APPROVER);
    const approved = await approve(note.id);
    expect(approved.status).toBe(200);
    const body = await bodyOf<ApprovalResultBody>(approved);
    expect(body.creditNote.approvalState).toBe('approved');
    expect(body.refundObligation).toMatchObject({
      invoiceId,
      creditNoteId: note.id,
      partnerId: PARTNER_A,
      amount: { amount: '30.0000', currency: 'USD' },
      source: 'credit_excess',
      state: 'open',
    });
    const obligationId = body.refundObligation?.id ?? '';
    expect(await auditCountFor('sal.refund_obligation.recorded', obligationId)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.financial_events
          WHERE source_id = $1 AND event_type = 'refund_obligation_recorded'`,
        [obligationId]
      )
    ).toBe(1);
    expect(await invoiceOpenReceivable(invoiceId)).toBe('0.0000');

    // The settlement view (D7) says the customer is owed it.
    const outstanding = await bodyOf<{
      settlement: { refundStatus: string; refundOwed: MoneyBody } | null;
    }>(await readOutstanding(invoiceId));
    expect(outstanding.settlement?.refundStatus).toBe('owed');
    expect(outstanding.settlement?.refundOwed.amount).toBe('30.0000');

    // The approved detail names the obligation; a replay of the approval answers it again.
    const after = await bodyOf<{
      approvalEffect: unknown;
      refundObligation: { id: string } | null;
    }>(await readNote(note.id));
    expect(after.approvalEffect).toBeNull();
    expect(after.refundObligation?.id).toBe(obligationId);
    authAs(SAL_APPROVER);
    const replay = await bodyOf<ApprovalResultBody>(await approve(note.id));
    expect(replay.replayed).toBe(true);
    expect(replay.refundObligation?.id).toBe(obligationId);
    expect(await auditCountFor('sal.refund_obligation.recorded', obligationId)).toBe(1);
  });

  it('answers none with no obligation when the credit stays within what is owed', async () => {
    const invoice = await seedIssuedInvoice('odfd2a_within');
    const note = await pendingNote(invoice.invoiceId, '40.00');
    authAs(SAL_APPROVER);
    const body = await bodyOf<ApprovalResultBody>(await approve(note.id));
    expect(body.refundObligation).toBeNull();
    const outstanding = await bodyOf<{
      settlement: { refundStatus: string; refundOwed: MoneyBody } | null;
    }>(await readOutstanding(invoice.invoiceId));
    expect(outstanding.settlement?.refundStatus).toBe('none');
    expect(outstanding.settlement?.refundOwed.amount).toBe('0.0000');
  });

  it('refuses an approval past the gross less the approved credits, by name, recorded once', async () => {
    const { invoiceId } = await paidInvoice('odfd2a_ceiling');
    const first = await pendingNote(invoiceId, '60.00');
    const second = await pendingNote(invoiceId, '60.00');
    authAs(SAL_APPROVER);
    expect((await approve(first.id)).status).toBe(200);
    authAs(SAL_APPROVER);
    const refused = await approve(second.id);
    expect(refused.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-TRN-001');
    expect(problem.violations).toEqual([
      { path: 'path.creditNoteId', rule: 'credit_note_exceeds_creditable' },
    ]);
    expect(JSON.stringify(problem)).not.toContain('60.00');
    expect((await storedNote(second.id)).state).toBe('pending');
    expect(await creditEvents(second.id, 'credit_note_exceeds_creditable')).toBe(1);
    expect(await approvedCreditEvents(second.id)).toBe(0);
  });

  it('refuses reversing the payment behind an open obligation, by name, recorded once', async () => {
    const { invoiceId, receiptId } = await paidInvoice('odfd2a_reversal');
    const note = await pendingNote(invoiceId, '25.00');
    authAs(SAL_APPROVER);
    expect((await approve(note.id)).status).toBe(200);

    const version = (
      await admin.query<{ v: number }>(
        `SELECT record_version AS v FROM sal.receipts WHERE id = $1`,
        [receiptId]
      )
    ).rows[0]?.v;
    authAs(SAL_FULL);
    const refused = await (REQUEST_REVERSAL as ParamHandler<{ paymentId: string }>)(
      new Request(`http://localhost/api/v1/payments/${receiptId}/reversals`, {
        method: 'POST',
        headers: commandHeaders(randomUUID(), version),
        body: JSON.stringify({ reason: 'Entered against the wrong invoice' }),
      }),
      { params: Promise.resolve({ paymentId: receiptId }) }
    );
    expect(refused.status).toBe(409);
    expect((await bodyOf<ProblemBody>(refused)).violations).toEqual([
      { path: 'path.paymentId', rule: 'receipt_reversal_refund_obligation_open' },
    ]);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.receipt_reversals WHERE original_receipt_id = $1`,
        [receiptId]
      )
    ).toBe(0);
    expect(
      await refusalEvents('sal.receipt', receiptId, 'receipt_reversal_refund_obligation_open')
    ).toBe(1);
  });
});

describe('D2 — sal.refund-obligation-list', () => {
  it('declares the finance view only, at the branch', () => {
    expect(REFUND_OBLIGATION_LIST_OPERATION.permissions).toEqual(['sal.finance.view']);
    expect(REFUND_OBLIGATION_LIST_OPERATION.scope).toBe('branch');
  });

  it('lists a branch, newest first, narrowed by invoice, customer and state, one page at a time', async () => {
    const one = await paidInvoice('odfd2a_list_one');
    const two = await paidInvoice('odfd2a_list_two');
    for (const invoiceId of [one.invoiceId, two.invoiceId]) {
      const note = await pendingNote(invoiceId, '10.00');
      authAs(SAL_APPROVER);
      expect((await approve(note.id)).status).toBe(200);
    }
    const byInvoice = await listObligations({ invoiceId: one.invoiceId });
    expect(byInvoice.status).toBe(200);
    const page = await bodyOf<RefundObligationPage>(byInvoice);
    expect(page.items.map((item) => [item.invoiceId, item.amount.amount, item.state])).toEqual([
      [one.invoiceId, '10.0000', 'open'],
    ]);
    const byCustomer = await bodyOf<RefundObligationPage>(
      await listObligations({ partnerId: PARTNER_A, state: 'open' })
    );
    const invoices = byCustomer.items.map((item) => item.invoiceId);
    // Newest first.
    expect(invoices.indexOf(two.invoiceId)).toBeLessThan(invoices.indexOf(one.invoiceId));
    expect(
      (await bodyOf<RefundObligationPage>(await listObligations({ state: 'settled' }))).items
    ).toEqual([]);

    const first = await bodyOf<RefundObligationPage>(await listObligations({ limit: '1' }));
    expect(first.items).toHaveLength(1);
    expect(typeof first.nextCursor).toBe('string');
    const next = await bodyOf<RefundObligationPage>(
      await listObligations({ limit: '1', cursor: first.nextCursor ?? '' })
    );
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(first.items[0]?.id);

    expect((await listObligations({ state: 'owing' })).status).toBe(422);
  });

  it('refuses a caller without the finance view, another branch and another tenant', async () => {
    expect((await listObligations({}, SAL_NO_FINANCE)).status).toBe(403);
    expect((await listObligations({}, SAL_PERMISSION_ELSEWHERE)).status).toBe(403);
    const crossTenant = await listObligations({}, SAL_TENANT_B);
    expect(crossTenant.status).toBe(403);
    expect(await crossTenant.text()).not.toContain('credit_excess');
  });
});
