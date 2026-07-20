-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: reopen prohibition, rework links (+ restricted cost), closure gate
-- Tasks: P1-09-DB-037 (reopen attempts), DB-038 (rework links),
--        DB-039 (restricted rework cost), DB-050 (work-order closure gate)
-- Owner module: qms, wo
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   attempts/rework exist (evidence). Forward-only.
--
-- Purpose
--   BR-WO-002: a closed work order NEVER reopens. Two paths enforce this:
--     * qms.attempt_reopen() records a rejected attempt and NEVER mutates the WO
--       (an autonomous-transaction-free way to keep the audit log; design F5).
--     * the terminal-freeze in the WO transition guard hard-blocks any direct
--       state change out of a terminal state (the backstop; already in place).
--   Corrective work uses a linked REWORK work order (qms.rework_links). BR-QMS-001:
--   safety-critical rework requires independent sign-off, and the correcting
--   (lead) technician may not sign off their own rework (design F4). rework_cost is
--   a restricted cost-of-quality metric in a 1:1 gated table.
--
--   The WORK-ORDER CLOSURE GATE (wo.guard_work_order_closure) fires on the
--   transition INTO a terminal state. A cancellation bypasses the completeness
--   blockers (records history only); a non-cancellation close runs B1..B6, each an
--   independent blocker (23514). Concurrency: child inserts lock the parent WO
--   (F2), so a close serializes against them.
--
-- Dependencies
--   wo.work_orders / jobs / work_order_states / job_states / additional_work_requests;
--   tech.labor_sessions / technician_profiles; dia.diagnostic_reports;
--   qms.qc_checks / quality_control_records; iam.*; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Objects created
--   Tables:    qms.reopen_attempts, qms.rework_links, qms.rework_link_details
--   Functions: qms.stamp_reopen_attempt(), qms.attempt_reopen(...),
--              qms.guard_rework_link_coherence(), qms.guard_rework_signoff(),
--              wo.guard_work_order_closure()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. qms.reopen_attempts — append-only ledger of rejected reopen attempts.
-- ----------------------------------------------------------------------------
CREATE TABLE qms.reopen_attempts (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  company_id    uuid        NOT NULL,
  branch_id     uuid        NOT NULL,
  work_order_id uuid        NOT NULL,
  reason        text        NOT NULL,
  outcome       text        NOT NULL DEFAULT 'rejected',
  requested_by  uuid        NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_reopen_attempts PRIMARY KEY (id),
  CONSTRAINT fk_reopen_attempts_wo
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_reopen_attempts_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_reopen_attempts_outcome CHECK (outcome = 'rejected')
);
COMMENT ON TABLE qms.reopen_attempts IS
  'Phase 1-9 append-only reopen-attempt ledger (P1-09-DB-037). Every attempt to reopen a closed work order is recorded as rejected (BR-WO-002). Written only by qms.attempt_reopen(), which never mutates the work order. SELECT+INSERT only.';
CREATE INDEX ix_reopen_attempts_wo ON qms.reopen_attempts (tenant_id, company_id, branch_id, work_order_id, requested_at DESC);

CREATE OR REPLACE FUNCTION qms.stamp_reopen_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.requested_by := iam.current_user_id();
  IF NEW.requested_by IS NULL THEN
    RAISE EXCEPTION 'reopen attempt requires an actor context' USING ERRCODE = 'check_violation';
  END IF;
  NEW.requested_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION qms.stamp_reopen_attempt() IS
  'BEFORE INSERT on qms.reopen_attempts: server-stamps requested_by + requested_at.';
REVOKE EXECUTE ON FUNCTION qms.stamp_reopen_attempt() FROM PUBLIC;

CREATE TRIGGER tg_reopen_attempts_stamp BEFORE INSERT ON qms.reopen_attempts
  FOR EACH ROW EXECUTE FUNCTION qms.stamp_reopen_attempt();
