/**
 * Phase 1-7 Mechanical + EV domain (P1-07-DB-007/008/009).
 *
 * Proves mutable-temporal engine/transmission intervals (end-datable valid_to,
 * close-only, non-overlap, immutable identity, no DELETE, point-in-time resolver),
 * the EV<->powertrain coupling in both directions with one-profile uniqueness, and
 * battery master interval rules + append-only battery readings.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

const V_EV = 'f0000000-0000-4000-8000-0000000c4001';
const V_ICE = 'f0000000-0000-4000-8000-0000000c4002';
const V_B = 'f0000000-0000-4000-8000-0000000c400b';
const ctxA = { tenantId: TENANT_A, userId: USER_A };

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$4,'EVVIN0001','ev','active',$6),
       ($2,$4,'ICEVIN001','ice','active',$6),
       ($3,$5,'BVIN00001','ice','active',$7)`,
    [V_EV, V_ICE, V_B, TENANT_A, TENANT_B, USER_A, USER_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const insEngine = (vehicle: string, from: string, to: string | null) =>
  `INSERT INTO veh.engine_history (tenant_id, vehicle_id, valid_from, valid_to, created_by)
   VALUES ('${TENANT_A}','${vehicle}','${from}',${to ? `'${to}'` : 'NULL'},'${USER_A}') RETURNING id`;

describe('veh.engine_history — mutable-temporal intervals', () => {
  it('inserts, end-dates, then forbids reopening/re-dating a closed interval', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insEngine(V_ICE, '2020-01-01', null))).rows[0].id;
      await c.query(`UPDATE veh.engine_history SET valid_to='2022-01-01' WHERE id=$1`, [id]);
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.engine_history SET valid_to=NULL WHERE id=$1`, [id]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.engine_history SET valid_to='2023-01-01' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('rejects overlapping intervals but allows adjacent ones', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insEngine(V_ICE, '2020-01-01', '2022-01-01'));
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insEngine(V_ICE, '2021-06-01', '2023-01-01')), '23P01');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      const adj = await c.query(insEngine(V_ICE, '2022-01-01', '2024-01-01'));
      expect(adj.rows).toHaveLength(1);
    });
  });

  it('freezes identity fields and forbids DELETE', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (
        await c.query(
          `INSERT INTO veh.engine_history (tenant_id, vehicle_id, displacement_cc, valid_from, created_by)
           VALUES ($1,$2,1600,'2020-01-01',$3) RETURNING id`,
          [TENANT_A, V_ICE, USER_A]
        )
      ).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.engine_history SET displacement_cc=2000 WHERE id=$1`, [id]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(`DELETE FROM veh.engine_history WHERE id=$1`, [id]), '42501');
    });
  });

  it('resolves the engine at a point in time', async () => {
    const res = await withRolledBackTx(runtime, ctxA, async (c) => {
      const a = (await c.query(insEngine(V_ICE, '2020-01-01', '2022-01-01'))).rows[0].id;
      const b = (await c.query(insEngine(V_ICE, '2022-01-01', null))).rows[0].id;
      const at2021 = (await c.query(`SELECT veh.engine_at($1,'2021-06-01') AS id`, [V_ICE])).rows[0]
        .id;
      const at2023 = (await c.query(`SELECT veh.engine_at($1,'2023-06-01') AS id`, [V_ICE])).rows[0]
        .id;
      return { a, b, at2021, at2023 };
    });
    expect(res.at2021).toBe(res.a);
    expect(res.at2023).toBe(res.b);
  });

  it('rejects a cross-tenant vehicle reference', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insEngine(V_B, '2020-01-01', null)), '23503');
    });
  });
});

describe('veh.transmission_history — taxonomy + temporal', () => {
  it('accepts an approved type and rejects an unknown one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ok = await c.query(
        `INSERT INTO veh.transmission_history (tenant_id, vehicle_id, transmission_type, valid_from, created_by)
         VALUES ($1,$2,'automatic','2020-01-01',$3) RETURNING id`,
        [TENANT_A, V_ICE, USER_A]
      );
      expect(ok.rows).toHaveLength(1);
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `INSERT INTO veh.transmission_history (tenant_id, vehicle_id, transmission_type, valid_from, created_by)
           VALUES ($1,$2,'warp_drive','2021-01-01',$3)`,
          [TENANT_A, V_ICE, USER_A]
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
    });
  });
});

describe('veh.vehicle_ev_profiles — powertrain coupling', () => {
  const insProfile = (vehicle: string, kind: string) =>
    `INSERT INTO veh.vehicle_ev_profiles (tenant_id, vehicle_id, ev_kind, created_by)
     VALUES ('${TENANT_A}','${vehicle}','${kind}','${USER_A}') RETURNING id`;

  it('allows a BEV profile on an EV vehicle', async () => {
    const res = await withRolledBackTx(runtime, ctxA, (c) => c.query(insProfile(V_EV, 'bev')));
    expect(res.rows).toHaveLength(1);
  });

  it('rejects an EV profile on an ICE vehicle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insProfile(V_ICE, 'bev')), '23514');
    });
  });

  it('rejects a mismatched ev_kind (bev on a non-ev category)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // V_EV category is 'ev' which only matches bev; hybrid requires 'hybrid'.
      await expectSqlState(c.query(insProfile(V_EV, 'hybrid')), '23514');
    });
  });

  it('enforces one active profile per vehicle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insProfile(V_EV, 'bev'));
      await expectSqlState(c.query(insProfile(V_EV, 'bev')), '23505');
    });
  });

  it('rejects an incompatible powertrain change while a profile is active', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insProfile(V_EV, 'bev'));
      await expectSqlState(
        c.query(`UPDATE veh.vehicles SET powertrain_category='ice' WHERE id=$1`, [V_EV]),
        '23514'
      );
    });
  });

  it('allows a powertrain change after the profile is removed', async () => {
    const res = await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insProfile(V_EV, 'bev'))).rows[0].id;
      await c.query(`UPDATE veh.vehicle_ev_profiles SET deleted_at=now() WHERE id=$1`, [id]);
      return c.query(
        `UPDATE veh.vehicles SET powertrain_category='ice' WHERE id=$1 RETURNING powertrain_category`,
        [V_EV]
      );
    });
    expect(res.rows[0].powertrain_category).toBe('ice');
  });
});

describe('veh.battery_masters / battery_readings', () => {
  const insBattery = (
    vehicle: string,
    role: string,
    status = 'active',
    removed: string | null = null
  ) =>
    `INSERT INTO veh.battery_masters (tenant_id, vehicle_id, battery_role, status, installed_on, removed_on, created_by)
     VALUES ('${TENANT_A}','${vehicle}','${role}','${status}','2021-01-01',${removed ? `'${removed}'` : 'NULL'},'${USER_A}') RETURNING id`;

  it('enforces at most one active traction battery, auxiliary allowed alongside', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insBattery(V_EV, 'traction'));
      const aux = await c.query(insBattery(V_EV, 'auxiliary'));
      expect(aux.rows).toHaveLength(1);
      await expectSqlState(c.query(insBattery(V_EV, 'traction')), '23505');
    });
  });

  it('requires removed_on for a removed battery and rejects removed<installed', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insBattery(V_EV, 'traction', 'removed', null)), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insBattery(V_EV, 'traction', 'removed', '2020-01-01')), '23514');
    });
  });

  it('battery_readings are append-only and stamped', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const bat = (await c.query(insBattery(V_EV, 'traction'))).rows[0].id;
      const r = await c.query(
        `INSERT INTO veh.battery_readings (tenant_id, battery_master_id, reading_kind, value, unit, measured_at)
         VALUES ($1,$2,'soh',97.5,'percent',now()) RETURNING id, actor_id`,
        [TENANT_A, bat]
      );
      expect(r.rows[0].actor_id).toBe(USER_A);
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.battery_readings SET value=1 WHERE id=$1`, [r.rows[0].id]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`DELETE FROM veh.battery_readings WHERE id=$1`, [r.rows[0].id]),
        '42501'
      );
    });
  });
});
