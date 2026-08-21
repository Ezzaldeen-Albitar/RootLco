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

/**
 * Cursor precision — `P1-27-INT-006`, missed here and found by the final P1-27
 * audit.
 *
 * `node-postgres` parses `timestamptz` into a JS `Date`, which holds
 * milliseconds. The search repository built its cursor from
 * `created_at.toISOString()`, silently dropping the three microsecond digits
 * PostgreSQL stores. The next page's keyset predicate then compares against the
 * TRUNCATED value, so every row sharing that millisecond with the last row of
 * the page is skipped — permanently, and with no error.
 *
 * The reason no existing test caught it is that a millisecond cursor paginates
 * perfectly whenever no two rows share a millisecond, which is true of every
 * fixture not deliberately built to collide. So this one is.
 *
 * The first assertion is the collision itself. Without it, a fixture that failed
 * to produce sub-millisecond spacing would make the walk below pass while
 * measuring nothing.
 */
describe('P1-27-INT-006 — a page boundary inside one millisecond loses no row', () => {
  const COLLIDING = Array.from(
    { length: 10 },
    (_unused, index) => `c1600000-0000-4000-8000-0000000000c${index.toString(16)}`
  );

  beforeAll(async () => {
    // Ten partners inside ONE millisecond, one microsecond apart. Written by the
    // admin pool because the runtime role cannot set `created_at`.
    for (const [index, id] of COLLIDING.entries()) {
      await admin.query(
        `INSERT INTO crm.business_partners
           (id, tenant_id, party_type, display_name, lifecycle_status, created_at, created_by)
         VALUES ($1, $2, 'individual', $3, 'active',
                 timestamptz '2026-03-01 12:00:00.123000+00' + ($4::int * interval '1 microsecond'),
                 $5)
         ON CONFLICT (id) DO NOTHING`,
        [id, TENANT_A, `Cursor Collision ${index}`, index + 1, USER_A]
      );
    }
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM crm.business_partners WHERE id = ANY($1::uuid[])`, [COLLIDING]);
  });

  it('places all ten rows in the same millisecond, so the walk below is not vacuous', async () => {
    const { rows } = await admin.query<{ ms: string; n: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS ms,
              count(*)::text AS n
         FROM crm.business_partners
        WHERE id = ANY($1::uuid[])
        GROUP BY 1`,
      [COLLIDING]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.n).toBe('10');

    // And they are genuinely distinct at microsecond precision — otherwise they
    // would be indistinguishable to any cursor and the test would prove nothing.
    const distinct = await admin.query<{ n: string }>(
      `SELECT count(DISTINCT to_char(created_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.US'))::text AS n
         FROM crm.business_partners WHERE id = ANY($1::uuid[])`,
      [COLLIDING]
    );
    expect(distinct.rows[0]?.n).toBe('10');
  });

  it('walks every colliding row across pages of four, with no duplicate and none lost', async () => {
    authenticateAs(CRM_READER_SUBJECT);

    const seen: string[] = [];
    let cursor: string | null = null;
    // Bounded so a broken cursor cannot spin: three pages carry 4 + 4 + 2.
    for (let request = 0; request < 8; request += 1) {
      const query: string =
        `?name=Cursor%20Collision&limit=4` +
        (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);
      const response = await search(query);
      expect(response.status).toBe(200);
      const body = (await response.json()) as SearchBody;
      seen.push(...(body.items ?? []).map((hit) => hit.id));
      if (body.hasMore !== true || body.nextCursor == null) break;
      cursor = body.nextCursor;
    }

    // On the truncated cursor the second request skipped every remaining row in
    // the millisecond, so this came back as 4.
    expect(new Set(seen).size, 'no row may be returned twice').toBe(seen.length);
    expect([...seen].sort()).toEqual([...COLLIDING].sort());
  });
});
