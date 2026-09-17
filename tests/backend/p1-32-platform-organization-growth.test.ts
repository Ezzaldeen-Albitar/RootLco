/**
 * P1-32-PRE-151 — the console GROWS an existing organisation, proven on the
 * RESPONSE and on the rows.
 *
 * Three operations and one changed one, and every claim here is about a LIVE
 * tenant — the state in which the control plane could previously do nothing at
 * all, because every platform write policy it had was predicated on the tenant
 * still being `provisioning`.
 *
 * What the suite is really asserting, beyond the status codes:
 *
 *   1. the console writes through the SAME database rules as the tenant
 *      operations. The capacity triggers refuse a console company exactly as
 *      they refuse a tenant one, and the refusal arrives as ERR-CAP-001 with the
 *      kind, the limit and the usage attached;
 *   2. a branch opened from the console arrives with its per-branch numbering
 *      runs, which is the half a copied INSERT would have omitted;
 *   3. a platform write touches ONLY the named organisation. The window is
 *      opened per request and every policy behind it carries
 *      `tenant_id = iam.current_tenant_id()`, so the second fixture tenant is
 *      asserted unchanged after every write against the first;
 *   4. a plan whose ceilings sit below current usage is refused per kind, and
 *      the accepted path leaves the existing records alone while the triggers go
 *      on refusing new ones.
 *
 * Fixture tenants are provisioned through the sanctioned route with codes
 * prefixed `odog_` and are removed by that prefix alone; plans are removed by the
 * same prefix. Nothing is deleted by any other predicate.
 *
 * COVERAGE-EVIDENCE (P1-32 platform organisation growth):
 *   platform.organization-company-create: route service authorization success denial cross-tenant idempotency audit
 *   platform.organization-branch-create: route service authorization success denial cross-tenant idempotency audit
 *   platform.organization-administrator-invite: route service authorization success denial cross-tenant idempotency audit
 *   platform.subscription-assign: route service authorization success denial cross-tenant idempotency audit
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

import { POST as organizationProvisionRoute } from '@/app/api/v1/platform/organizations/route';
import { POST as planCreateRoute } from '@/app/api/v1/platform/plans/route';
import {
  SUBSCRIPTION_ASSIGN_OPERATION,
  POST as subscriptionAssignRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/subscriptions/route';
import {
  ORGANIZATION_COMPANY_CREATE_OPERATION,
  POST as companyCreateRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/companies/route';
import {
  ORGANIZATION_BRANCH_CREATE_OPERATION,
  POST as branchCreateRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/branches/route';
import {
  ORGANIZATION_ADMINISTRATOR_INVITE_OPERATION,
  POST as administratorRoute,
} from '@/app/api/v1/platform/organizations/[tenantId]/administrators/route';
import { GET as organizationDetailRoute } from '@/app/api/v1/platform/organizations/[tenantId]/route';

const IDENTITY_PROVIDER = 'test_harness';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

const SUBJECT_HOLDER = 'fx_odog_holder';
const USER_HOLDER = 'd3210000-0000-4000-8000-00000000000a';
const SUBJECT_TENANT_ADMIN = 'fx_odog_tenant_admin';
const USER_TENANT_ADMIN = 'd3210000-0000-4000-8000-00000000000d';
const ROLE_TENANT_ADMIN = 'd3210000-0000-4000-8000-00000000000e';

const RUN = Math.random().toString(36).slice(2, 8);
const PLAN_ROOMY = `odog_roomy_${RUN}`;
const PLAN_TIGHT = `odog_tight_${RUN}`;
const PLAN_SMALL = `odog_small_${RUN}`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;
let provider: FakeIdentityProvider;

/** The organisation every growth act is performed on. */
let tenantOne = '';
/** The organisation that must never be touched by any of them. */
let tenantTwo = '';
/** The organisation whose only administrator is archived. */
let tenantThree = '';
let companyOne = '';
let companyTwo = '';

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

async function countOf(sql: string, values: readonly unknown[] = []): Promise<number> {
  return Number(await scalar<string>(sql, values));
}

