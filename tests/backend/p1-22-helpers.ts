/**
 * Phase 1-22 backend fixtures — payments and warranty.
 *
 * Builds the minimum protected-schema state the payment and warranty surfaces need,
 * in BOTH tenants, in two tenant-A branches, and in a SECOND tenant-A company, so
 * cross-tenant, cross-branch and cross-company isolation can be asserted rather than
 * assumed.
 *
 * Principals are seeded here rather than reused from `p1-19-helpers` or
 * `p1-21-helpers` because neither carries a `sal.` or `wty.` permission, and widening
 * them would change what those suites prove.
 *
 * Call order in a suite's `beforeAll` — each step depends on the one before it:
 *
 *   ensureTestLogins → ensureBackendFixtures → establishP1_19Fixtures →
 *   establishP1_22Fixtures
 *
 * `establishP1_19Fixtures` is a hard prerequisite, not a convenience: this file's
 * work-order chain is built by the REAL reception conversion route
 * (`p1-19-helpers.createWorkOrder`), which needs P1-19's partner, its tenant-wide
 * `work_order` number sequence, and its `rec.reception.convert` principal. P1-19's
 * own header argues that the conversion route is the only legitimate creation path
 * for a work order, and a warranty dated from a delivery of a work order that no
 * shipped code produced would be a fixture proving itself.
 *
 * ## The scoped principals are the point of the file
 *
 *  - `SAL_SCOPED_A2` holds every `sal.`/`wty.` permission scoped to branch A2 **only**.
 *  - `SAL_PERMISSION_ELSEWHERE` holds them scoped to A2 *and* an unrelated permission
 *    (`org.tenant.read`) scoped to A1. **That second grant is mandatory and is the
 *    whole reason this principal exists.** `iam.allowed_branch_ids()` is the
 *    permission-blind union of every active grant, so the second grant puts A1 into
 *    that union WITHOUT giving the principal any payment or warranty authority
 *    there — which is the only way to prove that a SCOPED PERMISSION CHECK, and not
 *    RLS invisibility, is what refuses the request (P1-18-A-01). Without it an
 *    A2-scoped principal has A1 outside the union, the row is invisible to RLS, the
 *    answer is a uniform 404, and the test would pass unchanged against a
 *    completely scope-blind implementation.
 *  - `SAL_COMPANY_SCOPED` holds its `sal.`/`wty.` permissions COMPANY-scoped to
 *    `COMPANY_A1`, plus an unrelated permission BRANCH-scoped to `BRANCH_A9` — a
 *    branch of a SECOND company inside tenant A. P1-21's H6 recorded that
 *    `iam.has_permission_in_scope` matches
 *      (scope_type='company' AND company_id = p_company)
 *      OR (scope_type='branch' AND branch_id = p_branch)
 *    so naming `companyId=COMPANY_A1&branchId=BRANCH_A9` satisfies the check on the
 *    COMPANY half while pointing the write at company A9 — and the widening grant
 *    puts A9 inside `iam.allowed_branch_ids()`, so RLS admits the rows too. An
 *    INCOHERENT `(company, branch)` pair is therefore a real leak, and it is
 *    unreachable by construction in a tenant with only one company, which is why
 *    `COMPANY_A9`/`BRANCH_A9` exist. Its grant is built by hand rather than through
 *    `Principal.scope`, which always writes `scope_type='branch'`.
 *  - `SAL_NO_FINANCE` holds every permission above EXCEPT `sal.finance.view`. Every
 *    `sal` money table is gated WHOLE-ROW by that permission on SELECT *and* INSERT
 *    (`sel_receipts_gated`, `ins_receipts_gated`), so a caller who is otherwise
 *    fully authorized still cannot reach or create a receipt. The invoice HEADER is
 *    deliberately ungated by it — a caller without the permission is meant to see
 *    that an invoice exists without seeing its money, rather than a 403 — but P1-22
 *    registers no invoice route, so that half of the asymmetry has no operation to
 *    exercise it here and is not simulated.
 *  - `SAL_APPROVER` is a SECOND unrestricted tenant-A principal. `sal.stamp_dual_control_maker`
 *    stamps the maker from the session and `sal.guard_dual_control_approval` refuses
 *    `approved_by = requested_by`, so maker ≠ approver has to be satisfiable by two
 *    real accounts rather than by one account used twice.
 *  - `SAL_READER` holds `sal.finance.view` and `sal.delivery.view` only. It is the
 *    403 probe for every command: a principal that holds NEITHER
 *    `sal.payment.record` nor `wty.warranty.issue`, in a tenant where the rows are
 *    otherwise visible to it.
 *
 * ## Every fixture a route will later read is COMMITTED
 *
 * The routes open their own transaction on a different connection, so an
 * uncommitted fixture is invisible to them. Every builder here commits before it
 * returns, and that is also why `cleanP1_22Fixtures` has to unwind the `sal`/`wty`
 * rows itself — see its own comment.
 */
import type { Pool } from 'pg';
import { BRANCH_A1, COMPANY_A1, IDENTITY_PROVIDER, TENANT_A, TENANT_B, USER_A } from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  PARTNER_A,
  createWorkOrder,
  type Principal,
} from './p1-19-helpers';
import { StaticClaimsAuthenticator, setSessionAuthenticator } from '@/server/context/principal';

// ---- Permission codes ------------------------------------------------------
//
// These twelve are the ONLY `sal.`/`wty.` codes the seeded catalogue defines
// (`supabase/seeds/04_iam_permission_catalog.sql`). Nothing here invents one: a
// fixture permission would make a route pass against a code the platform does not
// ship, which is exactly the P1-13 finding PC-1.

