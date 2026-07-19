-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: EV profile and battery master/readings
-- Tasks: P1-07-DB-008 (EV profile), P1-07-DB-009 (batteries and readings)
-- Owner module: veh
--
-- Purpose
--   veh.vehicle_ev_profiles holds the electric-drive profile for a Vehicle, valid
--   only when the Vehicle's powertrain category is electric-capable. The coupling
--   is DB-enforced in BOTH directions and race-safe: the profile insert/update
--   takes a FOR SHARE lock on the Vehicle, and a powertrain change on the Vehicle
--   takes its own row lock, so the two serialize (no TOCTOU leaving an ICE Vehicle
--   with an EV profile). veh.battery_masters records battery installations
--   (traction/auxiliary) with an install/remove interval; at most one active
--   TRACTION battery per Vehicle. veh.battery_readings is append-only telemetry
--   metadata (soh/soc/voltage/other) — no streaming.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once profiles/batteries exist. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; iam.current_tenant_id;
--   shared.touch_row_metadata; org.guard_immutable_columns;
--   shared.stamp_status_history (battery_readings).
--
-- Details
--   ev_kind -> required powertrain_category: bev->ev, hybrid->hybrid, phev->phev.
--   One active profile per Vehicle. battery_readings value/unit are stored as
--   supplied (no conversion); mixed units are documented, deterministic order by
--   (measured_at, seq).
--
-- Security implications
--   * ENABLE + FORCE RLS on all three; battery_readings append-only (sel/ins only).
--   * All guard functions SECURITY INVOKER, search_path='', REVOKE PUBLIC.
--
-- Objects created
--   Tables:    veh.vehicle_ev_profiles, veh.battery_masters, veh.battery_readings
--   Functions: veh.guard_ev_profile_powertrain(), veh.guard_vehicle_ev_powertrain()
--   Triggers:  tg_vehicle_ev_profiles_touch_metadata/_immutable/_powertrain,
--              tg_vehicles_ev_powertrain, tg_battery_masters_touch_metadata/_immutable,
--              tg_battery_readings_stamp
--   Policies:  sel_/ins_/upd_vehicle_ev_profiles_tenant,
--              sel_/ins_/upd_battery_masters_tenant,
--              sel_/ins_battery_readings_tenant
--   Indexes:   uq_vehicle_ev_profiles_vehicle, ix_battery_masters_vehicle,
--              uq_battery_masters_tenant_id, uq_battery_masters_active_traction,
--              ix_battery_readings_battery
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. veh.vehicle_ev_profiles
-- ----------------------------------------------------------------------------
CREATE TABLE veh.vehicle_ev_profiles (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  vehicle_id           uuid        NOT NULL,
  ev_kind              text        NOT NULL,
  usable_capacity_kwh  numeric(7, 2) NULL,
  charge_port_type     text        NULL,
  high_voltage_warning boolean     NOT NULL DEFAULT true,
  record_version       integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NULL,
  updated_by           uuid        NULL,
  deleted_at           timestamptz NULL,
  deleted_by           uuid        NULL,

  CONSTRAINT pk_vehicle_ev_profiles PRIMARY KEY (id),
  CONSTRAINT fk_vehicle_ev_profiles_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_ev_profiles_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_ev_profiles_kind CHECK (ev_kind IN ('bev', 'hybrid', 'phev')),
  CONSTRAINT ck_vehicle_ev_profiles_capacity
    CHECK (usable_capacity_kwh IS NULL OR usable_capacity_kwh >= 0),
  CONSTRAINT ck_vehicle_ev_profiles_port_not_blank
    CHECK (charge_port_type IS NULL OR btrim(charge_port_type) <> '')
);
COMMENT ON TABLE veh.vehicle_ev_profiles IS
  'Phase 1-7 EV profile (P1-07-DB-008). Allowed only when the Vehicle powertrain category is electric-capable (bev->ev, hybrid->hybrid, phev->phev), enforced in both directions and race-safe. One active profile per Vehicle.';

