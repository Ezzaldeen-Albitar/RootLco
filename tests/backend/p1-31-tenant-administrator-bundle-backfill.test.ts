/**
 * P1-31 — the tenant administrator bundle backfill, proved on real rows
 * (Owner decision **D-2** of 2026-09-08; P1-31 CC-11, closing CC-03 and CC-08).
 *
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs` is the one
 * sanctioned way an EXISTING organisation's administrator role is brought up to
 * the current `TENANT_ADMINISTRATOR_ROLE.permissionCodes`. It is driven here as
 * a module on the admin connection — the same privileged connection an operator
 * would use — and its properties are asserted rather than described.
 *
 * ## Why a privileged connection, and why that is the whole argument
 *
 * `ins_role_permissions_platform_bootstrap` (20260831093000) is the only policy
 * admitting the platform role to `iam.role_permissions`, and its WITH CHECK
 * requires `org.tenants.status = 'provisioning'`. Every organisation this
 * backfill exists for is `active`, and the table is FORCE ROW LEVEL SECURITY.
 * A route would be refused by the database; publishing one would need a
 * migration widening that policy permanently. BF-9 measures the refusal rather
 * than asserting it, so the choice of mechanism is falsifiable.
 *
 * ## The five obligations, one test each
 *
 *   BF-1  an organisation on the OLD bundle gains exactly the missing codes and
 *         no others, and every mapping row it already had survives by id
 *   BF-2  running it again changes nothing: `unchanged`, no row, no audit record
 *   BF-3  a role customised beyond the bundle keeps its customisations — an
 *         extra allow survives, and a tenant's own `deny` is left alone and
 *         reported rather than re-decided
 *   BF-4  after the backfill a principal of that organisation performs reads the
 *         stale bundle refused, including `wty.warranty-detail` — the read the
 *         P-7 re-pointing took away (CC-08)
 *   BF-5  no other tenant is touched: a second stale organisation is unchanged,
 *         row for row, and gains no audit record
 *
 * and four more that hold the mechanism honest:
 *
 *   BF-6  the authority gate is real: an account without
 *         `platform.organization.provision` is refused, and no code is minted
 *   BF-7  the bundle the tool widens to is the CONSTANT the provisioning path
 *         writes — the parser and the import agree, so the two cannot drift
 *   BF-8  additive only, structurally: the script issues no DELETE and no
 *         UPDATE, and a dry run leaves the database exactly as it found it
 *   BF-9  a route could not do this — the platform INSERT policy refuses an
 *         active tenant, which is why no migration is added
 *
 * ## Where it runs
 *
 * On the SHARED database, like `p1-31-provisioning-bundle.test.ts`, and against
 * tenants THIS SUITE provisions through the shipped provisioning route and drops
 * afterwards. Nothing here reads or writes an organisation it did not create.
 * The stale state is constructed by removing, from the suite's own fresh
 * tenants, exactly the eight codes the three P1-31 widenings added — which
 * reproduces the 67-code bundle those organisations really hold.
 *
 * Operations exercised: platform.organization-provision, iam.role-create,
 * iam.role-permission-add, wty.warranty-list, wty.warranty-detail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  deleteTenantCascade,
  ensureBackendFixtures,
  ensureTestLogins,
  platformAppPool,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPlatformPoolForTests, __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import {
  FakeIdentityProvider,
  TENANT_ADMINISTRATOR_ROLE,
  setIdentityProvider,
} from '@/modules/iam';
import { __resetIdentityProviderForTests } from '@/modules/iam/provider/identity-provider';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import {
  BACKFILL_AUDIT_ACTION,
  REQUIRED_PLATFORM_CODE,
  TARGET_ROLE_CODE,
  readTenantAdministratorBundle,
  runBackfill,
} from '../../scripts/platform/backfill-tenant-administrator-bundle.mjs';
import { POST as organizationProvisionRoute } from '@/app/api/v1/platform/organizations/route';
import { POST as roleCreateRoute } from '@/app/api/v1/iam/roles/route';
import { POST as rolePermissionAddRoute } from '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import { WARRANTY_LIST_OPERATION, GET as warrantyListRoute } from '@/app/api/v1/warranties/route';
import {
  WARRANTY_DETAIL_OPERATION,
  GET as warrantyDetailRoute,
} from '@/app/api/v1/warranties/[warrantyId]/route';

/**
 * The eight codes the three P1-31 widenings added (#322 P-1's six, #349 P-7's
 * one, and P-10's one). Written out rather than derived: removing these from a
 * freshly provisioned role reproduces the 67-code bundle the real organisations
 * hold, and a list computed from the constant under test would prove nothing.
 *
 * `wty.policy.manage` joined on 2026-09-09 when P-10 published the five
 * operations that declare it, closing CC-01. It is the reason this backfill owes
 * a THIRD operator run: an organisation provisioned on the 74-code bundle can
 * read a warranty and cannot configure the policy any warranty must be issued
 * under, and cannot delegate that authority either.
 */
