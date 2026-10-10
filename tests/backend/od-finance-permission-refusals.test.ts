/**
 * ADR-023 D12 extension (Owner decision 2026-10-03) — a refusal for want of a
 * PERMISSION on one of the four financial approval decisions is persisted in the
 * security trail, end to end through the route handlers.
 *
 * The four: `sal.credit-note-approve`, `sal.credit-note-reject`,
 * `sal.receipt-reversal-approve`, `sal.receipt-reversal-reject`. Before this
 * extension a scope or database-guard refusal for want of the deciding code on
 * the credit-note approval and the receipt-reversal decisions was already
 * persisted as `business-rule.refused` (`*_permission_missing`, FD2C/FD4), and
 * those rows stay in that class; the route-gate, `sal.finance.view`-only and
 * credit-note-rejection refusals were log lines. Nothing here claims a record of
 * such an attempt made before the extension.
 *
 * Every case counts a side effect and is written so it FAILS when the control it
 * names is removed. For each operation and each reachable source of the refusal —
 * the approval code held nowhere, `sal.finance.view` missing (both refused at the
 * pipeline's gate), the approval code held in another branch only (refused by the
 * deferred check against the document's own branch), and the database guard
 * (reached by revoking the code while the approval waits on the reversal's lock):
 *
 *  - the answer is still 403 `ERR-IAM-001`;
 *  - nothing financial moved: the document is still pending at the same version,
 *    no financial event was written, the receivable and the receipt are unchanged;
 *  - exactly ONE `authorization.denied` row carries the attempt's correlation id,
 *    with the tenant and actor of the session and a closed detail naming the
 *    operation, the branch, the missing codes and the source — and nothing of the
 *    document;
 *  - NO `business-rule.refused` row carries it, and no other tenant holds a row
 *    for it;
 *  - a reviewer holding `iam.audit.view` in the tenant reads the row under
 *    row-level security; a same-tenant user without it, and a reviewer of another
 *    tenant, cannot.
 *
 * And the business-rule refusals stay what they were: a self-approval and an
 * approval with no credit-note limit (D13) each write exactly one
 * `business-rule.refused` row and no `authorization.denied` row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
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
  CREDIT_APPROVE,
  CREDIT_MANAGE,
  FINANCE_VIEW,
  PAYMENT_METHOD_A,
  PAYMENT_RECORD,
  REVERSAL_APPROVE,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
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
import { POST as APPROVE_CREDIT_NOTE } from '@/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import { POST as REJECT_CREDIT_NOTE } from '@/app/api/v1/credit-notes/[creditNoteId]/rejection/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { POST as REQUEST_REVERSAL } from '@/app/api/v1/payments/[paymentId]/reversals/route';
import { POST as APPROVE_REVERSAL } from '@/app/api/v1/receipt-reversals/[reversalId]/approval/route';
import { POST as REJECT_REVERSAL } from '@/app/api/v1/receipt-reversals/[reversalId]/rejection/route';

let admin: Pool;
let runtime: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const principal = (
  suffix: string,
  tenantId: string,
  permissions: readonly string[]
): Principal => ({
  roleId: `f1320000-0000-4000-8000-0000000d12${suffix}1`,
  userId: `f1320000-0000-4000-8000-0000000d12${suffix}2`,
  subject: `fx_od_d12x_${suffix}`,
  tenantId,
  permissions,
});

/** Reads money and may request, and holds neither approval code anywhere. */
const NO_APPROVAL = principal('a', TENANT_A, [FINANCE_VIEW, CREDIT_MANAGE, PAYMENT_RECORD]);
/** Holds both approval codes and not `sal.finance.view`. */
const NO_FINANCE = principal('b', TENANT_A, [CREDIT_APPROVE, REVERSAL_APPROVE, CREDIT_MANAGE]);
/** Decides credit notes and holds no credit-note limit: refused by D13, a business rule. */
const NO_LIMIT = principal('c', TENANT_A, [FINANCE_VIEW, CREDIT_MANAGE, CREDIT_APPROVE]);
/** Decides reversals; its approval code is revoked while its approval waits on a lock. */
const REVOKED = principal('d', TENANT_A, [FINANCE_VIEW, REVERSAL_APPROVE]);
/** Security reviewers: `iam.audit.view` only, one per tenant. */
const REVIEWER_A = principal('e', TENANT_A, ['iam.audit.view']);
const REVIEWER_B = principal('f', TENANT_B, ['iam.audit.view']);

const SUITE_PRINCIPALS = [NO_APPROVAL, NO_FINANCE, NO_LIMIT, REVOKED, REVIEWER_A, REVIEWER_B];

