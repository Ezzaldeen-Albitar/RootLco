-- ============================================================================
-- Phase: 1-32 (preparatory) — item barcodes and packaging identifiers
-- Migration: inv.item_identifiers, the check-digit and normalisation functions,
--            and the tenant-scoped internal barcode allocator
-- Tasks: P1-32-PRE-100…104
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once an
--   identifier has been printed on a label, because a retired or re-issued code
--   cannot be recalled from the shelf. Forward-only — no down script.
--
-- Purpose
--   An item had exactly one identity, its SKU. A counter or a goods-in bench
--   scans the code printed on the box, which is a manufacturer's GTIN/EAN/UPC, a
--   supplier's own code, or nothing at all. This migration lets an item carry
--   any number of such identifiers, each saying how many base units one scan of
--   it represents, and gives an item with no printed code a stable internal one.
--
--     * NORMALISED ONCE, IN ONE PLACE. `normalized_value` is GENERATED from
--       `value` by `inv.normalize_item_identifier`, which folds Arabic-Indic and
--       Extended Arabic-Indic digits to ASCII, strips whitespace and hyphens, and
--       upper-cases. The resolver normalises what was scanned with the SAME
--       function, so a code typed as "5 012345 678900" and one scanned as
--       "5012345678900" are the same code by construction rather than by a
--       second, drifting copy of the rule in application code.
--
--     * CHECK DIGITS ARE A CONSTRAINT. A GTIN, EAN or UPC with a wrong mod-10
--       check digit is refused by `ck_item_identifiers_check_digit`, so a
--       mistyped manufacturer code cannot be stored and later match nothing — or,
--       worse, match a different product.
--
--     * INTERNAL CODES ARE ALLOCATED, NEVER INVENTED FROM OUTSIDE. The internal
--       code is `RL` + a nine-digit per-tenant counter + a mod-10 check digit,
--       allocated under a per-tenant advisory lock. Manufacturer kinds are only
--       ever entered by a user; nothing here derives one.
--
--     * SERIALISED ITEMS. A scan resolves to the ITEM, never to a unit, whether
--       or not `inv.item_master.is_serialized` is set. No serial-unit table
--       exists, and this migration deliberately does not create one.
--
--     * DUPLICATE FRAMES. A scanner can deliver one physical scan twice. That is
--       a client concern (debounce) plus server idempotency: every write a scan
--       triggers carries the idempotency key the client derives once per user
--       confirmation, and the identifier writes below are idempotent operations.
--
-- Dependencies
--   inv.item_master, inv.units_of_measure (20260723093000); org.tenants;
--   iam.*; org.guard_immutable_columns; shared.touch_row_metadata.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pure functions: normalisation and the mod-10 check digit.
--
--    IMMUTABLE, because a GENERATED column and a CHECK constraint may only call
--    immutable functions, and because they are: the answer depends on the
--    argument alone.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.normalize_item_identifier(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT pg_catalog.upper(
           pg_catalog.regexp_replace(
             pg_catalog.translate(
               p_value,
               U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
               '01234567890123456789'),
             '[[:space:]-]+', '', 'g'))
$$;
COMMENT ON FUNCTION inv.normalize_item_identifier(text) IS
  'Folds Arabic-Indic and Extended Arabic-Indic digits to ASCII, strips whitespace and hyphens, and upper-cases. The single normalisation rule for stored identifiers (GENERATED normalized_value) and for scanned input (the barcode resolver).';
REVOKE EXECUTE ON FUNCTION inv.normalize_item_identifier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.normalize_item_identifier(text) TO app_runtime, app_readonly;

-- The GS1 mod-10 check digit of a string of digits that does NOT include it:
-- weights 3,1,3,1… from the rightmost data digit.
CREATE OR REPLACE FUNCTION inv.mod10_check_digit(p_digits text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE v_sum integer := 0; v_len integer; v_pos integer;
BEGIN
  IF p_digits IS NULL OR p_digits !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;
  v_len := pg_catalog.length(p_digits);
  FOR v_pos IN 1..v_len LOOP
    v_sum := v_sum
      + pg_catalog.substr(p_digits, v_len - v_pos + 1, 1)::integer
        * CASE WHEN v_pos % 2 = 1 THEN 3 ELSE 1 END;
  END LOOP;
  RETURN (10 - (v_sum % 10)) % 10;
END; $$;
COMMENT ON FUNCTION inv.mod10_check_digit(text) IS
  'GS1 mod-10 check digit of a digit string that excludes the check digit (weights 3,1 from the right). NULL for a non-digit input.';
REVOKE EXECUTE ON FUNCTION inv.mod10_check_digit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.mod10_check_digit(text) TO app_runtime, app_readonly;

-- Whether a normalised identifier is well formed for its kind. The two free-text
-- kinds (manufacturer part number, supplier code) have no check digit to verify.
CREATE OR REPLACE FUNCTION inv.item_identifier_is_well_formed(p_kind text, p_normalized text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE v_len integer;
BEGIN
  IF p_normalized IS NULL OR p_normalized = '' THEN
    RETURN false;
  END IF;
  IF p_kind IN ('manufacturer_part_number', 'supplier_code') THEN
    RETURN true;
  END IF;
  IF p_kind = 'internal' THEN
    RETURN p_normalized ~ '^RL[0-9]{10}$'
      AND inv.mod10_check_digit(pg_catalog.substr(p_normalized, 3, 9))
          = pg_catalog.substr(p_normalized, 12, 1)::integer;
  END IF;
  IF p_normalized !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;
  v_len := pg_catalog.length(p_normalized);
  IF (p_kind = 'gtin' AND v_len NOT IN (8, 12, 13, 14))
     OR (p_kind = 'ean' AND v_len NOT IN (8, 13))
     OR (p_kind = 'upc' AND v_len <> 12) THEN
    RETURN false;
  END IF;
  IF p_kind NOT IN ('gtin', 'ean', 'upc') THEN
    RETURN false;
  END IF;
  RETURN inv.mod10_check_digit(pg_catalog.substr(p_normalized, 1, v_len - 1))
         = pg_catalog.substr(p_normalized, v_len, 1)::integer;
END; $$;
COMMENT ON FUNCTION inv.item_identifier_is_well_formed(text, text) IS
  'Well-formedness of a NORMALISED identifier for its kind: GTIN (8/12/13/14 digits), EAN (8/13) and UPC (12) must carry a valid mod-10 check digit; internal codes are RL + nine digits + a mod-10 check digit; manufacturer part numbers and supplier codes are free text.';
REVOKE EXECUTE ON FUNCTION inv.item_identifier_is_well_formed(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.item_identifier_is_well_formed(text, text) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 2. inv.item_identifiers — tenant-scoped, like the item it identifies.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.item_identifiers (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid    NOT NULL,
  item_id          uuid    NOT NULL,
  identifier_kind  text    NOT NULL,
  value            text    NOT NULL,
  normalized_value text    GENERATED ALWAYS AS (inv.normalize_item_identifier(value)) STORED,
  unit_id          uuid    NOT NULL,
  -- How many BASE units of the item one scan of this code represents: a case
  -- barcode with pack_quantity 12 adds twelve units per scan, the unit barcode one.
  pack_quantity    numeric(12, 3) NOT NULL DEFAULT 1,
  is_primary       boolean NOT NULL DEFAULT false,
  retired_at       timestamptz NULL,
  retired_by       uuid    NULL,
  record_version   integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid    NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid    NULL,

  CONSTRAINT pk_item_identifiers PRIMARY KEY (id),
  CONSTRAINT uq_item_identifiers_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_item_identifiers_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_identifiers_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_identifiers_unit FOREIGN KEY (unit_id) REFERENCES inv.units_of_measure (id) ON DELETE RESTRICT,
  CONSTRAINT ck_item_identifiers_kind CHECK (identifier_kind IN ('internal', 'gtin', 'ean', 'upc', 'manufacturer_part_number', 'supplier_code')),
  CONSTRAINT ck_item_identifiers_value_not_blank CHECK (btrim(value) <> ''),
  CONSTRAINT ck_item_identifiers_value_length CHECK (char_length(value) <= 64),
  CONSTRAINT ck_item_identifiers_check_digit CHECK (inv.item_identifier_is_well_formed(identifier_kind, normalized_value)),
  CONSTRAINT ck_item_identifiers_pack_quantity CHECK (pack_quantity > 0),
  CONSTRAINT ck_item_identifiers_retired CHECK ((retired_at IS NULL) = (retired_by IS NULL)),
  -- An internal code is one base unit by definition: it is printed on the unit.
  CONSTRAINT ck_item_identifiers_internal_pack CHECK (identifier_kind <> 'internal' OR pack_quantity = 1)
);
COMMENT ON TABLE inv.item_identifiers IS 'Barcodes and packaging identifiers of a tenant item. normalized_value is GENERATED by inv.normalize_item_identifier; GTIN/EAN/UPC check digits are a CHECK. A live code is unique per (tenant, kind, normalised value); a retired code frees its value. A scan resolves to the ITEM, never to a serialised unit — no serial-unit table exists.';
COMMENT ON COLUMN inv.item_identifiers.pack_quantity IS 'Base units of the item that one scan of this code represents (a case code carries the case size).';
-- One LIVE row per code within a kind. Retired rows are history and free the value.
CREATE UNIQUE INDEX uq_item_identifiers_live_value ON inv.item_identifiers (tenant_id, identifier_kind, normalized_value) WHERE retired_at IS NULL;
-- At most one live internal code, and at most one live primary code, per item.
CREATE UNIQUE INDEX uq_item_identifiers_live_internal ON inv.item_identifiers (tenant_id, item_id) WHERE identifier_kind = 'internal' AND retired_at IS NULL;
CREATE UNIQUE INDEX uq_item_identifiers_live_primary ON inv.item_identifiers (tenant_id, item_id) WHERE is_primary AND retired_at IS NULL;
CREATE INDEX ix_item_identifiers_item ON inv.item_identifiers (tenant_id, item_id);
CREATE INDEX ix_item_identifiers_unit ON inv.item_identifiers (unit_id);
CREATE INDEX ix_item_identifiers_lookup ON inv.item_identifiers (tenant_id, normalized_value) WHERE retired_at IS NULL;

-- A code may name a platform unit or the tenant's own, never another tenant's;
-- retirement is one-way; and a new code may not be attached to an archived item.
CREATE OR REPLACE FUNCTION inv.guard_item_identifier()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_scope text; v_unit_tenant uuid; v_lifecycle text;
BEGIN
  SELECT scope, tenant_id INTO v_scope, v_unit_tenant FROM inv.units_of_measure WHERE id = NEW.unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.item_identifiers: unit of measure % not found', NEW.unit_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_scope = 'tenant' AND v_unit_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'inv.item_identifiers: unit of measure % belongs to another tenant', NEW.unit_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'inv.item_identifiers: an identifier is born live' USING ERRCODE = 'check_violation';
    END IF;
    SELECT lifecycle_status INTO v_lifecycle FROM inv.item_master WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id;
    IF v_lifecycle = 'archived' THEN
      RAISE EXCEPTION 'inv.item_identifiers: an archived item takes no new identifier' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.retired_at IS NOT NULL AND (NEW.retired_at IS DISTINCT FROM OLD.retired_at OR NEW.retired_by IS DISTINCT FROM OLD.retired_by OR NEW.is_primary IS DISTINCT FROM OLD.is_primary) THEN
    RAISE EXCEPTION 'inv.item_identifiers: a retired identifier is frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_item_identifier() FROM PUBLIC;

CREATE TRIGGER tg_item_identifiers_guard BEFORE INSERT OR UPDATE ON inv.item_identifiers
  FOR EACH ROW EXECUTE FUNCTION inv.guard_item_identifier();
CREATE TRIGGER tg_item_identifiers_touch_metadata BEFORE UPDATE ON inv.item_identifiers
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_item_identifiers_immutable BEFORE UPDATE ON inv.item_identifiers
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'item_id', 'identifier_kind', 'value', 'unit_id', 'pack_quantity', 'created_at', 'created_by');
ALTER TABLE inv.item_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_identifiers FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_item_identifiers_tenant ON inv.item_identifiers FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_item_identifiers_tenant ON inv.item_identifiers FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_item_identifiers_tenant ON inv.item_identifiers FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.item_identifiers TO app_runtime;
GRANT SELECT ON inv.item_identifiers TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. Operation functions (SECURITY INVOKER; app_runtime executes).
-- ----------------------------------------------------------------------------

-- Add a user-entered identifier. `internal` is refused: internal codes come only
-- from inv.assign_internal_barcode. Marking the new code primary demotes the
-- item's current primary in the same statement sequence, so the one-primary index
-- never sees two.
CREATE OR REPLACE FUNCTION inv.add_item_identifier(
  p_item uuid, p_kind text, p_value text, p_unit uuid DEFAULT NULL,
  p_pack_quantity numeric DEFAULT 1, p_is_primary boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_unit uuid; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.add_item_identifier requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_kind = 'internal' THEN
    RAISE EXCEPTION 'an internal code is allocated by inv.assign_internal_barcode, never entered' USING ERRCODE = 'check_violation';
  END IF;
  SELECT uom_id INTO v_unit FROM inv.item_master WHERE tenant_id = v_tenant AND id = p_item AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item % not found in tenant', p_item USING ERRCODE = 'foreign_key_violation'; END IF;
  IF COALESCE(p_is_primary, false) THEN
    UPDATE inv.item_identifiers SET is_primary = false
     WHERE tenant_id = v_tenant AND item_id = p_item AND is_primary AND retired_at IS NULL;
  END IF;
  INSERT INTO inv.item_identifiers (tenant_id, item_id, identifier_kind, value, unit_id, pack_quantity, is_primary, created_by)
    VALUES (v_tenant, p_item, p_kind, btrim(p_value), COALESCE(p_unit, v_unit), COALESCE(p_pack_quantity, 1),
            COALESCE(p_is_primary, false), iam.current_user_id())
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.add_item_identifier(uuid, text, text, uuid, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.add_item_identifier(uuid, text, text, uuid, numeric, boolean) TO app_runtime;

-- Allocate the item's internal barcode, once. Idempotent: an item that already
-- holds a live internal code gets that code back and no number is consumed.
--
-- The counter is the highest internal number the tenant has ever stored, retired
-- rows included, so a retired code's number is never handed out again. It is read
-- under a per-tenant transaction advisory lock, which is what makes two concurrent
-- allocations for two different items produce two different numbers.
CREATE OR REPLACE FUNCTION inv.assign_internal_barcode(p_item uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_unit uuid; v_existing uuid;
        v_next bigint; v_digits text; v_has_primary boolean; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.assign_internal_barcode requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT uom_id INTO v_unit FROM inv.item_master WHERE tenant_id = v_tenant AND id = p_item AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item % not found in tenant', p_item USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT id INTO v_existing FROM inv.item_identifiers
   WHERE tenant_id = v_tenant AND item_id = p_item AND identifier_kind = 'internal' AND retired_at IS NULL;
  IF FOUND THEN RETURN v_existing; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('inv.item_identifiers.internal:' || v_tenant::text));
  SELECT COALESCE(MAX(pg_catalog.substr(normalized_value, 3, 9)::bigint), 0) + 1 INTO v_next
    FROM inv.item_identifiers WHERE tenant_id = v_tenant AND identifier_kind = 'internal';
  IF v_next > 999999999 THEN
    RAISE EXCEPTION 'the internal barcode range of this tenant is exhausted' USING ERRCODE = 'check_violation';
  END IF;
  v_digits := pg_catalog.lpad(v_next::text, 9, '0');
  SELECT EXISTS (SELECT 1 FROM inv.item_identifiers
                  WHERE tenant_id = v_tenant AND item_id = p_item AND is_primary AND retired_at IS NULL)
    INTO v_has_primary;
  INSERT INTO inv.item_identifiers (tenant_id, item_id, identifier_kind, value, unit_id, pack_quantity, is_primary, created_by)
    VALUES (v_tenant, p_item, 'internal', 'RL' || v_digits || inv.mod10_check_digit(v_digits)::text,
            v_unit, 1, NOT v_has_primary, iam.current_user_id())
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.assign_internal_barcode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.assign_internal_barcode(uuid) TO app_runtime;

-- Retire an identifier. Idempotent on an already-retired row. A retired code is
-- kept as history and frees its value for a new live row; it is never deleted,
-- because a label carrying it may still be on a shelf.
CREATE OR REPLACE FUNCTION inv.retire_item_identifier(p_identifier uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.item_identifiers%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.retire_item_identifier requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO r FROM inv.item_identifiers WHERE tenant_id = v_tenant AND id = p_identifier FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item identifier % not found', p_identifier USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.retired_at IS NOT NULL THEN RETURN; END IF;
  UPDATE inv.item_identifiers
     SET retired_at = now(), retired_by = iam.current_user_id(), is_primary = false
   WHERE tenant_id = v_tenant AND id = p_identifier;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.retire_item_identifier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.retire_item_identifier(uuid) TO app_runtime;
