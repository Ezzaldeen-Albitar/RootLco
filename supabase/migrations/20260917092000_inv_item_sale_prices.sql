-- ============================================================================
-- Phase: 1-32 (preparatory) — the selling price of a stock item
-- Migration: inv.item_sale_prices and inv.resolve_item_sale_price
-- Tasks: P1-32-PRE-105, P1-32-PRE-106
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once a
--   counter sale has been priced from a row here, because an invoice line's
--   captured amount cites the price that existed when it was written. Forward
--   only — no down script.
--
-- Purpose
--   A part could be issued to a work order and a work order could be invoiced,
--   but nothing in this schema said what a part COSTS A CUSTOMER. `svc.price_rules`
--   prices a SERVICE (`fk_price_rules_service` targets `svc.services`) and
--   `svc.resolve_price` takes a service id, so it cannot answer for an item; and
--   `inv.item_cost_details` / `inv.item_cost_layers` hold what the part cost the
--   tenant to buy, which is not a selling price and is gated by `inv.cost.view`.
--   A counter sale (the migration after this one) therefore had no price to put on
--   its line, and the alternatives were both wrong: accepting an amount from the
--   client, which `sal.invoices` has refused since P1-11, or defaulting to zero,
--   which sells stock for nothing.
--
--     * ONE LIVE PRICE PER SIGNATURE. `uq_item_sale_prices_signature` is UNIQUE on
--       (tenant, item, company, branch) with NULLS NOT DISTINCT, so the tenant-wide
--       row, the company row and the branch row are three rows that cannot be
--       duplicated. Ambiguity is therefore unrepresentable rather than broken by an
--       arbitrary tie-break.
--
--     * MOST SPECIFIC WINS. `inv.resolve_item_sale_price` prefers the branch row,
--       then the company row, then the tenant-wide row, and returns NO ROW when the
--       item has no price at all. A missing price is a refusal at the call site,
--       never a zero — the same rule `svc.resolve_price` follows.
--
--     * NO CUSTOMER-CLASS NARROWING. `svc.price_rules` carries `customer_class`;
--       this table deliberately does not. A counter sale in this slice prices the
--       item for the branch that sells it, and adding a dimension no operation can
--       yet set would be vocabulary with no writer.
--
--     * TAX IS A CLASS, NOT A RATE. `tax_class_id` names an `org.tax_classes` row
--       and the effective rate is read from `org.tax_rates` at the moment of sale,
--       exactly as the quotation path does. Storing a rate here would freeze one
--       tenant's tax change out of every future sale.
--
-- Dependencies
--   inv.item_master (20260723093000); org.legal_companies, org.branches,
--   org.tax_classes; shared.currencies; iam.*; org.guard_immutable_columns;
--   shared.touch_row_metadata.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. inv.item_sale_prices
-- ----------------------------------------------------------------------------
CREATE TABLE inv.item_sale_prices (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  item_id        uuid NOT NULL,
  -- NULL means "every company of the tenant"; NULL branch means "every branch of
  -- that company". The pair is the narrowing, and the resolver reads it as such.
  company_id     uuid NULL,
  branch_id      uuid NULL,
  currency_code  text NOT NULL,
  unit_price     numeric(18, 4) NOT NULL,
  tax_class_id   uuid NULL,
  status         text NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid NULL,

  CONSTRAINT pk_item_sale_prices PRIMARY KEY (id),
  CONSTRAINT uq_item_sale_prices_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_item_sale_prices_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_sale_prices_item FOREIGN KEY (tenant_id, item_id)
    REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_sale_prices_company FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_sale_prices_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_sale_prices_tax_class FOREIGN KEY (tenant_id, company_id, tax_class_id)
    REFERENCES org.tax_classes (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_sale_prices_currency FOREIGN KEY (currency_code)
    REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_item_sale_prices_unit_price CHECK (unit_price >= 0),
  CONSTRAINT ck_item_sale_prices_status CHECK (status IN ('active', 'inactive')),
  -- A branch row must name its company: the FK spans (tenant, company, branch) and
  -- a branch without a company would make the narrowing unreadable.
  CONSTRAINT ck_item_sale_prices_branch_needs_company CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  -- Tax classes are company-scoped (`org.tax_classes` is keyed on the company), so a
  -- tenant-wide price cannot name one.
  CONSTRAINT ck_item_sale_prices_tax_needs_company CHECK (tax_class_id IS NULL OR company_id IS NOT NULL)
);
COMMENT ON TABLE inv.item_sale_prices IS 'The price at which a tenant sells a stock item, optionally narrowed to a company and a branch. One live row per (tenant, item, company, branch) — uq_item_sale_prices_signature, NULLS NOT DISTINCT — so resolution is deterministic without a tie-break. The tax CLASS is stored; the rate is read from org.tax_rates at the moment of sale. This is a SELLING price and has nothing to do with inv.item_cost_details, which is gated by inv.cost.view.';
COMMENT ON COLUMN inv.item_sale_prices.company_id IS 'NULL applies the price to every company of the tenant.';
COMMENT ON COLUMN inv.item_sale_prices.branch_id IS 'NULL applies the price to every branch of the named company.';

CREATE UNIQUE INDEX uq_item_sale_prices_signature
  ON inv.item_sale_prices (tenant_id, item_id, company_id, branch_id) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;
CREATE INDEX ix_item_sale_prices_item ON inv.item_sale_prices (tenant_id, item_id);
CREATE INDEX ix_item_sale_prices_company ON inv.item_sale_prices (tenant_id, company_id);
CREATE INDEX ix_item_sale_prices_branch ON inv.item_sale_prices (tenant_id, company_id, branch_id);
CREATE INDEX ix_item_sale_prices_tax_class ON inv.item_sale_prices (tenant_id, company_id, tax_class_id);
CREATE INDEX ix_item_sale_prices_currency ON inv.item_sale_prices (currency_code);

-- A price may not be attached to an archived item, and the narrowing columns are
-- frozen: moving a row from one branch to another would silently re-target a price
-- that a sale has already cited.
CREATE OR REPLACE FUNCTION inv.guard_item_sale_price()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_lifecycle text; v_tracked boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT lifecycle_status, is_stock_tracked INTO v_lifecycle, v_tracked
      FROM inv.item_master WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inv.item_sale_prices: item % not found in tenant', NEW.item_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_lifecycle = 'archived' THEN
      RAISE EXCEPTION 'inv.item_sale_prices: an archived item takes no price' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_item_sale_price() FROM PUBLIC;

CREATE TRIGGER tg_item_sale_prices_guard BEFORE INSERT OR UPDATE ON inv.item_sale_prices
  FOR EACH ROW EXECUTE FUNCTION inv.guard_item_sale_price();
CREATE TRIGGER tg_item_sale_prices_touch_metadata BEFORE UPDATE ON inv.item_sale_prices
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_item_sale_prices_immutable BEFORE UPDATE ON inv.item_sale_prices
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'item_id', 'company_id', 'branch_id', 'created_at', 'created_by');

