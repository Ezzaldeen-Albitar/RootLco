/**
 * Phase 1-3 — automated structural security assertions
 * (P1-03-DB-017/018, P1-03-SEC-001/002, P1-03-QA-004 structural contract).
 *
 * These are catalog-level invariants: they hold for every current table and
 * will FAIL the build for any future table that violates them — the guard is
 * the assertion, not reviewer attention.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool, ensureTestLogins } from './helpers';

/**
 * Documented platform/root exceptions to the tenant-column rule.
 * Every entry must have a written justification in its table COMMENT and in
 * the data dictionary — adding to this list is a reviewed decision.
 */
const TENANT_COLUMN_EXCEPTIONS = new Set([
  'org.tenants', // ROOT: its own id IS the scope value (documented in-table)
  'org.feature_flags', // platform feature register
  'org.subscription_plans', // platform plan catalogue
  'shared.currencies', // Class 1 platform reference data
  'shared.timezones',
  'shared.languages',
  'iam.permissions', // platform-owned permission catalogue (no tenant scope)
  'shared.retention_classes', // platform retention definitions (no tenant scope)
  'shared.localization_keys', // platform localization-key catalogue
  'shared.localized_texts', // governed platform localization content
]);

/** Tables whose tenant_id is nullable BY DESIGN (documented adaptation). */
const NULLABLE_TENANT_EXCEPTIONS = new Set([
  'shared.idempotency_keys', // platform-scope operations have no tenant yet
  'iam.login_audit', // failed attempts against an unknown principal have no tenant
  'iam.security_events', // platform-level security events have no tenant
  'shared.document_categories', // dual-scope: platform default (tenant NULL) OR tenant override
  'shared.message_templates', // dual-scope: platform default (tenant NULL) OR tenant override
  'shared.template_versions', // mirrors its platform/tenant template tenant_id, including NULL
  'shared.processed_events', // platform consumers process platform-scope work without a tenant
  'shared.error_records', // errors can occur before tenant context is established
  'shared.system_settings', // dual-scope: platform default (tenant NULL) OR tenant override
  // Phase 1-7 vehicle reference catalogs — dual-scope: platform default (tenant NULL) OR tenant extension.
  'veh.makes',
  'veh.models',
  'veh.trims',
  'veh.body_types',
  'veh.powertrain_types',
]);

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
});

afterAll(async () => {
  await admin.end();
});

describe('tenant-column invariant', () => {
  it('every module-schema table carries tenant_id NOT NULL unless it is a documented exception', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || c.relname AS fq,
              a.attname IS NOT NULL AS has_tenant_id,
              COALESCE(a.attnotnull, false) AS tenant_not_null
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attribute a
         ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
       WHERE n.nspname IN ('apt','org','iam','shared','crm','rec','veh') AND c.relkind = 'r'
       ORDER BY 1`
    );
    const violations: string[] = [];
    for (const r of rows) {
      if (TENANT_COLUMN_EXCEPTIONS.has(r.fq)) {
        if (r.has_tenant_id) violations.push(`${r.fq}: listed as exception but HAS tenant_id`);
        continue;
      }
      if (NULLABLE_TENANT_EXCEPTIONS.has(r.fq)) {
        if (!r.has_tenant_id) violations.push(`${r.fq}: must have a nullable tenant_id`);
        continue;
      }
      if (!r.has_tenant_id) violations.push(`${r.fq}: tenant-owned table without tenant_id`);
      else if (!r.tenant_not_null) violations.push(`${r.fq}: tenant_id must be NOT NULL`);
    }
    expect(violations, violations.join('; ')).toEqual([]);
  });
});

describe('foreign-key index coverage (P1-03-DB-017)', () => {
  it('every FK in a module schema has an index whose leading columns cover it', async () => {
    const { rows } = await admin.query(
      `WITH fks AS (
         SELECT c.conname,
                n.nspname || '.' || t.relname AS child,
                t.oid AS child_oid,
                c.conkey
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE c.contype = 'f' AND n.nspname IN ('apt','org','iam','shared','crm','rec','veh')
       )
       SELECT f.conname, f.child
       FROM fks f
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_index i
         WHERE i.indrelid = f.child_oid
           AND i.indpred IS NULL
           -- the index's leading columns, as a set, cover the FK columns
           AND (SELECT array_agg(k ORDER BY k)
                  FROM unnest(f.conkey) k)
             = (SELECT array_agg(k ORDER BY k)
                  FROM unnest((i.indkey::int2[])[0:array_length(f.conkey,1)-1]) k)
       )
       ORDER BY 1`
    );
    expect(
      rows.map((r) => `${r.child} ${r.conname}`),
      'FKs without a supporting leading-column index'
    ).toEqual([]);
  });

  it('no exact-duplicate indexes exist in module schemas', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || t.relname AS tbl, i.indkey::text, count(*)
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE n.nspname IN ('apt','org','iam','shared','crm','rec','veh')
         AND i.indpred IS NULL
       GROUP BY 1, 2
       HAVING count(*) > 1`
    );
    expect(rows).toEqual([]);
  });
});

