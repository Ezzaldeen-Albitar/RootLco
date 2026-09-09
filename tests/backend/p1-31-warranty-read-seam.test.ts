/**
 * The warranty read seam (Phase 1-31, prerequisites P-6 and P-7).
 *
 * Two things are proved here and they are different in kind. **P-6** publishes
 * `GET /api/v1/warranties`, the chapter's second declared API, over a branch-wide
 * query that did not exist. **P-7** mints `wty.warranty.read` and re-points
 * `wty.warranty-detail` off `wty.warranty.issue` — a READ that was gated on the
 * authority to CREATE a warranty, which is a defect and not a convention.
 *
 * ## The permission claim is proved BEHAVIOURALLY, in both directions
 *
 * Asserting that a registration names a string proves only that somebody typed it.
 * Two principals decide the claim instead, and each is the counterfactual of the
 * other:
 *
 *   - `WTY_READ_ONLY` holds `wty.warranty.read` and NOTHING else. It could not have
 *     issued the warranty it reads — the arrangement is done by `SAL_FULL` through
 *     the real generation route and the authenticator is reset in between — so a
 *     200 from it is proof that the read no longer depends on a write code.
 *   - `WTY_ISSUE_ONLY` holds `wty.warranty.issue` and nothing else: yesterday's
 *     caller. It is REFUSED both reads with `ERR-IAM-001` naming
 *     `wty.warranty.read`, and it can still generate a warranty.
 *
 * Collapse the two codes back into one and both cases go red, in opposite
 * directions. That is the property a single assertion on `operation.permissions`
 * cannot have.
 *
 * ## No money, and that is a measurement rather than a promise
 *
 * `wty` has 80 columns and not one is an amount, a currency or a cap in any unit of
 * account, so a "covered value" would be a fabricated business fact.
 * `refusesAnyMoneyShapedNumber` walks every response for a JSON number under any
 * money-shaped key, and `odometerAtIssue` / `odometerLimit` are asserted to be exact
 * decimal STRINGS — they are distance readings, and a float is not available to them
 * either.
 *
 * ## What this file deliberately does NOT claim
 *
 * It does not touch a write path, an eligibility rule or the issue flow, and it does
 * not close **PPD-04 / P-10** (no warranty-policy writer exists; the fixtures still
 * seed policies and coverage by SQL) or the `wty.warranty_record_status_history`
 * reader, which no prerequisite in this slice names.
 *
 * COVERAGE-EVIDENCE (P1-31 warranty read seam):
 *   wty.warranty-list: route service authorization success denial cross-tenant isolation pagination
 *   wty.warranty-detail: route service authorization success denial cross-tenant isolation
 *
 * Neither declares an `audit` flag: both register `auditClass: 'none'`, so claiming
 * one would claim a record they do not write. Neither declares `idempotency` or
 * `stale-version` — they are reads, and neither is `idempotent` or `versionGuarded`.
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
import { BRANCH_A2, establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  COVERAGE_ACTIVE,
  COVERAGE_DURATION_MONTHS,
  COVERAGE_EFFECTIVE_FROM,
  COVERAGE_ODOMETER_ALLOWANCE,
  POLICY_ACTIVE,
  POLICY_ACTIVE_CODE,
  SAL_FULL,
  SAL_TENANT_B,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  expectedWarrantyTerms,
  seedDeliveredDelivery,
  type SeededDelivery,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { TENANT_ADMINISTRATOR_ROLE } from '@/modules/iam';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';
import { WARRANTY_LIST_OPERATION, GET as LIST_WARRANTIES } from '@/app/api/v1/warranties/route';
import {
  WARRANTY_DETAIL_OPERATION,
  GET as READ_WARRANTY,
} from '@/app/api/v1/warranties/[warrantyId]/route';

let admin: Pool;
let runtime: Pool;

/** The code this slice mints. Written once, used by every assertion below. */
const WARRANTY_READ = 'wty.warranty.read';
const WARRANTY_ISSUE = 'wty.warranty.issue';
const POLICY_MANAGE = 'wty.policy.manage';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

interface WarrantyListRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly workOrderId: string;
  readonly deliveryRecordId: string;
  readonly status: string;
  readonly startDate: string;
  readonly expiryDate: string;
  readonly odometerAtIssue: string;
  readonly odometerLimit: string | null;
  readonly policy: {
    readonly id: string;
    readonly policyCode: string;
    readonly name: string;
    readonly status: string;
  };
  readonly recordVersion: number;
}

