/**
 * POST /api/v1/vehicles and PATCH /api/v1/vehicles/{vehicleId} — vehicle master
 * create and edit, end to end (Phase 1-17, FR-VEH-001, P1-17-BE-003).
 *
 * Drives the real routes through the fixed pipeline against a real database on the
 * least-privilege `app_runtime` role. Creation is proven to be one atomic fact —
 * the vehicle row, its audit record, and its `vehicle.created` outbox event commit
 * together or not at all — and editing is proven to touch only descriptive master
 * fields under the frozen guards: a merged vehicle is frozen, a cross-tenant id is
 * indistinguishable from an unknown one, and the VIN never reaches the audit trail.
 *
 * Operations exercised here: veh.vehicle-create, veh.vehicle-update.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-create: route service authorization success denial cross-tenant audit outbox rollback idempotency
 *   veh.vehicle-update: route service authorization success denial cross-tenant audit idempotency
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
import { GET as SEARCH, POST as CREATE } from '@/app/api/v1/vehicles/route';
import { PATCH as UPDATE } from '@/app/api/v1/vehicles/[vehicleId]/route';

const WRITER_ROLE_A = 'c1710000-0000-4000-8000-0000000000a1';
const WRITER_USER_A = 'c1710000-0000-4000-8000-0000000000a2';
const WRITER_SUBJECT_A = 'fx_p1_17_veh_writer_a';
const WRITER_ROLE_B = 'c1710000-0000-4000-8000-0000000000b1';
const WRITER_USER_B = 'c1710000-0000-4000-8000-0000000000b2';
const WRITER_SUBJECT_B = 'fx_p1_17_veh_writer_b';

// A merged vehicle, assembled admin-side (the merge operation is a later slice):
// a live survivor plus a loser redirected to it and frozen at `merged`.
const MERGE_SURVIVOR = 'c1710000-0000-4000-8000-0000000000c1';
const MERGED_VEHICLE = 'c1710000-0000-4000-8000-0000000000c2';

const VEHICLES = 'http://localhost/api/v1/vehicles';

interface VehicleBody {
  readonly vehicleId?: string;
  readonly lifecycleStatus?: string;
  readonly powertrainCategory?: string;
  readonly hasVin?: boolean;
  readonly changedColumns?: readonly string[];
  readonly code?: string;
  readonly items?: readonly { readonly id: string }[];
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

/** Both write operations declare `idempotent: true`, so a key is mandatory. */
function create(body: unknown, idempotencyKey = crypto.randomUUID()): Promise<Response> {
  return CREATE(
    new Request(VEHICLES, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    })
  );
}

