-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: report item results, findings, measurements, DTCs, evidence,
--            recommendations, reviews
-- Tasks: P1-09-DB-026..029, DB-031..033
-- Owner module: dia
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only.
--
-- Purpose
--   The content of a diagnostic report: per-item results (a value OR a documented
--   not-applicable reason — the mandatory-completion basis), findings (constrained
--   severity/disposition), measurements (unit required), DTC records (validated
--   code), evidence (binds an EXACT immutable document version; append-only, no
--   substitution), recommendations, and reviews (server-stamped reviewer; append-
--   only). All branch-scoped children of dia.diagnostic_reports.
--
-- Dependencies
--   dia.diagnostic_reports / template_items; shared.document_versions (tenant,id);
--   iam.current_user_id; shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    dia.report_item_results, dia.findings, dia.measurements,
--              dia.dtc_records, dia.diagnostic_evidence, dia.recommendations,
--              dia.diagnostic_reviews
--   Functions: dia.stamp_review()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. dia.report_item_results — the answer to a template item (completion basis).
-- ----------------------------------------------------------------------------
CREATE TABLE dia.report_item_results (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  diagnostic_report_id uuid   NOT NULL,
  template_item_id    uuid    NOT NULL,
  result_value        text    NULL,
  not_applicable_reason text  NULL,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_report_item_results PRIMARY KEY (id),
  CONSTRAINT uq_report_item_results_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_report_item_results_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_item_results_item
    FOREIGN KEY (tenant_id, template_item_id) REFERENCES dia.template_items (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_report_item_results_answered CHECK (
    (result_value IS NOT NULL AND btrim(result_value) <> '')
    OR (not_applicable_reason IS NOT NULL AND btrim(not_applicable_reason) <> ''))
);
COMMENT ON TABLE dia.report_item_results IS
  'Phase 1-9 per-item diagnostic result (P1-09-DB-026). Each row is a value OR a documented not-applicable reason; the report completion gate counts mandatory items answered here.';
CREATE UNIQUE INDEX uq_report_item_results_report_item
  ON dia.report_item_results (tenant_id, company_id, branch_id, diagnostic_report_id, template_item_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_report_item_results_report ON dia.report_item_results (tenant_id, company_id, branch_id, diagnostic_report_id);
CREATE INDEX ix_report_item_results_item ON dia.report_item_results (tenant_id, template_item_id);
CREATE TRIGGER tg_report_item_results_touch_metadata BEFORE UPDATE ON dia.report_item_results
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_report_item_results_immutable BEFORE UPDATE ON dia.report_item_results
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'diagnostic_report_id', 'template_item_id', 'created_at', 'created_by');
ALTER TABLE dia.report_item_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.report_item_results FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_report_item_results_scope ON dia.report_item_results FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_report_item_results_scope ON dia.report_item_results FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_report_item_results_scope ON dia.report_item_results FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.report_item_results TO app_runtime;
GRANT SELECT ON dia.report_item_results TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. dia.findings — constrained severity/disposition.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.findings (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  diagnostic_report_id uuid   NOT NULL,
  template_item_id    uuid    NULL,
  severity            text    NOT NULL,
  disposition         text    NOT NULL,
  description         text    NOT NULL,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_findings PRIMARY KEY (id),
  CONSTRAINT uq_findings_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_findings_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_findings_item
    FOREIGN KEY (tenant_id, template_item_id) REFERENCES dia.template_items (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_findings_severity CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  CONSTRAINT ck_findings_disposition CHECK (disposition IN ('monitor', 'repair_recommended', 'repair_required', 'no_action')),
  CONSTRAINT ck_findings_description_not_blank CHECK (btrim(description) <> '')
);
COMMENT ON TABLE dia.findings IS
  'Phase 1-9 diagnostic finding (P1-09-DB-027). Constrained severity + disposition; optional template-item link.';
CREATE INDEX ix_findings_report ON dia.findings (tenant_id, company_id, branch_id, diagnostic_report_id);
CREATE INDEX ix_findings_item ON dia.findings (tenant_id, template_item_id);
CREATE TRIGGER tg_findings_touch_metadata BEFORE UPDATE ON dia.findings
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_findings_immutable BEFORE UPDATE ON dia.findings
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'diagnostic_report_id', 'created_at', 'created_by');
ALTER TABLE dia.findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.findings FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_findings_scope ON dia.findings FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_findings_scope ON dia.findings FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_findings_scope ON dia.findings FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.findings TO app_runtime;
GRANT SELECT ON dia.findings TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. dia.measurements — numeric reading (unit required).
-- ----------------------------------------------------------------------------
CREATE TABLE dia.measurements (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  diagnostic_report_id uuid   NOT NULL,
  template_item_id    uuid    NULL,
  label               text    NOT NULL,
  measured_value      numeric NOT NULL,
  unit                text    NOT NULL,
  within_range        boolean NULL,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_measurements PRIMARY KEY (id),
  CONSTRAINT uq_measurements_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_measurements_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_measurements_item
    FOREIGN KEY (tenant_id, template_item_id) REFERENCES dia.template_items (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_measurements_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT ck_measurements_unit_not_blank CHECK (btrim(unit) <> '')
);
COMMENT ON TABLE dia.measurements IS
  'Phase 1-9 diagnostic measurement (P1-09-DB-028). Unit is required; within_range flags out-of-spec readings.';
CREATE INDEX ix_measurements_report ON dia.measurements (tenant_id, company_id, branch_id, diagnostic_report_id);
CREATE INDEX ix_measurements_item ON dia.measurements (tenant_id, template_item_id);
CREATE TRIGGER tg_measurements_touch_metadata BEFORE UPDATE ON dia.measurements
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_measurements_immutable BEFORE UPDATE ON dia.measurements
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'diagnostic_report_id', 'created_at', 'created_by');
ALTER TABLE dia.measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.measurements FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_measurements_scope ON dia.measurements FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_measurements_scope ON dia.measurements FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_measurements_scope ON dia.measurements FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.measurements TO app_runtime;
GRANT SELECT ON dia.measurements TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. dia.dtc_records — diagnostic trouble codes (validated).
-- ----------------------------------------------------------------------------
CREATE TABLE dia.dtc_records (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  diagnostic_report_id uuid   NOT NULL,
  code                text    NOT NULL,
  description         text    NULL,
  dtc_status          text    NOT NULL DEFAULT 'active',
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_dtc_records PRIMARY KEY (id),
  CONSTRAINT uq_dtc_records_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_dtc_records_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_dtc_records_code_format CHECK (code ~ '^[PBCU][0-9][0-9A-F]{3}$'),
  CONSTRAINT ck_dtc_records_description_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_dtc_records_status CHECK (dtc_status IN ('active', 'pending', 'stored', 'cleared'))
);
COMMENT ON TABLE dia.dtc_records IS
  'Phase 1-9 diagnostic trouble code (P1-09-DB-029). OBD-II code format validated (e.g. P0300).';
CREATE INDEX ix_dtc_records_report ON dia.dtc_records (tenant_id, company_id, branch_id, diagnostic_report_id);
CREATE INDEX ix_dtc_records_code ON dia.dtc_records (tenant_id, code);
CREATE TRIGGER tg_dtc_records_touch_metadata BEFORE UPDATE ON dia.dtc_records
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_dtc_records_immutable BEFORE UPDATE ON dia.dtc_records
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'diagnostic_report_id', 'code', 'created_at', 'created_by');
ALTER TABLE dia.dtc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.dtc_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_dtc_records_scope ON dia.dtc_records FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_dtc_records_scope ON dia.dtc_records FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_dtc_records_scope ON dia.dtc_records FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.dtc_records TO app_runtime;
GRANT SELECT ON dia.dtc_records TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. dia.diagnostic_evidence — append-only; binds an exact document version.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.diagnostic_evidence (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  diagnostic_report_id uuid   NOT NULL,
  document_version_id uuid    NOT NULL,
  evidence_type       text    NOT NULL,
  note                text    NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,

  CONSTRAINT pk_diagnostic_evidence PRIMARY KEY (id),
  CONSTRAINT fk_diagnostic_evidence_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_diagnostic_evidence_version
    FOREIGN KEY (tenant_id, document_version_id) REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_diagnostic_evidence_type_not_blank CHECK (btrim(evidence_type) <> ''),
  CONSTRAINT ck_diagnostic_evidence_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);