interface WarrantyListBody {
  readonly items: readonly WarrantyListRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface WarrantyDetailBody extends WarrantyListRow {
  readonly coverage: { readonly id: string; readonly coveredScope: string };
  readonly items: readonly { readonly id: string; readonly itemKind: string }[];
  readonly replayed: boolean;
}

interface ProblemBody {
  readonly code: string;
  readonly status: number;
  readonly requiredPermissions?: readonly string[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const problemOf = (response: Response): Promise<ProblemBody> => bodyOf<ProblemBody>(response);

// ---------------------------------------------------------------------------
// Route invocation
// ---------------------------------------------------------------------------

function listWarranties(
  query: Record<string, string | number | undefined> = {}
): Promise<Response> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return LIST_WARRANTIES(new Request(`http://localhost/api/v1/warranties?${search.toString()}`));
}

const readWarranty = (warrantyId: string): Promise<Response> =>
  READ_WARRANTY(new Request(`http://localhost/api/v1/warranties/${warrantyId}`), {
    params: Promise.resolve({ warrantyId }),
  });

const generateWarranty = (deliveryId: string, policyId: string): Promise<Response> =>
  GENERATE_WARRANTY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/warranties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ policyId }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

// ---------------------------------------------------------------------------
// Principals minted by this file
//
// Each holds ONE code, so every refusal below is about that code and never about
// tenancy, scope or a second missing permission.
// ---------------------------------------------------------------------------

/** `wty.warranty.read` and nothing else. The principal P-7 exists for. */
const WTY_READ_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007a1',
  userId: 'f1310000-0000-4000-8000-0000000007a2',
  subject: 'fx_p1_31_wty_read_only',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ],
};

/** `wty.warranty.issue` and nothing else — the caller the old gate served. */
const WTY_ISSUE_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007b1',
  userId: 'f1310000-0000-4000-8000-0000000007b2',
  subject: 'fx_p1_31_wty_issue_only',
  tenantId: TENANT_A,
  permissions: [WARRANTY_ISSUE, 'wo.work_order.read', 'sal.delivery.view'],
};

/** `wty.policy.manage` and nothing else — the code the read must NOT borrow. */
const WTY_POLICY_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007c1',
  userId: 'f1310000-0000-4000-8000-0000000007c2',
  subject: 'fx_p1_31_wty_policy_only',
  tenantId: TENANT_A,
  permissions: [POLICY_MANAGE],
};

/** Tenant B, holding the read code. Its refusal is the tenant boundary. */
const WTY_READ_TENANT_B: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007d1',
  userId: 'f1310000-0000-4000-8000-0000000007d2',
  subject: 'fx_p1_31_wty_read_tenant_b',
  tenantId: TENANT_B,
  permissions: [WARRANTY_READ],
};

/**
 * Holds the read code, SCOPED to branch A2. RLS hides every A1 row from it.
 *
 * It has to hold `wty.warranty.read`, or its refusal would be the missing
 * permission rather than the branch boundary — which is exactly what the P1-22
 * principals would prove here, since none of them holds the code this slice minted.
 */
const WTY_READ_SCOPED_A2: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007e1',
  userId: 'f1310000-0000-4000-8000-0000000007e2',
  subject: 'fx_p1_31_wty_read_scoped_a2',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ],
};

/**
 * Scoped to A2 and holding the read code, with A1 inside its permission-blind
 * `iam.allowed_branch_ids()` union through an unrelated widening grant.
 *
 * The decisive isolation principal: A1's rows ARE visible to RLS for this caller,
 * so the only thing that can refuse an A1 request is the scoped permission check.
 */
const WTY_READ_ELSEWHERE: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000007f1',
  userId: 'f1310000-0000-4000-8000-0000000007f2',
  subject: 'fx_p1_31_wty_read_elsewhere',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ],
};

/** A role carrying one unrelated code. It widens reach, never authority. */
const WIDENING_ROLE = 'f1310000-0000-4000-8000-0000000007f3';
const WIDENING_PERMISSION = 'org.tenant.read';

const LOCAL_PRINCIPALS = [
  WTY_READ_ONLY,
  WTY_ISSUE_ONLY,
  WTY_POLICY_ONLY,
  WTY_READ_TENANT_B,
] as const;

/**
 * Seeds one principal's account, role, role-permission rows and unrestricted grant.
 *
 * The `role_permissions` insert JOINS `iam.permissions` on `permission_code`, so a
 * code absent from the seeded catalogue yields NO row and the principal silently
 * holds nothing. That is deliberate: if `wty.warranty.read` were missing from the
 * database this file would go red on the success case rather than passing while
 * proving nothing.
 */
