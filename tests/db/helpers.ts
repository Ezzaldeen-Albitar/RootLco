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

/**
 * PRE-P1-29 Wave B — the control-plane identity.
 *
 * A member of `app_platform` and of NO other application archetype. That
 * exclusivity is the point rather than tidiness: PostgreSQL enforces membership
 * at the LOGIN role, so a login holding both `app_platform` and `app_runtime`
 * would carry both authorities by inheritance on one connection and make the
 * `SET ROLE` prohibition of §6.8.3 inert. A test identity that did that would
 * prove the control plane works while proving nothing about its containment.
 *
 * It receives NO product permission directly. Platform authority still comes
 * only from an `iam.platform_grants` row, so the harness reproduces the real
 * authority composition instead of bypassing it — which is what lets the same
 * login serve both the authorized and the unauthorized case.
 */
export const PLATFORM_LOGIN = 'rootlco_test_platform';
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
 * Connects as the control-plane identity (PRE-P1-29 Wave B).
 *
 * Deliberately NOT a generic "privileged client": it connects as
 * `rootlco_test_platform` and nothing else, never falls back to the runtime or
 * owner credentials, and adds no tenant authority of its own. Whether a call
 * through it is admitted depends entirely on whether an `iam.platform_grants`
 * row exists for the acting principal — which is what makes the same helper
 * serve the authorized case and the without-grant refusal.
 */
export function platformClient(): Client {
  return new Client(config(PLATFORM_LOGIN, TEST_LOGIN_PASSWORD));
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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PLATFORM_LOGIN}') THEN
        CREATE ROLE ${PLATFORM_LOGIN} LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END;
    $$;
  `);
  await admin.query(`GRANT app_runtime TO ${RUNTIME_LOGIN}`);
  await admin.query(`GRANT app_readonly TO ${READONLY_LOGIN}`);
  await admin.query(`GRANT app_worker TO ${WORKER_LOGIN}`);
  // Exactly one archetype, and no product permission: see PLATFORM_LOGIN above.
  await admin.query(`GRANT app_platform TO ${PLATFORM_LOGIN}`);
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
  // suites use USER_A (and tenant B's USER_B) as their deterministic receiving
  // employee; FE-007 no longer permits an arbitrary uuid to stand in for one,
  // because rec.reception_visits.receiving_employee_id is now a same-tenant
  // foreign key into iam.user_accounts guarded by an eligibility trigger.
  //
  // `ON CONFLICT (id)` is the NARROW target on purpose, although both tables
  // carry further unique indexes that it does not cover —
  // `uq_user_accounts_tenant_email_active` (tenant_id, email),
  // `uq_user_accounts_provider_identity_active` (identity_provider,
  // provider_subject — GLOBAL, not per tenant) and `uq_roles_tenant_code_active`
  // (tenant_id, role_code). Reaching one of those means some OTHER row already
  // holds a natural key that belongs to this fixture, and the four values below
  // appear nowhere else in the repository. A bare `ON CONFLICT DO NOTHING` would
  // swallow exactly that case and leave USER_A absent, which surfaces later as
  // "receiving employee is not an active IAM user" — a mystery instead of a
  // unique violation naming the index. Fail loudly there; be idempotent only on
  // the id, which is what re-running a suite actually repeats.
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
  // ONE grant per statement, and every parameter explicitly cast.
  //
  // These two grants were originally one statement joined by `UNION ALL`, and it
  // took the ENTIRE database tier down: 117 of 140 files failed in
  // `ensureOrgFixtures`, and because the throw happened in a hook the runner
  // SKIPPED 1420 tests rather than failing them, so the summary read
  // "237 passed" instead of red.
  //
  // The cause is a type-resolution ordering that only a UNION exposes. In a
  // plain `INSERT INTO t (cols) SELECT $1, …` PostgreSQL takes the parameter
  // types from the target columns. Under `UNION ALL` it must first resolve the
  // select-list types ACROSS the branches, which it does before consulting the
  // insert target — so `$1` in the select list settled as `text` while
  // `tenant_id = $1` in the WHERE NOT EXISTS forced `uuid`, and the parse failed
  // with `inconsistent types deduced for parameter $1 … uuid versus text`.
  //
  // Both properties of the fix were verified against PostgreSQL directly, with
  // `PREPARE` and no declared parameter list so the server infers exactly as the
  // `pg` driver makes it: the UNION form raises, the single-row form parses.
  // The casts are belt and braces — the split alone is sufficient — and they are
  // kept because they make the statement independent of where its types come
  // from, which is the property that was silently missing.
  for (const [tenantId, userId, roleId] of [
    [TENANT_A, USER_A, ROLE_FIXTURE_EMPLOYEE_A],
    [TENANT_B, USER_B, ROLE_FIXTURE_EMPLOYEE_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'unrestricted', $4::uuid, $4::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM iam.role_grants
           WHERE tenant_id = $1::uuid AND user_id = $2::uuid
             AND role_id = $3::uuid AND status = 'active'
        )`,
      [tenantId, userId, roleId, SYS]
    );
  }
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
  // BR-06. `fk_job_work_logs_job` is ON DELETE RESTRICT, like every other child
  // in this domain, so the log must go before the job it describes — otherwise
  // teardown fails with a foreign-key violation and takes EVERY suite that uses
  // these fixtures down with it, not just the one that wrote a log.
  await deleteFrom('wo.job_work_logs');
  // BR-07. Same RESTRICT rule as the work log: the evidence goes before the job.
  await deleteFrom('wo.job_evidence');
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
  // P1-18 signature events reference rec.signatures, so they unwind first.
  await deleteFrom('rec.signature_events');
  await deleteFrom('rec.signatures');
  await deleteFrom('rec.vehicle_content_details');
  await deleteFrom('rec.vehicle_contents');
  await deleteFrom('rec.complaint_details');
  await deleteFrom('rec.complaints');
  await deleteFrom('rec.condition_items');
  await deleteFrom('rec.visual_inspections');
  await deleteFrom('rec.damage_marks');
  await deleteFrom('rec.damage_maps');
  /*
   * P1-18 reception evidence contracts. Order is the FK graph, not the alphabet:
   *
   *  - damage_map_template_versions is referenced BY rec.damage_maps, so it goes
   *    after it and before its own parent, damage_map_templates;
   *  - reception_evidence_bindings and capture_requirement_overrides reference
   *    rec.reception_visits, deleted below;
   *  - capture_policy_rules is referenced by nothing and only needs to precede
   *    the tenant itself.
   *
   * All six were absent from this cascade when the contracts landed. A tenant-
   * scoped table missing here does not fail loudly: it survives cleanup, and the
   * next suite inherits its rows.
   */
  await deleteFrom('rec.damage_map_template_versions');
  await deleteFrom('rec.damage_map_templates');
  await deleteFrom('rec.reception_evidence_bindings');
  await deleteFrom('rec.capture_requirement_overrides');
  await deleteFrom('rec.capture_policy_rules');
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
  // Before the versions it witnesses: fk_template_version_approvals_version is
  // ON DELETE RESTRICT, so unwinding in the other order strands the version.
  await deleteFrom('shared.template_version_approvals');
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
  // iam.platform_grants carries NO tenant_id — platform authority is not a
  // tenant's to hold — so deleteFrom(), which filters on tenant_id, cannot
  // reach it. Its foreign key to user_accounts is ON DELETE RESTRICT, so the
  // account delete below fails with fk_platform_grants_account without this.
  await admin.query(
    `DELETE FROM iam.platform_grants
      WHERE account_id IN (SELECT id FROM iam.user_accounts WHERE tenant_id = ANY($1::uuid[]))`,
    [tenantIds]
  );
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
  // BEFORE org.legal_companies, not after: fk_company_status_history_company is
  // ON DELETE RESTRICT, so a surviving history row blocks the parent delete —
  // the same shape as branch_status_history one line above.
  await deleteFrom('org.company_status_history');
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
/** One row of the platform permission catalog, exactly as seed 04 declares it. */
export interface SeededPermission {
  readonly permissionCode: string;
  readonly domain: string;
  readonly description: string;
  readonly riskLevel: string;
}

