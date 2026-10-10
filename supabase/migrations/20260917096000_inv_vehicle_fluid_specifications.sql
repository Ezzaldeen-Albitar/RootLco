-- ============================================================================
-- Phase: 1-32 (preparatory) — material demand control, slice 3a
-- Migration: inv.vehicle_fluid_specifications — attributable service capacities
-- Tasks: P1-32-PRE-121
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once a
--   material requirement cites a specification. No down script.
--
-- Purpose
--   How much oil an oil change takes depends on the vehicle, the engine and the
--   service, and nothing in this schema recorded it. A requirement that had to
--   invent the figure would be a guess; a requirement that defaulted it to zero
--   would block the job; one that left it empty would, in an application that read
--   "empty" as "no limit", allow anything. All three are refused here.
--
--     * A CAPACITY IS A FACT WITH A SOURCE. Each row binds a make, optionally a
--       model, a model-year range and an engine variant, a service condition and
--       optionally the item family it is for, to a capacity, its unit, and the
--       source reference it was read from. `capacity > 0`: there is no zero default
--       to fall back on.
--
--     * RECORDED IS NOT CONFIRMED. A row is `recorded` until someone confirms it,
--       and confirmation is attributable (`confirmed_by`, `confirmed_at`). Only a
--       CONFIRMED row resolves, so a figure somebody typed and nobody confirmed
--       never becomes an allowance.
--
--     * ONE CONFIRMED ANSWER PER SIGNATURE. Two confirmed rows with the same make,
--       model, engine variant, service condition and item family may not overlap in
--       model year (`ex_vehicle_fluid_specifications_confirmed_overlap`), so a
--       resolution can never face two different capacities for the same vehicle.
--       A change is a new row, and the old one is retired rather than edited.
--
--     * MOST SPECIFIC WINS. `inv.resolve_vehicle_fluid_specification` prefers a
--       model-specific row to a make-wide one, then an engine-specific row, then an
--       item-family row, then the narrowest year range — and returns NO ROW when
--       nothing confirmed matches, which the caller turns into "approval required".
--
-- Dependencies
--   veh.makes, veh.models (20260720091000); inv.units_of_measure,
--   inv.item_categories (20260723093000); btree_gist (0001); org.tenants;
--   iam.current_tenant_id / current_user_id; shared.touch_row_metadata;
--   org.guard_immutable_columns.
-- ============================================================================