export const INVOICE_MANAGE = 'sal.invoice.manage';
export const INVOICE_ISSUE = 'sal.invoice.issue';
export const PAYMENT_RECORD = 'sal.payment.record';
export const PAYMENT_ALLOCATE = 'sal.payment.allocate';
export const CREDIT_MANAGE = 'sal.credit.manage';
export const REVERSAL_APPROVE = 'sal.reversal.approve';
export const FINANCE_VIEW = 'sal.finance.view';
export const DELIVERY_MANAGE = 'sal.delivery.manage';
export const DELIVERY_COMPLETE = 'sal.delivery.complete';
export const DELIVERY_VIEW = 'sal.delivery.view';
export const POLICY_MANAGE = 'wty.policy.manage';
export const WARRANTY_ISSUE = 'wty.warranty.issue';
/**
 * Held so a `sal`/`wty` principal may read the work order a warranty cites.
 *
 * `wty.warranty-generate` reaches the work-order module's line port to decide covered
 * items, and the prerequisite chain (reception visit → work order → delivery) is
 * arranged through P1-19's routes. RLS on `wo.work_orders` is scope-only, so this is
 * not what admits the read — it is held because a principal that could issue a
 * warranty against a work order it may not read would be an odd grant to model.
 */
export const WORK_ORDER_READ = 'wo.work_order.read';

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

/** Domain per code, for the idempotent catalogue insert below. */
const CATALOGUE: readonly (readonly [string, string])[] = [
  [INVOICE_MANAGE, 'sal'],
  [INVOICE_ISSUE, 'sal'],
  [PAYMENT_RECORD, 'sal'],
  [PAYMENT_ALLOCATE, 'sal'],
  [CREDIT_MANAGE, 'sal'],
  [REVERSAL_APPROVE, 'sal'],
  [FINANCE_VIEW, 'sal'],
  [DELIVERY_MANAGE, 'sal'],
  [DELIVERY_COMPLETE, 'sal'],
  [DELIVERY_VIEW, 'sal'],
  [POLICY_MANAGE, 'wty'],
  [WARRANTY_ISSUE, 'wty'],
];

/** An unrelated permission used only to widen a grant union. Never authority. */
const WIDENING_PERMISSION = 'org.tenant.read';
const WIDENING_ROLE = 'f1220000-0000-4000-8000-0000000000f0';
const WIDENING_GRANT = 'f1220000-0000-4000-8000-0000000001f9';
const COMPANY_SCOPED_GRANT = 'f1220000-0000-4000-8000-0000000009f1';
const COMPANY_SCOPED_WIDENING_ROLE = 'f1220000-0000-4000-8000-0000000009e3';
const COMPANY_SCOPED_WIDENING_GRANT = 'f1220000-0000-4000-8000-0000000009f2';

// ---- Fixture ids -----------------------------------------------------------

/**
 * A SECOND company inside tenant A, with its own branch.
 *
 * H6 needs it: every other tenant-A fixture hangs off `COMPANY_A1`, so a
 * `(company, branch)` pair could never be INCOHERENT — and the leak only exists for
 * an incoherent pair. With one company in the tenant the hole is unreachable by
 * construction, which is exactly why nothing caught it.
 */
export const COMPANY_A9 = 'f1220000-0000-4000-8000-0000000009c1';
export const BRANCH_A9 = 'f1220000-0000-4000-8000-0000000009b1';

/**
 * Tenant-scoped payment methods.
 *
 * *** A RECEIPT CANNOT CITE A PLATFORM METHOD. ***
 * `fk_receipts_method` is `(tenant_id, payment_method_id) -> sal.payment_methods
 * (tenant_id, id)` and `ck_payment_methods_scope_tenant` forces a platform row's
 * `tenant_id` to be NULL. Under MATCH SIMPLE both referencing columns are NOT NULL,
 * so the referenced row must match on both and no NULL tenant can equal a concrete
 * one — recording against one of the three seeded platform methods raises `23503`.
 * `tests/db/p1-11-helpers.ts` records the same conclusion beside the tenant-scoped
 * method it has to create for exactly this reason. So a tenant row is seeded per
 * tenant, and `platformPaymentMethodId()` exposes a platform row so the refusal can
 * be proved rather than assumed.
 */
export const PAYMENT_METHOD_A = 'f1220000-0000-4000-8000-000000000d01';
/** Tenant A, `status = 'inactive'` — so `assertPaymentMethodUsable` is testable. */
export const PAYMENT_METHOD_A_INACTIVE = 'f1220000-0000-4000-8000-000000000d02';
/** Tenant B's own method, so the method list can be shown to be tenant-scoped. */
export const PAYMENT_METHOD_B = 'f1220000-0000-4000-8000-000000000d03';

export const PAYMENT_METHOD_A_CODE = 'fx_p122_cash';
export const PAYMENT_METHOD_A_INACTIVE_CODE = 'fx_p122_retired';
export const PAYMENT_METHOD_B_CODE = 'fx_p122_cash_b';

const SIG_CATEGORY = 'f1220000-0000-4000-8000-000000000c01';
const SIG_DOCUMENT = 'f1220000-0000-4000-8000-000000000c02';
/** The committed `shared.document_versions` row every delivery signature binds. */
export const SIGNATURE_DOCUMENT_VERSION = 'f1220000-0000-4000-8000-000000000c03';

