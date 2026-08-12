/**
 * Customer→Vehicle list — the read the POST never published, end to end
 * (Phase 1-16 remediation, `P1-27-INT-012`).
 *
 * `crm.vehicle-link` has inserted into `veh.vehicle_relationships` since P1-16
 * and no operation ever listed a customer's vehicles: the Customer→Vehicle
 * direction was write-only, while the Vehicle→Customer direction has had
 * `veh.vehicle-relationship-list` since P1-17. This suite proves the four
 * things the new partner-centric read can get wrong invisibly:
 *
 *  1. **A tombstoned vehicle never lends its identity.** The relationship row
 *     outlives a soft-deleted vehicle; the row must come back as the bare
 *     `vehicleId` beside nulls, never as a live-looking VIN.
 *  2. **History is returned, not hidden.** A closed interval travels with
 *     `active: false` — who was linked to which vehicle is a dated business
 *     fact the screen ranks by, exactly as contacts rank by `isPrimary`.
 *  3. **The two lists over the same table refuse each other's cursors, in BOTH
 *     directions.** This list and the vehicle-centric one paginate the SAME
 *     relation by the SAME sort; only the distinct ordering-contract keys
 *     (`partner_created_at_desc` vs `created_at_desc`) stop a replayed cursor
 *     from producing a plausible wrong page — pinned by feeding each list's
 *     cursor to the other.
 *  4. **Reads are not implied by writes.** A principal holding the linking
 *     permission and not `crm.customer.read` may create the relationship it
 *     cannot list.
 *  5. **The 404 is uniform four ways.** Other-tenant, never-existed,
 *     soft-deleted and merged-away customers all answer the identical
 *     `ERR-RES-001` problem body modulo `correlationId`, through the shared
 *     `requireLiveCustomer` path — so the route is not an existence oracle.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.customer-vehicle-list: route service authorization success denial cross-tenant
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
  GET as LIST_VEHICLES,
  POST as LINK_VEHICLE,
  CUSTOMER_VEHICLE_LIST_OPERATION,
} from '@/app/api/v1/customers/[customerId]/vehicles/route';
import { GET as LIST_CONTACTS } from '@/app/api/v1/customers/[customerId]/contacts/route';
import { GET as LIST_VEH_RELATIONSHIPS } from '@/app/api/v1/vehicles/[vehicleId]/relationships/route';

const ROLE_FULL = 'c1160000-0000-4000-8000-000000000101';
const USER_FULL = 'c1160000-0000-4000-8000-000000000102';
const SUBJ_FULL = 'fx_p1_16_cvl_full';

/** Holds the linking permission and NOT crm.customer.read. */
const ROLE_LINK_ONLY = 'c1160000-0000-4000-8000-000000000201';
const USER_LINK_ONLY = 'c1160000-0000-4000-8000-000000000202';
const SUBJ_LINK_ONLY = 'fx_p1_16_cvl_link_only';

const ROLE_TENANT_B = 'c1160000-0000-4000-8000-000000000301';
const USER_TENANT_B = 'c1160000-0000-4000-8000-000000000302';
const SUBJ_TENANT_B = 'fx_p1_16_cvl_tenant_b';

/** Tenant A customer whose links are made through the real POST route. */
const CUSTOMER_MAIN = 'c1160000-0000-4000-8000-0000000000c1';
/** Tenant A customer with direct-insert links at controlled created_at. */
const CUSTOMER_PAGER = 'c1160000-0000-4000-8000-0000000000c2';
/** Tenant B's own customer, for the empty-own-scope answer. */
const CUSTOMER_B = 'c1160000-0000-4000-8000-0000000000c3';
/** Tenant A customer soft-deleted before any read. */
const CUSTOMER_GONE = 'c1160000-0000-4000-8000-0000000000c4';
/** Tenant A customer merged away, and the survivor it was merged into. */
const CUSTOMER_MERGED = 'c1160000-0000-4000-8000-0000000000c5';
const CUSTOMER_SURVIVOR = 'c1160000-0000-4000-8000-0000000000c6';
/** Tenant A customer holding two roles on ONE vehicle, for the cursor pair. */
const CUSTOMER_XCUR = 'c1160000-0000-4000-8000-0000000000c7';
const UNKNOWN = 'c1160000-0000-4000-8000-0000000000ff';

