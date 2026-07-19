/**
 * Phase 1-7 dedicated Vehicle concurrency suite (P1-07-QA-008).
 *
 * Every race uses two GENUINELY independent runtime connections in their own
 * transactions: c1 executes and holds its locks, c2 issues its statement while
 * c1 is still open (the promise is created before c1 commits, so the statements
 * are concurrently in flight), then c1 commits and c2's outcome is observed.
 * Single-winner races prove exactly one valid committed state and document the
 * accepted loser SQLSTATEs; serialize-both races prove both effects commit with
 * no lost update and no missing history.
 *
 * Accepted loser SQLSTATEs per race (documented inline):
 *   23505 unique_violation, 23P01 exclusion_violation, 23514 check_violation
 *   (guard rejection after the lock is released), 40001 serialization_failure,
 *   40P01 deadlock_detected (legitimate loser only — the winner's state commits).
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
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  USER_A,
} from './helpers';

const ctxA = { tenantId: TENANT_A, userId: USER_A };

// Deterministic fixtures (valid hex only).
const V = {
  VIN1: 'f0000000-0000-4000-8000-0000000cc001',
  VIN2: 'f0000000-0000-4000-8000-0000000cc002',
  PLATE1: 'f0000000-0000-4000-8000-0000000cc003',
  PLATE2: 'f0000000-0000-4000-8000-0000000cc004',
  ENG: 'f0000000-0000-4000-8000-0000000cc005',
  TRANS: 'f0000000-0000-4000-8000-0000000cc006',
  EVRACE: 'f0000000-0000-4000-8000-0000000cc007',
  BATT: 'f0000000-0000-4000-8000-0000000cc008',
  OWN: 'f0000000-0000-4000-8000-0000000cc009',
  REL: 'f0000000-0000-4000-8000-0000000cc00a',
  ODO: 'f0000000-0000-4000-8000-0000000cc00b',
  STATUS: 'f0000000-0000-4000-8000-0000000cc00c',
  DUPA: 'f0000000-0000-4000-8000-0000000cc00d',
  DUPB: 'f0000000-0000-4000-8000-0000000cc00e',
  MSRC: 'f0000000-0000-4000-8000-0000000cc00f',
  MS2: 'f0000000-0000-4000-8000-0000000cc010',
  MS3: 'f0000000-0000-4000-8000-0000000cc011',
  SYMA: 'f0000000-0000-4000-8000-0000000cc012',
  SYMB: 'f0000000-0000-4000-8000-0000000cc013',
  RV: 'f0000000-0000-4000-8000-0000000cc014',
  IDENT: 'f0000000-0000-4000-8000-0000000cc015',
};
const PARTNER1 = 'f0000000-0000-4000-8000-0000000cd001';
const PARTNER2 = 'f0000000-0000-4000-8000-0000000cd002';

let admin: Pool;
let runtime: Pool;

/**
 * Lock-step race on two independent connections.
 * first(c1) runs and holds locks; second(c2) is ISSUED while c1 is open (its
 * promise starts before the commit); c1 commits; the c2 outcome resolves.
 * Returns c2's error code (undefined if it succeeded). Both transactions are
 * COMMITTED (winner semantics are proven against committed state) unless c2
 * failed, in which case c2 rolls back.
 */
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
    const p2 = second(c2); // in flight while c1 holds its locks
    // Attach a handler IMMEDIATELY: p2 may reject during the COMMIT await tick,
    // and an unattended rejection fails the vitest run (unhandled rejection)
    // even when every assertion passes. The outcome is still inspected below.
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

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  const vals = Object.values(V)
    .map(
      (id, i) =>
        `('${id}','${TENANT_A}','CCVIN${String(i).padStart(4, '0')}','ev','active','${USER_A}')`
    )
    .join(',');
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES ${vals}`
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by) VALUES
       ($1,$3,'individual','Race Partner 1',$4),
       ($2,$3,'individual','Race Partner 2',$4)`,
    [PARTNER1, PARTNER2, TENANT_A, USER_A]
  );
  // Onboarding-path provisioning of the per-tenant vehicle display sequence
  // (admin-side; never seeded).
  await admin.query(
    `INSERT INTO shared.number_sequences (tenant_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1,'vehicle','VEH-',6,$2)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('QA-008 §1 display-number allocation', () => {
  it('concurrent allocations serialize on the sequence row and never duplicate', async () => {
    let n1 = '';
    const code = await race(
      async (c1) => {
        n1 = (await c1.query(`SELECT display_number FROM shared.next_display_number('vehicle')`))
          .rows[0].display_number;
      },
      async (c2) => {
        const n2 = (
          await c2.query(`SELECT display_number FROM shared.next_display_number('vehicle')`)
        ).rows[0].display_number;
        expect(n2).not.toBe(n1);
      }
    );
    expect(code).toBeUndefined(); // both succeed with DISTINCT numbers
  });
});

describe('QA-008 §2/§3 VIN + alternate identifier uniqueness', () => {
  it('concurrent same active VIN: exactly one winner (loser 23505)', async () => {
    const code = await race(
      (c1) => c1.query(`UPDATE veh.vehicles SET vin_raw='RACEVIN001' WHERE id=$1`, [V.VIN1]),
      (c2) => c2.query(`UPDATE veh.vehicles SET vin_raw='RACEVIN001' WHERE id=$1`, [V.VIN2])
    );
    expect(code).toBe('23505');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.vehicles WHERE tenant_id=$1 AND vin_normalized='RACEVIN001'`,
      [TENANT_A]
    );
    expect(n.rows[0].n).toBe(1); // exactly one committed holder
  });

  it('concurrent same active alternate identifier: one winner (loser 23505)', async () => {
    const ins = (vehicle: string) =>
      `INSERT INTO veh.vehicle_identifiers (tenant_id, vehicle_id, identifier_type, raw_value, normalized_value, classification, created_by)
       VALUES ('${TENANT_A}','${vehicle}','fleet_no','FLT-9','FLT9','internal','${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins(V.IDENT)),
      (c2) => c2.query(ins(V.VIN2))
    );
    expect(code).toBe('23505');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.vehicle_identifiers WHERE normalized_value='FLT9' AND status='active'`
    );
    expect(n.rows[0].n).toBe(1);
  });
});

