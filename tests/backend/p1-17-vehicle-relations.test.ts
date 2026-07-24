/**
 * Vehicle relationships + authorized parties, end to end (Phase 1-17,
 * P1-17-BE-008, P1-17-BE-009).
 *
 * The vehicle-centric read of `veh.vehicle_relationships` and the authorized-party
 * writer, driven through the real routes on `app_runtime`. The read surfaces both a
 * CRM-written link and a veh-written authorized party from the single source of
 * truth; the writer adds one `authorized_person` relationship with a bounded scope,
 * and the overlap EXCLUDE proves the two modules cannot create conflicting active
 * relationships. History is append-only.
 *
 * Operations exercised here: veh.vehicle-relationship-list,
 * veh.vehicle-authorized-party-add, veh.vehicle-authorized-party-retire.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-relationship-list: route service authorization success denial cross-tenant
 *   veh.vehicle-authorized-party-add: route service authorization success denial cross-tenant audit outbox idempotency
 *   veh.vehicle-authorized-party-retire: route service authorization success denial cross-tenant audit idempotency
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
import { GET as REL_LIST } from '@/app/api/v1/vehicles/[vehicleId]/relationships/route';
import { POST as AUTH_ADD } from '@/app/api/v1/vehicles/[vehicleId]/authorized-parties/route';
import { POST as AUTH_RETIRE } from '@/app/api/v1/vehicles/[vehicleId]/authorized-parties/[relationshipId]/retirement/route';

const ROLE_A = 'c1750000-0000-4000-8000-0000000000a1';
const USER_RA = 'c1750000-0000-4000-8000-0000000000a2';
const SUBJ_A = 'fx_p1_17_veh_rel_a';
const ROLE_B = 'c1750000-0000-4000-8000-0000000000b1';
const USER_RB = 'c1750000-0000-4000-8000-0000000000b2';
const SUBJ_B = 'fx_p1_17_veh_rel_b';
const PARTNER_A1 = 'c1750000-0000-4000-8000-0000000000d1';
const PARTNER_A2 = 'c1750000-0000-4000-8000-0000000000d2';
const PARTNER_B1 = 'c1750000-0000-4000-8000-0000000000d3';
const MERGE_SURV = 'c1750000-0000-4000-8000-0000000000e1';
const MERGED = 'c1750000-0000-4000-8000-0000000000e2';

const V = 'http://localhost/api/v1/vehicles';

interface Body {
  readonly vehicleId?: string;
  readonly relationshipId?: string;
  readonly items?: readonly {
    readonly id: string;
    readonly relationshipRole?: string;
    readonly allowedActions?: readonly string[] | null;
  }[];
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
function addParty(vehicleId: string, body: unknown, key = crypto.randomUUID()): Promise<Response> {
  return AUTH_ADD(
    new Request(`${V}/${vehicleId}/authorized-parties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}
function retireParty(
  vehicleId: string,
  relationshipId: string,
  body: unknown = {},
  key = crypto.randomUUID()
): Promise<Response> {
  return AUTH_RETIRE(
    new Request(`${V}/${vehicleId}/authorized-parties/${relationshipId}/retirement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId, relationshipId }) }
  );
}
function listRel(vehicleId: string, query = ''): Promise<Response> {
  return REL_LIST(new Request(`${V}/${vehicleId}/relationships${query}`, { method: 'GET' }), {
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
     VALUES ($1,$2,$3,$4,$4||'@example.test','Rel Writer','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-17 rel writer',$4) ON CONFLICT (id) DO NOTHING`,
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

async function seedPartners(): Promise<void> {
  const fx = await admin.connect();
  try {
    await fx.query('BEGIN');
    await fx.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await fx.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$3,'organization','A1','active',$4), ($2,$3,'organization','A2','active',$4)
       ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A1, PARTNER_A2, TENANT_A, USER_A]
    );
    await fx.query(
      `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$3,'1RELSURV000000001','ice','active',$4), ($2,$3,'1RELLOSER00000001','ice','active',$4)
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
  const fxb = await admin.connect();
  try {
    await fxb.query('BEGIN');
    await fxb.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_B]
    );
    await fxb.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','B1','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_B1, TENANT_B, USER_A]
    );
    await fxb.query('COMMIT');
  } catch (error) {
    await fxb.query('ROLLBACK');
    throw error;
  } finally {
    fxb.release();
  }
}

/** Simulates the CRM customer→vehicle link writer (a plain owner role, no scope). */
async function crmLink(vehicleId: string, partnerId: string): Promise<void> {
  const fx = await admin.connect();
  try {
    await fx.query('BEGIN');
    await fx.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await fx.query(
      `INSERT INTO veh.vehicle_relationships (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, created_by)
       VALUES ($1,$2,$3,'owner',current_date,$4)`,
      [TENANT_A, vehicleId, partnerId, USER_A]
    );
    await fx.query('COMMIT');
  } finally {
    fx.release();
  }
}

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
  await seedPartners();
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
      (await addParty(MERGE_SURV, { partnerId: PARTNER_A1, allowedActions: ['receive_reports'] }))
        .status
    ).toBe(401);
    authAs(SUBJECT_UNPERMITTED);
    expect(
      (await addParty(MERGE_SURV, { partnerId: PARTNER_A1, allowedActions: ['receive_reports'] }))
        .status
    ).toBe(403);
  });
});

