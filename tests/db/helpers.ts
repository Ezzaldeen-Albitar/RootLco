/**
 * Database test-harness helpers (P1-02-QA-001..005).
 *
 * Connects to the local Supabase PostgreSQL (or the CI service container).
 * Two kinds of connections are used, and the distinction is the whole point:
 *
 *  - ADMIN connection (`postgres`): provisioning fixtures and cleanup ONLY.
 *    In the Supabase local stack `postgres` carries BYPASSRLS (inspected and
 *    recorded in docs/database/role-and-grant-standard.md), and in CI it is a
 *    superuser — so NOTHING executed on this connection is ever evidence that
 *    RLS works. Owner/admin behaviour must not invalidate tests.
 *
 *  - RUNTIME connection (`rootlco_test_runtime`, member of `app_runtime`):
 *    every isolation assertion runs here. The login role is created by the
 *    harness (never by a migration) and holds no attribute beyond LOGIN.
 *
 *  - WORKER connection (`rootlco_test_worker`, member of `app_worker`):
 *    worker-boundary and all-tenant infrastructure assertions run here, never
 *    on the admin connection.
 *
 * Credentials are the public Supabase local-dev defaults, overridable via
 * DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD. They are not secrets;
 * no production credential is ever read here.
 */
import { Client, Pool } from 'pg';
import type { ClientConfig } from 'pg';

const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DB_PORT ?? 54322);
const DATABASE = process.env.DB_NAME ?? 'postgres';
const ADMIN_USER = process.env.DB_USER ?? 'postgres';
const ADMIN_PASSWORD = process.env.DB_PASSWORD ?? 'postgres';

/** Login role assumed by all runtime-isolation tests. Test-only, local-only. */
export const RUNTIME_LOGIN = 'rootlco_test_runtime';
/** Login role for the read-only archetype. */
export const READONLY_LOGIN = 'rootlco_test_readonly';
/** Login role for the asynchronous worker archetype. */
export const WORKER_LOGIN = 'rootlco_test_worker';
/** Login role used to demonstrate FORCE RLS against a non-BYPASSRLS owner. */
export const OWNER_LOGIN = 'rootlco_test_owner';
/** Deliberately weak, deliberately fake, local test databases only. */
const TEST_LOGIN_PASSWORD = 'rootlco-local-test-only';

/** Deterministic fixture UUIDs (database-test-fixtures standard). */
export const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const USER_A = 'a0000000-0000-4000-8000-000000000001';
export const USER_B = 'b0000000-0000-4000-8000-000000000001';
export const COMPANY_A1 = 'a1000000-0000-4000-8000-000000000001';
export const BRANCH_A1 = 'a1100000-0000-4000-8000-000000000001';

/** Throwaway schema for disposable constraint/pattern fixtures. */
export const FIXTURE_SCHEMA = 'p1_02_test';

function config(user: string, password: string, max = 5): ClientConfig & { max: number } {
  return { host: HOST, port: PORT, database: DATABASE, user, password, max };
}

export function adminPool(): Pool {
  return new Pool(config(ADMIN_USER, ADMIN_PASSWORD));
}

export function runtimePool(max = 5): Pool {
  return new Pool(config(RUNTIME_LOGIN, TEST_LOGIN_PASSWORD, max));
}

export function readonlyPool(): Pool {
  return new Pool(config(READONLY_LOGIN, TEST_LOGIN_PASSWORD));
}

export function workerPool(max = 5): Pool {
  return new Pool(config(WORKER_LOGIN, TEST_LOGIN_PASSWORD, max));
}

export function ownerClient(): Client {
  return new Client(config(OWNER_LOGIN, TEST_LOGIN_PASSWORD));
}

export function runtimeClient(): Client {
  return new Client(config(RUNTIME_LOGIN, TEST_LOGIN_PASSWORD));
}

/**
 * Creates the test login roles (idempotently) and grants them the archetype
 * memberships. Runs as admin. Membership inherits, so grants and RLS policies
 * addressed TO app_runtime / app_readonly apply to the logins.
 */