/** ACTIVE policy with ONE active coverage effective from well in the past. */
export const POLICY_ACTIVE = 'f1220000-0000-4000-8000-000000000e01';
export const POLICY_ACTIVE_CODE = 'fx_p122_active';
export const COVERAGE_ACTIVE = 'f1220000-0000-4000-8000-000000000e02';
/**
 * ARCHIVED policy that still carries an ACTIVE coverage row.
 *
 * `wty.issue_warranty` filters coverage on `status = 'active'` and never looks at
 * `wty.warranty_policies.status`, so this pair is exactly the state the database
 * would happily issue against — which is what makes `assertPolicyActive` the only
 * defence and this fixture the only way to test it.
 */
export const POLICY_ARCHIVED = 'f1220000-0000-4000-8000-000000000e03';
export const POLICY_ARCHIVED_CODE = 'fx_p122_archived';
const COVERAGE_ARCHIVED_POLICY = 'f1220000-0000-4000-8000-000000000e04';
/** ACTIVE policy with NO coverage row at all — the configuration-gap fixture. */
export const POLICY_NO_COVERAGE = 'f1220000-0000-4000-8000-000000000e05';
export const POLICY_NO_COVERAGE_CODE = 'fx_p122_uncovered';

/** The coverage terms the tests assert the arithmetic against. */
export const COVERAGE_DURATION_MONTHS = 12;
/** RELATIVE allowance on the coverage. The RECORD's limit is absolute. */
export const COVERAGE_ODOMETER_ALLOWANCE = '20000';
export const COVERAGE_EFFECTIVE_FROM = '2020-01-01';
/** The odometer `sal.complete_delivery` captures for every fixture delivery. */
export const DELIVERY_ODOMETER = '100000';

// ---- Principals ------------------------------------------------------------

/** Tenant A, unrestricted, every code above. */
export const SAL_FULL: Principal = {
  roleId: 'f1220000-0000-4000-8000-000000000101',
  userId: 'f1220000-0000-4000-8000-000000000102',
  subject: 'fx_p1_22_full',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY,
};

/**
 * A SECOND unrestricted tenant-A principal, so maker <> approver is satisfiable.
 *
 * `sal.guard_dual_control_approval` refuses `approved_by = requested_by`, and the
 * maker is stamped from the session by `sal.stamp_dual_control_maker` rather than
 * supplied — so the split needs two real accounts.
 */
export const SAL_APPROVER: Principal = {
  roleId: 'f1220000-0000-4000-8000-000000000111',
  userId: 'f1220000-0000-4000-8000-000000000112',
  subject: 'fx_p1_22_approver',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY,
};

/** Everything EXCEPT `sal.finance.view`. See the file header. */
export const SAL_NO_FINANCE: Principal = {
  roleId: 'f1220000-0000-4000-8000-000000000121',
  userId: 'f1220000-0000-4000-8000-000000000122',
  subject: 'fx_p1_22_no_finance',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY.filter((code) => code !== FINANCE_VIEW),
};

/** Reads only. A command refusal from it is about authority, not tenancy. */
export const SAL_READER: Principal = {
  roleId: 'f1220000-0000-4000-8000-000000000131',
  userId: 'f1220000-0000-4000-8000-000000000132',
  subject: 'fx_p1_22_reader',
  tenantId: TENANT_A,
  permissions: [FINANCE_VIEW, DELIVERY_VIEW, WORK_ORDER_READ],
};

export const SAL_SCOPED_A2: Principal = {
  roleId: 'f1220000-0000-4000-8000-000000000141',
  userId: 'f1220000-0000-4000-8000-000000000142',
  subject: 'fx_p1_22_scoped_a2',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY,
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'f1220000-0000-4000-8000-0000000001f1',
};

/**
 * Scoped to A2, with A1 inside its permission-blind allowed-branch union.
 *
 * The decisive isolation principal: A1's rows ARE visible to RLS for this caller, so
 * the only thing that can refuse an A1 request is the scoped permission check.
 */
export const SAL_PERMISSION_ELSEWHERE: Principal = {
  roleId: 'f1220000-0000-4000-8000-000000000151',
  userId: 'f1220000-0000-4000-8000-000000000152',
  subject: 'fx_p1_22_permission_elsewhere',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY,
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'f1220000-0000-4000-8000-0000000001f2',
};

/** H6. Its grant is COMPANY-scoped and built by hand — see the file header. */
export const SAL_COMPANY_SCOPED: Principal = {
  roleId: 'f1220000-0000-4000-8000-0000000009e1',
  userId: 'f1220000-0000-4000-8000-0000000009e2',
  subject: 'fx_p1_22_company_scoped',
  tenantId: TENANT_A,
  permissions: ALL_SAL_WTY,
};

/** Tenant B, unrestricted. A refusal from it is the tenant boundary, not authority. */
export const SAL_TENANT_B: Principal = {
  roleId: 'f1220000-0000-4000-8000-000000000161',
  userId: 'f1220000-0000-4000-8000-000000000162',
  subject: 'fx_p1_22_tenant_b',
  tenantId: TENANT_B,
  permissions: ALL_SAL_WTY,
};

export const P1_22_PRINCIPALS: readonly Principal[] = [
  SAL_FULL,
  SAL_APPROVER,
  SAL_NO_FINANCE,
  SAL_READER,
  SAL_SCOPED_A2,
  SAL_PERMISSION_ELSEWHERE,
  SAL_COMPANY_SCOPED,
  SAL_TENANT_B,
];

let admin: Pool;
let platformMethodId = '';

/** A platform payment-method id, read from the seeds rather than invented. */
export function platformPaymentMethodId(): string {
  if (platformMethodId === '') {
    throw new Error('establishP1_22Fixtures has not run, so no platform method is resolved');
  }
  return platformMethodId;
}

export function authAs(principal: Principal): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    })
  );
}

