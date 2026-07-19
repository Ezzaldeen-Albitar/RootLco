-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception status history + atomic accepted-check-in primitive
-- Tasks: P1-08-DB-021 (reception status history), P1-08-DB-022 (atomic check-in)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   rec.reception_status_history is the append-only ledger of reception-visit
--   status transitions, trigger-emitted from rec.reception_visits (one row per real
--   change, coherence-guarded to the live master). Conversion records a 'converted'
--   status and creates NO work order (Phase 1-9 owns that).
--
--   rec.accept_check_in() is the atomic accepted-check-in primitive: in ONE
--   transaction it creates the reception visit (opened, custody accepted), records
--   the initial custody 'accepted' event, the initial 'opened' status-history row,
--   and the mandatory service-requester party role — so there is never an impossible
--   transient state (an open visit with no custody / no requester). A failure of any
--   step rolls the whole thing back: zero orphans.
--
--   The reception transition guard is REPLACED here to add activation preconditions:
--   advancing to 'authorized' now requires an active service-requester role AND an
--   approved authorization (the DR-10 deferred activation contract).
--
-- Dependencies
--   rec.reception_visits / reception_party_roles / custody_history / authorizations;
--   shared.stamp_status_history; iam.current_tenant_id / current_user_id.
--
-- Objects created
--   Tables:    rec.reception_status_history
--   Functions: rec.guard_reception_status_coherence(), rec.emit_reception_status_history(),
--              rec.accept_check_in(...); REPLACE rec.guard_reception_transition()
--   Triggers:  tg_reception_status_history_coherence, tg_reception_status_history_stamp,
--              tg_reception_visits_status_history
--   Policies:  sel/ins_reception_status_history_scope
-- ============================================================================

CREATE TABLE rec.reception_status_history (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  branch_id          uuid        NOT NULL,
  reception_visit_id uuid        NOT NULL,
  from_state         text        NULL,
  to_state           text        NOT NULL,
  reason             text        NULL,
  correlation_id     uuid        NULL,
  actor_id           uuid        NOT NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  seq                bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_reception_status_history PRIMARY KEY (id),
  CONSTRAINT fk_reception_status_history_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_reception_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_reception_status_history_states CHECK (
    to_state IN ('opened', 'inspecting', 'authorized', 'converted', 'closed_without_work', 'refused')
    AND (from_state IS NULL OR from_state IN (
      'opened', 'inspecting', 'authorized', 'converted', 'closed_without_work', 'refused'))
  ),
  CONSTRAINT ck_reception_status_history_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);

COMMENT ON TABLE rec.reception_status_history IS
  'Phase 1-8 append-only reception status ledger (P1-08-DB-021). Trigger-emitted from rec.reception_visits (one row per real change); coherence-guarded to the live master. converted creates no work order. SELECT+INSERT only.';

CREATE INDEX ix_reception_status_history_visit
  ON rec.reception_status_history
     (tenant_id, company_id, branch_id, reception_visit_id, occurred_at DESC, seq DESC);

CREATE OR REPLACE FUNCTION rec.guard_reception_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT reception_status INTO v_current FROM rec.reception_visits
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
      AND branch_id = NEW.branch_id AND id = NEW.reception_visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reception visit % not found in this scope', NEW.reception_visit_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the visit current status %',
      NEW.to_state, v_current USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_reception_status_coherence() IS
  'BEFORE INSERT on rec.reception_status_history: rejects a row whose to_state does not equal the visit current reception_status (blocks incoherent/forged inserts).';
REVOKE EXECUTE ON FUNCTION rec.guard_reception_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_reception_status_history_coherence
  BEFORE INSERT ON rec.reception_status_history
  FOR EACH ROW EXECUTE FUNCTION rec.guard_reception_status_coherence();
CREATE TRIGGER tg_reception_status_history_stamp
  BEFORE INSERT ON rec.reception_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE rec.reception_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.reception_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_reception_status_history_scope ON rec.reception_status_history
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_reception_status_history_scope ON rec.reception_status_history
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
GRANT SELECT, INSERT ON rec.reception_status_history TO app_runtime;
GRANT SELECT ON rec.reception_status_history TO app_readonly;