export async function ensureTestLogins(admin: Pool): Promise<void> {
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_LOGIN}') THEN
        CREATE ROLE ${RUNTIME_LOGIN} LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${READONLY_LOGIN}') THEN
        CREATE ROLE ${READONLY_LOGIN} LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_LOGIN}') THEN
        CREATE ROLE ${OWNER_LOGIN} LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${WORKER_LOGIN}') THEN
        CREATE ROLE ${WORKER_LOGIN} LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END;
    $$;
  `);
  await admin.query(`GRANT app_runtime TO ${RUNTIME_LOGIN}`);
  await admin.query(`GRANT app_readonly TO ${READONLY_LOGIN}`);
  await admin.query(`GRANT app_worker TO ${WORKER_LOGIN}`);
}

export interface SessionContext {
  tenantId?: string;
  userId?: string;
  companyIds?: string[];
  branchIds?: string[];
}

/**
 * Applies the transaction-scoped context contract (set_config(..., true)).
 * MUST be called inside an open transaction — the values evaporate at
 * COMMIT/ROLLBACK, which is exactly the contract the platform relies on.
 */
export async function setContext(
  client: { query: Client['query'] },
  ctx: SessionContext
): Promise<void> {
  const pairs: Array<[string, string]> = [];
  if (ctx.tenantId) pairs.push(['app.tenant_id', ctx.tenantId]);
  if (ctx.userId) pairs.push(['app.user_id', ctx.userId]);
  if (ctx.companyIds) pairs.push(['app.company_ids', ctx.companyIds.join(',')]);
  if (ctx.branchIds) pairs.push(['app.branch_ids', ctx.branchIds.join(',')]);
  for (const [key, value] of pairs) {
    await client.query('SELECT set_config($1, $2, true)', [key, value]);
  }
}

/**
 * Runs `fn` inside a transaction with the given context and ALWAYS rolls back.
 * Rollback keeps fixtures pristine and simultaneously proves the context is
 * transaction-local.
 */
export async function withRolledBackTx<T>(
  pool: Pool,
  ctx: SessionContext,
  fn: (client: { query: Client['query'] }) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Like withRolledBackTx but commits, for tests that need durable effects. */
export async function withCommittedTx<T>(
  pool: Pool,
  ctx: SessionContext,
  fn: (client: { query: Client['query'] }) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Provisions the deterministic org fixtures (Phase 1-3) as admin:
 * reference rows the fixtures depend on, plus tenants A and B. Idempotent
 * (natural-key/id conflict targets), so every suite may call it in beforeAll.
 * Admin-provisioned — never RLS evidence.
 */
export async function ensureOrgFixtures(admin: Pool): Promise<void> {
  const SYS = '00000000-0000-4000-8000-000000000001';
  await admin.query(
    `INSERT INTO shared.languages (locale_code, name, direction, created_by)
     VALUES ('en', 'English', 'ltr', $1), ('ar', 'Arabic', 'rtl', $1)
     ON CONFLICT (locale_code) DO NOTHING`,
    [SYS]
  );
  await admin.query(
    `INSERT INTO shared.timezones (zone_name, created_by)
     VALUES ('UTC', $1), ('Asia/Amman', $1)
     ON CONFLICT (zone_name) DO NOTHING`,
    [SYS]
  );
  await admin.query(
    `INSERT INTO shared.currencies (code, name, minor_unit, created_by)
     VALUES ('USD', 'United States Dollar', 2, $1), ('JOD', 'Jordanian Dinar', 3, $1)
     ON CONFLICT (code) DO NOTHING`,
    [SYS]
  );
  await admin.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
     VALUES
       ($1, 'tenant_a', 'Fixture Tenant A', 'active', 'en', 'UTC', $3),
       ($2, 'tenant_b', 'Fixture Tenant B', 'active', 'ar', 'UTC', $3)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, 'company_a1', 'Fixture Company A1', 'USD', $3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A1, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, 'branch_a1', 'Fixture Branch A1', 'UTC', $4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A1, TENANT_A, COMPANY_A1, USER_A]
  );
}

/**
 * Deletes tenant-owned rows in foreign-key dependency order, then the tenants.
 * Callers remain responsible for platform-scope fixtures and idempotency rows
 * whose tenant_id is NULL.
 */
export async function deleteTenantCascade(admin: Pool, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;

  const deleteFrom = async (table: string) => {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  };

  // Phase 1-6 CRM — delete crm children before crm.business_partners, and all
  // crm rows before org.tenants (business_partners.tenant_id -> org.tenants).
  // business_partners self-references via merged_into_id (ON DELETE RESTRICT);
  // a single-statement delete removes a merged source and its survivor together.
  await deleteFrom('crm.timeline_events');
  await deleteFrom('crm.communication_log');
  await deleteFrom('crm.partner_merges');
  await deleteFrom('crm.duplicate_candidates');
  await deleteFrom('crm.consent_history');
  await deleteFrom('crm.communication_preferences');
  await deleteFrom('crm.partner_segment_assignments');
  await deleteFrom('crm.customer_segments');
  await deleteFrom('crm.customer_block_history');
  await deleteFrom('crm.customer_restrictions');
  await deleteFrom('crm.customer_alerts');
  await deleteFrom('crm.customer_credit_profiles');
  await deleteFrom('crm.contact_points');
  await deleteFrom('crm.addresses');
  await deleteFrom('crm.individual_profiles');
  await deleteFrom('crm.company_profiles');
  await deleteFrom('crm.partner_sensitive_attributes');
  await deleteFrom('crm.partner_identifiers');
  await deleteFrom('crm.partner_roles');
  await deleteFrom('crm.partner_status_history');
  await deleteFrom('crm.business_partners');

  await deleteFrom('shared.comments');
  await deleteFrom('shared.notes');
  await deleteFrom('shared.entity_tags');
  await deleteFrom('shared.tags');
  await deleteFrom('shared.search_metadata');
  await deleteFrom('shared.system_settings');

  await deleteFrom('shared.delivery_attempts');
  await deleteFrom('shared.outbound_messages');
  await admin.query(
    `UPDATE shared.message_templates
        SET active_version_id = NULL
      WHERE tenant_id = ANY($1::uuid[])`,
    [tenantIds]
  );
  await deleteFrom('shared.template_versions');
  await deleteFrom('shared.message_templates');

  await deleteFrom('shared.event_outbox');
  await deleteFrom('shared.processed_events');
  await deleteFrom('shared.error_records');

  await deleteFrom('shared.legal_holds');
  await deleteFrom('shared.document_links');
  await deleteFrom('shared.file_scan_results');
  await deleteFrom('shared.document_versions');
  await deleteFrom('shared.documents');
  await deleteFrom('shared.document_categories');

  await deleteFrom('shared.status_history');
  await deleteFrom('shared.idempotency_keys');

  await deleteFrom('iam.role_grants');
  await deleteFrom('iam.approval_limits');
  await deleteFrom('iam.sensitive_data_permissions');
  await deleteFrom('iam.user_sessions');
  await deleteFrom('iam.login_audit');
  await deleteFrom('iam.audit_records');
  await deleteFrom('iam.security_events');
  await deleteFrom('iam.user_status_history');
  await deleteFrom('iam.user_employee_links');
  await deleteFrom('iam.user_profiles');
  await deleteFrom('iam.user_accounts');
  await deleteFrom('iam.role_permissions');
  await deleteFrom('iam.roles');

  await deleteFrom('shared.number_sequences');
  await deleteFrom('org.branch_settings');
  await deleteFrom('org.company_settings');
  await deleteFrom('org.tax_rates');
  await deleteFrom('org.tax_classes');
  await deleteFrom('org.tenant_feature_overrides');
  await deleteFrom('org.storage_locations');
  await deleteFrom('org.warehouses');
  await deleteFrom('org.departments');
  await deleteFrom('org.cost_centers');
  await deleteFrom('org.branch_status_history');
  await deleteFrom('org.branches');
  await deleteFrom('org.legal_companies');
  await deleteFrom('org.tenant_subscriptions');
  await deleteFrom('org.tenant_status_history');
  await admin.query('DELETE FROM org.tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
}

/** Removes every fixture row/object the harness may have created. */
export async function cleanFixtures(admin: Pool): Promise<void> {
  await admin.query(`DROP SCHEMA IF EXISTS ${FIXTURE_SCHEMA} CASCADE`);
  await deleteTenantCascade(admin, [TENANT_A, TENANT_B]);
  // Consumer claims use a fixture consumer prefix, including platform claims.
  // Error cleanup covers fixture tenants and pre-tenant platform fixture rows.
  await admin.query(
    `DELETE FROM shared.processed_events
      WHERE tenant_id IS NULL AND consumer_code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM shared.error_records
      WHERE tenant_id IS NULL AND error_code LIKE 'fx\\_%'`
  );
  // Settings are append-only. Remove tenant fixtures and only fx_-prefixed
  // platform rows; localization content must be removed before its key catalogue.
  await admin.query(
    `DELETE FROM shared.system_settings
      WHERE scope = 'platform' AND setting_key LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM shared.localized_texts
      WHERE key_id IN (
        SELECT id FROM shared.localization_keys WHERE key_code LIKE 'fx\\_%'
      )`
  );
  await admin.query(`DELETE FROM shared.localization_keys WHERE key_code LIKE 'fx\\_%'`);
  // Platform-scope test categories (tenant_id NULL) carry the fx_ code prefix.
  await admin.query(
    `DELETE FROM shared.document_categories WHERE scope = 'platform' AND category_code LIKE 'fx\\_%'`
  );
  // Platform message-template fixtures use the fx_ prefix.
  await admin.query(
    `UPDATE shared.message_templates
        SET active_version_id = NULL
      WHERE scope = 'platform' AND template_code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM shared.template_versions
      WHERE template_id IN (
        SELECT id FROM shared.message_templates
        WHERE scope = 'platform' AND template_code LIKE 'fx\\_%'
      )`
  );
  await admin.query(
    `DELETE FROM shared.message_templates
      WHERE scope = 'platform' AND template_code LIKE 'fx\\_%'`
  );
  // Global (non-tenant) test permission fixtures use the test. code prefix.
  await admin.query(`DELETE FROM iam.permissions WHERE permission_code LIKE 'test.%'`);
  // Test-created platform fixtures use the fx_ prefix by convention.
  await admin.query(`DELETE FROM org.subscription_plans WHERE plan_code LIKE 'fx\\_%'`);
  await admin.query(`DELETE FROM org.feature_flags WHERE flag_code LIKE 'fx\\_%'`);
}

/** Error-code convenience: `42501` insufficient_privilege, etc. */
export async function expectSqlState(
  promise: Promise<unknown>,
  ...allowedCodes: string[]
): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const code = (err as { code?: string }).code ?? '(none)';
    if (allowedCodes.includes(code)) return code;
    throw new Error(
      `Expected SQLSTATE ${allowedCodes.join(' or ')} but got ${code}: ${(err as Error).message}`
    );
  }
  throw new Error(`Expected SQLSTATE ${allowedCodes.join(' or ')} but the statement succeeded`);
}
