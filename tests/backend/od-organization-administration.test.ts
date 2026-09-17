/**
 * Organisation administration under subscription capacity — the Owner directive.
 *
 * Three new operations and one changed one, driven through the route handlers
 * exactly as Next.js loads them, on the runtime identity, against a live
 * database:
 *
 *   org.company-create  POST /org/companies
 *   org.branch-create   POST /org/branches
 *   org.capacity-read   GET  /org/capacity
 *   iam.invitation-create — now answers ERR-CAP-001 when the seats are spent.
 *
 * Every tenant here is created under the `odorg_` prefix and removed by that
 * prefix only. The shared fixture tenants are never given a subscription: a
 * ceiling on them would change what every other suite in the tier runs under.
 *
 * The capacity ceilings are enforced by a trigger, so what these cases prove is
 * the MAPPING — that the refusal the database raises reaches the caller as
 * ERR-CAP-001 carrying kind, limit and used, rather than as ERR-SYS-001 — plus
 * the pieces only the service does: the numbering runs a new branch owes, the
 * audit records, and the reachability check that turns a cross-tenant company
 * into a denial instead of a foreign-key fault.
 *
 * COVERAGE-EVIDENCE (Owner directive organisation administration):
 *   org.company-create: route service authorization success denial audit idempotency
 *   org.branch-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   org.capacity-read: route service authorization success denial cross-tenant
 *   iam.invitation-create: route service authorization success
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { adminPool, deleteTenantCascade, ensureTestLogins, runtimeAppPool } from './helpers';
import { ensureOrgFixtures } from '../db/helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { FakeIdentityProvider, iamModule, setIdentityProvider } from '@/modules/iam';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';

import {
  COMPANY_CREATE_OPERATION,
  POST as companyCreateRoute,
} from '@/app/api/v1/org/companies/route';
import {
  BRANCH_CREATE_OPERATION,
  POST as branchCreateRoute,
} from '@/app/api/v1/org/branches/route';
import { CAPACITY_READ_OPERATION, GET as capacityReadRoute } from '@/app/api/v1/org/capacity/route';
import {
  INVITE_OPERATION,
  POST as invitationCreateRoute,
} from '@/app/api/v1/iam/invitations/route';

const IDENTITY_PROVIDER = 'test_harness';
const SYS = '00000000-0000-4000-8000-000000000001';
const RUN = randomUUID().slice(0, 8);
const REDIRECT_ALLOWED = 'https://app.test.local/invitation';

const code = (label: string): string => `odorg_be_${label}_${RUN}`;

const ALPHA = { tenantId: randomUUID(), companyId: randomUUID() };
const BRAVO = { tenantId: randomUUID(), companyId: randomUUID() };

const SUBJECT_ADMIN = code('admin');
const SUBJECT_READER = code('reader');
const SUBJECT_BRAVO = code('bravo');

const ADMIN_CODES = [
  'org.company.manage',
  'org.branch.manage',
  'org.company.read',
  'org.branch.read',
  'org.tenant.read',
  'iam.user.manage',
];
const READER_CODES = ['org.company.read', 'org.branch.read'];

/** Alpha's ceilings. Two actors hold two of the three seats before any case runs. */
const LIMITS = { max_companies: 2, max_branches: 1, max_users: 3 };

let admin: Pool;
let runtime: Pool;

type CallResult<T> = { readonly status: number; readonly body: T };
type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;

let currentClaims: { providerSubject: string; tenantId: string } | null = null;

/**
 * Re-installed before EVERY request: composing `iamModule()` replaces the
 * session authenticator, so an authenticator installed once would silently stop
 * applying after the first route call in the process.
 */
function reinstallAuthenticator(): void {
  if (currentClaims === null) {
    __resetAuthenticatorForTests();
    return;
  }
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({ identityProvider: IDENTITY_PROVIDER, ...currentClaims })
  );
}

