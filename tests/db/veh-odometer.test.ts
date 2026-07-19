/**
 * Phase 1-7 Odometer readings (P1-07-DB-014).
 *
 * Proves the append-only forward-only odometer series: nonnegative values, unit
 * fidelity with a canonical value_km, correction-only downward movement (reason +
 * anomaly + earlier same-Vehicle reference), deterministic latest/at resolution,
 * mutation denial, RLS/grants, and the per-Vehicle lock that stops a concurrent
 * rollback from committing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

const V_A = 'f0000000-0000-4000-8000-0000000d5001';
const V_A2 = 'f0000000-0000-4000-8000-0000000d5002';
const V_RACE = 'f0000000-0000-4000-8000-0000000d5003';
const V_B = 'f0000000-0000-4000-8000-0000000d500b';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_B };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

/** Build an odometer INSERT. recorded_by is server-stamped (not supplied). */
const insOdo = (
  vehicle: string,
  value: number,
  unit: string,
  opts: {
    method?: string;
    correctionOf?: string;
    reason?: string;
    anomaly?: boolean;
    at?: string;
    tenant?: string;
  } = {}
) => {
  const tenant = opts.tenant ?? TENANT_A;
  const method = opts.method ?? 'manual';
  const corr = opts.correctionOf ? `'${opts.correctionOf}'` : 'NULL';
  const reason = opts.reason ? `'${opts.reason}'` : 'NULL';
  const anomaly = opts.anomaly ? 'true' : 'false';
  const at = opts.at ? `'${opts.at}'` : 'now()';
  return `INSERT INTO veh.odometer_readings
    (tenant_id, vehicle_id, value, unit, capture_method, correction_of, correction_reason, anomaly_flag, observed_at)
    VALUES ('${tenant}','${vehicle}',${value},'${unit}','${method}',${corr},${reason},${anomaly},${at})
    RETURNING id, value_km, seq`;
};

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$5,'ODOVIN001','ice','active',$7),
       ($2,$5,'ODOVIN002','ice','active',$7),
       ($3,$5,'ODOVIN003','ice','active',$7),
       ($4,$6,'ODOVINB01','ice','active',$8)`,
    [V_A, V_A2, V_RACE, V_B, TENANT_A, TENANT_B, USER_A, USER_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('veh.odometer_readings — monotonicity + corrections', () => {
  it('accepts first, increasing, and equal readings', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect((await c.query(insOdo(V_A, 100, 'km'))).rows).toHaveLength(1);
      expect((await c.query(insOdo(V_A, 150, 'km'))).rows).toHaveLength(1);
      expect((await c.query(insOdo(V_A, 150, 'km'))).rows).toHaveLength(1); // equal allowed
    });
  });

  it('rejects a lower normal reading (rollback) with 23514', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insOdo(V_A, 100, 'km'));
      await expectSqlState(c.query(insOdo(V_A, 90, 'km')), '23514');
    });
  });

  it('accepts a valid downward correction (reason + anomaly + earlier ref)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const bad = (await c.query(insOdo(V_A, 900, 'km', { at: '2024-01-01' }))).rows[0].id;
      const fix = await c.query(
        insOdo(V_A, 90, 'km', {
          method: 'correction',
          correctionOf: bad,
          reason: 'typo 900->90',
          anomaly: true,
          at: '2024-01-02',
        })
      );
      expect(fix.rows).toHaveLength(1);
      // After the correction supersedes the erroneous 900, a normal 100 is allowed.
      expect((await c.query(insOdo(V_A, 100, 'km', { at: '2024-01-03' }))).rows).toHaveLength(1);
    });
  });

  it('rejects a correction without a reason and without a reference', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const base = (await c.query(insOdo(V_A, 100, 'km', { at: '2024-01-01' }))).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(insOdo(V_A, 50, 'km', { method: 'correction', correctionOf: base, anomaly: true })),
        '23514'
      ); // no reason
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(insOdo(V_A, 50, 'km', { method: 'correction', reason: 'x', anomaly: true })),
        '23514'
      ); // no correction_of
    });
  });

  it('rejects correction-only metadata on a normal reading', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // anomaly true on a non-correction is incoherent (ck_correction_meta).
      await expectSqlState(
        c.query(
          `INSERT INTO veh.odometer_readings (tenant_id, vehicle_id, value, unit, capture_method, anomaly_flag)
           VALUES ('${TENANT_A}','${V_A}',100,'km','manual',true)`
        ),
        '23514'
      );
    });
  });

  it('rejects a correction referencing another Vehicle or a non-existent row (23503)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const onA2 = (await c.query(insOdo(V_A2, 500, 'km', { at: '2024-01-01' }))).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          insOdo(V_A, 40, 'km', {
            method: 'correction',
            correctionOf: onA2,
            reason: 'x',
            anomaly: true,
          })
        ),
        '23503'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(
          insOdo(V_A, 40, 'km', {
            method: 'correction',
            correctionOf: '11111111-1111-4111-8111-111111111111',
            reason: 'x',
            anomaly: true,
          })
        ),
        '23503'
      );
    });
  });

  it('rejects a correction referencing a later reading (ordering; blocks cycles)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const later = (await c.query(insOdo(V_A, 100, 'km', { at: '2024-06-01' }))).rows[0].id;
      await expectSqlState(
        c.query(
          insOdo(V_A, 50, 'km', {
            method: 'correction',
            correctionOf: later,
            reason: 'out of order',
            anomaly: true,
            at: '2024-01-01',
          })
        ),
        '23514'
      );
    });
  });

  it('rejects a self-referencing correction', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const X = '22222222-2222-4222-8222-222222222222';
      await expectSqlState(
        c.query(
          `INSERT INTO veh.odometer_readings (id, tenant_id, vehicle_id, value, unit, capture_method, correction_of, correction_reason, anomaly_flag)
           VALUES ('${X}','${TENANT_A}','${V_A}',10,'km','correction','${X}','self',true)`
        ),
        '23503',
        '23514'
      );
    });
  });
});

describe('veh.odometer_readings — units, resolution, mutation', () => {
  it('stores units verbatim and computes canonical value_km', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const mi = (await c.query(insOdo(V_A, 100, 'mi'))).rows[0];
      expect(Number(mi.value_km)).toBeCloseTo(160.9344, 3);
    });
  });

  it('resolves latest and at-time deterministically across a mixed-unit series', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const r1 = (await c.query(insOdo(V_A, 100, 'km', { at: '2024-01-01' }))).rows[0].id;
      // 100 km; a later 80 mi = 128.7 km (>= 100 km) is a valid increase.
      const r2 = (await c.query(insOdo(V_A, 80, 'mi', { at: '2024-02-01' }))).rows[0].id;
      const latest = (await c.query(`SELECT (veh.latest_odometer($1)).id AS id`, [V_A])).rows[0].id;
      const at = (await c.query(`SELECT (veh.odometer_at($1,'2024-01-15')).id AS id`, [V_A]))
        .rows[0].id;
      expect(latest).toBe(r2);
      expect(at).toBe(r1);
    });
  });

  it('breaks same-timestamp ties by seq (deterministic latest)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insOdo(V_A, 210, 'km', { at: '2024-03-01T00:00:00Z' }));
      const second = (await c.query(insOdo(V_A, 210, 'km', { at: '2024-03-01T00:00:00Z' }))).rows[0]
        .id;
      const latest = (await c.query(`SELECT (veh.latest_odometer($1)).id AS id`, [V_A])).rows[0].id;
      expect(latest).toBe(second);
    });
  });

  it('denies UPDATE and DELETE (append-only)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insOdo(V_A, 100, 'km'))).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.odometer_readings SET value=999 WHERE id=$1`, [id]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(`DELETE FROM veh.odometer_readings WHERE id=$1`, [id]), '42501');
    });
  });

  it('requires an actor in context (server-stamped recorded_by)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      await expectSqlState(c.query(insOdo(V_A, 100, 'km')), '23514');
    });
  });
});

