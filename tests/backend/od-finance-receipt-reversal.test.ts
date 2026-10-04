/**
 * P1-32-PRE-OD-FD4 — the receipt reversal of ADR-023 D4, end to end through the
 * route handlers: requested by a payment recorder, approved or rejected by a
 * DIFFERENT holder of `sal.reversal.approve`, withdrawn only by its requester, and
 * the replacement receipt linked to the reversed one.
 *
 * Every case counts a side effect — a state, a row, an audit record, a security
 * event, a financial event, an invoice's open amount — and is written so it FAILS
 * when the control it names is removed:
 *
 *  - the request: the payment recorder only; the amount is never the caller's
 *    (a body naming one is refused, the stored amount is the receipt's); the
 *    receipt's `If-Match` (stale is a conflict, missing is 428); a replay under the
 *    same key records nothing twice; a second live request and a reversed receipt
 *    are refused by name;
 *  - the freeze: an allocation while a reversal is pending is refused by name;
 *  - the decision: self-approval refused; a holder of the credit-note codes only is
 *    refused; the code held in another branch is refused (and recorded); the
 *    approval reverses the receipt, restores the invoice EXACTLY, writes one
 *    financial event and one audit record, and replays without a second of either;
 *    a rejection states why; the requester alone withdraws; decided reversals are
 *    terminal; an approval racing a rejection has exactly one winner; another
 *    tenant is a 404;
 *  - the replacement: only for a receipt an approved reversal reversed, once, and
 *    linked both ways on the receipt detail, which names the people on the
 *    reversal only for a reader who may read users;
 *  - D12: each refusal by rule leaves exactly ONE security event after the rollback.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   sal.receipt-reversal-request: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 *   sal.receipt-reversal-approve: route service authorization success denial audit idempotency isolation cross-tenant
 *   sal.receipt-reversal-reject: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 *   sal.receipt-reversal-withdraw: route service authorization success denial audit idempotency stale-version isolation cross-tenant
 *   sal.receipt-replacement-record: route service authorization success denial audit idempotency isolation cross-tenant
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
import {
  PARTNER_A,
  establishP1_19Fixtures,
  waitForBlockedBackends,
  type Principal,
} from './p1-19-helpers';
import {
  PAYMENT_METHOD_A,
  SAL_APPROVER,
  SAL_CASHIER,
  SAL_CREDIT_TRACE,
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
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as ALLOCATE_PAYMENT } from '@/app/api/v1/payments/[paymentId]/allocations/route';
import { GET as RECEIPT_DETAIL } from '@/app/api/v1/payments/[paymentId]/route';
import {
  POST as REQUEST_REVERSAL,
  RECEIPT_REVERSAL_REQUEST_OPERATION,
} from '@/app/api/v1/payments/[paymentId]/reversals/route';
import {
  POST as RECORD_REPLACEMENT,
  RECEIPT_REPLACEMENT_RECORD_OPERATION,
} from '@/app/api/v1/payments/[paymentId]/replacement/route';
import {
  POST as APPROVE_REVERSAL,
  RECEIPT_REVERSAL_APPROVE_OPERATION,
} from '@/app/api/v1/receipt-reversals/[reversalId]/approval/route';
import {
  POST as REJECT_REVERSAL,
  RECEIPT_REVERSAL_REJECT_OPERATION,
} from '@/app/api/v1/receipt-reversals/[reversalId]/rejection/route';
import {
  POST as WITHDRAW_REVERSAL,
  RECEIPT_REVERSAL_WITHDRAW_OPERATION,
} from '@/app/api/v1/receipt-reversals/[reversalId]/withdrawal/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface ReversalBody {
  readonly id: string;
  readonly receiptId: string;
  readonly state: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly reason: string;
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly reversedAt: string | null;
  readonly recordVersion: number;
}

interface ReversalResultBody {
  readonly reversal: ReversalBody;
  readonly replayed: boolean;
}

interface ReceiptDetailBody {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly recordVersion: number;
  readonly reversal:
    | (ReversalBody & {
        readonly requestedByName: string | null;
        readonly decidedByName: string | null;
      })
    | null;
  readonly replaces: { readonly id: string; readonly reference: string } | null;
  readonly replacedBy: { readonly id: string; readonly reference: string } | null;
}

/** Holds the finance view and BOTH credit-note codes — and not `sal.reversal.approve`. */
const FD4_CREDIT_ONLY: Principal = {
  roleId: 'f1320000-0000-4000-8000-00000000fd43',
  userId: 'f1320000-0000-4000-8000-00000000fd44',
  subject: 'fx_od_fd4_credit_approver_only',
  tenantId: TENANT_A,
  permissions: ['sal.finance.view', 'sal.credit.manage', 'sal.credit.approve'],
};

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

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

