-- ============================================================================
-- Phase: 1-15 — Shared Services Backend
-- Migration: tenant-safe shared-services write capabilities for document
--            metadata and pre-acceptance versions/links, notification
--            enqueueing, tenant template administration, and the asynchronous
--            worker surface (dispatch lifecycle, provider delivery evidence,
--            search projection)
-- Change request: DBCR-P1-15-001
-- Owner module: shared
--
-- Purpose
--   Phase 1-5 created the `shared` service structures and correctly declined to
--   grant a write surface to a caller that did not yet exist. Phase 1-15 is that
--   caller. Measured as `rootlco_test_runtime` (a member of `app_runtime`,
--   NOBYPASSRLS, non-super) against the protected baseline, ten shared-service
--   write targets failed with SQLSTATE 42501 before any constraint or trigger
--   was reached. The block is doubled: `app_runtime` holds SELECT-only
--   privileges AND the tables carry no INSERT/UPDATE/DELETE policy at all, with
--   RLS ENABLEd and FORCEd — so a privilege alone would still deny, and a policy
--   alone would still deny.
--
--   This migration is DBCR-P1-15-001's approved, minimum, additive remediation.
--   Nothing here creates a table, column, constraint, index, sequence, trigger,
--   or function. It adds grants and policies only.
--
-- Dependencies
--   0002 (role archetypes and context readers), 20260718100000..20260718107000
--   (the Phase 1-5 shared service tables), 20260725090000 (DBCR-P1-13-001
--   foundation write capabilities), 20260726090000 (DBCR-P1-14-001
--   administration capabilities).
--
-- Rollback classification: ROLLBACK-SAFE (grants and policies only — no data is
--   written, moved, or destroyed). The exact inverse is given at the end of this
--   file. Recorded in
--   docs/phase-1/phase-1-15/phase-1-15-migration-classification.md.
--
-- Security implications
--   * `app_runtime` and `app_worker` remain NOLOGIN, non-owner, NOBYPASSRLS, and
--     own nothing. No role is created; no ownership is transferred; no role
--     attribute changes.
--   * `app_readonly` gains nothing at all.
--   * Every `app_runtime` policy is anchored on
--     `tenant_id = iam.current_tenant_id()` and gated on a permission. There is
--     no `USING (true)` and no `WITH CHECK (true)` for the request role. A
--     session with no resolved tenant matches nothing, because the comparison is
--     against NULL.
--   * The three `app_worker` policies follow the cross-tenant worker pattern this
--     schema already established in `wkr_error_records_all` and
--     `wkr_processed_events_all`: the worker drains every tenant's queue, so its
--     policy is deliberately tenant-blind and **role membership plus the
--     column-scoped GRANT is the precision control**. `app_worker` is NOLOGIN and
--     is never an interactive request role.
--   * NO schema USAGE is granted. NO function is created. NO existing function
--     body, trigger, or guard is modified.
--   * NO DELETE is granted to `app_runtime` anywhere. The only DELETE added is
--     `app_worker` on `shared.search_metadata`, whose rows are a derived
--     projection with no evidentiary value.
--   * NO TRUNCATE, REFERENCES, TRIGGER privilege, and no `GRANT ALL`, anywhere.
--
-- Three capabilities are DELIBERATELY WITHHELD (see the capability matrix)
--   1. `shared.status_history` / `shared.status_evidence` — NOT granted to any
--      application role. `entity_id` carries no aggregate foreign key,
--      `entity_type` has no allow-list, the state vocabulary is unconstrained,
--      and there is no coherence guard — while every module owns a scope-bound,
--      coherence-guarded history table instead. Granting INSERT would create a
--      transition log forgeable inside a tenant. P1-15's transition service
--      composes the module-owned contracts.
--   2. `shared.file_scan_results` — NOT granted to any role, in any form. A
--      `scan_status = 'clean'` row is the sole positive evidence
--      `shared.guard_document_version_transition` accepts before a version may
--      become `accepted`, and the table has no triggers, so an `infected` verdict
--      could otherwise be silently rewritten. Consequence, recorded honestly: no
--      scanner exists in this phase, so a document version cannot reach
--      `accepted`. This migration delivers pre-acceptance lifecycle only and
--      claims no malware scanning.
--   3. `shared.search_metadata` write for `app_runtime` — withheld so the stored
--      normalized search expression can never be client-influenced. Projection
--      maintenance is asynchronous derivation and belongs to the worker.
--
-- Unchanged by design
--   `shared.error_records` and `shared.processed_events` already carry the
--   correct `app_worker` capability and their `wkr_*_all` policies. They are not
--   touched. `app_runtime` continues to hold no write access to either.
--
-- Policies added: ins_documents_scoped, ins_document_versions_scoped,
--                 upd_document_versions_reject, ins_document_links_scoped,
--                 upd_document_links_unlink, ins_outbound_messages_enqueue,
--                 ins_message_templates_tenant, upd_message_templates_tenant,
--                 ins_template_versions_tenant, upd_template_versions_tenant,
--                 lck_template_versions_reference,
--                 wkr_outbound_messages_dispatch, wkr_delivery_attempts_all,
--                 wkr_search_metadata_all
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Privileges — request runtime.
--
--    Column-scoped throughout. Three column classes are never granted:
--      * trigger-maintained metadata (`updated_by`, `updated_at`,
--        `record_version`) — `shared.touch_row_metadata()` owns them, and Phase
--        1-14 findings R-007/R-010 proved that naming a trigger-stamped column in
--        an UPDATE raises 42501 before any row is touched;
--      * re-parenting columns (`tenant_id`, `company_id`, `branch_id`) on UPDATE;
--      * guard-assigned lifecycle timestamps and immutable identity.
-- ----------------------------------------------------------------------------

