-- ============================================================================
-- Phase 1-11 — sal financial events + primitives (P1-11-DB-007/009/010)
-- The immutable, append-only financial_event foundation (future accounting
-- integration point — NOT a general ledger), its provenance guard, the
-- exactly-one-event-per-command completeness constraint triggers, the invoice-issue
-- / receipt / allocation / credit / reversal primitives, and outstanding-balance
-- derivation.
--
-- Rollback classification: ROLL-FORWARD-ONLY once any financial event exists (financial;
--   no down migration).
--
-- Binding amendments (phase-1-11-design.md §19): H-fin-1 (derivation excludes
-- reversed-receipt allocations), H-fin-2 (credit/reversal lock the invoice/receipt),
-- H-fin-3 (deferred completeness constraint triggers), M-fin-2 (numbering config),
-- M-fin-3 (in-lock idempotency pre-check), L-fin-3 (round-then-sum), M-wty-3/L-fin-2
-- (warranty_split source = invoice, amount = Σ line warranty_pay).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sal.financial_events — immutable append-only source-fact ledger
-- ----------------------------------------------------------------------------
CREATE TABLE sal.financial_events (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  event_type     text NOT NULL,
  source_type    text NOT NULL,
  source_id      uuid NOT NULL,
  currency_code  text NOT NULL,
  amount         numeric(18, 4) NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid NOT NULL,
  correlation_id uuid NULL,
  idempotency_key text NULL,
  seq            bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,

  CONSTRAINT pk_financial_events PRIMARY KEY (id),
  CONSTRAINT fk_financial_events_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_financial_events_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_financial_events_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_financial_events_event_type CHECK (event_type IN (
    'invoice_issued', 'receipt_recorded', 'payment_allocated',
    'credit_note_issued', 'receipt_reversed', 'warranty_split_recorded')),
  CONSTRAINT ck_financial_events_source_type CHECK (source_type IN (
    'invoice', 'receipt', 'payment_allocation', 'credit_note', 'receipt_reversal')),
  CONSTRAINT ck_financial_events_amount CHECK (amount >= 0),
  -- Single-use: one event per (source command, event type). invoice_issued and
  -- warranty_split_recorded share source_type='invoice' but differ by event_type.
  CONSTRAINT uq_financial_events_source UNIQUE (tenant_id, source_type, source_id, event_type)
);
COMMENT ON TABLE sal.financial_events IS 'Phase 1-11 IMMUTABLE append-only financial-event ledger (SELECT+INSERT only; WHOLE ROW gated by sal.finance.view). The future accounting integration point (Figure 4.29) — NOT a general ledger: no debit/credit/account columns. Exactly one event per financial command (completeness constraint triggers); provenance-guarded; single-use per (source, event_type). Roll-forward-only.';
CREATE INDEX ix_financial_events_source ON sal.financial_events (tenant_id, source_type, source_id);
CREATE INDEX ix_financial_events_scope_time ON sal.financial_events (tenant_id, company_id, branch_id, occurred_at DESC, seq DESC);
CREATE INDEX ix_financial_events_correlation ON sal.financial_events (tenant_id, correlation_id);
CREATE INDEX ix_financial_events_currency ON sal.financial_events (currency_code);

