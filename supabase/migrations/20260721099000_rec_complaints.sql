-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception complaints (metadata) + restricted complaint payload
-- Tasks: P1-08-DB-009 (customer complaints)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   The customer's stated complaint at reception, split into two tables so the
--   free-text narrative is protected:
--     * rec.complaints         — SAFE metadata (category, severity, who reported,
--                                evidence link, correction link). Readable by any
--                                in-scope user.
--     * rec.complaint_details  — the RESTRICTED narrative (complaint_text), 1:1 with
--                                the complaint, row-gated by iam.sensitive.view so a
--                                plain SELECT never exposes the words the customer
--                                used (which can carry personal circumstances).
--   Corrections are LINKED (correction_of), never silent mutations of the text.
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); crm.business_partners
--   (tenant,id); shared.documents (tenant,id) — evidence, no payload copy;
--   iam.current_tenant_id / allowed_*_ids / has_permission; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Security implications
--   * Both tables ENABLE + FORCE RLS; complaints branch-scoped; complaint_details
--     additionally requires iam.has_permission('iam.sensitive.view') on sel/ins/upd.
--   * classification column on the payload is fixed 'restricted' (immutable).
--     No unrestricted projection of the narrative; corrections are append-linked.
--
-- Objects created
--   Tables:    rec.complaints, rec.complaint_details
--   Triggers:  tg_complaints_immutable, tg_complaints_touch_metadata,
--              tg_complaint_details_immutable, tg_complaint_details_touch_metadata
--   Policies:  sel/ins/upd_complaints_scope, sel/ins/upd_complaint_details_gated
--   Indexes:   uq_complaints_scope_id, ix_complaints_visit, ix_complaints_reported_by,
--              ix_complaints_evidence, ix_complaints_correction_of,
--              uq_complaint_details_complaint
-- ============================================================================

CREATE TABLE rec.complaints (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  company_id            uuid        NOT NULL,
  branch_id             uuid        NOT NULL,
  reception_visit_id    uuid        NOT NULL,
  reported_by_partner_id uuid       NULL,
  category              text        NOT NULL,
  severity              text        NOT NULL DEFAULT 'medium',
  evidence_document_id  uuid        NULL,
  correction_of         uuid        NULL,
  correlation_id        uuid        NULL,
  record_version        integer     NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid        NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid        NULL,

  CONSTRAINT pk_complaints PRIMARY KEY (id),
  CONSTRAINT uq_complaints_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_complaints_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_reported_by
    FOREIGN KEY (tenant_id, reported_by_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_correction_of
    FOREIGN KEY (tenant_id, company_id, branch_id, correction_of)
    REFERENCES rec.complaints (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_complaints_category CHECK (category IN (
    'mechanical', 'electrical', 'body', 'noise', 'performance', 'other')),
  CONSTRAINT ck_complaints_severity CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT ck_complaints_not_self_correction CHECK (correction_of IS NULL OR correction_of <> id)
);

COMMENT ON TABLE rec.complaints IS
  'Phase 1-8 reception complaint metadata (P1-08-DB-009). SAFE fields only (category/severity/reporter/evidence/correction). The restricted narrative is in rec.complaint_details. Corrections are linked (correction_of), never silent text mutations.';

CREATE INDEX ix_complaints_visit
  ON rec.complaints (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_complaints_reported_by ON rec.complaints (tenant_id, reported_by_partner_id);
CREATE INDEX ix_complaints_evidence ON rec.complaints (tenant_id, evidence_document_id);
CREATE INDEX ix_complaints_correction_of
  ON rec.complaints (tenant_id, company_id, branch_id, correction_of);

CREATE TRIGGER tg_complaints_immutable
  BEFORE UPDATE ON rec.complaints
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'created_at', 'created_by');
CREATE TRIGGER tg_complaints_touch_metadata
  BEFORE UPDATE ON rec.complaints
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.complaints FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_complaints_scope ON rec.complaints
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_complaints_scope ON rec.complaints
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_complaints_scope ON rec.complaints
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.complaints TO app_runtime;
GRANT SELECT ON rec.complaints TO app_readonly;

-- ----------------------------------------------------------------------------
-- rec.complaint_details — restricted 1:1 narrative, row-gated by sensitive.view.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.complaint_details (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  complaint_id   uuid        NOT NULL,
  complaint_text text        NOT NULL,
  classification text        NOT NULL DEFAULT 'restricted',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_complaint_details PRIMARY KEY (id),
  CONSTRAINT fk_complaint_details_complaint
    FOREIGN KEY (tenant_id, company_id, branch_id, complaint_id)
    REFERENCES rec.complaints (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_complaint_details_classification CHECK (classification = 'restricted'),
  CONSTRAINT ck_complaint_details_text_not_blank CHECK (btrim(complaint_text) <> '')
);

COMMENT ON TABLE rec.complaint_details IS
  'Phase 1-8 RESTRICTED complaint narrative (P1-08-DB-009). 1:1 with rec.complaints; row-gated by iam.has_permission(''iam.sensitive.view'') on sel/ins/upd so a plain SELECT never exposes the customer''s words. classification is fixed ''restricted''.';

-- One live detail per complaint (partial) + a non-partial FK-covering index.
CREATE UNIQUE INDEX uq_complaint_details_complaint
  ON rec.complaint_details (tenant_id, company_id, branch_id, complaint_id)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_complaint_details_complaint
  ON rec.complaint_details (tenant_id, company_id, branch_id, complaint_id);

CREATE TRIGGER tg_complaint_details_immutable
  BEFORE UPDATE ON rec.complaint_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'complaint_id', 'classification',
    'created_at', 'created_by');
CREATE TRIGGER tg_complaint_details_touch_metadata
  BEFORE UPDATE ON rec.complaint_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.complaint_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.complaint_details FORCE  ROW LEVEL SECURITY;
-- Every row is restricted: the whole table requires iam.sensitive.view, in scope.
CREATE POLICY sel_complaint_details_gated ON rec.complaint_details
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view')
  );
CREATE POLICY ins_complaint_details_gated ON rec.complaint_details
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view')
  );
CREATE POLICY upd_complaint_details_gated ON rec.complaint_details
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view')
  )
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
GRANT SELECT, INSERT, UPDATE ON rec.complaint_details TO app_runtime;
GRANT SELECT ON rec.complaint_details TO app_readonly;