CREATE INDEX ix_vehicle_ev_profiles_vehicle_fk ON veh.vehicle_ev_profiles (tenant_id, vehicle_id);
CREATE UNIQUE INDEX uq_vehicle_ev_profiles_vehicle
  ON veh.vehicle_ev_profiles (tenant_id, vehicle_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION veh.guard_ev_profile_powertrain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_category text;
  v_required text := CASE NEW.ev_kind WHEN 'bev' THEN 'ev' ELSE NEW.ev_kind END;
BEGIN
  -- Lock the Vehicle so a concurrent powertrain change serializes with us.
  SELECT powertrain_category INTO v_category
    FROM veh.vehicles WHERE tenant_id = NEW.tenant_id AND id = NEW.vehicle_id
    FOR SHARE;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'vehicle % not found in tenant', NEW.vehicle_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_category <> v_required THEN
    RAISE EXCEPTION 'ev_kind % requires powertrain_category % but vehicle % is %',
      NEW.ev_kind, v_required, NEW.vehicle_id, v_category USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_ev_profile_powertrain() IS
  'BEFORE INSERT/UPDATE guard on veh.vehicle_ev_profiles: the Vehicle powertrain_category must match ev_kind (bev->ev, hybrid->hybrid, phev->phev). Locks the Vehicle FOR SHARE to serialize with powertrain changes.';
REVOKE EXECUTE ON FUNCTION veh.guard_ev_profile_powertrain() FROM PUBLIC;

CREATE OR REPLACE FUNCTION veh.guard_vehicle_ev_powertrain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
BEGIN
  -- If an active EV profile exists, the new powertrain category must remain
  -- compatible with it. The UPDATE holds the Vehicle row lock, serializing with
  -- a concurrent profile insert (which takes FOR SHARE on the same row).
  SELECT ev_kind INTO v_kind
    FROM veh.vehicle_ev_profiles
   WHERE tenant_id = NEW.tenant_id AND vehicle_id = NEW.id AND deleted_at IS NULL
   LIMIT 1;
  IF v_kind IS NOT NULL THEN
    IF NEW.powertrain_category <> (CASE v_kind WHEN 'bev' THEN 'ev' ELSE v_kind END) THEN
      RAISE EXCEPTION 'cannot change vehicle % powertrain to %: an active % EV profile requires %',
        NEW.id, NEW.powertrain_category, v_kind,
        (CASE v_kind WHEN 'bev' THEN 'ev' ELSE v_kind END) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_vehicle_ev_powertrain() IS
  'BEFORE UPDATE OF powertrain_category on veh.vehicles: a change incompatible with an active EV profile is rejected (no silent ICE-with-EV-profile state).';
REVOKE EXECUTE ON FUNCTION veh.guard_vehicle_ev_powertrain() FROM PUBLIC;

CREATE TRIGGER tg_vehicle_ev_profiles_touch_metadata
  BEFORE UPDATE ON veh.vehicle_ev_profiles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_vehicle_ev_profiles_immutable
  BEFORE UPDATE ON veh.vehicle_ev_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'created_at', 'created_by');
CREATE TRIGGER tg_vehicle_ev_profiles_powertrain
  BEFORE INSERT OR UPDATE OF ev_kind, vehicle_id, tenant_id ON veh.vehicle_ev_profiles
  FOR EACH ROW EXECUTE FUNCTION veh.guard_ev_profile_powertrain();
CREATE TRIGGER tg_vehicles_ev_powertrain
  BEFORE UPDATE OF powertrain_category ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION veh.guard_vehicle_ev_powertrain();

