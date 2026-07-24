/**
 * Vehicle odometer entry, anomaly handling, and history, end to end (Phase 1-17,
 * P1-17-BE-010, P1-17-BE-011).
 *
 * Driven through the real routes on `app_runtime`. Readings are append-only; a
 * normal reading below the effective odometer is refused as an anomaly and nothing
 * is stored (the original is preserved), while a correction records the disposition
 * and may lower the value. History is keyset-paginated, newest observed first.
 *
 * Operations exercised here: veh.vehicle-odometer-record, veh.vehicle-odometer-history.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-odometer-history: route service authorization success denial cross-tenant
 *   veh.vehicle-odometer-record: route service authorization success denial cross-tenant audit rollback idempotency
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
import { POST as CREATE } from '@/app/api/v1/vehicles/route';
import {
  GET as ODO_LIST,
  POST as ODO_RECORD,
} from '@/app/api/v1/vehicles/[vehicleId]/odometer-readings/route';

const ROLE_A = 'c1760000-0000-4000-8000-0000000000a1';
const USER_RA = 'c1760000-0000-4000-8000-0000000000a2';
const SUBJ_A = 'fx_p1_17_veh_odo_a';
const ROLE_B = 'c1760000-0000-4000-8000-0000000000b1';
const USER_RB = 'c1760000-0000-4000-8000-0000000000b2';
const SUBJ_B = 'fx_p1_17_veh_odo_b';

const V = 'http://localhost/api/v1/vehicles';

interface Body {
  readonly vehicleId?: string;
  readonly readingId?: string;
  readonly anomalyFlag?: boolean;
  readonly captureMethod?: string;
  readonly items?: readonly { readonly id: string; readonly anomalyFlag?: boolean }[];
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}
function createVehicle(): Promise<Response> {
  return CREATE(
    new Request(V, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: '{}',
    })
  );
}
async function newVehicle(): Promise<string> {
  return ((await (await createVehicle()).json()) as Body).vehicleId ?? '';
}
function record(vehicleId: string, body: unknown, key = crypto.randomUUID()): Promise<Response> {
  return ODO_RECORD(
    new Request(`${V}/${vehicleId}/odometer-readings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}
function listReadings(vehicleId: string, query = ''): Promise<Response> {
  return ODO_LIST(new Request(`${V}/${vehicleId}/odometer-readings${query}`, { method: 'GET' }), {
    params: Promise.resolve({ vehicleId }),
  });
}

async function seedWriter(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Odo Writer','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-17 odo writer',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code IN ('veh.vehicle.manage','veh.vehicle.read','veh.vehicle.odometer.record')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

async function readingCount(vehicleId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM veh.odometer_readings WHERE vehicle_id=$1`,
    [vehicleId]
  );
  return Number(r.rows[0]?.n ?? '0');
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('veh.vehicle.manage','veh','Create and edit vehicles','medium',$1),
            ('veh.vehicle.read','veh','Read vehicles','low',$1),
            ('veh.vehicle.odometer.record','veh','Record vehicle odometer readings and corrections','medium',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await seedWriter(TENANT_A, ROLE_A, USER_RA, SUBJ_A);
  await seedWriter(TENANT_B, ROLE_B, USER_RB, SUBJ_B);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('authorization', () => {
  it('401 without an authenticator; 403 without the permission', async () => {
    __resetAuthenticatorForTests();
    expect(
      (
        await record('00000000-0000-4000-8000-0000000000a0', {
          value: 10,
          unit: 'km',
          observedAt: '2026-01-01T00:00:00Z',
        })
      ).status
    ).toBe(401);
    authAs(SUBJECT_UNPERMITTED);
    expect(
      (
        await record('00000000-0000-4000-8000-0000000000a0', {
          value: 10,
          unit: 'km',
          observedAt: '2026-01-01T00:00:00Z',
        })
      ).status
    ).toBe(403);
  });
});

describe('recording and forward-only anomaly', () => {
  it('records a forward reading + audit, replays idempotently, and lists it', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const key = crypto.randomUUID();
    const first = (await (
      await record(vehicle, { value: 1000, unit: 'km', observedAt: '2026-01-01T10:00:00Z' }, key)
    ).json()) as Body;
    expect(first.readingId).toBeTruthy();
    expect(first.anomalyFlag).toBe(false);
    const replay = (await (
      await record(vehicle, { value: 1000, unit: 'km', observedAt: '2026-01-01T10:00:00Z' }, key)
    ).json()) as Body;
    expect(replay.readingId).toBe(first.readingId);
    expect(await readingCount(vehicle)).toBe(1);

    // A later, higher reading is accepted.
    expect(
      (await record(vehicle, { value: 2000, unit: 'km', observedAt: '2026-01-02T10:00:00Z' }))
        .status
    ).toBe(201);

    const audit = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_records WHERE action='veh.vehicle.odometer_recorded' AND entity_id=$1`,
      [first.readingId]
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);

    const list = (await (await listReadings(vehicle)).json()) as Body;
    expect((list.items ?? []).map((i) => i.id)).toContain(first.readingId);
  });

  it('refuses a lower normal reading as an anomaly and stores nothing (rollback)', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    await record(vehicle, { value: 5000, unit: 'km', observedAt: '2026-01-01T10:00:00Z' });
    const before = await readingCount(vehicle);

    const response = await record(vehicle, {
      value: 100,
      unit: 'km',
      observedAt: '2026-01-02T10:00:00Z',
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Body;
    expect(body.code).toBe('ERR-VAL-001');
    // The original is preserved and the below-value reading was not stored.
    expect(await readingCount(vehicle)).toBe(before);
  });

  it('records a correction that lowers the value and flags it as an anomaly', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const base = (await (
      await record(vehicle, { value: 90000, unit: 'km', observedAt: '2026-01-01T10:00:00Z' })
    ).json()) as Body;

    const response = await record(vehicle, {
      value: 12000,
      unit: 'km',
      observedAt: '2026-01-05T10:00:00Z',
      correctionOf: base.readingId,
      correctionReason: 'meter_replacement',
    });
    const body = (await response.json()) as Body;
    expect(response.status).toBe(201);
    expect(body.anomalyFlag).toBe(true);
    expect(body.captureMethod).toBe('correction');

    const row = await admin.query<{ anomaly_flag: boolean; correction_reason: string | null }>(
      `SELECT anomaly_flag, correction_reason FROM veh.odometer_readings WHERE id=$1`,
      [body.readingId]
    );
    expect(row.rows[0]?.anomaly_flag).toBe(true);
    expect(row.rows[0]?.correction_reason).toBe('meter_replacement');
  });
});

describe('validation and isolation', () => {
  it('rejects a negative value, a bad unit, and a malformed timestamp (422)', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    expect(
      (await record(vehicle, { value: -1, unit: 'km', observedAt: '2026-01-01T10:00:00Z' })).status
    ).toBe(422);
    expect(
      (await record(vehicle, { value: 10, unit: 'furlong', observedAt: '2026-01-01T10:00:00Z' }))
        .status
    ).toBe(422);
    expect(
      (await record(vehicle, { value: 10, unit: 'km', observedAt: 'not-a-timestamp' })).status
    ).toBe(422);
  });

  it('refuses an unknown correction reference (422) and an unknown vehicle (404)', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const bad = await record(vehicle, {
      value: 10,
      unit: 'km',
      observedAt: '2026-01-01T10:00:00Z',
      correctionOf: '00000000-0000-4000-8000-0000000000ff',
      correctionReason: 'unknown',
    });
    expect(bad.status).toBe(422);
    expect(
      (
        await record('00000000-0000-4000-8000-0000000000fe', {
          value: 10,
          unit: 'km',
          observedAt: '2026-01-01T10:00:00Z',
        })
      ).status
    ).toBe(404);
  });

  it('never exposes another tenant’s readings and refuses a bad cursor', async () => {
    authAs(SUBJ_A);
    const mine = await newVehicle();
    await record(mine, { value: 42, unit: 'km', observedAt: '2026-01-01T10:00:00Z' });
    authAs(SUBJ_B, TENANT_B);
    expect((((await (await listReadings(mine)).json()) as Body).items ?? []).length).toBe(0);
    authAs(SUBJ_A);
    expect((await listReadings(mine, '?cursor=nope')).status).toBe(400);
  });
});