export async function countRowsOf(sql: string, values: readonly unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

/** Audit records for ONE action against ONE entity. Never a tenant-wide total. */
export function auditCountFor(action: string, entityId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
}

/** Outbox rows for ONE event key. The key embeds the aggregate id. */
export function outboxCountFor(eventKey: string): Promise<number> {
  return countRowsOf(`SELECT count(*)::text AS n FROM shared.event_outbox WHERE event_key = $1`, [
    eventKey,
  ]);
}

/**
 * Reserves a fixture tag, refusing a reuse.
 *
 * The tag is load-bearing rather than decorative: it becomes a checklist template
 * code (`uq_delivery_checklist_templates_code`) and an invoice idempotency key
 * (`uq_invoices_idempotency`), both unique. Catching a duplicate here names the
 * offending tag; catching it in PostgreSQL produces a `23505` from inside a fixture
 * and reads like a defect in the code under test.
 */
const claimedTags = new Set<string>();
function claimTag(tag: string): string {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(tag)) {
    throw new Error(
      `fixture tag "${tag}" must match ^[a-z][a-z0-9_]{1,40}$: it is used as a ` +
        'sal.delivery_checklist_templates.template_code, whose CHECK constraint is stricter ' +
        'than a test name'
    );
  }
  if (claimedTags.has(tag)) {
    throw new Error(`fixture tag "${tag}" was already used in this suite; tags must be unique`);
  }
  claimedTags.add(tag);
  return tag;
}

/** Runs `work` in one admin transaction with the actor and tenant GUCs set. */
async function inTenantTransaction<T>(
  tenantId: string,
  actorId: string,
  work: (client: {
    query: <R extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: R[]; rowCount: number | null }>;
  }) => Promise<T>
): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [actorId, tenantId]
    );
    const value = await work({
      query: <R extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) =>
        client.query<R>(sql, values === undefined ? undefined : [...values]),
    });
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-22 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-22 fixture',$4) ON CONFLICT (id) DO NOTHING`,
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

  // Its grant is COMPANY-scoped and built by hand below; `Principal.scope` can only
  // express a branch scope, and an unrestricted grant here would defeat H6 entirely.
  if (principal.userId === SAL_COMPANY_SCOPED.userId) return;

  if (principal.scope === undefined) {
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
    return;
  }
  // `tg_role_grants_require_scope` is DEFERRABLE, so a scoped grant and its scope
  // row have to land in ONE transaction.
  await scopedGrant({
    grantId: principal.grantId ?? '',
    tenantId: principal.tenantId,
    userId: principal.userId,
    roleId: principal.roleId,
    scopeType: 'branch',
    companyId: principal.scope.companyId,
    branchId: principal.scope.branchId,
  });
}