const asAdmin = (): void => {
  currentClaims = { providerSubject: SUBJECT_ADMIN, tenantId: ALPHA.tenantId };
};
const asReader = (): void => {
  currentClaims = { providerSubject: SUBJECT_READER, tenantId: ALPHA.tenantId };
};
const asBravo = (): void => {
  currentClaims = { providerSubject: SUBJECT_BRAVO, tenantId: BRAVO.tenantId };
};

async function call<T>(
  handler: unknown,
  input: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
  }
): Promise<CallResult<T>> {
  reinstallAuthenticator();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve({}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

async function scalar<T>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
  const { rows } = await admin.query(sql, values as unknown[]);
  return rows.length === 0 ? null : (Object.values(rows[0])[0] as T);
}

const count = async (sql: string, values: readonly unknown[]): Promise<number> =>
  Number(await scalar<string>(sql, values));

const auditCount = (tenantId: string, action: string): Promise<number> =>
  count('SELECT count(*) FROM iam.audit_records WHERE tenant_id = $1 AND action = $2', [
    tenantId,
    action,
  ]);

async function seedTenant(tenant: { tenantId: string; companyId: string }, label: string) {
  await admin.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
     VALUES ($1, $2, 'Organisation administration fixture', 'active', 'en', 'UTC', $3)`,
    [tenant.tenantId, code(`t_${label}`), SYS]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, $3, 'Organisation administration fixture company', 'USD', $4)`,
    [tenant.companyId, tenant.tenantId, code(`c_${label}`), SYS]
  );
}

