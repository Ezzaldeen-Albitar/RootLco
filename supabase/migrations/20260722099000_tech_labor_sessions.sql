-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: technician labor sessions (time logs) + correction primitive
-- Tasks: P1-09-DB-018 (labor sessions), P1-09-DB-019 (labor corrections)
-- Owner module: tech
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   labor is recorded (it is evidence). Forward-only.
--
-- Purpose
--   tech.labor_sessions record a technician's time on a job. Invariants:
--     * At most one ACTIVE (open-ended) session per technician, and no overlapping
--       sessions — enforced race-safe by a gist EXCLUDE (design §8, F12).
--     * ended_at > started_at; ended_at is set once and then frozen.
--     * No labor on a terminal work order (parent WO row is locked on insert, F2).
--     * Labor only on a job whose state allows labor.
--     * Backdating beyond the approved window (job creation − 1 day) is rejected.
--     * Corrections never rewrite the original: tech.correct_labor_session soft-
--       deletes the original (removing it from the partial EXCLUDE) and inserts a
--       linked correction, atomically (design F9).
--
-- Dependencies
--   wo.jobs / work_orders / work_order_states / job_states; btree_gist (0001);
--   iam.current_tenant_id/current_user_id/allowed_*; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Objects created
--   Tables:    tech.labor_sessions
--   Functions: tech.guard_labor_session(), tech.correct_labor_session(...)
-- ============================================================================

CREATE TABLE tech.labor_sessions (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  company_id            uuid    NOT NULL,
  branch_id             uuid    NOT NULL,
  technician_profile_id uuid    NOT NULL,
  job_id                uuid    NOT NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz NULL,
  source                text    NOT NULL DEFAULT 'manual',
  correction_of_id      uuid    NULL,
  record_version        integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid    NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid    NULL,

  CONSTRAINT pk_labor_sessions PRIMARY KEY (id),
  CONSTRAINT uq_labor_sessions_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_labor_sessions_technician
    FOREIGN KEY (tenant_id, company_id, branch_id, technician_profile_id)
    REFERENCES tech.technician_profiles (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_labor_sessions_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_labor_sessions_correction_of
    FOREIGN KEY (tenant_id, company_id, branch_id, correction_of_id)
    REFERENCES tech.labor_sessions (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_labor_sessions_source CHECK (source IN ('manual', 'timer', 'correction')),
  CONSTRAINT ck_labor_sessions_window CHECK (ended_at IS NULL OR ended_at > started_at),
  -- No overlapping / no second active session per technician (∞ ranges always overlap).
  CONSTRAINT ex_labor_sessions_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    technician_profile_id WITH =,
    tstzrange(started_at, COALESCE(ended_at, 'infinity')) WITH &&
  ) WHERE (deleted_at IS NULL)
);
COMMENT ON TABLE tech.labor_sessions IS
  'Phase 1-9 technician labor session (P1-09-DB-018). Non-overlapping and ≤1 active per technician (gist EXCLUDE, 23P01). Corrections via tech.correct_labor_session (soft-delete original + linked insert). Content-immutable; ended_at set once.';

-- Active session lookup (non-unique; the EXCLUDE enforces the ≤1-active invariant, F12).
CREATE INDEX ix_labor_sessions_active_by_tech
  ON tech.labor_sessions (tenant_id, technician_profile_id) WHERE ended_at IS NULL AND deleted_at IS NULL;
-- Non-partial FK-covering indexes (the gist EXCLUDE is partial and does not cover them).
CREATE INDEX ix_labor_sessions_technician
  ON tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id);
CREATE INDEX ix_labor_sessions_job
  ON tech.labor_sessions (tenant_id, company_id, branch_id, job_id);
CREATE INDEX ix_labor_sessions_correction_of
  ON tech.labor_sessions (tenant_id, company_id, branch_id, correction_of_id);
CREATE INDEX ix_labor_sessions_by_branch_date
  ON tech.labor_sessions (tenant_id, company_id, branch_id, started_at DESC);