COMMENT ON TABLE dia.diagnostic_evidence IS
  'Phase 1-9 append-only diagnostic evidence (P1-09-DB-031). Binds an EXACT immutable shared.document_versions row; no substitution. SELECT+INSERT only.';
CREATE INDEX ix_diagnostic_evidence_report ON dia.diagnostic_evidence (tenant_id, company_id, branch_id, diagnostic_report_id);
CREATE INDEX ix_diagnostic_evidence_version ON dia.diagnostic_evidence (tenant_id, document_version_id);
ALTER TABLE dia.diagnostic_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.diagnostic_evidence FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_diagnostic_evidence_scope ON dia.diagnostic_evidence FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_diagnostic_evidence_scope ON dia.diagnostic_evidence FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON dia.diagnostic_evidence TO app_runtime;
GRANT SELECT ON dia.diagnostic_evidence TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. dia.recommendations — advisory outcomes.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.recommendations (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  diagnostic_report_id uuid   NOT NULL,
  recommendation      text    NOT NULL,
  priority            text    NOT NULL DEFAULT 'medium',
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_recommendations PRIMARY KEY (id),
  CONSTRAINT uq_recommendations_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_recommendations_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_recommendations_not_blank CHECK (btrim(recommendation) <> ''),
  CONSTRAINT ck_recommendations_priority CHECK (priority IN ('low', 'medium', 'high'))
);
COMMENT ON TABLE dia.recommendations IS
  'Phase 1-9 diagnostic recommendation (P1-09-DB-032).';
