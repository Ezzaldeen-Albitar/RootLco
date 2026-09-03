/**
 * P1-29 W9-R4 — the platform diagnostic-type vocabulary, proved on real PostgreSQL.
 *
 * `supabase/seeds/09_dia_diagnostic_types.sql`
 * completes the P1-09 seed obligation the catalogue shipped without (Owner
 * decision of 2026-09-03): ten tenant-neutral PLATFORM rows in
 * `dia.diagnostic_types`. Every property the decision named is asserted here
 * against the migrated database, not described:
 *
 *   D1  clean replay — after every migration and the declared seeds the ten platform types exist exactly once
 *   D2  idempotent — applying the seed's SQL again changes nothing
 *   D3  exact vocabulary — the ten codes and names are the Owner-approved list, no OBD
 *   D4  active — every row is in the catalogue's usable state
 *   D5  tenant isolation — a tenant cannot read or mutate another tenant's override,
 *       and cannot write a platform row
 *   D8  no Benzene — the seed file names no tenant
 *
 * D6/D7 (a tenant row shadows the platform row of the same code through the
 * shipped list operation, and shadowing one code hides nothing else) are
 * proved on real responses in tests/backend/p1-29-w5-diagnostic-type-list.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  adminPool,
  ensureOrgFixtures,
  ensureTestLogins,
  runtimePool,
  withRolledBackTx,
} from './helpers';

const SEED = join(process.cwd(), 'supabase', 'seeds', '09_dia_diagnostic_types.sql');

/** The Owner-approved vocabulary of 2026-09-03, in the catalogue's own code format. */
const APPROVED: ReadonlyArray<readonly [string, string]> = [
  ['general_diagnostic', 'General Diagnostic'],
  ['engine_powertrain', 'Engine & Powertrain'],
  ['transmission_drivetrain', 'Transmission & Drivetrain'],
  ['electrical_electronic', 'Electrical & Electronic Systems'],
  ['brakes', 'Brakes'],
  ['steering_suspension', 'Steering & Suspension'],
  ['hvac_climate', 'HVAC / Climate Control'],
  ['battery_starting_charging', 'Battery / Starting / Charging'],
  ['hybrid_ev_high_voltage', 'Hybrid & EV High-Voltage Systems'],
  ['safety_restraint', 'Safety / Restraint Systems'],
];
const CODES = APPROVED.map(([code]) => code);

let admin: Pool;
let runtime: Pool;

const PLATFORM_ROWS = `SELECT code, name, status, scope, tenant_id, created_by
                         FROM dia.diagnostic_types
                        WHERE scope = 'platform' AND deleted_at IS NULL AND code = ANY($1::text[])
                        ORDER BY code`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool(2);
}, 120_000);

afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

