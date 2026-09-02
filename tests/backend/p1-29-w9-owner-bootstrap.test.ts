/**
 * P1-29 W9 — the First-Owner bootstrap, proved on real PostgreSQL through the
 * shipped routes (Owner decisions of 2026-09-02; PRE-P1-29 Wave B §6.3).
 *
 * The provisioning operation now carries the whole act: tenant, company,
 * branch, the Owner's account, `first_owner`, `tenant_administrator`, their
 * mappings and grants, the audit record — and, only afterwards and only when
 * asked, activation. Every proof below drives `platform.organization-provision`
 * as a platform holder over the control-plane pool (`app_platform`), and reads
 * the result back either through the shipped routes or through the admin
 * connection for assertions only. No proof writes IAM state by direct SQL.
 *
 *   W9-B1  provisioning with an owner member creates every object, once
 *   W9-B2  `first_owner` holds exactly three codes
 *   W9-B3  `tenant_administrator` holds exactly the server-owned finite set
 *   W9-B4  a cross-tenant bootstrap is impossible: no input names a target, and
 *          the platform-on-target window refuses a tenant it did not create
 *   W9-B5  a caller-supplied permission or role list is refused at the boundary
 *   W9-B6  a failure during owner creation rolls back the tenant
 *   W9-B7  a failure during role/mapping rolls back the tenant
 *   W9-B8  `activate: true` activates only after the administrator exists
 *   W9-B9  an active tenant cannot reopen the bootstrap window
 *   W9-B10 an idempotent replay creates no duplicate IAM state
 *   W9-L   the created human logs in through the real authentication route and
 *          establishes a session (the residual the frozen contract left open)
 *   W9-R   the created human establishes the acceptance personas through the
 *          shipped IAM routes, and cannot delegate beyond the finite set
 *
 * Operations exercised here: platform.organization-provision, iam.auth-login,
 * iam.auth-session, iam.role-create, iam.role-permission-add,
 * iam.invitation-create.
 *
 * Coverage manifest (read by scripts/check-operation-test-coverage.mjs):
 *   platform.organization-provision: route service authorization success denial cross-tenant isolation audit idempotency rollback
 *   iam.auth-login: route service success
 *   iam.auth-session: route service authorization success
 *   iam.role-create: route service authorization success
 *   iam.role-permission-add: route service authorization success denial
 *   iam.invitation-create: route service authorization success
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  deleteTenantCascade,
  ensureBackendFixtures,
  ensureTestLogins,
  platformAppPool,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPlatformPoolForTests, __setPrimaryPoolForTests } from '@/server/db/pool';
import { withPlatformTarget, withTransaction } from '@/server/db/transaction';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import {
  BearerSessionAuthenticator,
  FIRST_OWNER_ROLE,
  FakeIdentityProvider,
  TENANT_ADMINISTRATOR_ROLE,
  setIdentityProvider,
} from '@/modules/iam';
import { __resetIdentityProviderForTests } from '@/modules/iam/provider/identity-provider';
import {
  ORGANIZATION_PROVISION_OPERATION,
  POST as organizationProvisionRoute,
} from '@/app/api/v1/platform/organizations/route';
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { GET as sessionRoute } from '@/app/api/v1/auth/session/route';
import { POST as roleCreateRoute } from '@/app/api/v1/iam/roles/route';
import { POST as rolePermissionAddRoute } from '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import { POST as invitationCreateRoute } from '@/app/api/v1/iam/invitations/route';

const IDENTITY_PROVIDER = 'test_harness';
const SUBJECT_HOLDER = 'fx_w9_platform_holder';
const USER_HOLDER = 'd9900000-0000-4000-8000-00000000001a';
const SUBJECT_PROVISION_ONLY = 'fx_w9_provision_only';
const USER_PROVISION_ONLY = 'd9900000-0000-4000-8000-00000000001b';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
const REDIRECT_ALLOWED = 'https://app.test/welcome';
const RUN = Math.random().toString(36).slice(2, 8);

let admin: Pool;
let runtime: Pool;
let platform: Pool;
let provider: FakeIdentityProvider;

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
    readonly bearer?: string;
  }
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  if (input.bearer !== undefined) headers['authorization'] = `Bearer ${input.bearer}`;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

function authenticateAs(providerSubject: string): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId: TENANT_A,
    })
  );
}
const asHolder = (): void => authenticateAs(SUBJECT_HOLDER);
const asProvisionOnly = (): void => authenticateAs(SUBJECT_PROVISION_ONLY);
/** The created human, through the real bearer path: the token the login route issued. */
const asBearer = (): void => setSessionAuthenticator(new BearerSessionAuthenticator(provider));