-- Document metadata. `status` is NOT granted: shared.guard_document_initial_state
-- fixes the initial state, and there is no UPDATE grant at all on this table, so
-- a document's status, legal hold, classification and retention class cannot be
-- changed through the request path. `legal_hold` is the absolute deletion blocker
-- and request code must never be able to clear it.
GRANT INSERT (id, tenant_id, company_id, branch_id, category_id, title,
              classification, retention_class, created_by)
  ON shared.documents                    TO app_runtime;

-- Version metadata. `status` is excluded from INSERT (the initial-state guard
-- fixes it to 'pending') and granted on UPDATE as the ONLY updatable column, so
-- the pre-acceptance lifecycle is expressible while acceptance stays gated on
-- scan evidence this role cannot produce. accepted_at/quarantined_at/rejected_at
-- are stamped by shared.guard_document_version_transition.
GRANT INSERT (id, tenant_id, document_id, version_number, storage_key,
              content_type, size_bytes, sha256, uploaded_by, created_by)
  ON shared.document_versions            TO app_runtime;
GRANT UPDATE (status)
  ON shared.document_versions            TO app_runtime;

-- Links. Unlinking is a soft delete, so `deleted_at` is the only updatable
-- column and no DELETE is granted: the link history is part of how a document
-- became reachable.
GRANT INSERT (id, tenant_id, document_id, entity_type, entity_id, link_purpose,
              linked_by, created_by)
  ON shared.document_links               TO app_runtime;
GRANT UPDATE (deleted_at)
  ON shared.document_links               TO app_runtime;

-- Notification enqueue ONLY. No UPDATE of any kind: `status`, `retry_count`,
-- `failure_class` and every lifecycle timestamp are dispatch-side facts. Request
-- code therefore cannot forge a queued, sent, or delivered state, and cannot
-- reach shared.delivery_attempts at all.
GRANT INSERT (id, tenant_id, company_id, branch_id, template_version_id, channel,
              purpose, recipient_digest, recipient_user_id, body_sha256,
              dedupe_key, consent_ref, created_by)
  ON shared.outbound_messages            TO app_runtime;

-- Tenant template administration. `scope` is grantable on INSERT because the
-- policy's WITH CHECK pins it to 'tenant'; it is NOT grantable on UPDATE, so a
-- tenant row can never be promoted to a platform row that every tenant reads.
-- template_code/channel/purpose/locale_code are template identity and are not
-- updatable.
GRANT INSERT (id, scope, tenant_id, template_code, name, channel, purpose,
              locale_code, description, active_version_id, status, created_by)
  ON shared.message_templates            TO app_runtime;
GRANT UPDATE (name, description, active_version_id, status, deleted_at)
  ON shared.message_templates            TO app_runtime;