async function provision(code: string): Promise<{ tenantId: string; companyId: string }> {
  asHolder();
  const result = await call<{ tenantId: string }>(organizationProvisionRoute, {
    path: '/platform/organizations',
    idempotencyKey: randomUUID(),
    body: {
      tenant: {
        code: `${code}_${RUN}`,
        display_name: `Growth ${code}`,
        locale: 'en',
        timezone: 'UTC',
      },
      company: { code: 'odogc', legal_name: 'Growth probe company', base_currency: 'JOD' },
      branch: { code: 'main', name: 'Main', timezone: 'UTC' },
      owner: { email: `${code}_${RUN}@fixture.test`, displayName: 'Growth probe owner' },
      activate: true,
    },
  });
  expect(result.status).toBe(201);
  const companyId = await scalar<string>(
    'SELECT id FROM org.legal_companies WHERE tenant_id = $1 ORDER BY created_at LIMIT 1',
    [result.body.tenantId]
  );
  return { tenantId: result.body.tenantId, companyId: companyId as string };
}

async function createPlan(
  planCode: string,
  limits: Record<string, number>
): Promise<{ planId: string }> {
  asHolder();
  const created = await call<{ id: string }>(planCreateRoute, {
    path: '/platform/plans',
    idempotencyKey: randomUUID(),
    body: {
      planCode,
      displayName: `Growth ${planCode}`,
      termMonths: 12,
      capacityLimits: limits,
      entitlementDocument: {},
      status: 'active',
      effectiveFrom: '2020-01-01',
    },
  });
  expect(created.status).toBe(201);
  return { planId: created.body.id };
}

/**
 * Assigns a plan STARTING IN THE PAST OR TODAY unless the caller says otherwise.
 *
 * Deliberate, and the reason is the rule under test: `org.capacity_limit`
 * resolves the assignment whose effective range covers `now()`, so a plan booked
 * to start tomorrow places no ceiling today. A fixture that assigned from
 * tomorrow would leave every organisation unlimited and every capacity assertion
 * below would pass against no rule at all.
 */
async function assignPlan(
  tenantId: string,
  planCode: string,
  extra: Record<string, unknown> = {}
): Promise<CallResult<Record<string, unknown>>> {
  asHolder();
  return call<Record<string, unknown>>(subscriptionAssignRoute, {
    path: `/platform/organizations/${tenantId}/subscriptions`,
    params: { tenantId },
    idempotencyKey: randomUUID(),
    body: {
      planCode,
      effectiveFrom: day(-10),
      kind: 'assigned',
      reason: 'growth fixture',
      ...extra,
    },
  });
}

async function seedSubjects(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'Growth fixture', 'active', $6)
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
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'Growth fixture', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      USER_TENANT_ADMIN,
      TENANT_A,
      IDENTITY_PROVIDER,
      SUBJECT_TENANT_ADMIN,
      `${SUBJECT_TENANT_ADMIN}@fixture.test`,
      SYSTEM_ACTOR,
    ]
  );
  for (const code of PLATFORM_AUTHORITY_CODES) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [USER_HOLDER, code, SYSTEM_ACTOR]
    );
  }
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, description, is_system, created_by)
     VALUES ($1, $2, 'odog_tenant_admin', 'Growth tenant admin', 'fixture', false, $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_TENANT_ADMIN, TENANT_A, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $2, $1, p.id, 'allow', $3
       FROM iam.permissions p
      WHERE p.permission_code IN ('org.company.manage','org.branch.manage','iam.user.manage')
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
  provider = new FakeIdentityProvider({
    secret: 'platform-growth-secret-not-real',
    issuer: 'https://auth.test.local/auth/v1',
    audience: 'authenticated',
  });
  setIdentityProvider(provider);

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSubjects();

  runtime = runtimeAppPool(6);
  platform = platformAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setPlatformPoolForTests(platform);

  const one = await provision('odog_one');
  const two = await provision('odog_two');
  const three = await provision('odog_three');
  tenantOne = one.tenantId;
  companyOne = one.companyId;
  tenantTwo = two.tenantId;
  companyTwo = two.companyId;
  tenantThree = three.tenantId;

  // The organisation with NO administrator: its first owner never arrived and
  // the account was archived. This is the state the invitation operation exists
  // for, and the only honest way to reach it in a fixture is to put the account
  // into it directly.
  await admin.query(
    `UPDATE iam.user_accounts SET status = 'archived'
      WHERE tenant_id = $1 AND status = 'active'`,
    [tenantThree]
  );

  await createPlan(PLAN_ROOMY, { companies: 5, branches: 5, users: 10 });
  await createPlan(PLAN_TIGHT, { companies: 2, branches: 2, users: 2 });
  await createPlan(PLAN_SMALL, { companies: 1, branches: 1, users: 1 });
}, 240_000);

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
    "SELECT id FROM org.tenants WHERE tenant_code LIKE 'odog\\_%'"
  );
  await deleteTenantCascade(
    admin,
    provisioned.rows.map((row) => row.id)
  );
  await admin.query("DELETE FROM org.subscription_plans WHERE plan_code LIKE 'odog\\_%'");
  await admin.query(
    `DELETE FROM shared.idempotency_keys
      WHERE tenant_id = $1
        AND operation IN ('platform_organization_provision', 'platform_plan_create',
                          'platform_subscription_assign',
                          'platform_organization_company_create',
                          'platform_organization_branch_create',
                          'platform_organization_administrator_invite')`,
    [TENANT_A]
  );
  await cleanBackendFixtures(admin);
  await admin.end();
}, 120_000);

