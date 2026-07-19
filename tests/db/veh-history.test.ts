/**
 * Phase 1-7 append-only VIN verifications + Vehicle attribute history
 * (P1-07-DB-004/005).
 *
 * Proves both tables are append-only (UPDATE/DELETE denied), server-stamped, and
 * that attribute history is trigger-populated exactly once per changed master
 * attribute (no row on a no-op update), never for a change that did not happen.
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
  USER_A,
} from './helpers';

const V_BASE = 'f0000000-0000-4000-8000-0000000c3a01';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, color, lifecycle_status, created_by)
     VALUES ($1, $2, 'HISTVIN001', 'red', 'active', $3)`,
    [V_BASE, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('veh.vin_verifications — append-only, stamped', () => {
  it('records a verification and server-stamps the actor', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(
        `INSERT INTO veh.vin_verifications (tenant_id, vehicle_id, vin_checked, check_kind, result)
         VALUES ($1,$2,'HISTVIN001','format','passed') RETURNING actor_id, occurred_at, seq`,
        [TENANT_A, V_BASE]
      )
    );
    expect(res.rows[0].actor_id).toBe(USER_A);
    expect(res.rows[0].occurred_at).not.toBeNull();
  });

  it('requires a reason for an overridden result', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query('SAVEPOINT sp');
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vin_verifications (tenant_id, vehicle_id, vin_checked, check_kind, result)
           VALUES ($1,$2,'HISTVIN001','manual','overridden')`,
          [TENANT_A, V_BASE]
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT sp');
      const ok = await c.query(
        `INSERT INTO veh.vin_verifications (tenant_id, vehicle_id, vin_checked, check_kind, result, override_reason)
         VALUES ($1,$2,'HISTVIN001','manual','overridden','checksum tool offline') RETURNING id`,
        [TENANT_A, V_BASE]
      );
      expect(ok.rows).toHaveLength(1);
    });
  });

  it('cannot be updated or deleted (append-only)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const id = (
        await c.query(
          `INSERT INTO veh.vin_verifications (tenant_id, vehicle_id, vin_checked, check_kind, result)
           VALUES ($1,$2,'HISTVIN001','format','failed') RETURNING id`,
          [TENANT_A, V_BASE]
        )
      ).rows[0].id;
      await c.query('SAVEPOINT sp');
      await expectSqlState(
        c.query(`UPDATE veh.vin_verifications SET result='passed' WHERE id=$1`, [id]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT sp');
      await expectSqlState(c.query(`DELETE FROM veh.vin_verifications WHERE id=$1`, [id]), '42501');
    });
  });
});

describe('veh.vehicle_attribute_history — trigger-populated, append-only', () => {
  it('records exactly one row for a single changed attribute', async () => {
    const rows = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A },
      async (c) => {
        await c.query(`UPDATE veh.vehicles SET color='blue' WHERE id=$1`, [V_BASE]);
        return c.query(
          `SELECT field_code, old_value, new_value, actor_id FROM veh.vehicle_attribute_history
         WHERE vehicle_id=$1`,
          [V_BASE]
        );
      }
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      field_code: 'color',
      old_value: 'red',
      new_value: 'blue',
      actor_id: USER_A,
    });
  });

  it('writes no row for a no-op update', async () => {
    const rows = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A },
      async (c) => {
        await c.query(`UPDATE veh.vehicles SET color='red' WHERE id=$1`, [V_BASE]); // same value
        return c.query(
          `SELECT count(*)::int AS n FROM veh.vehicle_attribute_history WHERE vehicle_id=$1`,
          [V_BASE]
        );
      }
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('records one row per changed attribute in a multi-column update', async () => {
    const rows = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A },
      async (c) => {
        await c.query(
          `UPDATE veh.vehicles SET color='green', workshop_status='in_workshop' WHERE id=$1`,
          [V_BASE]
        );
        return c.query(
          `SELECT field_code FROM veh.vehicle_attribute_history WHERE vehicle_id=$1 ORDER BY field_code`,
          [V_BASE]
        );
      }
    );
    expect(rows.rows.map((r) => r.field_code)).toEqual(['color', 'workshop_status']);
  });

  it('cannot be updated or deleted (append-only)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(`UPDATE veh.vehicles SET color='black' WHERE id=$1`, [V_BASE]);
      const id = (
        await c.query(`SELECT id FROM veh.vehicle_attribute_history WHERE vehicle_id=$1 LIMIT 1`, [
          V_BASE,
        ])
      ).rows[0].id;
      await c.query('SAVEPOINT sp');
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_attribute_history SET new_value='x' WHERE id=$1`, [id]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT sp');
      await expectSqlState(
        c.query(`DELETE FROM veh.vehicle_attribute_history WHERE id=$1`, [id]),
        '42501'
      );
    });
  });
});
