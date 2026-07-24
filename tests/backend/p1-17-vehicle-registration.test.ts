/**
 * Vehicle plate history + ownership transfer, end to end (Phase 1-17,
 * P1-17-BE-006, P1-17-BE-007, P1-17-BE-016).
 *
 * Drives the real routes through the fixed pipeline on the least-privilege
 * `app_runtime` role. Plate assignment and ownership transfer are each one
 * controlled transaction (close the open interval, open the new one, write audit
 * and — for ownership — the outbox event); the frozen temporal EXCLUDE constraints
 * keep exactly one active plate / registered owner, and an injected failure rolls
 * the whole thing back leaving the prior interval active. History is append-only.
 *
 * Operations exercised here: veh.vehicle-plate-history, veh.vehicle-plate-assign,
 * veh.vehicle-ownership-history, veh.vehicle-ownership-transfer.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-plate-history: route service authorization success denial cross-tenant
 *   veh.vehicle-plate-assign: route service authorization success denial cross-tenant audit idempotency
 *   veh.vehicle-ownership-history: route service authorization success denial cross-tenant
 *   veh.vehicle-ownership-transfer: route service authorization success denial cross-tenant audit outbox rollback idempotency
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
  GET as PLATE_LIST,
  POST as PLATE_ASSIGN,
} from '@/app/api/v1/vehicles/[vehicleId]/plates/route';
import {
  GET as OWN_LIST,
  POST as OWN_TRANSFER,
} from '@/app/api/v1/vehicles/[vehicleId]/ownerships/route';

const ROLE_A = 'c1740000-0000-4000-8000-0000000000a1';
const USER_RA = 'c1740000-0000-4000-8000-0000000000a2';
const SUBJ_A = 'fx_p1_17_veh_reg_a';
const ROLE_B = 'c1740000-0000-4000-8000-0000000000b1';
const USER_RB = 'c1740000-0000-4000-8000-0000000000b2';
const SUBJ_B = 'fx_p1_17_veh_reg_b';
const PARTNER_A1 = 'c1740000-0000-4000-8000-0000000000d1';
const PARTNER_A2 = 'c1740000-0000-4000-8000-0000000000d2';
const PARTNER_B1 = 'c1740000-0000-4000-8000-0000000000d3';
const MERGE_SURV = 'c1740000-0000-4000-8000-0000000000e1';
const MERGED = 'c1740000-0000-4000-8000-0000000000e2';

const V = 'http://localhost/api/v1/vehicles';

interface Body {
  readonly vehicleId?: string;
  readonly plateId?: string;
  readonly ownershipId?: string;
  readonly ownershipKind?: string;
  readonly items?: readonly { readonly id: string; readonly active?: boolean }[];
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

function assignPlate(
  vehicleId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return PLATE_ASSIGN(
    new Request(`${V}/${vehicleId}/plates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}
function listPlates(vehicleId: string, query = ''): Promise<Response> {
  return PLATE_LIST(new Request(`${V}/${vehicleId}/plates${query}`, { method: 'GET' }), {
    params: Promise.resolve({ vehicleId }),
  });
}
function transfer(vehicleId: string, body: unknown, key = crypto.randomUUID()): Promise<Response> {
  return OWN_TRANSFER(
    new Request(`${V}/${vehicleId}/ownerships`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}
function listOwn(vehicleId: string, query = ''): Promise<Response> {
  return OWN_LIST(new Request(`${V}/${vehicleId}/ownerships${query}`, { method: 'GET' }), {
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
     VALUES ($1,$2,$3,$4,$4||'@example.test','Reg Writer','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-17 reg writer',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code IN ('veh.vehicle.manage','veh.vehicle.read','veh.vehicle.relationship.manage')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [tenantId, userId, roleId, USER_A]
  );
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
            ('veh.vehicle.relationship.manage','veh','Transfer ownership and manage authorized parties','medium',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await seedWriter(TENANT_A, ROLE_A, USER_RA, SUBJ_A);
  await seedWriter(TENANT_B, ROLE_B, USER_RB, SUBJ_B);

  // Customers to transfer ownership to, and a merged vehicle. All the veh/crm
  // triggers stamp their actor from `app.user_id`, so the fixture runs in one
  // context-set transaction.
  const fx = await admin.connect();
  try {
    await fx.query('BEGIN');
    await fx.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await fx.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$3,'organization','Owner One','active',$4), ($2,$3,'organization','Owner Two','active',$4)
       ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A1, PARTNER_A2, TENANT_A, USER_A]
    );
    await fx.query(
      `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$3,'1REGSURV000000001','ice','active',$4), ($2,$3,'1REGLOSER00000001','ice','active',$4)
       ON CONFLICT (id) DO NOTHING`,
      [MERGE_SURV, MERGED, TENANT_A, USER_A]
    );
    await fx.query(
      `UPDATE veh.vehicles SET lifecycle_status='merged', merged_into_id=$2 WHERE id=$1 AND tenant_id=$3`,
      [MERGED, MERGE_SURV, TENANT_A]
    );
    await fx.query('COMMIT');
  } catch (error) {
    await fx.query('ROLLBACK');
    throw error;
  } finally {
    fx.release();
  }
  // A tenant-B customer for the cross-tenant ownership check.
  const fxb = await admin.connect();
  try {
    await fxb.query('BEGIN');
    await fxb.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_B]
    );
    await fxb.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Tenant B Owner','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_B1, TENANT_B, USER_A]
    );
    await fxb.query('COMMIT');
  } catch (error) {
    await fxb.query('ROLLBACK');
    throw error;
  } finally {
    fxb.release();
  }

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

async function auditCount(action: string, entityId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action=$1 AND entity_id=$2`,
    [action, entityId]
  );
  return Number(r.rows[0]?.n ?? '0');
}
async function relEventCount(vehicleId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM shared.event_outbox
      WHERE event_type='vehicle.relationship.changed' AND aggregate_id=$1`,
    [vehicleId]
  );
  return Number(r.rows[0]?.n ?? '0');
}

describe('authorization', () => {
  it('401 without an authenticator; 403 without the permission', async () => {
    __resetAuthenticatorForTests();
    expect((await assignPlate(MERGE_SURV, { countryCode: 'JO', plateRaw: 'AAA111' })).status).toBe(
      401
    );
    authAs(SUBJECT_UNPERMITTED);
    expect((await assignPlate(MERGE_SURV, { countryCode: 'JO', plateRaw: 'AAA111' })).status).toBe(
      403
    );
    expect((await transfer(MERGE_SURV, { partnerId: PARTNER_A1 })).status).toBe(403);
  });

  // The two history reads declare a permission requirement (`veh.vehicle.read`)
  // that nothing used to drive: every other test lists as SUBJ_A or SUBJ_B, both
  // permitted, so dropping the permission list from either GET operation would have
  // left the suite green while the endpoints answered anyone. These cases pin the
  // refusal for the reads themselves, not just for the two writes above.
  it('both history reads: 401 without an authenticator; 403 without the permission', async () => {
    __resetAuthenticatorForTests();
    expect((await listPlates(MERGE_SURV)).status).toBe(401);
    expect((await listOwn(MERGE_SURV)).status).toBe(401);
    authAs(SUBJECT_UNPERMITTED);
    expect((await listPlates(MERGE_SURV)).status).toBe(403);
    expect((await listOwn(MERGE_SURV)).status).toBe(403);
  });
});

describe('plate assignment and history', () => {
  it('assigns a plate, replays idempotently, and lists it', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const key = crypto.randomUUID();
    const first = (await (
      await assignPlate(vehicle, { countryCode: 'jo', plateRaw: 'ABC-100' }, key)
    ).json()) as Body;
    expect(first.plateId).toBeTruthy();
    const replay = (await (
      await assignPlate(vehicle, { countryCode: 'jo', plateRaw: 'ABC-100' }, key)
    ).json()) as Body;
    expect(replay.plateId).toBe(first.plateId);

    const active = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM veh.plate_history WHERE vehicle_id=$1 AND valid_to IS NULL`,
      [vehicle]
    );
    expect(active.rows[0]?.n).toBe('1');
    expect(await auditCount('veh.vehicle.plate_assigned', first.plateId ?? '')).toBe(1);

    const list = (await (await listPlates(vehicle)).json()) as Body;
    expect((list.items ?? []).map((i) => i.id)).toContain(first.plateId);
  });

  it('closes the prior plate when a new one is assigned', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    // The old plate started earlier, so today's assignment can close it (a plate
    // interval is [valid_from, valid_to) with valid_to strictly after valid_from).
    const p1 = (await (
      await assignPlate(vehicle, {
        countryCode: 'JO',
        plateRaw: 'OLD-1',
        effectiveDate: '2020-01-01',
      })
    ).json()) as Body;
    expect((await assignPlate(vehicle, { countryCode: 'JO', plateRaw: 'NEW-1' })).status).toBe(201);
    const closed = await admin.query<{ valid_to: string | null }>(
      `SELECT valid_to FROM veh.plate_history WHERE id=$1`,
      [p1.plateId]
    );
    expect(closed.rows[0]?.valid_to).not.toBeNull();
  });

  it('refuses a plate already active on another vehicle (409)', async () => {
    authAs(SUBJ_A);
    const a = await newVehicle();
    const b = await newVehicle();
    await assignPlate(a, { countryCode: 'JO', plateRaw: 'DUP-9' });
    const response = await assignPlate(b, { countryCode: 'JO', plateRaw: 'dup 9' });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-002');
  });

  it('refuses a plate on a merged vehicle (409) and an unknown vehicle (404)', async () => {
    authAs(SUBJ_A);
    expect((await assignPlate(MERGED, { countryCode: 'JO', plateRaw: 'MRG-1' })).status).toBe(409);
    expect(
      (
        await assignPlate('00000000-0000-4000-8000-0000000000fe', {
          countryCode: 'JO',
          plateRaw: 'GHO-1',
        })
      ).status
    ).toBe(404);
  });

  it('never exposes another tenant’s plate and refuses a bad cursor / oversized page', async () => {
    authAs(SUBJ_A);
    const mine = await newVehicle();
    await assignPlate(mine, { countryCode: 'JO', plateRaw: 'MINE-1' });
    authAs(SUBJ_B, TENANT_B);
    const asB = await listPlates(mine);
    // A successful read that returns nothing — not an error path that also yields [].
    expect(asB.status).toBe(200);
    expect(((await asB.json()) as Body).items ?? []).toEqual([]);
    authAs(SUBJ_A);
    expect((await listPlates(mine, '?cursor=not-a-cursor')).status).toBe(400);
    expect((await listPlates(mine, '?limit=100000')).status).toBe(422);
  });
});

describe('ownership transfer and history', () => {
  it('transfers ownership atomically with an audit and one event, and replays idempotently', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const key = crypto.randomUUID();
    const first = (await (
      await transfer(vehicle, { partnerId: PARTNER_A1, transferReason: 'sale' }, key)
    ).json()) as Body;
    expect(first.ownershipId).toBeTruthy();
    expect(first.ownershipKind).toBe('registered_owner');
    const replay = (await (
      await transfer(vehicle, { partnerId: PARTNER_A1, transferReason: 'sale' }, key)
    ).json()) as Body;
    expect(replay.ownershipId).toBe(first.ownershipId);

    const active = await admin.query<{ partner_id: string; n: string }>(
      `SELECT count(*)::text AS n FROM veh.ownership_history WHERE vehicle_id=$1 AND valid_to IS NULL`,
      [vehicle]
    );
    expect(active.rows[0]?.n).toBe('1');
    expect(await auditCount('veh.vehicle.ownership_changed', first.ownershipId ?? '')).toBe(1);
    expect(await relEventCount(vehicle)).toBe(1);
  });

  it('closes the prior owner on a second transfer', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    // The first owner starts earlier so today's transfer can close it.
    await transfer(vehicle, { partnerId: PARTNER_A1, effectiveDate: '2020-01-01' });
    expect((await transfer(vehicle, { partnerId: PARTNER_A2 })).status).toBe(201);
    const rows = await admin.query<{ n: string; active: string }>(
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE valid_to IS NULL)::text AS active
         FROM veh.ownership_history WHERE vehicle_id=$1`,
      [vehicle]
    );
    expect(rows.rows[0]?.n).toBe('2');
    expect(rows.rows[0]?.active).toBe('1');
  });

  it('rolls back a failed transfer, leaving the original owner active and no new row', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    // The original owner starts earlier so the failing transfer genuinely reaches
    // (and rolls back) the close-then-insert path rather than failing at the close.
    const original = (await (
      await transfer(vehicle, { partnerId: PARTNER_A1, effectiveDate: '2020-01-01' })
    ).json()) as Body;

    // A customer that does not exist fails the FK at the INSERT — after the prior
    // owner has been closed within the transaction — so the whole thing rolls back.
    const bad = await transfer(vehicle, { partnerId: '00000000-0000-4000-8000-0000000000cc' });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as Body).code).toBe('ERR-VAL-001');

    const rows = await admin.query<{ n: string; active_id: string | null }>(
      `SELECT count(*)::text AS n,
              (SELECT id FROM veh.ownership_history WHERE vehicle_id=$1 AND valid_to IS NULL) AS active_id
         FROM veh.ownership_history WHERE vehicle_id=$1`,
      [vehicle]
    );
    expect(rows.rows[0]?.n).toBe('1');
    expect(rows.rows[0]?.active_id).toBe(original.ownershipId);
  });

  it('refuses a cross-tenant customer (422) and a cross-tenant vehicle (404)', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const crossCustomer = await transfer(vehicle, { partnerId: PARTNER_B1 });
    expect(crossCustomer.status).toBe(422);
    expect(((await crossCustomer.json()) as Body).code).toBe('ERR-VAL-001');

    authAs(SUBJ_B, TENANT_B);
    const theirVehicle = await newVehicle();
    authAs(SUBJ_A);
    expect((await transfer(theirVehicle, { partnerId: PARTNER_A1 })).status).toBe(404);
  });

  it('lists ownership history, never exposes another tenant’s, and refuses a bad cursor', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const t = (await (await transfer(vehicle, { partnerId: PARTNER_A1 })).json()) as Body;
    const list = (await (await listOwn(vehicle)).json()) as Body;
    expect((list.items ?? []).map((i) => i.id)).toContain(t.ownershipId);
    expect((await listOwn(vehicle, '?cursor=nope')).status).toBe(400);
    // A tenant-B principal reading tenant A's vehicle sees no ownership rows — a
    // successful empty read, not an error path that also yields [].
    authAs(SUBJ_B, TENANT_B);
    const asB = await listOwn(vehicle);
    expect(asB.status).toBe(200);
    expect(((await asB.json()) as Body).items ?? []).toEqual([]);
  });
});
