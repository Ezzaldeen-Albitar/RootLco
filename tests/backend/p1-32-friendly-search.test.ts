/**
 * Friendly search — customers, vehicles and work orders, end to end
 * (P1-32-PRE-052, P1-32-PRE-053, P1-32-PRE-054).
 *
 * Drives the three real routes through the fixed pipeline against a real database
 * on the least-privilege `app_runtime` role, and proves what the Owner directive
 * asked for without widening what any caller may see:
 *
 *  1. **Either keyboard finds the same record.** A phone number, a plate or a
 *     work-order number typed with Arabic-Indic digits matches its ASCII
 *     spelling, and a name typed without its hamza or diacritics matches the
 *     stored spelling that has them.
 *  2. **A phone matches exactly or by a tail of at least seven digits — never by
 *     four.** A four-digit tail is shared by too many people to be a lookup.
 *  3. **Plate search spans the whole history, and says so.** A hit on a plate the
 *     vehicle no longer carries reports `plateMatch.active === false`.
 *  4. **Nothing crosses a tenant.** The SAME phone and the SAME plate exist in
 *     tenant B, and a tenant-A search never returns them.
 *  5. **The projection narrows by permission, never widens.** The primary phone is
 *     masked to its last four digits unless the caller holds
 *     `iam.sensitive.view`; the owner's name on a vehicle row is null unless the
 *     caller holds `crm.customer.read`.
 *  6. **The allow-lists stay closed.** An unknown parameter and a one-character
 *     free-text fragment are refused with 422.
 *
 * Operations exercised: crm.customer-search, veh.vehicle-search,
 * wo.work-order-list. All three are PRE-EXISTING — this slice adds parameters and
 * projection fields to them and changes no permission, scope or guard — so this
 * suite adds no coverage-manifest entry, exactly as BR-05 did for the work-order
 * list.
 */
import { randomInt } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  TENANT_B_FULL,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as SEARCH_CUSTOMERS } from '@/app/api/v1/customers/route';
import { GET as SEARCH_VEHICLES } from '@/app/api/v1/vehicles/route';
import { GET as LIST_WORK_ORDERS } from '@/app/api/v1/work-orders/route';

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// Principals. Every role code and subject carries the `odsrch_` prefix so a
// reader can attribute a stray row to this suite at a glance; the rows live in
// the suite-standard tenants and are unwound by `cleanBackendFixtures`.
// ---------------------------------------------------------------------------
interface SearchPrincipal {
  readonly roleId: string;
  readonly userId: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
}

const CUSTOMER_READER: SearchPrincipal = {
  roleId: '0d5c0000-0000-4000-8000-0000000000a1',
  userId: '0d5c0000-0000-4000-8000-0000000000a2',
  subject: 'odsrch_customer_reader',
  tenantId: TENANT_A,
  permissions: ['crm.customer.read'],
};
const CUSTOMER_SENSITIVE: SearchPrincipal = {
  roleId: '0d5c0000-0000-4000-8000-0000000000b1',
  userId: '0d5c0000-0000-4000-8000-0000000000b2',
  subject: 'odsrch_customer_sensitive',
  tenantId: TENANT_A,
  permissions: ['crm.customer.read', 'iam.sensitive.view'],
};
const VEHICLE_READER: SearchPrincipal = {
  roleId: '0d5c0000-0000-4000-8000-0000000000c1',
  userId: '0d5c0000-0000-4000-8000-0000000000c2',
  subject: 'odsrch_vehicle_reader',
  tenantId: TENANT_A,
  permissions: ['veh.vehicle.read'],
};
const VEHICLE_AND_CUSTOMER_READER: SearchPrincipal = {
  roleId: '0d5c0000-0000-4000-8000-0000000000d1',
  userId: '0d5c0000-0000-4000-8000-0000000000d2',
  subject: 'odsrch_vehicle_customer_reader',
  tenantId: TENANT_A,
  permissions: ['veh.vehicle.read', 'crm.customer.read'],
};
const TENANT_B_READER: SearchPrincipal = {
  roleId: '0d5c0000-0000-4000-8000-0000000000e1',
  userId: '0d5c0000-0000-4000-8000-0000000000e2',
  subject: 'odsrch_tenant_b_reader',
  tenantId: TENANT_B,
  permissions: ['crm.customer.read', 'veh.vehicle.read'],
};
const SEARCH_PRINCIPALS = [
  CUSTOMER_READER,
  CUSTOMER_SENSITIVE,
  VEHICLE_READER,
  VEHICLE_AND_CUSTOMER_READER,
  TENANT_B_READER,
];

