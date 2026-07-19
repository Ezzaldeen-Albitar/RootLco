/**
 * Phase 1-7 Vehicle status history (P1-07-DB-015) and Vehicle alerts (P1-07-DB-016).
 *
 * Status history proves trigger-emitted, one-row-per-actual-change, no-op-safe,
 * server-attributed, coherence-anchored (forgery-proof), append-only, atomic.
 * Alerts prove typed advisories with severity, effective window, active lookup,
 * acknowledgement coherence, soft-delete, cross-tenant rejection, and RLS.
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

const V_S1 = 'f0000000-0000-4000-8000-0000000e6001';
const V_S2 = 'f0000000-0000-4000-8000-0000000e6002';
const V_CC = 'f0000000-0000-4000-8000-0000000e6003';
const V_B = 'f0000000-0000-4000-8000-0000000e600b';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_B };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$5,'STVIN0001','ice','active',$7),
       ($2,$5,'STVIN0002','ice','active',$7),
       ($3,$5,'STVIN0003','ice','active',$7),
       ($4,$6,'STVINB001','ice','active',$8)`,
    [V_S1, V_S2, V_CC, V_B, TENANT_A, TENANT_B, USER_A, USER_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

const histCount = (c: { query: Pool['query'] }, vehicle: string, kind?: string) =>
  c
    .query(
      `SELECT count(*)::int AS n FROM veh.vehicle_status_history WHERE vehicle_id=$1 ${
        kind ? `AND status_kind='${kind}'` : ''
      }`,
      [vehicle]
    )
    .then((r) => r.rows[0].n as number);

describe('veh.vehicle_status_history — emission', () => {
  it('writes exactly one lifecycle row per real transition', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(`UPDATE veh.vehicles SET lifecycle_status='inactive' WHERE id=$1`, [V_S1]);
      const rows = (
        await c.query(
          `SELECT status_kind, from_state, to_state, actor_id FROM veh.vehicle_status_history WHERE vehicle_id=$1`,
          [V_S1]
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status_kind: 'lifecycle',
        from_state: 'active',
        to_state: 'inactive',
        actor_id: USER_A,
      });
    });
  });

  it('writes a workshop row on a workshop transition', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(`UPDATE veh.vehicles SET workshop_status='in_workshop' WHERE id=$1`, [V_S1]);
      expect(await histCount(c, V_S1, 'workshop')).toBe(1);
      expect(await histCount(c, V_S1, 'lifecycle')).toBe(0);
    });
  });

  it('writes nothing for a no-op update', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(`UPDATE veh.vehicles SET lifecycle_status='active', color='blue' WHERE id=$1`, [
        V_S1,
      ]);
      expect(await histCount(c, V_S1, 'lifecycle')).toBe(0);
    });
  });

  it('orders rows by seq within a transaction', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(`UPDATE veh.vehicles SET lifecycle_status='inactive' WHERE id=$1`, [V_S2]);
      await c.query(`UPDATE veh.vehicles SET workshop_status='in_workshop' WHERE id=$1`, [V_S2]);
      const seqs = (
        await c.query(
          `SELECT seq FROM veh.vehicle_status_history WHERE vehicle_id=$1 ORDER BY seq`,
          [V_S2]
        )
      ).rows.map((r) => Number(r.seq));
      expect(seqs).toHaveLength(2);
      expect(Math.max(...seqs)).toBeGreaterThan(Math.min(...seqs));
    });
  });

  it('denies UPDATE and DELETE (append-only)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(`UPDATE veh.vehicles SET lifecycle_status='inactive' WHERE id=$1`, [V_S1]);
      const id = (
        await c.query(`SELECT id FROM veh.vehicle_status_history WHERE vehicle_id=$1`, [V_S1])
      ).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_status_history SET to_state='active' WHERE id=$1`, [id]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`DELETE FROM veh.vehicle_status_history WHERE id=$1`, [id]),
        '42501'
      );
    });
  });
});

describe('veh.vehicle_status_history — coherence (no forged history)', () => {
  it('rejects a direct row whose to_state does not match the live master', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // V_CC is 'active'; forging a transition to 'inactive' that never happened.
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vehicle_status_history (tenant_id, vehicle_id, status_kind, from_state, to_state)
           VALUES ($1,$2,'lifecycle','active','inactive')`,
          [TENANT_A, V_CC]
        ),
        '23514'
      );
    });
  });

  it('rejects an invalid state value', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vehicle_status_history (tenant_id, vehicle_id, status_kind, from_state, to_state)
           VALUES ($1,$2,'lifecycle','active','bogus')`,
          [TENANT_A, V_CC]
        ),
        '23514'
      );
    });
  });

  it('is atomic with the master change (rollback removes the history)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await c.query(`UPDATE veh.vehicles SET lifecycle_status='inactive' WHERE id=$1`, [V_CC]);
      expect(await histCount(c, V_CC, 'lifecycle')).toBe(1);
      await c.query('ROLLBACK TO SAVEPOINT s1');
      expect(await histCount(c, V_CC, 'lifecycle')).toBe(0);
    });
  });
});

describe('veh.vehicle_status_history — concurrency', () => {
  it('serializes concurrent transitions and records both', async () => {
    const c1 = await runtime.connect();
    const c2 = await runtime.connect();
    try {
      await c1.query('BEGIN');
      await setContext(c1, ctxA);
      await c2.query('BEGIN');
      await setContext(c2, ctxA);
      await c1.query(`UPDATE veh.vehicles SET lifecycle_status='inactive' WHERE id=$1`, [V_CC]); // locks row
      const p2 = c2.query(`UPDATE veh.vehicles SET workshop_status='in_workshop' WHERE id=$1`, [
        V_CC,
      ]); // blocks
      p2.catch(() => {}); // mark handled now; p2 may reject during the COMMIT await
      await c1.query('COMMIT');
      await p2;
      await c2.query('COMMIT');
      const n = await histCount(admin, V_CC);
      expect(n).toBe(2);
    } finally {
      c1.release();
      c2.release();
      // Reset with an actor in context (the emit trigger requires one), then purge.
      const cc = await runtime.connect();
      try {
        await cc.query('BEGIN');
        await setContext(cc, ctxA);
        await cc.query(
          `UPDATE veh.vehicles SET lifecycle_status='active', workshop_status='none' WHERE id=$1`,
          [V_CC]
        );
        await cc.query('COMMIT');
      } finally {
        cc.release();
      }
      await admin.query(`DELETE FROM veh.vehicle_status_history WHERE vehicle_id=$1`, [V_CC]);
    }
  });
});

const insAlert = (
  vehicle: string,
  type: string,
  severity: string,
  opts: { from?: string; to?: string; tenant?: string } = {}
) => {
  const tenant = opts.tenant ?? TENANT_A;
  const from = opts.from ? `'${opts.from}'` : 'now()';
  const to = opts.to ? `'${opts.to}'` : 'NULL';
  return `INSERT INTO veh.vehicle_alerts (tenant_id, vehicle_id, alert_type, severity, message, effective_from, effective_to, created_by)
    VALUES ('${tenant}','${vehicle}','${type}','${severity}','advisory text',${from},${to},'${USER_A}')
    RETURNING id`;
};

describe('veh.vehicle_alerts', () => {
  it('accepts every alert type', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      for (const t of ['safety', 'technical', 'commercial', 'other']) {
        expect((await c.query(insAlert(V_S1, t, 'high'))).rows).toHaveLength(1);
      }
    });
  });

  it('rejects an invalid severity and an invalid effective interval', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insAlert(V_S1, 'safety', 'urgent')), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(insAlert(V_S1, 'safety', 'high', { from: '2024-06-01', to: '2024-01-01' })),
        '23514'
      );
    });
  });

  it('supports active and expired lookups', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insAlert(V_S1, 'safety', 'critical')); // active, open window
      await c.query(insAlert(V_S1, 'technical', 'low', { from: '2020-01-01', to: '2020-02-01' })); // expired
      const active = await c.query(
        `SELECT count(*)::int AS n FROM veh.vehicle_alerts
         WHERE vehicle_id=$1 AND is_active AND deleted_at IS NULL
           AND effective_from <= now() AND (effective_to IS NULL OR effective_to >= now())`,
        [V_S1]
      );
      expect(active.rows[0].n).toBe(1);
      const expired = await c.query(
        `SELECT count(*)::int AS n FROM veh.vehicle_alerts WHERE vehicle_id=$1 AND effective_to < now()`,
        [V_S1]
      );
      expect(expired.rows[0].n).toBe(1);
    });
  });

  it('enforces acknowledgement coherence', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAlert(V_S1, 'safety', 'high'))).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_alerts SET acknowledged_by=$1 WHERE id=$2`, [USER_A, id]),
        '23514'
      ); // by without at
      await c.query('ROLLBACK TO SAVEPOINT s1');
      const ok = await c.query(
        `UPDATE veh.vehicle_alerts SET acknowledged_by=$1, acknowledged_at=now(), is_active=false WHERE id=$2`,
        [USER_A, id]
      );
      expect(ok.rowCount).toBe(1);
    });
  });

  it('rejects a cross-tenant Vehicle reference', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insAlert(V_B, 'safety', 'high')), '23503');
    });
  });

  it('allows soft-delete but denies hard DELETE', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAlert(V_S1, 'safety', 'high'))).rows[0].id;
      const soft = await c.query(
        `UPDATE veh.vehicle_alerts SET deleted_at=now(), deleted_by=$1, is_active=false WHERE id=$2`,
        [USER_A, id]
      );
      expect(soft.rowCount).toBe(1);
      await expectSqlState(c.query(`DELETE FROM veh.vehicle_alerts WHERE id=$1`, [id]), '42501');
    });
  });

  it('isolates tenants and blocks app_readonly writes', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      expect((await c.query(`SELECT count(*)::int AS n FROM veh.vehicle_alerts`)).rows[0].n).toBe(
        0
      );
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(c.query(insAlert(V_S1, 'safety', 'high')), '42501');
    });
  });
});