const P1_31_ADDED = Object.freeze([
  'sal.delivery.manage',
  'sal.delivery.view',
  'sal.delivery.complete',
  'wty.warranty.issue',
  'rpt.report.read',
  'iam.audit.view',
  'wty.warranty.read',
  'wty.policy.manage',
]);

/** The bundle before the three P1-31 widenings. Unchanged by all three. */
const BUNDLE_BEFORE = 67;

/** A real catalogue code the bundle deliberately does NOT carry (P1-31 CC-04). */
const CUSTOMISATION_CODE = 'rpt.export';

/** The bundle code the customised tenant denies for itself. */
const DENIED_CODE = 'sal.delivery.complete';

const IDENTITY_PROVIDER = 'test_harness';
const SUBJECT_HOLDER = 'fx_p131bf_platform_holder';
const USER_HOLDER = 'd3110000-0000-4000-8000-00000000002a';
/** An account that exists and holds NO platform grant — BF-6's negative. */
const SUBJECT_STRANGER = 'fx_p131bf_stranger';
const USER_STRANGER = 'd3110000-0000-4000-8000-00000000002b';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
/** Distinct from every sibling suite's prefix: they delete tenants by prefix. */
const RUN = Math.random().toString(36).slice(2, 8);
const TENANT_PREFIX = `p31bf${RUN}`;
const HOLDER_EMAIL = `${SUBJECT_HOLDER}@fixture.test`;
const STRANGER_EMAIL = `${SUBJECT_STRANGER}@fixture.test`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;

/** The bundle as the SCRIPT reads it, from `bootstrap-roles.ts`. */
const parsedBundle = readTenantAdministratorBundle();

interface CallResult<T> {
  readonly status: number;
  readonly body: T;
}
type RouteHandler = (
  request: Request,
  route: { params: Promise<Record<string, string>> }
) => Promise<Response>;

async function call<T>(
  handler: unknown,
  input: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
    readonly params?: Record<string, string>;
    readonly idempotencyKey?: string;
  }
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

function asHolder(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJECT_HOLDER,
      tenantId: TENANT_A,
    })
  );
}

interface Provisioned {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly ownerAccountId: string;
  readonly tenantAdministratorRoleId: string;
  readonly identityProvider: string;
  readonly providerSubject: string;
  readonly companyId: string;
  readonly branchId: string;
}

function asOwnerOf(tenant: Provisioned): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: tenant.identityProvider,
      providerSubject: tenant.providerSubject,
      tenantId: tenant.tenantId,
    })
  );
}