const requestReversal = (
  paymentId: string,
  version: number | undefined,
  body: unknown,
  key?: string
) =>
  send(
    REQUEST_REVERSAL,
    `/api/v1/payments/${paymentId}/reversals`,
    { paymentId },
    {
      body,
      ...(version === undefined ? {} : { version }),
      ...(key === undefined ? {} : { key }),
    }
  );

const approve = (reversalId: string, key?: string) =>
  send(
    APPROVE_REVERSAL,
    `/api/v1/receipt-reversals/${reversalId}/approval`,
    { reversalId },
    {
      ...(key === undefined ? {} : { key }),
    }
  );

const reject = (reversalId: string, version: number | undefined, body: unknown, key?: string) =>
  send(
    REJECT_REVERSAL,
    `/api/v1/receipt-reversals/${reversalId}/rejection`,
    { reversalId },
    {
      body,
      ...(version === undefined ? {} : { version }),
      ...(key === undefined ? {} : { key }),
    }
  );

const withdraw = (reversalId: string, version?: number, key?: string) =>
  send(
    WITHDRAW_REVERSAL,
    `/api/v1/receipt-reversals/${reversalId}/withdrawal`,
    { reversalId },
    {
      ...(version === undefined ? {} : { version }),
      ...(key === undefined ? {} : { key }),
    }
  );

const replacement = (paymentId: string, body: unknown, key?: string) =>
  send(
    RECORD_REPLACEMENT,
    `/api/v1/payments/${paymentId}/replacement`,
    { paymentId },
    {
      body,
      ...(key === undefined ? {} : { key }),
    }
  );

const allocate = (paymentId: string, invoiceId: string, amount: string) =>
  send(
    ALLOCATE_PAYMENT,
    `/api/v1/payments/${paymentId}/allocations`,
    { paymentId },
    {
      body: { invoiceId, amount, currency: 'USD' },
    }
  );

async function readReceipt(paymentId: string): Promise<Response> {
  return (RECEIPT_DETAIL as ParamHandler<{ paymentId: string }>)(
    new Request(`http://localhost/api/v1/payments/${paymentId}`),
    { params: Promise.resolve({ paymentId }) }
  );
}

/** A receipt recorded through the route by SAL_FULL; returns its id and version. */
async function recordReceipt(amount: string): Promise<{ id: string; version: number }> {
  authAs(SAL_FULL);
  const response = await (RECORD_PAYMENT as (request: Request) => Promise<Response>)(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: commandHeaders(randomUUID()),
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        paymentMethodId: PAYMENT_METHOD_A,
        payerPartnerId: PARTNER_A,
        currency: 'USD',
        amount,
      }),
    })
  );
  if (response.status !== 201) {
    throw new Error(`fixture receipt failed with ${response.status}: ${await response.text()}`);
  }
  const body = await bodyOf<{ id: string; recordVersion: number }>(response);
  return { id: body.id, version: body.recordVersion };
}

/** The receipt's version as stored now. */
async function receiptVersion(receiptId: string): Promise<number> {
  const row = await admin.query<{ v: number }>(
    `SELECT record_version AS v FROM sal.receipts WHERE id = $1`,
    [receiptId]
  );
  return row.rows[0]?.v ?? -1;
}

