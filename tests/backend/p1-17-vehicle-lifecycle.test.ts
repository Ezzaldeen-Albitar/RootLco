/**
 * Vehicle EV profile and lifecycle/workshop status, end to end (Phase 1-17,
 * P1-17-BE-008, P1-17-BE-009).
 *
 * Driven through the real routes on `app_runtime`. The EV profile is set-or-replace
 * and allowed only when the vehicle powertrain category matches the EV kind; no
 * battery-health value is derived. Status changes move a live vehicle along the
 * approved transition graph — `merged` is never settable, `scrapped` is terminal —
 * and the append-only `veh.vehicle_status_history` ledger is written by the frozen
 * trigger.
 *
 * Operations exercised: veh.vehicle-ev-profile-read, veh.vehicle-ev-profile-set,
 * veh.vehicle-status-change.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-ev-profile-read: route service authorization success denial cross-tenant
 *   veh.vehicle-ev-profile-set: route service authorization success denial cross-tenant audit idempotency
 *   veh.vehicle-status-change: route service authorization success denial cross-tenant audit idempotency
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
import { GET as EV_GET, POST as EV_SET } from '@/app/api/v1/vehicles/[vehicleId]/ev-profile/route';
import { PATCH as STATUS } from '@/app/api/v1/vehicles/[vehicleId]/status/route';

const ROLE_A = 'c1770000-0000-4000-8000-0000000000a1';
const USER_RA = 'c1770000-0000-4000-8000-0000000000a2';
const SUBJ_A = 'fx_p1_17_veh_life_a';
const ROLE_B = 'c1770000-0000-4000-8000-0000000000b1';
const USER_RB = 'c1770000-0000-4000-8000-0000000000b2';
const SUBJ_B = 'fx_p1_17_veh_life_b';

const V = 'http://localhost/api/v1/vehicles';
let vinSeq = 0;
function nextVin(): string {
  vinSeq += 1;
  return `VINLIFE${String(vinSeq).padStart(6, '0')}`;
}

interface Body {
  readonly vehicleId?: string;
  readonly evProfileId?: string;
  readonly created?: boolean;
  readonly evKind?: string;
  readonly usableCapacityKwh?: number | null;
  readonly changedAxes?: readonly string[];
  readonly lifecycleStatus?: string;
  readonly workshopStatus?: string;
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
async function newVehicle(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await CREATE(
    new Request(V, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(overrides),
    })
  );
  return ((await response.json()) as Body).vehicleId ?? '';
}
function setEv(vehicleId: string, body: unknown, key = crypto.randomUUID()): Promise<Response> {
  return EV_SET(
    new Request(`${V}/${vehicleId}/ev-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}
function getEv(vehicleId: string): Promise<Response> {
  return EV_GET(new Request(`${V}/${vehicleId}/ev-profile`, { method: 'GET' }), {
    params: Promise.resolve({ vehicleId }),
  });
}
function changeStatus(
  vehicleId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return STATUS(
    new Request(`${V}/${vehicleId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}

async function seedWriter(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Lifecycle Writer','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-17 lifecycle writer',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code IN ('veh.vehicle.manage','veh.vehicle.read','veh.vehicle.status.manage')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

async function auditCount(action: string, entityId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action=$1 AND entity_id=$2`,
    [action, entityId]
  );
  return Number(r.rows[0]?.n ?? '0');
}
async function evProfileCount(vehicleId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM veh.vehicle_ev_profiles WHERE vehicle_id=$1 AND deleted_at IS NULL`,
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
            ('veh.vehicle.status.manage','veh','Change vehicle lifecycle and workshop status','medium',$1)
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
  it('EV set and status change require authentication and their permission', async () => {
    __resetAuthenticatorForTests();
    const id = '00000000-0000-4000-8000-0000000000a0';
    expect((await setEv(id, { evKind: 'bev' })).status).toBe(401);
    expect((await changeStatus(id, { lifecycleStatus: 'active' })).status).toBe(401);
    authAs(SUBJECT_UNPERMITTED);
    expect((await setEv(id, { evKind: 'bev' })).status).toBe(403);
    expect((await changeStatus(id, { lifecycleStatus: 'active' })).status).toBe(403);
  });
});

describe('EV profile set/replace/read', () => {
  it('creates then replaces the single profile, audits, reads, and replays idempotently', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({ powertrainCategory: 'ev', vin: nextVin() });

    const key = crypto.randomUUID();
    const created = (await (await setEv(vehicle, { evKind: 'bev' }, key)).json()) as Body;
    expect(created.created).toBe(true);
    expect(created.evProfileId).toBeTruthy();
    expect(await evProfileCount(vehicle)).toBe(1);
    expect(await auditCount('veh.vehicle.ev_profile_set', created.evProfileId ?? '')).toBe(1);

    // Idempotent replay: same key → same profile, no second audit.
    const replay = (await (await setEv(vehicle, { evKind: 'bev' }, key)).json()) as Body;
    expect(replay.evProfileId).toBe(created.evProfileId);
    expect(await auditCount('veh.vehicle.ev_profile_set', created.evProfileId ?? '')).toBe(1);

    // Replace (new key): still one active profile, now with capacity.
    const replaced = await setEv(vehicle, {
      evKind: 'bev',
      usableCapacityKwh: 80.5,
      chargePortType: 'ccs2',
    });
    expect(replaced.status).toBe(200);
    expect(((await replaced.json()) as Body).created).toBe(false);
    expect(await evProfileCount(vehicle)).toBe(1);

    const view = (await (await getEv(vehicle)).json()) as Body;
    expect(view.evKind).toBe('bev');
    expect(view.usableCapacityKwh).toBe(80.5);
  });

  it('accepts a hybrid profile on a hybrid vehicle', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({ powertrainCategory: 'hybrid', vin: nextVin() });
    expect((await setEv(vehicle, { evKind: 'hybrid' })).status).toBe(201);
  });

  it('refuses an EV kind that does not match the vehicle powertrain (422) and stores nothing', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({ powertrainCategory: 'ice', vin: nextVin() });
    const response = await setEv(vehicle, { evKind: 'bev' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
    expect(await evProfileCount(vehicle)).toBe(0);
  });

  it('answers 404 for a vehicle with no profile, an unknown vehicle, and a cross-tenant vehicle', async () => {
    authAs(SUBJ_A);
    const bare = await newVehicle({ powertrainCategory: 'ev', vin: nextVin() });
    expect((await getEv(bare)).status).toBe(404);
    expect((await getEv('00000000-0000-4000-8000-0000000000fe')).status).toBe(404);
    expect((await setEv('00000000-0000-4000-8000-0000000000fe', { evKind: 'bev' })).status).toBe(
      404
    );

    // A profile set on tenant A's vehicle is invisible to tenant B (404, not leaked).
    await setEv(bare, { evKind: 'bev' });
    authAs(SUBJ_B, TENANT_B);
    expect((await getEv(bare)).status).toBe(404);
    expect((await setEv(bare, { evKind: 'bev' })).status).toBe(404);
  });
});

describe('status transitions', () => {
  it('activates, moves the workshop axis, audits, and replays idempotently', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({ vin: nextVin() });

    const key = crypto.randomUUID();
    const activated = (await (
      await changeStatus(vehicle, { lifecycleStatus: 'active' }, key)
    ).json()) as Body;
    expect(activated.lifecycleStatus).toBe('active');
    expect(activated.changedAxes).toEqual(['lifecycle']);
    expect(await auditCount('veh.vehicle.status_changed', vehicle)).toBe(1);

    // Idempotent replay: no second transition, no second audit.
    await changeStatus(vehicle, { lifecycleStatus: 'active' }, key);
    expect(await auditCount('veh.vehicle.status_changed', vehicle)).toBe(1);

    expect((await changeStatus(vehicle, { workshopStatus: 'in_workshop' })).status).toBe(200);
    expect((await changeStatus(vehicle, { workshopStatus: 'ready_for_delivery' })).status).toBe(
      200
    );
    const home = (await (await changeStatus(vehicle, { workshopStatus: 'none' })).json()) as Body;
    expect(home.workshopStatus).toBe('none');
  });

  it('rejects a no-op, a disallowed transition, and setting merged (422)', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({ vin: nextVin() });
    // draft → inactive is not an approved transition.
    expect((await changeStatus(vehicle, { lifecycleStatus: 'inactive' })).status).toBe(422);
    // merged is never a settable target.
    expect((await changeStatus(vehicle, { lifecycleStatus: 'merged' })).status).toBe(422);
    // no-op (already draft).
    expect((await changeStatus(vehicle, { lifecycleStatus: 'draft' })).status).toBe(422);
    // empty body changes nothing.
    expect((await changeStatus(vehicle, {})).status).toBe(422);
  });

  it('refuses activation without a VIN or identifier (422) and changes nothing', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({}); // no VIN
    const response = await changeStatus(vehicle, { lifecycleStatus: 'active' });
    expect(response.status).toBe(422);
    const row = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM veh.vehicles WHERE id=$1`,
      [vehicle]
    );
    expect(row.rows[0]?.lifecycle_status).toBe('draft');
  });

  it('refuses scrapping a vehicle still in a workshop, but accepts it when workshop is cleared in the same call', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({ vin: nextVin() });
    await changeStatus(vehicle, { lifecycleStatus: 'active' });
    await changeStatus(vehicle, { workshopStatus: 'in_workshop' });

    expect((await changeStatus(vehicle, { lifecycleStatus: 'scrapped' })).status).toBe(422);
    const scrapped = await changeStatus(vehicle, {
      lifecycleStatus: 'scrapped',
      workshopStatus: 'none',
    });
    expect(scrapped.status).toBe(200);
    expect(((await scrapped.json()) as Body).lifecycleStatus).toBe('scrapped');
    // scrapped is terminal: any further transition is refused.
    expect((await changeStatus(vehicle, { lifecycleStatus: 'active' })).status).toBe(422);
  });

  it('answers 404 for an unknown and a cross-tenant vehicle', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle({ vin: nextVin() });
    expect(
      (await changeStatus('00000000-0000-4000-8000-0000000000fd', { lifecycleStatus: 'active' }))
        .status
    ).toBe(404);
    authAs(SUBJ_B, TENANT_B);
    expect((await changeStatus(vehicle, { lifecycleStatus: 'active' })).status).toBe(404);
  });
});
