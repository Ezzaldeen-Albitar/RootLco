/**
 * P1-32-PRE-020..026 — the Platform Owner Console backend, proven on the RESPONSE.
 *
 * Every operation here declares a `platform.` permission, so it authorizes
 * through `iam.has_platform_authority` and runs on the `app_platform` pool. The
 * proof therefore asserts what a caller actually receives from the real route
 * handler over the real platform connection, for four subjects:
 *
 *   HOLDER        every platform authority code (the genesis list of nine);
 *   READER        `platform.organization.read` and nothing else;
 *   NO_GRANT      an active account with no platform grant at all;
 *   TENANT_ADMIN  a generous TENANT role and no platform grant — tenant
 *                 authority is the wrong KIND of authority, not too little of it.
 *
 * Fixture tenants are provisioned through the sanctioned route with codes
 * prefixed `odpc_` and are removed by that prefix alone; plans are removed by the
 * same prefix. Nothing is deleted by any other predicate.
 *
 * COVERAGE-EVIDENCE (P1-32 Platform Owner Console):
 *   platform.session-read: route service authorization success denial
 *   platform.organization-detail: route service authorization success denial cross-tenant
 *   platform.plan-list: route service authorization success denial
 *   platform.plan-create: route service authorization success denial idempotency audit
 *   platform.plan-update: route service authorization success denial cross-tenant idempotency stale-version audit
 *   platform.subscription-assign: route service authorization success denial cross-tenant idempotency audit
 *   platform.subscription-cancel: route service authorization success denial cross-tenant idempotency audit
 *   platform.charge-list: route service authorization success denial cross-tenant
 *   platform.charge-record: route service authorization success denial cross-tenant idempotency audit
 *   platform.charge-void: route service authorization success denial cross-tenant idempotency audit
 *   platform.receipt-record: route service authorization success denial cross-tenant idempotency audit
 *   platform.statistics-read: route service authorization success denial
 *   platform.audit-search: route service authorization success denial
 *   platform.organization-lifecycle: route service authorization success denial cross-tenant audit
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
import { __resetRateLimitForTests } from '@/server/http/rate-limit';
import { __setPlatformPoolForTests, __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { FakeIdentityProvider, setIdentityProvider } from '@/modules/iam';
import { __resetIdentityProviderForTests } from '@/modules/iam/provider/identity-provider';
import { PLATFORM_AUTHORITY_CODES } from '../../scripts/platform/genesis-platform-operator.mjs';

import {
  GET as organizationSearchRoute,
  POST as organizationProvisionRoute,
} from '@/app/api/v1/platform/organizations/route';
import {
  ORGANIZATION_LIFECYCLE_OPERATION,
  POST as organizationLifecycleRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/status/route';
import {
  PLATFORM_SESSION_READ_OPERATION,
  GET as sessionRoute,
} from '@/app/api/v1/platform/session/route';
import {
  ORGANIZATION_DETAIL_OPERATION,
  GET as organizationDetailRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/route';
import {
  PLAN_CREATE_OPERATION,
  PLAN_LIST_OPERATION,
  GET as planListRoute,
  POST as planCreateRoute,
} from '@/app/api/v1/platform/plans/route';
import {
  PLAN_UPDATE_OPERATION,
  PATCH as planUpdateRoute,
} from '@/app/api/v1/platform/plans/[planId]/route';
import {
  SUBSCRIPTION_ASSIGN_OPERATION,
  POST as subscriptionAssignRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/subscriptions/route';
import {
  SUBSCRIPTION_CANCEL_OPERATION,
  POST as subscriptionCancelRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/subscriptions/[subscriptionId]/cancellation/route';
import {
  CHARGE_LIST_OPERATION,
  CHARGE_RECORD_OPERATION,
  GET as chargeListRoute,
  POST as chargeRecordRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/charges/route';
import {
  CHARGE_VOID_OPERATION,
  POST as chargeVoidRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/charges/[chargeId]/void/route';
import {
  RECEIPT_RECORD_OPERATION,
  POST as receiptRecordRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/receipts/route';
import {
  PLATFORM_STATISTICS_READ_OPERATION,
  GET as statisticsRoute,
} from '@/app/api/v1/platform/statistics/route';
import {
  PLATFORM_AUDIT_SEARCH_OPERATION,
  GET as auditSearchRoute,
} from '@/app/api/v1/platform/audit-events/route';

const IDENTITY_PROVIDER = 'test_harness';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

const SUBJECT_HOLDER = 'fx_odpc_holder';
const USER_HOLDER = 'd3200000-0000-4000-8000-00000000000a';
const SUBJECT_READER = 'fx_odpc_reader';
const USER_READER = 'd3200000-0000-4000-8000-00000000000b';
const SUBJECT_NO_GRANT = 'fx_odpc_nogrant';
const USER_NO_GRANT = 'd3200000-0000-4000-8000-00000000000c';
const SUBJECT_TENANT_ADMIN = 'fx_odpc_tenant_admin';
const USER_TENANT_ADMIN = 'd3200000-0000-4000-8000-00000000000d';
const ROLE_TENANT_ADMIN = 'd3200000-0000-4000-8000-00000000000e';

const RUN = Math.random().toString(36).slice(2, 8);
const PLAN_SMALL = `odpc_small_${RUN}`;
const PLAN_LARGE = `odpc_large_${RUN}`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;

let tenantOne = '';
let tenantTwo = '';
let planSmallId = '';
let planLargeId = '';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
interface CallResult<T> {
  readonly status: number;
  readonly body: T;
  readonly etag: string | null;
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
    readonly ifMatch?: string;
    readonly query?: Record<string, string>;
  }
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  if (input.ifMatch !== undefined) headers['if-match'] = input.ifMatch;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const search = input.query ? `?${new URLSearchParams(input.query).toString()}` : '';
  const request = new Request(`http://localhost/api/v1${input.path}${search}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === '' ? null : JSON.parse(text)) as T,
    etag: response.headers.get('etag'),
  };
}

function authenticateAs(providerSubject: string): void {
  // The rate limiter is keyed per operation, tenant and user, and this suite
  // makes more calls per operation than the control-plane budget allows in a
  // minute. Resetting it isolates each subject switch; the throttle itself is
  // proven by the Wave B suite and is not under test here.
  __resetRateLimitForTests();
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId: TENANT_A,
    })
  );
}

const asHolder = (): void => authenticateAs(SUBJECT_HOLDER);
const asReader = (): void => authenticateAs(SUBJECT_READER);
const asNoGrant = (): void => authenticateAs(SUBJECT_NO_GRANT);
const asTenantAdmin = (): void => authenticateAs(SUBJECT_TENANT_ADMIN);

/** A `YYYY-MM-DD` date `days` away from today, UTC. */
function day(days: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

async function scalar<T>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
  const { rows } = await admin.query(sql, values as unknown[]);
  return rows.length === 0 ? null : (Object.values(rows[0])[0] as T);
}

