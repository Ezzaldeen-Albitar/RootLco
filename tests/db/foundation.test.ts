/**
 * Phase 1-2 foundation assertions (P1-02-QA-001, P1-02-DB-017/018).
 *
 * Verifies that the applied migrations produced exactly the approved
 * foundation — and NOTHING more. The business-table guard here is the same
 * check CI runs: a migration that sneaks a domain table in before its phase
 * fails this suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');

/** The complete allow-list of tables permitted to exist in module schemas
 *  during Phase 1-2. Anything else is a phase violation. */
const ALLOWED_TABLES = new Set([
  // Phase 1-2 foundation.
  'shared.number_sequences',
  // Phase 1-3 platform reference data (P1-03-DB-013). Registered explicitly:
  // this allow-list IS the scope guard, so every new table is a deliberate entry
  // rather than something that slipped in unnoticed.
  'shared.currencies',
  'shared.timezones',
  'shared.languages',
  // Phase 1-3 organizational backbone (P1-03-DB-001..004, P1-03-DB-015).
  'org.tenants',
  'org.tenant_status_history',
  'org.feature_flags',
  'org.subscription_plans',
  'org.tenant_subscriptions',
  'org.legal_companies',
  'org.branches',
  'org.branch_status_history',
  'org.departments',
  'org.warehouses',
  'org.storage_locations',
  'org.cost_centers',
  'org.company_settings',
  'org.branch_settings',
  'org.tax_classes',
  'org.tax_rates',
  'org.tenant_feature_overrides',
]);

/** Extensions the PROJECT approved (extension register, migration 0001). */
const APPROVED_EXTENSIONS = new Set(['pgcrypto', 'btree_gist', 'citext', 'pg_trgm']);
/** Extensions the ENVIRONMENT itself ships: plpgsql is a PostgreSQL default;
 *  the rest are pre-installed by the Supabase local image (absent in the plain
 *  postgres:17 CI container). Environment-provided, not project-approved —
 *  anything outside this union fails the register's "no unregistered
 *  extension" rule. */
const ENVIRONMENT_EXTENSIONS = new Set([
  'plpgsql',
  'pg_net',
  'pg_stat_statements',
  'supabase_vault',
  'uuid-ossp',
  'pg_graphql',
  'pgjwt',
  'pgsodium',
]);

/** The complete allow-list of routines permitted in module schemas. */
const ALLOWED_ROUTINES = new Set([
  'iam.allowed_branch_ids',
  'iam.allowed_company_ids',
  'iam.current_tenant_id',
  'iam.current_user_id',
  'shared.guard_number_sequence_regression',
  'shared.next_display_number',
  'shared.touch_row_metadata',
  // Phase 1-3 (P1-03-DB-013): validates shared.timezones.zone_name against the
  // IANA database PostgreSQL already ships, keeping that the single source of truth.
  'shared.validate_timezone_name',
  // Phase 1-3 (P1-03-DB-001/002): reusable immutable-column guard and the
  // atomic tenant lifecycle transition (status UPDATE + history INSERT, one tx).
  'org.guard_immutable_columns',
  'org.change_tenant_status',
  // Phase 1-3 (P1-03-DB-003/004): plan-document validation against the feature
  // register, and deterministic point-in-time subscription resolution.
  'org.validate_plan_documents',
  'org.current_subscription_plan_id',
  // Phase 1-3 (P1-03-DB-005..007): live-parent guard for new branches and the
  // atomic branch lifecycle transition (runtime-executable, RLS-scoped).
  'org.guard_parent_company_live',
  'org.change_branch_status',
  // Phase 1-3 (P1-03-DB-008..010): dead parents reject new children.
  'org.guard_parent_branch_live',
  'org.guard_parent_warehouse_live',
  // Phase 1-3 (P1-03-DB-012/015): typed settings validation and the
  // override > plan > default feature-resolution precedence.
  'org.validate_setting_value',
  'org.resolve_feature_enabled',
]);

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
  await admin.query('SELECT 1'); // connectivity gate with a clear failure point
});

afterAll(async () => {
  await admin.end();
});

