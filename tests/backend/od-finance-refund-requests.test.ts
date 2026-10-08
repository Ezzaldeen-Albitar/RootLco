/**
 * P1-32-PRE-OD-FD2B — refund requests of ADR-023 D2, part 2, end to end through the
 * route handlers: requested by a payment recorder, approved or rejected by a
 * DIFFERENT holder of `sal.refund.approve`, withdrawn only by its requester, and its
 * payout recorded once, separately from the approval. No accounting.
 *
 * Every case counts a side effect — a state, a row, an audit record, a security
 * event, a financial event, the obligation's state, the invoice's refund status —
 * and is written so it FAILS when the control it names is removed:
 *
 *  - the request: a payment recorder only; at most what is still owed on the
 *    obligation; an active method of the tenant; one live request per obligation; a
 *    replay under the same key records nothing twice;
 *  - the decision: self-approval refused; a holder of every other finance decision
 *    code but not `sal.refund.approve` refused and recorded as a permission refusal;
 *    the code in another branch refused; `If-Match` on the request (stale 409,
 *    missing 428); a rejection states why; only the requester withdraws; decisions
 *    are terminal; another tenant is a 404;
 *  - the payout: only once approved, by the approved method, with a date not in the
 *    future; one `refund_executed` financial event and one audit record; a replay
 *    under its key writes neither again, and any other repeat is refused by name;
 *    the obligation is settled when what has been paid out reaches its amount;
 *  - D7: `refundStatus` moves none -> owed -> requested -> approved ->
 *    partly_refunded -> refunded, with the refunded and still-owed amounts;
 *  - D12: each refusal by rule leaves exactly ONE security event after the rollback.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.refund-request: route service authorization success denial audit idempotency isolation cross-tenant
 *   sal.refund-approve: route service authorization success denial audit stale-version isolation cross-tenant
 *   sal.refund-reject: route service authorization success denial audit stale-version isolation cross-tenant
 *   sal.refund-withdraw: route service authorization success denial audit stale-version isolation cross-tenant
 *   sal.refund-execute: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 *   sal.refund-request-list: route service authorization success denial isolation cross-tenant pagination
 *   sal.refund-request-detail: route service authorization success denial isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { PARTNER_A, establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  PAYMENT_METHOD_A,
  PAYMENT_METHOD_A_INACTIVE,
  SAL_APPROVER,
  SAL_CASHIER,
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
  seedIssuedInvoice,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { POST as REQUEST_CREDIT_NOTE } from '@/app/api/v1/invoices/[invoiceId]/credit-notes/route';
import { POST as APPROVE_CREDIT_NOTE } from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import { GET as INVOICE_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import {
  POST as REQUEST_REFUND,
  REFUND_REQUEST_OPERATION,
} from '@/app/api/v1/refund-obligations/[obligationId]/refund-requests/route';
import {
  GET as LIST_REFUNDS,
  REFUND_REQUEST_LIST_OPERATION,
} from '@/app/api/v1/refund-requests/route';
import {
  GET as READ_REFUND,
  REFUND_REQUEST_DETAIL_OPERATION,
} from '@/app/api/v1/refund-requests/[requestId]/route';
import {
  POST as APPROVE_REFUND,
  REFUND_APPROVE_OPERATION,
} from '@/app/api/v1/refund-requests/[requestId]/approval/route';
import {
  POST as REJECT_REFUND,
  REFUND_REJECT_OPERATION,
} from '@/app/api/v1/refund-requests/[requestId]/rejection/route';
import {
  POST as WITHDRAW_REFUND,
  REFUND_WITHDRAW_OPERATION,
} from '@/app/api/v1/refund-requests/[requestId]/withdrawal/route';
import {
  POST as EXECUTE_REFUND,
  REFUND_EXECUTE_OPERATION,
} from '@/app/api/v1/refund-requests/[requestId]/execution/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface RefundRequestBody {
  readonly id: string;
  readonly obligationId: string;
  readonly invoiceId: string;
  readonly payeePartnerId: string;
  readonly state: string;
  readonly amount: MoneyBody;
  readonly paymentMethod: { readonly id: string; readonly kind: string } | null;
  readonly reason: string;
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly executedBy: string | null;
  readonly payoutReference: string | null;
  readonly payoutDate: string | null;
  readonly recordVersion: number;
}

interface RefundResultBody {
  readonly refundRequest: RefundRequestBody;
  readonly obligation: {
    readonly id: string;
    readonly state: string;
    readonly paidOut: MoneyBody;
    readonly stillOwed: MoneyBody;
  };
  readonly replayed: boolean;
}

/** Holds every other finance decision code and the recording code — not `sal.refund.approve`. */
const FD2B_NO_REFUND_CODE: Principal = {
  roleId: 'f1320000-0000-4000-8000-00000000fdb1',
  userId: 'f1320000-0000-4000-8000-00000000fdb2',
  subject: 'fx_od_fd2b_no_refund_code',
  tenantId: TENANT_A,
  permissions: [
    'sal.finance.view',
    'sal.payment.record',
    'sal.credit.manage',
    'sal.credit.approve',
    'sal.reversal.approve',
  ],
};

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const today = () => new Date().toISOString().slice(0, 10);