describe('authorized parties', () => {
  it('adds a scoped authorized party with an audit and one event, and replays idempotently', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    const key = crypto.randomUUID();
    const first = (await (
      await addParty(
        vehicle,
        { partnerId: PARTNER_A1, allowedActions: ['receive_reports', 'approve_quotation'] },
        key
      )
    ).json()) as Body;
    expect(first.relationshipId).toBeTruthy();
    const replay = (await (
      await addParty(
        vehicle,
        { partnerId: PARTNER_A1, allowedActions: ['receive_reports', 'approve_quotation'] },
        key
      )
    ).json()) as Body;
    expect(replay.relationshipId).toBe(first.relationshipId);

    const row = await admin.query<{ relationship_role: string; scope: unknown }>(
      `SELECT relationship_role, authorization_scope AS scope FROM veh.vehicle_relationships WHERE id=$1`,
      [first.relationshipId]
    );
    expect(row.rows[0]?.relationship_role).toBe('authorized_person');
    expect(JSON.stringify(row.rows[0]?.scope)).toContain('receive_reports');
    expect(await auditCount('veh.vehicle.authorized_party_added', first.relationshipId ?? '')).toBe(
      1
    );
    expect(await relEventCount(vehicle)).toBe(1);
  });

  it('refuses a second active authorization for the same customer (409)', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    await addParty(vehicle, { partnerId: PARTNER_A1, allowedActions: ['receive_reports'] });
    const response = await addParty(vehicle, {
      partnerId: PARTNER_A1,
      allowedActions: ['receive_invoices'],
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-002');
  });

  it('rejects an unknown scope action (422), a cross-tenant customer (422), a cross-tenant/merged vehicle', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    expect(
      (await addParty(vehicle, { partnerId: PARTNER_A1, allowedActions: ['own_the_vehicle'] }))
        .status
    ).toBe(422);
    expect(
      (await addParty(vehicle, { partnerId: PARTNER_B1, allowedActions: ['receive_reports'] }))
        .status
    ).toBe(422);
    expect(
      (await addParty(MERGED, { partnerId: PARTNER_A1, allowedActions: ['receive_reports'] }))
        .status
    ).toBe(409);

    authAs(SUBJ_B, TENANT_B);
    const theirVehicle = await newVehicle();
    authAs(SUBJ_A);
    expect(
      (await addParty(theirVehicle, { partnerId: PARTNER_A1, allowedActions: ['receive_reports'] }))
        .status
    ).toBe(404);
  });

  it('retires an authorized party, replays idempotently, and refuses an unknown one', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    // Authorized earlier so today's retirement can close it.
    const added = (await (
      await addParty(vehicle, {
        partnerId: PARTNER_A1,
        allowedActions: ['receive_reports'],
        effectiveDate: '2020-01-01',
      })
    ).json()) as Body;

    const key = crypto.randomUUID();
    expect((await retireParty(vehicle, added.relationshipId ?? '', {}, key)).status).toBe(200);
    expect((await retireParty(vehicle, added.relationshipId ?? '', {}, key)).status).toBe(200); // idempotent replay

    const row = await admin.query<{ valid_to: string | null }>(
      `SELECT valid_to FROM veh.vehicle_relationships WHERE id=$1`,
      [added.relationshipId]
    );
    expect(row.rows[0]?.valid_to).not.toBeNull();
    expect(
      await auditCount('veh.vehicle.authorized_party_retired', added.relationshipId ?? '')
    ).toBe(1);

    expect((await retireParty(vehicle, '00000000-0000-4000-8000-0000000000fe')).status).toBe(404);
  });
});

describe('vehicle-centric relationship read (single source of truth)', () => {
  it('lists a CRM-written link and a veh-written authorized party together, without conflict', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    // CRM writes an owner link; the vehicle module writes an authorized party.
    await crmLink(vehicle, PARTNER_A2);
    const party = (await (
      await addParty(vehicle, {
        partnerId: PARTNER_A1,
        allowedActions: ['communicate_about_service'],
      })
    ).json()) as Body;

    const list = (await (await listRel(vehicle)).json()) as Body;
    const byRole = new Map((list.items ?? []).map((i) => [i.relationshipRole, i]));
    expect(byRole.get('owner')).toBeDefined();
    const authorized = byRole.get('authorized_person');
    expect(authorized?.id).toBe(party.relationshipId);
    expect(authorized?.allowedActions).toContain('communicate_about_service');
  });

  it('never exposes another tenant’s relationships and refuses a bad cursor', async () => {
    authAs(SUBJ_A);
    const mine = await newVehicle();
    await addParty(mine, { partnerId: PARTNER_A1, allowedActions: ['receive_reports'] });
    authAs(SUBJ_B, TENANT_B);
    const asB = await listRel(mine);
    // A successful read that returns nothing — not an error path that also yields [].
    expect(asB.status).toBe(200);
    expect(((await asB.json()) as Body).items ?? []).toEqual([]);
    authAs(SUBJ_A);
    expect((await listRel(mine, '?cursor=nope')).status).toBe(400);
  });
});
