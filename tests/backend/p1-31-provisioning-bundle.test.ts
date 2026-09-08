/**
 * P1-31 prerequisite P-1 — the provisioning bundle carries the P1-31 codes.
 *
 * The P1-31 A0 preflight (`docs/phase-1/phase-1-31/a0-preflight.md`, "The
 * closure that sits above all sixteen") measured that the two roles
 * `platform.organization-provision` writes held ZERO of the nine codes P1-31
 * needs, and that `ins_role_permissions_delegable` admits a mapping only when
 * the acting administrator already holds the code being mapped. That is a
 * CLOSURE, not an inconvenience: no principal in an organisation created by the
 * shipped operation could hold a P1-31 code, or ever be granted one.
 *
 * Seven of the nine are added. Two are deliberately EXCLUDED — `wty.policy.manage`
 * and `rpt.report.configure`, which no operation declares and no policy predicate
 * names (P1-31 CC-01, CC-02). This suite proves the split on real rows rather
 * than on the constant:
 *
 *   P31-B1  the bundle's delta is exactly the seven, nothing else moved, and
 *           every one of the seven is declared by a REGISTERED operation while
 *           each excluded code is declared by none
 *   P31-B2  an organisation created by the SHIPPED provisioning operation gives
 *           its administrator role all seven, and neither excluded code
 *   P31-B3  the Owner of that organisation effectively holds all seven, and the
 *           role holds nothing beyond the server-owned bundle
 *   P31-B4  the Owner can MAP each of the seven onto a role it creates — the
 *           exact act `ins_role_permissions_delegable` refused before
 *   P31-B5  each EXCLUDED code is refused, with the registered refusal:
 *           403 ERR-IAM-001, `requiredPermissions` naming the withheld code
 *   P31-B6  delegation is still held-only — three codes outside the bundle that
 *           were refused before are refused now, by the same failure
 *   P31-B7  three shipped reads gated on added codes answer for the provisioned
 *           Owner, including the audit list the shipped Audit Log screen calls
 *
 * Operations exercised: platform.organization-provision, iam.role-create,
 * iam.role-permission-add, iam.audit-event-list, rpt.report-catalogue,
 * shared.export-catalogue.
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
import { POST as organizationProvisionRoute } from '@/app/api/v1/platform/organizations/route';
import { ROLE_CREATE_OPERATION, POST as roleCreateRoute } from '@/app/api/v1/iam/roles/route';
import {
  ROLE_PERMISSION_ADD_OPERATION,
  POST as rolePermissionAddRoute,
} from '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import {
  AUDIT_EVENT_LIST_OPERATION,
  GET as auditEventListRoute,
} from '@/app/api/v1/audit-events/route';
import {
  REPORT_CATALOGUE_OPERATION,
  GET as reportCatalogueRoute,
} from '@/app/api/v1/reports/route';
import {
  EXPORT_CATALOGUE_OPERATION,
  GET as exportCatalogueRoute,
} from '@/app/api/v1/exports/resources/route';

/**
 * The seven codes prerequisite P-1 adds. Written out rather than derived from
 * the constant under test: a list computed from the thing it checks proves
 * nothing.
 */
const ADDED = Object.freeze([
  'sal.delivery.manage',
  'sal.delivery.view',
  'sal.delivery.complete',
  'wty.warranty.issue',
  'rpt.report.read',
  'rpt.export',
  'iam.audit.view',
]);

/** The two of the nine deliberately withheld — P1-31 CC-01 and CC-02. */
const EXCLUDED = Object.freeze(['wty.policy.manage', 'rpt.report.configure']);

/** The bundle before this slice: 48 → 65 (#321) → 67 (#322). */
const BUNDLE_BEFORE = 67;

const IDENTITY_PROVIDER = 'test_harness';
const SUBJECT_HOLDER = 'fx_p131_platform_holder';
const USER_HOLDER = 'd3100000-0000-4000-8000-00000000001b';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
/** Distinct from every sibling suite's prefix: they delete tenants by prefix. */
const RUN = Math.random().toString(36).slice(2, 8);
const TENANT_PREFIX = `p31b${RUN}`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;

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

/** The platform operator, in their own home tenant. */
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
  readonly ownerAccountId: string;
  readonly tenantAdministratorRoleId: string;
  readonly identityProvider: string;
  readonly providerSubject: string;
}

/** The Owner the bootstrap created, in the tenant it was created for. */
function asOwnerOf(tenant: Provisioned): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: tenant.identityProvider,
      providerSubject: tenant.providerSubject,
      tenantId: tenant.tenantId,
    })
  );
}