function commandHeaders(key: string, version?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': key,
  };
  if (version !== undefined) headers['if-match'] = String(version);
  return headers;
}

const send = <P extends Record<string, string>>(
  handler: unknown,
  path: string,
  params: P,
  init: { readonly body?: unknown; readonly key?: string; readonly version?: number }
): Promise<Response> =>
  (handler as ParamHandler<P>)(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: commandHeaders(init.key ?? randomUUID(), init.version),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    { params: Promise.resolve(params) }
  );

const requestRefund = (obligationId: string, body: unknown, key?: string) =>
  send(
    REQUEST_REFUND,
    `/api/v1/refund-obligations/${obligationId}/refund-requests`,
    { obligationId },
    { body, ...(key === undefined ? {} : { key }) }
  );

const decide = (
  handler: unknown,
  suffix: string,
  requestId: string,
  init: { readonly body?: unknown; readonly key?: string; readonly version?: number }
) => send(handler, `/api/v1/refund-requests/${requestId}/${suffix}`, { requestId }, init);

const approve = (requestId: string, version?: number) =>
  decide(APPROVE_REFUND, 'approval', requestId, version === undefined ? {} : { version });
const reject = (requestId: string, version: number | undefined, body: unknown) =>
  decide(REJECT_REFUND, 'rejection', requestId, {
    body,
    ...(version === undefined ? {} : { version }),
  });
const withdraw = (requestId: string, version?: number) =>
  decide(WITHDRAW_REFUND, 'withdrawal', requestId, version === undefined ? {} : { version });
const execute = (
  requestId: string,
  version: number | undefined,
  body: unknown = {
    paymentMethodId: PAYMENT_METHOD_A,
    payoutReference: 'TRF-0001',
    payoutDate: today(),
  },
  key?: string
) =>
  decide(EXECUTE_REFUND, 'execution', requestId, {
    body,
    ...(version === undefined ? {} : { version }),
    ...(key === undefined ? {} : { key }),
  });

const readRefund = (requestId: string): Promise<Response> =>
  (READ_REFUND as ParamHandler<{ requestId: string }>)(
    new Request(`http://localhost/api/v1/refund-requests/${requestId}`),
    { params: Promise.resolve({ requestId }) }
  );

const listRefunds = (query: Record<string, string>): Promise<Response> =>
  (LIST_REFUNDS as (request: Request) => Promise<Response>)(
    new Request(
      `http://localhost/api/v1/refund-requests?${new URLSearchParams({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        ...query,
      }).toString()}`
    )
  );

