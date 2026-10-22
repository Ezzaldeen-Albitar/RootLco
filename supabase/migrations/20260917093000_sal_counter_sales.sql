-- ============================================================================
-- Phase: 1-32 (preparatory) — the external (counter) sale
-- Migration: sal.invoices without a work order, inventory lines on an invoice,
--            the `sale` movement, and sal.create_counter_sale_invoice
-- Tasks: P1-32-PRE-107 … P1-32-PRE-111
-- Owner module: sal (billing), with the inv ledger widening the sale needs
--
-- Rollback classification: ROLL-FORWARD-ONLY. Dropping `sale_kind` after a counter
--   sale exists would make `work_order_id IS NULL` unreadable, and the `sale`
--   movements it posted cite invoice lines that the dropped columns describe. No
--   down script.
--
-- Purpose
--   A workshop also sells a part over the counter: a customer — often another
--   garage — buys a filter and leaves. No vehicle is received, no work order is
--   opened, and nothing is fitted. Until now `sal.invoices.work_order_id` was NOT
--   NULL, so that sale could not be invoiced at all, and the only way to record it
--   was to open a work order for a job nobody performs.
--
--     * A COUNTER SALE IS AN INVOICE KIND, NOT A SECOND DOCUMENT.
--       `sale_kind` is `work_order` or `counter_sale`, and
--       `ck_invoices_sale_kind_source` makes the work order present for exactly one
--       of them. Numbering, issuance, credit notes, receipts and allocation are the
--       ones that already exist; nothing about settlement is duplicated.
--
--     * STOCK LEAVES AT ISSUANCE, EXACTLY ONCE. A draft counter sale moves no
--       stock: it is a document being assembled, and a customer who walks away
--       leaves nothing to undo. Issuing it posts one `sale`/`out` movement per line
--       through `inv.post_counter_sale_line`, which locks the balance cell and
--       refuses to sell stock that is not available. `uq_stock_movements_source` is
--       UNIQUE on (reference_kind, reference_id, direction), so a second posting for
--       one invoice line is refused by the index rather than by a code path.
--
--     * CANCELLING AN ISSUED SALE DOES NOT RETURN STOCK. It cannot even be
--       attempted: `sal.guard_invoice_freeze` allows `issued -> credited` and
--       nothing else, so there is no post-issue void. Stock comes back only when
--       someone physically brings it back, which is a sales return
--       (20260917094000) — a separate act, with its own condition and its own
--       credit note. A cancelled document is not evidence that a part returned.
--
--     * THE PRICE IS RESOLVED, NEVER SENT. `sal.create_counter_sale_invoice` reads
--       `inv.resolve_item_sale_price` and `org.tax_rates`, and every amount is
--       computed here in `numeric`. The function takes no price, no total and no
--       tax from its caller, exactly as `sal.invoice-create` takes none.
--
-- Dependencies
--   sal.invoices, sal.invoice_amounts, sal.invoice_lines, sal.invoice_line_amounts,
--   sal.invoice_status_history (20260724091000); sal.issue_invoice (20260724093000);
--   inv.item_master, inv.stock_locations (20260723093000); inv.post_stock_movement,
--   inv.lock_stock_balance (20260723094000); inv.item_sale_prices (20260917092000);
--   crm.business_partners; org.tax_rates.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sal.invoices — a sale kind, and a work order only for one of them.
-- ----------------------------------------------------------------------------
ALTER TABLE sal.invoices ALTER COLUMN work_order_id DROP NOT NULL;
ALTER TABLE sal.invoices ADD COLUMN sale_kind text NOT NULL DEFAULT 'work_order';
ALTER TABLE sal.invoices ADD CONSTRAINT ck_invoices_sale_kind
  CHECK (sale_kind IN ('work_order', 'counter_sale'));
-- The equality, not two implications: a work-order invoice HAS a work order and a
-- counter sale has none. Neither an orphaned work-order invoice nor a counter sale
-- secretly attached to a job is representable.
ALTER TABLE sal.invoices ADD CONSTRAINT ck_invoices_sale_kind_source
  CHECK ((sale_kind = 'work_order') = (work_order_id IS NOT NULL));