async function seedPrincipal(p: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','D12 extension principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [p.userId, p.tenantId, IDENTITY_PROVIDER, p.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'D12 extension fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [p.roleId, p.tenantId, p.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,perm.id,'allow',$3::uuid FROM iam.permissions perm
      WHERE perm.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [p.tenantId, p.roleId, USER_A, [...p.permissions]]
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

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

function commandHeaders(version?: number): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
  };
  if (version !== undefined) headers['if-match'] = String(version);
  return headers;
}

const post = <P extends Record<string, string>>(
  handler: unknown,
  path: string,
  params: P,
  init: { readonly body?: unknown; readonly version?: number } = {}
): Promise<Response> =>
  (handler as ParamHandler<P>)(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: commandHeaders(init.version),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    { params: Promise.resolve(params) }
  );

// ---- Documents ----------------------------------------------------------------

interface PendingDocument {
  readonly id: string;
  readonly version: number;
}

async function pendingNote(invoiceId: string): Promise<PendingDocument> {
  authAs(SAL_FULL);
  const response = await post(
    REQUEST_CREDIT_NOTE,
    `/api/v1/invoices/${invoiceId}/credit-notes`,
    { invoiceId },
    { body: { amount: '10.00', reason: 'D12 extension probe' } }
  );
  if (response.status !== 201) {
    throw new Error(`fixture credit note failed with ${response.status}: ${await response.text()}`);
  }
  const note = (await bodyOf<{ creditNote: { id: string; recordVersion: number } }>(response))
    .creditNote;
  return { id: note.id, version: note.recordVersion };
}

async function recordReceipt(): Promise<PendingDocument> {
  authAs(SAL_FULL);
  const response = await (RECORD_PAYMENT as (request: Request) => Promise<Response>)(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: commandHeaders(),
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        paymentMethodId: PAYMENT_METHOD_A,
        payerPartnerId: PARTNER_A,
        currency: 'USD',
        amount: '20.00',
      }),
    })
  );
  if (response.status !== 201) {
    throw new Error(`fixture receipt failed with ${response.status}: ${await response.text()}`);
  }
  const body = await bodyOf<{ id: string; recordVersion: number }>(response);
  return { id: body.id, version: body.recordVersion };
}

async function pendingReversal(receipt: PendingDocument): Promise<PendingDocument> {
  authAs(SAL_FULL);
  const response = await post(
    REQUEST_REVERSAL,
    `/api/v1/payments/${receipt.id}/reversals`,
    { paymentId: receipt.id },
    { version: receipt.version, body: { reason: 'Recorded against the wrong payer' } }
  );
  if (response.status !== 201) {
    throw new Error(`fixture reversal failed with ${response.status}: ${await response.text()}`);
  }
  const reversal = (await bodyOf<{ reversal: { id: string; recordVersion: number } }>(response))
    .reversal;
  return { id: reversal.id, version: reversal.recordVersion };
}

const approveNote = (note: PendingDocument) =>
  post(APPROVE_CREDIT_NOTE, `/api/v1/credit-notes/${note.id}/approval`, { creditNoteId: note.id });
const rejectNote = (note: PendingDocument) =>
  post(
    REJECT_CREDIT_NOTE,
    `/api/v1/credit-notes/${note.id}/rejection`,
    { creditNoteId: note.id },
    { version: note.version, body: { reason: 'Raised against the wrong invoice' } }
  );
const approveReversal = (reversal: PendingDocument) =>
  post(APPROVE_REVERSAL, `/api/v1/receipt-reversals/${reversal.id}/approval`, {
    reversalId: reversal.id,
  });
const rejectReversal = (reversal: PendingDocument) =>
  post(
    REJECT_REVERSAL,
    `/api/v1/receipt-reversals/${reversal.id}/rejection`,
    { reversalId: reversal.id },
    { version: reversal.version, body: { reason: 'The receipt is correct' } }
  );

// ---- What moved, and what was recorded -----------------------------------------