// ---------------------------------------------------------------------------
// Records. Tenant B deliberately holds the SAME phone number and the SAME plate
// as tenant A, so an isolation failure produces a wrong row rather than an
// absent one — which is the only kind of failure a search test can see.
// ---------------------------------------------------------------------------
const PARTNER_HAMZA = '0d5c0000-0000-4000-8000-000000000101';
const PARTNER_OMAR = '0d5c0000-0000-4000-8000-000000000102';
const PARTNER_TENANT_B = '0d5c0000-0000-4000-8000-000000000103';

/** "Odsrch <Ahmad with hamza above> Haddad". */
const HAMZA_NAME = 'Odsrch \u0623\u062D\u0645\u062F Haddad';
const OMAR_NUMBER = 'ODS-C-9001';

const SHARED_PHONE_RAW = '+962 79 555 1234';
const SHARED_PHONE = '+962795551234';

const MAKE_A = '0d5c0000-0000-4000-8000-000000000201';
const MODEL_A = '0d5c0000-0000-4000-8000-000000000202';
const VEHICLE_A = '0d5c0000-0000-4000-8000-000000000301';
const VEHICLE_A_SECOND = '0d5c0000-0000-4000-8000-000000000302';
const VEHICLE_A_FORMER = '0d5c0000-0000-4000-8000-000000000303';
const VEHICLE_B = '0d5c0000-0000-4000-8000-000000000304';

const VIN_A = 'ODSRCHVIN00000001';
const PAST_PLATE = 'ODS 1111';
const CURRENT_PLATE = 'ODS 2222';

async function seedPrincipal(principal: SearchPrincipal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', 'P1-32 search principal', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-32 search principal', $4)
     ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
         FROM iam.permissions p WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [principal.tenantId, principal.userId, principal.roleId, USER_A]
  );
}

/** Runs fixture writes as admin inside one transaction carrying the tenant context. */
type FixtureSql = (text: string, values?: readonly unknown[]) => Promise<unknown>;

