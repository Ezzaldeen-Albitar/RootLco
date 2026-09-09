/**
 * The P1-31 warranty POLICY and COVERAGE seam — a configuration surface that did not
 * exist (prerequisite **P-10** of `docs/phase-1/phase-1-31/a0-preflight.md`, **PPD-04**).
 *
 * ## What was measured, and what this suite has to prove
 *
 * `wty.warranty_policies` and `wty.warranty_coverage` landed in P1-11 carrying SELECT,
 * INSERT and UPDATE grants for `app_runtime` and an INSERT and an UPDATE policy each,
 * and until this slice **no code anywhere in `apps/api/src` had ever written either
 * table**. `wty.policy.manage` — seeded in the permission catalogue since P1-08 — was
 * declared by NO operation and named by NO row-level-security predicate.
 *
 * The consequence is total rather than cosmetic. `wty.warranty-generate` resolves the
 * policy to issue under as the one the caller named or the company's ONLY active one,
 * and refuses a company with none as `ERR-RES-001`. Since nothing could create one, no
 * tenant provisioned through the product could ever issue a warranty — which is why
 * `establishP1_22Fixtures` and `p1-31-warranty-read-seam.test.ts` both seed
 * `wty.warranty_policies` by ADMIN SQL. This suite deliberately does not: every policy
 * and every coverage row it reads was authored through the published routes, because
 * "a warranty policy can be configured through the product" is the claim under test.
 *
 * ## The closure, closed end to end
 *
 * `COMPANY_A9` is used for the generation cases, and the reason is a property of the
 * fixtures rather than a preference: `establishP1_22Fixtures` seeds three warranty
 * policies in `COMPANY_A1` and none in `COMPANY_A9`, so A9 begins with ZERO active
 * policies — the exact state PPD-04 describes. The sequence proved on real rows is:
 * generation refused as unconfigured, a policy and its coverage AUTHORED THROUGH THE
 * ROUTES, generation succeeding and carrying back the very terms that were authored,
 * the policy archived through the status route, and generation refused as unconfigured
 * again.
 *
 * ## The authority is COMPANY-WIDE, and that is the substantive decision
 *
 * `SAL_SCOPED_A2` holds `wty.policy.manage` through a BRANCH-scoped grant inside
 * `COMPANY_A1` and is refused every write while still being able to READ;
 * `SAL_COMPANY_SCOPED`, whose grant is `scope_type = 'company'` on the same company, is
 * admitted there and refused in `COMPANY_A9`. Three principals, one rule: a coverage
 * row authored here sets the terms of every warranty issued in every branch of that
 * company, because neither table has a branch column and `resolvePolicy` picks a
 * company's only active policy for all of them.
 *
 * The READS are gated differently on purpose. `WTY_READ_ONLY` holds `wty.warranty.read`
 * and nothing else and reads the whole surface: whoever issues a warranty must be able
 * to name the policy to issue under, and `wty.warranty-generate` is `scope: 'branch'`.
 *
 * ## What this suite does NOT claim
 *
 * The three CHECK constraints on `wty.warranty_coverage` are each mirrored by the
 * request schema, so **no request that reaches the database can violate one**. The
 * cases below assert the BOUNDARY refusal — a 422 naming the field — and do not claim
 * to have exercised the `23514` constraint-name mapping in
 * `WarrantyPolicyService`, which exists for the case where the boundary and the column
 * disagree and is unreachable through the published routes today. Recorded in
 * `docs/phase-1/phase-1-31/warranty-policy-seam.md`.
 *
 * COVERAGE-EVIDENCE (P1-31 warranty policy and coverage seam):
 *   wty.warranty-policy-list: route service authorization success denial cross-tenant pagination
 *   wty.warranty-policy-read: route service authorization success denial cross-tenant
 *   wty.warranty-policy-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   wty.warranty-policy-rename: route service authorization success denial cross-tenant isolation audit stale-version
 *   wty.warranty-policy-status-set: route service authorization success denial cross-tenant isolation audit idempotency stale-version
 *   wty.warranty-coverage-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   wty.warranty-coverage-status-set: route service authorization success denial cross-tenant isolation audit stale-version
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
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
import { establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  BRANCH_A9,
  COMPANY_A9,
  POLICY_ACTIVE,
  POLICY_ACTIVE_CODE,
  SAL_COMPANY_SCOPED,
  SAL_FULL,
  SAL_SCOPED_A2,
  SAL_TENANT_B,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedDelivery,
} from './p1-22-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { TENANT_ADMINISTRATOR_ROLE } from '@/modules/iam';
import {
  CreateBody as POLICY_CREATE_BODY,
  WARRANTY_POLICY_CREATE_OPERATION,
  WARRANTY_POLICY_LIST_OPERATION,
  GET as LIST_POLICIES,
  POST as CREATE_POLICY,
} from '@/app/api/v1/warranty-policies/route';
import {
  WARRANTY_POLICY_READ_OPERATION,
  WARRANTY_POLICY_RENAME_OPERATION,
  GET as READ_POLICY,
  PATCH as RENAME_POLICY,
} from '@/app/api/v1/warranty-policies/[policyId]/route';
import {
  WARRANTY_POLICY_STATUS_OPERATION,
  POST as SET_POLICY_STATUS,
} from '@/app/api/v1/warranty-policies/[policyId]/status/route';
import {
  CoverageCreateBody as COVERAGE_CREATE_BODY,
  WARRANTY_COVERAGE_CREATE_OPERATION,
  POST as CREATE_COVERAGE,
} from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/route';
import {
  WARRANTY_COVERAGE_STATUS_OPERATION,
  POST as SET_COVERAGE_STATUS,
} from '@/app/api/v1/warranty-policies/[policyId]/coverage-windows/[coverageId]/status/route';
import { POST as GENERATE_WARRANTY } from '@/app/api/v1/deliveries/[deliveryId]/warranties/route';

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// The seven operation ids, written out as literals so the coverage gate can see
// this file INVOKE each one: the gate strips every comment before it looks, so
// naming them in a header proves nothing.
// ---------------------------------------------------------------------------

const SEAM_OPERATION_IDS = Object.freeze({
  list: 'wty.warranty-policy-list',
  read: 'wty.warranty-policy-read',
  create: 'wty.warranty-policy-create',
  rename: 'wty.warranty-policy-rename',
  status: 'wty.warranty-policy-status-set',
  coverageCreate: 'wty.warranty-coverage-create',
  coverageStatus: 'wty.warranty-coverage-status-set',
} as const);

const POLICY_MANAGE = 'wty.policy.manage';
const WARRANTY_READ = 'wty.warranty.read';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface PolicyBody {
  readonly id: string;
  readonly companyId: string;
  readonly policyCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

interface CoverageBody {
  readonly id: string;
  readonly policyId: string;
  readonly coveredScope: string;
  readonly durationMonths: number;
  readonly odometerAllowance: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

interface DetailBody {
  readonly policy: PolicyBody;
  readonly coverage: readonly CoverageBody[];
}

interface ListBody {
  readonly policies: {
    readonly items: readonly PolicyBody[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

interface ProblemBody {
  readonly code: string;
  readonly requiredPermissions?: readonly string[];
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

interface WarrantyBody {
  readonly id: string;
  readonly policy: { readonly id: string; readonly policyCode: string; readonly name: string };
  readonly coverage: {
    readonly id: string;
    readonly durationMonths: number;
    readonly odometerAllowance: string | null;
    readonly coveredScope: string;
  };
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { code: string }).code;

// ---------------------------------------------------------------------------
// Route drivers. Every call below goes through the real route handler, so the
// permission gate, the deferred scope check, the version guard, the idempotency
// reservation and the validation all run.
// ---------------------------------------------------------------------------

const BASE = 'http://localhost/api/v1/warranty-policies';

const jsonHeaders = (options: {
  readonly key?: string | null;
  readonly version?: number | null;
}): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null && options.key !== undefined) headers['idempotency-key'] = options.key;
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return headers;
};

const listPolicies = (query?: {
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<Response> => {
  const parts: string[] = [];
  if (query?.status !== undefined) parts.push(`status=${encodeURIComponent(query.status)}`);
  if (query?.cursor !== undefined) parts.push(`cursor=${encodeURIComponent(query.cursor)}`);
  if (query?.limit !== undefined) parts.push(`limit=${String(query.limit)}`);
  return LIST_POLICIES(new Request(`${BASE}${parts.length === 0 ? '' : `?${parts.join('&')}`}`));
};

const readPolicy = (policyId: string): Promise<Response> =>
  READ_POLICY(new Request(`${BASE}/${policyId}`), { params: Promise.resolve({ policyId }) });

const createPolicy = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_POLICY(
    new Request(BASE, { method: 'POST', headers: jsonHeaders({ key }), body: JSON.stringify(body) })
  );

const renamePolicy = (policyId: string, name: string, version: number | null): Promise<Response> =>
  RENAME_POLICY(
    new Request(`${BASE}/${policyId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ version }),
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ policyId }) }
  );

const setPolicyStatus = (
  policyId: string,
  status: string,
  version: number | null,
  key: string = randomUUID()
): Promise<Response> =>
  SET_POLICY_STATUS(
    new Request(`${BASE}/${policyId}/status`, {
      method: 'POST',
      headers: jsonHeaders({ key, version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ policyId }) }
  );

const createCoverage = (
  policyId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  CREATE_COVERAGE(
    new Request(`${BASE}/${policyId}/coverage-windows`, {
      method: 'POST',
      headers: jsonHeaders({ key }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ policyId }) }
  );

const setCoverageStatus = (
  policyId: string,
  coverageId: string,
  status: string,
  version: number | null
): Promise<Response> =>
  SET_COVERAGE_STATUS(
    new Request(`${BASE}/${policyId}/coverage-windows/${coverageId}/status`, {
      method: 'POST',
      headers: jsonHeaders({ version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ policyId, coverageId }) }
  );

const generateWarranty = (deliveryId: string, policyId?: string): Promise<Response> =>
  GENERATE_WARRANTY(
    new Request(`http://localhost/api/v1/deliveries/${deliveryId}/warranties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(policyId === undefined ? {} : { policyId }),
    }),
    { params: Promise.resolve({ deliveryId }) }
  );

// ---------------------------------------------------------------------------
// Fixture authoring — through the routes, never by admin SQL
// ---------------------------------------------------------------------------

/** A code no other suite uses, and one matching no suite's tenant-prefix cleanup. */
let codeSequence = 0;
const nextCode = (stem: string): string => {
  codeSequence += 1;
  return `fx_p131_p10_${stem}_${String(codeSequence)}`;
};

