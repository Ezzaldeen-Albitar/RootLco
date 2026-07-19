/**
 * Phase 1-7 Vehicle master (P1-07-DB-001/002/019).
 *
 * Proves Vehicle independence (no owner/partner column), generated VIN
 * normalization, tenant-scoped active-VIN uniqueness (merged/soft-deleted
 * excluded, cross-tenant coexistence), fail-closed catalog-reference + hierarchy
 * + powertrain-category guards, merge-redirect integrity (self/cycle/deleted
 * survivor/frozen), lifecycle-vs-workshop coherence, display-number allocation
 * via the shared allocator, tenant isolation, and optimistic record_version.
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

const PMAKE = 'f0000000-0000-4000-8000-0000000c0a01';
const PMAKE2 = 'f0000000-0000-4000-8000-0000000c0a02';
const PMODEL = 'f0000000-0000-4000-8000-0000000c0b01';
const PMODEL2 = 'f0000000-0000-4000-8000-0000000c0b02';
const PTRIM = 'f0000000-0000-4000-8000-0000000c0c01';
const PBODY = 'f0000000-0000-4000-8000-0000000c0d01';
const PPWR_EV = 'f0000000-0000-4000-8000-0000000c0e01';
const TB_MAKE = 'f0000000-0000-4000-8000-0000000c0f0b';
const V_A1 = 'f0000000-0000-4000-8000-0000000c1a01';
const V_B1 = 'f0000000-0000-4000-8000-0000000c1b01';
const SHARED_VIN = '1HGCM82633A004352';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();

  // Platform catalogs + a tenant-B make (committed; admin bypasses RLS).
  await admin.query(
    `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by) VALUES
       ($1, 'platform', NULL, 'fx_pmk', 'P Make', $3),
       ($2, 'platform', NULL, 'fx_pmk2', 'P Make 2', $3)`,
    [PMAKE, PMAKE2, USER_A]
  );
  await admin.query(
    `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by)
       VALUES ($1, 'tenant', $2, 'fx_tbmk', 'Tenant B Make', $3)`,
    [TB_MAKE, TENANT_B, USER_B]
  );
  await admin.query(
    `INSERT INTO veh.models (id, scope, tenant_id, make_id, code, name, created_by) VALUES
       ($1, 'platform', NULL, $3, 'fx_pmd', 'P Model', $5),
       ($2, 'platform', NULL, $4, 'fx_pmd2', 'P Model 2', $5)`,
    [PMODEL, PMODEL2, PMAKE, PMAKE2, USER_A]
  );
  await admin.query(
    `INSERT INTO veh.trims (id, scope, tenant_id, model_id, code, name, created_by)
       VALUES ($1, 'platform', NULL, $2, 'fx_ptr', 'P Trim', $3)`,
    [PTRIM, PMODEL, USER_A]
  );
  await admin.query(
    `INSERT INTO veh.body_types (id, scope, tenant_id, code, name, created_by)
       VALUES ($1, 'platform', NULL, 'fx_pbody', 'Sedan', $2)`,
    [PBODY, USER_A]
  );
  await admin.query(
    `INSERT INTO veh.powertrain_types (id, scope, tenant_id, code, name, category, created_by)
       VALUES ($1, 'platform', NULL, 'fx_pev', 'Battery EV', 'ev', $2)`,
    [PPWR_EV, USER_A]
  );

  // Per-tenant 'vehicle' display-number sequence (onboarding path — admin).
  await admin.query(
    `INSERT INTO shared.number_sequences (tenant_id, sequence_code, prefix_template, pad_width, created_by)
       VALUES ($1, 'vehicle', 'VEH-', 6, $2)
     ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING`,
    [TENANT_A, USER_A]
  );

  // Same VIN in two tenants — must coexist (tenant-scoped uniqueness).
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, lifecycle_status, created_by) VALUES
       ($1, $3, $5, 'active', $6),
       ($2, $4, $5, 'active', $7)`,
    [V_A1, V_B1, TENANT_A, TENANT_B, SHARED_VIN, USER_A, USER_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('veh.vehicles — independence and generation', () => {
  it('has no owner/partner/customer column on the master', async () => {
    const { rows } = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='veh' AND table_name='vehicles'
         AND (column_name LIKE '%owner%' OR column_name LIKE '%partner%' OR column_name LIKE '%customer%')`
    );
    expect(rows).toEqual([]);
  });

  it('creates a draft vehicle with no VIN and no partner', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(
        `INSERT INTO veh.vehicles (tenant_id, created_by) VALUES ($1, $2)
         RETURNING lifecycle_status, workshop_status, vin_normalized`,
        [TENANT_A, USER_A]
      )
    );
    expect(res.rows[0]).toMatchObject({
      lifecycle_status: 'draft',
      workshop_status: 'none',
      vin_normalized: null,
    });
  });

  it('generates vin_normalized from vin_raw (uppercase, separators stripped)', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(
        `INSERT INTO veh.vehicles (tenant_id, vin_raw, created_by) VALUES ($1, ' jh4-ka8 ', $2)
         RETURNING vin_normalized`,
        [TENANT_A, USER_A]
      )
    );
    expect(res.rows[0].vin_normalized).toBe('JH4KA8');
  });
});

describe('veh.vehicles — active VIN uniqueness (P1-07-DB-002)', () => {
  it('rejects a duplicate active normalized VIN within a tenant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vehicles (tenant_id, vin_raw, lifecycle_status, created_by)
           VALUES ($1, $2, 'active', $3)`,
          [TENANT_A, SHARED_VIN, USER_A]
        ),
        '23505'
      );
    });
  });

  it('allows the same VIN in a different tenant (proven at rest)', async () => {
    const { rows } = await admin.query(
      `SELECT tenant_id FROM veh.vehicles WHERE vin_normalized = $1 ORDER BY tenant_id`,
      [SHARED_VIN]
    );
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([TENANT_A, TENANT_B].sort());
  });

  it('a soft-deleted VIN frees the value for reuse', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(`UPDATE veh.vehicles SET deleted_at = now() WHERE id = $1`, [V_A1]);
      const res = await c.query(
        `INSERT INTO veh.vehicles (tenant_id, vin_raw, lifecycle_status, created_by)
         VALUES ($1, $2, 'active', $3) RETURNING id`,
        [TENANT_A, SHARED_VIN, USER_A]
      );
      expect(res.rows).toHaveLength(1);
    });
  });

  it('a merged vehicle is excluded from active VIN uniqueness', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const survivor = (
        await c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by)
           VALUES ($1, 'draft', $2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      const source = (
        await c.query(
          `INSERT INTO veh.vehicles (tenant_id, vin_raw, lifecycle_status, created_by)
           VALUES ($1, 'MERGEDVIN9', 'active', $2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `UPDATE veh.vehicles SET lifecycle_status='merged', merged_into_id=$2 WHERE id=$1`,
        [source, survivor]
      );
      // The merged source no longer occupies its VIN.
      const res = await c.query(
        `INSERT INTO veh.vehicles (tenant_id, vin_raw, lifecycle_status, created_by)
         VALUES ($1, 'MERGEDVIN9', 'active', $2) RETURNING id`,
        [TENANT_A, USER_A]
      );
      expect(res.rows).toHaveLength(1);
    });
  });
});

describe('veh.vehicles — catalog reference guards', () => {
  it('accepts a consistent make/model/trim/body/powertrain set', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(
        `INSERT INTO veh.vehicles
           (tenant_id, make_id, model_id, trim_id, body_type_id, powertrain_type_id,
            powertrain_category, model_year, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'ev',2022,$7) RETURNING id`,
        [TENANT_A, PMAKE, PMODEL, PTRIM, PBODY, PPWR_EV, USER_A]
      )
    );
    expect(res.rows).toHaveLength(1);
  });

  it('rejects a powertrain_type whose category conflicts with powertrain_category', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vehicles (tenant_id, powertrain_type_id, powertrain_category, created_by)
           VALUES ($1, $2, 'ice', $3)`,
          [TENANT_A, PPWR_EV, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects a model that does not belong to the chosen make', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vehicles (tenant_id, make_id, model_id, created_by)
           VALUES ($1, $2, $3, $4)`,
          [TENANT_A, PMAKE, PMODEL2, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects a cross-tenant catalog reference (fail-closed under RLS)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`INSERT INTO veh.vehicles (tenant_id, make_id, created_by) VALUES ($1, $2, $3)`, [
          TENANT_A,
          TB_MAKE,
          USER_A,
        ]),
        '23503'
      );
    });
  });
});

describe('veh.vehicles — merge-redirect integrity', () => {
  it('rejects a self-merge', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const id = (
        await c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by)
           VALUES ($1,'draft',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      await expectSqlState(
        c.query(
          `UPDATE veh.vehicles SET lifecycle_status='merged', merged_into_id=$1 WHERE id=$1`,
          [id]
        ),
        '23514'
      );
    });
  });

  it('merges into a live survivor and then freezes the merged source', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const survivor = (
        await c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by)
           VALUES ($1,'draft',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      const source = (
        await c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by)
           VALUES ($1,'draft',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `UPDATE veh.vehicles SET lifecycle_status='merged', merged_into_id=$2 WHERE id=$1`,
        [source, survivor]
      );
      await expectSqlState(
        c.query(`UPDATE veh.vehicles SET color='hijacked' WHERE id=$1`, [source]),
        '23514'
      );
    });
  });

  it('rejects merging into an already-merged survivor (no chaining/cycle)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const mk = async () =>
        (
          await c.query(
            `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by)
             VALUES ($1,'draft',$2) RETURNING id`,
            [TENANT_A, USER_A]
          )
        ).rows[0].id;
      const a = await mk();
      const b = await mk();
      const cc = await mk();
      await c.query(
        `UPDATE veh.vehicles SET lifecycle_status='merged', merged_into_id=$2 WHERE id=$1`,
        [a, b]
      );
      await expectSqlState(
        c.query(
          `UPDATE veh.vehicles SET lifecycle_status='merged', merged_into_id=$2 WHERE id=$1`,
          [cc, a]
        ),
        '23514'
      );
    });
  });

  it('rejects merging into a soft-deleted survivor', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const survivor = (
        await c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by)
           VALUES ($1,'draft',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      await c.query(`UPDATE veh.vehicles SET deleted_at=now() WHERE id=$1`, [survivor]);
      const source = (
        await c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by)
           VALUES ($1,'draft',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      await expectSqlState(
        c.query(
          `UPDATE veh.vehicles SET lifecycle_status='merged', merged_into_id=$2 WHERE id=$1`,
          [source, survivor]
        ),
        '23514'
      );
    });
  });
});

describe('veh.vehicles — coherence, display numbers, isolation', () => {
  it('rejects a terminal lifecycle with a non-none workshop status', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, workshop_status, created_by)
           VALUES ($1, 'scrapped', 'in_workshop', $2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('allocates a display number via shared.next_display_number(vehicle)', async () => {
    const res = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A },
      async (c) => {
        const dn = (
          await c.query(`SELECT display_number FROM shared.next_display_number('vehicle')`)
        ).rows[0].display_number;
        return c.query(
          `INSERT INTO veh.vehicles (tenant_id, display_number, lifecycle_status, created_by)
         VALUES ($1, $2, 'draft', $3) RETURNING display_number`,
          [TENANT_A, dn, USER_A]
        );
      }
    );
    expect(res.rows[0].display_number).toMatch(/^VEH-\d{6}$/);
  });

  it('a tenant cannot see another tenant’s vehicle', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, (c) =>
      c.query(`SELECT id FROM veh.vehicles WHERE id = $1`, [V_A1])
    );
    expect(res.rows).toEqual([]);
  });

  it('touch trigger bumps record_version on update', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(`UPDATE veh.vehicles SET color='blue' WHERE id=$1 RETURNING record_version`, [V_A1])
    );
    expect(res.rows[0].record_version).toBe(2);
  });
});