/** A pending reversal raised through the route by SAL_FULL. */
async function pendingReversal(receiptId: string): Promise<{ id: string; version: number }> {
  authAs(SAL_FULL);
  const response = await requestReversal(receiptId, await receiptVersion(receiptId), {
    reason: 'Recorded against the wrong payer',
  });
  if (response.status !== 201) {
    throw new Error(`fixture reversal failed with ${response.status}: ${await response.text()}`);
  }
  const reversal = (await bodyOf<ReversalResultBody>(response)).reversal;
  return { id: reversal.id, version: reversal.recordVersion };
}

const storedState = async (reversalId: string): Promise<string> =>
  (
    await admin.query<{ s: string }>(
      `SELECT approval_state AS s FROM sal.receipt_reversals WHERE id = $1`,
      [reversalId]
    )
  ).rows[0]?.s ?? '';

const storedReceiptStatus = async (receiptId: string): Promise<string> =>
  (
    await admin.query<{ s: string }>(`SELECT status AS s FROM sal.receipts WHERE id = $1`, [
      receiptId,
    ])
  ).rows[0]?.s ?? '';

const reversalsOf = (receiptId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.receipt_reversals WHERE original_receipt_id = $1`,
    [receiptId]
  );

const reversedEvents = (reversalId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM sal.financial_events
      WHERE source_id = $1 AND event_type = 'receipt_reversed'`,
    [reversalId]
  );