async function provision(code: string): Promise<Provisioned> {
  asHolder();
  const tenantCode = `${TENANT_PREFIX}_${code}`;
  const result = await call<{
    tenantId: string;
    ownerAccountId: string;
    tenantAdministratorRoleId: string;
  }>(organizationProvisionRoute, {
    path: '/platform/organizations',
    body: {
      tenant: {
        code: tenantCode,
        display_name: 'P1-31 backfill probe',
        locale: 'en',
        timezone: 'UTC',
      },
      company: { code: 'p31bfc', legal_name: 'P31 Backfill Ltd', base_currency: 'JOD' },
      branch: { code: 'main', name: 'Main', timezone: 'UTC' },
      owner: { email: `owner_${code}_${RUN}@fixture.test`, displayName: 'First Owner' },
      activate: true,
    },
    idempotencyKey: randomUUID(),
  });
  expect(result.status).toBe(201);
  const identity = await admin.query<{ identity_provider: string; provider_subject: string }>(
    'SELECT identity_provider, provider_subject FROM iam.user_accounts WHERE id = $1',
    [result.body.ownerAccountId]
  );
  const row = identity.rows[0];
  if (!row) throw new Error('provisioned owner account has no identity to act as');
  const company = await admin.query<{ id: string }>(
    'SELECT id FROM org.legal_companies WHERE tenant_id = $1',
    [result.body.tenantId]
  );
  const branch = await admin.query<{ id: string }>(
    'SELECT id FROM org.branches WHERE tenant_id = $1',
    [result.body.tenantId]
  );
  const companyId = company.rows[0]?.id;
  const branchId = branch.rows[0]?.id;
  if (!companyId || !branchId) throw new Error('provisioned organisation has no company or branch');
  return {
    tenantId: result.body.tenantId,
    tenantCode,
    ownerAccountId: result.body.ownerAccountId,
    tenantAdministratorRoleId: result.body.tenantAdministratorRoleId,
    identityProvider: row.identity_provider,
    providerSubject: row.provider_subject,
    companyId,
    branchId,
  };
}

/** Allow-codes mapped onto one role. */
async function codesOfRole(roleId: string): Promise<string[]> {
  const { rows } = await admin.query<{ permission_code: string }>(
    `SELECT p.permission_code
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1 AND rp.effect = 'allow'
      ORDER BY p.permission_code`,
    [roleId]
  );
  return rows.map((r) => r.permission_code);
}

/** Every mapping row of a role, by id — the fingerprint BF-1 and BF-5 compare. */
async function mappingRows(roleId: string): Promise<string[]> {
  const { rows } = await admin.query<{ fingerprint: string }>(
    `SELECT rp.id || ':' || p.permission_code || ':' || rp.effect AS fingerprint
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.permission_code`,
    [roleId]
  );
  return rows.map((r) => r.fingerprint);
}

async function backfillAuditCount(tenantId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM iam.audit_records WHERE tenant_id = $1 AND action = $2',
    [tenantId, BACKFILL_AUDIT_ACTION]
  );
  return rows[0]?.n ?? 0;
}

/** Removes the eight P1-31 codes, reproducing the 67-code bundle on a fresh role. */
async function makeStale(tenant: Provisioned): Promise<void> {
  await admin.query(
    `DELETE FROM iam.role_permissions
      WHERE role_id = $1
        AND permission_id IN (SELECT id FROM iam.permissions WHERE permission_code = ANY($2::text[]))`,
    [tenant.tenantAdministratorRoleId, [...P1_31_ADDED]]
  );
  expect(await codesOfRole(tenant.tenantAdministratorRoleId)).toHaveLength(BUNDLE_BEFORE);
}

function backfillInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: 'local-acceptance',
    dryRun: false,
    all: false,
    tenants: [],
    db: {},
    operator: { email: HOLDER_EMAIL },
    evidencePath: '',
    ...overrides,
  };
}

/** One organisation's line in the tool's report. */
interface BackfillOrganisation {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly status: string;
  readonly outcome: 'widened' | 'unchanged' | 'no-administrator-role';
  readonly roleId: string | null;
  readonly heldBefore: number;
  readonly heldAfter: number;
  readonly added: readonly string[];
  readonly blockedByDeny: readonly string[];
  readonly auditRecordId?: string;
}

interface BackfillReport {
  readonly outcome: 'applied' | 'dry-run';
  readonly operatorAccountId: string;
  readonly bundleSize: number;
  readonly considered: number;
  readonly widened: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly organisations: readonly BackfillOrganisation[];
}

/** Drives the script against the real database, on the admin connection. */
async function backfill(overrides: Record<string, unknown>): Promise<BackfillReport> {
  const client = await admin.connect();
  try {
    return (await runBackfill(client, backfillInput(overrides), parsedBundle)) as BackfillReport;
  } finally {
    client.release();
  }
}