-- Template versions. approved_at/retired_at are stamped by
-- shared.guard_template_version_lifecycle and are not granted; version_number is
-- the human-facing revision identity and is not updatable.
GRANT INSERT (id, tenant_id, template_id, version_number, subject, body,
              content_hash, status, created_by)
  ON shared.template_versions            TO app_runtime;
GRANT UPDATE (subject, body, content_hash, status, approved_by)
  ON shared.template_versions            TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Privileges — asynchronous worker.
--
--    `app_worker` held NO privilege at all on these three tables, so the worker
--    could not drain a queue it is the only legitimate writer of. SELECT is
--    granted alongside the writes because a dispatcher must read the row it is
--    about to act on.
-- ----------------------------------------------------------------------------

-- Dispatch lifecycle. Exactly two updatable columns. retry_count and every
-- lifecycle timestamp are assigned by shared.guard_outbound_message_lifecycle;
-- tenant_id/company_id/branch_id are frozen by tg_outbound_messages_immutable.
GRANT SELECT ON shared.outbound_messages TO app_worker;
GRANT UPDATE (status, failure_class)
  ON shared.outbound_messages            TO app_worker;

-- Provider delivery evidence. Append-only: INSERT only, no UPDATE, no DELETE.
-- This table has no triggers at all, so the absence of UPDATE is the control
-- that stops an errored attempt being rewritten as delivered.
GRANT SELECT ON shared.delivery_attempts TO app_worker;
GRANT INSERT (id, tenant_id, message_id, attempt_number, provider_code,
              provider_message_ref, status, response_code, error_summary,
              details, attempted_at, completed_at, created_by)
  ON shared.delivery_attempts            TO app_worker;

-- Search projection. `id` and `locale_code` are excluded from UPDATE by column
-- grant rather than trusted to a trigger: probing proved tg_search_metadata_
-- immutable does not cover them, and locale_code is part of the identity unique
-- index. entity_type/entity_id/field_code are source identity and are not
-- updatable, so a projection can never be re-parented onto another source.
GRANT SELECT ON shared.search_metadata   TO app_worker;
GRANT INSERT (id, tenant_id, company_id, branch_id, entity_type, entity_id,
              field_code, locale_code, normalized_value, classification,
              source_updated_at, created_by)
  ON shared.search_metadata              TO app_worker;
GRANT UPDATE (normalized_value, classification, source_updated_at)
  ON shared.search_metadata              TO app_worker;
GRANT DELETE ON shared.search_metadata   TO app_worker;

-- ----------------------------------------------------------------------------
-- 3. Document policies. Authorship is pinned to the acting user, and the
--    permission is evaluated in the document's own company/branch scope with
--    iam.has_permission_in_scope — not the tenant-wide iam.has_permission, which
--    Phase 1-14 proved unsafe where scope matters.
-- ----------------------------------------------------------------------------

CREATE POLICY ins_documents_scoped ON shared.documents
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND created_by = iam.current_user_id()
    AND iam.has_permission_in_scope('shared.document.manage', company_id, branch_id)
  );

-- The parent document is resolved from the database, never taken from the
-- request, and it is resolved inside the caller's own RLS view — so a version
-- can never be attached to another tenant's document.
CREATE POLICY ins_document_versions_scoped ON shared.document_versions
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND uploaded_by = iam.current_user_id()
    AND created_by = iam.current_user_id()
    AND EXISTS (
      SELECT 1 FROM shared.documents d
      WHERE d.tenant_id = document_versions.tenant_id
        AND d.id = document_versions.document_id
        AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  );

-- Pre-acceptance rejection only. USING pins the source state to 'pending' and
-- WITH CHECK pins the destination to 'rejected': acceptance and quarantine are
-- scanner outcomes, not request-path outcomes, and neither is reachable here
-- even before shared.guard_document_version_transition is consulted.
CREATE POLICY upd_document_versions_reject ON shared.document_versions
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM shared.documents d
      WHERE d.tenant_id = document_versions.tenant_id
        AND d.id = document_versions.document_id
        AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND status = 'rejected'
    AND EXISTS (
      SELECT 1 FROM shared.documents d
      WHERE d.tenant_id = document_versions.tenant_id
        AND d.id = document_versions.document_id
        AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  );

