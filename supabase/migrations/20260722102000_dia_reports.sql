-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: diagnostic reports + append-only report status history
-- Tasks: P1-09-DB-024 (reports), DB-025 (report status history)
-- Owner module: dia
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only.
--
-- Purpose
--   A diagnostic report is for a job under a work order and pins an EXACT PUBLISHED
--   template version (retained forever; the pinned version can never change). Its
--   lifecycle is a fixed DB invariant (draft→in_progress→completed|cancelled — not
--   tenant-configurable, a safety property). A report cannot reach 'completed'
--   while a mandatory template item is unanswered (design §10 completion gate; the
--   per-item results table is added next). Every real change emits an append-only
--   status-history row.
--
-- Dependencies
--   wo.work_orders / jobs; dia.template_versions / template_items /
--   diagnostic_types; shared.stamp_status_history / touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Objects created
--   Tables:    dia.diagnostic_reports, dia.diagnostic_report_status_history
--   Functions: dia.guard_diagnostic_report_refs(), dia.guard_diagnostic_report_transition(),
--              dia.guard_diagnostic_report_status_coherence(), dia.emit_diagnostic_report_status_history()
-- ============================================================================

CREATE TABLE dia.diagnostic_reports (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  company_id         uuid    NOT NULL,
  branch_id          uuid    NOT NULL,
  work_order_id      uuid    NOT NULL,
  job_id             uuid    NOT NULL,
  template_version_id uuid   NOT NULL,
  diagnostic_type_id uuid    NOT NULL,
  status             text    NOT NULL DEFAULT 'draft',
  revision_number    integer NOT NULL DEFAULT 1,
  summary            text    NULL,
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_diagnostic_reports PRIMARY KEY (id),
  CONSTRAINT uq_diagnostic_reports_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_diagnostic_reports_work_order
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_diagnostic_reports_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_diagnostic_reports_template_version
    FOREIGN KEY (tenant_id, template_version_id) REFERENCES dia.template_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_diagnostic_reports_type FOREIGN KEY (diagnostic_type_id) REFERENCES dia.diagnostic_types (id) ON DELETE RESTRICT,
  CONSTRAINT ck_diagnostic_reports_status CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT ck_diagnostic_reports_revision CHECK (revision_number > 0),
  CONSTRAINT ck_diagnostic_reports_summary_not_blank CHECK (summary IS NULL OR btrim(summary) <> '')
);
COMMENT ON TABLE dia.diagnostic_reports IS
  'Phase 1-9 diagnostic report (P1-09-DB-024). Pins an exact published template version (retained forever). Fixed lifecycle draft→in_progress→completed|cancelled; completion requires all mandatory items answered.';
CREATE INDEX ix_diagnostic_reports_work_order ON dia.diagnostic_reports (tenant_id, company_id, branch_id, work_order_id);
-- Non-partial FK-covering index for the job FK, plus a partial query index by status.
CREATE INDEX ix_diagnostic_reports_job ON dia.diagnostic_reports (tenant_id, company_id, branch_id, job_id);
CREATE INDEX ix_diagnostic_reports_job_status ON dia.diagnostic_reports (tenant_id, company_id, branch_id, job_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_diagnostic_reports_template_version ON dia.diagnostic_reports (tenant_id, template_version_id);
CREATE INDEX ix_diagnostic_reports_type ON dia.diagnostic_reports (diagnostic_type_id);

-- Refs guard (BEFORE INSERT): the job must belong to the work order; the pinned
-- template version must be PUBLISHED (never draft/retired at pin time).
CREATE OR REPLACE FUNCTION dia.guard_diagnostic_report_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_wo uuid;
  v_ver_status text;
BEGIN
  SELECT work_order_id INTO v_job_wo FROM wo.jobs
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = NEW.job_id;
  IF v_job_wo IS DISTINCT FROM NEW.work_order_id THEN
    RAISE EXCEPTION 'diagnostic report job % does not belong to work order %', NEW.job_id, NEW.work_order_id
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO v_ver_status FROM dia.template_versions
  WHERE tenant_id = NEW.tenant_id AND id = NEW.template_version_id;
  IF v_ver_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'diagnostic report must pin a published template version (version is %)', COALESCE(v_ver_status, '(missing)')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION dia.guard_diagnostic_report_refs() IS
  'BEFORE INSERT on dia.diagnostic_reports: the job must belong to the work order and the pinned template version must be published.';
REVOKE EXECUTE ON FUNCTION dia.guard_diagnostic_report_refs() FROM PUBLIC;

-- Transition guard (BEFORE UPDATE OF status): fixed lifecycle + completion gate.
CREATE OR REPLACE FUNCTION dia.guard_diagnostic_report_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_unanswered integer;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('in_progress', 'cancelled'))
    OR (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid diagnostic report transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'completed' THEN
    SELECT count(*) INTO v_unanswered
    FROM dia.template_items ti
    WHERE ti.tenant_id = NEW.tenant_id AND ti.template_version_id = NEW.template_version_id
      AND ti.is_mandatory AND ti.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM dia.report_item_results r
        WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
          AND r.branch_id = NEW.branch_id AND r.diagnostic_report_id = NEW.id
          AND r.template_item_id = ti.id
          AND (r.result_value IS NOT NULL OR r.not_applicable_reason IS NOT NULL)
      );
    IF v_unanswered > 0 THEN
      RAISE EXCEPTION 'diagnostic report % cannot complete: % mandatory item(s) unanswered', NEW.id, v_unanswered
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION dia.guard_diagnostic_report_transition() IS
  'BEFORE UPDATE OF status on dia.diagnostic_reports: fixed lifecycle graph; completion blocked while a mandatory template item is unanswered (result or documented not-applicable).';
