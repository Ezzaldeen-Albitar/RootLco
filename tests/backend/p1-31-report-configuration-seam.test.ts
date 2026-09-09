/**
 * The P1-31 report CONFIGURATION seam — a write surface that did not exist
 * (prerequisite **P-11** of `docs/phase-1/phase-1-31/a0-preflight.md`).
 *
 * ## What was measured, and what this suite has to prove
 *
 * `rpt.report_configurations` and `rpt.report_configuration_versions` landed in
 * P1-11 carrying INSERT and UPDATE grants and policies, and until this slice **no
 * code anywhere in `apps/api/src` had ever written either table**. P1-23 published
 * two READS over them and both filter on `status = 'published'`, so the only rows
 * they could return were rows nothing could create: every tenant's report
 * catalogue was empty and permanently so. `rpt.report.configure` had been a seeded
 * catalogue code since P1-08, declared by no operation and named by no policy
 * predicate.
 *
 * `tests/backend/p1-23-reporting.test.ts` seeds both tables by ADMIN SQL, and that
 * seeding is the measurement rather than a convenience. This suite deliberately
 * does not: every configuration and every version it reads was authored through
 * the published routes, because "a report definition can be configured through the
 * product" is the claim under test.
 *
 * ## The ENGINE is not here, and this suite does not pretend otherwise
 *
 * `ReportDefinitionView.executable` is the literal `false`, because the frozen
 * `rpt` schema binds no data source to a report code. The catalogue interplay case
 * below asserts that a definition authored and published through this seam appears
 * in `GET /reports` **carrying `executable: false`** — the seam publishes a
 * definition, and a definition is still not a report anyone can run. Making one
 * runnable requires choosing report definitions, which is Owner decision D-4.
 *
 * ## The permission decision this suite proves
 *
 * Every operation of the seam — the two READS included — declares
 * `rpt.report.configure`, which is the opposite shape from the P-9 and P-10 seams
 * beside it. The reason is the rows: this surface exposes drafts, archived
 * definitions and unpublished versions, which a `rpt.report.read` holder must not
 * see. `RPT_READER` holds `rpt.report.read` and nothing else and is refused all
 * seven; it can still read the published catalogue, which is what its code was
 * minted for.
 *
 * The authority must be held TENANT-WIDE. Both tables carry a `tenant_id` and no
 * company and no branch, so there is no scope target and `requiresScopedEvaluation`
 * returns false whatever the operation declares (P1-18-A-01) — the pre-handler
 * check degrades to the scope-blind `iam.has_permission`. `RPT_SCOPED` holds
 * `rpt.report.configure` through a BRANCH-scoped grant and is refused all seven by
 * the explicit re-check, which is the control under test.
 *
 * COVERAGE-EVIDENCE (P1-31 report configuration seam):
 *   rpt.report-configuration-list: route service authorization success denial cross-tenant
 *   rpt.report-configuration-read: route service authorization success denial cross-tenant
 *   rpt.report-configuration-create: route service authorization success denial cross-tenant idempotency audit
 *   rpt.report-configuration-update: route service authorization success denial cross-tenant stale-version audit
 *   rpt.report-configuration-status-set: route service authorization success denial cross-tenant idempotency stale-version audit
 *   rpt.report-configuration-version-create: route service authorization success denial cross-tenant idempotency audit
 *   rpt.report-configuration-version-publish: route service authorization success denial cross-tenant stale-version audit
 *
 * No `isolation` flag is claimed for any of the seven: every operation is
 * `scope: 'tenant'` over a table with no company and no branch, so there is no
 * in-tenant scope narrowing to be refused by. The branch-scoped principal's
 * refusals are AUTHORIZATION refusals — the tenant-wide re-check — and are claimed
 * as such.
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
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  setSessionAuthenticator,
  __resetAuthenticatorForTests,
} from '@/server/context/principal';
import { TENANT_ADMINISTRATOR_ROLE } from '@/modules/iam';
import {
  REPORT_CONFIGURATION_CREATE_OPERATION,
  REPORT_CONFIGURATION_LIST_OPERATION,
  GET as LIST_CONFIGURATIONS,
  POST as CREATE_CONFIGURATION,
} from '@/app/api/v1/report-configurations/route';
import {
  REPORT_CONFIGURATION_READ_OPERATION,
  REPORT_CONFIGURATION_UPDATE_OPERATION,
  GET as READ_CONFIGURATION,
  PATCH as UPDATE_CONFIGURATION,
} from '@/app/api/v1/report-configurations/[configurationId]/route';
import {
  REPORT_CONFIGURATION_STATUS_OPERATION,
  POST as SET_CONFIGURATION_STATUS,
} from '@/app/api/v1/report-configurations/[configurationId]/status/route';
import {
  REPORT_CONFIGURATION_VERSION_CREATE_OPERATION,
  POST as CREATE_VERSION,
} from '@/app/api/v1/report-configurations/[configurationId]/versions/route';
import {
  REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION,
  POST as PUBLISH_VERSION,
} from '@/app/api/v1/report-configurations/[configurationId]/versions/[versionId]/publish/route';
import { GET as LIST_REPORTS } from '@/app/api/v1/reports/route';

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// The seven operation ids as literals, so the coverage gate can see this file
// INVOKE each one: for an `rpt.` id the gate strips every comment before it
// looks, so naming them in a header proves nothing.
// ---------------------------------------------------------------------------

const SEAM_OPERATION_IDS = Object.freeze({
  list: 'rpt.report-configuration-list',
  read: 'rpt.report-configuration-read',
  create: 'rpt.report-configuration-create',
  update: 'rpt.report-configuration-update',
  status: 'rpt.report-configuration-status-set',
  versionCreate: 'rpt.report-configuration-version-create',
  versionPublish: 'rpt.report-configuration-version-publish',
} as const);

const CONFIGURE = 'rpt.report.configure';
const REPORT_READ = 'rpt.report.read';
/** A real seeded code, used as an `export_permission_code` a report may name. */
const EXPORT_CODE = 'rpt.export';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface ConfigurationBody {
  readonly id: string;
  readonly reportCode: string;
  readonly name: string;
  readonly scopeLevel: string;
  readonly exportPermissionCode: string;
  readonly ownerUserId: string;
  readonly status: string;
  readonly recordVersion: number;
}