async function storedRow(
  table: 'sal.credit_notes' | 'sal.receipt_reversals',
  id: string
): Promise<{ state: string; version: number }> {
  const result = await admin.query<{ approval_state: string; record_version: number }>(
    `SELECT approval_state, record_version FROM ${table} WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`${table} ${id} is not stored`);
  return { state: row.approval_state, version: row.record_version };
}

const financialEvents = (sourceId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.financial_events WHERE source_id = $1`, [
    sourceId,
  ]);

const receiptStatus = async (receiptId: string): Promise<string> =>
  (
    await admin.query<{ s: string }>(`SELECT status AS s FROM sal.receipts WHERE id = $1`, [
      receiptId,
    ])
  ).rows[0]?.s ?? '';

interface SecurityRow {
  readonly tenant_id: string;
  readonly event_type: string;
  readonly severity: string;
  readonly actor_id: string;
  readonly detail: string;
}

/** Every security event of one attempt, read on the owner connection. */
async function eventsOf(correlationId: string): Promise<readonly SecurityRow[]> {
  const result = await admin.query<SecurityRow>(
    `SELECT tenant_id, event_type, severity, actor_id, detail FROM iam.security_events
      WHERE correlation_id = $1 ORDER BY event_type`,
    [correlationId]
  );
  return result.rows;
}

/** What one principal can read of one attempt's events, through row-level security. */
async function visibleTo(reader: Principal, correlationId: string): Promise<number> {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`,
      [reader.tenantId, reader.userId]
    );
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.security_events WHERE correlation_id = $1`,
      [correlationId]
    );
    return Number(result.rows[0]?.n ?? '0');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const correlationOf = (response: Response): string => {
  const value = response.headers.get('x-correlation-id');
  if (value === null) throw new Error('the response carries no correlation id');
  return value;
};

/**
 * The whole contract of one refused attempt: 403, exactly one
 * `authorization.denied` row with this detail, no business-rule row, nothing in
 * another tenant, and readable only by a reviewer of this tenant.
 */
async function expectPermissionRefusal(
  response: Response,
  actor: Principal,
  detail: string
): Promise<void> {
  expect(response.status).toBe(403);
  expect((await bodyOf<{ code: string }>(response.clone())).code).toBe('ERR-IAM-001');
  const correlationId = correlationOf(response);
  expect(await eventsOf(correlationId)).toEqual([
    {
      tenant_id: TENANT_A,
      event_type: 'authorization.denied',
      severity: 'warning',
      actor_id: actor.userId,
      detail,
    },
  ]);
  expect(
    await countRowsOf(
      `SELECT count(*)::text AS n FROM iam.security_events
        WHERE correlation_id = $1 AND (tenant_id IS DISTINCT FROM $2 OR event_type = 'business-rule.refused')`,
      [correlationId, TENANT_A]
    )
  ).toBe(0);
  expect(await visibleTo(REVIEWER_A, correlationId)).toBe(1);
  expect(await visibleTo(SAL_FULL, correlationId)).toBe(0);
  expect(await visibleTo(REVIEWER_B, correlationId)).toBe(0);
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
  // No credit-note limit for NO_LIMIT, whatever an earlier run left behind.
  await admin.query(`DELETE FROM iam.approval_limits WHERE tenant_id = $1 AND user_id = $2`, [
    TENANT_A,
    NO_LIMIT.userId,
  ]);
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

const NOTE_DECISIONS = [
  { operation: 'sal.credit-note-approve', tag: 'd12x_note_approve', send: approveNote },
  { operation: 'sal.credit-note-reject', tag: 'd12x_note_reject', send: rejectNote },
] as const;

const REVERSAL_DECISIONS = [
  { operation: 'sal.receipt-reversal-approve', send: approveReversal },
  { operation: 'sal.receipt-reversal-reject', send: rejectReversal },
] as const;

describe('D12 extension — credit-note decisions refused for want of a permission', () => {
  for (const { operation, tag, send } of NOTE_DECISIONS) {
    it(`${operation}: records each source once and moves nothing`, async () => {
      const invoice = await seedIssuedInvoice(tag);
      const note = await pendingNote(invoice.invoiceId);
      const open = await invoiceOpenReceivable(invoice.invoiceId);
      const cases = [
        {
          actor: NO_APPROVAL,
          detail: `operation=${operation} branch=none missing=${CREDIT_APPROVE} source=route outcome=refused`,
        },
        {
          actor: NO_FINANCE,
          detail: `operation=${operation} branch=none missing=${FINANCE_VIEW} source=route outcome=refused`,
        },
        {
          actor: SAL_PERMISSION_ELSEWHERE,
          detail:
            `operation=${operation} branch=${BRANCH_A1} ` +
            `missing=${CREDIT_APPROVE},${FINANCE_VIEW} source=scope outcome=refused`,
        },
      ];
      for (const { actor, detail } of cases) {
        authAs(actor);
        await expectPermissionRefusal(await send(note), actor, detail);
        expect(await storedRow('sal.credit_notes', note.id)).toEqual({
          state: 'pending',
          version: note.version,
        });
        expect(await financialEvents(note.id)).toBe(0);
        expect(await invoiceOpenReceivable(invoice.invoiceId)).toBe(open);
      }
    });
  }
});

describe('D12 extension — receipt-reversal decisions refused for want of a permission', () => {
  for (const { operation, send } of REVERSAL_DECISIONS) {
    it(`${operation}: records each source once and moves nothing`, async () => {
      const receipt = await recordReceipt();
      const reversal = await pendingReversal(receipt);
      const cases = [
        {
          actor: NO_APPROVAL,
          detail: `operation=${operation} branch=none missing=${REVERSAL_APPROVE} source=route outcome=refused`,
        },
        {
          actor: NO_FINANCE,
          detail: `operation=${operation} branch=none missing=${FINANCE_VIEW} source=route outcome=refused`,
        },
        {
          actor: SAL_PERMISSION_ELSEWHERE,
          detail:
            `operation=${operation} branch=${BRANCH_A1} ` +
            `missing=${REVERSAL_APPROVE},${FINANCE_VIEW} source=scope outcome=refused`,
        },
      ];
      for (const { actor, detail } of cases) {
        authAs(actor);
        await expectPermissionRefusal(await send(reversal), actor, detail);
        expect(await storedRow('sal.receipt_reversals', reversal.id)).toEqual({
          state: 'pending',
          version: reversal.version,
        });
        expect(await financialEvents(reversal.id)).toBe(0);
        expect(await receiptStatus(receipt.id)).toBe('recorded');
      }
    });
  }

  it('sal.receipt-reversal-approve: records the database guard once when the code is revoked mid-command', async () => {
    const receipt = await recordReceipt();
    const reversal = await pendingReversal(receipt);
    const gate = await admin.connect();
    let response: Response | undefined;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT id FROM sal.receipt_reversals WHERE id = $1 FOR UPDATE', [
        reversal.id,
      ]);
      authAs(REVOKED);
      // The gate and the scope check pass; the command then waits on the reversal row.
      const inFlight = approveReversal(reversal);
      try {
        await waitForBlockedBackends(1);
        await admin.query(
          `DELETE FROM iam.role_permissions
            WHERE tenant_id = $1 AND role_id = $2
              AND permission_id = (SELECT id FROM iam.permissions WHERE permission_code = $3)`,
          [TENANT_A, REVOKED.roleId, REVERSAL_APPROVE]
        );
      } finally {
        await gate.query('ROLLBACK');
      }
      response = await inFlight;
    } finally {
      gate.release();
      // Restore the code, so a re-run starts from the declared principal.
      await seedPrincipal(REVOKED);
    }
    await expectPermissionRefusal(
      response,
      REVOKED,
      `operation=sal.receipt-reversal-approve branch=${BRANCH_A1} ` +
        `missing=${REVERSAL_APPROVE} source=database outcome=refused`
    );
    expect(await storedRow('sal.receipt_reversals', reversal.id)).toEqual({
      state: 'pending',
      version: reversal.version,
    });
    expect(await financialEvents(reversal.id)).toBe(0);
    expect(await receiptStatus(receipt.id)).toBe('recorded');
  });
});

