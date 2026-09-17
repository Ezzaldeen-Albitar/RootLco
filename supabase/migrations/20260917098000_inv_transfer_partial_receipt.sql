-- ============================================================================
-- Phase: 1-32 (preparatory) — material demand control, slice 3a
-- Migration: truthful transfer receipts — a short delivery is recorded as short,
--            and the remainder stays in transit until an act settles it
-- Tasks: P1-32-PRE-123
-- Owner module: inv
--
-- Rollback classification: ROLL-FORWARD-ONLY once a transfer has been settled in
--   parts: its settlement movements are ledger facts. No down script.
--
-- Purpose
--   20260917090000 made partial receipt unrepresentable
--   (`ck_stock_transfers_received_quantity`: received = dispatched). That kept the
--   ledger consistent, and it made it untruthful in exactly one situation: when
--   five units were dispatched and three arrived, the only way to take the three
--   was to record five as received — goods that had not arrived entered the
--   destination's on-hand. This migration replaces that constraint with a model in
--   which the receiving branch records what physically arrived, and nothing else.
--
--     * A RECEIPT RECORDS WHAT ARRIVED. `inv.receive_transfer` keeps its signature.
--       A receipt of the whole dispatched quantity of an untouched transfer settles
--       it exactly as before (same movements, same reference). Any other receipt is
--       a SETTLEMENT row of kind `receipt` for the quantity that arrived, and the
--       transfer moves to `partially_received` while anything is still outstanding.
--
--     * THE REMAINDER STAYS IN TRANSIT, VISIBLY. `outstanding_quantity` is GENERATED
--       from the dispatched, received and resolved quantities, so it cannot disagree
--       with them, and the unreceived units are still a real balance in the branch's
--       transit location — out of the origin's availability and not yet in the
--       destination's.
--
--     * A DISCREPANCY IS SETTLED BY AN ACT, WITH A REASON. The remainder leaves
--       transit only through: a further `receipt` when it does arrive; a
--       `return_to_origin` (with a reason) when it goes back; or a `write_off` (with
--       a reason) that is born PENDING and posts only when a person other than the
--       requester approves it — the same maker-checker rule every other stock loss
--       in this schema goes through. When nothing is outstanding the transfer is
--       `received` if everything arrived, and `settled` otherwise.
--
--     * DAMAGE IS NOT A SHORTFALL. Units that physically arrived damaged were
--       received; they are received and then quarantined through the existing damage
--       path, which is a separate act with its own movement pair. A write-off here is
--       for units that did not arrive.
--
--     * THE SETTLEMENT IS THE PROVENANCE. Settlement movements keep the reference
--       kind `transfer_receipt` and cite the SETTLEMENT row; the provenance guard
--       binds each leg to that row's kind, status, quantity and location. A
--       whole-transfer settlement movement is refused once a transfer has any
--       settlement row, so the two shapes can never both deliver the same units.
--
--   GOODS RECEIPTS are unchanged, deliberately: `inv.goods_receipt_lines.quantity`
--   is the quantity the receiver counted on the line, not an ordered quantity the
--   receipt assumes — there is no purchase order behind it — so a line records what
--   arrived by construction and there is no full-quantity assumption to correct.
--
-- Dependencies
--   inv.stock_transfers, inv.receive_transfer, inv.cancel_transfer,
--   inv.guard_stock_transfer_status (20260917090000); the provenance guard as last
--   re-issued by 20260917094000; inv.post_stock_movement, inv.lock_stock_balance
--   (20260723094000); org.branches.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. inv.stock_transfers — received, resolved and outstanding quantities.
-- ----------------------------------------------------------------------------
ALTER TABLE inv.stock_transfers ADD COLUMN resolved_quantity numeric(12, 3) NOT NULL DEFAULT 0;
ALTER TABLE inv.stock_transfers ADD COLUMN outstanding_quantity numeric(12, 3)
  GENERATED ALWAYS AS (CASE WHEN status = 'cancelled' THEN 0
                            ELSE quantity - COALESCE(received_quantity, 0) - resolved_quantity END) STORED;
COMMENT ON COLUMN inv.stock_transfers.received_quantity IS 'What physically arrived at the destination, summed over every receipt. Never more than was dispatched, and never recorded for units that did not arrive.';
COMMENT ON COLUMN inv.stock_transfers.resolved_quantity IS 'Units that did not arrive and were settled by an act: returned to the origin, or written off by a second person.';
COMMENT ON COLUMN inv.stock_transfers.outstanding_quantity IS 'GENERATED: dispatched - received - resolved. The discrepancy still in transit; zero once the transfer is received, settled or cancelled.';