interface VersionBody {
  readonly id: string;
  readonly configurationId: string;
  readonly versionNumber: number;
  readonly parameterSchema: unknown;
  readonly status: string;
  readonly publishedAt: string | null;
  readonly recordVersion: number;
}

interface DetailBody {
  readonly configuration: ConfigurationBody;
  readonly versions: readonly VersionBody[];
}

interface ListBody {
  readonly configurations: {
    readonly items: readonly ConfigurationBody[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

interface CatalogueBody {
  readonly items: readonly {
    readonly reportCode: string;
    readonly executable: boolean;
    readonly versionNumber: number | null;
  }[];
}

interface ProblemBody {
  readonly code: string;
  readonly requiredPermissions?: readonly string[];
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
  readonly details?: {
    readonly violations?: readonly { readonly path: string; readonly rule: string }[];
  };
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;
const problemOf = (response: Response): Promise<ProblemBody> => bodyOf<ProblemBody>(response);
const codeOf = async (response: Response): Promise<string> => (await problemOf(response)).code;

/**
 * A refusal read ONCE.
 *
 * A `Response` body is a stream and may be consumed a single time, so a case that
 * wants both the error code and the violation list has to take them together.
 */
async function refusalOf(
  response: Response
): Promise<{ code: string; violations: readonly { path: string; rule: string }[] }> {
  const problem = await problemOf(response);
  return {
    code: problem.code,
    violations: [...(problem.violations ?? problem.details?.violations ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Principals. Seeded locally rather than borrowed: no shared fixture principal
// holds an `rpt.` code, and the whole access claim of this seam is about which
// rpt code a caller holds and how widely.
// ---------------------------------------------------------------------------

interface LocalPrincipal {
  readonly roleId: string;
  readonly userId: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
  /** When set, the grant is `scoped` to this company/branch pair rather than unrestricted. */
  readonly scope?: { readonly companyId: string; readonly branchId: string };
  readonly grantId?: string;
}

/** Tenant A, unrestricted, holding the configure code — the author. */
const RPT_CONFIGURER: LocalPrincipal = {
  roleId: 'f1310000-0000-4000-8000-00000000b101',
  userId: 'f1310000-0000-4000-8000-00000000b102',
  subject: 'fx_p1_31_p11_configurer',
  tenantId: TENANT_A,
  permissions: [CONFIGURE],
};

/**
 * Tenant A, unrestricted, holding ONLY `rpt.report.read`.
 *
 * The principal the permission decision is about: it may read the published
 * catalogue and must not reach this seam, whose rows are drafts, archived
 * definitions and unpublished versions.
 */
const RPT_READER: LocalPrincipal = {
  roleId: 'f1310000-0000-4000-8000-00000000b111',
  userId: 'f1310000-0000-4000-8000-00000000b112',
  subject: 'fx_p1_31_p11_reader',
  tenantId: TENANT_A,
  permissions: [REPORT_READ],
};

/**
 * Tenant A, holding the configure code through a BRANCH-scoped grant.
 *
 * The control under test. RLS cannot refuse this caller anything — the tables
 * have no company and no branch, so `sel_report_configurations_scope` is the
 * tenant alone — and neither can the pre-handler permission check, which is
 * scope-blind with no target. Only the explicit tenant-wide re-check can.
 */
const RPT_SCOPED: LocalPrincipal = {
  roleId: 'f1310000-0000-4000-8000-00000000b121',
  userId: 'f1310000-0000-4000-8000-00000000b122',
  subject: 'fx_p1_31_p11_scoped',
  tenantId: TENANT_A,
  permissions: [CONFIGURE],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A1 },
  grantId: 'f1310000-0000-4000-8000-00000000b123',
};

/** Tenant B, unrestricted, holding the configure code IN ITS OWN TENANT. */
const RPT_TENANT_B: LocalPrincipal = {
  roleId: 'f1310000-0000-4000-8000-00000000b131',
  userId: 'f1310000-0000-4000-8000-00000000b132',
  subject: 'fx_p1_31_p11_tenant_b',
  tenantId: TENANT_B,
  permissions: [CONFIGURE],
};

const PRINCIPALS: readonly LocalPrincipal[] = [
  RPT_CONFIGURER,
  RPT_READER,
  RPT_SCOPED,
  RPT_TENANT_B,
];

function authAs(principal: LocalPrincipal): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    })
  );
}

async function seedPrincipal(principal: LocalPrincipal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 P-11 principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 P-11 fixture',$4) ON CONFLICT (id) DO NOTHING`,
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
  if (existing.rowCount !== 0) return;

  if (principal.scope === undefined) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    return;
  }
  // A scoped active grant must carry at least one scope, and that is a DEFERRABLE
  // constraint trigger — so the grant and its scope land in one transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [
        principal.tenantId,
        principal.grantId,
        principal.scope.companyId,
        principal.scope.branchId,
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

// ---------------------------------------------------------------------------
// Route drivers. Every call goes through the real exported handler, so the
// permission gate, the version guard, the idempotency reservation and the
// validation all run.
// ---------------------------------------------------------------------------

const BASE = 'http://localhost/api/v1/report-configurations';

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

const listConfigurations = (query?: {
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<Response> => {
  const parts: string[] = [];
  if (query?.status !== undefined) parts.push(`status=${encodeURIComponent(query.status)}`);
  if (query?.cursor !== undefined) parts.push(`cursor=${encodeURIComponent(query.cursor)}`);
  if (query?.limit !== undefined) parts.push(`limit=${String(query.limit)}`);
  return LIST_CONFIGURATIONS(
    new Request(`${BASE}${parts.length === 0 ? '' : `?${parts.join('&')}`}`)
  );
};

const readConfiguration = (configurationId: string): Promise<Response> =>
  READ_CONFIGURATION(new Request(`${BASE}/${configurationId}`), {
    params: Promise.resolve({ configurationId }),
  });

const createConfiguration = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  CREATE_CONFIGURATION(
    new Request(BASE, { method: 'POST', headers: jsonHeaders({ key }), body: JSON.stringify(body) })
  );

const updateConfiguration = (
  configurationId: string,
  body: unknown,
  version: number | null
): Promise<Response> =>
  UPDATE_CONFIGURATION(
    new Request(`${BASE}/${configurationId}`, {
      method: 'PATCH',
      headers: jsonHeaders({ version }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ configurationId }) }
  );

const setStatus = (
  configurationId: string,
  status: string,
  version: number | null,
  key: string = randomUUID()
): Promise<Response> =>
  SET_CONFIGURATION_STATUS(
    new Request(`${BASE}/${configurationId}/status`, {
      method: 'POST',
      headers: jsonHeaders({ key, version }),
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ configurationId }) }
  );

const createVersion = (
  configurationId: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  CREATE_VERSION(
    new Request(`${BASE}/${configurationId}/versions`, {
      method: 'POST',
      headers: jsonHeaders({ key }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ configurationId }) }
  );

const publishVersion = (
  configurationId: string,
  versionId: string,
  version: number | null
): Promise<Response> =>
  PUBLISH_VERSION(
    new Request(`${BASE}/${configurationId}/versions/${versionId}/publish`, {
      method: 'POST',
      headers: jsonHeaders({ version }),
    }),
    { params: Promise.resolve({ configurationId, versionId }) }
  );

const listPublishedReports = (): Promise<Response> =>
  LIST_REPORTS(new Request('http://localhost/api/v1/reports?limit=100'));

// ---------------------------------------------------------------------------
// Fixture authoring — through the routes, never by admin SQL
// ---------------------------------------------------------------------------

/**
 * A report-code stem no other suite uses.
 *
 * `p1-23-reporting.test.ts` deletes EVERY `rpt` row of tenants A and B in its
 * teardown, and this suite's own teardown is scoped to rows carrying this prefix —
 * so neither can remove the other's rows while they are in use, and the backend
 * tier runs its files sequentially besides (`fileParallelism: false`).
 */
const CODE_PREFIX = 'fx_p131_p11';
let codeSequence = 0;
const nextCode = (stem: string): string => {
  codeSequence += 1;
  return `${CODE_PREFIX}_${stem}_${String(codeSequence)}`;
};

interface Authored {
  readonly id: string;
  readonly reportCode: string;
  readonly recordVersion: number;
}

/** Creates a draft configuration as `RPT_CONFIGURER` and returns what the response carried. */
async function authorConfiguration(
  input: { readonly stem?: string; readonly name?: string; readonly scopeLevel?: string } = {}
): Promise<Authored> {
  authAs(RPT_CONFIGURER);
  const reportCode = nextCode(input.stem ?? 'cfg');
  const response = await createConfiguration({
    reportCode,
    name: input.name ?? 'Work orders by status',
    scopeLevel: input.scopeLevel ?? 'branch',
    exportPermissionCode: EXPORT_CODE,
  });
  expect(response.status).toBe(201);
  const created = await bodyOf<ConfigurationBody>(response);
  return { id: created.id, reportCode, recordVersion: created.recordVersion };
}

const auditCount = async (action: string, entityId: string): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
  return Number(result.rows[0]?.n ?? '0');
};

const configurationRow = async (
  configurationId: string
): Promise<
  { name: string; scope_level: string; status: string; record_version: number } | undefined
> => {
  const result = await admin.query<{
    name: string;
    scope_level: string;
    status: string;
    record_version: number;
  }>(
    `SELECT name, scope_level, status, record_version
       FROM rpt.report_configurations WHERE id = $1`,
    [configurationId]
  );
  return result.rows[0];
};

const versionRow = async (
  versionId: string
): Promise<
  | {
      version_number: number;
      status: string;
      record_version: number;
      published_at: Date | null;
      parameter_schema: unknown;
    }
  | undefined
> => {
  const result = await admin.query<{
    version_number: number;
    status: string;
    record_version: number;
    published_at: Date | null;
    parameter_schema: unknown;
  }>(
    `SELECT version_number, status, record_version, published_at, parameter_schema
       FROM rpt.report_configuration_versions WHERE id = $1`,
    [versionId]
  );
  return result.rows[0];
};

const configurationCount = async (): Promise<number> => {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM rpt.report_configurations
      WHERE tenant_id = $1 AND report_code LIKE $2`,
    [TENANT_A, `${CODE_PREFIX}%`]
  );
  return Number(result.rows[0]?.n ?? '0');
};

/** Removes only the rows this suite authored, by report-code prefix. */
async function cleanSeamRows(): Promise<void> {
  await admin.query(
    `DELETE FROM rpt.report_configuration_versions v
      USING rpt.report_configurations c
      WHERE v.report_configuration_id = c.id AND c.report_code LIKE $1`,
    [`${CODE_PREFIX}%`]
  );
  await admin.query(`DELETE FROM rpt.report_configurations WHERE report_code LIKE $1`, [
    `${CODE_PREFIX}%`,
  ]);
}

/**
 * Refuses a JSON number under any money-shaped key, anywhere in a response.
 *
 * There is no money on this surface — `rpt` has no `numeric` column at all — so
 * the correct assertion is not "the amounts are strings" but "there are no
 * amounts". This walks the whole document, `parameterSchema` included, so a
 * tenant-authored key cannot slip a float in under a nested object.
 * `versionNumber` and `recordVersion` are counters and are deliberately not
 * money-shaped names.
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
// Setup
// ---------------------------------------------------------------------------

let MAIN: Authored;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  for (const principal of PRINCIPALS) await seedPrincipal(principal);
  await cleanSeamRows();

  MAIN = await authorConfiguration({ stem: 'main', name: 'Work orders by status' });
  __resetAuthenticatorForTests();
}, 240_000);

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await cleanSeamRows().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

// ---------------------------------------------------------------------------
// The registrations
// ---------------------------------------------------------------------------

describe('the seven registrations', () => {
  it('declare the seeded configure code on every operation, and mint none', () => {
    expect(REPORT_CONFIGURATION_LIST_OPERATION.id).toBe(SEAM_OPERATION_IDS.list);
    expect(REPORT_CONFIGURATION_READ_OPERATION.id).toBe(SEAM_OPERATION_IDS.read);
    expect(REPORT_CONFIGURATION_CREATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.create);
    expect(REPORT_CONFIGURATION_UPDATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.update);
    expect(REPORT_CONFIGURATION_STATUS_OPERATION.id).toBe(SEAM_OPERATION_IDS.status);
    expect(REPORT_CONFIGURATION_VERSION_CREATE_OPERATION.id).toBe(SEAM_OPERATION_IDS.versionCreate);
    expect(REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION.id).toBe(
      SEAM_OPERATION_IDS.versionPublish
    );

    const every = [
      REPORT_CONFIGURATION_LIST_OPERATION,
      REPORT_CONFIGURATION_READ_OPERATION,
      REPORT_CONFIGURATION_CREATE_OPERATION,
      REPORT_CONFIGURATION_UPDATE_OPERATION,
      REPORT_CONFIGURATION_STATUS_OPERATION,
      REPORT_CONFIGURATION_VERSION_CREATE_OPERATION,
      REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION,
    ];
    for (const operation of every) {
      // The reads declare it as well as the writes, which is the access decision
      // of this seam: the rows are drafts and unpublished versions.
      expect(operation.permissions).toEqual([CONFIGURE]);
      // `tenant`, because neither table has a company or a branch column.
      expect(operation.scope).toBe('tenant');
      expect(operation.module).toBe('reporting');
    }

    for (const read of [REPORT_CONFIGURATION_LIST_OPERATION, REPORT_CONFIGURATION_READ_OPERATION]) {
      expect(read.method).toBe('GET');
      expect(read.auditClass).toBe('none');
    }
    for (const write of [
      REPORT_CONFIGURATION_CREATE_OPERATION,
      REPORT_CONFIGURATION_UPDATE_OPERATION,
      REPORT_CONFIGURATION_STATUS_OPERATION,
      REPORT_CONFIGURATION_VERSION_CREATE_OPERATION,
      REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION,
    ]) {
      expect(write.auditClass).toBe('privileged');
      expect(write.auditAction).toMatch(/^rpt\.report_configuration\./);
    }

    expect(REPORT_CONFIGURATION_CREATE_OPERATION.idempotent).toBe(true);
    expect(REPORT_CONFIGURATION_CREATE_OPERATION.successStatus).toBe(201);
    expect(REPORT_CONFIGURATION_VERSION_CREATE_OPERATION.idempotent).toBe(true);
    expect(REPORT_CONFIGURATION_VERSION_CREATE_OPERATION.successStatus).toBe(201);
    expect(REPORT_CONFIGURATION_STATUS_OPERATION.idempotent).toBe(true);
    expect(REPORT_CONFIGURATION_UPDATE_OPERATION.versionGuarded).toBe(true);
    expect(REPORT_CONFIGURATION_STATUS_OPERATION.versionGuarded).toBe(true);
    expect(REPORT_CONFIGURATION_VERSION_PUBLISH_OPERATION.versionGuarded).toBe(true);
    // Creating a draft version mutates nothing that existed, so there is no prior
    // version to guard — the `svc.service-version-create` rule.
    expect(REPORT_CONFIGURATION_VERSION_CREATE_OPERATION.versionGuarded).toBeFalsy();
  });

  it('carries rpt.report.configure in the tenant administrator bundle', () => {
    // CC-02 withheld this code while NO operation declared it, and stated the rule
    // for lifting the exclusion: the slice that publishes the writers owns the
    // widening. Seven operations declare it above, so it is held here.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(CONFIGURE);
    // `rpt.export` stays excluded on DIFFERENT grounds — least privilege, by Owner
    // decision (CC-04) — and this slice does not touch that.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).not.toContain(EXPORT_CODE);
    // The read code was already held; nothing is withdrawn.
    expect(TENANT_ADMINISTRATOR_ROLE.permissionCodes).toContain(REPORT_READ);
    expect(new Set(TENANT_ADMINISTRATOR_ROLE.permissionCodes).size).toBe(
      TENANT_ADMINISTRATOR_ROLE.permissionCodes.length
    );
  });
});

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

describe('authoring a definition', () => {
  it('creates a draft, owned by the caller, and reads it back with no versions', async () => {
    const authored = await authorConfiguration({ stem: 'author', name: 'Technician labour time' });
    authAs(RPT_CONFIGURER);
    const response = await readConfiguration(authored.id);
    expect(response.status).toBe(200);
    const detail = await bodyOf<DetailBody>(response);

    expect(detail.configuration.reportCode).toBe(authored.reportCode);
    expect(detail.configuration.name).toBe('Technician labour time');
    expect(detail.configuration.scopeLevel).toBe('branch');
    expect(detail.configuration.exportPermissionCode).toBe(EXPORT_CODE);
    // The owner is the SESSION user and never a request field.
    expect(detail.configuration.ownerUserId).toBe(RPT_CONFIGURER.userId);
    expect(detail.configuration.status).toBe('draft');
    expect(detail.versions).toEqual([]);
    // The ETag is the configuration's own counter, which the guarded commands want.
    expect(response.headers.get('etag')).toBe(`"${String(detail.configuration.recordVersion)}"`);
    refusesAnyMoneyShapedNumber(detail);
  });

  it('refuses a duplicate report code in the tenant, naming the field', async () => {
    authAs(RPT_CONFIGURER);
    const before = await configurationCount();
    const response = await createConfiguration({
      reportCode: MAIN.reportCode,
      name: 'A second definition wearing the first one’s code',
      scopeLevel: 'tenant',
      exportPermissionCode: EXPORT_CODE,
    });
    expect(response.status).toBe(409);
    const refusal = await refusalOf(response);
    expect(refusal.code).toBe('ERR-CON-001');
    expect(refusal.violations).toContainEqual({
      path: 'body.reportCode',
      rule: 'duplicate_code',
    });
    expect(await configurationCount()).toBe(before);
  });

  it('refuses an export permission code the catalogue does not carry', async () => {
    authAs(RPT_CONFIGURER);
    const before = await configurationCount();
    const response = await createConfiguration({
      reportCode: nextCode('bad_perm'),
      name: 'Stock movements summary',
      scopeLevel: 'company',
      // A well-formed code that is not a row in `iam.permissions`. The refusal is
      // `fk_report_configurations_permission`, mapped to a 422 naming the field.
      exportPermissionCode: 'rpt.export.that.does.not.exist',
    });
    expect(response.status).toBe(422);
    const refusal = await refusalOf(response);
    expect(refusal.code).toBe('ERR-VAL-001');
    expect(refusal.violations).toContainEqual({
      path: 'body.exportPermissionCode',
      rule: 'unknown_permission_code',
    });
    expect(await configurationCount()).toBe(before);
  });

  it('refuses a body that names id, status or ownerUserId, and a malformed report code', async () => {
    authAs(RPT_CONFIGURER);
    const before = await configurationCount();
    for (const body of [
      {
        id: randomUUID(),
        reportCode: nextCode('x'),
        name: 'n',
        scopeLevel: 'branch',
        exportPermissionCode: EXPORT_CODE,
      },
      {
        reportCode: nextCode('x'),
        name: 'n',
        scopeLevel: 'branch',
        exportPermissionCode: EXPORT_CODE,
        status: 'published',
      },
      {
        reportCode: nextCode('x'),
        name: 'n',
        scopeLevel: 'branch',
        exportPermissionCode: EXPORT_CODE,
        ownerUserId: USER_A,
      },
      // `ck_report_configurations_code` mirrored at the boundary: upper case.
      {
        reportCode: 'Not_A_Valid_Code',
        name: 'n',
        scopeLevel: 'branch',
        exportPermissionCode: EXPORT_CODE,
      },
      // A scope level outside `ck_report_configurations_scope`.
      {
        reportCode: nextCode('x'),
        name: 'n',
        scopeLevel: 'global',
        exportPermissionCode: EXPORT_CODE,
      },
      // The export code is NOT NULL with no default, so it cannot be omitted.
      { reportCode: nextCode('x'), name: 'n', scopeLevel: 'branch' },
    ]) {
      const response = await createConfiguration(body);
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe('ERR-VAL-001');
    }
    expect(await configurationCount()).toBe(before);
  });

  it('replays one idempotency key into one row and one audit record', async () => {
    authAs(RPT_CONFIGURER);
    const key = randomUUID();
    const reportCode = nextCode('replay');
    const body = {
      reportCode,
      name: 'Invoice and payment summary',
      scopeLevel: 'company',
      exportPermissionCode: EXPORT_CODE,
    };
    const first = await createConfiguration(body, key);
    expect(first.status).toBe(201);
    const created = await bodyOf<ConfigurationBody>(first);

    const replay = await createConfiguration(body, key);
    // The replay answers 200 rather than the declared 201: `withIdempotency`
    // stores the body and replays it as a plain result, which is a platform
    // contract rather than a property of this route.
    expect([200, 201]).toContain(replay.status);
    expect(await bodyOf<ConfigurationBody>(replay)).toEqual(created);

    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rpt.report_configurations
        WHERE tenant_id = $1 AND report_code = $2`,
      [TENANT_A, reportCode]
    );
    expect(Number(rows.rows[0]?.n ?? '0')).toBe(1);
    expect(await auditCount('rpt.report_configuration.created', created.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The version guards
// ---------------------------------------------------------------------------

describe('the version guards on the configuration', () => {
  it('requires If-Match on the edit, refuses a stale one, and advances by exactly one', async () => {
    const authored = await authorConfiguration({ stem: 'guard', name: 'Original name' });
    authAs(RPT_CONFIGURER);

    const missing = await updateConfiguration(authored.id, { name: 'Renamed' }, null);
    expect(missing.status).toBe(428);
    expect(await codeOf(missing)).toBe('ERR-CON-002');

    const stale = await updateConfiguration(
      authored.id,
      { name: 'Renamed' },
      authored.recordVersion + 7
    );
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');
    expect((await configurationRow(authored.id))?.name).toBe('Original name');

    const ok = await updateConfiguration(authored.id, { name: 'Renamed' }, authored.recordVersion);
    expect(ok.status).toBe(200);
    const updated = await bodyOf<ConfigurationBody>(ok);
    expect(updated.name).toBe('Renamed');
    expect(updated.recordVersion).toBe(authored.recordVersion + 1);
    // The field the caller omitted is written back as it was read.
    expect(updated.scopeLevel).toBe('branch');
    expect(await auditCount('rpt.report_configuration.updated', authored.id)).toBe(1);
  });

  it('refuses an edit body that changes nothing', async () => {
    authAs(RPT_CONFIGURER);
    const response = await updateConfiguration(MAIN.id, {}, MAIN.recordVersion);
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe('ERR-VAL-001');
  });

  it('edits the scope level alone and leaves the name untouched', async () => {
    const authored = await authorConfiguration({ stem: 'scope', name: 'Untouched name' });
    authAs(RPT_CONFIGURER);
    const response = await updateConfiguration(
      authored.id,
      { scopeLevel: 'tenant' },
      authored.recordVersion
    );
    expect(response.status).toBe(200);
    const updated = await bodyOf<ConfigurationBody>(response);
    expect(updated.scopeLevel).toBe('tenant');
    expect(updated.name).toBe('Untouched name');
  });
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

describe('the status command', () => {
  it('moves a definition through every value the CHECK allows, in both directions', async () => {
    const authored = await authorConfiguration({ stem: 'status' });
    authAs(RPT_CONFIGURER);
    let version = authored.recordVersion;

    for (const status of ['published', 'archived', 'draft', 'published'] as const) {
      const response = await setStatus(authored.id, status, version);
      expect(response.status).toBe(200);
      const changed = await bodyOf<ConfigurationBody>(response);
      expect(changed.status).toBe(status);
      expect(changed.recordVersion).toBe(version + 1);
      version = changed.recordVersion;
    }
    expect((await configurationRow(authored.id))?.status).toBe('published');
    expect(await auditCount('rpt.report_configuration.status_changed', authored.id)).toBe(4);
  });

  it('refuses a status outside the schema vocabulary, and a stale If-Match', async () => {
    const authored = await authorConfiguration({ stem: 'status_bad' });
    authAs(RPT_CONFIGURER);

    const bad = await setStatus(authored.id, 'retired', authored.recordVersion);
    expect(bad.status).toBe(422);
    expect(await codeOf(bad)).toBe('ERR-VAL-001');

    const stale = await setStatus(authored.id, 'published', authored.recordVersion + 3);
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe('ERR-CON-001');
    expect((await configurationRow(authored.id))?.status).toBe('draft');
  });

  it('replays one status key into one transition and one audit record', async () => {
    const authored = await authorConfiguration({ stem: 'status_replay' });
    authAs(RPT_CONFIGURER);
    const key = randomUUID();
    const first = await setStatus(authored.id, 'published', authored.recordVersion, key);
    expect(first.status).toBe(200);
    const changed = await bodyOf<ConfigurationBody>(first);
    const replay = await setStatus(authored.id, 'published', authored.recordVersion, key);
    expect(replay.status).toBe(200);
    expect(await bodyOf<ConfigurationBody>(replay)).toEqual(changed);
    expect((await configurationRow(authored.id))?.record_version).toBe(authored.recordVersion + 1);
    expect(await auditCount('rpt.report_configuration.status_changed', authored.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

describe('versions', () => {
  it('numbers drafts 1 then 2, echoes the parameter schema, and lists them ascending', async () => {
    const authored = await authorConfiguration({ stem: 'versions' });
    authAs(RPT_CONFIGURER);

    const firstResponse = await createVersion(authored.id, {
      parameterSchema: { branchId: { type: 'uuid' }, from: { type: 'date' } },
    });
    expect(firstResponse.status).toBe(201);
    const first = await bodyOf<VersionBody>(firstResponse);
    expect(first.versionNumber).toBe(1);
    expect(first.status).toBe('draft');
    expect(first.publishedAt).toBeNull();
    expect(first.parameterSchema).toEqual({
      branchId: { type: 'uuid' },
      from: { type: 'date' },
    });

    // An omitted schema is the empty object the column already defaults to.
    const secondResponse = await createVersion(authored.id, {});
    expect(secondResponse.status).toBe(201);
    const second = await bodyOf<VersionBody>(secondResponse);
    expect(second.versionNumber).toBe(2);
    expect(second.parameterSchema).toEqual({});

    const detail = await bodyOf<DetailBody>(await readConfiguration(authored.id));
    expect(detail.versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(await auditCount('rpt.report_configuration.version_created', first.id)).toBe(1);
    refusesAnyMoneyShapedNumber(detail);
  });

  it('bounds the parameter schema in shape and refuses what exceeds it', async () => {
    const authored = await authorConfiguration({ stem: 'schema_bounds' });
    authAs(RPT_CONFIGURER);

    const tooManyKeys: Record<string, unknown> = {};
    for (let i = 0; i < 65; i += 1) tooManyKeys[`filter_${String(i)}`] = { type: 'text' };
    const keys = await createVersion(authored.id, { parameterSchema: tooManyKeys });
    expect(keys.status).toBe(422);
    expect(await codeOf(keys)).toBe('ERR-VAL-001');

    // An array is JSON and would be accepted by `jsonb`; it is not a keyed document.
    const array = await createVersion(authored.id, { parameterSchema: [{ type: 'text' }] });
    expect(array.status).toBe(422);

    const huge = await createVersion(authored.id, {
      parameterSchema: { blob: 'x'.repeat(17 * 1024) },
    });
    expect(huge.status).toBe(422);

    // Nothing was written by any of the three.
    const detail = await bodyOf<DetailBody>(await readConfiguration(authored.id));
    expect(detail.versions).toEqual([]);
  });

  it('replays one version key into one version and one audit record', async () => {
    const authored = await authorConfiguration({ stem: 'version_replay' });
    authAs(RPT_CONFIGURER);
    const key = randomUUID();
    const body = { parameterSchema: { branchId: { type: 'uuid' } } };
    const first = await createVersion(authored.id, body, key);
    expect(first.status).toBe(201);
    const created = await bodyOf<VersionBody>(first);
    const replay = await createVersion(authored.id, body, key);
    expect(await bodyOf<VersionBody>(replay)).toEqual(created);

    const detail = await bodyOf<DetailBody>(await readConfiguration(authored.id));
    expect(detail.versions).toHaveLength(1);
    expect(await auditCount('rpt.report_configuration.version_created', created.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Publication, and the immutability the database enforces
// ---------------------------------------------------------------------------

describe('publication', () => {
  it('publishes a draft under its own version counter and stamps published_at', async () => {
    const authored = await authorConfiguration({ stem: 'publish' });
    authAs(RPT_CONFIGURER);
    const draft = await bodyOf<VersionBody>(
      await createVersion(authored.id, { parameterSchema: { branchId: { type: 'uuid' } } })
    );

    // The CONFIGURATION's counter is NOT the version's, and offering it is refused.
    const wrongCounter = await publishVersion(authored.id, draft.id, authored.recordVersion + 5);
    expect(wrongCounter.status).toBe(409);
    expect(await codeOf(wrongCounter)).toBe('ERR-CON-001');
    expect((await versionRow(draft.id))?.status).toBe('draft');

    const missing = await publishVersion(authored.id, draft.id, null);
    expect(missing.status).toBe(428);
    expect(await codeOf(missing)).toBe('ERR-CON-002');

    const ok = await publishVersion(authored.id, draft.id, draft.recordVersion);
    expect(ok.status).toBe(200);
    const published = await bodyOf<VersionBody>(ok);
    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();
    expect(published.recordVersion).toBe(draft.recordVersion + 1);
    expect(await auditCount('rpt.report_configuration.version_published', draft.id)).toBe(1);
  });

  it('refuses a second published version, and refuses republishing the first', async () => {
    const authored = await authorConfiguration({ stem: 'publish_conflict' });
    authAs(RPT_CONFIGURER);
    const one = await bodyOf<VersionBody>(await createVersion(authored.id, {}));
    const two = await bodyOf<VersionBody>(await createVersion(authored.id, {}));

    const first = await publishVersion(authored.id, one.id, one.recordVersion);
    expect(first.status).toBe(200);
    const live = await bodyOf<VersionBody>(first);

    // `uq_report_configuration_versions_published` — at most one per configuration.
    const second = await publishVersion(authored.id, two.id, two.recordVersion);
    expect(second.status).toBe(409);
    const conflict = await refusalOf(second);
    expect(conflict.code).toBe('ERR-CON-001');
    expect(conflict.violations).toContainEqual({
      path: 'path.versionId',
      rule: 'version_already_published',
    });
    expect((await versionRow(two.id))?.status).toBe('draft');

    /*
     * The immutability of a published version, refused BY THE DATABASE.
     *
     * The `If-Match` here is the CURRENT counter of the published row, so the
     * optimistic guard cannot be what refuses this: the UPDATE reaches the row and
     * `rpt.guard_report_version_freeze` raises, because the statement writes
     * `published_at = now()` and the guard compares it against the stored instant.
     * Letting the trigger stamp the column instead would make this a silent no-op
     * that advanced `record_version` and told the caller nothing.
     */
    const republish = await publishVersion(authored.id, one.id, live.recordVersion);
    expect(republish.status).toBe(409);
    const frozenRefusal = await refusalOf(republish);
    expect(frozenRefusal.code).toBe('ERR-CON-001');
    expect(frozenRefusal.violations).toContainEqual({
      path: 'path.versionId',
      rule: 'version_immutable',
    });
    const frozen = await versionRow(one.id);
    expect(frozen?.status).toBe('published');
    // Nothing moved: a refused republication burns no version.
    expect(frozen?.record_version).toBe(live.recordVersion);
  });

  it('refuses a version id that belongs to another configuration', async () => {
    const a = await authorConfiguration({ stem: 'publish_a' });
    const b = await authorConfiguration({ stem: 'publish_b' });
    authAs(RPT_CONFIGURER);
    const version = await bodyOf<VersionBody>(await createVersion(a.id, {}));
    const response = await publishVersion(b.id, version.id, version.recordVersion);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe('ERR-RES-001');
    expect((await versionRow(version.id))?.status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// The catalogue interplay — what the reader actually sees
// ---------------------------------------------------------------------------

describe('the P1-23 catalogue reads what this seam writes', () => {
  it('shows a published definition with executable false, and never a draft', async () => {
    const live = await authorConfiguration({ stem: 'catalogue_live' });
    const draft = await authorConfiguration({ stem: 'catalogue_draft' });
    authAs(RPT_CONFIGURER);

    const version = await bodyOf<VersionBody>(
      await createVersion(live.id, { parameterSchema: { branchId: { type: 'uuid' } } })
    );
    expect((await publishVersion(live.id, version.id, version.recordVersion)).status).toBe(200);
    expect((await setStatus(live.id, 'published', live.recordVersion)).status).toBe(200);

    // Read by the principal that holds ONLY `rpt.report.read`: it wrote none of
    // these rows and cannot reach the seam that did.
    authAs(RPT_READER);
    const catalogue = await bodyOf<CatalogueBody>(await listPublishedReports());
    const entry = catalogue.items.find((item) => item.reportCode === live.reportCode);
    expect(entry).toBeDefined();
    // The definition is publishable and STILL NOT RUNNABLE. The engine is Owner
    // decision D-4 and this slice does not move the literal.
    expect(entry?.executable).toBe(false);
    expect(entry?.versionNumber).toBe(1);
    expect(catalogue.items.some((item) => item.reportCode === draft.reportCode)).toBe(false);

    // Archiving takes it away again.
    authAs(RPT_CONFIGURER);
    const current = await bodyOf<DetailBody>(await readConfiguration(live.id));
    expect((await setStatus(live.id, 'archived', current.configuration.recordVersion)).status).toBe(
      200
    );
    authAs(RPT_READER);
    const after = await bodyOf<CatalogueBody>(await listPublishedReports());
    expect(after.items.some((item) => item.reportCode === live.reportCode)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('the administration reads', () => {
  it('lists drafts and archived definitions, and filters on status', async () => {
    const archived = await authorConfiguration({ stem: 'list_archived' });
    authAs(RPT_CONFIGURER);
    expect((await setStatus(archived.id, 'archived', archived.recordVersion)).status).toBe(200);

    const all = await bodyOf<ListBody>(await listConfigurations({ limit: 100 }));
    const codes = all.configurations.items.map((item) => item.reportCode);
    expect(codes).toContain(MAIN.reportCode);
    expect(codes).toContain(archived.reportCode);

    const onlyArchived = await bodyOf<ListBody>(
      await listConfigurations({ status: 'archived', limit: 100 })
    );
    expect(onlyArchived.configurations.items.every((item) => item.status === 'archived')).toBe(
      true
    );
    expect(onlyArchived.configurations.items.map((item) => item.reportCode)).toContain(
      archived.reportCode
    );
  });

  it('pages on a cursor the response does not carry, and the two pages are disjoint', async () => {
    // Authored inside one sitting, which is the case the microsecond cursor exists
    // for: a millisecond-truncated cursor silently skips rows sharing a boundary.
    await authorConfiguration({ stem: 'page_a' });
    await authorConfiguration({ stem: 'page_b' });
    await authorConfiguration({ stem: 'page_c' });
    authAs(RPT_CONFIGURER);

    const first = await bodyOf<ListBody>(await listConfigurations({ limit: 2 }));
    expect(first.configurations.items).toHaveLength(2);
    expect(first.configurations.hasMore).toBe(true);
    expect(first.configurations.nextCursor).not.toBeNull();

    const second = await bodyOf<ListBody>(
      await listConfigurations({ limit: 2, cursor: first.configurations.nextCursor ?? '' })
    );
    const firstIds = new Set(first.configurations.items.map((item) => item.id));
    for (const item of second.configurations.items) expect(firstIds.has(item.id)).toBe(false);
  });

  it('refuses an unknown status filter and a malformed identifier', async () => {
    authAs(RPT_CONFIGURER);
    const badFilter = await listConfigurations({ status: 'retired' });
    expect(badFilter.status).toBe(422);
    expect(await codeOf(badFilter)).toBe('ERR-VAL-001');

    const badId = await readConfiguration('not-a-uuid');
    expect(badId.status).toBe(422);
    expect(await codeOf(badId)).toBe('ERR-VAL-001');

    const absent = await readConfiguration(randomUUID());
    expect(absent.status).toBe(404);
    expect(await codeOf(absent)).toBe('ERR-RES-001');
  });
});

// ---------------------------------------------------------------------------
// Authorization — the two refusals this seam is built around
// ---------------------------------------------------------------------------

describe('a caller holding only rpt.report.read', () => {
  it('is refused every operation of the seam, naming the configure code', async () => {
    authAs(RPT_READER);
    const responses = [
      await listConfigurations(),
      await readConfiguration(MAIN.id),
      await createConfiguration({
        reportCode: nextCode('reader'),
        name: 'n',
        scopeLevel: 'branch',
        exportPermissionCode: EXPORT_CODE,
      }),
      await updateConfiguration(MAIN.id, { name: 'n' }, MAIN.recordVersion),
      await setStatus(MAIN.id, 'published', MAIN.recordVersion),
      await createVersion(MAIN.id, {}),
      await publishVersion(MAIN.id, randomUUID(), 1),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      const problem = await problemOf(response);
      expect(problem.code).toBe('ERR-IAM-001');
      expect(problem.requiredPermissions).toContain(CONFIGURE);
    }
    // And it can still read the published catalogue, which is what its code is for.
    expect((await listPublishedReports()).status).toBe(200);
  });
});

describe('a caller holding rpt.report.configure through a branch-scoped grant', () => {
  it('is refused every operation of the seam by the tenant-wide re-check', async () => {
    authAs(RPT_SCOPED);
    const responses = [
      await listConfigurations(),
      await readConfiguration(MAIN.id),
      await createConfiguration({
        reportCode: nextCode('scoped'),
        name: 'n',
        scopeLevel: 'branch',
        exportPermissionCode: EXPORT_CODE,
      }),
      await updateConfiguration(MAIN.id, { name: 'n' }, MAIN.recordVersion),
      await setStatus(MAIN.id, 'published', MAIN.recordVersion),
      await createVersion(MAIN.id, {}),
      await publishVersion(MAIN.id, randomUUID(), 1),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe('ERR-IAM-001');
    }
    // Nothing was written, and the target row did not move.
    expect((await configurationRow(MAIN.id))?.record_version).toBe(MAIN.recordVersion);
  });
});

describe('another tenant', () => {
  it('sees none of this tenant’s definitions and gets 404 rather than 403 on every one', async () => {
    authAs(RPT_TENANT_B);
    const list = await listConfigurations({ limit: 100 });
    expect(list.status).toBe(200);
    const items = (await bodyOf<ListBody>(list)).configurations.items;
    expect(items.some((item) => item.reportCode === MAIN.reportCode)).toBe(false);

    const responses = [
      await readConfiguration(MAIN.id),
      await updateConfiguration(MAIN.id, { name: 'n' }, MAIN.recordVersion),
      await setStatus(MAIN.id, 'published', MAIN.recordVersion),
      await createVersion(MAIN.id, {}),
      await publishVersion(MAIN.id, randomUUID(), 1),
    ];
    for (const response of responses) {
      // 404 and never 403: a foreign tenant must not learn that the id names a row.
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe('ERR-RES-001');
    }
    expect((await configurationRow(MAIN.id))?.record_version).toBe(MAIN.recordVersion);
  });
});
