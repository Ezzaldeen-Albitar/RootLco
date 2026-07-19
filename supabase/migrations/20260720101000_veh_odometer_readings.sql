-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: append-only odometer reading series
-- Tasks: P1-07-DB-014
-- Owner module: veh
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once readings exist. Forward-only — no down script.
--
-- Purpose
--   veh.odometer_readings is the append-only per-Vehicle odometer series. Readings
--   only ever move forward; a genuine downward value is possible ONLY through an
--   explicit, reasoned, anomaly-flagged correction that references an earlier
--   reading of the same Vehicle. Units (km/mi) are stored verbatim and never
--   silently converted; a generated canonical km column (value_km) is the single
--   basis for monotonicity and point-in-time resolution across a mixed-unit
--   history. recorded_by is server-stamped; a monotonic seq gives deterministic
--   same-timestamp ordering.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; iam.current_tenant_id /
--   iam.current_user_id.
--
-- Details
--   Append-only: SELECT+INSERT grants only; UPDATE/DELETE raise 42501 (no policy,
--   no grant). value >= 0. capture_method reception/delivery/manual/correction.
--   correction_of is a composite self-FK (tenant_id, vehicle_id, correction_of)
--   so a correction can only reference a row of the SAME tenant AND SAME Vehicle
--   (cross-tenant / cross-Vehicle correction is a FK violation). A correction must
--   carry a reason and anomaly_flag; a non-correction must not. The BEFORE INSERT
--   guard locks the Vehicle row (per-Vehicle mutex) so concurrent inserts cannot
--   race past the monotonicity check, rejects a normal reading below the current
--   effective odometer (max value_km over non-superseded readings), and requires a
--   correction to reference an earlier-or-equal reading. Corrections may lower the
--   value; the superseded reading is then excluded from the effective maximum.
--   Cycles are impossible: correction_of always references a pre-existing row.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped sel/ins policies; no upd/del.
--   * recorded_by is server-stamped (forged attribution impossible).
--   * Guard is SECURITY INVOKER + SET search_path = ''.
--
-- Objects created
--   Tables:    veh.odometer_readings
--   Functions: veh.stamp_odometer_reading(), veh.guard_odometer_reading(),
--              veh.latest_odometer(uuid), veh.odometer_at(uuid, timestamptz)
--   Triggers:  tg_odometer_readings_stamp, tg_odometer_readings_guard
--   Policies:  sel_odometer_readings_tenant, ins_odometer_readings_tenant
--   Indexes:   ix_odometer_readings_vehicle, ix_odometer_readings_correction,
--              uq_odometer_readings_vehicle_row
-- ============================================================================