-- ----------------------------------------------------------------------------
-- Labor guard: parent-WO lock (F2), job labor-eligibility, backdating window,
-- and ended_at write-once. BEFORE INSERT OR UPDATE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tech.guard_labor_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_state text;
  v_job_created timestamptz;
  v_labor_allowed boolean;
  v_wo_id uuid;
  v_wo_state text;
  v_wo_terminal boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- ended_at is write-once: once set it may not change (corrections are new rows).
    IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      RAISE EXCEPTION 'labor session ended_at is immutable once set (use a correction)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: resolve the job + its parent work order, locking the WO row (F2).
  SELECT j.state, j.created_at, j.work_order_id INTO v_job_state, v_job_created, v_wo_id
  FROM wo.jobs j
  WHERE j.tenant_id = NEW.tenant_id AND j.company_id = NEW.company_id
    AND j.branch_id = NEW.branch_id AND j.id = NEW.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % is not visible in this scope', NEW.job_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT state INTO v_wo_state FROM wo.work_orders
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = v_wo_id
  FOR UPDATE;
  SELECT is_terminal INTO v_wo_terminal FROM wo.work_order_states
  WHERE code = v_wo_state AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_wo_terminal THEN
    RAISE EXCEPTION 'cannot log labor on a terminal work order (state %)', v_wo_state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT labor_allowed INTO v_labor_allowed FROM wo.job_states
  WHERE code = v_job_state AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_labor_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'job state % does not allow labor', v_job_state USING ERRCODE = 'check_violation';
  END IF;

  -- Backdating window: labor may not start before the job existed (minus a 1-day tolerance).
  IF NEW.started_at < v_job_created - interval '1 day' THEN
    RAISE EXCEPTION 'labor start % is backdated beyond the approved window for job % (created %)',
      NEW.started_at, NEW.job_id, v_job_created USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION tech.guard_labor_session() IS
  'BEFORE INSERT/UPDATE on tech.labor_sessions: locks the parent WO (F2, no labor on terminal WO), enforces job labor-eligibility, the backdating window, and ended_at write-once.';
REVOKE EXECUTE ON FUNCTION tech.guard_labor_session() FROM PUBLIC;

CREATE TRIGGER tg_labor_sessions_guard BEFORE INSERT OR UPDATE ON tech.labor_sessions
  FOR EACH ROW EXECUTE FUNCTION tech.guard_labor_session();
CREATE TRIGGER tg_labor_sessions_immutable BEFORE UPDATE ON tech.labor_sessions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'technician_profile_id', 'job_id',
    'started_at', 'source', 'correction_of_id', 'created_at', 'created_by');
CREATE TRIGGER tg_labor_sessions_touch_metadata BEFORE UPDATE ON tech.labor_sessions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE tech.labor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.labor_sessions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_labor_sessions_scope ON tech.labor_sessions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_labor_sessions_scope ON tech.labor_sessions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_labor_sessions_scope ON tech.labor_sessions FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.labor_sessions TO app_runtime;
GRANT SELECT ON tech.labor_sessions TO app_readonly;

-- ----------------------------------------------------------------------------
-- tech.correct_labor_session — atomic correction: soft-delete the original and
-- insert a linked correction with the amended window (design F9). SECURITY INVOKER.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tech.correct_labor_session(
  p_original      uuid,
  p_new_started_at timestamptz,
  p_new_ended_at   timestamptz,
  p_reason         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := iam.current_user_id();
  v_orig  tech.labor_sessions%ROWTYPE;
  v_new   uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'labor correction requires an actor context' USING ERRCODE = 'raise_exception';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'labor correction requires a reason' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_orig FROM tech.labor_sessions
  WHERE id = p_original AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'labor session % not found or already corrected', p_original
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Soft-delete the original first, freeing the partial EXCLUDE range.
  UPDATE tech.labor_sessions
  SET deleted_at = now(), deleted_by = v_actor
  WHERE id = p_original;

  INSERT INTO tech.labor_sessions
    (tenant_id, company_id, branch_id, technician_profile_id, job_id,
     started_at, ended_at, source, correction_of_id, created_by)
  VALUES
    (v_orig.tenant_id, v_orig.company_id, v_orig.branch_id, v_orig.technician_profile_id, v_orig.job_id,
     p_new_started_at, p_new_ended_at, 'correction', p_original, v_actor)
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;
COMMENT ON FUNCTION tech.correct_labor_session(uuid, timestamptz, timestamptz, text) IS
  'Atomic labor correction (P1-09-DB-019): soft-deletes the original session and inserts a linked correction (correction_of_id) with the amended window, in one transaction. The original is content-immutable; only deleted_at is set. SECURITY INVOKER.';
REVOKE EXECUTE ON FUNCTION tech.correct_labor_session(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tech.correct_labor_session(uuid, timestamptz, timestamptz, text) TO app_runtime;