const readOutstanding = (invoiceId: string): Promise<Response> =>
  (INVOICE_OUTSTANDING as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`),
    { params: Promise.resolve({ invoiceId }) }
  );

/**
 * An issued invoice of 100.0000, paid in full through the routes and credited
 * `credit` by an approved note: the customer is owed `credit` back as one open
 * obligation. Returns the obligation and the invoice.
 */
async function owedBack(
  tag: string,
  credit: string
): Promise<{ obligationId: string; invoiceId: string }> {
  const invoice = await seedIssuedInvoice(tag);
  authAs(SAL_FULL);
  const recorded = await (RECORD_PAYMENT as (request: Request) => Promise<Response>)(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: commandHeaders(randomUUID()),
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        paymentMethodId: PAYMENT_METHOD_A,
        payerPartnerId: PARTNER_A,
        currency: 'USD',
        amount: '100.00',
      }),
    })
  );
  if (recorded.status !== 201) throw new Error(`fixture receipt: ${await recorded.text()}`);
  const receiptId = (await bodyOf<{ id: string }>(recorded)).id;
  authAs(SAL_FULL);
  const allocated = await send(
    ALLOCATE_PAYMENT,
    `/api/v1/payments/${receiptId}/allocations`,
    { paymentId: receiptId },
    { body: { invoiceId: invoice.invoiceId, amount: '100.00', currency: 'USD' } }
  );
  if (allocated.status !== 201) throw new Error(`fixture allocation: ${await allocated.text()}`);
  authAs(SAL_FULL);
  const raised = await send(
    REQUEST_CREDIT_NOTE,
    `/api/v1/invoices/${invoice.invoiceId}/credit-notes`,
    { invoiceId: invoice.invoiceId },
    { body: { amount: credit, reason: 'refund requests probe' } }
  );
  if (raised.status !== 201) throw new Error(`fixture credit note: ${await raised.text()}`);
  const noteId = (await bodyOf<{ creditNote: { id: string } }>(raised)).creditNote.id;
  authAs(SAL_APPROVER);
  const approved = await send(
    APPROVE_CREDIT_NOTE,
    `/api/v1/credit-notes/${noteId}/approval`,
    { creditNoteId: noteId },
    {}
  );
  if (approved.status !== 200) throw new Error(`fixture approval: ${await approved.text()}`);
  const obligationId =
    (await bodyOf<{ refundObligation: { id: string } | null }>(approved)).refundObligation?.id ??
    '';
  if (obligationId === '') throw new Error('fixture obligation missing');
  return { obligationId, invoiceId: invoice.invoiceId };
}

/** A pending request raised through the route by SAL_FULL. */
async function pendingRefund(
  obligationId: string,
  amount = '10.00'
): Promise<{ id: string; version: number }> {
  authAs(SAL_FULL);
  const response = await requestRefund(obligationId, {
    amount,
    paymentMethodId: PAYMENT_METHOD_A,
    reason: 'Paid in full, then credited',
  });
  if (response.status !== 201) throw new Error(`fixture request: ${await response.text()}`);
  const request = (await bodyOf<RefundResultBody>(response)).refundRequest;
  return { id: request.id, version: request.recordVersion };
}

/** An approved request, approved through the route by SAL_APPROVER. */
async function approvedRefund(
  obligationId: string,
  amount = '10.00'
): Promise<{ id: string; version: number }> {
  const pending = await pendingRefund(obligationId, amount);
  authAs(SAL_APPROVER);
  const response = await approve(pending.id, pending.version);
  if (response.status !== 200) throw new Error(`fixture approve: ${await response.text()}`);
  const request = (await bodyOf<RefundResultBody>(response)).refundRequest;
  return { id: request.id, version: request.recordVersion };
}

const storedVersion = async (requestId: string): Promise<number> =>
  (
    await admin.query<{ v: number }>(
      `SELECT record_version AS v FROM sal.refund_requests WHERE id = $1`,
      [requestId]
    )
  ).rows[0]?.v ?? -1;

const requestsOf = (obligationId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.refund_requests WHERE obligation_id = $1`, [
    obligationId,
  ]);

const executedEvents = (requestId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.financial_events
      WHERE source_id = $1 AND event_type = 'refund_executed'`,
    [requestId]
  );

/** Business-rule refusal events recorded for one entity, optionally one rule. */
const refusalEvents = (entityType: string, entityId: string, rule?: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
    [`%entity=${entityType}/${entityId} ${rule === undefined ? '' : `rule=${rule} `}%`]
  );

/** Permission refusals recorded for one refused call, by its correlation id. */
const deniedEvents = (response: Response): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE correlation_id = $1 AND event_type = 'authorization.denied'`,
    [response.headers.get('x-correlation-id')]
  );

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','FD2B no refund code','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'FD2B no refund code',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [principal.tenantId, principal.roleId, USER_A, [...principal.permissions]]
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

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimeAppPool(10);
  __setPrimaryPoolForTests(runtime);
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
  await seedPrincipal(FD2B_NO_REFUND_CODE);
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.end();
});

