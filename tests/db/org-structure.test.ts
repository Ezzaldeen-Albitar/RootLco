/**
 * Phase 1-3 — departments, warehouses, storage locations, cost centres
 * (P1-03-DB-008/009/010/011, P1-03-QA-002/003 subsets).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  BRANCH_A1,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  withRolledBackTx,
} from './helpers';

let admin: Pool;
let runtime: Pool;
let companyB1: string;
let branchB1: string;
let warehouseA1: string;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  const c = await admin.query(
    `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, 'company_b1', 'Fixture Company B1', 'USD', $2) RETURNING id`,
    [TENANT_B, USER_B]
  );
  companyB1 = c.rows[0].id;
  const b = await admin.query(
    `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, 'branch_b1', 'Fixture Branch B1', 'UTC', $3) RETURNING id`,
    [TENANT_B, companyB1, USER_B]
  );
  branchB1 = b.rows[0].id;
  const w = await admin.query(
    `INSERT INTO org.warehouses (tenant_id, company_id, branch_id, warehouse_code, name, created_by)
     VALUES ($1, $2, $3, 'wh_a1', 'Fixture Warehouse A1', $4) RETURNING id`,
    [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
  );
  warehouseA1 = w.rows[0].id;
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('org.departments — scope integrity and uniqueness', () => {
  it('a runtime session creates a department under its own branch', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
         VALUES ($1, $2, $3, 'service', 'Service Dept', $4) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
      );
      expect(rows).toHaveLength(1);
    });
  });

  it("a department cannot reference another tenant's branch (composite FK → 23503)", async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
         VALUES ($1, $2, $3, 'crossdept', 'Cross', $4)`,
        [TENANT_A, COMPANY_A1, branchB1, USER_A]
      ),
      '23503'
    );
  });

  it('duplicate live department code within a branch is rejected (23505); other branch is fine', async () => {
    const d = await admin.query(
      `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
       VALUES ($1, $2, $3, 'reception', 'Reception', $4) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
           VALUES ($1, $2, $3, 'reception', 'Reception again', $4)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
        ),
        '23505'
      );
      const other = await admin.query(
        `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
         VALUES ($1, $2, $3, 'reception', 'Reception at B1', $4) RETURNING id`,
        [TENANT_B, companyB1, branchB1, USER_B]
      );
      await admin.query('DELETE FROM org.departments WHERE id = $1', [other.rows[0].id]);
    } finally {
      await admin.query('DELETE FROM org.departments WHERE id = $1', [d.rows[0].id]);
    }
  });

  it('an ARCHIVED department frees its code (live-only uniqueness, documented decision)', async () => {
    const first = await admin.query(
      `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by, archived_at, archived_by)
       VALUES ($1, $2, $3, 'seasonal', 'Old seasonal', $4, now(), $4) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
    );
    const second = await admin.query(
      `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
       VALUES ($1, $2, $3, 'seasonal', 'New seasonal', $4) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
    );
    await admin.query('DELETE FROM org.departments WHERE id IN ($1, $2)', [
      first.rows[0].id,
      second.rows[0].id,
    ]);
  });

  it('an archived branch rejects NEW departments (guard → 23514)', async () => {
    const deadBranch = await admin.query(
      `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by, archived_at, archived_by)
       VALUES ($1, $2, 'mothballed', 'Mothballed branch', 'UTC', $3, now(), $3) RETURNING id`,
      [TENANT_A, COMPANY_A1, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.departments (tenant_id, company_id, branch_id, department_code, name, created_by)
           VALUES ($1, $2, $3, 'orphan', 'Orphan dept', $4)`,
          [TENANT_A, COMPANY_A1, deadBranch.rows[0].id, USER_A]
        ),
        '23514'
      );
    } finally {
      await admin.query('DELETE FROM org.branches WHERE id = $1', [deadBranch.rows[0].id]);
    }
  });
});

describe('org.warehouses — structure only, no stock', () => {
  it('holds NO stock or quantity columns (scope guard for later phases)', async () => {
    const { rows } = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'org' AND table_name IN ('warehouses', 'storage_locations')
         AND (column_name ILIKE '%stock%' OR column_name ILIKE '%quantity%'
              OR column_name ILIKE '%balance%' OR column_name ILIKE '%movement%')`
    );
    expect(rows).toEqual([]);
  });

  it('warehouse_type is constrained to the platform set (23514)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.warehouses (tenant_id, company_id, branch_id, warehouse_code, name, warehouse_type, created_by)
         VALUES ($1, $2, $3, 'badtype', 'Bad type', 'volcano', $4)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
      ),
      '23514'
    );
  });

  it('tenant B cannot see or update tenant A warehouses', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, async (c) => {
      const sel = await c.query('SELECT id FROM org.warehouses WHERE id = $1', [warehouseA1]);
      expect(sel.rows).toHaveLength(0);
      const upd = await c.query(`UPDATE org.warehouses SET name = 'defaced' WHERE id = $1`, [
        warehouseA1,
      ]);
      expect(upd.rowCount).toBe(0);
    });
  });
});

describe('org.storage_locations — warehouse composite scope', () => {
  it('a runtime session creates a location in its own warehouse', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO org.storage_locations (tenant_id, company_id, branch_id, warehouse_id, location_code, name, created_by)
         VALUES ($1, $2, $3, $4, 'aisle_1', 'Aisle 1', $5) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, warehouseA1, USER_A]
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('a location cannot reference a warehouse in another tenant (23503)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.storage_locations (tenant_id, company_id, branch_id, warehouse_id, location_code, name, created_by)
         VALUES ($1, $2, $3, $4, 'stolen', 'Stolen shelf', $5)`,
        [TENANT_B, companyB1, branchB1, warehouseA1, USER_B]
      ),
      '23503'
    );
  });

  it('duplicate live location code within a warehouse is rejected (23505)', async () => {
    const l = await admin.query(
      `INSERT INTO org.storage_locations (tenant_id, company_id, branch_id, warehouse_id, location_code, name, created_by)
       VALUES ($1, $2, $3, $4, 'bin_a', 'Bin A', $5) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, warehouseA1, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.storage_locations (tenant_id, company_id, branch_id, warehouse_id, location_code, name, created_by)
           VALUES ($1, $2, $3, $4, 'bin_a', 'Bin A again', $5)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, warehouseA1, USER_A]
        ),
        '23505'
      );
    } finally {
      await admin.query('DELETE FROM org.storage_locations WHERE id = $1', [l.rows[0].id]);
    }
  });

  it('an archived warehouse rejects NEW locations (guard → 23514)', async () => {
    const dead = await admin.query(
      `INSERT INTO org.warehouses (tenant_id, company_id, branch_id, warehouse_code, name, created_by, archived_at, archived_by)
       VALUES ($1, $2, $3, 'wh_dead', 'Closed warehouse', $4, now(), $4) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.storage_locations (tenant_id, company_id, branch_id, warehouse_id, location_code, name, created_by)
           VALUES ($1, $2, $3, $4, 'ghost', 'Ghost bin', $5)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, dead.rows[0].id, USER_A]
        ),
        '23514'
      );
    } finally {
      await admin.query('DELETE FROM org.warehouses WHERE id = $1', [dead.rows[0].id]);
    }
  });

  it('archive preserves the row and its history (archive is not deletion)', async () => {
    const l = await admin.query(
      `INSERT INTO org.storage_locations (tenant_id, company_id, branch_id, warehouse_id, location_code, name, created_by)
       VALUES ($1, $2, $3, $4, 'kept', 'Kept bin', $5) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, warehouseA1, USER_A]
    );
    await admin.query(
      `UPDATE org.storage_locations SET archived_at = now(), archived_by = $2 WHERE id = $1`,
      [l.rows[0].id, USER_A]
    );
    const still = await admin.query(
      'SELECT archived_at, record_version FROM org.storage_locations WHERE id = $1',
      [l.rows[0].id]
    );
    expect(still.rows).toHaveLength(1);
    expect(still.rows[0].archived_at).not.toBeNull();
    expect(still.rows[0].record_version).toBe(2);
    await admin.query('DELETE FROM org.storage_locations WHERE id = $1', [l.rows[0].id]);
  });
});

describe('org.cost_centers — effective-dated, company-scoped', () => {
  it('overlapping validity for one code is rejected (23P01); successive versions are fine', async () => {
    const v1 = await admin.query(
      `INSERT INTO org.cost_centers (tenant_id, company_id, cost_center_code, name, effective_from, effective_to, created_by)
       VALUES ($1, $2, 'workshop', 'Workshop v1', '2026-01-01', '2026-07-01', $3) RETURNING id`,
      [TENANT_A, COMPANY_A1, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.cost_centers (tenant_id, company_id, cost_center_code, name, effective_from, created_by)
           VALUES ($1, $2, 'workshop', 'Overlapping', '2026-03-01', $3)`,
          [TENANT_A, COMPANY_A1, USER_A]
        ),
        '23P01'
      );
      const v2 = await admin.query(
        `INSERT INTO org.cost_centers (tenant_id, company_id, cost_center_code, name, effective_from, created_by)
         VALUES ($1, $2, 'workshop', 'Workshop v2', '2026-07-01', $3) RETURNING id`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      await admin.query('DELETE FROM org.cost_centers WHERE id = $1', [v2.rows[0].id]);
    } finally {
      await admin.query('DELETE FROM org.cost_centers WHERE id = $1', [v1.rows[0].id]);
    }
  });

  it('the same code in another company does not collide', async () => {
    const other = await admin.query(
      `INSERT INTO org.cost_centers (tenant_id, company_id, cost_center_code, name, effective_from, created_by)
       VALUES ($1, $2, 'workshop', 'B1 workshop', '2026-01-01', $3) RETURNING id`,
      [TENANT_B, companyB1, USER_B]
    );
    await admin.query('DELETE FROM org.cost_centers WHERE id = $1', [other.rows[0].id]);
  });

  it('cross-tenant company reference is an FK violation (23503)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.cost_centers (tenant_id, company_id, cost_center_code, name, effective_from, created_by)
         VALUES ($1, $2, 'stolen_cc', 'Stolen', '2026-01-01', $3)`,
        [TENANT_A, companyB1, USER_A]
      ),
      '23503'
    );
  });

  it('runtime sessions are tenant-isolated on cost centres', async () => {
    const cc = await admin.query(
      `INSERT INTO org.cost_centers (tenant_id, company_id, cost_center_code, name, effective_from, created_by)
       VALUES ($1, $2, 'visible_cc', 'Visible CC', '2026-01-01', $3) RETURNING id`,
      [TENANT_A, COMPANY_A1, USER_A]
    );
    try {
      await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
        const { rows } = await c.query('SELECT id FROM org.cost_centers');
        expect(rows.map((r) => r.id)).toContain(cc.rows[0].id);
      });
      await withRolledBackTx(runtime, { tenantId: TENANT_B }, async (c) => {
        const { rows } = await c.query('SELECT id FROM org.cost_centers WHERE id = $1', [
          cc.rows[0].id,
        ]);
        expect(rows).toHaveLength(0);
      });
    } finally {
      await admin.query('DELETE FROM org.cost_centers WHERE id = $1', [cc.rows[0].id]);
    }
  });
});