CREATE POLICY ins_document_links_scoped ON shared.document_links
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND linked_by = iam.current_user_id()
    AND created_by = iam.current_user_id()
    AND EXISTS (
      SELECT 1 FROM shared.documents d
      WHERE d.tenant_id = document_links.tenant_id
        AND d.id = document_links.document_id
        AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  );

CREATE POLICY upd_document_links_unlink ON shared.document_links
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM shared.documents d
      WHERE d.tenant_id = document_links.tenant_id
        AND d.id = document_links.document_id
        AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM shared.documents d
      WHERE d.tenant_id = document_links.tenant_id
        AND d.id = document_links.document_id
        AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Notification enqueue policy. `status = 'pending'` is asserted on the
--    resulting row: the column is not grantable, so it takes its default, and the
--    assertion makes a future default change fail loudly here rather than
--    silently admit a forged state.
-- ----------------------------------------------------------------------------

CREATE POLICY ins_outbound_messages_enqueue ON shared.outbound_messages
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND created_by = iam.current_user_id()
    AND status = 'pending'
    AND iam.has_permission_in_scope('shared.notification.send', company_id, branch_id)
  );

-- ----------------------------------------------------------------------------
-- 5. Template administration policies. `scope = 'tenant'` and a non-null
--    tenant-owned row appear on BOTH sides of every predicate, so a platform
--    template — readable by every tenant through sel_message_templates_visible —
--    can be neither created nor mutated by tenant request code.
--    `org.settings.manage` is the frozen catalogue's existing tenant-configuration
--    permission; template administration is tenant configuration, so no new code
--    is minted for it.
-- ----------------------------------------------------------------------------

CREATE POLICY ins_message_templates_tenant ON shared.message_templates
  FOR INSERT TO app_runtime
  WITH CHECK (
    scope = 'tenant'
    AND tenant_id = iam.current_tenant_id()
    AND created_by = iam.current_user_id()
    AND iam.has_permission('org.settings.manage')
  );

CREATE POLICY upd_message_templates_tenant ON shared.message_templates
  FOR UPDATE TO app_runtime
  USING (
    scope = 'tenant'
    AND tenant_id = iam.current_tenant_id()
    AND iam.has_permission('org.settings.manage')
  )
  WITH CHECK (
    scope = 'tenant'
    AND tenant_id = iam.current_tenant_id()
    AND iam.has_permission('org.settings.manage')
  );

CREATE POLICY ins_template_versions_tenant ON shared.template_versions
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = iam.current_tenant_id()
    AND created_by = iam.current_user_id()
    AND iam.has_permission('org.settings.manage')
  );

CREATE POLICY upd_template_versions_tenant ON shared.template_versions
  FOR UPDATE TO app_runtime
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = iam.current_tenant_id()
    AND iam.has_permission('org.settings.manage')
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = iam.current_tenant_id()
    AND iam.has_permission('org.settings.manage')
  );

-- Lock-only policy (finding P1-15-R-001).
--
-- `shared.guard_outbound_message_scope` resolves the referenced template with
-- `SELECT ... FROM shared.template_versions WHERE id = ... FOR SHARE`. Under RLS a
-- *locking* read must additionally satisfy an UPDATE policy — the same mechanism
-- behind Phase 1-14 finding R-011. With only `upd_template_versions_tenant`
-- present, the lock admits no row for a platform template (`tenant_id IS NULL`),
-- and none at all for a sender who does not also hold `org.settings.manage`, so
-- the guard reports "template version does not exist" and enqueueing against a
-- platform template — the entire reason platform templates exist — is impossible.
--
-- This policy admits the row for LOCKING only. It can never permit a write:
-- permissive policies OR their `WITH CHECK`, this one contributes `false`, and the
-- only other check demands `tenant_id = iam.current_tenant_id()`. Because
-- `tenant_id` is deliberately absent from the UPDATE column grant, a platform row
-- cannot be re-tenanted into passing that check. Lockable, never mutable.
CREATE POLICY lck_template_versions_reference ON shared.template_versions
  FOR UPDATE TO app_runtime
  USING (tenant_id IS NULL OR tenant_id = iam.current_tenant_id())
  WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- 6. Worker policies. Deliberately tenant-blind, matching the pattern already
--    established by wkr_error_records_all and wkr_processed_events_all: a
--    dispatcher drains every tenant's queue. The precision control is the
--    column-scoped GRANT above plus membership of `app_worker`, which is NOLOGIN
--    and is never used by an interactive request.
-- ----------------------------------------------------------------------------

