-- ============================================================================
-- P1-32-PRE-OD-FD16C — a report snapshot is saved under rpt.report.configure,
-- not under the export switch (Owner decision D16, part 2, follow-up).
-- Owner module: rpt (one policy predicate)
--
-- Rollback classification: ROLLBACK-SAFE. One policy's WITH CHECK changes; no
--   object is created or dropped, no grant moves and no row is written. The
--   exact inverse at the foot of this file restores the predicate
--   20261008100000 wrote.
--
-- Purpose
--   20261008100000 required rpt.export to INSERT into rpt.report_snapshots.
--   rpt.export is the platform-wide export switch over every registered export
--   resource, and it is withheld from every tenant administrator by an explicit
--   Owner decision (P1-31 CC-04, 2026-09-08); a holder cannot be created by
--   delegation either. So no tenant account could save a snapshot at all.
--
--   A snapshot is an internal, frozen, append-only record that only holders of
--   the dataset's own codes can read (sel_report_snapshots_scope, unchanged); it
--   is not an export out of the platform. Saving one — an original or a
--   restatement — therefore requires rpt.report.configure in place of
--   rpt.export, with rpt.report.read, every frozen dataset code, the tenant,
--   company and branch reach and generated_by = the signed-in user exactly as
--   before. rpt.report.configure is already carried by the tenant administrator
--   bundle; this grants no code to any role and changes no bundle, backfill or
--   grant. It is an interim choice: a dedicated snapshot permission code remains
--   an open Owner question. The CSV export keeps rpt.export.
--
-- Security implications
--   The INSERT policy admits exactly the callers it admitted before with
--   rpt.report.configure substituted for rpt.export. ALTER POLICY keeps the
--   policy's name, command (INSERT) and roles (app_runtime). RLS stays enabled
--   and forced; the SELECT policy, the guard trigger, the grants (SELECT and
--   INSERT to app_runtime, SELECT to app_readonly, no UPDATE or DELETE) and the
--   two unique indexes are untouched. No SECURITY DEFINER.
-- ============================================================================

ALTER POLICY ins_report_snapshots_scope ON rpt.report_snapshots
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND generated_by = iam.current_user_id()
    AND iam.has_permission_in_scope('rpt.report.configure', company_id, branch_id, NULL)
    AND iam.has_permission_in_scope('rpt.report.read', company_id, branch_id, NULL)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(required_permissions) AS required(code)
       WHERE NOT iam.has_permission_in_scope(required.code, company_id, branch_id, NULL)));

COMMENT ON POLICY ins_report_snapshots_scope ON rpt.report_snapshots IS
  'P1-32-PRE-OD-FD16C: a snapshot (original or restatement) is saved by the signed-in person in their tenant, company and branch reach with rpt.report.configure, rpt.report.read and every frozen dataset code in the row''s own company and branch. Not rpt.export: a snapshot is an internal frozen record, not an export. Interim until the Owner decides on a dedicated snapshot permission code.';

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only)
--
--   COMMENT ON POLICY ins_report_snapshots_scope ON rpt.report_snapshots IS NULL;
--   ALTER POLICY ins_report_snapshots_scope ON rpt.report_snapshots
--     WITH CHECK (tenant_id = iam.current_tenant_id()
--       AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
--       AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
--       AND generated_by = iam.current_user_id()
--       AND iam.has_permission_in_scope('rpt.export', company_id, branch_id, NULL)
--       AND iam.has_permission_in_scope('rpt.report.read', company_id, branch_id, NULL)
--       AND NOT EXISTS (
--         SELECT 1 FROM unnest(required_permissions) AS required(code)
--          WHERE NOT iam.has_permission_in_scope(required.code, company_id, branch_id, NULL)));
-- ----------------------------------------------------------------------------