/** One scoped grant plus its single scope row, in one transaction. */
async function scopedGrant(input: {
  readonly grantId: string;
  readonly tenantId: string;
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
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [input.grantId, input.tenantId, input.userId, input.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.tenantId, input.grantId, input.scopeType, input.companyId, input.branchId, USER_A]
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

/** A role carrying only `WIDENING_PERMISSION`. It widens reach, never authority. */
async function seedWideningRole(roleId: string, code: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-22 widening',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, TENANT_A, code, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, roleId, USER_A, WIDENING_PERMISSION]
  );
}

/**
 * Provisions everything the two P1-22 suites share.
 *
 * Runs as the admin role with the actor GUC set wherever a trigger reads
 * `iam.current_user_id()`. Nothing executed here is ever evidence about runtime
 * behaviour: the admin login bypasses RLS.
 */
export async function establishP1_22Fixtures(pool: Pool): Promise<void> {
  admin = pool;

  // The catalogue rows, idempotently. `04_iam_permission_catalog.sql` already ships
  // all twelve; the insert exists so a database missing the seed still resolves what
  // the routes declare, and `ON CONFLICT DO NOTHING` means a seeded database sees no
  // drift.
  for (const [code, domain] of CATALOGUE) {
    await admin.query(
      `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
       VALUES ($1,$2,$3,'high',$4) ON CONFLICT (permission_code) DO NOTHING`,
      [code, domain, `P1-22 ${code}`, USER_A]
    );
  }

  // ---- H6: a second company in tenant A ------------------------------------
  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p1_22_company_a9','P1-22 Second Company','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A9, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'fx_p1_22_branch_a9','P1-22 Second Branch','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A9, TENANT_A, COMPANY_A9, USER_A]
  );

  for (const principal of P1_22_PRINCIPALS) await seedPrincipal(principal);

  // The widening grant for SAL_PERMISSION_ELSEWHERE: an unrelated permission scoped
  // to BRANCH_A1, so A1 is inside that user's `iam.allowed_branch_ids()` union
  // without any payment or warranty authority there. See the file header.
  await seedWideningRole(WIDENING_ROLE, 'fx_p1_22_widening');
  await scopedGrant({
    grantId: WIDENING_GRANT,
    tenantId: TENANT_A,
    userId: SAL_PERMISSION_ELSEWHERE.userId,
    roleId: WIDENING_ROLE,
    scopeType: 'branch',
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
  });

  // H6's principal: `scope_type = 'company'` on COMPANY_A1 — deliberately, and
  // uniquely among the P1-22 principals — plus an unrelated BRANCH grant on A9.
  await scopedGrant({
    grantId: COMPANY_SCOPED_GRANT,
    tenantId: TENANT_A,
    userId: SAL_COMPANY_SCOPED.userId,
    roleId: SAL_COMPANY_SCOPED.roleId,
    scopeType: 'company',
    companyId: COMPANY_A1,
    branchId: null,
  });
  await seedWideningRole(COMPANY_SCOPED_WIDENING_ROLE, 'fx_p1_22_widening_a9');
  await scopedGrant({
    grantId: COMPANY_SCOPED_WIDENING_GRANT,
    tenantId: TENANT_A,
    userId: SAL_COMPANY_SCOPED.userId,
    roleId: COMPANY_SCOPED_WIDENING_ROLE,
    scopeType: 'branch',
    companyId: COMPANY_A9,
    branchId: BRANCH_A9,
  });

  // ---- Numbering sequences --------------------------------------------------
  //
  // `shared.next_display_number` matches the scope EXACTLY
  // (`company_id IS NOT DISTINCT FROM p_company_id`) and has no fallback, so these
  // two rows provision (TENANT_A, COMPANY_A1, BRANCH_A1) and NOTHING else.
  //
  // BRANCH_A2, BRANCH_A9 and tenant B are deliberately left UNPROVISIONED: SB3 /
  // `P1-22-L-03` is that an unprovisioned `'receipt'` sequence must surface as a
  // configuration error rather than an invented receipt number, and that is only
  // testable if some in-scope company/branch pair genuinely has no sequence row.
  // Runtime holds no INSERT grant on `shared.number_sequences`, so the application
  // cannot self-heal it either.
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, company_id, branch_id, sequence_code, prefix_template, next_value,
        pad_width, period_reset_rule, created_by)
     VALUES ($1,$2,$3,'invoice','FXINV-',1,6,'never',$4),
            ($1,$2,$3,'receipt','FXRCT-',1,6,'never',$4)
     ON CONFLICT (tenant_id, sequence_code, company_id, branch_id) DO NOTHING`,
    [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
  );

  // ---- Payment methods ------------------------------------------------------
  await admin.query(
    `INSERT INTO sal.payment_methods
       (id, scope, tenant_id, method_code, kind, display_name, status, created_by)
     VALUES ($1,'tenant',$2,$3,'cash','P1-22 Cash','active',$7),
            ($4,'tenant',$2,$5,'card_terminal','P1-22 Retired terminal','inactive',$7),
            ($6,'tenant',$8,$9,'cash','P1-22 Cash (tenant B)','active',$7)
     ON CONFLICT (id) DO NOTHING`,
    [
      PAYMENT_METHOD_A,
      TENANT_A,
      PAYMENT_METHOD_A_CODE,
      PAYMENT_METHOD_A_INACTIVE,
      PAYMENT_METHOD_A_INACTIVE_CODE,
      PAYMENT_METHOD_B,
      USER_A,
      TENANT_B,
      PAYMENT_METHOD_B_CODE,
    ]
  );
  const platform = await admin.query<{ id: string }>(
    `SELECT id FROM sal.payment_methods
      WHERE scope = 'platform' AND method_code = 'cash' AND deleted_at IS NULL`
  );
  const resolvedPlatform = platform.rows[0]?.id;
  if (resolvedPlatform === undefined) {
    throw new Error(
      'no platform payment method is seeded, so the platform-method refusal cannot be proved'
    );
  }
  platformMethodId = resolvedPlatform;

  // ---- The signature document version ---------------------------------------
  //
  // Admin SQL and necessarily so: a real upload needs a signed storage URL and an
  // object actually written to it. What matters is that the row is the shape
  // `fk_delivery_signatures_version` points at — `(tenant_id, id)`. `accepted` is
  // deliberately NOT produced: no application role may write
  // `shared.file_scan_results`, so acceptance is unreachable and a fixture in that
  // state would be testing against something the platform cannot reach.
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ($1,'tenant',$2,'fx_p122_signatures','P1-22 delivery signatures',
             ARRAY['application/pdf']::text[], 5000000, 'internal', 'evidence-audit', $3)
     ON CONFLICT (id) DO NOTHING`,
    [SIG_CATEGORY, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, company_id, branch_id, category_id, title, classification,
        retention_class, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'P1-22 delivery signature','internal','evidence-audit','pending',$6)
     ON CONFLICT (id) DO NOTHING`,
    [SIG_DOCUMENT, TENANT_A, COMPANY_A1, BRANCH_A1, SIG_CATEGORY, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes,
        sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,'p122/sig/v1.pdf','application/pdf',2048,
             decode(repeat('ab',32),'hex'),$4,$4)
     ON CONFLICT (id) DO NOTHING`,
    [SIGNATURE_DOCUMENT_VERSION, TENANT_A, SIG_DOCUMENT, USER_A]
  );

  // ---- Warranty policies and coverage ---------------------------------------
  //
  // `ex_warranty_coverage_no_overlap` is per (tenant, company, policy, covered_scope),
  // so the two coverage rows below never collide: they hang off different policies.
  await inTenantTransaction(TENANT_A, USER_A, async (client) => {
    await client.query(
      `INSERT INTO wty.warranty_policies
         (id, tenant_id, company_id, policy_code, name, status, created_by)
       VALUES ($1,$2,$3,$4,'P1-22 active policy','active',$9),
              ($5,$2,$3,$6,'P1-22 archived policy','archived',$9),
              ($7,$2,$3,$8,'P1-22 policy without coverage','active',$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        POLICY_ACTIVE,
        TENANT_A,
        COMPANY_A1,
        POLICY_ACTIVE_CODE,
        POLICY_ARCHIVED,
        POLICY_ARCHIVED_CODE,
        POLICY_NO_COVERAGE,
        POLICY_NO_COVERAGE_CODE,
        USER_A,
      ]
    );
    await client.query(
      `INSERT INTO wty.warranty_coverage
         (id, tenant_id, company_id, policy_id, covered_scope, duration_months,
          odometer_limit, effective_from, effective_to, status, created_by)
       VALUES ($1,$2,$3,$4,'all',$6,$7::integer,$8::date,NULL,'active',$9),
              ($5,$2,$3,$10,'all',$6,$7::integer,$8::date,NULL,'active',$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        COVERAGE_ACTIVE,
        TENANT_A,
        COMPANY_A1,
        POLICY_ACTIVE,
        COVERAGE_ARCHIVED_POLICY,
        COVERAGE_DURATION_MONTHS,
        COVERAGE_ODOMETER_ALLOWANCE,
        COVERAGE_EFFECTIVE_FROM,
        USER_A,
        POLICY_ARCHIVED,
      ]
    );
  });
}

