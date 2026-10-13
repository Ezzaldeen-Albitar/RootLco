-- ============================================================================
-- Phase: 1-32 (preparatory) — inventory operations the ledger could not express
-- Migration: stock transfers with in-transit, goods receipts with an append-only
--            cost history, and stock counts that raise adjustments
-- Tasks: P1-32-PRE-040…049
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once a
--   transfer, goods receipt or stock count exists (their movements are immutable
--   ledger rows). Forward-only — no down script.
--
-- Purpose
--   Three capabilities the `inv` schema deliberately did not have, each built on
--   the SAME trust root rather than beside it: every quantity change is still one
--   `inv.post_stock_movement` under `inv.lock_stock_balance`, every movement still
--   proves a source through `inv.guard_stock_movement_provenance`, and every
--   balance is still re-verified by `inv.guard_stock_balance_coherence`.
--
--     * TRANSFERS. A transfer is two paired postings separated in time, not one
--       relocation: dispatch moves the quantity OUT of the source cell and IN to a
--       branch-level `transit` location, and receipt moves it OUT of transit and IN
--       to the destination. Stock is therefore never in two cells at once and never
--       in none; the quantity sitting in transit is a real balance row that the
--       availability read reports as `inTransitQty`. Cancellation returns the
--       quantity from transit to the origin through the same receipt pair, so a
--       cancelled transfer leaves four movements and a zero net effect rather than
--       a deleted row.
--
--     * GOODS RECEIPTS. A receipt adds stock and, when the caller may see cost,
--       APPENDS a cost layer. It never rewrites an earlier layer and never touches
--       `inv.item_cost_details.standard_cost`, so the cost of what was received in
--       March survives a different price in September. A current reference cost is
--       therefore derived from the layers (latest, and quantity-weighted average),
--       never stored — there is no column a later receipt could overwrite.
--
--     * STOCK COUNTS. A count snapshots the on-hand quantity of every item at a
--       location and then lets the ledger keep moving: the reconciliation re-reads
--       the movements that occurred AFTER the snapshot and subtracts them, so a
--       part issued while the shelf was being counted is not reported as a loss.
--       A non-zero variance raises a PENDING `inv.stock_adjustments` row and stops.
--       A count never posts stock by itself — the maker-checker approval that every
--       other adjustment goes through is the only way a variance reaches the ledger.
--
-- Dependencies
--   inv.stock_movements/balances/reservations + primitives (20260723094000);
--   inv.stock_adjustments, inv.guard_stock_movement_provenance (20260723095000);
--   inv.stock_locations, inv.item_master (20260723093000); shared.currencies;
--   iam.*; org.guard_immutable_columns; shared.touch_row_metadata.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Vocabulary widening on the frozen ledger constraints.
--
--    DROP/ADD rather than an edit to the original migration: an applied migration
--    is immutable, and a CHECK is replaced by naming the same constraint again so
--    the catalog keeps ONE constraint per rule instead of accumulating a second,
--    weaker one beside the first.
-- ----------------------------------------------------------------------------

-- `transit` is a fourth location type, not a flag on an existing one. Damage
-- already proved the pattern: a unit leaves sellable availability because it SITS
-- somewhere else, which no application filter can forget to apply.
ALTER TABLE inv.stock_locations DROP CONSTRAINT ck_stock_locations_type;
ALTER TABLE inv.stock_locations ADD CONSTRAINT ck_stock_locations_type
  CHECK (location_type IN ('warehouse', 'storage', 'quarantine', 'transit'));
COMMENT ON COLUMN inv.stock_locations.location_type IS
  'warehouse (root), storage and quarantine (nested under a warehouse), transit (branch-level, parentless, system-created by inv.ensure_transit_location and never a sellable cell).';

-- A transit location is branch-level and has no parent, exactly like a warehouse.
-- It is not nested because it is not a place: it is the interval between two
-- places, and choosing a warehouse to file it under would assert a location the
-- quantity is not at.
CREATE OR REPLACE FUNCTION inv.guard_stock_location_hierarchy()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_parent_type text;
BEGIN
  IF NEW.location_type IN ('warehouse', 'transit') THEN
    IF NEW.parent_location_id IS NOT NULL THEN
      RAISE EXCEPTION 'inv.stock_locations: a % location cannot have a parent location', NEW.location_type USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_location_id IS NULL THEN
    RAISE EXCEPTION 'inv.stock_locations: a % location requires a parent warehouse', NEW.location_type USING ERRCODE = 'check_violation';
  END IF;
  SELECT location_type INTO v_parent_type FROM inv.stock_locations
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.parent_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.stock_locations: parent location % not found in scope', NEW.parent_location_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_parent_type <> 'warehouse' THEN
    RAISE EXCEPTION 'inv.stock_locations: parent must be a warehouse (found %)', v_parent_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_location_hierarchy() FROM PUBLIC;

-- Two new movement types and three new reference kinds. `transfer` may go either
-- way because a transfer posts both legs; `receipt` is `in` only, because a goods
-- receipt that removed stock would be a return under another name.
ALTER TABLE inv.stock_movements DROP CONSTRAINT ck_stock_movements_type;
ALTER TABLE inv.stock_movements ADD CONSTRAINT ck_stock_movements_type
  CHECK (movement_type IN ('opening', 'issue', 'return', 'damage', 'adjustment', 'transfer', 'receipt'));

ALTER TABLE inv.stock_movements DROP CONSTRAINT ck_stock_movements_type_direction;
ALTER TABLE inv.stock_movements ADD CONSTRAINT ck_stock_movements_type_direction
  CHECK (
    (movement_type IN ('opening', 'return', 'receipt') AND direction = 'in')
    OR (movement_type = 'issue' AND direction = 'out')
    OR (movement_type IN ('damage', 'adjustment', 'transfer')));

ALTER TABLE inv.stock_movements DROP CONSTRAINT ck_stock_movements_reference_kind;
ALTER TABLE inv.stock_movements ADD CONSTRAINT ck_stock_movements_reference_kind
  CHECK (reference_kind IN (
    'opening_line', 'part_issue', 'part_return', 'damage', 'adjustment',
    'transfer_dispatch', 'transfer_receipt', 'goods_receipt_line'));

