/**
 * Phase 1-7 → Phase 1-8 structural contract (P1-07 hand-off).
 *
 * Phase 1-8 (Workshop Core Operations DB) and every later Vehicle consumer
 * builds on a small, stable structural surface of the `veh` schema. This test
 * pins exactly that surface: the Vehicle master and its key columns, the
 * composite same-tenant candidate key, active-identity uniqueness, the
 * lifecycle/workshop status vocabularies, the merge redirect + survivor
 * resolver, the current-state/point-in-time resolvers, and the security posture.
 * It also asserts NO Phase 1-8 object exists (no reception, appointment, or
 * work-order table anywhere). Intentionally a contract, not an inventory —
 * `foundation.test.ts` owns the exhaustive object list.
 *
 * Prose contract: docs/phase-1/phase-1-7/p1-08-structural-contract.md
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

let admin: Pool;

beforeAll(() => {
  admin = adminPool();
});

afterAll(async () => {
  await admin.end();
});

async function columns(table: string): Promise<Set<string>> {
  const { rows } = await admin.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'veh' AND table_name = $1`,
    [table]
  );
  return new Set(rows.map((r) => r.column_name));
}

describe('P1-08 structural contract — Vehicle master', () => {
  it('veh.vehicles exposes the columns the next phase binds to', async () => {
    const cols = await columns('vehicles');
    for (const required of [
      'id',
      'tenant_id',
      'display_number',
      'vin_raw',
      'vin_normalized',
      'lifecycle_status',
      'workshop_status',
      'merged_into_id',
      'powertrain_category',
      'record_version',
      'created_by',
      'deleted_at',
    ]) {
      expect(cols, `vehicles.${required}`).toContain(required);
    }
  });

  it('the composite tenant candidate key and active-identity uniqueness exist by name', async () => {
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'veh' AND conname = ANY($1::text[])`,
      [
        [
          'uq_vehicles_tenant_id',
          'ck_vehicles_lifecycle',
          'ck_vehicles_workshop',
          'ck_vehicles_merged_coherent',
        ],
      ]
    );
    expect(rows.map((r) => r.conname).sort()).toEqual([
      'ck_vehicles_lifecycle',
      'ck_vehicles_merged_coherent',
      'ck_vehicles_workshop',
      'uq_vehicles_tenant_id',
    ]);
    const idx = await admin.query(
      `SELECT indexrelid::regclass::text AS n FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname='veh'
         AND indexrelid::regclass::text IN ('veh.uq_vehicles_active_vin', 'veh.uq_vehicles_active_display_number')`
    );
    expect(idx.rows).toHaveLength(2);
  });

  it('the status vocabularies P1-08 depends on are stable', async () => {
    const life = await admin.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_vehicles_lifecycle'`
    );
    for (const s of ['draft', 'active', 'inactive', 'merged', 'scrapped']) {
      expect(life.rows[0].def).toContain(s);
    }
    const shop = await admin.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_vehicles_workshop'`
    );
    for (const s of ['none', 'in_workshop', 'awaiting_parts', 'ready_for_delivery']) {
      expect(shop.rows[0].def).toContain(s);
    }
  });
});

describe('P1-08 structural contract — resolvers and gate posture', () => {
  it('the consumer-callable resolvers exist as SECURITY INVOKER with locked search_path', async () => {
    const { rows } = await admin.query(
      `SELECT p.proname, p.prosecdef, COALESCE(array_to_string(p.proconfig, ','), '') AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'veh' AND p.proname = ANY($1::text[])`,
      [
        [
          'resolve_vehicle_survivor',
          'plate_at',
          'owner_at',
          'relationships_at',
          'engine_at',
          'transmission_at',
          'latest_odometer',
          'odometer_at',
          'normalize_vin',
          'normalize_plate',
        ],
      ]
    );
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.prosecdef, `${r.proname} must not be SECURITY DEFINER`).toBe(false);
      expect(r.cfg, `${r.proname} must lock search_path`).toMatch(/search_path=/);
    }
  });

  it('every veh table keeps FORCE RLS (the posture the next phase relies on)', async () => {
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'veh' AND c.relkind = 'r'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('P1-08 structural contract — no Phase 1-8 objects exist', () => {
  it('no reception, appointment, or work-order table exists in ANY module schema', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq
         FROM information_schema.tables
        WHERE table_schema IN ('org','iam','shared','crm','veh')
          AND (table_name ~ 'reception' OR table_name ~ 'appointment' OR table_name ~ 'work_order' OR table_name ~ 'workorder')`
    );
    expect(rows, 'Phase 1-8 objects must not exist yet').toEqual([]);
  });
});
