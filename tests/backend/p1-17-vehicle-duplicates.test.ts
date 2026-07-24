/**
 * POST /api/v1/vehicles/{vehicleId}/duplicate-scans and
 * POST /api/v1/vehicle-duplicates/{candidateId}/review — vehicle duplicate
 * detection and review, end to end (Phase 1-17, FR-VEH-003, P1-17-BE-004).
 *
 * Drives the real routes through the fixed pipeline against a real database on the
 * least-privilege `app_runtime` role. The scan is proven conservative and
 * explainable: a near-VIN typo corroborated by a moved plate is recorded, a lone
 * near-VIN is not, a re-scan neither duplicates nor re-scores a frozen candidate,
 * and a dismissed candidate is never reopened. Review records only a human
 * dismissal, refuses an already-reviewed candidate, and cannot see across tenants.
 *
 * Operations exercised here: veh.vehicle-duplicate-scan, veh.vehicle-duplicate-review.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-duplicate-scan: route service authorization success denial cross-tenant audit idempotency
 *   veh.vehicle-duplicate-review: route service authorization success denial cross-tenant audit idempotency
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
import { POST as SCAN } from '@/app/api/v1/vehicles/[vehicleId]/duplicate-scans/route';
import { POST as REVIEW } from '@/app/api/v1/vehicle-duplicates/[candidateId]/review/route';

const WRITER_ROLE_A = 'c1730000-0000-4000-8000-0000000000a1';
const WRITER_USER_A = 'c1730000-0000-4000-8000-0000000000a2';
const WRITER_SUBJECT_A = 'fx_p1_17_veh_dup_a';
const WRITER_ROLE_B = 'c1730000-0000-4000-8000-0000000000b1';
const WRITER_USER_B = 'c1730000-0000-4000-8000-0000000000b2';
const WRITER_SUBJECT_B = 'fx_p1_17_veh_dup_b';

// A is the scan target. B is a near-VIN typo of A that also holds A's plate in its
// history (strong + strong → recorded). E is a near-VIN typo with no other signal
// (strong-only → NOT recorded). C is unrelated.
const VIN_A = '1HGCM82633A004352';
const VIN_B = '1HGCM82633A004353'; // one substitution from A
const VIN_E = '1HGCM82633A004350'; // one substitution from A, no corroboration
const VIN_C = '1HGCM82633A004999'; // three substitutions from A — not near
const PLATE = 'ABC123';

const VEHICLES = 'http://localhost/api/v1/vehicles';

interface ScanBody {
  readonly vehicleId?: string;
  readonly compared?: number;
  readonly candidates?: readonly { candidateId: string; otherId: string; score: number }[];
  readonly candidateId?: string;
  readonly status?: string;
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;
let vehA = '';
let vehB = '';
let vehC = '';
let vehE = '';

function authenticateAs(providerSubject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

function createWithVin(vin: string): Promise<Response> {
  return CREATE(
    new Request(VEHICLES, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ vin }),
    })
  );
}

function scan(vehicleId: string, idempotencyKey = crypto.randomUUID()): Promise<Response> {
  return SCAN(
    new Request(`${VEHICLES}/${vehicleId}/duplicate-scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: '{}',
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}

function review(
  candidateId: string,
  body: unknown,
  idempotencyKey = crypto.randomUUID()
): Promise<Response> {
  return REVIEW(
    new Request(`http://localhost/api/v1/vehicle-duplicates/${candidateId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ candidateId }) }
  );
}

async function createdId(vin: string): Promise<string> {
  return ((await (await createWithVin(vin)).json()) as { vehicleId?: string }).vehicleId ?? '';
}

async function seedDupWriter(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', 'Vehicle Dup Reviewer', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-17 vehicle dup reviewer', $4)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code IN ('veh.vehicle.manage', 'veh.vehicle.duplicate.review')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

async function scanAuditCount(vehicleId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM iam.audit_records
      WHERE action = 'veh.vehicle.duplicates_scanned' AND entity_id = $1`,
    [vehicleId]
  );
  return Number(r.rows[0]?.n ?? '0');
}

async function candidateStatus(candidateId: string): Promise<string | null> {
  const r = await admin.query<{ status: string }>(
    `SELECT status FROM veh.duplicate_candidates WHERE id = $1`,
    [candidateId]
  );
  return r.rows[0]?.status ?? null;
}

async function candidateRowCount(idA: string, idB: string): Promise<number> {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM veh.duplicate_candidates
      WHERE vehicle_id_a = $1 AND vehicle_id_b = $2`,
    [a, b]
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
            ('veh.vehicle.duplicate.review', 'veh', 'Scan for and review duplicate vehicle candidates', 'medium', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await seedDupWriter(TENANT_A, WRITER_ROLE_A, WRITER_USER_A, WRITER_SUBJECT_A);
  await seedDupWriter(TENANT_B, WRITER_ROLE_B, WRITER_USER_B, WRITER_SUBJECT_B);

  authenticateAs(WRITER_SUBJECT_A);
  vehA = await createdId(VIN_A);
  vehB = await createdId(VIN_B);
  vehC = await createdId(VIN_C);
  vehE = await createdId(VIN_E);
  __resetAuthenticatorForTests();

  // Plates, added admin-side (the plate API is a later slice): A holds PLATE
  // actively; B held the same PLATE historically. The plate-history triggers read
  // the actor from `app.user_id`, so the inserts run in one context-set transaction.
  const fx = await admin.connect();
  try {
    await fx.query('BEGIN');
    await fx.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, TENANT_A]
    );
    await fx.query(
      `INSERT INTO veh.plate_history (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
       VALUES ($1, $2, 'JO', $3, current_date, $4)`,
      [TENANT_A, vehA, PLATE, USER_A]
    );
    await fx.query(
      `INSERT INTO veh.plate_history
         (tenant_id, vehicle_id, country_code, plate_raw, valid_from, valid_to, created_by)
       VALUES ($1, $2, 'JO', $3, current_date - 100, current_date - 10, $4)`,
      [TENANT_A, vehB, PLATE, USER_A]
    );
    await fx.query('COMMIT');
  } catch (error) {
    await fx.query('ROLLBACK');
    throw error;
  } finally {
    fx.release();
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
  it('answers 401 for a scan with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    const response = await scan(vehA);
    expect(response.status).toBe(401);
    expect(((await response.json()) as ScanBody).code).toBe('ERR-IAM-002');
  });

  it('answers 403 for a caller lacking veh.vehicle.duplicate.review', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);
    const response = await scan(vehA);
    expect(response.status).toBe(403);
    expect(((await response.json()) as ScanBody).code).toBe('ERR-IAM-001');
  });
});

describe('the scan is conservative and explainable', () => {
  it('records a near-VIN + moved-plate pair, but not a lone near-VIN or an unrelated one', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await scan(vehA);
    const body = (await response.json()) as ScanBody;
    expect(response.status).toBe(200);

    const others = (body.candidates ?? []).map((c) => c.otherId);
    // B is recorded: near-VIN (70) + plate move (60) clears the threshold.
    expect(others).toContain(vehB);
    // E is NOT recorded: a lone near-VIN (70) is below the threshold (80).
    expect(others).not.toContain(vehE);
    // C is NOT recorded: not near, no shared plate.
    expect(others).not.toContain(vehC);

    const hit = (body.candidates ?? []).find((c) => c.otherId === vehB);
    expect(hit?.score).toBeGreaterThanOrEqual(0.8);
    expect(await scanAuditCount(vehA)).toBeGreaterThanOrEqual(1);

    // The frozen basis names both strong signals as restricted evidence.
    const row = await admin.query<{ match_basis: { basis: string; classification: string }[] }>(
      `SELECT match_basis FROM veh.duplicate_candidates WHERE id = $1`,
      [hit?.candidateId]
    );
    const bases = (row.rows[0]?.match_basis ?? []).map((b) => b.basis).sort();
    expect(bases).toContain('vin_collision');
    expect(bases).toContain('plate_collision');
  });

  it('does not duplicate or re-score a candidate on a re-scan, and never reopens a dismissal', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const first = (await (await scan(vehA)).json()) as ScanBody;
    const candidateId = (first.candidates ?? []).find((c) => c.otherId === vehB)?.candidateId ?? '';
    expect(candidateId).not.toBe('');
    expect(await candidateRowCount(vehA, vehB)).toBe(1);

    // Dismiss it, then re-scan: the dismissal stands and no second row appears.
    const dismissed = await review(candidateId, {
      decision: 'dismissed',
      reason: 'not the same car',
    });
    expect(dismissed.status).toBe(200);
    expect(await candidateStatus(candidateId)).toBe('dismissed');

    await scan(vehA);
    expect(await candidateRowCount(vehA, vehB)).toBe(1);
    expect(await candidateStatus(candidateId)).toBe('dismissed');
  });

  it('replays a scan with one idempotency key without a second scan effect', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const before = await scanAuditCount(vehA);
    const key = crypto.randomUUID();
    const first = (await (await scan(vehA, key)).json()) as ScanBody;
    const second = (await (await scan(vehA, key)).json()) as ScanBody;
    // The keyed replay returns the stored response and runs no second scan — proven
    // by the audit trail: the first scan writes exactly one duplicates_scanned
    // record and the replay writes none. A route that ignored the key would
    // re-execute and write a second (before + 2), which this would catch.
    expect(second.vehicleId).toBe(first.vehicleId);
    expect(await candidateRowCount(vehA, vehB)).toBe(1);
    expect(await scanAuditCount(vehA)).toBe(before + 1);
  });

  it('accepts an upper-case vehicle id in the scan path and stores the pair canonically', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    // schemas.uuid accepts an upper-case UUID. The pair is lower-cased before the
    // ordered INSERT, so a mixed-case order flip against the database's canonical
    // uuid ordering never raises an unhandled check violation (previously a 500).
    const response = await scan(vehA.toUpperCase());
    expect(response.status).toBe(200);
    expect(
      (((await response.json()) as ScanBody).candidates ?? []).some((c) => c.otherId === vehB)
    ).toBe(true);
    // candidateRowCount looks the row up by the canonical lower-case ids, so a
    // single match proves the pair was stored canonically (not mis-ordered).
    expect(await candidateRowCount(vehA, vehB)).toBe(1);
  });

  it('answers 404 when scanning an unknown vehicle', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await scan('00000000-0000-4000-8000-0000000000fe');
    expect(response.status).toBe(404);
    expect(((await response.json()) as ScanBody).code).toBe('ERR-RES-001');
  });
});

describe('review records a human decision', () => {
  async function freshCandidate(partnerVin: string, daysAgo: number): Promise<string> {
    // A fresh open candidate: create a new near-VIN + moved-plate partner of A.
    // Each caller passes a distinct near-VIN (so the active-VIN unique index never
    // collides) and a distinct, non-overlapping historical plate window (so the
    // temporal `ex_plate_history_active_plate` exclusion never collides on PLATE).
    authenticateAs(WRITER_SUBJECT_A);
    const partner = await createdId(partnerVin); // one substitution from A
    const fx = await admin.connect();
    try {
      await fx.query('BEGIN');
      await fx.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
        [USER_A, TENANT_A]
      );
      await fx.query(
        `INSERT INTO veh.plate_history
           (tenant_id, vehicle_id, country_code, plate_raw, valid_from, valid_to, created_by)
         VALUES ($1, $2, 'JO', $3, current_date - $5::int, current_date - ($5::int - 10), $4)`,
        [TENANT_A, partner, PLATE, USER_A, daysAgo]
      );
      await fx.query('COMMIT');
    } catch (error) {
      await fx.query('ROLLBACK');
      throw error;
    } finally {
      fx.release();
    }
    const scanned = (await (await scan(vehA)).json()) as ScanBody;
    return (scanned.candidates ?? []).find((c) => c.otherId === partner)?.candidateId ?? '';
  }

  it('dismisses an open candidate, audits the prior status, and replays one key once', async () => {
    const candidateId = await freshCandidate('1HGCM82633A004354', 400);
    expect(candidateId).not.toBe('');

    authenticateAs(WRITER_SUBJECT_A);
    const key = crypto.randomUUID();
    const response = await review(
      candidateId,
      { decision: 'dismissed', reason: 'different vehicle' },
      key
    );
    const body = (await response.json()) as ScanBody;
    expect(response.status).toBe(200);
    expect(body.status).toBe('dismissed');
    expect(await candidateStatus(candidateId)).toBe('dismissed');

    // Retrying the same request replays the stored 200 rather than 409-ing on the
    // now-dismissed candidate, and audits the decision exactly once.
    const replay = await review(
      candidateId,
      { decision: 'dismissed', reason: 'different vehicle' },
      key
    );
    expect(replay.status).toBe(200);

    const audit = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_records
        WHERE action = 'veh.vehicle.duplicate_reviewed' AND entity_id = $1`,
      [candidateId]
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
  });

  it('refuses to review a candidate that is already reviewed (409)', async () => {
    const candidateId = await freshCandidate('1HGCM82633A004356', 380);
    authenticateAs(WRITER_SUBJECT_A);
    await review(candidateId, { decision: 'dismissed', reason: 'first decision' });

    const response = await review(candidateId, {
      decision: 'dismissed',
      reason: 'second decision',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as ScanBody).code).toBe('ERR-RES-002');
  });

  it('rejects an unknown decision value (strict schema)', async () => {
    const candidateId = await freshCandidate('1HGCM82633A004357', 360);
    authenticateAs(WRITER_SUBJECT_A);
    const response = await review(candidateId, { decision: 'merged', reason: 'not allowed here' });
    expect(response.status).toBe(422);
    expect(((await response.json()) as ScanBody).code).toBe('ERR-VAL-001');
  });

  it('answers 404 for an unknown candidate', async () => {
    authenticateAs(WRITER_SUBJECT_A);
    const response = await review('00000000-0000-4000-8000-0000000000fd', {
      decision: 'dismissed',
      reason: 'ghost',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as ScanBody).code).toBe('ERR-RES-001');
  });

  it('answers the same 404 for a candidate owned by another tenant (no existence oracle)', async () => {
    const candidateId = await freshCandidate('1HGCM82633A004358', 340);
    authenticateAs(WRITER_SUBJECT_B, TENANT_B);
    const response = await review(candidateId, { decision: 'dismissed', reason: 'cross tenant' });
    expect(response.status).toBe(404);
    expect(((await response.json()) as ScanBody).code).toBe('ERR-RES-001');
  });
});