interface Provisioned {
  readonly tenantId: string;
  readonly ownerAccountId: string;
  readonly firstOwnerRoleId: string;
  readonly tenantAdministratorRoleId: string;
  readonly activated: boolean;
}

function spec(code: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant: { code: `w9${code}_${RUN}`, display_name: 'W9 Probe', locale: 'en', timezone: 'UTC' },
    company: { code: 'w9c', legal_name: 'W9 Ltd', base_currency: 'JOD' },
    branch: { code: 'main', name: 'Main', timezone: 'UTC' },
    owner: { email: `owner_${code}_${RUN}@fixture.test`, displayName: 'First Owner' },
    ...overrides,
  };
}

async function provision(
  code: string,
  overrides: Record<string, unknown> = {},
  idempotencyKey = randomUUID()
): Promise<CallResult<Provisioned>> {
  return call<Provisioned>(organizationProvisionRoute, {
    path: '/platform/organizations',
    body: spec(code, overrides),
    idempotencyKey,
  });
}

async function scalar<T>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
  const { rows } = await admin.query(sql, values as unknown[]);
  return rows.length === 0 ? null : (Object.values(rows[0])[0] as T);
}

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

async function tenantByCode(code: string): Promise<{ id: string; status: string } | null> {
  const { rows } = await admin.query<{ id: string; status: string }>(
    'SELECT id, status FROM org.tenants WHERE tenant_code = $1',
    [`w9${code}_${RUN}`]
  );
  return rows[0] ?? null;
}

async function seedSuiteFixtures(): Promise<void> {
  for (const [id, subject] of [
    [USER_HOLDER, SUBJECT_HOLDER],
    [USER_PROVISION_ONLY, SUBJECT_PROVISION_ONLY],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'W9 fixture', 'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, IDENTITY_PROVIDER, subject, `${subject}@fixture.test`, SYSTEM_ACTOR]
    );
  }
  for (const code of [
    'platform.organization.read',
    'platform.organization.provision',
    'platform.organization.lifecycle',
  ]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [USER_HOLDER, code, SYSTEM_ACTOR]
    );
  }
  await admin.query(
    `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
     VALUES ($1, 'platform.organization.provision', $2, $2) ON CONFLICT DO NOTHING`,
    [USER_PROVISION_ONLY, SYSTEM_ACTOR]
  );
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = REDIRECT_ALLOWED;
  __resetBackendConfigForTests();
  provider = new FakeIdentityProvider({
    secret: 'p1-29-w9-secret-not-real',
    issuer: 'https://auth.test.local/auth/v1',
    audience: 'authenticated',
  });
  setIdentityProvider(provider);

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSuiteFixtures();
  runtime = runtimeAppPool(6);
  platform = platformAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setPlatformPoolForTests(platform);
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
  provider.outage = false;
});

