-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: append-only Appointment status history
-- Tasks: P1-08-DB-003 (appointment lifecycle history)
-- Owner module: apt
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once history rows exist. Forward-only — no down script.
--
-- Purpose
--   apt.appointment_status_history is the append-only ledger of appointment
--   lifecycle transitions. apt.appointments stays the canonical current state;
--   this ledger is written ONLY by an AFTER UPDATE trigger on apt.appointments, in
--   the same transaction as the change, exactly one row per real lifecycle change
--   (no-op updates write nothing). Attribution is server-stamped and a coherence
--   guard anchors every inserted row's to_state to the appointment's live status,
--   so a caller cannot forge a transition that did not happen.
--
-- Dependencies
--   apt.appointments (tenant_id, company_id, branch_id, id) — the composite parent
--   candidate key; org.tenants; shared.stamp_status_history (stamps actor_id +
--   occurred_at); iam.current_tenant_id / allowed_company_ids / allowed_branch_ids.
--
-- Details
--   Append-only: SELECT+INSERT grants only; UPDATE/DELETE raise 42501. Full branch
--   scope is inherited with a composite FK to the appointment's scope candidate key
--   (branch coherence FK-enforced). from_state IS DISTINCT FROM to_state forbids
--   no-op rows; both sides validate against the appointment state set. A monotonic
--   seq gives deterministic same-transaction ordering. reason and correlation_id
--   are captured from transaction-local GUCs (app.status_reason / app.correlation_id)
--   so the caller can annotate a transition without being able to forge its states.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant + company + branch scoped sel/ins; no upd/del.
--   * actor_id/occurred_at server-stamped; to_state anchored to the live master.
--   * All functions SECURITY INVOKER + SET search_path = ''.
--
-- Objects created
--   Tables:    apt.appointment_status_history
--   Functions: apt.guard_appointment_status_coherence(), apt.emit_appointment_status_history()
--   Triggers:  tg_appointment_status_history_coherence, tg_appointment_status_history_stamp,
--              tg_appointments_status_history
--   Policies:  sel_appointment_status_history_scope, ins_appointment_status_history_scope
--   Indexes:   ix_appointment_status_history_appointment
-- ============================================================================

CREATE TABLE apt.appointment_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  appointment_id uuid        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NULL,
  correlation_id uuid        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_appointment_status_history PRIMARY KEY (id),
  CONSTRAINT fk_appointment_status_history_appointment
    FOREIGN KEY (tenant_id, company_id, branch_id, appointment_id)
    REFERENCES apt.appointments (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  -- No no-op history rows.
  CONSTRAINT ck_appointment_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  -- Valid appointment states on both the from (nullable) and to sides.
  CONSTRAINT ck_appointment_status_history_states CHECK (
    to_state IN ('requested', 'pending_confirmation', 'confirmed', 'checked_in', 'cancelled', 'no_show')
    AND (from_state IS NULL OR from_state IN (
      'requested', 'pending_confirmation', 'confirmed', 'checked_in', 'cancelled', 'no_show'))
  ),
  CONSTRAINT ck_appointment_status_history_reason_not_blank
    CHECK (reason IS NULL OR btrim(reason) <> '')
);

COMMENT ON TABLE apt.appointment_status_history IS
  'Phase 1-8 append-only appointment lifecycle ledger (P1-08-DB-003). Trigger-populated from apt.appointments on real lifecycle changes (one row per change, same transaction); no-op writes nothing. Server-stamped actor_id/occurred_at; monotonic seq. Coherence guard anchors to_state to the live master so forged transitions are rejected.';

-- Non-partial FK-covering index (P1-03-DB-017) + newest-first history read.
CREATE INDEX ix_appointment_status_history_appointment
  ON apt.appointment_status_history
     (tenant_id, company_id, branch_id, appointment_id, occurred_at DESC, seq DESC);

-- ----------------------------------------------------------------------------
-- Coherence guard: a history row's to_state must equal the appointment's current
-- lifecycle_status. The emit trigger runs AFTER the master UPDATE, so legitimate
-- rows always match; a caller cannot record a transition into a state the
-- appointment is not actually in.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apt.guard_appointment_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT lifecycle_status INTO v_current
    FROM apt.appointments
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
      AND branch_id = NEW.branch_id AND id = NEW.appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'appointment % not found in this scope', NEW.appointment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the appointment current status %',
      NEW.to_state, v_current USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION apt.guard_appointment_status_coherence() IS
  'BEFORE INSERT on apt.appointment_status_history: rejects a row whose to_state does not equal the appointment current lifecycle_status (blocks incoherent/forged direct inserts).';
REVOKE EXECUTE ON FUNCTION apt.guard_appointment_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_appointment_status_history_coherence
  BEFORE INSERT ON apt.appointment_status_history
  FOR EACH ROW EXECUTE FUNCTION apt.guard_appointment_status_coherence();
CREATE TRIGGER tg_appointment_status_history_stamp
  BEFORE INSERT ON apt.appointment_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE apt.appointment_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt.appointment_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_appointment_status_history_scope ON apt.appointment_status_history
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_appointment_status_history_scope ON apt.appointment_status_history
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
GRANT SELECT, INSERT ON apt.appointment_status_history TO app_runtime;
GRANT SELECT ON apt.appointment_status_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- Emit trigger: one append-only history row per real lifecycle change, same
-- transaction. reason/correlation come from transaction-local GUCs (optional).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apt.emit_appointment_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  v_reason      text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
    INSERT INTO apt.appointment_status_history
      (tenant_id, company_id, branch_id, appointment_id, from_state, to_state, reason, correlation_id)
    VALUES
      (NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.id,
       OLD.lifecycle_status, NEW.lifecycle_status, v_reason, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION apt.emit_appointment_status_history() IS
  'AFTER UPDATE trigger on apt.appointments: writes one append-only lifecycle-history row when lifecycle_status actually changes, same transaction. reason/correlation captured from app.status_reason / app.correlation_id GUCs. No-op updates write nothing.';
REVOKE EXECUTE ON FUNCTION apt.emit_appointment_status_history() FROM PUBLIC;

CREATE TRIGGER tg_appointments_status_history
  AFTER UPDATE ON apt.appointments
  FOR EACH ROW EXECUTE FUNCTION apt.emit_appointment_status_history();