function spec(code: string): Record<string, unknown> {
  return {
    tenant: {
      code: `${TENANT_PREFIX}_${code}`,
      display_name: 'P1-31 bundle probe',
      locale: 'en',
      timezone: 'UTC',
    },
    company: { code: 'p31c', legal_name: 'P31 Ltd', base_currency: 'JOD' },
    branch: { code: 'main', name: 'Main', timezone: 'UTC' },
    owner: { email: `owner_${code}_${RUN}@fixture.test`, displayName: 'First Owner' },
    activate: true,
  };
}

async function provision(code: string): Promise<Provisioned> {
  asHolder();
  const result = await call<{
    tenantId: string;
    ownerAccountId: string;
    tenantAdministratorRoleId: string;
  }>(organizationProvisionRoute, {
    path: '/platform/organizations',
    body: spec(code),
    idempotencyKey: randomUUID(),
  });
  expect(result.status).toBe(201);
  const { rows } = await admin.query<{
    identity_provider: string;
    provider_subject: string;
  }>('SELECT identity_provider, provider_subject FROM iam.user_accounts WHERE id = $1', [
    result.body.ownerAccountId,
  ]);
  const row = rows[0];
  if (!row) throw new Error('provisioned owner account has no identity to act as');
  return {
    tenantId: result.body.tenantId,
    ownerAccountId: result.body.ownerAccountId,
    tenantAdministratorRoleId: result.body.tenantAdministratorRoleId,
    identityProvider: row.identity_provider,
    providerSubject: row.provider_subject,
  };
}

/** Allow-codes mapped onto one role, read back on the admin connection. */
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

/** What the Owner account effectively holds, through its active role grants. */
async function codesHeldBy(userId: string): Promise<string[]> {
  const { rows } = await admin.query<{ permission_code: string }>(
    `SELECT DISTINCT p.permission_code
       FROM iam.role_grants g
       JOIN iam.role_permissions rp ON rp.role_id = g.role_id AND rp.effect = 'allow'
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE g.user_id = $1 AND g.status = 'active'
      ORDER BY p.permission_code`,
    [userId]
  );
  return rows.map((r) => r.permission_code);
}

/** A role the provisioned Owner creates, to delegate onto. */
async function newRole(tenant: Provisioned, code: string): Promise<string> {
  asOwnerOf(tenant);
  const role = await call<{ id: string }>(roleCreateRoute, {
    path: '/iam/roles',
    body: { roleCode: code, name: code, description: `P1-31 delegation probe ${code}` },
    idempotencyKey: randomUUID(),
  });
  expect(role.status).toBe(201);
  return role.body.id;
}

async function mapCode(
  tenant: Provisioned,
  roleId: string,
  permissionCode: string
): Promise<CallResult<{ code?: string; requiredPermissions?: string[] }>> {
  asOwnerOf(tenant);
  return call(rolePermissionAddRoute, {
    path: `/iam/roles/${roleId}/permissions`,
    params: { roleId },
    body: { permissionCode, effect: 'allow' },
    idempotencyKey: randomUUID(),
  });
}

let probe: Provisioned;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = 'https://app.test/welcome';
  __resetBackendConfigForTests();
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'p1-31-bundle-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'P1-31 bundle fixture', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      USER_HOLDER,
      TENANT_A,
      IDENTITY_PROVIDER,
      SUBJECT_HOLDER,
      `${SUBJECT_HOLDER}@fixture.test`,
      SYSTEM_ACTOR,
    ]
  );
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

  probe = await provision('a');
}, 180_000);

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
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

describe('P1-31 P-1 — the derivation', () => {
  it('P31-B1 the delta is exactly the seven, each declared by a registered operation, and the two exclusions by none', () => {
    const bundle = [...TENANT_ADMINISTRATOR_ROLE.permissionCodes];

    // The delta, stated two ways so neither can drift alone.
    expect(bundle).toHaveLength(BUNDLE_BEFORE + ADDED.length);
    expect(bundle.filter((code) => !ADDED.includes(code))).toHaveLength(BUNDLE_BEFORE);
    for (const code of ADDED) expect(bundle.filter((c) => c === code)).toHaveLength(1);
    for (const code of EXCLUDED) expect(bundle).not.toContain(code);
    expect(new Set(bundle).size).toBe(bundle.length);
    expect(bundle.some((c) => c.includes('*'))).toBe(false);
    expect(bundle.some((c) => c.startsWith('platform.'))).toBe(false);

    // DERIVED, not chosen. The P1-24 operation register is the generated,
    // gate-validated inventory of every registered operation's declared
    // permissions; the split falls out of it rather than out of a judgement.
    const register = JSON.parse(
      readFileSync(
        join(REPOSITORY_ROOT, 'docs/phase-1/phase-1-24/evidence/operation-register.json'),
        'utf8'
      )
    ) as { operations: Array<{ id: string; permissions: string[] }> };
    expect(register.operations.length).toBeGreaterThan(300);
    const declarersOf = (code: string): string[] =>
      register.operations.filter((op) => op.permissions.includes(code)).map((op) => op.id);

    for (const code of ADDED) expect(declarersOf(code).length).toBeGreaterThan(0);
    for (const code of EXCLUDED) expect(declarersOf(code)).toEqual([]);

    // The four routes the added codes are held FOR, by id, so a rename cannot
    // quietly leave the bundle carrying a code nothing declares.
    expect(AUDIT_EVENT_LIST_OPERATION.permissions).toContain('iam.audit.view');
    expect(REPORT_CATALOGUE_OPERATION.permissions).toContain('rpt.report.read');
    expect(EXPORT_CATALOGUE_OPERATION.permissions).toContain('rpt.export');
    expect(ROLE_PERMISSION_ADD_OPERATION.id).toBe('iam.role-permission-add');
    expect(ROLE_CREATE_OPERATION.id).toBe('iam.role-create');
  });
});