CREATE POLICY wkr_outbound_messages_dispatch ON shared.outbound_messages
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY wkr_delivery_attempts_all ON shared.delivery_attempts
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY wkr_search_metadata_all ON shared.search_metadata
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- ROLLBACK (exact inverse — grants and policies only; no data is touched)
--
-- DROP POLICY wkr_search_metadata_all           ON shared.search_metadata;
-- DROP POLICY wkr_delivery_attempts_all         ON shared.delivery_attempts;
-- DROP POLICY wkr_outbound_messages_dispatch    ON shared.outbound_messages;
-- DROP POLICY lck_template_versions_reference   ON shared.template_versions;
-- DROP POLICY upd_template_versions_tenant      ON shared.template_versions;
-- DROP POLICY ins_template_versions_tenant      ON shared.template_versions;
-- DROP POLICY upd_message_templates_tenant      ON shared.message_templates;
-- DROP POLICY ins_message_templates_tenant      ON shared.message_templates;
-- DROP POLICY ins_outbound_messages_enqueue     ON shared.outbound_messages;
-- DROP POLICY upd_document_links_unlink         ON shared.document_links;
-- DROP POLICY ins_document_links_scoped         ON shared.document_links;
-- DROP POLICY upd_document_versions_reject      ON shared.document_versions;
-- DROP POLICY ins_document_versions_scoped      ON shared.document_versions;
-- DROP POLICY ins_documents_scoped              ON shared.documents;
--
-- REVOKE DELETE ON shared.search_metadata FROM app_worker;
-- REVOKE UPDATE (normalized_value, classification, source_updated_at)
--   ON shared.search_metadata FROM app_worker;
-- REVOKE INSERT (id, tenant_id, company_id, branch_id, entity_type, entity_id,
--                field_code, locale_code, normalized_value, classification,
--                source_updated_at, created_by)
--   ON shared.search_metadata FROM app_worker;
-- REVOKE SELECT ON shared.search_metadata FROM app_worker;
-- REVOKE INSERT (id, tenant_id, message_id, attempt_number, provider_code,
--                provider_message_ref, status, response_code, error_summary,
--                details, attempted_at, completed_at, created_by)
--   ON shared.delivery_attempts FROM app_worker;
-- REVOKE SELECT ON shared.delivery_attempts FROM app_worker;
-- REVOKE UPDATE (status, failure_class) ON shared.outbound_messages FROM app_worker;
-- REVOKE SELECT ON shared.outbound_messages FROM app_worker;
-- REVOKE UPDATE (subject, body, content_hash, status, approved_by)
--   ON shared.template_versions FROM app_runtime;
-- REVOKE INSERT (id, tenant_id, template_id, version_number, subject, body,
--                content_hash, status, created_by)
--   ON shared.template_versions FROM app_runtime;
-- REVOKE UPDATE (name, description, active_version_id, status, deleted_at)
--   ON shared.message_templates FROM app_runtime;
-- REVOKE INSERT (id, scope, tenant_id, template_code, name, channel, purpose,
--                locale_code, description, active_version_id, status, created_by)
--   ON shared.message_templates FROM app_runtime;
-- REVOKE INSERT (id, tenant_id, company_id, branch_id, template_version_id,
--                channel, purpose, recipient_digest, recipient_user_id,
--                body_sha256, dedupe_key, consent_ref, created_by)
--   ON shared.outbound_messages FROM app_runtime;
-- REVOKE UPDATE (deleted_at) ON shared.document_links FROM app_runtime;
-- REVOKE INSERT (id, tenant_id, document_id, entity_type, entity_id,
--                link_purpose, linked_by, created_by)
--   ON shared.document_links FROM app_runtime;
-- REVOKE UPDATE (status) ON shared.document_versions FROM app_runtime;
-- REVOKE INSERT (id, tenant_id, document_id, version_number, storage_key,
--                content_type, size_bytes, sha256, uploaded_by, created_by)
--   ON shared.document_versions FROM app_runtime;
-- REVOKE INSERT (id, tenant_id, company_id, branch_id, category_id, title,
--                classification, retention_class, created_by)
--   ON shared.documents FROM app_runtime;
-- ============================================================================