describe('D2 part 2 — the seven operations are declared as the Owner rule requires', () => {
  it('requests, withdraws and pays out under the recording code, decides under sal.refund.approve', () => {
    expect(REFUND_REQUEST_OPERATION).toMatchObject({
      id: 'sal.refund-request',
      permissions: ['sal.payment.record', 'sal.finance.view'],
      scope: 'branch',
      auditClass: 'financial',
      auditAction: 'sal.refund_request.requested',
      idempotent: true,
      successStatus: 201,
    });
    expect(REFUND_APPROVE_OPERATION).toMatchObject({
      id: 'sal.refund-approve',
      permissions: ['sal.refund.approve', 'sal.finance.view'],
      auditClass: 'approval',
      auditAction: 'sal.refund_request.approved',
      versionGuarded: true,
    });
    expect(REFUND_REJECT_OPERATION).toMatchObject({
      id: 'sal.refund-reject',
      permissions: ['sal.refund.approve', 'sal.finance.view'],
      auditClass: 'approval',
      auditAction: 'sal.refund_request.rejected',
      versionGuarded: true,
    });
    expect(REFUND_WITHDRAW_OPERATION).toMatchObject({
      id: 'sal.refund-withdraw',
      permissions: ['sal.payment.record', 'sal.finance.view'],
      auditClass: 'financial',
      versionGuarded: true,
    });
    expect(REFUND_EXECUTE_OPERATION).toMatchObject({
      id: 'sal.refund-execute',
      permissions: ['sal.payment.record', 'sal.finance.view'],
      auditClass: 'financial',
      auditAction: 'sal.refund_request.executed',
      idempotent: true,
      versionGuarded: true,
    });
    expect(REFUND_REQUEST_LIST_OPERATION).toMatchObject({
      id: 'sal.refund-request-list',
      permissions: ['sal.finance.view'],
      auditClass: 'none',
    });
    expect(REFUND_REQUEST_DETAIL_OPERATION).toMatchObject({
      id: 'sal.refund-request-detail',
      permissions: ['sal.finance.view'],
      auditClass: 'none',
    });
    for (const operation of [REFUND_APPROVE_OPERATION, REFUND_REJECT_OPERATION]) {
      expect(operation.permissions).not.toContain('sal.credit.approve');
      expect(operation.permissions).not.toContain('sal.reversal.approve');
      expect(operation.permissions).not.toContain('sal.payment.record');
    }
  });
});