CREATE INDEX ix_recommendations_report ON dia.recommendations (tenant_id, company_id, branch_id, diagnostic_report_id);
CREATE TRIGGER tg_recommendations_touch_metadata BEFORE UPDATE ON dia.recommendations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_recommendations_immutable BEFORE UPDATE ON dia.recommendations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'diagnostic_report_id', 'created_at', 'created_by');
ALTER TABLE dia.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.recommendations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_recommendations_scope ON dia.recommendations FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_recommendations_scope ON dia.recommendations FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_recommendations_scope ON dia.recommendations FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.recommendations TO app_runtime;
GRANT SELECT ON dia.recommendations TO app_readonly;

-- ----------------------------------------------------------------------------
-- 7. dia.diagnostic_reviews — append-only; server-stamped reviewer attribution.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.diagnostic_reviews (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  diagnostic_report_id uuid   NOT NULL,
  review_result       text    NOT NULL,
  notes               text    NULL,
  reviewer_id         uuid    NOT NULL,
  reviewed_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_diagnostic_reviews PRIMARY KEY (id),
  CONSTRAINT fk_diagnostic_reviews_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_diagnostic_reviews_result CHECK (review_result IN ('approved', 'rejected', 'needs_rework')),
  CONSTRAINT ck_diagnostic_reviews_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
COMMENT ON TABLE dia.diagnostic_reviews IS
  'Phase 1-9 append-only diagnostic review (P1-09-DB-033). reviewer_id + reviewed_at are server-stamped (cannot be forged). SELECT+INSERT only.';
CREATE INDEX ix_diagnostic_reviews_report ON dia.diagnostic_reviews (tenant_id, company_id, branch_id, diagnostic_report_id, reviewed_at DESC);

CREATE OR REPLACE FUNCTION dia.stamp_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.reviewer_id := iam.current_user_id();
  IF NEW.reviewer_id IS NULL THEN
    RAISE EXCEPTION 'diagnostic review requires an actor in the session context' USING ERRCODE = 'check_violation';
  END IF;
  NEW.reviewed_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION dia.stamp_review() IS
  'BEFORE INSERT on dia.diagnostic_reviews: server-stamps reviewer_id (iam.current_user_id) and reviewed_at so review attribution cannot be forged.';
REVOKE EXECUTE ON FUNCTION dia.stamp_review() FROM PUBLIC;

CREATE TRIGGER tg_diagnostic_reviews_stamp BEFORE INSERT ON dia.diagnostic_reviews
  FOR EACH ROW EXECUTE FUNCTION dia.stamp_review();
ALTER TABLE dia.diagnostic_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.diagnostic_reviews FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_diagnostic_reviews_scope ON dia.diagnostic_reviews FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_diagnostic_reviews_scope ON dia.diagnostic_reviews FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON dia.diagnostic_reviews TO app_runtime;
GRANT SELECT ON dia.diagnostic_reviews TO app_readonly;