// ---------------------------------------------------------------------------
// Prerequisite-chain builders. Every one commits before it returns.
// ---------------------------------------------------------------------------

export interface WorkOrderChain {
  readonly tag: string;
  readonly vehicleId: string;
  readonly visitId: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
}

/**
 * A vehicle, an `authorized` reception visit and a work order.
 *
 * Delegates to `p1-19-helpers.createWorkOrder`, which drives the real
 * `POST /receptions/{id}/convert-to-work-order` route: P1-19's boundary claim is that
 * reception's conversion is the ONLY creation path for a work order, and a fixture
 * that inserted `wo.work_orders` itself would let this phase's assertions rest on a
 * shell no shipped code produces. It leaves the session authenticator set to P1-19's
 * privileged subject, so a test must call `authAs` again before the request it
 * asserts on.
 */
export async function seedWorkOrderChain(
  tag: string,
  options: { readonly companyId?: string; readonly branchId?: string } = {}
): Promise<WorkOrderChain> {
  const claimed = claimTag(tag);
  const created = await createWorkOrder({
    ...(options.companyId === undefined ? {} : { companyId: options.companyId }),
    ...(options.branchId === undefined ? {} : { branchId: options.branchId }),
  });
  return {
    tag: claimed,
    vehicleId: created.vehicleId,
    visitId: created.visitId,
    workOrderId: created.workOrderId,
    companyId: created.companyId,
    branchId: created.branchId,
  };
}

export interface IssuedInvoice {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly currencyCode: string;
  /** `sal.invoice_amounts.gross_total` as an exact decimal STRING. */
  readonly gross: string;
  readonly payerPartnerId: string;
  readonly workOrderId: string;
}

/**
 * An ISSUED invoice with one line.
 *
 * Built the way the protected schema demands rather than the way an application
 * would: a draft header, a line, its restricted line amount, then
 * `sal.issue_invoice`. `sal.guard_invoice_freeze` refuses an INSERT of a born-issued
 * row, so even a fixture has to take the draft -> issued transition — which is also
 * what writes `sal.invoice_amounts`, allocates the gapless number and emits the
 * `invoice_issued` completeness event the deferred trigger demands.
 *
 * The gross is READ BACK from `sal.invoice_amounts` rather than computed here: it is
 * money, and the only correct arithmetic on money in this codebase is PostgreSQL's.
 */
