-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: work jobs/tasks + append-only job status history
-- Tasks: P1-09-DB-007 (jobs), P1-09-DB-008 (job status history)
-- Owner module: wo
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   jobs exist. Forward-only.
--
-- Purpose
--   wo.jobs are the units of work under a work order. A job may be created only
--   while the parent work order is in a state that allows jobs, and never on a
--   terminal work order — enforced by locking the parent row (FOR UPDATE) so a
--   job insert serializes against a concurrent work-order close (design F2). The
--   job lifecycle is the configurable job graph (wo.job_states/job_transitions);
--   terminal job states are frozen. requires_diagnostic marks jobs whose closure
--   depends on a completed diagnostic report (design F8, closure blocker B4). The
--   assignment precondition is added in the next migration (once job_assignments
--   exists). Every real state change emits an append-only history row.
--
-- Dependencies
--   wo.work_orders / work_order_states / job_states / job_transitions;
--   shared.stamp_status_history / touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    wo.jobs, wo.job_status_history
--   Functions: wo.guard_job_refs(), wo.guard_job_transition(),
--              wo.guard_job_status_coherence(), wo.emit_job_status_history()
-- ============================================================================

CREATE TABLE wo.jobs (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  company_id         uuid    NOT NULL,
  branch_id          uuid    NOT NULL,
  work_order_id      uuid    NOT NULL,
  title              text    NOT NULL,
  job_type           text    NULL,
  state              text    NOT NULL DEFAULT 'planned',
  requires_diagnostic boolean NOT NULL DEFAULT false,
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_jobs PRIMARY KEY (id),
  CONSTRAINT uq_jobs_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_jobs_work_order
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_jobs_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_jobs_job_type_not_blank CHECK (job_type IS NULL OR btrim(job_type) <> ''),
  CONSTRAINT ck_jobs_state_format CHECK (state ~ '^[a-z][a-z0-9_]{1,62}$')
);
COMMENT ON TABLE wo.jobs IS
  'Phase 1-9 work job/task (P1-09-DB-007) under a work order. Created only while the parent WO allows jobs and is not terminal (parent-row-locked, F2). requires_diagnostic drives closure blocker B4.';

CREATE INDEX ix_jobs_work_order
  ON wo.jobs (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_jobs_by_state
  ON wo.jobs (tenant_id, company_id, branch_id, work_order_id, state) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Job reference guard (BEFORE INSERT): lock the parent WO, reject if terminal or
-- if the WO state does not allow jobs; the initial job state must be non-terminal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wo.guard_job_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wo_state   text;
  v_allows     boolean;
  v_wo_terminal boolean;
  v_job_terminal boolean;
BEGIN
  -- Lock the parent work order so this insert serializes against a concurrent close (F2).
  SELECT state INTO v_wo_state FROM wo.work_orders
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = NEW.work_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order % is not visible in this scope', NEW.work_order_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT is_terminal, allows_jobs INTO v_wo_terminal, v_allows FROM wo.work_order_states
  WHERE code = v_wo_state AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_wo_terminal THEN
    RAISE EXCEPTION 'cannot add a job to a terminal work order (state %)', v_wo_state
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_allows IS NOT TRUE THEN
    RAISE EXCEPTION 'work order state % does not allow jobs', v_wo_state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT is_terminal INTO v_job_terminal FROM wo.job_states
  WHERE code = NEW.state AND (scope = 'platform' OR tenant_id = NEW.tenant_id)
    AND status = 'active' AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_job_terminal IS NULL THEN
    RAISE EXCEPTION 'job initial state % is not a defined active state', NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_job_terminal THEN
    RAISE EXCEPTION 'job cannot be created in terminal state %', NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_job_refs() IS
  'BEFORE INSERT on wo.jobs: locks the parent work order (F2), rejects if the WO is terminal or does not allow jobs, and requires a non-terminal initial job state.';
REVOKE EXECUTE ON FUNCTION wo.guard_job_refs() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Job transition guard (BEFORE UPDATE OF state): terminal-freeze + graph + reason.
-- The assignment precondition is added by the next migration (REPLACE).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wo.guard_job_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_old_terminal boolean;
  v_target_active boolean;
  v_target_reason boolean;
  v_edge_reason   boolean;
  v_reason        text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  SELECT is_terminal INTO v_old_terminal FROM wo.job_states
  WHERE code = OLD.state AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_old_terminal THEN
    RAISE EXCEPTION 'job state % is terminal; no transition is permitted', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT (status = 'active'), reason_required INTO v_target_active, v_target_reason FROM wo.job_states
  WHERE code = NEW.state AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_target_active IS NULL THEN
    RAISE EXCEPTION 'job target state % is not a defined state', NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_target_active THEN
    RAISE EXCEPTION 'job target state % is inactive', NEW.state USING ERRCODE = 'check_violation';
  END IF;

  SELECT requires_reason INTO v_edge_reason FROM wo.job_transitions
  WHERE from_state = OLD.state AND to_state = NEW.state AND is_active
    AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_edge_reason IS NULL THEN
    RAISE EXCEPTION 'no active job transition % -> % in the approved graph', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF (v_edge_reason OR v_target_reason) AND v_reason IS NULL THEN
    RAISE EXCEPTION 'job transition % -> % requires a reason (set app.status_reason)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_job_transition() IS
  'BEFORE UPDATE OF state on wo.jobs: terminal-freeze, configurable-graph edge validity, reason enforcement. The assignment precondition is added once job_assignments exists.';
REVOKE EXECUTE ON FUNCTION wo.guard_job_transition() FROM PUBLIC;

CREATE TRIGGER tg_jobs_refs BEFORE INSERT ON wo.jobs
  FOR EACH ROW EXECUTE FUNCTION wo.guard_job_refs();
CREATE TRIGGER tg_jobs_transition BEFORE UPDATE OF state ON wo.jobs
  FOR EACH ROW EXECUTE FUNCTION wo.guard_job_transition();
CREATE TRIGGER tg_jobs_immutable BEFORE UPDATE ON wo.jobs
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'created_at', 'created_by');
CREATE TRIGGER tg_jobs_touch_metadata BEFORE UPDATE ON wo.jobs
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE wo.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.jobs FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_jobs_scope ON wo.jobs FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_jobs_scope ON wo.jobs FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_jobs_scope ON wo.jobs FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.jobs TO app_runtime;
GRANT SELECT ON wo.jobs TO app_readonly;