ALTER TABLE veh.vehicle_ev_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicle_ev_profiles FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_ev_profiles_tenant ON veh.vehicle_ev_profiles
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicle_ev_profiles_tenant ON veh.vehicle_ev_profiles
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_vehicle_ev_profiles_tenant ON veh.vehicle_ev_profiles
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.vehicle_ev_profiles TO app_runtime;
GRANT SELECT ON veh.vehicle_ev_profiles TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. veh.battery_masters
-- ----------------------------------------------------------------------------
CREATE TABLE veh.battery_masters (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  vehicle_id          uuid        NOT NULL,
  battery_ref         text        NULL,
  battery_role        text        NOT NULL DEFAULT 'traction',
  chemistry           text        NULL,
  nominal_capacity_kwh numeric(7, 2) NULL,
  installed_on        date        NULL,
  removed_on          date        NULL,
  status              text        NOT NULL DEFAULT 'active',
  record_version      integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid        NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid        NULL,

  CONSTRAINT pk_battery_masters PRIMARY KEY (id),
  CONSTRAINT uq_battery_masters_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_battery_masters_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_battery_masters_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_battery_masters_role CHECK (battery_role IN ('traction', 'auxiliary', 'other')),
  CONSTRAINT ck_battery_masters_status CHECK (status IN ('active', 'removed')),
  CONSTRAINT ck_battery_masters_chemistry
    CHECK (chemistry IS NULL OR chemistry IN ('li_ion', 'lfp', 'nimh', 'lead_acid', 'other')),
  CONSTRAINT ck_battery_masters_capacity
    CHECK (nominal_capacity_kwh IS NULL OR nominal_capacity_kwh >= 0),
  CONSTRAINT ck_battery_masters_ref_not_blank CHECK (battery_ref IS NULL OR btrim(battery_ref) <> ''),
  CONSTRAINT ck_battery_masters_removed_after_installed
    CHECK (removed_on IS NULL OR installed_on IS NULL OR removed_on >= installed_on),
  CONSTRAINT ck_battery_masters_removed_coherent
    CHECK ((status = 'removed') = (removed_on IS NOT NULL))
);
COMMENT ON TABLE veh.battery_masters IS
  'Phase 1-7 battery installations (P1-07-DB-009). battery_role traction/auxiliary/other; at most one active traction battery per Vehicle (partial unique). Replacement history preserved (removed rows retained). status removed requires removed_on.';

CREATE INDEX ix_battery_masters_vehicle ON veh.battery_masters (tenant_id, vehicle_id);
CREATE UNIQUE INDEX uq_battery_masters_active_traction
  ON veh.battery_masters (tenant_id, vehicle_id)
  WHERE status = 'active' AND battery_role = 'traction' AND deleted_at IS NULL;

CREATE TRIGGER tg_battery_masters_touch_metadata
  BEFORE UPDATE ON veh.battery_masters
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_battery_masters_immutable
  BEFORE UPDATE ON veh.battery_masters
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'battery_ref', 'battery_role', 'installed_on',
    'created_at', 'created_by');

ALTER TABLE veh.battery_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.battery_masters FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_battery_masters_tenant ON veh.battery_masters
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_battery_masters_tenant ON veh.battery_masters
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_battery_masters_tenant ON veh.battery_masters
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.battery_masters TO app_runtime;
GRANT SELECT ON veh.battery_masters TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. veh.battery_readings (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE veh.battery_readings (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  battery_master_id uuid        NOT NULL,
  reading_kind      text        NOT NULL,
  value             numeric(10, 3) NOT NULL,
  unit              text        NOT NULL,
  measured_at       timestamptz NOT NULL,
  measured_by       uuid        NULL,
  source            text        NULL,
  correlation_id    uuid        NULL,
  actor_id          uuid        NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  seq               bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_battery_readings PRIMARY KEY (id),
  CONSTRAINT fk_battery_readings_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_battery_readings_battery
    FOREIGN KEY (tenant_id, battery_master_id)
    REFERENCES veh.battery_masters (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_battery_readings_kind CHECK (reading_kind IN ('soh', 'soc', 'voltage', 'other')),
  CONSTRAINT ck_battery_readings_unit_not_blank CHECK (btrim(unit) <> ''),
  CONSTRAINT ck_battery_readings_source_not_blank CHECK (source IS NULL OR btrim(source) <> '')
);
COMMENT ON TABLE veh.battery_readings IS
  'Phase 1-7 append-only battery readings (P1-07-DB-009): soh/soc/voltage/other. value stored as supplied with its unit (no conversion; mixed units documented). Server-stamped; deterministic order by (measured_at, seq). No telemetry streaming.';

CREATE INDEX ix_battery_readings_battery
  ON veh.battery_readings (tenant_id, battery_master_id, measured_at DESC, seq DESC);

CREATE TRIGGER tg_battery_readings_stamp
  BEFORE INSERT ON veh.battery_readings
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE veh.battery_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.battery_readings FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_battery_readings_tenant ON veh.battery_readings
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_battery_readings_tenant ON veh.battery_readings
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON veh.battery_readings TO app_runtime;
GRANT SELECT ON veh.battery_readings TO app_readonly;