COMMENT ON COLUMN sal.invoices.sale_kind IS 'work_order: the invoice bills a job (work_order_id NOT NULL). counter_sale: an over-the-counter sale of stock with no job (work_order_id NULL). Frozen for the life of the document.';
COMMENT ON COLUMN sal.invoices.work_order_id IS 'The job this invoice bills. NULL exactly when sale_kind is counter_sale (ck_invoices_sale_kind_source).';

-- One live invoice per work order — restated so the index ignores counter sales.
-- NULLs are already distinct in a unique index, so this changes no behaviour; it
-- states the intent and keeps every counter sale out of the index entirely.
DROP INDEX sal.uq_invoices_work_order_active;
CREATE UNIQUE INDEX uq_invoices_work_order_active ON sal.invoices (tenant_id, company_id, branch_id, work_order_id)
  WHERE work_order_id IS NOT NULL AND status <> 'void_before_issue' AND deleted_at IS NULL;
CREATE INDEX ix_invoices_sale_kind ON sal.invoices (tenant_id, company_id, branch_id, sale_kind, status);

-- `sale_kind` joins the columns no UPDATE may touch. A draft counter sale must not
-- become a work-order invoice: its lines carry stock references that a work-order
-- invoice may not have, and the freeze guard below only looks at invoices that have
-- already left draft.
DROP TRIGGER tg_invoices_immutable ON sal.invoices;
CREATE TRIGGER tg_invoices_immutable BEFORE UPDATE ON sal.invoices
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'sale_kind', 'created_at', 'created_by');

-- Re-issued for one reason: `NEW.work_order_id <> OLD.work_order_id` is NULL when
-- both sides are NULL, so on a counter sale the comparison silently stopped being a
-- guard. `IS DISTINCT FROM` says what was always meant.
CREATE OR REPLACE FUNCTION sal.guard_invoice_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'sal.invoices: a new invoice must be created as draft (status % is not allowed on insert; issue via sal.issue_invoice)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'issued', 'void_before_issue') THEN
      RAISE EXCEPTION 'sal.invoices: a draft invoice may only stay draft, be issued, or be voided before issue'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
       OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
       OR NEW.quotation_revision_id IS DISTINCT FROM OLD.quotation_revision_id
       OR NEW.currency_code <> OLD.currency_code THEN
      RAISE EXCEPTION 'sal.invoices: an issued invoice''s number/issue/source/currency are frozen'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF OLD.status = 'issued' AND NEW.status <> 'credited' THEN
        RAISE EXCEPTION 'sal.invoices: an issued invoice may only advance to credited' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.status IN ('credited', 'void_before_issue') THEN
        RAISE EXCEPTION 'sal.invoices: % is terminal', OLD.status USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_freeze() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. sal.invoice_lines — what was sold, and which cell it leaves.
-- ----------------------------------------------------------------------------
ALTER TABLE sal.invoice_lines ADD COLUMN item_id uuid NULL;
ALTER TABLE sal.invoice_lines ADD COLUMN stock_location_id uuid NULL;
ALTER TABLE sal.invoice_lines ADD CONSTRAINT fk_invoice_lines_item
  FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE sal.invoice_lines ADD CONSTRAINT fk_invoice_lines_stock_location
  FOREIGN KEY (tenant_id, company_id, branch_id, stock_location_id)
  REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT;
-- Both or neither: a movement needs an item AND a cell, and a line that named one
-- of them would describe a posting that cannot be made.
ALTER TABLE sal.invoice_lines ADD CONSTRAINT ck_invoice_lines_stock_pair
  CHECK ((item_id IS NULL) = (stock_location_id IS NULL));
