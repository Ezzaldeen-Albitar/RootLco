/**
 * Phase 1-7 Vehicle search contract (P1-07-DB-019).
 *
 * Proves the shared.search_metadata contract for veh: ordinary runtime roles are
 * read-only (backend/admin projection write path), VIN/plate normalization is
 * reused, a projected row is tenant-isolated and carries only the normalized
 * value (no PII), and the classification registry's searchable set is exactly the
 * approved VIN/plate/display#/catalog-name fields with no restricted column
 * searchable.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(
  HERE,
  '..',
  '..',
  'docs',
  'database',
  'veh-personal-data-classification.json'
);

const ENTITY = 'f0000000-0000-4000-8000-0000000a9001';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

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
});

afterAll(async () => {
  await admin.query(`DELETE FROM shared.search_metadata WHERE entity_type = 'veh.vehicle'`);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('veh search — read-only runtime contract', () => {
  it('runtime and readonly cannot write shared.search_metadata (42501)', async () => {
    const ins = (tenant: string) =>
      `INSERT INTO shared.search_metadata (tenant_id, entity_type, entity_id, field_code, normalized_value, classification, source_updated_at, created_by)
       VALUES ('${tenant}','veh.vehicle','${ENTITY}','vin','1HGCM82633A004352','internal',now(),'${USER_A}')`;
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(ins(TENANT_A)), '42501');
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(c.query(ins(TENANT_A)), '42501');
    });
  });

  it('runtime can SELECT shared.search_metadata', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const r = await c.query(`SELECT count(*)::int AS n FROM shared.search_metadata`);
      expect(typeof r.rows[0].n).toBe('number');
    });
  });
});

describe('veh search — normalization reuse', () => {
  it('reuses veh.normalize_vin and veh.normalize_plate', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const vin = (await c.query(`SELECT veh.normalize_vin(' 1hg cm-8 ') AS v`)).rows[0].v;
      expect(vin).toBe('1HGCM8');
      const plate = (await c.query(`SELECT veh.normalize_plate('  22-3 ك 45 ') AS v`)).rows[0].v;
      expect(plate).toContain('223');
    });
  });
});

describe('veh search — projected row isolation + no PII', () => {
  it('a tenant-A projection is visible only to tenant A and carries only the normalized value', async () => {
    await admin.query(
      `INSERT INTO shared.search_metadata (tenant_id, entity_type, entity_id, field_code, normalized_value, classification, source_updated_at, created_by)
       VALUES ($1,'veh.vehicle',$2,'vin','1HGCM82633A004352','internal',now(),$3)`,
      [TENANT_A, ENTITY, USER_A]
    );
    try {
      await withRolledBackTx(runtime, ctxA, async (c) => {
        const r = await c.query(
          `SELECT normalized_value FROM shared.search_metadata WHERE entity_type='veh.vehicle' AND entity_id=$1`,
          [ENTITY]
        );
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].normalized_value).toBe('1HGCM82633A004352');
      });
      await withRolledBackTx(runtime, ctxB, async (c) => {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM shared.search_metadata WHERE entity_type='veh.vehicle' AND entity_id=$1`,
          [ENTITY]
        );
        expect(r.rows[0].n).toBe(0); // tenant B cannot see tenant A's projection
      });
    } finally {
      await admin.query(`DELETE FROM shared.search_metadata WHERE entity_id=$1`, [ENTITY]);
    }
  });
});

describe('veh search — classification registry matches the allow-list', () => {
  it('the searchable set is exactly the approved fields and none is restricted', () => {
    const doc = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    const searchable = Object.entries(doc.columns)
      .filter(([, m]) => (m as { searchable?: boolean }).searchable === true)
      .map(([c]) => c)
      .sort();
    expect(searchable).toEqual(
      [
        'makes.name',
        'models.name',
        'plate_history.plate_normalized',
        'trims.name',
        'vehicles.display_number',
        'vehicles.vin_normalized',
      ].sort()
    );
    // No restricted column may be searchable.
    const restrictedSearchable = Object.entries(doc.columns).filter(
      ([, m]) =>
        (m as { classification?: string }).classification === 'restricted' &&
        (m as { searchable?: boolean }).searchable === true
    );
    expect(restrictedSearchable).toEqual([]);
    // The restricted identifier value columns exist and are NOT searchable.
    expect(doc.columns['vehicle_identifiers.raw_value'].classification).toBe('restricted');
    expect(doc.columns['vehicle_identifiers.raw_value'].searchable).toBe(false);
    expect(doc.columns['vehicle_identifiers.normalized_value'].searchable).toBe(false);
  });
});