describe('D2 part 2 — a payment recorder requests a refund', () => {
  it('raises a pending request of the obligation, audited once, and replays under the same key', async () => {
    const { obligationId, invoiceId } = await owedBack('odfd2b_request', '30.00');
    const key = randomUUID();
    authAs(SAL_FULL);
    const response = await requestRefund(
      obligationId,
      { amount: '12.50', paymentMethodId: PAYMENT_METHOD_A, reason: 'Paid twice' },
      key
    );
    expect(response.status).toBe(201);
    const body = await bodyOf<RefundResultBody>(response);
    expect(body.replayed).toBe(false);
    expect(body.refundRequest).toMatchObject({
      obligationId,
      invoiceId,
      payeePartnerId: PARTNER_A,
      state: 'pending',
      amount: { amount: '12.5000', currency: 'USD' },
      paymentMethod: { id: PAYMENT_METHOD_A, kind: 'cash' },
      requestedBy: SAL_FULL.userId,
      decidedBy: null,
      executedBy: null,
    });
    expect(body.obligation).toMatchObject({ state: 'open', stillOwed: { amount: '30.0000' } });
    expect(await auditCountFor('sal.refund_request.requested', body.refundRequest.id)).toBe(1);
    expect(await executedEvents(body.refundRequest.id)).toBe(0);

    authAs(SAL_FULL);
    const replay = await requestRefund(
      obligationId,
      { amount: '12.50', paymentMethodId: PAYMENT_METHOD_A, reason: 'Paid twice' },
      key
    );
    // The transport answers a repeated key with the STORED body, at 200.
    expect(replay.status).toBe(200);
    const replayed = await bodyOf<RefundResultBody>(replay);
    expect(replayed.refundRequest.id).toBe(body.refundRequest.id);
    expect(await requestsOf(obligationId)).toBe(1);
    expect(await auditCountFor('sal.refund_request.requested', body.refundRequest.id)).toBe(1);
  });

  it('refuses more than is still owed, a second live request and an inactive method, each by name and recorded once', async () => {
    const { obligationId } = await owedBack('odfd2b_request_rules', '30.00');
    authAs(SAL_FULL);
    const over = await requestRefund(obligationId, {
      amount: '30.01',
      paymentMethodId: PAYMENT_METHOD_A,
      reason: 'x',
    });
    expect(over.status).toBe(409);
    expect((await bodyOf<ProblemBody>(over)).violations).toEqual([
      { path: 'body.amount', rule: 'refund_exceeds_obligation' },
    ]);
    expect(
      await refusalEvents('sal.refund_obligation', obligationId, 'refund_exceeds_obligation')
    ).toBe(1);

    authAs(SAL_FULL);
    const inactive = await requestRefund(obligationId, {
      amount: '5.00',
      paymentMethodId: PAYMENT_METHOD_A_INACTIVE,
      reason: 'x',
    });
    expect(inactive.status).toBe(409);
    expect((await bodyOf<ProblemBody>(inactive)).violations).toEqual([
      { path: 'body.paymentMethodId', rule: 'refund_request_method_unavailable' },
    ]);

    authAs(SAL_FULL);
    const minor = await requestRefund(obligationId, {
      amount: '5.001',
      paymentMethodId: PAYMENT_METHOD_A,
      reason: 'x',
    });
    expect(minor.status).toBe(422);
    expect((await bodyOf<ProblemBody>(minor)).violations).toEqual([
      { path: 'body.amount', rule: 'minor_unit_scale' },
    ]);

    await pendingRefund(obligationId);
    authAs(SAL_FULL);
    const second = await requestRefund(obligationId, {
      amount: '5.00',
      paymentMethodId: PAYMENT_METHOD_A,
      reason: 'again',
    });
    expect(second.status).toBe(409);
    expect((await bodyOf<ProblemBody>(second)).violations).toEqual([
      { path: 'path.obligationId', rule: 'refund_request_live_exists' },
    ]);
    expect(
      await refusalEvents('sal.refund_obligation', obligationId, 'refund_request_live_exists')
    ).toBe(1);
    expect(await requestsOf(obligationId)).toBe(1);
  });

  it('refuses a caller without the recording code, the code elsewhere, no finance view and another tenant', async () => {
    const { obligationId } = await owedBack('odfd2b_request_denied', '30.00');
    const body = { amount: '5.00', paymentMethodId: PAYMENT_METHOD_A, reason: 'x' };
    authAs(SAL_CASHIER);
    const cashier = await requestRefund(obligationId, body);
    expect(cashier.status).toBe(403);
    expect(await deniedEvents(cashier)).toBe(1);
    authAs(SAL_PERMISSION_ELSEWHERE);
    const elsewhere = await requestRefund(obligationId, body);
    expect(elsewhere.status).toBe(403);
    expect(await deniedEvents(elsewhere)).toBe(1);
    authAs(SAL_NO_FINANCE);
    expect((await requestRefund(obligationId, body)).status).toBe(403);
    authAs(SAL_TENANT_B);
    expect((await requestRefund(obligationId, body)).status).toBe(404);
    expect(await requestsOf(obligationId)).toBe(0);
  });
});

