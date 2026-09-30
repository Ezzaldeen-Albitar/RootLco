-- ============================================================================
-- P1-32-PRE-OD-FIN — finance controls that need no business decision.
-- Owner module: sal (billing and payments)
--
-- Rollback classification: ROLLBACK-SAFE WITH DATA NOTE. One nullable column
--   and one partial unique index are added to sal.payment_allocations; four
--   triggers and three trigger functions are added; five functions are
--   re-issued with the same names; two table-level UPDATE grants are narrowed
--   to column grants. No row is written, moved or deleted. The inverse at the
--   foot of this file restores every previous definition; the one data note is
--   that allocation keys recorded after this migration are lost when the
--   column is dropped, which removes nothing an allocation's amount depends on.
--
-- Purpose (contract review of 2026-09-30, finance evidence folder)
--
--   M-01  The maker/approver separation on sal.credit_notes and
--         sal.receipt_reversals could be bypassed in the database. While a
--         request was pending, requested_by, amount and reason were updatable
--         (app_runtime held UPDATE on every column) and
--         sal.guard_dual_control_approval compared the NEW approver with the
--         NEW requester, so one UPDATE relabelling the requester followed by an
--         approval from the original requester passed every check. From this
--         migration the request is frozen from insert onward — requester,
--         amount, currency, reason, source document, idempotency key and
--         creation stamp — by a trigger raising one stable error, app_runtime
--         may UPDATE only the columns a decision writes, and both the guard
--         and the two approve primitives compare the approver with the STORED
--         requester.
--
--   GAP-13 A credit note's currency must equal its invoice's. Until now only
--         the application compared them. A BEFORE INSERT trigger now refuses a
--         mismatch, and sal.approve_credit_note compares them again under the
--         invoice lock.
--
--   M-09  An allocation had no business idempotency key: a retry after an
--         uncertain outcome, sent under a new transport key, could book a
--         second allocation. sal.payment_allocations gains idempotency_key
--         (unique per tenant) and sal.allocate_receipt takes it: a repeat of
--         the same key returns the allocation it already made, and a key
--         reused for a different receipt, invoice or amount is refused. A
--         receipt may also be recorded only in an ACTIVE currency of
--         shared.currencies; the foreign key already refused an unknown code.
--
--   GAP-05 A partial return credited round(line gross * q / qty, 4) on each
--         return, so three returns of one unit on a three-unit line of 20.0000
--         credited 20.0001 and the last credit could never be approved.
--         sal.request_return_credit_note now allocates cumulatively: the
--         credit for this return is round(gross * (returned before + q) / qty,
--         4) less the credits already raised for the line, so a line returned
--         in full is credited exactly its gross.
--
-- Not changed here: the credit ceiling, rejection or withdrawal of a request,
-- receipt reversal requests, the rounding rule of priced amounts, and every
-- other item the review marks as needing a business decision.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. M-01 — the pending request is frozen from insert onward
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sal.guard_dual_control_request_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  col text;
  v_frozen text[];
BEGIN
  v_frozen := CASE TG_TABLE_NAME
    WHEN 'credit_notes' THEN
      ARRAY['requested_by', 'amount', 'currency_code', 'reason', 'invoice_id', 'idempotency_key', 'created_at', 'created_by']
    ELSE
      ARRAY['requested_by', 'amount', 'currency_code', 'reason', 'original_receipt_id', 'idempotency_key', 'created_at', 'created_by']
  END;
  FOREACH col IN ARRAY v_frozen LOOP
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'dual control: sal.% request is frozen once raised (column %); raise a new request instead', TG_TABLE_NAME, col
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_dual_control_request_frozen() IS
  'BEFORE UPDATE guard on sal.credit_notes and sal.receipt_reversals (P1-32-PRE-OD-FIN, M-01): the requester, amount, currency, reason, source document, idempotency key and creation stamp of a dual-control request are frozen from insert onward, in every approval state. Raises check_violation with the stable prefix "dual control: sal.<table> request is frozen once raised".';
REVOKE EXECUTE ON FUNCTION sal.guard_dual_control_request_frozen() FROM PUBLIC;