describe('W9-R4 — the platform diagnostic-type vocabulary', () => {
  it('D1 — after the migration series and the declared seeds the ten platform types exist exactly once each', async () => {
    const { rows } = await admin.query<{ code: string; n: number }>(
      `SELECT code, count(*)::int AS n
         FROM dia.diagnostic_types
        WHERE scope = 'platform' AND deleted_at IS NULL AND code = ANY($1::text[])
        GROUP BY code ORDER BY code`,
      [CODES]
    );
    expect(rows.map((r) => r.code)).toEqual([...CODES].sort());
    expect(rows.every((r) => r.n === 1)).toBe(true);
    // Platform rows carry no tenant, by the table's own scope constraint.
    const scoped = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dia.diagnostic_types
        WHERE scope = 'platform' AND code = ANY($1::text[]) AND tenant_id IS NOT NULL`,
      [CODES]
    );
    expect(scoped.rows[0]?.n).toBe(0);
  });

  it('D2 — applying the seed again inserts nothing and changes nothing', async () => {
    const sql = readFileSync(SEED, 'utf8');
    const before = await admin.query(PLATFORM_ROWS, [CODES]);
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      const replay = await client.query(sql);
      // A multi-statement text answers the LAST statement's result: the INSERT.
      const last = Array.isArray(replay) ? replay[replay.length - 1] : replay;
      expect(last?.rowCount ?? 0).toBe(0);
      const after = await client.query(PLATFORM_ROWS, [CODES]);
      expect(after.rows).toEqual(before.rows);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const count = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dia.diagnostic_types WHERE scope = 'platform' AND deleted_at IS NULL AND code = ANY($1::text[])`,
      [CODES]
    );
    expect(count.rows[0]?.n).toBe(10);
  });

  it('D3 — the vocabulary is exactly the Owner-approved ten, and OBD is not among them', async () => {
    const { rows } = await admin.query<{ code: string; name: string }>(PLATFORM_ROWS, [CODES]);
    const expected = [...APPROVED].sort((a, b) => a[0].localeCompare(b[0]));
    expect(rows.map((r) => [r.code, r.name])).toEqual(expected);
    const obd = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dia.diagnostic_types
        WHERE scope = 'platform' AND deleted_at IS NULL AND (code ~* 'obd' OR name ~* 'obd')`
    );
    expect(obd.rows[0]?.n).toBe(0);
  });

  it('D4 — every platform row is active, attributed to the platform-system actor, and code-formatted', async () => {
    const { rows } = await admin.query<{ status: string; created_by: string; code: string }>(
      PLATFORM_ROWS,
      [CODES]
    );
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === 'active')).toBe(true);
    expect(rows.every((r) => r.created_by === '00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(rows.every((r) => /^[a-z][a-z0-9_]{1,62}$/.test(r.code))).toBe(true);
  });

  it('D5 — a tenant sees the platform rows and only its own overrides; it cannot write a platform row', async () => {
    // Tenant B's override of an approved code, written as the database owner
    // (the same way an operator would seed configuration), rolled back at the end.
    await withRolledBackTx(admin, { tenantId: TENANT_B, userId: USER_B }, async (owner) => {
      await owner.query(
        `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, created_by)
         VALUES ('tenant', $1, 'brakes', 'Brakes (tenant B)', $2)`,
        [TENANT_B, USER_B]
      );
      // Same transaction, seen through the runtime role as tenant A: the
      // platform rows are visible, tenant B's override is not.
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (a) => {
        const visible = await a.query<{ scope: string; name: string }>(
          `SELECT scope, name FROM dia.diagnostic_types WHERE code = 'brakes' AND deleted_at IS NULL ORDER BY scope`
        );
        expect(visible.rows).toEqual([{ scope: 'platform', name: 'Brakes' }]);
        // Tenant A cannot mutate tenant B's row (zero rows reachable) …
        const touched = await a.query(
          `UPDATE dia.diagnostic_types SET name = 'hijacked' WHERE scope = 'tenant' AND tenant_id = $1`,
          [TENANT_B]
        );
        expect(touched.rowCount).toBe(0);
        // … nor write a platform row: the only INSERT policy admits tenant rows of its own tenant.
        await expect(
          a.query(
            `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, created_by)
             VALUES ('platform', NULL, 'w9r4_probe', 'Probe', $1)`,
            [USER_A]
          )
        ).rejects.toMatchObject({ code: '42501' });
      });
    });
  });

  it('D8 — the seed names no tenant: no Benzene, no Zoom, no tenant identifier', () => {
    const sql = readFileSync(SEED, 'utf8');
    expect(sql).not.toMatch(/benzene/i);
    expect(sql).not.toMatch(/\bzoom\b/i);
    // Every VALUES row is a platform row with a NULL tenant.
    const rows = sql.match(/\('platform',\s*NULL,/g) ?? [];
    expect(rows).toHaveLength(10);
    expect(sql).not.toMatch(/\('tenant'/);
    expect(sql).toMatch(/WHY THIS IS STRUCTURAL, NOT BUSINESS DATA/i);
  });
});