/** The first organisation in a report, refusing an empty one rather than reading undefined. */
function only(report: BackfillReport): BackfillOrganisation {
  const organisation = report.organisations[0];
  if (organisation === undefined) throw new Error('the backfill reported no organisation');
  return organisation;
}

let stale: Provisioned;
let customised: Provisioned;
let bystander: Provisioned;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = 'https://app.test/welcome';
  __resetBackendConfigForTests();
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'p1-31-backfill-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  for (const [id, subject, email] of [
    [USER_HOLDER, SUBJECT_HOLDER, HOLDER_EMAIL],
    [USER_STRANGER, SUBJECT_STRANGER, STRANGER_EMAIL],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'P1-31 backfill fixture', 'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, IDENTITY_PROVIDER, subject, email, SYSTEM_ACTOR]
    );
  }
  // Only the holder gets platform authority. The stranger stays an ordinary
  // account so BF-6's refusal is about the grant and nothing else.
  for (const code of [
    'platform.organization.provision',
    'platform.organization.lifecycle',
    'platform.organization.read',
  ]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [USER_HOLDER, code, SYSTEM_ACTOR]
    );
  }
  runtime = runtimeAppPool(6);
  platform = platformAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setPlatformPoolForTests(platform);

  stale = await provision('stale');
  customised = await provision('custom');
  bystander = await provision('bystdr');

  await makeStale(stale);
  await makeStale(customised);
  await makeStale(bystander);

  // The customised tenant's own decisions about its own administrator role: one
  // allow BEYOND the bundle, and one deny INSIDE it.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $4 FROM iam.permissions p WHERE p.permission_code = $3`,
    [customised.tenantId, customised.tenantAdministratorRoleId, CUSTOMISATION_CODE, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'deny', $4 FROM iam.permissions p WHERE p.permission_code = $3`,
    [customised.tenantId, customised.tenantAdministratorRoleId, DENIED_CODE, SYSTEM_ACTOR]
  );
}, 240_000);

afterAll(async () => {
  __resetAuthenticatorForTests();
  __resetIdentityProviderForTests();
  __setPrimaryPoolForTests(undefined);
  __setPlatformPoolForTests(undefined);
  await runtime.end();
  await platform.end();
  const provisioned = await admin.query<{ id: string }>(
    'SELECT id FROM org.tenants WHERE tenant_code LIKE $1',
    [`${TENANT_PREFIX}%`]
  );
  await deleteTenantCascade(
    admin,
    provisioned.rows.map((row) => row.id)
  );
  await admin.query(
    "DELETE FROM shared.idempotency_keys WHERE operation IN ('org_provisioning','platform_organization_provision')"
  );
  await admin.query('DELETE FROM iam.platform_grants WHERE account_id = $1', [USER_HOLDER]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])', [
    [USER_HOLDER, USER_STRANGER],
  ]);
  await cleanBackendFixtures(admin);
  await admin.end();
}, 120_000);

describe('P1-31 D-2 — the mechanism', () => {
  it('BF-7 the tool widens to the constant the provisioning path writes, and the two cannot drift', () => {
    expect([...parsedBundle].sort()).toEqual([...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort());
    expect(parsedBundle).toHaveLength(TENANT_ADMINISTRATOR_ROLE.permissionCodes.length);
    // The eight this backfill exists to deliver are in it, and the withheld
    // export code is not: a backfill must never widen past the bundle.
    for (const code of P1_31_ADDED) expect(parsedBundle).toContain(code);
    expect(parsedBundle).not.toContain(CUSTOMISATION_CODE);
    expect(parsedBundle).toHaveLength(BUNDLE_BEFORE + P1_31_ADDED.length);
  });

  it('BF-8 additive only, structurally: the script issues no DELETE and no UPDATE', () => {
    const source = readFileSync(
      join(REPOSITORY_ROOT, 'scripts', 'platform', 'backfill-tenant-administrator-bundle.mjs'),
      'utf8'
    );
    // Every SQL statement the tool can execute, read out of the template
    // literals it sends. A revoking verb cannot hide in a comment: only the
    // statements are inspected.
    const statements = [...source.matchAll(/client\.query\(\s*(`[^`]*`|'[^']*')/g)].map((m) =>
      (m[1] ?? '').replace(/^[`']|[`']$/g, '').trim()
    );
    expect(statements.length).toBeGreaterThan(6);
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDELETE\b/i);
      expect(statement).not.toMatch(/\bUPDATE\b/i);
      expect(statement).not.toMatch(/\bTRUNCATE\b/i);
      expect(statement).not.toMatch(/\bREVOKE\b/i);
    }
    // Its only write to the mapping table is an allow insert.
    const writes = statements.filter((s) => /INSERT INTO iam\.role_permissions/i.test(s));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/'allow'/);
  });

  it('BF-6 the authority gate is real: an account without the platform code is refused', async () => {
    const before = await codesOfRole(stale.tenantAdministratorRoleId);
    await expect(
      backfill({ tenants: [stale.tenantId], operator: { email: STRANGER_EMAIL } })
    ).rejects.toMatchObject({ exitCode: 4 });
    await expect(
      backfill({ tenants: [stale.tenantId], operator: { email: `absent_${RUN}@fixture.test` } })
    ).rejects.toMatchObject({ exitCode: 4 });
    // Refused, and nothing moved.
    expect(await codesOfRole(stale.tenantAdministratorRoleId)).toEqual(before);
    // The gate names an EXISTING platform permission; none is minted.
    expect(REQUIRED_PLATFORM_CODE).toBe('platform.organization.provision');
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM iam.permissions WHERE permission_code = $1',
      [REQUIRED_PLATFORM_CODE]
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('BF-9 a route could not do this: the platform INSERT policy refuses an active tenant', async () => {
    const { rows } = await admin.query<{ qual: string }>(
      `SELECT with_check AS qual FROM pg_policies
        WHERE schemaname = 'iam' AND tablename = 'role_permissions'
          AND policyname = 'ins_role_permissions_platform_bootstrap'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.qual).toMatch(/provisioning/);
    // And the organisations the backfill is for are not in that state.
    const { rows: state } = await admin.query<{ status: string }>(
      'SELECT status FROM org.tenants WHERE id = $1',
      [stale.tenantId]
    );
    expect(state[0]?.status).toBe('active');
    // The table forces RLS, so the owner connection is bound by it too; only a
    // BYPASSRLS role can write here, which is what the operator connection is.
    const { rows: forced } = await admin.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class
        WHERE oid = 'iam.role_permissions'::regclass`
    );
    expect(forced[0]?.relforcerowsecurity).toBe(true);
  });
});