ALTER TABLE inv.stock_transfers DROP CONSTRAINT ck_stock_transfers_status;
ALTER TABLE inv.stock_transfers ADD CONSTRAINT ck_stock_transfers_status
  CHECK (status IN ('dispatched', 'partially_received', 'received', 'settled', 'cancelled'));

ALTER TABLE inv.stock_transfers DROP CONSTRAINT ck_stock_transfers_received;
ALTER TABLE inv.stock_transfers ADD CONSTRAINT ck_stock_transfers_received
  CHECK ((COALESCE(received_quantity, 0) > 0) = (received_at IS NOT NULL));

ALTER TABLE inv.stock_transfers DROP CONSTRAINT ck_stock_transfers_received_quantity;
ALTER TABLE inv.stock_transfers ADD CONSTRAINT ck_stock_transfers_received_quantity
  CHECK (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity <= quantity));
ALTER TABLE inv.stock_transfers ADD CONSTRAINT ck_stock_transfers_resolved_quantity
  CHECK (resolved_quantity >= 0 AND COALESCE(received_quantity, 0) + resolved_quantity <= quantity);

-- The status is a function of the quantities, stated rather than trusted: a
-- `dispatched` transfer has received nothing, a `partially_received` one has
-- received something and still has an outstanding remainder, a `received` one
-- received everything, a `settled` one has nothing outstanding and resolved the
-- shortfall, and a `cancelled` one went back whole.
ALTER TABLE inv.stock_transfers ADD CONSTRAINT ck_stock_transfers_status_quantities CHECK (
  (status = 'dispatched' AND COALESCE(received_quantity, 0) = 0 AND resolved_quantity < quantity)
  OR (status = 'partially_received' AND received_quantity > 0 AND received_quantity + resolved_quantity < quantity)
  OR (status = 'received' AND received_quantity = quantity AND resolved_quantity = 0)
  OR (status = 'settled' AND resolved_quantity > 0 AND COALESCE(received_quantity, 0) + resolved_quantity = quantity)
  OR (status = 'cancelled' AND COALESCE(received_quantity, 0) = 0 AND resolved_quantity = 0));

COMMENT ON TABLE inv.stock_transfers IS 'Inventory transfer between two stock locations of one company, held in a branch-level transit location between dispatch and receipt. Owned by the SOURCE branch; the destination branch reads it through a second SELECT policy. A receipt records only what arrived: a short delivery leaves the transfer partially_received with outstanding_quantity still in transit, settled later by a further receipt, a return to origin or an approved write-off (inv.stock_transfer_settlements).';

