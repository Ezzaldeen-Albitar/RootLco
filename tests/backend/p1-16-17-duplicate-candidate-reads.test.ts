/**
 * The duplicate-candidate review queues, end to end (P1-16/P1-17 remediation,
 * `P1-27-INT-005`).
 *
 * Both modules could record a scan and record a decision, and neither could list
 * what was waiting. A review screen's only way to see its own queue was to POST
 * a scan — a privileged write that emits an audit record — so opening the queue
 * would have written to the audit trail every time, and a re-scan is not a read.
 *
 * The two claims worth holding, beyond the usual isolation sweep:
 *
 *  1. **The queue is a read.** Listing emits no audit record. Asserted as a
 *     DELTA across the call, because a count taken once proves nothing about
 *     what the call did.
 *  2. **`match_basis` carries signals, never values.** The database guarantees
 *     it — `crm.jsonb_no_raw_value_keys` and `veh.valid_match_basis` — and this
 *     suite proves the guarantee is actually load-bearing by trying to insert a
 *     candidate whose basis carries a raw value and asserting the write is
 *     refused. A projection test alone would pass against a schema that had
 *     quietly stopped enforcing it.
 *
 * Operations exercised here: crm.duplicate-list, veh.vehicle-duplicate-list.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   crm.duplicate-list: route service authorization success denial cross-tenant
 *   veh.vehicle-duplicate-list: route service authorization success denial cross-tenant
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
  GET as LIST_CUSTOMER_DUPLICATES,
  DUPLICATE_LIST_OPERATION,
} from '@/app/api/v1/customer-duplicates/route';
import {
  GET as LIST_VEHICLE_DUPLICATES,
  VEHICLE_DUPLICATE_LIST_OPERATION,
} from '@/app/api/v1/vehicle-duplicates/route';

const ROLE = 'c1620000-0000-4000-8000-00000000d001';
const REVIEWER = 'c1620000-0000-4000-8000-00000000d002';
const SUBJECT = 'fx_p1_16_17_dup_reviewer';

const CUST_A1 = 'c1620000-0000-4000-8000-00000000d101';
const CUST_A2 = 'c1620000-0000-4000-8000-00000000d102';
const CUST_A3 = 'c1620000-0000-4000-8000-00000000d103';
const CUST_B1 = 'c1620000-0000-4000-8000-00000000d201';
const CUST_B2 = 'c1620000-0000-4000-8000-00000000d202';

const VEH_A1 = 'c1700000-0000-4000-8000-00000000d101';
const VEH_A2 = 'c1700000-0000-4000-8000-00000000d102';
const VEH_B1 = 'c1700000-0000-4000-8000-00000000d201';
const VEH_B2 = 'c1700000-0000-4000-8000-00000000d202';

const CAND_OPEN = 'c1620000-0000-4000-8000-00000000e101';
const CAND_DISMISSED = 'c1620000-0000-4000-8000-00000000e102';
const CAND_TENANT_B = 'c1620000-0000-4000-8000-00000000e103';
const VEH_CAND_OPEN = 'c1700000-0000-4000-8000-00000000e101';
const VEH_CAND_TENANT_B = 'c1700000-0000-4000-8000-00000000e102';

interface CandidateRow {
  readonly id: string;
  readonly displayNameA?: string | null;
  readonly displayNameB?: string | null;
  readonly displayNumberA?: string | null;
  readonly displayNumberB?: string | null;
  readonly matchScore?: string;
  readonly matchBasis?: unknown;
  readonly status?: string;
}
interface PageBody {
  readonly items?: readonly CandidateRow[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
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

function listCustomers(query = ''): Promise<Response> {
  return LIST_CUSTOMER_DUPLICATES(
    new Request(`http://localhost/api/v1/customer-duplicates${query}`, { method: 'GET' })
  );
}
function listVehicles(query = ''): Promise<Response> {
  return LIST_VEHICLE_DUPLICATES(
    new Request(`http://localhost/api/v1/vehicle-duplicates${query}`, { method: 'GET' })
  );
}

async function auditCount(): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records`
  );
  return Number(result.rows[0]?.n ?? '0');
}

/** Vehicle writes fire history triggers that refuse a row with no actor. */
async function asActor(
  statements: (run: (sql: string, values?: unknown[]) => Promise<unknown>) => Promise<void>
): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [REVIEWER]);
    await statements((sql, values = []) => client.query(sql, values));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('crm.customer.duplicate.review', 'crm', 'Scan for and review duplicate customer candidates', 'medium', $1),
            ('veh.vehicle.duplicate.review', 'veh', 'Scan for and review duplicate vehicle candidates', 'medium', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, 'dup-reviewer@example.test', 'Duplicate Reviewer', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [REVIEWER, TENANT_A, IDENTITY_PROVIDER, SUBJECT, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p1_16_17_dup', 'P1-16/17 duplicate reviewer', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('crm.customer.duplicate.review', 'veh.vehicle.duplicate.review')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [TENANT_A, REVIEWER, ROLE, USER_A]
  );

  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1, $6, 'individual', 'Nadia Khoury',   'active', $8),
            ($2, $6, 'individual', 'Nadia Khouri',   'active', $8),
            ($3, $6, 'individual', 'Unrelated Third','active', $8),
            ($4, $7, 'individual', 'Tenant B One',   'active', $8),
            ($5, $7, 'individual', 'Tenant B Two',   'active', $8)
     ON CONFLICT (id) DO NOTHING`,
    [CUST_A1, CUST_A2, CUST_A3, CUST_B1, CUST_B2, TENANT_A, TENANT_B, USER_A]
  );

  // `ck_duplicate_candidates_order` requires a < b, so the pairs are ordered
  // here rather than assumed — the fixture must satisfy the same invariant the
  // scanner does.
  const crmPair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);
  const [a1, a2] = crmPair(CUST_A1, CUST_A2);
  const [a1b, a3b] = crmPair(CUST_A1, CUST_A3);
  const [b1, b2] = crmPair(CUST_B1, CUST_B2);

  await admin.query(
    `INSERT INTO crm.duplicate_candidates
       (id, tenant_id, partner_id_a, partner_id_b, match_score, match_basis, status, created_by)
     VALUES ($1, $10, $4, $5, 0.9100, '[{"signal":"name","weight":60}]'::jsonb, 'open',      $12),
            ($2, $10, $6, $7, 0.8200, '[{"signal":"name","weight":50}]'::jsonb, 'dismissed', $12),
            ($3, $11, $8, $9, 0.9500, '[{"signal":"name","weight":70}]'::jsonb, 'open',      $12)`,
    [CAND_OPEN, CAND_DISMISSED, CAND_TENANT_B, a1, a2, a1b, a3b, b1, b2, TENANT_A, TENANT_B, USER_A]
  );

  await asActor(async (run) => {
    await run(
      `INSERT INTO veh.vehicles (id, tenant_id, display_number, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1, $5, 'V-0001', '1HGCM82633A100001', 'ice', 'active', $7),
              ($2, $5, 'V-0002', '1HGCM82633A100002', 'ice', 'active', $7),
              ($3, $6, 'V-B001', '1HGCM82633A200001', 'ice', 'active', $7),
              ($4, $6, 'V-B002', '1HGCM82633A200002', 'ice', 'active', $7)
       ON CONFLICT (id) DO NOTHING`,
      [VEH_A1, VEH_A2, VEH_B1, VEH_B2, TENANT_A, TENANT_B, USER_A]
    );
  });

  const vehPair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);
  const [va1, va2] = vehPair(VEH_A1, VEH_A2);
  const [vb1, vb2] = vehPair(VEH_B1, VEH_B2);
  await admin.query(
    `INSERT INTO veh.duplicate_candidates
       (id, tenant_id, vehicle_id_a, vehicle_id_b, match_score, match_basis, status, created_by)
     VALUES ($1, $6, $3, $4, 0.8800,
             '[{"basis":"vin_collision","classification":"restricted","weight":70}]'::jsonb, 'open', $8),
            ($2, $7, $5, $9, 0.9200,
             '[{"basis":"plate_collision","classification":"restricted","weight":60}]'::jsonb, 'open', $8)`,
    [VEH_CAND_OPEN, VEH_CAND_TENANT_B, va1, va2, vb1, TENANT_A, TENANT_B, USER_A, vb2]
  );

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

describe('the registrations themselves', () => {
  it('registers both queues as unaudited tenant reads on the review permissions', () => {
    // The registration the runtime enforces, not a comment. `auditClass: none`
    // is the whole point of this remediation: the only previous way to see the
    // queue was a scan POST, whose audit class is `privileged`.
    expect(DUPLICATE_LIST_OPERATION.id).toBe('crm.duplicate-list');
    expect(DUPLICATE_LIST_OPERATION.permissions).toEqual(['crm.customer.duplicate.review']);
    expect(DUPLICATE_LIST_OPERATION.auditClass).toBe('none');
    expect(DUPLICATE_LIST_OPERATION.idempotent ?? false).toBe(false);

    expect(VEHICLE_DUPLICATE_LIST_OPERATION.id).toBe('veh.vehicle-duplicate-list');
    expect(VEHICLE_DUPLICATE_LIST_OPERATION.permissions).toEqual(['veh.vehicle.duplicate.review']);
    expect(VEHICLE_DUPLICATE_LIST_OPERATION.auditClass).toBe('none');
    expect(VEHICLE_DUPLICATE_LIST_OPERATION.idempotent ?? false).toBe(false);
  });
});

describe('authentication and authorization', () => {
  it('answers 401 on both queues with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    for (const response of [await listCustomers(), await listVehicles()]) {
      expect(response.status).toBe(401);
    }
  });

  it('answers 403 on both queues without the review permission', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    for (const response of [await listCustomers(), await listVehicles()]) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as PageBody).code).toBe('ERR-IAM-001');
    }
  });
});

describe('the customer queue', () => {
  it('returns the tenant’s candidates with both display names resolved', async () => {
    authenticateAs(SUBJECT);
    const response = await listCustomers();
    const body = (await response.json()) as PageBody;
    expect(response.status).toBe(200);

    const open = body.items?.find((row) => row.id === CAND_OPEN);
    expect(open).toBeDefined();
    // A queue of uuid pairs is not reviewable, so both partners are joined.
    expect([open?.displayNameA, open?.displayNameB].sort()).toEqual([
      'Nadia Khouri',
      'Nadia Khoury',
    ]);
    // `numeric` stays a string. Parsing to a float here would let a rounding
    // artefact change which of two candidates a reviewer sees first.
    expect(typeof open?.matchScore).toBe('string');
    expect(Number(open?.matchScore)).toBeCloseTo(0.91, 4);
  });

  it('returns dismissed candidates too when no status filter is given', async () => {
    authenticateAs(SUBJECT);
    const body = (await (await listCustomers()).json()) as PageBody;
    // A reviewer auditing past decisions needs the dismissed ones. Defaulting to
    // `open` would hide them and make the default look like the whole truth.
    expect(body.items?.map((row) => row.id).sort()).toEqual([CAND_DISMISSED, CAND_OPEN].sort());
  });

  it('filters by status', async () => {
    authenticateAs(SUBJECT);
    const body = (await (await listCustomers('?status=open')).json()) as PageBody;
    expect(body.items?.map((row) => row.id)).toEqual([CAND_OPEN]);
  });

  it('never returns another tenant’s candidate', async () => {
    authenticateAs(SUBJECT);
    for (const query of ['', '?status=open', '?limit=100']) {
      const body = (await (await listCustomers(query)).json()) as PageBody;
      expect(
        body.items?.some((row) => row.id === CAND_TENANT_B),
        query
      ).toBe(false);
    }
  });

  it('refuses a status outside the schema vocabulary', async () => {
    authenticateAs(SUBJECT);
    const response = await listCustomers('?status=pending');
    expect(response.status).toBe(422);
  });

  it('refuses an unknown query parameter', async () => {
    authenticateAs(SUBJECT);
    expect((await listCustomers('?reviewed=true')).status).toBe(422);
  });
});

describe('the vehicle queue', () => {
  it('labels the pair by display number and publishes the signal, not the value', async () => {
    authenticateAs(SUBJECT);
    const response = await listVehicles();
    const body = (await response.json()) as PageBody;
    expect(response.status).toBe(200);

    const row = body.items?.find((item) => item.id === VEH_CAND_OPEN);
    expect(row).toBeDefined();
    expect([row?.displayNumberA, row?.displayNumberB].sort()).toEqual(['V-0001', 'V-0002']);
    // The reviewer learns the pair collided on its VIN. Neither VIN appears.
    expect(JSON.stringify(row?.matchBasis)).toContain('vin_collision');
    const text = JSON.stringify(body);
    expect(text).not.toContain('1HGCM82633A100001');
    expect(text).not.toContain('1HGCM82633A100002');
  });

  it('never returns another tenant’s candidate', async () => {
    authenticateAs(SUBJECT);
    const body = (await (await listVehicles('?limit=100')).json()) as PageBody;
    expect(body.items?.some((row) => row.id === VEH_CAND_TENANT_B)).toBe(false);
  });
});

describe('the queue is a read', () => {
  it('writes no audit record, measured as a delta', async () => {
    authenticateAs(SUBJECT);
    const before = await auditCount();
    await listCustomers();
    await listVehicles();
    const after = await auditCount();
    // A delta, not an absolute count. `expect(count).toBe(0)` would pass on a
    // database that already had audit rows and would prove nothing about what
    // these two calls did.
    expect(after - before).toBe(0);
  });
});

describe('match_basis cannot carry a raw value', () => {
  it('is refused by the database, not merely absent from the projection', async () => {
    // The projection tests above would pass against a schema that had quietly
    // stopped enforcing this. Proving the constraint still bites is what makes
    // publishing `matchBasis` safe rather than merely currently-harmless.
    await expect(
      admin.query(
        `INSERT INTO crm.duplicate_candidates
           (tenant_id, partner_id_a, partner_id_b, match_score, match_basis, created_by)
         VALUES ($1, $2, $3, 0.5000, '[{"signal":"name","raw_value":"Nadia Khoury"}]'::jsonb, $4)`,
        [TENANT_A, CUST_A2, CUST_A3, USER_A]
      )
    ).rejects.toThrow(/ck_duplicate_candidates_basis/);
  });

  it('refuses an unapproved key on the vehicle side', async () => {
    await expect(
      admin.query(
        `INSERT INTO veh.duplicate_candidates
           (tenant_id, vehicle_id_a, vehicle_id_b, match_score, match_basis, created_by)
         VALUES ($1, $2, $3, 0.5000,
                 '[{"basis":"vin_collision","classification":"restricted","vin":"1HGCM82633A100001"}]'::jsonb,
                 $4)`,
        [TENANT_A, VEH_A1 < VEH_A2 ? VEH_A1 : VEH_A2, VEH_A1 < VEH_A2 ? VEH_A2 : VEH_A1, USER_A]
      )
    ).rejects.toThrow(/ck_duplicate_candidates_basis|duplicate key/);
  });
});