-- ----------------------------------------------------------------------------
-- 2. inv.stock_transfers — a dispatch and a receipt separated in time.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_transfers (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  -- The SOURCE branch owns the row. A transfer is an act by the branch that gives
  -- the stock up; the destination sees it through a second SELECT policy below.
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  item_id             uuid    NOT NULL,
  from_location_id    uuid    NOT NULL,
  transit_location_id uuid    NOT NULL,
  to_branch_id        uuid    NOT NULL,
  to_location_id      uuid    NOT NULL,
  quantity            numeric(12, 3) NOT NULL,
  received_quantity   numeric(12, 3) NULL,
  status              text    NOT NULL DEFAULT 'dispatched',
  reason              text    NULL,
  cancel_reason       text    NULL,
  dispatched_at       timestamptz NOT NULL DEFAULT now(),
  dispatched_by       uuid    NOT NULL,
  received_at         timestamptz NULL,
  received_by         uuid    NULL,
  cancelled_at        timestamptz NULL,
  cancelled_by        uuid    NULL,
  correlation_id      uuid    NULL,
  idempotency_key     text    NULL,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,

  CONSTRAINT pk_stock_transfers PRIMARY KEY (id),
  CONSTRAINT uq_stock_transfers_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_stock_transfers_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_to_branch FOREIGN KEY (tenant_id, company_id, to_branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_from_location FOREIGN KEY (tenant_id, company_id, branch_id, from_location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_transit_location FOREIGN KEY (tenant_id, company_id, branch_id, transit_location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfers_to_location FOREIGN KEY (tenant_id, company_id, to_branch_id, to_location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_transfers_quantity CHECK (quantity > 0),
  CONSTRAINT ck_stock_transfers_status CHECK (status IN ('dispatched', 'received', 'cancelled')),
  CONSTRAINT ck_stock_transfers_received CHECK ((status = 'received') = (received_at IS NOT NULL)),
  CONSTRAINT ck_stock_transfers_cancelled CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  -- PARTIAL RECEIPT IS OUT OF SCOPE for this slice, and the constraint says so
  -- rather than a comment: a received quantity that differs from the dispatched
  -- one would need a variance disposition (shortage, damage in transit, or a
  -- residual still in transit) that no column here can express.
  CONSTRAINT ck_stock_transfers_received_quantity CHECK (received_quantity IS NULL OR received_quantity = quantity),
  CONSTRAINT ck_stock_transfers_locations_differ CHECK (from_location_id <> to_location_id),
  CONSTRAINT ck_stock_transfers_transit_distinct CHECK (transit_location_id <> from_location_id AND transit_location_id <> to_location_id),
  CONSTRAINT ck_stock_transfers_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT ck_stock_transfers_cancel_reason_not_blank CHECK (cancel_reason IS NULL OR btrim(cancel_reason) <> ''),
  CONSTRAINT ck_stock_transfers_cancel_reason_state CHECK (cancel_reason IS NULL OR status = 'cancelled')
);
COMMENT ON TABLE inv.stock_transfers IS 'Inventory transfer between two stock locations of one company, held in a branch-level transit location between dispatch and receipt. Owned by the SOURCE branch; the destination branch reads it through a second SELECT policy. Partial receipt is deliberately unrepresentable (ck_stock_transfers_received_quantity).';
CREATE UNIQUE INDEX uq_stock_transfers_idempotency ON inv.stock_transfers (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_stock_transfers_branch ON inv.stock_transfers (tenant_id, company_id, branch_id);
CREATE INDEX ix_stock_transfers_to_branch ON inv.stock_transfers (tenant_id, company_id, to_branch_id);
CREATE INDEX ix_stock_transfers_item ON inv.stock_transfers (tenant_id, item_id);
CREATE INDEX ix_stock_transfers_from_location ON inv.stock_transfers (tenant_id, company_id, branch_id, from_location_id);
CREATE INDEX ix_stock_transfers_transit_location ON inv.stock_transfers (tenant_id, company_id, branch_id, transit_location_id);
CREATE INDEX ix_stock_transfers_to_location ON inv.stock_transfers (tenant_id, company_id, to_branch_id, to_location_id);
CREATE INDEX ix_stock_transfers_status ON inv.stock_transfers (tenant_id, company_id, branch_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION inv.guard_stock_transfer_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'dispatched' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inv.stock_transfers: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'received' AND NEW.received_by IS NULL THEN
    RAISE EXCEPTION 'inv.stock_transfers: a received transfer requires received_by' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_by IS NULL THEN
    RAISE EXCEPTION 'inv.stock_transfers: a cancelled transfer requires cancelled_by' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_transfer_status() FROM PUBLIC;

CREATE TRIGGER tg_stock_transfers_status BEFORE INSERT OR UPDATE ON inv.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION inv.guard_stock_transfer_status();
CREATE TRIGGER tg_stock_transfers_touch_metadata BEFORE UPDATE ON inv.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_transfers_immutable BEFORE UPDATE ON inv.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'item_id', 'from_location_id', 'transit_location_id', 'to_branch_id', 'to_location_id', 'quantity', 'idempotency_key', 'dispatched_at', 'dispatched_by', 'created_at', 'created_by');
ALTER TABLE inv.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_transfers FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_transfers_scope ON inv.stock_transfers FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
-- The DESTINATION branch must be able to see what is coming to it. Without this a
-- receiving storekeeper could not list incoming transfers at all, because the row
-- is scoped to the branch that dispatched it. Policies are OR-ed, so this widens
-- SELECT only, and only to the branch the stock is addressed to.
CREATE POLICY sel_stock_transfers_destination ON inv.stock_transfers FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR to_branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_transfers_scope ON inv.stock_transfers FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_transfers_scope ON inv.stock_transfers FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_transfers TO app_runtime;
GRANT SELECT ON inv.stock_transfers TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. inv.goods_receipts / inv.goods_receipt_lines.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.goods_receipts (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  company_id         uuid    NOT NULL,
  branch_id          uuid    NOT NULL,
  -- No allocated display number. `shared.number_sequences` carries no inventory
  -- code, and registering one would make receipt creation depend on a sequence row
  -- that no tenant has provisioned. `reference` is the operator's own label.
  reference          text    NULL,
  supplier_reference text    NULL,
  received_on        date    NOT NULL,
  status             text    NOT NULL DEFAULT 'draft',
  notes              text    NULL,
  posted_at          timestamptz NULL,
  posted_by          uuid    NULL,
  cancelled_at       timestamptz NULL,
  cancelled_by       uuid    NULL,
  correlation_id     uuid    NULL,
  idempotency_key    text    NULL,
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,

  CONSTRAINT pk_goods_receipts PRIMARY KEY (id),
  CONSTRAINT uq_goods_receipts_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_goods_receipts_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipts_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_goods_receipts_status CHECK (status IN ('draft', 'posted', 'cancelled')),
  CONSTRAINT ck_goods_receipts_posted CHECK ((status = 'posted') = (posted_at IS NOT NULL)),
  CONSTRAINT ck_goods_receipts_cancelled CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT ck_goods_receipts_reference_format CHECK (reference IS NULL OR reference ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
  CONSTRAINT ck_goods_receipts_supplier_reference CHECK (supplier_reference IS NULL OR btrim(supplier_reference) <> ''),
  CONSTRAINT ck_goods_receipts_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
COMMENT ON TABLE inv.goods_receipts IS 'Goods received into a branch. A draft holds counted lines; posting writes one receipt movement per line and APPENDS a cost layer per priced line. Posting is terminal — a posted receipt is never re-priced, because its cost layer is history.';
CREATE UNIQUE INDEX uq_goods_receipts_idempotency ON inv.goods_receipts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_goods_receipts_reference ON inv.goods_receipts (tenant_id, company_id, branch_id, reference) WHERE reference IS NOT NULL;
CREATE INDEX ix_goods_receipts_branch ON inv.goods_receipts (tenant_id, company_id, branch_id);
CREATE INDEX ix_goods_receipts_status ON inv.goods_receipts (tenant_id, company_id, branch_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION inv.guard_goods_receipt_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inv.goods_receipts: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'posted' AND NEW.posted_by IS NULL THEN
    RAISE EXCEPTION 'inv.goods_receipts: a posted receipt requires posted_by' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_by IS NULL THEN
    RAISE EXCEPTION 'inv.goods_receipts: a cancelled receipt requires cancelled_by' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_goods_receipt_status() FROM PUBLIC;

CREATE TRIGGER tg_goods_receipts_status BEFORE INSERT OR UPDATE ON inv.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION inv.guard_goods_receipt_status();
CREATE TRIGGER tg_goods_receipts_touch_metadata BEFORE UPDATE ON inv.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_goods_receipts_immutable BEFORE UPDATE ON inv.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'received_on', 'idempotency_key', 'created_at', 'created_by');
ALTER TABLE inv.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.goods_receipts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_goods_receipts_scope ON inv.goods_receipts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_goods_receipts_scope ON inv.goods_receipts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_goods_receipts_scope ON inv.goods_receipts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.goods_receipts TO app_runtime;
GRANT SELECT ON inv.goods_receipts TO app_readonly;

CREATE TABLE inv.goods_receipt_lines (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  receipt_id     uuid    NOT NULL,
  line_no        integer NOT NULL,
  item_id        uuid    NOT NULL,
  location_id    uuid    NOT NULL,
  quantity       numeric(12, 3) NOT NULL,
  unit_cost      numeric(18, 4) NULL,
  currency_code  text    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,

  CONSTRAINT pk_goods_receipt_lines PRIMARY KEY (id),
  CONSTRAINT uq_goods_receipt_lines_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_goods_receipt_lines_line_no UNIQUE (tenant_id, company_id, branch_id, receipt_id, line_no),
  CONSTRAINT fk_goods_receipt_lines_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipt_lines_receipt FOREIGN KEY (tenant_id, company_id, branch_id, receipt_id) REFERENCES inv.goods_receipts (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipt_lines_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipt_lines_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipt_lines_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_goods_receipt_lines_quantity CHECK (quantity > 0),
  CONSTRAINT ck_goods_receipt_lines_line_no CHECK (line_no > 0),
  CONSTRAINT ck_goods_receipt_lines_unit_cost CHECK (unit_cost IS NULL OR unit_cost >= 0),
  -- A cost without a currency is not a cost. The two move together or not at all.
  CONSTRAINT ck_goods_receipt_lines_cost_currency CHECK ((unit_cost IS NULL) = (currency_code IS NULL))
);
COMMENT ON TABLE inv.goods_receipt_lines IS 'One counted line of a goods receipt. unit_cost/currency_code are the INPUT a cost layer is built from at posting time; no read path in the inventory module returns them, and the durable cost record is the inv.cost.view-gated inv.item_cost_layers.';
CREATE UNIQUE INDEX uq_goods_receipt_lines_cell ON inv.goods_receipt_lines (tenant_id, company_id, branch_id, receipt_id, item_id, location_id);
CREATE INDEX ix_goods_receipt_lines_receipt ON inv.goods_receipt_lines (tenant_id, company_id, branch_id, receipt_id);
CREATE INDEX ix_goods_receipt_lines_item ON inv.goods_receipt_lines (tenant_id, item_id);
CREATE INDEX ix_goods_receipt_lines_location ON inv.goods_receipt_lines (tenant_id, company_id, branch_id, location_id);
CREATE INDEX ix_goods_receipt_lines_currency ON inv.goods_receipt_lines (currency_code);
CREATE TRIGGER tg_goods_receipt_lines_touch_metadata BEFORE UPDATE ON inv.goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_goods_receipt_lines_immutable BEFORE UPDATE ON inv.goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'receipt_id', 'line_no', 'item_id', 'location_id', 'quantity', 'unit_cost', 'currency_code', 'created_at', 'created_by');
ALTER TABLE inv.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.goods_receipt_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_goods_receipt_lines_scope ON inv.goods_receipt_lines FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_goods_receipt_lines_scope ON inv.goods_receipt_lines FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_goods_receipt_lines_scope ON inv.goods_receipt_lines FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.goods_receipt_lines TO app_runtime;
GRANT SELECT ON inv.goods_receipt_lines TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. inv.item_cost_layers — RESTRICTED, append-only cost history.
--
--    The point of the table is what it does NOT allow. There is no UPDATE grant
--    and no UPDATE policy, so a later receipt cannot revise an earlier layer, and
--    nothing here writes inv.item_cost_details.standard_cost. A current reference
--    cost is therefore DERIVED from the layers on every read — latest, and
--    quantity-weighted average — and there is no stored figure a second receipt
--    could silently overwrite.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.item_cost_layers (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  item_id        uuid    NOT NULL,
  source_kind    text    NOT NULL,
  source_id      uuid    NOT NULL,
  quantity       numeric(12, 3) NOT NULL,
  unit_cost      numeric(18, 4) NOT NULL,
  currency_code  text    NOT NULL,
  effective_at   timestamptz NOT NULL DEFAULT now(),
  classification text    NOT NULL DEFAULT 'restricted',
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,

  CONSTRAINT pk_item_cost_layers PRIMARY KEY (id),
  CONSTRAINT fk_item_cost_layers_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_cost_layers_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_cost_layers_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_cost_layers_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_item_cost_layers_source_kind CHECK (source_kind IN ('goods_receipt_line', 'opening_line', 'external_purchase')),
  CONSTRAINT ck_item_cost_layers_quantity CHECK (quantity > 0),
  CONSTRAINT ck_item_cost_layers_unit_cost CHECK (unit_cost >= 0),
  CONSTRAINT ck_item_cost_layers_classification CHECK (classification = 'restricted')
);
COMMENT ON TABLE inv.item_cost_layers IS 'RESTRICTED append-only item cost history. One layer per priced source; never updated and never deleted, so the cost of what was received then survives a different price now. Every policy gated by iam.has_permission(''inv.cost.view'').';
CREATE UNIQUE INDEX uq_item_cost_layers_source ON inv.item_cost_layers (tenant_id, source_kind, source_id);
CREATE INDEX ix_item_cost_layers_item ON inv.item_cost_layers (tenant_id, item_id, effective_at DESC);
CREATE INDEX ix_item_cost_layers_branch ON inv.item_cost_layers (tenant_id, company_id, branch_id);
CREATE INDEX ix_item_cost_layers_currency ON inv.item_cost_layers (currency_code);
ALTER TABLE inv.item_cost_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_cost_layers FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_item_cost_layers_gated ON inv.item_cost_layers FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('inv.cost.view'));
CREATE POLICY ins_item_cost_layers_gated ON inv.item_cost_layers FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('inv.cost.view'));
-- SELECT and INSERT only. An UPDATE grant would make "never rewritten" a promise
-- rather than a property.
GRANT SELECT, INSERT ON inv.item_cost_layers TO app_runtime;
GRANT SELECT ON inv.item_cost_layers TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. inv.stock_counts / inv.stock_count_lines.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_counts (
  id              uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid    NOT NULL,
  company_id      uuid    NOT NULL,
  branch_id       uuid    NOT NULL,
  location_id     uuid    NOT NULL,
  status          text    NOT NULL DEFAULT 'open',
  snapshot_at     timestamptz NOT NULL,
  counted_by      uuid    NOT NULL,
  reconciled_at   timestamptz NULL,
  reconciled_by   uuid    NULL,
  cancelled_at    timestamptz NULL,
  cancelled_by    uuid    NULL,
  cancel_reason   text    NULL,
  notes           text    NULL,
  correlation_id  uuid    NULL,
  idempotency_key text    NULL,
  record_version  integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid    NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid    NULL,

  CONSTRAINT pk_stock_counts PRIMARY KEY (id),
  CONSTRAINT uq_stock_counts_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_stock_counts_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_counts_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_counts_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_counts_status CHECK (status IN ('open', 'counting', 'reconciled', 'cancelled')),
  CONSTRAINT ck_stock_counts_reconciled CHECK ((status = 'reconciled') = (reconciled_at IS NOT NULL)),
  CONSTRAINT ck_stock_counts_cancelled CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT ck_stock_counts_cancel_reason_not_blank CHECK (cancel_reason IS NULL OR btrim(cancel_reason) <> ''),
  CONSTRAINT ck_stock_counts_cancel_reason_state CHECK (cancel_reason IS NULL OR status = 'cancelled'),
  CONSTRAINT ck_stock_counts_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
COMMENT ON TABLE inv.stock_counts IS 'A physical count of one stock location. The ledger keeps moving while it is open: snapshot_at fixes what was on hand when it started, and reconciliation subtracts the movements posted since, so stock issued mid-count is not reported as a loss. Reconciling raises PENDING adjustments and posts nothing.';
CREATE UNIQUE INDEX uq_stock_counts_idempotency ON inv.stock_counts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- At most ONE count may be in progress at a location. Two open counts of the same
-- shelf would each raise adjustments for the other's findings.
CREATE UNIQUE INDEX uq_stock_counts_open_location ON inv.stock_counts (tenant_id, company_id, branch_id, location_id) WHERE status IN ('open', 'counting');
CREATE INDEX ix_stock_counts_branch ON inv.stock_counts (tenant_id, company_id, branch_id);
CREATE INDEX ix_stock_counts_location ON inv.stock_counts (tenant_id, company_id, branch_id, location_id);
CREATE INDEX ix_stock_counts_status ON inv.stock_counts (tenant_id, company_id, branch_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION inv.guard_stock_count_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('reconciled', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inv.stock_counts: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'reconciled' AND NEW.reconciled_by IS NULL THEN
    RAISE EXCEPTION 'inv.stock_counts: a reconciled count requires reconciled_by' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_by IS NULL THEN
    RAISE EXCEPTION 'inv.stock_counts: a cancelled count requires cancelled_by' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_count_status() FROM PUBLIC;

CREATE TRIGGER tg_stock_counts_status BEFORE INSERT OR UPDATE ON inv.stock_counts
  FOR EACH ROW EXECUTE FUNCTION inv.guard_stock_count_status();
CREATE TRIGGER tg_stock_counts_touch_metadata BEFORE UPDATE ON inv.stock_counts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_counts_immutable BEFORE UPDATE ON inv.stock_counts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'location_id', 'snapshot_at', 'counted_by', 'idempotency_key', 'created_at', 'created_by');
ALTER TABLE inv.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_counts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_counts_scope ON inv.stock_counts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_counts_scope ON inv.stock_counts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_counts_scope ON inv.stock_counts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_counts TO app_runtime;
GRANT SELECT ON inv.stock_counts TO app_readonly;

CREATE TABLE inv.stock_count_lines (
  id                          uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                   uuid    NOT NULL,
  company_id                  uuid    NOT NULL,
  branch_id                   uuid    NOT NULL,
  count_id                    uuid    NOT NULL,
  item_id                     uuid    NOT NULL,
  snapshot_qty                numeric(12, 3) NOT NULL,
  counted_qty                 numeric(12, 3) NULL,
  movement_delta_during_count numeric(12, 3) NOT NULL DEFAULT 0,
  -- GENERATED, so the variance can never disagree with its three inputs. NULL
  -- until the line is actually counted, which is what distinguishes "counted and
  -- found correct" from "not counted".
  variance_qty                numeric(12, 3) GENERATED ALWAYS AS (counted_qty - (snapshot_qty + movement_delta_during_count)) STORED,
  adjustment_id               uuid    NULL,
  record_version              integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid    NOT NULL,
  updated_at                  timestamptz NULL,
  updated_by                  uuid    NULL,

  CONSTRAINT pk_stock_count_lines PRIMARY KEY (id),
  CONSTRAINT uq_stock_count_lines_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_stock_count_lines_cell UNIQUE (tenant_id, company_id, branch_id, count_id, item_id),
  CONSTRAINT fk_stock_count_lines_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_lines_count FOREIGN KEY (tenant_id, company_id, branch_id, count_id) REFERENCES inv.stock_counts (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_lines_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_lines_adjustment FOREIGN KEY (tenant_id, company_id, branch_id, adjustment_id) REFERENCES inv.stock_adjustments (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_count_lines_snapshot CHECK (snapshot_qty >= 0),
  CONSTRAINT ck_stock_count_lines_counted CHECK (counted_qty IS NULL OR counted_qty >= 0)
);
COMMENT ON TABLE inv.stock_count_lines IS 'One item on a stock count. variance_qty is GENERATED from counted − (snapshot + movements posted during the count), so it cannot disagree with its inputs, and adjustment_id names the PENDING adjustment the variance raised — approval stays a separate act.';
CREATE INDEX ix_stock_count_lines_count ON inv.stock_count_lines (tenant_id, company_id, branch_id, count_id);
CREATE INDEX ix_stock_count_lines_item ON inv.stock_count_lines (tenant_id, item_id);
CREATE INDEX ix_stock_count_lines_adjustment ON inv.stock_count_lines (tenant_id, company_id, branch_id, adjustment_id);
CREATE TRIGGER tg_stock_count_lines_touch_metadata BEFORE UPDATE ON inv.stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_count_lines_immutable BEFORE UPDATE ON inv.stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'count_id', 'item_id', 'snapshot_qty', 'created_at', 'created_by');
ALTER TABLE inv.stock_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_count_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_count_lines_scope ON inv.stock_count_lines FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_count_lines_scope ON inv.stock_count_lines FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_count_lines_scope ON inv.stock_count_lines FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_count_lines TO app_runtime;
GRANT SELECT ON inv.stock_count_lines TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. PROVENANCE — the three new reference kinds.
--
--    The guard is the trust root: a raw inv.stock_movements INSERT cannot mint
--    stock because every reference kind must prove a source in the right state
--    with the right quantity, and an unknown kind is refused outright. Widening
--    the CHECK above without widening this would have opened exactly that hole,
--    which is why both happen in one migration.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.guard_stock_movement_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_qty numeric(12, 3); v_status text; v_dir text; v_batch_status text;
        t inv.stock_transfers%ROWTYPE; v_receipt_status text; v_location uuid;
BEGIN
  IF NEW.reference_kind = 'opening_line' THEN
    SELECT l.quantity, b.status INTO v_qty, v_batch_status
      FROM inv.opening_inventory_lines l JOIN inv.opening_inventory_batches b
        ON b.tenant_id = l.tenant_id AND b.company_id = l.company_id AND b.branch_id = l.branch_id AND b.id = l.batch_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.reference_id AND l.item_id = NEW.item_id AND l.location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: opening line % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_batch_status <> 'approved' THEN RAISE EXCEPTION 'stock movement: opening batch is % (must be approved)', v_batch_status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'opening' OR NEW.direction <> 'in' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: opening movement must be in/opening with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'part_issue' THEN
    SELECT quantity INTO v_qty FROM inv.part_issues WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id AND location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: part issue % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF NEW.movement_type <> 'issue' OR NEW.direction <> 'out' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: issue movement must be out/issue with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'part_return' THEN
    SELECT r.quantity INTO v_qty FROM inv.part_returns r JOIN inv.part_issues i
        ON i.tenant_id = r.tenant_id AND i.company_id = r.company_id AND i.branch_id = r.branch_id AND i.id = r.part_issue_id
      WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reference_id AND i.item_id = NEW.item_id AND i.location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: part return % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF NEW.movement_type <> 'return' OR NEW.direction <> 'in' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: return movement must be in/return with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'damage' THEN
    SELECT quantity INTO v_qty FROM inv.damaged_stock
      WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id
        AND (from_location_id = NEW.location_id OR quarantine_location_id = NEW.location_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: damaged stock % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF NEW.movement_type <> 'damage' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: damage movement must be type damage with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'adjustment' THEN
    SELECT quantity, status, direction INTO v_qty, v_status, v_dir FROM inv.stock_adjustments
      WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id AND location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: adjustment % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_status <> 'approved' THEN RAISE EXCEPTION 'stock movement: adjustment is % (must be approved)', v_status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'adjustment' OR NEW.direction <> v_dir OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: adjustment movement must match the approved adjustment (dir %, qty %)', v_dir, v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'transfer_dispatch' THEN
    -- The DISPATCH pair: out of the source cell, in to transit, while the transfer
    -- is still `dispatched`. Both legs are bound to the transfer's own quantity and
    -- to the two locations the transfer names, so neither can be redirected.
    SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: stock transfer % not found for this item', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF t.status <> 'dispatched' THEN RAISE EXCEPTION 'stock movement: transfer is % (dispatch movements post only while dispatched)', t.status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'transfer' OR NEW.quantity <> t.quantity THEN
      RAISE EXCEPTION 'stock movement: transfer dispatch must be type transfer with quantity %', t.quantity USING ERRCODE = 'check_violation'; END IF;
    v_location := CASE WHEN NEW.direction = 'out' THEN t.from_location_id ELSE t.transit_location_id END;
    IF NEW.location_id <> v_location THEN
      RAISE EXCEPTION 'stock movement: transfer dispatch % leg must name location %', NEW.direction, v_location USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'transfer_receipt' THEN
    -- The SETTLEMENT pair: out of transit, and in to the destination on a receipt
    -- or back to the origin on a cancellation. The `in` leg's legal location is
    -- decided by the transfer's own terminal status, so a cancelled transfer cannot
    -- deliver and a received one cannot be returned.
    SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: stock transfer % not found for this item', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF t.status NOT IN ('received', 'cancelled') THEN
      RAISE EXCEPTION 'stock movement: transfer is % (settlement movements post only once received or cancelled)', t.status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'transfer' OR NEW.quantity <> t.quantity THEN
      RAISE EXCEPTION 'stock movement: transfer settlement must be type transfer with quantity %', t.quantity USING ERRCODE = 'check_violation'; END IF;
    IF NEW.direction = 'out' THEN
      v_location := t.transit_location_id;
    ELSIF t.status = 'received' THEN
      v_location := t.to_location_id;
    ELSE
      v_location := t.from_location_id;
    END IF;
    IF NEW.location_id <> v_location THEN
      RAISE EXCEPTION 'stock movement: transfer settlement % leg must name location %', NEW.direction, v_location USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'goods_receipt_line' THEN
    SELECT l.quantity, r.status INTO v_qty, v_receipt_status
      FROM inv.goods_receipt_lines l JOIN inv.goods_receipts r
        ON r.tenant_id = l.tenant_id AND r.company_id = l.company_id AND r.branch_id = l.branch_id AND r.id = l.receipt_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.reference_id AND l.item_id = NEW.item_id AND l.location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: goods receipt line % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_receipt_status <> 'posted' THEN RAISE EXCEPTION 'stock movement: goods receipt is % (must be posted)', v_receipt_status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'receipt' OR NEW.direction <> 'in' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: goods receipt movement must be in/receipt with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSE
    RAISE EXCEPTION 'stock movement: unknown reference_kind %', NEW.reference_kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_movement_provenance() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 7. Operation functions (SECURITY INVOKER; app_runtime executes).
-- ----------------------------------------------------------------------------

-- The branch's single system transit location, created on first use.
--
-- It is created lazily rather than provisioned, because a branch that never
-- transfers should not carry a location that holds nothing, and because
-- provisioning already exists and adding a step to it would change every tenant.
CREATE OR REPLACE FUNCTION inv.ensure_transit_location(p_company uuid, p_branch uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.ensure_transit_location requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT id INTO v_id FROM inv.stock_locations
    WHERE tenant_id = v_tenant AND company_id = p_company AND branch_id = p_branch
      AND location_type = 'transit' AND deleted_at IS NULL
    ORDER BY location_code LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;
  BEGIN
    INSERT INTO inv.stock_locations (tenant_id, company_id, branch_id, location_code, name, location_type, created_by)
      VALUES (v_tenant, p_company, p_branch, 'TRANSIT', 'In transit', 'transit', iam.current_user_id())
      RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM inv.stock_locations
      WHERE tenant_id = v_tenant AND company_id = p_company AND branch_id = p_branch AND location_code = 'TRANSIT';
  END;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.ensure_transit_location(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.ensure_transit_location(uuid, uuid) TO app_runtime;

-- Dispatch: source cell -> transit, under the balance lock, with lifetime
-- idempotency resolved INSIDE the lock exactly as inv.reserve_stock does.
--
-- Availability is checked rather than freed. `inv.record_damage` releases
-- conflicting reservations because damage is a loss that has already happened; a
-- transfer is a choice, so destroying another work order's guaranteed part to make
-- room for it would be the wrong answer. The dispatch is REFUSED instead.
CREATE OR REPLACE FUNCTION inv.dispatch_transfer(
  p_item uuid, p_from uuid, p_to uuid, p_qty numeric,
  p_reason text DEFAULT NULL, p_idempotency_key text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id();
        v_co uuid; v_br uuid; v_to_co uuid; v_to_br uuid; v_transit uuid;
        v_existing uuid; v_transfer uuid; v_onhand numeric(12, 3); v_reserved numeric(12, 3);
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.dispatch_transfer requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'transfer quantity must be positive' USING ERRCODE = 'check_violation'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'a transfer must name two different locations' USING ERRCODE = 'check_violation'; END IF;
  SELECT company_id, branch_id INTO v_co, v_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_from;
  IF NOT FOUND THEN RAISE EXCEPTION 'source stock location % not found in tenant', p_from USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT company_id, branch_id INTO v_to_co, v_to_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_to;
  IF NOT FOUND THEN RAISE EXCEPTION 'destination stock location % not found in tenant', p_to USING ERRCODE = 'foreign_key_violation'; END IF;
  IF v_to_co <> v_co THEN
    RAISE EXCEPTION 'a transfer may not cross a company boundary' USING ERRCODE = 'check_violation';
  END IF;

  v_transit := inv.ensure_transit_location(v_co, v_br);
  PERFORM inv.lock_stock_balance(v_tenant, v_co, v_br, p_item, p_from);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM inv.stock_transfers WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  PERFORM inv.lock_stock_balance(v_tenant, v_co, v_br, p_item, v_transit);
  SELECT on_hand_qty, reserved_qty INTO v_onhand, v_reserved FROM inv.stock_balances
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = p_item AND location_id = p_from;
  IF p_qty > COALESCE(v_onhand, 0) - COALESCE(v_reserved, 0) THEN
    RAISE EXCEPTION 'insufficient available stock to dispatch (requested %, available %)',
      p_qty, COALESCE(v_onhand, 0) - COALESCE(v_reserved, 0) USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO inv.stock_transfers (
    tenant_id, company_id, branch_id, item_id, from_location_id, transit_location_id,
    to_branch_id, to_location_id, quantity, status, reason, dispatched_by,
    correlation_id, idempotency_key, created_by)
    VALUES (v_tenant, v_co, v_br, p_item, p_from, v_transit, v_to_br, p_to, p_qty,
            'dispatched', p_reason, iam.current_user_id(), p_correlation, p_idempotency_key, iam.current_user_id())
    RETURNING id INTO v_transfer;

  PERFORM inv.post_stock_movement(p_item, p_from, 'transfer', 'out', p_qty, 'transfer_dispatch', v_transfer, p_correlation);
  PERFORM inv.post_stock_movement(p_item, v_transit, 'transfer', 'in', p_qty, 'transfer_dispatch', v_transfer, p_correlation);
  RETURN v_transfer;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.dispatch_transfer(uuid, uuid, uuid, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.dispatch_transfer(uuid, uuid, uuid, numeric, text, text, uuid) TO app_runtime;

-- Receipt: transit -> destination. The row is locked FOR UPDATE first, so two
-- concurrent receipts of one transfer produce exactly one winner: the second finds
-- the status already `received` and is refused.
CREATE OR REPLACE FUNCTION inv.receive_transfer(p_transfer uuid, p_qty numeric, p_correlation uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); t inv.stock_transfers%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.receive_transfer requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock transfer % not found', p_transfer USING ERRCODE = 'foreign_key_violation'; END IF;
  IF t.status <> 'dispatched' THEN RAISE EXCEPTION 'stock transfer is % (must be dispatched)', t.status USING ERRCODE = 'check_violation'; END IF;
  IF p_qty IS NULL OR p_qty <> t.quantity THEN
    RAISE EXCEPTION 'transfer_quantity_mismatch: the received quantity % must equal the dispatched %; partial receipt is out of scope',
      p_qty, t.quantity USING ERRCODE = 'check_violation';
  END IF;
  PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.branch_id, t.item_id, t.transit_location_id);
  PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.to_branch_id, t.item_id, t.to_location_id);
  UPDATE inv.stock_transfers
     SET status = 'received', received_at = now(), received_by = iam.current_user_id(), received_quantity = p_qty
   WHERE tenant_id = v_tenant AND id = p_transfer;
  PERFORM inv.post_stock_movement(t.item_id, t.transit_location_id, 'transfer', 'out', t.quantity, 'transfer_receipt', t.id, p_correlation);
  PERFORM inv.post_stock_movement(t.item_id, t.to_location_id, 'transfer', 'in', t.quantity, 'transfer_receipt', t.id, p_correlation);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.receive_transfer(uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.receive_transfer(uuid, numeric, uuid) TO app_runtime;

-- Cancellation: transit -> back to the origin, through the same settlement pair.
-- Nothing is deleted and nothing is reversed in place; the ledger keeps all four
-- movements and their net effect is zero.
CREATE OR REPLACE FUNCTION inv.cancel_transfer(p_transfer uuid, p_reason text, p_correlation uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); t inv.stock_transfers%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.cancel_transfer requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a cancellation requires a reason' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock transfer % not found', p_transfer USING ERRCODE = 'foreign_key_violation'; END IF;
  IF t.status <> 'dispatched' THEN RAISE EXCEPTION 'stock transfer is % (must be dispatched)', t.status USING ERRCODE = 'check_violation'; END IF;
  PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.branch_id, t.item_id, t.transit_location_id);
  PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.branch_id, t.item_id, t.from_location_id);
  UPDATE inv.stock_transfers
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = iam.current_user_id(), cancel_reason = p_reason
   WHERE tenant_id = v_tenant AND id = p_transfer;
  PERFORM inv.post_stock_movement(t.item_id, t.transit_location_id, 'transfer', 'out', t.quantity, 'transfer_receipt', t.id, p_correlation);
  PERFORM inv.post_stock_movement(t.item_id, t.from_location_id, 'transfer', 'in', t.quantity, 'transfer_receipt', t.id, p_correlation);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.cancel_transfer(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.cancel_transfer(uuid, text, uuid) TO app_runtime;

-- Post a goods receipt: one `receipt`/`in` movement per line, and one APPENDED
-- cost layer per priced line. Writing a layer needs `inv.cost.view` because the
-- table's INSERT policy is gated on it, so posting a priced receipt requires the
-- cost authority that entering the price required.
CREATE OR REPLACE FUNCTION inv.post_goods_receipt(p_receipt uuid, p_correlation uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.goods_receipts%ROWTYPE; ln RECORD; v_lines int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.post_goods_receipt requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO r FROM inv.goods_receipts WHERE tenant_id = v_tenant AND id = p_receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'goods receipt % not found', p_receipt USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'goods receipt is % (must be draft)', r.status USING ERRCODE = 'check_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM inv.goods_receipt_lines WHERE tenant_id = v_tenant AND receipt_id = p_receipt) THEN
    RAISE EXCEPTION 'a goods receipt with no lines cannot be posted' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inv.goods_receipts SET status = 'posted', posted_at = now(), posted_by = iam.current_user_id()
   WHERE tenant_id = v_tenant AND id = p_receipt;
  FOR ln IN
    SELECT id, company_id, branch_id, item_id, location_id, quantity, unit_cost, currency_code
      FROM inv.goods_receipt_lines WHERE tenant_id = v_tenant AND receipt_id = p_receipt ORDER BY line_no
  LOOP
    PERFORM inv.post_stock_movement(ln.item_id, ln.location_id, 'receipt', 'in', ln.quantity, 'goods_receipt_line', ln.id, p_correlation);
    IF ln.unit_cost IS NOT NULL THEN
      INSERT INTO inv.item_cost_layers (tenant_id, company_id, branch_id, item_id, source_kind, source_id, quantity, unit_cost, currency_code, effective_at, created_by)
        VALUES (v_tenant, ln.company_id, ln.branch_id, ln.item_id, 'goods_receipt_line', ln.id, ln.quantity, ln.unit_cost, ln.currency_code, now(), iam.current_user_id());
    END IF;
    v_lines := v_lines + 1;
  END LOOP;
  RETURN v_lines;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.post_goods_receipt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.post_goods_receipt(uuid, uuid) TO app_runtime;

-- Reject a pending adjustment.
--
-- `inv.approve_adjustment` existed and its counterpart did not, so a pending
-- adjustment could only ever be approved or left open forever. The maker-checker
-- rule is enforced here because `inv.guard_adjustment_approval` only constrains
-- `approved_by`, and a rejection sets no approver — so without this check a
-- requester could dispose of their own request.
CREATE OR REPLACE FUNCTION inv.reject_adjustment(p_adjustment uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); a inv.stock_adjustments%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.reject_adjustment requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO a FROM inv.stock_adjustments WHERE tenant_id = v_tenant AND id = p_adjustment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'adjustment % not found', p_adjustment USING ERRCODE = 'foreign_key_violation'; END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'adjustment is % (must be pending)', a.status USING ERRCODE = 'check_violation'; END IF;
  IF a.requested_by = iam.current_user_id() THEN
    RAISE EXCEPTION 'the requester may not decide their own adjustment (maker<>checker)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inv.stock_adjustments SET status = 'rejected' WHERE tenant_id = v_tenant AND id = p_adjustment;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.reject_adjustment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.reject_adjustment(uuid) TO app_runtime;

-- Open a count: snapshot every cell that holds a balance at the location.
--
-- Each balance row is locked FOR UPDATE as it is read, so the snapshot is
-- internally consistent — but the LEDGER IS NOT FROZEN. A count that stopped
-- trading for its duration would be unusable in a working branch, so trading
-- continues and the reconciliation subtracts what moved.
CREATE OR REPLACE FUNCTION inv.open_stock_count(
  p_location uuid, p_notes text DEFAULT NULL, p_idempotency_key text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_co uuid; v_br uuid;
        v_existing uuid; v_count uuid; v_snapshot timestamptz := now(); b RECORD;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.open_stock_count requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT company_id, branch_id INTO v_co, v_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_location;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock location % not found in tenant', p_location USING ERRCODE = 'foreign_key_violation'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM inv.stock_counts WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  INSERT INTO inv.stock_counts (tenant_id, company_id, branch_id, location_id, status, snapshot_at, counted_by, notes, correlation_id, idempotency_key, created_by)
    VALUES (v_tenant, v_co, v_br, p_location, 'open', v_snapshot, iam.current_user_id(), p_notes, p_correlation, p_idempotency_key, iam.current_user_id())
    RETURNING id INTO v_count;
  FOR b IN
    SELECT item_id, on_hand_qty FROM inv.stock_balances
     WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND location_id = p_location
     ORDER BY item_id
     FOR UPDATE
  LOOP
    INSERT INTO inv.stock_count_lines (tenant_id, company_id, branch_id, count_id, item_id, snapshot_qty, created_by)
      VALUES (v_tenant, v_co, v_br, v_count, b.item_id, b.on_hand_qty, iam.current_user_id());
  END LOOP;
  RETURN v_count;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.open_stock_count(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.open_stock_count(uuid, text, text, uuid) TO app_runtime;

-- Record what was actually on the shelf for one item.
--
-- An item with no balance row is accepted with a zero snapshot: finding stock that
-- the ledger does not know about is exactly what a count is for, and refusing it
-- would make the surplus invisible.
CREATE OR REPLACE FUNCTION inv.record_stock_count_line(p_count uuid, p_item uuid, p_counted_qty numeric)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); c inv.stock_counts%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.record_stock_count_line requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN RAISE EXCEPTION 'a counted quantity may not be negative' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO c FROM inv.stock_counts WHERE tenant_id = v_tenant AND id = p_count FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock count % not found', p_count USING ERRCODE = 'foreign_key_violation'; END IF;
  IF c.status NOT IN ('open', 'counting') THEN RAISE EXCEPTION 'stock count is % (must be open or counting)', c.status USING ERRCODE = 'check_violation'; END IF;
  UPDATE inv.stock_count_lines SET counted_qty = p_counted_qty
   WHERE tenant_id = v_tenant AND company_id = c.company_id AND branch_id = c.branch_id AND count_id = p_count AND item_id = p_item;
  IF NOT FOUND THEN
    INSERT INTO inv.stock_count_lines (tenant_id, company_id, branch_id, count_id, item_id, snapshot_qty, counted_qty, created_by)
      VALUES (v_tenant, c.company_id, c.branch_id, p_count, p_item, 0, p_counted_qty, iam.current_user_id());
  END IF;
  IF c.status = 'open' THEN
    UPDATE inv.stock_counts SET status = 'counting' WHERE tenant_id = v_tenant AND id = p_count;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.record_stock_count_line(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.record_stock_count_line(uuid, uuid, numeric) TO app_runtime;

-- Reconcile: subtract what moved during the count, then raise a PENDING adjustment
-- per non-zero variance and STOP.
--
-- The count deliberately posts nothing. Every quantity correction in this schema
-- reaches the ledger through inv.approve_adjustment and a second person, and a
-- count that wrote its own findings straight to stock would be a way around that
-- rule rather than a use of it.
CREATE OR REPLACE FUNCTION inv.reconcile_stock_count(p_count uuid, p_correlation uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); c inv.stock_counts%ROWTYPE; ln RECORD;
        v_delta numeric(12, 3); v_variance numeric(12, 3); v_adj uuid; v_raised int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.reconcile_stock_count requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO c FROM inv.stock_counts WHERE tenant_id = v_tenant AND id = p_count FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock count % not found', p_count USING ERRCODE = 'foreign_key_violation'; END IF;
  IF c.status NOT IN ('open', 'counting') THEN RAISE EXCEPTION 'stock count is % (must be open or counting)', c.status USING ERRCODE = 'check_violation'; END IF;
  FOR ln IN
    SELECT id, item_id, snapshot_qty, counted_qty FROM inv.stock_count_lines
     WHERE tenant_id = v_tenant AND count_id = p_count AND counted_qty IS NOT NULL
     ORDER BY item_id
  LOOP
    PERFORM inv.lock_stock_balance(v_tenant, c.company_id, c.branch_id, ln.item_id, c.location_id);
    SELECT COALESCE(SUM(signed_qty), 0) INTO v_delta FROM inv.stock_movements
      WHERE tenant_id = v_tenant AND company_id = c.company_id AND branch_id = c.branch_id
        AND item_id = ln.item_id AND location_id = c.location_id AND occurred_at > c.snapshot_at;
    UPDATE inv.stock_count_lines SET movement_delta_during_count = v_delta
     WHERE tenant_id = v_tenant AND id = ln.id;
    v_variance := ln.counted_qty - (ln.snapshot_qty + v_delta);
    IF v_variance <> 0 THEN
      INSERT INTO inv.stock_adjustments (
        tenant_id, company_id, branch_id, item_id, location_id, direction, quantity,
        reason, status, requested_by, created_by)
        VALUES (v_tenant, c.company_id, c.branch_id, ln.item_id, c.location_id,
                CASE WHEN v_variance > 0 THEN 'in' ELSE 'out' END, abs(v_variance),
                'stock count ' || p_count::text, 'pending', iam.current_user_id(), iam.current_user_id())
        RETURNING id INTO v_adj;
      UPDATE inv.stock_count_lines SET adjustment_id = v_adj WHERE tenant_id = v_tenant AND id = ln.id;
      v_raised := v_raised + 1;
    END IF;
  END LOOP;
  UPDATE inv.stock_counts SET status = 'reconciled', reconciled_at = now(), reconciled_by = iam.current_user_id()
   WHERE tenant_id = v_tenant AND id = p_count;
  RETURN v_raised;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.reconcile_stock_count(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.reconcile_stock_count(uuid, uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.cancel_stock_count(p_count uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); c inv.stock_counts%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.cancel_stock_count requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a cancellation requires a reason' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO c FROM inv.stock_counts WHERE tenant_id = v_tenant AND id = p_count FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock count % not found', p_count USING ERRCODE = 'foreign_key_violation'; END IF;
  IF c.status NOT IN ('open', 'counting') THEN RAISE EXCEPTION 'stock count is % (must be open or counting)', c.status USING ERRCODE = 'check_violation'; END IF;
  UPDATE inv.stock_counts SET status = 'cancelled', cancelled_at = now(), cancelled_by = iam.current_user_id(), cancel_reason = p_reason
   WHERE tenant_id = v_tenant AND id = p_count;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.cancel_stock_count(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.cancel_stock_count(uuid, text) TO app_runtime;
