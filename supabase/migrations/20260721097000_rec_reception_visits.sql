-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: the Vehicle-Reception visit master
-- Tasks: P1-08-DB-005 (reception master), DB-006 (origin), DB-014 (display #)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once visits exist. Forward-only — no down script.
--
-- Purpose
--   rec.reception_visits is the branch-scoped custody boundary: the moment a
--   Vehicle is physically received into a branch. A visit has EXACTLY ONE origin —
--   an appointment XOR a walk-in — never both, never neither. It captures the
--   receiving employee, custody-acceptance time, and the reception-moment state
--   (odometer reading, fuel level, EV state-of-charge). A Vehicle can have only
--   ONE open visit at a time (custody cannot be in two places). Conversion to a
--   work order is Phase 1-9 — this phase creates NO work order.
--
--   The atomic accepted-check-in primitive (visit + initial custody + initial
--   status history + service-requester role, one transaction) is added in Wave 5,
--   once the custody and status-history ledgers exist. The correctness invariants
--   that must never be deferred — exactly-one-origin, one-open-visit, origin/
--   Vehicle coherence, odometer same-Vehicle, SOC/fuel validity, the state
--   machine — are all enforced here at DDL/trigger level.
--
-- Dependencies
--   org.branches (tenant,company,id); apt.appointments (tenant,company,branch,id);
--   rec.walk_in_references (tenant,company,branch,id); veh.vehicles (tenant,id);
--   veh.odometer_readings (tenant,vehicle,id); rec.fuel_levels (id);
--   iam.current_tenant_id / allowed_company_ids / allowed_branch_ids;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant + company + branch scoped; scope + origin +
--     Vehicle + custody capture immutable; fuel_level fail-closed to visibility.
--   * app roles NOBYPASSRLS; no DELETE grant (soft delete only).
--
-- Objects created
--   Tables:    rec.reception_visits
--   Functions: rec.guard_reception_visit_refs(), rec.guard_reception_transition()
--   Triggers:  tg_reception_visits_refs, tg_reception_visits_transition,
--              tg_reception_visits_immutable, tg_reception_visits_touch_metadata
--   Policies:  sel_reception_visits_scope, ins_reception_visits_scope,
--              upd_reception_visits_scope
--   Indexes:   uq_reception_visits_scope_id, uq_reception_visits_appointment,
--              uq_reception_visits_walk_in, ix_reception_visits_odometer,
--              ix_reception_visits_fuel_level, uq_reception_visits_open_vehicle,
--              uq_reception_visits_active_display_number, ix_reception_visits_status
-- ============================================================================

CREATE TABLE rec.reception_visits (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  company_id           uuid        NOT NULL,
  branch_id            uuid        NOT NULL,
  appointment_id       uuid        NULL,
  walk_in_id           uuid        NULL,
  vehicle_id           uuid        NOT NULL,
  odometer_reading_id  uuid        NULL,
  fuel_level_id        uuid        NULL,
  ev_soc_percent       numeric(5, 2) NULL,
  receiving_employee_id uuid       NOT NULL,
  custody_accepted_at  timestamptz NOT NULL DEFAULT now(),
  reception_status     text        NOT NULL DEFAULT 'opened',
  display_number       text        NULL,
  record_version       integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NULL,
  updated_by           uuid        NULL,
  deleted_at           timestamptz NULL,
  deleted_by           uuid        NULL,

  CONSTRAINT pk_reception_visits PRIMARY KEY (id),
  CONSTRAINT uq_reception_visits_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  -- One visit per appointment / per walk-in (non-partial: also covers the origin
  -- FKs; multiple NULLs are distinct, so many walk-in visits share appointment NULL).
  CONSTRAINT uq_reception_visits_appointment UNIQUE (tenant_id, company_id, branch_id, appointment_id),
  CONSTRAINT uq_reception_visits_walk_in UNIQUE (tenant_id, company_id, branch_id, walk_in_id),
  CONSTRAINT fk_reception_visits_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_visits_appointment
    FOREIGN KEY (tenant_id, company_id, branch_id, appointment_id)
    REFERENCES apt.appointments (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_visits_walk_in
    FOREIGN KEY (tenant_id, company_id, branch_id, walk_in_id)
    REFERENCES rec.walk_in_references (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_visits_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_visits_odometer
    FOREIGN KEY (tenant_id, vehicle_id, odometer_reading_id)
    REFERENCES veh.odometer_readings (tenant_id, vehicle_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_visits_fuel_level
    FOREIGN KEY (fuel_level_id) REFERENCES rec.fuel_levels (id) ON DELETE RESTRICT,
  -- Exactly one origin: appointment XOR walk-in.
  CONSTRAINT ck_reception_visits_one_origin
    CHECK ((appointment_id IS NULL) <> (walk_in_id IS NULL)),
  CONSTRAINT ck_reception_visits_status CHECK (reception_status IN (
    'opened', 'inspecting', 'authorized', 'converted', 'closed_without_work', 'refused')),
  CONSTRAINT ck_reception_visits_soc
    CHECK (ev_soc_percent IS NULL OR (ev_soc_percent >= 0 AND ev_soc_percent <= 100)),
  CONSTRAINT ck_reception_visits_display_number_not_blank
    CHECK (display_number IS NULL OR btrim(display_number) <> '')
);

COMMENT ON TABLE rec.reception_visits IS
  'Phase 1-8 reception visit master / custody boundary (P1-08-DB-005). Exactly one origin (appointment XOR walk-in); one open visit per Vehicle; captures receiving employee, custody-accept time, odometer/fuel/SOC. No work order (P1-09). Atomic accepted-check-in primitive added in Wave 5.';
COMMENT ON COLUMN rec.reception_visits.ev_soc_percent IS
  'EV state-of-charge 0–100 (percent) or NULL. Not required for ICE Vehicles.';

-- One OPEN visit per Vehicle+tenant (custody cannot be in two places). Terminal
-- visits (closed_without_work/refused) do not block a later visit.
CREATE UNIQUE INDEX uq_reception_visits_open_vehicle
  ON rec.reception_visits (tenant_id, vehicle_id)
  WHERE reception_status IN ('opened', 'inspecting', 'authorized', 'converted')
    AND deleted_at IS NULL;
-- Active display-number uniqueness (per tenant).
CREATE UNIQUE INDEX uq_reception_visits_active_display_number
  ON rec.reception_visits (tenant_id, display_number)
  WHERE display_number IS NOT NULL AND deleted_at IS NULL;
-- Non-partial FK-covering indexes (P1-03-DB-017). ix_odometer's leading (tenant,
-- vehicle) also covers the Vehicle FK; ix_fuel_level covers the fuel FK.
CREATE INDEX ix_reception_visits_odometer
  ON rec.reception_visits (tenant_id, vehicle_id, odometer_reading_id);
CREATE INDEX ix_reception_visits_fuel_level ON rec.reception_visits (fuel_level_id);
CREATE INDEX ix_reception_visits_status
  ON rec.reception_visits (tenant_id, company_id, branch_id, reception_status);

-- ----------------------------------------------------------------------------
-- Reference guard: fuel_level visibility (fail-closed) + origin/Vehicle coherence
-- (the appointment's Vehicle, and a walk-in's identified Vehicle, must equal the
-- visit's Vehicle). SECURITY INVOKER so RLS scoping applies to the lookups.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_reception_visit_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_vehicle uuid;
BEGIN
  IF NEW.fuel_level_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rec.fuel_levels WHERE id = NEW.fuel_level_id) THEN
    RAISE EXCEPTION 'fuel_level % is not visible to this tenant', NEW.fuel_level_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle FROM apt.appointments
      WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
        AND branch_id = NEW.branch_id AND id = NEW.appointment_id;
    IF v_vehicle IS DISTINCT FROM NEW.vehicle_id THEN
      RAISE EXCEPTION 'reception Vehicle % does not match appointment Vehicle %',
        NEW.vehicle_id, v_vehicle USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.walk_in_id IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle FROM rec.walk_in_references
      WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
        AND branch_id = NEW.branch_id AND id = NEW.walk_in_id;
    -- A walk-in Vehicle is only known once identified; if set, it must match.
    IF v_vehicle IS NOT NULL AND v_vehicle IS DISTINCT FROM NEW.vehicle_id THEN
      RAISE EXCEPTION 'reception Vehicle % does not match walk-in Vehicle %',
        NEW.vehicle_id, v_vehicle USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_reception_visit_refs() IS
  'BEFORE INSERT/UPDATE guard on rec.reception_visits: fuel_level fail-closed visibility; the appointment Vehicle (and an identified walk-in Vehicle) must equal the visit Vehicle.';
REVOKE EXECUTE ON FUNCTION rec.guard_reception_visit_refs() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Reception state machine. Wave 3 enforces the state graph; Wave 5 replaces this
-- to also require an authorization and a service-requester role before authorized/
-- converted. Terminal states (converted, closed_without_work, refused) are frozen.
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
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_reception_transition() IS
  'BEFORE UPDATE OF reception_status on rec.reception_visits: enforces the reception state graph (opened->inspecting->authorized->converted; opened/inspecting/authorized->closed_without_work|refused; terminals frozen). Wave 5 adds authorization/service-requester preconditions.';
REVOKE EXECUTE ON FUNCTION rec.guard_reception_transition() FROM PUBLIC;

CREATE TRIGGER tg_reception_visits_refs
  BEFORE INSERT OR UPDATE OF appointment_id, walk_in_id, vehicle_id, fuel_level_id
  ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION rec.guard_reception_visit_refs();
CREATE TRIGGER tg_reception_visits_transition
  BEFORE UPDATE OF reception_status ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION rec.guard_reception_transition();
CREATE TRIGGER tg_reception_visits_immutable
  BEFORE UPDATE ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'appointment_id', 'walk_in_id', 'vehicle_id',
    'odometer_reading_id', 'fuel_level_id', 'ev_soc_percent', 'receiving_employee_id',
    'custody_accepted_at', 'created_at', 'created_by');
CREATE TRIGGER tg_reception_visits_touch_metadata
  BEFORE UPDATE ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.reception_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.reception_visits FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_reception_visits_scope ON rec.reception_visits
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_reception_visits_scope ON rec.reception_visits
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_reception_visits_scope ON rec.reception_visits
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.reception_visits TO app_runtime;
GRANT SELECT ON rec.reception_visits TO app_readonly;