async function seedAccountAndRole(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 warranty read-seam principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 warranty read-seam fixture',$4) ON CONFLICT (id) DO NOTHING`,
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

/** Account, role, permissions and an UNRESTRICTED grant. */
async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await seedAccountAndRole(principal);
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

/**
 * Seeds a principal's account, role and permission rows WITHOUT a grant, then binds
 * a scoped grant and its scope row in ONE transaction.
 *
 * One transaction because `tg_role_grants_require_scope` is DEFERRABLE: a scoped
 * grant with no scope row is refused at COMMIT, not at INSERT.
 */
async function bindScopedGrant(
  grantId: string,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly roleId: string;
    readonly companyId: string;
    readonly branchId: string;
  }
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [grantId]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO iam.role_grants
           (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [grantId, input.tenantId, input.userId, input.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes
           (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [input.tenantId, grantId, input.companyId, input.branchId, USER_A]
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

async function seedScopedPrincipal(
  principal: Principal,
  grantId: string,
  scope: { readonly companyId: string; readonly branchId: string }
): Promise<void> {
  await seedAccountAndRole(principal);
  await bindScopedGrant(grantId, {
    tenantId: principal.tenantId,
    userId: principal.userId,
    roleId: principal.roleId,
    companyId: scope.companyId,
    branchId: scope.branchId,
  });
}

/** A COMPANY_A9 policy and coverage, so a warranty can exist in a second branch. */
const A9_POLICY = 'f1310000-0000-4000-8000-000000000901';
const A9_POLICY_CODE = 'fx_p131_a9_policy';
const A9_COVERAGE = 'f1310000-0000-4000-8000-000000000902';

/**
 * Seeds the second branch's warranty configuration by SQL.
 *
 * By SQL because there is no writer: `wty.policy.manage` is declared by no operation
 * anywhere in the product (**PPD-04**, prerequisite P-10), which is a finding this
 * slice records and does not close. The P1-22 fixtures seed COMPANY_A1's policies
 * the same way and for the same reason.
 */
async function seedSecondBranchPolicy(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO wty.warranty_policies
         (id, tenant_id, company_id, policy_code, name, status, created_by)
       VALUES ($1,$2,$3,$4,'P1-31 second-branch policy','active',$5)
       ON CONFLICT (id) DO NOTHING`,
      [A9_POLICY, TENANT_A, COMPANY_A9, A9_POLICY_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO wty.warranty_coverage
         (id, tenant_id, company_id, policy_id, covered_scope, duration_months,
          odometer_limit, effective_from, effective_to, status, created_by)
       VALUES ($1,$2,$3,$4,'all',$5,$6::integer,$7::date,NULL,'active',$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        A9_COVERAGE,
        TENANT_A,
        COMPANY_A9,
        A9_POLICY,
        COVERAGE_DURATION_MONTHS,
        COVERAGE_ODOMETER_ALLOWANCE,
        COVERAGE_EFFECTIVE_FROM,
        USER_A,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Every code the fixture principals hold must actually be in the catalogue. */
async function heldPermissionCodes(principal: Principal): Promise<readonly string[]> {
  const rows = await admin.query<{ permission_code: string }>(
    `SELECT p.permission_code
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.tenant_id = $1 AND rp.role_id = $2
      ORDER BY 1`,
    [principal.tenantId, principal.roleId]
  );
  return rows.rows.map((row) => row.permission_code);
}

// ---------------------------------------------------------------------------
// Money guard
// ---------------------------------------------------------------------------

const MONEY_KEYS = Object.freeze([
  'amount',
  'currency',
  'price',
  'total',
  'cost',
  'balance',
  'value',
  'net',
  'gross',
  'tax',
]);

function refusesAnyMoneyShapedNumber(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) refusesAnyMoneyShapedNumber(entry);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number') {
      expect(MONEY_KEYS.some((money) => key.toLowerCase().includes(money))).toBe(false);
    }
    refusesAnyMoneyShapedNumber(entry);
  }
}

/** An exact decimal string — never a float, never an exponent. */
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Arrangement — real routes, then the authenticator is thrown away
// ---------------------------------------------------------------------------

interface ArrangedWarranty {
  readonly warrantyId: string;
  readonly delivery: SeededDelivery;
}

/**
 * Issues a warranty through `POST /deliveries/{id}/warranties` as `SAL_FULL`.
 *
 * Arranged through the product rather than by INSERT, because the claim under test
 * is that a warranty a workshop actually issued can be found again — not that a row
 * planted by the fixture can be selected.
 */
async function arrangeWarranty(tag: string): Promise<ArrangedWarranty> {
  const delivery = await seedDeliveredDelivery(tag);
  authAs(SAL_FULL);
  const response = await generateWarranty(delivery.deliveryId, POLICY_ACTIVE);
  if (response.status !== 201) {
    throw new Error(
      `arrangement for ${tag} failed with ${response.status}: ${await response.text()}`
    );
  }
  const body = await bodyOf<WarrantyDetailBody>(response);
  __resetAuthenticatorForTests();
  return { warrantyId: body.id, delivery };
}

let FIRST: ArrangedWarranty;
let SECOND: ArrangedWarranty;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  for (const principal of LOCAL_PRINCIPALS) await seedLocalPrincipal(principal);
  await seedScopedPrincipal(WTY_READ_SCOPED_A2, 'f1310000-0000-4000-8000-0000000007e3', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A2,
  });
  await seedScopedPrincipal(WTY_READ_ELSEWHERE, 'f1310000-0000-4000-8000-0000000007f4', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A2,
  });
  // The widening grant: one unrelated code scoped to BRANCH_A1, so A1 enters this
  // user's permission-blind branch union without any warranty authority there.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_31_widening','P1-31 widening',$3) ON CONFLICT (id) DO NOTHING`,
    [WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  await bindScopedGrant('f1310000-0000-4000-8000-0000000007f5', {
    tenantId: TENANT_A,
    userId: WTY_READ_ELSEWHERE.userId,
    roleId: WIDENING_ROLE,
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
  });
  await seedSecondBranchPolicy();
  FIRST = await arrangeWarranty('p131_wty_one');
  SECOND = await arrangeWarranty('p131_wty_two');
}, 240_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// P-7 — the minted code, and the re-point
// ---------------------------------------------------------------------------

describe('P-7 the minted read code', () => {
  it('is seeded once, in the wty domain, at low risk', async () => {
    const rows = await admin.query<{ domain: string; risk_level: string; description: string }>(
      `SELECT domain, risk_level, description FROM iam.permissions WHERE permission_code = $1`,
      [WARRANTY_READ]
    );
    // Exactly one row: the catalogue seed is the only shipping insert into
    // iam.permissions and it is idempotent, so a duplicate would mean a second
    // authority for the same name.
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.domain).toBe('wty');
    expect(rows.rows[0]?.risk_level).toBe('low');
    expect(rows.rows[0]?.description).toContain('warranty');
  });

  it('gates both warranty reads, and gates no write', () => {
    expect(WARRANTY_LIST_OPERATION.id).toBe('wty.warranty-list');
    expect(WARRANTY_DETAIL_OPERATION.id).toBe('wty.warranty-detail');
    for (const operation of [WARRANTY_LIST_OPERATION, WARRANTY_DETAIL_OPERATION]) {
      // The re-point, and the new declaration. `wty.warranty.issue` is the write
      // code the detail read used to carry; `wty.policy.manage` is the code the
      // route docblock refused to borrow because it grants coverage administration.
      expect(operation.permissions).toEqual([WARRANTY_READ]);
      expect(operation.permissions).not.toContain(WARRANTY_ISSUE);
      expect(operation.permissions).not.toContain(POLICY_MANAGE);
      expect(operation.method).toBe('GET');
      expect(operation.scope).toBe('branch');
      expect(operation.auditClass).toBe('none');
    }
  });

  it('is carried by the tenant administrator provisioning bundle (CC-07)', () => {
    // Withholding it while re-pointing the detail read would REMOVE a capability a
    // freshly provisioned administrator already has through `wty.warranty.issue`,
    // which is the one thing the CC-01/CC-02/CC-04 exclusions never do.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(WARRANTY_READ);
    // Nothing is withdrawn: `wty.warranty-generate` still declares the issue code.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(WARRANTY_ISSUE);
    // `wty.policy.manage` was still excluded when P-7 landed (CC-01). P-10
    // published the five operations that declare it on 2026-09-09 and carried it
    // into the bundle on CC-01's own terms, so the bundle holds it now. This
    // slice's claim is unaffected either way: the two reads declare
    // `wty.warranty.read`, and the case above proves a holder of ONLY
    // `wty.policy.manage` is refused them.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(POLICY_MANAGE);
    expect(new Set(TENANT_ADMINISTRATOR_ROLE.permissionCodes).size).toBe(
      TENANT_ADMINISTRATOR_ROLE.permissionCodes.length
    );
  });

  it('actually reaches the fixture principals, so a refusal below means something', async () => {
    expect(await heldPermissionCodes(WTY_READ_ONLY)).toEqual([WARRANTY_READ]);
    expect(await heldPermissionCodes(WTY_POLICY_ONLY)).toEqual([POLICY_MANAGE]);
    expect(await heldPermissionCodes(WTY_ISSUE_ONLY)).toContain(WARRANTY_ISSUE);
    expect(await heldPermissionCodes(WTY_ISSUE_ONLY)).not.toContain(WARRANTY_READ);
  });
});

describe('P-7 the read is no longer gated on a write code', () => {
  it('a principal holding ONLY wty.warranty.read reads a warranty it could not have issued', async () => {
    // The arrangement was performed by SAL_FULL and the authenticator was reset, so
    // this principal has no relationship to the write that created the row.
    authAs(WTY_READ_ONLY);
    const detail = await readWarranty(FIRST.warrantyId);
    expect(detail.status).toBe(200);
    const body = await bodyOf<WarrantyDetailBody>(detail);
    expect(body.id).toBe(FIRST.warrantyId);
    expect(body.deliveryRecordId).toBe(FIRST.delivery.deliveryId);

    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(list.status).toBe(200);
    const page = await bodyOf<WarrantyListBody>(list);
    expect(page.items.map((row) => row.id)).toContain(FIRST.warrantyId);
  });

  it('that principal can neither issue a warranty nor manage policy', async () => {
    authAs(WTY_READ_ONLY);
    const refused = await generateWarranty(SECOND.delivery.deliveryId, POLICY_ACTIVE);
    expect(refused.status).toBe(403);
    const problem = await problemOf(refused);
    expect(problem.code).toBe('ERR-IAM-001');
    // The registered code, named: the read code confers no authority to issue.
    expect(problem.requiredPermissions).toContain(WARRANTY_ISSUE);
    expect(problem.requiredPermissions).not.toContain(WARRANTY_READ);
    // And it holds no policy authority at all — `wty.policy.manage` is declared by
    // no operation in the product (PPD-04 / P-10), so the strongest available proof
    // is that the code is not held rather than that a route refuses it.
    expect(await heldPermissionCodes(WTY_READ_ONLY)).not.toContain(POLICY_MANAGE);
  });

  it('yesterday caller — wty.warranty.issue alone — is now REFUSED both reads', async () => {
    authAs(WTY_ISSUE_ONLY);
    for (const [label, response] of [
      ['detail', await readWarranty(FIRST.warrantyId)] as const,
      [
        'list',
        await listWarranties({
          companyId: FIRST.delivery.companyId,
          branchId: FIRST.delivery.branchId,
        }),
      ] as const,
    ]) {
      expect(response.status, label).toBe(403);
      const problem = await problemOf(response);
      expect(problem.code, label).toBe('ERR-IAM-001');
      expect(problem.requiredPermissions, label).toEqual([WARRANTY_READ]);
    }
  });

  it('and can still generate a warranty, so nothing was taken from the write path', async () => {
    const delivery = await seedDeliveredDelivery('p131_wty_issue_only');
    authAs(WTY_ISSUE_ONLY);
    const created = await generateWarranty(delivery.deliveryId, POLICY_ACTIVE);
    expect(created.status).toBe(201);
    expect((await bodyOf<WarrantyDetailBody>(created)).deliveryRecordId).toBe(delivery.deliveryId);
  });

  it('wty.policy.manage alone is refused both reads, so the read never borrows it', async () => {
    authAs(WTY_POLICY_ONLY);
    const detail = await readWarranty(FIRST.warrantyId);
    expect(detail.status).toBe(403);
    expect((await problemOf(detail)).requiredPermissions).toEqual([WARRANTY_READ]);
    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(list.status).toBe(403);
    expect((await problemOf(list)).requiredPermissions).toEqual([WARRANTY_READ]);
  });
});

// ---------------------------------------------------------------------------
// P-6 — the list itself
// ---------------------------------------------------------------------------

describe('P-6 GET /api/v1/warranties', () => {
  it('publishes the record fields and a resolvable policy, with no money anywhere', async () => {
    authAs(WTY_READ_ONLY);
    const response = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(response.status).toBe(200);
    const page = await bodyOf<WarrantyListBody>(response);
    const row = page.items.find((entry) => entry.id === FIRST.warrantyId);
    expect(row).toBeDefined();
    if (row === undefined) return;

    // Every term is compared against what PostgreSQL derives from the fixture rows,
    // never against a value this file computed: a one-day drift in a contractual
    // date is a wrong warranty document, not a rounding detail.
    const expected = await expectedWarrantyTerms(FIRST.delivery.deliveryId, COVERAGE_ACTIVE);
    expect(row.startDate).toBe(expected.startDate);
    expect(row.expiryDate).toBe(expected.expiryDate);
    expect(row.odometerAtIssue).toBe(expected.odometerAtIssue);
    expect(row.odometerLimit).toBe(expected.odometerLimit);
    expect(row.vehicleId).toBe(FIRST.delivery.vehicleId);
    expect(row.workOrderId).toBe(FIRST.delivery.workOrderId);
    expect(row.deliveryRecordId).toBe(FIRST.delivery.deliveryId);
    expect(row.status).toBe('issued');
    expect(row.recordVersion).toBeGreaterThan(0);

    // The policy travels resolved. No operation lists warranty policies (PPD-04 /
    // P-10), so a bare policyId would be an identifier nobody could resolve.
    expect(row.policy.id).toBe(POLICY_ACTIVE);
    expect(row.policy.policyCode).toBe(POLICY_ACTIVE_CODE);
    expect(row.policy.status).toBe('active');
    expect(row.policy.name.length).toBeGreaterThan(0);

    // Distance readings as exact decimal STRINGS, and no money-shaped number at all.
    expect(typeof row.odometerAtIssue).toBe('string');
    expect(row.odometerAtIssue).toMatch(DECIMAL_STRING);
    if (row.odometerLimit !== null) expect(row.odometerLimit).toMatch(DECIMAL_STRING);
    refusesAnyMoneyShapedNumber(page);
  });

  it('spells every shared field exactly as the detail read spells it', async () => {
    authAs(WTY_READ_ONLY);
    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    const row = (await bodyOf<WarrantyListBody>(list)).items.find(
      (entry) => entry.id === FIRST.warrantyId
    );
    const detail = await bodyOf<WarrantyDetailBody>(await readWarranty(FIRST.warrantyId));
    expect(row).toBeDefined();
    if (row === undefined) return;
    // One shape, not two. Every key the list publishes carries the detail read's own
    // value — including `odometerLimit`, which is the record's ABSOLUTE ceiling in
    // both and never the coverage's relative allowance.
    for (const key of Object.keys(row) as (keyof WarrantyListRow)[]) {
      expect({ key, value: row[key] }).toEqual({
        key,
        value: detail[key as keyof WarrantyDetailBody],
      });
    }
    // The list is a projection and stops there: coverage terms and covered items
    // belong to the detail read, which already publishes them.
    expect(Object.keys(row)).not.toContain('coverage');
    expect(Object.keys(row)).not.toContain('items');
    expect(Object.keys(row)).not.toContain('replayed');
  });

  it('is scoped by the SERVER on an unfiltered call, and never bleeds a branch', async () => {
    // A second company and branch inside the SAME tenant, so what separates the two
    // pages cannot be tenancy.
    const elsewhere = await seedDeliveredDelivery('p131_wty_a9', {
      companyId: COMPANY_A9,
      branchId: BRANCH_A9,
    });
    authAs(SAL_FULL);
    // A9's own policy. `POLICY_ACTIVE` belongs to COMPANY_A1 and generation answers
    // ERR-RES-001 for it here — which is itself the composite scope key doing its job.
    const created = await generateWarranty(elsewhere.deliveryId, A9_POLICY);
    expect(created.status).toBe(201);
    const foreignBranchWarranty = (await bodyOf<WarrantyDetailBody>(created)).id;
    __resetAuthenticatorForTests();

    authAs(WTY_READ_ONLY);
    const page = await bodyOf<WarrantyListBody>(
      await listWarranties({
        companyId: FIRST.delivery.companyId,
        branchId: FIRST.delivery.branchId,
        limit: 100,
      })
    );
    const ids = page.items.map((row) => row.id);
    expect(ids).toContain(FIRST.warrantyId);
    expect(ids).toContain(SECOND.warrantyId);
    // The unfiltered call returns the SERVER's scope and nothing wider.
    expect(ids).not.toContain(foreignBranchWarranty);
    for (const row of page.items) {
      expect(row.companyId).toBe(FIRST.delivery.companyId);
      expect(row.branchId).toBe(FIRST.delivery.branchId);
    }
  });

  it('filters by vehicle, and the filter actually filters', async () => {
    authAs(WTY_READ_ONLY);
    const filtered = await bodyOf<WarrantyListBody>(
      await listWarranties({
        companyId: FIRST.delivery.companyId,
        branchId: FIRST.delivery.branchId,
        vehicleId: FIRST.delivery.vehicleId,
      })
    );
    expect(filtered.items.map((row) => row.id)).toEqual([FIRST.warrantyId]);
    // The complement, so the assertion above cannot pass because the filter dropped
    // everything: the same list unfiltered carries the second warranty too.
    expect(SECOND.delivery.vehicleId).not.toBe(FIRST.delivery.vehicleId);
    const unfiltered = await bodyOf<WarrantyListBody>(
      await listWarranties({
        companyId: FIRST.delivery.companyId,
        branchId: FIRST.delivery.branchId,
        limit: 100,
      })
    );
    expect(unfiltered.items.map((row) => row.id)).toContain(SECOND.warrantyId);

    // A vehicle with no warranty is an empty page, not a 404.
    const none = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
      vehicleId: randomUUID(),
    });
    expect(none.status).toBe(200);
    expect((await bodyOf<WarrantyListBody>(none)).items).toEqual([]);
  });

  it('requires the scope target, and refuses an unknown parameter', async () => {
    authAs(WTY_READ_ONLY);
    const noScope = await listWarranties({});
    expect(noScope.status).toBe(422);
    expect((await problemOf(noScope)).code).toBe('ERR-VAL-001');

    const branchOnly = await listWarranties({ branchId: FIRST.delivery.branchId });
    expect(branchOnly.status).toBe(422);

    const unknown = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
      somethingElse: 'x',
    });
    // 422 and not a filter silently dropped: a caller who mistyped `vehicleId` and
    // was shown the whole branch would read the page as that vehicle's.
    expect(unknown.status).toBe(422);
    expect((await problemOf(unknown)).code).toBe('ERR-VAL-001');
  });

  it('401 unauthenticated, on both reads', async () => {
    __resetAuthenticatorForTests();
    expect(
      (
        await listWarranties({
          companyId: FIRST.delivery.companyId,
          branchId: FIRST.delivery.branchId,
        })
      ).status
    ).toBe(401);
    expect((await readWarranty(FIRST.warrantyId)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tenancy and scope
// ---------------------------------------------------------------------------

describe('another tenant learns nothing about existence', () => {
  it('is refused the list of a scope it does not hold, and told nothing about it', async () => {
    authAs(WTY_READ_TENANT_B);
    const response = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    // A refusal that is identical whether or not that branch has warranties — the
    // scope is refused before a row is read, so the answer carries no existence.
    expect(response.status).toBe(403);
    expect((await problemOf(response)).code).toBe('ERR-IAM-001');
  });

  it('is answered ERR-RES-001 for a real warranty id, never a 403', async () => {
    authAs(WTY_READ_TENANT_B);
    const response = await readWarranty(FIRST.warrantyId);
    // Not-found is decided BEFORE any scope decision, so a foreign tenant cannot
    // tell a real warranty id from an invented one.
    expect(response.status).toBe(404);
    expect((await problemOf(response)).code).toBe('ERR-RES-001');

    const invented = await readWarranty(randomUUID());
    expect(invented.status).toBe(404);
    expect((await problemOf(invented)).code).toBe('ERR-RES-001');
  });

  it('a tenant-B principal holding every sal/wty code, the read code included, still learns nothing', async () => {
    // `SAL_TENANT_B` holds the full sal/wty set INCLUDING `wty.warranty.read`, so
    // nothing about this refusal is a missing permission: it is tenancy, and it is
    // reported as an absent resource rather than as a forbidden one.
    authAs(SAL_TENANT_B);
    const response = await readWarranty(FIRST.warrantyId);
    expect(response.status).toBe(404);
    expect((await problemOf(response)).code).toBe('ERR-RES-001');
  });
});

describe('branch isolation, in both layers', () => {
  it('404 from RLS when the caller is scoped to another branch', async () => {
    // Holds `wty.warranty.read`, so this refusal cannot be the permission.
    authAs(WTY_READ_SCOPED_A2);
    const response = await readWarranty(FIRST.warrantyId);
    expect(response.status).toBe(404);
    expect((await problemOf(response)).code).toBe('ERR-RES-001');
  });

  it('403 from authorizeScope when RLS can see the row but the grant is elsewhere', async () => {
    // The decisive case, and it is decisive only on the DETAIL read. That request
    // carries no scope target, so the pre-handler evaluates the permission
    // SCOPE-BLIND through `iam.has_permission` and this caller — which holds
    // `wty.warranty.read` in A2 — passes it. Its widening grant puts BRANCH_A1
    // inside the permission-blind `iam.allowed_branch_ids()` union, so RLS returns
    // the row too. The in-service `authorizeScope` on the row's OWN company and
    // branch is therefore the only guard left, and deleting that call turns this
    // 403 into a 200.
    authAs(WTY_READ_ELSEWHERE);
    const detail = await readWarranty(FIRST.warrantyId);
    expect(detail.status).toBe(403);
    expect((await problemOf(detail)).code).toBe('ERR-IAM-001');

    // And on the list, where the caller NAMES the scope: the target is refused
    // before any row is read, so a client-asserted pair is never authoritative.
    const list = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    });
    expect(list.status).toBe(403);
    expect((await problemOf(list)).code).toBe('ERR-IAM-001');
  });
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

describe('the list pages', () => {
  it('pages disjointly over two warranties that share a start_date', async () => {
    // Both fixtures were delivered inside this run, so `start_date` — the sort key —
    // is the SAME calendar day for both. The `id` tie-break is the only thing making
    // the order total, which is exactly the case a sort-value-only cursor loses.
    expect(FIRST.delivery.deliveredOn).toBe(SECOND.delivery.deliveredOn);

    authAs(WTY_READ_ONLY);
    const scope = {
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    };

    // Walked one row at a time to exhaustion rather than sampled two pages: the
    // property under test is that the cursor loses nothing and repeats nothing over
    // the WHOLE set, and a two-page sample cannot see a row dropped at page five.
    const walked: string[] = [];
    const startDates: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response: Response = await listWarranties({
        ...scope,
        limit: 1,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(response.status).toBe(200);
      const page: WarrantyListBody = await bodyOf<WarrantyListBody>(response);
      expect(page.items).toHaveLength(1);
      const row = page.items[0];
      if (row !== undefined) {
        walked.push(row.id);
        startDates.push(row.startDate);
      }
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
      pages += 1;
      // A cursor that never advanced would otherwise spin for ever, which is a
      // failure mode a fixed two-page assertion cannot tell apart from success.
      expect(pages).toBeLessThan(50);
    } while (cursor !== null);

    // Nothing repeated and nothing skipped: the walk is exactly the branch live
    // warranty rows as the database holds them.
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toContain(FIRST.warrantyId);
    expect(walked).toContain(SECOND.warrantyId);
    const actual = await admin.query<{ id: string }>(
      `SELECT id FROM wty.warranty_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 AND deleted_at IS NULL`,
      [TENANT_A, FIRST.delivery.companyId, FIRST.delivery.branchId]
    );
    expect([...walked].sort()).toEqual(actual.rows.map((r) => r.id).sort());

    // And the walk really did cross a tie: at least two rows share the `start_date`
    // the cursor sorts on, so the `id` tie-break was load-bearing rather than
    // incidental.
    expect(new Set(startDates).size).toBeLessThan(startDates.length);
  });

  it('refuses a malformed cursor and an oversized page, differently', async () => {
    authAs(WTY_READ_ONLY);
    const scope = {
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
    };
    const badCursor = await listWarranties({ ...scope, cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect((await problemOf(badCursor)).code).toBe('ERR-PAG-001');

    const oversized = await listWarranties({ ...scope, limit: 5000 });
    expect(oversized.status).toBe(422);
    expect((await problemOf(oversized)).code).toBe('ERR-VAL-001');
  });

  it('refuses a cursor minted for a different list', async () => {
    // The ordering contract's key is part of the cursor, so a cursor cannot be spent
    // on a list it was not minted for.
    authAs(WTY_READ_ONLY);
    const crossed = await listWarranties({
      companyId: FIRST.delivery.companyId,
      branchId: FIRST.delivery.branchId,
      cursor: Buffer.from(
        JSON.stringify({ k: 'sal.receipts:received_at_desc', v: '2026-01-01', i: randomUUID() })
      ).toString('base64url'),
    });
    expect(crossed.status).toBe(400);
    expect((await problemOf(crossed)).code).toBe('ERR-PAG-001');
  });
});
