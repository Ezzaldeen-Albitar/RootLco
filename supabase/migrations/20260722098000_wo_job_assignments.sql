-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: job assignments (temporal) + assignment precondition on job transitions
-- Tasks: P1-09-DB-009 (job assignments)
-- Owner module: wo
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only.
--
-- Purpose
--   wo.job_assignments records which technician is assigned to a job, temporally
--   (valid_from/valid_to). Reassignment ends the current assignment (sets valid_to,
--   which REQUIRES a reason) and opens a new one — the row set is the assignment
--   history. One active PRIMARY assignment per job at a time. Once assignments
--   exist, the job transition guard is REPLACED to require an active assignment
--   before a job may enter an assignment-required state.
--
-- Dependencies
--   wo.jobs; tech.technician_profiles; wo.job_states/job_transitions;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    wo.job_assignments
--   Functions: REPLACE wo.guard_job_transition()
-- ============================================================================

CREATE TABLE wo.job_assignments (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  company_id            uuid    NOT NULL,
  branch_id             uuid    NOT NULL,
  job_id                uuid    NOT NULL,
  technician_profile_id uuid    NOT NULL,
  assignment_role       text    NOT NULL DEFAULT 'primary',
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_to              timestamptz NULL,
  reason                text    NULL,
  record_version        integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid    NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid    NULL,

  CONSTRAINT pk_job_assignments PRIMARY KEY (id),
  CONSTRAINT uq_job_assignments_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_job_assignments_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_job_assignments_technician
    FOREIGN KEY (tenant_id, company_id, branch_id, technician_profile_id)
    REFERENCES tech.technician_profiles (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_assignments_role CHECK (assignment_role IN ('primary', 'assist')),
  CONSTRAINT ck_job_assignments_window CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- Ending an assignment requires a reason (reassignment/removal is accountable).
  CONSTRAINT ck_job_assignments_end_reason CHECK (valid_to IS NULL OR (reason IS NOT NULL AND btrim(reason) <> ''))
);
COMMENT ON TABLE wo.job_assignments IS
  'Phase 1-9 temporal job assignment (P1-09-DB-009). valid_from/valid_to; ending an assignment requires a reason. One active PRIMARY assignment per job. The row set is the assignment history.';

-- One active PRIMARY assignment per job.
CREATE UNIQUE INDEX uq_job_assignments_active_primary
  ON wo.job_assignments (tenant_id, company_id, branch_id, job_id)
  WHERE assignment_role = 'primary' AND valid_to IS NULL AND deleted_at IS NULL;
-- Non-partial FK-covering indexes.
CREATE INDEX ix_job_assignments_job
  ON wo.job_assignments (tenant_id, company_id, branch_id, job_id);
CREATE INDEX ix_job_assignments_technician
  ON wo.job_assignments (tenant_id, company_id, branch_id, technician_profile_id);
-- Assignment queue by technician (active assignments).
CREATE INDEX ix_job_assignments_active_by_tech
  ON wo.job_assignments (tenant_id, technician_profile_id) WHERE valid_to IS NULL AND deleted_at IS NULL;

CREATE TRIGGER tg_job_assignments_touch_metadata BEFORE UPDATE ON wo.job_assignments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_job_assignments_immutable BEFORE UPDATE ON wo.job_assignments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'job_id', 'technician_profile_id',
    'assignment_role', 'valid_from', 'created_at', 'created_by');
ALTER TABLE wo.job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_assignments FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_job_assignments_scope ON wo.job_assignments FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_job_assignments_scope ON wo.job_assignments FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_job_assignments_scope ON wo.job_assignments FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.job_assignments TO app_runtime;
GRANT SELECT ON wo.job_assignments TO app_readonly;

-- ----------------------------------------------------------------------------
-- REPLACE the job transition guard to add the assignment precondition: a job may
-- enter an assignment-required state only with an active assignment.
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
  v_target_assign boolean;
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

  SELECT (status = 'active'), reason_required, assignment_required
    INTO v_target_active, v_target_reason, v_target_assign FROM wo.job_states
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

  IF v_target_assign THEN
    IF NOT EXISTS (
      SELECT 1 FROM wo.job_assignments a
      WHERE a.tenant_id = NEW.tenant_id AND a.company_id = NEW.company_id
        AND a.branch_id = NEW.branch_id AND a.job_id = NEW.id
        AND a.valid_to IS NULL AND a.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'job % cannot enter state % without an active assignment', NEW.id, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
