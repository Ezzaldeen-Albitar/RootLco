-- ============================================================================
-- Phase: 1-32 (preparatory) — material demand control, slice 3a
-- Migration: inv.item_unit_conversions — exact, attributable unit conversions
-- Tasks: P1-32-PRE-120
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once a
--   material request has recorded a factor read from a conversion row. No down
--   script.
--
-- Purpose
--   A material requirement is stated in the unit its source uses — a service
--   specification says "4.500 litre" — while stock is issued in the unit the item
--   is stocked in, which may be a pack, a bottle or a drum. Nothing in `inv` could
--   say how many litres a pack of a given oil holds, so an allowance in litres could
--   not be compared with an issue in packs at all, and any comparison an application
--   invented would be a guess.
--
--     * ONE FACTOR, EXACT, IN ONE DIRECTION. A row says "1 from-unit = factor
--       to-units" as numeric(24, 12). There is no float anywhere and no implied
--       reverse: 1 / factor is not exact in general, so a conversion the other way
--       is a row of its own, with its own source. `inv.unit_conversion_factor`
--       answers ONLY what a row states and returns NULL for anything else — an
--       unsupported conversion is reported as unsupported, never approximated.
--
--     * ITEM-SPECIFIC BEATS TENANT-WIDE. A pack is a number of litres only for a
--       particular item, so a conversion that crosses dimensions (count to volume)
--       must name the item. A tenant-wide row may only convert within one dimension
--       (millilitre to litre), where the relation holds for every item.
--
--     * ONE LIVE ROW PER SIGNATURE, AND NO LIVE CONTRADICTION. A live row per
--       (tenant, item, from, to) is unique, and a live row whose exact reverse is
--       also live is refused: two live rows for A->B and B->A could disagree, and
--       the database would then hold two answers to one question.
--
--     * REPRESENTABLE OR REFUSED. `inv.convert_item_quantity` returns NULL when the
--       converted value does not fit the quantity scale of three decimals exactly,
--       rather than rounding a quantity someone will be held to.
--
-- Dependencies
--   inv.units_of_measure, inv.item_master (20260723093000); org.tenants;
--   iam.current_tenant_id / current_user_id; shared.touch_row_metadata;
--   org.guard_immutable_columns.
-- ============================================================================

