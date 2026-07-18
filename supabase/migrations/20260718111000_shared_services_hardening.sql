-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: shared-services hardening and fix-forward corrections
-- Tasks: P1-05-DB-019, P1-05-DB-020, P1-05-SEC-001, P1-05-SEC-002,
--        P1-05-SEC-003, P1-05-SEC-004, P1-05-SEC-005
-- Owner module: shared
--
-- Purpose
--   Apply the repository's fix-forward standard to the already-merged,
--   immutable Increment A/B migrations: bind document branches to their
--   company, close both direct terminal-state INSERT paths, and add the exact
--   non-partial child indexes required for foreign-key enforcement support.
--
-- Fix-forward legitimacy and existing data
--   Migrations 20260718100000 and 20260718101000 are merged history and are
--   therefore immutable. Correcting their objects in this later migration is
--   the required fix-forward practice. shared.documents and
--   shared.document_versions are policy-guaranteed empty in every environment
--   at this phase, so replacing the branch FK and validating the new CHECK are
--   data-safe and validate trivially; there is no legacy-row remediation.
--
-- Dependencies
--   Increment A shared.documents/document_categories, Increment B
--   shared.document_versions, Phase 1-3 composite organization candidate keys,
--   and the shared-service tables whose FK support indexes are completed here.
--
-- Rollback classification: ROLLBACK-SAFE only while shared.documents and
--   shared.document_versions remain empty. Once populated, roll-forward-only:
--   restoring the two-column branch FK or removing either insert guard would
--   deliberately reopen reviewed integrity/security bypasses. The added
--   indexes are non-destructive but belong to the corrected contract.
--
-- Security implications
--   * A document branch must belong to the same tenant AND company carried by
--     the document; branch scope can no longer drift across same-tenant firms.
--   * Documents and document versions can only be inserted in pending state
--     with every terminal-state timestamp NULL. Audited/scan-gated transitions
--     remain the only routes to terminal states.
--   * Both guards are SECURITY INVOKER with an empty search_path and have no
--     PUBLIC execution surface.
--
-- Objects created/changed
--   Constraint: ck_documents_branch_requires_company (new),
--               fk_documents_branch (replaced with three-column shape)
--   Functions:  shared.guard_document_initial_state(),
--               shared.guard_document_version_initial_state()
--   Triggers:   tg_documents_guard_initial_state,
--               tg_document_versions_guard_initial_state
--   Indexes:    ix_document_categories_tenant, ix_document_links_document,
--               ix_legal_holds_document, ix_number_sequences_org_scope,
--               ix_documents_org_scope
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fix-forward document organization scope.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.documents
  ADD CONSTRAINT ck_documents_branch_requires_company
  CHECK (branch_id IS NULL OR company_id IS NOT NULL);

ALTER TABLE shared.documents DROP CONSTRAINT fk_documents_branch;

ALTER TABLE shared.documents
  ADD CONSTRAINT fk_documents_branch
  FOREIGN KEY (tenant_id, company_id, branch_id)
  REFERENCES org.branches (tenant_id, company_id, id)
  ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 2. Initial-state guards. Keep the merged document-version UPDATE guard
--    untouched: this dedicated INSERT function closes only the insert bypass.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_document_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.archived_at IS NOT NULL
     OR NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'document must be inserted pending with archived_at and deleted_at unset'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_document_initial_state() IS
  'BEFORE INSERT guard on shared.documents: requires status=pending and archived_at/deleted_at NULL, so callers cannot bypass the controlled archival path with a terminal-state insert.';

REVOKE EXECUTE ON FUNCTION shared.guard_document_initial_state() FROM PUBLIC;

CREATE TRIGGER tg_documents_guard_initial_state
  BEFORE INSERT ON shared.documents
  FOR EACH ROW EXECUTE FUNCTION shared.guard_document_initial_state();

CREATE OR REPLACE FUNCTION shared.guard_document_version_initial_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.accepted_at IS NOT NULL
     OR NEW.quarantined_at IS NOT NULL
     OR NEW.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION
      'document version must be inserted pending with terminal timestamps unset'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_document_version_initial_state() IS
  'BEFORE INSERT guard on shared.document_versions: requires status=pending and all terminal timestamps NULL, preventing direct acceptance without the unchanged clean-scan UPDATE gate.';

REVOKE EXECUTE ON FUNCTION shared.guard_document_version_initial_state() FROM PUBLIC;

CREATE TRIGGER tg_document_versions_guard_initial_state
  BEFORE INSERT ON shared.document_versions
  FOR EACH ROW EXECUTE FUNCTION shared.guard_document_version_initial_state();

-- ----------------------------------------------------------------------------
-- 3. Non-partial FK-support indexes. Partial unique indexes intentionally do
--    not count as universal child-side FK coverage.
-- ----------------------------------------------------------------------------
CREATE INDEX ix_document_categories_tenant
  ON shared.document_categories (tenant_id);

CREATE INDEX ix_document_links_document
  ON shared.document_links (tenant_id, document_id);

CREATE INDEX ix_legal_holds_document
  ON shared.legal_holds (tenant_id, document_id);

CREATE INDEX ix_number_sequences_org_scope
  ON shared.number_sequences (tenant_id, company_id, branch_id);

CREATE INDEX ix_documents_org_scope
  ON shared.documents (tenant_id, company_id, branch_id);