describe('QA-008 §4 active plate assignment', () => {
  it('the same open plate on two Vehicles: one winner (loser 23P01)', async () => {
    const ins = (vehicle: string) =>
      `INSERT INTO veh.plate_history (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
       VALUES ('${TENANT_A}','${vehicle}','JO','RACE 111','2024-01-01','${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins(V.PLATE1)),
      (c2) => c2.query(ins(V.PLATE2))
    );
    expect(code).toBe('23P01');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.plate_history WHERE plate_normalized='RACE111' AND valid_to IS NULL`
    );
    expect(n.rows[0].n).toBe(1);
  });
});

describe('QA-008 §5/§6 engine + transmission interval replacement', () => {
  it('overlapping engine intervals: one winner (loser 23P01)', async () => {
    const ins = (from: string) =>
      `INSERT INTO veh.engine_history (tenant_id, vehicle_id, valid_from, created_by)
       VALUES ('${TENANT_A}','${V.ENG}','${from}','${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins('2024-01-01')),
      (c2) => c2.query(ins('2024-06-01'))
    );
    expect(code).toBe('23P01');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.engine_history WHERE vehicle_id=$1 AND valid_to IS NULL`,
      [V.ENG]
    );
    expect(n.rows[0].n).toBe(1); // exactly one open interval
  });

  it('overlapping transmission intervals: one winner (loser 23P01)', async () => {
    const ins = (from: string) =>
      `INSERT INTO veh.transmission_history (tenant_id, vehicle_id, transmission_type, valid_from, created_by)
       VALUES ('${TENANT_A}','${V.TRANS}','automatic','${from}','${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins('2024-01-01')),
      (c2) => c2.query(ins('2024-06-01'))
    );
    expect(code).toBe('23P01');
  });
});

describe('QA-008 §7 EV-profile vs powertrain change', () => {
  it('powertrain flips to ice while a profile INSERT is in flight: profile loses (23514)', async () => {
    const code = await race(
      (c1) => c1.query(`UPDATE veh.vehicles SET powertrain_category='ice' WHERE id=$1`, [V.EVRACE]),
      (c2) =>
        c2.query(
          `INSERT INTO veh.vehicle_ev_profiles (tenant_id, vehicle_id, ev_kind, created_by)
           VALUES ($1,$2,'bev',$3)`,
          [TENANT_A, V.EVRACE, USER_A]
        )
    );
    expect(code).toBe('23514'); // FOR SHARE guard re-reads committed 'ice'
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.vehicle_ev_profiles WHERE vehicle_id=$1`,
      [V.EVRACE]
    );
    expect(n.rows[0].n).toBe(0); // no invalid ev-profile/ice combination
  });
});