REVOKE EXECUTE ON FUNCTION dia.guard_diagnostic_report_transition() FROM PUBLIC;

CREATE TRIGGER tg_diagnostic_reports_refs BEFORE INSERT ON dia.diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION dia.guard_diagnostic_report_refs();
CREATE TRIGGER tg_diagnostic_reports_transition BEFORE UPDATE OF status ON dia.diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION dia.guard_diagnostic_report_transition();
CREATE TRIGGER tg_diagnostic_reports_immutable BEFORE UPDATE ON dia.diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'job_id', 'template_version_id',
    'diagnostic_type_id', 'created_at', 'created_by');
CREATE TRIGGER tg_diagnostic_reports_touch_metadata BEFORE UPDATE ON dia.diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
ALTER TABLE dia.diagnostic_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.diagnostic_reports FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_diagnostic_reports_scope ON dia.diagnostic_reports FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_diagnostic_reports_scope ON dia.diagnostic_reports FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_diagnostic_reports_scope ON dia.diagnostic_reports FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.diagnostic_reports TO app_runtime;
GRANT SELECT ON dia.diagnostic_reports TO app_readonly;

-- ----------------------------------------------------------------------------
-- Append-only diagnostic report status history + coherence + stamp + emitter.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.diagnostic_report_status_history (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  company_id          uuid        NOT NULL,
  branch_id           uuid        NOT NULL,
  diagnostic_report_id uuid       NOT NULL,
  from_state          text        NULL,
  to_state            text        NOT NULL,
  reason              text        NULL,
  correlation_id      uuid        NULL,
  actor_id            uuid        NOT NULL,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  seq                 bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_diagnostic_report_status_history PRIMARY KEY (id),
  CONSTRAINT fk_diagnostic_report_status_history_report
    FOREIGN KEY (tenant_id, company_id, branch_id, diagnostic_report_id)
    REFERENCES dia.diagnostic_reports (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_diagnostic_report_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_diagnostic_report_status_history_states CHECK (
    to_state IN ('draft', 'in_progress', 'completed', 'cancelled')
    AND (from_state IS NULL OR from_state IN ('draft', 'in_progress', 'completed', 'cancelled'))),
  CONSTRAINT ck_diagnostic_report_status_history_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);
COMMENT ON TABLE dia.diagnostic_report_status_history IS
  'Phase 1-9 append-only diagnostic report status ledger (P1-09-DB-025). Trigger-emitted; coherence-guarded; server-stamped. SELECT+INSERT only.';
CREATE INDEX ix_diagnostic_report_status_history_report
  ON dia.diagnostic_report_status_history (tenant_id, company_id, branch_id, diagnostic_report_id, occurred_at DESC, seq DESC);

CREATE OR REPLACE FUNCTION dia.guard_diagnostic_report_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT status INTO v_current FROM dia.diagnostic_reports
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = NEW.diagnostic_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'diagnostic report % not found in this scope', NEW.diagnostic_report_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the report current status %', NEW.to_state, v_current
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION dia.guard_diagnostic_report_status_coherence() IS
  'BEFORE INSERT on dia.diagnostic_report_status_history: rejects a row whose to_state does not equal the report current status.';
REVOKE EXECUTE ON FUNCTION dia.guard_diagnostic_report_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_diagnostic_report_status_history_coherence BEFORE INSERT ON dia.diagnostic_report_status_history
  FOR EACH ROW EXECUTE FUNCTION dia.guard_diagnostic_report_status_coherence();
CREATE TRIGGER tg_diagnostic_report_status_history_stamp BEFORE INSERT ON dia.diagnostic_report_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE dia.diagnostic_report_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.diagnostic_report_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_diagnostic_report_status_history_scope ON dia.diagnostic_report_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_diagnostic_report_status_history_scope ON dia.diagnostic_report_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON dia.diagnostic_report_status_history TO app_runtime;
GRANT SELECT ON dia.diagnostic_report_status_history TO app_readonly;

CREATE OR REPLACE FUNCTION dia.emit_diagnostic_report_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  v_reason      text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO dia.diagnostic_report_status_history
      (tenant_id, company_id, branch_id, diagnostic_report_id, from_state, to_state, reason, correlation_id)
    VALUES (NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.id, OLD.status, NEW.status, v_reason, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION dia.emit_diagnostic_report_status_history() IS
  'AFTER UPDATE trigger on dia.diagnostic_reports: writes one append-only status-history row when status actually changes.';
REVOKE EXECUTE ON FUNCTION dia.emit_diagnostic_report_status_history() FROM PUBLIC;

CREATE TRIGGER tg_diagnostic_reports_status_history AFTER UPDATE ON dia.diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION dia.emit_diagnostic_report_status_history();