export async function seedIssuedInvoice(
  tag: string,
  options: {
    readonly net?: string;
    readonly tax?: string;
    readonly currency?: string;
    readonly payerPartnerId?: string;
  } = {}
): Promise<IssuedInvoice> {
  const chain = await seedWorkOrderChain(tag);
  const net = options.net ?? '100.0000';
  const tax = options.tax ?? '0.0000';
  const currency = options.currency ?? 'USD';
  const payer = options.payerPartnerId ?? PARTNER_A;

  return inTenantTransaction(TENANT_A, USER_A, async (client) => {
    const invoice = await client.query<{ id: string }>(
      `INSERT INTO sal.invoices
         (tenant_id, company_id, branch_id, work_order_id, payer_partner_id, currency_code,
          idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        TENANT_A,
        chain.companyId,
        chain.branchId,
        chain.workOrderId,
        payer,
        currency,
        `fx-p122-invoice-${chain.tag}`,
        USER_A,
      ]
    );
    const invoiceId = invoice.rows[0]?.id ?? '';
    const line = await client.query<{ id: string }>(
      `INSERT INTO sal.invoice_lines
         (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity,
          currency_code, created_by)
       VALUES ($1,$2,$3,$4,1,'service',1,$5,$6) RETURNING id`,
      [TENANT_A, chain.companyId, chain.branchId, invoiceId, currency, USER_A]
    );
    // gross = net + tax, and the whole gross is the customer's share: no protected
    // configuration anywhere determines a warranty contribution at invoice time, so
    // a non-zero `warranty_pay_amount` here would be an invented business fact.
    await client.query(
      `INSERT INTO sal.invoice_line_amounts
         (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price,
          net_amount, tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$6::numeric,$7::numeric,
               round($6::numeric + $7::numeric, 4), round($6::numeric + $7::numeric, 4),
               0, $8)`,
      [
        TENANT_A,
        chain.companyId,
        chain.branchId,
        line.rows[0]?.id ?? '',
        invoiceId,
        net,
        tax,
        USER_A,
      ]
    );
    const issued = await client.query<{ n: string }>(`SELECT sal.issue_invoice($1,NULL) AS n`, [
      invoiceId,
    ]);
    const totals = await client.query<{ gross_total: string }>(
      `SELECT gross_total::text AS gross_total FROM sal.invoice_amounts
        WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL`,
      [TENANT_A, invoiceId]
    );
    return {
      invoiceId,
      invoiceNumber: issued.rows[0]?.n ?? '',
      currencyCode: currency,
      gross: totals.rows[0]?.gross_total ?? '',
      payerPartnerId: payer,
      workOrderId: chain.workOrderId,
    };
  });
}

export interface SeededDelivery {
  readonly tag: string;
  readonly deliveryId: string;
  readonly workOrderId: string;
  readonly vehicleId: string;
  readonly visitId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly status: string;
  /** `veh.odometer_readings.id` the completion captured, or null when `ready`. */
  readonly finalOdometerReadingId: string | null;
  /** `sal.delivery_records.delivered_at::date` as text, or null when `ready`. */
  readonly deliveredOn: string | null;
}

/**
 * A delivery record with every `sal.complete_delivery` gate satisfied.
 *
 * The gates are the primitive's own — a verified authorized receiver, EVERY
 * company-mandatory checklist item passed, and at least one signature — and the
 * receiver is P1-19's fixture partner because `sal.guard_authorized_receiver` demands
 * an ACTIVE `rec.reception_party_roles` row on THIS delivery's visit, and
 * `rec.accept_check_in` created exactly one: `service_requester` for that partner.
 *
 * The checklist result is written for every mandatory item in the company that lacks
 * one, not just this delivery's own: `sal.complete_delivery` evaluates the whole
 * company's mandatory set, so a committed leftover from an earlier test in the same
 * run has to be satisfied too.
 *
 * `complete` is `false` for the `ready` fixture that proves an incomplete handover
 * cannot produce a warranty.
 */
export async function seedDelivery(
  tag: string,
  options: {
    readonly complete?: boolean;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly odometer?: string;
  } = {}
): Promise<SeededDelivery> {
  const chain = await seedWorkOrderChain(tag, {
    ...(options.companyId === undefined ? {} : { companyId: options.companyId }),
    ...(options.branchId === undefined ? {} : { branchId: options.branchId }),
  });
  const complete = options.complete ?? true;
  const odometer = options.odometer ?? DELIVERY_ODOMETER;

  return inTenantTransaction(TENANT_A, USER_A, async (client) => {
    const delivery = await client.query<{ id: string }>(
      `INSERT INTO sal.delivery_records
         (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
          delivering_employee_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [
        TENANT_A,
        chain.companyId,
        chain.branchId,
        chain.workOrderId,
        chain.visitId,
        chain.vehicleId,
        USER_A,
      ]
    );
    const deliveryId = delivery.rows[0]?.id ?? '';

    const template = await client.query<{ id: string }>(
      `INSERT INTO sal.delivery_checklist_templates
         (tenant_id, company_id, template_code, name, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [TENANT_A, chain.companyId, chain.tag, `P1-22 checklist ${chain.tag}`, USER_A]
    );
    await client.query(
      `INSERT INTO sal.delivery_checklist_template_items
         (tenant_id, company_id, template_id, item_code, label, is_mandatory, created_by)
       VALUES ($1,$2,$3,$4,$5,true,$6)`,
      [
        TENANT_A,
        chain.companyId,
        template.rows[0]?.id ?? '',
        chain.tag,
        `P1-22 mandatory item ${chain.tag}`,
        USER_A,
      ]
    );

    if (complete) {
      await client.query(
        `INSERT INTO sal.delivery_checklist_results
           (tenant_id, company_id, branch_id, delivery_record_id, template_item_id, outcome,
            recorded_by, created_by)
         SELECT $1,$2,$3,$4,ti.id,'passed',$5,$5
           FROM sal.delivery_checklist_template_items ti
          WHERE ti.tenant_id = $1 AND ti.company_id = $2 AND ti.is_mandatory
            AND ti.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM sal.delivery_checklist_results r
               WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
                 AND r.delivery_record_id = $4 AND r.template_item_id = ti.id)`,
        [TENANT_A, chain.companyId, chain.branchId, deliveryId, USER_A]
      );
      await client.query(
        `INSERT INTO sal.authorized_receivers
           (tenant_id, company_id, branch_id, delivery_record_id, receiver_partner_id,
            verified_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [TENANT_A, chain.companyId, chain.branchId, deliveryId, PARTNER_A, USER_A]
      );
      await client.query(
        `INSERT INTO sal.delivery_signatures
           (tenant_id, company_id, branch_id, delivery_record_id, signer_role,
            signature_document_version_id, created_by)
         VALUES ($1,$2,$3,$4,'receiver',$5,$6)`,
        [TENANT_A, chain.companyId, chain.branchId, deliveryId, SIGNATURE_DOCUMENT_VERSION, USER_A]
      );
      await client.query(`SELECT sal.complete_delivery($1,$2::numeric,'km',NULL) AS odo`, [
        deliveryId,
        odometer,
      ]);
    }

    const row = await client.query<{
      status: string;
      final_odometer_reading_id: string | null;
      delivered_on: string | null;
    }>(
      `SELECT status, final_odometer_reading_id, delivered_at::date::text AS delivered_on
         FROM sal.delivery_records WHERE id = $1`,
      [deliveryId]
    );
    return {
      tag: chain.tag,
      deliveryId,
      workOrderId: chain.workOrderId,
      vehicleId: chain.vehicleId,
      visitId: chain.visitId,
      companyId: chain.companyId,
      branchId: chain.branchId,
      status: row.rows[0]?.status ?? '',
      finalOdometerReadingId: row.rows[0]?.final_odometer_reading_id ?? null,
      deliveredOn: row.rows[0]?.delivered_on ?? null,
    };
  });
}

/** A `delivered` delivery — every gate satisfied, custody released, odometer captured. */
export function seedDeliveredDelivery(
  tag: string,
  options: { readonly companyId?: string; readonly branchId?: string } = {}
): Promise<SeededDelivery> {
  return seedDelivery(tag, { ...options, complete: true });
}

/** A `ready` delivery. Not delivered, so a warranty must be refused against it. */
export function seedReadyDelivery(tag: string): Promise<SeededDelivery> {
  return seedDelivery(tag, { complete: false });
}