COMMENT ON COLUMN sal.invoice_lines.item_id IS 'The stock item a counter-sale line sells. NULL on a work-order invoice, whose parts left stock as a part issue long before the invoice existed.';
COMMENT ON COLUMN sal.invoice_lines.stock_location_id IS 'The cell the counter-sale line is drawn from at issuance. NULL on a work-order invoice.';
CREATE INDEX ix_invoice_lines_item ON sal.invoice_lines (tenant_id, item_id);
CREATE INDEX ix_invoice_lines_stock_location ON sal.invoice_lines (tenant_id, company_id, branch_id, stock_location_id);

-- Re-issued to bind a line's shape to its parent's sale kind. The CHECK above
-- cannot do it: a constraint sees one row and the sale kind is on the header.
CREATE OR REPLACE FUNCTION sal.guard_invoice_line_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text; v_sale_kind text; v_currency text;
BEGIN
  SELECT status, sale_kind, currency_code INTO v_status, v_sale_kind, v_currency FROM sal.invoices
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.invoice_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'sal.invoice_lines: parent invoice % not found in scope', NEW.invoice_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'sal.invoice_lines: parent invoice is % (not draft); lines are frozen', v_status USING ERRCODE = 'check_violation';
  END IF;
  -- currency coherence with the header
  IF v_currency <> NEW.currency_code THEN
    RAISE EXCEPTION 'sal.invoice_lines: line currency must match the invoice header currency' USING ERRCODE = 'check_violation';
  END IF;
  IF v_sale_kind = 'counter_sale' THEN
    IF NEW.item_id IS NULL THEN
      RAISE EXCEPTION 'sal.invoice_lines: a counter-sale line must name the item and the stock location it leaves' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.line_type <> 'part' THEN
      RAISE EXCEPTION 'sal.invoice_lines: a counter sale sells parts; line type % is not one', NEW.line_type USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.item_id IS NOT NULL THEN
    RAISE EXCEPTION 'sal.invoice_lines: only a counter-sale line carries an item and a stock location; this invoice bills a work order' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_line_frozen() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. The ledger vocabulary: a `sale` movement citing an invoice line.
--
--    Widened here, with the provenance branch that makes it safe, because the CHECK
--    alone would let a raw INSERT mint a `sale` movement against nothing.
-- ----------------------------------------------------------------------------
ALTER TABLE inv.stock_movements DROP CONSTRAINT ck_stock_movements_type;
ALTER TABLE inv.stock_movements ADD CONSTRAINT ck_stock_movements_type
  CHECK (movement_type IN ('opening', 'issue', 'return', 'damage', 'adjustment', 'transfer', 'receipt', 'sale'));

-- `sale` is `out` only. A sale that added stock would be a return under another name.
ALTER TABLE inv.stock_movements DROP CONSTRAINT ck_stock_movements_type_direction;
ALTER TABLE inv.stock_movements ADD CONSTRAINT ck_stock_movements_type_direction
  CHECK (
    (movement_type IN ('opening', 'return', 'receipt') AND direction = 'in')
    OR (movement_type IN ('issue', 'sale') AND direction = 'out')
    OR (movement_type IN ('damage', 'adjustment', 'transfer')));

ALTER TABLE inv.stock_movements DROP CONSTRAINT ck_stock_movements_reference_kind;
ALTER TABLE inv.stock_movements ADD CONSTRAINT ck_stock_movements_reference_kind
  CHECK (reference_kind IN (
    'opening_line', 'part_issue', 'part_return', 'damage', 'adjustment',
    'transfer_dispatch', 'transfer_receipt', 'goods_receipt_line', 'invoice_line'));

