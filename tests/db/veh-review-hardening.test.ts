/**
 * Phase 1-7 red-team hardening regressions (RT-1, RT-2 — migration 105000).
 *
 * RT-1: removing/blanking the VIN of an ACTIVE identifier-less Vehicle must be
 * rejected (previously bypassed the activation guard, which fired only on
 * lifecycle_status changes). RT-2: un-soft-deleting an EV profile after the
 * Vehicle's powertrain changed to ice must be rejected (previously the profile
 * guard did not fire on deleted_at changes).
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

const V_VIN = 'f0000000-0000-4000-8000-0000000d0001';
const V_ALT = 'f0000000-0000-4000-8000-0000000d0002';
const V_EV = 'f0000000-0000-4000-8000-0000000d0003';
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
       ($1,$4,'RTHVIN0001','ice','active',$5),
       ($2,$4,'RTHVIN0002','ice','active',$5),
       ($3,$4,'RTHVIN0003','ev','active',$5)`,
    [V_VIN, V_ALT, V_EV, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('RT-1 — VIN removal on an active Vehicle re-validates identity', () => {
  it('rejects blanking the VIN of an active Vehicle with no alternate identifier', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(
        c.query(`UPDATE veh.vehicles SET vin_raw=NULL WHERE id=$1`, [V_VIN]),
        '23514'
      );
    });
  });

  it('allows blanking the VIN when an active alternate identifier exists', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(
        `INSERT INTO veh.vehicle_identifiers (tenant_id, vehicle_id, identifier_type, raw_value, normalized_value, classification, created_by)
         VALUES ($1,$2,'fleet_no','FLT-RTH','FLTRTH','internal',$3)`,
        [TENANT_A, V_ALT, USER_A]
      );
      const r = await c.query(`UPDATE veh.vehicles SET vin_raw=NULL WHERE id=$1`, [V_ALT]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('still allows a VIN CHANGE (A -> B) on an active Vehicle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const r = await c.query(`UPDATE veh.vehicles SET vin_raw='RTHVIN9999' WHERE id=$1`, [V_VIN]);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe('RT-2 — EV-profile resurrection re-validates the powertrain', () => {
  it('rejects un-soft-deleting a profile after the Vehicle became ICE', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (
        await c.query(
          `INSERT INTO veh.vehicle_ev_profiles (tenant_id, vehicle_id, ev_kind, created_by)
           VALUES ($1,$2,'bev',$3) RETURNING id`,
          [TENANT_A, V_EV, USER_A]
        )
      ).rows[0].id;
      // Soft-delete the profile, then flip the powertrain (now legal).
      await c.query(
        `UPDATE veh.vehicle_ev_profiles SET deleted_at=now(), deleted_by=$1 WHERE id=$2`,
        [USER_A, id]
      );
      await c.query(`UPDATE veh.vehicles SET powertrain_category='ice' WHERE id=$1`, [V_EV]);
      // Resurrection must now fail — otherwise a live bev profile sits on an ICE Vehicle.
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_ev_profiles SET deleted_at=NULL, deleted_by=NULL WHERE id=$1`, [
          id,
        ]),
        '23514'
      );
    });
  });

  it('still allows soft-deleting a live profile (dying row needs no compatibility)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (
        await c.query(
          `INSERT INTO veh.vehicle_ev_profiles (tenant_id, vehicle_id, ev_kind, created_by)
           VALUES ($1,$2,'bev',$3) RETURNING id`,
          [TENANT_A, V_EV, USER_A]
        )
      ).rows[0].id;
      const r = await c.query(
        `UPDATE veh.vehicle_ev_profiles SET deleted_at=now(), deleted_by=$1 WHERE id=$2`,
        [USER_A, id]
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it('still allows resurrection while the Vehicle remains electric', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (
        await c.query(
          `INSERT INTO veh.vehicle_ev_profiles (tenant_id, vehicle_id, ev_kind, created_by)
           VALUES ($1,$2,'bev',$3) RETURNING id`,
          [TENANT_A, V_EV, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `UPDATE veh.vehicle_ev_profiles SET deleted_at=now(), deleted_by=$1 WHERE id=$2`,
        [USER_A, id]
      );
      const r = await c.query(
        `UPDATE veh.vehicle_ev_profiles SET deleted_at=NULL, deleted_by=NULL WHERE id=$1`,
        [id]
      );
      expect(r.rowCount).toBe(1);
    });
  });
});
