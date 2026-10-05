-- ============================================================================
-- P1-32-PRE-OD-FD5 — invoice approved quantities only, and track what each
-- quotation line has invoiced across superseding revisions (Owner decisions
-- D5 and D15 of 2026-09-30, ADR-023).
-- Owner module: sal (two unique indexes replacing one, one index, one read
--   function and three trigger functions with their triggers on
--   sal.invoices, sal.invoice_lines and sal.invoice_line_amounts)
--
-- Rollback classification: ROLLBACK-SAFE while no work order holds two live
--   invoices; roll-forward-only once one does, because the inverse restores
--   uq_invoices_work_order_active, which such a work order would violate.
--   Forward-only — the inverse at the foot of this file is for a rehearsal
--   copy only.
--
-- Purpose
--   D5: approved items and quantities are invoiceable; rejected, cancelled and
--   unapproved ones are not. D15: invoiced quantities and amounts are tracked
--   against accepted revisions and their source lines, so approved quantities
--   not yet billed can be billed later without billing anything twice, across
--   superseding revisions; "one invoice per revision" is not the only
--   safeguard; idempotency and concurrency protection live in the backend AND
--   the database.
--
--   Until now a work-order invoice copied every line of a revision whose every
--   line was approved, and uq_invoices_work_order_active allowed ONE live
--   invoice per work order. That was the only thing stopping a second bill of
--   the same work, and it made later billing of approved work impossible.
--
-- What a source line is, and how it is followed across revisions
--   The invoice line already names its quotation line
--   (sal.invoice_lines.source_quotation_item_id). A quotation line carries no
--   pointer to the line it replaced in an earlier revision: revisions are
--   typed afresh, and the optional work-order references are never sent by
--   the screens. So the identity that survives a superseding revision is the
--   thing being sold: (item_kind, service_id) for a service line and
--   (item_kind, item_ref) for a part line — the LINEAGE. A line naming neither
--   (none can be written through the API) is its own lineage. Nothing is
--   stored or backfilled; the lineage is derived from columns every line
--   already has, so no existing row is linked by guesswork.
--
--   Quantities are pooled per work order and lineage: what was invoiced for a
--   lineage under any revision counts against the approved quantity of that
--   lineage in the revision billed now. When the revision billed now holds
--   MORE THAN ONE approved line of a lineage and some of that lineage was
--   invoiced under another revision, which line the earlier quantity belongs
--   to cannot be told apart, and those lines are refused as
--   'lineage_ambiguous' rather than guessed — that can bill less, never more.
--
-- sal.billable_quotation_lines(revision, excluded invoice line)
--   One read used by the application AND by the guards below, so the two
--   cannot disagree. For every line of the revision: the customer's decision,
--   the quoted, approved, invoiced and remaining quantities, the remaining
--   net, tax and discount (NULL to a caller without sal.finance.view), and a
--   status: billable, not_current (the revision is not the current issued or
--   rejected revision of a live quotation), not_approved, rejected,
--   lineage_ambiguous, fully_invoiced, or repriced_below_invoiced (the
--   approved line now totals less than what was already invoiced for its
--   lineage). Invoices that are void_before_issue release what they held;
--   issued and credited invoices keep it — an approved credit note does not
--   make work billable again.
--
--   The remaining amount of a line that nothing has invoiced yet is the
--   line's own captured amount, exactly as before. The remaining amount of a
--   line part of whose lineage was already invoiced is the line's captured
--   net and tax less what was already invoiced, so the lineage is never
--   billed more than the approved line's total; its discount is then not
--   restated and is reported as zero.
--
-- Guards (all SECURITY INVOKER, empty search_path, EXECUTE revoked from PUBLIC)
--   * sal.guard_invoice_work_order_source, BEFORE INSERT OR UPDATE OF
--     quotation_revision_id ON sal.invoices: locks the work order row (FOR NO
--     KEY UPDATE) for the rest of the transaction; a work-order invoice that
--     names a quotation revision must name one of its own work order's
--     quotations; a live invoice that names a revision and a live invoice that
--     names none never coexist on one work order; the revision named is
--     frozen.
--   * sal.guard_invoice_line_source, BEFORE INSERT OR UPDATE ON
--     sal.invoice_lines: on an invoice that names a revision, every live line
--     names a source line of that revision, has its kind, and — under the
--     work order row lock, re-reading after the lock — is 'billable' with at
--     most the remaining approved quantity.
--   * sal.guard_invoice_line_amount_source, BEFORE INSERT OR UPDATE ON
--     sal.invoice_line_amounts: under the same lock, a sourced line's net and
--     tax do not exceed what remains of the approved line.
--
-- One live invoice per work order, replaced rather than dropped
--   uq_invoices_work_order_active is replaced by:
--     * uq_invoices_work_order_draft — at most one DRAFT invoice per work order;
--       two creators racing both insert a draft and the second is refused by
--       the index;
--     * uq_invoices_work_order_unsourced — at most one live invoice per work
--       order among invoices that name no quotation revision (the old rule,
--       kept whole for them);
--     * the guards above for invoices that do name one.
--   So a second live invoice is possible only for approved quantity no live
--   invoice holds, which is what the old rule protected and what it also
--   prevented from ever being billed.
--
-- Existing rows
--   No row is written, moved or recomputed. Every invoice the application
--   created names its revision and every line its source, so existing
--   invoices count against their lineages from the moment this applies. The
--   guards fire on new writes only.
--
-- Security implications
--   No new table, policy, grant, role or SECURITY DEFINER. The read function
--   is SECURITY INVOKER and reads quo and sal under the caller's own RLS;
--   amounts in sal.invoice_line_amounts remain behind sal.finance.view, and
--   the function returns no amount to a caller without it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One live invoice per work order, replaced.
-- ----------------------------------------------------------------------------
DROP INDEX sal.uq_invoices_work_order_active;
CREATE UNIQUE INDEX uq_invoices_work_order_draft ON sal.invoices (tenant_id, company_id, branch_id, work_order_id)
  WHERE work_order_id IS NOT NULL AND status = 'draft' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_invoices_work_order_unsourced ON sal.invoices (tenant_id, company_id, branch_id, work_order_id)
  WHERE work_order_id IS NOT NULL AND quotation_revision_id IS NULL
    AND status <> 'void_before_issue' AND deleted_at IS NULL;