-- The whole provenance guard, re-issued with the `invoice_line` branch. Every
-- earlier branch is carried unchanged: this function is the trust root for the
-- ledger, so it is replaced in one piece rather than patched.
CREATE OR REPLACE FUNCTION inv.guard_stock_movement_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_qty numeric(12, 3); v_status text; v_dir text; v_batch_status text;
        t inv.stock_transfers%ROWTYPE; v_receipt_status text; v_location uuid;
        v_sale_kind text;
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
    SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: stock transfer % not found for this item', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF t.status <> 'dispatched' THEN RAISE EXCEPTION 'stock movement: transfer is % (dispatch movements post only while dispatched)', t.status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'transfer' OR NEW.quantity <> t.quantity THEN
      RAISE EXCEPTION 'stock movement: transfer dispatch must be type transfer with quantity %', t.quantity USING ERRCODE = 'check_violation'; END IF;
    v_location := CASE WHEN NEW.direction = 'out' THEN t.from_location_id ELSE t.transit_location_id END;
    IF NEW.location_id <> v_location THEN
      RAISE EXCEPTION 'stock movement: transfer dispatch % leg must name location %', NEW.direction, v_location USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'transfer_receipt' THEN
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

  ELSIF NEW.reference_kind = 'invoice_line' THEN
    -- The counter sale. The line must belong to an ISSUED counter-sale invoice and
    -- must name this item and this cell, so the posting cannot be redirected to
    -- another location, made against a draft that may still be voided, or made
    -- against a work-order invoice whose parts already left stock as a part issue.
    SELECT l.quantity, i.status, i.sale_kind INTO v_qty, v_status, v_sale_kind
      FROM sal.invoice_lines l JOIN sal.invoices i
        ON i.tenant_id = l.tenant_id AND i.company_id = l.company_id AND i.branch_id = l.branch_id AND i.id = l.invoice_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.reference_id
        AND l.item_id = NEW.item_id AND l.stock_location_id = NEW.location_id AND l.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: invoice line % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_sale_kind <> 'counter_sale' THEN RAISE EXCEPTION 'stock movement: invoice line % does not belong to a counter sale', NEW.reference_id USING ERRCODE = 'check_violation'; END IF;
    IF v_status <> 'issued' THEN RAISE EXCEPTION 'stock movement: counter sale is % (stock leaves at issuance)', v_status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'sale' OR NEW.direction <> 'out' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: counter-sale movement must be out/sale with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSE
    RAISE EXCEPTION 'stock movement: unknown reference_kind %', NEW.reference_kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_movement_provenance() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. Posting one sold line. Owned by `inv`, because it writes the ledger.
-- ----------------------------------------------------------------------------

