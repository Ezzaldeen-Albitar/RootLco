-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: append-only Vehicle attribute history (trigger-populated)
-- Tasks: P1-07-DB-005
-- Owner module: veh
--
-- Purpose
--   veh.vehicle_attribute_history records each change to an approved veh.vehicles
--   master attribute (VIN, catalog references, model year, body/powertrain, color,
--   lifecycle/workshop status). Rows are written ONLY by an AFTER UPDATE trigger on
--   veh.vehicles, in the same transaction as the change; a no-op update writes
--   nothing. Only internal master attributes are tracked — restricted identifiers
--   live in veh.vehicle_identifiers and are never master columns, so no restricted
--   value can enter this internal-classified history.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once history exists. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; iam.current_tenant_id;
--   shared.stamp_status_history (server-stamps actor_id + occurred_at).
--
-- Details
--   Append-only: SELECT+INSERT grants only; UPDATE/DELETE raise 42501. actor_id
--   and occurred_at server-stamped; monotonic seq for deterministic same-tx order.
--   old_value/new_value are text renderings of the changed column.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped sel/ins policies; no upd/del.
--   * The emit trigger is SECURITY INVOKER, so the history INSERT runs under the
--     updating user's RLS and attribution; no client can forge a history row for
--     a change that did not happen (rows only appear alongside a real UPDATE).
--
-- Objects created
--   Tables:    veh.vehicle_attribute_history
--   Functions: veh.emit_vehicle_attribute_history()
--   Triggers:  tg_vehicle_attribute_history_stamp, tg_vehicles_attribute_history
--   Policies:  sel_vehicle_attribute_history_tenant, ins_vehicle_attribute_history_tenant
--   Indexes:   ix_vehicle_attribute_history_vehicle
-- ============================================================================

CREATE TABLE veh.vehicle_attribute_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  vehicle_id     uuid        NOT NULL,
  field_code     text        NOT NULL,
  old_value      text        NULL,
  new_value      text        NULL,
  correlation_id uuid        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_vehicle_attribute_history PRIMARY KEY (id),
  CONSTRAINT fk_vehicle_attribute_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_attribute_history_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_attribute_history_field_not_blank CHECK (btrim(field_code) <> '')
);

COMMENT ON TABLE veh.vehicle_attribute_history IS
  'Phase 1-7 append-only Vehicle attribute history (P1-07-DB-005). Trigger-populated on approved master attribute changes only (internal fields); server-stamped; monotonic seq. No restricted identifier value can appear (restricted identifiers are not master columns).';

CREATE INDEX ix_vehicle_attribute_history_vehicle
  ON veh.vehicle_attribute_history (tenant_id, vehicle_id, occurred_at DESC, seq DESC);

CREATE TRIGGER tg_vehicle_attribute_history_stamp
  BEFORE INSERT ON veh.vehicle_attribute_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE veh.vehicle_attribute_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicle_attribute_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_attribute_history_tenant ON veh.vehicle_attribute_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicle_attribute_history_tenant ON veh.vehicle_attribute_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON veh.vehicle_attribute_history TO app_runtime;
GRANT SELECT ON veh.vehicle_attribute_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- Emit trigger: one history row per changed tracked attribute, same transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.emit_vehicle_attribute_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
BEGIN
  IF NEW.vin_normalized IS DISTINCT FROM OLD.vin_normalized THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'vin_normalized', OLD.vin_normalized, NEW.vin_normalized, v_correlation);
  END IF;
  IF NEW.make_id IS DISTINCT FROM OLD.make_id THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'make_id', OLD.make_id::text, NEW.make_id::text, v_correlation);
  END IF;
  IF NEW.model_id IS DISTINCT FROM OLD.model_id THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'model_id', OLD.model_id::text, NEW.model_id::text, v_correlation);
  END IF;
  IF NEW.trim_id IS DISTINCT FROM OLD.trim_id THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'trim_id', OLD.trim_id::text, NEW.trim_id::text, v_correlation);
  END IF;
  IF NEW.model_year IS DISTINCT FROM OLD.model_year THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'model_year', OLD.model_year::text, NEW.model_year::text, v_correlation);
  END IF;
  IF NEW.body_type_id IS DISTINCT FROM OLD.body_type_id THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'body_type_id', OLD.body_type_id::text, NEW.body_type_id::text, v_correlation);
  END IF;
  IF NEW.powertrain_type_id IS DISTINCT FROM OLD.powertrain_type_id THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'powertrain_type_id', OLD.powertrain_type_id::text, NEW.powertrain_type_id::text, v_correlation);
  END IF;
  IF NEW.powertrain_category IS DISTINCT FROM OLD.powertrain_category THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'powertrain_category', OLD.powertrain_category, NEW.powertrain_category, v_correlation);
  END IF;
  IF NEW.color IS DISTINCT FROM OLD.color THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'color', OLD.color, NEW.color, v_correlation);
  END IF;
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'lifecycle_status', OLD.lifecycle_status, NEW.lifecycle_status, v_correlation);
  END IF;
  IF NEW.workshop_status IS DISTINCT FROM OLD.workshop_status THEN
    INSERT INTO veh.vehicle_attribute_history (tenant_id, vehicle_id, field_code, old_value, new_value, correlation_id)
    VALUES (NEW.tenant_id, NEW.id, 'workshop_status', OLD.workshop_status, NEW.workshop_status, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION veh.emit_vehicle_attribute_history() IS
  'AFTER UPDATE trigger on veh.vehicles: writes one append-only history row per changed tracked master attribute, in the same transaction. No-op updates write nothing.';
REVOKE EXECUTE ON FUNCTION veh.emit_vehicle_attribute_history() FROM PUBLIC;

CREATE TRIGGER tg_vehicles_attribute_history
  AFTER UPDATE ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION veh.emit_vehicle_attribute_history();