// ---------------------------------------------------------------------------
// Read-back helpers. Admin reads — never RLS evidence.
// ---------------------------------------------------------------------------

/** `sal.invoice_open_receivable` as an exact decimal STRING. Never a number. */
export async function invoiceOpenReceivable(invoiceId: string): Promise<string> {
  const result = await admin.query<{ open: string }>(
    `SELECT sal.invoice_open_receivable($1)::text AS open`,
    [invoiceId]
  );
  return result.rows[0]?.open ?? '';
}

/** `sal.receipt_unallocated` as an exact decimal STRING. */
export async function receiptUnallocated(receiptId: string): Promise<string> {
  const result = await admin.query<{ remaining: string }>(
    `SELECT sal.receipt_unallocated($1)::text AS remaining`,
    [receiptId]
  );
  return result.rows[0]?.remaining ?? '';
}

export interface WarrantyTerms {
  readonly startDate: string;
  readonly expiryDate: string;
  readonly odometerAtIssue: string;
  readonly odometerLimit: string | null;
}

/**
 * The terms a warranty issued from this delivery MUST carry, derived in SQL.
 *
 * Derived rather than hard-coded, and derived by PostgreSQL rather than by
 * JavaScript: `expiry_date` is `start + duration_months` in the database's own
 * calendar arithmetic and `odometer_limit` is the RELATIVE coverage allowance added
 * to the ABSOLUTE reading at issue. A Node-side date computation would be a second
 * implementation of a contractual term, and a one-day drift there is a wrong
 * warranty document rather than a rounding detail.
 */
export async function expectedWarrantyTerms(
  deliveryId: string,
  coverageId: string
): Promise<WarrantyTerms> {
  const result = await admin.query<{
    start_date: string;
    expiry_date: string;
    odometer_at_issue: string;
    odometer_limit: string | null;
  }>(
    `SELECT d.delivered_at::date::text AS start_date,
            ((d.delivered_at::date + (c.duration_months || ' months')::interval)::date)::text
              AS expiry_date,
            o.value::integer::text AS odometer_at_issue,
            CASE WHEN c.odometer_limit IS NULL THEN NULL
                 ELSE (o.value::integer + c.odometer_limit)::text END AS odometer_limit
       FROM sal.delivery_records d
       JOIN veh.odometer_readings o
         ON o.tenant_id = d.tenant_id AND o.vehicle_id = d.vehicle_id
        AND o.id = d.final_odometer_reading_id
       JOIN wty.warranty_coverage c ON c.id = $2
      WHERE d.id = $1`,
    [deliveryId, coverageId]
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`delivery ${deliveryId} has no final odometer reading; the fixture changed`);
  }
  return {
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    odometerAtIssue: row.odometer_at_issue,
    odometerLimit: row.odometer_limit,
  };
}

/**
 * Removes the `sal`/`wty` rows this file's suites commit, in ONE transaction.
 *
 * The single transaction is the whole point, and it is not tidiness.
 * `tg_invoice_line_amounts_reconcile` is a DEFERRABLE CONSTRAINT trigger, so it fires
 * at COMMIT — and `cleanFixtures`/`deleteTenantCascade` run every DELETE on the
 * autocommitting admin pool, which would leave a transient "issued invoice whose
 * header totals no longer reconcile to its (now deleted) lines" state and abort the
 * teardown. Deleting the whole graph inside one transaction means the trigger only
 * ever sees the finished state, where the invoice is gone and the check
 * short-circuits.
 *
 * Call BEFORE `cleanBackendFixtures`. Children before parents throughout.
 */
export async function cleanP1_22Fixtures(): Promise<void> {
  const client = await admin.connect();
  const tenants = [TENANT_A, TENANT_B];
  try {
    await client.query('BEGIN');
    for (const table of [
      'wty.warranty_status_history',
      'wty.warranty_record_items',
      'wty.warranty_records',
      'wty.warranty_coverage',
      'wty.warranty_policies',
      'sal.financial_events',
      'sal.authorized_receivers',
      'sal.delivery_signatures',
      'sal.delivery_checklist_results',
      'sal.delivery_status_history',
      'sal.delivery_records',
      'sal.delivery_checklist_template_items',
      'sal.delivery_checklist_templates',
      'sal.payment_allocations',
      'sal.receipt_reversals',
      'sal.credit_notes',
      'sal.receipts',
      'sal.invoice_status_history',
      'sal.invoice_line_amounts',
      'sal.invoice_lines',
      'sal.invoice_amounts',
      'sal.invoice_numbering_configs',
      'sal.invoices',
      'sal.payment_methods',
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // COMPANY_A9, BRANCH_A9 and the three hand-built grants are deliberately NOT deleted
  // here. `deleteTenantCascade` (via `cleanBackendFixtures`) already removes
  // `iam.role_grants` — and `fk_grant_scopes_grant` is ON DELETE CASCADE, so the scope
  // rows leave with their grant rather than in a separate statement that would trip the
  // DEFERRABLE "a scoped active grant must carry at least one scope" trigger — and it
  // removes `org.branches` and `org.legal_companies` afterwards, in dependency order.
  //
  // Deleting the branch here instead is what an earlier revision did, and it FAILED:
  // the H6 fixtures build a reception visit in BRANCH_A9, and
  // `fk_walk_in_references_branch` still pointed at it because the `rec` rows are
  // unwound later in the cascade. The cascade already knows the order; duplicating half
  // of it out of sequence does not.
}

export { BRANCH_A1, BRANCH_A2, BRANCH_B1, COMPANY_A1, COMPANY_B1, PARTNER_A, TENANT_A, TENANT_B };
