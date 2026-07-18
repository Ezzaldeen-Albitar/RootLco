-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: permission-gated read paths for audit and privileged viewing
-- Tasks: P1-04-DB-023, P1-04-DB-024, P1-04-SEC-001, P1-04-SEC-002, P1-04-SEC-003
-- Owner module: iam
--
-- Purpose
--   Increments A–F deliberately left the audit tables platform-only and the
--   session/login tables own-row-only. This migration adds the permission-gated
--   read paths built on iam.has_permission (Increment H): audit-view, and
--   security-admin viewing of all sessions / all login history in a tenant.
--   Default deny is preserved — a session without the permission sees ZERO rows.
--
-- Dependencies
--   Increment F (audit tables), E (login_audit/user_sessions), H (has_permission).
--
-- Rollback classification: ROLLBACK-SAFE (policies/grants only). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * Audit tables gain a SELECT grant, but reads are gated by
--     iam.has_permission('iam.audit.view'): no permission → no rows. Writes stay
--     ungranted (append-only via iam.audit_append; the chain detects tampering).
--   * user_sessions/login_audit keep their own-row policy AND gain an
--     admin policy (RLS policies are OR-ed) gated by a distinct permission, so a
--     security administrator can see all sessions / login history in the tenant
--     while ordinary users still see only their own.
--   * The permission codes are seeded in Increment J; until a grant exists,
--     every gated read is denied — safe by default.
--   * Index coverage (FK-supporting, tenant-leading, active-session partial,
--     grant-resolution, audit-timeline) was created alongside each table in
--     Increments A–H; the FK-coverage and no-duplicate-index assertions verify
--     it. No new index is required here.
--
-- Objects created
--   Policies:  sel_audit_records_permitted, sel_audit_record_details_permitted,
--              sel_audit_integrity_links_permitted, sel_security_events_permitted,
--              sel_user_sessions_admin, sel_login_audit_admin
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Audit read: SELECT grant + permission-gated policy (default deny).
-- ----------------------------------------------------------------------------
GRANT SELECT ON iam.audit_records         TO app_runtime, app_readonly;
GRANT SELECT ON iam.audit_record_details  TO app_runtime, app_readonly;
GRANT SELECT ON iam.audit_integrity_links TO app_runtime, app_readonly;
GRANT SELECT ON iam.security_events        TO app_runtime, app_readonly;

CREATE POLICY sel_audit_records_permitted ON iam.audit_records
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.audit.view'));
CREATE POLICY sel_audit_record_details_permitted ON iam.audit_record_details
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.audit.view'));
CREATE POLICY sel_audit_integrity_links_permitted ON iam.audit_integrity_links
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.audit.view'));
CREATE POLICY sel_security_events_permitted ON iam.security_events
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.audit.view'));

COMMENT ON POLICY sel_audit_records_permitted ON iam.audit_records IS
  'Audit reads require the iam.audit.view permission (Increment H resolution). No permission → zero rows. Writes remain ungranted; the hash chain is the tamper control.';

-- ----------------------------------------------------------------------------
-- 2. Privileged viewing of sessions / login history (in addition to own-row).
-- ----------------------------------------------------------------------------
CREATE POLICY sel_user_sessions_admin ON iam.user_sessions
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.session.view_all'));
CREATE POLICY sel_login_audit_admin ON iam.login_audit
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.login.view_all'));

COMMENT ON POLICY sel_user_sessions_admin ON iam.user_sessions IS
  'Adds security-admin visibility of ALL tenant sessions to the own-row policy (policies are OR-ed), gated by iam.session.view_all. Ordinary users still see only their own sessions.';