describe('D2 part 2 — a different authorised person decides', () => {
  it('refuses the requester, a holder of every other decision code, and the code in another branch', async () => {
    const { obligationId } = await owedBack('odfd2b_approve_denied', '30.00');
    const pending = await pendingRefund(obligationId);

    authAs(SAL_FULL);
    const self = await approve(pending.id, pending.version);
    expect(self.status).toBe(409);
    expect((await bodyOf<ProblemBody>(self)).violations).toEqual([
      { path: 'path.requestId', rule: 'refund_self_approval' },
    ]);
    expect(await refusalEvents('sal.refund_request', pending.id, 'refund_self_approval')).toBe(1);

    authAs(FD2B_NO_REFUND_CODE);
    const noCode = await approve(pending.id, pending.version);
    expect(noCode.status).toBe(403);
    expect(await deniedEvents(noCode)).toBe(1);
    authAs(FD2B_NO_REFUND_CODE);
    expect((await reject(pending.id, pending.version, { reason: 'no' })).status).toBe(403);

    authAs(SAL_PERMISSION_ELSEWHERE);
    const elsewhere = await approve(pending.id, pending.version);
    expect(elsewhere.status).toBe(403);
    expect(await deniedEvents(elsewhere)).toBe(1);

    authAs(SAL_TENANT_B);
    expect((await approve(pending.id, pending.version)).status).toBe(404);
    expect(await storedVersion(pending.id)).toBe(pending.version);
  });

  it('approves under the request version, pays nothing, audits once and replays; stale and missing versions are refused', async () => {
    const { obligationId } = await owedBack('odfd2b_approve', '30.00');
    const pending = await pendingRefund(obligationId);
    authAs(SAL_APPROVER);
    expect((await approve(pending.id, pending.version + 1)).status).toBe(409);
    authAs(SAL_APPROVER);
    expect((await approve(pending.id)).status).toBe(428);

    authAs(SAL_APPROVER);
    const response = await approve(pending.id, pending.version);
    expect(response.status).toBe(200);
    const body = await bodyOf<RefundResultBody>(response);
    expect(body.refundRequest).toMatchObject({ state: 'approved', decidedBy: SAL_APPROVER.userId });
    expect(body.replayed).toBe(false);
    expect(await auditCountFor('sal.refund_request.approved', pending.id)).toBe(1);
    expect(await executedEvents(pending.id)).toBe(0);

    authAs(SAL_APPROVER);
    const replay = await approve(pending.id, body.refundRequest.recordVersion);
    expect((await bodyOf<RefundResultBody>(replay)).replayed).toBe(true);
    expect(await auditCountFor('sal.refund_request.approved', pending.id)).toBe(1);
  });

  it('rejects with a reason by another person, refuses the requester and a blank reason, and freezes the decision', async () => {
    const { obligationId } = await owedBack('odfd2b_reject', '30.00');
    const pending = await pendingRefund(obligationId);
    authAs(SAL_FULL);
    const self = await reject(pending.id, pending.version, { reason: 'mine' });
    expect((await bodyOf<ProblemBody>(self)).violations).toEqual([
      { path: 'path.requestId', rule: 'refund_self_rejection' },
    ]);
    authAs(SAL_APPROVER);
    const blank = await reject(pending.id, pending.version, { reason: '   ' });
    expect(blank.status).toBe(422);
    expect((await bodyOf<ProblemBody>(blank)).violations).toEqual([
      { path: 'body.reason', rule: 'too_small' },
    ]);
    authAs(SAL_APPROVER);
    const rejected = await reject(pending.id, pending.version, { reason: 'Not owed after all' });
    expect(rejected.status).toBe(200);
    const body = await bodyOf<RefundResultBody>(rejected);
    expect(body.refundRequest).toMatchObject({
      state: 'rejected',
      decisionReason: 'Not owed after all',
      decidedBy: SAL_APPROVER.userId,
    });
    expect(await auditCountFor('sal.refund_request.rejected', pending.id)).toBe(1);

    authAs(SAL_APPROVER);
    const frozen = await approve(pending.id, body.refundRequest.recordVersion);
    expect((await bodyOf<ProblemBody>(frozen)).violations).toEqual([
      { path: 'path.requestId', rule: 'refund_decision_frozen' },
    ]);
    expect(await refusalEvents('sal.refund_request', pending.id, 'refund_decision_frozen')).toBe(1);
    // A rejection does not block a corrected request.
    expect((await pendingRefund(obligationId, '20.00')).id).not.toBe(pending.id);
  });

  it('lets only the requester withdraw, under the request version', async () => {
    const { obligationId } = await owedBack('odfd2b_withdraw', '30.00');
    const pending = await pendingRefund(obligationId);
    authAs(SAL_APPROVER);
    const other = await withdraw(pending.id, pending.version);
    expect((await bodyOf<ProblemBody>(other)).violations).toEqual([
      { path: 'path.requestId', rule: 'refund_withdraw_not_requester' },
    ]);
    authAs(SAL_FULL);
    expect((await withdraw(pending.id)).status).toBe(428);
    authAs(SAL_FULL);
    const done = await withdraw(pending.id, pending.version);
    expect(done.status).toBe(200);
    expect((await bodyOf<RefundResultBody>(done)).refundRequest.state).toBe('withdrawn');
    expect(await auditCountFor('sal.refund_request.withdrawn', pending.id)).toBe(1);
  });
});