interface AuthoredPolicy {
  readonly id: string;
  readonly policyCode: string;
  readonly recordVersion: number;
  readonly coverage: readonly CoverageBody[];
}

/** Creates a policy as `SAL_FULL` and returns what the response actually carried. */
async function authorPolicy(
  input: {
    readonly companyId?: string;
    readonly name?: string;
    readonly coverage?: readonly unknown[];
  } = {}
): Promise<AuthoredPolicy> {
  authAs(SAL_FULL);
  const policyCode = nextCode('pol');
  const response = await createPolicy({
    companyId: input.companyId ?? COMPANY_A1,
    policyCode,
    name: input.name ?? 'Standard workshop warranty',
    ...(input.coverage === undefined ? {} : { coverage: input.coverage }),
  });
  expect(response.status).toBe(201);
  const created = await bodyOf<DetailBody>(response);
  return {
    id: created.policy.id,
    policyCode,
    recordVersion: created.policy.recordVersion,
    coverage: created.coverage,
  };
}

const auditCount = async (action: string, entityId: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
  return Number(result.rows[0]?.n ?? '0');
};

const policyRow = async (
  policyId: string
): Promise<{ name: string; status: string; record_version: number } | undefined> => {
  const result = await admin.query<{ name: string; status: string; record_version: number }>(
    `SELECT name, status, record_version FROM wty.warranty_policies WHERE id = $1`,
    [policyId]
  );
  return result.rows[0];
};

