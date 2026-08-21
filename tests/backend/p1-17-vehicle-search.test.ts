/**
 * GET /api/v1/vehicles — vehicle search, end to end (Phase 1-17, FR-VEH-001,
 * NFR-PRV-001).
 *
 * Drives the real route through the fixed pipeline against a real database on the
 * least-privilege `app_runtime` role: correlation → authenticate → resolve
 * context → transaction → authorize → handler → response. It proves the search is
 * bounded, privacy-safe, tenant-isolated, matches on the normalized VIN and the
 * active plate, and cannot be turned into a wildcard scan or an enumeration oracle.
 *
 * Operations exercised here: veh.vehicle-search.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-search: route service authorization success denial cross-tenant
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
import { GET } from '@/app/api/v1/vehicles/route';

const VEH_READER_ROLE = 'c1700000-0000-4000-8000-0000000000a1';
const VEH_READER_USER = 'c1700000-0000-4000-8000-0000000000a2';
const VEH_READER_SUBJECT = 'fx_p1_17_veh_reader';
const VEHICLE_A = 'c1700000-0000-4000-8000-0000000000b1';
const VEHICLE_B = 'c1700000-0000-4000-8000-0000000000b2';
const VIN_A = '1HGCM82633A004352';
const PLATE_A = 'ABC123';

const BASE = 'http://localhost/api/v1/vehicles';
/**
 * The closed safe master projection, asserted EXACTLY.
 *
 * The exact-match assertion is the point: it fails when a field is added as
 * readily as when one is removed, so a restricted identifier cannot arrive here
 * unnoticed. That is why `mergedIntoId` below is a deliberate edit rather than a
 * silently absorbed one — the test caught the addition on the first run.
 *
 * `mergedIntoId` is safe by the same reasoning as every other key: it is a
 * vehicle id in the caller's own tenant, already returned by the detail read,
 * and carries no personal data. It is published because search **returns**
 * merged vehicles, and without it a result row is indistinguishable from a live
 * one until a write answers 409 (`P1-27-INT-008`).
 */
const SAFE_KEYS = [
  'id',
  'displayNumber',
  'vin',
  'makeId',
  'modelId',
  'modelYear',
  'powertrainCategory',
  'lifecycleStatus',
  'workshopStatus',
  'createdAt',
  'mergedIntoId',
];

interface Hit {
  readonly id: string;
  readonly vin: string | null;
  readonly powertrainCategory: string;
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

/**
 * The ids a search returned, asserting the 200 on the way through. Used where the
 * question is *which* vehicles came back rather than whether the read was allowed.
 */
async function searchIds(queryString = ''): Promise<readonly string[]> {
  const response = await search(queryString);
  const body = (await response.json()) as SearchBody;
  expect(response.status).toBe(200);
  return (body.items ?? []).map((h) => h.id);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // veh.vehicle.read is a seeded platform code (seed 04). Inserting it is a no-op
  // where the seed has run (CI, clean room); it keeps this suite runnable against a
  // dev database whose seeds predate the code.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('veh.vehicle.read', 'veh', 'Search and read vehicles in the caller tenant', 'low', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'veh-reader@example.test', 'Vehicle Reader', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [VEH_READER_USER, TENANT_A, IDENTITY_PROVIDER, VEH_READER_SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_17_veh_reader', 'P1-17 vehicle reader', $3)
     ON CONFLICT (id) DO NOTHING`,
    [VEH_READER_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p WHERE p.permission_code = 'veh.vehicle.read'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, VEH_READER_ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, VEH_READER_USER, VEH_READER_ROLE, USER_A]
  );
  // One vehicle in tenant A to find, one in tenant B as a cross-tenant decoy.
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1, $2, $5, 'ice', 'active', $6),
            ($3, $4, '2HGES16575H500001', 'ev', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [VEHICLE_A, TENANT_A, VEHICLE_B, TENANT_B, VIN_A, USER_A]
  );
  // The tenant-A vehicle's active plate, for the plate-match path.
  await admin.query(
    `INSERT INTO veh.plate_history (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
     VALUES ($1, $2, 'JO', $3, current_date, $4)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, VEHICLE_A, PLATE_A, USER_A]
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

  it('answers 403 for an authenticated caller lacking veh.vehicle.read', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await search();
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(403);
    expect(body.code).toBe('ERR-IAM-001');
    expect(body.items).toBeUndefined();
  });
});