CREATE TABLE inv.item_unit_conversions (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid    NOT NULL,
  item_id          uuid    NULL,
  from_uom_id      uuid    NOT NULL,
  to_uom_id        uuid    NOT NULL,
  factor           numeric(24, 12) NOT NULL,
  source_reference text    NOT NULL,
  status           text    NOT NULL DEFAULT 'active',
  retired_at       timestamptz NULL,
  retired_by       uuid    NULL,
  record_version   integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid    NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid    NULL,

  CONSTRAINT pk_item_unit_conversions PRIMARY KEY (id),
  CONSTRAINT uq_item_unit_conversions_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_item_unit_conversions_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_unit_conversions_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_unit_conversions_from_uom FOREIGN KEY (from_uom_id) REFERENCES inv.units_of_measure (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_unit_conversions_to_uom FOREIGN KEY (to_uom_id) REFERENCES inv.units_of_measure (id) ON DELETE RESTRICT,
  CONSTRAINT ck_item_unit_conversions_distinct_units CHECK (from_uom_id <> to_uom_id),
  CONSTRAINT ck_item_unit_conversions_factor CHECK (factor > 0),
  CONSTRAINT ck_item_unit_conversions_source_not_blank CHECK (btrim(source_reference) <> ''),
  CONSTRAINT ck_item_unit_conversions_status CHECK (status IN ('active', 'retired')),
  CONSTRAINT ck_item_unit_conversions_retired CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  CONSTRAINT ck_item_unit_conversions_retired_by CHECK ((retired_at IS NULL) = (retired_by IS NULL))
);
COMMENT ON TABLE inv.item_unit_conversions IS 'An exact, attributable unit conversion: 1 from-unit = factor to-units, numeric(24,12). Item-specific when item_id is set (required when the two units measure different dimensions, e.g. a pack of an oil to litres); tenant-wide within one dimension otherwise. One direction per row — no implied reverse. One live row per (tenant, item, from, to), and a live row whose exact reverse is live is refused.';
COMMENT ON COLUMN inv.item_unit_conversions.factor IS 'How many to-units ONE from-unit is, exactly. Never a float, never inverted by the database.';
COMMENT ON COLUMN inv.item_unit_conversions.source_reference IS 'Where the factor comes from (a manufacturer data sheet, a pack label). A conversion nobody can attribute is not accepted.';

CREATE UNIQUE INDEX uq_item_unit_conversions_live ON inv.item_unit_conversions (tenant_id, item_id, from_uom_id, to_uom_id)
  NULLS NOT DISTINCT WHERE status = 'active';
CREATE INDEX ix_item_unit_conversions_item ON inv.item_unit_conversions (tenant_id, item_id);
CREATE INDEX ix_item_unit_conversions_from_uom ON inv.item_unit_conversions (from_uom_id);
CREATE INDEX ix_item_unit_conversions_to_uom ON inv.item_unit_conversions (to_uom_id);

-- Both units must be visible to the row's tenant, a tenant-wide row may not cross
-- dimensions, a live row may not contradict a live reverse, and `retired` is
-- terminal. Keyed on NEW.tenant_id so the guard binds in a session with no GUC.
CREATE OR REPLACE FUNCTION inv.guard_item_unit_conversion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_from_scope text; v_from_tenant uuid; v_from_dim text;
        v_to_scope text; v_to_tenant uuid; v_to_dim text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'inv.item_unit_conversions: retired is terminal' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT scope, tenant_id, dimension INTO v_from_scope, v_from_tenant, v_from_dim
    FROM inv.units_of_measure WHERE id = NEW.from_uom_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.item_unit_conversions: unit % not found', NEW.from_uom_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT scope, tenant_id, dimension INTO v_to_scope, v_to_tenant, v_to_dim
    FROM inv.units_of_measure WHERE id = NEW.to_uom_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.item_unit_conversions: unit % not found', NEW.to_uom_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF (v_from_scope = 'tenant' AND v_from_tenant IS DISTINCT FROM NEW.tenant_id)
     OR (v_to_scope = 'tenant' AND v_to_tenant IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'inv.item_unit_conversions: a unit of another tenant cannot be converted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.item_id IS NULL AND v_from_dim <> v_to_dim THEN
    RAISE EXCEPTION 'inv.item_unit_conversions: converting % to % crosses dimensions and must name the item it holds for', v_from_dim, v_to_dim
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM inv.item_unit_conversions r
     WHERE r.tenant_id = NEW.tenant_id AND r.item_id IS NOT DISTINCT FROM NEW.item_id
       AND r.from_uom_id = NEW.to_uom_id AND r.to_uom_id = NEW.from_uom_id AND r.status = 'active'
  ) THEN
    RAISE EXCEPTION 'inv.item_unit_conversions: the reverse conversion is already live; retire it before stating this direction'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_item_unit_conversion() FROM PUBLIC;

CREATE TRIGGER tg_item_unit_conversions_guard BEFORE INSERT OR UPDATE ON inv.item_unit_conversions
  FOR EACH ROW EXECUTE FUNCTION inv.guard_item_unit_conversion();
CREATE TRIGGER tg_item_unit_conversions_touch_metadata BEFORE UPDATE ON inv.item_unit_conversions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_item_unit_conversions_immutable BEFORE UPDATE ON inv.item_unit_conversions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'item_id', 'from_uom_id', 'to_uom_id', 'factor', 'source_reference', 'created_at', 'created_by');

ALTER TABLE inv.item_unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_unit_conversions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_item_unit_conversions_tenant ON inv.item_unit_conversions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_item_unit_conversions_tenant ON inv.item_unit_conversions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_item_unit_conversions_tenant ON inv.item_unit_conversions FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.item_unit_conversions TO app_runtime;
GRANT SELECT ON inv.item_unit_conversions TO app_readonly;

-- ----------------------------------------------------------------------------
-- Resolution. The tenant is an ARGUMENT, as in inv.returned_quantity: a trigger
-- resolves a factor for the row it is handed, in a session with or without a GUC.
-- ----------------------------------------------------------------------------