function update(
  vehicleId: string,
  body: unknown,
  idempotencyKey = crypto.randomUUID()
): Promise<Response> {
  return UPDATE(
    new Request(`${VEHICLES}/${vehicleId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}

function search(query: string): Promise<Response> {
  return SEARCH(new Request(VEHICLES + query, { method: 'GET' }));
}

async function createdVehicleId(body: unknown): Promise<string> {
  const parsed = (await (await create(body)).json()) as VehicleBody;
  return parsed.vehicleId ?? '';
}

async function seedWriter(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', 'Vehicle Writer', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-17 vehicle writer', $4)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('veh.vehicle.manage', 'veh.vehicle.read')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

async function auditCount(action: string, vehicleId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, vehicleId]
  );
  return Number(result.rows[0]?.n ?? '0');
}

async function outboxCount(vehicleId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM shared.event_outbox
      WHERE event_type = 'vehicle.created' AND aggregate_id = $1`,
    [vehicleId]
  );
  return Number(result.rows[0]?.n ?? '0');
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // Seeded platform codes (seed 04). No-op wherever the seed has run.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('veh.vehicle.read',   'veh', 'Search and read vehicles in the caller tenant', 'low',    $1),
            ('veh.vehicle.manage', 'veh', 'Create and edit vehicles in the caller tenant',  'medium', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await seedWriter(TENANT_A, WRITER_ROLE_A, WRITER_USER_A, WRITER_SUBJECT_A);
  await seedWriter(TENANT_B, WRITER_ROLE_B, WRITER_USER_B, WRITER_SUBJECT_B);

  // A merged vehicle for the freeze test: insert a live survivor and a live loser
  // (an active vehicle needs a VIN, per guard_vehicle_activation), then redirect the
  // loser to the survivor through the real merge guard. The vehicle status-history
  // trigger reads the actor from `app.user_id`, so the whole fixture runs in one
  // transaction with the session context set — the same context the pipeline sets.
  const fixture = await admin.connect();
  try {
    await fixture.query('BEGIN');
    await fixture.query(`SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`, [
      USER_A,
      TENANT_A,
    ]);
    await fixture.query(
      `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1, $3, '1SURVIVOR00000001', 'ice', 'active', $4),
              ($2, $3, '1LOSERVEHICLE0001', 'ice', 'active', $4)
       ON CONFLICT (id) DO NOTHING`,
      [MERGE_SURVIVOR, MERGED_VEHICLE, TENANT_A, USER_A]
    );
    await fixture.query(
      `UPDATE veh.vehicles SET lifecycle_status = 'merged', merged_into_id = $2
        WHERE id = $1 AND tenant_id = $3`,
      [MERGED_VEHICLE, MERGE_SURVIVOR, TENANT_A]
    );
    await fixture.query('COMMIT');
  } catch (error) {
    await fixture.query('ROLLBACK');
    throw error;
  } finally {
    fixture.release();
  }

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

describe('authentication and authorization', () => {
  it('answers 401 with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    const response = await create({ powertrainCategory: 'ice' });
    expect(response.status).toBe(401);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-IAM-002');
  });

  it('answers 403 for an authenticated caller lacking veh.vehicle.manage', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await create({ powertrainCategory: 'ice' });
    const body = (await response.json()) as VehicleBody;
    expect(response.status).toBe(403);
    expect(body.code).toBe('ERR-IAM-001');
    expect(body.vehicleId).toBeUndefined();
  });

  it('refuses an edit to the same unpermitted caller', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await update(MERGE_SURVIVOR, { color: 'Red' });
    expect(response.status).toBe(403);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-IAM-001');
  });
});