-- Provenance guard: every event must name a real source row in scope, in its
-- authorized/terminal state, with the amount and currency bound to that source.
CREATE OR REPLACE FUNCTION sal.guard_financial_event_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_amount numeric(18, 4); v_currency text; v_ok boolean := false;
BEGIN
  IF NEW.event_type = 'invoice_issued' THEN
    SELECT a.gross_total, i.currency_code INTO v_amount, v_currency
      FROM sal.invoices i JOIN sal.invoice_amounts a
        ON a.tenant_id = i.tenant_id AND a.company_id = i.company_id AND a.branch_id = i.branch_id AND a.invoice_id = i.id
      WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.source_id AND i.status = 'issued' AND a.deleted_at IS NULL;
    v_ok := FOUND;
  ELSIF NEW.event_type = 'warranty_split_recorded' THEN
    SELECT COALESCE(sum(la.warranty_pay_amount), 0), i.currency_code INTO v_amount, v_currency
      FROM sal.invoices i JOIN sal.invoice_line_amounts la
        ON la.tenant_id = i.tenant_id AND la.company_id = i.company_id AND la.branch_id = i.branch_id AND la.invoice_id = i.id
      WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.source_id AND i.status = 'issued' AND la.deleted_at IS NULL
      GROUP BY i.currency_code;
    v_ok := FOUND;
  ELSIF NEW.event_type = 'receipt_recorded' THEN
    SELECT amount, currency_code INTO v_amount, v_currency FROM sal.receipts
      WHERE tenant_id = NEW.tenant_id AND id = NEW.source_id;
    v_ok := FOUND;
  ELSIF NEW.event_type = 'payment_allocated' THEN
    SELECT amount, currency_code INTO v_amount, v_currency FROM sal.payment_allocations
      WHERE tenant_id = NEW.tenant_id AND id = NEW.source_id;
    v_ok := FOUND;
  ELSIF NEW.event_type = 'credit_note_issued' THEN
    SELECT amount, currency_code INTO v_amount, v_currency FROM sal.credit_notes
      WHERE tenant_id = NEW.tenant_id AND id = NEW.source_id AND approval_state = 'approved';
    v_ok := FOUND;
  ELSIF NEW.event_type = 'receipt_reversed' THEN
    SELECT amount, currency_code INTO v_amount, v_currency FROM sal.receipt_reversals
      WHERE tenant_id = NEW.tenant_id AND id = NEW.source_id AND approval_state = 'approved';
    v_ok := FOUND;
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'sal.financial_events: no authorized % source % for event %', NEW.source_type, NEW.source_id, NEW.event_type
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount <> v_amount THEN
    RAISE EXCEPTION 'sal.financial_events: amount % does not bind the source amount %', NEW.amount, v_amount USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_code <> v_currency THEN
    RAISE EXCEPTION 'sal.financial_events: currency % does not bind the source currency %', NEW.currency_code, v_currency USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_financial_event_provenance() FROM PUBLIC;
CREATE TRIGGER tg_financial_events_provenance BEFORE INSERT ON sal.financial_events
  FOR EACH ROW EXECUTE FUNCTION sal.guard_financial_event_provenance();