describe('D12 extension — business-rule refusals stay business-rule refusals', () => {
  const businessOnly = async (response: Response, expectedStatus: number, rule: string) => {
    expect(response.status).toBe(expectedStatus);
    const events = await eventsOf(correlationOf(response));
    expect(events.map((row) => row.event_type)).toEqual(['business-rule.refused']);
    expect(events[0]?.detail).toContain(`rule=${rule} outcome=refused`);
  };

  it('a self-approval of a credit note and of a reversal, and an approval with no limit', async () => {
    const invoice = await seedIssuedInvoice('d12x_business');
    const note = await pendingNote(invoice.invoiceId);
    authAs(SAL_FULL);
    await businessOnly(await approveNote(note), 409, 'credit_note_self_approval');
    authAs(NO_LIMIT);
    await businessOnly(await approveNote(note), 403, 'credit_no_approval_limit');

    const receipt = await recordReceipt();
    const reversal = await pendingReversal(receipt);
    authAs(SAL_FULL);
    await businessOnly(await approveReversal(reversal), 409, 'receipt_reversal_self_approval');

    expect(await storedRow('sal.credit_notes', note.id)).toEqual({
      state: 'pending',
      version: note.version,
    });
    expect(await storedRow('sal.receipt_reversals', reversal.id)).toEqual({
      state: 'pending',
      version: reversal.version,
    });
  });
});