async function auditRecordsFor(action: string, entityId: string) {
  const { rows } = await admin.query<{ tenant_id: string; target: string | null }>(
    `SELECT a.tenant_id,
            (SELECT d.new_value_masked FROM iam.audit_record_details d
              WHERE d.audit_record_id = a.id AND d.field_name = 'target_tenant_id') AS target
       FROM iam.audit_records a
      WHERE a.action = $1 AND a.entity_id = $2`,
    [action, entityId]
  );
  return rows;
}

async function provision(code: string): Promise<string> {
  asHolder();
  const result = await call<{ tenantId: string }>(organizationProvisionRoute, {
    path: '/platform/organizations',
    idempotencyKey: randomUUID(),
    body: {
      tenant: {
        code: `${code}_${RUN}`,
        display_name: `Console ${code}`,
        locale: 'en',
        timezone: 'UTC',
      },
      company: { code: 'odpcc', legal_name: 'Console probe company', base_currency: 'JOD' },
      branch: { code: 'main', name: 'Main', timezone: 'UTC' },
      owner: { email: `${code}_${RUN}@fixture.test`, displayName: 'Console probe owner' },
      activate: true,
    },
  });
  expect(result.status).toBe(201);
  return result.body.tenantId;
}

async function seedSubjects(): Promise<void> {
  for (const [id, subject] of [
    [USER_HOLDER, SUBJECT_HOLDER],
    [USER_READER, SUBJECT_READER],
    [USER_NO_GRANT, SUBJECT_NO_GRANT],
    [USER_TENANT_ADMIN, SUBJECT_TENANT_ADMIN],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Console fixture', 'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, IDENTITY_PROVIDER, subject, `${subject}@fixture.test`, SYSTEM_ACTOR]
    );
  }
  for (const code of PLATFORM_AUTHORITY_CODES) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [USER_HOLDER, code, SYSTEM_ACTOR]
    );
  }
  await admin.query(
    `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
     VALUES ($1, 'platform.organization.read', $2, $2) ON CONFLICT DO NOTHING`,
    [USER_READER, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, description, is_system, created_by)
     VALUES ($1, $2, 'odpc_tenant_admin', 'Console tenant admin', 'fixture', false, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_TENANT_ADMIN, TENANT_A, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $2, $1, p.id, 'allow', $3
       FROM iam.permissions p
      WHERE p.permission_code IN ('org.tenant.read','iam.user.manage','iam.role.manage','iam.audit.view')
     ON CONFLICT DO NOTHING`,
    [ROLE_TENANT_ADMIN, TENANT_A, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, USER_TENANT_ADMIN, ROLE_TENANT_ADMIN, SYSTEM_ACTOR]
  );
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = 'https://app.test/welcome';
  __resetBackendConfigForTests();
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'platform-console-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSubjects();

  runtime = runtimeAppPool(6);
  platform = platformAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setPlatformPoolForTests(platform);

  tenantOne = await provision('odpc_one');
  tenantTwo = await provision('odpc_two');
}, 180_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __resetIdentityProviderForTests();
  __setPrimaryPoolForTests(undefined);
  __setPlatformPoolForTests(undefined);
  await runtime.end();
  await platform.end();
  const provisioned = await admin.query<{ id: string }>(
    "SELECT id FROM org.tenants WHERE tenant_code LIKE 'odpc\\_%'"
  );
  await deleteTenantCascade(
    admin,
    provisioned.rows.map((row) => row.id)
  );
  await admin.query("DELETE FROM org.subscription_plans WHERE plan_code LIKE 'odpc\\_%'");
  await admin.query(
    `DELETE FROM shared.idempotency_keys
      WHERE tenant_id = $1
        AND operation IN ('platform_organization_provision', 'platform_plan_create',
                          'platform_plan_update', 'platform_subscription_assign',
                          'platform_subscription_cancel', 'platform_charge_record',
                          'platform_charge_void', 'platform_receipt_record')`,
    [TENANT_A]
  );
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

// ---------------------------------------------------------------------------
// Declarations — structural, and deliberately not the proof.
// ---------------------------------------------------------------------------
describe('console operation declarations', () => {
  it('registers every console operation under its published id', () => {
    // The ids as literals: the operation-coverage gate requires this suite to
    // NAME each operation it proves, not merely to import its route.
    expect(
      [
        PLATFORM_SESSION_READ_OPERATION,
        ORGANIZATION_DETAIL_OPERATION,
        PLAN_LIST_OPERATION,
        PLAN_CREATE_OPERATION,
        PLAN_UPDATE_OPERATION,
        SUBSCRIPTION_ASSIGN_OPERATION,
        SUBSCRIPTION_CANCEL_OPERATION,
        CHARGE_LIST_OPERATION,
        CHARGE_RECORD_OPERATION,
        CHARGE_VOID_OPERATION,
        RECEIPT_RECORD_OPERATION,
        PLATFORM_STATISTICS_READ_OPERATION,
        PLATFORM_AUDIT_SEARCH_OPERATION,
        ORGANIZATION_LIFECYCLE_OPERATION,
      ].map((operation) => operation.id)
    ).toEqual([
      'platform.session-read',
      'platform.organization-detail',
      'platform.plan-list',
      'platform.plan-create',
      'platform.plan-update',
      'platform.subscription-assign',
      'platform.subscription-cancel',
      'platform.charge-list',
      'platform.charge-record',
      'platform.charge-void',
      'platform.receipt-record',
      'platform.statistics-read',
      'platform.audit-search',
      'platform.organization-lifecycle',
    ]);
  });

  it('declare exactly one platform permission each, and the audit classes the writes need', () => {
    const reads = [
      [PLATFORM_SESSION_READ_OPERATION, 'platform.organization.read'],
      [ORGANIZATION_DETAIL_OPERATION, 'platform.organization.read'],
      [PLAN_LIST_OPERATION, 'platform.subscription.manage'],
      [CHARGE_LIST_OPERATION, 'platform.billing.read'],
      [PLATFORM_STATISTICS_READ_OPERATION, 'platform.statistics.read'],
      [PLATFORM_AUDIT_SEARCH_OPERATION, 'platform.audit.read'],
    ] as const;
    for (const [operation, code] of reads) {
      expect(operation.permissions).toEqual([code]);
      expect(operation.auditClass).toBe('none');
      expect(operation.rateLimitPolicy).toBe('expensive-read');
    }
    const writes = [
      [PLAN_CREATE_OPERATION, 'platform.subscription.manage', 'org.subscription_plan.created'],
      [PLAN_UPDATE_OPERATION, 'platform.subscription.manage', 'org.subscription_plan.updated'],
      [
        SUBSCRIPTION_ASSIGN_OPERATION,
        'platform.subscription.manage',
        'org.tenant_subscription.changed',
      ],
      [
        SUBSCRIPTION_CANCEL_OPERATION,
        'platform.subscription.manage',
        'org.tenant_subscription.changed',
      ],
      [CHARGE_RECORD_OPERATION, 'platform.billing.manage', 'org.subscription_charge.recorded'],
      [CHARGE_VOID_OPERATION, 'platform.billing.manage', 'org.subscription_charge.voided'],
      [RECEIPT_RECORD_OPERATION, 'platform.billing.manage', 'org.subscription_receipt.recorded'],
    ] as const;
    for (const [operation, code, action] of writes) {
      expect(operation.permissions).toEqual([code]);
      expect(operation.auditClass).toBe('privileged');
      expect(operation.auditAction).toBe(action);
      expect(operation.idempotent).toBe(true);
      expect(operation.rateLimitPolicy).toBe('expensive-read');
    }
    expect(PLAN_UPDATE_OPERATION.versionGuarded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// platform.session-read
// ---------------------------------------------------------------------------
describe('platform.session-read', () => {
  it('describes the holder, with its own nine codes and its home tenant', async () => {
    asHolder();
    const result = await call<{
      userId: string;
      homeTenantId: string;
      platformPermissions: string[];
    }>(sessionRoute, { path: '/platform/session', method: 'GET' });
    expect(result.status).toBe(200);
    expect(result.body.userId).toBe(USER_HOLDER);
    expect(result.body.homeTenantId).toBe(TENANT_A);
    expect(result.body.platformPermissions).toEqual([...PLATFORM_AUTHORITY_CODES].sort());
    // Identity columns are not reachable by app_platform and are not published.
    expect(result.body).not.toHaveProperty('email');
  });

  it('lists only the caller own codes — a reader sees one, not the holder nine', async () => {
    asReader();
    const result = await call<{ platformPermissions: string[] }>(sessionRoute, {
      path: '/platform/session',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(result.body.platformPermissions).toEqual(['platform.organization.read']);
  });

  it('refuses an account with no platform grant and a tenant administrator', async () => {
    asNoGrant();
    expect((await call(sessionRoute, { path: '/platform/session', method: 'GET' })).status).toBe(
      403
    );
    asTenantAdmin();
    expect((await call(sessionRoute, { path: '/platform/session', method: 'GET' })).status).toBe(
      403
    );
  });
});

// ---------------------------------------------------------------------------
// platform.organization-read (search) and platform.organization-detail
// ---------------------------------------------------------------------------
describe('platform.organization-read search', () => {
  it('finds an organisation by code fragment, with plan and size facts', async () => {
    asReader();
    const result = await call<{
      items: {
        id: string;
        tenantCode: string;
        status: string;
        activePlanCode: string | null;
        activeCompanyCount: number;
        activeBranchCount: number;
        activeUserCount: number;
      }[];
      hasMore: boolean;
    }>(organizationSearchRoute, {
      path: '/platform/organizations',
      method: 'GET',
      query: { q: `ODPC_ONE_${RUN.toUpperCase()}` },
    });
    expect(result.status).toBe(200);
    expect(result.body.items.map((row) => row.id)).toEqual([tenantOne]);
    const row = result.body.items[0]!;
    expect(row.status).toBe('active');
    expect(row.activeCompanyCount).toBe(1);
    expect(row.activeBranchCount).toBe(1);
    expect(typeof row.activeUserCount).toBe('number');
  });

  it('pages with a keyset cursor and never repeats a row', async () => {
    asReader();
    const first = await call<{
      items: { id: string }[];
      nextCursor: string | null;
      hasMore: boolean;
    }>(organizationSearchRoute, {
      path: '/platform/organizations',
      method: 'GET',
      query: { q: RUN, limit: '1' },
    });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.hasMore).toBe(true);
    const second = await call<{ items: { id: string }[]; hasMore: boolean }>(
      organizationSearchRoute,
      {
        path: '/platform/organizations',
        method: 'GET',
        query: { q: RUN, limit: '1', cursor: first.body.nextCursor! },
      }
    );
    expect(second.status).toBe(200);
    const ids = [...first.body.items, ...second.body.items].map((row) => row.id).sort();
    expect(ids).toEqual([tenantOne, tenantTwo].sort());
  });

  it('matches LIKE metacharacters literally, and filters by status', async () => {
    asReader();
    const wildcard = await call<{ items: unknown[] }>(organizationSearchRoute, {
      path: '/platform/organizations',
      method: 'GET',
      query: { q: '%' },
    });
    expect(wildcard.status).toBe(200);
    expect(wildcard.body.items).toEqual([]);
    const suspended = await call<{ items: { id: string }[] }>(organizationSearchRoute, {
      path: '/platform/organizations',
      method: 'GET',
      query: { q: RUN, status: 'suspended' },
    });
    expect(suspended.body.items).toEqual([]);
  });

  it('refuses a caller without platform.organization.read', async () => {
    asNoGrant();
    expect(
      (await call(organizationSearchRoute, { path: '/platform/organizations', method: 'GET' }))
        .status
    ).toBe(403);
  });
});

describe('platform.organization-detail', () => {
  it('publishes structure, counts and lifecycle trail for a tenant that has left provisioning', async () => {
    asReader();
    const result = await call<{
      id: string;
      companies: { code: string }[];
      branches: { code: string }[];
      userCountsByStatus: { status: string; count: number }[];
      statusHistory: { toState: string }[];
      capacity: { companies: { used: number; limit: number | null } };
    }>(organizationDetailRoute, {
      path: `/platform/organizations/${tenantOne}`,
      method: 'GET',
      params: { tenantId: tenantOne },
    });
    expect(result.status).toBe(200);
    expect(result.body.id).toBe(tenantOne);
    expect(result.body.companies.map((c) => c.code)).toEqual(['odpcc']);
    expect(result.body.branches.map((b) => b.code)).toEqual(['main']);
    expect(result.body.statusHistory.map((h) => h.toState)).toContain('active');
    expect(result.body.capacity.companies.used).toBe(1);
    // Counts only: no row carries an identity field.
    for (const row of result.body.userCountsByStatus) {
      expect(Object.keys(row).sort()).toEqual(['count', 'status']);
    }
  });

  it('answers 404 for an unknown organisation, and 403 without authority', async () => {
    asReader();
    const unknown = randomUUID();
    expect(
      (
        await call(organizationDetailRoute, {
          path: `/platform/organizations/${unknown}`,
          method: 'GET',
          params: { tenantId: unknown },
        })
      ).status
    ).toBe(404);
    asTenantAdmin();
    expect(
      (
        await call(organizationDetailRoute, {
          path: `/platform/organizations/${tenantOne}`,
          method: 'GET',
          params: { tenantId: tenantOne },
        })
      ).status
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
describe('platform.plan-create / plan-list / plan-update', () => {
  it('creates priced plans, keeps the price a decimal string, and replays by key', async () => {
    asHolder();
    const key = randomUUID();
    const body = {
      planCode: PLAN_SMALL,
      displayName: 'Console small',
      listPrice: '120.5',
      currencyCode: 'JOD',
      termMonths: 12,
      capacityLimits: { companies: 1, branches: 5, users: 10 },
      entitlementDocument: {},
      status: 'active',
      effectiveFrom: '2020-01-01',
    };
    const created = await call<{ id: string; listPrice: string; recordVersion: number }>(
      planCreateRoute,
      { path: '/platform/plans', idempotencyKey: key, body }
    );
    expect(created.status).toBe(201);
    expect(created.body.listPrice).toBe('120.5000');
    planSmallId = created.body.id;

    const replay = await call<{ id: string }>(planCreateRoute, {
      path: '/platform/plans',
      idempotencyKey: key,
      body,
    });
    expect(replay.body.id).toBe(planSmallId);
    expect(
      Number(
        await scalar<string>('SELECT count(*) FROM org.subscription_plans WHERE plan_code = $1', [
          PLAN_SMALL,
        ])
      )
    ).toBe(1);

    const large = await call<{ id: string }>(planCreateRoute, {
      path: '/platform/plans',
      idempotencyKey: randomUUID(),
      body: {
        ...body,
        planCode: PLAN_LARGE,
        displayName: 'Console large',
        listPrice: '240',
        capacityLimits: { companies: 1, branches: 20, users: 50 },
      },
    });
    expect(large.status).toBe(201);
    planLargeId = large.body.id;

    const audits = await auditRecordsFor('org.subscription_plan.created', planSmallId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.tenant_id).toBe(TENANT_A);
  });

  it('refuses a price without a currency and an unregistered entitlement key', async () => {
    asHolder();
    const base = {
      planCode: `odpc_bad_${RUN}`,
      displayName: 'Console bad',
      capacityLimits: {},
      effectiveFrom: '2020-01-01',
    };
    const noCurrency = await call(planCreateRoute, {
      path: '/platform/plans',
      idempotencyKey: randomUUID(),
      body: { ...base, listPrice: '10', entitlementDocument: {} },
    });
    expect(noCurrency.status).toBe(422);
    const badFlag = await call(planCreateRoute, {
      path: '/platform/plans',
      idempotencyKey: randomUUID(),
      body: { ...base, entitlementDocument: { odpc_not_a_feature: true } },
    });
    expect(badFlag.status).toBe(422);
  });

  it('lists the catalogue for a subscription administrator only', async () => {
    asHolder();
    const list = await call<{ items: { planCode: string }[] }>(planListRoute, {
      path: '/platform/plans',
      method: 'GET',
    });
    expect(list.status).toBe(200);
    expect(list.body.items.map((p) => p.planCode)).toEqual(
      expect.arrayContaining([PLAN_SMALL, PLAN_LARGE])
    );
    asReader();
    expect((await call(planListRoute, { path: '/platform/plans', method: 'GET' })).status).toBe(
      403
    );
    expect(
      (
        await call(planCreateRoute, {
          path: '/platform/plans',
          idempotencyKey: randomUUID(),
          body: {
            planCode: 'odpc_denied',
            displayName: 'x',
            capacityLimits: {},
            entitlementDocument: {},
            effectiveFrom: '2020-01-01',
          },
        })
      ).status
    ).toBe(403);
  });

  it('amends under If-Match, refuses a stale or missing version, and audits the change', async () => {
    asHolder();
    const current = Number(
      await scalar<number>('SELECT record_version FROM org.subscription_plans WHERE id = $1', [
        planLargeId,
      ])
    );
    const updated = await call<{ displayName: string; recordVersion: number }>(planUpdateRoute, {
      path: `/platform/plans/${planLargeId}`,
      method: 'PATCH',
      params: { planId: planLargeId },
      idempotencyKey: randomUUID(),
      ifMatch: `"${current}"`,
      body: { displayName: 'Console large renamed' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.displayName).toBe('Console large renamed');
    expect(updated.body.recordVersion).toBe(current + 1);

    const stale = await call(planUpdateRoute, {
      path: `/platform/plans/${planLargeId}`,
      method: 'PATCH',
      params: { planId: planLargeId },
      idempotencyKey: randomUUID(),
      ifMatch: `"${current}"`,
      body: { displayName: 'stale' },
    });
    expect(stale.status).toBe(409);

    const missing = await call(planUpdateRoute, {
      path: `/platform/plans/${planLargeId}`,
      method: 'PATCH',
      params: { planId: planLargeId },
      idempotencyKey: randomUUID(),
      body: { displayName: 'missing' },
    });
    expect(missing.status).toBe(428);

    const unknown = randomUUID();
    const absent = await call(planUpdateRoute, {
      path: `/platform/plans/${unknown}`,
      method: 'PATCH',
      params: { planId: unknown },
      idempotencyKey: randomUUID(),
      ifMatch: '"1"',
      body: { displayName: 'absent' },
    });
    expect(absent.status).toBe(404);

    expect(await auditRecordsFor('org.subscription_plan.updated', planLargeId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
describe('platform.subscription-assign / subscription-cancel', () => {
  let liveSmall = '';
  let liveLarge = '';
  let futureRenewal = '';

  it('assigns a plan, appends the event, and audits in the operator home tenant', async () => {
    asHolder();
    const assigned = await call<{ subscriptionId: string; eventKind: string; planCode: string }>(
      subscriptionAssignRoute,
      {
        path: `/platform/organizations/${tenantOne}/subscriptions`,
        params: { tenantId: tenantOne },
        idempotencyKey: randomUUID(),
        body: {
          planCode: PLAN_SMALL,
          effectiveFrom: day(-30),
          kind: 'assigned',
          reason: 'initial contract',
        },
      }
    );
    expect(assigned.status).toBe(201);
    expect(assigned.body.planCode).toBe(PLAN_SMALL);
    liveSmall = assigned.body.subscriptionId;

    expect(
      await scalar<string>(
        'SELECT event_kind FROM org.tenant_subscription_events WHERE subscription_id = $1',
        [liveSmall]
      )
    ).toBe('assigned');
    const audits = await auditRecordsFor('org.tenant_subscription.changed', liveSmall);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toEqual({ tenant_id: TENANT_A, target: tenantOne });
  });

  it('refuses an upgrade onto the plan in force and a renewal onto a different plan', async () => {
    asHolder();
    const sameUpgrade = await call(subscriptionAssignRoute, {
      path: `/platform/organizations/${tenantOne}/subscriptions`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { planCode: PLAN_SMALL, effectiveFrom: day(-5), kind: 'upgraded', reason: 'no-op' },
    });
    expect(sameUpgrade.status).toBe(409);
    const otherRenewal = await call(subscriptionAssignRoute, {
      path: `/platform/organizations/${tenantOne}/subscriptions`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { planCode: PLAN_LARGE, effectiveFrom: day(-5), kind: 'renewed', reason: 'wrong' },
    });
    expect(otherRenewal.status).toBe(409);
  });

  it('upgrades by closing the live period the day before, and the detail reflects the new limit', async () => {
    asHolder();
    const upgraded = await call<{ subscriptionId: string; previousSubscriptionId: string }>(
      subscriptionAssignRoute,
      {
        path: `/platform/organizations/${tenantOne}/subscriptions`,
        params: { tenantId: tenantOne },
        idempotencyKey: randomUUID(),
        body: { planCode: PLAN_LARGE, effectiveFrom: day(-10), kind: 'upgraded', reason: 'grew' },
      }
    );
    expect(upgraded.status).toBe(201);
    expect(upgraded.body.previousSubscriptionId).toBe(liveSmall);
    liveLarge = upgraded.body.subscriptionId;

    const closedAt = await scalar<string>(
      "SELECT to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM org.tenant_subscriptions WHERE id = $1",
      [liveSmall]
    );
    expect(closedAt).toBe(day(-11));

    asReader();
    const detail = await call<{
      capacity: { branches: { used: number; limit: number | null } };
      subscriptionEvents: { eventKind: string }[];
    }>(organizationDetailRoute, {
      path: `/platform/organizations/${tenantOne}`,
      method: 'GET',
      params: { tenantId: tenantOne },
    });
    expect(detail.body.capacity.branches).toEqual({ used: 1, limit: 20 });
    expect(detail.body.subscriptionEvents.map((e) => e.eventKind)).toEqual(
      expect.arrayContaining(['assigned', 'upgraded'])
    );
  });

  it('books a renewal after the live period without extending it, and refuses an overlap', async () => {
    asHolder();
    const liveEndBefore = await scalar<string>(
      'SELECT effective_to::text FROM org.tenant_subscriptions WHERE id = $1',
      [liveLarge]
    );
    const renewal = await call<{ subscriptionId: string }>(subscriptionAssignRoute, {
      path: `/platform/organizations/${tenantOne}/subscriptions`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { planCode: PLAN_LARGE, effectiveFrom: day(400), kind: 'renewed', reason: 'renewal' },
    });
    expect(renewal.status).toBe(201);
    futureRenewal = renewal.body.subscriptionId;
    expect(
      await scalar<string>(
        'SELECT effective_to::text FROM org.tenant_subscriptions WHERE id = $1',
        [liveLarge]
      )
    ).toBe(liveEndBefore);

    const overlapping = await call<{ code: string }>(subscriptionAssignRoute, {
      path: `/platform/organizations/${tenantOne}/subscriptions`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: {
        planCode: PLAN_SMALL,
        effectiveFrom: day(500),
        kind: 'downgraded',
        reason: 'overlap',
      },
    });
    expect(overlapping.status).toBe(409);
  });

  it('cancels an active assignment once, and refuses a second cancellation', async () => {
    asHolder();
    const input = {
      path: `/platform/organizations/${tenantOne}/subscriptions/${futureRenewal}/cancellation`,
      params: { tenantId: tenantOne, subscriptionId: futureRenewal },
      body: { effectiveTo: day(450), reason: 'customer will not renew' },
    };
    const cancelled = await call<{ status: string }>(subscriptionCancelRoute, {
      ...input,
      idempotencyKey: randomUUID(),
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(
      await scalar<string>(
        "SELECT event_kind FROM org.tenant_subscription_events WHERE subscription_id = $1 AND event_kind = 'cancelled'",
        [futureRenewal]
      )
    ).toBe('cancelled');
    expect(await auditRecordsFor('org.tenant_subscription.changed', futureRenewal)).toHaveLength(2);

    const again = await call(subscriptionCancelRoute, { ...input, idempotencyKey: randomUUID() });
    expect(again.status).toBe(409);

    // Addressed through the WRONG organisation, the assignment does not exist.
    const crossTenant = await call(subscriptionCancelRoute, {
      path: `/platform/organizations/${tenantTwo}/subscriptions/${liveLarge}/cancellation`,
      params: { tenantId: tenantTwo, subscriptionId: liveLarge },
      idempotencyKey: randomUUID(),
      body: { effectiveTo: day(1), reason: 'wrong tenant' },
    });
    expect(crossTenant.status).toBe(404);
  });

  it('refuses a caller without platform.subscription.manage', async () => {
    asReader();
    const denied = await call(subscriptionAssignRoute, {
      path: `/platform/organizations/${tenantTwo}/subscriptions`,
      params: { tenantId: tenantTwo },
      idempotencyKey: randomUUID(),
      body: { planCode: PLAN_SMALL, effectiveFrom: day(0), kind: 'assigned', reason: 'x' },
    });
    expect(denied.status).toBe(403);
    asTenantAdmin();
    const deniedCancel = await call(subscriptionCancelRoute, {
      path: `/platform/organizations/${tenantOne}/subscriptions/${liveLarge}/cancellation`,
      params: { tenantId: tenantOne, subscriptionId: liveLarge },
      idempotencyKey: randomUUID(),
      body: { effectiveTo: day(1), reason: 'x' },
    });
    expect(deniedCancel.status).toBe(403);
  });

  it('records a suspension and a reactivation against the live assignment', async () => {
    asHolder();
    const suspend = await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantOne}/status`,
      params: { tenantId: tenantOne },
      body: { to: 'suspended', reason: 'payment overdue' },
    });
    expect(suspend.status).toBe(200);

    asReader();
    const whileSuspended = await call<{ capacity: { companies: { used: number } } }>(
      organizationDetailRoute,
      {
        path: `/platform/organizations/${tenantOne}`,
        method: 'GET',
        params: { tenantId: tenantOne },
      }
    );
    // A suspended tenant is still fully readable, capacity included.
    expect(whileSuspended.status).toBe(200);
    expect(whileSuspended.body.capacity.companies.used).toBe(1);

    asHolder();
    const reactivate = await call(organizationLifecycleRoute, {
      path: `/platform/organizations/${tenantOne}/status`,
      params: { tenantId: tenantOne },
      body: { to: 'active', reason: 'payment received' },
    });
    expect(reactivate.status).toBe(200);

    const kinds = await admin.query<{ event_kind: string }>(
      `SELECT event_kind FROM org.tenant_subscription_events
        WHERE subscription_id = $1 AND event_kind IN ('suspended','reactivated')
        ORDER BY created_at`,
      [liveLarge]
    );
    expect(kinds.rows.map((r) => r.event_kind)).toEqual(['suspended', 'reactivated']);

    const audits = await auditRecordsFor('org.tenant.status_changed', tenantOne);
    const home = audits.filter((row) => row.tenant_id === TENANT_A);
    expect(home.length).toBeGreaterThanOrEqual(2);
    expect(home.every((row) => row.target === tenantOne)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Charges and receipts — platform revenue.
// ---------------------------------------------------------------------------
describe('platform.charge-record / receipt-record / charge-void / charge-list', () => {
  let paidCharge = '';
  let voidCharge = '';

  it('records a charge once per key, open, with the amount as a decimal string', async () => {
    asHolder();
    const key = randomUUID();
    const body = {
      amount: '100.00',
      currencyCode: 'JOD',
      dueOn: day(15),
      description: 'Annual subscription fee',
    };
    const recorded = await call<{ chargeId: string; status: string; amount: string }>(
      chargeRecordRoute,
      {
        path: `/platform/organizations/${tenantOne}/charges`,
        params: { tenantId: tenantOne },
        idempotencyKey: key,
        body,
      }
    );
    expect(recorded.status).toBe(201);
    expect(recorded.body.status).toBe('open');
    paidCharge = recorded.body.chargeId;

    const replay = await call<{ chargeId: string }>(chargeRecordRoute, {
      path: `/platform/organizations/${tenantOne}/charges`,
      params: { tenantId: tenantOne },
      idempotencyKey: key,
      body,
    });
    expect(replay.body.chargeId).toBe(paidCharge);
    expect(
      Number(
        await scalar<string>('SELECT count(*) FROM org.subscription_charges WHERE tenant_id = $1', [
          tenantOne,
        ])
      )
    ).toBe(1);
    const audits = await auditRecordsFor('org.subscription_charge.recorded', paidCharge);
    expect(audits).toEqual([{ tenant_id: TENANT_A, target: tenantOne }]);
  });

  it('refuses a receipt in another currency, then settles the charge exactly once', async () => {
    asHolder();
    const receipt = (amount: string, currencyCode?: string) =>
      call<{ chargeStatus: string; outstanding: string }>(receiptRecordRoute, {
        path: `/platform/organizations/${tenantOne}/receipts`,
        params: { tenantId: tenantOne },
        idempotencyKey: randomUUID(),
        body: {
          chargeId: paidCharge,
          amount,
          ...(currencyCode !== undefined ? { currencyCode } : {}),
          receivedOn: day(0),
          method: 'bank transfer',
        },
      });

    expect((await receipt('10.00', 'USD')).status).toBe(422);

    const partial = await receipt('40.00', 'JOD');
    expect(partial.status).toBe(201);
    expect(partial.body).toMatchObject({ chargeStatus: 'open', outstanding: '60.0000' });

    const rest = await receipt('60.00');
    expect(rest.status).toBe(201);
    expect(rest.body).toMatchObject({ chargeStatus: 'settled', outstanding: '0.0000' });

    const versionAtSettlement = await scalar<number>(
      'SELECT record_version FROM org.subscription_charges WHERE id = $1',
      [paidCharge]
    );
    const extra = await receipt('5.00');
    expect(extra.status).toBe(201);
    expect(extra.body.chargeStatus).toBe('settled');
    expect(
      await scalar<number>('SELECT record_version FROM org.subscription_charges WHERE id = $1', [
        paidCharge,
      ])
    ).toBe(versionAtSettlement);
  });

  it('voids only an open charge, with a reason, and never a settled one', async () => {
    asHolder();
    const settledVoid = await call(chargeVoidRoute, {
      path: `/platform/organizations/${tenantOne}/charges/${paidCharge}/void`,
      params: { tenantId: tenantOne, chargeId: paidCharge },
      idempotencyKey: randomUUID(),
      body: { reason: 'mistake' },
    });
    expect(settledVoid.status).toBe(409);

    const second = await call<{ chargeId: string }>(chargeRecordRoute, {
      path: `/platform/organizations/${tenantOne}/charges`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { amount: '50', currencyCode: 'JOD', dueOn: day(30), description: 'Setup fee' },
    });
    voidCharge = second.body.chargeId;
    const voided = await call<{ status: string }>(chargeVoidRoute, {
      path: `/platform/organizations/${tenantOne}/charges/${voidCharge}/void`,
      params: { tenantId: tenantOne, chargeId: voidCharge },
      idempotencyKey: randomUUID(),
      body: { reason: 'waived by agreement' },
    });
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('void');
    expect(await auditRecordsFor('org.subscription_charge.voided', voidCharge)).toEqual([
      { tenant_id: TENANT_A, target: tenantOne },
    ]);

    const receiptOnVoid = await call(receiptRecordRoute, {
      path: `/platform/organizations/${tenantOne}/receipts`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { chargeId: voidCharge, amount: '1', receivedOn: day(0), method: 'cash' },
    });
    expect(receiptOnVoid.status).toBe(409);

    // The charge addressed through the wrong organisation does not exist.
    const crossTenant = await call(chargeVoidRoute, {
      path: `/platform/organizations/${tenantTwo}/charges/${paidCharge}/void`,
      params: { tenantId: tenantTwo, chargeId: paidCharge },
      idempotencyKey: randomUUID(),
      body: { reason: 'wrong tenant' },
    });
    expect(crossTenant.status).toBe(404);
  });

  it('refuses a charge citing another organisation subscription', async () => {
    asHolder();
    const foreign = await call(chargeRecordRoute, {
      path: `/platform/organizations/${tenantTwo}/charges`,
      params: { tenantId: tenantTwo },
      idempotencyKey: randomUUID(),
      body: {
        subscriptionId: await scalar<string>(
          'SELECT id FROM org.tenant_subscriptions WHERE tenant_id = $1 LIMIT 1',
          [tenantOne]
        ),
        amount: '10',
        currencyCode: 'JOD',
        dueOn: day(1),
        description: 'misfiled',
      },
    });
    expect(foreign.status).toBe(422);
  });

  it('lists charges with nested receipts and outstanding strings, scoped to the organisation', async () => {
    asHolder();
    const list = await call<{
      items: { id: string; status: string; outstanding: string; receipts: { amount: string }[] }[];
    }>(chargeListRoute, {
      path: `/platform/organizations/${tenantOne}/charges`,
      method: 'GET',
      params: { tenantId: tenantOne },
    });
    expect(list.status).toBe(200);
    const paid = list.body.items.find((c) => c.id === paidCharge)!;
    expect(paid.status).toBe('settled');
    expect(paid.outstanding).toBe('0.0000');
    expect(paid.receipts.map((r) => r.amount)).toEqual(['40.0000', '60.0000', '5.0000']);
    const voided = list.body.items.find((c) => c.id === voidCharge)!;
    expect(voided).toMatchObject({ status: 'void', outstanding: '0.0000' });

    const other = await call<{ items: unknown[] }>(chargeListRoute, {
      path: `/platform/organizations/${tenantTwo}/charges`,
      method: 'GET',
      params: { tenantId: tenantTwo },
    });
    expect(other.body.items).toEqual([]);

    asReader();
    expect(
      (
        await call(chargeListRoute, {
          path: `/platform/organizations/${tenantOne}/charges`,
          method: 'GET',
          params: { tenantId: tenantOne },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(chargeRecordRoute, {
          path: `/platform/organizations/${tenantOne}/charges`,
          params: { tenantId: tenantOne },
          idempotencyKey: randomUUID(),
          body: { amount: '1', currencyCode: 'JOD', dueOn: day(1), description: 'denied' },
        })
      ).status
    ).toBe(403);
  });

  it('is unreachable from the tenant runtime role', async () => {
    const client = await runtime.connect();
    try {
      await expect(client.query('SELECT 1 FROM org.subscription_charges LIMIT 1')).rejects.toThrow(
        /permission denied/
      );
      await expect(client.query('SELECT 1 FROM org.subscription_receipts LIMIT 1')).rejects.toThrow(
        /permission denied/
      );
    } finally {
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
// Statistics and audit search
// ---------------------------------------------------------------------------
describe('platform.statistics-read', () => {
  it('reports counts, capacity alerts and per-currency revenue as decimal strings', async () => {
    asHolder();
    const result = await call<{
      generatedAt: string;
      asOf: string;
      tenantsByStatus: { key: string; count: number }[];
      activeCompanies: number;
      subscriptions: { active: number; expiringWithin90Days: number };
      capacityAlerts: { tenantId: string; kind: string; severity: string }[];
      revenueByCurrency: {
        currencyCode: string;
        contracted: string;
        received: string;
        outstanding: string;
        projectedRenewalValue: string;
      }[];
      health: { readiness: string; outbox: { reachable: boolean } };
    }>(statisticsRoute, { path: '/platform/statistics', method: 'GET' });
    expect(result.status).toBe(200);
    expect(Number.isNaN(Date.parse(result.body.asOf))).toBe(false);
    expect(
      result.body.tenantsByStatus.find((row) => row.key === 'active')?.count ?? 0
    ).toBeGreaterThanOrEqual(2);
    expect(result.body.activeCompanies).toBeGreaterThanOrEqual(2);
    expect(result.body.capacityAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenantId: tenantOne, kind: 'companies', severity: 'at-limit' }),
      ])
    );
    const jod = result.body.revenueByCurrency.find((row) => row.currencyCode === 'JOD')!;
    // One settled 100.00 charge (the voided one is excluded), 105.00 received
    // against it, so nothing outstanding; the live large plan (240) ends within
    // twelve months and the booked renewal was cancelled.
    expect(jod).toEqual({
      currencyCode: 'JOD',
      contracted: '100.0000',
      received: '105.0000',
      outstanding: '0.0000',
      projectedRenewalValue: '240.0000',
    });
    expect(['ready', 'degraded', 'unavailable']).toContain(result.body.health.readiness);
    expect(typeof result.body.health.outbox.reachable).toBe('boolean');
  });

  it('refuses a caller without platform.statistics.read', async () => {
    asReader();
    expect(
      (await call(statisticsRoute, { path: '/platform/statistics', method: 'GET' })).status
    ).toBe(403);
  });
});

describe('platform.audit-search', () => {
  const window = (): Record<string, string> => ({
    from: new Date(Date.now() - 86_400_000).toISOString(),
    to: new Date(Date.now() + 86_400_000).toISOString(),
  });

  it('returns only home-tenant records, filterable by the target organisation', async () => {
    asHolder();
    const result = await call<{ items: { id: string; action: string; targetTenantId: string }[] }>(
      auditSearchRoute,
      {
        path: '/platform/audit-events',
        method: 'GET',
        query: { ...window(), targetTenantId: tenantOne, limit: '100' },
      }
    );
    expect(result.status).toBe(200);
    expect(result.body.items.length).toBeGreaterThan(0);
    expect(result.body.items.every((row) => row.targetTenantId === tenantOne)).toBe(true);
    // Provisioning now leaves a record the operator can find in its own trail.
    expect(result.body.items.map((row) => row.action)).toContain('org.tenant.provisioned');

    const tenants = await admin.query<{ tenant_id: string }>(
      'SELECT DISTINCT tenant_id FROM iam.audit_records WHERE id = ANY($1::uuid[])',
      [result.body.items.map((row) => row.id)]
    );
    expect(tenants.rows.map((row) => row.tenant_id)).toEqual([TENANT_A]);
  });

  it('refuses a window wider than 92 days and a caller without platform.audit.read', async () => {
    asHolder();
    const wide = await call(auditSearchRoute, {
      path: '/platform/audit-events',
      method: 'GET',
      query: {
        from: new Date(Date.now() - 100 * 86_400_000).toISOString(),
        to: new Date().toISOString(),
      },
    });
    expect(wide.status).toBe(422);
    asReader();
    expect(
      (
        await call(auditSearchRoute, {
          path: '/platform/audit-events',
          method: 'GET',
          query: window(),
        })
      ).status
    ).toBe(403);
  });
});