describe('D2 part 2 — the payout is recorded once, after the approval', () => {
  it('refuses a payout before approval, by another method or on a future day', async () => {
    const { obligationId } = await owedBack('odfd2b_execute_rules', '30.00');
    const pending = await pendingRefund(obligationId);
    authAs(SAL_FULL);
    const early = await execute(pending.id, pending.version);
    expect((await bodyOf<ProblemBody>(early)).violations).toEqual([
      { path: 'path.requestId', rule: 'refund_not_approved' },
    ]);
    expect(await refusalEvents('sal.refund_request', pending.id, 'refund_not_approved')).toBe(1);

    authAs(SAL_APPROVER);
    const approved = await bodyOf<RefundResultBody>(await approve(pending.id, pending.version));
    const version = approved.refundRequest.recordVersion;
    authAs(SAL_FULL);
    const method = await execute(pending.id, version, {
      paymentMethodId: PAYMENT_METHOD_A_INACTIVE,
      payoutReference: 'X',
      payoutDate: today(),
    });
    expect((await bodyOf<ProblemBody>(method)).violations).toEqual([
      { path: 'body.paymentMethodId', rule: 'refund_payout_method_mismatch' },
    ]);
    authAs(SAL_FULL);
    const future = await execute(pending.id, version, {
      paymentMethodId: PAYMENT_METHOD_A,
      payoutReference: 'X',
      payoutDate: '2999-01-01',
    });
    expect(future.status).toBe(422);
    expect((await bodyOf<ProblemBody>(future)).violations).toEqual([
      { path: 'body.payoutDate', rule: 'refund_payout_date_invalid' },
    ]);
    authAs(SAL_CASHIER);
    const cashier = await execute(pending.id, version);
    expect(cashier.status).toBe(403);
    expect(await deniedEvents(cashier)).toBe(1);
    expect(await executedEvents(pending.id)).toBe(0);
  });

  it('records the payout once with one event and one audit record, replays under its key, and refuses another', async () => {
    const { obligationId } = await owedBack('odfd2b_execute', '30.00');
    const approved = await approvedRefund(obligationId, '12.00');
    const key = randomUUID();
    const payout = {
      paymentMethodId: PAYMENT_METHOD_A,
      payoutReference: 'TRF-55',
      payoutDate: today(),
    };
    authAs(SAL_FULL);
    expect((await execute(approved.id, approved.version + 5, payout, key)).status).toBe(409);
    authAs(SAL_FULL);
    const response = await execute(approved.id, approved.version, payout, key);
    expect(response.status).toBe(200);
    const body = await bodyOf<RefundResultBody>(response);
    expect(body.refundRequest).toMatchObject({
      state: 'executed',
      executedBy: SAL_FULL.userId,
      payoutReference: 'TRF-55',
      payoutDate: today(),
    });
    expect(body.obligation).toMatchObject({
      state: 'open',
      paidOut: { amount: '12.0000' },
      stillOwed: { amount: '18.0000' },
    });
    expect(await executedEvents(approved.id)).toBe(1);
    expect(await auditCountFor('sal.refund_request.executed', approved.id)).toBe(1);

    authAs(SAL_FULL);
    // The same key: the transport answers with the STORED body; nothing is written twice.
    const replay = await execute(approved.id, approved.version, payout, key);
    expect(replay.status).toBe(200);
    expect((await bodyOf<RefundResultBody>(replay)).refundRequest.id).toBe(approved.id);
    expect(await executedEvents(approved.id)).toBe(1);
    expect(await auditCountFor('sal.refund_request.executed', approved.id)).toBe(1);

    authAs(SAL_FULL);
    const again = await execute(approved.id, body.refundRequest.recordVersion, payout);
    expect((await bodyOf<ProblemBody>(again)).violations).toEqual([
      { path: 'path.requestId', rule: 'refund_already_executed' },
    ]);
    expect(await refusalEvents('sal.refund_request', approved.id, 'refund_already_executed')).toBe(
      1
    );
    expect(await executedEvents(approved.id)).toBe(1);
  });

  it('moves refundStatus through every state and settles the obligation when it is paid back in full', async () => {
    const { obligationId, invoiceId } = await owedBack('odfd2b_status', '30.00');
    const settlement = async () => {
      authAs(SAL_FULL);
      return (
        await bodyOf<{
          settlement: { refundStatus: string; refundOwed: MoneyBody; refunded: MoneyBody } | null;
        }>(await readOutstanding(invoiceId))
      ).settlement;
    };
    expect(await settlement()).toMatchObject({
      refundStatus: 'owed',
      refundOwed: { amount: '30.0000' },
      refunded: { amount: '0.0000' },
    });
    const first = await pendingRefund(obligationId, '10.00');
    expect((await settlement())?.refundStatus).toBe('requested');
    authAs(SAL_APPROVER);
    const approved = await bodyOf<RefundResultBody>(await approve(first.id, first.version));
    expect((await settlement())?.refundStatus).toBe('approved');
    authAs(SAL_FULL);
    expect((await execute(first.id, approved.refundRequest.recordVersion)).status).toBe(200);
    expect(await settlement()).toMatchObject({
      refundStatus: 'partly_refunded',
      refundOwed: { amount: '20.0000' },
      refunded: { amount: '10.0000' },
    });
    const rest = await approvedRefund(obligationId, '20.00');
    authAs(SAL_FULL);
    const last = await execute(rest.id, rest.version, {
      paymentMethodId: PAYMENT_METHOD_A,
      payoutReference: 'TRF-LAST',
      payoutDate: today(),
    });
    expect((await bodyOf<RefundResultBody>(last)).obligation.state).toBe('settled');
    expect(await auditCountFor('sal.refund_obligation.settled', obligationId)).toBe(1);
    expect(await settlement()).toMatchObject({
      refundStatus: 'refunded',
      refundOwed: { amount: '0.0000' },
      refunded: { amount: '30.0000' },
    });
    // Settled: nothing more can be asked for.
    authAs(SAL_FULL);
    const closed = await requestRefund(obligationId, {
      amount: '1.00',
      paymentMethodId: PAYMENT_METHOD_A,
      reason: 'x',
    });
    expect((await bodyOf<ProblemBody>(closed)).violations).toEqual([
      { path: 'path.obligationId', rule: 'refund_obligation_not_open' },
    ]);
  });
});