CREATE TRIGGER tg_credit_notes_request_frozen BEFORE UPDATE ON sal.credit_notes
  FOR EACH ROW EXECUTE FUNCTION sal.guard_dual_control_request_frozen();
CREATE TRIGGER tg_receipt_reversals_request_frozen BEFORE UPDATE ON sal.receipt_reversals
  FOR EACH ROW EXECUTE FUNCTION sal.guard_dual_control_request_frozen();

-- The approval guard compares the approver with the STORED requester (OLD), so
-- a requester rewritten in the same statement can never make a self-approval
-- look like a second person's.
CREATE OR REPLACE FUNCTION sal.guard_dual_control_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'dual control: sal.% request is frozen once raised (column requested_by); raise a new request instead', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.approval_state = 'pending' AND NEW.approval_state = 'approved' THEN
    NEW.approved_by := iam.current_user_id();
    NEW.approved_at := now();
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'dual control: no user context (approved_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.approved_by = OLD.requested_by THEN
      RAISE EXCEPTION 'dual control: the approver must differ from the requester (maker<>approver)' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.approval_state = 'pending' AND NEW.approval_state = 'rejected' THEN
    NEW.approved_by := iam.current_user_id();
    NEW.approved_at := now();
  ELSIF OLD.approval_state <> 'pending' THEN
    IF NEW.approval_state <> OLD.approval_state OR NEW.requested_by <> OLD.requested_by
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.amount <> OLD.amount THEN
      RAISE EXCEPTION 'dual control: a % decision is frozen', OLD.approval_state USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_dual_control_approval() FROM PUBLIC;

-- app_runtime may UPDATE only what a decision writes. The triggers stamp
-- approved_by, approved_at and the row metadata themselves, and a column a
-- trigger assigns needs no privilege of the caller.
REVOKE UPDATE ON sal.credit_notes FROM app_runtime;
GRANT UPDATE (approval_state, issued_at) ON sal.credit_notes TO app_runtime;
REVOKE UPDATE ON sal.receipt_reversals FROM app_runtime;
GRANT UPDATE (approval_state, reversed_at) ON sal.receipt_reversals TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. GAP-13 — a credit note is in its invoice's currency
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sal.guard_credit_note_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_currency text;
BEGIN
  SELECT i.currency_code INTO v_currency
    FROM sal.invoices i
   WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id
     AND i.branch_id = NEW.branch_id AND i.id = NEW.invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit note: invoice % is not visible in the credit note''s scope', NEW.invoice_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.currency_code IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'credit note: currency % does not match the invoice currency %', NEW.currency_code, v_currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_credit_note_currency() IS
  'BEFORE INSERT guard on sal.credit_notes (P1-32-PRE-OD-FIN, GAP-13): the credit note''s currency must equal its invoice''s currency. currency_code and invoice_id are immutable afterwards, so the equality holds for the life of the row.';
REVOKE EXECUTE ON FUNCTION sal.guard_credit_note_currency() FROM PUBLIC;

CREATE TRIGGER tg_credit_notes_currency BEFORE INSERT ON sal.credit_notes
  FOR EACH ROW EXECUTE FUNCTION sal.guard_credit_note_currency();