CREATE INDEX ix_invoice_lines_source_quotation_item ON sal.invoice_lines (tenant_id, source_quotation_item_id)
  WHERE source_quotation_item_id IS NOT NULL;

COMMENT ON INDEX sal.uq_invoices_work_order_draft IS
  'P1-32-PRE-OD-FD5 (ADR-023 D5/D15): at most one draft invoice per work order. Replaces, with uq_invoices_work_order_unsourced and the sal invoice source guards, the one-live-invoice rule of uq_invoices_work_order_active.';
COMMENT ON INDEX sal.uq_invoices_work_order_unsourced IS
  'P1-32-PRE-OD-FD5: at most one live invoice per work order among invoices that name no quotation revision — the old one-live-invoice rule, kept whole for invoices the quantity guards cannot follow.';

-- ----------------------------------------------------------------------------
-- 2. What each line of a revision may still bill.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.billable_quotation_lines(
  p_revision_id uuid, p_exclude_invoice_line_id uuid DEFAULT NULL)
RETURNS TABLE (
  quotation_item_id  uuid,
  line_number        integer,
  item_kind          text,
  decision           text,
  quoted_quantity    numeric(12, 3),
  approved_quantity  numeric(12, 3),
  invoiced_quantity  numeric(12, 3),
  remaining_quantity numeric(12, 3),
  remaining_net      numeric(18, 4),
  remaining_tax      numeric(18, 4),
  remaining_discount numeric(18, 4),
  carried            boolean,
  billing_status     text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH rev AS (
    SELECT r.tenant_id, r.company_id, r.branch_id, r.id, q.work_order_id,
           (r.id = q.current_revision_id AND r.status IN ('issued', 'rejected')
            AND r.deleted_at IS NULL AND q.status <> 'cancelled' AND q.deleted_at IS NULL) AS is_source
      FROM quo.quotation_revisions r
      JOIN quo.quotations q
        ON q.tenant_id = r.tenant_id AND q.company_id = r.company_id
       AND q.branch_id = r.branch_id AND q.id = r.quotation_id
     WHERE r.tenant_id = iam.current_tenant_id() AND r.id = p_revision_id
  ),
  lines AS (
    SELECT it.id, it.line_number, it.item_kind,
           COALESCE(it.service_id, it.item_ref, it.id) AS lineage_ref,
           it.captured_quantity AS qty,
           (it.captured_line_total - it.captured_tax_amount) AS net,
           it.captured_tax_amount AS tax,
           it.captured_discount AS discount,
           d.decision, rev.is_source
      FROM rev
      JOIN quo.quotation_items it
        ON it.tenant_id = rev.tenant_id AND it.company_id = rev.company_id
       AND it.branch_id = rev.branch_id AND it.quotation_revision_id = rev.id
       AND it.deleted_at IS NULL
      LEFT JOIN quo.approval_decisions d
        ON d.tenant_id = it.tenant_id AND d.company_id = it.company_id
       AND d.branch_id = it.branch_id AND d.quotation_revision_id = it.quotation_revision_id
       AND d.quotation_item_id = it.id
  ),
  billed AS (
    SELECT l.source_quotation_item_id AS source_id, s.item_kind,
           COALESCE(s.service_id, s.item_ref, s.id) AS lineage_ref,
           l.quantity, a.net_amount, a.tax_amount
      FROM rev
      JOIN sal.invoices i
        ON i.tenant_id = rev.tenant_id AND i.company_id = rev.company_id
       AND i.branch_id = rev.branch_id AND i.work_order_id = rev.work_order_id
       AND i.status <> 'void_before_issue'
      JOIN sal.invoice_lines l
        ON l.tenant_id = i.tenant_id AND l.company_id = i.company_id
       AND l.branch_id = i.branch_id AND l.invoice_id = i.id
       AND l.deleted_at IS NULL AND l.source_quotation_item_id IS NOT NULL
       AND l.id IS DISTINCT FROM p_exclude_invoice_line_id
      JOIN quo.quotation_items s
        ON s.tenant_id = l.tenant_id AND s.id = l.source_quotation_item_id
      LEFT JOIN sal.invoice_line_amounts a
        ON a.tenant_id = l.tenant_id AND a.company_id = l.company_id
       AND a.branch_id = l.branch_id AND a.invoice_line_id = l.id AND a.deleted_at IS NULL
  ),
  measured AS (
    SELECT ln.*,
           COALESCE((SELECT sum(b.quantity) FROM billed b WHERE b.source_id = ln.id), 0) AS line_q,
           COALESCE((SELECT sum(b.net_amount) FROM billed b WHERE b.source_id = ln.id), 0) AS line_net_billed,
           COALESCE((SELECT sum(b.tax_amount) FROM billed b WHERE b.source_id = ln.id), 0) AS line_tax_billed,
           COALESCE((SELECT sum(b.quantity) FROM billed b
                      WHERE b.item_kind = ln.item_kind AND b.lineage_ref = ln.lineage_ref
                        AND NOT EXISTS (SELECT 1 FROM lines o WHERE o.id = b.source_id)), 0) AS carried_q,
           COALESCE((SELECT sum(b.net_amount) FROM billed b
                      WHERE b.item_kind = ln.item_kind AND b.lineage_ref = ln.lineage_ref
                        AND NOT EXISTS (SELECT 1 FROM lines o WHERE o.id = b.source_id)), 0) AS carried_net,
           COALESCE((SELECT sum(b.tax_amount) FROM billed b
                      WHERE b.item_kind = ln.item_kind AND b.lineage_ref = ln.lineage_ref
                        AND NOT EXISTS (SELECT 1 FROM lines o WHERE o.id = b.source_id)), 0) AS carried_tax,
           (SELECT count(*) FROM lines o
             WHERE o.item_kind = ln.item_kind AND o.lineage_ref = ln.lineage_ref
               AND o.decision = 'approved') AS approved_in_lineage
      FROM lines ln
  ),
  judged AS (
    SELECT m.*,
           CASE
             WHEN NOT m.is_source THEN 'not_current'
             WHEN m.decision IS NULL THEN 'not_approved'
             WHEN m.decision <> 'approved' THEN 'rejected'
             WHEN m.carried_q > 0 AND m.approved_in_lineage > 1 THEN 'lineage_ambiguous'
             WHEN m.qty - m.line_q - m.carried_q <= 0 THEN 'fully_invoiced'
             WHEN m.line_q + m.carried_q > 0
                  AND (m.net - m.line_net_billed - m.carried_net < 0
                       OR m.tax - m.line_tax_billed - m.carried_tax < 0) THEN 'repriced_below_invoiced'
             ELSE 'billable'
           END AS status,
           (m.decision IS NOT DISTINCT FROM 'approved' AND m.approved_in_lineage = 1 AND m.carried_q > 0) AS absorbs,
           iam.has_permission('sal.finance.view') AS sees_money
      FROM measured m
  )
  SELECT j.id,
         j.line_number,
         j.item_kind,
         j.decision,
         j.qty::numeric(12, 3),
         (CASE WHEN j.decision IS NOT DISTINCT FROM 'approved' THEN j.qty ELSE 0 END)::numeric(12, 3),
         (j.line_q + CASE WHEN j.absorbs THEN j.carried_q ELSE 0 END)::numeric(12, 3),
         (CASE WHEN j.status = 'billable' THEN j.qty - j.line_q - j.carried_q ELSE 0 END)::numeric(12, 3),
         (CASE WHEN j.status = 'billable' AND j.sees_money
               THEN j.net - j.line_net_billed - j.carried_net END)::numeric(18, 4),
         (CASE WHEN j.status = 'billable' AND j.sees_money
               THEN j.tax - j.line_tax_billed - j.carried_tax END)::numeric(18, 4),
         (CASE WHEN j.status = 'billable' AND j.sees_money
               THEN CASE WHEN j.line_q = 0 AND j.carried_q = 0 THEN j.discount ELSE 0 END END)::numeric(18, 4),
         j.absorbs,
         j.status
    FROM judged j
   ORDER BY j.line_number
$$;
COMMENT ON FUNCTION sal.billable_quotation_lines(uuid, uuid) IS
  'P1-32-PRE-OD-FD5 (ADR-023 D5/D15): every line of a quotation revision with its decision and its quoted, approved, invoiced and remaining quantities; the remaining net, tax and discount only to a caller holding sal.finance.view; and a billing_status (billable, not_current, not_approved, rejected, lineage_ambiguous, fully_invoiced, repriced_below_invoiced). Invoiced quantity is pooled per work order and lineage — (item_kind, service_id or item_ref) — across every revision; void_before_issue invoices release it, issued and credited invoices keep it. p_exclude_invoice_line_id leaves one invoice line out, for the guards that judge it. Used by the application and by the sal invoice source guards alike.';
REVOKE EXECUTE ON FUNCTION sal.billable_quotation_lines(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.billable_quotation_lines(uuid, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 3. The invoice header: one work order, one way of sourcing at a time.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.guard_invoice_work_order_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.sale_kind <> 'work_order' OR NEW.work_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.quotation_revision_id IS DISTINCT FROM OLD.quotation_revision_id THEN
      RAISE EXCEPTION 'invoice_source_frozen: the quotation revision an invoice bills cannot be changed'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Every invoice write for this work order serialises here until COMMIT.
  PERFORM 1 FROM wo.work_orders w
    WHERE w.tenant_id = NEW.tenant_id AND w.company_id = NEW.company_id
      AND w.branch_id = NEW.branch_id AND w.id = NEW.work_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sal.invoices: work order % not found in scope', NEW.work_order_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.quotation_revision_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM quo.quotation_revisions r
        JOIN quo.quotations q
          ON q.tenant_id = r.tenant_id AND q.company_id = r.company_id
         AND q.branch_id = r.branch_id AND q.id = r.quotation_id
       WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
         AND r.branch_id = NEW.branch_id AND r.id = NEW.quotation_revision_id
         AND q.work_order_id = NEW.work_order_id) THEN
      RAISE EXCEPTION 'invoice_source_foreign: quotation revision % is not a revision of work order %''s quotations',
        NEW.quotation_revision_id, NEW.work_order_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM sal.invoices i
       WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id
         AND i.branch_id = NEW.branch_id AND i.work_order_id = NEW.work_order_id
         AND i.quotation_revision_id IS NULL AND i.status <> 'void_before_issue'
         AND i.id <> NEW.id) THEN
      RAISE EXCEPTION 'invoice_source_mixed: work order % has a live invoice that names no quotation revision', NEW.work_order_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF EXISTS (
      SELECT 1 FROM sal.invoices i
       WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id
         AND i.branch_id = NEW.branch_id AND i.work_order_id = NEW.work_order_id
         AND i.quotation_revision_id IS NOT NULL AND i.status <> 'void_before_issue'
         AND i.id <> NEW.id) THEN
    RAISE EXCEPTION 'invoice_source_mixed: work order % has a live invoice billed from its quotation', NEW.work_order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_invoice_work_order_source() IS
  'BEFORE INSERT OR UPDATE OF quotation_revision_id guard on sal.invoices (P1-32-PRE-OD-FD5, ADR-023 D5/D15). For a work-order invoice: locks the work order row FOR NO KEY UPDATE until COMMIT, so every invoice write for one work order is serialised; a named quotation revision must belong to the work order''s own quotations; a live invoice that names a revision and a live invoice that names none never coexist on one work order; the revision named is frozen.';
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_work_order_source() FROM PUBLIC;

CREATE TRIGGER tg_invoices_work_order_source BEFORE INSERT OR UPDATE OF quotation_revision_id ON sal.invoices
  FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_work_order_source();

-- ----------------------------------------------------------------------------
-- 4. A sourced line bills only what remains approved.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.guard_invoice_line_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_kind text; v_work_order uuid; v_revision uuid; v_line record;
BEGIN
  SELECT i.sale_kind, i.work_order_id, i.quotation_revision_id
    INTO v_kind, v_work_order, v_revision
    FROM sal.invoices i
   WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id
     AND i.branch_id = NEW.branch_id AND i.id = NEW.invoice_id;
  -- A missing parent is sal.guard_invoice_line_frozen's refusal; a counter sale
  -- and an invoice that names no revision are not followed by quantity.
  IF NOT FOUND OR v_kind <> 'work_order' OR v_revision IS NULL THEN
    RETURN NEW;
  END IF;
  -- A deleted line bills nothing, and an UPDATE that moves nothing a bill
  -- depends on is not judged again.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL
     AND NEW.quantity = OLD.quantity AND NEW.line_type = OLD.line_type
     AND NEW.source_quotation_item_id IS NOT DISTINCT FROM OLD.source_quotation_item_id THEN
    RETURN NEW;
  END IF;
  IF NEW.source_quotation_item_id IS NULL THEN
    RAISE EXCEPTION 'invoice_source_line_required: a line of an invoice billed from a quotation revision names its quotation line'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM wo.work_orders w
    WHERE w.tenant_id = NEW.tenant_id AND w.company_id = NEW.company_id
      AND w.branch_id = NEW.branch_id AND w.id = v_work_order
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sal.invoice_lines: work order % not found in scope', v_work_order
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Read AFTER the lock: a concurrent writer that held it has committed, and
  -- this statement's snapshot sees what it invoiced.
  SELECT b.* INTO v_line
    FROM sal.billable_quotation_lines(v_revision, NEW.id) b
   WHERE b.quotation_item_id = NEW.source_quotation_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_source_line_foreign: quotation line % is not a line of the revision this invoice bills', NEW.source_quotation_item_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_line.item_kind <> NEW.line_type THEN
    RAISE EXCEPTION 'invoice_line_type_mismatch: quotation line % is a % line', NEW.source_quotation_item_id, v_line.item_kind
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_line.billing_status <> 'billable' THEN
    RAISE EXCEPTION 'invoice_line_not_billable: quotation line % is %', NEW.source_quotation_item_id, v_line.billing_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.quantity > v_line.remaining_quantity THEN
    RAISE EXCEPTION 'invoice_quantity_exceeds_approved: quotation line % has % approved and not yet invoiced, not %',
      NEW.source_quotation_item_id, v_line.remaining_quantity, NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_invoice_line_source() IS
  'BEFORE INSERT OR UPDATE guard on sal.invoice_lines (P1-32-PRE-OD-FD5, ADR-023 D5/D15). On a work-order invoice that names a quotation revision, a live line must name a line of that revision with the same kind, and — under the work order row lock, read after it — be billable per sal.billable_quotation_lines with a quantity no greater than what remains approved and not yet invoiced for its lineage. Lines of counter sales and of invoices that name no revision are not followed.';
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_line_source() FROM PUBLIC;

CREATE TRIGGER tg_invoice_lines_source BEFORE INSERT OR UPDATE ON sal.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_line_source();

-- ----------------------------------------------------------------------------
-- 5. A sourced line's money stays within the approved line.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.guard_invoice_line_amount_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_source uuid; v_revision uuid; v_work_order uuid; v_kind text; v_line record;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL
     AND NEW.net_amount = OLD.net_amount AND NEW.tax_amount = OLD.tax_amount THEN
    RETURN NEW;
  END IF;
  -- Without sal.finance.view the row is refused by ins/upd_invoice_line_amounts_gated,
  -- and that refusal is the one to report.
  IF NOT iam.has_permission('sal.finance.view') THEN
    RETURN NEW;
  END IF;
  SELECT l.source_quotation_item_id, i.quotation_revision_id, i.work_order_id, i.sale_kind
    INTO v_source, v_revision, v_work_order, v_kind
    FROM sal.invoice_lines l
    JOIN sal.invoices i
      ON i.tenant_id = l.tenant_id AND i.company_id = l.company_id
     AND i.branch_id = l.branch_id AND i.id = l.invoice_id
   WHERE l.tenant_id = NEW.tenant_id AND l.company_id = NEW.company_id
     AND l.branch_id = NEW.branch_id AND l.id = NEW.invoice_line_id;
  IF NOT FOUND OR v_kind <> 'work_order' OR v_revision IS NULL OR v_source IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM wo.work_orders w
    WHERE w.tenant_id = NEW.tenant_id AND w.company_id = NEW.company_id
      AND w.branch_id = NEW.branch_id AND w.id = v_work_order
    FOR NO KEY UPDATE;

  SELECT b.* INTO v_line
    FROM sal.billable_quotation_lines(v_revision, NEW.invoice_line_id) b
   WHERE b.quotation_item_id = v_source;
  IF NOT FOUND OR v_line.billing_status <> 'billable' OR v_line.remaining_net IS NULL
     OR NEW.net_amount > v_line.remaining_net OR NEW.tax_amount > v_line.remaining_tax THEN
    RAISE EXCEPTION 'invoice_amount_exceeds_approved: the line billing quotation line % would exceed what remains of its approved amount', v_source
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_invoice_line_amount_source() IS
  'BEFORE INSERT OR UPDATE guard on sal.invoice_line_amounts (P1-32-PRE-OD-FD5, ADR-023 D5/D15). For a line of a work-order invoice that names a quotation revision, under the work order row lock: the net and tax may not exceed what remains of the approved line per sal.billable_quotation_lines, so a lineage is never billed more than its approved total.';
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_line_amount_source() FROM PUBLIC;

CREATE TRIGGER tg_invoice_line_amounts_source BEFORE INSERT OR UPDATE ON sal.invoice_line_amounts
  FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_line_amount_source();

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only — refused once a work order holds two
-- live invoices)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM sal.invoices WHERE work_order_id IS NOT NULL
--                  AND status <> 'void_before_issue' AND deleted_at IS NULL
--                GROUP BY tenant_id, company_id, branch_id, work_order_id HAVING count(*) > 1) THEN
--       RAISE EXCEPTION 'a work order holds two live invoices; this migration is forward-only';
--     END IF;
--   END $$;
--   DROP TRIGGER tg_invoice_line_amounts_source ON sal.invoice_line_amounts;
--   DROP FUNCTION sal.guard_invoice_line_amount_source();
--   DROP TRIGGER tg_invoice_lines_source ON sal.invoice_lines;
--   DROP FUNCTION sal.guard_invoice_line_source();
--   DROP TRIGGER tg_invoices_work_order_source ON sal.invoices;
--   DROP FUNCTION sal.guard_invoice_work_order_source();
--   DROP FUNCTION sal.billable_quotation_lines(uuid, uuid);
--   DROP INDEX sal.ix_invoice_lines_source_quotation_item;
--   DROP INDEX sal.uq_invoices_work_order_unsourced;
--   DROP INDEX sal.uq_invoices_work_order_draft;
--   CREATE UNIQUE INDEX uq_invoices_work_order_active ON sal.invoices (tenant_id, company_id, branch_id, work_order_id)
--     WHERE work_order_id IS NOT NULL AND status <> 'void_before_issue' AND deleted_at IS NULL;
-- ----------------------------------------------------------------------------