describe('QA-008 §8 active traction battery', () => {
  it('two concurrent active traction batteries: one winner (loser 23505)', async () => {
    const ins = (ref: string) =>
      `INSERT INTO veh.battery_masters (tenant_id, vehicle_id, battery_ref, battery_role, installed_on, status, created_by)
       VALUES ('${TENANT_A}','${V.BATT}','${ref}','traction','2024-01-01','active','${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins('BAT-A')),
      (c2) => c2.query(ins('BAT-B'))
    );
    expect(code).toBe('23505');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.battery_masters WHERE vehicle_id=$1 AND status='active' AND battery_role='traction'`,
      [V.BATT]
    );
    expect(n.rows[0].n).toBe(1);
  });
});

describe('QA-008 §9/§10 ownership transfer + relationship interval', () => {
  it('two concurrent open registered-owner intervals: one winner (loser 23P01) — no split-brain', async () => {
    const ins = (partner: string) =>
      `INSERT INTO veh.ownership_history (tenant_id, vehicle_id, partner_id, ownership_kind, valid_from, created_by)
       VALUES ('${TENANT_A}','${V.OWN}','${partner}','registered_owner','2024-01-01','${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins(PARTNER1)),
      (c2) => c2.query(ins(PARTNER2))
    );
    expect(code).toBe('23P01');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.ownership_history
        WHERE vehicle_id=$1 AND ownership_kind='registered_owner' AND valid_to IS NULL`,
      [V.OWN]
    );
    expect(n.rows[0].n).toBe(1); // exactly one authoritative owner
  });

  it('identical overlapping relationship: one winner (loser 23P01)', async () => {
    const ins = () =>
      `INSERT INTO veh.vehicle_relationships (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, created_by)
       VALUES ('${TENANT_A}','${V.REL}','${PARTNER1}','driver','2024-01-01','${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins()),
      (c2) => c2.query(ins())
    );
    expect(code).toBe('23P01');
  });
});

describe('QA-008 §11/§12 odometer ordering + rollback race', () => {
  it('two increasing readings serialize on the Vehicle lock; latest is deterministic', async () => {
    const ins = (value: number, at: string) =>
      `INSERT INTO veh.odometer_readings (tenant_id, vehicle_id, value, unit, capture_method, observed_at)
       VALUES ('${TENANT_A}','${V.ODO}',${value},'km','manual','${at}')`;
    const code = await race(
      (c1) => c1.query(ins(100, '2024-01-01')),
      (c2) => c2.query(ins(150, '2024-01-02'))
    );
    expect(code).toBeUndefined(); // both commit
    const latest = await admin.query(
      `SELECT value FROM (SELECT * FROM veh.odometer_readings WHERE vehicle_id=$1 ORDER BY observed_at DESC, seq DESC LIMIT 1) t`,
      [V.ODO]
    );
    expect(Number(latest.rows[0].value)).toBe(150);
  });

  it('a concurrent lower reading loses to the per-Vehicle lock (loser 23514)', async () => {
    const ins = (value: number, at: string) =>
      `INSERT INTO veh.odometer_readings (tenant_id, vehicle_id, value, unit, capture_method, observed_at)
       VALUES ('${TENANT_A}','${V.ODO}',${value},'km','manual','${at}')`;
    const code = await race(
      (c1) => c1.query(ins(200, '2024-02-01')),
      (c2) => c2.query(ins(180, '2024-02-02'))
    );
    expect(code).toBe('23514'); // no lost ordering, no silent rollback
  });
});

describe('QA-008 §13 status transition', () => {
  it('concurrent transitions serialize; no missing history row', async () => {
    const code = await race(
      (c1) =>
        c1.query(`UPDATE veh.vehicles SET lifecycle_status='inactive' WHERE id=$1`, [V.STATUS]),
      (c2) =>
        c2.query(`UPDATE veh.vehicles SET workshop_status='in_workshop' WHERE id=$1`, [V.STATUS])
    );
    expect(code).toBeUndefined(); // both commit serially
    const hist = await admin.query(
      `SELECT status_kind, to_state FROM veh.vehicle_status_history WHERE vehicle_id=$1 ORDER BY seq`,
      [V.STATUS]
    );
    expect(hist.rows).toHaveLength(2); // one row per real change, none missing
    const final = await admin.query(
      `SELECT lifecycle_status, workshop_status FROM veh.vehicles WHERE id=$1`,
      [V.STATUS]
    );
    expect(final.rows[0]).toEqual({ lifecycle_status: 'inactive', workshop_status: 'in_workshop' });
  });
});

describe('QA-008 §14 duplicate candidate', () => {
  it('concurrent same-pair open candidates: one winner (loser 23505)', async () => {
    const ins = (score: number) =>
      `INSERT INTO veh.duplicate_candidates (tenant_id, vehicle_id_a, vehicle_id_b, match_score, match_basis, created_by)
       VALUES ('${TENANT_A}','${V.DUPA}','${V.DUPB}',${score},'[{"basis":"other"}]'::jsonb,'${USER_A}')`;
    const code = await race(
      (c1) => c1.query(ins(0.9)),
      (c2) => c2.query(ins(0.8))
    );
    expect(code).toBe('23505');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM veh.duplicate_candidates WHERE vehicle_id_a=$1 AND status='open'`,
      [V.DUPA]
    );
    expect(n.rows[0].n).toBe(1);
  });
});

