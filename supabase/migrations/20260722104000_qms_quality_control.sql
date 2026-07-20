-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: quality-control records, per-check results, QC status history
-- Tasks: P1-09-DB-034 (QC records), DB-035 (check results), DB-036 (QC history)
-- Owner module: qms
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only.
--
-- Purpose
--   A quality-control record evaluates a work order. Its overall_result is
--   pending→passed|failed; once finalized it is FROZEN (checker + result + time
--   immutable, design F10), so the closure-gating fact cannot be edited after the
--   fact — re-QC creates a new record. The checker and finalize time are server-
--   stamped (unforgeable). Per-check results record each configured qc_check
--   outcome. Every overall_result change emits an append-only history row.
--
-- Dependencies
--   wo.work_orders; qms.qc_checks; iam.current_user_id; shared.stamp_status_history;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    qms.quality_control_records, qms.qc_check_results, qms.qc_status_history
--   Functions: qms.guard_qc_finalize(), qms.guard_qc_status_coherence(),
--              qms.emit_qc_status_history()
-- ============================================================================

CREATE TABLE qms.quality_control_records (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  work_order_id  uuid    NOT NULL,
  overall_result text    NOT NULL DEFAULT 'pending',
  checker_id     uuid    NULL,
  finalized_at   timestamptz NULL,
  notes          text    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_quality_control_records PRIMARY KEY (id),
  CONSTRAINT uq_quality_control_records_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_quality_control_records_wo
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_quality_control_records_result CHECK (overall_result IN ('pending', 'passed', 'failed')),
  CONSTRAINT ck_quality_control_records_finalized CHECK (
    (overall_result = 'pending' AND finalized_at IS NULL AND checker_id IS NULL)
    OR (overall_result IN ('passed', 'failed') AND finalized_at IS NOT NULL AND checker_id IS NOT NULL)),
  CONSTRAINT ck_quality_control_records_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
COMMENT ON TABLE qms.quality_control_records IS
  'Phase 1-9 quality-control record (P1-09-DB-034). overall_result pending→passed|failed; finalized result is frozen (F10). Checker + finalize time server-stamped. A mandatory QC missing/failed blocks closure (B5).';
-- Non-partial FK-covering index for the work-order FK, plus a partial query index.
CREATE INDEX ix_quality_control_records_wo
  ON qms.quality_control_records (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_quality_control_records_wo_result
  ON qms.quality_control_records (tenant_id, company_id, branch_id, work_order_id, overall_result) WHERE deleted_at IS NULL;

-- Finalize guard: stamp checker+time on pending→passed/failed; freeze once finalized.
CREATE OR REPLACE FUNCTION qms.guard_qc_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.overall_result IN ('passed', 'failed') THEN
    IF NEW.overall_result IS DISTINCT FROM OLD.overall_result
       OR NEW.checker_id IS DISTINCT FROM OLD.checker_id
       OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
      RAISE EXCEPTION 'quality-control record % is finalized; result/checker/time are immutable', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.overall_result IN ('passed', 'failed') AND OLD.overall_result = 'pending' THEN
    NEW.checker_id := iam.current_user_id();
    IF NEW.checker_id IS NULL THEN
      RAISE EXCEPTION 'finalizing QC requires an actor context' USING ERRCODE = 'check_violation';
    END IF;
    NEW.finalized_at := now();
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION qms.guard_qc_finalize() IS
  'BEFORE UPDATE on qms.quality_control_records: server-stamps checker_id+finalized_at on finalization and freezes result/checker/time thereafter (F10).';
REVOKE EXECUTE ON FUNCTION qms.guard_qc_finalize() FROM PUBLIC;

CREATE TRIGGER tg_quality_control_records_finalize BEFORE UPDATE ON qms.quality_control_records
  FOR EACH ROW EXECUTE FUNCTION qms.guard_qc_finalize();
CREATE TRIGGER tg_quality_control_records_touch_metadata BEFORE UPDATE ON qms.quality_control_records
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_quality_control_records_immutable BEFORE UPDATE ON qms.quality_control_records
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'created_at', 'created_by');
ALTER TABLE qms.quality_control_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE qms.quality_control_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_quality_control_records_scope ON qms.quality_control_records FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_quality_control_records_scope ON qms.quality_control_records FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_quality_control_records_scope ON qms.quality_control_records FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON qms.quality_control_records TO app_runtime;
GRANT SELECT ON qms.quality_control_records TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. qms.qc_check_results — per configured check outcome.
-- ----------------------------------------------------------------------------
CREATE TABLE qms.qc_check_results (
  id                       uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                uuid    NOT NULL,
  company_id               uuid    NOT NULL,
  branch_id                uuid    NOT NULL,
  quality_control_record_id uuid   NOT NULL,
  qc_check_id              uuid    NOT NULL,
  result                   text    NOT NULL,
  note                     text    NULL,
  record_version           integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid    NOT NULL,
  updated_at               timestamptz NULL,
  updated_by               uuid    NULL,
  deleted_at               timestamptz NULL,
  deleted_by               uuid    NULL,

  CONSTRAINT pk_qc_check_results PRIMARY KEY (id),
  CONSTRAINT uq_qc_check_results_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_qc_check_results_record
    FOREIGN KEY (tenant_id, company_id, branch_id, quality_control_record_id)
    REFERENCES qms.quality_control_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_qc_check_results_check FOREIGN KEY (qc_check_id) REFERENCES qms.qc_checks (id) ON DELETE RESTRICT,
  CONSTRAINT ck_qc_check_results_result CHECK (result IN ('pass', 'fail', 'na')),
  CONSTRAINT ck_qc_check_results_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);
COMMENT ON TABLE qms.qc_check_results IS
  'Phase 1-9 per-check QC result (P1-09-DB-035). One result per configured check per record.';
CREATE UNIQUE INDEX uq_qc_check_results_record_check
  ON qms.qc_check_results (tenant_id, company_id, branch_id, quality_control_record_id, qc_check_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_qc_check_results_record ON qms.qc_check_results (tenant_id, company_id, branch_id, quality_control_record_id);
CREATE INDEX ix_qc_check_results_check ON qms.qc_check_results (qc_check_id);
CREATE TRIGGER tg_qc_check_results_touch_metadata BEFORE UPDATE ON qms.qc_check_results
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_qc_check_results_immutable BEFORE UPDATE ON qms.qc_check_results
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'quality_control_record_id', 'qc_check_id', 'created_at', 'created_by');
ALTER TABLE qms.qc_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE qms.qc_check_results FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_qc_check_results_scope ON qms.qc_check_results FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_qc_check_results_scope ON qms.qc_check_results FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_qc_check_results_scope ON qms.qc_check_results FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON qms.qc_check_results TO app_runtime;
GRANT SELECT ON qms.qc_check_results TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. qms.qc_status_history — append-only QC result ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE qms.qc_status_history (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL,
  company_id               uuid        NOT NULL,
  branch_id                uuid        NOT NULL,
  quality_control_record_id uuid       NOT NULL,
  from_state               text        NULL,
  to_state                 text        NOT NULL,
  reason                   text        NULL,
  correlation_id           uuid        NULL,
  actor_id                 uuid        NOT NULL,
  occurred_at              timestamptz NOT NULL DEFAULT now(),
  seq                      bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_qc_status_history PRIMARY KEY (id),
  CONSTRAINT fk_qc_status_history_record
    FOREIGN KEY (tenant_id, company_id, branch_id, quality_control_record_id)
    REFERENCES qms.quality_control_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_qc_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_qc_status_history_states CHECK (
    to_state IN ('pending', 'passed', 'failed')
    AND (from_state IS NULL OR from_state IN ('pending', 'passed', 'failed'))),
  CONSTRAINT ck_qc_status_history_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);
COMMENT ON TABLE qms.qc_status_history IS
  'Phase 1-9 append-only QC status ledger (P1-09-DB-036). Trigger-emitted; coherence-guarded; server-stamped. SELECT+INSERT only.';
CREATE INDEX ix_qc_status_history_record
  ON qms.qc_status_history (tenant_id, company_id, branch_id, quality_control_record_id, occurred_at DESC, seq DESC);

CREATE OR REPLACE FUNCTION qms.guard_qc_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT overall_result INTO v_current FROM qms.quality_control_records
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = NEW.quality_control_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QC record % not found in this scope', NEW.quality_control_record_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'QC status history to_state % does not match the record current result %', NEW.to_state, v_current
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION qms.guard_qc_status_coherence() IS
  'BEFORE INSERT on qms.qc_status_history: rejects a row whose to_state does not equal the QC record current result.';
REVOKE EXECUTE ON FUNCTION qms.guard_qc_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_qc_status_history_coherence BEFORE INSERT ON qms.qc_status_history
  FOR EACH ROW EXECUTE FUNCTION qms.guard_qc_status_coherence();
CREATE TRIGGER tg_qc_status_history_stamp BEFORE INSERT ON qms.qc_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE qms.qc_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE qms.qc_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_qc_status_history_scope ON qms.qc_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_qc_status_history_scope ON qms.qc_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON qms.qc_status_history TO app_runtime;
GRANT SELECT ON qms.qc_status_history TO app_readonly;

CREATE OR REPLACE FUNCTION qms.emit_qc_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  v_reason      text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.overall_result IS DISTINCT FROM OLD.overall_result THEN
    INSERT INTO qms.qc_status_history
      (tenant_id, company_id, branch_id, quality_control_record_id, from_state, to_state, reason, correlation_id)
    VALUES (NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.id, OLD.overall_result, NEW.overall_result, v_reason, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION qms.emit_qc_status_history() IS
  'AFTER UPDATE trigger on qms.quality_control_records: writes one append-only status-history row when overall_result changes.';
REVOKE EXECUTE ON FUNCTION qms.emit_qc_status_history() FROM PUBLIC;

CREATE TRIGGER tg_quality_control_records_status_history AFTER UPDATE ON qms.quality_control_records
  FOR EACH ROW EXECUTE FUNCTION qms.emit_qc_status_history();