describe('P1-31 D-2 — the five obligations, on real rows', () => {
  it('BF-8b a dry run leaves the database exactly as it found it', async () => {
    const before = await mappingRows(stale.tenantAdministratorRoleId);
    const auditBefore = await backfillAuditCount(stale.tenantId);
    const result = await backfill({ tenants: [stale.tenantId], dryRun: true });
    expect(result.outcome).toBe('dry-run');
    expect(only(result)).toMatchObject({ outcome: 'widened' });
    expect(await mappingRows(stale.tenantAdministratorRoleId)).toEqual(before);
    expect(await backfillAuditCount(stale.tenantId)).toBe(auditBefore);
  });

  it('BF-1 an organisation on the old bundle gains exactly the missing codes and no others', async () => {
    const before = await codesOfRole(stale.tenantAdministratorRoleId);
    const beforeRows = await mappingRows(stale.tenantAdministratorRoleId);
    expect(before).toHaveLength(BUNDLE_BEFORE);
    for (const code of P1_31_ADDED) expect(before).not.toContain(code);

    const result = await backfill({ tenants: [stale.tenantId] });
    expect(result.outcome).toBe('applied');
    expect(result.organisations).toHaveLength(1);
    expect(only(result)).toMatchObject({
      tenantId: stale.tenantId,
      tenantCode: stale.tenantCode,
      outcome: 'widened',
      heldBefore: BUNDLE_BEFORE,
      heldAfter: parsedBundle.length,
      blockedByDeny: [],
    });
    expect(only(result).added).toEqual([...P1_31_ADDED].sort());

    const after = await codesOfRole(stale.tenantAdministratorRoleId);
    expect(after).toEqual([...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort());
    // Exactly the delta, computed on the rows rather than trusted from the report.
    expect(after.filter((code) => !before.includes(code))).toEqual([...P1_31_ADDED].sort());
    expect(before.filter((code) => !after.includes(code))).toEqual([]);
    // NOTHING was revoked: every mapping row that existed still exists, by id.
    const afterRows = await mappingRows(stale.tenantAdministratorRoleId);
    for (const row of beforeRows) expect(afterRows).toContain(row);
    expect(afterRows).toHaveLength(beforeRows.length + P1_31_ADDED.length);

    // It recorded what it changed, in that organisation's own audit trail.
    expect(await backfillAuditCount(stale.tenantId)).toBe(1);
    const { rows: detail } = await admin.query<{ field_name: string; new_value_masked: string }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.audit_record_id = r.id
        WHERE r.tenant_id = $1 AND r.action = $2 AND d.field_name = 'permission_codes_added'`,
      [stale.tenantId, BACKFILL_AUDIT_ACTION]
    );
    expect(detail[0]?.new_value_masked).toBe([...P1_31_ADDED].sort().join(','));
  });

  it('BF-2 running it again changes nothing', async () => {
    const before = await mappingRows(stale.tenantAdministratorRoleId);
    const auditBefore = await backfillAuditCount(stale.tenantId);
    const result = await backfill({ tenants: [stale.tenantId] });
    expect(only(result)).toMatchObject({
      outcome: 'unchanged',
      heldBefore: parsedBundle.length,
      heldAfter: parsedBundle.length,
    });
    expect(only(result).added).toEqual([]);
    expect(await mappingRows(stale.tenantAdministratorRoleId)).toEqual(before);
    // No second audit record: an idempotent no-op records nothing.
    expect(await backfillAuditCount(stale.tenantId)).toBe(auditBefore);
  });

  it('BF-3 a role customised beyond the bundle keeps its customisations and loses nothing', async () => {
    const before = await mappingRows(customised.tenantAdministratorRoleId);
    expect(await codesOfRole(customised.tenantAdministratorRoleId)).toContain(CUSTOMISATION_CODE);

    const result = await backfill({ tenants: [customised.tenantId] });
    const organisation = only(result);
    expect(organisation).toMatchObject({ outcome: 'widened' });
    // The denied code is LEFT ALONE and reported, never re-decided by update.
    expect(organisation.blockedByDeny).toEqual([DENIED_CODE]);
    expect(organisation.added).toEqual(
      [...P1_31_ADDED].filter((code) => code !== DENIED_CODE).sort()
    );

    const after = await mappingRows(customised.tenantAdministratorRoleId);
    // Every row it had — the extra allow and the deny included — survives by id.
    for (const row of before) expect(after).toContain(row);
    const codes = await codesOfRole(customised.tenantAdministratorRoleId);
    expect(codes).toContain(CUSTOMISATION_CODE);
    expect(codes).not.toContain(DENIED_CODE);
    const { rows: effect } = await admin.query<{ effect: string }>(
      `SELECT rp.effect FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.permission_code = $2`,
      [customised.tenantAdministratorRoleId, DENIED_CODE]
    );
    expect(effect).toHaveLength(1);
    expect(effect[0]?.effect).toBe('deny');
  });

  it('BF-3b no role other than the tenant administrator role is touched', async () => {
    // A role the tenant built for itself, with one code of its own.
    asOwnerOf(customised);
    const created = await call<{ id: string }>(roleCreateRoute, {
      path: '/iam/roles',
      body: {
        roleCode: `custom_${RUN}`,
        name: 'Custom',
        description: 'A role the tenant owns',
      },
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    const roleId = created.body.id;
    const mapped = await call(rolePermissionAddRoute, {
      path: `/iam/roles/${roleId}/permissions`,
      params: { roleId },
      body: { permissionCode: 'wo.work_order.read', effect: 'allow' },
      idempotencyKey: randomUUID(),
    });
    expect(mapped.status).toBe(201);
    const before = await mappingRows(roleId);
    expect(before).toHaveLength(1);

    await backfill({ tenants: [customised.tenantId] });
    expect(await mappingRows(roleId)).toEqual(before);
    expect(TARGET_ROLE_CODE).toBe('tenant_administrator');
  });

  it('BF-4 after the backfill a principal performs the reads the stale bundle refused, warranty detail included', async () => {
    // `bystander` is still stale here; BF-5 depends on that and runs after.
    const probe = await provision('read');
    await makeStale(probe);
    const warrantyId = randomUUID();

    asOwnerOf(probe);
    const listBefore = await call<{ code?: string; requiredPermissions?: string[] }>(
      warrantyListRoute,
      {
        path: `/warranties?companyId=${probe.companyId}&branchId=${probe.branchId}&limit=5`,
        method: 'GET',
      }
    );
    expect(listBefore.status).toBe(403);
    expect(listBefore.body.code).toBe('ERR-IAM-001');
    expect(listBefore.body.requiredPermissions).toEqual(['wty.warranty.read']);

    const detailBefore = await call<{ code?: string; requiredPermissions?: string[] }>(
      warrantyDetailRoute,
      {
        path: `/warranties/${warrantyId}`,
        method: 'GET',
        params: { warrantyId },
      }
    );
    expect(detailBefore.status).toBe(403);
    expect(detailBefore.body.code).toBe('ERR-IAM-001');
    expect(detailBefore.body.requiredPermissions).toEqual(['wty.warranty.read']);

    const result = await backfill({ tenants: [probe.tenantId] });
    expect(only(result)).toMatchObject({ outcome: 'widened' });

    asOwnerOf(probe);
    const listAfter = await call<{ items: unknown[] }>(warrantyListRoute, {
      path: `/warranties?companyId=${probe.companyId}&branchId=${probe.branchId}&limit=5`,
      method: 'GET',
    });
    expect(listAfter.status).toBe(200);
    expect(Array.isArray(listAfter.body.items)).toBe(true);

    // The detail read the P-7 re-pointing took away (CC-08). The organisation
    // holds no warranty, so the authorized answer is 404 — what matters is that
    // it is no longer the 403 the permission gate raised a moment ago.
    const detailAfter = await call<{ code?: string }>(warrantyDetailRoute, {
      path: `/warranties/${warrantyId}`,
      method: 'GET',
      params: { warrantyId },
    });
    expect(detailAfter.status).not.toBe(403);
    expect(detailAfter.status).toBe(404);

    // Both reads are gated on the minted code, by declaration.
    expect(WARRANTY_LIST_OPERATION.permissions).toEqual(['wty.warranty.read']);
    expect(WARRANTY_DETAIL_OPERATION.permissions).toEqual(['wty.warranty.read']);
  });

  it('BF-5 no other tenant is touched', async () => {
    const before = await mappingRows(bystander.tenantAdministratorRoleId);
    expect(before).toHaveLength(BUNDLE_BEFORE);
    const auditBefore = await backfillAuditCount(bystander.tenantId);

    const result = await backfill({ tenants: [stale.tenantId, customised.tenantId] });
    expect(result.organisations.map((o) => o.tenantId)).toEqual([
      stale.tenantId,
      customised.tenantId,
    ]);

    // Row for row, id for id, effect for effect.
    expect(await mappingRows(bystander.tenantAdministratorRoleId)).toEqual(before);
    expect(await backfillAuditCount(bystander.tenantId)).toBe(auditBefore);
    expect(auditBefore).toBe(0);
  });

  it('BF-5b a sweep reports the list it acted on rather than sweeping silently', async () => {
    const result = await backfill({ all: true, dryRun: true });
    const codes = result.organisations.map((o) => o.tenantCode);
    // Every organisation is named in the report, including the ones it skipped.
    expect(codes).toContain(bystander.tenantCode);
    expect(codes).toContain(stale.tenantCode);
    expect(result.considered).toBe(result.organisations.length);
    // A tenant with no administrator role is reported and skipped, never created.
    const skipped = result.organisations.filter((o) => o.outcome === 'no-administrator-role');
    for (const organisation of skipped) expect(organisation.roleId).toBeNull();
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM iam.roles WHERE tenant_id = $1 AND role_code = $2',
      [TENANT_A, TARGET_ROLE_CODE]
    );
    expect(rows[0]?.n).toBe(0);
  });
});
