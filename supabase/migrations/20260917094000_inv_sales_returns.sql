-- ============================================================================
-- Phase: 1-32 (preparatory) — a return, with a condition and a credit
-- Migration: inv.sales_returns, its ceiling, the `sales_return` movement, and
--            sal.request_return_credit_note
-- Tasks: P1-32-PRE-112 … P1-32-PRE-116
-- Owner module: inv, with the sal primitive that raises the credit note
--
-- Rollback classification: ROLL-FORWARD-ONLY. A received return has already moved
--   stock and may already have raised a credit note a second person approved. No
--   down script.
--
-- Purpose
--   `inv.part_returns` records one thing: a part that left the store for a job
--   coming back to the shelf. It has no condition — a part returned broken went
--   back into sellable stock — no link to what the customer was charged, and no
--   answer to "how many of these may still be returned". A part sold over the
--   counter had no return path at all.
--
--     * THE SOURCE IS NAMED, AND BOUNDED. A return cites either the part issue it
--       came from or the invoice line it was sold on, and
--       `inv.guard_sales_return_ceiling` locks that source and refuses a return
--       that would take the running total past the quantity that actually left. For
--       a part issue the running total counts `inv.part_returns` TOO, so the old
--       path and the new one cannot each spend the same ceiling.
--
--     * THE CONDITION DECIDES THE SHELF, NOT A FLAG. A `restockable` return posts
--       into the receiving location; a `damaged` one posts into a quarantine
--       location, which is not sellable because of where it IS
--       (`requireSellableLocation`, `ck_stock_locations_type`), not because a column
--       says so. There is no third path: an inspection that later scraps the unit is
--       an approved adjustment, as it already was.
--
--     * NO FORGED DAMAGE ROW. A `damaged` return does NOT write `inv.damaged_stock`.
--       That table records stock LOST FROM the tenant's own sellable cells and its
--       provenance guard binds a paired out/in movement to it; a unit arriving from
--       a customer was never in a sellable cell, so the `out` leg would name a cell
--       that never held it. The quarantine balance is the record.
--
--     * THE MONEY FOLLOWS THE DOCUMENT, NOT THE STOCK. A return against an invoice
--       line raises a PENDING credit note for the returned share of that line's
--       gross, which the existing `sal.credit-note-approve` still requires a second
--       person to approve. A return against a part issue raises none: nothing was
--       invoiced to the customer for it yet — the work order's invoice prices the
--       job, and the part going back on the shelf changes what that invoice will
--       say, not what a past document said.
--
-- Dependencies
--   inv.part_issues, inv.part_returns (20260723095000); inv.stock_locations,
--   inv.item_master (20260723093000); inv.post_stock_movement (20260723094000);
--   sal.invoice_lines, sal.invoice_line_amounts, sal.invoices (20260724091000),
--   widened by 20260917093000; sal.credit_notes (20260724092000).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. inv.sales_returns
-- ----------------------------------------------------------------------------
CREATE TABLE inv.sales_returns (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  company_id             uuid NOT NULL,
  branch_id              uuid NOT NULL,
  source_kind            text NOT NULL,
  source_id              uuid NOT NULL,
  item_id                uuid NOT NULL,
  quantity               numeric(12, 3) NOT NULL,
  return_condition       text NOT NULL,
  received_location_id   uuid NOT NULL,
  quarantine_location_id uuid NULL,
  reason                 text NULL,
  credit_note_id         uuid NULL,
  status                 text NOT NULL DEFAULT 'received',
  idempotency_key        text NULL,
  record_version         integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid NULL,

  CONSTRAINT pk_sales_returns PRIMARY KEY (id),
  CONSTRAINT uq_sales_returns_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_sales_returns_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_returns_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_returns_item FOREIGN KEY (tenant_id, item_id)
    REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_returns_received_location FOREIGN KEY (tenant_id, company_id, branch_id, received_location_id)
    REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_returns_quarantine_location FOREIGN KEY (tenant_id, company_id, branch_id, quarantine_location_id)
    REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sales_returns_credit_note FOREIGN KEY (tenant_id, company_id, branch_id, credit_note_id)
    REFERENCES sal.credit_notes (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_sales_returns_source_kind CHECK (source_kind IN ('part_issue', 'invoice_line')),
  CONSTRAINT ck_sales_returns_quantity CHECK (quantity > 0),
  CONSTRAINT ck_sales_returns_condition CHECK (return_condition IN ('restockable', 'damaged')),
  -- A damaged return must name where it is quarantined, and a restockable one must
  -- not: the movement's destination is decided by this pair and nothing else.
  CONSTRAINT ck_sales_returns_quarantine CHECK ((return_condition = 'damaged') = (quarantine_location_id IS NOT NULL)),
  CONSTRAINT ck_sales_returns_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT ck_sales_returns_status CHECK (status IN ('received', 'credited')),
  CONSTRAINT ck_sales_returns_credit_link CHECK ((status = 'credited') = (credit_note_id IS NOT NULL))
);
COMMENT ON TABLE inv.sales_returns IS 'A part coming back: from the work order it was issued to (source_kind part_issue) or from the counter sale it was sold on (invoice_line). The condition decides which cell it lands in — the receiving location when restockable, a quarantine location when damaged — and an invoice-line source additionally raises a pending credit note for the returned share of that line. Bounded by inv.guard_sales_return_ceiling, which counts inv.part_returns as well for a part-issue source.';
COMMENT ON COLUMN inv.sales_returns.return_condition IS 'restockable: the unit goes back into sellable stock. damaged: it goes into quarantine and leaves availability by location, not by flag.';
COMMENT ON COLUMN inv.sales_returns.credit_note_id IS 'The pending credit note this return raised (invoice-line sources only). A second person still approves it through sal.credit-note-approve.';

CREATE UNIQUE INDEX uq_sales_returns_idempotency ON inv.sales_returns (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_sales_returns_source ON inv.sales_returns (tenant_id, source_kind, source_id);
CREATE INDEX ix_sales_returns_branch ON inv.sales_returns (tenant_id, company_id, branch_id, created_at DESC);
CREATE INDEX ix_sales_returns_item ON inv.sales_returns (tenant_id, item_id);
CREATE INDEX ix_sales_returns_received_location ON inv.sales_returns (tenant_id, company_id, branch_id, received_location_id);
CREATE INDEX ix_sales_returns_quarantine_location ON inv.sales_returns (tenant_id, company_id, branch_id, quarantine_location_id);
CREATE INDEX ix_sales_returns_credit_note ON inv.sales_returns (tenant_id, company_id, branch_id, credit_note_id);

-- How much of a source may still come back, counting BOTH return tables.
--
-- `inv.part_returns` is still written by `inv.return_part` (`POST /stock-returns`),
-- so a part issue has two ways back and one ceiling. Reading only the new table
-- would let the same issued quantity be returned twice, once through each path —
-- which is the phantom stock this function exists to prevent.
-- The tenant is an ARGUMENT, never `iam.current_tenant_id()`. A trigger has to bound
-- the row it is handed even in a session that carries no tenant GUC, and a sum keyed
-- on the GUC would return 0 in such a session — a ceiling of zero already returned,
-- which is no ceiling at all. Every caller has the tenant in hand, so asking for it
-- costs nothing and removes the failure mode.
CREATE OR REPLACE FUNCTION inv.returned_quantity(p_tenant uuid, p_source_kind text, p_source_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE((SELECT sum(r.quantity) FROM inv.sales_returns r
                    WHERE r.tenant_id = p_tenant
                      AND r.source_kind = p_source_kind AND r.source_id = p_source_id), 0)
       + CASE WHEN p_source_kind = 'part_issue'
              THEN COALESCE((SELECT sum(pr.quantity) FROM inv.part_returns pr
                              WHERE pr.tenant_id = p_tenant
                                AND pr.part_issue_id = p_source_id), 0)
              ELSE 0 END
$$;
COMMENT ON FUNCTION inv.returned_quantity(uuid, text, uuid) IS 'Everything already returned against a source, for the tenant NAMED IN THE ARGUMENT: inv.sales_returns plus, for a part-issue source, the legacy inv.part_returns rows. One ceiling over two tables.';
REVOKE EXECUTE ON FUNCTION inv.returned_quantity(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.returned_quantity(uuid, text, uuid) TO app_runtime, app_readonly;

-- The OLD path's ceiling, re-issued to count the new table too.
--
-- Measured, not assumed: with `inv.guard_part_return_ceiling` counting only
-- `inv.part_returns`, an issue of five returned two through `POST /stock-returns`
-- and three through this slice's path accepted a SIXTH unit through the old path —
-- five units issued, six returned, one minted. Widening one side's ceiling without
-- widening the other is exactly how that happens, so both are stated here, in the
-- migration that creates the second table.
--
-- The sums are keyed on NEW.tenant_id rather than on `inv.returned_quantity`,
-- which reads `iam.current_tenant_id()`: a trigger must bound the row it is given
-- even in a session that carries no tenant GUC, and a guard that silently summed
-- nothing would be worse than no guard at all.
CREATE OR REPLACE FUNCTION inv.guard_part_return_ceiling()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_issued numeric(12, 3); v_returned numeric(12, 3);
BEGIN
  SELECT quantity INTO v_issued FROM inv.part_issues
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.part_issue_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.part_returns: part issue % not found in scope', NEW.part_issue_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT COALESCE((SELECT SUM(quantity) FROM inv.part_returns
                    WHERE tenant_id = NEW.tenant_id AND part_issue_id = NEW.part_issue_id), 0)
       + COALESCE((SELECT SUM(quantity) FROM inv.sales_returns
                    WHERE tenant_id = NEW.tenant_id AND source_kind = 'part_issue'
                      AND source_id = NEW.part_issue_id), 0)
    INTO v_returned;
  IF v_returned + NEW.quantity > v_issued THEN
    RAISE EXCEPTION 'inv.part_returns: total returns %.% exceed the issued quantity %',
      v_returned, NEW.quantity, v_issued USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_part_return_ceiling() FROM PUBLIC;

-- `inv.return_part` states the same ceiling before the INSERT so the message names
-- the figures. The trigger above is what binds; this is what explains.
CREATE OR REPLACE FUNCTION inv.return_part(p_part_issue uuid, p_qty numeric, p_reason text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); i inv.part_issues%ROWTYPE; v_returned numeric(12, 3); v_return uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  -- lock the issue to serialize the return-ceiling check
  SELECT * INTO i FROM inv.part_issues WHERE tenant_id = v_tenant AND id = p_part_issue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'part issue % not found', p_part_issue USING ERRCODE = 'foreign_key_violation'; END IF;
  v_returned := inv.returned_quantity(v_tenant, 'part_issue', p_part_issue);
  IF v_returned + p_qty > i.quantity THEN
    RAISE EXCEPTION 'return exceeds issued quantity (issued %, already returned %, requested %)', i.quantity, v_returned, p_qty USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO inv.part_returns (tenant_id, company_id, branch_id, part_issue_id, quantity, reason, created_by)
    VALUES (v_tenant, i.company_id, i.branch_id, p_part_issue, p_qty, p_reason, iam.current_user_id())
    RETURNING id INTO v_return;
  PERFORM inv.post_stock_movement(i.item_id, i.location_id, 'return', 'in', p_qty, 'part_return', v_return, p_correlation);
  RETURN v_return;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.return_part(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.return_part(uuid, numeric, text, uuid) TO app_runtime;

-- What the counter needs before it accepts anything: how much left, how much has
-- already come back, and therefore how much may still be returned. A read, with no
-- lock — the number it reports is advisory, and the ceiling that binds is the one
-- the INSERT re-checks under the source lock. Returns NO ROW for a source that does
-- not exist or is not returnable, which the caller reports as not found.
CREATE OR REPLACE FUNCTION inv.returnable_quantity(p_source_kind text, p_source_id uuid)
RETURNS TABLE (source_quantity numeric, returned_quantity numeric, remaining_quantity numeric,
               item_id uuid, company_id uuid, branch_id uuid)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id();
        v_qty numeric(12, 3); v_item uuid; v_co uuid; v_br uuid; v_returned numeric(12, 3);
BEGIN
  IF p_source_kind = 'part_issue' THEN
    SELECT i.quantity, i.item_id, i.company_id, i.branch_id INTO v_qty, v_item, v_co, v_br
      FROM inv.part_issues i WHERE i.tenant_id = v_tenant AND i.id = p_source_id;
  ELSIF p_source_kind = 'invoice_line' THEN
    SELECT l.quantity, l.item_id, l.company_id, l.branch_id INTO v_qty, v_item, v_co, v_br
      FROM sal.invoice_lines l JOIN sal.invoices s
        ON s.tenant_id = l.tenant_id AND s.company_id = l.company_id AND s.branch_id = l.branch_id AND s.id = l.invoice_id
      WHERE l.tenant_id = v_tenant AND l.id = p_source_id AND l.deleted_at IS NULL
        AND l.item_id IS NOT NULL AND s.status = 'issued';
  ELSE
    RAISE EXCEPTION 'return source: unknown source kind %', p_source_kind USING ERRCODE = 'check_violation';
  END IF;
  IF v_qty IS NULL THEN RETURN; END IF;
  v_returned := inv.returned_quantity(v_tenant, p_source_kind, p_source_id);
  RETURN QUERY SELECT v_qty, v_returned, v_qty - v_returned, v_item, v_co, v_br;
END; $$;
COMMENT ON FUNCTION inv.returnable_quantity(text, uuid) IS 'How much of a source left, how much has come back, and how much may still be returned. Advisory: the binding ceiling is re-checked under the source lock by inv.guard_sales_return_ceiling.';
REVOKE EXECUTE ON FUNCTION inv.returnable_quantity(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.returnable_quantity(text, uuid) TO app_runtime, app_readonly;

-- The quantity the source put into the customer's hands, read under a ROW LOCK so
-- two concurrent returns of the last unit cannot both pass the ceiling.
--
-- The tenant is an ARGUMENT here for the same reason as in `inv.returned_quantity`:
-- the trigger calls this with `NEW.tenant_id`, so the source it locks and the sum it
-- is compared against are both the new row's tenant, in a session with a tenant GUC
-- or without one.
CREATE OR REPLACE FUNCTION inv.lock_return_source(p_tenant uuid, p_source_kind text, p_source_id uuid)
RETURNS TABLE (source_quantity numeric, item_id uuid, company_id uuid, branch_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := p_tenant;
        v_qty numeric(12, 3); v_item uuid; v_co uuid; v_br uuid; v_status text;
BEGIN
  IF p_source_kind = 'part_issue' THEN
    SELECT i.quantity, i.item_id, i.company_id, i.branch_id INTO v_qty, v_item, v_co, v_br
      FROM inv.part_issues i WHERE i.tenant_id = v_tenant AND i.id = p_source_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'return source: part issue % not found', p_source_id USING ERRCODE = 'foreign_key_violation'; END IF;
  ELSIF p_source_kind = 'invoice_line' THEN
    SELECT l.quantity, l.item_id, l.company_id, l.branch_id, i.status INTO v_qty, v_item, v_co, v_br, v_status
      FROM sal.invoice_lines l JOIN sal.invoices i
        ON i.tenant_id = l.tenant_id AND i.company_id = l.company_id AND i.branch_id = l.branch_id AND i.id = l.invoice_id
      WHERE l.tenant_id = v_tenant AND l.id = p_source_id AND l.deleted_at IS NULL FOR UPDATE OF l;
    IF NOT FOUND THEN RAISE EXCEPTION 'return source: invoice line % not found', p_source_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_item IS NULL THEN RAISE EXCEPTION 'return source: invoice line % sold no stock item', p_source_id USING ERRCODE = 'check_violation'; END IF;
    IF v_status <> 'issued' THEN RAISE EXCEPTION 'return source: the invoice is % (only an issued sale can be returned)', v_status USING ERRCODE = 'check_violation'; END IF;
  ELSE
    RAISE EXCEPTION 'return source: unknown source kind %', p_source_kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY SELECT v_qty, v_item, v_co, v_br;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.lock_return_source(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.lock_return_source(uuid, text, uuid) TO app_runtime;

-- The ceiling at the CONSTRAINT layer, like inv.guard_part_return_ceiling: a raw
-- INSERT that bypassed inv.receive_sales_return would otherwise mint stock, because
-- the movement provenance guard binds the movement to this row's own quantity.
--
-- Keyed on NEW.tenant_id, exactly as inv.guard_part_return_ceiling is, and for the
-- reason stated there: a trigger must bound the row it is given even in a session
-- that carries no tenant GUC. Both helpers below take the tenant as an argument, so
-- neither the source lock nor the returned sum can quietly degrade to nothing.
CREATE OR REPLACE FUNCTION inv.guard_sales_return_ceiling()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE s record; v_returned numeric(12, 3);
BEGIN
  SELECT * INTO s FROM inv.lock_return_source(NEW.tenant_id, NEW.source_kind, NEW.source_id);
  IF NEW.item_id <> s.item_id THEN
    RAISE EXCEPTION 'inv.sales_returns: the return names item % but the source sold %', NEW.item_id, s.item_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.company_id <> s.company_id OR NEW.branch_id <> s.branch_id THEN
    RAISE EXCEPTION 'inv.sales_returns: a return is received in the branch that sold or issued the part' USING ERRCODE = 'check_violation';
  END IF;
  v_returned := inv.returned_quantity(NEW.tenant_id, NEW.source_kind, NEW.source_id);
  IF v_returned + NEW.quantity > s.source_quantity THEN
    RAISE EXCEPTION 'inv.sales_returns: returning % would exceed the % that left (% already returned)',
      NEW.quantity, s.source_quantity, v_returned USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_sales_return_ceiling() FROM PUBLIC;
CREATE TRIGGER tg_sales_returns_ceiling BEFORE INSERT ON inv.sales_returns
  FOR EACH ROW EXECUTE FUNCTION inv.guard_sales_return_ceiling();
CREATE TRIGGER tg_sales_returns_touch_metadata BEFORE UPDATE ON inv.sales_returns
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_sales_returns_immutable BEFORE UPDATE ON inv.sales_returns
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'source_kind', 'source_id', 'item_id',
    'quantity', 'return_condition', 'received_location_id', 'quarantine_location_id',
    'created_at', 'created_by');

ALTER TABLE inv.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.sales_returns FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_sales_returns_scope ON inv.sales_returns FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_sales_returns_scope ON inv.sales_returns FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_sales_returns_scope ON inv.sales_returns FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.sales_returns TO app_runtime;
GRANT SELECT ON inv.sales_returns TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. The ledger vocabulary: a `return` movement citing a sales return.
-- ----------------------------------------------------------------------------
ALTER TABLE inv.stock_movements DROP CONSTRAINT ck_stock_movements_reference_kind;
ALTER TABLE inv.stock_movements ADD CONSTRAINT ck_stock_movements_reference_kind
  CHECK (reference_kind IN (
    'opening_line', 'part_issue', 'part_return', 'damage', 'adjustment',
    'transfer_dispatch', 'transfer_receipt', 'goods_receipt_line', 'invoice_line',
    'sales_return'));

-- The provenance guard, re-issued with the `sales_return` branch. Every earlier
-- branch is carried unchanged, as in 20260917093000: this function is the trust
-- root, so it is replaced whole.
CREATE OR REPLACE FUNCTION inv.guard_stock_movement_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_qty numeric(12, 3); v_status text; v_dir text; v_batch_status text;
        t inv.stock_transfers%ROWTYPE; v_receipt_status text; v_location uuid;
        v_sale_kind text; r inv.sales_returns%ROWTYPE;
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
    -- The condition decides the destination, so the guard reads it from the row
    -- rather than trusting the posting: a damaged return may only land in the
    -- quarantine location it named, and a restockable one only in the receiving
    -- location it named.
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
-- 3. The credit note a returned sale raises. Owned by `sal`, because it writes
--    `sal.credit_notes` and nothing outside `sal` may.
-- ----------------------------------------------------------------------------

-- Pro-rata on the line's GROSS, in one `round(..., 4)`: the returned share of what
-- the customer was actually charged, tax included. Dividing the line into a unit
-- price and multiplying back would round twice and leave a full return a fraction
-- short of the line it reverses.
--
-- The note is born PENDING. Approval is the existing second-person act
-- (`sal.approve_credit_note`), which re-checks the amount against the invoice's open
-- receivable under the invoice lock — so a return credited after a partial credit
-- cannot over-credit the document.
CREATE OR REPLACE FUNCTION sal.request_return_credit_note(
  p_invoice_line uuid, p_quantity numeric, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_co uuid; v_br uuid; v_invoice uuid; v_currency text; v_credit uuid;
        v_line_qty numeric(12, 3); v_gross numeric(18, 4); v_amount numeric(18, 4);
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'sal.request_return_credit_note requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT l.company_id, l.branch_id, l.invoice_id, l.currency_code, l.quantity, la.gross_amount
    INTO v_co, v_br, v_invoice, v_currency, v_line_qty, v_gross
    FROM sal.invoice_lines l JOIN sal.invoice_line_amounts la
      ON la.tenant_id = l.tenant_id AND la.company_id = l.company_id AND la.branch_id = l.branch_id
     AND la.invoice_line_id = l.id AND la.deleted_at IS NULL
   WHERE l.tenant_id = v_tenant AND l.id = p_invoice_line AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    -- Either the line does not exist, or its amounts are invisible to this caller:
    -- `sel_invoice_line_amounts_gated` needs `sal.finance.view`. Both are refusals,
    -- and neither may guess an amount.
    RAISE EXCEPTION 'credit note: invoice line % has no readable amount', p_invoice_line USING ERRCODE = 'no_data_found';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > v_line_qty THEN
    RAISE EXCEPTION 'credit note: % is not a creditable share of the % on the line', p_quantity, v_line_qty USING ERRCODE = 'check_violation';
  END IF;
  v_amount := round(v_gross * (p_quantity / v_line_qty), 4);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'credit note: the returned share of this line is zero; nothing to credit' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO sal.credit_notes (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason, requested_by, created_by)
    VALUES (v_tenant, v_co, v_br, v_invoice, v_currency, v_amount, p_reason, v_actor, v_actor)
    RETURNING id INTO v_credit;
  RETURN v_credit;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.request_return_credit_note(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.request_return_credit_note(uuid, numeric, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Receiving the return: one row, one movement, and at most one credit note.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.receive_sales_return(
  p_source_kind text, p_source_id uuid, p_qty numeric, p_condition text,
  p_received_location uuid, p_quarantine_location uuid DEFAULT NULL,
  p_reason text DEFAULT NULL, p_idempotency_key text DEFAULT NULL,
  p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); s record; v_existing uuid; v_return uuid;
        v_location uuid; v_credit uuid; v_loc_type text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.receive_sales_return requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM inv.sales_returns WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  SELECT * INTO s FROM inv.lock_return_source(v_tenant, p_source_kind, p_source_id);

  v_location := CASE WHEN p_condition = 'damaged' THEN p_quarantine_location ELSE p_received_location END;
  SELECT location_type INTO v_loc_type FROM inv.stock_locations
    WHERE tenant_id = v_tenant AND company_id = s.company_id AND branch_id = s.branch_id AND id = v_location
      AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'sales return: location % is not an active location of the selling branch', v_location USING ERRCODE = 'foreign_key_violation'; END IF;
  IF p_condition = 'damaged' AND v_loc_type <> 'quarantine' THEN
    RAISE EXCEPTION 'sales return: a damaged return goes into a quarantine location, not a % one', v_loc_type USING ERRCODE = 'check_violation';
  END IF;
  IF p_condition = 'restockable' AND v_loc_type <> 'warehouse' AND v_loc_type <> 'storage' THEN
    RAISE EXCEPTION 'sales return: a restockable return goes back into sellable stock, not into a % location', v_loc_type USING ERRCODE = 'check_violation';
  END IF;

  -- The ceiling trigger fires on this INSERT and re-locks the source.
  INSERT INTO inv.sales_returns (tenant_id, company_id, branch_id, source_kind, source_id, item_id,
                                 quantity, return_condition, received_location_id, quarantine_location_id,
                                 reason, idempotency_key, created_by)
    VALUES (v_tenant, s.company_id, s.branch_id, p_source_kind, p_source_id, s.item_id,
            p_qty, p_condition, p_received_location, p_quarantine_location,
            p_reason, p_idempotency_key, iam.current_user_id())
    RETURNING id INTO v_return;

  PERFORM inv.post_stock_movement(s.item_id, v_location, 'return', 'in', p_qty, 'sales_return', v_return, p_correlation);

  IF p_source_kind = 'invoice_line' THEN
    v_credit := sal.request_return_credit_note(p_source_id, p_qty, COALESCE(p_reason, 'Returned goods'));
    UPDATE inv.sales_returns SET credit_note_id = v_credit, status = 'credited'
      WHERE tenant_id = v_tenant AND id = v_return;
  END IF;
  RETURN v_return;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.receive_sales_return(text, uuid, numeric, text, uuid, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.receive_sales_return(text, uuid, numeric, text, uuid, uuid, text, text, uuid) TO app_runtime;
