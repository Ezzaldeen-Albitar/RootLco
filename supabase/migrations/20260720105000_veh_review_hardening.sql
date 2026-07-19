-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: red-team review hardening (forward correction)
-- Tasks: P1-07 red-team findings RT-1, RT-2, RT-3
-- Owner module: veh
--
-- Rollback classification: ROLLBACK-SAFE (replaces two guard functions and
--   re-creates their triggers with wider firing columns; no data change).
--   Forward-only — no down script.
--
-- Purpose
--   Closes two HIGH red-team findings and corrects one comment overclaim:
--
--   RT-1 (High): tg_vehicles_activation_guard fired only on INSERT OR UPDATE OF
--   lifecycle_status, so `UPDATE veh.vehicles SET vin_raw = NULL` on an ACTIVE
--   identifier-less Vehicle silently produced an active Vehicle with zero
--   identity (CR-VEH-03 bypass). The guard now also fires on UPDATE OF vin_raw
--   and re-validates whenever an active Vehicle's VIN changes.
--
--   RT-2 (High): tg_vehicle_ev_profiles_powertrain did not fire on UPDATE OF
--   deleted_at, so soft-delete profile -> change powertrain to ice ->
--   un-delete profile committed a live bev profile on an ICE Vehicle. The
--   guard now fires on deleted_at too and validates whenever the row is (or
--   becomes) live; a dying row (NEW.deleted_at IS NOT NULL) needs no
--   compatibility.
--
--   RT-3 (Medium, honesty): veh.valid_match_basis's comment claimed "no raw
--   identifier values"; the DB control is a heuristic (sensitive-key scan +
--   length bound) — a short raw value under an innocuous key passes. The
--   comment now states the defense-in-depth posture accurately; the backend
--   sanitizer remains the primary control (accepted Medium, abuse record).
--
-- Dependencies
--   20260720093000 (guard_vehicle_activation), 20260720097000
--   (guard_ev_profile_powertrain), 20260720104000 (valid_match_basis).
--
-- Security implications
--   * Strictly tightens enforcement; no grant/policy change.
--
-- Objects created
--   (none new) Functions replaced: veh.guard_vehicle_activation(),
--   veh.guard_ev_profile_powertrain(). Triggers re-created:
--   tg_vehicles_activation_guard, tg_vehicle_ev_profiles_powertrain.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RT-1: activation guard also protects VIN removal/change on an active Vehicle.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_vehicle_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.lifecycle_status = 'active'
     AND (
       TG_OP = 'INSERT'
       OR OLD.lifecycle_status <> 'active'
       OR NEW.vin_raw IS DISTINCT FROM OLD.vin_raw
     ) THEN
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
      RAISE EXCEPTION 'vehicle % cannot be active without a normalized VIN or an active alternate identifier', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_vehicle_activation() IS
  'BEFORE INSERT/UPDATE guard on veh.vehicles: an active vehicle requires a normalized VIN or an active alternate identifier — enforced on activation AND on any VIN change while active (RT-1). The UPDATE path holds the vehicle row lock, serializing with identity-removal.';

DROP TRIGGER tg_vehicles_activation_guard ON veh.vehicles;
CREATE TRIGGER tg_vehicles_activation_guard
  BEFORE INSERT OR UPDATE OF lifecycle_status, vin_raw ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION veh.guard_vehicle_activation();

-- ----------------------------------------------------------------------------
-- RT-2: EV-profile guard validates whenever the row is (or becomes) live,
-- including un-soft-delete resurrection.
-- ----------------------------------------------------------------------------
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
  -- A dying/dead row needs no powertrain compatibility.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
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
  'BEFORE INSERT/UPDATE guard on veh.vehicle_ev_profiles: whenever the row is (or becomes) live — including un-soft-delete resurrection (RT-2) — the Vehicle powertrain_category must match ev_kind (bev->ev, hybrid->hybrid, phev->phev). Locks the Vehicle FOR SHARE to serialize with powertrain changes.';

DROP TRIGGER tg_vehicle_ev_profiles_powertrain ON veh.vehicle_ev_profiles;
CREATE TRIGGER tg_vehicle_ev_profiles_powertrain
  BEFORE INSERT OR UPDATE OF ev_kind, vehicle_id, tenant_id, deleted_at ON veh.vehicle_ev_profiles
  FOR EACH ROW EXECUTE FUNCTION veh.guard_ev_profile_powertrain();

-- ----------------------------------------------------------------------------
-- RT-3: honest comment on the match-basis validator (defense-in-depth, not a
-- guarantee against every raw value).
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION veh.valid_match_basis(jsonb) IS
  'Positive-schema validator for veh.duplicate_candidates.match_basis: a non-empty array of objects with approved keys (basis/classification/weight/evidence) and approved basis categories; restricted categories cannot be downgraded; evidence rejects sensitive keys (any depth, case-insensitive) and oversized string leaves. DEFENSE-IN-DEPTH ONLY: a short raw value under an innocuous key can pass — the backend sanitizer (P1-17) is the primary control (accepted Medium, abuse record RT-3).';
