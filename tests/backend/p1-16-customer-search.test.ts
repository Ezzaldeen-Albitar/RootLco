/**
 * GET /api/v1/customers — customer search, end to end (Phase 1-16, FR-CRM-001,
 * NFR-PRV-001).
 *
 * Drives the real route through the fixed pipeline against a real database on the
 * least-privilege `app_runtime` role: correlation → authenticate → resolve
 * context → transaction → authorize → handler → response. It proves the search
 * is bounded, privacy-safe, tenant-isolated, and cannot be turned into a wildcard
 * scan or an enumeration oracle.
 *
 * Operations exercised here: crm.customer-search.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.customer-search: route service authorization success denial cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  IDENTITY_PROVIDER,
  SUBJECT_UNPERMITTED,
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
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { GET } from '@/app/api/v1/customers/route';

const CRM_READER_ROLE = 'c1600000-0000-4000-8000-0000000000a1';
const CRM_READER_USER = 'c1600000-0000-4000-8000-0000000000a2';
const CRM_READER_SUBJECT = 'fx_p1_16_crm_reader';
const PARTNER_A = 'c1600000-0000-4000-8000-0000000000b1';
const PARTNER_B = 'c1600000-0000-4000-8000-0000000000b2';

const BASE = 'http://localhost/api/v1/customers';
const SAFE_KEYS = [
  'id',
  'displayNumber',
  'displayName',
  'partyType',
  'lifecycleStatus',
  'createdAt',
];

interface Hit {
  readonly id: string;
  readonly displayName: string;
  readonly partyType: string;
  readonly lifecycleStatus: string;
}
interface SearchBody {
  readonly items?: readonly Hit[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
  readonly code?: string;
  readonly status?: number;
}

let admin: Pool;
let runtime: Pool;

function authenticateAs(providerSubject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

function search(queryString = ''): Promise<Response> {
  return GET(new Request(BASE + queryString, { method: 'GET' }));
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // crm.customer.read is a seeded platform code (seed 04). Inserting it is a
  // no-op where the seed has run (CI, clean room); it keeps this suite runnable
  // against a dev database whose seeds predate the code.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.read', 'crm', 'Search and read customers in the tenant', 'low', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'crm-reader@example.test', 'CRM Reader', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [CRM_READER_USER, TENANT_A, IDENTITY_PROVIDER, CRM_READER_SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_16_crm_reader', 'P1-16 CRM reader', $3)
     ON CONFLICT (id) DO NOTHING`,
    [CRM_READER_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p WHERE p.permission_code = 'crm.customer.read'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, CRM_READER_ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, CRM_READER_USER, CRM_READER_ROLE, USER_A]
  );
  // One customer in tenant A to find, one in tenant B as a cross-tenant decoy.
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1, $2, 'individual', 'Acme Fixture Individual', 'active', $5),
            ($3, $4, 'organization', 'Beta Fixture Organization', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [PARTNER_A, TENANT_A, PARTNER_B, TENANT_B, USER_A]
  );

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('authentication and authorization', () => {
  it('answers 401 with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    const response = await search();
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(401);
    expect(body.code).toBe('ERR-IAM-002');
  });

  it('answers 403 for an authenticated caller lacking crm.customer.read', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await search();
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(403);
    expect(body.code).toBe('ERR-IAM-001');
    expect(body.items).toBeUndefined();
  });
});

describe('bounded, privacy-safe search', () => {
  it('returns the tenant customer and never a cross-tenant row, with safe fields only', async () => {
    authenticateAs(CRM_READER_SUBJECT);
    const response = await search();
    const body = (await response.json()) as SearchBody;

    expect(response.status).toBe(200);
    const ids = (body.items ?? []).map((h) => h.id);
    expect(ids).toContain(PARTNER_A);
    // A real tenant-B customer exists but is unreachable from tenant A.
    expect(ids).not.toContain(PARTNER_B);

    const hit = (body.items ?? []).find((h) => h.id === PARTNER_A);
    expect(hit?.displayName).toBe('Acme Fixture Individual');
    expect(hit?.partyType).toBe('individual');
    // The projection is the closed safe view — no sensitive identifier column.
    expect(Object.keys(hit ?? {}).sort()).toEqual([...SAFE_KEYS].sort());
  });

  it('matches an allow-listed normalized name prefix', async () => {
    authenticateAs(CRM_READER_SUBJECT);
    const response = await search('?name=acme');
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(200);
    expect((body.items ?? []).map((h) => h.id)).toContain(PARTNER_A);
  });

  it('treats a wildcard as a literal — a "%" fragment matches nothing, never everything', async () => {
    authenticateAs(CRM_READER_SUBJECT);
    const response = await search('?name=%25'); // URL-encoded '%'
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(200);
    // No customer's name starts with a literal '%', so the injection returns none.
    expect((body.items ?? []).length).toBe(0);
  });

  it('bounds page size: the platform maximum is accepted and an oversized page is refused', async () => {
    authenticateAs(CRM_READER_SUBJECT);
    const ok = await search('?limit=100');
    expect(ok.status).toBe(200);
    expect((((await ok.json()) as SearchBody).items ?? []).length).toBeLessThanOrEqual(100);

    const tooBig = await search('?limit=100000');
    const body = (await tooBig.json()) as SearchBody;
    expect(tooBig.status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });
});

describe('validation refusals', () => {
  it('rejects an over-long name fragment with ERR-VAL-001', async () => {
    authenticateAs(CRM_READER_SUBJECT);
    const response = await search(`?name=${'a'.repeat(200)}`);
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });

  it('rejects a malformed cursor with ERR-PAG-001 (no ordering-vocabulary oracle)', async () => {
    authenticateAs(CRM_READER_SUBJECT);
    const response = await search('?cursor=not-a-real-cursor');
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(400);
    expect(body.code).toBe('ERR-PAG-001');
  });

  it('rejects an unknown query parameter (strict schema — no mass filtering)', async () => {
    authenticateAs(CRM_READER_SUBJECT);
    const response = await search('?nationalId=123456');
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });
});
