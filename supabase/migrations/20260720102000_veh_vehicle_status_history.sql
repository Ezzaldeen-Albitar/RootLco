-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: append-only Vehicle status history (lifecycle + workshop)
-- Tasks: P1-07-DB-015
-- Owner module: veh
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once history rows exist. Forward-only — no down script.
--
-- Purpose
--   veh.vehicle_status_history is the append-only typed ledger of Vehicle
--   lifecycle and workshop status transitions. The veh.vehicles master stays the
--   canonical current state; this ledger is written ONLY by an AFTER UPDATE
--   trigger on veh.vehicles, in the same transaction as the change, exactly one
--   row per axis that actually changed (no-op updates write nothing). Lifecycle
--   and workshop are distinct kinds. Attribution is server-stamped and a coherence
--   guard anchors every inserted row's to_state to the Vehicle's live status, so a
--   caller cannot forge a transition that did not happen.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; shared.stamp_status_history
--   (server-stamps actor_id + occurred_at); iam.current_tenant_id.
--
-- Details
--   Append-only: SELECT+INSERT grants only; UPDATE/DELETE raise 42501. status_kind
--   lifecycle/workshop with per-kind valid state sets on both from (nullable) and
--   to sides; from_state IS DISTINCT FROM to_state forbids no-op rows. A monotonic
--   seq gives deterministic same-transaction ordering. The coherence guard rejects
--   any row whose to_state does not equal the Vehicle's current status for that
--   kind (incoherent/forged direct inserts fail).
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped sel/ins policies; no upd/del.
--   * actor_id/occurred_at server-stamped; to_state anchored to live master.
--   * All functions SECURITY INVOKER + SET search_path = ''.
--
-- Objects created
--   Tables:    veh.vehicle_status_history
--   Functions: veh.guard_status_history_coherence(), veh.emit_vehicle_status_history()
--   Triggers:  tg_vehicle_status_history_coherence, tg_vehicle_status_history_stamp,
--              tg_vehicles_status_history
--   Policies:  sel_vehicle_status_history_tenant, ins_vehicle_status_history_tenant
--   Indexes:   ix_vehicle_status_history_vehicle
-- ============================================================================

CREATE TABLE veh.vehicle_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  vehicle_id     uuid        NOT NULL,
  status_kind    text        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  correlation_id uuid        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_vehicle_status_history PRIMARY KEY (id),
  CONSTRAINT fk_vehicle_status_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_status_history_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_status_history_kind CHECK (status_kind IN ('lifecycle', 'workshop')),
  -- No no-op history rows.
  CONSTRAINT ck_vehicle_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  -- Valid states per kind on both the from (nullable) and to sides.
  CONSTRAINT ck_vehicle_status_history_states CHECK (
    (
      status_kind = 'lifecycle'
      AND to_state IN ('draft', 'active', 'inactive', 'merged', 'scrapped')
      AND (from_state IS NULL OR from_state IN ('draft', 'active', 'inactive', 'merged', 'scrapped'))
    )
    OR (
      status_kind = 'workshop'
      AND to_state IN ('none', 'in_workshop', 'awaiting_parts', 'ready_for_delivery')
      AND (from_state IS NULL OR from_state IN ('none', 'in_workshop', 'awaiting_parts', 'ready_for_delivery'))
    )
  )
);

COMMENT ON TABLE veh.vehicle_status_history IS
  'Phase 1-7 append-only Vehicle status ledger (P1-07-DB-015). Trigger-populated from veh.vehicles on real lifecycle/workshop changes (one row per changed axis, same transaction); no-op writes nothing. Server-stamped actor_id/occurred_at; monotonic seq. Coherence guard anchors to_state to the live master so forged transitions are rejected.';

CREATE INDEX ix_vehicle_status_history_vehicle
  ON veh.vehicle_status_history (tenant_id, vehicle_id, occurred_at DESC, seq DESC);

-- ----------------------------------------------------------------------------
-- Coherence guard: a status-history row's to_state must equal the Vehicle's
-- current status for that kind. The emit trigger runs AFTER the master UPDATE, so
-- legitimate rows always match; a caller cannot record a transition into a state
-- the Vehicle is not actually in.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_status_history_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  IF NEW.status_kind = 'lifecycle' THEN
    SELECT lifecycle_status INTO v_current
      FROM veh.vehicles WHERE tenant_id = NEW.tenant_id AND id = NEW.vehicle_id;
  ELSE
    SELECT workshop_status INTO v_current
      FROM veh.vehicles WHERE tenant_id = NEW.tenant_id AND id = NEW.vehicle_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle % not found in this tenant', NEW.vehicle_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the vehicle current % status %',
      NEW.to_state, NEW.status_kind, v_current USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_status_history_coherence() IS
  'BEFORE INSERT on veh.vehicle_status_history: rejects a row whose to_state does not equal the Vehicle current status for that kind (blocks incoherent/forged direct inserts).';
REVOKE EXECUTE ON FUNCTION veh.guard_status_history_coherence() FROM PUBLIC;

CREATE TRIGGER tg_vehicle_status_history_coherence
  BEFORE INSERT ON veh.vehicle_status_history
  FOR EACH ROW EXECUTE FUNCTION veh.guard_status_history_coherence();
CREATE TRIGGER tg_vehicle_status_history_stamp
  BEFORE INSERT ON veh.vehicle_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE veh.vehicle_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicle_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_status_history_tenant ON veh.vehicle_status_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicle_status_history_tenant ON veh.vehicle_status_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON veh.vehicle_status_history TO app_runtime;
GRANT SELECT ON veh.vehicle_status_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- Emit trigger: one typed history row per changed status axis, same transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.emit_vehicle_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
BEGIN
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
    INSERT INTO veh.vehicle_status_history (tenant_id, vehicle_id, status_kind, from_state, to_state, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'lifecycle', OLD.lifecycle_status, NEW.lifecycle_status, v_correlation);
  END IF;
  IF NEW.workshop_status IS DISTINCT FROM OLD.workshop_status THEN
    INSERT INTO veh.vehicle_status_history (tenant_id, vehicle_id, status_kind, from_state, to_state, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'workshop', OLD.workshop_status, NEW.workshop_status, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION veh.emit_vehicle_status_history() IS
  'AFTER UPDATE trigger on veh.vehicles: writes one append-only typed status-history row per changed axis (lifecycle/workshop), same transaction. No-op updates write nothing.';
REVOKE EXECUTE ON FUNCTION veh.emit_vehicle_status_history() FROM PUBLIC;

CREATE TRIGGER tg_vehicles_status_history
  AFTER UPDATE ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION veh.emit_vehicle_status_history();