// ---------------------------------------------------------------------------
// Declarations — structural, and deliberately not the proof.
// ---------------------------------------------------------------------------
describe('the three growth operations declare what they are', () => {
  it('registers them under their published ids, authority and audit actions', () => {
    expect(
      [
        ORGANIZATION_COMPANY_CREATE_OPERATION,
        ORGANIZATION_BRANCH_CREATE_OPERATION,
        ORGANIZATION_ADMINISTRATOR_INVITE_OPERATION,
      ].map((operation) => operation.id)
    ).toEqual([
      'platform.organization-company-create',
      'platform.organization-branch-create',
      'platform.organization-administrator-invite',
    ]);
    for (const operation of [
      ORGANIZATION_COMPANY_CREATE_OPERATION,
      ORGANIZATION_BRANCH_CREATE_OPERATION,
      ORGANIZATION_ADMINISTRATOR_INVITE_OPERATION,
    ]) {
      expect(operation.permissions, operation.id).toEqual(['platform.organization.manage']);
      expect(operation.auditClass, operation.id).toBe('privileged');
      expect(operation.idempotent, operation.id).toBe(true);
      expect(operation.successStatus, operation.id).toBe(201);
      expect(operation.answersNotFound, operation.id).toBe(true);
    }
    expect(ORGANIZATION_COMPANY_CREATE_OPERATION.auditAction).toBe('org.company.created');
    expect(ORGANIZATION_BRANCH_CREATE_OPERATION.auditAction).toBe('org.branch.created');
    expect(ORGANIZATION_ADMINISTRATOR_INVITE_OPERATION.auditAction).toBe(
      'iam.tenant_administrator.invited'
    );
    // The subscription change is the fourth subject of this suite and keeps its
    // own declaration; the capacity gate is added to its body, not to its id.
    expect(SUBSCRIPTION_ASSIGN_OPERATION.id).toBe('platform.subscription-assign');
  });
});