const VEHICLE_LIVE = 'c1160000-0000-4000-8000-0000000000d1';
const VEHICLE_CLOSED = 'c1160000-0000-4000-8000-0000000000d2';
const VEHICLE_DEAD = 'c1160000-0000-4000-8000-0000000000d3';
/** One vehicle with two relationship rows, so BOTH lists can issue a cursor. */
const VEHICLE_XCUR = 'c1160000-0000-4000-8000-0000000000d4';
const PAGER_VEHICLES = [
  'c1160000-0000-4000-8000-0000000000e1',
  'c1160000-0000-4000-8000-0000000000e2',
  'c1160000-0000-4000-8000-0000000000e3',
] as const;

interface VehicleRow {
  readonly id?: string;
  readonly vehicleId?: string;
  readonly relationshipRole?: string;
  readonly validFrom?: string;
  readonly validTo?: string | null;
  readonly active?: boolean;
  readonly vehicleDisplayNumber?: string | null;
  readonly vin?: string | null;
  readonly makeId?: string | null;
  readonly modelId?: string | null;
  readonly modelYear?: number | null;
  readonly color?: string | null;
  readonly vehicleLifecycleStatus?: string | null;
  readonly code?: string;
}

interface PageBody {
  readonly items?: readonly VehicleRow[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;

function authAs(providerSubject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

const route = (customerId: string) => ({ params: Promise.resolve({ customerId }) });

function list(customerId: string, query = ''): Promise<Response> {
  return LIST_VEHICLES(
    new Request(`http://localhost/api/v1/customers/${customerId}/vehicles${query}`),
    route(customerId)
  );
}

/** The vehicle-centric list over the same table (`veh.vehicle-relationship-list`). */
function vehList(vehicleId: string, query = ''): Promise<Response> {
  return LIST_VEH_RELATIONSHIPS(
    new Request(`http://localhost/api/v1/vehicles/${vehicleId}/relationships${query}`),
    { params: Promise.resolve({ vehicleId }) }
  );
}

function link(customerId: string, vehicleId: string, relationshipRole: string): Promise<Response> {
  return LINK_VEHICLE(
    new Request(`http://localhost/api/v1/customers/${customerId}/vehicles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ vehicleId, relationshipRole }),
    }),
    route(customerId)
  );
}

/** Runs `work` as admin inside one transaction with the actor GUCs set. */
async function asAdminTx<T>(tenantId: string, work: (client: Pool) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const result = await work(client as unknown as Pool);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedPrincipal(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string,
  permissions: readonly string[]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Customer Vehicle Principal','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-16 customer-vehicle principal',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, [...permissions]]
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

  // All three codes exist in the seeded catalog (04_iam_permission_catalog.sql);
  // the idempotent insert keeps this suite runnable against a database that
  // predates the seed, exactly as the sibling read suite does.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.read','crm','Search and read customers in the tenant','low',$1),
            ('crm.customer.vehicle.manage','crm','Link customers to vehicles','medium',$1),
            ('veh.vehicle.read','veh','Search and read vehicles in the caller tenant','low',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  // `veh.vehicle.read` is granted so the SAME principal can drive both lists
  // over `veh.vehicle_relationships` for the bidirectional cursor refusal.
  await seedPrincipal(TENANT_A, ROLE_FULL, USER_FULL, SUBJ_FULL, [
    'crm.customer.read',
    'crm.customer.vehicle.manage',
    'veh.vehicle.read',
  ]);
  await seedPrincipal(TENANT_A, ROLE_LINK_ONLY, USER_LINK_ONLY, SUBJ_LINK_ONLY, [
    'crm.customer.vehicle.manage',
  ]);
  await seedPrincipal(TENANT_B, ROLE_TENANT_B, USER_TENANT_B, SUBJ_TENANT_B, ['crm.customer.read']);

  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1,$4,'individual','Vehicle Holder','active',$5),
            ($2,$4,'individual','Paginated Holder','active',$5),
            ($3,$6,'individual','Tenant B Holder','active',$5),
            ($7,$4,'individual','Deleted Holder','active',$5),
            ($8,$4,'individual','Merged Holder','active',$5),
            ($9,$4,'individual','Surviving Holder','active',$5),
            ($10,$4,'individual','Cursor Holder','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [
      CUSTOMER_MAIN,
      CUSTOMER_PAGER,
      CUSTOMER_B,
      TENANT_A,
      USER_A,
      TENANT_B,
      CUSTOMER_GONE,
      CUSTOMER_MERGED,
      CUSTOMER_SURVIVOR,
      CUSTOMER_XCUR,
    ]
  );
  await admin.query(
    `UPDATE crm.business_partners SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
    [CUSTOMER_GONE, USER_A]
  );
  // Both columns together: `ck_business_partners_merged_coherent` makes
  // `lifecycle_status = 'merged'` and a non-null `merged_into_id` the same
  // fact, so a fixture that set only one would not be a merged customer.
  await admin.query(
    `UPDATE crm.business_partners SET merged_into_id = $2, lifecycle_status = 'merged' WHERE id = $1`,
    [CUSTOMER_MERGED, CUSTOMER_SURVIVOR]
  );

  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, display_number, vin_raw, model_year, color, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$5,'V-CVL-0001','P116CVLLIVE000001',2024,'blue','ice','active',$6),
            ($2,$5,'V-CVL-0002','P116CVLCLSD000002',NULL,NULL,'ice','active',$6),
            ($3,$5,'V-CVL-0003','P116CVLDEAD000003',NULL,NULL,'ice','active',$6),
            ($4,$5,'V-CVL-1001','P116CVLPAGE000001',NULL,NULL,'ice','active',$6),
            ($7,$5,'V-CVL-1002','P116CVLPAGE000002',NULL,NULL,'ice','active',$6),
            ($8,$5,'V-CVL-1003','P116CVLPAGE000003',NULL,NULL,'ice','active',$6),
            ($9,$5,'V-CVL-2001','P116CVLXCUR000001',NULL,NULL,'ice','active',$6)
     ON CONFLICT (id) DO NOTHING`,
    [
      VEHICLE_LIVE,
      VEHICLE_CLOSED,
      VEHICLE_DEAD,
      PAGER_VEHICLES[0],
      TENANT_A,
      USER_A,
      PAGER_VEHICLES[1],
      PAGER_VEHICLES[2],
      VEHICLE_XCUR,
    ]
  );

  // Distinct created_at values for the pagination customer, so the keyset
  // order is total and the page boundary is a fact rather than a coincidence
  // of insert order (the p1-16 contacts pagination precedent).
  await asAdminTx(TENANT_A, async (client) => {
    for (let index = 0; index < PAGER_VEHICLES.length; index += 1) {
      await client.query(
        `INSERT INTO veh.vehicle_relationships
           (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, created_at, created_by)
         VALUES ($1,$2,$3,'owner',current_date, now() - ($4 || ' minutes')::interval, $5)`,
        [TENANT_A, PAGER_VEHICLES[index], CUSTOMER_PAGER, String(index), USER_A]
      );
    }
    // Two roles for ONE (partner, vehicle) pair — no overlap under the EXCLUDE
    // constraint because the roles differ — so BOTH lists over this table have
    // a second row to issue a cursor from with limit=1.
    await client.query(
      `INSERT INTO veh.vehicle_relationships
         (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, created_at, created_by)
       VALUES ($1,$2,$3,'owner',current_date, now() - interval '2 minutes', $4),
              ($1,$2,$3,'driver',current_date, now() - interval '1 minute', $4)`,
      [TENANT_A, VEHICLE_XCUR, CUSTOMER_XCUR, USER_A]
    );
  });

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

describe('registration', () => {
  it('registers the read exactly as the contract says', () => {
    const operation = CUSTOMER_VEHICLE_LIST_OPERATION;
    expect(operation.id).toBe('crm.customer-vehicle-list');
    expect(operation.path).toBe('/customers/{customerId}/vehicles');
    expect(operation.method).toBe('GET');
    // The same permission as the nine sibling customer reads — knowing which
    // vehicles a customer holds is reading the customer, not managing links.
    expect(operation.permissions).toEqual(['crm.customer.read']);
    expect(operation.scope).toBe('tenant');
    expect(operation.auditClass).toBe('none');
    expect(operation.rateLimitPolicy).toBe('expensive-read');
    expect(operation.idempotent ?? false).toBe(false);
    expect(operation.versionGuarded ?? false).toBe(false);
  });
});

describe('authorization (denial)', () => {
  it('answers 401 with no session and 403 without crm.customer.read', async () => {
    __resetAuthenticatorForTests();
    expect((await list(CUSTOMER_MAIN)).status).toBe(401);

    authAs(SUBJECT_UNPERMITTED);
    const denied = await list(CUSTOMER_MAIN);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as PageBody).code).toBe('ERR-IAM-001');
  });

  it('refuses the principal that may CREATE the link it cannot list', async () => {
    // The sharper case: this principal holds crm.customer.vehicle.manage — the
    // POST on this very route works for it — and is refused purely because the
    // read code is missing. Reads are not implied by writes.
    authAs(SUBJ_LINK_ONLY);
    const denied = await list(CUSTOMER_MAIN);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as PageBody).code).toBe('ERR-IAM-001');
  });
});

describe('the parent is resolved first (cross-tenant)', () => {
  it('answers ONE uniform 404 across other-tenant, never-existed, soft-deleted and merged-away', async () => {
    // The central IDOR claim, four ways through the shared requireLiveCustomer
    // path. Merged is in the list deliberately: it is the case a naive
    // `tenant_id = $1 AND id = $2` lookup would let through, because the row is
    // still there — redirected, not deleted. The bodies must be identical
    // modulo correlationId, or the differences between them become an
    // existence oracle.
    const cases: readonly [string, string, () => void][] = [
      ['a customer in another tenant', CUSTOMER_MAIN, () => authAs(SUBJ_TENANT_B, TENANT_B)],
      ['an id that never existed', UNKNOWN, () => authAs(SUBJ_TENANT_B, TENANT_B)],
      ['a soft-deleted customer in the caller tenant', CUSTOMER_GONE, () => authAs(SUBJ_FULL)],
      ['a customer merged into another, same tenant', CUSTOMER_MERGED, () => authAs(SUBJ_FULL)],
    ];
    const bodies: Record<string, unknown>[] = [];
    for (const [label, customerId, auth] of cases) {
      auth();
      const response = await list(customerId);
      expect(response.status, label).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body['code'], label).toBe('ERR-RES-001');
      expect(typeof body['correlationId'], label).toBe('string');
      delete body['correlationId'];
      bodies.push(body);
    }
    // Identical problem documents modulo the per-request correlation id: no
    // field distinguishes "not yours" from "gone", "merged" or "never was".
    for (const [index, body] of bodies.entries()) {
      expect(body, cases[index]?.[0]).toEqual(bodies[0]);
    }
  });

  it('answers an empty page — not 404 — for tenant B own linkless customer', async () => {
    authAs(SUBJ_TENANT_B, TENANT_B);
    const response = await list(CUSTOMER_B, '?limit=10');
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('answers 422 — not 500 — for a malformed path id', async () => {
    authAs(SUBJ_FULL);
    const response = await list('not-a-uuid');
    expect(response.status).toBe(422);
    expect(((await response.json()) as PageBody).code).toBe('ERR-VAL-001');
  });

  it('refuses an unknown query parameter and an out-of-bounds limit', async () => {
    authAs(SUBJ_FULL);
    expect((await list(CUSTOMER_MAIN, '?sort=vin')).status).toBe(422);
    expect((await list(CUSTOMER_MAIN, '?limit=0')).status).toBe(422);
  });
});

describe('the list (success)', () => {
  it('round-trips the real write: links made by POST come back with the vehicle identity', async () => {
    authAs(SUBJ_FULL);
    expect((await link(CUSTOMER_MAIN, VEHICLE_LIVE, 'owner')).status).toBe(201);
    expect((await link(CUSTOMER_MAIN, VEHICLE_CLOSED, 'driver')).status).toBe(201);
    expect((await link(CUSTOMER_MAIN, VEHICLE_DEAD, 'user')).status).toBe(201);

    const response = await list(CUSTOMER_MAIN, '?limit=10');
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    expect(page.items?.length).toBe(3);

    const owner = page.items?.find((row) => row.vehicleId === VEHICLE_LIVE);
    expect(owner?.relationshipRole).toBe('owner');
    expect(owner?.active).toBe(true);
    expect(owner?.validTo).toBeNull();
    // The identity veh.vehicles itself carries, resolved in the same page.
    expect(owner?.vehicleDisplayNumber).toBe('V-CVL-0001');
    expect(owner?.vin).toBe('P116CVLLIVE000001');
    expect(owner?.modelYear).toBe(2024);
    expect(owner?.color).toBe('blue');
    expect(owner?.vehicleLifecycleStatus).toBe('active');
    // Bare ids for anything with no honest join: the make/model catalogs have
    // their own published reads, and this fixture references none.
    expect(owner?.makeId).toBeNull();
    expect(owner?.modelId).toBeNull();
    // valid_from is a date column read ::text — a day, never an instant.
    expect(owner?.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a closed interval with active:false rather than hiding it', async () => {
    // guard_temporal_close permits exactly this close; identity columns stay
    // immutable. Who drove which vehicle is a dated business fact.
    await asAdminTx(TENANT_A, async (client) => {
      await client.query(
        `UPDATE veh.vehicle_relationships
            SET valid_to = valid_from + 1
          WHERE tenant_id = $1 AND partner_id = $2 AND vehicle_id = $3 AND valid_to IS NULL`,
        [TENANT_A, CUSTOMER_MAIN, VEHICLE_CLOSED]
      );
    });

    authAs(SUBJ_FULL);
    const page = (await (await list(CUSTOMER_MAIN, '?limit=10')).json()) as PageBody;
    const closed = page.items?.find((row) => row.vehicleId === VEHICLE_CLOSED);
    expect(closed).toBeDefined();
    expect(closed?.active).toBe(false);
    expect(closed?.validTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never lends a tombstoned vehicle its identity: the bare id survives, the VIN does not', async () => {
    await admin.query(`UPDATE veh.vehicles SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [
      VEHICLE_DEAD,
      USER_A,
    ]);

    authAs(SUBJ_FULL);
    const page = (await (await list(CUSTOMER_MAIN, '?limit=10')).json()) as PageBody;
    const dead = page.items?.find((row) => row.vehicleId === VEHICLE_DEAD);
    // The relationship is a fact and stays; the vehicle's identity is gone and
    // must not be resurrected into a live-looking row.
    expect(dead).toBeDefined();
    expect(dead?.vin).toBeNull();
    expect(dead?.vehicleDisplayNumber).toBeNull();
    expect(dead?.vehicleLifecycleStatus).toBeNull();
    // And the raw response never carries the dead vehicle's identifiers.
    const text = JSON.stringify(page);
    expect(text).not.toContain('P116CVLDEAD000003');
    expect(text).not.toContain('V-CVL-0003');
  });
});

