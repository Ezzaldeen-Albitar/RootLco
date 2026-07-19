-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: vehicle identifiers + the missing-VIN activation contract
-- Tasks: P1-07-DB-003
-- Owner module: veh
--
-- Purpose
--   veh.vehicle_identifiers is the typed identifier ledger (vin/chassis/engine_no/
--   fleet_no/other) for a Vehicle. Chassis and engine numbers are theft-sensitive
--   and gated as 'restricted'; the type<->classification coupling and classification
--   immutability prevent mislabelling and downgrade.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once identifiers exist. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; iam.current_tenant_id;
--   iam.has_permission; shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Details
--   Missing-VIN activation contract: a Vehicle may be created in 'draft' with no
--   VIN and no identifier, but may not become 'active' unless it has a normalized
--   VIN on the master OR at least one active alternate identifier (chassis/
--   engine_no/fleet_no/other). Symmetrically, retiring the last such identity from
--   an active VIN-less Vehicle is rejected. Both guards lock the parent Vehicle
--   row FOR UPDATE so activation and identity-removal serialize (no write-skew).
--   vehicles.vin_normalized remains the authoritative VIN for uniqueness/search;
--   a 'vin' identifier row is an optional ledger echo (no forced sync — documented
--   residual). Restricted rows are row-gated (read AND write) by
--   iam.has_permission('iam.sensitive.view'); the backend must translate a 23505
--   on the active-value unique index into a generic "possible duplicate" without
--   echoing the constraint DETAIL (which would leak the raw restricted value).
--
-- Security implications
--   * ENABLE + FORCE RLS; restricted rows gated on sel/ins/upd by the sensitive
--     permission. tenant_id/vehicle_id/identifier_type/classification immutable.
--   * All guard functions SECURITY INVOKER, search_path='', REVOKE PUBLIC.
--
-- Objects created
--   Tables:    veh.vehicle_identifiers
--   Functions: veh.guard_vehicle_activation(), veh.guard_vehicle_identity_removal()
--   Triggers:  tg_vehicle_identifiers_touch_metadata, tg_vehicle_identifiers_immutable,
--              tg_vehicle_identifiers_identity_removal, tg_vehicles_activation_guard
--   Policies:  sel_/ins_/upd_vehicle_identifiers_tenant
--   Indexes:   ix_vehicle_identifiers_vehicle, uq_vehicle_identifiers_active,
--              uq_vehicle_identifiers_primary
-- ============================================================================

CREATE TABLE veh.vehicle_identifiers (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  vehicle_id       uuid        NOT NULL,
  identifier_type  text        NOT NULL,
  raw_value        text        NOT NULL,
  normalized_value text        NOT NULL,
  is_primary       boolean     NOT NULL DEFAULT false,
  status           text        NOT NULL DEFAULT 'active',
  classification   text        NOT NULL,
  verified_at      timestamptz NULL,
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid        NULL,

  CONSTRAINT pk_vehicle_identifiers PRIMARY KEY (id),
  CONSTRAINT fk_vehicle_identifiers_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_identifiers_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_identifiers_type
    CHECK (identifier_type IN ('vin', 'chassis', 'engine_no', 'fleet_no', 'other')),
  CONSTRAINT ck_vehicle_identifiers_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_vehicle_identifiers_classification
    CHECK (classification IN ('internal', 'restricted')),
  -- Chassis/engine numbers are restricted; vin/fleet_no are internal; other may
  -- be either (a genuinely sensitive misc identifier may be marked restricted).
  CONSTRAINT ck_vehicle_identifiers_type_classification CHECK (
    (identifier_type IN ('chassis', 'engine_no') AND classification = 'restricted')
    OR (identifier_type IN ('vin', 'fleet_no') AND classification = 'internal')
    OR (identifier_type = 'other')
  ),
  CONSTRAINT ck_vehicle_identifiers_raw_not_blank
    CHECK (btrim(raw_value) <> '' AND char_length(raw_value) <= 512),
  CONSTRAINT ck_vehicle_identifiers_normalized_not_blank
    CHECK (btrim(normalized_value) <> '' AND char_length(normalized_value) <= 512)
);

COMMENT ON TABLE veh.vehicle_identifiers IS
  'Phase 1-7 typed Vehicle identifier ledger (P1-07-DB-003). vin/chassis/engine_no/fleet_no/other. chassis+engine_no are restricted (row-gated by iam.sensitive.view); type<->classification coupled and classification immutable. Alternate identifiers (chassis/engine_no/fleet_no/other) satisfy the missing-VIN activation contract. vehicles.vin_normalized stays authoritative for VIN uniqueness/search.';

-- FK cover (tenant_id, vehicle_id) covers both fk_..._vehicle and fk_..._tenant.
CREATE INDEX ix_vehicle_identifiers_vehicle ON veh.vehicle_identifiers (tenant_id, vehicle_id);
-- One active identifier per (tenant, type, normalized value).
CREATE UNIQUE INDEX uq_vehicle_identifiers_active
  ON veh.vehicle_identifiers (tenant_id, identifier_type, normalized_value)
  WHERE deleted_at IS NULL AND status = 'active';
