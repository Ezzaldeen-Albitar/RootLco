-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: retention classes, legal holds, and controlled document archival
-- Tasks: P1-05-DB-006, P1-05-SEC-002, P1-05-QA-005
-- Owner module: shared
--
-- Purpose
--   retention_classes is the platform, deterministic definition of each retention
--   class (period + whether deletion is ever permitted). legal_holds is the
--   auditable per-document hold record. document_deletion_eligibility answers
--   "may this document be disposed of?" through THREE gates (no legal hold, no
--   active links, retention elapsed on a class that allows deletion), and
--   archive_document is the ONLY controlled transition to the archived state:
--   legal hold ALWAYS wins, and every archival is written to the Phase-1-4 audit
--   chain in the SAME transaction — an audit failure aborts the archival.
--
-- Dependencies
--   Increment A shared.documents (+ its legal_hold flag), Increment C
--   shared.document_links, Phase 1-4 iam.audit_append, org.tenants,
--   shared.touch_row_metadata, org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only);
--   roll-forward-only once holds/definitions exist. Recorded in
--   docs/database/phase-1-5-migration-classification.md.
--
-- Security implications
--   * Physical deletion of file bytes is NOT performed here (backend/infra scope):
--     this migration governs the metadata disposition state only.
--   * There is no ad-hoc DELETE grant. Archival is a controlled transition; a
--     legal hold blocks it absolutely (checked first).
--   * archive_document calls iam.audit_append as its final step in the same
--     transaction; any audit exception rolls the archival back (atomicity).
--
-- Objects created
--   Tables:    shared.retention_classes, shared.legal_holds
--   Functions: shared.document_deletion_eligibility(uuid, uuid),
--              shared.archive_document(uuid, uuid, uuid, text, text)
--   Triggers:  tg_retention_classes_touch_metadata, tg_retention_classes_immutable,
--              tg_legal_holds_touch_metadata, tg_legal_holds_immutable
--   Policies:  sel_retention_classes_all, sel_legal_holds_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.retention_classes (P1-05-DB-006) — platform retention definitions.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.retention_classes (
  class_code         text        NOT NULL,
  description        text        NOT NULL,
  min_retention_days integer     NULL,
  allows_deletion    boolean     NOT NULL,
  record_version     integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid        NULL,

  CONSTRAINT pk_retention_classes PRIMARY KEY (class_code),
  CONSTRAINT ck_retention_classes_code CHECK (
    class_code IN (
      'operational', 'evidence-audit', 'personal-data', 'temporary',
      'immutable-financial-history'
    )
  ),
  CONSTRAINT ck_retention_classes_days_nonneg CHECK (min_retention_days IS NULL OR min_retention_days >= 0),
  CONSTRAINT ck_retention_classes_desc_not_blank CHECK (btrim(description) <> '')
);

COMMENT ON TABLE shared.retention_classes IS
  'Platform, deterministic definition of each retention class (P1-05-DB-006): minimum retention period (NULL = indefinite) and whether physical deletion is ever permitted. Immutable-financial-history sets allows_deletion=false. Populated by structural seeds (Increment M); no tenant scope (platform reference, TENANT_COLUMN_EXCEPTIONS).';

CREATE TRIGGER tg_retention_classes_touch_metadata
  BEFORE UPDATE ON shared.retention_classes
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_retention_classes_immutable
  BEFORE UPDATE ON shared.retention_classes
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('class_code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. shared.legal_holds (P1-05-SEC-002) — auditable per-document hold records.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.legal_holds (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  document_id    uuid        NOT NULL,
  reason         text        NOT NULL,
  placed_by      uuid        NOT NULL,
  placed_at      timestamptz NOT NULL DEFAULT now(),
  released_by    uuid        NULL,
  released_at    timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_legal_holds PRIMARY KEY (id),
  CONSTRAINT fk_legal_holds_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_legal_holds_document
    FOREIGN KEY (tenant_id, document_id) REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_legal_holds_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_legal_holds_release_pairing CHECK ((released_at IS NULL) = (released_by IS NULL))
);

COMMENT ON TABLE shared.legal_holds IS
  'Auditable per-document legal hold (P1-05-SEC-002). An ACTIVE hold (released_at IS NULL) blocks archival/deletion absolutely. Placing/releasing is a governed backend operation (no runtime write); runtime reads within-tenant only.';

-- At most one ACTIVE hold per document.
CREATE UNIQUE INDEX uq_legal_holds_active
  ON shared.legal_holds (tenant_id, document_id)
  WHERE released_at IS NULL;