-- ----------------------------------------------------------------------------
-- Append-only job status history + coherence + stamp + emitter.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.job_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  job_id         uuid        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NULL,
  correlation_id uuid        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_job_status_history PRIMARY KEY (id),
  CONSTRAINT fk_job_status_history_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_job_status_history_to_format CHECK (to_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_job_status_history_from_format CHECK (from_state IS NULL OR from_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_job_status_history_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);
COMMENT ON TABLE wo.job_status_history IS
  'Phase 1-9 append-only job status ledger (P1-09-DB-008). Trigger-emitted from wo.jobs; coherence-guarded; server-stamped. SELECT+INSERT only.';
CREATE INDEX ix_job_status_history_job
  ON wo.job_status_history (tenant_id, company_id, branch_id, job_id, occurred_at DESC, seq DESC);

CREATE OR REPLACE FUNCTION wo.guard_job_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT state INTO v_current FROM wo.jobs
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = NEW.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % not found in this scope', NEW.job_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the job current state %',
      NEW.to_state, v_current USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_job_status_coherence() IS
  'BEFORE INSERT on wo.job_status_history: rejects a row whose to_state does not equal the job current state.';
REVOKE EXECUTE ON FUNCTION wo.guard_job_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_job_status_history_coherence BEFORE INSERT ON wo.job_status_history
  FOR EACH ROW EXECUTE FUNCTION wo.guard_job_status_coherence();
CREATE TRIGGER tg_job_status_history_stamp BEFORE INSERT ON wo.job_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE wo.job_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_job_status_history_scope ON wo.job_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_job_status_history_scope ON wo.job_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON wo.job_status_history TO app_runtime;
GRANT SELECT ON wo.job_status_history TO app_readonly;

CREATE OR REPLACE FUNCTION wo.emit_job_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  v_reason      text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO wo.job_status_history
      (tenant_id, company_id, branch_id, job_id, from_state, to_state, reason, correlation_id)
    VALUES (NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.id, OLD.state, NEW.state, v_reason, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION wo.emit_job_status_history() IS
  'AFTER UPDATE trigger on wo.jobs: writes one append-only status-history row when state actually changes.';
REVOKE EXECUTE ON FUNCTION wo.emit_job_status_history() FROM PUBLIC;

CREATE TRIGGER tg_jobs_status_history AFTER UPDATE ON wo.jobs
  FOR EACH ROW EXECUTE FUNCTION wo.emit_job_status_history();
