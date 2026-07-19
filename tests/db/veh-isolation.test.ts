/**
 * Phase 1-7 centralized two-tenant isolation suite (P1-07-QA-007).
 *
 * Auto-enumerates EVERY tenant-owned veh base table and proves, through the
 * NON-owner runtime login, that one tenant can neither read nor mutate another
 * tenant's rows: with no context reads are empty and writes denied; cross-tenant
 * UPDATE/DELETE affect zero rows (mutable) or are denied 42501 (append-only); and
 * a populated cross-tenant read of the Vehicle master returns zero. Critically,
 * the suite FAILS if a new veh table is added without being listed here.
 *
 * Exhaustive populated cross-tenant read/write proofs per child table live in the
 * per-table targeted suites (veh-*.test.ts), each of which seeds tenant-B data.
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
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

// The authoritative list of tenant-owned veh base tables under isolation coverage.
const COVERED_TABLES = [
  'battery_masters',
  'battery_readings',
  'body_types',
  'duplicate_candidates',
  'engine_history',
  'makes',
  'models',
  'odometer_readings',
  'ownership_history',
  'plate_history',
  'powertrain_types',
  'relationship_evidence',
  'transmission_history',
  'trims',
  'vehicle_alerts',
  'vehicle_attribute_history',
  'vehicle_ev_profiles',
  'vehicle_identifiers',
  'vehicle_merges',
  'vehicle_relationships',
  'vehicle_status_history',
  'vehicles',
  'vin_verifications',
];

const V_A = 'f0000000-0000-4000-8000-0000000c1001';
const V_B = 'f0000000-0000-4000-8000-0000000c100b';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  // One Vehicle per tenant so the populated cross-tenant read is meaningful.
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$3,'ISOVINA001','ice','active',$5),
       ($2,$4,'ISOVINB001','ice','active',$6)`,
    [V_A, V_B, TENANT_A, TENANT_B, USER_A, USER_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('veh isolation coverage (P1-07-QA-007)', () => {
  it('covers every tenant-owned veh base table (fails when a new table is added)', async () => {
    const { rows } = await admin.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'veh' AND table_type = 'BASE TABLE' ORDER BY 1`
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([...COVERED_TABLES].sort());
  });

  it('with NO tenant context the runtime role reads zero rows on every veh table', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      // Deliberately DO NOT set app.tenant_id / app.user_id.
      for (const t of COVERED_TABLES) {
        const r = await client.query(`SELECT count(*)::int AS n FROM veh.${t}`);
        expect(r.rows[0].n, `no-context read of veh.${t} must be empty`).toBe(0);
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('tenant A cannot UPDATE or DELETE any tenant-B row on ANY veh table', async () => {
    async function attempt(tx: { query: Pool['query'] }, sql: string) {
      await tx.query('SAVEPOINT sp');
      try {
        const r = await tx.query(sql, [TENANT_B]);
        await tx.query('RELEASE SAVEPOINT sp');
        return { rowCount: r.rowCount as number };
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT sp');
        return { code: (e as { code?: string }).code };
      }
    }
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      for (const t of COVERED_TABLES) {
        const upd = await attempt(
          tx,
          `UPDATE veh.${t} SET tenant_id = tenant_id WHERE tenant_id = $1`
        );
        if (upd.code !== undefined) expect(upd.code, `UPDATE veh.${t}`).toBe('42501');
        else expect(upd.rowCount, `UPDATE veh.${t} changed tenant-B rows`).toBe(0);

        const del = await attempt(tx, `DELETE FROM veh.${t} WHERE tenant_id = $1`);
        if (del.code !== undefined) expect(del.code, `DELETE veh.${t}`).toBe('42501');
        else expect(del.rowCount, `DELETE veh.${t} removed tenant-B rows`).toBe(0);
      }
    });
    // Every tenant-B Vehicle still present (nothing was actually mutated/deleted).
    const still = await admin.query(
      `SELECT count(*)::int AS n FROM veh.vehicles WHERE tenant_id = $1`,
      [TENANT_B]
    );
    expect(still.rows[0].n).toBeGreaterThan(0);
  });

  it('tenant A reads its own Vehicle but ZERO tenant-B Vehicles (populated proof)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const own = await tx.query(`SELECT count(*)::int AS n FROM veh.vehicles`);
      expect(own.rows[0].n).toBeGreaterThan(0);
      const b = await tx.query(`SELECT count(*)::int AS n FROM veh.vehicles WHERE tenant_id = $1`, [
        TENANT_B,
      ]);
      expect(b.rows[0].n).toBe(0);
    });
  });

  it('tenant A cannot INSERT a Vehicle into tenant B (WITH CHECK) or reference a tenant-B Vehicle', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query('SAVEPOINT sp');
      let insCode: string | undefined;
      try {
        await tx.query(
          `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
           VALUES ($1,'SNEAKVIN01','ice','draft',$2)`,
          [TENANT_B, USER_A]
        );
      } catch (e) {
        insCode = (e as { code?: string }).code;
      }
      await tx.query('ROLLBACK TO SAVEPOINT sp');
      expect(insCode, 'cross-tenant Vehicle INSERT must be denied').toBe('42501');

      // Referencing tenant B's Vehicle from a tenant-A alert is a FK violation.
      await tx.query('SAVEPOINT sp2');
      let fkCode: string | undefined;
      try {
        await tx.query(
          `INSERT INTO veh.vehicle_alerts (tenant_id, vehicle_id, alert_type, severity, message, created_by)
           VALUES ($1,$2,'safety','high','x',$3)`,
          [TENANT_A, V_B, USER_A]
        );
      } catch (e) {
        fkCode = (e as { code?: string }).code;
      }
      await tx.query('ROLLBACK TO SAVEPOINT sp2');
      expect(fkCode, 'referencing a tenant-B Vehicle must fail').toBe('23503');
    });
  });
});