ALTER TABLE sal.financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.financial_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_financial_events_gated ON sal.financial_events FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_financial_events_gated ON sal.financial_events FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON sal.financial_events TO app_runtime;
GRANT SELECT ON sal.financial_events TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. Outstanding-balance derivation (never stored). H-fin-1: exclude reversed receipts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.invoice_open_receivable(p_invoice_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_gross numeric(18, 4); v_alloc numeric(18, 4); v_credit numeric(18, 4); v_status text; v_tenant uuid;
BEGIN
  SELECT i.status, i.tenant_id, a.gross_total INTO v_status, v_tenant, v_gross
    FROM sal.invoices i LEFT JOIN sal.invoice_amounts a
      ON a.tenant_id = i.tenant_id AND a.company_id = i.company_id AND a.branch_id = i.branch_id AND a.invoice_id = i.id AND a.deleted_at IS NULL
    WHERE i.id = p_invoice_id;
  IF v_status IS NULL OR v_status IN ('draft', 'void_before_issue') THEN
    RETURN 0;
  END IF;
  v_gross := COALESCE(v_gross, 0);
  SELECT COALESCE(sum(pa.amount), 0) INTO v_alloc
    FROM sal.payment_allocations pa JOIN sal.receipts r
      ON r.tenant_id = pa.tenant_id AND r.company_id = pa.company_id AND r.branch_id = pa.branch_id AND r.id = pa.receipt_id
    WHERE pa.tenant_id = v_tenant AND pa.invoice_id = p_invoice_id AND r.status <> 'reversed';
  SELECT COALESCE(sum(amount), 0) INTO v_credit FROM sal.credit_notes
    WHERE tenant_id = v_tenant AND invoice_id = p_invoice_id AND approval_state = 'approved';
  RETURN round(v_gross - v_alloc - v_credit, 4);
END; $$;
REVOKE EXECUTE ON FUNCTION sal.invoice_open_receivable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.invoice_open_receivable(uuid) TO app_runtime, app_readonly;

CREATE OR REPLACE FUNCTION sal.receipt_unallocated(p_receipt_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_amount numeric(18, 4); v_alloc numeric(18, 4); v_status text; v_tenant uuid;
BEGIN
  SELECT amount, status, tenant_id INTO v_amount, v_status, v_tenant FROM sal.receipts WHERE id = p_receipt_id;
  IF v_amount IS NULL OR v_status = 'reversed' THEN RETURN 0; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_alloc FROM sal.payment_allocations WHERE tenant_id = v_tenant AND receipt_id = p_receipt_id;
  RETURN round(v_amount - v_alloc, 4);
END; $$;
REVOKE EXECUTE ON FUNCTION sal.receipt_unallocated(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.receipt_unallocated(uuid) TO app_runtime, app_readonly;

CREATE OR REPLACE FUNCTION sal.partner_outstanding_balance(p_partner_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_total numeric(18, 4) := 0; r RECORD;
BEGIN
  FOR r IN SELECT id FROM sal.invoices
    WHERE tenant_id = iam.current_tenant_id() AND payer_partner_id = p_partner_id AND status = 'issued' AND deleted_at IS NULL
  LOOP
    v_total := v_total + sal.invoice_open_receivable(r.id);
  END LOOP;
  RETURN round(v_total, 4);
END; $$;
REVOKE EXECUTE ON FUNCTION sal.partner_outstanding_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.partner_outstanding_balance(uuid) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 3. Primitives
-- ----------------------------------------------------------------------------
-- issue_invoice: lock, idempotent, recompute header from lines, allocate the gapless
-- number, emit invoice_issued (+ warranty_split when Σ warranty_pay > 0).
CREATE OR REPLACE FUNCTION sal.issue_invoice(p_invoice_id uuid, p_correlation_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_inv sal.invoices%ROWTYPE; v_seq_code text; v_number text;
  v_net numeric(18, 4); v_tax numeric(18, 4); v_gross numeric(18, 4);
  v_wty numeric(18, 4); v_lines int; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_inv FROM sal.invoices WHERE id = p_invoice_id
    AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sal.issue_invoice: invoice % not found in scope', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.status = 'issued' THEN RETURN v_inv.invoice_number; END IF; -- idempotent (M-fin-3)
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'sal.issue_invoice: invoice is % (only a draft may be issued)', v_inv.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*)::int, COALESCE(sum(la.net_amount), 0), COALESCE(sum(la.tax_amount), 0),
         COALESCE(sum(la.gross_amount), 0), COALESCE(sum(la.warranty_pay_amount), 0)
    INTO v_lines, v_net, v_tax, v_gross, v_wty
    FROM sal.invoice_lines l JOIN sal.invoice_line_amounts la
      ON la.tenant_id = l.tenant_id AND la.company_id = l.company_id AND la.branch_id = l.branch_id AND la.invoice_line_id = l.id
    WHERE l.tenant_id = v_inv.tenant_id AND l.company_id = v_inv.company_id AND l.branch_id = v_inv.branch_id
      AND l.invoice_id = v_inv.id AND l.deleted_at IS NULL AND la.deleted_at IS NULL;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'sal.issue_invoice: cannot issue an invoice with no lines' USING ERRCODE = 'check_violation';
  END IF;
  -- Write/refresh the authoritative header totals (round-then-sum, L-fin-3).
  UPDATE sal.invoice_amounts SET net_total = v_net, tax_total = v_tax, gross_total = round(v_net + v_tax, 4)
    WHERE tenant_id = v_inv.tenant_id AND company_id = v_inv.company_id AND branch_id = v_inv.branch_id
      AND invoice_id = v_inv.id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO sal.invoice_amounts (tenant_id, company_id, branch_id, invoice_id, net_total, tax_total, gross_total, created_by)
      VALUES (v_inv.tenant_id, v_inv.company_id, v_inv.branch_id, v_inv.id, v_net, v_tax, round(v_net + v_tax, 4), v_actor);
  END IF;
  v_gross := round(v_net + v_tax, 4);
  -- Resolve numbering config (M-fin-2); default sequence code 'invoice'.
  SELECT sequence_code INTO v_seq_code FROM sal.invoice_numbering_configs
    WHERE tenant_id = v_inv.tenant_id AND company_id = v_inv.company_id AND status = 'active' AND deleted_at IS NULL;
  v_seq_code := COALESCE(v_seq_code, 'invoice');
  SELECT display_number INTO v_number FROM shared.next_display_number(v_seq_code, v_inv.company_id, v_inv.branch_id);
  UPDATE sal.invoices SET status = 'issued', invoice_number = v_number, issued_at = now()
    WHERE id = v_inv.id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_inv.tenant_id, v_inv.company_id, v_inv.branch_id, 'invoice_issued', 'invoice', v_inv.id, v_inv.currency_code, v_gross, v_actor, p_correlation_id, v_actor);
  IF v_wty > 0 THEN
    INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
      VALUES (v_inv.tenant_id, v_inv.company_id, v_inv.branch_id, 'warranty_split_recorded', 'invoice', v_inv.id, v_inv.currency_code, round(v_wty, 4), v_actor, p_correlation_id, v_actor);
  END IF;
  INSERT INTO sal.invoice_status_history (tenant_id, company_id, branch_id, invoice_id, from_status, to_status, correlation_id, actor_id)
    VALUES (v_inv.tenant_id, v_inv.company_id, v_inv.branch_id, v_inv.id, 'draft', 'issued', p_correlation_id, v_actor);
  RETURN v_number;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.issue_invoice(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.issue_invoice(uuid, uuid) TO app_runtime;

-- record_receipt: allocate a receipt number, insert the receipt, emit receipt_recorded.
CREATE OR REPLACE FUNCTION sal.record_receipt(
  p_company_id uuid, p_branch_id uuid, p_method_id uuid, p_payer_partner_id uuid,
  p_currency_code text, p_amount numeric, p_evidence_document_version_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_existing uuid; v_number text; v_id uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM sal.receipts WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF; -- idempotent (M-fin-3)
  END IF;
  SELECT display_number INTO v_number FROM shared.next_display_number('receipt', p_company_id, p_branch_id);
  INSERT INTO sal.receipts (tenant_id, company_id, branch_id, receipt_number, payment_method_id, payer_partner_id,
    currency_code, amount, received_by, evidence_document_version_id, idempotency_key, created_by)
    VALUES (v_tenant, p_company_id, p_branch_id, v_number, p_method_id, p_payer_partner_id,
      p_currency_code, p_amount, v_actor, p_evidence_document_version_id, p_idempotency_key, v_actor)
    RETURNING id INTO v_id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, idempotency_key, created_by)
    VALUES (v_tenant, p_company_id, p_branch_id, 'receipt_recorded', 'receipt', v_id, p_currency_code, p_amount, v_actor, p_correlation_id, p_idempotency_key, v_actor);
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid) TO app_runtime;

-- allocate_receipt: lock receipt then invoice (order receipts->invoices, H-fin-2),
-- bound by receipt-unallocated and invoice-open, emit payment_allocated.
CREATE OR REPLACE FUNCTION sal.allocate_receipt(p_receipt_id uuid, p_invoice_id uuid, p_amount numeric, p_correlation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_rcpt sal.receipts%ROWTYPE; v_inv sal.invoices%ROWTYPE; v_unalloc numeric(18, 4);
  v_open numeric(18, 4); v_alloc_total numeric(18, 4); v_id uuid; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_rcpt FROM sal.receipts WHERE id = p_receipt_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.allocate_receipt: receipt % not found in scope', p_receipt_id USING ERRCODE = 'no_data_found'; END IF;
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
  INSERT INTO sal.payment_allocations (tenant_id, company_id, branch_id, receipt_id, invoice_id, currency_code, amount, allocated_by, correlation_id, created_by)
    VALUES (v_rcpt.tenant_id, v_rcpt.company_id, v_rcpt.branch_id, p_receipt_id, p_invoice_id, v_rcpt.currency_code, p_amount, v_actor, p_correlation_id, v_actor)
    RETURNING id INTO v_id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rcpt.tenant_id, v_rcpt.company_id, v_rcpt.branch_id, 'payment_allocated', 'payment_allocation', v_id, v_rcpt.currency_code, p_amount, v_actor, p_correlation_id, v_actor);
  SELECT COALESCE(sum(amount), 0) INTO v_alloc_total FROM sal.payment_allocations WHERE tenant_id = v_rcpt.tenant_id AND receipt_id = p_receipt_id;
  UPDATE sal.receipts SET status = CASE WHEN v_alloc_total >= v_rcpt.amount THEN 'allocated' ELSE 'partially_allocated' END
    WHERE id = p_receipt_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid) TO app_runtime;

-- approve_credit_note: lock the invoice (H-fin-2), enforce credit <= open, approve, emit.
CREATE OR REPLACE FUNCTION sal.approve_credit_note(p_credit_id uuid, p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_cn sal.credit_notes%ROWTYPE; v_open numeric(18, 4); v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_cn FROM sal.credit_notes WHERE id = p_credit_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_credit_note: credit note % not found in scope', p_credit_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_cn.approval_state = 'approved' THEN RETURN; END IF; -- idempotent
  IF v_cn.approval_state <> 'pending' THEN RAISE EXCEPTION 'sal.approve_credit_note: credit note is %', v_cn.approval_state USING ERRCODE = 'check_violation'; END IF;
  PERFORM 1 FROM sal.invoices WHERE id = v_cn.invoice_id AND tenant_id = v_cn.tenant_id
    AND company_id = v_cn.company_id AND branch_id = v_cn.branch_id FOR UPDATE;
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

-- approve_receipt_reversal: lock the receipt, flip to reversed, approve, emit.
CREATE OR REPLACE FUNCTION sal.approve_receipt_reversal(p_reversal_id uuid, p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rev sal.receipt_reversals%ROWTYPE; v_rcpt sal.receipts%ROWTYPE; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_rev FROM sal.receipt_reversals WHERE id = p_reversal_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: reversal % not found in scope', p_reversal_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_rev.approval_state = 'approved' THEN RETURN; END IF; -- idempotent
  IF v_rev.approval_state <> 'pending' THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: reversal is %', v_rev.approval_state USING ERRCODE = 'check_violation'; END IF;
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
-- 4. Completeness constraint triggers (H-fin-3): exactly one event per command.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.guard_event_completeness()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_type text; v_needed boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    v_needed := (NEW.status = 'issued'); v_type := 'invoice_issued';
  ELSIF TG_TABLE_NAME = 'receipts' THEN
    v_needed := true; v_type := 'receipt_recorded';
  ELSIF TG_TABLE_NAME = 'payment_allocations' THEN
    v_needed := true; v_type := 'payment_allocated';
  ELSIF TG_TABLE_NAME = 'credit_notes' THEN
    v_needed := (NEW.approval_state = 'approved'); v_type := 'credit_note_issued';
  ELSIF TG_TABLE_NAME = 'receipt_reversals' THEN
    v_needed := (NEW.approval_state = 'approved'); v_type := 'receipt_reversed';
  END IF;
  IF v_needed AND NOT EXISTS (
    SELECT 1 FROM sal.financial_events fe
    WHERE fe.tenant_id = NEW.tenant_id AND fe.source_id = NEW.id AND fe.event_type = v_type
  ) THEN
    RAISE EXCEPTION 'sal.%: financial command produced no % event (completeness)', TG_TABLE_NAME, v_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_event_completeness() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER tg_invoices_event_completeness AFTER UPDATE ON sal.invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'issued') EXECUTE FUNCTION sal.guard_event_completeness();
CREATE CONSTRAINT TRIGGER tg_receipts_event_completeness AFTER INSERT ON sal.receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sal.guard_event_completeness();
CREATE CONSTRAINT TRIGGER tg_payment_allocations_event_completeness AFTER INSERT ON sal.payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sal.guard_event_completeness();
CREATE CONSTRAINT TRIGGER tg_credit_notes_event_completeness AFTER UPDATE ON sal.credit_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.approval_state = 'approved') EXECUTE FUNCTION sal.guard_event_completeness();
CREATE CONSTRAINT TRIGGER tg_receipt_reversals_event_completeness AFTER UPDATE ON sal.receipt_reversals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.approval_state = 'approved') EXECUTE FUNCTION sal.guard_event_completeness();
