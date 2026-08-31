/**
 * PRE-P1-29 Wave B — the control plane, end to end.
 *
 * Every assertion here starts at `new Request(...)` and ends at a `Response`,
 * against a live PostgreSQL carrying the four Wave-B migrations. That is
 * deliberate and it is the whole point of the suite: the defect this wave exists
 * to prevent — `PC-1` / `platform.meta.ping` — was a route that satisfied every
 * structural gate while answering `403` to every caller. A count cannot see it.
 * Only a response can.
 *
 * ## Three principals, and why they must stay distinguishable
 *
 * All three requests reach the database on the SAME control-plane connection
 * (`rootlco_test_platform`, a member of `app_platform` and of no other
 * archetype). What separates them is not the connection but the authority the
 * acting principal holds:
 *
 *   PLATFORM HOLDER    an `iam.platform_grants` row for the code in question
 *   PLATFORM NO-GRANT  the same login, an account with no matching grant
 *   TENANT-ONLY        an account holding ordinary `iam.*` tenant permissions
 *
 * The third one is the U1-A proof. `iam.has_permission` returns false unless the
 * acting principal holds an active account in the CURRENT tenant, so routing a
 * `platform.` code through it would deny every platform operator. Routing it
 * through `iam.has_platform_authority` is what makes the holder succeed — and a
 * tenant permission holder must still be refused, or the prefix branch would be
 * a widening rather than a partition.
 *
 * COVERAGE-EVIDENCE (PRE-P1-29 Wave B control plane):
 *   platform.organization-read: route service authorization success denial
 *   platform.organization-provision: route service authorization success denial idempotency audit
 *   platform.organization-lifecycle: route service authorization success denial cross-tenant audit
 *
 * The final describe discharges slice B9's obligation 1 — a control-plane
 * throttle breach must raise a security event — and is written to fail if the
 * privilege behind it is removed rather than merely if the call is skipped.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
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
import { RATE_LIMIT_POLICIES, __resetRateLimitForTests } from '@/server/http/rate-limit';
import { __setPlatformPoolForTests, __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';

import {
  ORGANIZATION_PROVISION_OPERATION,
  ORGANIZATION_READ_OPERATION,
  GET as organizationReadRoute,
  POST as organizationProvisionRoute,
} from '@/app/api/v1/platform/organizations/route';
import {
  ORGANIZATION_LIFECYCLE_OPERATION,
  POST as organizationLifecycleRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/status/route';

const IDENTITY_PROVIDER = 'test_harness';

/** Holds every platform code. */
const SUBJECT_PLATFORM_HOLDER = 'fx_wb_platform_holder';
const USER_PLATFORM_HOLDER = 'd2900000-0000-4000-8000-00000000000a';

/** The same platform login, but no platform grant at all. */
const SUBJECT_PLATFORM_NO_GRANT = 'fx_wb_platform_nogrant';
const USER_PLATFORM_NO_GRANT = 'd2900000-0000-4000-8000-00000000000b';

/** Ordinary tenant authority, deliberately generous, and still not platform. */
const SUBJECT_TENANT_ONLY = 'fx_wb_tenant_only';
const USER_TENANT_ONLY = 'd2900000-0000-4000-8000-00000000000c';
const ROLE_TENANT_ONLY = 'd2900000-0000-4000-8000-00000000000d';

const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

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

function authenticateAs(providerSubject: string): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId: TENANT_A,
    })
  );
}

const asPlatformHolder = (): void => authenticateAs(SUBJECT_PLATFORM_HOLDER);
const asPlatformWithoutGrant = (): void => authenticateAs(SUBJECT_PLATFORM_NO_GRANT);
const asTenantOnly = (): void => authenticateAs(SUBJECT_TENANT_ONLY);

/** A valid provisioning spec, in the shape org.provision_organization reads. */
/** A per-run suffix: provisioned tenants are real rows and uq_tenants_tenant_code
 * is a real constraint, so a fixed code makes the suite pass once and fail forever
 * after. */
const RUN = Math.random().toString(36).slice(2, 8);