describe('veh.odometer_readings — RLS + grants', () => {
  it('a tenant cannot read or write another tenant rows', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      const seen = await c.query(`SELECT count(*)::int AS n FROM veh.odometer_readings`);
      expect(seen.rows[0].n).toBe(0);
      // cannot reference a tenant A vehicle from tenant B (RLS or FK)
      await expectSqlState(c.query(insOdo(V_A, 100, 'km', { tenant: TENANT_B })), '42501', '23503');
    });
  });

  it('app_readonly cannot INSERT', async () => {
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(c.query(insOdo(V_A, 100, 'km')), '42501');
    });
  });
});

describe('veh.odometer_readings — concurrency (per-Vehicle lock)', () => {
  it('serializes concurrent readings so a lower value cannot slip past', async () => {
    const c1 = await runtime.connect();
    const c2 = await runtime.connect();
    try {
      await c1.query('BEGIN');
      await setContext(c1, ctxA);
      await c1.query(insOdo(V_RACE, 100, 'km'));
      await c1.query('COMMIT'); // base reading 100 committed

      await c1.query('BEGIN');
      await setContext(c1, ctxA);
      await c2.query('BEGIN');
      await setContext(c2, ctxA);

      await c1.query(insOdo(V_RACE, 150, 'km')); // locks the vehicle row
      const p2 = c2.query(insOdo(V_RACE, 120, 'km')); // blocks on the lock
      p2.catch(() => {}); // mark handled now; p2 may reject during the COMMIT await
      await c1.query('COMMIT');
      // c2 now sees 150 as current -> 120 is a rollback -> rejected
      await expectSqlState(p2, '23514');
      await c2.query('ROLLBACK');
    } finally {
      c1.release();
      c2.release();
      await admin.query(`DELETE FROM veh.odometer_readings WHERE vehicle_id=$1`, [V_RACE]);
    }
  });
});
