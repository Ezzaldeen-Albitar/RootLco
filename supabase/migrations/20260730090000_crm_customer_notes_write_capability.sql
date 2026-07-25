-- ============================================================================
-- Phase: 1-16 — CRM Backend
-- Migration: tenant-safe runtime write capability for CRM customer notes on
--            shared.notes (creation, content edit, and soft retirement)
-- Change request: DBCR-P1-16-001
-- Owner module: shared (the granted table) / consumed by: crm
--
-- Purpose
--   Phase 1-5 created shared.notes and correctly declined to grant a write
--   surface to a caller that did not yet exist: the table is SELECT-only for
--   app_runtime AND carries no INSERT/UPDATE/DELETE policy, with RLS ENABLEd and
--   FORCEd. Phase 1-16 (CRM Backend) is the first caller that must author notes
--   about a customer. Measured as rootlco_test_runtime (a member of app_runtime,
--   NOBYPASSRLS, non-super) against the protected baseline, a note INSERT failed
--   with SQLSTATE 42501 (permission denied for table notes) before any constraint
--   or trigger was reached. That is the block this migration lifts, minimally.
--
--   This is DBCR-P1-16-001's approved, minimum, additive remediation. Nothing
--   here creates a table, column, constraint, index, sequence, trigger, or
--   function. It adds grants and two RLS policies only, and mints no permission
--   (the permission code lives in the seed catalog, seed 04).
--
-- Dependencies
--   0002 (role archetypes and context readers), 20260718110000 (shared.notes,
--   its immutable/edit-stamp/metadata triggers, and sel_notes_tenant),
--   the crm party foundation (crm.business_partners), and the iam context
--   readers iam.current_tenant_id(), iam.current_user_id(), iam.has_permission().
--
-- Rollback classification: ROLLBACK-SAFE (grants and policies only — no data is
--   written, moved, or destroyed). The exact inverse is given at the end of this
--   file. Recorded in
--   docs/database/change-requests/DBCR-P1-16-001-crm-customer-notes-write-capability.md.
--
-- Security implications
--   * app_runtime remains NOLOGIN, non-owner, NOBYPASSRLS, and owns nothing. No
--     role is created; no ownership is transferred; no role attribute changes.
--   * app_readonly gains nothing at all. app_worker gains nothing at all.
--   * The write is column-scoped and CRM-customer-scoped. Both policies are
--     anchored on tenant_id = iam.current_tenant_id() AND gated on the permission
--     crm.customer.note.write. There is no USING (true) and no WITH CHECK (true)
--     for the request role. A session with no resolved tenant matches nothing.
--   * INSERT is admitted ONLY for entity_type = 'crm.business_partners' whose
--     target row EXISTS and is live inside the caller's own RLS view, so a note
--     can never be attached to another tenant's, a deleted, or a non-existent
--     customer, nor to any non-customer entity — even though shared.notes is a
--     generic polymorphic table. A future module that needs to annotate its own
--     entities adds its own scoped policy; this migration grants customer notes
--     and nothing else.
--   * author_id and created_by are pinned to the acting user on INSERT. UPDATE is
--     admitted ONLY to the note's own author (author_id = iam.current_user_id()),
--     so one user can never edit or retire another user's note.
--   * The UPDATE column grant is (body, classification, visibility, deleted_at):
--     content revision plus soft retirement. NO DELETE is granted — a note is
--     retired by setting deleted_at, never physically removed, so the annotation
--     history is preserved. re-parenting columns (tenant_id, company_id,
--     branch_id, entity_type, entity_id, author_id) are frozen by the existing
--     tg_notes_immutable trigger and are absent from the UPDATE grant; edited_at
--     is stamped by tg_notes_stamp_content_edit; record_version/updated_* are
--     owned by shared.touch_row_metadata() and naming any of them in an UPDATE
--     would raise 42501 before a row is touched (Phase 1-14 findings R-007/R-010).
--   * company_id and branch_id are DELIBERATELY absent from the INSERT grant: a
--     CRM customer note is tenant-level (the crm schema carries no company/branch
--     scope), so both columns take their NULL default and request code cannot set
--     them.
--   * Reading a restricted/secret note still additionally requires
--     iam.sensitive.view through the unchanged sel_notes_tenant policy. This
--     migration does not touch read visibility.
--   * NO schema USAGE is granted. NO function is created or modified. NO existing
--     policy, trigger, or guard is modified. NO TRUNCATE/REFERENCES/TRIGGER
--     privilege and no GRANT ALL, anywhere.
--
-- Policies added: ins_notes_crm_customer, upd_notes_crm_customer
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Privileges — request runtime. Column-scoped throughout.
-- ----------------------------------------------------------------------------

-- Creation. id/classification/visibility take their table defaults when omitted;
-- they are grantable so the service can set an explicit classification and
-- visibility. company_id/branch_id are NOT granted (tenant-level notes only).
-- edited_at/deleted_at/record_version/created_at/updated_* are never granted on
-- INSERT: they are defaults or trigger/guard-owned.
GRANT INSERT (id, tenant_id, entity_type, entity_id, author_id, body,
              classification, visibility, created_by)
  ON shared.notes TO app_runtime;

-- Revision and soft retirement. Exactly four updatable columns.
GRANT UPDATE (body, classification, visibility, deleted_at)
  ON shared.notes TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. INSERT policy. Authorship is pinned to the acting user; the target must be
--    a live customer resolved inside the caller's own RLS view; the permission
--    crm.customer.note.write is required. entity_type is pinned to
--    'crm.business_partners' so this capability can never author a note on any
--    other entity kind.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_notes_crm_customer ON shared.notes
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND author_id = iam.current_user_id()
    AND created_by = iam.current_user_id()
    AND entity_type = 'crm.business_partners'
    AND iam.has_permission('crm.customer.note.write')
    AND EXISTS (
      SELECT 1
      FROM crm.business_partners bp
      WHERE bp.tenant_id = notes.tenant_id
        AND bp.id = notes.entity_id
        AND bp.deleted_at IS NULL
    )
  );

-- ----------------------------------------------------------------------------
-- 3. UPDATE policy. A note's own author may revise its content/classification/
--    visibility and soft-retire it. Re-parenting is impossible: the target
--    columns are frozen by tg_notes_immutable and absent from the column grant,
--    and the policy pins tenant, author, and entity_type on both sides.
-- ----------------------------------------------------------------------------
CREATE POLICY upd_notes_crm_customer ON shared.notes
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND author_id = iam.current_user_id()
    AND entity_type = 'crm.business_partners'
    AND iam.has_permission('crm.customer.note.write')
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND author_id = iam.current_user_id()
    AND entity_type = 'crm.business_partners'
    AND iam.has_permission('crm.customer.note.write')
  );

-- ============================================================================
-- ROLLBACK (exact inverse — grants and policies only; no data is touched)
--
-- DROP POLICY upd_notes_crm_customer ON shared.notes;
-- DROP POLICY ins_notes_crm_customer ON shared.notes;
-- REVOKE UPDATE (body, classification, visibility, deleted_at)
--   ON shared.notes FROM app_runtime;
-- REVOKE INSERT (id, tenant_id, entity_type, entity_id, author_id, body,
--                classification, visibility, created_by)
--   ON shared.notes FROM app_runtime;
-- ============================================================================