-- Takes the invoice LINE and nothing else: the item, the cell and the quantity are
-- read from the line itself, so no caller can sell one part out of another part's
-- shelf. Availability (`on_hand - reserved`) is checked INSIDE the balance-row lock,
-- so two tills selling the last unit resolve to one winner.
CREATE OR REPLACE FUNCTION inv.post_counter_sale_line(p_invoice_line uuid, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id();
        v_item uuid; v_location uuid; v_qty numeric(12, 3); v_co uuid; v_br uuid;
        v_onhand numeric(12, 3); v_reserved numeric(12, 3);
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.post_counter_sale_line requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT l.item_id, l.stock_location_id, l.quantity, l.company_id, l.branch_id
    INTO v_item, v_location, v_qty, v_co, v_br
    FROM sal.invoice_lines l
   WHERE l.tenant_id = v_tenant AND l.id = p_invoice_line AND l.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice line % not found in tenant', p_invoice_line USING ERRCODE = 'foreign_key_violation'; END IF;
  IF v_item IS NULL THEN RAISE EXCEPTION 'invoice line % sells no stock item', p_invoice_line USING ERRCODE = 'check_violation'; END IF;

  PERFORM inv.lock_stock_balance(v_tenant, v_co, v_br, v_item, v_location);
  SELECT on_hand_qty, reserved_qty INTO v_onhand, v_reserved FROM inv.stock_balances
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = v_item AND location_id = v_location;
  IF COALESCE(v_onhand, 0) - COALESCE(v_reserved, 0) < v_qty THEN
    RAISE EXCEPTION 'counter sale: only % available of the % requested', COALESCE(v_onhand, 0) - COALESCE(v_reserved, 0), v_qty USING ERRCODE = 'check_violation';
  END IF;
  RETURN inv.post_stock_movement(v_item, v_location, 'sale', 'out', v_qty, 'invoice_line', p_invoice_line, p_correlation);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.post_counter_sale_line(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.post_counter_sale_line(uuid, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 5. Creating the draft counter sale, priced here and nowhere else.
-- ----------------------------------------------------------------------------

-- One transaction: the header, the restricted header totals, every line, every
-- line's restricted amounts and the birth status-history row.
--
-- The caller sends WHAT was sold — item, cell, quantity — and never how much it
-- costs. Each line resolves `inv.resolve_item_sale_price` and, when that price
-- names a tax class, the rate effective for the company today. A missing price and
-- a tax class with no effective rate are both refusals: an unpriced part must not
-- leave the shop for nothing, and a silently untaxed line cannot be corrected once
-- the customer has gone.
--
-- Every amount is `numeric` arithmetic inside this function, in the same
-- `round(..., 4)` shape `ck_invoice_line_amounts_gross` validates.
CREATE OR REPLACE FUNCTION sal.create_counter_sale_invoice(
  p_company uuid, p_branch uuid, p_customer uuid, p_lines jsonb,
  p_idempotency_key text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
  v_existing uuid; v_invoice uuid; v_currency text; v_as_of date := CURRENT_DATE;
  v_line jsonb; v_number integer := 0; v_priced jsonb := '[]'::jsonb;
  v_item uuid; v_location uuid; v_qty numeric(12, 3);
  v_price record; v_rate numeric(9, 6); v_net numeric(18, 4); v_tax numeric(18, 4);
  v_net_total numeric(18, 4) := 0; v_tax_total numeric(18, 4) := 0;
  v_line_id uuid; v_loc_type text; v_lifecycle text; v_tracked boolean;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'sal.create_counter_sale_invoice requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM sal.invoices WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'a counter sale must sell at least one line' USING ERRCODE = 'check_violation';
  END IF;

  -- Pass one: price every line before anything is written, so an unpriced item
  -- refuses the whole sale rather than leaving a half-built draft behind. The
  -- priced lines are accumulated in a jsonb value rather than a temporary table:
  -- a function that creates a relation in `pg_temp` hands the session a writable
  -- object inside its own execution, which this schema does not do anywhere.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_number := v_number + 1;
    v_item := (v_line ->> 'itemId')::uuid;
    v_location := (v_line ->> 'locationId')::uuid;
    v_qty := (v_line ->> 'quantity')::numeric;
    IF v_item IS NULL OR v_location IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'counter sale line % must name an item, a location and a positive quantity', v_number USING ERRCODE = 'check_violation';
    END IF;

    SELECT lifecycle_status, is_stock_tracked INTO v_lifecycle, v_tracked FROM inv.item_master
      WHERE tenant_id = v_tenant AND id = v_item AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'counter sale line %: item % not found', v_number, v_item USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_lifecycle <> 'active' OR NOT v_tracked THEN
      RAISE EXCEPTION 'counter sale line %: item % is archived or not stock-tracked', v_number, v_item USING ERRCODE = 'check_violation';
    END IF;

    SELECT location_type INTO v_loc_type FROM inv.stock_locations
      WHERE tenant_id = v_tenant AND company_id = p_company AND branch_id = p_branch AND id = v_location
        AND status = 'active' AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'counter sale line %: stock location % is not an active location of this branch', v_number, v_location USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_loc_type IN ('quarantine', 'transit') THEN
      RAISE EXCEPTION 'counter sale line %: % stock is not sellable', v_number, v_loc_type USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_price FROM inv.resolve_item_sale_price(v_item, p_company, p_branch);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'counter sale line %: item % has no selling price for this branch', v_number, v_item USING ERRCODE = 'check_violation';
    END IF;
    IF v_currency IS NULL THEN
      v_currency := v_price.currency_code;
    ELSIF v_currency <> v_price.currency_code THEN
      RAISE EXCEPTION 'counter sale line % is priced in %, but this sale is in %; no conversion is performed', v_number, v_price.currency_code, v_currency USING ERRCODE = 'check_violation';
    END IF;

    IF v_price.tax_class_id IS NULL THEN
      v_rate := 0;
    ELSE
      SELECT tr.rate INTO v_rate FROM org.tax_rates tr JOIN org.tax_classes tc
          ON tc.tenant_id = tr.tenant_id AND tc.id = tr.tax_class_id
        WHERE tr.tenant_id = v_tenant AND tr.company_id = p_company AND tr.tax_class_id = v_price.tax_class_id
          AND tr.status = 'active' AND tr.deleted_at IS NULL
          AND tc.status = 'active' AND tc.deleted_at IS NULL
          AND tr.effective_from <= v_as_of AND (tr.effective_to IS NULL OR tr.effective_to > v_as_of)
        ORDER BY tr.effective_from DESC LIMIT 1;
      IF v_rate IS NULL THEN
        RAISE EXCEPTION 'counter sale line %: tax class % has no effective rate for this company today', v_number, v_price.tax_class_id USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    v_net := round(v_price.unit_price * v_qty, 4);
    v_tax := round(v_net * v_rate, 4);
    v_net_total := v_net_total + v_net;
    v_tax_total := v_tax_total + v_tax;
    v_priced := v_priced || jsonb_build_object(
      'lineNumber', v_number, 'itemId', v_item, 'locationId', v_location,
      'quantity', v_qty, 'unitPrice', v_price.unit_price, 'taxClassId', v_price.tax_class_id,
      'netAmount', v_net, 'taxAmount', v_tax);
  END LOOP;

  -- Pass two: write the document.
  INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, sale_kind,
                            payer_partner_id, currency_code, idempotency_key, created_by)
    VALUES (v_tenant, p_company, p_branch, NULL, 'counter_sale', p_customer, v_currency, p_idempotency_key, v_actor)
    RETURNING id INTO v_invoice;
  INSERT INTO sal.invoice_amounts (tenant_id, company_id, branch_id, invoice_id, net_total, tax_total, gross_total, created_by)
    VALUES (v_tenant, p_company, p_branch, v_invoice, v_net_total, v_tax_total, round(v_net_total + v_tax_total, 4), v_actor);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_priced) LOOP
    INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number, line_type,
                                   quantity, tax_class_id, currency_code, item_id, stock_location_id, created_by)
      VALUES (v_tenant, p_company, p_branch, v_invoice, (v_line ->> 'lineNumber')::integer, 'part',
              (v_line ->> 'quantity')::numeric, (v_line ->> 'taxClassId')::uuid, v_currency,
              (v_line ->> 'itemId')::uuid, (v_line ->> 'locationId')::uuid, v_actor)
      RETURNING id INTO v_line_id;
    INSERT INTO sal.invoice_line_amounts (tenant_id, company_id, branch_id, invoice_line_id, invoice_id,
                                          unit_price, net_amount, tax_amount, gross_amount,
                                          customer_pay_amount, warranty_pay_amount, created_by)
      VALUES (v_tenant, p_company, p_branch, v_line_id, v_invoice,
              (v_line ->> 'unitPrice')::numeric, (v_line ->> 'netAmount')::numeric, (v_line ->> 'taxAmount')::numeric,
              round((v_line ->> 'netAmount')::numeric + (v_line ->> 'taxAmount')::numeric, 4),
              round((v_line ->> 'netAmount')::numeric + (v_line ->> 'taxAmount')::numeric, 4), 0, v_actor);
  END LOOP;

  INSERT INTO sal.invoice_status_history (tenant_id, company_id, branch_id, invoice_id, from_status, to_status, correlation_id, actor_id)
    VALUES (v_tenant, p_company, p_branch, v_invoice, NULL, 'draft', p_correlation, v_actor);
  RETURN v_invoice;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.create_counter_sale_invoice(uuid, uuid, uuid, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.create_counter_sale_invoice(uuid, uuid, uuid, jsonb, text, uuid) TO app_runtime;