CREATE TRIGGER tg_legal_holds_touch_metadata
  BEFORE UPDATE ON shared.legal_holds
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_legal_holds_immutable
  BEFORE UPDATE ON shared.legal_holds
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'document_id', 'reason', 'placed_by', 'placed_at', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 3. Eligibility: deterministic three-gate answer (legal hold wins).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.document_deletion_eligibility(p_tenant uuid, p_document_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_doc    shared.documents%ROWTYPE;
  v_class  shared.retention_classes%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM shared.documents WHERE tenant_id = p_tenant AND id = p_document_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- Gate 1 — legal hold ALWAYS wins (flag or an active hold record).
  IF v_doc.legal_hold THEN
    RETURN 'legal_hold';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shared.legal_holds
    WHERE tenant_id = p_tenant AND document_id = p_document_id AND released_at IS NULL
  ) THEN
    RETURN 'legal_hold';
  END IF;

  IF v_doc.status = 'archived' THEN
    RETURN 'already_archived';
  END IF;

  -- Gate 2 — active links block disposition.
  IF EXISTS (
    SELECT 1 FROM shared.document_links
    WHERE tenant_id = p_tenant AND document_id = p_document_id AND deleted_at IS NULL
  ) THEN
    RETURN 'active_links';
  END IF;

  -- Gate 3 — retention elapsed on a class that permits deletion.
  SELECT * INTO v_class FROM shared.retention_classes WHERE class_code = v_doc.retention_class;
  IF NOT FOUND THEN
    RETURN 'class_undefined';
  END IF;
  IF NOT v_class.allows_deletion THEN
    RETURN 'class_no_delete';
  END IF;
  IF v_class.min_retention_days IS NULL THEN
    RETURN 'retention_indefinite';
  END IF;
  IF now() < v_doc.created_at + make_interval(days => v_class.min_retention_days) THEN
    RETURN 'retention_not_elapsed';
  END IF;

  RETURN 'eligible';
END;
$$;

COMMENT ON FUNCTION shared.document_deletion_eligibility(uuid, uuid) IS
  'Deterministic disposition eligibility for a document (P1-05-QA-005): returns a reason code or ''eligible''. Legal hold (flag or active hold record) always wins; active links block; retention is measured from created_at against the class definition. Read-only.';

REVOKE EXECUTE ON FUNCTION shared.document_deletion_eligibility(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.document_deletion_eligibility(uuid, uuid) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 4. Controlled archival transition — audited, atomic, legal-hold-blocked.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.archive_document(
  p_tenant      uuid,
  p_document_id uuid,
  p_actor       uuid,
  p_reason      text,
  p_actor_kind  text DEFAULT 'user'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_elig  text;
  v_audit uuid;
BEGIN
  v_elig := shared.document_deletion_eligibility(p_tenant, p_document_id);
  IF v_elig <> 'eligible' THEN
    RAISE EXCEPTION 'document % not eligible for archival: %', p_document_id, v_elig
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE shared.documents
     SET status = 'archived', archived_at = now()
   WHERE tenant_id = p_tenant AND id = p_document_id;

  -- Final step, same transaction: an audit failure rolls the archival back.
  v_audit := iam.audit_append(
    p_tenant, p_actor, p_actor_kind, 'shared.document.archive', 'shared.documents',
    p_document_id, NULL, NULL, NULL, p_reason,
    jsonb_build_array(
      jsonb_build_object('field', 'status', 'old', 'pending', 'new', 'archived', 'class', 'internal'),
      jsonb_build_object('field', 'reason', 'new', p_reason, 'class', 'internal')
    )
  );

  RETURN v_audit;
END;
$$;

COMMENT ON FUNCTION shared.archive_document(uuid, uuid, uuid, text, text) IS
  'Controlled retention transition to archived (P1-05-SEC-002/QA-005): raises unless document_deletion_eligibility = eligible (legal hold always blocks), then archives and writes an iam.audit_append record in the same transaction. No physical deletion — that is later backend/infra scope. Backend/worker operation; no runtime EXECUTE grant.';

REVOKE EXECUTE ON FUNCTION shared.archive_document(uuid, uuid, uuid, text, text) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.retention_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.retention_classes FORCE  ROW LEVEL SECURITY;
ALTER TABLE shared.legal_holds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.legal_holds       FORCE  ROW LEVEL SECURITY;

-- Retention classes are platform reference data: readable by every app role.
CREATE POLICY sel_retention_classes_all ON shared.retention_classes
  FOR SELECT TO app_runtime, app_readonly
  USING (true);

CREATE POLICY sel_legal_holds_tenant ON shared.legal_holds
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 6. Grants — SELECT only. Placing holds and archiving are backend operations.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.retention_classes TO app_runtime, app_readonly;
GRANT SELECT ON shared.legal_holds       TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