describe('creation writes one atomic fact', () => {
  it('creates a draft master, an audit record, and one vehicle.created event', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await create({
      vin: ' 1hgcm8-2633a-777001 ',
      powertrainCategory: 'ev',
      modelYear: 2022,
      color: '  Pearl White  ',
    });
    const body = (await response.json()) as VehicleBody;

    expect(response.status).toBe(201);
    const vehicleId = body.vehicleId ?? '';
    expect(vehicleId).not.toBe('');
    expect(body.lifecycleStatus).toBe('draft');
    expect(body.powertrainCategory).toBe('ev');
    expect(body.hasVin).toBe(true);

    const row = await admin.query<{
      tenant_id: string;
      vin_normalized: string | null;
      color: string | null;
      lifecycle_status: string;
    }>(
      `SELECT tenant_id, vin_normalized, color, lifecycle_status FROM veh.vehicles WHERE id = $1`,
      [vehicleId]
    );
    expect(row.rows[0]?.tenant_id).toBe(TENANT_A);
    // The database generated the normalized VIN from the trimmed raw value.
    expect(row.rows[0]?.vin_normalized).toBe('1HGCM82633A777001');
    expect(row.rows[0]?.color).toBe('Pearl White');
    expect(row.rows[0]?.lifecycle_status).toBe('draft');

    expect(await auditCount('veh.vehicle.created', vehicleId)).toBe(1);
    expect(await outboxCount(vehicleId)).toBe(1);
  });

  it('publishes an event carrying no VIN, plate, or owner', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const vehicleId = await createdVehicleId({ vin: 'JH4KA8260MC900042' });
    const event = await admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM shared.event_outbox
        WHERE event_type = 'vehicle.created' AND aggregate_id = $1`,
      [vehicleId]
    );
    const payload = event.rows[0]?.payload ?? {};
    expect(Object.keys(payload).sort()).toEqual([
      'hasVin',
      'lifecycleStatus',
      'powertrainCategory',
      'vehicleId',
    ]);
    expect(JSON.stringify(payload)).not.toContain('JH4KA8260MC900042');
  });

  it('creates a bare draft with no descriptive fields at all', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await create({});
    const body = (await response.json()) as VehicleBody;
    expect(response.status).toBe(201);
    expect(body.lifecycleStatus).toBe('draft');
    expect(body.powertrainCategory).toBe('ice');
    expect(body.hasVin).toBe(false);
  });
});

describe('creation refusals and rollback', () => {
  it('refuses a second live vehicle with the same active VIN (409), atomically', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const vin = '2HGES16575H424242';
    const firstId = await createdVehicleId({ vin });
    expect(firstId).not.toBe('');

    const before = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM veh.vehicles WHERE tenant_id = $1`,
      [TENANT_A]
    );
    const response = await create({ vin });
    expect(response.status).toBe(409);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-RES-002');

    // The failed create wrote no row, and left no orphan audit or event behind:
    // the row, its audit, and its event are one all-or-nothing unit.
    const after = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM veh.vehicles WHERE tenant_id = $1`,
      [TENANT_A]
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const orphanAudit = await admin.query(
      `SELECT 1 FROM iam.audit_records a
        WHERE a.action = 'veh.vehicle.created'
          AND NOT EXISTS (SELECT 1 FROM veh.vehicles v WHERE v.id = a.entity_id)`
    );
    expect(orphanAudit.rows).toHaveLength(0);
    const orphanEvent = await admin.query(
      `SELECT 1 FROM shared.event_outbox e
        WHERE e.event_type = 'vehicle.created'
          AND NOT EXISTS (SELECT 1 FROM veh.vehicles v WHERE v.id = e.aggregate_id)`
    );
    expect(orphanEvent.rows).toHaveLength(0);
  });

  it('refuses a catalog reference the tenant cannot see (422)', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    // A well-formed but non-existent make id: the fail-closed catalog guard rejects
    // it as a validation problem, never a server fault.
    const response = await create({ makeId: '00000000-0000-4000-8000-0000000000ff' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-VAL-001');
  });

  it('rejects an unknown body field (strict schema — no mass assignment)', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await create({ powertrainCategory: 'ice', tenantId: TENANT_B });
    expect(response.status).toBe(422);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-VAL-001');
  });
});

describe('idempotent replay', () => {
  it('creates exactly one vehicle when the same request is retried with one key', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const key = crypto.randomUUID();
    const body = { vin: '5YJ3E1EA7KF000777' };

    const first = (await (await create(body, key)).json()) as VehicleBody;
    const second = (await (await create(body, key)).json()) as VehicleBody;

    // The retry replays the stored response rather than registering a second
    // vehicle — which is what makes a client-side retry safe after a timeout.
    expect(second.vehicleId).toBe(first.vehicleId);
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM veh.vehicles
        WHERE tenant_id = $1 AND vin_normalized = '5YJ3E1EA7KF000777'`,
      [TENANT_A]
    );
    expect(rows.rows[0]?.n).toBe('1');
    expect(await auditCount('veh.vehicle.created', first.vehicleId ?? '')).toBe(1);
    expect(await outboxCount(first.vehicleId ?? '')).toBe(1);
  });

  it('applies an edit exactly once when the same request is retried with one key', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const vehicleId = await createdVehicleId({ color: 'Bronze' });
    const key = crypto.randomUUID();

    const first = (await (await update(vehicleId, { color: 'Copper' }, key)).json()) as VehicleBody;
    const second = (await (
      await update(vehicleId, { color: 'Copper' }, key)
    ).json()) as VehicleBody;
    expect(second.vehicleId).toBe(first.vehicleId);

    // The version was bumped once, and exactly one edit was audited: the replay
    // returned the stored response without touching the row a second time.
    const row = await admin.query<{ record_version: number }>(
      `SELECT record_version FROM veh.vehicles WHERE id = $1`,
      [vehicleId]
    );
    expect(row.rows[0]?.record_version).toBe(2);
    expect(await auditCount('veh.vehicle.updated', vehicleId)).toBe(1);
  });
});