CREATE TABLE inv.vehicle_fluid_specifications (
  id                uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid    NOT NULL,
  make_id           uuid    NOT NULL,
  model_id          uuid    NULL,
  model_year_from   integer NULL,
  model_year_to     integer NULL,
  engine_variant    text    NULL,
  service_condition text    NOT NULL,
  item_category_id  uuid    NULL,
  capacity          numeric(12, 3) NOT NULL,
  uom_id            uuid    NOT NULL,
  source_reference  text    NOT NULL,
  status            text    NOT NULL DEFAULT 'recorded',
  confirmed_by      uuid    NULL,
  confirmed_at      timestamptz NULL,
  retired_by        uuid    NULL,
  retired_at        timestamptz NULL,
  record_version    integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid    NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid    NULL,

  CONSTRAINT pk_vehicle_fluid_specifications PRIMARY KEY (id),
  CONSTRAINT uq_vehicle_fluid_specifications_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_vehicle_fluid_specifications_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_fluid_specifications_make FOREIGN KEY (make_id) REFERENCES veh.makes (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_fluid_specifications_model FOREIGN KEY (model_id) REFERENCES veh.models (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_fluid_specifications_category FOREIGN KEY (tenant_id, item_category_id) REFERENCES inv.item_categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_fluid_specifications_uom FOREIGN KEY (uom_id) REFERENCES inv.units_of_measure (id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_fluid_specifications_capacity CHECK (capacity > 0),
  CONSTRAINT ck_vehicle_fluid_specifications_years CHECK (
    (model_year_from IS NULL OR model_year_from > 0)
    AND (model_year_to IS NULL OR model_year_to > 0)
    AND (model_year_from IS NULL OR model_year_to IS NULL OR model_year_from <= model_year_to)),
  CONSTRAINT ck_vehicle_fluid_specifications_engine_not_blank CHECK (engine_variant IS NULL OR btrim(engine_variant) <> ''),
  CONSTRAINT ck_vehicle_fluid_specifications_condition_format CHECK (service_condition ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_vehicle_fluid_specifications_source_not_blank CHECK (btrim(source_reference) <> ''),
  CONSTRAINT ck_vehicle_fluid_specifications_status CHECK (status IN ('recorded', 'confirmed', 'retired')),
  CONSTRAINT ck_vehicle_fluid_specifications_confirmed_pair CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT ck_vehicle_fluid_specifications_confirmed CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  CONSTRAINT ck_vehicle_fluid_specifications_retired CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  CONSTRAINT ck_vehicle_fluid_specifications_retired_pair CHECK ((retired_by IS NULL) = (retired_at IS NULL)),
  CONSTRAINT ex_vehicle_fluid_specifications_confirmed_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    make_id WITH =,
    (COALESCE(model_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (COALESCE(engine_variant, '')) WITH =,
    service_condition WITH =,
    (COALESCE(item_category_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    int4range(model_year_from, model_year_to, '[]') WITH &&
  ) WHERE (status = 'confirmed')
);
COMMENT ON TABLE inv.vehicle_fluid_specifications IS 'An attributable service capacity: make, optional model, model-year range and engine variant, a service condition and an optional item family, bound to a capacity (> 0), its unit and the source it was read from. Only a CONFIRMED row resolves; confirmed rows with one signature cannot overlap in model year. A change is a new row; the old one is retired.';
COMMENT ON COLUMN inv.vehicle_fluid_specifications.service_condition IS 'The service the capacity is for, as a code (an oil change with a filter and one without are different conditions).';
COMMENT ON COLUMN inv.vehicle_fluid_specifications.source_reference IS 'Where the capacity was read: a manufacturer manual, a service bulletin. Required; a capacity nobody can attribute is not accepted.';

CREATE INDEX ix_vehicle_fluid_specifications_make ON inv.vehicle_fluid_specifications (make_id);
CREATE INDEX ix_vehicle_fluid_specifications_model ON inv.vehicle_fluid_specifications (model_id);
CREATE INDEX ix_vehicle_fluid_specifications_category ON inv.vehicle_fluid_specifications (tenant_id, item_category_id);
CREATE INDEX ix_vehicle_fluid_specifications_uom ON inv.vehicle_fluid_specifications (uom_id);
CREATE INDEX ix_vehicle_fluid_specifications_lookup ON inv.vehicle_fluid_specifications (tenant_id, make_id, service_condition) WHERE status = 'confirmed';

-- The make, the model and the unit must be visible to the row's tenant; a model
-- must belong to the make; and the status graph is recorded -> confirmed ->
-- retired, with recorded -> retired allowed and retired terminal.
CREATE OR REPLACE FUNCTION inv.guard_vehicle_fluid_specification()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_scope text; v_tenant uuid; v_model_make uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'inv.vehicle_fluid_specifications: retired is terminal' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'confirmed' AND NEW.status = 'recorded' THEN
      RAISE EXCEPTION 'inv.vehicle_fluid_specifications: a confirmed specification cannot return to recorded' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'recorded' THEN
    RAISE EXCEPTION 'inv.vehicle_fluid_specifications: a specification is born recorded and confirmed as a separate act' USING ERRCODE = 'check_violation';
  END IF;
  SELECT scope, tenant_id INTO v_scope, v_tenant FROM veh.makes WHERE id = NEW.make_id AND deleted_at IS NULL;
  IF NOT FOUND OR (v_scope = 'tenant' AND v_tenant IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'inv.vehicle_fluid_specifications: make % is not visible to this tenant', NEW.make_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.model_id IS NOT NULL THEN
    SELECT scope, tenant_id, make_id INTO v_scope, v_tenant, v_model_make FROM veh.models WHERE id = NEW.model_id AND deleted_at IS NULL;
    IF NOT FOUND OR (v_scope = 'tenant' AND v_tenant IS DISTINCT FROM NEW.tenant_id) THEN
      RAISE EXCEPTION 'inv.vehicle_fluid_specifications: model % is not visible to this tenant', NEW.model_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_model_make <> NEW.make_id THEN
      RAISE EXCEPTION 'inv.vehicle_fluid_specifications: model % does not belong to make %', NEW.model_id, NEW.make_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT scope, tenant_id INTO v_scope, v_tenant FROM inv.units_of_measure WHERE id = NEW.uom_id AND deleted_at IS NULL;
  IF NOT FOUND OR (v_scope = 'tenant' AND v_tenant IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'inv.vehicle_fluid_specifications: unit % is not visible to this tenant', NEW.uom_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_vehicle_fluid_specification() FROM PUBLIC;

CREATE TRIGGER tg_vehicle_fluid_specifications_guard BEFORE INSERT OR UPDATE ON inv.vehicle_fluid_specifications
  FOR EACH ROW EXECUTE FUNCTION inv.guard_vehicle_fluid_specification();
CREATE TRIGGER tg_vehicle_fluid_specifications_touch_metadata BEFORE UPDATE ON inv.vehicle_fluid_specifications
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_vehicle_fluid_specifications_immutable BEFORE UPDATE ON inv.vehicle_fluid_specifications
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'make_id', 'model_id', 'model_year_from', 'model_year_to', 'engine_variant',
    'service_condition', 'item_category_id', 'capacity', 'uom_id', 'source_reference',
    'created_at', 'created_by');

ALTER TABLE inv.vehicle_fluid_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.vehicle_fluid_specifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_fluid_specifications_tenant ON inv.vehicle_fluid_specifications FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicle_fluid_specifications_tenant ON inv.vehicle_fluid_specifications FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_vehicle_fluid_specifications_tenant ON inv.vehicle_fluid_specifications FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.vehicle_fluid_specifications TO app_runtime;
GRANT SELECT ON inv.vehicle_fluid_specifications TO app_readonly;

-- ----------------------------------------------------------------------------
-- Operations
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.record_vehicle_fluid_specification(
  p_make uuid, p_model uuid, p_model_year_from integer, p_model_year_to integer,
  p_engine_variant text, p_service_condition text, p_item_category uuid,
  p_capacity numeric, p_uom uuid, p_source_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.record_vehicle_fluid_specification requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_capacity IS NULL OR p_capacity <= 0 THEN
    RAISE EXCEPTION 'a specification needs a known positive capacity; an unknown capacity is not recorded as zero' USING ERRCODE = 'check_violation';
  END IF;
  IF p_source_reference IS NULL OR btrim(p_source_reference) = '' THEN
    RAISE EXCEPTION 'a specification needs the source its capacity was read from' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO inv.vehicle_fluid_specifications (
    tenant_id, make_id, model_id, model_year_from, model_year_to, engine_variant, service_condition,
    item_category_id, capacity, uom_id, source_reference, created_by)
    VALUES (v_tenant, p_make, p_model, p_model_year_from, p_model_year_to, NULLIF(btrim(p_engine_variant), ''),
            p_service_condition, p_item_category, p_capacity, p_uom, btrim(p_source_reference), iam.current_user_id())
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.record_vehicle_fluid_specification(uuid, uuid, integer, integer, text, text, uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.record_vehicle_fluid_specification(uuid, uuid, integer, integer, text, text, uuid, numeric, uuid, text) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.confirm_vehicle_fluid_specification(p_specification uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.confirm_vehicle_fluid_specification requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT status INTO v_status FROM inv.vehicle_fluid_specifications WHERE tenant_id = v_tenant AND id = p_specification FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'specification % not found', p_specification USING ERRCODE = 'foreign_key_violation'; END IF;
  IF v_status <> 'recorded' THEN RAISE EXCEPTION 'specification is % (must be recorded)', v_status USING ERRCODE = 'check_violation'; END IF;
  UPDATE inv.vehicle_fluid_specifications
     SET status = 'confirmed', confirmed_by = iam.current_user_id(), confirmed_at = now()
   WHERE tenant_id = v_tenant AND id = p_specification;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.confirm_vehicle_fluid_specification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.confirm_vehicle_fluid_specification(uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.retire_vehicle_fluid_specification(p_specification uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.retire_vehicle_fluid_specification requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT status INTO v_status FROM inv.vehicle_fluid_specifications WHERE tenant_id = v_tenant AND id = p_specification FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'specification % not found', p_specification USING ERRCODE = 'foreign_key_violation'; END IF;
  IF v_status = 'retired' THEN RAISE EXCEPTION 'specification is already retired' USING ERRCODE = 'check_violation'; END IF;
  UPDATE inv.vehicle_fluid_specifications
     SET status = 'retired', retired_by = iam.current_user_id(), retired_at = now()
   WHERE tenant_id = v_tenant AND id = p_specification;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.retire_vehicle_fluid_specification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.retire_vehicle_fluid_specification(uuid) TO app_runtime;

-- The one confirmed specification that answers for a vehicle, most specific first,
-- or NO ROW. A vehicle with no model year matches only rows that bound no year:
-- a range cannot be said to contain a year nobody recorded.
CREATE OR REPLACE FUNCTION inv.resolve_vehicle_fluid_specification(
  p_tenant uuid, p_make uuid, p_model uuid, p_model_year integer,
  p_engine_variant text, p_service_condition text, p_item_category uuid)
RETURNS TABLE (specification_id uuid, capacity numeric, uom_id uuid, source_reference text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.id, s.capacity, s.uom_id, s.source_reference
    FROM inv.vehicle_fluid_specifications s
   WHERE s.tenant_id = p_tenant
     AND s.status = 'confirmed'
     AND s.make_id = p_make
     AND (s.model_id IS NULL OR s.model_id = p_model)
     AND (s.engine_variant IS NULL OR s.engine_variant = p_engine_variant)
     AND s.service_condition = p_service_condition
     AND (s.item_category_id IS NULL OR s.item_category_id = p_item_category)
     AND (CASE WHEN p_model_year IS NULL
               THEN s.model_year_from IS NULL AND s.model_year_to IS NULL
               ELSE int4range(s.model_year_from, s.model_year_to, '[]') @> p_model_year END)
   ORDER BY (s.model_id IS NOT NULL) DESC,
            (s.engine_variant IS NOT NULL) DESC,
            (s.item_category_id IS NOT NULL) DESC,
            (s.model_year_from IS NOT NULL AND s.model_year_to IS NOT NULL) DESC,
            (COALESCE(s.model_year_to, 100000) - COALESCE(s.model_year_from, 0)) ASC,
            s.confirmed_at DESC, s.id
   LIMIT 1
$$;
COMMENT ON FUNCTION inv.resolve_vehicle_fluid_specification(uuid, uuid, uuid, integer, text, text, uuid) IS 'The most specific CONFIRMED specification for a vehicle and service, or no row. Never a default.';
REVOKE EXECUTE ON FUNCTION inv.resolve_vehicle_fluid_specification(uuid, uuid, uuid, integer, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.resolve_vehicle_fluid_specification(uuid, uuid, uuid, integer, text, text, uuid) TO app_runtime, app_readonly;
