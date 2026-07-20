-- ============================================================================
-- Phase 1-11 — sal invoices (P1-11-DB-001/002/003/004)
-- Invoice master + restricted amount detail, immutable lines + restricted line
-- amounts, per-tenant numbering configuration, and append-only status history.
--
-- Rollback classification: ROLL-FORWARD-ONLY once any invoice exists (financial).
--
-- Binding design amendments implemented here (see phase-1-11-design.md §19):
--   * H-fin-5 — invoice_number/issued_at only appear at the draft->issued transition
--     (ck_invoices_number_iff_issued) and freeze thereafter.
--   * H-priv-1 — money lives in restricted 1:1 detail tables (sal.invoice_amounts,
--     sal.invoice_line_amounts) gated by iam.has_permission('sal.finance.view');
--     the base invoice/line rows are branch-scoped structural rows only.
--   * M-fin-1 — invoices.status stores lifecycle only (draft/issued/credited/
--     void_before_issue); paid/partially_paid are DERIVED (Wave 3), never stored.
--   * L-fin-1/L-fin-3 — header totals reconcile to the immutable line amounts by a
--     deferred constraint trigger using round-then-sum; never skipped for an issued
--     invoice with gross_total <> 0.
-- Final red-team hardening (raw-DML paths, since app_runtime holds INSERT/UPDATE here):
--   * H-fin-3 — invoices are BORN DRAFT (guard_invoice_freeze on INSERT); a raw born-'issued'
--     row cannot bypass shared.next_display_number or the invoice_issued completeness event.
--   * H-fin-2 — issued-invoice header totals freeze (guard_invoice_amount_frozen), symmetric
--     to the line-amount freeze; a raw post-issue UPDATE of net/tax/gross is rejected.
--   * L-fin-4 — a line-amount's denormalized invoice_id must equal its parent line's invoice_id.
-- The issue primitive, financial-event emission, and completeness triggers live in
-- 20260724093000 (after sal.financial_events exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sal.invoices — branch-scoped master (structural; amounts are in 1:1 detail)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.invoices (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  company_id            uuid NOT NULL,
  branch_id             uuid NOT NULL,
  work_order_id         uuid NOT NULL,
  quotation_revision_id uuid NULL,
  payer_partner_id      uuid NOT NULL,
  currency_code         text NOT NULL,
  status                text NOT NULL DEFAULT 'draft',
  invoice_number        text NULL,
  issued_at             timestamptz NULL,
  idempotency_key       text NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_invoices PRIMARY KEY (id),
  CONSTRAINT uq_invoices_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_quotation_revision FOREIGN KEY (tenant_id, company_id, branch_id, quotation_revision_id)
    REFERENCES quo.quotation_revisions (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_payer FOREIGN KEY (tenant_id, payer_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_invoices_status CHECK (status IN ('draft', 'issued', 'credited', 'void_before_issue')),
  -- H-fin-5: a number and issue timestamp appear only once issued; never on draft/void.
  CONSTRAINT ck_invoices_number_iff_issued
    CHECK ((invoice_number IS NULL AND issued_at IS NULL) = (status IN ('draft', 'void_before_issue')))
);
COMMENT ON TABLE sal.invoices IS 'Phase 1-11 invoice master (branch-scoped, structural). Money is in the restricted sal.invoice_amounts 1:1 detail (H-priv-1). One live invoice per work order (uq_invoices_work_order_active). status is lifecycle only; payment state is derived (M-fin-1). Roll-forward-only.';

-- One live (non-void) invoice per work order (FR-SAL-001).
CREATE UNIQUE INDEX uq_invoices_work_order_active ON sal.invoices (tenant_id, company_id, branch_id, work_order_id)
  WHERE status <> 'void_before_issue' AND deleted_at IS NULL;
-- Issued numbers are unique in scope.
CREATE UNIQUE INDEX uq_invoices_number ON sal.invoices (tenant_id, company_id, branch_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
-- Idempotency business key (BR-SAL-001).
CREATE UNIQUE INDEX uq_invoices_idempotency ON sal.invoices (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- FK covers + query families.
CREATE INDEX ix_invoices_work_order ON sal.invoices (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_invoices_quotation_revision ON sal.invoices (tenant_id, company_id, branch_id, quotation_revision_id);
CREATE INDEX ix_invoices_payer ON sal.invoices (tenant_id, payer_partner_id);
CREATE INDEX ix_invoices_currency ON sal.invoices (currency_code);
CREATE INDEX ix_invoices_status ON sal.invoices (tenant_id, company_id, branch_id, status);
CREATE INDEX ix_invoices_payer_status ON sal.invoices (tenant_id, payer_partner_id, status);

-- Freeze guard: a non-draft invoice's identity and issue facts are immutable; status
-- advances forward only (draft->issued|void_before_issue; issued->credited; terminal
-- credited/void_before_issue). On INSERT an invoice is BORN DRAFT with no identity
-- (H-fin-3 hardening): the number/issued_at and the 'issued' status appear only at the
-- draft->issued transition inside sal.issue_invoice. Because app_runtime holds raw INSERT
-- on this table, a direct INSERT of a born-'issued' row would otherwise bypass the gapless
-- shared.next_display_number allocator AND the invoice_issued completeness event; this gate
-- closes both.
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
       OR NEW.work_order_id <> OLD.work_order_id
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
CREATE TRIGGER tg_invoices_freeze BEFORE INSERT OR UPDATE ON sal.invoices FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_freeze();
CREATE TRIGGER tg_invoices_touch_metadata BEFORE UPDATE ON sal.invoices FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_invoices_immutable BEFORE UPDATE ON sal.invoices
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'created_at', 'created_by');

ALTER TABLE sal.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.invoices FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_invoices_scope ON sal.invoices FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_invoices_scope ON sal.invoices FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_invoices_scope ON sal.invoices FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON sal.invoices TO app_runtime;
GRANT SELECT ON sal.invoices TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. sal.invoice_amounts — RESTRICTED 1:1 header totals (gated sal.finance.view)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.invoice_amounts (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  invoice_id     uuid NOT NULL,
  net_total      numeric(18, 4) NOT NULL,
  tax_total      numeric(18, 4) NOT NULL,
  gross_total    numeric(18, 4) NOT NULL,
  classification text NOT NULL DEFAULT 'restricted',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_invoice_amounts PRIMARY KEY (id),
  CONSTRAINT fk_invoice_amounts_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_amounts_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_invoice_amounts_nonneg CHECK (net_total >= 0 AND tax_total >= 0 AND gross_total >= 0),
  CONSTRAINT ck_invoice_amounts_gross CHECK (gross_total = round(net_total + tax_total, 4)),
  CONSTRAINT ck_invoice_amounts_classification CHECK (classification = 'restricted')
);
COMMENT ON TABLE sal.invoice_amounts IS 'Phase 1-11 RESTRICTED 1:1 invoice header totals. Every policy gated by iam.has_permission(''sal.finance.view'') (H-priv-1). gross=net+tax. Reconciled to lines by tg_invoice_line_amounts_reconcile. Roll-forward-only.';
CREATE UNIQUE INDEX uq_invoice_amounts_invoice ON sal.invoice_amounts (tenant_id, company_id, branch_id, invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_invoice_amounts_invoice ON sal.invoice_amounts (tenant_id, company_id, branch_id, invoice_id); -- non-partial FK cover
CREATE TRIGGER tg_invoice_amounts_touch_metadata BEFORE UPDATE ON sal.invoice_amounts FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_invoice_amounts_immutable BEFORE UPDATE ON sal.invoice_amounts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'invoice_id', 'classification', 'created_at', 'created_by');
-- Freeze the header totals once the parent invoice leaves draft (H-fin-2 hardening,
-- symmetric to sal.guard_invoice_line_amount_frozen on the line amounts). The generic
-- immutable guard above does NOT cover net/tax/gross, and the deferred reconcile trigger
-- fires only on invoice_line_amounts DML — so without this a finance user could raw-UPDATE
-- an issued invoice's totals (moving the derived open receivable and desyncing from the
-- frozen lines and the invoice_issued event). sal.issue_invoice writes these totals WHILE
-- the invoice is still draft (before flipping to issued), so the primitive path is unaffected.
CREATE OR REPLACE FUNCTION sal.guard_invoice_amount_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM sal.invoices
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.invoice_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'sal.invoice_amounts: parent invoice % not found in scope', NEW.invoice_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'sal.invoice_amounts: parent invoice is % (not draft); header totals are frozen', v_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_amount_frozen() FROM PUBLIC;
CREATE TRIGGER tg_invoice_amounts_frozen BEFORE INSERT OR UPDATE ON sal.invoice_amounts FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_amount_frozen();
ALTER TABLE sal.invoice_amounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.invoice_amounts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_invoice_amounts_gated ON sal.invoice_amounts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_invoice_amounts_gated ON sal.invoice_amounts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_invoice_amounts_gated ON sal.invoice_amounts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'));
GRANT SELECT, INSERT, UPDATE ON sal.invoice_amounts TO app_runtime;
GRANT SELECT ON sal.invoice_amounts TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. sal.invoice_lines — immutable-once-issued structural lines (amounts in detail)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.invoice_lines (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  branch_id     uuid NOT NULL,
  invoice_id    uuid NOT NULL,
  line_number   integer NOT NULL,
  line_type     text NOT NULL,
  quantity      numeric(12, 3) NOT NULL,
  tax_class_id  uuid NULL,
  currency_code text NOT NULL,
  source_service_line_id   uuid NULL,
  source_part_issue_id     uuid NULL,
  source_quotation_item_id uuid NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_invoice_lines PRIMARY KEY (id),
  CONSTRAINT uq_invoice_lines_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT uq_invoice_lines_number UNIQUE (tenant_id, company_id, branch_id, invoice_id, line_number),
  CONSTRAINT fk_invoice_lines_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_lines_tax_class FOREIGN KEY (tenant_id, company_id, tax_class_id)
    REFERENCES org.tax_classes (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_lines_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_invoice_lines_line_type CHECK (line_type IN ('service', 'part', 'fee')),
  CONSTRAINT ck_invoice_lines_quantity CHECK (quantity > 0),
  CONSTRAINT ck_invoice_lines_line_number CHECK (line_number >= 1)
);
COMMENT ON TABLE sal.invoice_lines IS 'Phase 1-11 invoice line (structural). Amounts + payer split are in the restricted sal.invoice_line_amounts 1:1 detail (H-priv-1). Frozen once the parent invoice is issued. Roll-forward-only.';
CREATE INDEX ix_invoice_lines_invoice ON sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id);
CREATE INDEX ix_invoice_lines_tax_class ON sal.invoice_lines (tenant_id, company_id, tax_class_id);
CREATE INDEX ix_invoice_lines_currency ON sal.invoice_lines (currency_code);

-- Line freeze: no INSERT/UPDATE of a line once its parent invoice has left draft.
CREATE OR REPLACE FUNCTION sal.guard_invoice_line_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM sal.invoices
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.invoice_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'sal.invoice_lines: parent invoice % not found in scope', NEW.invoice_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'sal.invoice_lines: parent invoice is % (not draft); lines are frozen', v_status USING ERRCODE = 'check_violation';
  END IF;
  -- currency coherence with the header
  IF NOT EXISTS (SELECT 1 FROM sal.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id
                   AND i.branch_id = NEW.branch_id AND i.id = NEW.invoice_id AND i.currency_code = NEW.currency_code) THEN
    RAISE EXCEPTION 'sal.invoice_lines: line currency must match the invoice header currency' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_line_frozen() FROM PUBLIC;
CREATE TRIGGER tg_invoice_lines_frozen BEFORE INSERT OR UPDATE ON sal.invoice_lines FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_line_frozen();
CREATE TRIGGER tg_invoice_lines_touch_metadata BEFORE UPDATE ON sal.invoice_lines FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_invoice_lines_immutable BEFORE UPDATE ON sal.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'invoice_id', 'created_at', 'created_by');

ALTER TABLE sal.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.invoice_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_invoice_lines_scope ON sal.invoice_lines FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_invoice_lines_scope ON sal.invoice_lines FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_invoice_lines_scope ON sal.invoice_lines FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON sal.invoice_lines TO app_runtime;
GRANT SELECT ON sal.invoice_lines TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. sal.invoice_line_amounts — RESTRICTED 1:1 line money + payer split (gated)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.invoice_line_amounts (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  company_id          uuid NOT NULL,
  branch_id           uuid NOT NULL,
  invoice_line_id     uuid NOT NULL,
  invoice_id          uuid NOT NULL,
  unit_price          numeric(18, 4) NOT NULL,
  net_amount          numeric(18, 4) NOT NULL,
  tax_amount          numeric(18, 4) NOT NULL,
  gross_amount        numeric(18, 4) NOT NULL,
  customer_pay_amount numeric(18, 4) NOT NULL,
  warranty_pay_amount numeric(18, 4) NOT NULL,
  classification text NOT NULL DEFAULT 'restricted',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_invoice_line_amounts PRIMARY KEY (id),
  CONSTRAINT fk_invoice_line_amounts_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_line_amounts_line FOREIGN KEY (tenant_id, company_id, branch_id, invoice_line_id)
    REFERENCES sal.invoice_lines (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_line_amounts_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_invoice_line_amounts_nonneg
    CHECK (unit_price >= 0 AND net_amount >= 0 AND tax_amount >= 0 AND gross_amount >= 0
           AND customer_pay_amount >= 0 AND warranty_pay_amount >= 0),
  CONSTRAINT ck_invoice_line_amounts_gross CHECK (gross_amount = round(net_amount + tax_amount, 4)),
  -- FR-WTY-004: every line carries one unambiguous payer allocation.
  CONSTRAINT ck_invoice_line_amounts_payer_split CHECK (customer_pay_amount + warranty_pay_amount = gross_amount),
  CONSTRAINT ck_invoice_line_amounts_classification CHECK (classification = 'restricted')
);
COMMENT ON TABLE sal.invoice_line_amounts IS 'Phase 1-11 RESTRICTED 1:1 invoice-line money + customer/warranty payer split. Gated by iam.has_permission(''sal.finance.view'') (H-priv-1). gross=net+tax; customer_pay+warranty_pay=gross (FR-WTY-004). Roll-forward-only.';
CREATE UNIQUE INDEX uq_invoice_line_amounts_line ON sal.invoice_line_amounts (tenant_id, company_id, branch_id, invoice_line_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_invoice_line_amounts_line ON sal.invoice_line_amounts (tenant_id, company_id, branch_id, invoice_line_id); -- non-partial FK cover
CREATE INDEX ix_invoice_line_amounts_invoice ON sal.invoice_line_amounts (tenant_id, company_id, branch_id, invoice_id);

-- Freeze line amounts once the parent invoice leaves draft.
CREATE OR REPLACE FUNCTION sal.guard_invoice_line_amount_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM sal.invoices
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.invoice_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'sal.invoice_line_amounts: parent invoice % not found in scope', NEW.invoice_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'sal.invoice_line_amounts: parent invoice is % (not draft); line amounts are frozen', v_status USING ERRCODE = 'check_violation';
  END IF;
  -- L-fin-4 hardening: the denormalized invoice_id must equal the parent line's own
  -- invoice_id, else issue_invoice (which sums by the line's invoice_id) and the deferred
  -- reconcile trigger (which sums by this row's invoice_id) diverge. Closes a mis-parented
  -- line-amount between two draft invoices under a raw finance-role INSERT.
  IF NOT EXISTS (SELECT 1 FROM sal.invoice_lines l
                  WHERE l.tenant_id = NEW.tenant_id AND l.company_id = NEW.company_id AND l.branch_id = NEW.branch_id
                    AND l.id = NEW.invoice_line_id AND l.invoice_id = NEW.invoice_id) THEN
    RAISE EXCEPTION 'sal.invoice_line_amounts: invoice_line_id % does not belong to invoice_id %', NEW.invoice_line_id, NEW.invoice_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_line_amount_frozen() FROM PUBLIC;
CREATE TRIGGER tg_invoice_line_amounts_frozen BEFORE INSERT OR UPDATE ON sal.invoice_line_amounts FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_line_amount_frozen();
CREATE TRIGGER tg_invoice_line_amounts_touch_metadata BEFORE UPDATE ON sal.invoice_line_amounts FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_invoice_line_amounts_immutable BEFORE UPDATE ON sal.invoice_line_amounts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'invoice_line_id', 'invoice_id', 'classification', 'created_at', 'created_by');

-- Deferred header<->lines reconciliation (L-fin-1: never skipped for an issued invoice
-- with gross <> 0). Runs at COMMIT so all lines + header exist. Only enforced once the
-- invoice is issued (a draft is still being assembled).
CREATE OR REPLACE FUNCTION sal.guard_invoice_totals_reconcile()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_row RECORD;
  v_net numeric(18, 4); v_tax numeric(18, 4); v_gross numeric(18, 4);
  v_hnet numeric(18, 4); v_htax numeric(18, 4); v_hgross numeric(18, 4); v_status text;
BEGIN
  v_row := COALESCE(NEW, OLD);
  SELECT status INTO v_status FROM sal.invoices
    WHERE tenant_id = v_row.tenant_id AND company_id = v_row.company_id AND branch_id = v_row.branch_id AND id = v_row.invoice_id;
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN NULL; -- draft assembly or teardown; reconciliation is enforced at issue and for issued invoices only
  END IF;
  SELECT COALESCE(sum(net_amount), 0), COALESCE(sum(tax_amount), 0), COALESCE(sum(gross_amount), 0)
    INTO v_net, v_tax, v_gross FROM sal.invoice_line_amounts
    WHERE tenant_id = v_row.tenant_id AND company_id = v_row.company_id AND branch_id = v_row.branch_id
      AND invoice_id = v_row.invoice_id AND deleted_at IS NULL;
  SELECT net_total, tax_total, gross_total INTO v_hnet, v_htax, v_hgross FROM sal.invoice_amounts
    WHERE tenant_id = v_row.tenant_id AND company_id = v_row.company_id AND branch_id = v_row.branch_id
      AND invoice_id = v_row.invoice_id AND deleted_at IS NULL;
  IF v_hgross IS NULL THEN
    RAISE EXCEPTION 'sal.invoice_line_amounts: issued invoice % has no header amount row', v_row.invoice_id USING ERRCODE = 'check_violation';
  END IF;
  IF v_hnet <> v_net OR v_htax <> v_tax OR v_hgross <> v_gross THEN
    RAISE EXCEPTION 'sal.invoice_line_amounts: header totals (net %, tax %, gross %) do not reconcile to lines (net %, tax %, gross %)',
      v_hnet, v_htax, v_hgross, v_net, v_tax, v_gross USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_invoice_totals_reconcile() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER tg_invoice_line_amounts_reconcile
  AFTER INSERT OR UPDATE OR DELETE ON sal.invoice_line_amounts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sal.guard_invoice_totals_reconcile();

ALTER TABLE sal.invoice_line_amounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.invoice_line_amounts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_invoice_line_amounts_gated ON sal.invoice_line_amounts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_invoice_line_amounts_gated ON sal.invoice_line_amounts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_invoice_line_amounts_gated ON sal.invoice_line_amounts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'));
GRANT SELECT, INSERT, UPDATE ON sal.invoice_line_amounts TO app_runtime;
GRANT SELECT ON sal.invoice_line_amounts TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. sal.invoice_numbering_configs — per (tenant, company) numbering mode (P1-OD-042)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.invoice_numbering_configs (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  mode          text NOT NULL DEFAULT 'gapless',
  sequence_code text NOT NULL DEFAULT 'invoice',
  status        text NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_invoice_numbering_configs PRIMARY KEY (id),
  CONSTRAINT fk_invoice_numbering_configs_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_numbering_configs_company FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_invoice_numbering_configs_mode CHECK (mode IN ('gapless', 'gapped')),
  CONSTRAINT ck_invoice_numbering_configs_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_invoice_numbering_configs_sequence_code CHECK (sequence_code ~ '^[a-z][a-z0-9_]{1,62}$')
);
COMMENT ON TABLE sal.invoice_numbering_configs IS 'Phase 1-11 per (tenant, company) invoice numbering configuration (P1-OD-042 open decision, held as configuration). mode documents the legal posture; both modes use the rollback-safe shared.next_display_number allocator (M-fin-2). One active config per company.';
CREATE UNIQUE INDEX uq_invoice_numbering_configs_active ON sal.invoice_numbering_configs (tenant_id, company_id)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX ix_invoice_numbering_configs_company ON sal.invoice_numbering_configs (tenant_id, company_id);
CREATE TRIGGER tg_invoice_numbering_configs_touch_metadata BEFORE UPDATE ON sal.invoice_numbering_configs FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_invoice_numbering_configs_immutable BEFORE UPDATE ON sal.invoice_numbering_configs
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'created_at', 'created_by');
ALTER TABLE sal.invoice_numbering_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.invoice_numbering_configs FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_invoice_numbering_configs_scope ON sal.invoice_numbering_configs FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY ins_invoice_numbering_configs_scope ON sal.invoice_numbering_configs FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY upd_invoice_numbering_configs_scope ON sal.invoice_numbering_configs FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
GRANT SELECT, INSERT, UPDATE ON sal.invoice_numbering_configs TO app_runtime;
GRANT SELECT ON sal.invoice_numbering_configs TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. sal.invoice_status_history — append-only ledger
-- ----------------------------------------------------------------------------
CREATE TABLE sal.invoice_status_history (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  invoice_id     uuid NOT NULL,
  from_status    text NULL,
  to_status      text NOT NULL,
  reason         text NULL,
  correlation_id uuid NULL,
  actor_id       uuid NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  seq            bigint GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_invoice_status_history PRIMARY KEY (id),
  CONSTRAINT fk_invoice_status_history_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_status_history_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_invoice_status_history_to_status
    CHECK (to_status IN ('draft', 'issued', 'partially_paid', 'paid', 'credited', 'void_before_issue'))
);
COMMENT ON TABLE sal.invoice_status_history IS 'Phase 1-11 append-only invoice status ledger (SELECT+INSERT only). Records lifecycle and derived payment milestones (partially_paid/paid may be recorded by the backend from the derived balance). actor_id/occurred_at server-stamped. Roll-forward-only.';
CREATE INDEX ix_invoice_status_history_invoice ON sal.invoice_status_history (tenant_id, company_id, branch_id, invoice_id, occurred_at DESC, seq DESC);
CREATE TRIGGER tg_invoice_status_history_stamp BEFORE INSERT ON sal.invoice_status_history FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();
ALTER TABLE sal.invoice_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.invoice_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_invoice_status_history_scope ON sal.invoice_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_invoice_status_history_scope ON sal.invoice_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON sal.invoice_status_history TO app_runtime;
GRANT SELECT ON sal.invoice_status_history TO app_readonly;