-- approve_credit_note: the requester is compared from the STORED row, and the
-- currency is compared again under the invoice lock.
CREATE OR REPLACE FUNCTION sal.approve_credit_note(p_credit_id uuid, p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_cn sal.credit_notes%ROWTYPE; v_open numeric(18, 4); v_currency text; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_cn FROM sal.credit_notes WHERE id = p_credit_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_credit_note: credit note % not found in scope', p_credit_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_cn.approval_state = 'approved' THEN RETURN; END IF; -- idempotent
  IF v_cn.approval_state <> 'pending' THEN RAISE EXCEPTION 'sal.approve_credit_note: credit note is %', v_cn.approval_state USING ERRCODE = 'check_violation'; END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (approved_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_cn.requested_by = v_actor THEN
    RAISE EXCEPTION 'dual control: the approver must differ from the requester (maker<>approver)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT currency_code INTO v_currency FROM sal.invoices WHERE id = v_cn.invoice_id AND tenant_id = v_cn.tenant_id
    AND company_id = v_cn.company_id AND branch_id = v_cn.branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_credit_note: invoice % not found in scope', v_cn.invoice_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_currency IS DISTINCT FROM v_cn.currency_code THEN
    RAISE EXCEPTION 'credit note: currency % does not match the invoice currency %', v_cn.currency_code, v_currency USING ERRCODE = 'check_violation';
  END IF;
  v_open := sal.invoice_open_receivable(v_cn.invoice_id);
  IF v_cn.amount > v_open THEN
    RAISE EXCEPTION 'sal.approve_credit_note: credit % exceeds invoice open receivable %', v_cn.amount, v_open USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.credit_notes SET approval_state = 'approved', issued_at = now() WHERE id = p_credit_id; -- trigger stamps approved_by, maker<>approver
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_cn.tenant_id, v_cn.company_id, v_cn.branch_id, 'credit_note_issued', 'credit_note', v_cn.id, v_cn.currency_code, v_cn.amount, v_actor, p_correlation_id, v_actor);
END; $$;
REVOKE EXECUTE ON FUNCTION sal.approve_credit_note(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.approve_credit_note(uuid, uuid) TO app_runtime;

-- approve_receipt_reversal: the requester is compared from the STORED row.
CREATE OR REPLACE FUNCTION sal.approve_receipt_reversal(p_reversal_id uuid, p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rev sal.receipt_reversals%ROWTYPE; v_rcpt sal.receipts%ROWTYPE; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_rev FROM sal.receipt_reversals WHERE id = p_reversal_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: reversal % not found in scope', p_reversal_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_rev.approval_state = 'approved' THEN RETURN; END IF; -- idempotent
  IF v_rev.approval_state <> 'pending' THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: reversal is %', v_rev.approval_state USING ERRCODE = 'check_violation'; END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (approved_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_rev.requested_by = v_actor THEN
    RAISE EXCEPTION 'dual control: the approver must differ from the requester (maker<>approver)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_rcpt FROM sal.receipts WHERE id = v_rev.original_receipt_id AND tenant_id = v_rev.tenant_id
    AND company_id = v_rev.company_id AND branch_id = v_rev.branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: original receipt not found in scope' USING ERRCODE = 'no_data_found'; END IF;
  IF v_rcpt.status = 'reversed' THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: receipt is already reversed' USING ERRCODE = 'check_violation'; END IF;
  IF v_rev.amount <> v_rcpt.amount THEN
    RAISE EXCEPTION 'sal.approve_receipt_reversal: full-receipt reversal amount % must equal receipt amount %', v_rev.amount, v_rcpt.amount USING ERRCODE = 'check_violation';
  END IF;
  -- Approve the reversal FIRST, then flip the receipt: guard_receipt_freeze (H-fin-1
  -- hardening) permits receipt->'reversed' only when an approved reversal already exists.
  UPDATE sal.receipt_reversals SET approval_state = 'approved', reversed_at = now() WHERE id = p_reversal_id; -- trigger stamps approved_by, maker<>approver
  UPDATE sal.receipts SET status = 'reversed' WHERE id = v_rcpt.id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rev.tenant_id, v_rev.company_id, v_rev.branch_id, 'receipt_reversed', 'receipt_reversal', v_rev.id, v_rev.currency_code, v_rev.amount, v_actor, p_correlation_id, v_actor);
END; $$;
REVOKE EXECUTE ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 3. M-09 — an allocation carries a business idempotency key; a receipt is
--    recorded only in an active currency
-- ----------------------------------------------------------------------------

ALTER TABLE sal.payment_allocations ADD COLUMN idempotency_key text NULL;
COMMENT ON COLUMN sal.payment_allocations.idempotency_key IS
  'The Idempotency-Key the allocation was booked under (P1-32-PRE-OD-FIN, M-09). Unique per tenant: sal.allocate_receipt returns the allocation a key already made rather than booking a second one, and refuses a key reused for a different receipt, invoice or amount. NULL on allocations booked before the key existed.';
CREATE UNIQUE INDEX uq_payment_allocations_idempotency
  ON sal.payment_allocations (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid);

-- allocate_receipt: lock receipt then invoice (order receipts->invoices, H-fin-2),
-- resolve a repeated key under the receipt lock, bound by receipt-unallocated and
-- invoice-open, emit payment_allocated.
CREATE FUNCTION sal.allocate_receipt(
  p_receipt_id uuid, p_invoice_id uuid, p_amount numeric,
  p_correlation_id uuid DEFAULT NULL, p_idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_rcpt sal.receipts%ROWTYPE; v_inv sal.invoices%ROWTYPE; v_prior sal.payment_allocations%ROWTYPE;
  v_unalloc numeric(18, 4); v_open numeric(18, 4); v_alloc_total numeric(18, 4); v_id uuid;
  v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_rcpt FROM sal.receipts WHERE id = p_receipt_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.allocate_receipt: receipt % not found in scope', p_receipt_id USING ERRCODE = 'no_data_found'; END IF;
  -- A repeated key is answered BEFORE any state or bound is re-evaluated: the
  -- command already happened, and a receipt allocated in full by it would
  -- otherwise refuse its own retry as an over-allocation.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM sal.payment_allocations
     WHERE tenant_id = v_rcpt.tenant_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_prior.receipt_id <> p_receipt_id OR v_prior.invoice_id <> p_invoice_id OR v_prior.amount <> p_amount THEN
        RAISE EXCEPTION 'sal.allocate_receipt: idempotency key already booked a different allocation (key reused for another receipt, invoice or amount)'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN v_prior.id;
    END IF;
  END IF;
  IF v_rcpt.status = 'reversed' THEN RAISE EXCEPTION 'sal.allocate_receipt: receipt is reversed' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_inv FROM sal.invoices
    WHERE id = p_invoice_id AND tenant_id = v_rcpt.tenant_id AND company_id = v_rcpt.company_id AND branch_id = v_rcpt.branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.allocate_receipt: invoice % not found in the receipt scope', p_invoice_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_inv.status NOT IN ('issued', 'credited') THEN
    RAISE EXCEPTION 'sal.allocate_receipt: invoice is % (must be issued)', v_inv.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_inv.currency_code <> v_rcpt.currency_code THEN
    RAISE EXCEPTION 'sal.allocate_receipt: invoice currency % <> receipt currency %', v_inv.currency_code, v_rcpt.currency_code USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'sal.allocate_receipt: amount must be positive' USING ERRCODE = 'check_violation'; END IF;
  v_unalloc := sal.receipt_unallocated(p_receipt_id);
  IF p_amount > v_unalloc THEN
    RAISE EXCEPTION 'sal.allocate_receipt: amount % exceeds receipt unallocated %', p_amount, v_unalloc USING ERRCODE = 'check_violation';
  END IF;
  v_open := sal.invoice_open_receivable(p_invoice_id);
  IF p_amount > v_open THEN
    RAISE EXCEPTION 'sal.allocate_receipt: amount % exceeds invoice open receivable %', p_amount, v_open USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO sal.payment_allocations (tenant_id, company_id, branch_id, receipt_id, invoice_id, currency_code, amount, allocated_by, correlation_id, idempotency_key, created_by)
    VALUES (v_rcpt.tenant_id, v_rcpt.company_id, v_rcpt.branch_id, p_receipt_id, p_invoice_id, v_rcpt.currency_code, p_amount, v_actor, p_correlation_id, p_idempotency_key, v_actor)
    RETURNING id INTO v_id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rcpt.tenant_id, v_rcpt.company_id, v_rcpt.branch_id, 'payment_allocated', 'payment_allocation', v_id, v_rcpt.currency_code, p_amount, v_actor, p_correlation_id, v_actor);
  SELECT COALESCE(sum(amount), 0) INTO v_alloc_total FROM sal.payment_allocations WHERE tenant_id = v_rcpt.tenant_id AND receipt_id = p_receipt_id;
  UPDATE sal.receipts SET status = CASE WHEN v_alloc_total >= v_rcpt.amount THEN 'allocated' ELSE 'partially_allocated' END
    WHERE id = p_receipt_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text) TO app_runtime;

CREATE OR REPLACE FUNCTION sal.guard_receipt_currency_active()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM shared.currencies c WHERE c.code = NEW.currency_code AND c.status = 'active'
  ) THEN
    RAISE EXCEPTION 'sal.receipts: currency % is not an active currency', NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_receipt_currency_active() IS
  'BEFORE INSERT guard on sal.receipts (P1-32-PRE-OD-FIN, M-09): a receipt is recorded only in an ACTIVE currency of shared.currencies. fk_receipts_currency already refuses an unknown code; this also refuses a withdrawn one. The currency is frozen afterwards (sal.guard_receipt_freeze), so a currency withdrawn later never invalidates a receipt already recorded.';