describe('role posture', () => {
  it('application roles own no relation and carry no BYPASSRLS', async () => {
    const owned = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE r.rolname IN ('app_runtime','app_readonly','app_worker')`
    );
    expect(owned.rows).toEqual([]);
    const attrs = await admin.query(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
       WHERE rolname IN (
         'app_runtime','app_readonly','app_worker',
         'rootlco_test_runtime','rootlco_test_readonly','rootlco_test_worker'
       )`
    );
    expect(attrs.rows).toHaveLength(6);
    for (const r of attrs.rows) {
      expect(r.rolbypassrls, `${r.rolname} must not BYPASSRLS`).toBe(false);
      expect(r.rolsuper, `${r.rolname} must not be superuser`).toBe(false);
    }
  });

  it('application roles hold NO privilege on platform-only tables (idempotency keys)', async () => {
    const { rows } = await admin.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'shared' AND table_name = 'idempotency_keys'
         AND grantee IN ('app_runtime','app_readonly')`
    );
    expect(rows).toEqual([]);
  });

  it('DELETE is granted to application roles on NO module-schema table', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq FROM information_schema.role_table_grants
       WHERE table_schema IN ('apt','org','iam','shared','crm','rec','veh')
         AND grantee IN ('app_runtime','app_readonly','app_worker')
         AND privilege_type = 'DELETE'`
    );
    expect(
      rows,
      'soft delete is an UPDATE; hard delete is never an application capability'
    ).toEqual([]);
  });
});

describe('data-dictionary coverage (P1-03-DOC-001, P1-03-SEC-003)', () => {
  it('every module-schema table AND column appears in the data dictionary', async () => {
    const dict = readFileSync(
      join(__dirname, '..', '..', 'docs', 'database', 'data-dictionary.md'),
      'utf8'
    );
    const { rows } = await admin.query(
      `SELECT table_schema, table_name, column_name
       FROM information_schema.columns
       WHERE table_schema IN ('apt','org','iam','shared','crm','rec','veh')
       ORDER BY 1, 2, 3`
    );
    const missing: string[] = [];
    const seenTables = new Set<string>();
    for (const r of rows) {
      const fq = `${r.table_schema}.${r.table_name}`;
      if (!seenTables.has(fq)) {
        seenTables.add(fq);
        if (!dict.includes(fq)) missing.push(`table ${fq}`);
      }
      if (!dict.includes(`\`${r.column_name}\``)) missing.push(`column ${fq}.${r.column_name}`);
    }
    expect(missing, `undocumented (unclassified) objects: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('structural contract for Phase 1-4 (stable keys the next phase builds on)', () => {
  it('the composite candidate keys and status constraints exist by their contracted names', async () => {
    const expected = [
      'uq_tenants_tenant_code',
      'uq_legal_companies_tenant_id_id',
      'uq_branches_tenant_id_id',
      'uq_branches_tenant_company_id',
      'uq_warehouses_scope_id',
      'uq_tax_classes_scope_id',
      'ck_tenants_status',
      'ck_legal_companies_status',
      'ck_branches_status',
      'fk_branches_company',
      'fk_number_sequences_tenant',
      'fk_number_sequences_company',
      'fk_number_sequences_branch',
    ];
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname IN ('org','shared') AND conname = ANY($1::text[])`,
      [expected]
    );
    const found = rows.map((r) => r.conname).sort();
    expect(found).toEqual([...expected].sort());
  });

  it('scope columns expose uuid types and the four lifecycle statuses are stable', async () => {
    const { rows } = await admin.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'org' AND table_name = 'tenants' AND column_name = 'id'`
    );
    expect(rows[0].data_type).toBe('uuid');
    const status = await admin.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_tenants_status'`
    );
    for (const s of ['provisioning', 'active', 'suspended', 'closed']) {
      expect(status.rows[0].def).toContain(s);
    }
  });
});