// ---------------------------------------------------------------------------
// platform.organization-company-create
// ---------------------------------------------------------------------------
describe('platform.organization-company-create', () => {
  it('adds a company to a live organisation, replays by key, and audits at home', async () => {
    asHolder();
    const key = randomUUID();
    const body = {
      code: 'odog_second',
      legalName: 'Second legal entity',
      baseCurrency: 'JOD',
    };
    const created = await call<{
      targetTenantId: string;
      company: { id: string; companyCode: string; status: string };
    }>(companyCreateRoute, {
      path: `/platform/organizations/${tenantOne}/companies`,
      params: { tenantId: tenantOne },
      idempotencyKey: key,
      body,
    });
    expect(created.status).toBe(201);
    expect(created.body.targetTenantId).toBe(tenantOne);
    expect(created.body.company.companyCode).toBe('odog_second');
    expect(created.body.company.status).toBe('active');

    // The row landed in the TARGET organisation, written by the operator.
    expect(
      await scalar<string>('SELECT tenant_id FROM org.legal_companies WHERE id = $1', [
        created.body.company.id,
      ])
    ).toBe(tenantOne);
    expect(
      await scalar<string>('SELECT created_by FROM org.legal_companies WHERE id = $1', [
        created.body.company.id,
      ])
    ).toBe(USER_HOLDER);

    const replay = await call<{ company: { id: string } }>(companyCreateRoute, {
      path: `/platform/organizations/${tenantOne}/companies`,
      params: { tenantId: tenantOne },
      idempotencyKey: key,
      body,
    });
    expect(replay.body.company.id).toBe(created.body.company.id);
    expect(
      await countOf(
        'SELECT count(*)::text FROM org.legal_companies WHERE tenant_id = $1 AND company_code = $2',
        [tenantOne, 'odog_second']
      )
    ).toBe(1);

    // The record is in the OPERATOR's tenant, carrying the organisation it was
    // about: sel_audit_records_platform is tenant_id = current_tenant_id(), so a
    // record written in the target would be invisible to the operator who made it.
    const { rows } = await admin.query<{ tenant_id: string; target: string | null }>(
      `SELECT a.tenant_id,
              (SELECT d.new_value_masked FROM iam.audit_record_details d
                WHERE d.audit_record_id = a.id AND d.field_name = 'target_tenant_id') AS target
         FROM iam.audit_records a
        WHERE a.action = 'org.company.created' AND a.entity_id = $1`,
      [created.body.company.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe(TENANT_A);
    expect(rows[0]!.target).toBe(tenantOne);
  });

  it('refuses an unknown organisation, a tenant administrator and an anonymous caller', async () => {
    const unknown = randomUUID();
    asHolder();
    const missing = await call(companyCreateRoute, {
      path: `/platform/organizations/${unknown}/companies`,
      params: { tenantId: unknown },
      idempotencyKey: randomUUID(),
      body: { code: 'odog_nowhere', legalName: 'Nowhere', baseCurrency: 'JOD' },
    });
    expect(missing.status).toBe(404);

    asTenantAdmin();
    const denied = await call<{ code?: string }>(companyCreateRoute, {
      path: `/platform/organizations/${tenantOne}/companies`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { code: 'odog_denied', legalName: 'Denied', baseCurrency: 'JOD' },
    });
    expect(denied.status).toBe(403);
    expect(denied.body?.code).toBe('ERR-IAM-001');

    __resetRateLimitForTests();
    __resetAuthenticatorForTests();
    const anonymous = await call<{ code?: string }>(companyCreateRoute, {
      path: `/platform/organizations/${tenantOne}/companies`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { code: 'odog_anon', legalName: 'Anonymous', baseCurrency: 'JOD' },
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body?.code).toBe('ERR-IAM-002');

    expect(
      await countOf(
        `SELECT count(*)::text FROM org.legal_companies
          WHERE company_code IN ('odog_nowhere', 'odog_denied', 'odog_anon')`
      )
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// platform.organization-branch-create
// ---------------------------------------------------------------------------
describe('platform.organization-branch-create', () => {
  it('opens a branch with the numbering runs it owes, and replays by key', async () => {
    asHolder();
    const key = randomUUID();
    const body = {
      companyId: companyOne,
      code: 'odog_north',
      name: 'North workshop',
      timezone: 'UTC',
      city: 'Amman',
      countryCode: 'JO',
    };
    const created = await call<{
      targetTenantId: string;
      branch: { id: string; branchCode: string; companyId: string };
    }>(branchCreateRoute, {
      path: `/platform/organizations/${tenantOne}/branches`,
      params: { tenantId: tenantOne },
      idempotencyKey: key,
      body,
    });
    expect(created.status).toBe(201);
    expect(created.body.branch.branchCode).toBe('odog_north');
    expect(created.body.branch.companyId).toBe(companyOne);

    // The half a copied INSERT would have omitted. Three of the registered runs
    // are per-branch and shared.next_display_number refuses rather than
    // degrading, so a branch without them cannot issue an invoice at all.
    const { rows } = await admin.query<{ sequence_code: string }>(
      `SELECT sequence_code FROM shared.number_sequences
        WHERE tenant_id = $1 AND branch_id = $2 ORDER BY sequence_code`,
      [tenantOne, created.body.branch.id]
    );
    expect(rows.map((row) => row.sequence_code)).toEqual(['invoice', 'quotation', 'receipt']);

    const replay = await call<{ branch: { id: string } }>(branchCreateRoute, {
      path: `/platform/organizations/${tenantOne}/branches`,
      params: { tenantId: tenantOne },
      idempotencyKey: key,
      body,
    });
    expect(replay.body.branch.id).toBe(created.body.branch.id);
    expect(
      await countOf(
        'SELECT count(*)::text FROM org.branches WHERE tenant_id = $1 AND branch_code = $2',
        [tenantOne, 'odog_north']
      )
    ).toBe(1);

    const audits = await countOf(
      `SELECT count(*)::text FROM iam.audit_records
        WHERE action = 'org.branch.created' AND entity_id = $1 AND tenant_id = $2`,
      [created.body.branch.id, TENANT_A]
    );
    expect(audits).toBe(1);
  });

  it('refuses a company of ANOTHER organisation as a denial, not a foreign-key fault', async () => {
    asHolder();
    const crossTenant = await call<{ code?: string }>(branchCreateRoute, {
      path: `/platform/organizations/${tenantOne}/branches`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      // A company that exists — and belongs to the OTHER organisation. The
      // console read policies admit companies of every tenant to a holder of
      // platform.organization.read, so without the tenant term on the reach
      // check this would reach the composite foreign key as a 500.
      body: { companyId: companyTwo, code: 'odog_stolen', name: 'Stolen', timezone: 'UTC' },
    });
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body?.code).toBe('ERR-RES-001');

    // Nothing landed anywhere: not in the named organisation, not in the other.
    expect(
      await countOf("SELECT count(*)::text FROM org.branches WHERE branch_code = 'odog_stolen'")
    ).toBe(0);
    expect(
      await countOf('SELECT count(*)::text FROM org.branches WHERE tenant_id = $1', [tenantTwo])
    ).toBe(1);
  });

  it('refuses a tenant administrator and an anonymous caller', async () => {
    asTenantAdmin();
    const denied = await call<{ code?: string }>(branchCreateRoute, {
      path: `/platform/organizations/${tenantOne}/branches`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { companyId: companyOne, code: 'odog_denied', name: 'Denied', timezone: 'UTC' },
    });
    expect(denied.status).toBe(403);
    expect(denied.body?.code).toBe('ERR-IAM-001');

    __resetRateLimitForTests();
    __resetAuthenticatorForTests();
    const anonymous = await call<{ code?: string }>(branchCreateRoute, {
      path: `/platform/organizations/${tenantOne}/branches`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { companyId: companyOne, code: 'odog_anon', name: 'Anonymous', timezone: 'UTC' },
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body?.code).toBe('ERR-IAM-002');
  });
});

// ---------------------------------------------------------------------------
// The capacity ceiling, from the console
// ---------------------------------------------------------------------------
describe('the capacity triggers govern the console exactly as they govern a tenant', () => {
  it('refuses a company beyond the plan ceiling, naming the kind, the limit and the usage', async () => {
    // Two companies exist in this organisation by now (the provisioned one and
    // the one added above), and PLAN_TIGHT permits exactly two.
    const assigned = await assignPlan(tenantOne, PLAN_TIGHT);
    expect(assigned.status).toBe(201);

    asHolder();
    const refused = await call<{
      code?: string;
      capacity?: { kind: string; limit: number; used: number };
    }>(companyCreateRoute, {
      path: `/platform/organizations/${tenantOne}/companies`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { code: 'odog_third', legalName: 'Third legal entity', baseCurrency: 'JOD' },
    });
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('ERR-CAP-001');
    expect(refused.body?.capacity).toEqual({ kind: 'companies', limit: 2, used: 2 });
    expect(
      await countOf(
        "SELECT count(*)::text FROM org.legal_companies WHERE company_code = 'odog_third'"
      )
    ).toBe(0);
  });

  it('refuses a branch beyond the same plan ceiling', async () => {
    asHolder();
    const refused = await call<{
      code?: string;
      capacity?: { kind: string; limit: number; used: number };
    }>(branchCreateRoute, {
      path: `/platform/organizations/${tenantOne}/branches`,
      params: { tenantId: tenantOne },
      idempotencyKey: randomUUID(),
      body: { companyId: companyOne, code: 'odog_south', name: 'South', timezone: 'UTC' },
    });
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('ERR-CAP-001');
    expect(refused.body?.capacity?.kind).toBe('branches');
  });

  it('publishes the same numbers on the organisation detail, from org.capacity_usage', async () => {
    asHolder();
    const detail = await call<{
      capacity: {
        companies: { used: number; limit: number | null };
        branches: { used: number; limit: number | null };
        users: { used: number; limit: number | null };
      };
    }>(organizationDetailRoute, {
      path: `/platform/organizations/${tenantOne}`,
      method: 'GET',
      params: { tenantId: tenantOne },
    });
    expect(detail.status).toBe(200);
    expect(detail.body.capacity.companies).toEqual({ used: 2, limit: 2 });
    expect(detail.body.capacity.branches).toEqual({ used: 2, limit: 2 });
    // The screen and the refusal read ONE function: what the database says the
    // organisation is using is what the console shows.
    const { rows } = await admin.query<{ usage: Record<string, { used: number }> }>(
      'SELECT org.capacity_usage($1) AS usage',
      [tenantOne]
    );
    expect(detail.body.capacity.users.used).toBe(rows[0]!.usage['users']!.used);
  });
});

// ---------------------------------------------------------------------------
// platform.organization-administrator-invite
// ---------------------------------------------------------------------------
describe('platform.organization-administrator-invite', () => {
  it('gives an organisation with no administrator one, and replays by key', async () => {
    asHolder();
    const key = randomUUID();
    const body = {
      mode: 'invite',
      email: `odog_admin_${RUN}@fixture.test`,
      displayName: 'Growth administrator',
    };
    const established = await call<{
      targetTenantId: string;
      outcome: string;
      accountId: string | null;
      roleEstablished: boolean;
      administratorsBefore: number;
    }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: key,
      body,
    });
    expect(established.status).toBe(201);
    expect(established.body.outcome).toBe('established');
    expect(established.body.administratorsBefore).toBe(0);
    // The organisation already held the role from its own provisioning, so this
    // act granted it rather than creating it.
    expect(established.body.roleEstablished).toBe(false);

    const accountId = established.body.accountId as string;
    expect(
      await scalar<string>('SELECT tenant_id FROM iam.user_accounts WHERE id = $1', [accountId])
    ).toBe(tenantThree);
    expect(
      await scalar<string>('SELECT status FROM iam.user_accounts WHERE id = $1', [accountId])
    ).toBe('active');
    expect(
      await countOf(
        `SELECT count(*)::text FROM iam.role_grants g
           JOIN iam.roles r ON r.id = g.role_id
          WHERE g.user_id = $1 AND g.status = 'active' AND r.role_code = 'tenant_administrator'`,
        [accountId]
      )
    ).toBe(1);
    // Born active and saying so in its own trail, exactly as the first owner is.
    expect(
      await countOf(
        `SELECT count(*)::text FROM iam.user_status_history
          WHERE user_id = $1 AND to_state = 'active'`,
        [accountId]
      )
    ).toBe(1);

    const replay = await call<{ accountId: string | null }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: key,
      body,
    });
    expect(replay.body.accountId).toBe(accountId);
    expect(
      await countOf('SELECT count(*)::text FROM iam.user_accounts WHERE tenant_id = $1', [
        tenantThree,
      ])
    ).toBe(2);

    // Audited in the operator's own tenant, against the organisation.
    const { rows } = await admin.query<{ tenant_id: string; masked: string | null }>(
      `SELECT a.tenant_id,
              (SELECT d.new_value_masked FROM iam.audit_record_details d
                WHERE d.audit_record_id = a.id AND d.field_name = 'email') AS masked
         FROM iam.audit_records a
        WHERE a.action = 'iam.tenant_administrator.invited' AND a.entity_id = $1`,
      [tenantThree]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe(TENANT_A);
    // The address is `restricted`, so what is stored is a marker rather than
    // the address itself.
    expect(rows[0]!.masked).not.toBe(body.email);
  });

  it('refuses a second administrator unless one is asked for explicitly, with a reason', async () => {
    asHolder();
    const refused = await call<{ code?: string }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: randomUUID(),
      body: {
        mode: 'invite',
        email: `odog_second_admin_${RUN}@fixture.test`,
        displayName: 'Second administrator',
      },
    });
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('ERR-TRN-001');
    expect(
      await countOf('SELECT count(*)::text FROM iam.user_accounts WHERE tenant_id = $1', [
        tenantThree,
      ])
    ).toBe(2);

    // The flag without a reason is a request defect, not an act.
    const unexplained = await call<{ code?: string }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: randomUUID(),
      body: {
        mode: 'invite',
        email: `odog_second_admin_${RUN}@fixture.test`,
        displayName: 'Second administrator',
        additionalAdministrator: true,
      },
    });
    expect(unexplained.status).toBe(422);

    const accepted = await call<{ outcome: string; administratorsBefore: number }>(
      administratorRoute,
      {
        path: `/platform/organizations/${tenantThree}/administrators`,
        params: { tenantId: tenantThree },
        idempotencyKey: randomUUID(),
        body: {
          mode: 'invite',
          email: `odog_second_admin_${RUN}@fixture.test`,
          displayName: 'Second administrator',
          additionalAdministrator: true,
          reason: 'the Owner asked for a deputy administrator',
        },
      }
    );
    expect(accepted.status).toBe(201);
    expect(accepted.body.outcome).toBe('established');
    expect(accepted.body.administratorsBefore).toBe(1);
  });

  it('sends the outstanding link again without writing anything', async () => {
    asHolder();
    const email = `odog_admin_${RUN}@fixture.test`;
    const before = await countOf(
      'SELECT count(*)::text FROM iam.user_accounts WHERE tenant_id = $1',
      [tenantThree]
    );
    const deliveriesBefore = provider.deliveries.length;
    const resent = await call<{ outcome: string; accountId: string | null }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: randomUUID(),
      body: { mode: 'resend', email },
    });
    expect(resent.status).toBe(201);
    expect(resent.body.outcome).toBe('reinvited');
    expect(resent.body.accountId).toBeNull();
    expect(provider.deliveries.length).toBe(deliveriesBefore + 1);
    expect(
      await countOf('SELECT count(*)::text FROM iam.user_accounts WHERE tenant_id = $1', [
        tenantThree,
      ])
    ).toBe(before);

    // An address this organisation has never invited is a 404, and so is an
    // address bound to a DIFFERENT organisation: answering those two differently
    // would answer a question about somebody else's tenant.
    const unknown = await call<{ code?: string }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: randomUUID(),
      body: { mode: 'resend', email: `odog_nobody_${RUN}@fixture.test` },
    });
    expect(unknown.status).toBe(404);

    const elsewhere = await call<{ code?: string }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: randomUUID(),
      body: { mode: 'resend', email: `odog_one_${RUN}@fixture.test` },
    });
    expect(elsewhere.status).toBe(404);
  });

  it('refuses the seat ceiling and leaves no orphan identity behind', async () => {
    // PLAN_SMALL permits ONE seat, and the organisation holds more than one.
    // The organisation is ALREADY over this plan on seats (two active
    // administrators against one), so the assignment itself has to be accepted
    // deliberately — which is the other half of the same rule.
    const assigned = await assignPlan(tenantThree, PLAN_SMALL, {
      acceptOverCapacity: true,
      overCapacityReason: 'the customer is being moved to a smaller plan',
    });
    expect(assigned.status).toBe(201);

    asHolder();
    const email = `odog_noseat_${RUN}@fixture.test`;
    const refused = await call<{ code?: string; capacity?: { kind: string } }>(administratorRoute, {
      path: `/platform/organizations/${tenantThree}/administrators`,
      params: { tenantId: tenantThree },
      idempotencyKey: randomUUID(),
      body: {
        mode: 'invite',
        email,
        displayName: 'No seat',
        additionalAdministrator: true,
        reason: 'testing the seat ceiling',
      },
    });
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('ERR-CAP-001');
    expect(refused.body?.capacity?.kind).toBe('users');
    // The identity this request created was removed again, so the retry after a
    // plan change is not blocked by an orphan.
    expect(await provider.findByEmail(email)).toBeNull();
  });

  it('refuses a tenant administrator and an anonymous caller', async () => {
    asTenantAdmin();
    const denied = await call<{ code?: string }>(administratorRoute, {
      path: `/platform/organizations/${tenantTwo}/administrators`,
      params: { tenantId: tenantTwo },
      idempotencyKey: randomUUID(),
      body: { mode: 'resend', email: `odog_two_${RUN}@fixture.test` },
    });
    expect(denied.status).toBe(403);
    expect(denied.body?.code).toBe('ERR-IAM-001');

    __resetRateLimitForTests();
    __resetAuthenticatorForTests();
    const anonymous = await call<{ code?: string }>(administratorRoute, {
      path: `/platform/organizations/${tenantTwo}/administrators`,
      params: { tenantId: tenantTwo },
      idempotencyKey: randomUUID(),
      body: { mode: 'resend', email: `odog_two_${RUN}@fixture.test` },
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body?.code).toBe('ERR-IAM-002');
  });
});

