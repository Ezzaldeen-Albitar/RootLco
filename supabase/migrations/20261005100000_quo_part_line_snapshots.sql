-- ============================================================================
-- P1-32-PRE-OD-FD6 — part lines on quotations at the authorised sales price,
-- snapshotted (Owner decision D6 of 2026-09-30, ADR-023).
-- Owner module: quo (six columns, two foreign keys, two indexes, one trigger
--   function and one trigger on quo.quotation_items)
--
-- Rollback classification: ROLLBACK-SAFE while no part line exists; roll-
--   forward-only once one does, because the snapshot columns are the only
--   statement of the unit, the item words and the price row a customer was
--   quoted. Forward-only — the inverse at the foot of this file is for a
--   rehearsal copy only.
--
-- Purpose
--   quo.quotation_items has admitted item_kind 'part' with item_ref ->
--   inv.item_master since 20260723096000, but nothing wrote one: every line
--   was a service priced from svc.price_rules. D6: parts are explicit
--   quotation lines at AUTHORISED SALES prices, never at inventory cost; each
--   line snapshots quantity, unit, price, discount and tax treatment, and a
--   later catalogue change never alters it silently.
--
--   The one source that can price an ITEM today is the item selling price,
--   inv.item_sale_prices through inv.resolve_item_sale_price (branch row, else
--   company row, else tenant-wide row, else none) — the source counter sales
--   use. svc.price_rules cannot: service_id is NOT NULL with a foreign key to
--   svc.services, and svc.resolve_price takes a service id. Cost
--   (inv.item_cost_details, inv.item_cost_layers) is never read here.
--
--   Quantity, discount, unit price and tax RATE were already captured on every
--   line. This migration adds what a part line also needs to stay what it was
--   quoted as:
--     * item_sale_price_ref — the inv.item_sale_prices row that priced it;
--     * quoted_item_sku, quoted_item_name — the item's words at quoting;
--     * quoted_unit_code, quoted_unit_name — its unit of measure at
--       quoting (inv.item_master.uom_id is mutable; a unit change later must
--       not re-label a quoted quantity);
--     * quoted_tax_class_ref — the tax class the price row named, so the
--       tax treatment is stated, not only its rate.
--
--   quo.guard_quotation_part_line (BEFORE INSERT OR UPDATE):
--     * a 'part' line names an item and carries every snapshot, and names no
--       service and no price rule; a 'service' line carries none of them and
--       links no required part;
--     * on INSERT, a part line's captured unit price, currency and tax class
--       must be exactly what inv.resolve_item_sale_price answers for the
--       line's company and branch at this moment, its price row must be the
--       resolved row, its words and unit must be the item's current ones, the
--       item must be active, its tax rate the class's effective rate today
--       (zero for no class, exactly as sal.create_counter_sale_invoice
--       treats it), and a linked required part must belong to the quotation's
--       own work order and, when it names an item, this item. So no writer —
--       the application included — can put a cost, a typed price or a stale
--       price on a part line;
--     * on UPDATE, the kind, the item, the price row and every snapshot are
--       frozen, and so are a part line's unit price, tax rate and currency, and
--       the service references it may never carry. A change is a new revision,
--       as for every quotation change.
--
--   Invoicing is unchanged: a work-order invoice copies the accepted
--   revision's lines with line_type = item_kind and source_quotation_item_id,
--   and sal.guard_invoice_line_frozen (20260917093000) already refuses an item or a
--   stock location on a work-order invoice line, so no part line can be
--   posted as a counter sale; its stock left as a part issue.
--
-- Existing rows
--   Every existing line is a 'service' line written by the application with
--   no item; the new columns are NULL for them, which the guard accepts. No
--   row is written, moved or recomputed, and the guard fires only on new
--   writes, so an issued revision keeps every figure it was issued with.
--
-- Security implications
--   No new table, policy, grant, role or SECURITY DEFINER. The guard is
--   SECURITY INVOKER and reads inv.item_master, inv.units_of_measure,
--   inv.item_sale_prices, org.tax_rates, org.tax_classes, wo.required_parts
--   and quo.quotation_revisions / quo.quotations under the writer's own RLS.
-- ============================================================================

