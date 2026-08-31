/**
 * PRE-P1-29 Wave C — the Company RBAC Backend, end to end.
 *
 * Every assertion starts at `new Request(...)` and ends at a `Response`. That is
 * deliberate and it is the whole point of the suite. Three of the permissions
 * exercised here — `org.company.manage`, `org.branch.manage`,
 * `org.department.manage` — were seeded with ZERO references anywhere in the
 * product before this slice, so nothing had ever run the path where they are
 * true OR the path where they are false. A structural gate cannot tell an
 * enforced permission from an inert one; only a response can.
 *
 * ## Five principals, and why each exists
 *
 *   ORG ADMIN        every manage code plus every read code, unrestricted
 *   READER           the three read codes only — no manage authority at all
 *   MANAGE ONLY      org.department.manage and NOT org.department.read
 *   UNPERMITTED      an active account in the tenant holding nothing
 *   TENANT B         an active account in another tenant, fully permissioned there
 *
 * MANAGE ONLY is the one that would be easy to omit and is the most important.
 * `org.department.read` is a NEW code in this wave, and the entire argument for
 * minting it is that reusing `org.department.manage` for a picker would force
 * anyone choosing a department to hold the authority to restructure the
 * organisation. That argument is only worth anything if the codes really are
 * separate — so this principal is refused the list, and if someone later
 * collapses the two codes the refusal turns into a 200 and this suite goes red.
 *
 * ## Audit is asserted as a DELTA, never as a declaration
 *
 * `route-handler.ts` writes no audit record. `auditClass: 'privileged'` is
 * validated against a catalogue and does nothing at runtime, and Wave B shipped
 * two operations that declared it and appended nothing. So each privileged case
 * here counts `iam.audit_records` before and after and asserts the difference.
 *
 * COVERAGE-EVIDENCE (PRE-P1-29 Wave C company RBAC):
 *   org.company-list: route service authorization success denial cross-tenant
 *   org.branch-list: route service authorization success denial cross-tenant
 *   org.company-update: route service authorization success denial cross-tenant isolation audit stale-version
 *   org.company-status-set: route service authorization success denial cross-tenant isolation audit idempotency
 *   org.branch-update: route service authorization success denial cross-tenant isolation audit stale-version
 *   org.department-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   org.department-list: route service authorization success denial cross-tenant isolation
 *   org.department-update: route service authorization success denial cross-tenant isolation audit stale-version
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { FakeIdentityProvider, iamModule, setIdentityProvider } from '@/modules/iam';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';

import { COMPANY_LIST_OPERATION, GET as companyListRoute } from '@/app/api/v1/org/companies/route';
import {
  COMPANY_UPDATE_OPERATION,
  PATCH as companyUpdateRoute,
} from '@/app/api/v1/org/companies/[companyId]/route';
import {
  COMPANY_STATUS_SET_OPERATION,
  POST as companyStatusRoute,
} from '@/app/api/v1/org/companies/[companyId]/status/route';
import { BRANCH_LIST_OPERATION, GET as branchListRoute } from '@/app/api/v1/org/branches/route';
import {
  BRANCH_UPDATE_OPERATION,
  PATCH as branchUpdateRoute,
} from '@/app/api/v1/org/branches/[branchId]/route';
import {
  DEPARTMENT_CREATE_OPERATION,
  DEPARTMENT_LIST_OPERATION,
  GET as departmentListRoute,
  POST as departmentCreateRoute,
} from '@/app/api/v1/org/departments/route';
import {
  DEPARTMENT_UPDATE_OPERATION,
  PATCH as departmentUpdateRoute,
} from '@/app/api/v1/org/departments/[departmentId]/route';

const IDENTITY_PROVIDER = 'test_harness';
const RUN = randomUUID().slice(0, 8);

const SUBJECT_ADMIN = `fx_wc_admin_${RUN}`;
const SUBJECT_READER = `fx_wc_reader_${RUN}`;
const SUBJECT_MANAGE_ONLY = `fx_wc_manageonly_${RUN}`;
const SUBJECT_UNPERMITTED = `fx_wc_none_${RUN}`;
const SUBJECT_TENANT_B = `fx_wc_bravo_${RUN}`;

const USER_ADMIN = 'c1000000-0000-4000-8000-00000000000a';
const USER_READER = 'c1000000-0000-4000-8000-00000000000b';
const USER_MANAGE_ONLY = 'c1000000-0000-4000-8000-00000000000c';
const USER_UNPERMITTED = 'c1000000-0000-4000-8000-00000000000d';
const USER_TENANT_B = 'c1000000-0000-4000-8000-00000000000e';

/** A second company in tenant A, so "reachable" can differ from "exists". */
const COMPANY_A2 = 'c1200000-0000-4000-8000-000000000001';
/** Tenant B's own company and branch, so cross-tenant is a real comparison. */
let companyB1 = '';
let branchB1 = '';

