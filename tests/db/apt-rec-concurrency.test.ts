/**
 * Phase 1-8 dedicated Appointment/Reception concurrency suite (P1-08-QA).
 *
 * Every race uses two genuinely independent runtime connections in their own
 * transactions: c1 executes and holds its locks, c2 issues its statement while
 * c1 is still open, then c1 commits and c2's outcome is observed. Each race runs
 * five isolated repetitions; exactly one valid state must commit each time.
 *
 * Accepted loser SQLSTATEs (documented inline): 23P01 exclusion_violation,
 * 23505 unique_violation, 23514 check_violation (guard after lock release).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  TENANT_A,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const ctxA = { tenantId: TENANT_A, userId: USER_A };
const VA = 'c1000000-0000-4000-8000-0000000cc001';
const VB = 'c1000000-0000-4000-8000-0000000cc002';
const PA = 'c1000000-0000-4000-8000-0000000cc0c1';
const AT = 'c1000000-0000-4000-8000-0000000cc0d1';
const SC = 'c1000000-0000-4000-8000-0000000cc0d2';
const REPS = 5;

let admin: Pool;
let runtime: Pool;

async function race(
  first: (c: PoolClient) => Promise<unknown>,
  second: (c: PoolClient) => Promise<unknown>
): Promise<string | undefined> {
  const c1 = await runtime.connect();
  const c2 = await runtime.connect();
  try {
    await c1.query('BEGIN');
    await setContext(c1, ctxA);
    await c2.query('BEGIN');
    await setContext(c2, ctxA);
    await first(c1);
    const p2 = second(c2);
    p2.catch(() => {});
    await c1.query('COMMIT');
    let code: string | undefined;
    try {
      await p2;
      await c2.query('COMMIT');
    } catch (e) {
      code = (e as { code?: string }).code;
      await c2.query('ROLLBACK');
    }
    return code;
  } finally {
    c1.release();
    c2.release();
  }
}

// Remove all committed apt/rec business rows for the tenant between repetitions.
async function resetRace(): Promise<void> {
  for (const t of [
    'rec.reception_status_history',
    'rec.custody_history',
    'rec.authorizations',
    'rec.reception_party_roles',
    'rec.reception_visits',
    'rec.walk_in_references',
    'apt.appointment_status_history',
    'apt.appointments',
  ]) {
    await admin.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [TENANT_A]);
  }
}

const apptSql = (id: string, from: string, to: string) =>
  `INSERT INTO apt.appointments
     (id, tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, appointment_type_id,
      source_channel_id, requested_from, requested_to, confirmed_from, confirmed_to, lifecycle_status, created_by)
   VALUES ('${id}','${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${VA}','${PA}','${AT}','${SC}',
     '${from}','${to}','${from}','${to}','confirmed','${USER_A}')`;

const insVisitSql = (walkIn: string, vehicle: string) =>
  `INSERT INTO rec.reception_visits
     (tenant_id, company_id, branch_id, walk_in_id, vehicle_id, receiving_employee_id, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${walkIn}','${vehicle}','${USER_A}','${USER_A}')`;

const mkWalkIn = async (c: PoolClient | Pool, vehicle: string): Promise<string> =>
  (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${vehicle}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$3,'RACEVIN001','ice','active',$4),($2,$3,'RACEVIN002','ice','active',$4)`,
    [VA, VB, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual','Race Requester',$3)`,
    [PA, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_race_type','Race',$2)`,
    [AT, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.source_channels (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_race_chan','Race',$2)`,
    [SC, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('P1-08 concurrency — single-winner invariants (x5)', () => {
  it('same-Vehicle overlapping confirmed appointments: exactly one commits (loser 23P01)', async () => {
    for (let i = 0; i < REPS; i++) {
      await resetRace();
      const a = `c1000000-0000-4000-8000-0000000ca${String(i).padStart(3, '0')}`;
      const b = `c1000000-0000-4000-8000-0000000cb${String(i).padStart(3, '0')}`;
      const code = await race(
        (c1) => c1.query(apptSql(a, '2027-01-01T09:00:00Z', '2027-01-01T11:00:00Z')),
        (c2) => c2.query(apptSql(b, '2027-01-01T10:00:00Z', '2027-01-01T12:00:00Z'))
      );
      expect(code).toBe('23P01');
      const n = await admin.query(
        `SELECT count(*)::int n FROM apt.appointments WHERE tenant_id=$1 AND lifecycle_status='confirmed'`,
        [TENANT_A]
      );
      expect(n.rows[0].n).toBe(1);
    }
  });

  it('duplicate OPEN reception visit for a Vehicle: exactly one commits (loser 23505)', async () => {
    for (let i = 0; i < REPS; i++) {
      await resetRace();
      const code = await race(
        async (c1) => {
          const w = await mkWalkIn(c1, VA);
          await c1.query(insVisitSql(w, VA));
        },
        async (c2) => {
          const w = await mkWalkIn(c2, VA);
          await c2.query(insVisitSql(w, VA));
        }
      );
      expect(code).toBe('23505');
      const n = await admin.query(
        `SELECT count(*)::int n FROM rec.reception_visits WHERE tenant_id=$1 AND vehicle_id=$2`,
        [TENANT_A, VA]
      );
      expect(n.rows[0].n).toBe(1);
    }
  });

  it('duplicate custody acceptance for one visit: exactly one commits (loser 23505/23514)', async () => {
    for (let i = 0; i < REPS; i++) {
      await resetRace();
      const w = await mkWalkIn(admin, VA);
      const visit = (await admin.query(insVisitSql(w, VA) + ' RETURNING id')).rows[0].id;
      const accept = (c: PoolClient) =>
        c.query(
          `INSERT INTO rec.custody_history
             (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, actor_id)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}',NULL,'accepted','${USER_A}')`
        );
      const code = await race(accept, accept);
      expect(['23505', '23514']).toContain(code);
      const n = await admin.query(
        `SELECT count(*)::int n FROM rec.custody_history WHERE reception_visit_id=$1 AND to_state='accepted'`,
        [visit]
      );
      expect(n.rows[0].n).toBe(1);
    }
  });
});