function seedFail(message: string): never {
  throw new Error(`${PERMISSION_CATALOG_SEED}: ${message}`);
}

function seedLineOf(sql: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < sql.length; i += 1) if (sql.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Blanks `--` and block comments, preserving every offset and newline so a parse
 * error can still name the line it happened on.
 *
 * A scanner with modes rather than a regular expression, for the reason
 * `scripts/ci/check-p1-27-doc-counts.mjs` records: a text scanner that cannot
 * tell code from prose about code is the defect this family keeps producing.
 * This seed is mostly commentary, and that commentary quotes permission codes
 * and risk levels ("svc.price.read is 'medium' rather than 'low'") in the same
 * shape as the rows below it. String literals and dollar-quoted bodies are left
 * intact, so a `--` inside a description stays data rather than becoming a
 * comment.
 */
function stripSqlComments(sql: string): string {
  const out = [...sql];
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))?.[0];
      if (tag !== undefined) {
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? sql.length : close + tag.length;
        continue;
      }
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const stop = nl === -1 ? sql.length : nl;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      const stop = close === -1 ? sql.length : close + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * Reads the comma-separated `('a','b',...)` tuples of a VALUES list starting at
 * `from`, and reports where it stopped. Every field must be a quoted literal;
 * anything else is a parse failure naming its line, never a silently skipped row.
 */