describe('pagination', () => {
  it('walks a bounded page and its continuation without a gap or a repeat', async () => {
    authAs(SUBJ_FULL);
    const first = (await (await list(CUSTOMER_PAGER, '?limit=2')).json()) as PageBody;
    expect(first.items?.length).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    // Newest link first: the fixtures are minutes apart by construction.
    expect(first.items?.[0]?.vehicleId).toBe(PAGER_VEHICLES[0]);

    const second = (await (
      await list(CUSTOMER_PAGER, `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
    ).json()) as PageBody;
    expect(second.items?.length).toBe(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    const seen = [...(first.items ?? []), ...(second.items ?? [])].map((row) => row.id);
    expect(new Set(seen).size).toBe(3);
  });

  it('refuses a cursor issued for a different list on a different relation', async () => {
    authAs(SUBJ_FULL);
    const vehicles = (await (await list(CUSTOMER_PAGER, '?limit=2')).json()) as PageBody;
    // The general rule first: any other list refuses this list's cursor. The
    // sharp same-relation pair is pinned in the next case.
    const response = await LIST_CONTACTS(
      new Request(
        `http://localhost/api/v1/customers/${CUSTOMER_PAGER}/contacts?cursor=${encodeURIComponent(
          vehicles.nextCursor ?? ''
        )}`
      ),
      route(CUSTOMER_PAGER)
    );
    // 400, not 422: a cursor is not caller-authored input to validate, it is a
    // token this API issued, and ERR-PAG-001 says it does not belong here.
    expect(response.status).toBe(400);
    expect(((await response.json()) as PageBody).code).toBe('ERR-PAG-001');
  });

  it('the two lists over veh.vehicle_relationships refuse each other cursors, BOTH directions', async () => {
    // The sharpest replay: crm.customer-vehicle-list and
    // veh.vehicle-relationship-list paginate the SAME relation by the SAME
    // sort column, so a shared ordering-contract key would make each list
    // ACCEPT the other's cursor and serve a plausible wrong page. The keys
    // differ (`veh.vehicle_relationships:partner_created_at_desc` vs
    // `veh.vehicle_relationships:created_at_desc`), and both directions are
    // pinned here on one (partner, vehicle) pair holding two roles — so each
    // list has a second row and genuinely issues a cursor at limit=1.
    authAs(SUBJ_FULL);

    const customerPage = (await (await list(CUSTOMER_XCUR, '?limit=1')).json()) as PageBody;
    expect(customerPage.nextCursor).toBeTruthy();
    const vehiclePage = (await (await vehList(VEHICLE_XCUR, '?limit=1')).json()) as PageBody;
    expect(vehiclePage.nextCursor).toBeTruthy();

    // Customer-list cursor fed to the vehicle-centric list: refused.
    const intoVehicleList = await vehList(
      VEHICLE_XCUR,
      `?limit=1&cursor=${encodeURIComponent(customerPage.nextCursor ?? '')}`
    );
    expect(intoVehicleList.status).toBe(400);
    expect(((await intoVehicleList.json()) as PageBody).code).toBe('ERR-PAG-001');

    // Vehicle-list cursor fed to the customer-centric list: refused.
    const intoCustomerList = await list(
      CUSTOMER_XCUR,
      `?limit=1&cursor=${encodeURIComponent(vehiclePage.nextCursor ?? '')}`
    );
    expect(intoCustomerList.status).toBe(400);
    expect(((await intoCustomerList.json()) as PageBody).code).toBe('ERR-PAG-001');
  });
});