describe('QA-008 §15/§16 merge races', () => {
  const insMerge = (src: string, surv: string) =>
    `INSERT INTO veh.vehicle_merges (tenant_id, source_vehicle_id, survivor_vehicle_id, approval_ref)
     VALUES ('${TENANT_A}','${src}','${surv}','RACE-APPROVAL')`;

  it('same-source concurrent merges: one winner (loser 23505/40P01)', async () => {
    const code = await race(
      (c1) => c1.query(insMerge(V.MSRC, V.MS2)),
      (c2) => c2.query(insMerge(V.MSRC, V.MS3))
    );
    expect(['23505', '40P01']).toContain(code);
    const rec = await admin.query(
      `SELECT survivor_vehicle_id FROM veh.vehicle_merges WHERE source_vehicle_id=$1`,
      [V.MSRC]
    );
    expect(rec.rows).toHaveLength(1); // exactly one committed merge
    const src = await admin.query(
      `SELECT lifecycle_status, merged_into_id FROM veh.vehicles WHERE id=$1`,
      [V.MSRC]
    );
    expect(src.rows[0].lifecycle_status).toBe('merged');
    expect(src.rows[0].merged_into_id).toBe(rec.rows[0].survivor_vehicle_id); // no partial state
  });

  it('symmetric merge (A->B vs B->A): one winner, no cycle (loser 23514/40P01)', async () => {
    const code = await race(
      (c1) => c1.query(insMerge(V.SYMA, V.SYMB)),
      (c2) => c2.query(insMerge(V.SYMB, V.SYMA))
    );
    expect(['23514', '40P01']).toContain(code);
    const rows = (
      await admin.query(
        `SELECT id, lifecycle_status, merged_into_id FROM veh.vehicles WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[V.SYMA, V.SYMB]]
      )
    ).rows;
    const merged = rows.filter((r) => r.lifecycle_status === 'merged');
    expect(merged).toHaveLength(1); // exactly one side merged — no cycle
    const survivorId = merged[0]?.merged_into_id as string;
    const survivor = rows.find((r) => r.id === survivorId);
    expect(survivor?.lifecycle_status).not.toBe('merged');
  });
});

describe('QA-008 §17 record_version conflict', () => {
  it('concurrent master updates serialize; record_version advances twice, no lost update', async () => {
    const code = await race(
      (c1) => c1.query(`UPDATE veh.vehicles SET color='red' WHERE id=$1`, [V.RV]),
      (c2) => c2.query(`UPDATE veh.vehicles SET model_year=2024 WHERE id=$1`, [V.RV])
    );
    expect(code).toBeUndefined();
    const row = (
      await admin.query(`SELECT color, model_year, record_version FROM veh.vehicles WHERE id=$1`, [
        V.RV,
      ])
    ).rows[0];
    expect(row.color).toBe('red'); // c1's change not lost
    expect(row.model_year).toBe(2024); // c2's change applied on top
    expect(row.record_version).toBe(3); // 1 -> 2 -> 3
  });
});

describe('QA-008 §18 classification downgrade', () => {
  it('identifier classification is immutable (structurally no downgrade race exists)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (
        await c.query(
          `INSERT INTO veh.vehicle_identifiers (tenant_id, vehicle_id, identifier_type, raw_value, normalized_value, classification, created_by)
           VALUES ($1,$2,'fleet_no','FLT-RV','FLTRV','internal',$3) RETURNING id`,
          [TENANT_A, V.IDENT, USER_A]
        )
      ).rows[0].id;
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_identifiers SET classification='public' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });
});