-- How many to-units one from-unit of this item is. 1 when the units are the same;
-- the live item-specific row when there is one; the live tenant-wide row
-- otherwise; NULL when no row states the conversion. Never the reverse of a row.
CREATE OR REPLACE FUNCTION inv.unit_conversion_factor(p_tenant uuid, p_item uuid, p_from uuid, p_to uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN NULL
    WHEN p_from = p_to THEN 1::numeric
    ELSE COALESCE(
      (SELECT c.factor FROM inv.item_unit_conversions c
        WHERE c.tenant_id = p_tenant AND c.item_id = p_item
          AND c.from_uom_id = p_from AND c.to_uom_id = p_to AND c.status = 'active'),
      (SELECT c.factor FROM inv.item_unit_conversions c
        WHERE c.tenant_id = p_tenant AND c.item_id IS NULL
          AND c.from_uom_id = p_from AND c.to_uom_id = p_to AND c.status = 'active'))
  END
$$;
COMMENT ON FUNCTION inv.unit_conversion_factor(uuid, uuid, uuid, uuid) IS 'The exact factor a live conversion row states for (item, from, to), item-specific first; 1 for the same unit; NULL when no row states it. Never inverts a row.';
REVOKE EXECUTE ON FUNCTION inv.unit_conversion_factor(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.unit_conversion_factor(uuid, uuid, uuid, uuid) TO app_runtime, app_readonly;

-- A quantity of this item in another unit, exactly — or NULL when no row states the
-- conversion or when the result is not representable at the quantity scale.
CREATE OR REPLACE FUNCTION inv.convert_item_quantity(p_tenant uuid, p_item uuid, p_quantity numeric, p_from uuid, p_to uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_factor numeric; v_result numeric;
BEGIN
  IF p_quantity IS NULL THEN RETURN NULL; END IF;
  v_factor := inv.unit_conversion_factor(p_tenant, p_item, p_from, p_to);
  IF v_factor IS NULL THEN RETURN NULL; END IF;
  v_result := p_quantity * v_factor;
  IF v_result <> round(v_result, 3) THEN RETURN NULL; END IF;
  RETURN round(v_result, 3);
END; $$;
COMMENT ON FUNCTION inv.convert_item_quantity(uuid, uuid, numeric, uuid, uuid) IS 'p_quantity * the exact factor, or NULL when the conversion is unsupported or the product has more than three decimals. Nothing is rounded.';
REVOKE EXECUTE ON FUNCTION inv.convert_item_quantity(uuid, uuid, numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.convert_item_quantity(uuid, uuid, numeric, uuid, uuid) TO app_runtime, app_readonly;

-- State a conversion: the live row with the same signature is retired in the same
-- transaction, so a changed factor is a new attributable row and the old one stays.
CREATE OR REPLACE FUNCTION inv.set_item_unit_conversion(
  p_item uuid, p_from uuid, p_to uuid, p_factor numeric, p_source_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id(); v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.set_item_unit_conversion requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_factor IS NULL OR p_factor <= 0 THEN
    RAISE EXCEPTION 'a unit conversion needs a positive exact factor' USING ERRCODE = 'check_violation';
  END IF;
  IF p_source_reference IS NULL OR btrim(p_source_reference) = '' THEN
    RAISE EXCEPTION 'a unit conversion needs the source its factor comes from' USING ERRCODE = 'check_violation';
  END IF;
  -- Serialize writers of one signature, so two concurrent setters cannot both
  -- find nothing to retire and then collide on the live index.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'inv.item_unit_conversions:' || v_tenant::text || ':' || COALESCE(p_item::text, '-') || ':' || p_from::text || ':' || p_to::text));
  UPDATE inv.item_unit_conversions
     SET status = 'retired', retired_at = now(), retired_by = v_actor
   WHERE tenant_id = v_tenant AND item_id IS NOT DISTINCT FROM p_item
     AND from_uom_id = p_from AND to_uom_id = p_to AND status = 'active';
  INSERT INTO inv.item_unit_conversions (tenant_id, item_id, from_uom_id, to_uom_id, factor, source_reference, created_by)
    VALUES (v_tenant, p_item, p_from, p_to, p_factor, btrim(p_source_reference), v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.set_item_unit_conversion(uuid, uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.set_item_unit_conversion(uuid, uuid, uuid, numeric, text) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.retire_item_unit_conversion(p_conversion uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.retire_item_unit_conversion requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT status INTO v_status FROM inv.item_unit_conversions WHERE tenant_id = v_tenant AND id = p_conversion FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit conversion % not found', p_conversion USING ERRCODE = 'foreign_key_violation'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'unit conversion is % (must be active)', v_status USING ERRCODE = 'check_violation'; END IF;
  UPDATE inv.item_unit_conversions SET status = 'retired', retired_at = now(), retired_by = iam.current_user_id()
   WHERE tenant_id = v_tenant AND id = p_conversion;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.retire_item_unit_conversion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.retire_item_unit_conversion(uuid) TO app_runtime;