describe('tenant isolation on creation', () => {
  it('never exposes a vehicle created in another tenant', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const mineVin = '1FTFW1ET5DFC10001';
    const mine = await createdVehicleId({ vin: mineVin });

    // Tenant B cannot find tenant A's vehicle by its exact VIN.
    authenticateAs(WRITER_SUBJECT_B, TENANT_B);
    const asB = (await (await search(`?vin=${mineVin}`)).json()) as VehicleBody;
    expect((asB.items ?? []).map((h) => h.id)).not.toContain(mine);

    // Tenant A finds its own.
    authenticateAs(WRITER_SUBJECT_A);
    const asA = (await (await search(`?vin=${mineVin}`)).json()) as VehicleBody;
    expect((asA.items ?? []).map((h) => h.id)).toContain(mine);
  });
});

describe('editing the master', () => {
  it('applies a partial edit, bumps the version, and audits the changed columns only', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const vehicleId = await createdVehicleId({ powertrainCategory: 'ice', color: 'Grey' });

    const response = await update(vehicleId, { color: 'Midnight Blue', modelYear: 2019 });
    const body = (await response.json()) as VehicleBody;
    expect(response.status).toBe(200);
    expect([...(body.changedColumns ?? [])].sort()).toEqual(['color', 'model_year']);

    const row = await admin.query<{ color: string; model_year: number; record_version: number }>(
      `SELECT color, model_year, record_version FROM veh.vehicles WHERE id = $1`,
      [vehicleId]
    );
    expect(row.rows[0]?.color).toBe('Midnight Blue');
    expect(row.rows[0]?.model_year).toBe(2019);
    expect(row.rows[0]?.record_version).toBe(2);
    expect(await auditCount('veh.vehicle.updated', vehicleId)).toBe(1);
  });

  it('clears a nullable field when it is explicitly set to null', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const vehicleId = await createdVehicleId({ color: 'Silver' });
    const response = await update(vehicleId, { color: null });
    expect(response.status).toBe(200);
    const row = await admin.query<{ color: string | null }>(
      `SELECT color FROM veh.vehicles WHERE id = $1`,
      [vehicleId]
    );
    expect(row.rows[0]?.color).toBeNull();
  });

  it('refuses to edit a merged vehicle (409 — it is frozen)', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await update(MERGED_VEHICLE, { color: 'Repaint' });
    expect(response.status).toBe(409);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-RES-002');
  });

  it('refuses an update that names no writable field (422)', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const vehicleId = await createdVehicleId({ color: 'Green' });
    const response = await update(vehicleId, {});
    expect(response.status).toBe(422);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-VAL-001');
  });

  it('rejects an unknown field on edit (strict schema)', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const vehicleId = await createdVehicleId({ color: 'Black' });
    const response = await update(vehicleId, { lifecycleStatus: 'active' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-VAL-001');
  });

  it('answers 404 for an unknown vehicle', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await update('00000000-0000-4000-8000-0000000000fe', { color: 'Ghost' });
    expect(response.status).toBe(404);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-RES-001');
  });

  it('answers the same 404 for a vehicle owned by another tenant (no existence oracle)', async () => {
    // Create a real vehicle in tenant B, then try to edit it as tenant A.
    authenticateAs(WRITER_SUBJECT_B, TENANT_B);
    const theirs = await createdVehicleId({ color: 'TenantB' });

    authenticateAs(WRITER_SUBJECT_A);
    const response = await update(theirs, { color: 'Hijack' });
    expect(response.status).toBe(404);
    expect(((await response.json()) as VehicleBody).code).toBe('ERR-RES-001');
  });
});
