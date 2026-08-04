/**
 * GET /api/v1/vehicles/{vehicleId} — the vehicle detail read, end to end
 * (Phase 1-17 remediation, `P1-27-INT-002`).
 *
 * The route module exported PATCH and nothing else. Search returned a page of
 * hits, seven sub-resources returned their own lists, and no operation anywhere
 * returned one vehicle — so a profile screen could reach a vehicle's plates and
 * never learn its make.
 *
 * Three claims this suite exists to hold:
 *
 *  1. **The projection stays safe.** `domain/vehicle-search.ts` states under
 *     NFR-PRV-001 that restricted identifiers are never projected by the vehicle
 *     read contract. The assertion here is on the response's KEY SET, not on a
 *     hand-picked field, so a later projection that widens fails rather than
 *     passing because nobody thought to check the new column.
 *  2. **A merged vehicle is returned, not hidden.** Deliberately unlike the CRM
 *     customer read. The PATCH treats a merged vehicle as existing-but-frozen
 *     (409, not 404), so a read that answered 404 would report a vehicle live
 *     work orders still reference as missing.
 *  3. **Catalog labels come from a visible catalog.** A make the caller cannot
 *     see yields a null name beside a non-null id — the vehicle does reference
 *     something, and this caller may not read it.
 *
 * Operations exercised here: veh.vehicle-read.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-read: route service authorization success denial cross-tenant
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
import {
  GET as READ_VEHICLE,
  VEHICLE_READ_OPERATION,
} from '@/app/api/v1/vehicles/[vehicleId]/route';

const READER_ROLE = 'c1700000-0000-4000-8000-0000000000d1';
const READER_USER = 'c1700000-0000-4000-8000-0000000000d2';
const READER_SUBJECT = 'fx_p1_17_veh_detail_reader';

const VEHICLE = 'c1700000-0000-4000-8000-0000000000e1';
const MERGED = 'c1700000-0000-4000-8000-0000000000e2';
const SURVIVOR = 'c1700000-0000-4000-8000-0000000000e3';
const OTHER_TENANT = 'c1700000-0000-4000-8000-0000000000e4';
const DELETED = 'c1700000-0000-4000-8000-0000000000e5';
const UNKNOWN = 'c1700000-0000-4000-8000-0000000000ff';

const MAKE_VISIBLE = 'c1700000-0000-4000-8000-00000000f001';
const MODEL_VISIBLE = 'c1700000-0000-4000-8000-00000000f002';
const MAKE_OTHER_TENANT = 'c1700000-0000-4000-8000-00000000f003';

const VIN = '1HGCM82633A004352';

/**
 * The complete key set the detail read is contracted to return.
 *
 * Compared as a SET, both directions. A missing key breaks a screen; an extra
 * key is how a restricted column reaches a client that was never supposed to see
 * one, and the only assertion that catches that is one nobody has to remember to
 * update.
 */
const CONTRACT_KEYS = [
  'id',
  'displayNumber',
  'vin',
  'makeId',
  'makeName',
  'modelId',
  'modelName',
  'trimId',
  'trimName',
  'bodyTypeId',
  'bodyTypeName',
  'powertrainTypeId',
  'powertrainTypeName',
  'modelYear',
  'powertrainCategory',
  'color',
  'lifecycleStatus',
  'workshopStatus',
  'mergedIntoId',
  'recordVersion',
  'createdAt',
  'updatedAt',
].sort();

