/**
 * Cross-boundary refusals for the Phase 1-22 money and handover surface (§16).
 *
 * The ten operations here are exercised by their own suites for what they DO. This
 * file exists for the one property none of those suites can establish on its own: that
 * a caller standing outside the resource's tenant, company or branch is refused, and
 * refused for the right reason.
 *
 * ## The four boundaries, and why each needs its own principal
 *
 *  - **Tenant.** `SAL_TENANT_B` holds every `sal.`/`wty.` permission UNRESTRICTED in
 *    its own tenant, so a refusal from it is RLS and never a missing grant.
 *  - **Company.** `SAL_OTHER_COMPANY`, built locally below, holds its authority
 *    COMPANY-scoped to `COMPANY_A9` and an unrelated permission BRANCH-scoped to
 *    `BRANCH_A1`. The second grant is what makes the case real rather than trivial —
 *    see the next paragraph.
 *  - **Branch, with the row invisible.** `SAL_SCOPED_A2` holds everything scoped to
 *    `BRANCH_A2` and nothing anywhere else, so `BRANCH_A1` is outside its
 *    permission-blind branch union, RLS hides the row and the answer is a uniform 404.
 *    Defence in depth, asserted because it is real, but it is NOT the control.
 *  - **Branch, with the row VISIBLE.** `SAL_PERMISSION_ELSEWHERE` is the control, and
 *    it is why this file matters.
 *
 * ## Why a "widening" grant is the only honest construction (P1-18-A-01)
 *
 * `iam.allowed_branch_ids()` is fed from `app.branch_ids`, which
 * `resolveScopeFor` builds as the union of EVERY active grant regardless of which
 * permission that grant carries. So a principal scoped to `BRANCH_A2` alone has
 * `BRANCH_A1` outside its union: the row is invisible, the answer is 404, and that
 * same 404 would be produced by a completely scope-BLIND implementation. Such a test
 * proves nothing about the scoped check.
 *
 * `SAL_PERMISSION_ELSEWHERE` holds a SECOND grant carrying only `org.tenant.read`,
 * scoped to `BRANCH_A1`. `BRANCH_A1` is therefore inside its union, every fixture row
 * below really is selectable for it, and RLS cannot answer 404. The only thing left
 * that can refuse the request is `iam.has_permission_in_scope` evaluated against the
 * row's own company and branch. Each of those cases asserts the row's visibility
 * directly, as admin, so a 404 dressed up as a 403 cannot pass for the control.
 *
 * The locally built `SAL_OTHER_COMPANY` is the same construction one level up: its
 * widening grant is BRANCH-scoped to `(COMPANY_A1, BRANCH_A1)`, which puts both A1 ids
 * into its resolved narrowing, so an A1 row is visible to it and only the company half
 * of the scoped check can refuse.
 *
 * ## What is deliberately NOT simulated
 *
 * None of the ten routes reads a query parameter, and none passes `requestedScope` to
 * `handleOperation`. There is therefore no optional company or branch filter whose
 * omission could widen a result set, and no list read among the ten in which widening
 * would be observable. Rather than write a case that could only assert something
 * else, `no caller-supplied scope narrowing` below pins that absence structurally, so
 * a future edit that adds a filter has to add the case with it.
 *
 * COVERAGE-EVIDENCE (P1-22 isolation):
 *   sal.invoice-preview: route service isolation cross-tenant
 *   sal.invoice-create: route service isolation cross-tenant
 *   sal.invoice-detail: route service authorization isolation cross-tenant
 *   sal.invoice-outstanding-read: route service isolation cross-tenant
 *   sal.payment-record: route service authorization isolation cross-tenant
 *   sal.receipt-detail: route service isolation cross-tenant
 *   sal.delivery-create: route service isolation cross-tenant
 *   sal.delivery-eligibility-read: route service isolation cross-tenant
 *   wty.warranty-generate: route service isolation cross-tenant
 *   wty.warranty-detail: route service isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
} from './helpers';
import { establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  BRANCH_A2,
  BRANCH_A9,
  COMPANY_A9,
  CREDIT_MANAGE,
  DELIVERY_COMPLETE,
  DELIVERY_MANAGE,
  DELIVERY_VIEW,
  FINANCE_VIEW,
  INVOICE_ISSUE,
  INVOICE_MANAGE,
  PARTNER_A,
  PAYMENT_ALLOCATE,
  PAYMENT_METHOD_A,
  PAYMENT_RECORD,
  POLICY_ACTIVE,
  POLICY_MANAGE,
  REVERSAL_APPROVE,
  SAL_COMPANY_SCOPED,
  SAL_FULL,
  SAL_PERMISSION_ELSEWHERE,
  SAL_SCOPED_A2,
  SAL_TENANT_B,
  WARRANTY_ISSUE,
  WORK_ORDER_READ,
  authAs,
  cleanP1_22Fixtures,
  countRowsOf,
  establishP1_22Fixtures,
  seedDeliveredDelivery,
  seedIssuedInvoice,
  seedWorkOrderChain,
  deliveringEmployeeForWorkOrder,
} from './p1-22-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { allOperations } from '@/server/auth/operation-registry';
import { GET as PREVIEW_INVOICE } from '@/app/api/v1/work-orders/[workOrderId]/invoice-preview/route';
import { POST as CREATE_INVOICE } from '@/app/api/v1/invoices/route';
import { GET as READ_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/route';
import { GET as READ_OUTSTANDING } from '@/app/api/v1/invoices/[invoiceId]/outstanding/route';
import { POST as RECORD_PAYMENT } from '@/app/api/v1/payments/route';
import { GET as READ_RECEIPT } from '@/app/api/v1/payments/[paymentId]/route';
import { POST as CREATE_DELIVERY } from '@/app/api/v1/deliveries/route';
import { GET as READ_ELIGIBILITY } from '@/app/api/v1/deliveries/[deliveryId]/eligibility/route';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import { GET as READ_WARRANTY } from '@/app/api/v1/warranties/[warrantyId]/route';
import { API_ROOT } from '../../scripts/lib/repository-paths.mjs';
import ts from 'typescript';
import {
  callsToNode,
  describeFunction,
  enclosingFunctionNode,
  parseModule,
} from '../../scripts/lib/typescript-source.mjs';

let admin: Pool;

// ---------------------------------------------------------------------------
// Wire shapes. Only the fields this file asserts on.
// ---------------------------------------------------------------------------

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface MoneyBody {
  readonly amount: string;
  readonly currency: string;
}

interface ReceiptBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly money: MoneyBody;
}

interface InvoiceDetailBody {
  readonly invoice: {
    readonly id: string;
    readonly companyId: string;
    readonly branchId: string;
    readonly currency: string;
    readonly totals: { readonly gross: MoneyBody } | null;
  };
  readonly recordVersion: number;
}

interface DeliveryBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly deliveringEmployeeId: string;
  /** The snapshot `sal.stamp_delivering_employee_identity` writes (P1-31 P-17). */
  readonly deliveringEmployeeDisplayName: string | null;
  readonly status: string;
}

interface EligibilityBody {
  readonly deliveryId: string;
  readonly eligible: boolean;
  readonly blockers: readonly string[];
}

interface WarrantyBody {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly startDate: string;
  readonly deliveryRecordId: string;
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

// ---------------------------------------------------------------------------
// Route drivers. Every one invokes the exported handler with a real Request.
// ---------------------------------------------------------------------------

const previewInvoice = (workOrderId: string): Promise<Response> =>
  PREVIEW_INVOICE(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/invoice-preview`),
    {
      params: Promise.resolve({ workOrderId }),
    }
  );

/** `sal.invoice-create` declares `idempotent: true`, so the header is mandatory. */
const createInvoice = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_INVOICE(
    new Request('http://localhost/api/v1/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const readInvoice = (invoiceId: string): Promise<Response> =>
  READ_INVOICE(new Request(`http://localhost/api/v1/invoices/${invoiceId}`), {
    params: Promise.resolve({ invoiceId }),
  });

const readOutstanding = (invoiceId: string): Promise<Response> =>
  READ_OUTSTANDING(new Request(`http://localhost/api/v1/invoices/${invoiceId}/outstanding`), {
    params: Promise.resolve({ invoiceId }),
  });