CREATE OR REPLACE FUNCTION rec.emit_reception_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  v_reason      text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.reception_status IS DISTINCT FROM OLD.reception_status THEN
    INSERT INTO rec.reception_status_history
      (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, reason, correlation_id)
    VALUES
      (NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.id,
       OLD.reception_status, NEW.reception_status, v_reason, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION rec.emit_reception_status_history() IS
  'AFTER UPDATE trigger on rec.reception_visits: writes one append-only status-history row when reception_status actually changes, same transaction.';
REVOKE EXECUTE ON FUNCTION rec.emit_reception_status_history() FROM PUBLIC;

CREATE TRIGGER tg_reception_visits_status_history
  AFTER UPDATE ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION rec.emit_reception_status_history();

-- ----------------------------------------------------------------------------
-- REPLACE the reception transition guard to add activation preconditions:
-- advancing to 'authorized' requires an active service-requester role AND an
-- approved authorization on the visit (DR-10 deferred activation contract).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_reception_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.reception_status = OLD.reception_status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.reception_status = 'opened'
       AND NEW.reception_status IN ('inspecting', 'closed_without_work', 'refused'))
    OR (OLD.reception_status = 'inspecting'
       AND NEW.reception_status IN ('authorized', 'closed_without_work', 'refused'))
    OR (OLD.reception_status = 'authorized'
       AND NEW.reception_status IN ('converted', 'closed_without_work', 'refused'))
  ) THEN
    RAISE EXCEPTION 'invalid reception transition % -> %', OLD.reception_status, NEW.reception_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reception_status = 'authorized' THEN
    IF NOT EXISTS (
      SELECT 1 FROM rec.reception_party_roles r
      WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
        AND r.branch_id = NEW.branch_id AND r.reception_visit_id = NEW.id
        AND r.relationship_role = 'service_requester'
        AND r.valid_to IS NULL AND r.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'cannot authorize visit % without an active service requester', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM rec.authorizations a
      WHERE a.tenant_id = NEW.tenant_id AND a.company_id = NEW.company_id
        AND a.branch_id = NEW.branch_id AND a.reception_visit_id = NEW.id
        AND a.decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'cannot authorize visit % without an approved authorization', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- rec.accept_check_in — atomic accepted check-in primitive. Establishes the
-- visit + service-requester role + initial custody acceptance + initial status
-- history in one transaction. SECURITY INVOKER: runs under the caller's RLS.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.accept_check_in(
  p_company             uuid,
  p_branch              uuid,
  p_vehicle             uuid,
  p_appointment         uuid,
  p_walk_in             uuid,
  p_receiving_employee  uuid,
  p_service_requester   uuid,
  p_odometer_reading    uuid DEFAULT NULL,
  p_fuel_level          uuid DEFAULT NULL,
  p_soc                 numeric DEFAULT NULL,
  p_display_number      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := iam.current_tenant_id();
  v_actor  uuid := iam.current_user_id();
  v_visit  uuid;
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'check-in requires tenant and actor context' USING ERRCODE = 'raise_exception';
  END IF;
  IF p_service_requester IS NULL THEN
    RAISE EXCEPTION 'check-in requires a service requester' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO rec.reception_visits
    (tenant_id, company_id, branch_id, appointment_id, walk_in_id, vehicle_id,
     odometer_reading_id, fuel_level_id, ev_soc_percent, receiving_employee_id,
     reception_status, display_number, created_by)
  VALUES
    (v_tenant, p_company, p_branch, p_appointment, p_walk_in, p_vehicle,
     p_odometer_reading, p_fuel_level, p_soc, p_receiving_employee,
     'opened', p_display_number, v_actor)
  RETURNING id INTO v_visit;

  INSERT INTO rec.reception_party_roles
    (tenant_id, company_id, branch_id, reception_visit_id, partner_id, relationship_role, created_by)
  VALUES (v_tenant, p_company, p_branch, v_visit, p_service_requester, 'service_requester', v_actor);

  INSERT INTO rec.custody_history
    (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state,
     receiving_partner_id, actor_id)
  VALUES (v_tenant, p_company, p_branch, v_visit, NULL, 'accepted', p_service_requester, v_actor);

  INSERT INTO rec.reception_status_history
    (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, actor_id)
  VALUES (v_tenant, p_company, p_branch, v_visit, NULL, 'opened', v_actor);

  RETURN v_visit;
END;
$$;
COMMENT ON FUNCTION rec.accept_check_in(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) IS
  'Atomic accepted-check-in (P1-08-DB-022): one transaction creates the opened visit, the service-requester role, the initial custody acceptance, and the initial status-history row. SECURITY INVOKER (caller RLS); rolls back wholly on any failure.';
REVOKE EXECUTE ON FUNCTION
  rec.accept_check_in(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  rec.accept_check_in(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) TO app_runtime;