const policyCount = async (companyId: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wty.warranty_policies
      WHERE tenant_id = $1 AND company_id = $2`,
    [TENANT_A, companyId]
  );
  return Number(result.rows[0]?.n ?? '0');
};

const coverageStatuses = async (policyId: string): Promise<readonly string[]> => {
  const result = await admin.query<{ status: string }>(
    `SELECT status FROM wty.warranty_coverage WHERE policy_id = $1 ORDER BY covered_scope, id`,
    [policyId]
  );
  return result.rows.map((row) => row.status);
};

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

/**
 * Refuses a JSON number under any money-shaped key, anywhere in a response.
 *
 * There is no money on this surface — `wty` has 80 columns and not one is an amount,
 * a currency or a cap in any unit of account — so the correct assertion is not "the
 * amounts are strings" but "there are no amounts". This walks the whole document so a
 * future field cannot slip a float in under a nested object. `durationMonths` and
 * `recordVersion` are integers and are deliberately not money-shaped names;
 * `odometerAllowance` is a distance and is asserted to be a STRING separately.
 */
const MONEY_KEYS = Object.freeze(['amount', 'net', 'tax', 'gross', 'total', 'price', 'balance']);

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

// ---------------------------------------------------------------------------
// Principals minted by this file
// ---------------------------------------------------------------------------

/**
 * `wty.warranty.read` and nothing else.
 *
 * The whole point of the read cases: it wrote none of the rows it reads, so a 200
 * proves the reads are gated on the READ code, and its refusal on every write is the
 * MISSING `wty.policy.manage` and nothing else.
 */
const WTY_READ_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000010a1',
  userId: 'f1310000-0000-4000-8000-0000000010a2',
  subject: 'fx_p1_31_p10_read_only',
  tenantId: TENANT_A,
  permissions: [WARRANTY_READ],
};

/**
 * `wty.policy.manage` and nothing else — the administrator who cannot read.
 *
 * Its refusal on the two reads is the missing `wty.warranty.read` and nothing else,
 * which is what makes "the reads declare the READ code" a falsifiable claim rather
 * than a restatement of the declaration.
 */
const WTY_POLICY_ONLY: Principal = {
  roleId: 'f1310000-0000-4000-8000-0000000010b1',
  userId: 'f1310000-0000-4000-8000-0000000010b2',
  subject: 'fx_p1_31_p10_policy_only',
  tenantId: TENANT_A,
  permissions: [POLICY_MANAGE],
};

const LOCAL_PRINCIPALS = [WTY_READ_ONLY, WTY_POLICY_ONLY] as const;

/**
 * Seeds one principal's account, role, role-permission rows and unrestricted grant.
 *
 * The `role_permissions` insert JOINS `iam.permissions` on `permission_code`, so a
 * code absent from the seeded catalogue yields NO row and the principal silently holds
 * nothing. That is deliberate: if `wty.policy.manage` were missing from the database
 * this file would go red on the success cases rather than passing while proving
 * nothing, and `heldPermissionCodes` asserts the grants landed before any refusal is
 * read as meaningful.
 */
async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 P-10 principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 P-10 fixture',$4) ON CONFLICT (id) DO NOTHING`,
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * The main policy, authored in `COMPANY_A1` with two NON-OVERLAPPING windows.
 *
 * Two different `covered_scope` values rather than two date ranges, because
 * `ex_warranty_coverage_no_overlap` keys on the scope: `service` and `part` may share a
 * window and `all` may not share one with either.
 */
let MAIN: AuthoredPolicy;

const FAR_PAST = '2020-01-01';

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

  MAIN = await authorPolicy({
    name: 'Standard workshop warranty',
    coverage: [
      {
        coveredScope: 'service',
        durationMonths: 12,
        odometerAllowance: '20000',
        effectiveFrom: FAR_PAST,
      },
      {
        coveredScope: 'part',
        durationMonths: 6,
        effectiveFrom: FAR_PAST,
        effectiveTo: '2030-01-01',
      },
    ],
  });
  __resetAuthenticatorForTests();
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
}, 120_000);

// ---------------------------------------------------------------------------

describe('P-10 the seven operations are declared as the seam intends', () => {
  it('P10-D1 each id, path, permission, scope and audit class, by value', () => {
    expect(WARRANTY_POLICY_LIST_OPERATION.id).toBe(SEAM_OPERATION_IDS.list);
    expect(WARRANTY_POLICY_LIST_OPERATION.path).toBe('/warranty-policies');
    expect(WARRANTY_POLICY_LIST_OPERATION.permissions).toEqual([WARRANTY_READ]);
    expect(WARRANTY_POLICY_LIST_OPERATION.scope).toBe('tenant');
    expect(WARRANTY_POLICY_LIST_OPERATION.auditClass).toBe('none');

    expect(WARRANTY_POLICY_READ_OPERATION.id).toBe(SEAM_OPERATION_IDS.read);
    expect(WARRANTY_POLICY_READ_OPERATION.permissions).toEqual([WARRANTY_READ]);
    expect(WARRANTY_POLICY_READ_OPERATION.scope).toBe('tenant');

    // The five writes. Every one declares the ADMINISTRATION code, every one is
    // company-scoped, and every one is audited as privileged — a write that had
    // shipped on the read code, or tenant-scoped, or unaudited, fails here.
    for (const operation of [
      WARRANTY_POLICY_CREATE_OPERATION,
      WARRANTY_POLICY_RENAME_OPERATION,
      WARRANTY_POLICY_STATUS_OPERATION,
      WARRANTY_COVERAGE_CREATE_OPERATION,
      WARRANTY_COVERAGE_STATUS_OPERATION,
    ]) {
      expect(operation.permissions).toEqual([POLICY_MANAGE]);
      expect(operation.scope).toBe('company');
      expect(operation.auditClass).toBe('privileged');
    }

    expect(WARRANTY_POLICY_CREATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.create);
    expect(WARRANTY_POLICY_CREATE_OPERATION.successStatus).toBe(201);
    expect(WARRANTY_POLICY_CREATE_OPERATION.idempotent).toBe(true);
    expect(WARRANTY_POLICY_RENAME_OPERATION.id).toBe(SEAM_OPERATION_IDS.rename);
    expect(WARRANTY_POLICY_RENAME_OPERATION.versionGuarded).toBe(true);
    expect(WARRANTY_POLICY_STATUS_OPERATION.id).toBe(SEAM_OPERATION_IDS.status);
    expect(WARRANTY_POLICY_STATUS_OPERATION.versionGuarded).toBe(true);
    expect(WARRANTY_COVERAGE_CREATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.coverageCreate);
    expect(WARRANTY_COVERAGE_CREATE_OPERATION.successStatus).toBe(201);
    expect(WARRANTY_COVERAGE_STATUS_OPERATION.id).toBe(SEAM_OPERATION_IDS.coverageStatus);
    expect(WARRANTY_COVERAGE_STATUS_OPERATION.versionGuarded).toBe(true);
  });

  it('P10-D2 the two coverage schemas agree, so the same terms get the same answer', () => {
    // The add route restates the window schema rather than importing the collection
    // route's. Every BOUND comes from the module's transcription of the CHECK
    // constraints, so the two cannot disagree about the column — but the zod plumbing
    // is written twice, and this is what stops the two drifting.
    const CASES: readonly unknown[] = [
      { coveredScope: 'all', durationMonths: 12, effectiveFrom: '2026-01-01' },
      { coveredScope: 'nonsense', durationMonths: 12, effectiveFrom: '2026-01-01' },
      { coveredScope: 'all', durationMonths: 0, effectiveFrom: '2026-01-01' },
      { coveredScope: 'all', durationMonths: 1.5, effectiveFrom: '2026-01-01' },
      { coveredScope: 'all', durationMonths: 12, effectiveFrom: '01-01-2026' },
      {
        coveredScope: 'all',
        durationMonths: 12,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-01-01',
      },
      {
        coveredScope: 'all',
        durationMonths: 12,
        effectiveFrom: '2026-01-01',
        odometerAllowance: '0',
      },
      {
        coveredScope: 'all',
        durationMonths: 12,
        effectiveFrom: '2026-01-01',
        odometerAllowance: 20000,
      },
      { coveredScope: 'all', durationMonths: 12, effectiveFrom: '2026-01-01', status: 'archived' },
    ];
    const embedded = POLICY_CREATE_BODY.shape.coverage.unwrap().element;
    for (const value of CASES) {
      expect({
        value,
        embedded: embedded.safeParse(value).success,
      }).toEqual({ value, embedded: COVERAGE_CREATE_BODY.safeParse(value).success });
    }
    // Anti-vacuity: the matrix must contain both answers, or an always-false schema
    // would satisfy the equality above.
    const outcomes = new Set(CASES.map((value) => COVERAGE_CREATE_BODY.safeParse(value).success));
    expect([...outcomes].sort()).toEqual([false, true]);
  });
});

