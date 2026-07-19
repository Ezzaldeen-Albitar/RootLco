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
  // Phase 1-3 (P1-03-DB-022): the Phase 1-2 idempotency pattern, promoted to a
  // permanent platform table (no application-role access at all).
  'shared.idempotency_keys',
  // Phase 1-4 identity foundation (P1-04-DB-001..004). Registered explicitly.
  'iam.user_accounts',
  'iam.user_profiles',
  'iam.user_employee_links',
  'iam.user_status_history',
  // Phase 1-4 authorization (P1-04-DB-005..007).
  'iam.permissions',
  'iam.roles',
  'iam.role_permissions',
  // Phase 1-4 scoped grants (P1-04-DB-008..009).
  'iam.role_grants',
  'iam.grant_scopes',
  // Phase 1-4 approval limits and sensitive-data permissions (P1-04-DB-010..011).
  'iam.approval_limits',
  'iam.sensitive_data_permissions',
  // Phase 1-4 login audit and session metadata (P1-04-DB-012..013).
  'iam.login_audit',
  'iam.user_sessions',
  // Phase 1-4 audit subsystem (P1-04-DB-014..017).
  'iam.audit_records',
  'iam.audit_record_details',
  'iam.audit_integrity_links',
  'iam.security_events',
  // Phase 1-4 generic status history (P1-04-DB-018).
  'shared.status_history',
  'shared.status_evidence',
  // Phase 1-5 shared services — governed document metadata (P1-05-DB-001/002).
  'shared.document_categories',
  'shared.documents',
  // Phase 1-5 Increment B — versioned file metadata and scan results (P1-05-DB-003/004).
  'shared.document_versions',
  'shared.file_scan_results',
  // Phase 1-5 Increment C — generic document links (P1-05-DB-005).
  'shared.document_links',
  // Phase 1-5 Increment D — retention definitions and legal holds (P1-05-DB-006).
  'shared.retention_classes',
  'shared.legal_holds',
  // Phase 1-5 Increment E — governed message templates (P1-05-DB-007/008).
  'shared.message_templates',
  'shared.template_versions',
  // Phase 1-5 Increment F — outbound message persistence (P1-05-DB-009/010).
  'shared.outbound_messages',
  'shared.delivery_attempts',
  // Phase 1-5 Increment G — transactional integration-event delivery.
  'shared.event_outbox',
  // Phase 1-5 Increment H — consumer claims and durable error triage.
  'shared.processed_events',
  'shared.error_records',
  // Phase 1-5 Increment I — immutable settings and governed localization.
  'shared.system_settings',
  'shared.localization_keys',
  'shared.localized_texts',
  // Phase 1-5 Increment J — tenant-scoped search projection metadata.
  'shared.search_metadata',
  // Phase 1-5 Increment K — tenant tags and generic entity annotations.
  'shared.tags',
  'shared.entity_tags',
  'shared.notes',
  'shared.comments',
  // Phase 1-6 CRM — party master (P1-06-DB-001).
  'crm.business_partners',
  // Phase 1-6 CRM — normalized typed identifiers (P1-06-DB-004).
  'crm.partner_identifiers',
  // Phase 1-6 CRM — 1:1 profiles and gated sensitive attributes (P1-06-DB-002/003, SEC-001).
  'crm.individual_profiles',
  'crm.company_profiles',
  'crm.partner_sensitive_attributes',
  // Phase 1-6 CRM — dated typed party roles (P1-06-DB-005).
  'crm.partner_roles',
  // Phase 1-6 CRM — append-only status history (P1-06-DB-006).
  'crm.partner_status_history',
  // Phase 1-6 CRM — segments and dated assignments (P1-06-DB-007).
  'crm.customer_segments',
  'crm.partner_segment_assignments',
  // Phase 1-6 CRM — dated restrictions (P1-06-DB-008).
  'crm.customer_restrictions',
  // Phase 1-6 CRM — alerts and credit-profile foundation (P1-06-DB-013/014).
  'crm.customer_alerts',
  'crm.customer_credit_profiles',
  // Phase 1-6 CRM — append-only block history (P1-06-DB-015).
  'crm.customer_block_history',
  // Phase 1-6 CRM — duplicate candidates and merge history (P1-06-DB-016/017).
  'crm.duplicate_candidates',
  'crm.partner_merges',
  // Phase 1-6 CRM — communication log and timeline (P1-06-DB-018/019).
  'crm.communication_log',
  'crm.timeline_events',
  // Phase 1-6 CRM — contact points and addresses (P1-06-DB-009/010).
  'crm.contact_points',
  'crm.addresses',
  // Phase 1-6 CRM — preferences and consent (P1-06-DB-011/012).
  'crm.communication_preferences',
  'crm.consent_history',
  // Phase 1-7 vehicle — reference catalogs (P1-07-DB-006).
  'veh.makes',
  'veh.models',
  'veh.trims',
  'veh.body_types',
  'veh.powertrain_types',
  // Phase 1-7 vehicle — independent Vehicle master (P1-07-DB-001).
  'veh.vehicles',
  // Phase 1-7 vehicle — typed identifier ledger (P1-07-DB-003).
  'veh.vehicle_identifiers',
  // Phase 1-7 vehicle — append-only VIN verification + attribute history (P1-07-DB-004/005).
  'veh.vin_verifications',
  'veh.vehicle_attribute_history',
  // Phase 1-7 vehicle — mechanical and EV domain (P1-07-DB-007/008/009).
  'veh.engine_history',
  'veh.transmission_history',
  'veh.vehicle_ev_profiles',
  'veh.battery_masters',
  'veh.battery_readings',
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
  // Phase 1-3 (P1-03-DB-005..007): live-parent guard for new branches, the
  // atomic branch lifecycle transition (runtime-executable, RLS-scoped), and
  // the server-stamp trigger that forbids forged branch-history attribution.
  'org.guard_parent_company_live',
  'org.change_branch_status',
  'org.stamp_branch_history',
  // Phase 1-3 (P1-03-DB-008..010): dead parents reject new children.
  'org.guard_parent_branch_live',
  'org.guard_parent_warehouse_live',
  // Phase 1-3 (P1-03-DB-012/015): typed settings validation and the
  // override > plan > default feature-resolution precedence.
  'org.validate_setting_value',
  'org.resolve_feature_enabled',
  // Phase 1-3 (P1-03-DB-022): atomic organization provisioning (platform-only).
  'org.provision_organization',
  // Phase 1-4 (P1-04-DB-004): atomic account lifecycle transition and the
  // server-stamp trigger that forbids forged user-history attribution.
  'iam.change_user_status',
  'iam.stamp_user_status_history',
  // Phase 1-4 (P1-04-DB-009): deferred scoped-grant integrity.
  'iam.enforce_scoped_grant_has_scope',
  // Phase 1-4 (P1-04-DB-012): server-stamp of login-audit timestamps.
  'iam.stamp_login_audit',
  // Phase 1-4 audit subsystem (P1-04-DB-014..022): masking, canonical
  // serialization, SHA-256 hashing, the sole append writer, and chain verify.
  'iam.audit_mask',
  'iam.audit_canonical',
  'iam.audit_hash',
  'iam.audit_append',
  'iam.audit_verify_chain',
  // Phase 1-4 (P1-04-DB-018): generic status-history server-stamp.
  'shared.stamp_status_history',
  // Phase 1-4 (P1-04-DB-020/021): context wrappers and permission resolution.
  'iam.current_company_ids',
  'iam.current_branch_ids',
  'iam.has_permission',
  'iam.has_permission_in_scope',
  // Phase 1-5 (P1-05-DB-002): documents category-scope guard (platform-or-same-tenant).
  'shared.guard_document_category_scope',
  // Phase 1-5 Increment L: terminal-state INSERT bypass guards for documents
  // and document versions; the merged version UPDATE transition is unchanged.
  'shared.guard_document_initial_state',
  'shared.guard_document_version_initial_state',
  // Phase 1-5 (P1-05-DB-003): document-version one-way lifecycle + clean-scan gate.
  'shared.guard_document_version_transition',
  // Phase 1-5 (P1-05-DB-005): link-derived access resolution primitive.
  'shared.document_ids_for_entity',
  // Phase 1-5 (P1-05-DB-006): retention eligibility + controlled archival.
  'shared.document_deletion_eligibility',
  'shared.archive_document',
  // Phase 1-5 (P1-05-DB-007/008): active-version, scope, and lifecycle guards.
  'shared.guard_template_active_version',
  'shared.guard_template_version_lifecycle',
  'shared.guard_template_version_scope',
  // Phase 1-5 (P1-05-DB-009/SEC-004): approved template scope and exact
  // initial-state/transition enforcement for outbound messages.
  'shared.guard_outbound_message_lifecycle',
  'shared.guard_outbound_message_scope',
  // Phase 1-5 Increment G — initial-state guard and atomic worker lifecycle.
  'shared.guard_event_outbox_initial_state',
  'shared.claim_outbox_events',
  'shared.complete_outbox_event',
  'shared.fail_outbox_event',
  // Phase 1-5 Increment H — recursive error sanitization and lifecycle guard.
  'shared.guard_error_context_sanitized',
  'shared.guard_error_record_lifecycle',
  // Phase 1-5 Increment I — setting resolution and localization lifecycle/reporting.
  'shared.resolve_setting',
  'shared.guard_localized_text_lifecycle',
  'shared.missing_translations',
  // Phase 1-5 Increment K — shared edit stamping and comment-parent guard.
  'shared.stamp_content_edit',
  'shared.guard_comment_parent',
  // Phase 1-6 CRM — merge-redirect integrity guard (P1-06-DB-001).
  'crm.guard_business_partner_merge',
  // Phase 1-6 CRM — point-in-time role resolver (P1-06-DB-005).
  'crm.partner_roles_active_at',
  // Phase 1-6 CRM — consent stamp + current-consent resolver (P1-06-DB-012).
  'crm.guard_consent_insert',
  'crm.current_consent',
  // Phase 1-6 CRM — block/lifecycle coherence guard (P1-06-DB-015).
  'crm.guard_partner_block_coherence',
  // Phase 1-6 CRM — duplicate/merge helpers (P1-06-DB-016/017).
  'crm.jsonb_no_raw_value_keys',
  'crm.stamp_partner_merge',
  'crm.resolve_partner_survivor',
  // Phase 1-6 CRM — timeline emit (P1-06-DB-019) + BEFORE-INSERT stamp (P1-06 review hardening).
  'crm.emit_timeline_event',
  'crm.stamp_timeline_event',
  // Phase 1-6 CRM — search normalization (P1-06-DB-021).
  'crm.normalize_name',
  'crm.normalize_email',
  'crm.normalize_phone',
  // Phase 1-7 vehicle — VIN/plate normalization (P1-07-DB-002/010) and catalog
  // hierarchy scope guards (P1-07-DB-006).
  'veh.normalize_vin',
  'veh.normalize_plate',
  'veh.guard_model_make_scope',
  'veh.guard_trim_model_scope',
  // Phase 1-7 vehicle — master catalog-scope and merge-redirect guards (P1-07-DB-001).
  'veh.guard_vehicle_catalog_refs',
  'veh.guard_vehicle_merge',
  // Phase 1-7 vehicle — missing-VIN activation contract guards (P1-07-DB-003).
  'veh.guard_vehicle_activation',
  'veh.guard_vehicle_identity_removal',
  // Phase 1-7 vehicle — attribute-history emitter (P1-07-DB-005).
  'veh.emit_vehicle_attribute_history',
  // Phase 1-7 vehicle — mechanical/EV temporal + coupling guards and resolvers
  // (P1-07-DB-007/008).
  'veh.guard_temporal_close',
  'veh.engine_at',
  'veh.transmission_at',
  'veh.guard_ev_profile_powertrain',
  'veh.guard_vehicle_ev_powertrain',
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

  it('defines all three application roles as constrained archetypes', async () => {
    const { rows } = await admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb,
              rolreplication
       FROM pg_roles WHERE rolname IN ('app_runtime','app_readonly','app_worker') ORDER BY rolname`
    );
    expect(rows).toHaveLength(3);
    for (const role of rows) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      expect(role.rolcanlogin).toBe(false);
      expect(role.rolcreaterole).toBe(false);
      expect(role.rolcreatedb).toBe(false);
      expect(role.rolreplication).toBe(false);
    }
  });

  it('runtime roles own no schema and no table', async () => {
    const schemas = await admin.query(
      `SELECT nspname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
       WHERE r.rolname IN ('app_runtime','app_readonly','app_worker')`
    );
    expect(schemas.rows).toHaveLength(0);
    const tables = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE r.rolname IN ('app_runtime','app_readonly','app_worker') AND c.relkind = 'r'`
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
      'tg_addresses_immutable',
      'tg_addresses_touch_metadata',
      'tg_approval_limits_immutable',
      'tg_approval_limits_touch_metadata',
      'tg_battery_masters_immutable',
      'tg_battery_masters_touch_metadata',
      'tg_battery_readings_stamp',
      'tg_body_types_immutable',
      'tg_body_types_touch_metadata',
      'tg_branch_settings_immutable',
      'tg_branch_settings_validate_value',
      'tg_branch_status_history_stamp',
      'tg_branches_immutable',
      'tg_branches_parent_company_live',
      'tg_branches_touch_metadata',
      'tg_business_partners_block_coherence',
      'tg_business_partners_immutable',
      'tg_business_partners_merge_guard',
      'tg_business_partners_touch_metadata',
      'tg_comments_guard_parent',
      'tg_comments_immutable',
      'tg_comments_stamp_content_edit',
      'tg_comments_touch_metadata',
      'tg_communication_log_immutable',
      'tg_communication_log_timeline',
      'tg_communication_log_touch_metadata',
      'tg_communication_preferences_immutable',
      'tg_communication_preferences_touch_metadata',
      'tg_company_profiles_immutable',
      'tg_company_profiles_touch_metadata',
      'tg_company_settings_immutable',
      'tg_company_settings_validate_value',
      'tg_consent_history_stamp',
      'tg_consent_history_timeline',
      'tg_contact_points_immutable',
      'tg_contact_points_touch_metadata',
      'tg_cost_centers_immutable',
      'tg_cost_centers_touch_metadata',
      'tg_currencies_touch_metadata',
      'tg_customer_alerts_immutable',
      'tg_customer_alerts_timeline',
      'tg_customer_alerts_touch_metadata',
      'tg_customer_block_history_stamp',
      'tg_customer_block_history_timeline',
      'tg_customer_credit_profiles_immutable',
      'tg_customer_credit_profiles_touch_metadata',
      'tg_customer_restrictions_immutable',
      'tg_customer_restrictions_touch_metadata',
      'tg_customer_segments_immutable',
      'tg_customer_segments_touch_metadata',
      'tg_departments_immutable',
      'tg_departments_parent_branch_live',
      'tg_departments_touch_metadata',
      'tg_document_categories_immutable',
      'tg_document_categories_touch_metadata',
      'tg_document_links_immutable',
      'tg_document_links_touch_metadata',
      'tg_document_versions_guard_initial_state',
      'tg_document_versions_guard_transition',
      'tg_document_versions_immutable',
      'tg_documents_category_scope',
      'tg_documents_guard_initial_state',
      'tg_documents_immutable',
      'tg_documents_touch_metadata',
      'tg_duplicate_candidates_immutable',
      'tg_duplicate_candidates_touch_metadata',
      'tg_engine_history_close',
      'tg_engine_history_immutable',
      'tg_engine_history_touch_metadata',
      'tg_entity_tags_immutable',
      'tg_entity_tags_touch_metadata',
      'tg_error_records_context_sanitized',
      'tg_error_records_guard_lifecycle',
      'tg_error_records_immutable',
      'tg_error_records_touch_metadata',
      'tg_event_outbox_guard_initial_state',
      'tg_feature_flags_immutable',
      'tg_feature_flags_touch_metadata',
      'tg_grant_scopes_require_scope',
      'tg_individual_profiles_immutable',
      'tg_individual_profiles_touch_metadata',
      'tg_languages_touch_metadata',
      'tg_legal_companies_immutable',
      'tg_legal_companies_touch_metadata',
      'tg_legal_holds_immutable',
      'tg_legal_holds_touch_metadata',
      'tg_localization_keys_immutable',
      'tg_localization_keys_touch_metadata',
      'tg_localized_texts_guard_lifecycle',
      'tg_localized_texts_immutable',
      'tg_localized_texts_touch_metadata',
      'tg_login_audit_stamp',
      'tg_makes_immutable',
      'tg_makes_touch_metadata',
      'tg_message_templates_active_version',
      'tg_message_templates_immutable',
      'tg_message_templates_touch_metadata',
      'tg_models_immutable',
      'tg_models_make_scope',
      'tg_models_touch_metadata',
      'tg_notes_immutable',
      'tg_notes_stamp_content_edit',
      'tg_notes_touch_metadata',
      'tg_number_sequences_guard_regression',
      'tg_number_sequences_touch_metadata',
      'tg_outbound_messages_guard_lifecycle',
      'tg_outbound_messages_guard_scope',
      'tg_outbound_messages_immutable',
      'tg_outbound_messages_touch_metadata',
      'tg_partner_identifiers_immutable',
      'tg_partner_identifiers_touch_metadata',
      'tg_partner_merges_stamp',
      'tg_partner_merges_timeline',
      'tg_partner_roles_immutable',
      'tg_partner_roles_touch_metadata',
      'tg_partner_segment_assignments_immutable',
      'tg_partner_segment_assignments_touch_metadata',
      'tg_partner_sensitive_attributes_immutable',
      'tg_partner_sensitive_attributes_touch_metadata',
      'tg_partner_status_history_stamp',
      'tg_partner_status_history_timeline',
      'tg_permissions_immutable',
      'tg_permissions_touch_metadata',
      'tg_powertrain_types_immutable',
      'tg_powertrain_types_touch_metadata',
      'tg_retention_classes_immutable',
      'tg_retention_classes_touch_metadata',
      'tg_role_grants_immutable',
      'tg_role_grants_require_scope',
      'tg_role_grants_touch_metadata',
      'tg_role_permissions_immutable',
      'tg_role_permissions_touch_metadata',
      'tg_roles_immutable',
      'tg_roles_touch_metadata',
      'tg_search_metadata_immutable',
      'tg_search_metadata_touch_metadata',
      'tg_sensitive_data_permissions_immutable',
      'tg_sensitive_data_permissions_touch_metadata',
      'tg_status_history_stamp',
      'tg_storage_locations_immutable',
      'tg_storage_locations_parent_warehouse_live',
      'tg_storage_locations_touch_metadata',
      'tg_subscription_plans_immutable',
      'tg_subscription_plans_touch_metadata',
      'tg_subscription_plans_validate_documents',
      'tg_system_settings_immutable',
      'tg_system_settings_validate_value',
      'tg_tags_immutable',
      'tg_tags_touch_metadata',
      'tg_tax_classes_immutable',
      'tg_tax_classes_touch_metadata',
      'tg_tax_rates_immutable',
      'tg_tax_rates_touch_metadata',
      'tg_template_versions_guard_lifecycle',
      'tg_template_versions_guard_scope',
      'tg_template_versions_immutable',
      'tg_template_versions_touch_metadata',
      'tg_tenant_feature_overrides_immutable',
      'tg_tenant_subscriptions_immutable',
      'tg_tenant_subscriptions_touch_metadata',
      'tg_tenants_immutable_columns',
      'tg_tenants_touch_metadata',
      'tg_timeline_events_stamp',
      'tg_timezones_touch_metadata',
      'tg_timezones_validate_zone_name',
      'tg_transmission_history_close',
      'tg_transmission_history_immutable',
      'tg_transmission_history_touch_metadata',
      'tg_trims_immutable',
      'tg_trims_model_scope',
      'tg_trims_touch_metadata',
      'tg_user_accounts_immutable',
      'tg_user_accounts_touch_metadata',
      'tg_user_employee_links_immutable',
      'tg_user_employee_links_touch_metadata',
      'tg_user_profiles_immutable',
      'tg_user_profiles_touch_metadata',
      'tg_user_sessions_immutable',
      'tg_user_sessions_touch_metadata',
      'tg_user_status_history_stamp',
      'tg_vehicle_attribute_history_stamp',
      'tg_vehicle_ev_profiles_immutable',
      'tg_vehicle_ev_profiles_powertrain',
      'tg_vehicle_ev_profiles_touch_metadata',
      'tg_vehicle_identifiers_identity_removal',
      'tg_vehicle_identifiers_immutable',
      'tg_vehicle_identifiers_touch_metadata',
      'tg_vehicles_activation_guard',
      'tg_vehicles_attribute_history',
      'tg_vehicles_catalog_refs',
      'tg_vehicles_ev_powertrain',
      'tg_vehicles_immutable',
      'tg_vehicles_merge_guard',
      'tg_vehicles_touch_metadata',
      'tg_vin_verifications_stamp',
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
      'ins_addresses_tenant',
      'ins_battery_masters_tenant',
      'ins_battery_readings_tenant',
      'ins_body_types_tenant',
      'ins_branch_settings_scope',
      'ins_branch_status_history_tenant',
      'ins_branches_scope',
      'ins_business_partners_tenant',
      'ins_communication_log_tenant',
      'ins_communication_preferences_tenant',
      'ins_company_profiles_tenant',
      'ins_company_settings_scope',
      'ins_consent_history_tenant',
      'ins_contact_points_tenant',
      'ins_cost_centers_scope',
      'ins_customer_alerts_tenant',
      'ins_customer_block_history_tenant',
      'ins_customer_credit_profiles_tenant',
      'ins_customer_restrictions_tenant',
      'ins_customer_segments_tenant',
      'ins_departments_scope',
      'ins_duplicate_candidates_tenant',
      'ins_engine_history_tenant',
      'ins_individual_profiles_tenant',
      'ins_legal_companies_tenant',
      'ins_makes_tenant',
      'ins_models_tenant',
      'ins_partner_identifiers_tenant',
      'ins_partner_merges_tenant',
      'ins_partner_roles_tenant',
      'ins_partner_segment_assignments_tenant',
      'ins_partner_sensitive_attributes_tenant',
      'ins_partner_status_history_tenant',
      'ins_powertrain_types_tenant',
      'ins_storage_locations_scope',
      'ins_tax_classes_scope',
      'ins_tax_rates_scope',
      'ins_timeline_events_tenant',
      'ins_transmission_history_tenant',
      'ins_trims_tenant',
      'ins_vehicle_attribute_history_tenant',
      'ins_vehicle_ev_profiles_tenant',
      'ins_vehicle_identifiers_tenant',
      'ins_vehicles_tenant',
      'ins_vin_verifications_tenant',
      'ins_warehouses_scope',
      'sel_addresses_tenant',
      'sel_approval_limits_tenant',
      'sel_audit_integrity_links_permitted',
      'sel_audit_record_details_permitted',
      'sel_audit_records_permitted',
      'sel_battery_masters_tenant',
      'sel_battery_readings_tenant',
      'sel_body_types_visible',
      'sel_branch_settings_scope',
      'sel_branch_status_history_tenant',
      'sel_branches_scope',
      'sel_business_partners_tenant',
      'sel_comments_tenant',
      'sel_communication_log_tenant',
      'sel_communication_preferences_tenant',
      'sel_company_profiles_tenant',
      'sel_company_settings_scope',
      'sel_consent_history_tenant',
      'sel_contact_points_tenant',
      'sel_cost_centers_scope',
      'sel_currencies_all',
      'sel_customer_alerts_tenant',
      'sel_customer_block_history_tenant',
      'sel_customer_credit_profiles_tenant',
      'sel_customer_restrictions_tenant',
      'sel_customer_segments_tenant',
      'sel_delivery_attempts_tenant',
      'sel_departments_scope',
      'sel_document_categories_visible',
      'sel_document_links_tenant',
      'sel_document_versions_tenant',
      'sel_documents_tenant',
      'sel_duplicate_candidates_tenant',
      'sel_engine_history_tenant',
      'sel_entity_tags_tenant',
      'sel_feature_flags_all',
      'sel_file_scan_results_tenant',
      'sel_grant_scopes_tenant',
      'sel_individual_profiles_tenant',
      'sel_languages_all',
      'sel_legal_companies_tenant',
      'sel_legal_holds_tenant',
      'sel_localization_keys_all',
      'sel_localized_texts_all',
      'sel_login_audit_admin',
      'sel_login_audit_own',
      'sel_makes_visible',
      'sel_message_templates_visible',
      'sel_models_visible',
      'sel_notes_tenant',
      'sel_number_sequences_tenant',
      'sel_outbound_messages_tenant',
      'sel_partner_identifiers_tenant',
      'sel_partner_merges_tenant',
      'sel_partner_roles_tenant',
      'sel_partner_segment_assignments_tenant',
      'sel_partner_sensitive_attributes_tenant',
      'sel_partner_status_history_tenant',
      'sel_permissions_all',
      'sel_powertrain_types_visible',
      'sel_retention_classes_all',
      'sel_role_grants_tenant',
      'sel_role_permissions_tenant',
      'sel_roles_tenant',
      'sel_search_metadata_tenant',
      'sel_security_events_permitted',
      'sel_sensitive_data_permissions_tenant',
      'sel_status_evidence_tenant',
      'sel_status_history_tenant',
      'sel_storage_locations_scope',
      'sel_subscription_plans_published',
      'sel_system_settings_visible',
      'sel_tags_tenant',
      'sel_tax_classes_scope',
      'sel_tax_rates_scope',
      'sel_template_versions_visible',
      'sel_tenant_feature_overrides_tenant',
      'sel_tenant_status_history_tenant',
      'sel_tenant_subscriptions_tenant',
      'sel_tenants_self',
      'sel_timeline_events_tenant',
      'sel_timezones_all',
      'sel_transmission_history_tenant',
      'sel_trims_visible',
      'sel_user_accounts_tenant',
      'sel_user_employee_links_tenant',
      'sel_user_profiles_tenant',
      'sel_user_sessions_admin',
      'sel_user_sessions_own',
      'sel_user_status_history_tenant',
      'sel_vehicle_attribute_history_tenant',
      'sel_vehicle_ev_profiles_tenant',
      'sel_vehicle_identifiers_tenant',
      'sel_vehicles_tenant',
      'sel_vin_verifications_tenant',
      'sel_warehouses_scope',
      'upd_addresses_tenant',
      'upd_battery_masters_tenant',
      'upd_body_types_tenant',
      'upd_branches_scope',
      'upd_business_partners_tenant',
      'upd_communication_log_tenant',
      'upd_communication_preferences_tenant',
      'upd_company_profiles_tenant',
      'upd_contact_points_tenant',
      'upd_cost_centers_scope',
      'upd_customer_alerts_tenant',
      'upd_customer_credit_profiles_tenant',
      'upd_customer_restrictions_tenant',
      'upd_customer_segments_tenant',
      'upd_departments_scope',
      'upd_duplicate_candidates_tenant',
      'upd_engine_history_tenant',
      'upd_individual_profiles_tenant',
      'upd_legal_companies_tenant',
      'upd_makes_tenant',
      'upd_models_tenant',
      'upd_number_sequences_tenant',
      'upd_partner_identifiers_tenant',
      'upd_partner_roles_tenant',
      'upd_partner_segment_assignments_tenant',
      'upd_partner_sensitive_attributes_tenant',
      'upd_powertrain_types_tenant',
      'upd_storage_locations_scope',
      'upd_tax_classes_scope',
      'upd_tax_rates_scope',
      'upd_transmission_history_tenant',
      'upd_trims_tenant',
      'upd_vehicle_ev_profiles_tenant',
      'upd_vehicle_identifiers_tenant',
      'upd_vehicles_tenant',
      'upd_warehouses_scope',
      'wkr_error_records_all',
      'wkr_event_outbox_all',
      'wkr_processed_events_all',
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