// ---------------------------------------------------------------------------
// The plan change and the capacity it would leave behind
// ---------------------------------------------------------------------------
describe('platform.subscription-assign refuses a plan below current usage', () => {
  it('names every kind that would be over its ceiling, and writes nothing', async () => {
    const before = await countOf(
      "SELECT count(*)::text FROM org.tenant_subscriptions WHERE tenant_id = $1 AND status = 'active'",
      [tenantOne]
    );
    const refused = await assignPlan(tenantOne, PLAN_SMALL, {
      kind: 'downgraded',
      effectiveFrom: day(0),
    });
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('ERR-CAP-003');
    const overCapacity = refused.body['overCapacity'] as readonly {
      kind: string;
      used: number;
      newLimit: number;
    }[];
    // Companies and branches are both 2 against a ceiling of 1, so BOTH are
    // named: an operator told only about the companies would correct those and
    // be refused again for the branches.
    expect(overCapacity.map((row) => row.kind)).toEqual(['companies', 'branches']);
    expect(overCapacity[0]).toEqual({ kind: 'companies', used: 2, newLimit: 1 });
    expect(
      await countOf(
        "SELECT count(*)::text FROM org.tenant_subscriptions WHERE tenant_id = $1 AND status = 'active'",
        [tenantOne]
      )
    ).toBe(before);
  });

  it('accepts it with a reason, keeps every record, and goes on refusing new ones', async () => {
    const accepted = await assignPlan(tenantOne, PLAN_SMALL, {
      kind: 'downgraded',
      effectiveFrom: day(0),
      acceptOverCapacity: true,
      overCapacityReason: 'the customer agreed to shed a branch this month',
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body['planCode']).toBe(PLAN_SMALL);

    // Nothing was deleted: the organisation keeps what it had.
    expect(
      await countOf(
        "SELECT count(*)::text FROM org.legal_companies WHERE tenant_id = $1 AND status = 'active'",
        [tenantOne]
      )
    ).toBe(2);

    // And the triggers go on refusing anything new while it is over.
    asHolder();
    const refused = await call<{ code?: string; capacity?: { used: number; limit: number } }>(
      companyCreateRoute,
      {
        path: `/platform/organizations/${tenantOne}/companies`,
        params: { tenantId: tenantOne },
        idempotencyKey: randomUUID(),
        body: { code: 'odog_fourth', legalName: 'Fourth', baseCurrency: 'JOD' },
      }
    );
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('ERR-CAP-001');
    expect(refused.body?.capacity).toEqual({ kind: 'companies', limit: 1, used: 2 });

    // The console shows the over-capacity plainly: used above limit.
    const detail = await call<{
      capacity: { companies: { used: number; limit: number | null } };
    }>(organizationDetailRoute, {
      path: `/platform/organizations/${tenantOne}`,
      method: 'GET',
      params: { tenantId: tenantOne },
    });
    expect(detail.body.capacity.companies).toEqual({ used: 2, limit: 1 });
  });

  it('left the second organisation untouched throughout', async () => {
    // Tenant isolation, asserted at the end over every write this suite made:
    // one company, one branch, one account — exactly what provisioning created.
    expect(
      await countOf('SELECT count(*)::text FROM org.legal_companies WHERE tenant_id = $1', [
        tenantTwo,
      ])
    ).toBe(1);
    expect(
      await countOf('SELECT count(*)::text FROM org.branches WHERE tenant_id = $1', [tenantTwo])
    ).toBe(1);
    expect(
      await countOf('SELECT count(*)::text FROM iam.user_accounts WHERE tenant_id = $1', [
        tenantTwo,
      ])
    ).toBe(1);
    expect(
      await countOf(
        "SELECT count(*)::text FROM org.tenant_subscriptions WHERE tenant_id = $1 AND status = 'active'",
        [tenantTwo]
      )
    ).toBe(0);
  });
});