describe('database foundation', () => {
  it('runs on PostgreSQL 17', async () => {
    const { rows } = await admin.query('SHOW server_version');
    expect(rows[0].server_version).toMatch(/^17\./);
  });

  it('has the five module schemas', async () => {
    const { rows } = await admin.query(
      `SELECT nspname FROM pg_namespace
       WHERE nspname IN ('org','iam','shared','crm','veh') ORDER BY nspname`
    );
    expect(rows.map((r) => r.nspname)).toEqual(['crm', 'iam', 'org', 'shared', 'veh']);
  });

  it('has the four approved extensions, in the extensions schema', async () => {
    const { rows } = await admin.query(
      `SELECT extname, n.nspname AS schema
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE extname IN ('pgcrypto','btree_gist','citext','pg_trgm')
       ORDER BY extname`
    );
    expect(rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext', 'pg_trgm', 'pgcrypto']);
    for (const row of rows) expect(row.schema).toBe('extensions');
  });

  it('defines app_runtime and app_readonly as constrained archetypes', async () => {
    const { rows } = await admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb
       FROM pg_roles WHERE rolname IN ('app_runtime','app_readonly') ORDER BY rolname`
    );
    expect(rows).toHaveLength(2);
    for (const role of rows) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      expect(role.rolcanlogin).toBe(false);
      expect(role.rolcreaterole).toBe(false);
      expect(role.rolcreatedb).toBe(false);
    }
  });

  it('runtime roles own no schema and no table', async () => {
    const schemas = await admin.query(
      `SELECT nspname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
       WHERE r.rolname IN ('app_runtime','app_readonly')`
    );
    expect(schemas.rows).toHaveLength(0);
    const tables = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE r.rolname IN ('app_runtime','app_readonly') AND c.relkind = 'r'`
    );
    expect(tables.rows).toHaveLength(0);
  });

  it('contains NO business-domain tables (Phase 1-2 scope guard)', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq
       FROM information_schema.tables
       WHERE table_schema IN ('org','iam','shared','crm','veh')
         AND table_type = 'BASE TABLE'
       ORDER BY 1`
    );
    const found = rows.map((r) => r.fq);
    const violations = found.filter((t) => !ALLOWED_TABLES.has(t));
    expect(violations, `Tables outside the Phase 1-2 allow-list: ${violations.join(', ')}`).toEqual(
      []
    );
  });

  it('every table in a module schema has RLS enabled AND forced', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || c.relname AS fq, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('org','iam','shared','crm','veh') AND c.relkind = 'r'`
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.fq} must have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.fq} must have RLS forced`).toBe(true);
    }
  });

  it('no extension exists outside the approved + environment allow-lists', async () => {
    const { rows } = await admin.query('SELECT extname FROM pg_extension');
    const unexpected = rows
      .map((r) => r.extname as string)
      .filter((e) => !APPROVED_EXTENSIONS.has(e) && !ENVIRONMENT_EXTENSIONS.has(e));
    expect(
      unexpected,
      `Unregistered extensions (register them in docs/database/postgresql-extension-register.md first): ${unexpected.join(', ')}`
    ).toEqual([]);
  });

  it('module schemas contain EXACTLY the approved routines — nothing more', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || p.proname AS fq
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('org','iam','shared','crm','veh')
       ORDER BY 1`
    );
    expect(rows.map((r) => r.fq).sort()).toEqual([...ALLOWED_ROUTINES].sort());
  });

  it('module-schema tables carry EXACTLY the approved triggers and policies', async () => {
    const triggers = await admin.query(
      `SELECT t.tgname FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('org','iam','shared','crm','veh') AND NOT t.tgisinternal
       ORDER BY 1`
    );
    expect(triggers.rows.map((r) => r.tgname)).toEqual([
      'tg_branch_settings_immutable',
      'tg_branch_settings_validate_value',
      'tg_branches_immutable',
      'tg_branches_parent_company_live',
      'tg_branches_touch_metadata',
      'tg_company_settings_immutable',
      'tg_company_settings_validate_value',
      'tg_cost_centers_immutable',
      'tg_cost_centers_touch_metadata',
      'tg_currencies_touch_metadata',
      'tg_departments_immutable',
      'tg_departments_parent_branch_live',
      'tg_departments_touch_metadata',
      'tg_feature_flags_immutable',
      'tg_feature_flags_touch_metadata',
      'tg_languages_touch_metadata',
      'tg_legal_companies_immutable',
      'tg_legal_companies_touch_metadata',
      'tg_number_sequences_guard_regression',
      'tg_number_sequences_touch_metadata',
      'tg_storage_locations_immutable',
      'tg_storage_locations_parent_warehouse_live',
      'tg_storage_locations_touch_metadata',
      'tg_subscription_plans_immutable',
      'tg_subscription_plans_touch_metadata',
      'tg_subscription_plans_validate_documents',
      'tg_tax_classes_immutable',
      'tg_tax_classes_touch_metadata',
      'tg_tax_rates_immutable',
      'tg_tax_rates_touch_metadata',
      'tg_tenant_feature_overrides_immutable',
      'tg_tenant_subscriptions_immutable',
      'tg_tenant_subscriptions_touch_metadata',
      'tg_tenants_immutable_columns',
      'tg_tenants_touch_metadata',
      'tg_timezones_touch_metadata',
      'tg_timezones_validate_zone_name',
      'tg_warehouses_immutable',
      'tg_warehouses_parent_branch_live',
      'tg_warehouses_touch_metadata',
    ]);
    const policies = await admin.query(
      `SELECT polname FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('org','iam','shared','crm','veh')
       ORDER BY 1`
    );
    expect(policies.rows.map((r) => r.polname)).toEqual([
      'ins_branch_settings_scope',
      'ins_branch_status_history_tenant',
      'ins_branches_scope',
      'ins_company_settings_scope',
      'ins_cost_centers_scope',
      'ins_departments_scope',
      'ins_legal_companies_tenant',
      'ins_storage_locations_scope',
      'ins_tax_classes_scope',
      'ins_tax_rates_scope',
      'ins_warehouses_scope',
      'sel_branch_settings_scope',
      'sel_branch_status_history_tenant',
      'sel_branches_scope',
      'sel_company_settings_scope',
      'sel_cost_centers_scope',
      'sel_currencies_all',
      'sel_departments_scope',
      'sel_feature_flags_all',
      'sel_languages_all',
      'sel_legal_companies_tenant',
      'sel_number_sequences_tenant',
      'sel_storage_locations_scope',
      'sel_subscription_plans_published',
      'sel_tax_classes_scope',
      'sel_tax_rates_scope',
      'sel_tenant_feature_overrides_tenant',
      'sel_tenant_status_history_tenant',
      'sel_tenant_subscriptions_tenant',
      'sel_tenants_self',
      'sel_timezones_all',
      'sel_warehouses_scope',
      'upd_branches_scope',
      'upd_cost_centers_scope',
      'upd_departments_scope',
      'upd_legal_companies_tenant',
      'upd_number_sequences_tenant',
      'upd_storage_locations_scope',
      'upd_tax_classes_scope',
      'upd_tax_rates_scope',
      'upd_warehouses_scope',
    ]);
  });

  it('the iam context helpers exist and read transaction-local settings', async () => {
    const { rows } = await admin.query(`
      SELECT iam.current_tenant_id() AS tenant, iam.current_user_id() AS actor,
             iam.allowed_company_ids() AS companies, iam.allowed_branch_ids() AS branches
    `);
    // No context set on this connection: everything must be NULL (default deny).
    expect(rows[0]).toEqual({ tenant: null, actor: null, companies: null, branches: null });
  });
});

describe('migration files (migration standard)', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  it('exist and follow the deterministic naming rule', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      // 0001_-style foundation versions or 14-digit `supabase migration new`
      // timestamps; snake_case description; .sql.
      expect(file).toMatch(/^(\d{4}|\d{14})_[a-z0-9_]+\.sql$/);
    }
  });

  it('are ordered and unique by version prefix', () => {
    const versions = files.map((f) => f.split('_')[0] ?? '');
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a.localeCompare(b))).toEqual(versions);
  });

  it('each declares a rollback classification in its header', () => {
    for (const file of files) {
      const head = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').slice(0, 2000);
      expect(head, `${file} must declare its rollback classification`).toMatch(
        /Rollback classification/i
      );
    }
  });
});
