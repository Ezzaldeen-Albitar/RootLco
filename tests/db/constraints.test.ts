/**
 * Reusable constraint templates — positive AND negative proof
 * (P1-02-DB-005/010/011, P1-02-QA-004).
 *
 * These templates are what later phases copy when they build business tables.
 * They live in a DISPOSABLE fixture schema created and dropped by this suite —
 * they are NOT business tables and NOT part of the platform schema.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  expectSqlState,
  FIXTURE_SCHEMA,
  TENANT_A,
  TENANT_B,
} from './helpers';

let admin: Pool;
const S = FIXTURE_SCHEMA;

beforeAll(async () => {
  admin = adminPool();
  await cleanFixtures(admin);
  await admin.query(`CREATE SCHEMA ${S}`);

  // Composite-FK template: the child row must live in the SAME tenant as its
  // parent. Referencing (tenant_id, id) makes a cross-tenant link a type-level
  // impossibility instead of an application promise.
  await admin.query(`
    CREATE TABLE ${S}.parents (
      id        uuid NOT NULL DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      CONSTRAINT pk_parents PRIMARY KEY (id),
      CONSTRAINT uq_parents_tenant_scope UNIQUE (tenant_id, id)
    )
  `);
  await admin.query(`
    CREATE TABLE ${S}.children (
      id        uuid NOT NULL DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      parent_id uuid NOT NULL,
      CONSTRAINT pk_children PRIMARY KEY (id),
      CONSTRAINT fk_children_parent_tenant_scoped
        FOREIGN KEY (tenant_id, parent_id)
        REFERENCES ${S}.parents (tenant_id, id)
        ON DELETE RESTRICT
    )
  `);

  // Soft-delete + partial-unique template: the business key is unique among
  // ACTIVE rows only; deleted rows keep their history without blocking reuse.
  await admin.query(`
    CREATE TABLE ${S}.coded_things (
      id         uuid NOT NULL DEFAULT gen_random_uuid(),
      tenant_id  uuid NOT NULL,
      code       text NOT NULL,
      deleted_at timestamptz NULL,
      CONSTRAINT pk_coded_things PRIMARY KEY (id)
    )
  `);
  await admin.query(`
    CREATE UNIQUE INDEX uq_coded_things_tenant_code_active
      ON ${S}.coded_things (tenant_id, code)
      WHERE deleted_at IS NULL
  `);

  // EXCLUDE template (btree_gist): one resource cannot be double-booked
  // within a tenant; different tenants never collide.
  await admin.query(`
    CREATE TABLE ${S}.slots (
      id          uuid NOT NULL DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL,
      resource_id uuid NOT NULL,
      during      tstzrange NOT NULL,
      CONSTRAINT pk_slots PRIMARY KEY (id),
      CONSTRAINT ex_slots_no_overlap
        EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, during WITH &&)
    )
  `);

  // CHECK template.
  await admin.query(`
    CREATE TABLE ${S}.amounts (
      id       uuid NOT NULL DEFAULT gen_random_uuid(),
      quantity numeric(12,3) NOT NULL,
      CONSTRAINT pk_amounts PRIMARY KEY (id),
      CONSTRAINT ck_amounts_quantity_positive CHECK (quantity > 0)
    )
  `);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
});

const RESOURCE = 'c0000000-0000-4000-8000-00000000000c';

describe('composite FK (tenant-scope isolation)', () => {
  it('accepts a child in the same tenant as its parent', async () => {
    const parent = await admin.query(
      `INSERT INTO ${S}.parents (tenant_id) VALUES ($1) RETURNING id`,
      [TENANT_A]
    );
    const { rowCount } = await admin.query(
      `INSERT INTO ${S}.children (tenant_id, parent_id) VALUES ($1, $2)`,
      [TENANT_A, parent.rows[0].id]
    );
    expect(rowCount).toBe(1);
  });

  it('REJECTS a cross-tenant link (Tenant B child → Tenant A parent)', async () => {
    const parent = await admin.query(
      `INSERT INTO ${S}.parents (tenant_id) VALUES ($1) RETURNING id`,
      [TENANT_A]
    );
    await expectSqlState(
      admin.query(`INSERT INTO ${S}.children (tenant_id, parent_id) VALUES ($1, $2)`, [
        TENANT_B,
        parent.rows[0].id,
      ]),
      '23503' // foreign_key_violation
    );
  });

  it('ON DELETE RESTRICT blocks deleting a referenced parent', async () => {
    const parent = await admin.query(
      `INSERT INTO ${S}.parents (tenant_id) VALUES ($1) RETURNING id`,
      [TENANT_A]
    );
    await admin.query(`INSERT INTO ${S}.children (tenant_id, parent_id) VALUES ($1, $2)`, [
      TENANT_A,
      parent.rows[0].id,
    ]);
    await expectSqlState(
      admin.query(`DELETE FROM ${S}.parents WHERE id = $1`, [parent.rows[0].id]),
      '23503'
    );
  });
});

describe('partial unique index with soft deletion', () => {
  it('rejects a duplicate ACTIVE code within a tenant', async () => {
    await admin.query(`INSERT INTO ${S}.coded_things (tenant_id, code) VALUES ($1, 'X-1')`, [
      TENANT_A,
    ]);
    await expectSqlState(
      admin.query(`INSERT INTO ${S}.coded_things (tenant_id, code) VALUES ($1, 'X-1')`, [TENANT_A]),
      '23505' // unique_violation
    );
  });

  it('allows the same code again after the old row is soft-deleted', async () => {
    await admin.query(
      `UPDATE ${S}.coded_things SET deleted_at = now() WHERE tenant_id = $1 AND code = 'X-1'`,
      [TENANT_A]
    );
    const { rowCount } = await admin.query(
      `INSERT INTO ${S}.coded_things (tenant_id, code) VALUES ($1, 'X-1')`,
      [TENANT_A]
    );
    expect(rowCount).toBe(1);
  });

  it('allows the same code in a DIFFERENT tenant (scope-local uniqueness)', async () => {
    const { rowCount } = await admin.query(
      `INSERT INTO ${S}.coded_things (tenant_id, code) VALUES ($1, 'X-1')`,
      [TENANT_B]
    );
    expect(rowCount).toBe(1);
  });
});

describe('EXCLUDE constraint (btree_gist, non-overlapping intervals)', () => {
  it('accepts non-overlapping bookings for the same resource', async () => {
    await admin.query(
      `INSERT INTO ${S}.slots (tenant_id, resource_id, during)
       VALUES ($1, $2, tstzrange('2026-08-01 09:00Z', '2026-08-01 10:00Z'))`,
      [TENANT_A, RESOURCE]
    );
    const { rowCount } = await admin.query(
      `INSERT INTO ${S}.slots (tenant_id, resource_id, during)
       VALUES ($1, $2, tstzrange('2026-08-01 10:00Z', '2026-08-01 11:00Z'))`,
      [TENANT_A, RESOURCE]
    );
    expect(rowCount).toBe(1);
  });

  it('REJECTS an overlapping booking for the same tenant + resource', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO ${S}.slots (tenant_id, resource_id, during)
         VALUES ($1, $2, tstzrange('2026-08-01 09:30Z', '2026-08-01 09:45Z'))`,
        [TENANT_A, RESOURCE]
      ),
      '23P01' // exclusion_violation
    );
  });

  it('allows the overlapping window for ANOTHER tenant (tenant-scoped exclusion)', async () => {
    const { rowCount } = await admin.query(
      `INSERT INTO ${S}.slots (tenant_id, resource_id, during)
       VALUES ($1, $2, tstzrange('2026-08-01 09:30Z', '2026-08-01 09:45Z'))`,
      [TENANT_B, RESOURCE]
    );
    expect(rowCount).toBe(1);
  });
});

describe('CHECK constraint template', () => {
  it('accepts a valid value and rejects an invalid one', async () => {
    const ok = await admin.query(`INSERT INTO ${S}.amounts (quantity) VALUES (12.5)`);
    expect(ok.rowCount).toBe(1);
    await expectSqlState(
      admin.query(`INSERT INTO ${S}.amounts (quantity) VALUES (0)`),
      '23514' // check_violation
    );
  });
});

describe('constraint and index naming (naming standard)', () => {
  it('every fixture constraint carries its approved prefix', async () => {
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND c.conname NOT LIKE '%_not_null'`,
      [S]
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { conname } of rows) {
      expect(conname).toMatch(/^(pk|fk|uq|ck|ex)_/);
    }
  });

  it('every standalone fixture index carries ix_ or uq_', async () => {
    const { rows } = await admin.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, [
      S,
    ]);
    for (const { indexname } of rows) {
      expect(indexname).toMatch(/^(pk|ix|uq|ex)_/);
    }
  });
});