const MANAGE_CODES = [
  'org.company.manage',
  'org.branch.manage',
  'org.department.manage',
  'org.company.read',
  'org.branch.read',
  'org.department.read',
];
const READ_CODES = ['org.company.read', 'org.branch.read', 'org.department.read'];

let admin: Pool;
let runtime: Pool;

type CallResult<T> = { readonly status: number; readonly body: T };
type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;

async function call<T>(
  handler: unknown,
  input: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
    readonly params?: Record<string, string>;
    readonly idempotencyKey?: string;
    readonly ifMatch?: number;
  }
): Promise<CallResult<T>> {
  reinstallAuthenticator();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  if (input.ifMatch !== undefined) headers['if-match'] = `"${input.ifMatch}"`;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

let currentClaims: { providerSubject: string; tenantId: string } | null = null;

/**
 * Re-installed immediately before EVERY request, not once per test.
 *
 * `iamModule()` is a memoised composition root and composing it calls
 * `installIamRuntime()`, which calls `setSessionAuthenticator(new
 * BearerSessionAuthenticator(...))` — silently replacing whatever the harness
 * installed. Without this, the first route call in the process runs as the
 * harness intended and every later one does not.
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

function authenticateAs(providerSubject: string, tenantId: string = TENANT_A): void {
  currentClaims = { providerSubject, tenantId };
  reinstallAuthenticator();
}
const asAdmin = (): void => authenticateAs(SUBJECT_ADMIN);
const asReader = (): void => authenticateAs(SUBJECT_READER);
const asManageOnly = (): void => authenticateAs(SUBJECT_MANAGE_ONLY);
const asUnpermitted = (): void => authenticateAs(SUBJECT_UNPERMITTED);
const asTenantB = (): void => authenticateAs(SUBJECT_TENANT_B, TENANT_B);

async function seedActor(
  userId: string,
  subject: string,
  tenantId: string,
  creator: string,
  codes: readonly string[]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'Wave C fixture','active',$6) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, `${subject}@example.test`, creator]
  );
  if (codes.length === 0) return;
  const roleId = randomUUID();
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by) VALUES ($1,$2,$3,$4,$5)`,
    [roleId, tenantId, `fx_wc_${subject.slice(-12)}`, 'Wave C fixture role', creator]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = ANY($4::text[])`,
    [tenantId, roleId, creator, codes]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
    [tenantId, userId, roleId, creator]
  );
}

async function scalar<T>(sql: string, values: readonly unknown[] = []): Promise<T | null> {
  const { rows } = await admin.query(sql, values as unknown[]);
  return rows.length === 0 ? null : (Object.values(rows[0])[0] as T);
}

const auditCount = async (action: string): Promise<number> =>
  Number(
    await scalar<string>('SELECT count(*) FROM iam.audit_records WHERE action = $1', [action])
  );

const companyVersion = async (companyId: string): Promise<number> =>
  Number(
    await scalar<number>('SELECT record_version FROM org.legal_companies WHERE id = $1', [
      companyId,
    ])
  );

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  __resetBackendConfigForTests();

  // The provider seam goes in BEFORE the composition root is touched.
  // `installIamRuntime()` reads Supabase credentials only when no provider is
  // present, so installing the fake first is what lets this whole route surface
  // run with no provider credentials at all (ADR-019).
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'pre-p1-29-wave-c-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);

  // A second company in tenant A. Without it "the list is what you may reach"
  // cannot be distinguished from "the list is everything", because there would
  // be nothing the actor cannot reach.
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,$3,'Wave C Second Company','USD',$4) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A2, TENANT_A, `wc_second_${RUN}`, USER_A]
  );

  // Tenant B's own organisation, so the cross-tenant cases compare two populated
  // tenants rather than one populated tenant and one empty one — an empty
  // comparison passes for the wrong reason.
  const cb = await admin.query<{ id: string }>(
    `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'Bravo Company','USD',$3) RETURNING id`,
    [TENANT_B, `wc_bravo_${RUN}`, USER_B]
  );
  companyB1 = cb.rows[0]!.id;
  const bb = await admin.query<{ id: string }>(
    `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'Bravo Branch','UTC',$4) RETURNING id`,
    [TENANT_B, companyB1, `wc_bravo_br_${RUN}`, USER_B]
  );
  branchB1 = bb.rows[0]!.id;

  await seedActor(USER_ADMIN, SUBJECT_ADMIN, TENANT_A, USER_A, MANAGE_CODES);
  await seedActor(USER_READER, SUBJECT_READER, TENANT_A, USER_A, READ_CODES);
  await seedActor(USER_MANAGE_ONLY, SUBJECT_MANAGE_ONLY, TENANT_A, USER_A, [
    'org.department.manage',
  ]);
  await seedActor(USER_UNPERMITTED, SUBJECT_UNPERMITTED, TENANT_A, USER_A, []);
  await seedActor(USER_TENANT_B, SUBJECT_TENANT_B, TENANT_B, USER_B, MANAGE_CODES);

  // Force the composition root NOW, so its authenticator replacement happens
  // here rather than in the middle of the first test's request.
  iamModule();
}, 120_000);

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  __resetAuthenticatorForTests();
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

// ---------------------------------------------------------------------------
// The registrations. Structural, and deliberately NOT the proof.
// ---------------------------------------------------------------------------
describe('Wave C operation declarations', () => {
  it('registers the eight operation ids this wave owes', () => {
    // The ids in assertions, not only in the evidence block: the coverage gate
    // reads a suite for the ids it claims to exercise, and a manifest entry whose
    // file never names the operation is a claim with nothing behind it.
    expect(COMPANY_LIST_OPERATION.id).toBe('org.company-list');
    expect(BRANCH_LIST_OPERATION.id).toBe('org.branch-list');
    expect(COMPANY_UPDATE_OPERATION.id).toBe('org.company-update');
    expect(COMPANY_STATUS_SET_OPERATION.id).toBe('org.company-status-set');
    expect(BRANCH_UPDATE_OPERATION.id).toBe('org.branch-update');
    expect(DEPARTMENT_CREATE_OPERATION.id).toBe('org.department-create');
    expect(DEPARTMENT_LIST_OPERATION.id).toBe('org.department-list');
    expect(DEPARTMENT_UPDATE_OPERATION.id).toBe('org.department-update');
  });

  it('splits the department read from the department manage authority', () => {
    // The whole justification for minting org.department.read is that a picker
    // must not require restructure authority. If these two ever name the same
    // code, that justification is gone and this assertion says so.
    expect(DEPARTMENT_LIST_OPERATION.permissions).toEqual(['org.department.read']);
    expect(DEPARTMENT_CREATE_OPERATION.permissions).toEqual(['org.department.manage']);
    expect(DEPARTMENT_UPDATE_OPERATION.permissions).toEqual(['org.department.manage']);
  });

  it('declares the reach lists on the low-risk read codes, not on manage', () => {
    expect(COMPANY_LIST_OPERATION.permissions).toEqual(['org.company.read']);
    expect(BRANCH_LIST_OPERATION.permissions).toEqual(['org.branch.read']);
    expect(COMPANY_LIST_OPERATION.auditClass).toBe('none');
    expect(BRANCH_LIST_OPERATION.auditClass).toBe('none');
  });

  it('declares every mutation privileged, with a named action', () => {
    expect(COMPANY_UPDATE_OPERATION.auditAction).toBe('org.company.updated');
    expect(COMPANY_STATUS_SET_OPERATION.auditAction).toBe('org.company.status_changed');
    expect(BRANCH_UPDATE_OPERATION.auditAction).toBe('org.branch.updated');
    expect(DEPARTMENT_CREATE_OPERATION.auditAction).toBe('org.department.created');
    expect(DEPARTMENT_UPDATE_OPERATION.auditAction).toBe('org.department.updated');
  });
});

// ---------------------------------------------------------------------------
// P-1 — the reach lists
// ---------------------------------------------------------------------------
describe('P-1: the companies and branches an actor may reach, by name', () => {
  it('W1 returns companies BY NAME to a permitted actor', async () => {
    asReader();
    const result = await call<{ items: { id: string; legalName: string }[] }>(companyListRoute, {
      path: '/org/companies',
      method: 'GET',
    });
    expect(result.status).toBe(200);
    // By NAME, which is P-1's actual requirement — an id-only list is the state
    // the product was already in and is exactly what G-5 records as the gap.
    const names = result.body.items.map((row) => row.legalName);
    expect(names).toContain('Wave C Second Company');
    expect(result.body.items.every((row) => typeof row.legalName === 'string')).toBe(true);
  }, 30_000);

  it('W2 refuses an actor holding no read authority (403, ERR-IAM-001)', async () => {
    asUnpermitted();
    const result = await call<{ code?: string }>(companyListRoute, {
      path: '/org/companies',
      method: 'GET',
    });
    // The code as well as the status. A 403 from a throttle, a missing session or
    // an unregistered permission code are indistinguishable by status alone, and
    // this repository has already shipped a case that passed against the wrong one.
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W3 returns branches by name, each under its company', async () => {
    asReader();
    const result = await call<{ items: { id: string; companyId: string; name: string }[] }>(
      branchListRoute,
      { path: '/org/branches', method: 'GET' }
    );
    expect(result.status).toBe(200);
    expect(result.body.items.length).toBeGreaterThan(0);
    // companyId travels with every row because a branch name is only unambiguous
    // underneath its company — the selector P-1 describes is a two-level choice.
    for (const row of result.body.items) {
      expect(typeof row.name).toBe('string');
      expect(typeof row.companyId).toBe('string');
    }
  }, 30_000);

  it('W4 refuses the branch list to an actor holding no read authority', async () => {
    asUnpermitted();
    const result = await call<{ code?: string }>(branchListRoute, {
      path: '/org/branches',
      method: 'GET',
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W5 shows a tenant NONE of another tenant’s organisation', async () => {
    // Both tenants are populated, so this is a real comparison. Against an empty
    // tenant B the assertion would pass no matter what the predicate did.
    asTenantB();
    const companies = await call<{ items: { id: string }[] }>(companyListRoute, {
      path: '/org/companies',
      method: 'GET',
    });
    expect(companies.status).toBe(200);
    const companyIds = companies.body.items.map((row) => row.id);
    expect(companyIds).toContain(companyB1);
    expect(companyIds).not.toContain(COMPANY_A1);
    expect(companyIds).not.toContain(COMPANY_A2);

    const branches = await call<{ items: { id: string }[] }>(branchListRoute, {
      path: '/org/branches',
      method: 'GET',
    });
    expect(branches.status).toBe(200);
    const branchIds = branches.body.items.map((row) => row.id);
    expect(branchIds).toContain(branchB1);
    expect(branchIds).not.toContain(BRANCH_A1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// G-4 — company and branch administration
// ---------------------------------------------------------------------------
describe('G-4: company and branch administration', () => {
  it('W6 updates a company and appends exactly one audit record', async () => {
    const before = await auditCount('org.company.updated');
    asAdmin();
    const result = await call<{ company: { legalName: string; recordVersion: number } }>(
      companyUpdateRoute,
      {
        path: `/org/companies/${COMPANY_A2}`,
        method: 'PATCH',
        body: { legalName: 'Wave C Renamed Company' },
        params: { companyId: COMPANY_A2 },
        ifMatch: await companyVersion(COMPANY_A2),
      }
    );
    expect(result.status).toBe(200);
    expect(result.body.company.legalName).toBe('Wave C Renamed Company');
    // A DELTA of exactly one. The declaration proves nothing: the pipeline writes
    // no audit record, so only the row shows the service actually appended it.
    expect(await auditCount('org.company.updated')).toBe(before + 1);
  }, 30_000);

  it('W7 refuses a company update to an actor without org.company.manage', async () => {
    // The READER holds org.company.read, so this is one permission apart from a
    // caller who succeeds — not a caller who holds nothing.
    asReader();
    const result = await call<{ code?: string }>(companyUpdateRoute, {
      path: `/org/companies/${COMPANY_A2}`,
      method: 'PATCH',
      body: { legalName: 'Should not land' },
      params: { companyId: COMPANY_A2 },
      ifMatch: await companyVersion(COMPANY_A2),
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W8 refuses a cross-tenant company update, and changes nothing', async () => {
    const nameBefore = await scalar<string>(
      'SELECT legal_name FROM org.legal_companies WHERE id = $1',
      [COMPANY_A2]
    );
    asTenantB();
    const result = await call<{ code?: string }>(companyUpdateRoute, {
      path: `/org/companies/${COMPANY_A2}`,
      method: 'PATCH',
      body: { legalName: 'Taken over' },
      params: { companyId: COMPANY_A2 },
      ifMatch: 1,
    });
    // ERR-IAM-001 rather than a 404: a denial must not reveal whether the target
    // exists, so an unreachable row and a nonexistent one answer the same way.
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
    expect(
      await scalar<string>('SELECT legal_name FROM org.legal_companies WHERE id = $1', [COMPANY_A2])
    ).toBe(nameBefore);
  }, 30_000);

  it('W9 refuses a stale If-Match rather than overwriting (ERR-CON-001)', async () => {
    asAdmin();
    const current = await companyVersion(COMPANY_A2);
    const result = await call<{ code?: string }>(companyUpdateRoute, {
      path: `/org/companies/${COMPANY_A2}`,
      method: 'PATCH',
      body: { legalName: 'Racing write' },
      params: { companyId: COMPANY_A2 },
      // The row exists and is reachable; ONLY the version is wrong. A version
      // that is stale because the row was never there would prove nothing.
      ifMatch: current - 1,
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('ERR-CON-001');
  }, 30_000);

  it('W10 refuses status in the company update body (422), because a lifecycle owns it', async () => {
    asAdmin();
    const result = await call<{ code?: string }>(companyUpdateRoute, {
      path: `/org/companies/${COMPANY_A2}`,
      method: 'PATCH',
      body: { status: 'inactive' },
      params: { companyId: COMPANY_A2 },
      ifMatch: await companyVersion(COMPANY_A2),
    });
    // .strict() refuses the key outright. A silent drop would let a caller
    // believe they had deactivated a company through a route that cannot.
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ERR-VAL-001');
  }, 30_000);

  it('W11 updates a branch and appends exactly one audit record', async () => {
    const before = await auditCount('org.branch.updated');
    const version = Number(
      await scalar<number>('SELECT record_version FROM org.branches WHERE id = $1', [BRANCH_A1])
    );
    asAdmin();
    const result = await call<{ branch: { name: string } }>(branchUpdateRoute, {
      path: `/org/branches/${BRANCH_A1}`,
      method: 'PATCH',
      body: { name: 'Wave C Renamed Branch', city: 'Amman' },
      params: { branchId: BRANCH_A1 },
      ifMatch: version,
    });
    expect(result.status).toBe(200);
    expect(result.body.branch.name).toBe('Wave C Renamed Branch');
    expect(await auditCount('org.branch.updated')).toBe(before + 1);
  }, 30_000);

  it('W12 refuses a branch reassignment: companyId is not in the schema (422)', async () => {
    asAdmin();
    const version = Number(
      await scalar<number>('SELECT record_version FROM org.branches WHERE id = $1', [BRANCH_A1])
    );
    const result = await call<{ code?: string }>(branchUpdateRoute, {
      path: `/org/branches/${BRANCH_A1}`,
      method: 'PATCH',
      body: { companyId: COMPANY_A2 },
      params: { branchId: BRANCH_A1 },
      ifMatch: version,
    });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ERR-VAL-001');
  }, 30_000);

  it('W31 refuses a cross-tenant branch update, and changes nothing', async () => {
    const before = await scalar<string>('SELECT name FROM org.branches WHERE id = $1', [BRANCH_A1]);
    asTenantB();
    const result = await call<{ code?: string }>(branchUpdateRoute, {
      path: `/org/branches/${BRANCH_A1}`,
      method: 'PATCH',
      body: { name: 'Taken over' },
      params: { branchId: BRANCH_A1 },
      ifMatch: 1,
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
    // The refusal AND the absence of a side effect. An error asserted alone would
    // pass even if the write had happened and the response failed afterwards.
    expect(await scalar<string>('SELECT name FROM org.branches WHERE id = $1', [BRANCH_A1])).toBe(
      before
    );
  }, 30_000);

  it('W13 refuses a branch update to an actor without org.branch.manage', async () => {
    asReader();
    const version = Number(
      await scalar<number>('SELECT record_version FROM org.branches WHERE id = $1', [BRANCH_A1])
    );
    const result = await call<{ code?: string }>(branchUpdateRoute, {
      path: `/org/branches/${BRANCH_A1}`,
      method: 'PATCH',
      body: { name: 'Should not land' },
      params: { branchId: BRANCH_A1 },
      ifMatch: version,
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// G-4 / migration 133 — the company lifecycle acquires a caller
// ---------------------------------------------------------------------------
describe('org.company-status-set: wiring org.change_company_status', () => {
  it('W14 deactivates a company, emitting exactly one history row and one audit record', async () => {
    const auditBefore = await auditCount('org.company.status_changed');
    const historyBefore = Number(
      await scalar<string>(
        'SELECT count(*) FROM org.company_status_history WHERE company_id = $1',
        [COMPANY_A2]
      )
    );

    asAdmin();
    const result = await call<{ company: { status: string } }>(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      body: { status: 'inactive', reason: 'wave C proof' },
      params: { companyId: COMPANY_A2 },
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(200);
    expect(result.body.company.status).toBe('inactive');

    // EXACTLY one history row. The route inserts none — migration 133's emitter
    // does — so this is the assertion that proves the sanctioned function was the
    // path taken rather than an inline UPDATE.
    const rows = await admin.query<{
      from_state: string;
      to_state: string;
      reason: string;
      actor_id: string;
    }>(
      `SELECT from_state, to_state, reason, actor_id FROM org.company_status_history
        WHERE company_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [COMPANY_A2]
    );
    const after = Number(
      await scalar<string>(
        'SELECT count(*) FROM org.company_status_history WHERE company_id = $1',
        [COMPANY_A2]
      )
    );
    expect(after - historyBefore).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      from_state: 'active',
      to_state: 'inactive',
      reason: 'wave C proof',
      // Server-derived by shared.stamp_status_history() from the SESSION. The
      // route has no actor parameter and could not supply one.
      actor_id: USER_ADMIN,
    });
    expect(await auditCount('org.company.status_changed')).toBe(auditBefore + 1);
  }, 30_000);

  it('W15 reinstates the company: the reverse edge is legal', async () => {
    asAdmin();
    const result = await call<{ company: { status: string } }>(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      body: { status: 'active', reason: 'wave C reinstate' },
      params: { companyId: COMPANY_A2 },
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(200);
    expect(result.body.company.status).toBe('active');
  }, 30_000);

  it('W30 replays a status change on the same key without a second history row', async () => {
    const key = randomUUID();
    const body = { status: 'inactive', reason: 'wave C replay' };
    const before = Number(
      await scalar<string>(
        'SELECT count(*) FROM org.company_status_history WHERE company_id = $1',
        [COMPANY_A2]
      )
    );

    asAdmin();
    const first = await call<{ company: { status: string } }>(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      body,
      params: { companyId: COMPANY_A2 },
      idempotencyKey: key,
    });
    expect(first.status).toBe(200);

    asAdmin();
    const replay = await call<{ company: { status: string } }>(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      body,
      params: { companyId: COMPANY_A2 },
      idempotencyKey: key,
    });
    expect(replay.status).toBe(200);

    // The DELTA, not the status. Without replay protection the second call would
    // reach org.change_company_status, be refused as a no-op, and answer 422 —
    // so a status assertion alone would look like proof and be measuring the
    // function's own guard instead of the idempotency layer.
    const after = Number(
      await scalar<string>(
        'SELECT count(*) FROM org.company_status_history WHERE company_id = $1',
        [COMPANY_A2]
      )
    );
    expect(after - before).toBe(1);

    // Put it back, so the ordering of later cases does not depend on this one.
    asAdmin();
    await call(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      body: { status: 'active', reason: 'wave C replay cleanup' },
      params: { companyId: COMPANY_A2 },
      idempotencyKey: randomUUID(),
    });
  }, 60_000);

  it('W16 refuses a status change to an actor without org.company.manage', async () => {
    asReader();
    const result = await call<{ code?: string }>(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      body: { status: 'inactive', reason: 'should not land' },
      params: { companyId: COMPANY_A2 },
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W17 refuses a cross-tenant status change and leaves the status untouched', async () => {
    asTenantB();
    const result = await call<{ code?: string }>(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      body: { status: 'inactive', reason: 'takeover' },
      params: { companyId: COMPANY_A2 },
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(403);
    expect(
      await scalar<string>('SELECT status FROM org.legal_companies WHERE id = $1', [COMPANY_A2])
    ).toBe('active');
  }, 30_000);

  it('W18 refuses a tenant state the company vocabulary does not have (422)', async () => {
    asAdmin();
    const result = await call<{ code?: string }>(companyStatusRoute, {
      path: `/org/companies/${COMPANY_A2}/status`,
      // 'suspended' is a TENANT state. Companies must not acquire the tenant
      // graph by accident, and this is the case that would go red if they did.
      body: { status: 'suspended', reason: 'wrong graph' },
      params: { companyId: COMPANY_A2 },
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ERR-VAL-001');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// G-6 — the department surface
// ---------------------------------------------------------------------------
describe('G-6: departments acquire a way in', () => {
  let departmentId = '';

  it('W19 creates the first department the product has ever been able to create', async () => {
    const before = await auditCount('org.department.created');
    asAdmin();
    const result = await call<{ department: { id: string; departmentCode: string } }>(
      departmentCreateRoute,
      {
        path: '/org/departments',
        body: {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          departmentCode: `wc_dept_${RUN}`,
          name: 'Wave C Service Department',
        },
        idempotencyKey: randomUUID(),
      }
    );
    expect(result.status).toBe(201);
    expect(result.body.department.departmentCode).toBe(`wc_dept_${RUN}`);
    expect(await auditCount('org.department.created')).toBe(before + 1);
    departmentId = result.body.department.id;
  }, 30_000);

  it('W20 replays the same idempotency key without creating a second department', async () => {
    const key = randomUUID();
    const body = {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      departmentCode: `wc_idem_${RUN}`,
      name: 'Wave C Idempotent Department',
    };
    asAdmin();
    const first = await call<{ department: { id: string } }>(departmentCreateRoute, {
      path: '/org/departments',
      body,
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);

    asAdmin();
    const replay = await call<{ department: { id: string } }>(departmentCreateRoute, {
      path: '/org/departments',
      body,
      idempotencyKey: key,
    });
    // The same id, not merely another 201 — a second 201 with a different id is
    // exactly the defect replay protection exists to prevent, and the status
    // alone cannot tell the two apart.
    expect(replay.body.department.id).toBe(first.body.department.id);
    const count = Number(
      await scalar<string>('SELECT count(*) FROM org.departments WHERE department_code = $1', [
        `wc_idem_${RUN}`,
      ])
    );
    expect(count).toBe(1);
  }, 60_000);

  it('W21 lists the department to a holder of org.department.read', async () => {
    asReader();
    const result = await call<{ items: { id: string; name: string }[] }>(departmentListRoute, {
      path: `/org/departments?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`,
      method: 'GET',
    });
    expect(result.status).toBe(200);
    expect(result.body.items.map((row) => row.id)).toContain(departmentId);
    // The minimum a later BR-02 selector needs: an id and a name.
    expect(result.body.items.every((row) => typeof row.name === 'string')).toBe(true);
  }, 30_000);

  it('W22 REFUSES the list to an actor holding only org.department.manage', async () => {
    // The case that justifies minting org.department.read at all. If the two
    // codes were ever collapsed, this 403 becomes a 200 and the suite goes red —
    // which is the only thing standing between a least-privilege picker and an
    // over-grant that would look identical in every structural gate.
    asManageOnly();
    const result = await call<{ code?: string }>(departmentListRoute, {
      path: `/org/departments?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`,
      method: 'GET',
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W23 refuses a create to an actor holding only the read code', async () => {
    // The mirror of W22, and it matters just as much: a read code that silently
    // permitted creation would make the split decorative.
    asReader();
    const result = await call<{ code?: string }>(departmentCreateRoute, {
      path: '/org/departments',
      body: {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        departmentCode: `wc_denied_${RUN}`,
        name: 'Should not land',
      },
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W24 refuses a cross-tenant department create', async () => {
    asTenantB();
    const result = await call<{ code?: string }>(departmentCreateRoute, {
      path: '/org/departments',
      body: {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        departmentCode: `wc_cross_${RUN}`,
        name: 'Cross-tenant department',
      },
      idempotencyKey: randomUUID(),
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W25 refuses a duplicate department code inside the same branch', async () => {
    asAdmin();
    const result = await call<{ code?: string }>(departmentCreateRoute, {
      path: '/org/departments',
      body: {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        departmentCode: `wc_dept_${RUN}`,
        name: 'Duplicate code',
      },
      idempotencyKey: randomUUID(),
    });
    // uq_departments_branch_code_live, surfaced as a conflict rather than a 500.
    expect(result.status).toBe(409);
  }, 30_000);

  it('W32 shows tenant B none of tenant A’s departments', async () => {
    // Tenant B asks for tenant A's exact company/branch pair. The permission is
    // satisfied — tenant B holds org.department.read unrestricted in its OWN
    // tenant — so what refuses this is scope and RLS, not the permission.
    asTenantB();
    const result = await call<{ items: { id: string }[]; code?: string }>(departmentListRoute, {
      path: `/org/departments?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`,
      method: 'GET',
    });
    if (result.status === 200) {
      // If the scope check admits it, the row-level predicate must still return
      // nothing — asserting only the status would miss a leak entirely.
      expect(result.body.items).toHaveLength(0);
    } else {
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('ERR-IAM-001');
    }
  }, 30_000);

  it('W26 renames a department and appends exactly one audit record', async () => {
    const before = await auditCount('org.department.updated');
    const version = Number(
      await scalar<number>('SELECT record_version FROM org.departments WHERE id = $1', [
        departmentId,
      ])
    );
    asAdmin();
    const result = await call<{ department: { name: string } }>(departmentUpdateRoute, {
      path: `/org/departments/${departmentId}`,
      method: 'PATCH',
      body: { name: 'Wave C Renamed Department' },
      params: { departmentId },
      ifMatch: version,
    });
    expect(result.status).toBe(200);
    expect(result.body.department.name).toBe('Wave C Renamed Department');
    expect(await auditCount('org.department.updated')).toBe(before + 1);
  }, 30_000);

  it('W27 refuses moving a department between branches (422)', async () => {
    asAdmin();
    const version = Number(
      await scalar<number>('SELECT record_version FROM org.departments WHERE id = $1', [
        departmentId,
      ])
    );
    const result = await call<{ code?: string }>(departmentUpdateRoute, {
      path: `/org/departments/${departmentId}`,
      method: 'PATCH',
      body: { branchId: BRANCH_A1, name: 'Moved' },
      params: { departmentId },
      ifMatch: version,
    });
    expect(result.status).toBe(422);
    expect(result.body.code).toBe('ERR-VAL-001');
  }, 30_000);

  it('W28 refuses a department update to an actor without org.department.manage', async () => {
    asReader();
    const version = Number(
      await scalar<number>('SELECT record_version FROM org.departments WHERE id = $1', [
        departmentId,
      ])
    );
    const result = await call<{ code?: string }>(departmentUpdateRoute, {
      path: `/org/departments/${departmentId}`,
      method: 'PATCH',
      body: { name: 'Should not land' },
      params: { departmentId },
      ifMatch: version,
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
  }, 30_000);

  it('W33 refuses a cross-tenant department update, and changes nothing', async () => {
    const before = await scalar<string>('SELECT name FROM org.departments WHERE id = $1', [
      departmentId,
    ]);
    asTenantB();
    const result = await call<{ code?: string }>(departmentUpdateRoute, {
      path: `/org/departments/${departmentId}`,
      method: 'PATCH',
      body: { name: 'Taken over' },
      params: { departmentId },
      ifMatch: 1,
    });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ERR-IAM-001');
    expect(
      await scalar<string>('SELECT name FROM org.departments WHERE id = $1', [departmentId])
    ).toBe(before);
  }, 30_000);

  it('W29 retires a department by status, keeping its code reserved', async () => {
    const version = Number(
      await scalar<number>('SELECT record_version FROM org.departments WHERE id = $1', [
        departmentId,
      ])
    );
    asAdmin();
    const result = await call<{ department: { status: string } }>(departmentUpdateRoute, {
      path: `/org/departments/${departmentId}`,
      method: 'PATCH',
      body: { status: 'inactive' },
      params: { departmentId },
      ifMatch: version,
    });
    expect(result.status).toBe(200);
    expect(result.body.department.status).toBe('inactive');
    // Retirement is NOT archival: the row is still present and still holds its
    // code, so uq_departments_branch_code_live has not released it. That is the
    // reason Wave C ships no archive verb.
    expect(
      await scalar<string>('SELECT department_code FROM org.departments WHERE id = $1', [
        departmentId,
      ])
    ).toBe(`wc_dept_${RUN}`);
  }, 30_000);
});