async function asTenant(tenantId: string, work: (sql: FixtureSql) => Promise<void>) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, tenantId]
    );
    const sql: FixtureSql = (text, values) =>
      (client as PoolClient).query(text, values === undefined ? [] : [...values]);
    await work(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedCustomers(): Promise<void> {
  await asTenant(TENANT_A, async (sql) => {
    await sql(
      `INSERT INTO crm.business_partners
         (id, tenant_id, party_type, display_name, display_number, lifecycle_status, created_by)
       VALUES ($1, $2, 'individual', $3, NULL, 'active', $4),
              ($5, $2, 'individual', 'Odsrch Omar', $6, 'active', $4)`,
      [PARTNER_HAMZA, TENANT_A, HAMZA_NAME, USER_A, PARTNER_OMAR, OMAR_NUMBER]
    );
    await sql(
      `INSERT INTO crm.contact_points
         (tenant_id, partner_id, channel, normalized_value, raw_value, is_primary, created_by)
       VALUES ($1, $2, 'mobile', crm.normalize_phone($3), $3, true, $4),
              ($1, $5, 'phone', crm.normalize_phone('0791112233'), '0791112233', true, $4)`,
      [TENANT_A, PARTNER_HAMZA, SHARED_PHONE_RAW, USER_A, PARTNER_OMAR]
    );
  });
  await asTenant(TENANT_B, async (sql) => {
    await sql(
      `INSERT INTO crm.business_partners
         (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1, $2, 'individual', 'Odsrch Tenant B Holder', 'active', $3)`,
      [PARTNER_TENANT_B, TENANT_B, USER_A]
    );
    await sql(
      `INSERT INTO crm.contact_points
         (tenant_id, partner_id, channel, normalized_value, raw_value, is_primary, created_by)
       VALUES ($1, $2, 'mobile', crm.normalize_phone($3), $3, true, $4)`,
      [TENANT_B, PARTNER_TENANT_B, SHARED_PHONE_RAW, USER_A]
    );
  });
}

async function seedVehicles(): Promise<void> {
  await asTenant(TENANT_A, async (sql) => {
    await sql(
      `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by)
       VALUES ($1, 'tenant', $2, 'odsrch_make', 'Odsrchmotors', $3)`,
      [MAKE_A, TENANT_A, USER_A]
    );
    await sql(
      `INSERT INTO veh.models (id, scope, tenant_id, make_id, code, name, created_by)
       VALUES ($1, 'tenant', $2, $3, 'odsrch_model', 'Odsrchline', $4)`,
      [MODEL_A, TENANT_A, MAKE_A, USER_A]
    );
    await sql(
      `INSERT INTO veh.vehicles
         (id, tenant_id, vin_raw, make_id, model_id, model_year, powertrain_category,
          lifecycle_status, created_by)
       VALUES ($1, $2, $3, $4, $5, 2020, 'ice', 'active', $6),
              ($7, $2, NULL, NULL, NULL, NULL, 'ice', 'draft', $6),
              ($8, $2, NULL, NULL, NULL, NULL, 'ice', 'draft', $6)`,
      [VEHICLE_A, TENANT_A, VIN_A, MAKE_A, MODEL_A, USER_A, VEHICLE_A_SECOND, VEHICLE_A_FORMER]
    );
    // One past plate and one current plate on the same vehicle.
    await sql(
      `INSERT INTO veh.plate_history
         (tenant_id, vehicle_id, country_code, plate_raw, valid_from, valid_to, created_by)
       VALUES ($1, $2, 'JO', $3, DATE '2024-01-01', DATE '2025-01-01', $5),
              ($1, $2, 'JO', $4, DATE '2025-01-01', NULL, $5)`,
      [TENANT_A, VEHICLE_A, PAST_PLATE, CURRENT_PLATE, USER_A]
    );
    // The customer holds VEHICLE_A under TWO roles (one car), VEHICLE_A_SECOND
    // under one, and VEHICLE_A_FORMER under a CLOSED relationship. The count must
    // therefore be exactly two.
    await sql(
      `INSERT INTO veh.vehicle_relationships
         (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, valid_to, created_by)
       VALUES ($1, $2, $5, 'owner',  DATE '2025-01-01', NULL, $6),
              ($1, $2, $5, 'driver', DATE '2025-01-01', NULL, $6),
              ($1, $3, $5, 'owner',  DATE '2025-01-01', NULL, $6),
              ($1, $4, $5, 'owner',  DATE '2023-01-01', DATE '2024-01-01', $6)`,
      [TENANT_A, VEHICLE_A, VEHICLE_A_SECOND, VEHICLE_A_FORMER, PARTNER_HAMZA, USER_A]
    );
    await sql(
      `INSERT INTO veh.ownership_history
         (tenant_id, vehicle_id, partner_id, ownership_kind, valid_from, created_by)
       VALUES ($1, $2, $3, 'registered_owner', DATE '2025-01-01', $4)`,
      [TENANT_A, VEHICLE_A, PARTNER_HAMZA, USER_A]
    );
  });
  await asTenant(TENANT_B, async (sql) => {
    await sql(
      `INSERT INTO veh.vehicles (id, tenant_id, powertrain_category, lifecycle_status, created_by)
       VALUES ($1, $2, 'ice', 'draft', $3)`,
      [VEHICLE_B, TENANT_B, USER_A]
    );
    // Tenant B's CURRENT plate is tenant A's PAST plate.
    await sql(
      `INSERT INTO veh.plate_history
         (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
       VALUES ($1, $2, 'JO', $3, DATE '2025-06-01', $4)`,
      [TENANT_B, VEHICLE_B, PAST_PLATE, USER_A]
    );
  });
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  for (const principal of SEARCH_PRINCIPALS) await seedPrincipal(principal);
  await seedCustomers();
  await seedVehicles();
  runtime = runtimeAppPool(6);
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

function as(principal: SearchPrincipal): void {
  authAsSubject(principal.subject, principal.tenantId);
}

interface Page<T> {
  readonly items?: readonly T[];
  readonly code?: string;
}

async function read<T>(response: Response): Promise<{ status: number; body: Page<T> }> {
  return { status: response.status, body: (await response.json()) as Page<T> };
}

// ===========================================================================
// crm.customer-search
// ===========================================================================
interface CustomerHit {
  readonly id: string;
  readonly displayName: string;
  readonly primaryPhone: string | null;
  readonly phoneMasked: boolean;
  readonly vehicleCount: number;
}

const customers = async (query: string) =>
  read<CustomerHit>(
    await SEARCH_CUSTOMERS(new Request(`http://localhost/api/v1/customers?${query}`))
  );

const customerIds = async (query: string): Promise<string[]> => {
  const { status, body } = await customers(query);
  expect(status, query).toBe(200);
  return (body.items ?? []).map((hit) => hit.id);
};

describe('crm.customer-search — phone', () => {
  it('matches a normalized phone exactly, and never tenant B holding the same number', async () => {
    as(CUSTOMER_READER);
    const ids = await customerIds(`phone=${encodeURIComponent(SHARED_PHONE)}`);
    expect(ids).toEqual([PARTNER_HAMZA]);
    expect(ids).not.toContain(PARTNER_TENANT_B);
  });

  it('matches a seven-digit tail typed in Arabic-Indic digits', async () => {
    as(CUSTOMER_READER);
    const tail = '\u0665\u0665\u0665\u0661\u0662\u0663\u0664'; // 5551234
    expect(await customerIds(`phone=${encodeURIComponent(tail)}`)).toEqual([PARTNER_HAMZA]);
  });

  it('refuses to match a four-digit tail — too many people share one', async () => {
    as(CUSTOMER_READER);
    expect(await customerIds('phone=1234')).toEqual([]);
  });

  it('answers a phone with no digits in it with an empty page, never the first page', async () => {
    as(CUSTOMER_READER);
    // The tenant has customers, so an empty answer here is the impossible
    // predicate working, not an empty table.
    expect((await customerIds('')).length).toBeGreaterThan(0);
    expect(await customerIds('phone=abc')).toEqual([]);
  });

  it('tenant B, searching the same number, finds only its own customer', async () => {
    as(TENANT_B_READER);
    expect(await customerIds(`phone=${encodeURIComponent(SHARED_PHONE)}`)).toEqual([
      PARTNER_TENANT_B,
    ]);
  });
});

describe('crm.customer-search — name and free text', () => {
  it('finds a hamza-seated name from its bare-alef spelling, as a contains match', async () => {
    as(CUSTOMER_READER);
    const bare = '\u0627\u062D\u0645\u062F'; // Ahmad, bare alef
    expect(await customerIds(`name=${encodeURIComponent(bare)}`)).toContain(PARTNER_HAMZA);
    expect(await customerIds('name=haddad')).toContain(PARTNER_HAMZA);
  });

  it('q finds by part of the name, by customer number, and by phone digits', async () => {
    as(CUSTOMER_READER);
    expect(await customerIds('q=HADDAD')).toEqual([PARTNER_HAMZA]);
    expect(await customerIds(`q=${OMAR_NUMBER}`)).toEqual([PARTNER_OMAR]);
    const arabicDigits = '\u0660\u0667\u0669\u0661\u0661\u0661\u0662\u0662\u0663\u0663';
    expect(await customerIds(`q=${encodeURIComponent(arabicDigits)}`)).toEqual([PARTNER_OMAR]);
  });

  it('q holding no digit omits the phone arm and still answers', async () => {
    // A parameter bound but never referenced is refused by PostgreSQL, so this is
    // a 200 only if the phone arm and its parameter are omitted together.
    as(CUSTOMER_READER);
    expect(await customerIds('q=omar')).toEqual([PARTNER_OMAR]);
  });

  it('q never reaches tenant B', async () => {
    as(CUSTOMER_READER);
    expect(await customerIds('q=Tenant%20B%20Holder')).toEqual([]);
  });
});

describe('crm.customer-search — the projection', () => {
  it('masks the primary phone to its last four digits without iam.sensitive.view', async () => {
    as(CUSTOMER_READER);
    const { body } = await customers(`phone=${encodeURIComponent(SHARED_PHONE)}`);
    const hit = body.items?.[0];
    expect(hit?.primaryPhone).toBe('*********1234');
    expect(hit?.phoneMasked).toBe(true);
  });

  it('shows the primary phone in full to a holder of iam.sensitive.view', async () => {
    as(CUSTOMER_SENSITIVE);
    const { body } = await customers(`phone=${encodeURIComponent(SHARED_PHONE)}`);
    const hit = body.items?.[0];
    expect(hit?.primaryPhone).toBe(SHARED_PHONE);
    expect(hit?.phoneMasked).toBe(false);
  });

  it('counts distinct live vehicles: two roles on one car are one car, a closed link is none', async () => {
    as(CUSTOMER_READER);
    const { body } = await customers('q=haddad');
    expect(body.items?.[0]?.vehicleCount).toBe(2);
  });
});

describe('crm.customer-search — the allow-list stays closed', () => {
  it('refuses an unknown parameter', async () => {
    as(CUSTOMER_READER);
    const { status, body } = await customers('phoneNumber=0791112233');
    expect(status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });

  it('refuses a one-character free-text fragment', async () => {
    as(CUSTOMER_READER);
    const { status, body } = await customers('q=a');
    expect(status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
// veh.vehicle-search
// ===========================================================================
interface VehicleHit {
  readonly id: string;
  readonly makeName: string | null;
  readonly modelName: string | null;
  readonly modelYear: number | null;
  readonly activePlate: string | null;
  readonly plateMatch: {
    readonly plate: string;
    readonly active: boolean;
    readonly validFrom: string;
    readonly validTo: string | null;
  } | null;
  readonly customerDisplayName: string | null;
}

const vehicles = async (query: string) =>
  read<VehicleHit>(await SEARCH_VEHICLES(new Request(`http://localhost/api/v1/vehicles?${query}`)));

describe('veh.vehicle-search — plates across the whole history', () => {
  it('finds a vehicle by a plate it no longer carries, and reports the match as historical', async () => {
    as(VEHICLE_READER);
    const { status, body } = await vehicles('plate=ods-1111');
    expect(status).toBe(200);
    // Tenant B carries this plate TODAY; tenant A's search must still return only
    // tenant A's vehicle.
    expect((body.items ?? []).map((hit) => hit.id)).toEqual([VEHICLE_A]);
    const hit = body.items?.[0];
    expect(hit?.plateMatch).toEqual({
      plate: PAST_PLATE,
      active: false,
      validFrom: '2024-01-01',
      validTo: '2025-01-01',
    });
    expect(hit?.activePlate).toBe(CURRENT_PLATE);
  });

  it('reports a match on the current plate as active', async () => {
    as(VEHICLE_READER);
    const { body } = await vehicles(`plate=${encodeURIComponent(CURRENT_PLATE)}`);
    expect(body.items?.[0]?.plateMatch?.active).toBe(true);
  });

  it('matches a plate typed with Arabic-Indic digits', async () => {
    as(VEHICLE_READER);
    const typed = 'ODS \u0662\u0662\u0662\u0662';
    const { body } = await vehicles(`plate=${encodeURIComponent(typed)}`);
    expect((body.items ?? []).map((hit) => hit.id)).toEqual([VEHICLE_A]);
  });

  it('reports no plateMatch when the search did not ask about a plate', async () => {
    as(VEHICLE_READER);
    const { body } = await vehicles(`vin=${VIN_A}`);
    expect(body.items?.[0]?.plateMatch).toBeNull();
    expect(body.items?.[0]?.activePlate).toBe(CURRENT_PLATE);
  });
});

describe('veh.vehicle-search — make, model and free text', () => {
  it('matches folded fragments of the make and model names and publishes both names', async () => {
    as(VEHICLE_READER);
    const byMake = await vehicles('make=SRCHMOT');
    expect((byMake.body.items ?? []).map((hit) => hit.id)).toEqual([VEHICLE_A]);
    expect(byMake.body.items?.[0]?.makeName).toBe('Odsrchmotors');
    expect(byMake.body.items?.[0]?.modelName).toBe('Odsrchline');
    expect(byMake.body.items?.[0]?.modelYear).toBe(2020);

    const byModel = await vehicles('model=srchli');
    expect((byModel.body.items ?? []).map((hit) => hit.id)).toEqual([VEHICLE_A]);
  });

  it('q finds by part of a plate, reporting the plate it matched', async () => {
    as(VEHICLE_READER);
    const { body } = await vehicles('q=2222');
    expect((body.items ?? []).map((hit) => hit.id)).toEqual([VEHICLE_A]);
    expect(body.items?.[0]?.plateMatch?.plate).toBe(CURRENT_PLATE);
  });

  it('q finds by part of a VIN', async () => {
    as(VEHICLE_READER);
    const { body } = await vehicles('q=vin00000001');
    expect((body.items ?? []).map((hit) => hit.id)).toEqual([VEHICLE_A]);
  });

  it('answers a box that reduces to nothing under the VIN and plate rules', async () => {
    // '--' folds to a name fragment but to NO VIN and NO plate, so those two arms
    // and their parameters are omitted. A parameter bound but never referenced is
    // refused by PostgreSQL, so this is a 200 only if the omission is complete.
    as(VEHICLE_READER);
    const { status, body } = await vehicles('q=--');
    expect(status).toBe(200);
    expect(body.items ?? []).toEqual([]);
  });

  it('refuses a one-character free-text fragment and an unknown parameter', async () => {
    as(VEHICLE_READER);
    expect((await vehicles('q=x')).status).toBe(422);
    expect((await vehicles('color=red')).status).toBe(422);
  });
});

describe("veh.vehicle-search — the owner's name narrows by permission", () => {
  it('is null for a caller holding vehicle read alone', async () => {
    as(VEHICLE_READER);
    const { body } = await vehicles(`vin=${VIN_A}`);
    expect(body.items?.[0]?.customerDisplayName).toBeNull();
  });

  it('is the current owner for a caller who may also read customers', async () => {
    as(VEHICLE_AND_CUSTOMER_READER);
    const { body } = await vehicles(`vin=${VIN_A}`);
    expect(body.items?.[0]?.customerDisplayName).toBe(HAMZA_NAME);
  });
});

// ===========================================================================
// wo.work-order-list
// ===========================================================================
interface WorkOrderHit {
  readonly id: string;
  readonly displayNumber: string | null;
  readonly customer: { readonly displayName: string } | null;
}

const workOrders = async (query: string) =>
  read<WorkOrderHit>(
    await LIST_WORK_ORDERS(new Request(`http://localhost/api/v1/work-orders?${query}`))
  );

const branchA = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;

describe('wo.work-order-list — number and free text', () => {
  let workOrderId = '';
  let number = '';
  let numberDigits = '';
  let customerName = '';
  let vin = '';
  const plate = `ODSW ${randomInt(1000, 9999)}`;

  beforeAll(async () => {
    const order = await createOpenWorkOrder();
    workOrderId = order.workOrderId;
    numberDigits = String(randomInt(100000, 999999));
    number = `ODS-WO-${numberDigits}`;
    await asTenant(TENANT_A, async (sql) => {
      await sql(`UPDATE wo.work_orders SET display_number = $1 WHERE id = $2`, [
        number,
        workOrderId,
      ]);
      await sql(
        `INSERT INTO veh.plate_history
           (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
         VALUES ($1, $2, 'JO', $3, DATE '2026-01-01', $4)`,
        [TENANT_A, order.vehicleId, plate, USER_A]
      );
    });
    const stored = await admin.query<{ vin_normalized: string }>(
      `SELECT vin_normalized FROM veh.vehicles WHERE id = $1`,
      [order.vehicleId]
    );
    vin = stored.rows[0]?.vin_normalized ?? '';

    authAs(FULL);
    const { body } = await workOrders(`${branchA}&number=${number}`);
    customerName = body.items?.[0]?.customer?.displayName ?? '';
  });

  const ids = async (query: string): Promise<string[]> => {
    authAs(FULL);
    const { status, body } = await workOrders(query);
    expect(status, query).toBe(200);
    return (body.items ?? []).map((hit) => hit.id);
  };

  it('the fixture is real: the order carries a number, a customer name and a VIN', () => {
    // Without these the cases below would pass while searching for nothing.
    expect(number).toMatch(/^ODS-WO-\d{6}$/);
    expect(customerName.length).toBeGreaterThan(2);
    expect(vin.length).toBeGreaterThan(6);
  });

  it('matches an exact number, including one typed with Arabic-Indic digits', async () => {
    expect(await ids(`${branchA}&number=${number}`)).toEqual([workOrderId]);
    const arabic = numberDigits.replace(/\d/g, (digit) =>
      String.fromCharCode(0x0660 + Number.parseInt(digit, 10))
    );
    expect(await ids(`${branchA}&number=${encodeURIComponent(`ODS-WO-${arabic}`)}`)).toEqual([
      workOrderId,
    ]);
  });

  it('q matches part of the number, case-insensitively', async () => {
    // A contiguous piece of `ODS-WO-nnnnnn`, typed in lower case.
    expect(await ids(`${branchA}&q=wo-${numberDigits.slice(0, 4)}`)).toContain(workOrderId);
  });

  it("q matches part of the customer's name", async () => {
    const fragment = customerName.slice(0, Math.min(6, customerName.length)).toLowerCase();
    expect(await ids(`${branchA}&q=${encodeURIComponent(fragment)}`)).toContain(workOrderId);
  });

  it('q matches part of a plate and the tail of the VIN', async () => {
    expect(await ids(`${branchA}&q=${encodeURIComponent(plate.slice(-4))}`)).toContain(workOrderId);
    expect(await ids(`${branchA}&q=${vin.slice(-6)}`)).toContain(workOrderId);
  });

  it('q that matches nothing returns nothing', async () => {
    expect(await ids(`${branchA}&q=odsrch-no-such-thing`)).toEqual([]);
  });

  it('the box narrows a board and never widens one: company and branch stay required', async () => {
    authAs(FULL);
    const { status, body } = await workOrders(`q=${numberDigits}`);
    expect(status).toBe(422);
    expect(body.code).toBe('ERR-VAL-001');
  });

  it("tenant B, searching tenant A's number on its own board, finds nothing", async () => {
    authAs(TENANT_B_FULL);
    const { status, body } = await workOrders(
      `companyId=${COMPANY_B1}&branchId=${BRANCH_B1}&number=${number}`
    );
    expect(status).toBe(200);
    expect(body.items ?? []).toEqual([]);
  });

  it('refuses a one-character free-text fragment', async () => {
    authAs(FULL);
    expect((await workOrders(`${branchA}&q=1`)).status).toBe(422);
  });
});