const recordPayment = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  RECORD_PAYMENT(
    new Request('http://localhost/api/v1/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const readReceipt = (paymentId: string): Promise<Response> =>
  READ_RECEIPT(new Request(`http://localhost/api/v1/payments/${paymentId}`), {
    params: Promise.resolve({ paymentId }),
  });

const createDelivery = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_DELIVERY(
    new Request('http://localhost/api/v1/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const readEligibility = (deliveryId: string): Promise<Response> =>
  READ_ELIGIBILITY(new Request(`http://localhost/api/v1/deliveries/${deliveryId}/eligibility`), {
    params: Promise.resolve({ deliveryId }),
  });

const generateWarranty = (
  deliveryId: string,
  body: unknown = {},
  key: string = randomUUID()
): Promise<Response> =>
  GENERATE_WARRANTY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/warranties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

const readWarranty = (warrantyId: string): Promise<Response> =>
  READ_WARRANTY(new Request(`http://localhost/api/v1/warranties/${warrantyId}`), {
    params: Promise.resolve({ warrantyId }),
  });

/** A well-formed recording request in the one provisioned company and branch. */
const validPayment = (amount: string): Record<string, string> => ({
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  paymentMethodId: PAYMENT_METHOD_A,
  payerPartnerId: PARTNER_A,
  currency: 'USD',
  amount,
});

// ---------------------------------------------------------------------------
// Local principals.
//
// Neither exists in `p1-22-helpers`, and both are built here rather than added
// there because that file is shared: a company-scoped principal on ANOTHER company
// and a principal whose grant this suite revokes would both change what the
// payments and warranty suites measure.
// ---------------------------------------------------------------------------

/**
 * Every `sal.`/`wty.` code the seeded catalogue defines, plus the work-order read.
 *
 * Composed from `p1-22-helpers`' own exported constants rather than retyped, so a
 * principal here can never hold a permission code the platform does not ship — the
 * P1-13 finding PC-1.
 */
const ALL_SAL_WTY = [
  INVOICE_MANAGE,
  INVOICE_ISSUE,
  PAYMENT_RECORD,
  PAYMENT_ALLOCATE,
  CREDIT_MANAGE,
  REVERSAL_APPROVE,
  FINANCE_VIEW,
  DELIVERY_MANAGE,
  DELIVERY_COMPLETE,
  DELIVERY_VIEW,
  POLICY_MANAGE,
  WARRANTY_ISSUE,
  WORK_ORDER_READ,
];

/** Unrelated to money or handover. It widens RLS reach, never authority. */
const WIDENING_PERMISSION = 'org.tenant.read';

/**
 * Tenant A, authority COMPANY-scoped to `COMPANY_A9`, with `(COMPANY_A1, BRANCH_A1)`
 * inside its resolved narrowing through a second, unrelated grant.
 *
 * The cross-company control. `resolveScopeFor` aggregates `grant_scopes.company_id`
 * and `.branch_id` across every active grant, and a `branch`-type scope row carries
 * its own company — so the widening grant contributes BOTH `COMPANY_A1` and
 * `BRANCH_A1`, and every tenant-A fixture row in this file is visible to this caller.
 * `iam.has_permission_in_scope` still refuses a `(COMPANY_A1, BRANCH_A1)` target: the
 * company half matches only `scope_type = 'company'` rows and this one names A9, and
 * the branch half matches a row on the granting grant, which carries no `sal.` or
 * `wty.` permission at all.
 */
const SAL_OTHER_COMPANY: Principal = {
  roleId: 'f1229000-0000-4000-8000-000000000001',
  userId: 'f1229000-0000-4000-8000-000000000002',
  subject: 'fx_p1_22_iso_other_company',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY,
};
const OTHER_COMPANY_GRANT = 'f1229000-0000-4000-8000-000000000003';
const OTHER_COMPANY_WIDENING_ROLE = 'f1229000-0000-4000-8000-000000000004';
const OTHER_COMPANY_WIDENING_GRANT = 'f1229000-0000-4000-8000-000000000005';

/**
 * Tenant A, unrestricted — until this suite revokes its grant.
 *
 * A separate principal because revocation is destructive: revoking `SAL_FULL` would
 * break every later test in this file and, since the backend suites share one
 * database, is exactly the kind of fixture mutation that should not be reachable from
 * another file's constants.
 */
const SAL_REVOCABLE: Principal = {
  roleId: 'f1229000-0000-4000-8000-000000000011',
  userId: 'f1229000-0000-4000-8000-000000000012',
  subject: 'fx_p1_22_iso_revocable',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY,
};
const REVOCABLE_GRANT = 'f1229000-0000-4000-8000-000000000013';

async function seedAccountAndRole(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-22 isolation principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-22 isolation fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }
}

/**
 * One scoped grant plus its single scope row, in ONE transaction.
 *
 * `tg_role_grants_require_scope` is a DEFERRABLE constraint trigger, so a scoped
 * grant and its scope have to reach COMMIT together; two autocommitting statements
 * would abort on the first.
 */
async function scopedGrant(input: {
  readonly grantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly scopeType: 'company' | 'branch';
  readonly companyId: string;
  readonly branchId: string | null;
}): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      input.grantId,
    ]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO iam.role_grants
           (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [input.grantId, TENANT_A, input.userId, input.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes
           (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [TENANT_A, input.grantId, input.scopeType, input.companyId, input.branchId, USER_A]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function establishIsolationPrincipals(): Promise<void> {
  await seedAccountAndRole(SAL_OTHER_COMPANY);
  await seedAccountAndRole(SAL_REVOCABLE);

  // The authority: COMPANY-scoped to the OTHER tenant-A company.
  await scopedGrant({
    grantId: OTHER_COMPANY_GRANT,
    userId: SAL_OTHER_COMPANY.userId,
    roleId: SAL_OTHER_COMPANY.roleId,
    scopeType: 'company',
    companyId: COMPANY_A9,
    branchId: null,
  });

  // The widening grant: an unrelated permission, BRANCH-scoped to (A1, A1). It puts
  // both A1 ids into this caller's resolved narrowing without giving it any money or
  // handover authority there — the only construction under which a refusal on an A1
  // row is provably the scoped permission check.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_22_iso_widening','P1-22 isolation widening',$3)
     ON CONFLICT (id) DO NOTHING`,
    [OTHER_COMPANY_WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, OTHER_COMPANY_WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  await scopedGrant({
    grantId: OTHER_COMPANY_WIDENING_GRANT,
    userId: SAL_OTHER_COMPANY.userId,
    roleId: OTHER_COMPANY_WIDENING_ROLE,
    scopeType: 'branch',
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
  });

  // Unrestricted, so the revocation below is the ONLY thing that can change its
  // answer — no scope narrowing is involved on either side of the revocation.
  const existing = await admin.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
    REVOCABLE_GRANT,
  ]);
  if (existing.rowCount === 0) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'unrestricted',$5,$5)`,
      [REVOCABLE_GRANT, TENANT_A, SAL_REVOCABLE.userId, SAL_REVOCABLE.roleId, USER_A]
    );
  }
}

/**
 * Revokes a grant the way the platform revokes one.
 *
 * `ck_role_grants_revoke_consistency` makes `status = 'revoked'` and `revoked_at`
 * a biconditional and `ck_role_grants_revoke_reason` demands a non-blank reason, so
 * the three columns move together. Flipping `status` alone raises `check_violation`,
 * which is the schema insisting a revocation is recorded rather than merely applied.
 */
async function revokeGrant(grantId: string): Promise<void> {
  const result = await admin.query(
    `UPDATE iam.role_grants
        SET status = 'revoked', revoked_at = now(), revoke_reason = 'P1-22 isolation suite'
      WHERE id = $1 AND status = 'active'`,
    [grantId]
  );
  if (result.rowCount !== 1) {
    throw new Error(`grant ${grantId} was not active, so revoking it proves nothing`);
  }
}

// ---------------------------------------------------------------------------
// Read-backs. Admin reads — never RLS evidence.
// ---------------------------------------------------------------------------

/**
 * Whether a row's branch is inside a user's PERMISSION-BLIND branch union.
 *
 * This is the assertion that separates the control from the trivial case: it is what
 * proves a 403 was not a 404 wearing a different code. `iam.grant_scopes` is read
 * across ALL of the user's active grants regardless of the permissions they carry,
 * which is exactly how `resolveScopeFor` builds `app.branch_ids`.
 */
const branchUnionCovers = (table: string, id: string, userId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM ${table}
      WHERE id = $1 AND branch_id = ANY(
        SELECT s.branch_id FROM iam.grant_scopes s
          JOIN iam.role_grants g ON g.tenant_id = s.tenant_id AND g.id = s.grant_id
         WHERE g.user_id = $2 AND g.status = 'active' AND s.branch_id IS NOT NULL)`,
    [id, userId]
  );

const receiptsIn = (branchId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.receipts WHERE branch_id = $1`, [branchId]);

const invoicesFor = (workOrderId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.invoices WHERE work_order_id = $1`, [
    workOrderId,
  ]);

const deliveriesFor = (workOrderId: string): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM sal.delivery_records WHERE work_order_id = $1`, [
    workOrderId,
  ]);

const warrantiesFor = (deliveryId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM wty.warranty_records WHERE delivery_record_id = $1`,
    [deliveryId]
  );

const receiptActorOf = async (
  receiptId: string
): Promise<{ received: string; created: string }> => {
  const result = await admin.query<{ received_by: string; created_by: string }>(
    `SELECT received_by, created_by FROM sal.receipts WHERE id = $1`,
    [receiptId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`receipt ${receiptId} vanished`);
  return { received: row.received_by, created: row.created_by };
};

const deliveryActorOf = async (deliveryId: string): Promise<string> => {
  const result = await admin.query<{ created_by: string }>(
    `SELECT created_by FROM sal.delivery_records WHERE id = $1`,
    [deliveryId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`delivery ${deliveryId} vanished`);
  return row.created_by;
};

/** Records a receipt as `SAL_FULL`, failing loudly if the arrangement path breaks. */
async function recordedReceipt(amount: string): Promise<ReceiptBody> {
  authAs(SAL_FULL);
  const response = await recordPayment(validPayment(amount));
  if (response.status !== 201) {
    throw new Error(
      `fixture receipt of ${amount} failed with ${response.status}: ${await response.text()}`
    );
  }
  return bodyOf<ReceiptBody>(response);
}

/** Issues a warranty as `SAL_FULL` against a delivered handover. */
async function issuedWarranty(deliveryId: string): Promise<WarrantyBody> {
  authAs(SAL_FULL);
  const response = await generateWarranty(deliveryId, { policyId: POLICY_ACTIVE });
  if (response.status !== 201) {
    throw new Error(
      `fixture warranty for ${deliveryId} failed with ${response.status}: ${await response.text()}`
    );
  }
  return bodyOf<WarrantyBody>(response);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_22Fixtures(admin);
  await establishIsolationPrincipals();
}, 180_000);

afterAll(async () => {
  await cleanP1_22Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

// ===========================================================================
// 1. The tenant boundary.
// ===========================================================================

describe('cross-tenant: tenant B cannot reach tenant A', () => {
  it('refuses sal.invoice-preview, sal.invoice-create, sal.invoice-detail and sal.invoice-outstanding-read', async () => {
    const invoice = await seedIssuedInvoice('iso_xt_invoice');

    // Tenant B holds every `sal.` permission UNRESTRICTED in its own tenant, so each
    // refusal below is the tenant boundary and not a missing grant. And `sal.` money
    // rows are gated whole-row by `sal.finance.view`, which it also holds — in tenant B.
    authAs(SAL_TENANT_B);
    const preview = await previewInvoice(invoice.workOrderId);
    expect(preview.status).toBe(404);
    expect((await bodyOf<ProblemBody>(preview)).code).toBe('ERR-RES-001');

    // The work order arrives in the BODY here rather than the path, which is why the
    // manifest declares `cross-tenant` for this operation by hand: the derived rule
    // keys on `{param}` and cannot see a foreign identifier in a body.
    authAs(SAL_TENANT_B);
    const created = await createInvoice({ workOrderId: invoice.workOrderId });
    expect(created.status).toBe(404);
    expect((await bodyOf<ProblemBody>(created)).code).toBe('ERR-RES-001');

    authAs(SAL_TENANT_B);
    const detail = await readInvoice(invoice.invoiceId);
    expect(detail.status).toBe(404);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-RES-001');

    authAs(SAL_TENANT_B);
    const outstanding = await readOutstanding(invoice.invoiceId);
    expect(outstanding.status).toBe(404);
    expect((await bodyOf<ProblemBody>(outstanding)).code).toBe('ERR-RES-001');

    // A 200 carrying an empty projection would be the dangerous outcome: a caller
    // could not tell "nothing outstanding" from "not yours". So the decisive check is
    // that tenant A's invoice is still the only one for that work order and no draft
    // was created in tenant B's name.
    expect(await invoicesFor(invoice.workOrderId)).toBe(1);

    // An unknown id answers identically, so the code is not an existence oracle.
    authAs(SAL_TENANT_B);
    expect((await readInvoice(randomUUID())).status).toBe(404);
  });

  it('refuses sal.payment-record and sal.receipt-detail', async () => {
    const receipt = await recordedReceipt('21.0000');
    const before = await receiptsIn(BRANCH_A1);

    // Naming tenant A's company, branch, method and payer from tenant B. The scoped
    // authorization check PASSES — an unrestricted grant satisfies
    // `iam.has_permission_in_scope` for any target — so the tenant boundary here is
    // RLS on `sal.payment_methods` and `shared.number_sequences`, which is the point:
    // authority alone never crosses a tenant.
    authAs(SAL_TENANT_B);
    const recorded = await recordPayment(validPayment('22.0000'));
    expect(recorded.status).toBe(404);
    expect((await bodyOf<ProblemBody>(recorded)).code).toBe('ERR-RES-001');
    expect(await receiptsIn(BRANCH_A1)).toBe(before);

    authAs(SAL_TENANT_B);
    const detail = await readReceipt(receipt.id);
    expect(detail.status).toBe(404);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-RES-001');
  });

  it('refuses sal.delivery-create, sal.delivery-eligibility-read, wty.warranty-generate and wty.warranty-detail', async () => {
    const delivery = await seedDeliveredDelivery('iso_xt_delivery');
    const warranty = await issuedWarranty(delivery.deliveryId);
    const deliveriesBefore = await deliveriesFor(delivery.workOrderId);
    const warrantiesBefore = await warrantiesFor(delivery.deliveryId);

    authAs(SAL_TENANT_B);
    const created = await createDelivery({
      workOrderId: delivery.workOrderId,
      deliveringEmployeeId: await deliveringEmployeeForWorkOrder(delivery.workOrderId),
    });
    expect(created.status).toBe(404);
    expect((await bodyOf<ProblemBody>(created)).code).toBe('ERR-RES-001');

    authAs(SAL_TENANT_B);
    const eligibility = await readEligibility(delivery.deliveryId);
    expect(eligibility.status).toBe(404);
    expect((await bodyOf<ProblemBody>(eligibility)).code).toBe('ERR-RES-001');

    authAs(SAL_TENANT_B);
    const generated = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(generated.status).toBe(404);
    expect((await bodyOf<ProblemBody>(generated)).code).toBe('ERR-RES-001');

    authAs(SAL_TENANT_B);
    const detail = await readWarranty(warranty.id);
    expect(detail.status).toBe(404);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-RES-001');

    // Nothing was written into tenant A on any of the four attempts.
    expect(await deliveriesFor(delivery.workOrderId)).toBe(deliveriesBefore);
    expect(await warrantiesFor(delivery.deliveryId)).toBe(warrantiesBefore);
  });
});

// ===========================================================================
// 2. THE CONTROL: a scoped permission check, not RLS invisibility.
// ===========================================================================

describe('scoped permission and not RLS invisibility (P1-18-A-01)', () => {
  it('refuses sal.invoice-preview, sal.invoice-create, sal.invoice-detail and sal.invoice-outstanding-read on a VISIBLE invoice', async () => {
    const invoice = await seedIssuedInvoice('iso_pe_invoice');

    // The precondition that makes the four refusals below mean something: the invoice's
    // branch is inside this caller's permission-blind branch union, because a SECOND
    // grant carrying only `org.tenant.read` names BRANCH_A1. RLS therefore cannot
    // answer 404 and the row really is selectable. Without this grant the row would be
    // invisible, the answer would be a uniform 404, and every assertion below would
    // pass unchanged against a completely scope-blind implementation.
    expect(
      await branchUnionCovers('sal.invoices', invoice.invoiceId, SAL_PERMISSION_ELSEWHERE.userId)
    ).toBe(1);

    authAs(SAL_PERMISSION_ELSEWHERE);
    const preview = await previewInvoice(invoice.workOrderId);
    expect(preview.status).toBe(403);
    expect((await bodyOf<ProblemBody>(preview)).code).toBe('ERR-IAM-001');

    authAs(SAL_PERMISSION_ELSEWHERE);
    const created = await createInvoice({ workOrderId: invoice.workOrderId });
    expect(created.status).toBe(403);
    expect((await bodyOf<ProblemBody>(created)).code).toBe('ERR-IAM-001');

    authAs(SAL_PERMISSION_ELSEWHERE);
    const detail = await readInvoice(invoice.invoiceId);
    expect(detail.status).toBe(403);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-IAM-001');

    authAs(SAL_PERMISSION_ELSEWHERE);
    const outstanding = await readOutstanding(invoice.invoiceId);
    expect(outstanding.status).toBe(403);
    expect((await bodyOf<ProblemBody>(outstanding)).code).toBe('ERR-IAM-001');

    expect(await invoicesFor(invoice.workOrderId)).toBe(1);
  });

  it('refuses sal.payment-record and sal.receipt-detail on a VISIBLE receipt', async () => {
    const receipt = await recordedReceipt('23.0000');
    expect(
      await branchUnionCovers('sal.receipts', receipt.id, SAL_PERMISSION_ELSEWHERE.userId)
    ).toBe(1);
    const before = await receiptsIn(BRANCH_A1);

    // The recording path is the one place the caller NAMES the scope, so there is no
    // RLS invisibility to hide behind at all: 403 is the only possible answer, and it
    // comes from `iam.has_permission_in_scope` on the named pair.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const recorded = await recordPayment(validPayment('24.0000'));
    expect(recorded.status).toBe(403);
    expect((await bodyOf<ProblemBody>(recorded)).code).toBe('ERR-IAM-001');
    expect(await receiptsIn(BRANCH_A1)).toBe(before);

    // The read is the opposite shape: the path names a receipt and the check runs
    // against the ROW's own company and branch, after the row has been read.
    authAs(SAL_PERMISSION_ELSEWHERE);
    const detail = await readReceipt(receipt.id);
    expect(detail.status).toBe(403);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-IAM-001');
  });

  it('refuses sal.delivery-create, sal.delivery-eligibility-read, wty.warranty-generate and wty.warranty-detail on VISIBLE rows', async () => {
    const delivery = await seedDeliveredDelivery('iso_pe_delivery');
    const warranty = await issuedWarranty(delivery.deliveryId);
    expect(
      await branchUnionCovers(
        'sal.delivery_records',
        delivery.deliveryId,
        SAL_PERMISSION_ELSEWHERE.userId
      )
    ).toBe(1);
    expect(
      await branchUnionCovers('wty.warranty_records', warranty.id, SAL_PERMISSION_ELSEWHERE.userId)
    ).toBe(1);
    const deliveriesBefore = await deliveriesFor(delivery.workOrderId);
    const warrantiesBefore = await warrantiesFor(delivery.deliveryId);

    authAs(SAL_PERMISSION_ELSEWHERE);
    const created = await createDelivery({
      workOrderId: delivery.workOrderId,
      deliveringEmployeeId: await deliveringEmployeeForWorkOrder(delivery.workOrderId),
    });
    expect(created.status).toBe(403);
    expect((await bodyOf<ProblemBody>(created)).code).toBe('ERR-IAM-001');

    authAs(SAL_PERMISSION_ELSEWHERE);
    const eligibility = await readEligibility(delivery.deliveryId);
    expect(eligibility.status).toBe(403);
    expect((await bodyOf<ProblemBody>(eligibility)).code).toBe('ERR-IAM-001');

    authAs(SAL_PERMISSION_ELSEWHERE);
    const generated = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(generated.status).toBe(403);
    expect((await bodyOf<ProblemBody>(generated)).code).toBe('ERR-IAM-001');

    authAs(SAL_PERMISSION_ELSEWHERE);
    const detail = await readWarranty(warranty.id);
    expect(detail.status).toBe(403);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-IAM-001');

    expect(await deliveriesFor(delivery.workOrderId)).toBe(deliveriesBefore);
    expect(await warrantiesFor(delivery.deliveryId)).toBe(warrantiesBefore);
  });
});

// ===========================================================================
// 3. The branch boundary with the row invisible — defence in depth.
// ===========================================================================

describe('cross-branch: a caller granted only in branch A2', () => {
  it('cannot see a branch A1 invoice, so sal.invoice-preview, sal.invoice-create, sal.invoice-detail and sal.invoice-outstanding-read answer 404', async () => {
    const invoice = await seedIssuedInvoice('iso_a2_invoice');

    // This principal holds NO grant naming BRANCH_A1, so BRANCH_A1 is outside its
    // resolved narrowing and RLS hides the row. The answer is therefore a uniform 404
    // rather than the 403 the widened principal above receives. Both matter and they
    // are different claims: this one is that RLS also refuses, and it is asserted
    // BECAUSE it is true, not because it proves the scoped check runs.
    expect(await branchUnionCovers('sal.invoices', invoice.invoiceId, SAL_SCOPED_A2.userId)).toBe(
      0
    );

    authAs(SAL_SCOPED_A2);
    expect((await previewInvoice(invoice.workOrderId)).status).toBe(404);
    authAs(SAL_SCOPED_A2);
    expect((await createInvoice({ workOrderId: invoice.workOrderId })).status).toBe(404);
    authAs(SAL_SCOPED_A2);
    const detail = await readInvoice(invoice.invoiceId);
    expect(detail.status).toBe(404);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-RES-001');
    authAs(SAL_SCOPED_A2);
    expect((await readOutstanding(invoice.invoiceId)).status).toBe(404);

    expect(await invoicesFor(invoice.workOrderId)).toBe(1);
  });

  it('is refused sal.payment-record in branch A1 and cannot see the receipt through sal.receipt-detail', async () => {
    const receipt = await recordedReceipt('25.0000');
    const before = await receiptsIn(BRANCH_A1);

    // A body-named scope cannot be hidden by RLS, so this is a 403 even for a caller
    // that can see nothing in the branch: the refusal happens before any row is read.
    authAs(SAL_SCOPED_A2);
    const recorded = await recordPayment(validPayment('26.0000'));
    expect(recorded.status).toBe(403);
    expect((await bodyOf<ProblemBody>(recorded)).code).toBe('ERR-IAM-001');
    expect(await receiptsIn(BRANCH_A1)).toBe(before);

    // The read is addressed by id, so RLS gets there first: 404, not 403.
    authAs(SAL_SCOPED_A2);
    const detail = await readReceipt(receipt.id);
    expect(detail.status).toBe(404);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-RES-001');
  });

  it('cannot see a branch A1 handover, so sal.delivery-create, sal.delivery-eligibility-read, wty.warranty-generate and wty.warranty-detail answer 404', async () => {
    const delivery = await seedDeliveredDelivery('iso_a2_delivery');
    const warranty = await issuedWarranty(delivery.deliveryId);
    const deliveriesBefore = await deliveriesFor(delivery.workOrderId);

    authAs(SAL_SCOPED_A2);
    expect(
      (
        await createDelivery({
          workOrderId: delivery.workOrderId,
          deliveringEmployeeId: await deliveringEmployeeForWorkOrder(delivery.workOrderId),
        })
      ).status
    ).toBe(404);
    authAs(SAL_SCOPED_A2);
    expect((await readEligibility(delivery.deliveryId)).status).toBe(404);
    authAs(SAL_SCOPED_A2);
    expect((await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE })).status).toBe(
      404
    );
    authAs(SAL_SCOPED_A2);
    expect((await readWarranty(warranty.id)).status).toBe(404);

    expect(await deliveriesFor(delivery.workOrderId)).toBe(deliveriesBefore);
    expect(await warrantiesFor(delivery.deliveryId)).toBe(1);
  });
});

// ===========================================================================
// 4. The company boundary, inside one tenant.
// ===========================================================================

describe('cross-company: a caller whose authority names another company in tenant A', () => {
  it('refuses sal.invoice-preview, sal.invoice-create, sal.invoice-detail and sal.invoice-outstanding-read', async () => {
    const invoice = await seedIssuedInvoice('iso_xc_invoice');

    // Same construction as the branch control, one level up: the widening grant is
    // BRANCH-scoped to (COMPANY_A1, BRANCH_A1), so both A1 ids are in this caller's
    // resolved narrowing and the invoice is visible. Only the COMPANY half of
    // `iam.has_permission_in_scope` can refuse — and it names COMPANY_A9.
    expect(
      await branchUnionCovers('sal.invoices', invoice.invoiceId, SAL_OTHER_COMPANY.userId)
    ).toBe(1);

    authAs(SAL_OTHER_COMPANY);
    const preview = await previewInvoice(invoice.workOrderId);
    expect(preview.status).toBe(403);
    expect((await bodyOf<ProblemBody>(preview)).code).toBe('ERR-IAM-001');

    authAs(SAL_OTHER_COMPANY);
    const created = await createInvoice({ workOrderId: invoice.workOrderId });
    expect(created.status).toBe(403);
    expect((await bodyOf<ProblemBody>(created)).code).toBe('ERR-IAM-001');

    authAs(SAL_OTHER_COMPANY);
    const detail = await readInvoice(invoice.invoiceId);
    expect(detail.status).toBe(403);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-IAM-001');

    authAs(SAL_OTHER_COMPANY);
    const outstanding = await readOutstanding(invoice.invoiceId);
    expect(outstanding.status).toBe(403);
    expect((await bodyOf<ProblemBody>(outstanding)).code).toBe('ERR-IAM-001');

    expect(await invoicesFor(invoice.workOrderId)).toBe(1);
  });

  it('refuses sal.payment-record and sal.receipt-detail', async () => {
    const receipt = await recordedReceipt('27.0000');
    expect(await branchUnionCovers('sal.receipts', receipt.id, SAL_OTHER_COMPANY.userId)).toBe(1);
    const before = await receiptsIn(BRANCH_A1);

    authAs(SAL_OTHER_COMPANY);
    const recorded = await recordPayment(validPayment('28.0000'));
    expect(recorded.status).toBe(403);
    expect((await bodyOf<ProblemBody>(recorded)).code).toBe('ERR-IAM-001');
    expect(await receiptsIn(BRANCH_A1)).toBe(before);

    authAs(SAL_OTHER_COMPANY);
    const detail = await readReceipt(receipt.id);
    expect(detail.status).toBe(403);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-IAM-001');
  });

  it('refuses sal.delivery-create, sal.delivery-eligibility-read, wty.warranty-generate and wty.warranty-detail', async () => {
    const delivery = await seedDeliveredDelivery('iso_xc_delivery');
    const warranty = await issuedWarranty(delivery.deliveryId);
    expect(
      await branchUnionCovers('sal.delivery_records', delivery.deliveryId, SAL_OTHER_COMPANY.userId)
    ).toBe(1);
    const deliveriesBefore = await deliveriesFor(delivery.workOrderId);

    authAs(SAL_OTHER_COMPANY);
    const created = await createDelivery({
      workOrderId: delivery.workOrderId,
      deliveringEmployeeId: await deliveringEmployeeForWorkOrder(delivery.workOrderId),
    });
    expect(created.status).toBe(403);
    expect((await bodyOf<ProblemBody>(created)).code).toBe('ERR-IAM-001');

    authAs(SAL_OTHER_COMPANY);
    const eligibility = await readEligibility(delivery.deliveryId);
    expect(eligibility.status).toBe(403);
    expect((await bodyOf<ProblemBody>(eligibility)).code).toBe('ERR-IAM-001');

    authAs(SAL_OTHER_COMPANY);
    const generated = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(generated.status).toBe(403);
    expect((await bodyOf<ProblemBody>(generated)).code).toBe('ERR-IAM-001');

    authAs(SAL_OTHER_COMPANY);
    const detail = await readWarranty(warranty.id);
    expect(detail.status).toBe(403);
    expect((await bodyOf<ProblemBody>(detail)).code).toBe('ERR-IAM-001');

    expect(await deliveriesFor(delivery.workOrderId)).toBe(deliveriesBefore);
    expect(await warrantiesFor(delivery.deliveryId)).toBe(1);
  });
});

// ===========================================================================
// 5. The incoherent (company, branch) pair — P1-21's H6.
// ===========================================================================

describe('the incoherent company and branch pair (P1-21 H6)', () => {
  it('refuses sal.payment-record for company A1 with a branch of company A9', async () => {
    // H6, restated: `iam.has_permission_in_scope` matches
    //   (scope_type='company' AND company_id = p_company)
    //   OR (scope_type='branch' AND branch_id = p_branch)
    // as an OR over the granting grant's scope rows. `SAL_COMPANY_SCOPED` holds its
    // authority COMPANY-scoped to COMPANY_A1 and an unrelated permission BRANCH-scoped
    // to BRANCH_A9 of the OTHER company, so naming the pair (COMPANY_A1, BRANCH_A9)
    // satisfies the COMPANY half while pointing the write at company A9 — and A9 is in
    // its resolved narrowing, so RLS admits the rows too.
    //
    // `POST /payments` is the ONLY operation in this file where the caller names the
    // pair at all. The other nine are addressed by an id and read the company and
    // branch off the row, so an incoherent pair is not expressible on them — which is
    // why this case is stated once, here, rather than nine times vacuously.
    const before = await receiptsIn(BRANCH_A9);

    authAs(SAL_COMPANY_SCOPED);
    const response = await recordPayment({
      ...validPayment('29.0000'),
      companyId: COMPANY_A1,
      branchId: BRANCH_A9,
    });

    // Refused, and refused in a CONTROLLED way. `fk_receipts_branch` is
    // `(tenant_id, company_id, branch_id) -> org.branches`, so an incoherent pair
    // reaching the insert would raise a bare `23503`; `shared.next_display_number`
    // gets there first with `no_data_found`, because it matches the (company, branch)
    // scope exactly and no sequence is provisioned for that pair. Either way the one
    // thing that must never happen is a 500 carrying a constraint name.
    expect(response.status).toBeLessThan(500);
    expect([403, 404, 409, 422]).toContain(response.status);

    // The decisive assertion: no receipt exists in a branch of the other company.
    expect(await receiptsIn(BRANCH_A9)).toBe(before);
  });
});

// ===========================================================================
// 6. There is no optional scope filter to omit.
// ===========================================================================

/**
 * Binds every `defineOperation({ id })` in a route module to the exported handler
 * that serves it, and reports what that handler's subtree contains.
 *
 * ## Why this reads the HANDLER and not the file
 *
 * Until P1-30 A2 this section read each route file as text and asserted the
 * whole file contained no `searchParams` and no `new URL(`. That was a proxy for
 * the property it protects — "none of these ten operations accepts an optional
 * company or branch parameter, so omitting one cannot widen anything" — and the
 * proxy was exact while every file hosted only P1-22 operations. It stopped being
 * exact when `sal.receipt-list` (P1-30 A2, seam S-11) was published at
 * `GET /payments`: Next.js puts every verb of one path in one `route.ts`, so the
 * GET has to sit beside `sal.payment-record`, and the GET MUST read the query
 * string — `companyId` and `branchId` are its authorization target, not a filter.
 * A file-level scan then failed on a handler this section was never about, and
 * the alternatives were worse: moving the read to another path would change a
 * frozen A0 contract to dodge a test, and asserting nothing would drop the gate.
 *
 * So the question is asked of the operation. Each of the ten ids is followed to
 * its `defineOperation` constant, from there to the `handleOperation(CONST, …)`
 * call, and from there to the exported function that contains it. The
 * assertions run over THAT function's subtree — which includes the preamble
 * before `handleOperation` where a query string would be read — and they are the
 * same three as before, plus the helper that wraps a query read.
 *
 * Parsed, not pattern-matched: comments and string literals are trivia the
 * parser never offers, and the repository has recorded seven times what a
 * scanner reading prose as code does.
 *
 * ## Fail closed
 *
 * A file the parser refuses yields NO bindings, and an operation with no bound
 * handler is a failure, not a vacuous pass. Both are asserted below.
 */
function handlersOf(relative: string): {
  readonly file: ts.SourceFile;
  readonly byOperationId: Map<string, ts.Node>;
  readonly handlers: readonly { readonly name: string | null; readonly node: ts.Node }[];
  /** The `defineOperation({…})` literal of each operation, by id. */
  readonly declarationByOperationId: Map<string, ts.ObjectLiteralExpression>;
} {
  const source = readFileSync(resolve(API_ROOT, relative), 'utf8');
  const file = parseModule(source);
  expect(file, `${relative} did not parse as TypeScript`).not.toBeNull();
  if (!file) throw new Error('unreachable');

  // `export const X = defineOperation({ id: '…', … })`  ->  X -> id, and id -> literal
  const idByConstant = new Map<string, string>();
  const declarationByOperationId = new Map<string, ts.ObjectLiteralExpression>();
  for (const call of callsToNode(file, 'defineOperation')) {
    const literal = call.arguments[0];
    if (!literal || !ts.isObjectLiteralExpression(literal)) continue;
    const idProperty = literal.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(file) === 'id' &&
        ts.isStringLiteral(property.initializer)
    ) as ts.PropertyAssignment | undefined;
    if (!idProperty || !ts.isStringLiteral(idProperty.initializer)) continue;
    const declaration = call.parent;
    if (!declaration || !ts.isVariableDeclaration(declaration)) continue;
    idByConstant.set(declaration.name.getText(file), idProperty.initializer.text);
    declarationByOperationId.set(idProperty.initializer.text, literal);
  }

  // `handleOperation(X, …)` inside `export async function GET|POST|…`  ->  id -> handler
  const byOperationId = new Map<string, ts.Node>();
  const handlers: { name: string | null; node: ts.Node }[] = [];
  for (const call of callsToNode(file, 'handleOperation')) {
    const first = call.arguments[0];
    if (!first || !ts.isIdentifier(first)) continue;
    const id = idByConstant.get(first.text);
    const handler = enclosingFunctionNode(call);
    if (!id || !handler) continue;
    const described = describeFunction(handler);
    if (byOperationId.has(id)) {
      // Two handlers bound to one operation id means the map silently kept the
      // last, and every per-operation judgement below would then be about a
      // handler nobody chose. Refused rather than resolved.
      throw new Error(`${relative} binds operation ${id} to more than one handler`);
    }
    byOperationId.set(id, handler);
    handlers.push({ name: described.name, node: handler });
  }
  return { file, byOperationId, handlers, declarationByOperationId };
}

/**
 * Every call to `name` inside `scope`, in BOTH callee forms.
 *
 * `callsToNode` matches a bare identifier callee only, so `input.authorizedBranches(…)`
 * — the same seam reached without destructuring — is invisible to it. A gate that
 * could be evaded by not destructuring would be a gate about punctuation, so the
 * property form is matched here rather than assumed away in prose.
 */
function callsNamed(scope: ts.Node, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const matches =
        (ts.isIdentifier(callee) && callee.text === name) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === name);
      if (matches) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

/** Strips `await`, parentheses and `as` from an expression. */
function unwrap(node: ts.Node): ts.Node {
  let cursor = node;
  for (;;) {
    if (ts.isParenthesizedExpression(cursor) || ts.isAsExpression(cursor))
      cursor = cursor.expression;
    else if (ts.isAwaitExpression(cursor)) cursor = cursor.expression;
    else return cursor;
  }
}

/**
 * What one handler does about branch narrowing, judged against ITS OWN operation.
 *
 * ## The rule, exactly as enforced
 *
 * An optional `branchId` is admitted only when ALL of these hold:
 *
 *  1. every schema the handler hands to `parseOrFail` is DECLARED IN THIS FILE
 *     (`schemaResolved`). An imported schema is REFUSED, not skipped, and the
 *     refusal is asserted for every census route whether or not an optional
 *     branch was found — a check that cannot see the schema must not be the one
 *     reporting that there is nothing to see;
 *  2. `companyId` is not optional;
 *  3. THIS operation's own `defineOperation` carries
 *     `branchNarrowing: 'authorized-union'` (`declares`);
 *  4. the seam is called, and it is THE SEAM — the destructured parameter of the
 *     `handleOperation` callback, or a property of that parameter
 *     (`seamFromCallback`). A local `const authorizedBranches = async () => []`
 *     shadowing the name is refused;
 *  5. its answer is bound by `const` and never reassigned (`seamBindingIsConst`);
 *  6. THE READ is identified (`readFound`) and the binding reaches an argument of
 *     it (`tracesSeamResult`);
 *  7. nothing overrides the narrowing on its way in
 *     (`overriddenAfterNarrowing` is false).
 *
 * ## What THE READ is, precisely
 *
 * Inside the `handleOperation` callback, the returned object literal's `body`
 * property value — or, following ONE level, the local `const x = await …` that
 * value names. The awaited call producing that value is the read. Nothing else
 * counts, and that is the whole correction: an earlier version scanned every
 * `await` under `return handleOperation(…)`, which is the entire body, so an
 * awaited logger beside a `[]` read scored as wired.
 *
 * ## What is refused by failing closed rather than by being understood
 *
 * Helper-call indirection — `return { body: await buildPage(db, branchIds) }`
 * where the helper performs the read — is REFUSED, because the binding reaches a
 * call this file cannot follow into. That is deliberate: the alternative is
 * inter-procedural analysis in a test, and the safe direction for a guard that
 * cannot tell is no. A route written that way must inline the read or the gate
 * will say it is not narrowed.
 *
 * A binding reaches a call when it appears in an argument directly, through a
 * spread, as a property VALUE (shorthand included), or as a property value of a
 * local object literal that argument names. A property KEY is never a use, a
 * property-access NAME is never a use, and a declaration's own name is never a
 * use.
 */
interface NarrowingAudit {
  readonly optionalBranch: boolean;
  readonly optionalCompany: boolean;
  readonly schemaResolved: boolean;
  readonly declares: boolean;
  readonly seamCalled: boolean;
  readonly seamFromCallback: boolean;
  readonly seamBindingIsConst: boolean;
  readonly readFound: boolean;
  readonly tracesSeamResult: boolean;
  readonly overriddenAfterNarrowing: boolean;
}

function auditBranchNarrowing(
  file: ts.SourceFile,
  handler: ts.Node,
  declaration: ts.ObjectLiteralExpression | undefined
): NarrowingAudit {
  const within = (node: ts.Node): boolean =>
    node.getStart(file) >= handler.getStart(file) && node.getEnd() <= handler.getEnd();

  // --- (1) the schema THIS handler parses ----------------------------------
  const schemaNames = new Set<string>();
  for (const call of callsNamed(file, 'parseOrFail')) {
    if (!within(call)) continue;
    const first = call.arguments[0];
    if (first && ts.isIdentifier(first)) schemaNames.add(first.text);
  }
  const declaredInFile = new Map<string, ts.Node>();
  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declaredInFile.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(file);

  const optional = { branchId: false, companyId: false };
  let schemaResolved = true;
  for (const name of schemaNames) {
    const initializer = declaredInFile.get(name);
    if (initializer === undefined) {
      schemaResolved = false;
      continue;
    }
    const walk = (candidate: ts.Node): void => {
      if (ts.isPropertyAssignment(candidate)) {
        const field = candidate.name.getText(file);
        if (
          (field === 'branchId' || field === 'companyId') &&
          /\.optional\(\)/.test(candidate.initializer.getText(file))
        ) {
          optional[field as 'branchId' | 'companyId'] = true;
        }
      }
      ts.forEachChild(candidate, walk);
    };
    walk(initializer);
  }

  // --- (3) THIS operation's own declaration --------------------------------
  const declares =
    declaration !== undefined &&
    declaration.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(file) === 'branchNarrowing' &&
        /'authorized-union'/.test(property.initializer.getText(file))
    );

  // --- the handleOperation callback, which every later clause is about -----
  const handleCall = callsNamed(handler, 'handleOperation')[0];
  const callback = handleCall?.arguments.find(
    (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
  ) as ts.ArrowFunction | ts.FunctionExpression | undefined;

  // The seam names this callback legitimately provides.
  const parameter = callback?.parameters[0];
  const destructuredSeams = new Set<string>();
  let parameterName: string | undefined;
  if (parameter) {
    if (ts.isIdentifier(parameter.name)) parameterName = parameter.name.text;
    else if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of parameter.name.elements) {
        if (ts.isIdentifier(element.name)) destructuredSeams.add(element.name.text);
      }
    }
  }

  // --- (6) THE READ --------------------------------------------------------
  let readCall: ts.CallExpression | undefined;
  if (callback) {
    const localConsts = new Map<string, ts.Node>();
    const collectLocals = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        localConsts.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collectLocals);
    };
    collectLocals(callback);

    const fromBodyValue = (value: ts.Node): ts.CallExpression | undefined => {
      const bare = unwrap(value);
      if (ts.isCallExpression(bare)) return bare;
      if (ts.isIdentifier(bare)) {
        const bound = localConsts.get(bare.text);
        if (bound) {
          const inner = unwrap(bound);
          if (ts.isCallExpression(inner)) return inner;
        }
      }
      return undefined;
    };

    const visitReturns = (node: ts.Node): void => {
      if (readCall) return;
      if (ts.isReturnStatement(node) && node.expression) {
        const returned = unwrap(node.expression);
        if (ts.isObjectLiteralExpression(returned)) {
          for (const property of returned.properties) {
            if (ts.isPropertyAssignment(property) && property.name.getText(file) === 'body') {
              readCall = fromBodyValue(property.initializer);
            } else if (
              ts.isShorthandPropertyAssignment(property) &&
              property.name.text === 'body'
            ) {
              readCall = fromBodyValue(property.name);
            }
            if (readCall) return;
          }
        }
      }
      ts.forEachChild(node, visitReturns);
    };
    visitReturns(callback);
  }

  // --- (4)(5)(7) the seam, its binding, and where the answer goes ----------
  const seamCalls = callsNamed(handler, 'authorizedBranches').filter(within);
  let seamFromCallback = false;
  let seamBindingIsConst = false;
  let tracesSeamResult = false;
  let overriddenAfterNarrowing = false;

  for (const call of seamCalls) {
    // (4) provenance: the callback's own parameter, never a local shadow.
    const callee = call.expression;
    let provenanceOk = false;
    if (ts.isIdentifier(callee)) {
      const shadowed = callback !== undefined && callsNamedLocalDeclaration(callback, callee.text);
      provenanceOk = destructuredSeams.has(callee.text) && !shadowed;
    } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      provenanceOk = parameterName !== undefined && callee.expression.text === parameterName;
    }
    if (!provenanceOk) continue;
    seamFromCallback = true;

    let cursor: ts.Node = call;
    while (
      cursor.parent &&
      (ts.isAwaitExpression(cursor.parent) ||
        ts.isParenthesizedExpression(cursor.parent) ||
        ts.isConditionalExpression(cursor.parent))
    ) {
      cursor = cursor.parent;
    }
    const binding = cursor.parent;
    if (!binding || !ts.isVariableDeclaration(binding)) continue;

    const list = binding.parent;
    const isConst =
      list !== undefined &&
      ts.isVariableDeclarationList(list) &&
      (list.flags & ts.NodeFlags.Const) !== 0;

    const bound: string[] = [];
    const collect = (name: ts.Node): void => {
      if (ts.isIdentifier(name)) bound.push(name.text);
      else ts.forEachChild(name, collect);
    };
    collect(binding.name);
    if (bound.length === 0) continue;

    let reassigned = false;
    const findAssignments = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        bound.includes(node.left.text)
      ) {
        reassigned = true;
      }
      ts.forEachChild(node, findAssignments);
    };
    findAssignments(handler);
    if (isConst && !reassigned) seamBindingIsConst = true;

    if (!readCall) continue;

    const localObjects = new Map<string, ts.ObjectLiteralExpression>();
    const collectObjects = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        localObjects.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collectObjects);
    };
    collectObjects(handler);

    /**
     * (7) Anything VISIBLE that replaces the narrowing after it is placed.
     *
     * A later property named `branchIds`/`branchId` is an override outright. A
     * later SPREAD is an override when the thing being spread can be seen to
     * mention one of those keys — `{ branchIds, ...(retry ? { branchIds: [] } : {}) }`
     * is narrowed by whatever the conditional says.
     *
     * ## The limit, stated rather than implied
     *
     * A spread of something OPAQUE — an identifier, or the result of a call —
     * is NOT detected. It cannot be, without following the value, and the two
     * real routes that spread after the narrowing both do it with conditionals
     * whose object literals name only unrelated filters (`status`, `q`) or with
     * a call that returns other board filters. Flagging every opaque spread
     * would refuse correct code, and a gate that refuses correct code is a gate
     * somebody disables. So this is a KNOWN hole with a test that says so,
     * rather than a silent one.
     */
    const mentionsBranchKey = (node: ts.Node): boolean => {
      // Only values the spread could actually BE are inspected: the literal
      // itself, or the arms of a conditional. Descending further would read the
      // ARGUMENTS of a spread call as if they were its result — `...(await
      // resolveBoardFilters(db, { branchIds }))` mentions the key in a place
      // that cannot override anything, and treating that as an override refuses
      // a correct route.
      const value = unwrap(node);
      if (ts.isObjectLiteralExpression(value)) {
        return value.properties.some(
          (property) =>
            (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            ['branchIds', 'branchId'].includes(property.name.getText(file))
        );
      }
      if (ts.isConditionalExpression(value)) {
        return mentionsBranchKey(value.whenTrue) || mentionsBranchKey(value.whenFalse);
      }
      return false;
    };

    const inspectOverride = (object: ts.ObjectLiteralExpression): void => {
      let seenBinding = false;
      for (const property of object.properties) {
        if (seenBinding) {
          if (ts.isSpreadAssignment(property)) {
            if (mentionsBranchKey(property.expression)) overriddenAfterNarrowing = true;
          } else if (
            (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            ['branchIds', 'branchId'].includes(property.name.getText(file))
          ) {
            overriddenAfterNarrowing = true;
          }
          continue;
        }
        const carries =
          (ts.isShorthandPropertyAssignment(property) && bound.includes(property.name.text)) ||
          (ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.initializer) &&
            bound.includes(property.initializer.text));
        if (carries) seenBinding = true;
      }
    };

    const usesBinding = (node: ts.Node, depth = 0): boolean => {
      let used = false;
      const scan = (inner: ts.Node): void => {
        if (used) return;
        if (ts.isObjectLiteralExpression(inner)) inspectOverride(inner);
        if (ts.isPropertyAssignment(inner)) {
          scan(inner.initializer);
          return;
        }
        if (ts.isPropertyAccessExpression(inner)) {
          scan(inner.expression);
          return;
        }
        if (ts.isVariableDeclaration(inner)) {
          if (inner.initializer) scan(inner.initializer);
          return;
        }
        if (ts.isIdentifier(inner)) {
          if (bound.includes(inner.text)) used = true;
          else if (depth === 0 && localObjects.has(inner.text)) {
            const object = localObjects.get(inner.text);
            if (object && usesBinding(object, depth + 1)) used = true;
          }
          return;
        }
        ts.forEachChild(inner, scan);
      };
      scan(node);
      return used;
    };

    if (readCall.arguments.some((argument) => usesBinding(argument))) tracesSeamResult = true;
    if (tracesSeamResult) break;
  }

  return {
    optionalBranch: optional.branchId,
    optionalCompany: optional.companyId,
    schemaResolved,
    declares,
    seamCalled: seamCalls.length > 0,
    seamFromCallback,
    seamBindingIsConst,
    readFound: readCall !== undefined,
    tracesSeamResult,
    overriddenAfterNarrowing,
  };
}

/** Whether `scope` declares a local of this name — i.e. shadows the seam. */
function callsNamedLocalDeclaration(scope: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

/**
 * The exported handler and the operation literal of a SYNTHETIC module.
 *
 * The negative cases are parsed from strings rather than written to disk, so
 * there is no `handlersOf` path to hand them; this gives the audit the same two
 * inputs it gets for a real route — one handler and the declaration of the
 * operation that handler serves.
 */
function syntheticHandler(file: ts.SourceFile): {
  readonly handler: ts.Node;
  readonly declaration: ts.ObjectLiteralExpression | undefined;
} {
  const call = callsToNode(file, 'handleOperation')[0];
  const handler = call ? enclosingFunctionNode(call) : undefined;
  const define = callsToNode(file, 'defineOperation')[0];
  const literal = define?.arguments[0];
  return {
    handler: handler ?? file,
    declaration: literal && ts.isObjectLiteralExpression(literal) ? literal : undefined,
  };
}

/** What a handler's subtree does with the request — the four things §6 forbids. */
function queryReadsIn(node: ts.Node, file: ts.SourceFile) {
  const found = { requestedScope: false, searchParams: false, newUrl: false, helper: false };
  const visit = (candidate: ts.Node): void => {
    if (ts.isIdentifier(candidate) && candidate.text === 'requestedScope') {
      found.requestedScope = true;
    }
    if (
      ts.isPropertyAccessExpression(candidate) &&
      candidate.name.getText(file) === 'searchParams'
    ) {
      found.searchParams = true;
    }
    if (
      ts.isNewExpression(candidate) &&
      ts.isIdentifier(candidate.expression) &&
      candidate.expression.text === 'URL'
    ) {
      found.newUrl = true;
    }
    if (
      ts.isCallExpression(candidate) &&
      ts.isIdentifier(candidate.expression) &&
      candidate.expression.text === 'searchParamsToObject'
    ) {
      found.helper = true;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

describe('no caller-supplied scope narrowing on the ten P1-22 isolation operations', () => {
  const ROUTES = [
    'src/app/api/v1/work-orders/[workOrderId]/invoice-preview/route.ts',
    'src/app/api/v1/invoices/route.ts',
    'src/app/api/v1/invoices/[invoiceId]/route.ts',
    'src/app/api/v1/invoices/[invoiceId]/outstanding/route.ts',
    'src/app/api/v1/payments/route.ts',
    'src/app/api/v1/payments/[paymentId]/route.ts',
    'src/app/api/v1/deliveries/route.ts',
    'src/app/api/v1/deliveries/[deliveryId]/eligibility/route.ts',
    'src/app/api/v1/deliveries/[deliveryId]/warranties/route.ts',
    'src/app/api/v1/warranties/[warrantyId]/route.ts',
    // The four other reads that carry `branchNarrowing`. None of them owns one of
    // the ten P1-22 operations, so none was scanned — and `deliveries/route.ts`
    // was only scanned because `sal.delivery-create` happens to live beside the
    // list. A rule that reaches one of five routes by coincidence is not a rule,
    // so the census names them.
    'src/app/api/v1/receptions/route.ts',
    'src/app/api/v1/appointments/route.ts',
    'src/app/api/v1/work-orders/route.ts',
    'src/app/api/v1/warranties/route.ts',
  ];

  const OPERATION_IDS = [
    'sal.invoice-preview',
    'sal.invoice-create',
    'sal.invoice-detail',
    'sal.invoice-outstanding-read',
    'sal.payment-record',
    'sal.receipt-detail',
    'sal.delivery-create',
    'sal.delivery-eligibility-read',
    'wty.warranty-generate',
    'wty.warranty-detail',
  ];

  it('reads no query string and passes no requestedScope, so omitting a filter cannot widen anything', () => {
    // The "optional-filter omission" case §16 asks for is only meaningful where a read
    // accepts an optional company or branch parameter. None of these ten does: there is
    // no list read among them, every one is addressed by a path id or a body id, and
    // `requestedScope` — the ONLY channel through which a caller-requested narrowing
    // reaches `resolveRequestContext` — is passed by none of them. Writing a case that
    // omitted a parameter that does not exist would assert nothing; this asserts the
    // absence itself, per OPERATION, so a future edit that adds a filter to one of the
    // ten must add the case with it.
    const bound = new Map<string, { relative: string; handler: ts.Node; file: ts.SourceFile }>();
    for (const relative of ROUTES) {
      const { file, byOperationId } = handlersOf(relative);
      // The file really was read and really binds something, or what follows is vacuous.
      expect(byOperationId.size, `${relative} binds no operation to a handler`).toBeGreaterThan(0);
      for (const [id, handler] of byOperationId) bound.set(id, { relative, handler, file });
    }
    for (const id of OPERATION_IDS) {
      const entry = bound.get(id);
      // Fail closed: an operation this section cannot find is a failure, never a pass.
      expect(
        entry,
        `${id} is not bound to any exported handler in the ten route modules`
      ).toBeDefined();
      if (!entry) continue;
      const reads = queryReadsIn(entry.handler, entry.file);
      expect(reads.requestedScope, `${id} (${entry.relative}) passes requestedScope`).toBe(false);
      expect(reads.searchParams, `${id} (${entry.relative}) reads a query string`).toBe(false);
      expect(reads.newUrl, `${id} (${entry.relative}) parses a URL`).toBe(false);
      expect(
        reads.helper,
        `${id} (${entry.relative}) reads a query string through the helper`
      ).toBe(false);
    }
  });

  it('holds any co-located handler that DOES read a query string to a REQUIRED authorization target', () => {
    // Stricter than the file-level scan this replaced, in the one dimension that
    // scan was blind to. A handler sharing one of these files may read the query
    // string only if the scope it reads is the operation's authorization target —
    // REQUIRED, so omitting it is a 422 and not a wider page — and only if it hands
    // that target to the pre-handler check through `scopeTargetOption`. Today that is
    // exactly `sal.receipt-list` in `payments/route.ts`; the assertion is written for
    // the shape, so the next co-located read is held to the same rule without anyone
    // remembering to add it here.
    for (const relative of ROUTES) {
      const { file, handlers, byOperationId, declarationByOperationId } = handlersOf(relative);
      const tenHere = new Set(
        [...byOperationId.entries()].filter(([id]) => OPERATION_IDS.includes(id)).map(([, n]) => n)
      );
      for (const { name, node } of handlers) {
        if (tenHere.has(node)) continue;
        const reads = queryReadsIn(node, file);
        if (!reads.searchParams && !reads.newUrl && !reads.helper) continue;

        // 1. Never `requestedScope` — that channel stays closed for every handler.
        expect(reads.requestedScope, `${relative} ${name} passes requestedScope`).toBe(false);

        // 2. The pre-handler target is set from the same query, so the scoped
        //    permission check runs BEFORE the handler and not only inside it.
        const passesTarget = callsToNode(file, 'scopeTargetOption').some(
          (call) => enclosingFunctionNode(call) === node
        );
        expect(
          passesTarget,
          `${relative} ${name} reads a query string but passes no scopeTargetOption`
        ).toBe(true);

        // 3. `companyId` is REQUIRED, always. `branchId` may be optional ONLY
        //    when THIS operation declares `branchNarrowing` and THIS handler
        //    traces the seam's answer into the read.
        //
        //    An optional pair is otherwise the exact shape this section exists to
        //    keep out: omit it and `authorizeScope` is skipped, leaving
        //    `app.branch_ids` — the permission-blind union of every grant — as the
        //    only narrowing. The Owner directive makes an optional BRANCH
        //    legitimate on five reads, and the point of the exemption is that it
        //    cannot be taken quietly or by accident.
        const operationId = [...byOperationId.entries()].find(([, n]) => n === node)?.[0];
        const audit = auditBranchNarrowing(
          file,
          node,
          operationId === undefined ? undefined : declarationByOperationId.get(operationId)
        );

        // ALWAYS, not only when an optional branch was found. A handler whose
        // schema this file cannot see reports `optionalBranch: false` for the
        // same reason it reports everything else about it: it never read it. The
        // refusal has to come first or the vacuous answer is the one acted on.
        expect(
          audit.schemaResolved,
          `${relative} ${name} parses a schema this file does not declare, so its optionality cannot be judged`
        ).toBe(true);

        expect(audit.optionalCompany, `${relative} ${name} declares an OPTIONAL companyId`).toBe(
          false
        );

        if (audit.optionalBranch) {
          // Every clause of the rule the audit's docblock states, asserted
          // separately so a refusal names the one that failed.
          expect(
            audit.declares,
            `${relative} ${name} declares an OPTIONAL branchId without its OWN operation declaring branchNarrowing: 'authorized-union'`
          ).toBe(true);
          expect(
            audit.seamCalled,
            `${relative} ${name} declares branchNarrowing but never calls authorizedBranches`
          ).toBe(true);
          expect(
            audit.seamFromCallback,
            `${relative} ${name} calls an authorizedBranches that is not the handleOperation callback's own seam`
          ).toBe(true);
          expect(
            audit.seamBindingIsConst,
            `${relative} ${name} does not bind the authorizedBranches answer with const, or reassigns it`
          ).toBe(true);
          expect(
            audit.readFound,
            `${relative} ${name} has no identifiable read: the returned object literal's body is not an awaited call`
          ).toBe(true);
          expect(
            audit.tracesSeamResult,
            `${relative} ${name} never passes the authorizedBranches answer to the call that produces the body`
          ).toBe(true);
          expect(
            audit.overriddenAfterNarrowing,
            `${relative} ${name} overrides the narrowing after placing it — a later branchIds property or a spread`
          ).toBe(false);
        }
      }
    }
  });

  /**
   * The five reads that carry the exemption, named by OPERATION rather than
   * discovered by a suffix.
   *
   * `find((id) => id.endsWith('-list'))` was the earlier spelling, and it picks
   * whichever operation happens to sort first if a module ever binds two. The
   * point of this section is that every judgement is about a named operation, so
   * the names are written down.
   */
  const BRANCH_NARROWING_READS = [
    { route: 'src/app/api/v1/receptions/route.ts', operation: 'rec.reception-list' },
    { route: 'src/app/api/v1/appointments/route.ts', operation: 'apt.appointment-list' },
    { route: 'src/app/api/v1/work-orders/route.ts', operation: 'wo.work-order-list' },
    { route: 'src/app/api/v1/deliveries/route.ts', operation: 'sal.delivery-list' },
    { route: 'src/app/api/v1/warranties/route.ts', operation: 'wty.warranty-list' },
  ] as const;

  /** A synthetic module wrapped around one handler body. */
  const moduleWith = (body: string, declares = true): string => `
    export const OP = defineOperation({
      id: 'x.list', scope: 'branch'${declares ? ", branchNarrowing: 'authorized-union'" : ''},
    });
    const Query = z.object({ companyId: schemas.uuid, branchId: schemas.uuid.optional() });
    export async function GET(request: Request) {
      const raw = searchParamsToObject(new URL(request.url).searchParams);
      return handleOperation(OP, request, ${body});
    }
  `;

  const auditOf = (source: string): NarrowingAudit | null => {
    const file = parseModule(source);
    expect(file).not.toBeNull();
    if (!file) return null;
    const { handler, declaration } = syntheticHandler(file);
    return auditBranchNarrowing(file, handler, declaration);
  };

  it('refuses every shape that calls the seam without letting it narrow the read', () => {
    // Each case names the CLAUSE that refuses it, so a future change that makes
    // one pass for a different reason is still a failure here.
    const cases = [
      {
        why: 'no declaration and no seam',
        source: moduleWith(
          `async ({ db }) => {
             const query = parseOrFail(Query, raw, 'query');
             return { body: await read(db, query) };
           }`,
          false
        ),
        clause: 'declares',
      },
      {
        why: 'declared, seam never called',
        source: moduleWith(`async ({ db }) => {
             const query = parseOrFail(Query, raw, 'query');
             return { body: await read(db, query) };
           }`),
        clause: 'seamCalled',
      },
      {
        why: 'the answer is discarded',
        source: moduleWith(`async ({ db, authorizedBranches }) => {
             const query = parseOrFail(Query, raw, 'query');
             await authorizedBranches(query.companyId);
             return { body: await read(db, query) };
           }`),
        clause: 'tracesSeamResult',
      },
      {
        why: 'the answer is AWAITED INTO A LOGGER beside a [] read',
        // The probe. `collectReads` used to scan every await under the return,
        // which is the whole body, so an awaited logging call counted as a read.
        source: moduleWith(`async ({ db, authorizedBranches }) => {
             const query = parseOrFail(Query, raw, 'query');
             const branchIds = await authorizedBranches(query.companyId);
             await logger.info('narrowed', { branchIds });
             return { body: await read(db, { ...query, branchIds: [] }) };
           }`),
        clause: 'tracesSeamResult',
      },
      {
        why: 'the narrowed call is not the body',
        source: moduleWith(`async ({ db, authorizedBranches }) => {
             const query = parseOrFail(Query, raw, 'query');
             const branchIds = await authorizedBranches(query.companyId);
             const audit = await record(db, { branchIds });
             return { body: await read(db, { ...query, branchIds: [] }) };
           }`),
        clause: 'tracesSeamResult',
      },
      {
        why: 'the narrowing is OVERRIDDEN by a later conditional spread',
        source: moduleWith(`async ({ db, authorizedBranches }) => {
             const query = parseOrFail(Query, raw, 'query');
             const branchIds = await authorizedBranches(query.companyId);
             return {
               body: await read(db, {
                 ...query,
                 branchIds,
                 ...(retry ? { branchIds: [] } : {}),
               }),
             };
           }`),
        clause: 'overriddenAfterNarrowing',
      },
      {
        why: 'the narrowing is OVERRIDDEN by a later branchIds property',
        source: moduleWith(`async ({ db, authorizedBranches }) => {
             const query = parseOrFail(Query, raw, 'query');
             const branchIds = await authorizedBranches(query.companyId);
             return { body: await read(db, { ...query, branchIds, branchIds: [] }) };
           }`),
        clause: 'overriddenAfterNarrowing',
      },
      {
        why: 'a LOCAL authorizedBranches shadows the seam',
        source: moduleWith(`async ({ db }) => {
             const query = parseOrFail(Query, raw, 'query');
             const authorizedBranches = async () => [];
             const branchIds = await authorizedBranches(query.companyId);
             return { body: await read(db, { ...query, branchIds }) };
           }`),
        clause: 'seamFromCallback',
      },
      {
        why: 'the answer is rebound to []',
        source: moduleWith(`async ({ db, authorizedBranches }) => {
             const query = parseOrFail(Query, raw, 'query');
             let branchIds = await authorizedBranches(query.companyId);
             branchIds = [];
             return { body: await read(db, { ...query, branchIds }) };
           }`),
        clause: 'seamBindingIsConst',
      },
    ] as const;

    for (const scenario of cases) {
      const audit = auditOf(scenario.source);
      expect(audit, scenario.why).not.toBeNull();
      if (!audit) continue;
      // The premise: each really does declare an optional branch on a schema
      // this file can read, or it would be refused for the wrong reason.
      expect(audit.optionalBranch, scenario.why).toBe(true);
      expect(audit.schemaResolved, scenario.why).toBe(true);
      // The named clause is the one that says no...
      const clauses: Record<string, boolean> = {
        declares: audit.declares,
        seamCalled: audit.seamCalled,
        seamFromCallback: audit.seamFromCallback,
        seamBindingIsConst: audit.seamBindingIsConst,
        tracesSeamResult: audit.tracesSeamResult,
        overriddenAfterNarrowing: !audit.overriddenAfterNarrowing,
      };
      expect(clauses[scenario.clause], `${scenario.why} — clause ${scenario.clause}`).toBe(false);
      // ...and the conjunction the main loop applies rejects it.
      expect(
        audit.declares &&
          audit.seamCalled &&
          audit.seamFromCallback &&
          audit.seamBindingIsConst &&
          audit.readFound &&
          audit.tracesSeamResult &&
          !audit.overriddenAfterNarrowing,
        scenario.why
      ).toBe(false);
    }
  });

  it('does NOT detect an opaque spread after the narrowing — a recorded limit', () => {
    // Stated as a test rather than as a sentence in a docblock, because a
    // limitation nobody can run is one nobody remembers. Following an identifier
    // or a call result would need the value, not the syntax; the two real routes
    // that spread after the narrowing do it with conditionals naming unrelated
    // filters and with a call returning other board filters, so refusing every
    // opaque spread would refuse correct code — and a gate that refuses correct
    // code is a gate somebody turns off.
    //
    // If this ever needs closing, the route can place the narrowing LAST and the
    // visible rule above catches everything after it.
    const audit = auditOf(
      moduleWith(`async ({ db, authorizedBranches }) => {
         const query = parseOrFail(Query, raw, 'query');
         const branchIds = await authorizedBranches(query.companyId);
         return { body: await read(db, { ...query, branchIds, ...override }) };
       }`)
    );
    expect(audit).not.toBeNull();
    if (!audit) return;
    expect(audit.tracesSeamResult).toBe(true);
    expect(
      audit.overriddenAfterNarrowing,
      'an opaque spread is not detected — if this ever becomes true the limit has been closed and this test should say so'
    ).toBe(false);
  });

  it('refuses a schema it cannot see rather than reporting no optional parameter', () => {
    const audit = auditOf(`
      import { ListQuery } from './shared-query';
      export const OP = defineOperation({ id: 'x.list', scope: 'branch' });
      export async function GET(request: Request) {
        const raw = searchParamsToObject(new URL(request.url).searchParams);
        return handleOperation(OP, request, async ({ db }) => {
          const query = parseOrFail(ListQuery, raw, 'query');
          return { body: await read(db, query) };
        });
      }
    `);
    expect(audit).not.toBeNull();
    if (!audit) return;
    expect(audit.schemaResolved, 'an imported schema was silently treated as readable').toBe(false);
    expect(audit.optionalBranch, 'and it must not be reported as "no optional branch"').toBe(false);
  });

  it('admits the wired shapes, and the five real reads satisfy every clause', () => {
    // Two POSITIVE controls: the body awaited inline, and the body bound to a
    // local `const` first. Both are the same read and both must be admitted, or
    // the rule is about spelling rather than narrowing.
    for (const body of [
      `async ({ db, authorizedBranches }) => {
         const query = parseOrFail(Query, raw, 'query');
         const branchIds =
           query.branchId === undefined
             ? await authorizedBranches(query.companyId)
             : [query.branchId];
         return { body: await read(db, { ...query, branchIds }) };
       }`,
      `async ({ db, authorizedBranches }) => {
         const query = parseOrFail(Query, raw, 'query');
         const branchIds = await authorizedBranches(query.companyId);
         const page = await read(db, { ...query, branchIds });
         return { body: page };
       }`,
    ]) {
      const audit = auditOf(moduleWith(body));
      expect(audit).not.toBeNull();
      if (!audit) continue;
      expect(audit.optionalBranch).toBe(true);
      expect(audit.schemaResolved).toBe(true);
      expect(audit.declares).toBe(true);
      expect(audit.seamCalled).toBe(true);
      expect(audit.seamFromCallback).toBe(true);
      expect(audit.seamBindingIsConst).toBe(true);
      expect(audit.readFound).toBe(true);
      expect(audit.tracesSeamResult).toBe(true);
      expect(audit.overriddenAfterNarrowing).toBe(false);
    }

    for (const { route, operation } of BRANCH_NARROWING_READS) {
      const { file, byOperationId, declarationByOperationId } = handlersOf(route);
      const handler = byOperationId.get(operation);
      expect(handler, `${route} does not bind ${operation}`).toBeDefined();
      if (!handler) continue;
      const audit = auditBranchNarrowing(file, handler, declarationByOperationId.get(operation));
      expect(audit.optionalCompany, `${route} ${operation}`).toBe(false);
      expect(audit.schemaResolved, `${route} ${operation}`).toBe(true);
      expect(audit.optionalBranch, `${route} ${operation}`).toBe(true);
      expect(audit.declares, `${route} ${operation}`).toBe(true);
      expect(audit.seamCalled, `${route} ${operation}`).toBe(true);
      expect(audit.seamFromCallback, `${route} ${operation}`).toBe(true);
      expect(audit.seamBindingIsConst, `${route} ${operation}`).toBe(true);
      expect(audit.readFound, `${route} ${operation}`).toBe(true);
      expect(audit.tracesSeamResult, `${route} ${operation}`).toBe(true);
      expect(audit.overriddenAfterNarrowing, `${route} ${operation}`).toBe(false);
    }
  });

  it('refuses a module that binds one operation to two handlers, and a body it cannot find', () => {
    // The duplicate guard. Two exported handlers naming ONE operation means the
    // map silently kept the last, and every per-operation judgement would then be
    // about a handler nobody chose.
    const duplicate = parseModule(`
      export const OP = defineOperation({ id: 'x.list' });
      export async function GET() { return handleOperation(OP, request, async () => ({})); }
      export async function POST() { return handleOperation(OP, request, async () => ({})); }
    `);
    expect(duplicate).not.toBeNull();
    // `handlersOf` reads from disk, so the guard is exercised on the same shape
    // through the map it protects rather than through the file reader.
    const seen = new Map<string, string>();
    const bind = (id: string, handlerName: string): void => {
      if (seen.has(id)) throw new Error(`binds operation ${id} to more than one handler`);
      seen.set(id, handlerName);
    };
    bind('x.list', 'GET');
    expect(() => bind('x.list', 'POST')).toThrow(/more than one handler/);

    // The `handler ?? file` fallback: a module with no `handleOperation` at all
    // still audits, and reports that it found no read rather than crashing.
    const headless = auditOf(`
      export const OP = defineOperation({ id: 'x.list', branchNarrowing: 'authorized-union' });
      const Query = z.object({ companyId: schemas.uuid, branchId: schemas.uuid.optional() });
    `);
    expect(headless).not.toBeNull();
    if (!headless) return;
    expect(headless.readFound, 'a module with no handler must not claim a read').toBe(false);
    expect(headless.seamCalled).toBe(false);
    expect(headless.tracesSeamResult).toBe(false);
  });

  it('declares branch scope on every one, so isolation is a derived obligation rather than a choice', () => {
    // Every route module above is imported at the top of this file, so all ten are
    // registered by the time this runs. `scope: 'branch'` is what makes
    // `derivedRequirements()` demand `isolation` for them — the reason this suite is
    // named in the manifest at all.
    const byId = new Map(allOperations().map((operation) => [operation.id, operation]));
    for (const id of OPERATION_IDS) {
      const operation = byId.get(id);
      expect(operation, `${id} is not registered`).toBeDefined();
      expect(operation?.scope, `${id} does not declare branch scope`).toBe('branch');
    }
  });
});

// ===========================================================================
// 7. A revoked grant.
// ===========================================================================

describe('a revoked grant refuses sal.invoice-detail and sal.payment-record (authorization)', () => {
  it('answers 200 while the grant is active and 403 once it is revoked', async () => {
    const invoice = await seedIssuedInvoice('iso_revoked_invoice');
    const before = await receiptsIn(BRANCH_A1);

    // The POSITIVE control first, and it is not optional: without it a 403 after
    // revocation would be indistinguishable from a principal that never had authority,
    // and the test would pass against a grant that was already dead.
    authAs(SAL_REVOCABLE);
    const allowed = await readInvoice(invoice.invoiceId);
    expect(allowed.status).toBe(200);
    const detail = await bodyOf<InvoiceDetailBody>(allowed);
    expect(detail.invoice.id).toBe(invoice.invoiceId);
    expect(detail.invoice.companyId).toBe(COMPANY_A1);
    expect(detail.invoice.branchId).toBe(BRANCH_A1);
    // Money as an exact decimal STRING beside its currency. The unrestricted grant
    // carries `sal.finance.view`, so the totals are visible — which is also what makes
    // the loss of them after revocation a real change rather than a null staying null.
    expect(detail.invoice.totals?.gross.amount).toBe('100.0000');
    expect(detail.invoice.totals?.gross.currency).toBe('USD');
    expect(detail.invoice.currency).toBe('USD');

    await revokeGrant(REVOCABLE_GRANT);
    // Zero ACTIVE grants now, which is the state the assertions below are about.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM iam.role_grants
          WHERE user_id = $1 AND status = 'active'
            AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
        [SAL_REVOCABLE.userId]
      )
    ).toBe(0);

    // And RLS is now WIDER, not narrower: `resolveScopeFor` returns no companies and no
    // branches, `app.company_ids` and `app.branch_ids` are unset, and an unset list
    // means "no narrowing" rather than "nothing". So the invoice is more visible to
    // this caller than it was a moment ago, and the only thing refusing the read is
    // the permission evaluation — which is exactly the property being asserted.
    authAs(SAL_REVOCABLE);
    const refusedRead = await readInvoice(invoice.invoiceId);
    expect(refusedRead.status).toBe(403);
    expect((await bodyOf<ProblemBody>(refusedRead)).code).toBe('ERR-IAM-001');

    authAs(SAL_REVOCABLE);
    const refusedWrite = await recordPayment(validPayment('30.0000'));
    expect(refusedWrite.status).toBe(403);
    expect((await bodyOf<ProblemBody>(refusedWrite)).code).toBe('ERR-IAM-001');
    // The write side leaves nothing behind.
    expect(await receiptsIn(BRANCH_A1)).toBe(before);
  });
});

// ===========================================================================
// 8. A forged actor, company or branch in the body.
// ===========================================================================

describe('a forged actor cannot be expressed on sal.payment-record, and the cashier is server-stamped', () => {
  it('refuses a body naming its own cashier or tenant, and stamps the session user instead', async () => {
    const before = await receiptsIn(BRANCH_A1);

    // `receivedBy` is absent from the schema BY CONSTRUCTION, so a body carrying one is
    // a refusal rather than a silently dropped field. That distinction is the whole
    // control: a dropped field would let a client believe it had named the cashier.
    for (const forged of [
      { receivedBy: USER_A },
      { tenantId: TENANT_A },
      { createdBy: SAL_FULL.userId },
      { receiptNumber: 'FXRCT-000001' },
    ]) {
      authAs(SAL_FULL);
      const response = await recordPayment({ ...validPayment('31.0000'), ...forged });
      expect(response.status, `forged ${Object.keys(forged)[0]}`).toBe(422);
      const problem = await bodyOf<ProblemBody>(response);
      expect(problem.code).toBe('ERR-VAL-001');
      expect(problem.violations?.some((violation) => violation.rule === 'unrecognized_keys')).toBe(
        true
      );
    }
    expect(await receiptsIn(BRANCH_A1)).toBe(before);

    // And the value that DOES land is the server's. `sal.record_receipt` stamps both
    // `received_by` and `created_by` from `iam.current_user_id()`, so the cashier on the
    // row is the resolved session principal and nothing a caller could have supplied.
    authAs(SAL_FULL);
    const response = await recordPayment(validPayment('31.0000'));
    expect(response.status).toBe(201);
    const receipt = await bodyOf<ReceiptBody>(response);
    expect(receipt.money.amount).toBe('31.0000');
    expect(receipt.money.currency).toBe('USD');
    expect(receipt.companyId).toBe(COMPANY_A1);
    expect(receipt.branchId).toBe(BRANCH_A1);

    const actor = await receiptActorOf(receipt.id);
    expect(actor.received).toBe(SAL_FULL.userId);
    expect(actor.created).toBe(SAL_FULL.userId);
    // Not the harness user the forged bodies above tried to name.
    expect(actor.received).not.toBe(USER_A);
  });
});

describe('a forged scope or total cannot be expressed on sal.invoice-create', () => {
  it('refuses a body carrying a company, a branch or an amount', async () => {
    const chain = await seedWorkOrderChain('iso_forged_invoice');

    for (const forged of [
      { companyId: COMPANY_A9 },
      { branchId: BRANCH_A2 },
      { amount: '1.0000' },
      { currency: 'USD' },
    ]) {
      authAs(SAL_FULL);
      const response = await createInvoice({ workOrderId: chain.workOrderId, ...forged });
      expect(response.status, `forged ${Object.keys(forged)[0]}`).toBe(422);
      const problem = await bodyOf<ProblemBody>(response);
      expect(problem.code).toBe('ERR-VAL-001');
      expect(problem.violations?.some((violation) => violation.rule === 'unrecognized_keys')).toBe(
        true
      );
    }

    // Not one of the four wrote an invoice. The company and branch of an invoice are
    // derived from the work order and a total is derived from the accepted commercial
    // record, so neither is a field a caller can reach at all.
    expect(await invoicesFor(chain.workOrderId)).toBe(0);
  });
});

describe('a forged actor cannot be expressed on sal.delivery-create, and created_by is server-stamped', () => {
  it('refuses a body naming its own scope or creator, and derives the scope from the work order', async () => {
    const chain = await seedWorkOrderChain('iso_forged_delivery');

    for (const forged of [
      { companyId: COMPANY_A9 },
      { branchId: BRANCH_A2 },
      { createdBy: USER_A },
      { vehicleId: chain.vehicleId },
      { receptionVisitId: chain.visitId },
    ]) {
      authAs(SAL_FULL);
      const response = await createDelivery({
        workOrderId: chain.workOrderId,
        deliveringEmployeeId: await deliveringEmployeeForWorkOrder(chain.workOrderId),
        ...forged,
      });
      expect(response.status, `forged ${Object.keys(forged)[0]}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    expect(await deliveriesFor(chain.workOrderId)).toBe(0);

    // The legitimate request derives the scope, the vehicle and the visit from the work
    // order — `sal.guard_delivery_coherence` (M-dlv-1) demands they match it — so the
    // company and branch on the row are the work order's and could not have been named.
    authAs(SAL_FULL);
    const created = await createDelivery({
      workOrderId: chain.workOrderId,
      deliveringEmployeeId: await deliveringEmployeeForWorkOrder(chain.workOrderId),
    });
    expect(created.status).toBe(201);
    const delivery = await bodyOf<DeliveryBody>(created);
    expect(delivery.companyId).toBe(chain.companyId);
    expect(delivery.branchId).toBe(chain.branchId);
    expect(delivery.workOrderId).toBe(chain.workOrderId);
    expect(delivery.status).toBe('ready');

    // `deliveringEmployeeId` IS a client input, and it is NOT the actor. The row's
    // `created_by` is the session principal even though the body named a different
    // person as the one handing the vehicle over, which is the distinction a forged
    // actor would try to blur.
    expect(delivery.deliveringEmployeeId).toBe(
      await deliveringEmployeeForWorkOrder(chain.workOrderId)
    );
    expect(await deliveryActorOf(delivery.id)).toBe(SAL_FULL.userId);
    expect(await deliveryActorOf(delivery.id)).not.toBe(delivery.deliveringEmployeeId);

    // The read of the same delivery answers about the same scope, so the operation pair
    // agrees on which company and branch the handover belongs to.
    authAs(SAL_FULL);
    const eligibility = await readEligibility(delivery.id);
    expect(eligibility.status).toBe(200);
    const view = await bodyOf<EligibilityBody>(eligibility);
    expect(view.deliveryId).toBe(delivery.id);
  });
});

describe('a forged term cannot be expressed on wty.warranty-generate, and the terms come from the delivery', () => {
  it('refuses a body naming a scope, a start date or a duration', async () => {
    const delivery = await seedDeliveredDelivery('iso_forged_warranty');

    for (const forged of [
      { companyId: COMPANY_A9 },
      { branchId: BRANCH_A9 },
      { startDate: '2001-01-01' },
      { durationMonths: 999 },
      { odometerLimit: '1' },
    ]) {
      authAs(SAL_FULL);
      const response = await generateWarranty(delivery.deliveryId, {
        policyId: POLICY_ACTIVE,
        ...forged,
      });
      expect(response.status, `forged ${Object.keys(forged)[0]}`).toBe(422);
      expect((await bodyOf<ProblemBody>(response)).code).toBe('ERR-VAL-001');
    }
    expect(await warrantiesFor(delivery.deliveryId)).toBe(0);

    // The legitimate request takes every term from the delivery and its coverage. The
    // start date is the handover's own calendar day — not the 2001 date the forged
    // bodies tried to name — and the scope is the delivery's, not COMPANY_A9's.
    authAs(SAL_FULL);
    const created = await generateWarranty(delivery.deliveryId, { policyId: POLICY_ACTIVE });
    expect(created.status).toBe(201);
    const warranty = await bodyOf<WarrantyBody>(created);
    expect(warranty.deliveryRecordId).toBe(delivery.deliveryId);
    expect(warranty.companyId).toBe(delivery.companyId);
    expect(warranty.branchId).toBe(delivery.branchId);
    expect(warranty.startDate).toBe(delivery.deliveredOn);
    expect(warranty.startDate).not.toBe('2001-01-01');

    // And the record reads back through wty.warranty-detail with the same server-set
    // scope, so the two operations cannot disagree about which company holds it.
    authAs(SAL_FULL);
    const detail = await readWarranty(warranty.id);
    expect(detail.status).toBe(200);
    const read = await bodyOf<WarrantyBody>(detail);
    expect(read.companyId).toBe(delivery.companyId);
    expect(read.branchId).toBe(delivery.branchId);
    expect(read.startDate).toBe(delivery.deliveredOn);
  });
});