-- At most one live primary per (vehicle, type).
CREATE UNIQUE INDEX uq_vehicle_identifiers_primary
  ON veh.vehicle_identifiers (tenant_id, vehicle_id, identifier_type)
  WHERE is_primary AND deleted_at IS NULL;

CREATE TRIGGER tg_vehicle_identifiers_touch_metadata
  BEFORE UPDATE ON veh.vehicle_identifiers
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_vehicle_identifiers_immutable
  BEFORE UPDATE ON veh.vehicle_identifiers
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'identifier_type', 'classification', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- Missing-VIN activation contract (write-skew-safe: both sides lock the vehicle).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_vehicle_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.lifecycle_status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.lifecycle_status <> 'active') THEN
    -- On INSERT no identifier rows can exist yet, so only a VIN can satisfy the
    -- contract: an active identity-less vehicle must be built draft -> add
    -- identifier -> activate. On UPDATE either a VIN or an active alternate works.
    -- NB: the STORED generated vin_normalized is not yet populated inside a BEFORE
    -- trigger, so compute it directly from vin_raw (normalize_vin is IMMUTABLE).
    IF veh.normalize_vin(NEW.vin_raw) IS NULL AND NOT EXISTS (
      SELECT 1 FROM veh.vehicle_identifiers
       WHERE tenant_id = NEW.tenant_id AND vehicle_id = NEW.id
         AND status = 'active' AND deleted_at IS NULL
         AND identifier_type IN ('chassis', 'engine_no', 'fleet_no', 'other')
    ) THEN
      RAISE EXCEPTION 'vehicle % cannot be activated without a normalized VIN or an active alternate identifier', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_vehicle_activation() IS
  'BEFORE INSERT/UPDATE guard on veh.vehicles: an active vehicle requires a normalized VIN or an active alternate identifier. On UPDATE the vehicle row is already locked, serializing with identity-removal.';
REVOKE EXECUTE ON FUNCTION veh.guard_vehicle_activation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION veh.guard_vehicle_identity_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_lifecycle text;
  v_vin       text;
BEGIN
  IF (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
     OR (NEW.status = 'inactive' AND OLD.status = 'active') THEN
    -- Lock the parent vehicle to serialize with activation.
    SELECT lifecycle_status, vin_normalized INTO v_lifecycle, v_vin
      FROM veh.vehicles
     WHERE tenant_id = OLD.tenant_id AND id = OLD.vehicle_id
     FOR UPDATE;

    IF v_lifecycle = 'active' AND v_vin IS NULL
       AND OLD.identifier_type IN ('chassis', 'engine_no', 'fleet_no', 'other') THEN
      IF NOT EXISTS (
        SELECT 1 FROM veh.vehicle_identifiers
         WHERE tenant_id = OLD.tenant_id AND vehicle_id = OLD.vehicle_id AND id <> OLD.id
           AND status = 'active' AND deleted_at IS NULL
           AND identifier_type IN ('chassis', 'engine_no', 'fleet_no', 'other')
      ) THEN
        RAISE EXCEPTION 'cannot retire the last identity from active VIN-less vehicle %', OLD.vehicle_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_vehicle_identity_removal() IS
  'BEFORE UPDATE guard on veh.vehicle_identifiers: retiring the last active alternate identity from an active VIN-less vehicle is rejected. Locks the parent vehicle FOR UPDATE to serialize with activation.';
REVOKE EXECUTE ON FUNCTION veh.guard_vehicle_identity_removal() FROM PUBLIC;

CREATE TRIGGER tg_vehicle_identifiers_identity_removal
  BEFORE UPDATE ON veh.vehicle_identifiers
  FOR EACH ROW EXECUTE FUNCTION veh.guard_vehicle_identity_removal();

CREATE TRIGGER tg_vehicles_activation_guard
  BEFORE INSERT OR UPDATE OF lifecycle_status ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION veh.guard_vehicle_activation();

-- ----------------------------------------------------------------------------
-- RLS — tenant isolation + restricted-row sensitive gate (read AND write).
-- ----------------------------------------------------------------------------
ALTER TABLE veh.vehicle_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicle_identifiers FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_identifiers_tenant ON veh.vehicle_identifiers
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view'))
  );
CREATE POLICY ins_vehicle_identifiers_tenant ON veh.vehicle_identifiers
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view'))
  );
CREATE POLICY upd_vehicle_identifiers_tenant ON veh.vehicle_identifiers
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view'))
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view'))
  );
GRANT SELECT, INSERT, UPDATE ON veh.vehicle_identifiers TO app_runtime;
GRANT SELECT ON veh.vehicle_identifiers TO app_readonly;