REVOKE EXECUTE ON FUNCTION sal.guard_receipt_currency_active() FROM PUBLIC;

CREATE TRIGGER tg_receipts_currency_active BEFORE INSERT ON sal.receipts
  FOR EACH ROW EXECUTE FUNCTION sal.guard_receipt_currency_active();

-- ----------------------------------------------------------------------------
-- 4. GAP-05 — return credits are allocated cumulatively per invoice line
-- ----------------------------------------------------------------------------

-- The credit for THIS return is the line gross's share for everything returned
-- so far, less what earlier returns of the same line were already credited:
--   round(gross * (returned_before + q) / qty, 4) - credited_before.
-- Earlier returns count while their note is not rejected. Rounding is taken once
-- on the cumulative share, so a line returned in full is credited exactly its
-- gross, however many returns it took. The note is still born PENDING and still
-- approved by a second person under the invoice lock (sal.approve_credit_note).
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
    -- Either the line does not exist, or its amounts are invisible to this caller:
    -- `sel_invoice_line_amounts_gated` needs `sal.finance.view`. Both are refusals,
    -- and neither may guess an amount.
    RAISE EXCEPTION 'credit note: invoice line % has no readable amount', p_invoice_line USING ERRCODE = 'no_data_found';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > v_line_qty THEN
    RAISE EXCEPTION 'credit note: % is not a creditable share of the % on the line', p_quantity, v_line_qty USING ERRCODE = 'check_violation';
  END IF;
  -- Earlier returns of this line that raised a credit which still stands. The
  -- return being received is not counted: its credit_note_id is still NULL.
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
  v_amount := round(v_gross * (v_returned_before + p_quantity) / v_line_qty, 4) - v_credited_before;
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
-- Inverse (ROLLBACK-SAFE WITH DATA NOTE — allocation keys recorded after this
-- migration are dropped with their column; no amount depends on them)
--
--   Re-issue sal.request_return_credit_note, sal.approve_credit_note,
--   sal.approve_receipt_reversal and sal.guard_dual_control_approval from
--   20260917094000_inv_sales_returns.sql, 20260724093000_sal_financial_events.sql
--   and 20260724092000_sal_payments.sql, then:
--   DROP TRIGGER tg_receipts_currency_active ON sal.receipts;
--   DROP FUNCTION sal.guard_receipt_currency_active();
--   DROP FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text);
--   -- re-issue sal.allocate_receipt(uuid, uuid, numeric, uuid) from
--   -- 20260724093000_sal_financial_events.sql with its REVOKE and GRANT
--   DROP INDEX sal.uq_payment_allocations_idempotency;
--   ALTER TABLE sal.payment_allocations DROP COLUMN idempotency_key;
--   DROP TRIGGER tg_credit_notes_currency ON sal.credit_notes;
--   DROP FUNCTION sal.guard_credit_note_currency();
--   REVOKE UPDATE (approval_state, reversed_at) ON sal.receipt_reversals FROM app_runtime;
--   GRANT UPDATE ON sal.receipt_reversals TO app_runtime;
--   REVOKE UPDATE (approval_state, issued_at) ON sal.credit_notes FROM app_runtime;
--   GRANT UPDATE ON sal.credit_notes TO app_runtime;
--   DROP TRIGGER tg_receipt_reversals_request_frozen ON sal.receipt_reversals;
--   DROP TRIGGER tg_credit_notes_request_frozen ON sal.credit_notes;
--   DROP FUNCTION sal.guard_dual_control_request_frozen();
-- ----------------------------------------------------------------------------