/** Business-rule refusal events recorded for one entity, optionally one rule. */
const refusalEvents = (entityType: string, entityId: string, rule?: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM iam.security_events
      WHERE event_type = 'business-rule.refused' AND detail LIKE $1`,
    [`%entity=${entityType}/${entityId} ${rule === undefined ? '' : `rule=${rule} `}%`]
  );

/** Runs requests with the race FORCED behind a held row lock. */
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
      for (const sender of senders) {
        inFlight.push(sender());
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

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','FD4 credit only','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'FD4 credit only',$4) ON CONFLICT (id) DO NOTHING`,
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
  await seedPrincipal(FD4_CREDIT_ONLY);
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

describe('D4 — the five operations are declared as the Owner rule requires', () => {
  it('requests and withdraws under the recording code, decides under sal.reversal.approve', () => {
    expect(RECEIPT_REVERSAL_REQUEST_OPERATION).toMatchObject({
      id: 'sal.receipt-reversal-request',
      permissions: ['sal.payment.record', 'sal.finance.view'],
      scope: 'branch',
      auditClass: 'financial',
      auditAction: 'sal.receipt_reversal.requested',
      idempotent: true,
      versionGuarded: true,
    });
    expect(RECEIPT_REVERSAL_APPROVE_OPERATION).toMatchObject({
      id: 'sal.receipt-reversal-approve',
      permissions: ['sal.reversal.approve', 'sal.finance.view'],
      auditClass: 'approval',
      auditAction: 'sal.receipt_reversal.approved',
      idempotent: true,
    });
    expect(RECEIPT_REVERSAL_REJECT_OPERATION).toMatchObject({
      id: 'sal.receipt-reversal-reject',
      permissions: ['sal.reversal.approve', 'sal.finance.view'],
      auditClass: 'approval',
      auditAction: 'sal.receipt_reversal.rejected',
      versionGuarded: true,
    });
    expect(RECEIPT_REVERSAL_WITHDRAW_OPERATION).toMatchObject({
      id: 'sal.receipt-reversal-withdraw',
      permissions: ['sal.payment.record', 'sal.finance.view'],
      auditClass: 'financial',
      auditAction: 'sal.receipt_reversal.withdrawn',
      versionGuarded: true,
    });
    expect(RECEIPT_REPLACEMENT_RECORD_OPERATION).toMatchObject({
      id: 'sal.receipt-replacement-record',
      permissions: ['sal.payment.record', 'sal.finance.view'],
      auditClass: 'financial',
      auditAction: 'sal.receipt.replacement_recorded',
      idempotent: true,
    });
    // No credit-note code decides a receipt reversal.
    for (const operation of [
      RECEIPT_REVERSAL_APPROVE_OPERATION,
      RECEIPT_REVERSAL_REJECT_OPERATION,
    ]) {
      expect(operation.permissions).not.toContain('sal.credit.manage');
      expect(operation.permissions).not.toContain('sal.credit.approve');
    }
  });
});

describe('D4 — a payment recorder requests a full reversal', () => {
  it('raises a pending reversal of the whole receipt, audits it once, and replays under the same key', async () => {
    const receipt = await recordReceipt('80.00');
    const key = randomUUID();
    authAs(SAL_FULL);
    const response = await requestReversal(
      receipt.id,
      receipt.version,
      { reason: 'Amount typed wrong' },
      key
    );
    expect(response.status).toBe(201);
    const result = await bodyOf<ReversalResultBody>(response);
    expect(result.replayed).toBe(false);
    expect(result.reversal).toMatchObject({
      receiptId: receipt.id,
      state: 'pending',
      amount: { amount: '80.0000', currency: 'USD' },
      reason: 'Amount typed wrong',
      requestedBy: SAL_FULL.userId,
      decidedBy: null,
      reversedAt: null,
    });
    expect(await auditCountFor('sal.receipt_reversal.requested', result.reversal.id)).toBe(1);
    expect(await storedReceiptStatus(receipt.id)).toBe('recorded');

    // The same key: one reversal, one audit record.
    authAs(SAL_FULL);
    const again = await requestReversal(
      receipt.id,
      receipt.version,
      { reason: 'Amount typed wrong' },
      key
    );
    // The transport answers a repeated key with the STORED body, at 200.
    expect(again.status).toBe(200);
    expect((await bodyOf<ReversalResultBody>(again)).reversal.id).toBe(result.reversal.id);
    expect(await reversalsOf(receipt.id)).toBe(1);
    expect(await auditCountFor('sal.receipt_reversal.requested', result.reversal.id)).toBe(1);
  });

  it('never takes an amount from the caller', async () => {
    const receipt = await recordReceipt('45.00');
    authAs(SAL_FULL);
    const response = await requestReversal(receipt.id, receipt.version, {
      reason: 'partial',
      amount: '10.00',
    });
    expect(response.status).toBe(422);
    expect(await reversalsOf(receipt.id)).toBe(0);
  });

  it('requires the receipt version, refuses a stale one, and refuses a blank reason on the field', async () => {
    const receipt = await recordReceipt('30.00');
    authAs(SAL_FULL);
    expect((await requestReversal(receipt.id, undefined, { reason: 'x' })).status).toBe(428);
    authAs(SAL_FULL);
    const stale = await requestReversal(receipt.id, receipt.version + 7, { reason: 'stale' });
    expect(stale.status).toBe(409);
    expect((await bodyOf<ProblemBody>(stale)).code).toBe('ERR-CON-001');
    authAs(SAL_FULL);
    const blank = await requestReversal(receipt.id, receipt.version, { reason: '   ' });
    expect(blank.status).toBe(422);
    expect((await bodyOf<ProblemBody>(blank)).violations).toEqual([
      { path: 'body.reason', rule: 'too_small' },
    ]);
    expect(await reversalsOf(receipt.id)).toBe(0);
    expect(await refusalEvents('sal.receipt', receipt.id)).toBe(0);
  });

  it('refuses a caller without the recording code, and records one who holds it in another branch only', async () => {
    const receipt = await recordReceipt('20.00');
    authAs(SAL_CASHIER);
    expect((await requestReversal(receipt.id, receipt.version, { reason: 'x' })).status).toBe(403);
    authAs(SAL_PERMISSION_ELSEWHERE);
    expect((await requestReversal(receipt.id, receipt.version, { reason: 'x' })).status).toBe(403);
    expect(
      await refusalEvents('sal.receipt', receipt.id, 'receipt_reversal_request_permission_missing')
    ).toBe(1);
    authAs(SAL_TENANT_B);
    expect((await requestReversal(receipt.id, receipt.version, { reason: 'x' })).status).toBe(404);
    expect(await reversalsOf(receipt.id)).toBe(0);
  });

  it('refuses a second live request by name and records it once', async () => {
    const receipt = await recordReceipt('25.00');
    await pendingReversal(receipt.id);
    authAs(SAL_FULL);
    const second = await requestReversal(receipt.id, await receiptVersion(receipt.id), {
      reason: 'twice',
    });
    expect(second.status).toBe(409);
    expect((await bodyOf<ProblemBody>(second)).violations).toEqual([
      { path: 'path.paymentId', rule: 'receipt_reversal_exists' },
    ]);
    expect(await reversalsOf(receipt.id)).toBe(1);
    expect(await refusalEvents('sal.receipt', receipt.id, 'receipt_reversal_exists')).toBe(1);
  });
});

describe('D4 — a pending reversal freezes the receipt for new allocations', () => {
  it('refuses an allocation by name, records it once, and allows it again after a withdrawal', async () => {
    const invoice = await seedIssuedInvoice('odfd4_freeze');
    const receipt = await recordReceipt('50.00');
    const reversal = await pendingReversal(receipt.id);
    authAs(SAL_FULL);
    const refused = await allocate(receipt.id, invoice.invoiceId, '10.00');
    expect(refused.status).toBe(409);
    expect((await bodyOf<ProblemBody>(refused)).violations).toEqual([
      { path: 'path.paymentId', rule: 'receipt_reversal_pending_blocks_allocation' },
    ]);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`,
        [receipt.id]
      )
    ).toBe(0);
    expect(
      await refusalEvents('sal.receipt', receipt.id, 'receipt_reversal_pending_blocks_allocation')
    ).toBe(1);

    authAs(SAL_FULL);
    expect((await withdraw(reversal.id, reversal.version)).status).toBe(200);
    authAs(SAL_FULL);
    expect((await allocate(receipt.id, invoice.invoiceId, '10.00')).status).toBe(201);
  });
});

describe('D4 — a different authorised person approves', () => {
  it('refuses the requester, a holder of the credit-note codes only, and the code in another branch', async () => {
    const receipt = await recordReceipt('15.00');
    const reversal = await pendingReversal(receipt.id);

    authAs(SAL_FULL);
    const self = await approve(reversal.id);
    expect(self.status).toBe(409);
    expect((await bodyOf<ProblemBody>(self)).violations).toEqual([
      { path: 'path.reversalId', rule: 'receipt_reversal_self_approval' },
    ]);
    expect(
      await refusalEvents('sal.receipt_reversal', reversal.id, 'receipt_reversal_self_approval')
    ).toBe(1);

    authAs(FD4_CREDIT_ONLY);
    expect((await approve(reversal.id)).status).toBe(403);
    authAs(FD4_CREDIT_ONLY);
    expect((await reject(reversal.id, reversal.version, { reason: 'no' })).status).toBe(403);

    authAs(SAL_PERMISSION_ELSEWHERE);
    const elsewhere = await approve(reversal.id);
    expect(elsewhere.status).toBe(403);
    // A PERMISSION refusal since the D12 extension (Owner decision 2026-10-03):
    // recorded once as `authorization.denied`, and no longer as the business rule
    // `receipt_reversal_approve_permission_missing`. `od-finance-permission-refusals`
    // holds the full contract.
    expect(
      await refusalEvents(
        'sal.receipt_reversal',
        reversal.id,
        'receipt_reversal_approve_permission_missing'
      )
    ).toBe(0);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM iam.security_events
          WHERE correlation_id = $1 AND event_type = 'authorization.denied'`,
        [elsewhere.headers.get('x-correlation-id')]
      )
    ).toBe(1);

    authAs(SAL_TENANT_B);
    expect((await approve(reversal.id)).status).toBe(404);
    expect(await storedState(reversal.id)).toBe('pending');
    expect(await storedReceiptStatus(receipt.id)).toBe('recorded');
  });

  it('reverses the receipt, restores the invoice exactly, writes one event and one audit record, and replays', async () => {
    const invoice = await seedIssuedInvoice('odfd4_approve');
    const receipt = await recordReceipt('100.00');
    authAs(SAL_FULL);
    expect((await allocate(receipt.id, invoice.invoiceId, '60.00')).status).toBe(201);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('40.0000');
    const reversal = await pendingReversal(receipt.id);

    authAs(SAL_APPROVER);
    const response = await approve(reversal.id);
    expect(response.status).toBe(200);
    const result = await bodyOf<ReversalResultBody>(response);
    expect(result.replayed).toBe(false);
    expect(result.reversal).toMatchObject({ state: 'approved', decidedBy: SAL_APPROVER.userId });
    expect(result.reversal.reversedAt).not.toBeNull();
    expect(await storedReceiptStatus(receipt.id)).toBe('reversed');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');
    expect(await reversedEvents(reversal.id)).toBe(1);
    expect(await auditCountFor('sal.receipt_reversal.approved', reversal.id)).toBe(1);
    // History is never deleted: the allocation is still recorded.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.payment_allocations WHERE receipt_id = $1`,
        [receipt.id]
      )
    ).toBe(1);

    authAs(SAL_APPROVER);
    const again = await approve(reversal.id);
    expect(again.status).toBe(200);
    expect((await bodyOf<ReversalResultBody>(again)).replayed).toBe(true);
    expect(await reversedEvents(reversal.id)).toBe(1);
    expect(await auditCountFor('sal.receipt_reversal.approved', reversal.id)).toBe(1);
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('100.0000');

    // Terminal: a rejection and a withdrawal afterwards are refused.
    const stored = await admin.query<{ v: number }>(
      `SELECT record_version AS v FROM sal.receipt_reversals WHERE id = $1`,
      [reversal.id]
    );
    const version = stored.rows[0]?.v ?? -1;
    authAs(SAL_APPROVER);
    const late = await reject(reversal.id, version, { reason: 'too late' });
    expect(late.status).toBe(409);
    expect((await bodyOf<ProblemBody>(late)).violations).toEqual([
      { path: 'path.reversalId', rule: 'receipt_reversal_decision_frozen' },
    ]);
    authAs(SAL_FULL);
    expect((await withdraw(reversal.id, version)).status).toBe(409);
  });

  it('has exactly one winner when an approval races a rejection', async () => {
    const receipt = await recordReceipt('12.00');
    const reversal = await pendingReversal(receipt.id);
    authAs(SAL_APPROVER);
    const outcomes = await race(
      {
        sql: 'SELECT id FROM sal.receipt_reversals WHERE id = $1 FOR UPDATE',
        values: [reversal.id],
      },
      [
        () => approve(reversal.id),
        () => reject(reversal.id, reversal.version, { reason: 'duplicate request' }),
      ]
    );
    const statuses = outcomes.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const final = await storedState(reversal.id);
    expect(['approved', 'rejected']).toContain(final);
    expect(await reversedEvents(reversal.id)).toBe(final === 'approved' ? 1 : 0);
    expect(await storedReceiptStatus(receipt.id)).toBe(
      final === 'approved' ? 'reversed' : 'recorded'
    );
  });
});