CREATE OR REPLACE FUNCTION inv.guard_stock_transfer_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('received', 'settled', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inv.stock_transfers: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'partially_received' AND NEW.status IN ('dispatched', 'cancelled') THEN
    RAISE EXCEPTION 'inv.stock_transfers: a partially received transfer cannot become %', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('partially_received', 'received') AND NEW.received_by IS NULL THEN
    RAISE EXCEPTION 'inv.stock_transfers: a % transfer requires received_by', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_by IS NULL THEN
    RAISE EXCEPTION 'inv.stock_transfers: a cancelled transfer requires cancelled_by' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_transfer_status() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. inv.stock_transfer_settlements
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_transfer_settlements (
  id              uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid    NOT NULL,
  company_id      uuid    NOT NULL,
  branch_id       uuid    NOT NULL,
  transfer_id     uuid    NOT NULL,
  to_branch_id    uuid    NOT NULL,
  settlement_kind text    NOT NULL,
  quantity        numeric(12, 3) NOT NULL,
  reason          text    NULL,
  status          text    NOT NULL DEFAULT 'posted',
  requested_by    uuid    NOT NULL,
  approved_by     uuid    NULL,
  approved_at     timestamptz NULL,
  rejected_by     uuid    NULL,
  rejected_at     timestamptz NULL,
  idempotency_key text    NULL,
  correlation_id  uuid    NULL,
  record_version  integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid    NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid    NULL,

  CONSTRAINT pk_stock_transfer_settlements PRIMARY KEY (id),
  CONSTRAINT uq_stock_transfer_settlements_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_stock_transfer_settlements_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfer_settlements_transfer FOREIGN KEY (tenant_id, company_id, branch_id, transfer_id)
    REFERENCES inv.stock_transfers (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_transfer_settlements_to_branch FOREIGN KEY (tenant_id, company_id, to_branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_transfer_settlements_kind CHECK (settlement_kind IN ('receipt', 'return_to_origin', 'write_off')),
  CONSTRAINT ck_stock_transfer_settlements_quantity CHECK (quantity > 0),
  CONSTRAINT ck_stock_transfer_settlements_reason CHECK (
    (settlement_kind = 'receipt' OR reason IS NOT NULL) AND (reason IS NULL OR btrim(reason) <> '')),
  CONSTRAINT ck_stock_transfer_settlements_status CHECK (status IN ('pending', 'posted', 'rejected')),
  -- Only a write-off waits for a second person; a receipt and a return post at once.
  CONSTRAINT ck_stock_transfer_settlements_pending_kind CHECK (settlement_kind = 'write_off' OR status = 'posted'),
  CONSTRAINT ck_stock_transfer_settlements_write_off_approved CHECK (
    settlement_kind <> 'write_off' OR ((status = 'posted') = (approved_at IS NOT NULL))),
  CONSTRAINT ck_stock_transfer_settlements_approved_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT ck_stock_transfer_settlements_rejected CHECK ((status = 'rejected') = (rejected_at IS NOT NULL)),
  CONSTRAINT ck_stock_transfer_settlements_rejected_pair CHECK ((rejected_by IS NULL) = (rejected_at IS NULL)),
  CONSTRAINT ck_stock_transfer_settlements_separation CHECK (
    (approved_by IS NULL OR approved_by <> requested_by) AND (rejected_by IS NULL OR rejected_by <> requested_by))
);
COMMENT ON TABLE inv.stock_transfer_settlements IS 'One act that takes units out of transit for a transfer settled in parts: a receipt of what arrived, a return to origin (with a reason), or a write-off of what did not arrive (with a reason, pending until a second person approves). Bounded by the dispatched quantity under the transfer row lock (inv.guard_stock_transfer_settlement); its movements cite this row.';

CREATE UNIQUE INDEX uq_stock_transfer_settlements_idempotency ON inv.stock_transfer_settlements (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_stock_transfer_settlements_transfer ON inv.stock_transfer_settlements (tenant_id, company_id, branch_id, transfer_id);
CREATE INDEX ix_stock_transfer_settlements_to_branch ON inv.stock_transfer_settlements (tenant_id, company_id, to_branch_id);
CREATE INDEX ix_stock_transfer_settlements_pending ON inv.stock_transfer_settlements (tenant_id, company_id, branch_id, created_at DESC)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION inv.guard_stock_transfer_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE t inv.stock_transfers%ROWTYPE; v_committed numeric(12, 3); v_birth text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'inv.stock_transfer_settlements: % is terminal', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO t FROM inv.stock_transfers
   WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.transfer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.stock_transfer_settlements: transfer % not found in scope', NEW.transfer_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.to_branch_id <> t.to_branch_id THEN
    RAISE EXCEPTION 'inv.stock_transfer_settlements: the settlement names another destination branch' USING ERRCODE = 'check_violation';
  END IF;
  IF t.status NOT IN ('dispatched', 'partially_received') THEN
    RAISE EXCEPTION 'inv.stock_transfer_settlements: transfer is % and has nothing in transit', t.status USING ERRCODE = 'check_violation';
  END IF;
  v_birth := CASE WHEN NEW.settlement_kind = 'write_off' THEN 'pending' ELSE 'posted' END;
  IF NEW.status <> v_birth THEN
    RAISE EXCEPTION 'inv.stock_transfer_settlements: a % is born %', NEW.settlement_kind, v_birth USING ERRCODE = 'check_violation';
  END IF;
  -- Every live settlement counts, a PENDING write-off included, so a receipt cannot
  -- take units that a write-off awaiting approval has already claimed.
  SELECT COALESCE(sum(quantity), 0) INTO v_committed FROM inv.stock_transfer_settlements
   WHERE tenant_id = NEW.tenant_id AND transfer_id = NEW.transfer_id AND status IN ('pending', 'posted');
  IF v_committed + NEW.quantity > t.quantity THEN
    RAISE EXCEPTION 'transfer_settlement_exceeded: settling % would exceed the % dispatched (% already settled or pending)',
      NEW.quantity, t.quantity, v_committed USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_transfer_settlement() FROM PUBLIC;

CREATE TRIGGER tg_stock_transfer_settlements_guard BEFORE INSERT OR UPDATE ON inv.stock_transfer_settlements
  FOR EACH ROW EXECUTE FUNCTION inv.guard_stock_transfer_settlement();
CREATE TRIGGER tg_stock_transfer_settlements_touch_metadata BEFORE UPDATE ON inv.stock_transfer_settlements
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_transfer_settlements_immutable BEFORE UPDATE ON inv.stock_transfer_settlements
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'transfer_id', 'to_branch_id', 'settlement_kind', 'quantity',
    'reason', 'requested_by', 'idempotency_key', 'created_at', 'created_by');

ALTER TABLE inv.stock_transfer_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_transfer_settlements FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_transfer_settlements_scope ON inv.stock_transfer_settlements FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY sel_stock_transfer_settlements_destination ON inv.stock_transfer_settlements FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR to_branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_transfer_settlements_scope ON inv.stock_transfer_settlements FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_transfer_settlements_scope ON inv.stock_transfer_settlements FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_transfer_settlements TO app_runtime;
GRANT SELECT ON inv.stock_transfer_settlements TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. PROVENANCE — `transfer_receipt` now proves either shape. Every other branch
--    is carried unchanged from 20260917094000: this function is the trust root, so
--    it is replaced whole.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.guard_stock_movement_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_qty numeric(12, 3); v_status text; v_dir text; v_batch_status text;
        t inv.stock_transfers%ROWTYPE; v_receipt_status text; v_location uuid;
        v_sale_kind text; r inv.sales_returns%ROWTYPE; st inv.stock_transfer_settlements%ROWTYPE;
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
    SELECT r2.quantity INTO v_qty FROM inv.part_returns r2 JOIN inv.part_issues i
        ON i.tenant_id = r2.tenant_id AND i.company_id = r2.company_id AND i.branch_id = r2.branch_id AND i.id = r2.part_issue_id
      WHERE r2.tenant_id = NEW.tenant_id AND r2.id = NEW.reference_id AND i.item_id = NEW.item_id AND i.location_id = NEW.location_id;
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
    IF FOUND THEN
      -- The WHOLE-TRANSFER settlement: one pair for the full dispatched quantity, on
      -- a transfer that was never settled in parts.
      IF EXISTS (SELECT 1 FROM inv.stock_transfer_settlements s WHERE s.tenant_id = NEW.tenant_id AND s.transfer_id = t.id) THEN
        RAISE EXCEPTION 'stock movement: transfer % is settled in parts; a whole-transfer settlement is refused', t.id USING ERRCODE = 'check_violation'; END IF;
      IF NOT (t.status = 'cancelled' OR (t.status = 'received' AND t.received_quantity = t.quantity)) THEN
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
    ELSE
      -- A PART settlement: the movement cites the settlement row, and the row decides
      -- the quantity, the status it must be in, and where the in-leg may land.
      SELECT * INTO st FROM inv.stock_transfer_settlements WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: stock transfer or settlement % not found', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
      SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = st.tenant_id AND id = st.transfer_id AND item_id = NEW.item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: settlement % is for another item', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
      IF st.status <> 'posted' THEN
        RAISE EXCEPTION 'stock movement: settlement is % (must be posted)', st.status USING ERRCODE = 'check_violation'; END IF;
      IF NEW.movement_type <> 'transfer' OR NEW.quantity <> st.quantity THEN
        RAISE EXCEPTION 'stock movement: settlement movement must be type transfer with quantity %', st.quantity USING ERRCODE = 'check_violation'; END IF;
      IF NEW.direction = 'out' THEN
        v_location := t.transit_location_id;
      ELSIF st.settlement_kind = 'receipt' THEN
        v_location := t.to_location_id;
      ELSIF st.settlement_kind = 'return_to_origin' THEN
        v_location := t.from_location_id;
      ELSE
        RAISE EXCEPTION 'stock movement: a write-off leaves transit and lands nowhere' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.location_id <> v_location THEN
        RAISE EXCEPTION 'stock movement: settlement % leg must name location %', NEW.direction, v_location USING ERRCODE = 'check_violation'; END IF;
    END IF;

  ELSIF NEW.reference_kind = 'goods_receipt_line' THEN
    SELECT l.quantity, r2.status INTO v_qty, v_receipt_status
      FROM inv.goods_receipt_lines l JOIN inv.goods_receipts r2
        ON r2.tenant_id = l.tenant_id AND r2.company_id = l.company_id AND r2.branch_id = l.branch_id AND r2.id = l.receipt_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.reference_id AND l.item_id = NEW.item_id AND l.location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: goods receipt line % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_receipt_status <> 'posted' THEN RAISE EXCEPTION 'stock movement: goods receipt is % (must be posted)', v_receipt_status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'receipt' OR NEW.direction <> 'in' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: goods receipt movement must be in/receipt with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'invoice_line' THEN
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

  ELSIF NEW.reference_kind = 'sales_return' THEN
    SELECT * INTO r FROM inv.sales_returns WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: sales return % not found for this item', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    v_location := CASE WHEN r.return_condition = 'damaged' THEN r.quarantine_location_id ELSE r.received_location_id END;
    IF NEW.movement_type <> 'return' OR NEW.direction <> 'in' OR NEW.quantity <> r.quantity THEN
      RAISE EXCEPTION 'stock movement: sales return movement must be in/return with quantity %', r.quantity USING ERRCODE = 'check_violation'; END IF;
    IF NEW.location_id <> v_location THEN
      RAISE EXCEPTION 'stock movement: a % sales return must land in location %', r.return_condition, v_location USING ERRCODE = 'check_violation'; END IF;

  ELSE
    RAISE EXCEPTION 'stock movement: unknown reference_kind %', NEW.reference_kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_movement_provenance() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. Operations.
-- ----------------------------------------------------------------------------

-- The transfer status its quantities imply.
CREATE OR REPLACE FUNCTION inv.transfer_status_for(p_quantity numeric, p_received numeric, p_resolved numeric)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN COALESCE(p_received, 0) + p_resolved < p_quantity THEN
      CASE WHEN COALESCE(p_received, 0) > 0 THEN 'partially_received' ELSE 'dispatched' END
    WHEN COALESCE(p_received, 0) = p_quantity THEN 'received'
    ELSE 'settled'
  END
$$;
REVOKE EXECUTE ON FUNCTION inv.transfer_status_for(numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.transfer_status_for(numeric, numeric, numeric) TO app_runtime, app_readonly;

-- Post one settlement row's movements and fold it into the transfer. The caller
-- holds the transfer row lock and has inserted the row as `posted`.
CREATE OR REPLACE FUNCTION inv.apply_transfer_settlement(p_settlement uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); st inv.stock_transfer_settlements%ROWTYPE; t inv.stock_transfers%ROWTYPE;
        v_received numeric(12, 3); v_resolved numeric(12, 3);
BEGIN
  SELECT * INTO st FROM inv.stock_transfer_settlements WHERE tenant_id = v_tenant AND id = p_settlement;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement % not found', p_settlement USING ERRCODE = 'foreign_key_violation'; END IF;
  IF st.status <> 'posted' THEN RAISE EXCEPTION 'settlement is % (must be posted)', st.status USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = st.transfer_id FOR UPDATE;

  PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.branch_id, t.item_id, t.transit_location_id);
  IF st.settlement_kind = 'receipt' THEN
    PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.to_branch_id, t.item_id, t.to_location_id);
  ELSIF st.settlement_kind = 'return_to_origin' THEN
    PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.branch_id, t.item_id, t.from_location_id);
  END IF;

  v_received := COALESCE(t.received_quantity, 0) + CASE WHEN st.settlement_kind = 'receipt' THEN st.quantity ELSE 0 END;
  v_resolved := t.resolved_quantity + CASE WHEN st.settlement_kind = 'receipt' THEN 0 ELSE st.quantity END;
  UPDATE inv.stock_transfers
     SET received_quantity = CASE WHEN v_received > 0 THEN v_received ELSE received_quantity END,
         resolved_quantity = v_resolved,
         received_at = CASE WHEN st.settlement_kind = 'receipt' THEN now() ELSE received_at END,
         received_by = CASE WHEN st.settlement_kind = 'receipt' THEN st.requested_by ELSE received_by END,
         status = inv.transfer_status_for(t.quantity, v_received, v_resolved)
   WHERE tenant_id = v_tenant AND id = t.id;

  PERFORM inv.post_stock_movement(t.item_id, t.transit_location_id, 'transfer', 'out', st.quantity, 'transfer_receipt', st.id, st.correlation_id);
  IF st.settlement_kind = 'receipt' THEN
    PERFORM inv.post_stock_movement(t.item_id, t.to_location_id, 'transfer', 'in', st.quantity, 'transfer_receipt', st.id, st.correlation_id);
  ELSIF st.settlement_kind = 'return_to_origin' THEN
    PERFORM inv.post_stock_movement(t.item_id, t.from_location_id, 'transfer', 'in', st.quantity, 'transfer_receipt', st.id, st.correlation_id);
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.apply_transfer_settlement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.apply_transfer_settlement(uuid) TO app_runtime;

-- Receipt: what arrived. The whole dispatched quantity of an untouched transfer
-- settles it exactly as 20260917090000 did; anything else is a part settlement.
CREATE OR REPLACE FUNCTION inv.receive_transfer(p_transfer uuid, p_qty numeric, p_correlation uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); t inv.stock_transfers%ROWTYPE; v_settlement uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.receive_transfer requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock transfer % not found', p_transfer USING ERRCODE = 'foreign_key_violation'; END IF;
  IF t.status NOT IN ('dispatched', 'partially_received') THEN
    RAISE EXCEPTION 'stock transfer is % (must be dispatched or partially received)', t.status USING ERRCODE = 'check_violation';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'a receipt records a positive quantity that arrived' USING ERRCODE = 'check_violation';
  END IF;
  IF p_qty > t.outstanding_quantity THEN
    RAISE EXCEPTION 'transfer_quantity_exceeded: % received exceeds the % still in transit', p_qty, t.outstanding_quantity USING ERRCODE = 'check_violation';
  END IF;

  IF t.status = 'dispatched' AND p_qty = t.quantity
     AND NOT EXISTS (SELECT 1 FROM inv.stock_transfer_settlements s WHERE s.tenant_id = v_tenant AND s.transfer_id = t.id) THEN
    PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.branch_id, t.item_id, t.transit_location_id);
    PERFORM inv.lock_stock_balance(v_tenant, t.company_id, t.to_branch_id, t.item_id, t.to_location_id);
    UPDATE inv.stock_transfers
       SET status = 'received', received_at = now(), received_by = iam.current_user_id(), received_quantity = p_qty
     WHERE tenant_id = v_tenant AND id = p_transfer;
    PERFORM inv.post_stock_movement(t.item_id, t.transit_location_id, 'transfer', 'out', t.quantity, 'transfer_receipt', t.id, p_correlation);
    PERFORM inv.post_stock_movement(t.item_id, t.to_location_id, 'transfer', 'in', t.quantity, 'transfer_receipt', t.id, p_correlation);
    RETURN;
  END IF;

  INSERT INTO inv.stock_transfer_settlements (
    tenant_id, company_id, branch_id, transfer_id, to_branch_id, settlement_kind, quantity, status,
    requested_by, correlation_id, created_by)
    VALUES (v_tenant, t.company_id, t.branch_id, t.id, t.to_branch_id, 'receipt', p_qty, 'posted',
            iam.current_user_id(), p_correlation, iam.current_user_id())
    RETURNING id INTO v_settlement;
  PERFORM inv.apply_transfer_settlement(v_settlement);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.receive_transfer(uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.receive_transfer(uuid, numeric, uuid) TO app_runtime;

-- Return what did not arrive to the origin, with a reason.
CREATE OR REPLACE FUNCTION inv.return_transfer_remainder(
  p_transfer uuid, p_qty numeric, p_reason text, p_idempotency_key text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); t inv.stock_transfers%ROWTYPE; v_existing uuid; v_settlement uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.return_transfer_remainder requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a return to origin requires a reason' USING ERRCODE = 'check_violation'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'a return to origin moves a positive quantity' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock transfer % not found', p_transfer USING ERRCODE = 'foreign_key_violation'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM inv.stock_transfer_settlements WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  INSERT INTO inv.stock_transfer_settlements (
    tenant_id, company_id, branch_id, transfer_id, to_branch_id, settlement_kind, quantity, reason, status,
    requested_by, idempotency_key, correlation_id, created_by)
    VALUES (v_tenant, t.company_id, t.branch_id, t.id, t.to_branch_id, 'return_to_origin', p_qty, btrim(p_reason), 'posted',
            iam.current_user_id(), p_idempotency_key, p_correlation, iam.current_user_id())
    RETURNING id INTO v_settlement;
  PERFORM inv.apply_transfer_settlement(v_settlement);
  RETURN v_settlement;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.return_transfer_remainder(uuid, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.return_transfer_remainder(uuid, numeric, text, text, uuid) TO app_runtime;

-- Request a write-off of what did not arrive. PENDING: nothing moves yet, but the
-- quantity is claimed, so it cannot also be received or returned.
CREATE OR REPLACE FUNCTION inv.request_transfer_write_off(
  p_transfer uuid, p_qty numeric, p_reason text, p_idempotency_key text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); t inv.stock_transfers%ROWTYPE; v_existing uuid; v_settlement uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.request_transfer_write_off requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a write-off requires a reason' USING ERRCODE = 'check_violation'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'a write-off states a positive quantity' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock transfer % not found', p_transfer USING ERRCODE = 'foreign_key_violation'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM inv.stock_transfer_settlements WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  INSERT INTO inv.stock_transfer_settlements (
    tenant_id, company_id, branch_id, transfer_id, to_branch_id, settlement_kind, quantity, reason, status,
    requested_by, idempotency_key, correlation_id, created_by)
    VALUES (v_tenant, t.company_id, t.branch_id, t.id, t.to_branch_id, 'write_off', p_qty, btrim(p_reason), 'pending',
            iam.current_user_id(), p_idempotency_key, p_correlation, iam.current_user_id())
    RETURNING id INTO v_settlement;
  RETURN v_settlement;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.request_transfer_write_off(uuid, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.request_transfer_write_off(uuid, numeric, text, text, uuid) TO app_runtime;

-- A second person decides the write-off. Approval takes the units out of transit.
CREATE OR REPLACE FUNCTION inv.decide_transfer_write_off(p_settlement uuid, p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id(); v_transfer uuid;
        st inv.stock_transfer_settlements%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.decide_transfer_write_off requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'a decision is approve or reject' USING ERRCODE = 'check_violation'; END IF;
  SELECT transfer_id INTO v_transfer FROM inv.stock_transfer_settlements WHERE tenant_id = v_tenant AND id = p_settlement;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement % not found', p_settlement USING ERRCODE = 'foreign_key_violation'; END IF;
  -- Transfer first, then the settlement: the order every settlement writer uses.
  PERFORM 1 FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = v_transfer FOR UPDATE;
  SELECT * INTO st FROM inv.stock_transfer_settlements WHERE tenant_id = v_tenant AND id = p_settlement FOR UPDATE;
  IF st.settlement_kind <> 'write_off' OR st.status <> 'pending' THEN
    RAISE EXCEPTION 'settlement is a % in status % (only a pending write-off is decided)', st.settlement_kind, st.status USING ERRCODE = 'check_violation';
  END IF;
  IF st.requested_by = v_actor THEN
    RAISE EXCEPTION 'the requester may not decide their own write-off (maker<>checker)' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT p_approve THEN
    UPDATE inv.stock_transfer_settlements SET status = 'rejected', rejected_by = v_actor, rejected_at = now()
     WHERE tenant_id = v_tenant AND id = p_settlement;
    RETURN;
  END IF;
  UPDATE inv.stock_transfer_settlements SET status = 'posted', approved_by = v_actor, approved_at = now()
   WHERE tenant_id = v_tenant AND id = p_settlement;
  PERFORM inv.apply_transfer_settlement(p_settlement);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.decide_transfer_write_off(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.decide_transfer_write_off(uuid, boolean) TO app_runtime;

-- Cancellation stays a WHOLE-transfer act: a transfer that has begun to be settled
-- in parts returns its remainder through inv.return_transfer_remainder instead.
CREATE OR REPLACE FUNCTION inv.cancel_transfer(p_transfer uuid, p_reason text, p_correlation uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); t inv.stock_transfers%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.cancel_transfer requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a cancellation requires a reason' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO t FROM inv.stock_transfers WHERE tenant_id = v_tenant AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock transfer % not found', p_transfer USING ERRCODE = 'foreign_key_violation'; END IF;
  IF t.status <> 'dispatched' THEN RAISE EXCEPTION 'stock transfer is % (must be dispatched)', t.status USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM inv.stock_transfer_settlements s WHERE s.tenant_id = v_tenant AND s.transfer_id = t.id AND s.status IN ('pending', 'posted')) THEN
    RAISE EXCEPTION 'stock transfer is being settled in parts; return the remainder to origin instead of cancelling' USING ERRCODE = 'check_violation';
  END IF;
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