afterAll(async () => {
  __resetIdentityProviderForTests();
  __setPrimaryPoolForTests(undefined);
  __setPlatformPoolForTests(undefined);
  await runtime.end();
  await platform.end();
  const provisioned = await admin.query<{ id: string }>(
    "SELECT id FROM org.tenants WHERE tenant_code LIKE 'w9%'"
  );
  await deleteTenantCascade(
    admin,
    provisioned.rows.map((row) => row.id)
  );
  await admin.query(
    "DELETE FROM shared.idempotency_keys WHERE operation IN ('org_provisioning','platform_organization_provision')"
  );
  await admin.query('DELETE FROM iam.platform_grants WHERE account_id = ANY($1::uuid[])', [
    [USER_HOLDER, USER_PROVISION_ONLY],
  ]);
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

describe('W9 — the bootstrap the provisioning operation now carries', () => {
  it('declares one operation, one authority, the privileged audit class and idempotency — no new operation was published', () => {
    expect(ORGANIZATION_PROVISION_OPERATION.id).toBe('platform.organization-provision');
    expect(ORGANIZATION_PROVISION_OPERATION.permissions).toEqual([
      'platform.organization.provision',
    ]);
    expect(ORGANIZATION_PROVISION_OPERATION.auditAction).toBe('org.tenant.provisioned');
    expect(ORGANIZATION_PROVISION_OPERATION.idempotent).toBe(true);
  });

  it('W9-B1 creates tenant, company, branch, owner account, both roles, exact mappings and exact grants — once', async () => {
    asHolder();
    const result = await provision('b1');
    expect(result.status).toBe(201);
    const body = result.body;
    expect(Object.keys(body).sort()).toEqual([
      'activated',
      'firstOwnerRoleId',
      'ownerAccountId',
      'tenantAdministratorRoleId',
      'tenantId',
    ]);
    expect(body.activated).toBe(false);

    const tenant = await tenantByCode('b1');
    expect(tenant?.id).toBe(body.tenantId);
    expect(tenant?.status).toBe('provisioning');
    expect(
      await scalar<number>('SELECT count(*)::int FROM org.legal_companies WHERE tenant_id = $1', [
        body.tenantId,
      ])
    ).toBe(1);
    expect(
      await scalar<number>('SELECT count(*)::int FROM org.branches WHERE tenant_id = $1', [
        body.tenantId,
      ])
    ).toBe(1);

    const account = await admin.query<{
      tenant_id: string;
      status: string;
      email: string;
      identity_provider: string;
      created_by: string;
    }>(
      'SELECT tenant_id, status, email, identity_provider, created_by FROM iam.user_accounts WHERE id = $1',
      [body.ownerAccountId]
    );
    expect(account.rows).toHaveLength(1);
    expect(account.rows[0]).toMatchObject({
      tenant_id: body.tenantId,
      status: 'active',
      email: `owner_b1_${RUN}@fixture.test`,
      identity_provider: provider.name,
      created_by: USER_HOLDER,
    });
    // The identity was established through the provider, bound to the new tenant.
    const identity = await provider.findByEmail(`owner_b1_${RUN}@fixture.test`);
    expect(identity?.tenantId).toBe(body.tenantId);
    // One status row, nothing -> active, attributed to the operator.
    const history = await admin.query<{
      from_state: string | null;
      to_state: string;
      actor_id: string;
    }>('SELECT from_state, to_state, actor_id FROM iam.user_status_history WHERE user_id = $1', [
      body.ownerAccountId,
    ]);
    expect(history.rows).toEqual([{ from_state: null, to_state: 'active', actor_id: USER_HOLDER }]);

    const roles = await admin.query<{ id: string; role_code: string; is_system: boolean }>(
      'SELECT id, role_code, is_system FROM iam.roles WHERE tenant_id = $1 ORDER BY role_code',
      [body.tenantId]
    );
    expect(roles.rows).toEqual([
      { id: body.firstOwnerRoleId, role_code: 'first_owner', is_system: false },
      { id: body.tenantAdministratorRoleId, role_code: 'tenant_administrator', is_system: false },
    ]);
    const grants = await admin.query<{
      role_id: string;
      scope_mode: string;
      status: string;
      granted_by: string;
    }>(
      'SELECT role_id, scope_mode, status, granted_by FROM iam.role_grants WHERE user_id = $1 ORDER BY role_id',
      [body.ownerAccountId]
    );
    expect(grants.rows.map((g) => g.role_id).sort()).toEqual(
      [body.firstOwnerRoleId, body.tenantAdministratorRoleId].sort()
    );
    for (const grant of grants.rows) {
      expect(grant).toMatchObject({
        scope_mode: 'unrestricted',
        status: 'active',
        granted_by: USER_HOLDER,
      });
    }
    // The genesis is on the new tenant's own audit trail, identifiers only.
    const audit = await admin.query<{ details: unknown }>(
      `SELECT jsonb_agg(d.field_name ORDER BY d.field_name) AS details
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.audit_record_id = r.id
        WHERE r.tenant_id = $1 AND r.action = 'org.tenant.provisioned' AND r.entity_id = $1`,
      [body.tenantId]
    );
    expect(audit.rows[0]?.details).toEqual([
      'activated',
      'display_name',
      'first_owner_role_id',
      'owner_account_id',
      'tenant_administrator_role_id',
      'tenant_code',
    ]);
  });

  it('W9-B2 first_owner holds exactly the three frozen IAM codes', async () => {
    asHolder();
    const result = await provision('b2');
    expect(result.status).toBe(201);
    expect([...FIRST_OWNER_ROLE.permissionCodes]).toEqual([
      'iam.user.manage',
      'iam.role.manage',
      'iam.grant.manage',
    ]);
    expect(await codesOfRole(result.body.firstOwnerRoleId)).toEqual(
      [...FIRST_OWNER_ROLE.permissionCodes].sort()
    );
  });

  it('W9-B3 tenant_administrator holds exactly the server-owned finite set — no wildcard, no platform code', async () => {
    asHolder();
    const result = await provision('b3');
    expect(result.status).toBe(201);
    const expected = [...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort();
    expect(expected).toHaveLength(44);
    expect(expected.some((c) => c.includes('*'))).toBe(false);
    expect(expected.some((c) => c.startsWith('platform.'))).toBe(false);
    expect(new Set(expected).size).toBe(expected.length);
    expect(await codesOfRole(result.body.tenantAdministratorRoleId)).toEqual(expected);
    // Every code is a catalogue row: nothing was invented.
    expect(
      await scalar<number>(
        'SELECT count(*)::int FROM iam.permissions WHERE permission_code = ANY($1::text[])',
        [expected]
      )
    ).toBe(expected.length);
  });

  it('W9-B4 no request names a target tenant, and the window refuses a tenant this transaction did not create', async () => {
    asHolder();
    for (const overrides of [
      { owner: { email: `x_${RUN}@fixture.test`, displayName: 'X', tenantId: TENANT_A } },
      { tenantId: TENANT_A },
      {
        tenant: {
          code: `w9b4_${RUN}`,
          display_name: 'X',
          locale: 'en',
          timezone: 'UTC',
          activate: true,
        },
      },
    ]) {
      const refused = await provision('b4', overrides);
      expect(refused.status).toBe(422);
      expect(await tenantByCode('b4')).toBeNull();
    }

    // A tenant that is provisioning but was NOT created by the transaction
    // that tries to bootstrap into it: refused before any write.
    const foreign = await admin.query<{ id: string }>(
      `INSERT INTO org.tenants (tenant_code, display_name, default_locale, default_timezone, created_by)
       VALUES ($1, 'Foreign', 'en', 'UTC', $2) RETURNING id`,
      [`w9foreign_${RUN}`, SYSTEM_ACTOR]
    );
    const context = contextFor({
      tenantId: TENANT_A,
      userId: USER_HOLDER,
      operation: 'platform.organization-provision',
      module: 'platform',
    });
    await expect(
      withTransaction(
        context,
        (db) => withPlatformTarget(db, foreign.rows[0]?.id as string, async () => 'written'),
        { connection: 'platform' }
      )
    ).rejects.toMatchObject({ code: 'ERR-CTX-001' });
    // And never on the primary connection at all.
    await expect(
      withTransaction(context, (db) =>
        withPlatformTarget(db, foreign.rows[0]?.id as string, async () => 'written')
      )
    ).rejects.toMatchObject({ code: 'ERR-CTX-001' });
  });

  it('W9-B5 a caller-supplied permission or role list is refused at the boundary', async () => {
    asHolder();
    for (const owner of [
      { email: `p_${RUN}@fixture.test`, displayName: 'P', permissions: ['iam.role.manage'] },
      { email: `p_${RUN}@fixture.test`, displayName: 'P', roleCodes: ['first_owner'] },
      { email: `p_${RUN}@fixture.test`, displayName: 'P', roleIds: [randomUUID()] },
    ]) {
      const refused = await provision('b5', { owner });
      expect(refused.status).toBe(422);
    }
    expect(await tenantByCode('b5')).toBeNull();
  });

  it('W9-B6 a failure during owner creation rolls back the tenant', async () => {
    asHolder();
    provider.outage = true;
    const refused = await provision('b6');
    expect(refused.status).toBeGreaterThanOrEqual(500);
    expect(await tenantByCode('b6')).toBeNull();
    expect(
      await scalar<number>('SELECT count(*)::int FROM iam.user_accounts WHERE email = $1', [
        `owner_b6_${RUN}@fixture.test`,
      ])
    ).toBe(0);
  });

  it('W9-B7 a failure during role/mapping rolls back the tenant', async () => {
    asHolder();
    // The catalogue read the mapping step depends on is withdrawn for the
    // duration of one attempt: the tenant and the account were already written
    // in the same transaction, and both must vanish with the refusal.
    await admin.query('REVOKE SELECT (id, permission_code) ON iam.permissions FROM app_platform');
    try {
      const refused = await provision('b7');
      expect(refused.status).toBeGreaterThanOrEqual(500);
    } finally {
      await admin.query('GRANT SELECT (id, permission_code) ON iam.permissions TO app_platform');
    }
    expect(await tenantByCode('b7')).toBeNull();
    expect(
      await scalar<number>('SELECT count(*)::int FROM iam.user_accounts WHERE email = $1', [
        `owner_b7_${RUN}@fixture.test`,
      ])
    ).toBe(0);
    // Recovered: the same request now succeeds.
    const retried = await provision('b7');
    expect(retried.status).toBe(201);
  });

  it('W9-B8 activate: true activates only after the administrator exists, and needs the lifecycle authority', async () => {
    asProvisionOnly();
    const refused = await provision('b8x', { activate: true });
    expect(refused.status).toBe(403);
    expect(await tenantByCode('b8x')).toBeNull();

    asHolder();
    const result = await provision('b8', { activate: true });
    expect(result.status).toBe(201);
    expect(result.body.activated).toBe(true);
    expect((await tenantByCode('b8'))?.status).toBe('active');
    // Every bootstrap row exists on the now-active tenant. Under the §6.3
    // policies those rows are admitted only while the tenant is `provisioning`,
    // so their presence on an active tenant is the proof that the bootstrap ran
    // BEFORE the activation — a timestamp could not show it (one transaction,
    // one `now()`), the policy set does. The transition itself is on record,
    // attributed to the operator's session.
    const history = await admin.query<{ from_state: string; to_state: string; actor_id: string }>(
      `SELECT from_state, to_state, actor_id FROM org.tenant_status_history
        WHERE tenant_id = $1 AND from_state IS NOT NULL`,
      [result.body.tenantId]
    );
    expect(history.rows).toEqual([
      { from_state: 'provisioning', to_state: 'active', actor_id: USER_HOLDER },
    ]);
    expect(
      await scalar<number>(
        'SELECT count(*)::int FROM iam.role_grants WHERE user_id = $1 AND status = $2',
        [result.body.ownerAccountId, 'active']
      )
    ).toBe(2);
    expect(await codesOfRole(result.body.tenantAdministratorRoleId)).toHaveLength(44);
  });

  it('W9-B9 an active tenant cannot reopen the bootstrap write window', async () => {
    asHolder();
    const result = await provision('b9', { activate: true });
    expect(result.status).toBe(201);
    // The identical write the bootstrap made, attempted as app_platform once
    // the tenant is active: the §6.3 predicate no longer admits it.
    const client = await platform.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id', $1, true)", [USER_HOLDER]);
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [result.body.tenantId]);
      await expect(
        client.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, description, is_system, created_by)
           VALUES ($1, 'late_role', 'Late', 'refused', false, $2)`,
          [result.body.tenantId, USER_HOLDER]
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('W9-B10 an idempotent replay creates no duplicate account, role, mapping, grant or tenant', async () => {
    asHolder();
    const key = randomUUID();
    const first = await provision('b10', {}, key);
    expect(first.status).toBe(201);
    const counts = async (): Promise<number[]> => [
      (await scalar<number>('SELECT count(*)::int FROM org.tenants WHERE tenant_code = $1', [
        `w9b10_${RUN}`,
      ])) ?? -1,
      (await scalar<number>('SELECT count(*)::int FROM iam.user_accounts WHERE tenant_id = $1', [
        first.body.tenantId,
      ])) ?? -1,
      (await scalar<number>('SELECT count(*)::int FROM iam.roles WHERE tenant_id = $1', [
        first.body.tenantId,
      ])) ?? -1,
      (await scalar<number>('SELECT count(*)::int FROM iam.role_permissions WHERE tenant_id = $1', [
        first.body.tenantId,
      ])) ?? -1,
      (await scalar<number>('SELECT count(*)::int FROM iam.role_grants WHERE tenant_id = $1', [
        first.body.tenantId,
      ])) ?? -1,
    ];
    const before = await counts();
    expect(before).toEqual([1, 1, 2, 47, 2]);

    asHolder();
    const replay = await provision('b10', {}, key);
    // The framework replays the stored result; its status is the replay's, the
    // body is byte-for-byte the first response.
    expect([200, 201]).toContain(replay.status);
    expect(replay.body).toEqual(first.body);
    expect(await counts()).toEqual(before);

    // The same key with a different request keeps the conflict behaviour.
    asHolder();
    const conflict = await provision(
      'b10',
      { owner: { email: `other_${RUN}@fixture.test`, displayName: 'Other' } },
      key
    );
    expect([409, 422]).toContain(conflict.status);
    expect(await counts()).toEqual(before);
  });
});

describe('W9 — the created human, through the real application paths', () => {
  let tenantId: string;
  let ownerAccountId: string;
  let ownerEmail: string;
  let accessToken: string;
  const PASSWORD = 'Correct-Horse-Battery-Staple-42';

  beforeAll(async () => {
    asHolder();
    const result = await provision('login', { activate: true });
    expect(result.status).toBe(201);
    tenantId = result.body.tenantId;
    ownerAccountId = result.body.ownerAccountId;
    ownerEmail = `owner_login_${RUN}@fixture.test`;
    __resetAuthenticatorForTests();
  });

  it('W9-L logs in through iam.auth-login and establishes a session through iam.auth-session', async () => {
    // The Owner follows the provider's invitation link and sets a credential —
    // the provider's own act, never a platform write.
    await provider.acceptInvitation(ownerEmail, PASSWORD);

    const login = await call<{ accessToken: string; user: { id: string; tenantId: string } }>(
      loginRoute,
      { path: '/auth/login', body: { email: ownerEmail, password: PASSWORD, tenantId } }
    );
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(ownerAccountId);
    expect(login.body.user.tenantId).toBe(tenantId);
    accessToken = login.body.accessToken;

    asBearer();
    const session = await call<{ permissions: string[]; user: { id: string } }>(sessionRoute, {
      path: '/auth/session',
      method: 'GET',
      bearer: accessToken,
    });
    expect(session.status).toBe(200);
    const held = new Set(session.body.permissions);
    for (const code of [
      ...FIRST_OWNER_ROLE.permissionCodes,
      ...TENANT_ADMINISTRATOR_ROLE.permissionCodes,
    ]) {
      expect(held.has(code)).toBe(true);
    }
    expect([...held].some((c) => c.startsWith('platform.'))).toBe(false);
  });

  it('W9-R establishes an acceptance persona through the shipped IAM routes, and cannot delegate beyond the finite set', async () => {
    asBearer();
    const role = await call<{ id: string }>(roleCreateRoute, {
      path: '/iam/roles',
      body: { roleCode: 'technician', name: 'Technician', description: 'W4 persona' },
      bearer: accessToken,
      idempotencyKey: randomUUID(),
    });
    expect(role.status).toBe(201);

    for (const code of ['tech.technician.read', 'tech.labor.record', 'wo.work_order.read']) {
      asBearer();
      const mapped = await call(rolePermissionAddRoute, {
        path: `/iam/roles/${role.body.id}/permissions`,
        params: { roleId: role.body.id },
        body: { permissionCode: code, effect: 'allow' },
        bearer: accessToken,
        idempotencyKey: randomUUID(),
      });
      expect(mapped.status).toBe(201);
    }
    // A code the administrator does not hold cannot be delegated: the finite
    // set is the boundary, enforced by the database, not by this suite.
    asBearer();
    const beyond = await call(rolePermissionAddRoute, {
      path: `/iam/roles/${role.body.id}/permissions`,
      params: { roleId: role.body.id },
      body: { permissionCode: 'iam.approval.manage', effect: 'allow' },
      bearer: accessToken,
      idempotencyKey: randomUUID(),
    });
    expect([403, 422]).toContain(beyond.status);

    asBearer();
    const invited = await call<{ id: string }>(invitationCreateRoute, {
      path: '/iam/invitations',
      body: {
        email: `tech_${RUN}@fixture.test`,
        displayName: 'Technician One',
        roleIds: [role.body.id],
      },
      bearer: accessToken,
      idempotencyKey: randomUUID(),
    });
    expect(invited.status).toBe(201);
    expect(
      await scalar<number>(
        'SELECT count(*)::int FROM iam.role_grants WHERE user_id = $1 AND role_id = $2 AND status = $3',
        [invited.body.id, role.body.id, 'active']
      )
    ).toBe(1);
  });
});