describe('D4 — rejection and withdrawal', () => {
  it('rejects with a reason; the requester may not reject and nobody else may withdraw', async () => {
    const invoice = await seedIssuedInvoice('odfd4_reject');
    const receipt = await recordReceipt('70.00');
    authAs(SAL_FULL);
    expect((await allocate(receipt.id, invoice.invoiceId, '70.00')).status).toBe(201);
    const reversal = await pendingReversal(receipt.id);

    authAs(SAL_FULL);
    const self = await reject(reversal.id, reversal.version, { reason: 'mine' });
    expect(self.status).toBe(409);
    expect((await bodyOf<ProblemBody>(self)).violations).toEqual([
      { path: 'path.reversalId', rule: 'receipt_reversal_self_rejection' },
    ]);
    authAs(SAL_APPROVER);
    const other = await withdraw(reversal.id, reversal.version);
    expect(other.status).toBe(409);
    expect((await bodyOf<ProblemBody>(other)).violations).toEqual([
      { path: 'path.reversalId', rule: 'receipt_reversal_withdraw_not_requester' },
    ]);
    authAs(SAL_APPROVER);
    expect((await reject(reversal.id, reversal.version + 3, { reason: 'stale' })).status).toBe(409);
    authAs(SAL_APPROVER);
    const blank = await reject(reversal.id, reversal.version, { reason: '  ' });
    expect(blank.status).toBe(422);

    const key = randomUUID();
    authAs(SAL_APPROVER);
    const rejected = await reject(
      reversal.id,
      reversal.version,
      { reason: 'The receipt is correct' },
      key
    );
    expect(rejected.status).toBe(200);
    expect((await bodyOf<ReversalResultBody>(rejected)).reversal).toMatchObject({
      state: 'rejected',
      decidedBy: SAL_APPROVER.userId,
      decisionReason: 'The receipt is correct',
    });
    expect(await auditCountFor('sal.receipt_reversal.rejected', reversal.id)).toBe(1);
    authAs(SAL_APPROVER);
    expect(
      (await reject(reversal.id, reversal.version, { reason: 'The receipt is correct' }, key))
        .status
    ).toBe(200);
    expect(await auditCountFor('sal.receipt_reversal.rejected', reversal.id)).toBe(1);
    // The receipt keeps counting.
    expect(await storedReceiptStatus(receipt.id)).toBe('allocated');
    expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe('30.0000');
    // Terminal: an approval afterwards is refused.
    authAs(SAL_APPROVER);
    expect((await approve(reversal.id)).status).toBe(409);
  });

  it('lets the requester withdraw, audits once, and accepts a corrected request afterwards', async () => {
    const receipt = await recordReceipt('33.00');
    const reversal = await pendingReversal(receipt.id);
    authAs(SAL_FULL);
    expect((await withdraw(reversal.id)).status).toBe(428);
    const key = randomUUID();
    authAs(SAL_FULL);
    const withdrawn = await withdraw(reversal.id, reversal.version, key);
    expect(withdrawn.status).toBe(200);
    expect((await bodyOf<ReversalResultBody>(withdrawn)).reversal).toMatchObject({
      state: 'withdrawn',
      decidedBy: SAL_FULL.userId,
    });
    authAs(SAL_FULL);
    expect((await withdraw(reversal.id, reversal.version, key)).status).toBe(200);
    expect(await auditCountFor('sal.receipt_reversal.withdrawn', reversal.id)).toBe(1);
    authAs(SAL_TENANT_B);
    expect((await withdraw(reversal.id, reversal.version)).status).toBe(404);
    authAs(SAL_TENANT_B);
    expect((await reject(reversal.id, reversal.version, { reason: 'x' })).status).toBe(404);

    await pendingReversal(receipt.id);
    expect(await reversalsOf(receipt.id)).toBe(2);
  });
});