ALTER TABLE qms.reopen_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qms.reopen_attempts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_reopen_attempts_scope ON qms.reopen_attempts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_reopen_attempts_scope ON qms.reopen_attempts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON qms.reopen_attempts TO app_runtime;
GRANT SELECT ON qms.reopen_attempts TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. qms.rework_links — a rework work order corrects a closed original.
-- ----------------------------------------------------------------------------
CREATE TABLE qms.rework_links (
  id                     uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              uuid    NOT NULL,
  company_id             uuid    NOT NULL,
  branch_id              uuid    NOT NULL,
  original_work_order_id uuid    NOT NULL,
  rework_work_order_id   uuid    NOT NULL,
  root_cause             text    NOT NULL,
  corrective_action      text    NOT NULL,
  responsibility         text    NULL,
  lead_technician_id     uuid    NULL,
  is_safety_critical     boolean NOT NULL DEFAULT false,
  independent_sign_off_by uuid   NULL,
  sign_off_at            timestamptz NULL,
  record_version         integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid    NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid    NULL,
  deleted_at             timestamptz NULL,
  deleted_by             uuid    NULL,

  CONSTRAINT pk_rework_links PRIMARY KEY (id),
  CONSTRAINT uq_rework_links_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_rework_links_original
    FOREIGN KEY (tenant_id, company_id, branch_id, original_work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rework_links_rework
    FOREIGN KEY (tenant_id, company_id, branch_id, rework_work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rework_links_lead_tech
    FOREIGN KEY (tenant_id, company_id, branch_id, lead_technician_id)
    REFERENCES tech.technician_profiles (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rework_links_signoff_tech
    FOREIGN KEY (tenant_id, company_id, branch_id, independent_sign_off_by)
    REFERENCES tech.technician_profiles (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_rework_links_distinct_wo CHECK (original_work_order_id <> rework_work_order_id),
  CONSTRAINT ck_rework_links_root_cause_not_blank CHECK (btrim(root_cause) <> ''),
  CONSTRAINT ck_rework_links_corrective_not_blank CHECK (btrim(corrective_action) <> ''),
  CONSTRAINT ck_rework_links_responsibility_not_blank CHECK (responsibility IS NULL OR btrim(responsibility) <> ''),
  -- BR-QMS-001: safety-critical rework needs a known lead technician.
  CONSTRAINT ck_rework_links_safety_lead CHECK (NOT is_safety_critical OR lead_technician_id IS NOT NULL),
  -- BR-QMS-001: the correcting technician may not be the independent approver.
  CONSTRAINT ck_rework_links_signoff_distinct CHECK (
    independent_sign_off_by IS NULL OR independent_sign_off_by IS DISTINCT FROM lead_technician_id),
  CONSTRAINT ck_rework_links_signoff_time CHECK (
    (independent_sign_off_by IS NULL AND sign_off_at IS NULL)
    OR (independent_sign_off_by IS NOT NULL AND sign_off_at IS NOT NULL))
);
COMMENT ON TABLE qms.rework_links IS
  'Phase 1-9 rework link (P1-09-DB-038). Links a rework work order to a closed original with root cause / corrective action / responsibility. BR-QMS-001: safety-critical rework requires an independent sign-off by someone other than the lead technician; unsigned safety rework blocks the rework WO closing (B6).';
CREATE UNIQUE INDEX uq_rework_links_rework_wo
  ON qms.rework_links (tenant_id, company_id, branch_id, rework_work_order_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_rework_links_original ON qms.rework_links (tenant_id, company_id, branch_id, original_work_order_id);
CREATE INDEX ix_rework_links_rework ON qms.rework_links (tenant_id, company_id, branch_id, rework_work_order_id);
CREATE INDEX ix_rework_links_lead_tech ON qms.rework_links (tenant_id, company_id, branch_id, lead_technician_id);
CREATE INDEX ix_rework_links_signoff_tech ON qms.rework_links (tenant_id, company_id, branch_id, independent_sign_off_by);

-- Coherence: original must be closed, rework must be kind='rework', same reception visit.
CREATE OR REPLACE FUNCTION qms.guard_rework_link_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_orig_state text; v_orig_visit uuid; v_orig_closed boolean;
  v_rw_kind text; v_rw_visit uuid;
BEGIN
  SELECT w.state, w.reception_visit_id INTO v_orig_state, v_orig_visit FROM wo.work_orders w
  WHERE w.tenant_id = NEW.tenant_id AND w.company_id = NEW.company_id
    AND w.branch_id = NEW.branch_id AND w.id = NEW.original_work_order_id;
  SELECT is_closed INTO v_orig_closed FROM wo.work_order_states
  WHERE code = v_orig_state AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_orig_closed IS NOT TRUE THEN
    RAISE EXCEPTION 'rework original work order % must be closed (state %)', NEW.original_work_order_id, v_orig_state
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT w.kind, w.reception_visit_id INTO v_rw_kind, v_rw_visit FROM wo.work_orders w
  WHERE w.tenant_id = NEW.tenant_id AND w.company_id = NEW.company_id
    AND w.branch_id = NEW.branch_id AND w.id = NEW.rework_work_order_id;
  IF v_rw_kind IS DISTINCT FROM 'rework' THEN
    RAISE EXCEPTION 'rework work order % must have kind=rework (is %)', NEW.rework_work_order_id, v_rw_kind
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_rw_visit IS DISTINCT FROM v_orig_visit THEN
    RAISE EXCEPTION 'rework work order must share the original reception visit' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION qms.guard_rework_link_coherence() IS
  'BEFORE INSERT/UPDATE on qms.rework_links: the original WO must be closed, the rework WO must be kind=rework, and both must share the original reception visit.';
REVOKE EXECUTE ON FUNCTION qms.guard_rework_link_coherence() FROM PUBLIC;

-- Sign-off guard: write-once; stamps sign_off_at when signed.
CREATE OR REPLACE FUNCTION qms.guard_rework_signoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.independent_sign_off_by IS NOT NULL
     AND NEW.independent_sign_off_by IS DISTINCT FROM OLD.independent_sign_off_by THEN
    RAISE EXCEPTION 'rework sign-off is immutable once recorded' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.independent_sign_off_by IS NOT NULL AND OLD.independent_sign_off_by IS NULL THEN
    NEW.sign_off_at := now();
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION qms.guard_rework_signoff() IS
  'BEFORE UPDATE on qms.rework_links: sign-off is write-once; sign_off_at is stamped when the independent sign-off is recorded.';
REVOKE EXECUTE ON FUNCTION qms.guard_rework_signoff() FROM PUBLIC;

CREATE TRIGGER tg_rework_links_coherence BEFORE INSERT OR UPDATE OF original_work_order_id, rework_work_order_id ON qms.rework_links
  FOR EACH ROW EXECUTE FUNCTION qms.guard_rework_link_coherence();
CREATE TRIGGER tg_rework_links_signoff BEFORE UPDATE ON qms.rework_links
  FOR EACH ROW EXECUTE FUNCTION qms.guard_rework_signoff();
CREATE TRIGGER tg_rework_links_touch_metadata BEFORE UPDATE ON qms.rework_links
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_rework_links_immutable BEFORE UPDATE ON qms.rework_links
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'original_work_order_id', 'rework_work_order_id',
    'lead_technician_id', 'created_at', 'created_by');
ALTER TABLE qms.rework_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE qms.rework_links FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_rework_links_scope ON qms.rework_links FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_rework_links_scope ON qms.rework_links FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_rework_links_scope ON qms.rework_links FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON qms.rework_links TO app_runtime;
GRANT SELECT ON qms.rework_links TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. qms.rework_link_details — RESTRICTED cost-of-quality metric (rework_cost).
-- ----------------------------------------------------------------------------
CREATE TABLE qms.rework_link_details (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  rework_link_id uuid    NOT NULL,
  rework_cost    numeric(14, 4) NOT NULL,
  cost_currency  text    NOT NULL DEFAULT 'JOD',
  classification text    NOT NULL DEFAULT 'restricted',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_rework_link_details PRIMARY KEY (id),
  CONSTRAINT fk_rework_link_details_link
    FOREIGN KEY (tenant_id, company_id, branch_id, rework_link_id)
    REFERENCES qms.rework_links (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_rework_link_details_classification CHECK (classification = 'restricted'),
  CONSTRAINT ck_rework_link_details_cost CHECK (rework_cost >= 0),
  CONSTRAINT ck_rework_link_details_currency CHECK (cost_currency ~ '^[A-Z]{3}$')
);
COMMENT ON TABLE qms.rework_link_details IS
  'Phase 1-9 RESTRICTED rework cost-of-quality (P1-09-DB-039). 1:1 with a rework link; whole table gated by iam.has_permission(''iam.sensitive.view''). An internal quality KPI, NOT a billing/invoice artifact.';
CREATE UNIQUE INDEX uq_rework_link_details_link
  ON qms.rework_link_details (tenant_id, company_id, branch_id, rework_link_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_rework_link_details_link ON qms.rework_link_details (tenant_id, company_id, branch_id, rework_link_id);
CREATE TRIGGER tg_rework_link_details_immutable BEFORE UPDATE ON qms.rework_link_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'rework_link_id', 'classification', 'created_at', 'created_by');
CREATE TRIGGER tg_rework_link_details_touch_metadata BEFORE UPDATE ON qms.rework_link_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
ALTER TABLE qms.rework_link_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE qms.rework_link_details FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_rework_link_details_gated ON qms.rework_link_details FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY ins_rework_link_details_gated ON qms.rework_link_details FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY upd_rework_link_details_gated ON qms.rework_link_details FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
GRANT SELECT, INSERT, UPDATE ON qms.rework_link_details TO app_runtime;
GRANT SELECT ON qms.rework_link_details TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. qms.attempt_reopen — sanctioned reopen path: record rejection, never mutate.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION qms.attempt_reopen(p_work_order uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := iam.current_tenant_id();
  v_wo wo.work_orders%ROWTYPE;
  v_closed boolean;
  v_attempt uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'reopen requires tenant context' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reopen attempt requires a reason' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_wo FROM wo.work_orders WHERE id = p_work_order AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order % not visible', p_work_order USING ERRCODE = 'no_data_found';
  END IF;
  SELECT is_closed INTO v_closed FROM wo.work_order_states
  WHERE code = v_wo.state AND (scope = 'platform' OR tenant_id = v_tenant) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_closed IS NOT TRUE THEN
    RAISE EXCEPTION 'work order % is not closed; nothing to reopen', p_work_order USING ERRCODE = 'check_violation';
  END IF;
  -- Record the rejected attempt (requested_by/requested_at are server-stamped).
  -- The work order is NEVER mutated (BR-WO-002).
  INSERT INTO qms.reopen_attempts (tenant_id, company_id, branch_id, work_order_id, reason, outcome)
  VALUES (v_wo.tenant_id, v_wo.company_id, v_wo.branch_id, v_wo.id, p_reason, 'rejected')
  RETURNING id INTO v_attempt;
  RETURN v_attempt;
END;
$$;
COMMENT ON FUNCTION qms.attempt_reopen(uuid, text) IS
  'Sanctioned reopen path (P1-09-DB-037, design F5): records a rejected reopen attempt for a closed work order and returns its id, WITHOUT ever mutating the work order. Closed work orders never reopen (BR-WO-002).';
REVOKE EXECUTE ON FUNCTION qms.attempt_reopen(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qms.attempt_reopen(uuid, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 5. wo.guard_work_order_closure — the closure gate (B1..B6). BEFORE UPDATE OF state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wo.guard_work_order_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_terminal boolean; v_cancel boolean;
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;
  SELECT is_terminal, is_cancellation INTO v_terminal, v_cancel FROM wo.work_order_states
  WHERE code = NEW.state AND (scope = 'platform' OR tenant_id = NEW.tenant_id) AND deleted_at IS NULL
  ORDER BY (scope = 'tenant') DESC LIMIT 1;
  IF v_terminal IS NOT TRUE THEN
    RETURN NEW;  -- not a close
  END IF;
  IF v_cancel THEN
    RETURN NEW;  -- cancellation bypasses completeness blockers (history still recorded)
  END IF;

  -- B1: no non-terminal job may remain open.
  IF EXISTS (
    SELECT 1 FROM wo.jobs j
    WHERE j.tenant_id = NEW.tenant_id AND j.company_id = NEW.company_id AND j.branch_id = NEW.branch_id
      AND j.work_order_id = NEW.id AND j.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM wo.job_states js
        WHERE js.code = j.state AND (js.scope = 'platform' OR js.tenant_id = NEW.tenant_id)
          AND js.deleted_at IS NULL AND js.is_terminal)
  ) THEN
    RAISE EXCEPTION 'closure blocked (B1): a non-terminal job exists on work order %', NEW.id USING ERRCODE = 'check_violation';
  END IF;

  -- B2: no active (open-ended) labor session may remain.
  IF EXISTS (
    SELECT 1 FROM tech.labor_sessions ls
    JOIN wo.jobs j ON j.tenant_id = ls.tenant_id AND j.company_id = ls.company_id
      AND j.branch_id = ls.branch_id AND j.id = ls.job_id
    WHERE ls.tenant_id = NEW.tenant_id AND j.work_order_id = NEW.id
      AND ls.ended_at IS NULL AND ls.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'closure blocked (B2): an active labor session exists on work order %', NEW.id USING ERRCODE = 'check_violation';
  END IF;

  -- B3: no required additional-work request pending or approved-but-unfulfilled.
  IF EXISTS (
    SELECT 1 FROM wo.additional_work_requests r
    WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id AND r.branch_id = NEW.branch_id
      AND r.work_order_id = NEW.id AND r.is_required AND r.deleted_at IS NULL
      AND (r.state = 'pending' OR (r.state = 'approved' AND r.fulfillment_state = 'unfulfilled'))
  ) THEN
    RAISE EXCEPTION 'closure blocked (B3): a required additional-work request is unresolved on work order %', NEW.id USING ERRCODE = 'check_violation';
  END IF;

  -- B4: every requires_diagnostic job must have a completed diagnostic report.
  IF EXISTS (
    SELECT 1 FROM wo.jobs j
    WHERE j.tenant_id = NEW.tenant_id AND j.company_id = NEW.company_id AND j.branch_id = NEW.branch_id
      AND j.work_order_id = NEW.id AND j.requires_diagnostic AND j.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM dia.diagnostic_reports d
        WHERE d.tenant_id = j.tenant_id AND d.company_id = j.company_id AND d.branch_id = j.branch_id
          AND d.job_id = j.id AND d.status = 'completed' AND d.deleted_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'closure blocked (B4): a required diagnostic report is not completed on work order %', NEW.id USING ERRCODE = 'check_violation';
  END IF;

  -- B5a: a failed QC record with no passing record blocks closure.
  IF EXISTS (
    SELECT 1 FROM qms.quality_control_records q
    WHERE q.tenant_id = NEW.tenant_id AND q.company_id = NEW.company_id AND q.branch_id = NEW.branch_id
      AND q.work_order_id = NEW.id AND q.overall_result = 'failed' AND q.deleted_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM qms.quality_control_records q
    WHERE q.tenant_id = NEW.tenant_id AND q.company_id = NEW.company_id AND q.branch_id = NEW.branch_id
      AND q.work_order_id = NEW.id AND q.overall_result = 'passed' AND q.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'closure blocked (B5): quality control failed on work order %', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  -- B5b: if any mandatory QC check is configured, a passed QC record is required.
  IF EXISTS (
    SELECT 1 FROM qms.qc_checks c
    WHERE c.is_mandatory AND c.status = 'active' AND (c.scope = 'platform' OR c.tenant_id = NEW.tenant_id) AND c.deleted_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM qms.quality_control_records q
    WHERE q.tenant_id = NEW.tenant_id AND q.company_id = NEW.company_id AND q.branch_id = NEW.branch_id
      AND q.work_order_id = NEW.id AND q.overall_result = 'passed' AND q.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'closure blocked (B5): a mandatory quality-control pass is missing on work order %', NEW.id USING ERRCODE = 'check_violation';
  END IF;

  -- B6: a safety-critical rework of this WO must be independently signed off.
  IF EXISTS (
    SELECT 1 FROM qms.rework_links rl
    WHERE rl.tenant_id = NEW.tenant_id AND rl.company_id = NEW.company_id AND rl.branch_id = NEW.branch_id
      AND rl.rework_work_order_id = NEW.id AND rl.is_safety_critical
      AND rl.independent_sign_off_by IS NULL AND rl.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'closure blocked (B6): safety-critical rework lacks independent sign-off on work order %', NEW.id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_work_order_closure() IS
  'BEFORE UPDATE OF state on wo.work_orders: on the transition into a terminal (non-cancellation) state, enforces closure blockers B1..B6 (non-terminal job, active labor, unresolved required additional work, incomplete required diagnostic, missing/failed mandatory QC, unsigned safety rework). Cancellation bypasses the completeness blockers. Reads qms/dia/tech under caller RLS (SECURITY INVOKER).';
REVOKE EXECUTE ON FUNCTION wo.guard_work_order_closure() FROM PUBLIC;

CREATE TRIGGER tg_work_orders_closure BEFORE UPDATE OF state ON wo.work_orders
  FOR EACH ROW EXECUTE FUNCTION wo.guard_work_order_closure();