async function seedActor(
  tenantId: string,
  subject: string,
  codes: readonly string[]
): Promise<void> {
  const userId = randomUUID();
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'Organisation administration fixture', 'active', $6)`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, `${subject}@example.test`, SYS]
  );
  const roleId = randomUUID();
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by) VALUES ($1, $2, $3, 'Fixture role', $4)`,
    [roleId, tenantId, `${subject}_role`, SYS]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])`,
    [tenantId, roleId, SYS, codes]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
    [tenantId, userId, roleId, SYS]
  );
}

async function removeOwnFixtures(): Promise<void> {
  const { rows } = await admin.query<{ id: string }>(
    `SELECT id FROM org.tenants WHERE tenant_code LIKE 'odorg\\_%'`
  );
  await deleteTenantCascade(
    admin,
    rows.map((row) => row.id)
  );
  await admin.query(`DELETE FROM org.subscription_plans WHERE plan_code LIKE 'odorg\\_%'`);
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = REDIRECT_ALLOWED;
  __resetBackendConfigForTests();

  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'od-organization-administration-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  // Reference rows (currencies, timezones, languages) the fixtures depend on.
  await ensureOrgFixtures(admin);
  await removeOwnFixtures();

  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  await seedTenant(ALPHA, 'alpha');
  await seedTenant(BRAVO, 'bravo');
  await seedActor(ALPHA.tenantId, SUBJECT_ADMIN, ADMIN_CODES);
  await seedActor(ALPHA.tenantId, SUBJECT_READER, READER_CODES);
  await seedActor(BRAVO.tenantId, SUBJECT_BRAVO, ADMIN_CODES);

  // Alpha's subscription is attached AFTER its fixture rows, so the fixtures
  // are written under no ceiling and count as consumption from here on:
  // one company, zero branches, two seats.
  const planId = randomUUID();
  await admin.query(
    `INSERT INTO org.subscription_plans (id, plan_code, name, capacity_limits, status, effective_from, created_by)
     VALUES ($1, $2, 'Organisation administration fixture plan', $3::jsonb, 'active', now() - interval '1 day', $4)`,
    [planId, code('plan'), JSON.stringify(LIMITS), SYS]
  );
  await admin.query(
    `INSERT INTO org.tenant_subscriptions (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
     VALUES ($1, $2, 'active', now() - interval '1 day', $3, $3)`,
    [ALPHA.tenantId, planId, SYS]
  );

  iamModule();
}, 120_000);

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  __resetAuthenticatorForTests();
  await runtime.end();
  await removeOwnFixtures();
  await admin.end();
}, 60_000);

describe('operation declarations', () => {
  it('registers the three new ids with the authority each needs', () => {
    expect(COMPANY_CREATE_OPERATION.id).toBe('org.company-create');
    expect(COMPANY_CREATE_OPERATION.permissions).toEqual(['org.company.manage']);
    expect(COMPANY_CREATE_OPERATION.idempotent).toBe(true);
    expect(COMPANY_CREATE_OPERATION.auditAction).toBe('org.company.created');

    expect(BRANCH_CREATE_OPERATION.id).toBe('org.branch-create');
    expect(BRANCH_CREATE_OPERATION.permissions).toEqual(['org.branch.manage']);
    expect(BRANCH_CREATE_OPERATION.idempotent).toBe(true);
    expect(BRANCH_CREATE_OPERATION.auditAction).toBe('org.branch.created');

    expect(CAPACITY_READ_OPERATION.id).toBe('org.capacity-read');
    expect(CAPACITY_READ_OPERATION.permissions).toEqual(['org.tenant.read']);

    expect(INVITE_OPERATION.id).toBe('iam.invitation-create');
  });
});

describe('org.company-create', () => {
  const firstKey = randomUUID();
  const firstBody = {
    code: code('second_company'),
    legalName: 'Second Legal Entity',
    baseCurrency: 'USD',
    registrationNumber: 'REG-ODORG-1',
  };
  let createdId = '';

  it('creates a company, answers 201 and appends one audit record', async () => {
    const auditBefore = await auditCount(ALPHA.tenantId, 'org.company.created');
    asAdmin();
    const result = await call<{ company: { id: string; companyCode: string; status: string } }>(
      companyCreateRoute,
      { path: '/org/companies', body: firstBody, idempotencyKey: firstKey }
    );
    expect(result.status).toBe(201);
    expect(result.body.company.companyCode).toBe(firstBody.code);
    expect(result.body.company.status).toBe('active');
    createdId = result.body.company.id;
    expect(
      await count('SELECT count(*) FROM org.legal_companies WHERE id = $1 AND tenant_id = $2', [
        createdId,
        ALPHA.tenantId,
      ])
    ).toBe(1);
    expect((await auditCount(ALPHA.tenantId, 'org.company.created')) - auditBefore).toBe(1);
  });

  it('replays the same key without a second company or a second audit record', async () => {
    const auditBefore = await auditCount(ALPHA.tenantId, 'org.company.created');
    asAdmin();
    const replay = await call<{ company: { id: string } }>(companyCreateRoute, {
      path: '/org/companies',
      body: firstBody,
      idempotencyKey: firstKey,
    });
    expect([200, 201]).toContain(replay.status);
    expect(replay.body.company.id).toBe(createdId);
    expect(
      await count('SELECT count(*) FROM org.legal_companies WHERE tenant_id = $1', [ALPHA.tenantId])
    ).toBe(2);
    expect(await auditCount(ALPHA.tenantId, 'org.company.created')).toBe(auditBefore);
  });

  it('answers 409 ERR-CAP-001 with the ceiling when the plan allows no more', async () => {
    asAdmin();
    const refused = await call<{ code: string; capacity?: unknown }>(companyCreateRoute, {
      path: '/org/companies',
      body: { code: code('third_company'), legalName: 'Third Legal Entity', baseCurrency: 'USD' },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ERR-CAP-001');
    expect(refused.body.capacity).toEqual({ kind: 'companies', limit: 2, used: 2 });
  });

  it('refuses an actor without org.company.manage', async () => {
    asReader();
    const refused = await call<{ code: string; requiredPermissions?: string[] }>(
      companyCreateRoute,
      {
        path: '/org/companies',
        body: { code: code('refused_company'), legalName: 'Refused', baseCurrency: 'USD' },
        idempotencyKey: randomUUID(),
      }
    );
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ERR-IAM-001');
    expect(refused.body.requiredPermissions).toEqual(['org.company.manage']);
  });

  it('writes into the caller tenant only — bravo is not limited by alpha', async () => {
    asBravo();
    const created = await call<{ company: { id: string } }>(companyCreateRoute, {
      path: '/org/companies',
      body: { code: code('bravo_second'), legalName: 'Bravo Second', baseCurrency: 'USD' },
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    expect(
      await scalar<string>('SELECT tenant_id FROM org.legal_companies WHERE id = $1', [
        created.body.company.id,
      ])
    ).toBe(BRAVO.tenantId);
  });
});

describe('org.branch-create', () => {
  const firstKey = randomUUID();
  let firstBody: Record<string, unknown> = {};
  let createdId = '';

  it('creates a branch with its numbering runs, answers 201 and appends one audit record', async () => {
    firstBody = {
      companyId: ALPHA.companyId,
      code: code('branch_one'),
      name: 'Second Workshop',
      timezone: 'UTC',
      city: 'Amman',
      countryCode: 'JO',
    };
    const auditBefore = await auditCount(ALPHA.tenantId, 'org.branch.created');
    asAdmin();
    const result = await call<{
      branch: { id: string; companyId: string; branchCode: string; timezoneName: string };
    }>(branchCreateRoute, { path: '/org/branches', body: firstBody, idempotencyKey: firstKey });
    expect(result.status).toBe(201);
    expect(result.body.branch.companyId).toBe(ALPHA.companyId);
    expect(result.body.branch.timezoneName).toBe('UTC');
    createdId = result.body.branch.id;

    // The three per-branch runs, without which the branch could not issue an
    // invoice, a quotation or a receipt.
    const { rows } = await admin.query<{ sequence_code: string }>(
      `SELECT sequence_code FROM shared.number_sequences
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3 ORDER BY sequence_code`,
      [ALPHA.tenantId, ALPHA.companyId, createdId]
    );
    expect(rows.map((row) => row.sequence_code)).toEqual(['invoice', 'quotation', 'receipt']);
    expect((await auditCount(ALPHA.tenantId, 'org.branch.created')) - auditBefore).toBe(1);
  });

  it('replays the same key without a second branch or second numbering rows', async () => {
    asAdmin();
    const replay = await call<{ branch: { id: string } }>(branchCreateRoute, {
      path: '/org/branches',
      body: firstBody,
      idempotencyKey: firstKey,
    });
    expect([200, 201]).toContain(replay.status);
    expect(replay.body.branch.id).toBe(createdId);
    expect(
      await count('SELECT count(*) FROM org.branches WHERE tenant_id = $1', [ALPHA.tenantId])
    ).toBe(1);
    expect(
      await count('SELECT count(*) FROM shared.number_sequences WHERE branch_id = $1', [createdId])
    ).toBe(3);
  });

  it('answers 409 ERR-CAP-001 with the ceiling when the plan allows no more', async () => {
    asAdmin();
    const refused = await call<{ code: string; capacity?: unknown }>(branchCreateRoute, {
      path: '/org/branches',
      body: {
        companyId: ALPHA.companyId,
        code: code('branch_two'),
        name: 'Third Workshop',
        timezone: 'UTC',
      },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ERR-CAP-001');
    expect(refused.body.capacity).toEqual({ kind: 'branches', limit: 1, used: 1 });
    // The refusal unwound the whole create: no orphan numbering rows either.
    expect(
      await count(
        `SELECT count(*) FROM shared.number_sequences WHERE tenant_id = $1 AND branch_id IS NOT NULL`,
        [ALPHA.tenantId]
      )
    ).toBe(3);
  });

  it('refuses an actor without org.branch.manage', async () => {
    asReader();
    const refused = await call<{ code: string }>(branchCreateRoute, {
      path: '/org/branches',
      body: {
        companyId: ALPHA.companyId,
        code: code('refused_branch'),
        name: 'Refused',
        timezone: 'UTC',
      },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ERR-IAM-001');
  });

  it('refuses a company of another tenant as a denial, not a server fault', async () => {
    asBravo();
    const refused = await call<{ code: string }>(branchCreateRoute, {
      path: '/org/branches',
      body: {
        companyId: ALPHA.companyId,
        code: code('cross_tenant'),
        name: 'Cross-tenant',
        timezone: 'UTC',
      },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ERR-IAM-001');
    expect(
      await count('SELECT count(*) FROM org.branches WHERE company_id = $1', [ALPHA.companyId])
    ).toBe(1);
  });

  it('refuses an unknown member of the body', async () => {
    asAdmin();
    const refused = await call<{ code: string }>(branchCreateRoute, {
      path: '/org/branches',
      body: {
        companyId: ALPHA.companyId,
        code: code('strict'),
        name: 'Strict',
        timezone: 'UTC',
        status: 'inactive',
      },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('ERR-VAL-001');
  });
});

describe('iam.invitation-create under the seat ceiling', () => {
  it('admits the invitation that takes the last seat', async () => {
    asAdmin();
    const invited = await call<{ id?: string; status?: string }>(invitationCreateRoute, {
      path: '/iam/invitations',
      body: { email: `${code('invitee_one')}@example.test`, displayName: 'Invitee One' },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(invited.status);
    expect(invited.body.status).toBe('invited');
  });

  it('answers 409 ERR-CAP-001 with the seat numbers once the seats are spent', async () => {
    asAdmin();
    const refused = await call<{ code: string; capacity?: unknown }>(invitationCreateRoute, {
      path: '/iam/invitations',
      body: { email: `${code('invitee_two')}@example.test`, displayName: 'Invitee Two' },
      idempotencyKey: randomUUID(),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ERR-CAP-001');
    expect(refused.body.capacity).toEqual({ kind: 'users', limit: 3, used: 3 });
    expect(
      await count('SELECT count(*) FROM iam.user_accounts WHERE tenant_id = $1', [ALPHA.tenantId])
    ).toBe(3);
  });
});

describe('org.capacity-read', () => {
  it('publishes usage against the ceilings and the subscription behind them', async () => {
    asAdmin();
    const result = await call<{
      capacity: unknown;
      subscription: {
        planCode: string;
        displayName: string;
        status: string;
        effectiveFrom: string;
        effectiveTo: string | null;
      } | null;
    }>(capacityReadRoute, { path: '/org/capacity', method: 'GET' });
    expect(result.status).toBe(200);
    expect(result.body.capacity).toEqual({
      companies: { used: 2, limit: 2 },
      branches: { used: 1, limit: 1 },
      users: { used: 3, limit: 3 },
    });
    expect(result.body.subscription).not.toBeNull();
    expect(result.body.subscription!.planCode).toBe(code('plan'));
    expect(result.body.subscription!.status).toBe('active');
    expect(Number.isNaN(Date.parse(result.body.subscription!.effectiveFrom))).toBe(false);
    expect(result.body.subscription!.effectiveTo).toBeNull();
  });

  it('answers another tenant with its own numbers, never alpha', async () => {
    asBravo();
    const result = await call<{ capacity: unknown; subscription: unknown }>(capacityReadRoute, {
      path: '/org/capacity',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(result.body.subscription).toBeNull();
    expect(result.body.capacity).toEqual({
      companies: { used: 2, limit: null },
      branches: { used: 0, limit: null },
      users: { used: 1, limit: null },
    });
  });

  it('refuses an actor without org.tenant.read', async () => {
    asReader();
    const refused = await call<{ code: string }>(capacityReadRoute, {
      path: '/org/capacity',
      method: 'GET',
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ERR-IAM-001');
  });
});