describe('bounded, privacy-safe search', () => {
  it('returns the tenant vehicle and never a cross-tenant row, with safe fields only', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const response = await search();
    const body = (await response.json()) as SearchBody;

    expect(response.status).toBe(200);
    const ids = (body.items ?? []).map((h) => h.id);
    expect(ids).toContain(VEHICLE_A);
    // A real tenant-B vehicle exists but is unreachable from tenant A.
    expect(ids).not.toContain(VEHICLE_B);

    const hit = (body.items ?? []).find((h) => h.id === VEHICLE_A);
    expect(hit?.vin).toBe(VIN_A);
    expect(hit?.powertrainCategory).toBe('ice');
    // The projection is the closed safe master view — no restricted identifier.
    expect(Object.keys(hit ?? {}).sort()).toEqual([...SAFE_KEYS].sort());
  });

  it('matches an exact normalized VIN (case- and separator-insensitive)', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const response = await search('?vin=1hgcm8-2633a0043 52');
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(200);
    expect((body.items ?? []).map((h) => h.id)).toEqual([VEHICLE_A]);
  });

  it('matches the active plate through the frozen plate normalization', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const response = await search('?plate=abc-123');
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(200);
    expect((body.items ?? []).map((h) => h.id)).toContain(VEHICLE_A);
  });

  it('treats a wildcard VIN as a literal — a "%" fragment matches nothing, never everything', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const response = await search('?vin=%25'); // URL-encoded '%'
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(200);
    // '%' normalizes to null (no [A-Z0-9]); a supplied-but-empty VIN matches none.
    expect((body.items ?? []).length).toBe(0);
  });

  it('bounds page size: the platform maximum is accepted and an oversized page is refused', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const ok = await search('?limit=100');
    expect(ok.status).toBe(200);
    expect((((await ok.json()) as SearchBody).items ?? []).length).toBeLessThanOrEqual(100);

    const tooBig = await search('?limit=100000');
    const body = (await tooBig.json()) as SearchBody;
    expect(tooBig.status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });
});

/**
 * A whitespace-only filter reaches the domain: the route validates with
 * `z.string().min(1)` and neither the schema nor `searchParamsToObject` trims, so
 * `%20` is a one-character string that passes. If the domain then collapsed it to
 * "no filter", the caller would get the first page of every vehicle in the tenant —
 * a wrong answer indistinguishable from a lookup that matched everything. Each test
 * below first proves, with the same caller in the same moment, that an unfiltered
 * search does return a vehicle; the empty page that follows is therefore the filter
 * matching nothing, not an empty tenant.
 */
describe('a supplied-but-blank filter matches nothing, never everything', () => {
  const BLANK = '%20'; // URL-encoded single space

  it('returns an empty page for a whitespace-only vin', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    expect(await searchIds()).toContain(VEHICLE_A);
    expect(await searchIds(`?vin=${BLANK}`)).toEqual([]);
  });

  it('returns an empty page for a whitespace-only plate', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    expect(await searchIds()).toContain(VEHICLE_A);
    // VEHICLE_A holds an active plate, so the plate arm is reachable and would have
    // returned it for a real fragment ('?plate=abc-123' above).
    expect(await searchIds(`?plate=${BLANK}`)).toEqual([]);
  });

  it('returns an empty page for a whitespace-only vehicleNumber', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    expect(await searchIds()).toContain(VEHICLE_A);
    expect(await searchIds(`?vehicleNumber=${BLANK}`)).toEqual([]);
  });

  it('leaves a blank filter combined with a matching discriminator empty too', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    // 'ice' alone matches VEHICLE_A, so the empty result is the blank plate closing
    // the door — a dropped filter would have let the discriminator answer alone.
    expect(await searchIds('?powertrainCategory=ice')).toContain(VEHICLE_A);
    expect(await searchIds(`?powertrainCategory=ice&plate=${BLANK}`)).toEqual([]);
  });
});

describe('validation refusals', () => {
  it('rejects an over-long VIN fragment with ERR-VAL-001', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const response = await search(`?vin=${'A'.repeat(200)}`);
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });

  it('rejects a malformed cursor with ERR-PAG-001 (no ordering-vocabulary oracle)', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const response = await search('?cursor=not-a-real-cursor');
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(400);
    expect(body.code).toBe('ERR-PAG-001');
  });

  it('rejects an unknown query parameter (strict schema — no mass filtering)', async () => {
    authenticateAs(VEH_READER_SUBJECT);
    const response = await search('?chassisNumber=123456');
    const body = (await response.json()) as SearchBody;
    expect(response.status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });
});