describe('D4 — the replacement receipt, linked both ways', () => {
  it('records one replacement of an approved-reversed receipt and shows the link on both receipts', async () => {
    const receipt = await recordReceipt('90.00');
    const reversal = await pendingReversal(receipt.id);
    const body = {
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency: 'USD',
      amount: '85.00',
    };

    // Pending: nothing replaces it yet.
    authAs(SAL_FULL);
    const early = await replacement(receipt.id, body);
    expect(early.status).toBe(409);
    expect((await bodyOf<ProblemBody>(early)).violations).toEqual([
      { path: 'path.paymentId', rule: 'receipt_replacement_not_reversed' },
    ]);
    expect(await refusalEvents('sal.receipt', receipt.id, 'receipt_replacement_not_reversed')).toBe(
      1
    );

    authAs(SAL_APPROVER);
    expect((await approve(reversal.id)).status).toBe(200);

    const key = randomUUID();
    authAs(SAL_FULL);
    const recorded = await replacement(receipt.id, body, key);
    expect(recorded.status).toBe(201);
    const created = await bodyOf<{ id: string; replacesReceiptId: string | null }>(recorded);
    expect(created.replacesReceiptId).toBe(receipt.id);
    expect(await auditCountFor('sal.receipt.replacement_recorded', created.id)).toBe(1);
    authAs(SAL_FULL);
    const replayed = await replacement(receipt.id, body, key);
    // The transport answers a repeated key with the STORED body, at 200.
    expect(replayed.status).toBe(200);
    expect((await bodyOf<{ id: string }>(replayed)).id).toBe(created.id);
    expect(await auditCountFor('sal.receipt.replacement_recorded', created.id)).toBe(1);

    authAs(SAL_FULL);
    const second = await replacement(receipt.id, body);
    expect(second.status).toBe(409);
    expect((await bodyOf<ProblemBody>(second)).violations).toEqual([
      { path: 'path.paymentId', rule: 'receipt_replacement_exists' },
    ]);

    authAs(SAL_TENANT_B);
    expect((await replacement(receipt.id, body)).status).toBe(404);

    // Linked both ways; the people named only for a reader who may read users.
    authAs(SAL_CREDIT_TRACE);
    const reversed = await bodyOf<ReceiptDetailBody>(await readReceipt(receipt.id));
    expect(reversed.status).toBe('reversed');
    expect(reversed.replacedBy).toEqual({
      id: created.id,
      reference: expect.any(String) as string,
    });
    expect(reversed.reversal).toMatchObject({
      id: reversal.id,
      state: 'approved',
      requestedBy: SAL_FULL.userId,
      decidedBy: SAL_APPROVER.userId,
    });
    expect(reversed.reversal?.requestedByName).toEqual(expect.any(String));
    expect(reversed.reversal?.decidedByName).toEqual(expect.any(String));
    expect(reversed.reversal?.requestedByName).not.toBe(SAL_FULL.userId);
    authAs(SAL_CREDIT_TRACE);
    const replacing = await bodyOf<ReceiptDetailBody>(await readReceipt(created.id));
    expect(replacing.replaces).toEqual({ id: receipt.id, reference: reversed.reference });
    expect(replacing.replacedBy).toBeNull();
    authAs(SAL_FULL);
    const unnamed = await bodyOf<ReceiptDetailBody>(await readReceipt(receipt.id));
    expect(unnamed.reversal?.requestedByName).toBeNull();
    expect(unnamed.reversal?.decidedByName).toBeNull();
  });

  it('refuses a replacement of a receipt nobody reversed, and a caller without the recording code', async () => {
    const receipt = await recordReceipt('40.00');
    const body = {
      paymentMethodId: PAYMENT_METHOD_A,
      payerPartnerId: PARTNER_A,
      currency: 'USD',
      amount: '40.00',
    };
    authAs(SAL_FULL);
    const refused = await replacement(receipt.id, body);
    expect(refused.status).toBe(409);
    expect((await bodyOf<ProblemBody>(refused)).violations).toEqual([
      { path: 'path.paymentId', rule: 'receipt_replacement_not_reversed' },
    ]);
    authAs(SAL_CASHIER);
    expect((await replacement(receipt.id, body)).status).toBe(403);
    authAs(SAL_PERMISSION_ELSEWHERE);
    expect((await replacement(receipt.id, body)).status).toBe(403);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.receipts WHERE replaces_receipt_id = $1`,
        [receipt.id]
      )
    ).toBe(0);
  });
});