ALTER TABLE quo.quotation_items ADD COLUMN item_sale_price_ref uuid NULL;
ALTER TABLE quo.quotation_items ADD COLUMN quoted_item_sku text NULL;
ALTER TABLE quo.quotation_items ADD COLUMN quoted_item_name text NULL;
ALTER TABLE quo.quotation_items ADD COLUMN quoted_unit_code text NULL;
ALTER TABLE quo.quotation_items ADD COLUMN quoted_unit_name text NULL;
ALTER TABLE quo.quotation_items ADD COLUMN quoted_tax_class_ref uuid NULL;

ALTER TABLE quo.quotation_items ADD CONSTRAINT fk_quotation_items_sale_price
  FOREIGN KEY (tenant_id, item_sale_price_ref)
  REFERENCES inv.item_sale_prices (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE quo.quotation_items ADD CONSTRAINT fk_quotation_items_tax_class
  FOREIGN KEY (tenant_id, company_id, quoted_tax_class_ref)
  REFERENCES org.tax_classes (tenant_id, company_id, id) ON DELETE RESTRICT;

CREATE INDEX ix_quotation_items_sale_price ON quo.quotation_items (tenant_id, item_sale_price_ref);
CREATE INDEX ix_quotation_items_tax_class ON quo.quotation_items (tenant_id, company_id, quoted_tax_class_ref);

COMMENT ON COLUMN quo.quotation_items.item_sale_price_ref IS
  'P1-32-PRE-OD-FD6 (ADR-023 D6): the inv.item_sale_prices row that priced a part line, as inv.resolve_item_sale_price answered at quoting. NULL on a service line.';
COMMENT ON COLUMN quo.quotation_items.quoted_item_sku IS
  'P1-32-PRE-OD-FD6: the item''s stock code when the part line was quoted. Frozen; NULL on a service line.';
COMMENT ON COLUMN quo.quotation_items.quoted_item_name IS
  'P1-32-PRE-OD-FD6: the item''s name when the part line was quoted. Frozen; NULL on a service line.';
COMMENT ON COLUMN quo.quotation_items.quoted_unit_code IS
  'P1-32-PRE-OD-FD6: the item''s unit of measure code when the part line was quoted; the captured quantity is in this unit. Frozen; NULL on a service line.';
COMMENT ON COLUMN quo.quotation_items.quoted_unit_name IS
  'P1-32-PRE-OD-FD6: the item''s unit of measure name when the part line was quoted. Frozen; NULL on a service line.';
COMMENT ON COLUMN quo.quotation_items.quoted_tax_class_ref IS
  'P1-32-PRE-OD-FD6: the tax class the item selling price named when the part line was quoted (NULL = untaxed, rate zero, as for a counter sale). Frozen; NULL on a service line.';

CREATE OR REPLACE FUNCTION quo.guard_quotation_part_line()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_price record; v_rate numeric(9, 6); v_today date := CURRENT_DATE;
  v_sku text; v_name text; v_lifecycle text; v_unit_code text; v_unit_name text;
  v_work_order uuid; v_part_item uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.item_kind IS DISTINCT FROM OLD.item_kind
       OR NEW.item_ref IS DISTINCT FROM OLD.item_ref
       OR NEW.item_sale_price_ref IS DISTINCT FROM OLD.item_sale_price_ref
       OR NEW.quoted_item_sku IS DISTINCT FROM OLD.quoted_item_sku
       OR NEW.quoted_item_name IS DISTINCT FROM OLD.quoted_item_name
       OR NEW.quoted_unit_code IS DISTINCT FROM OLD.quoted_unit_code
       OR NEW.quoted_unit_name IS DISTINCT FROM OLD.quoted_unit_name
       OR NEW.quoted_tax_class_ref IS DISTINCT FROM OLD.quoted_tax_class_ref
       OR NEW.source_required_part_ref IS DISTINCT FROM OLD.source_required_part_ref THEN
      RAISE EXCEPTION 'part_line_snapshot_frozen: the kind, item, price row and snapshot of a quotation line are fixed once written; quote a new revision instead'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.item_kind = 'part' AND (
         NEW.service_id IS DISTINCT FROM OLD.service_id
         OR NEW.price_rule_ref IS DISTINCT FROM OLD.price_rule_ref
         OR NEW.source_service_line_ref IS DISTINCT FROM OLD.source_service_line_ref
         OR NEW.captured_unit_price IS DISTINCT FROM OLD.captured_unit_price
         OR NEW.captured_tax_rate IS DISTINCT FROM OLD.captured_tax_rate
         OR NEW.currency_code IS DISTINCT FROM OLD.currency_code) THEN
      RAISE EXCEPTION 'part_line_snapshot_frozen: a part line keeps the sales price and tax it was quoted at; quote a new revision instead'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.item_kind = 'service' THEN
    IF NEW.item_ref IS NOT NULL OR NEW.item_sale_price_ref IS NOT NULL
       OR NEW.quoted_item_sku IS NOT NULL OR NEW.quoted_item_name IS NOT NULL
       OR NEW.quoted_unit_code IS NOT NULL OR NEW.quoted_unit_name IS NOT NULL
       OR NEW.quoted_tax_class_ref IS NOT NULL OR NEW.source_required_part_ref IS NOT NULL THEN
      RAISE EXCEPTION 'part_line_shape: a service line names no item, no item price, no unit snapshot and no required part'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- A part line.
  IF NEW.item_ref IS NULL OR NEW.item_sale_price_ref IS NULL
     OR NEW.quoted_item_sku IS NULL OR NEW.quoted_item_name IS NULL
     OR NEW.quoted_unit_code IS NULL OR NEW.quoted_unit_name IS NULL THEN
    RAISE EXCEPTION 'part_line_shape: a part line names its item, the selling price that priced it, and the item and unit it was quoted as'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.service_id IS NOT NULL OR NEW.price_rule_ref IS NOT NULL OR NEW.source_service_line_ref IS NOT NULL THEN
    RAISE EXCEPTION 'part_line_shape: a part line names no service, no service price rule and no service line'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.sku, i.name, i.lifecycle_status, u.code, u.name
    INTO v_sku, v_name, v_lifecycle, v_unit_code, v_unit_name
    FROM inv.item_master i
    JOIN inv.units_of_measure u ON u.id = i.uom_id
   WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_ref AND i.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'part_line_item: item % is not in this tenant''s catalogue', NEW.item_ref
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_lifecycle <> 'active' THEN
    RAISE EXCEPTION 'part_line_item: item % is archived and cannot be quoted', NEW.item_ref
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.quoted_item_sku <> v_sku OR NEW.quoted_item_name <> v_name
     OR NEW.quoted_unit_code <> v_unit_code OR NEW.quoted_unit_name <> v_unit_name THEN
    RAISE EXCEPTION 'part_line_snapshot: the item and unit captured must be the item''s own at quoting'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The authorised sales price, and only it. Never cost; never a typed figure.
  SELECT * INTO v_price FROM inv.resolve_item_sale_price(NEW.item_ref, NEW.company_id, NEW.branch_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'part_line_price: item % has no authorised sales price for this branch', NEW.item_ref
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_price.price_id <> NEW.item_sale_price_ref
     OR v_price.unit_price <> NEW.captured_unit_price
     OR v_price.currency_code <> NEW.currency_code
     OR v_price.tax_class_id IS DISTINCT FROM NEW.quoted_tax_class_ref THEN
    RAISE EXCEPTION 'part_line_price: a part line is priced at the item selling price that applies to its branch, with that price''s currency and tax class'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The tax treatment exactly as a counter sale reads it: no class is untaxed,
  -- a class with no effective rate today is refused.
  IF v_price.tax_class_id IS NULL THEN
    v_rate := 0;
  ELSE
    SELECT tr.rate INTO v_rate FROM org.tax_rates tr JOIN org.tax_classes tc
        ON tc.tenant_id = tr.tenant_id AND tc.id = tr.tax_class_id
      WHERE tr.tenant_id = NEW.tenant_id AND tr.company_id = NEW.company_id
        AND tr.tax_class_id = v_price.tax_class_id
        AND tr.status = 'active' AND tr.deleted_at IS NULL
        AND tc.status = 'active' AND tc.deleted_at IS NULL
        AND tr.effective_from <= v_today AND (tr.effective_to IS NULL OR tr.effective_to > v_today)
      ORDER BY tr.effective_from DESC LIMIT 1;
    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'part_line_tax: tax class % has no effective rate for this company today', v_price.tax_class_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.captured_tax_rate <> v_rate THEN
    RAISE EXCEPTION 'part_line_tax: a part line carries the effective rate of its price''s tax class (%)', v_rate
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.source_required_part_ref IS NOT NULL THEN
    SELECT q.work_order_id INTO v_work_order
      FROM quo.quotation_revisions r
      JOIN quo.quotations q ON q.tenant_id = r.tenant_id AND q.id = r.quotation_id
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.quotation_revision_id;
    SELECT rp.item_ref INTO v_part_item
      FROM wo.required_parts rp
     WHERE rp.tenant_id = NEW.tenant_id AND rp.id = NEW.source_required_part_ref
       AND rp.work_order_id = v_work_order AND rp.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'part_line_required_part: required part % is not on this quotation''s work order', NEW.source_required_part_ref
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_part_item IS NOT NULL AND v_part_item <> NEW.item_ref THEN
      RAISE EXCEPTION 'part_line_required_part: required part % names a different item', NEW.source_required_part_ref
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION quo.guard_quotation_part_line() IS
  'BEFORE INSERT OR UPDATE guard on quo.quotation_items (P1-32-PRE-OD-FD6, ADR-023 D6). A part line must be priced at exactly what inv.resolve_item_sale_price answers for its branch now (price row, unit price, currency, tax class), carry the effective rate of that tax class (zero for none, as a counter sale), name an active item with its current stock code, name and unit, and link only a required part of its own work order. A service line carries none of the part columns. On UPDATE the kind, item, price row and snapshot are frozen, and so are a part line''s unit price, tax rate, currency and (absent) service references.';
REVOKE EXECUTE ON FUNCTION quo.guard_quotation_part_line() FROM PUBLIC;

CREATE TRIGGER tg_quotation_items_part_line BEFORE INSERT OR UPDATE ON quo.quotation_items
  FOR EACH ROW EXECUTE FUNCTION quo.guard_quotation_part_line();

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only — refused once a part line exists)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM quo.quotation_items WHERE item_kind = 'part') THEN
--       RAISE EXCEPTION 'part lines exist; this migration is forward-only';
--     END IF;
--   END $$;
--   DROP TRIGGER tg_quotation_items_part_line ON quo.quotation_items;
--   DROP FUNCTION quo.guard_quotation_part_line();
--   DROP INDEX quo.ix_quotation_items_tax_class;
--   DROP INDEX quo.ix_quotation_items_sale_price;
--   ALTER TABLE quo.quotation_items DROP CONSTRAINT fk_quotation_items_tax_class;
--   ALTER TABLE quo.quotation_items DROP CONSTRAINT fk_quotation_items_sale_price;
--   ALTER TABLE quo.quotation_items DROP COLUMN quoted_tax_class_ref;
--   ALTER TABLE quo.quotation_items DROP COLUMN quoted_unit_name;
--   ALTER TABLE quo.quotation_items DROP COLUMN quoted_unit_code;
--   ALTER TABLE quo.quotation_items DROP COLUMN quoted_item_name;
--   ALTER TABLE quo.quotation_items DROP COLUMN quoted_item_sku;
--   ALTER TABLE quo.quotation_items DROP COLUMN item_sale_price_ref;
-- ----------------------------------------------------------------------------