CREATE TABLE veh.odometer_readings (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL,
  vehicle_id        uuid          NOT NULL,
  value             numeric(12, 1) NOT NULL,
  unit              text          NOT NULL,
  value_km          numeric(14, 4) GENERATED ALWAYS AS (
    CASE unit
      WHEN 'km' THEN value
      WHEN 'mi' THEN round(value * 1.609344, 4)
    END
  ) STORED,
  observed_at       timestamptz   NOT NULL DEFAULT now(),
  capture_method    text          NOT NULL,
  correction_of     uuid          NULL,
  correction_reason text          NULL,
  anomaly_flag      boolean       NOT NULL DEFAULT false,
  correlation_id    uuid          NULL,
  recorded_by       uuid          NOT NULL,
  seq               bigint        GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_odometer_readings PRIMARY KEY (id),
  -- Candidate key for the same-tenant, same-Vehicle composite correction FK.
  CONSTRAINT uq_odometer_readings_vehicle_row UNIQUE (tenant_id, vehicle_id, id),
  CONSTRAINT fk_odometer_readings_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_odometer_readings_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_odometer_readings_correction
    FOREIGN KEY (tenant_id, vehicle_id, correction_of)
    REFERENCES veh.odometer_readings (tenant_id, vehicle_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_odometer_readings_value_nonneg CHECK (value >= 0),
  CONSTRAINT ck_odometer_readings_unit CHECK (unit IN ('km', 'mi')),
  CONSTRAINT ck_odometer_readings_capture
    CHECK (capture_method IN ('reception', 'delivery', 'manual', 'correction')),
  CONSTRAINT ck_odometer_readings_not_self CHECK (correction_of IS NULL OR correction_of <> id),
  -- A correction has a reference; a non-correction does not.
  CONSTRAINT ck_odometer_readings_correction_ref
    CHECK ((capture_method = 'correction') = (correction_of IS NOT NULL)),
  -- Correction-only metadata (reason + anomaly) is coupled to a correction; a
  -- normal reading cannot carry it.
  CONSTRAINT ck_odometer_readings_correction_meta CHECK (
    CASE
      WHEN capture_method = 'correction'
        THEN correction_reason IS NOT NULL AND btrim(correction_reason) <> '' AND anomaly_flag = true
      ELSE correction_reason IS NULL AND anomaly_flag = false
    END
  )
);

COMMENT ON TABLE veh.odometer_readings IS
  'Phase 1-7 append-only odometer series (P1-07-DB-014). Forward-only per Vehicle; a downward value requires an explicit reasoned anomaly-flagged correction referencing an earlier same-Vehicle reading. Units stored verbatim (never converted); generated value_km is the canonical monotonicity/resolution basis. recorded_by server-stamped; seq gives deterministic same-timestamp ordering. Mixed-unit history: compare/resolve on value_km only.';
COMMENT ON COLUMN veh.odometer_readings.value_km IS
  'Generated (STORED) canonical kilometres from (value, unit): km verbatim, mi * 1.609344 rounded to 4dp. Sole basis for monotonicity and point-in-time resolution; never set directly.';
COMMENT ON COLUMN veh.odometer_readings.correction_of IS
  'Composite self-FK (tenant_id, vehicle_id, correction_of): a correction references an earlier reading of the SAME Vehicle. Append-only + pre-existing target makes correction cycles impossible.';

-- Per-Vehicle latest-first reads; first column (tenant_id) also covers the tenant
-- FK and the first two columns cover the composite Vehicle FK.
CREATE INDEX ix_odometer_readings_vehicle
  ON veh.odometer_readings (tenant_id, vehicle_id, observed_at DESC, seq DESC);
-- Non-partial covering index for the 3-column composite correction FK.
CREATE INDEX ix_odometer_readings_correction
  ON veh.odometer_readings (tenant_id, vehicle_id, correction_of);

-- ----------------------------------------------------------------------------
-- Server-stamp recorded_by from the session actor (forged attribution impossible).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.stamp_odometer_reading()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.recorded_by := iam.current_user_id();
  IF NEW.recorded_by IS NULL THEN
    RAISE EXCEPTION 'odometer reading requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.stamp_odometer_reading() IS
  'BEFORE INSERT on veh.odometer_readings: server-stamps recorded_by from iam.current_user_id() (raises if unset).';
REVOKE EXECUTE ON FUNCTION veh.stamp_odometer_reading() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Monotonicity + correction integrity guard. Locks the Vehicle row so concurrent
-- inserts serialize and cannot both pass the check with a stale maximum.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_odometer_reading()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_vehicle_exists boolean;
  v_corrected_observed timestamptz;
  v_prior_max numeric(14, 4);
  -- STORED generated value_km is not populated during a BEFORE trigger, so the
  -- canonical km is computed here from the supplied value/unit.
  v_new_km numeric(14, 4) := CASE NEW.unit
    WHEN 'km' THEN NEW.value
    WHEN 'mi' THEN round(NEW.value * 1.609344, 4)
  END;
BEGIN
  -- Per-Vehicle mutex: serialize concurrent readings for this Vehicle.
  SELECT true INTO v_vehicle_exists
    FROM veh.vehicles
   WHERE tenant_id = NEW.tenant_id AND id = NEW.vehicle_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle % not found in this tenant', NEW.vehicle_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.capture_method = 'correction' THEN
    -- Defer the correction/reference coupling to ck_odometer_readings_correction_ref
    -- (a correction with a NULL reference is a check violation, not a guard error).
    IF NEW.correction_of IS NULL THEN
      RETURN NEW;
    END IF;
    -- correction_of is same-tenant/same-Vehicle (FK). It must reference an
    -- earlier-or-equal reading; a correction may lower the value.
    SELECT observed_at INTO v_corrected_observed
      FROM veh.odometer_readings
     WHERE tenant_id = NEW.tenant_id AND vehicle_id = NEW.vehicle_id AND id = NEW.correction_of;
    IF v_corrected_observed IS NULL THEN
      RAISE EXCEPTION 'corrected reading % not found for this Vehicle', NEW.correction_of
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_corrected_observed > NEW.observed_at THEN
      RAISE EXCEPTION 'correction must reference an earlier-or-equal reading'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Normal reading: must not fall below the current effective odometer (the max
  -- canonical km over readings not superseded by a correction).
  SELECT max(o.value_km) INTO v_prior_max
    FROM veh.odometer_readings o
   WHERE o.tenant_id = NEW.tenant_id
     AND o.vehicle_id = NEW.vehicle_id
     AND NOT EXISTS (
       SELECT 1 FROM veh.odometer_readings c
        WHERE c.tenant_id = o.tenant_id AND c.vehicle_id = o.vehicle_id AND c.correction_of = o.id
     );
  IF v_prior_max IS NOT NULL AND v_new_km < v_prior_max THEN
    RAISE EXCEPTION 'odometer value % km is below the current reading % km (use a correction)',
      v_new_km, v_prior_max USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_odometer_reading() IS
  'BEFORE INSERT on veh.odometer_readings: locks the Vehicle row, rejects a normal reading below the current effective odometer (max value_km over non-superseded readings), and requires a correction to reference an earlier-or-equal reading. Corrections may lower the value.';
REVOKE EXECUTE ON FUNCTION veh.guard_odometer_reading() FROM PUBLIC;

CREATE TRIGGER tg_odometer_readings_stamp
  BEFORE INSERT ON veh.odometer_readings
  FOR EACH ROW EXECUTE FUNCTION veh.stamp_odometer_reading();
CREATE TRIGGER tg_odometer_readings_guard
  BEFORE INSERT ON veh.odometer_readings
  FOR EACH ROW EXECUTE FUNCTION veh.guard_odometer_reading();

-- ----------------------------------------------------------------------------
-- Deterministic resolvers (SECURITY INVOKER; RLS/context apply).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.latest_odometer(p_vehicle_id uuid)
RETURNS veh.odometer_readings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT o.*
    FROM veh.odometer_readings o
   WHERE o.vehicle_id = p_vehicle_id
     AND NOT EXISTS (
       SELECT 1 FROM veh.odometer_readings c
        WHERE c.tenant_id = o.tenant_id AND c.vehicle_id = o.vehicle_id AND c.correction_of = o.id
     )
   ORDER BY o.observed_at DESC, o.seq DESC
   LIMIT 1;
$$;
COMMENT ON FUNCTION veh.latest_odometer(uuid) IS
  'Latest effective odometer reading for a Vehicle (non-superseded, ordered observed_at DESC then seq DESC). SECURITY INVOKER — RLS/context apply.';
REVOKE EXECUTE ON FUNCTION veh.latest_odometer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.latest_odometer(uuid) TO app_runtime, app_readonly;

CREATE OR REPLACE FUNCTION veh.odometer_at(p_vehicle_id uuid, p_at timestamptz)
RETURNS veh.odometer_readings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT o.*
    FROM veh.odometer_readings o
   WHERE o.vehicle_id = p_vehicle_id
     AND o.observed_at <= p_at
     AND NOT EXISTS (
       SELECT 1 FROM veh.odometer_readings c
        WHERE c.tenant_id = o.tenant_id AND c.vehicle_id = o.vehicle_id AND c.correction_of = o.id
     )
   ORDER BY o.observed_at DESC, o.seq DESC
   LIMIT 1;
$$;
COMMENT ON FUNCTION veh.odometer_at(uuid, timestamptz) IS
  'Effective odometer reading at or before a timestamp for a Vehicle (non-superseded). SECURITY INVOKER — RLS/context apply.';
REVOKE EXECUTE ON FUNCTION veh.odometer_at(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.odometer_at(uuid, timestamptz) TO app_runtime, app_readonly;

ALTER TABLE veh.odometer_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.odometer_readings FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_odometer_readings_tenant ON veh.odometer_readings
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_odometer_readings_tenant ON veh.odometer_readings
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON veh.odometer_readings TO app_runtime;
GRANT SELECT ON veh.odometer_readings TO app_readonly;