ALTER TABLE inv.item_sale_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_sale_prices FORCE  ROW LEVEL SECURITY;
-- Readable tenant-wide, like the item it prices: a tenant-wide row (company NULL)
-- answers for every branch, so a company predicate on SELECT would hide the price
-- that actually applies. The WRITE policies narrow, so a caller scoped to one
-- company cannot create or move another company's price.
CREATE POLICY sel_item_sale_prices_tenant ON inv.item_sale_prices FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_item_sale_prices_scope ON inv.item_sale_prices FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (company_id IS NULL OR iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (branch_id IS NULL OR iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_item_sale_prices_scope ON inv.item_sale_prices FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (company_id IS NULL OR iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (branch_id IS NULL OR iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (company_id IS NULL OR iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (branch_id IS NULL OR iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON inv.item_sale_prices TO app_runtime;
GRANT SELECT ON inv.item_sale_prices TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. Resolution, and the write that keeps one row per signature.
-- ----------------------------------------------------------------------------

-- The one winning price for an item at a branch, or no row.
--
-- Specificity, not priority: a branch row beats a company row beats a tenant-wide
-- row. Two rows cannot tie, because `uq_item_sale_prices_signature` gives each
-- specificity at most one row for a given (item, company, branch) pair.
CREATE OR REPLACE FUNCTION inv.resolve_item_sale_price(p_item uuid, p_company uuid, p_branch uuid)
RETURNS TABLE (price_id uuid, unit_price numeric, currency_code text, tax_class_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p.id, p.unit_price, p.currency_code, p.tax_class_id
    FROM inv.item_sale_prices p
   WHERE p.tenant_id = iam.current_tenant_id()
     AND p.item_id = p_item
     AND p.status = 'active'
     AND p.deleted_at IS NULL
     AND (p.company_id IS NULL OR p.company_id = p_company)
     AND (p.branch_id IS NULL OR p.branch_id = p_branch)
   ORDER BY (p.branch_id IS NOT NULL) DESC, (p.company_id IS NOT NULL) DESC
   LIMIT 1
$$;
COMMENT ON FUNCTION inv.resolve_item_sale_price(uuid, uuid, uuid) IS 'The selling price of an item at a branch: the branch row, else the company row, else the tenant-wide row, else NO ROW. A missing price is a refusal at the call site and never a zero.';
REVOKE EXECUTE ON FUNCTION inv.resolve_item_sale_price(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.resolve_item_sale_price(uuid, uuid, uuid) TO app_runtime, app_readonly;

-- Set the price for one signature: insert it, or revise the live row that already
-- holds that signature. Revising rather than inserting is what keeps
-- `uq_item_sale_prices_signature` from turning an ordinary price change into a
-- `23505` the caller cannot act on, and it keeps the row's history in
-- `record_version` instead of scattering it across duplicates.
CREATE OR REPLACE FUNCTION inv.set_item_sale_price(
  p_item uuid, p_company uuid, p_branch uuid, p_currency text,
  p_unit_price numeric, p_tax_class uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.set_item_sale_price requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT id INTO v_id FROM inv.item_sale_prices
   WHERE tenant_id = v_tenant AND item_id = p_item AND deleted_at IS NULL
     AND company_id IS NOT DISTINCT FROM p_company
     AND branch_id IS NOT DISTINCT FROM p_branch
   FOR UPDATE;
  IF FOUND THEN
    UPDATE inv.item_sale_prices
       SET currency_code = p_currency, unit_price = p_unit_price,
           tax_class_id = p_tax_class, status = 'active'
     WHERE tenant_id = v_tenant AND id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO inv.item_sale_prices (tenant_id, item_id, company_id, branch_id, currency_code, unit_price, tax_class_id, created_by)
    VALUES (v_tenant, p_item, p_company, p_branch, p_currency, p_unit_price, p_tax_class, iam.current_user_id())
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.set_item_sale_price(uuid, uuid, uuid, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.set_item_sale_price(uuid, uuid, uuid, text, numeric, uuid) TO app_runtime;
