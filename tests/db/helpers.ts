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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const ROLE_FIXTURE_EMPLOYEE_A = 'a0000000-0000-4000-8000-0000000000e1';
const ROLE_FIXTURE_EMPLOYEE_B = 'b0000000-0000-4000-8000-0000000000e1';
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
  // Real active IAM identities with live tenant-wide grants. Reception database
  // suites use USER_A as their deterministic receiving employee; FE-007 no
  // longer permits an arbitrary uuid to stand in for one.
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES
       ($1,$3,'test_harness','fx_db_user_a','db-user-a@example.test','Fixture User A','active',$5),
       ($2,$4,'test_harness','fx_db_user_b','db-user-b@example.test','Fixture User B','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [USER_A, USER_B, TENANT_A, TENANT_B, SYS]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$3,'fx_db_employee','DB fixture employee',$5),
            ($2,$4,'fx_db_employee','DB fixture employee',$5)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_FIXTURE_EMPLOYEE_A, ROLE_FIXTURE_EMPLOYEE_B, TENANT_A, TENANT_B, SYS]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     SELECT $1,$2,$3,'unrestricted',$4,$4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.role_grants
         WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3 AND status = 'active'
      )
     UNION ALL
     SELECT $5,$6,$7,'unrestricted',$4,$4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.role_grants
         WHERE tenant_id = $5 AND user_id = $6 AND role_id = $7 AND status = 'active'
      )`,
    [TENANT_A, USER_A, ROLE_FIXTURE_EMPLOYEE_A, SYS, TENANT_B, USER_B, ROLE_FIXTURE_EMPLOYEE_B]
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

  // Phase 1-11 billing / payment / delivery / warranty / reporting — deleted FIRST:
  // every sal/wty/rpt row references a Phase 1-7..1-10 parent (wo work orders, quo
  // revisions, rec visits, veh vehicles/odometer) deleted below, so P1-11 unwinds
  // first. Children before parents. sal.financial_events has no FK into sal (its
  // source_id is a plain uuid), so it can go anywhere in this block.
  await deleteFrom('rpt.saved_filters');
  await deleteFrom('rpt.report_configuration_versions');
  await deleteFrom('rpt.report_configurations');
  await deleteFrom('wty.warranty_status_history');
  await deleteFrom('wty.warranty_record_items');
  await deleteFrom('wty.warranty_records');
  await deleteFrom('wty.warranty_coverage');
  await deleteFrom('wty.warranty_policies');
  await deleteFrom('sal.financial_events');
  await deleteFrom('sal.authorized_receivers');
  await deleteFrom('sal.delivery_signatures');
  await deleteFrom('sal.delivery_checklist_results');
  await deleteFrom('sal.delivery_status_history');
  await deleteFrom('sal.delivery_records');
  await deleteFrom('sal.delivery_checklist_template_items');
  await deleteFrom('sal.delivery_checklist_templates');
  await deleteFrom('sal.payment_allocations');
  await deleteFrom('sal.receipt_reversals');
  await deleteFrom('sal.credit_notes');
  await deleteFrom('sal.receipts');
  await deleteFrom('sal.invoice_status_history');
  await deleteFrom('sal.invoice_line_amounts');
  await deleteFrom('sal.invoice_lines');
  await deleteFrom('sal.invoice_amounts');
  await deleteFrom('sal.invoice_numbering_configs');
  await deleteFrom('sal.invoices');
  await deleteFrom('sal.payment_methods');

  // Phase 1-10 service/quotation/inventory — deleted FIRST for the parts that
  // reference the Phase 1-9 work order. The wo<->quo forward FK makes the two
  // mutually referencing, so this straddles the wo block: quo items +
  // wo.customer_approvals are removed before quo.quotation_revisions, and
  // quo.quotations + every wo-referencing inv row are removed before
  // wo.work_orders (below). The forward-FK TARGET catalogs (svc.services,
  // inv.item_master) are removed AFTER the wo block — see the second P1-10 block.
  await deleteFrom('quo.approval_evidence');
  await deleteFrom('quo.approval_decisions');
  await deleteFrom('quo.quotation_status_history');
  await deleteFrom('quo.quotation_items');
  await deleteFrom('wo.customer_approval_evidence');
  await deleteFrom('wo.customer_approvals');
  await deleteFrom('quo.quotation_revisions');
  await deleteFrom('quo.quotations');
  await deleteFrom('inv.part_returns');
  await deleteFrom('inv.part_issues');
  await deleteFrom('inv.damaged_stock');
  await deleteFrom('inv.customer_supplied_parts');
  await deleteFrom('inv.external_purchase_part_details');
  await deleteFrom('inv.external_purchase_parts');
  await deleteFrom('inv.stock_adjustment_details');
  await deleteFrom('inv.stock_adjustments');
  await deleteFrom('inv.opening_inventory_lines');
  await deleteFrom('inv.opening_inventory_batches');
  await deleteFrom('inv.stock_reservations');
  await deleteFrom('inv.stock_movements');
  await deleteFrom('inv.stock_balances');

  // Phase 1-9 work-order / diagnostics / technician / quality — deleted FIRST
  // (they reference rec/veh/wo/tech). Children before parents; qms + dia before
  // wo; tech.labor_sessions before wo.jobs and tech.technician_profiles; wo
  // children before masters; tech profiles before their catalogs. Dual-scope
  // catalog tenant rows are removed here; platform rows in cleanFixtures.
  await deleteFrom('qms.rework_link_details');
  await deleteFrom('qms.rework_links');
  await deleteFrom('qms.reopen_attempts');
  await deleteFrom('qms.qc_status_history');
  await deleteFrom('qms.qc_check_results');
  await deleteFrom('qms.quality_control_records');
  await deleteFrom('dia.diagnostic_reviews');
  await deleteFrom('dia.diagnostic_evidence');
  await deleteFrom('dia.recommendations');
  await deleteFrom('dia.dtc_records');
  await deleteFrom('dia.measurements');
  await deleteFrom('dia.findings');
  await deleteFrom('dia.report_item_results');
  await deleteFrom('dia.diagnostic_report_status_history');
  await deleteFrom('dia.diagnostic_reports');
  await deleteFrom('dia.template_items');
  await deleteFrom('dia.template_versions');
  await deleteFrom('dia.inspection_templates');
  await deleteFrom('tech.labor_sessions');
  await deleteFrom('wo.customer_approval_evidence');
  await deleteFrom('wo.customer_approvals');
  await deleteFrom('wo.additional_work_request_details');
  await deleteFrom('wo.additional_work_requests');
  await deleteFrom('wo.required_parts');
  await deleteFrom('wo.work_order_service_lines');
  await deleteFrom('wo.job_assignments');
  await deleteFrom('wo.job_status_history');
  await deleteFrom('wo.jobs');
  await deleteFrom('wo.work_order_status_history');
  await deleteFrom('wo.work_orders');
  await deleteFrom('tech.technician_certification_details');
  await deleteFrom('tech.technician_certifications');
  await deleteFrom('tech.technician_skills');
  await deleteFrom('tech.technician_availability');
  await deleteFrom('tech.technician_profiles');
  await deleteFrom('tech.certifications');
  await deleteFrom('tech.skills');
  await deleteFrom('tech.skill_levels');
  await deleteFrom('dia.diagnostic_types');
  await deleteFrom('qms.qc_checks');
  await deleteFrom('wo.work_order_transitions');
  await deleteFrom('wo.work_order_states');
  await deleteFrom('wo.job_transitions');
  await deleteFrom('wo.job_states');

  // Phase 1-10 catalogs that are TARGETS of the wo forward FKs (svc.services,
  // inv.item_master) — removed AFTER the wo block above deleted the referencing
  // service lines and required parts. Children before parents.
  await deleteFrom('svc.price_rules');
  await deleteFrom('svc.price_list_assignments');
  await deleteFrom('svc.price_list_versions');
  await deleteFrom('svc.price_lists');
  await deleteFrom('svc.discount_rules');
  await deleteFrom('svc.pricing_approval_policies');
  await deleteFrom('svc.standard_labor_times');
  await deleteFrom('svc.service_versions');
  await deleteFrom('svc.branch_service_availability');
  await deleteFrom('svc.services');
  await deleteFrom('svc.service_categories');
  await deleteFrom('inv.item_cost_details');
  await deleteFrom('inv.item_master');
  await deleteFrom('inv.stock_locations');
  await deleteFrom('inv.item_categories');
  await deleteFrom('inv.units_of_measure');

  // Phase 1-8 appointment/reception — tenant-scoped rows before org.tenants, and
  // before the apt/veh/crm parents they reference. Reception children before the
  // visit master before walk-ins and the reception catalogs; then the appointment
  // children before the master before the appointment catalogs. Config catalogs'
  // tenant rows are removed here; their platform rows (tenant_id NULL, fx_ codes)
  // are removed in cleanFixtures.
  await deleteFrom('rec.reception_status_history');
  await deleteFrom('rec.custody_history');
  await deleteFrom('rec.authorizations');
  await deleteFrom('rec.refusals');
  await deleteFrom('rec.signatures');
  await deleteFrom('rec.vehicle_content_details');
  await deleteFrom('rec.vehicle_contents');
  await deleteFrom('rec.complaint_details');
  await deleteFrom('rec.complaints');
  await deleteFrom('rec.condition_items');
  await deleteFrom('rec.visual_inspections');
  await deleteFrom('rec.damage_marks');
  await deleteFrom('rec.damage_maps');
  await deleteFrom('rec.warning_light_observations');
  await deleteFrom('rec.leak_observations');
  await deleteFrom('rec.reception_party_roles');
  await deleteFrom('rec.visit_reason_links');
  await deleteFrom('rec.reception_visits');
  await deleteFrom('rec.walk_in_references');
  await deleteFrom('rec.visit_reasons');
  await deleteFrom('rec.fuel_levels');
  await deleteFrom('rec.warning_light_codes');
  await deleteFrom('rec.refusal_reasons');
  await deleteFrom('apt.appointment_status_history');
  await deleteFrom('apt.appointment_services');
  await deleteFrom('apt.appointments');
  await deleteFrom('apt.appointment_types');
  await deleteFrom('apt.source_channels');
  await deleteFrom('apt.cancellation_reasons');

  // Phase 1-7 vehicle — delete veh children before their parents, and all veh
  // rows before crm/org (later veh tables reference crm.business_partners and
  // org.tenants). Vehicles reference the catalogs, so delete them first; the
  // self-referential merged_into_id (ON DELETE RESTRICT) is removed together in
  // a single statement. Catalog hierarchy: trims -> models -> makes.
  await deleteFrom('veh.vehicle_merges');
  await deleteFrom('veh.duplicate_candidates');
  await deleteFrom('veh.vehicle_alerts');
  await deleteFrom('veh.vehicle_status_history');
  await deleteFrom('veh.odometer_readings');
  await deleteFrom('veh.relationship_evidence');
  await deleteFrom('veh.vehicle_relationships');
  await deleteFrom('veh.ownership_history');
  await deleteFrom('veh.plate_history');
  await deleteFrom('veh.vin_verifications');
  await deleteFrom('veh.vehicle_attribute_history');
  await deleteFrom('veh.battery_readings');
  await deleteFrom('veh.battery_masters');
  await deleteFrom('veh.engine_history');
  await deleteFrom('veh.transmission_history');
  await deleteFrom('veh.vehicle_ev_profiles');
  await deleteFrom('veh.vehicle_identifiers');
  await deleteFrom('veh.vehicles');
  await deleteFrom('veh.trims');
  await deleteFrom('veh.models');
  await deleteFrom('veh.makes');
  await deleteFrom('veh.body_types');
  await deleteFrom('veh.powertrain_types');

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
  // Phase 1-7 vehicle platform catalog fixtures (scope='platform', tenant NULL)
  // carry the fx_ code prefix; delete children before parents.
  await admin.query(`DELETE FROM veh.trims WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  await admin.query(`DELETE FROM veh.models WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  await admin.query(`DELETE FROM veh.makes WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  await admin.query(`DELETE FROM veh.body_types WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  await admin.query(
    `DELETE FROM veh.powertrain_types WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  // Phase 1-8 appointment platform catalog fixtures (scope='platform', fx_ codes).
  await admin.query(
    `DELETE FROM apt.appointment_types WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM apt.source_channels WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM apt.cancellation_reasons WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  // Phase 1-8 reception platform catalog fixtures (scope='platform', fx_ codes).
  await admin.query(
    `DELETE FROM rec.visit_reasons WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(`DELETE FROM rec.fuel_levels WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  await admin.query(
    `DELETE FROM rec.warning_light_codes WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM rec.refusal_reasons WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  // Phase 1-9 platform catalog fixtures (scope='platform', fx_ codes). Seeded
  // platform state-graph rows (real codes) are structural reference, not fx_, and
  // are left intact.
  await admin.query(
    `DELETE FROM wo.work_order_transitions WHERE scope = 'platform' AND from_state LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM wo.work_order_states WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM wo.job_transitions WHERE scope = 'platform' AND from_state LIKE 'fx\\_%'`
  );
  await admin.query(`DELETE FROM wo.job_states WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  await admin.query(`DELETE FROM tech.skills WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  await admin.query(
    `DELETE FROM tech.skill_levels WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM tech.certifications WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(
    `DELETE FROM dia.diagnostic_types WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  await admin.query(`DELETE FROM qms.qc_checks WHERE scope = 'platform' AND code LIKE 'fx\\_%'`);
  // Phase 1-10 platform unit-of-measure fixtures (scope='platform', fx_ codes).
  // Seeded platform units (real codes: each/hour/...) are structural reference and
  // are left intact.
  await admin.query(
    `DELETE FROM inv.units_of_measure WHERE scope = 'platform' AND code LIKE 'fx\\_%'`
  );
  // Phase 1-11 platform payment-method fixtures (scope='platform', fx_ codes). Seeded
  // platform methods (cash/card_terminal/bank_transfer) are structural reference, kept.
  await admin.query(
    `DELETE FROM sal.payment_methods WHERE scope = 'platform' AND method_code LIKE 'fx\\_%'`
  );
  // Global (non-tenant) test permission fixtures use the test. code prefix.
  await admin.query(`DELETE FROM iam.permissions WHERE permission_code LIKE 'test.%'`);
  // Test-created platform fixtures use the fx_ prefix by convention.
  await admin.query(`DELETE FROM org.subscription_plans WHERE plan_code LIKE 'fx\\_%'`);
  await admin.query(`DELETE FROM org.feature_flags WHERE flag_code LIKE 'fx\\_%'`);
}

const PERMISSION_CATALOG_SEED = join(
  __dirname,
  '..',
  '..',
  'supabase',
  'seeds',
  '04_iam_permission_catalog.sql'
);
const PERMISSION_SEED_CONFLICT_ARM = /ON\s+CONFLICT\s*\(\s*permission_code\s*\)\s*DO\s+NOTHING/gi;

/**
 * Puts the governed platform permission catalog back exactly as seed 04 defines
 * it. For suites that must remove a SEEDED permission code to exercise a gate.
 *
 * iam.permissions is PLATFORM reference data, not a fixture: cleanFixtures only
 * removes the `test.` prefix codes suites mint for themselves, so a suite that
 * deletes a governed code leaves the catalog one row short for every suite and
 * tool that runs afterwards on the same database. CI hides this because the db
 * and backend tiers use separate containers; a long-lived local database does
 * not, and the row does not come back on its own.
 *
 * The seed's own INSERT is reused verbatim and only its conflict arm is rewritten
 * from DO NOTHING to DO UPDATE, so no code, domain, description or risk level is
 * ever restated here and the restore cannot drift from
 * 04_iam_permission_catalog.sql. DO UPDATE rather than the seed's own DO NOTHING
 * because a deleted code gets re-created by whichever OTHER suite next inserts it
 * as a fixture, with that suite's own wording — so the row can be present and
 * still be wrong, and only an update puts the seeded text back.
 *
 * The WHERE clause keeps that update to rows that actually differ:
 * tg_permissions_touch_metadata advances record_version on EVERY update, so an
 * unguarded replay would bump all hundred rows on each suite that calls this —
 * the same leak class in a quieter column. permission_code/created_at/created_by
 * are never in the SET list: tg_permissions_immutable guards them.
 */
export async function restoreSeededPermissionCatalog(admin: Pool): Promise<void> {
  const seed = readFileSync(PERMISSION_CATALOG_SEED, 'utf8');
  const arms = seed.match(PERMISSION_SEED_CONFLICT_ARM) ?? [];
  if (arms.length !== 1) {
    throw new Error(
      `Expected exactly one "ON CONFLICT (permission_code) DO NOTHING" in ` +
        `${PERMISSION_CATALOG_SEED}, found ${arms.length}. restoreSeededPermissionCatalog must ` +
        `be updated before any suite may delete a seeded permission code again.`
    );
  }
  await admin.query(
    seed.replace(
      PERMISSION_SEED_CONFLICT_ARM,
      `ON CONFLICT (permission_code) DO UPDATE
         SET domain      = EXCLUDED.domain,
             description = EXCLUDED.description,
             risk_level  = EXCLUDED.risk_level
       WHERE permissions.domain      IS DISTINCT FROM EXCLUDED.domain
          OR permissions.description IS DISTINCT FROM EXCLUDED.description
          OR permissions.risk_level  IS DISTINCT FROM EXCLUDED.risk_level`
    )
  );
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