function spec(code: string): Record<string, unknown> {
  return {
    tenant: { code: `${code}_${RUN}`, display_name: 'Wave B Probe', locale: 'en', timezone: 'UTC' },
    company: { code: 'wbc', legal_name: 'Wave B Ltd', base_currency: 'JOD' },
    branch: { code: 'main', name: 'Main', timezone: 'UTC' },
  };
}

async function seedSuiteFixtures(): Promise<void> {
  // Three accounts in the harness tenant. The platform operator authenticates
  // through the ORDINARY path — §5.1 adds no second identity system — so each
  // needs a home tenant even though platform authority carries none.
  for (const [id, subject] of [
    [USER_PLATFORM_HOLDER, SUBJECT_PLATFORM_HOLDER],
    [USER_PLATFORM_NO_GRANT, SUBJECT_PLATFORM_NO_GRANT],
    [USER_TENANT_ONLY, SUBJECT_TENANT_ONLY],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Wave B fixture', 'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, IDENTITY_PROVIDER, subject, `${subject}@fixture.test`, SYSTEM_ACTOR]
    );
  }

  // The holder's platform authority. Note what is NOT here: no role, no grant,
  // no tenant permission. Platform authority comes only from this table.
  for (const code of [
    'platform.organization.read',
    'platform.organization.provision',
    'platform.organization.lifecycle',
  ]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT DO NOTHING`,
      [USER_PLATFORM_HOLDER, code, SYSTEM_ACTOR]
    );
  }

  // The tenant-only principal gets a GENEROUS tenant role on purpose: if a
  // narrow one were used, a refusal could be explained by "not enough tenant
  // permission" instead of by "tenant permission is the wrong kind of authority".
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, description, is_system, created_by)
     VALUES ($1, $2, 'wb_tenant_only', 'Wave B tenant admin', 'fixture', false, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_TENANT_ONLY, TENANT_A, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $2, $1, p.id, 'allow', $3
       FROM iam.permissions p
      WHERE p.permission_code IN ('org.tenant.read','iam.user.manage','iam.role.manage','iam.grant.manage')
     ON CONFLICT DO NOTHING`,
    [ROLE_TENANT_ONLY, TENANT_A, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, USER_TENANT_ONLY, ROLE_TENANT_ONLY, SYSTEM_ACTOR]
  );
}

async function provisionedTenant(code: string): Promise<string> {
  asPlatformHolder();
  const result = await call<{ tenantId: string }>(organizationProvisionRoute, {
    path: '/platform/organizations',
    body: spec(code),
    idempotencyKey: randomUUID(),
  });
  expect(result.status).toBe(201);
  return result.body.tenantId;
}

async function scalar<T>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
  const { rows } = await admin.query(sql, values as unknown[]);
  return rows.length === 0 ? null : (Object.values(rows[0])[0] as T);
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  __resetBackendConfigForTests();

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
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  __setPlatformPoolForTests(undefined);
  await runtime.end();
  await platform.end();
  // Tenants this suite provisioned are REAL rows outside the harness fixture
  // set, so cleanBackendFixtures does not know about them and they survive it.
  //
  // Unwound through deleteTenantCascade rather than by a hand-written DELETE
  // order. The first version of this block was that hand-written order, and it
  // was wrong in a way that hid itself: DELETE FROM org.tenants failed on
  // fk_tenant_status_history_tenant, the failure surfaced only inside afterAll
  // where a passing run does not show it, and 72 tenants accumulated across
  // runs until validate:seed-state — a gate about something else entirely —
  // reported the business tables as non-empty. The cascade already knows the
  // full order, including this table, and is maintained with the schema.
  const provisioned = await admin.query<{ id: string }>(
    "SELECT id FROM org.tenants WHERE tenant_code LIKE 'wb%'"
  );
  await deleteTenantCascade(
    admin,
    provisioned.rows.map((row) => row.id)
  );
  await admin.query(
    "DELETE FROM shared.idempotency_keys WHERE operation IN ('org_provisioning','platform_organization_provision')"
  );
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