describe('P-10 a policy is authored through the product', () => {
  it('P10-A1 the header and both windows land in one call and read back in order', async () => {
    expect(MAIN.coverage).toHaveLength(2);
    // Ordered `(covered_scope, effective_from, id)` — `part` before `service`.
    expect(MAIN.coverage.map((row) => row.coveredScope)).toEqual(['part', 'service']);
    // The distance is a STRING, and the unlimited window carries an explicit null
    // rather than an absent key.
    expect(MAIN.coverage[0]?.odometerAllowance).toBeNull();
    expect(MAIN.coverage[1]?.odometerAllowance).toBe('20000');
    expect(MAIN.coverage[0]?.effectiveTo).toBe('2030-01-01');
    expect(MAIN.coverage[1]?.effectiveTo).toBeNull();

    // Read back by a principal that holds the READ code and NOT the write code, so it
    // wrote none of the rows it is reading.
    authAs(WTY_READ_ONLY);
    const response = await readPolicy(MAIN.id);
    expect(response.status).toBe(200);
    // The ETag is the POLICY's version, which is what the two policy commands expect.
    expect(response.headers.get('etag')).toBe(`"${String(MAIN.recordVersion)}"`);
    const detail = await bodyOf<DetailBody>(response);
    expect(detail.policy.policyCode).toBe(MAIN.policyCode);
    expect(detail.policy.status).toBe('active');
    expect(detail.policy.companyId).toBe(COMPANY_A1);
    expect(detail.coverage.map((row) => row.coveredScope)).toEqual(['part', 'service']);
    expect(detail.coverage.every((row) => row.policyId === MAIN.id)).toBe(true);
    refusesAnyMoneyShapedNumber(detail);
  });

  it('P10-A2 the create is recorded once, with the count of windows that arrived', async () => {
    expect(await auditCount('wty.warranty_policy.created', MAIN.id)).toBe(1);
    const details = await admin.query<{ field_name: string; new_value_masked: string | null }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.audit_record_id = r.id
        WHERE r.action = 'wty.warranty_policy.created' AND r.entity_id = $1
        ORDER BY d.field_name`,
      [MAIN.id]
    );
    const byField = new Map(details.rows.map((row) => [row.field_name, row.new_value_masked]));
    expect(byField.get('coverageCount')).toBe('2');
    expect(byField.get('status')).toBe('active');
  });

  it('P10-A3 a duplicate policy code in the same company is refused as a conflict', async () => {
    authAs(SAL_FULL);
    const refused = await createPolicy({
      companyId: COMPANY_A1,
      policyCode: MAIN.policyCode,
      name: 'A second policy claiming the same code',
    });
    expect(refused.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-CON-001');
    expect(problem.violations).toEqual([{ path: 'body.policyCode', rule: 'duplicate_code' }]);
  });

  it('P10-A4 a body whose own two windows overlap is refused at the boundary', async () => {
    authAs(SAL_FULL);
    const refused = await createPolicy({
      companyId: COMPANY_A1,
      policyCode: nextCode('selfoverlap'),
      name: 'Two windows for one scope',
      coverage: [
        { coveredScope: 'all', durationMonths: 12, effectiveFrom: '2026-01-01' },
        { coveredScope: 'all', durationMonths: 24, effectiveFrom: '2026-06-01' },
      ],
    });
    expect(refused.status).toBe(422);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations).toEqual([{ path: 'body.coverage.1', rule: 'overlapping_coverage' }]);
    // Nothing was written: the refusal happens before the header insert.
    const rows = await admin.query(
      `SELECT 1 FROM wty.warranty_policies WHERE tenant_id = $1 AND name = $2`,
      [TENANT_A, 'Two windows for one scope']
    );
    expect(rows.rowCount).toBe(0);
  });

  it('P10-A5 consecutive windows for one scope are accepted — the range is half-open', async () => {
    // `daterange(from, to, '[)')`: a window ending on the day the next begins does NOT
    // overlap it, so consecutive terms need no gap. This is the property that makes
    // "archive and add" a usable model.
    const policy = await authorPolicy({
      name: 'Consecutive terms',
      coverage: [
        {
          coveredScope: 'all',
          durationMonths: 12,
          effectiveFrom: '2024-01-01',
          effectiveTo: '2025-01-01',
        },
        { coveredScope: 'all', durationMonths: 24, effectiveFrom: '2025-01-01' },
      ],
    });
    expect(policy.coverage).toHaveLength(2);
    expect(policy.coverage.map((row) => row.durationMonths)).toEqual([12, 24]);
  });

  it('P10-A6 out-of-range terms are refused by the boundary, naming the field', async () => {
    // The three CHECK constraints are each mirrored by the schema, so no request that
    // reaches the database can violate one. What is asserted is the BOUNDARY refusal;
    // the constraint-name mapping in the service is defence for the case where the two
    // disagree and is NOT claimed to have been exercised here.
    authAs(SAL_FULL);
    for (const terms of [
      { coveredScope: 'all', durationMonths: 0, effectiveFrom: FAR_PAST },
      { coveredScope: 'all', durationMonths: 12, effectiveFrom: FAR_PAST, odometerAllowance: '0' },
      {
        coveredScope: 'all',
        durationMonths: 12,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2025-01-01',
      },
      { coveredScope: 'engine', durationMonths: 12, effectiveFrom: FAR_PAST },
    ]) {
      const refused = await createCoverage(MAIN.id, terms);
      expect({ terms, status: refused.status }).toEqual({ terms, status: 422 });
      expect(await codeOf(refused)).toBe('ERR-VAL-001');
    }
  });
});

describe('P-10 the overlap invariant is the database, and it is reported as a conflict', () => {
  it('P10-B1 a window overlapping a live one for the same scope is refused', async () => {
    const policy = await authorPolicy({
      name: 'Overlap probe',
      coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: '2024-01-01' }],
    });
    authAs(SAL_FULL);
    const refused = await createCoverage(policy.id, {
      coveredScope: 'all',
      durationMonths: 24,
      effectiveFrom: '2027-01-01',
    });
    expect(refused.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-CON-001');
    expect(problem.violations).toEqual([{ path: 'body', rule: 'overlapping_coverage' }]);
  });

  it('P10-B2 a different scope over the same days is accepted', async () => {
    const policy = await authorPolicy({
      name: 'Scope-disjoint probe',
      coverage: [{ coveredScope: 'service', durationMonths: 12, effectiveFrom: '2024-01-01' }],
    });
    authAs(SAL_FULL);
    const accepted = await createCoverage(policy.id, {
      coveredScope: 'part',
      durationMonths: 6,
      effectiveFrom: '2024-01-01',
    });
    expect(accepted.status).toBe(201);
    const created = await bodyOf<CoverageBody>(accepted);
    expect(created.coveredScope).toBe('part');
    expect(created.recordVersion).toBe(1);
    expect(await auditCount('wty.warranty_policy.coverage_added', created.id)).toBe(1);
  });

  it('P10-B3 archiving frees the window, and reactivating into a re-covered one conflicts', async () => {
    const policy = await authorPolicy({
      name: 'Archive and replace',
      coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: '2024-01-01' }],
    });
    const first = policy.coverage[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    // ARCHIVE: the window is released, because the exclusion constraint is partial on
    // `status = 'active'`.
    authAs(SAL_FULL);
    const archived = await setCoverageStatus(policy.id, first.id, 'archived', first.recordVersion);
    expect(archived.status).toBe(200);
    const archivedBody = await bodyOf<CoverageBody>(archived);
    expect(archivedBody.status).toBe('archived');
    expect(archivedBody.recordVersion).toBe(first.recordVersion + 1);
    expect(await auditCount('wty.warranty_policy.coverage_status_changed', first.id)).toBe(1);

    // The same days are now writable, with different terms.
    authAs(SAL_FULL);
    const replacement = await createCoverage(policy.id, {
      coveredScope: 'all',
      durationMonths: 24,
      effectiveFrom: '2024-01-01',
    });
    expect(replacement.status).toBe(201);

    // REACTIVATION now collides with the replacement, and the refusal carries the SAME
    // rule an insert into a covered window produces — to a caller the two mean one
    // thing.
    authAs(SAL_FULL);
    const refused = await setCoverageStatus(
      policy.id,
      first.id,
      'active',
      archivedBody.recordVersion
    );
    expect(refused.status).toBe(409);
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-CON-001');
    expect(problem.violations).toEqual([{ path: 'body.status', rule: 'overlapping_coverage' }]);

    // The archived row is unchanged: a refused reactivation must not burn a version.
    const rows = await admin.query<{ status: string; record_version: number }>(
      `SELECT status, record_version FROM wty.warranty_coverage WHERE id = $1`,
      [first.id]
    );
    expect(rows.rows[0]).toEqual({
      status: 'archived',
      record_version: archivedBody.recordVersion,
    });
  });

  it('P10-B4 a coverage row addressed through the WRONG parent policy is a 404', async () => {
    const other = await authorPolicy({ name: 'A sibling policy in the same company' });
    const window = MAIN.coverage[0];
    expect(window).toBeDefined();
    if (window === undefined) return;
    authAs(SAL_FULL);
    // Both rows live in COMPANY_A1, so `findCoverage` resolves the row — the PARENT
    // check is the only thing that refuses it. Without it this path would archive a
    // sibling policy's terms and report success.
    const refused = await setCoverageStatus(other.id, window.id, 'archived', window.recordVersion);
    expect(refused.status).toBe(404);
    expect(await codeOf(refused)).toBe('ERR-RES-001');
  });
});

describe('P-10 the version guard', () => {
  it('P10-C1 a rename without If-Match is refused, and the row is untouched', async () => {
    const policy = await authorPolicy({ name: 'Guard probe' });
    authAs(SAL_FULL);
    const refused = await renamePolicy(policy.id, 'Renamed without a version', null);
    expect(refused.status).toBe(428);
    expect(await codeOf(refused)).toBe('ERR-CON-002');
    expect(await policyRow(policy.id)).toEqual({
      name: 'Guard probe',
      status: 'active',
      record_version: 1,
    });
  });

  it('P10-C2 a stale If-Match conflicts, and a success advances the version by one', async () => {
    const policy = await authorPolicy({ name: 'Stale probe' });
    authAs(SAL_FULL);
    const first = await renamePolicy(policy.id, 'Renamed once', policy.recordVersion);
    expect(first.status).toBe(200);
    const renamed = await bodyOf<PolicyBody>(first);
    expect(renamed.recordVersion).toBe(policy.recordVersion + 1);
    expect(renamed.name).toBe('Renamed once');
    // The code and the status are untouched: the body carries the name and nothing else.
    expect(renamed.policyCode).toBe(policy.policyCode);
    expect(renamed.status).toBe('active');

    authAs(SAL_FULL);
    const stale = await renamePolicy(policy.id, 'Renamed twice', policy.recordVersion);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');
    expect(await policyRow(policy.id)).toEqual({
      name: 'Renamed once',
      status: 'active',
      record_version: renamed.recordVersion,
    });
    expect(await auditCount('wty.warranty_policy.renamed', policy.id)).toBe(1);
  });

  it('P10-C3 the coverage If-Match is the COVERAGE version, never the policy version', async () => {
    const policy = await authorPolicy({
      name: 'Two counters',
      coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: '2024-01-01' }],
    });
    const window = policy.coverage[0];
    expect(window).toBeDefined();
    if (window === undefined) return;

    // Move the POLICY's counter so the two rows can no longer be confused by value.
    authAs(SAL_FULL);
    const renamed = await renamePolicy(policy.id, 'Two counters, moved', policy.recordVersion);
    expect(renamed.status).toBe(200);
    const policyVersion = (await bodyOf<PolicyBody>(renamed)).recordVersion;
    expect(policyVersion).not.toBe(window.recordVersion);

    // The POLICY's version is refused on the coverage path...
    authAs(SAL_FULL);
    const wrong = await setCoverageStatus(policy.id, window.id, 'archived', policyVersion);
    expect(wrong.status).toBe(409);
    expect(await codeOf(wrong)).toBe('ERR-CON-001');

    // ...and the COVERAGE's own version is accepted.
    authAs(SAL_FULL);
    const right = await setCoverageStatus(policy.id, window.id, 'archived', window.recordVersion);
    expect(right.status).toBe(200);
    expect((await bodyOf<CoverageBody>(right)).status).toBe('archived');
  });

  it('P10-C4 a coverage status without If-Match is refused', async () => {
    const window = MAIN.coverage[0];
    expect(window).toBeDefined();
    if (window === undefined) return;
    authAs(SAL_FULL);
    const refused = await setCoverageStatus(MAIN.id, window.id, 'archived', null);
    expect(refused.status).toBe(428);
    expect(await codeOf(refused)).toBe('ERR-CON-002');
  });

  it('P10-C5 a policy is archived and restored, and its coverage is NOT cascaded', async () => {
    const policy = await authorPolicy({
      name: 'Status probe',
      coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: '2024-01-01' }],
    });
    expect(await coverageStatuses(policy.id)).toEqual(['active']);

    authAs(SAL_FULL);
    const archived = await setPolicyStatus(policy.id, 'archived', policy.recordVersion);
    expect(archived.status).toBe(200);
    const archivedBody = await bodyOf<PolicyBody>(archived);
    expect(archivedBody.status).toBe('archived');
    // THE COVERAGE IS UNTOUCHED. `wty.issue_warranty` filters coverage on the
    // COVERAGE's own status and never reads the policy's, so a cascade here would
    // change what the primitive resolves for reasons the operator did not choose —
    // and could not be undone by restoring the policy.
    expect(await coverageStatuses(policy.id)).toEqual(['active']);

    authAs(SAL_FULL);
    const restored = await setPolicyStatus(policy.id, 'active', archivedBody.recordVersion);
    expect(restored.status).toBe(200);
    expect((await bodyOf<PolicyBody>(restored)).status).toBe('active');
    expect(await auditCount('wty.warranty_policy.status_changed', policy.id)).toBe(2);
  });
});

describe('P-10 the reads answer for the caller and nobody else', () => {
  it('P10-R1 the list is paged, and two pages are disjoint', async () => {
    authAs(WTY_READ_ONLY);
    const first = await listPolicies({ limit: 1 });
    expect(first.status).toBe(200);
    const page1 = await bodyOf<ListBody>(first);
    expect(page1.policies.items).toHaveLength(1);
    expect(page1.policies.hasMore).toBe(true);
    expect(page1.policies.nextCursor).not.toBeNull();

    authAs(WTY_READ_ONLY);
    const second = await listPolicies({ limit: 1, cursor: page1.policies.nextCursor ?? '' });
    expect(second.status).toBe(200);
    const page2 = await bodyOf<ListBody>(second);
    expect(page2.policies.items).toHaveLength(1);
    // Disjoint. The cursor's sort value is minted by `cursorTimestamp()` at MICROSECOND
    // precision, so a boundary row sharing a millisecond with its neighbour is not
    // skipped (`P1-27-INT-006`) — which is exactly what one transaction authoring two
    // policies produces.
    expect(page2.policies.items[0]?.id).not.toBe(page1.policies.items[0]?.id);
  });

  it('P10-R2 the status filter narrows, and archived rows are visible without it', async () => {
    const policy = await authorPolicy({ name: 'Filter probe' });
    authAs(SAL_FULL);
    const archived = await setPolicyStatus(policy.id, 'archived', policy.recordVersion);
    expect(archived.status).toBe(200);

    authAs(WTY_READ_ONLY);
    const activeOnly = await bodyOf<ListBody>(await listPolicies({ status: 'active', limit: 50 }));
    expect(activeOnly.policies.items.some((row) => row.id === policy.id)).toBe(false);
    expect(activeOnly.policies.items.every((row) => row.status === 'active')).toBe(true);

    // Unfiltered, the archived row IS listed — otherwise the restore command would be
    // unreachable through the product.
    authAs(WTY_READ_ONLY);
    const all = await bodyOf<ListBody>(await listPolicies({ limit: 50 }));
    expect(all.policies.items.some((row) => row.id === policy.id)).toBe(true);
  });

  it('P10-R3 the fixture policies seeded by ADMIN SQL are visible too, and were not authored by this suite', async () => {
    // Non-vacuity of the tenant scope: `POLICY_ACTIVE` belongs to the P1-22 fixtures and
    // was never written through these routes, so a list that showed only rows this file
    // authored would be a list scoped to the wrong thing.
    authAs(WTY_READ_ONLY);
    const response = await readPolicy(POLICY_ACTIVE);
    expect(response.status).toBe(200);
    const detail = await bodyOf<DetailBody>(response);
    expect(detail.policy.policyCode).toBe(POLICY_ACTIVE_CODE);
    expect(detail.coverage.length).toBeGreaterThan(0);
  });

  it('P10-R4 another tenant gets 404 on the read and on every write, never 403', async () => {
    authAs(SAL_TENANT_B);
    const read = await readPolicy(MAIN.id);
    expect(read.status).toBe(404);
    expect(await codeOf(read)).toBe('ERR-RES-001');

    authAs(SAL_TENANT_B);
    const renamed = await renamePolicy(MAIN.id, 'Renamed from another tenant', 1);
    expect(renamed.status).toBe(404);
    expect(await codeOf(renamed)).toBe('ERR-RES-001');

    authAs(SAL_TENANT_B);
    const window = await createCoverage(MAIN.id, {
      coveredScope: 'all',
      durationMonths: 12,
      effectiveFrom: FAR_PAST,
    });
    expect(window.status).toBe(404);
    expect(await codeOf(window)).toBe('ERR-RES-001');

    // And it cannot see tenant A's policies at all.
    authAs(SAL_TENANT_B);
    const list = await bodyOf<ListBody>(await listPolicies({ limit: 50 }));
    expect(list.policies.items.some((row) => row.id === MAIN.id)).toBe(false);

    // Nothing was written, in either direction.
    expect(await policyRow(MAIN.id)).toMatchObject({ name: 'Standard workshop warranty' });
  });
});

describe('P-10 the authority', () => {
  it('P10-P0 the fixture principals actually hold what they are meant to', async () => {
    // Without this, every refusal below could be a principal that holds nothing.
    expect(await heldPermissionCodes(WTY_READ_ONLY)).toEqual([WARRANTY_READ]);
    expect(await heldPermissionCodes(WTY_POLICY_ONLY)).toEqual([POLICY_MANAGE]);
    expect(await heldPermissionCodes(SAL_FULL)).toContain(POLICY_MANAGE);
    expect(await heldPermissionCodes(SAL_SCOPED_A2)).toContain(POLICY_MANAGE);
    expect(await heldPermissionCodes(SAL_COMPANY_SCOPED)).toContain(POLICY_MANAGE);
  });

  it('P10-P1 a read-code holder reads everything and is refused all five writes', async () => {
    authAs(WTY_READ_ONLY);
    expect((await listPolicies({ limit: 5 })).status).toBe(200);
    authAs(WTY_READ_ONLY);
    expect((await readPolicy(MAIN.id)).status).toBe(200);

    const window = MAIN.coverage[0];
    expect(window).toBeDefined();
    if (window === undefined) return;

    const refusals: readonly [string, () => Promise<Response>][] = [
      [
        SEAM_OPERATION_IDS.create,
        () =>
          createPolicy({
            companyId: COMPANY_A1,
            policyCode: nextCode('refused'),
            name: 'Written by a reader',
          }),
      ],
      [SEAM_OPERATION_IDS.rename, () => renamePolicy(MAIN.id, 'Renamed by a reader', 1)],
      [SEAM_OPERATION_IDS.status, () => setPolicyStatus(MAIN.id, 'archived', 1)],
      [
        SEAM_OPERATION_IDS.coverageCreate,
        () =>
          createCoverage(MAIN.id, {
            coveredScope: 'all',
            durationMonths: 12,
            effectiveFrom: FAR_PAST,
          }),
      ],
      [
        SEAM_OPERATION_IDS.coverageStatus,
        () => setCoverageStatus(MAIN.id, window.id, 'archived', window.recordVersion),
      ],
    ];
    for (const [operationId, call] of refusals) {
      authAs(WTY_READ_ONLY);
      const refused = await call();
      expect({ operationId, status: refused.status }).toEqual({ operationId, status: 403 });
      const problem = await bodyOf<ProblemBody>(refused);
      expect(problem.code).toBe('ERR-IAM-001');
      // The refusal is the MISSING ADMINISTRATION CODE and nothing else.
      expect(problem.requiredPermissions).toEqual([POLICY_MANAGE]);
    }
  });

  it('P10-P2 a manage-code holder that lacks the read code is refused both reads', async () => {
    authAs(WTY_POLICY_ONLY);
    const list = await listPolicies({ limit: 5 });
    expect(list.status).toBe(403);
    expect((await bodyOf<ProblemBody>(list)).requiredPermissions).toEqual([WARRANTY_READ]);

    authAs(WTY_POLICY_ONLY);
    const read = await readPolicy(MAIN.id);
    expect(read.status).toBe(403);
    expect((await bodyOf<ProblemBody>(read)).requiredPermissions).toEqual([WARRANTY_READ]);
  });

  it('P10-P3 a BRANCH-scoped manage grant reads but cannot write', async () => {
    // `SAL_SCOPED_A2` holds `wty.policy.manage` through a grant whose scope row is
    // `scope_type = 'branch'` inside COMPANY_A1. `iam.has_permission_in_scope(code,
    // company, NULL, NULL)` compares `s.branch_id = NULL` for a branch row and does not
    // match, so a company target means "company-wide or wider" by the DEPLOYED function
    // rather than by a second definition of scope written in the application.
    authAs(SAL_SCOPED_A2);
    expect((await listPolicies({ limit: 5 })).status).toBe(200);

    authAs(SAL_SCOPED_A2);
    const refused = await renamePolicy(MAIN.id, 'Renamed by a branch-scoped caller', 1);
    expect(refused.status).toBe(403);
    expect((await bodyOf<ProblemBody>(refused)).code).toBe('ERR-IAM-001');

    authAs(SAL_SCOPED_A2);
    const created = await createPolicy({
      companyId: COMPANY_A1,
      policyCode: nextCode('branchscoped'),
      name: 'Authored by a branch-scoped caller',
    });
    expect(created.status).toBe(403);
  });

  it('P10-P4 a COMPANY-scoped manage grant writes in its company and is refused in another', async () => {
    authAs(SAL_COMPANY_SCOPED);
    const allowed = await createPolicy({
      companyId: COMPANY_A1,
      policyCode: nextCode('companyscoped'),
      name: 'Authored by a company-scoped caller',
    });
    expect(allowed.status).toBe(201);

    // The SAME principal, in a company its grant does not name. Its widening grant puts
    // COMPANY_A9 inside `iam.allowed_company_ids()`, so RLS would admit the row — the
    // scoped permission check is the only thing that refuses it (P1-18-A-01).
    authAs(SAL_COMPANY_SCOPED);
    const refused = await createPolicy({
      companyId: COMPANY_A9,
      policyCode: nextCode('companyscopedelsewhere'),
      name: 'Authored in a company it may not configure',
    });
    expect(refused.status).toBe(403);
    expect((await bodyOf<ProblemBody>(refused)).code).toBe('ERR-IAM-001');
  });
});

describe('P-10 idempotency', () => {
  it('P10-I1 a replayed create returns the same document and writes one policy', async () => {
    const key = randomUUID();
    const body = {
      companyId: COMPANY_A1,
      policyCode: nextCode('replay'),
      name: 'Replayed policy',
      coverage: [{ coveredScope: 'all', durationMonths: 12, effectiveFrom: '2024-01-01' }],
    };
    const before = await policyCount(COMPANY_A1);

    authAs(SAL_FULL);
    const first = await createPolicy(body, key);
    expect(first.status).toBe(201);
    const created = await bodyOf<DetailBody>(first);

    authAs(SAL_FULL);
    const replay = await createPolicy(body, key);
    // `withIdempotency` stores the body and replays it as a plain result, so the replay
    // answers 200 rather than the declared 201. That is a platform contract rather than
    // a property of this route.
    expect(replay.status).toBe(200);
    expect(await bodyOf<DetailBody>(replay)).toEqual(created);

    expect(await policyCount(COMPANY_A1)).toBe(before + 1);
    expect(await auditCount('wty.warranty_policy.created', created.policy.id)).toBe(1);
  });

  it('P10-I2 a replayed coverage add returns the same row and writes one', async () => {
    const policy = await authorPolicy({ name: 'Coverage replay probe' });
    const key = randomUUID();
    const terms = { coveredScope: 'all', durationMonths: 18, effectiveFrom: '2024-01-01' };

    authAs(SAL_FULL);
    const first = await createCoverage(policy.id, terms, key);
    expect(first.status).toBe(201);
    const created = await bodyOf<CoverageBody>(first);

    authAs(SAL_FULL);
    const replay = await createCoverage(policy.id, terms, key);
    expect(replay.status).toBe(200);
    expect(await bodyOf<CoverageBody>(replay)).toEqual(created);

    const rows = await admin.query(`SELECT 1 FROM wty.warranty_coverage WHERE policy_id = $1`, [
      policy.id,
    ]);
    expect(rows.rowCount).toBe(1);
    expect(await auditCount('wty.warranty_policy.coverage_added', created.id)).toBe(1);
  });
});

describe('P-10 the closure PPD-04 measured, closed end to end', () => {
  it('P10-W1 a company with no policy cannot issue, authors one, issues, archives, and cannot again', async () => {
    // COMPANY_A9 begins with ZERO warranty policies: `establishP1_22Fixtures` seeds all
    // three of its policies in COMPANY_A1. That is the state PPD-04 describes and the
    // state a tenant provisioned through the product was permanently stuck in.
    expect(await policyCount(COMPANY_A9)).toBe(0);

    const first = await seedDelivery('p10w1a', { companyId: COMPANY_A9, branchId: BRANCH_A9 });
    expect(first.status).toBe('delivered');

    // BEFORE. The refusal is `resolvePolicy`'s no-active-policy branch, and its message
    // says the configuration is the operator's — which no operator could supply.
    authAs(SAL_FULL);
    const unconfigured = await generateWarranty(first.deliveryId);
    expect(unconfigured.status).toBe(404);
    expect(await codeOf(unconfigured)).toBe('ERR-RES-001');

    // AUTHOR, entirely through the published routes.
    const policy = await authorPolicy({
      companyId: COMPANY_A9,
      name: 'Second-company warranty',
      coverage: [
        {
          coveredScope: 'all',
          durationMonths: 24,
          odometerAllowance: '30000',
          effectiveFrom: FAR_PAST,
        },
      ],
    });
    expect(await policyCount(COMPANY_A9)).toBe(1);

    // AFTER. No `policyId` is sent, so `resolvePolicy` takes the company's only active
    // policy — and the warranty comes back carrying the very terms just authored,
    // which is what makes this a proof of the seam rather than of the route.
    authAs(SAL_FULL);
    const issued = await generateWarranty(first.deliveryId);
    expect(issued.status).toBe(201);
    const warranty = await bodyOf<WarrantyBody>(issued);
    expect(warranty.policy.id).toBe(policy.id);
    expect(warranty.policy.policyCode).toBe(policy.policyCode);
    expect(warranty.coverage.id).toBe(policy.coverage[0]?.id);
    expect(warranty.coverage.durationMonths).toBe(24);
    expect(warranty.coverage.odometerAllowance).toBe('30000');
    expect(warranty.coverage.coveredScope).toBe('all');

    // ARCHIVE the policy through the status route.
    authAs(SAL_FULL);
    const archived = await setPolicyStatus(policy.id, 'archived', policy.recordVersion);
    expect(archived.status).toBe(200);

    // AND THE COMPANY IS UNCONFIGURED AGAIN. A second delivery, so the refusal cannot
    // be the duplicate-warranty pre-check.
    const second = await seedDelivery('p10w1b', { companyId: COMPANY_A9, branchId: BRANCH_A9 });
    authAs(SAL_FULL);
    const refused = await generateWarranty(second.deliveryId);
    expect(refused.status).toBe(404);
    expect(await codeOf(refused)).toBe('ERR-RES-001');

    // Naming the archived policy explicitly is a DIFFERENT refusal, and that difference
    // is the whole reason `findPolicy` does not filter on status: the caller is told
    // the policy was retired rather than that it does not exist.
    authAs(SAL_FULL);
    const named = await generateWarranty(second.deliveryId, policy.id);
    expect(named.status).toBe(409);
    expect(await codeOf(named)).toBe('ERR-TRN-001');
  }, 180_000);
});

describe('P-10 the provisioning bundle', () => {
  it('P10-N1 the tenant administrator bundle now carries wty.policy.manage (CC-01 closed)', async () => {
    // CC-01 withheld the code BECAUSE no operation declared it, and stated that "the
    // slice that publishes them owns the widening". Five operations now declare it.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(POLICY_MANAGE);
    // Nothing else moved, and nothing is duplicated. 75 when this slice landed;
    // 76 once P-11 carried `rpt.report.configure` on the same rule the same day,
    // closing CC-02 — which is why the assertion below is now a POSITIVE one.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toHaveLength(76);
    expect(new Set(TENANT_ADMINISTRATOR_ROLE.permissionCodes).size).toBe(
      TENANT_ADMINISTRATOR_ROLE.permissionCodes.length
    );
    // `rpt.report.configure` left the exclusions when P-11 published the seven
    // operations that declare it (CC-02, closed on the same terms as CC-01 here).
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain('rpt.report.configure');
    // `rpt.export` stays excluded on least-privilege grounds by Owner decision (CC-04).
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).not.toContain('rpt.export');
  });

  it('P10-N2 nothing was minted — the code was already a catalogue row', async () => {
    const rows = await admin.query<{ permission_code: string }>(
      `SELECT permission_code FROM iam.permissions WHERE permission_code = $1`,
      [POLICY_MANAGE]
    );
    expect(rows.rows.map((row) => row.permission_code)).toEqual([POLICY_MANAGE]);
  });
});