function parseValueTuples(sql: string, from: number): { rows: string[][]; end: number } {
  const rows: string[][] = [];
  let i = from;
  const skipSpace = (): void => {
    while (i < sql.length && /\s/.test(sql[i] as string)) i += 1;
  };
  for (;;) {
    skipSpace();
    if (sql[i] === ',') {
      i += 1;
      continue;
    }
    if (sql[i] !== '(') break;
    i += 1;
    const fields: string[] = [];
    let expecting: 'value' | 'separator' = 'value';
    for (;;) {
      skipSpace();
      if (i >= sql.length) seedFail(`line ${seedLineOf(sql, i)}: unterminated VALUES tuple`);
      const ch = sql[i] as string;
      if (ch === ')') {
        if (expecting === 'value' && fields.length > 0) {
          seedFail(`line ${seedLineOf(sql, i)}: trailing comma in a VALUES tuple`);
        }
        i += 1;
        break;
      }
      if (expecting === 'separator') {
        if (ch !== ',') seedFail(`line ${seedLineOf(sql, i)}: expected "," or ")", found "${ch}"`);
        i += 1;
        expecting = 'value';
        continue;
      }
      if (ch !== "'")
        seedFail(`line ${seedLineOf(sql, i)}: expected a quoted value, found "${ch}"`);
      const opened = i;
      i += 1;
      let value = '';
      for (;;) {
        if (i >= sql.length) {
          seedFail(`line ${seedLineOf(sql, opened)}: unterminated string literal`);
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += sql[i];
        i += 1;
      }
      fields.push(value);
      expecting = 'separator';
    }
    rows.push(fields);
  }
  return { rows, end: i };
}

/**
 * The platform permission catalog as `04_iam_permission_catalog.sql` DECLARES it
 * — parsed from the seed file, never read back from a database.
 *
 * ## Why this exists
 *
 * Two database suites used to restate this file's contents: a literal catalogue
 * total in `p1-15-shared-services-runtime-capabilities.test.ts` and an
 * exhaustive code list in `p1-19-catalog-reconciliation.test.ts`. Adding one
 * permission code to the seed stale-dated both, and every local gate stayed
 * green. That is the defect `scripts/ci/check-p1-27-doc-counts.mjs` was built
 * for and states plainly: a number written by hand that nothing recomputes. The
 * expectation now moves with the seed by construction, so the only way to change
 * it is to change the authority it is read from.
 *
 * ## What this does NOT make true by construction
 *
 * This reads a FILE. It never queries a database, so the suites using it still
 * compare two independent things: the seed says what the catalog is, and the
 * database is asked what it actually holds. A code missing from the database, an
 * extra code, a wrong domain, a wrong description, a wrong risk level, and a
 * migration that inserts a permission behind the seed's back all still fail —
 * and so does a checkout whose seed changed without the database being re-reset,
 * which is exactly the drift these suites exist to report.
 *
 * What it cannot catch, and no seed-derived expectation ever could, is a typo in
 * the seed itself: `wo.work_order.tranistion` would be declared and seeded
 * consistently. That direction is held by the CONSUMERS, which do not read this
 * file — `tests/backend/p1-23-authorization.test.ts` grants each route-declared
 * code and requires the operation to SUCCEED, and `tests/ci/p1-28-access-gate.test.ts`
 * requires every code a screen consults to exist in this catalogue.
 *
 * Rows come back in declaration order with duplicates PRESERVED: the seed's own
 * `ON CONFLICT (permission_code) DO NOTHING` swallows a repeated code silently,
 * so a caller that must prove there is no duplicate has to be able to see one.
 */
export function readSeededPermissionCatalog(): SeededPermission[] {
  const sql = stripSqlComments(readFileSync(PERMISSION_CATALOG_SEED, 'utf8'));

  const headers = [...sql.matchAll(/INSERT\s+INTO\s+iam\.permissions\s*\(([^()]*)\)\s*VALUES/gi)];
  if (headers.length !== 1) {
    seedFail(
      `expected exactly one "INSERT INTO iam.permissions (...) VALUES", found ${headers.length}`
    );
  }
  const header = headers[0] as RegExpMatchArray & { index: number };
  const columns = (header[1] as string).split(',').map((name) => name.trim().toLowerCase());

  // Mapped BY NAME, never by position: a reordered column list would otherwise
  // silently swap every description and risk level in the parsed catalogue.
  const columnAt = (name: string): number => {
    const at = columns.indexOf(name);
    if (at === -1) seedFail(`column "${name}" is missing from the seed's column list`);
    return at;
  };
  const codeAt = columnAt('permission_code');
  const domainAt = columnAt('domain');
  const descriptionAt = columnAt('description');
  const riskAt = columnAt('risk_level');

  const { rows, end } = parseValueTuples(sql, header.index + (header[0] as string).length);

  // The statement must end in the seed's own conflict arm. This is what proves
  // the scan consumed the WHOLE list: a parser that stopped early would
  // under-count the catalogue and hand every caller a quietly wrong expectation,
  // which is worse than the literal it replaces.
  if (!/^\s*ON\s+CONFLICT\s*\(\s*permission_code\s*\)\s*DO\s+NOTHING\s*;/i.test(sql.slice(end))) {
    seedFail(
      `the VALUES list did not end at "ON CONFLICT (permission_code) DO NOTHING;" ` +
        `(stopped on line ${seedLineOf(sql, end)} after ${rows.length} rows)`
    );
  }

  return rows.map((fields, index) => {
    if (fields.length !== columns.length) {
      seedFail(
        `row ${index + 1} declares ${fields.length} values but the column list declares ${columns.length}`
      );
    }
    return {
      permissionCode: fields[codeAt] as string,
      domain: fields[domainAt] as string,
      description: fields[descriptionAt] as string,
      riskLevel: fields[riskAt] as string,
    };
  });
}

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