describe('P1-31 P-1 — an organisation created by the shipped provisioning operation', () => {
  it('P31-B2 its administrator role holds all seven, and neither excluded code', async () => {
    const codes = await codesOfRole(probe.tenantAdministratorRoleId);
    for (const code of ADDED) expect(codes).toContain(code);
    for (const code of EXCLUDED) expect(codes).not.toContain(code);
  });

  it('P31-B3 the Owner effectively holds all seven, and the role holds nothing beyond the bundle', async () => {
    const held = await codesHeldBy(probe.ownerAccountId);
    for (const code of ADDED) expect(held).toContain(code);
    for (const code of EXCLUDED) expect(held).not.toContain(code);

    // Nothing was permitted BEYOND the seven: the role's rows are exactly the
    // server-owned bundle, so a code that is not in the constant is not held.
    expect(await codesOfRole(probe.tenantAdministratorRoleId)).toEqual(
      [...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort()
    );
  });

  it('P31-B4 the Owner can map each of the seven onto a role it creates', async () => {
    const roleId = await newRole(probe, 'delivery_officer');
    for (const permissionCode of ADDED) {
      const mapped = await mapCode(probe, roleId, permissionCode);
      expect({ permissionCode, status: mapped.status }).toEqual({ permissionCode, status: 201 });
    }
    const codes = await codesOfRole(roleId);
    for (const code of ADDED) expect(codes).toContain(code);
  });

  it('P31-B5 each deliberately excluded code is refused, with the registered refusal', async () => {
    const roleId = await newRole(probe, 'warranty_clerk');
    for (const permissionCode of EXCLUDED) {
      const refused = await mapCode(probe, roleId, permissionCode);
      expect({ permissionCode, status: refused.status }).toEqual({ permissionCode, status: 403 });
      expect(refused.body.code).toBe('ERR-IAM-001');
      expect(refused.body.requiredPermissions).toEqual([permissionCode]);
    }
    expect(await codesOfRole(roleId)).toEqual([]);
  });

  it('P31-B6 delegation is still held-only — codes outside the bundle are refused as before', async () => {
    const roleId = await newRole(probe, 'escalation_probe');
    // Three real exclusions, each recorded with its own reason in
    // `bootstrap-roles.ts`: an organisation write, an IAM read, and a platform
    // code that is never a tenant code at all.
    for (const permissionCode of [
      'org.settings.manage',
      'iam.login.view_all',
      'platform.organization.provision',
    ]) {
      const refused = await mapCode(probe, roleId, permissionCode);
      expect(refused.status).not.toBe(201);
      expect([403, 422]).toContain(refused.status);
    }
    expect(await codesOfRole(roleId)).toEqual([]);
  });

  it('P31-B7 three shipped reads gated on the added codes answer for the provisioned Owner', async () => {
    asOwnerOf(probe);
    const audit = await call<{ items: unknown[] }>(auditEventListRoute, {
      path: `/audit-events?from=${encodeURIComponent(
        new Date(Date.now() - 86_400_000).toISOString()
      )}&to=${encodeURIComponent(new Date().toISOString())}&limit=1`,
      method: 'GET',
    });
    expect(audit.status).toBe(200);

    asOwnerOf(probe);
    const reports = await call<{ items: unknown[] }>(reportCatalogueRoute, {
      path: '/reports?limit=1',
      method: 'GET',
    });
    expect(reports.status).toBe(200);

    asOwnerOf(probe);
    const exports = await call<{ resources: unknown[] }>(exportCatalogueRoute, {
      path: '/exports/resources',
      method: 'GET',
    });
    expect(exports.status).toBe(200);
    expect(Array.isArray(exports.body.resources)).toBe(true);
  });
});