// ---------------------------------------------------------------------------
// The registrations. Structural, and deliberately NOT the proof.
// ---------------------------------------------------------------------------
describe('control-plane operation declarations', () => {
  it('declare platform permissions, expensive-read, and the audit classes the design fixes', () => {
    expect(ORGANIZATION_READ_OPERATION.permissions).toEqual(['platform.organization.read']);
    expect(ORGANIZATION_READ_OPERATION.auditClass).toBe('none');
    expect(ORGANIZATION_PROVISION_OPERATION.permissions).toEqual([
      'platform.organization.provision',
    ]);
    expect(ORGANIZATION_PROVISION_OPERATION.auditAction).toBe('org.tenant.provisioned');
    expect(ORGANIZATION_PROVISION_OPERATION.idempotent).toBe(true);
    expect(ORGANIZATION_LIFECYCLE_OPERATION.permissions).toEqual([
      'platform.organization.lifecycle',
    ]);
    expect(ORGANIZATION_LIFECYCLE_OPERATION.auditAction).toBe('org.tenant.status_changed');

    // §10: every platform operation declares expensive-read, and no policy is
    // minted. auth-adjacent is the corrected mistake and must not return.
    for (const operation of [
      ORGANIZATION_READ_OPERATION,
      ORGANIZATION_PROVISION_OPERATION,
      ORGANIZATION_LIFECYCLE_OPERATION,
    ]) {
      expect(operation.rateLimitPolicy).toBe('expensive-read');
    }
  });
});