interface VehicleBody {
  readonly id?: string;
  readonly vin?: string | null;
  readonly makeId?: string | null;
  readonly makeName?: string | null;
  readonly modelName?: string | null;
  readonly color?: string | null;
  readonly lifecycleStatus?: string;
  readonly mergedIntoId?: string | null;
  readonly recordVersion?: number;
  readonly code?: string;
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

function read(vehicleId: string): Promise<Response> {
  return READ_VEHICLE(
    new Request(`http://localhost/api/v1/vehicles/${vehicleId}`, { method: 'GET' }),
    { params: Promise.resolve({ vehicleId }) }
  );
}

/**
 * Runs fixture statements with an actor in the session, in one transaction.
 *
 * `veh.vehicles` carries triggers that append status and attribute history, and
 * they refuse a row with no `app.user_id` — correctly, because history with no
 * actor is not history. So the fixture supplies one rather than the trigger being
 * worked around, and it must be a REAL `iam.user_accounts` row: `USER_A` is the
 * bootstrap actor id used for `created_by`, not an account.
 */
async function asActor(
  statements: (run: (sql: string, values?: unknown[]) => Promise<unknown>) => Promise<void>
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [READER_USER]);
    await statements((sql, values = []) => client.query(sql, values));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Repoints a vehicle's make, and its model with it.
 *
 * Both columns together because the frozen `veh.vehicles` catalog-coherence guard
 * refuses a model that does not belong to the make — correctly. Goes through
 * `asActor` because the attribute-history trigger fires on these columns and
 * refuses a change with no actor.
 */
function repointCatalog(vehicleId: string, makeId: string, modelId: string | null): Promise<void> {
  return asActor(async (run) => {
    await run(`UPDATE veh.vehicles SET make_id = $2, model_id = $3 WHERE id = $1`, [
      vehicleId,
      makeId,
      modelId,
    ]);
  });
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('veh.vehicle.read', 'veh', 'Search and read vehicles in the caller tenant', 'low', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'veh-detail@example.test', 'Vehicle Detail Reader', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [READER_USER, TENANT_A, IDENTITY_PROVIDER, READER_SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_17_veh_detail', 'P1-17 vehicle detail reader', $3)
     ON CONFLICT (id) DO NOTHING`,
    [READER_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p WHERE p.permission_code = 'veh.vehicle.read'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, READER_ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, READER_USER, READER_ROLE, USER_A]
  );

  // A platform-scoped make and model, visible to every tenant, plus a make owned
  // by tenant B — the one this caller must NOT be able to resolve a name for.
  await admin.query(
    `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by)
     VALUES ($1, 'platform', NULL, 'fx_make_platform', 'Platform Make', $3),
            ($2, 'tenant',   $4,   'fx_make_tenant_b', 'Tenant B Make',  $3)
     ON CONFLICT (id) DO NOTHING`,
    [MAKE_VISIBLE, MAKE_OTHER_TENANT, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO veh.models (id, scope, tenant_id, make_id, code, name, created_by)
     VALUES ($1, 'platform', NULL, $2, 'fx_model_platform', 'Platform Model', $3)
     ON CONFLICT (id) DO NOTHING`,
    [MODEL_VISIBLE, MAKE_VISIBLE, USER_A]
  );

  await asActor(async (run) => {
    await run(
      `INSERT INTO veh.vehicles
         (id, tenant_id, vin_raw, make_id, model_id, model_year, color,
          powertrain_category, lifecycle_status, created_by)
       VALUES ($1, $6, $9,                  $7,   $8,   2021, 'Midnight Blue', 'ice', 'active', $10),
              ($2, $6, '2HGES16575H500002', NULL, NULL, NULL, NULL,            'ev',  'active', $10),
              ($3, $6, '3HGES16575H500003', NULL, NULL, NULL, NULL,            'ev',  'active', $10),
              ($4, $5, '4HGES16575H500004', NULL, NULL, NULL, NULL,            'ice', 'active', $10),
              ($11,$6, '5HGES16575H500005', NULL, NULL, NULL, NULL,            'ice', 'active', $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        VEHICLE,
        MERGED,
        SURVIVOR,
        OTHER_TENANT,
        TENANT_B,
        TENANT_A,
        MAKE_VISIBLE,
        MODEL_VISIBLE,
        VIN,
        USER_A,
        DELETED,
      ]
    );
    await run(
      `UPDATE veh.vehicles SET merged_into_id = $2, lifecycle_status = 'merged' WHERE id = $1`,
      [MERGED, SURVIVOR]
    );
    await run(`UPDATE veh.vehicles SET deleted_at = now() WHERE id = $1`, [DELETED]);
  });

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('the registration itself', () => {
  it('registers veh.vehicle-read as an unaudited tenant read on veh.vehicle.read', () => {
    // Asserted against the registration the runtime actually enforces, not
    // against a comment. Every clause here is a decision somebody could quietly
    // change: widening `permissions`, declaring `idempotent` on a GET (which
    // would make every request without an Idempotency-Key fail 400), or flipping
    // the scope. None of those break a behavioural test that only reads a
    // vehicle back.
    expect(VEHICLE_READ_OPERATION.id).toBe('veh.vehicle-read');
    expect(VEHICLE_READ_OPERATION.method).toBe('GET');
    expect(VEHICLE_READ_OPERATION.permissions).toEqual(['veh.vehicle.read']);
    expect(VEHICLE_READ_OPERATION.scope).toBe('tenant');
    expect(VEHICLE_READ_OPERATION.auditClass).toBe('none');
    expect(VEHICLE_READ_OPERATION.idempotent ?? false).toBe(false);
    expect(VEHICLE_READ_OPERATION.versionGuarded ?? false).toBe(false);
  });
});

describe('authentication and authorization', () => {
  it('answers 401 with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    const response = await read(VEHICLE);
    expect(response.status).toBe(401);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-IAM-002');
  });

  it('answers 403 for a caller lacking veh.vehicle.read', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await read(VEHICLE);
    expect(response.status).toBe(403);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-IAM-001');
  });
});

describe('the vehicle itself', () => {
  it('returns the master record with its catalog labels and the ETag', async () => {
    authenticateAs(READER_SUBJECT);
    const response = await read(VEHICLE);
    const body = (await response.json()) as VehicleBody;

    expect(response.status).toBe(200);
    expect(body.id).toBe(VEHICLE);
    // The generated, normalised VIN — never vin_raw. Search publishes the same
    // column, so the two operations cannot disagree about what "the VIN" is.
    expect(body.vin).toBe(VIN);
    expect(body.makeName).toBe('Platform Make');
    expect(body.modelName).toBe('Platform Model');
    expect(body.color).toBe('Midnight Blue');
    expect(body.mergedIntoId).toBeNull();

    // record_version has always existed and was never published, so the PATCH's
    // If-Match demand had no supply.
    expect(typeof body.recordVersion).toBe('number');
    expect(response.headers.get('ETag')).not.toBeNull();
  });

  it('returns exactly the contracted keys — no more, no fewer', async () => {
    authenticateAs(READER_SUBJECT);
    const body = (await (await read(VEHICLE)).json()) as Record<string, unknown>;
    // Set equality in both directions. A widened projection is how a restricted
    // column reaches a client, and NFR-PRV-001 says the vehicle read contract
    // never projects one. A field-by-field assertion would not catch an addition.
    expect(Object.keys(body).sort()).toEqual(CONTRACT_KEYS);
  });

  it('never projects a restricted identifier column', async () => {
    authenticateAs(READER_SUBJECT);
    const text = await (await read(VEHICLE)).text();
    for (const forbidden of ['vin_raw', 'vinRaw', 'chassis', 'engine_no', 'engineNo']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the parent is resolved under the caller tenant', () => {
  it.each([
    ['a vehicle in another tenant', OTHER_TENANT],
    ['a soft-deleted vehicle', DELETED],
    ['an id that never existed', UNKNOWN],
  ])('answers the same 404 for %s', async (_label, vehicleId) => {
    authenticateAs(READER_SUBJECT);
    const response = await read(vehicleId);
    expect(response.status).toBe(404);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-RES-001');
  });

  it('returns a merged vehicle, pointing at its survivor', async () => {
    authenticateAs(READER_SUBJECT);
    const response = await read(MERGED);
    const body = (await response.json()) as VehicleBody;
    // NOT a 404, and deliberately unlike the CRM customer read. The PATCH treats
    // a merged vehicle as existing-but-frozen (409), so hiding it here would
    // report a vehicle live work orders still reference as missing.
    expect(response.status).toBe(200);
    expect(body.mergedIntoId).toBe(SURVIVOR);
    expect(body.lifecycleStatus).toBe('merged');
  });
});

describe('catalog visibility', () => {
  it('leaves the name null when the catalog row belongs to another tenant', async () => {
    // Point the tenant-A vehicle at a make owned by tenant B. `sel_makes_visible`
    // hides it, and the explicit scope predicate says the same thing, so the join
    // yields no name — while the id stays, because the vehicle really does
    // reference something this caller may not read.
    await repointCatalog(VEHICLE, MAKE_OTHER_TENANT, null);
    try {
      authenticateAs(READER_SUBJECT);
      const body = (await (await read(VEHICLE)).json()) as VehicleBody;
      expect(body.makeId).toBe(MAKE_OTHER_TENANT);
      expect(body.makeName).toBeNull();
    } finally {
      await repointCatalog(VEHICLE, MAKE_VISIBLE, MODEL_VISIBLE);
    }
  });
});