describe('D2 part 2 — the list and the detail', () => {
  it('lists a branch newest first, narrowed by invoice, customer and state, one page at a time', async () => {
    const one = await owedBack('odfd2b_list_one', '30.00');
    const two = await owedBack('odfd2b_list_two', '30.00');
    const pending = await pendingRefund(one.obligationId);
    const approved = await approvedRefund(two.obligationId);
    authAs(SAL_FULL);
    const byInvoice = await bodyOf<{ items: readonly RefundRequestBody[] }>(
      await listRefunds({ invoiceId: one.invoiceId })
    );
    expect(byInvoice.items.map((item) => [item.id, item.state])).toEqual([[pending.id, 'pending']]);
    authAs(SAL_FULL);
    const byState = await bodyOf<{ items: readonly RefundRequestBody[] }>(
      await listRefunds({ state: 'approved', partnerId: PARTNER_A })
    );
    expect(byState.items.map((item) => item.id)).toContain(approved.id);
    expect(byState.items.map((item) => item.id)).not.toContain(pending.id);
    authAs(SAL_FULL);
    const all = await bodyOf<{ items: readonly RefundRequestBody[] }>(await listRefunds({}));
    const ids = all.items.map((item) => item.id);
    expect(ids.indexOf(approved.id)).toBeLessThan(ids.indexOf(pending.id));
    authAs(SAL_FULL);
    const first = await bodyOf<{ items: readonly RefundRequestBody[]; nextCursor: string | null }>(
      await listRefunds({ limit: '1' })
    );
    expect(first.items).toHaveLength(1);
    authAs(SAL_FULL);
    const next = await bodyOf<{ items: readonly RefundRequestBody[] }>(
      await listRefunds({ limit: '1', cursor: first.nextCursor ?? '' })
    );
    expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
    authAs(SAL_FULL);
    expect((await listRefunds({ state: 'paid' })).status).toBe(422);
  });

  it('refuses a caller without the finance view, another branch and another tenant', async () => {
    authAs(SAL_NO_FINANCE);
    expect((await listRefunds({})).status).toBe(403);
    authAs(SAL_PERMISSION_ELSEWHERE);
    expect((await listRefunds({})).status).toBe(403);
    authAs(SAL_TENANT_B);
    expect((await listRefunds({})).status).toBe(403);
  });

  it('reads one request with its obligation, names the people only for a reader of users, and hides it from another tenant', async () => {
    const { obligationId } = await owedBack('odfd2b_detail', '30.00');
    const approved = await approvedRefund(obligationId);
    authAs(SAL_CREDIT_TRACE);
    const named = await bodyOf<{
      requestedByName: string | null;
      decidedByName: string | null;
      obligation: { stillOwed: MoneyBody };
    }>(await readRefund(approved.id));
    expect(named.requestedByName).not.toBeNull();
    expect(named.decidedByName).not.toBeNull();
    expect(named.obligation.stillOwed.amount).toBe('30.0000');
    authAs(SAL_FULL);
    const unnamed = await bodyOf<{ requestedByName: string | null; state: string }>(
      await readRefund(approved.id)
    );
    expect(unnamed.state).toBe('approved');
    expect(unnamed.requestedByName).toBeNull();
    authAs(SAL_TENANT_B);
    expect((await readRefund(approved.id)).status).toBe(404);
    authAs(SAL_NO_FINANCE);
    expect((await readRefund(approved.id)).status).toBe(403);
  });
});
