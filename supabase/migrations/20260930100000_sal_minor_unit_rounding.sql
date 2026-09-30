-- ============================================================================
-- P1-32-PRE-OD-FD1 — money rounded to the currency's minor unit (ADR-023, D1).
-- Owner module: sal (billing), with the quo line arithmetic it inherits and one
--   shared rounding helper both read.
--
-- Rollback classification: ROLLBACK-SAFE. Two helper functions and one trigger
--   function are added; two CHECK constraints on quo.quotation_items are replaced
--   by a trigger that enforces the same arithmetic at the currency's minor unit;
--   four functions are re-issued with the same names and signatures. No row is
--   written, moved or deleted, and no stored amount is recomputed: an issued
--   quotation, invoice or credit note keeps the figures it was issued with. The
--   inverse at the foot of this file restores every previous definition.
--
-- Purpose (Owner decision D1 of 2026-09-30, ADR-023; finance review GAP-01)
--
--   Every money column is numeric(18,4), but a receipt, an allocation and a
--   credit note must fit the currency's minor unit (JOD 3, USD 2). Line tax and
--   line totals were rounded to four decimals, so a JOD line of 12.345 at 16% tax
--   carried round(12.345 * 0.16, 4) = 1.9752 — a residue of 0.0002 that no receipt
--   and no credit note could ever settle, holding the invoice open for good.
--
--   The approved policy, applied here to the amounts the database computes:
--
--     * A MONETARY LINE AMOUNT is rounded half-up to the currency's minor unit at
--       the point it is computed: line net = round(unit x qty - discount), tax =
--       round(line net x rate), line gross = line net + tax. PostgreSQL's
--       round(numeric, n) rounds half away from zero, which is half-up for the
--       non-negative amounts every one of these is.
--     * DOCUMENT TOTALS ARE SUMS OF ROUNDED LINES. quo.issue_revision already sums
--       tax and line totals; its subtotal is now the sum of each line's
--       (line gross - tax + discount), so subtotal - discount + tax = grand total
--       by construction, whatever precision the unit price carries.
--     * QUANTITIES, RATES AND UNIT PRICES KEEP THEIR OWN SCALES. The currency's
--       scale is applied to monetary amounts only: a quantity stays
--       numeric(12,3), a tax rate numeric(9,6), and a unit price keeps the
--       calculation precision of numeric(18,4). The application refuses a price
--       ENTERED finer than the minor unit (price rules, item selling prices,
--       fixed discounts, amount thresholds); nothing here forces the scale onto a
--       unit price the database derived.
--     * ISSUED DOCUMENTS KEEP THEIR SNAPSHOTS. The replaced CHECKs are dropped,
--       not re-validated, and the new trigger fires on INSERT and on an UPDATE
--       that changes a money column, so no stored line is recomputed and an
--       issued line (frozen by quo.guard_quotation_item) is never touched. A
--       draft line still carrying a four-decimal residue is not rewritten either:
--       quo.issue_revision refuses to issue it, naming the rule, so the draft is
--       re-priced by a revision rather than silently changed. The block at the
--       end of section 3 counts such drafts and raises a NOTICE when it finds any.
--
--   The same rule is applied where the database prices a line itself:
--   sal.create_counter_sale_invoice (net and tax per line) and
--   sal.request_return_credit_note (the cumulative return credit of #486, now at
--   the minor unit, with a line returned in full credited exactly its gross).
--   A work-order invoice line is copied from its quotation line and inherits the
--   rounded amounts unchanged, so sal.invoice_line_amounts needs no change: its
--   CHECK gross = round(net + tax, 4) is an addition identity that minor-unit
--   operands satisfy exactly.
--
-- Not changed here: the credit ceiling (D2), refunds, receipt reversal (D4), the
-- invoice status vocabulary, and every stored amount.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The one rounding rule, and the one test of it
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION shared.round_to_minor_unit(p_amount numeric, p_currency text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_minor smallint;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  SELECT c.minor_unit INTO v_minor FROM shared.currencies c WHERE c.code = p_currency;
  IF v_minor IS NULL THEN
    RAISE EXCEPTION 'money: currency % is not a known currency', p_currency
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN round(p_amount, v_minor);
END; $$;
COMMENT ON FUNCTION shared.round_to_minor_unit(numeric, text) IS
  'P1-32-PRE-OD-FD1 (ADR-023, D1): a monetary amount rounded half-up (half away from zero, identical for the non-negative amounts it is used on) to the minor unit shared.currencies records for the currency. Raises foreign_key_violation for an unknown currency. Used for monetary amounts only - never for a quantity, a rate or a unit price.';
REVOKE EXECUTE ON FUNCTION shared.round_to_minor_unit(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.round_to_minor_unit(numeric, text) TO app_runtime;

CREATE OR REPLACE FUNCTION shared.fits_minor_unit(p_amount numeric, p_currency text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_amount IS NULL OR p_amount = shared.round_to_minor_unit(p_amount, p_currency);
$$;
COMMENT ON FUNCTION shared.fits_minor_unit(numeric, text) IS
  'P1-32-PRE-OD-FD1 (ADR-023, D1): true when the amount carries no non-zero digit below the currency''s minor unit. Trailing zeros are not significant: 12.3450 fits JOD.';
REVOKE EXECUTE ON FUNCTION shared.fits_minor_unit(numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.fits_minor_unit(numeric, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Quotation lines: the arithmetic CHECKs become a minor-unit trigger
-- ----------------------------------------------------------------------------

ALTER TABLE quo.quotation_items DROP CONSTRAINT ck_quotation_items_tax_amount;
ALTER TABLE quo.quotation_items DROP CONSTRAINT ck_quotation_items_line_total;

CREATE OR REPLACE FUNCTION quo.guard_quotation_item_money()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_net numeric; v_tax numeric;
BEGIN
  -- An UPDATE that leaves every input and output of the arithmetic alone is not
  -- re-validated: a stored line is never recomputed, and a line written before
  -- this rule keeps the figures it was written with.
  IF TG_OP = 'UPDATE'
     AND NEW.currency_code IS NOT DISTINCT FROM OLD.currency_code
     AND NEW.captured_unit_price IS NOT DISTINCT FROM OLD.captured_unit_price
     AND NEW.captured_quantity IS NOT DISTINCT FROM OLD.captured_quantity
     AND NEW.captured_discount IS NOT DISTINCT FROM OLD.captured_discount
     AND NEW.captured_tax_rate IS NOT DISTINCT FROM OLD.captured_tax_rate
     AND NEW.captured_tax_amount IS NOT DISTINCT FROM OLD.captured_tax_amount
     AND NEW.captured_line_total IS NOT DISTINCT FROM OLD.captured_line_total THEN
    RETURN NEW;
  END IF;
  IF NOT shared.fits_minor_unit(NEW.captured_discount, NEW.currency_code) THEN
    RAISE EXCEPTION 'quotation line money: discount % is finer than the minor unit of %', NEW.captured_discount, NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  v_net := shared.round_to_minor_unit(NEW.captured_unit_price * NEW.captured_quantity - NEW.captured_discount, NEW.currency_code);
  v_tax := shared.round_to_minor_unit(v_net * NEW.captured_tax_rate, NEW.currency_code);
  IF NEW.captured_tax_amount IS DISTINCT FROM v_tax THEN
    RAISE EXCEPTION 'quotation line money: tax amount % must be % (line net % x rate %, rounded half-up to the minor unit of %)',
      NEW.captured_tax_amount, v_tax, v_net, NEW.captured_tax_rate, NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.captured_line_total IS DISTINCT FROM v_net + v_tax THEN
    RAISE EXCEPTION 'quotation line money: line total % must be % (line net % plus tax %)',
      NEW.captured_line_total, v_net + v_tax, v_net, v_tax
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION quo.guard_quotation_item_money() IS
  'BEFORE INSERT OR UPDATE guard on quo.quotation_items (P1-32-PRE-OD-FD1, ADR-023 D1). Replaces ck_quotation_items_tax_amount and ck_quotation_items_line_total: line net = round(unit x qty - discount), tax = round(line net x rate), line total = line net + tax, each rounded half-up to the currency''s minor unit, and the discount must fit that minor unit. The unit price, quantity and rate keep their own scales. An UPDATE that changes no money column is not re-validated, so no stored line is recomputed.';
REVOKE EXECUTE ON FUNCTION quo.guard_quotation_item_money() FROM PUBLIC;

CREATE TRIGGER tg_quotation_items_money BEFORE INSERT OR UPDATE ON quo.quotation_items
  FOR EACH ROW EXECUTE FUNCTION quo.guard_quotation_item_money();

COMMENT ON TABLE quo.quotation_items IS 'Phase 1-10 captured quotation lines. Per-line arithmetic is trigger-enforced at the currency''s minor unit (tg_quotation_items_money, ADR-023 D1): line total = round(unit*qty - discount) + round(line net * rate); currency matches the revision; frozen once the revision is issued.';

-- ----------------------------------------------------------------------------
-- 3. quo.issue_revision and the deferred totals identity: totals are sums of
--    rounded lines, and a draft still carrying a sub-minor-unit residue is
--    refused rather than issued
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION quo.issue_revision(p_revision_id uuid, p_expires_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); rev quo.quotation_revisions%ROWTYPE; v_count int; v_residue int;
        v_sub numeric(18,4); v_disc numeric(18,4); v_tax numeric(18,4); v_grand numeric(18,4);
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO rev FROM quo.quotation_revisions WHERE tenant_id = v_tenant AND id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quotation revision % not found', p_revision_id USING ERRCODE = 'foreign_key_violation'; END IF;
  -- serialize on the parent quotation
  PERFORM 1 FROM quo.quotations WHERE tenant_id = v_tenant AND id = rev.quotation_id FOR UPDATE;
  IF rev.status <> 'draft' THEN RAISE EXCEPTION 'revision % is % (must be draft)', p_revision_id, rev.status USING ERRCODE = 'check_violation'; END IF;
  -- Totals are sums of the ROUNDED lines (ADR-023, D1). A line's subtotal is its
  -- gross less its tax plus its discount, so subtotal - discount + tax is the
  -- grand total by construction, whatever precision the unit price carries.
  SELECT count(*),
         COALESCE(SUM(captured_line_total - captured_tax_amount + captured_discount), 0),
         COALESCE(SUM(captured_discount), 0),
         COALESCE(SUM(captured_tax_amount), 0), COALESCE(SUM(captured_line_total), 0),
         count(*) FILTER (WHERE NOT shared.fits_minor_unit(captured_tax_amount, currency_code)
                             OR NOT shared.fits_minor_unit(captured_line_total, currency_code)
                             OR NOT shared.fits_minor_unit(captured_discount, currency_code))
    INTO v_count, v_sub, v_disc, v_tax, v_grand, v_residue
    FROM quo.quotation_items WHERE tenant_id = v_tenant AND quotation_revision_id = p_revision_id AND deleted_at IS NULL;
  IF v_count = 0 THEN RAISE EXCEPTION 'cannot issue a revision with no items' USING ERRCODE = 'check_violation'; END IF;
  IF v_residue > 0 THEN
    RAISE EXCEPTION 'quotation line money: revision % carries % line(s) priced finer than the currency minor unit; revise the quotation to re-price them', p_revision_id, v_residue
      USING ERRCODE = 'check_violation';
  END IF;
  -- supersede the prior issued revision first (keeps the single-issued unique satisfied)
  UPDATE quo.quotation_revisions SET status = 'superseded'
    WHERE tenant_id = v_tenant AND quotation_id = rev.quotation_id AND status = 'issued';
  UPDATE quo.quotation_revisions
    SET status = 'issued', issued_at = now(), expires_at = p_expires_at,
        captured_subtotal = v_sub, captured_discount_total = v_disc, captured_tax_total = v_tax, captured_grand_total = v_grand
    WHERE tenant_id = v_tenant AND id = p_revision_id;
  UPDATE quo.quotations SET current_revision_id = p_revision_id, status = 'active'
    WHERE tenant_id = v_tenant AND id = rev.quotation_id;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.issue_revision(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.issue_revision(uuid, timestamptz) TO app_runtime;

-- The deferred totals identity checks an issued revision against the same sums
-- quo.issue_revision writes. Re-issued from 20260723096000_quo_quotations.sql;
-- the only change is the subtotal, now the sum of each line's gross less its tax
-- plus its discount. For every line written under the earlier rule that is
-- round(unit x qty, 4), so an issued revision that reconciled before still does.
CREATE OR REPLACE FUNCTION quo.guard_revision_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_rev uuid; v_status text;
        v_sub numeric(18,4); v_disc numeric(18,4); v_tax numeric(18,4); v_grand numeric(18,4);
        a_sub numeric(18,4); a_disc numeric(18,4); a_tax numeric(18,4); a_grand numeric(18,4);
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_rev := OLD.quotation_revision_id;
  ELSE v_tenant := NEW.tenant_id; v_rev := NEW.quotation_revision_id; END IF;
  SELECT status, captured_subtotal, captured_discount_total, captured_tax_total, captured_grand_total
    INTO v_status, v_sub, v_disc, v_tax, v_grand
    FROM quo.quotation_revisions WHERE tenant_id = v_tenant AND id = v_rev;
  IF v_status IS DISTINCT FROM 'issued' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(captured_line_total - captured_tax_amount + captured_discount), 0), COALESCE(SUM(captured_discount), 0),
         COALESCE(SUM(captured_tax_amount), 0), COALESCE(SUM(captured_line_total), 0)
    INTO a_sub, a_disc, a_tax, a_grand
    FROM quo.quotation_items WHERE tenant_id = v_tenant AND quotation_revision_id = v_rev AND deleted_at IS NULL;
  -- An issued revision always has >= 1 item (issue_revision forbids zero); a live
  -- sum of zero means the revision's items are being torn down (cascade/migration),
  -- so skip the identity check rather than block a legitimate teardown.
  IF a_grand = 0 THEN RETURN NULL; END IF;
  IF v_sub <> a_sub OR v_disc <> a_disc OR v_tax <> a_tax OR v_grand <> a_grand THEN
    RAISE EXCEPTION 'quo: issued revision % totals do not reconcile with its items', v_rev USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_revision_totals() FROM PUBLIC;

-- Surfaced, never rewritten: draft lines written before this rule whose amounts
-- sit below the minor unit. quo.issue_revision refuses them; nothing here changes
-- them. Read-only, and silent when there are none.
DO $$
DECLARE v_drafts int;
BEGIN
  SELECT count(*) INTO v_drafts
    FROM quo.quotation_items it
    JOIN quo.quotation_revisions r ON r.tenant_id = it.tenant_id AND r.id = it.quotation_revision_id
   WHERE r.status = 'draft' AND it.deleted_at IS NULL
     AND (NOT shared.fits_minor_unit(it.captured_tax_amount, it.currency_code)
          OR NOT shared.fits_minor_unit(it.captured_line_total, it.currency_code)
          OR NOT shared.fits_minor_unit(it.captured_discount, it.currency_code));
  IF v_drafts > 0 THEN
    RAISE NOTICE 'P1-32-PRE-OD-FD1: % draft quotation line(s) carry amounts finer than their currency minor unit; they are left unchanged and must be re-priced by a revision before issue', v_drafts;
  END IF;
END; $$;

-- ----------------------------------------------------------------------------
-- 4. Counter sales: each line's net and tax at the minor unit
-- ----------------------------------------------------------------------------

-- Re-issued from 20260917093000_sal_counter_sales.sql. The only change is the
-- two rounding expressions in pass one and the gross in pass two: net and tax are
-- rounded half-up to the sale currency's minor unit, and the gross is their sum.
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

    -- ADR-023 D1: each monetary line amount half-up to the currency's minor unit.
    v_net := shared.round_to_minor_unit(v_price.unit_price * v_qty, v_currency);
    v_tax := shared.round_to_minor_unit(v_net * v_rate, v_currency);
    v_net_total := v_net_total + v_net;
    v_tax_total := v_tax_total + v_tax;
    v_priced := v_priced || jsonb_build_object(
      'lineNumber', v_number, 'itemId', v_item, 'locationId', v_location,
      'quantity', v_qty, 'unitPrice', v_price.unit_price, 'taxClassId', v_price.tax_class_id,
      'netAmount', v_net, 'taxAmount', v_tax);
  END LOOP;

  INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, sale_kind,
                            payer_partner_id, currency_code, idempotency_key, created_by)
    VALUES (v_tenant, p_company, p_branch, NULL, 'counter_sale', p_customer, v_currency, p_idempotency_key, v_actor)
    RETURNING id INTO v_invoice;
  INSERT INTO sal.invoice_amounts (tenant_id, company_id, branch_id, invoice_id, net_total, tax_total, gross_total, created_by)
    VALUES (v_tenant, p_company, p_branch, v_invoice, v_net_total, v_tax_total, v_net_total + v_tax_total, v_actor);

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
              (v_line ->> 'netAmount')::numeric + (v_line ->> 'taxAmount')::numeric,
              (v_line ->> 'netAmount')::numeric + (v_line ->> 'taxAmount')::numeric, 0, v_actor);
  END LOOP;

  INSERT INTO sal.invoice_status_history (tenant_id, company_id, branch_id, invoice_id, from_status, to_status, correlation_id, actor_id)
    VALUES (v_tenant, p_company, p_branch, v_invoice, NULL, 'draft', p_correlation, v_actor);
  RETURN v_invoice;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.create_counter_sale_invoice(uuid, uuid, uuid, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.create_counter_sale_invoice(uuid, uuid, uuid, jsonb, text, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 5. Return credits: the cumulative share at the minor unit
-- ----------------------------------------------------------------------------

-- Re-issued from 20260930090000_sal_finance_controls.sql. The cumulative rule is
-- unchanged; the share is rounded half-up to the line currency's minor unit, and
-- the return that completes the line credits exactly what remains of its gross,
-- so a line returned in full is credited its gross however it was stored.
CREATE OR REPLACE FUNCTION sal.request_return_credit_note(
  p_invoice_line uuid, p_quantity numeric, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_co uuid; v_br uuid; v_invoice uuid; v_currency text; v_credit uuid;
        v_line_qty numeric(12, 3); v_gross numeric(18, 4); v_amount numeric(18, 4);
        v_returned_before numeric; v_credited_before numeric(18, 4);
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'sal.request_return_credit_note requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT l.company_id, l.branch_id, l.invoice_id, l.currency_code, l.quantity, la.gross_amount
    INTO v_co, v_br, v_invoice, v_currency, v_line_qty, v_gross
    FROM sal.invoice_lines l JOIN sal.invoice_line_amounts la
      ON la.tenant_id = l.tenant_id AND la.company_id = l.company_id AND la.branch_id = l.branch_id
     AND la.invoice_line_id = l.id AND la.deleted_at IS NULL
   WHERE l.tenant_id = v_tenant AND l.id = p_invoice_line AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit note: invoice line % has no readable amount', p_invoice_line USING ERRCODE = 'no_data_found';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > v_line_qty THEN
    RAISE EXCEPTION 'credit note: % is not a creditable share of the % on the line', p_quantity, v_line_qty USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum(r.quantity), 0), COALESCE(sum(cn.amount), 0)
    INTO v_returned_before, v_credited_before
    FROM inv.sales_returns r
    JOIN sal.credit_notes cn
      ON cn.tenant_id = r.tenant_id AND cn.company_id = r.company_id
     AND cn.branch_id = r.branch_id AND cn.id = r.credit_note_id
   WHERE r.tenant_id = v_tenant AND r.source_kind = 'invoice_line' AND r.source_id = p_invoice_line
     AND cn.approval_state <> 'rejected';
  IF v_returned_before + p_quantity > v_line_qty THEN
    RAISE EXCEPTION 'credit note: % more is past the % on the line (% already credited)', p_quantity, v_line_qty, v_returned_before USING ERRCODE = 'check_violation';
  END IF;
  IF v_returned_before + p_quantity = v_line_qty THEN
    v_amount := v_gross - v_credited_before;
  ELSE
    v_amount := shared.round_to_minor_unit(v_gross * (v_returned_before + p_quantity) / v_line_qty, v_currency) - v_credited_before;
  END IF;
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
-- Inverse (ROLLBACK-SAFE — no row depends on anything added here)
--
--   Re-issue sal.request_return_credit_note from
--   20260930090000_sal_finance_controls.sql, sal.create_counter_sale_invoice from
--   20260917093000_sal_counter_sales.sql, and quo.issue_revision and
--   quo.guard_revision_totals from 20260723096000_quo_quotations.sql, each with its
--   REVOKE and GRANT, then:
--   DROP TRIGGER tg_quotation_items_money ON quo.quotation_items;
--   DROP FUNCTION quo.guard_quotation_item_money();
--   ALTER TABLE quo.quotation_items
--     ADD CONSTRAINT ck_quotation_items_tax_amount CHECK (captured_tax_amount = round((captured_unit_price * captured_quantity - captured_discount) * captured_tax_rate, 4)) NOT VALID,
--     ADD CONSTRAINT ck_quotation_items_line_total CHECK (captured_line_total = round(captured_unit_price * captured_quantity - captured_discount + captured_tax_amount, 4)) NOT VALID;
--   -- NOT VALID: a line written under the minor-unit rule does not satisfy the
--   -- four-decimal expression, and rewriting it is exactly what this file refuses.
--   DROP FUNCTION shared.fits_minor_unit(numeric, text);
--   DROP FUNCTION shared.round_to_minor_unit(numeric, text);
--   and restore the table comment on quo.quotation_items.
-- ----------------------------------------------------------------------------