// ---------------------------------------------------------------------------
// platform.organization-lifecycle — the load-bearing set.
// ---------------------------------------------------------------------------
describe('platform.organization-lifecycle', () => {
  it('L1 transitions provisioning -> active for a platform holder', async () => {
    const tenantId = await provisionedTenant('wb_l1');
    expect(await scalar<string>('SELECT status FROM org.tenants WHERE id = $1', [tenantId])).toBe(
      'provisioning'
    );

    asPlatformHolder();
    const result = await call<{ status: string }>(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'active', reason: 'owner acceptance' },
      params: { tenantId },
    });

    expect(result.status).toBe(200);
    expect(await scalar<string>('SELECT status FROM org.tenants WHERE id = $1', [tenantId])).toBe(
      'active'
    );
  });

  it('L2 transitions provisioning -> closed, the graph’s other legal exit', async () => {
    const tenantId = await provisionedTenant('wb_l2');
    asPlatformHolder();
    const result = await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'closed', reason: 'abandoned before activation' },
      params: { tenantId },
    });
    expect(result.status).toBe(200);
    expect(await scalar<string>('SELECT status FROM org.tenants WHERE id = $1', [tenantId])).toBe(
      'closed'
    );
  });

  it('L3 refuses active -> provisioning, and the refusal comes from the database guard', async () => {
    const tenantId = await provisionedTenant('wb_l3');
    asPlatformHolder();
    await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'active', reason: 'activate' },
      params: { tenantId },
    });

    // The route's own schema does not admit `provisioning` as a destination, so
    // this proves the BOUNDARY refuses it. The database guard is proven
    // separately below, by calling the function directly — otherwise a passing
    // test here would only show that zod works.
    asPlatformHolder();
    const viaRoute = await call<{ code?: string }>(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'provisioning', reason: 'reopen' },
      params: { tenantId },
    });
    // 422/ERR-VAL-001 is this repository's validation refusal — measured, not
    // assumed. The code is asserted alongside the status because P5 in this same
    // file once passed while asserting only a status, matching a DIFFERENT error
    // (ERR-INT-002, an unregistered route template) that had nothing to do with
    // the rule under test. A status alone does not identify a refusal.
    expect(viaRoute.status).toBe(422);
    expect(viaRoute.body.code).toBe('ERR-VAL-001');

    // M4's BEFORE UPDATE backstop, which binds every writer including a direct
    // UPDATE that never touches this route.
    await expect(
      admin.query('SELECT org.change_tenant_status($1, $2, $3)', [
        tenantId,
        'provisioning',
        'reopen',
      ])
    ).rejects.toThrow(/invalid tenant status transition/i);
  });

  it('L4 refuses a platform login holding no lifecycle grant', async () => {
    const tenantId = await provisionedTenant('wb_l4');
    asPlatformWithoutGrant();
    const result = await call<{ code?: string }>(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'active', reason: 'attempt' },
      params: { tenantId },
    });
    expect(result.status).toBe(403);
    expect(await scalar<string>('SELECT status FROM org.tenants WHERE id = $1', [tenantId])).toBe(
      'provisioning'
    );
  });

  it('L5 refuses a tenant-only principal — the U1-A partition', async () => {
    const tenantId = await provisionedTenant('wb_l5');
    asTenantOnly();
    const result = await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'active', reason: 'attempt' },
      params: { tenantId },
    });
    expect(result.status).toBe(403);
  });

  it('L6/L7 emit exactly one history row, attributed to the session and not to the request', async () => {
    const tenantId = await provisionedTenant('wb_l6');
    asPlatformHolder();
    await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'active', reason: 'owner acceptance' },
      params: { tenantId },
    });

    const { rows } = await admin.query(
      `SELECT from_state, to_state, reason, actor_id
         FROM org.tenant_status_history
        WHERE tenant_id = $1 AND from_state IS NOT NULL`,
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].from_state).toBe('provisioning');
    expect(rows[0].to_state).toBe('active');
    expect(rows[0].reason).toBe('owner acceptance');
    // Server-derived. The route passes NULL for the function's actor parameter
    // and shared.stamp_status_history() overwrites it from iam.current_user_id().
    expect(rows[0].actor_id).toBe(USER_PLATFORM_HOLDER);
  });

  it('L8 closes the bootstrap window: the same write is admitted before and refused after', async () => {
    const tenantId = await provisionedTenant('wb_l8');

    // The B7 bootstrap predicate, exercised as app_platform against the real
    // policy set. While the tenant is provisioning the window is open.
    const bootstrapWrite = async (): Promise<void> => {
      const client = await platform.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, true)', [
          'app.user_id',
          USER_PLATFORM_HOLDER,
        ]);
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        await client.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1, 'local', $2, $3, 'First Owner', 'active', $4)`,
          [tenantId, `owner_${tenantId}`, `owner_${tenantId}@fixture.test`, USER_PLATFORM_HOLDER]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };

    await expect(bootstrapWrite()).resolves.toBeUndefined();

    asPlatformHolder();
    const transition = await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'active', reason: 'owner acceptance' },
      params: { tenantId },
    });
    expect(transition.status).toBe(200);

    // The identical write, refused. Not "status changed" — the B7 predicate no
    // longer admits the tenant, which is what makes the window self-closing and
    // is the executable answer to integration finding I6-1.
    await expect(bootstrapWrite()).rejects.toThrow(/row-level security policy/i);
  });
});

// ---------------------------------------------------------------------------
// platform.organization-provision
// ---------------------------------------------------------------------------
describe('platform.organization-provision', () => {
  it('P1 creates a tenant in provisioning for a platform holder', async () => {
    const tenantId = await provisionedTenant('wb_p1');
    expect(await scalar<string>('SELECT status FROM org.tenants WHERE id = $1', [tenantId])).toBe(
      'provisioning'
    );
    // The genesis history row, written by the function inside the same transaction.
    expect(
      await scalar<string>(
        'SELECT count(*)::text FROM org.tenant_status_history WHERE tenant_id = $1 AND from_state IS NULL',
        [tenantId]
      )
    ).toBe('1');
  });

  it('P2 refuses a platform login holding no provision grant', async () => {
    asPlatformWithoutGrant();
    const result = await call(organizationProvisionRoute, {
      path: '/platform/organizations',
      body: spec('wb_p2'),
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(403);
    expect(
      await scalar<string>('SELECT count(*)::text FROM org.tenants WHERE tenant_code = $1', [
        `wb_p2_${RUN}`,
      ])
    ).toBe('0');
  });

  it('P3 refuses a tenant-only principal', async () => {
    asTenantOnly();
    const result = await call(organizationProvisionRoute, {
      path: '/platform/organizations',
      body: spec('wb_p3'),
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(403);
  });

  it('P4 replays the same key and request without creating a second tenant', async () => {
    const key = randomUUID();
    asPlatformHolder();
    const first = await call<{ tenantId: string }>(organizationProvisionRoute, {
      path: '/platform/organizations',
      body: spec('wb_p4'),
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);

    asPlatformHolder();
    const replay = await call<{ tenantId: string }>(organizationProvisionRoute, {
      path: '/platform/organizations',
      body: spec('wb_p4'),
      idempotencyKey: key,
    });

    expect(replay.body.tenantId).toBe(first.body.tenantId);
    expect(
      await scalar<string>('SELECT count(*)::text FROM org.tenants WHERE tenant_code = $1', [
        `wb_p4_${RUN}`,
      ])
    ).toBe('1');
  });

  it('P5 refuses a request that tries to supply its own actor or activation', async () => {
    asPlatformHolder();
    const withActor = await call<{ code?: string }>(organizationProvisionRoute, {
      path: '/platform/organizations',
      body: { ...spec('wb_p5a'), actor_id: USER_TENANT_ONLY },
      idempotencyKey: randomUUID(),
    });
    expect(withActor.status).toBe(422);
    expect(withActor.body.code).toBe('ERR-VAL-001');

    asPlatformHolder();
    const withActivate = await call<{ code?: string }>(organizationProvisionRoute, {
      path: '/platform/organizations',
      body: {
        ...spec('wb_p5b'),
        tenant: { ...(spec('wb_p5b').tenant as object), activate: true },
      },
      idempotencyKey: randomUUID(),
    });
    expect(withActivate.status).toBe(422);
    expect(withActivate.body.code).toBe('ERR-VAL-001');
  });
});

// ---------------------------------------------------------------------------
// platform.organization-read
// ---------------------------------------------------------------------------
describe('platform.organization-read', () => {
  it('R1 reads the collection for a platform holder, crossing the tenant boundary', async () => {
    const tenantId = await provisionedTenant('wb_r1');

    asPlatformHolder();
    const result = await call<{ items: readonly { id: string }[] }>(organizationReadRoute, {
      path: '/platform/organizations',
      method: 'GET',
    });

    expect(result.status).toBe(200);
    // The control plane is NOT narrowed to iam.current_tenant_id(): the operator
    // sees the tenant they just created, which is not their home tenant.
    expect(result.body.items.some((row) => row.id === tenantId)).toBe(true);
  });

  it('R2 narrows to one tenant through the optional target', async () => {
    const tenantId = await provisionedTenant('wb_r2');
    asPlatformHolder();
    const result = await call<{ items: readonly { id: string }[] }>(organizationReadRoute, {
      path: `/platform/organizations?tenantId=${tenantId}`,
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]?.id).toBe(tenantId);
  });

  it('R3 refuses a platform login holding no read grant', async () => {
    asPlatformWithoutGrant();
    const result = await call(organizationReadRoute, {
      path: '/platform/organizations',
      method: 'GET',
    });
    expect(result.status).toBe(403);
  });

  it('R4 refuses a tenant-only principal', async () => {
    asTenantOnly();
    const result = await call(organizationReadRoute, {
      path: '/platform/organizations',
      method: 'GET',
    });
    expect(result.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// The audit trail for the two privileged control-plane operations
//
// Both declare auditClass: 'privileged' with a named auditAction, and the
// coverage gate requires `audit` evidence for them. That requirement is worth
// meeting honestly rather than by writing the keyword: the gate reads the
// COVERAGE-EVIDENCE block, not the assertions, so a claimed keyword with no
// test behind it passes silently — which is what this block was, before the
// gate's own failure on the provisioning operation exposed it.
// ---------------------------------------------------------------------------
describe('control-plane audit trail', () => {
  const auditCount = async (action: string): Promise<number> =>
    Number(
      await scalar<string>('SELECT count(*) FROM iam.audit_records WHERE action = $1', [action])
    );

  it('A1 writes org.tenant.provisioned, attributed to the operator', async () => {
    const before = await auditCount('org.tenant.provisioned');
    const tenantId = await provisionedTenant('wb_a1');
    expect(await auditCount('org.tenant.provisioned')).toBe(before + 1);

    const { rows } = await admin.query(
      `SELECT actor_id, actor_kind, tenant_id
         FROM iam.audit_records
        WHERE action = 'org.tenant.provisioned'
        ORDER BY seq DESC LIMIT 1`
    );
    const row = rows[0] as { actor_id: string; actor_kind: string; tenant_id: string };
    // Server-derived, from the resolved principal — never from the request. The
    // provisioning schema refuses an actor_id key outright (P5), and this is the
    // other half of that rule: what the record actually carries.
    expect(row.actor_id).toBe(USER_PLATFORM_HOLDER);
    // The operator's HOME tenant, not the tenant just created. Worth asserting
    // rather than assuming: the audit row is written by the request pipeline
    // from context.principal, so it answers "who did this, acting from where",
    // and ins_audit_records_platform admits it only because that tenant IS the
    // current one. A row bound to the NEW tenant would not satisfy that policy.
    expect(row.tenant_id).toBe(TENANT_A);
    expect(tenantId).not.toBe(TENANT_A);
  }, 30_000);

  it('A2 writes org.tenant.status_changed for a lifecycle transition', async () => {
    const tenantId = await provisionedTenant('wb_a2');
    const before = await auditCount('org.tenant.status_changed');

    asPlatformHolder();
    const result = await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantId}/status`,
      body: { to: 'active', reason: 'audited activation' },
      params: { tenantId },
    });
    expect(result.status).toBe(200);
    expect(await auditCount('org.tenant.status_changed')).toBe(before + 1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// B9 obligation 1 — a control-plane breach is a signal, not a counter
// ---------------------------------------------------------------------------
describe('control-plane breach signalling (B9)', () => {
  it('persists rate-limit.breached for the control plane, and persists it exactly once', async () => {
    __resetRateLimitForTests();

    // Counted as a DELTA. An absolute count would pass on a table that already
    // held the row from some other cause, which is the vacuity this repository
    // has shipped before.
    const before = await scalar<string>(
      `SELECT count(*) FROM iam.security_events
        WHERE event_type = 'rate-limit.breached' AND tenant_id = $1`,
      [TENANT_A]
    );

    // expensive-read is 30 per minute, keyed by operation + tenant + user, so
    // the 31st call from one operator breaches. The limit is read from the
    // catalogue rather than written as a literal: a policy re-tune must not
    // silently turn this proof into thirty successful reads and no breach.
    asPlatformHolder();
    const limit = RATE_LIMIT_POLICIES['expensive-read'].limit;
    for (let i = 0; i < limit; i += 1) {
      const ok = await call(organizationReadRoute, {
        path: '/platform/organizations',
        method: 'GET',
      });
      expect(ok.status).toBe(200);
    }

    const breach = await call<{ code?: string }>(organizationReadRoute, {
      path: '/platform/organizations',
      method: 'GET',
    });
    expect(breach.status).toBe(429);
    expect(breach.body.code).toBe('ERR-RTE-001');

    // The row itself, read as the admin. recordSecurityEvent swallows its own
    // insert failure by design and reports success either way, so asserting the
    // call happened would prove nothing at all: without
    // GRANT INSERT ON iam.security_events TO app_platform plus
    // ins_security_events_platform, this test is the thing that goes red.
    const rows = await admin.query(
      `SELECT event_type, severity, actor_id, detail
         FROM iam.security_events
        WHERE event_type = 'rate-limit.breached' AND tenant_id = $1`,
      [TENANT_A]
    );
    expect(rows.rows.length - Number(before ?? 0)).toBe(1);

    const row = rows.rows[rows.rows.length - 1] as {
      severity: string;
      actor_id: string;
      detail: string;
    };
    expect(row.severity).toBe('warning');
    // Server-derived attribution, never anything the request carried.
    expect(row.actor_id).toBe(USER_PLATFORM_HOLDER);
    expect(row.detail).toContain(ORGANIZATION_READ_OPERATION.id);
    expect(row.detail).toContain('expensive-read');

    __resetRateLimitForTests();
  }, 60_000);
});
