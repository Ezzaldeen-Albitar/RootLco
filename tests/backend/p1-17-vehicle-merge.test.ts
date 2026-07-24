/**
 * POST /api/v1/vehicles/{vehicleId}/merge — vehicle merge, end to end
 * (Phase 1-17, FR-VEH-003, P1-17-BE-004).
 *
 * Drives the real route through the fixed pipeline against a real database on the
 * least-privilege `app_runtime` role. The single INSERT into `veh.vehicle_merges`
 * is proven to redirect and freeze the source, record the merge, and publish
 * `vehicle.merged` (with the survivor as the aggregate) as one atomic fact — and to
 * refuse a self-merge, an already-merged source, a merged survivor, and a
 * cross-tenant survivor without becoming an existence oracle.
 *
 * Operations exercised here: veh.vehicle-merge.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-merge: route service authorization success denial cross-tenant audit outbox idempotency
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
import { POST as MERGE } from '@/app/api/v1/vehicles/[vehicleId]/merge/route';

const WRITER_ROLE_A = 'c1720000-0000-4000-8000-0000000000a1';
const WRITER_USER_A = 'c1720000-0000-4000-8000-0000000000a2';
const WRITER_SUBJECT_A = 'fx_p1_17_veh_merger_a';
const WRITER_ROLE_B = 'c1720000-0000-4000-8000-0000000000b1';
const WRITER_USER_B = 'c1720000-0000-4000-8000-0000000000b2';
const WRITER_SUBJECT_B = 'fx_p1_17_veh_merger_b';

const VEHICLES = 'http://localhost/api/v1/vehicles';

interface Body {
  readonly vehicleId?: string;
  readonly mergeId?: string;
  readonly sourceId?: string;
  readonly survivorId?: string;
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

function createVehicle(idempotencyKey = crypto.randomUUID()): Promise<Response> {
  return CREATE(
    new Request(VEHICLES, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({}),
    })
  );
}

function merge(
  sourceId: string,
  body: unknown,
  idempotencyKey = crypto.randomUUID()
): Promise<Response> {
  return MERGE(
    new Request(`${VEHICLES}/${sourceId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId: sourceId }) }
  );
}

async function newVehicleId(): Promise<string> {
  return ((await (await createVehicle()).json()) as Body).vehicleId ?? '';
}

async function seedMerger(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', 'Vehicle Merger', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-17 vehicle merger', $4)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('veh.vehicle.manage', 'veh.vehicle.merge')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

async function mergeAuditCount(sourceId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE action = 'veh.vehicle.merged' AND entity_id = $1`,
    [sourceId]
  );
  return Number(r.rows[0]?.n ?? '0');
}

async function mergeEventCount(survivorId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM shared.event_outbox
      WHERE event_type = 'vehicle.merged' AND aggregate_id = $1`,
    [survivorId]
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
     VALUES ('veh.vehicle.manage', 'veh', 'Create and edit vehicles in the caller tenant', 'medium', $1),
            ('veh.vehicle.merge',  'veh', 'Merge a duplicate vehicle into a survivor',      'high',   $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await seedMerger(TENANT_A, WRITER_ROLE_A, WRITER_USER_A, WRITER_SUBJECT_A);
  await seedMerger(TENANT_B, WRITER_ROLE_B, WRITER_USER_B, WRITER_SUBJECT_B);

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
    const response = await merge('00000000-0000-4000-8000-0000000000a0', {
      survivorId: '00000000-0000-4000-8000-0000000000a1',
      approvalRef: 'TCKT-1',
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as Body).code).toBe('ERR-IAM-002');
  });

  it('answers 403 for an authenticated caller lacking veh.vehicle.merge', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await merge('00000000-0000-4000-8000-0000000000a0', {
      survivorId: '00000000-0000-4000-8000-0000000000a1',
      approvalRef: 'TCKT-1',
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as Body).code).toBe('ERR-IAM-001');
  });
});

describe('a merge redirects and freezes the source atomically', () => {
  it('records the merge, redirects the source, and publishes one survivor-keyed event', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const source = await newVehicleId();
    const survivor = await newVehicleId();

    const response = await merge(source, { survivorId: survivor, approvalRef: 'TCKT-MERGE-1' });
    const body = (await response.json()) as Body;
    expect(response.status).toBe(200);
    expect(body.mergeId).toBeTruthy();
    expect(body.survivorId).toBe(survivor);

    const row = await admin.query<{ lifecycle_status: string; merged_into_id: string | null }>(
      `SELECT lifecycle_status, merged_into_id FROM veh.vehicles WHERE id = $1`,
      [source]
    );
    expect(row.rows[0]?.lifecycle_status).toBe('merged');
    expect(row.rows[0]?.merged_into_id).toBe(survivor);
    // The survivor is untouched.
    const surv = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM veh.vehicles WHERE id = $1`,
      [survivor]
    );
    expect(surv.rows[0]?.lifecycle_status).toBe('draft');

    expect(await mergeAuditCount(source)).toBe(1);
    expect(await mergeEventCount(survivor)).toBe(1);
  });

  it('publishes an event carrying only source, survivor, and merge ids', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const source = await newVehicleId();
    const survivor = await newVehicleId();
    await merge(source, { survivorId: survivor, approvalRef: 'TCKT-MERGE-2' });

    const event = await admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM shared.event_outbox
        WHERE event_type = 'vehicle.merged' AND aggregate_id = $1`,
      [survivor]
    );
    expect(Object.keys(event.rows[0]?.payload ?? {}).sort()).toEqual([
      'mergeId',
      'sourceId',
      'survivorId',
    ]);
  });

  it('replays a repeated merge with one key without merging twice', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const source = await newVehicleId();
    const survivor = await newVehicleId();
    const key = crypto.randomUUID();

    const first = (await (
      await merge(source, { survivorId: survivor, approvalRef: 'TCKT-IDEM' }, key)
    ).json()) as Body;
    const second = (await (
      await merge(source, { survivorId: survivor, approvalRef: 'TCKT-IDEM' }, key)
    ).json()) as Body;
    expect(second.mergeId).toBe(first.mergeId);

    const merges = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM veh.vehicle_merges WHERE source_vehicle_id = $1`,
      [source]
    );
    expect(merges.rows[0]?.n).toBe('1');
    expect(await mergeAuditCount(source)).toBe(1);
  });
});

describe('merge refusals', () => {
  it('rejects a self-merge with 422', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const v = await newVehicleId();
    const response = await merge(v, { survivorId: v, approvalRef: 'TCKT-SELF' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Body).code).toBe('ERR-VAL-001');
  });

  it('rejects a self-merge written in two letter cases with the same 422', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const v = await newVehicleId();

    // A uuid is case-insensitive and PostgreSQL compares it in canonical
    // lower-case, so both of these name one vehicle twice. Comparing the raw
    // strings would let them through to `ck_vehicle_merges_distinct`, which comes
    // back as a 409 inviting a retry that can never succeed — the request is
    // permanently invalid and must be refused as validation, in either orientation.
    const upperSurvivor = await merge(v, {
      survivorId: v.toUpperCase(),
      approvalRef: 'TCKT-SELF-CASE',
    });
    expect(upperSurvivor.status).toBe(422);
    expect(((await upperSurvivor.json()) as Body).code).toBe('ERR-VAL-001');

    const upperSource = await merge(v.toUpperCase(), {
      survivorId: v,
      approvalRef: 'TCKT-SELF-CASE-2',
    });
    expect(upperSource.status).toBe(422);
    expect(((await upperSource.json()) as Body).code).toBe('ERR-VAL-001');

    const merges = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM veh.vehicle_merges WHERE source_vehicle_id = $1`,
      [v]
    );
    expect(merges.rows[0]?.n).toBe('0');
  });

  it('rejects merging an already-merged source with 409', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const source = await newVehicleId();
    const survivor = await newVehicleId();
    const other = await newVehicleId();
    await merge(source, { survivorId: survivor, approvalRef: 'TCKT-FIRST' });

    const response = await merge(source, { survivorId: other, approvalRef: 'TCKT-SECOND' });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-002');
  });

  it('rejects merging into a survivor that is itself merged with 409', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const a = await newVehicleId();
    const b = await newVehicleId();
    const c = await newVehicleId();
    await merge(a, { survivorId: b, approvalRef: 'TCKT-AB' }); // a -> b, b lives

    // b is fine; now merge b into a? a is merged -> survivor merged -> 409.
    const response = await merge(c, { survivorId: a, approvalRef: 'TCKT-CA' });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-002');
  });

  it('answers 404 for an unknown source vehicle', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const survivor = await newVehicleId();
    const response = await merge('00000000-0000-4000-8000-0000000000fe', {
      survivorId: survivor,
      approvalRef: 'TCKT-X',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-001');
  });
});

describe('tenant isolation', () => {
  it('answers the same 404 for a survivor owned by another tenant (no existence oracle)', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const source = await newVehicleId();

    authenticateAs(WRITER_SUBJECT_B, TENANT_B);
    const theirSurvivor = await newVehicleId();

    authenticateAs(WRITER_SUBJECT_A);
    const response = await merge(source, { survivorId: theirSurvivor, approvalRef: 'TCKT-XT' });
    expect(response.status).toBe(404);
    expect(((await response.json()) as Body).code).toBe('ERR-RES-001');

    // The source was not touched by the failed merge.
    const row = await admin.query<{ lifecycle_status: string }>(
      `SELECT lifecycle_status FROM veh.vehicles WHERE id = $1`,
      [source]
    );
    expect(row.rows[0]?.lifecycle_status).toBe('draft');
  });
});
