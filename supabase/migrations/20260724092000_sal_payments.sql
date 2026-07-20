-- ============================================================================
-- Phase 1-11 — sal payments (P1-11-DB-005/006/008)
-- Payment methods (dual-scope reference), receipts (amount whole-row gated by
-- sal.finance.view), append-only payment allocations, credit notes, and
-- full-receipt reversals with server-stamped dual control.
--
-- Rollback classification: ROLL-FORWARD-ONLY once any receipt exists (financial).
--
-- Binding design amendments implemented here (phase-1-11-design.md §19):
--   * H-priv-1 — receipts/allocations/credit_notes/receipt_reversals carry amounts on
--     the row and gate the WHOLE ROW behind iam.has_permission('sal.finance.view').
--   * H-fin-1 — full-receipt reversal only; receipts gain a 'reversed' status; the
--     outstanding-balance derivation (093000) excludes allocations of reversed receipts.
--   * H-fin-4 — receipt amount/method/payer/currency/received_at freeze once recorded.
--   * H-fin-6 — dual-control requested_by/approved_by are SERVER-STAMPED to the acting
--     user (never client-supplied) with an immutable maker<>approver guarantee.
--   * M-fin-4 — credit_note.currency = invoice.currency; reversal.currency = receipt.currency.
--   * M-fin-5 — composite scoped FKs reference the child's own (tenant,company,branch).
-- The event-emitting primitives (record/allocate/approve/reverse) + completeness
-- constraint triggers live in 20260724093000 (after sal.financial_events exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sal.payment_methods — dual-scope reference (platform + tenant); no gateways
-- ----------------------------------------------------------------------------
CREATE TABLE sal.payment_methods (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  scope       text NOT NULL,
  tenant_id   uuid NULL,
  method_code text NOT NULL,
  kind        text NOT NULL,
  display_name text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_payment_methods PRIMARY KEY (id),
  CONSTRAINT uq_payment_methods_scope_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_payment_methods_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_payment_methods_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_payment_methods_scope_tenant
    CHECK ((scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)),
  -- ASM-14 / CON-04: cash, card terminal, bank transfer only. No online gateway/settlement.
  CONSTRAINT ck_payment_methods_kind CHECK (kind IN ('cash', 'card_terminal', 'bank_transfer')),
  CONSTRAINT ck_payment_methods_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_payment_methods_code CHECK (method_code ~ '^[a-z][a-z0-9_]{1,62}$')
);
COMMENT ON TABLE sal.payment_methods IS 'Phase 1-11 dual-scope payment-method reference (platform structural rows cash/card_terminal/bank_transfer + tenant rows). No online payment gateway/settlement types (ASM-14, CON-04).';
CREATE UNIQUE INDEX uq_payment_methods_platform_code ON sal.payment_methods (method_code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_payment_methods_tenant_code ON sal.payment_methods (tenant_id, method_code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE INDEX ix_payment_methods_tenant ON sal.payment_methods (tenant_id);
CREATE TRIGGER tg_payment_methods_touch_metadata BEFORE UPDATE ON sal.payment_methods FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_payment_methods_immutable BEFORE UPDATE ON sal.payment_methods
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('scope', 'tenant_id', 'created_at', 'created_by');
ALTER TABLE sal.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.payment_methods FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_payment_methods_scope ON sal.payment_methods FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_payment_methods_tenant ON sal.payment_methods FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_payment_methods_tenant ON sal.payment_methods FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON sal.payment_methods TO app_runtime;
GRANT SELECT ON sal.payment_methods TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. sal.receipts — branch-scoped; amount on the row, WHOLE ROW gated (finance)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.receipts (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  receipt_number text NOT NULL,
  payment_method_id uuid NOT NULL,
  payer_partner_id  uuid NOT NULL,
  currency_code  text NOT NULL,
  amount         numeric(18, 4) NOT NULL,
  received_by    uuid NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  evidence_document_version_id uuid NULL,
  status         text NOT NULL DEFAULT 'recorded',
  idempotency_key text NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_receipts PRIMARY KEY (id),
  CONSTRAINT uq_receipts_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT uq_receipts_number UNIQUE (tenant_id, company_id, branch_id, receipt_number),
  CONSTRAINT fk_receipts_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_method FOREIGN KEY (tenant_id, payment_method_id)
    REFERENCES sal.payment_methods (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_payer FOREIGN KEY (tenant_id, payer_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_evidence FOREIGN KEY (tenant_id, evidence_document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_receipts_amount CHECK (amount > 0),
  CONSTRAINT ck_receipts_status CHECK (status IN ('recorded', 'partially_allocated', 'allocated', 'reversed'))
);
COMMENT ON TABLE sal.receipts IS 'Phase 1-11 receipt (branch-scoped). WHOLE ROW gated by iam.has_permission(''sal.finance.view'') (H-priv-1). amount/method/payer/currency/received_at freeze once recorded (H-fin-4). Full-receipt reversal flips status to reversed (H-fin-1). Roll-forward-only.';
CREATE UNIQUE INDEX uq_receipts_idempotency ON sal.receipts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_receipts_method ON sal.receipts (tenant_id, payment_method_id);
CREATE INDEX ix_receipts_payer ON sal.receipts (tenant_id, payer_partner_id);
CREATE INDEX ix_receipts_currency ON sal.receipts (currency_code);
CREATE INDEX ix_receipts_evidence ON sal.receipts (tenant_id, evidence_document_version_id);
CREATE INDEX ix_receipts_payer_date ON sal.receipts (tenant_id, company_id, branch_id, payer_partner_id, received_at DESC);

-- H-fin-4: freeze the money-bearing facts once recorded; only status may advance.
CREATE OR REPLACE FUNCTION sal.guard_receipt_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.amount <> OLD.amount OR NEW.currency_code <> OLD.currency_code
     OR NEW.payment_method_id <> OLD.payment_method_id OR NEW.payer_partner_id <> OLD.payer_partner_id
     OR NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.receipt_number <> OLD.receipt_number THEN
    RAISE EXCEPTION 'sal.receipts: a recorded receipt''s amount/method/payer/currency/received_at/number are frozen (corrections via reversal only)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'reversed' THEN
      RAISE EXCEPTION 'sal.receipts: reversed is terminal' USING ERRCODE = 'check_violation';
    END IF;
    -- H-fin-1 hardening: a receipt may reach 'reversed' ONLY through an approved
    -- sal.receipt_reversals row (i.e. only via sal.approve_receipt_reversal). app_runtime
    -- holds raw UPDATE here, so without this a finance user could flip status to 'reversed'
    -- directly — silently unwinding a payment (the derivation drops reversed-receipt
    -- allocations, so a paid invoice re-opens) with no reversal record, no maker<>approver
    -- dual control, and no receipt_reversed financial event. A raw INSERT into
    -- receipt_reversals is born 'pending' (stamp_dual_control_maker) and can only become
    -- 'approved' through the dual-control approval guard, so this gate cannot be forged.
    IF NEW.status = 'reversed' THEN
      IF NOT EXISTS (
        SELECT 1 FROM sal.receipt_reversals rr
         WHERE rr.tenant_id = NEW.tenant_id AND rr.company_id = NEW.company_id
           AND rr.branch_id = NEW.branch_id AND rr.original_receipt_id = NEW.id
           AND rr.approval_state = 'approved'
      ) THEN
        RAISE EXCEPTION 'sal.receipts: a receipt may be reversed only via an approved receipt reversal (sal.approve_receipt_reversal)'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_receipt_freeze() FROM PUBLIC;
CREATE TRIGGER tg_receipts_freeze BEFORE UPDATE ON sal.receipts FOR EACH ROW EXECUTE FUNCTION sal.guard_receipt_freeze();
CREATE TRIGGER tg_receipts_touch_metadata BEFORE UPDATE ON sal.receipts FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_receipts_immutable BEFORE UPDATE ON sal.receipts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'created_at', 'created_by');

ALTER TABLE sal.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.receipts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_receipts_gated ON sal.receipts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_receipts_gated ON sal.receipts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_receipts_gated ON sal.receipts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'));
GRANT SELECT, INSERT, UPDATE ON sal.receipts TO app_runtime;
GRANT SELECT ON sal.receipts TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. sal.payment_allocations — append-only; composite scoped FKs (own scope)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.payment_allocations (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  receipt_id     uuid NOT NULL,
  invoice_id     uuid NOT NULL,
  currency_code  text NOT NULL,
  amount         numeric(18, 4) NOT NULL,
  allocated_by   uuid NOT NULL,
  allocated_at   timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NULL,
  seq            bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,

  CONSTRAINT pk_payment_allocations PRIMARY KEY (id),
  CONSTRAINT fk_payment_allocations_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_receipt FOREIGN KEY (tenant_id, company_id, branch_id, receipt_id)
    REFERENCES sal.receipts (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_allocations_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_payment_allocations_amount CHECK (amount > 0)
);
COMMENT ON TABLE sal.payment_allocations IS 'Phase 1-11 append-only receipt->invoice allocation (SELECT+INSERT only). WHOLE ROW gated by sal.finance.view. Composite scoped FKs force same-branch receipt+invoice (M-fin-5). Σ active allocations + unallocated = receipt amount (BR-SAL-002); reversed receipts excluded from the derivation. Roll-forward-only.';
CREATE INDEX ix_payment_allocations_receipt ON sal.payment_allocations (tenant_id, company_id, branch_id, receipt_id);
CREATE INDEX ix_payment_allocations_invoice ON sal.payment_allocations (tenant_id, company_id, branch_id, invoice_id);
CREATE INDEX ix_payment_allocations_currency ON sal.payment_allocations (currency_code);
ALTER TABLE sal.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.payment_allocations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_payment_allocations_gated ON sal.payment_allocations FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_payment_allocations_gated ON sal.payment_allocations FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON sal.payment_allocations TO app_runtime;
GRANT SELECT ON sal.payment_allocations TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. Server-stamped dual control (H-fin-6): shared by credit_notes + receipt_reversals
-- ----------------------------------------------------------------------------
-- BEFORE INSERT: force requested_by := iam.current_user_id() (ignore client input).
CREATE OR REPLACE FUNCTION sal.stamp_dual_control_maker()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.requested_by := iam.current_user_id();
  IF NEW.requested_by IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (requested_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.approved_by := NULL;
  NEW.approved_at := NULL;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.stamp_dual_control_maker() FROM PUBLIC;

-- BEFORE UPDATE: on transition to 'approved', force approved_by := current user and
-- reject self-approval; the approved snapshot then freezes.
CREATE OR REPLACE FUNCTION sal.guard_dual_control_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.approval_state = 'pending' AND NEW.approval_state = 'approved' THEN
    NEW.approved_by := iam.current_user_id();
    NEW.approved_at := now();
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'dual control: no user context (approved_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.approved_by = NEW.requested_by THEN
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

-- ----------------------------------------------------------------------------
-- 5. sal.credit_notes — invoice-linked, dual control, currency = invoice
-- ----------------------------------------------------------------------------
CREATE TABLE sal.credit_notes (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  invoice_id     uuid NOT NULL,
  currency_code  text NOT NULL,
  amount         numeric(18, 4) NOT NULL,
  reason         text NOT NULL,
  approval_state text NOT NULL DEFAULT 'pending',
  requested_by   uuid NOT NULL,
  approved_by    uuid NULL,
  approved_at    timestamptz NULL,
  issued_at      timestamptz NULL,
  idempotency_key text NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,

  CONSTRAINT pk_credit_notes PRIMARY KEY (id),
  CONSTRAINT uq_credit_notes_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_credit_notes_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_credit_notes_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_credit_notes_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_credit_notes_amount CHECK (amount > 0),
  CONSTRAINT ck_credit_notes_approval_state CHECK (approval_state IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ck_credit_notes_approved_distinct CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT ck_credit_notes_approved_shape
    CHECK ((approval_state = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL AND issued_at IS NOT NULL))
);
COMMENT ON TABLE sal.credit_notes IS 'Phase 1-11 credit-note foundation (invoice-linked, WHOLE ROW gated by sal.finance.view). Dual control: requested_by/approved_by server-stamped, maker<>approver (H-fin-6). currency = invoice currency (M-fin-4). Immutable once approved. Credit <= invoice open receivable (enforced in approve_credit_note under the invoice lock). Roll-forward-only.';
CREATE UNIQUE INDEX uq_credit_notes_idempotency ON sal.credit_notes (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_credit_notes_invoice ON sal.credit_notes (tenant_id, company_id, branch_id, invoice_id);
CREATE INDEX ix_credit_notes_currency ON sal.credit_notes (currency_code);
CREATE TRIGGER tg_credit_notes_stamp_maker BEFORE INSERT ON sal.credit_notes FOR EACH ROW EXECUTE FUNCTION sal.stamp_dual_control_maker();
CREATE TRIGGER tg_credit_notes_approval BEFORE UPDATE ON sal.credit_notes FOR EACH ROW EXECUTE FUNCTION sal.guard_dual_control_approval();
CREATE TRIGGER tg_credit_notes_touch_metadata BEFORE UPDATE ON sal.credit_notes FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_credit_notes_immutable BEFORE UPDATE ON sal.credit_notes
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'invoice_id', 'currency_code', 'created_at', 'created_by');
ALTER TABLE sal.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.credit_notes FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_credit_notes_gated ON sal.credit_notes FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_credit_notes_gated ON sal.credit_notes FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_credit_notes_gated ON sal.credit_notes FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'));
GRANT SELECT, INSERT, UPDATE ON sal.credit_notes TO app_runtime;
GRANT SELECT ON sal.credit_notes TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. sal.receipt_reversals — full-receipt reversal, dual control, currency = receipt
-- ----------------------------------------------------------------------------
CREATE TABLE sal.receipt_reversals (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  company_id          uuid NOT NULL,
  branch_id           uuid NOT NULL,
  original_receipt_id uuid NOT NULL,
  currency_code       text NOT NULL,
  amount              numeric(18, 4) NOT NULL,
  reason              text NOT NULL,
  approval_state      text NOT NULL DEFAULT 'pending',
  requested_by        uuid NOT NULL,
  approved_by         uuid NULL,
  approved_at         timestamptz NULL,
  reversed_at         timestamptz NULL,
  idempotency_key     text NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,

  CONSTRAINT pk_receipt_reversals PRIMARY KEY (id),
  CONSTRAINT uq_receipt_reversals_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  -- H-fin-1: full-receipt reversal — at most one reversal per receipt.
  CONSTRAINT uq_receipt_reversals_receipt UNIQUE (tenant_id, company_id, branch_id, original_receipt_id),
  CONSTRAINT fk_receipt_reversals_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipt_reversals_receipt FOREIGN KEY (tenant_id, company_id, branch_id, original_receipt_id)
    REFERENCES sal.receipts (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipt_reversals_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_receipt_reversals_amount CHECK (amount > 0),
  CONSTRAINT ck_receipt_reversals_approval_state CHECK (approval_state IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ck_receipt_reversals_approved_distinct CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT ck_receipt_reversals_approved_shape
    CHECK ((approval_state = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL AND reversed_at IS NOT NULL))
);
COMMENT ON TABLE sal.receipt_reversals IS 'Phase 1-11 full-receipt reversal (WHOLE ROW gated by sal.finance.view). Original receipt retained; at most one reversal per receipt; amount = original receipt amount (enforced in reverse_receipt). Dual control server-stamped, maker<>approver (H-fin-6). currency = receipt currency (M-fin-4). Roll-forward-only.';
CREATE UNIQUE INDEX uq_receipt_reversals_idempotency ON sal.receipt_reversals (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- The non-partial uq_receipt_reversals_receipt already covers the receipt FK; no separate index.
CREATE INDEX ix_receipt_reversals_currency ON sal.receipt_reversals (currency_code);
CREATE TRIGGER tg_receipt_reversals_stamp_maker BEFORE INSERT ON sal.receipt_reversals FOR EACH ROW EXECUTE FUNCTION sal.stamp_dual_control_maker();
CREATE TRIGGER tg_receipt_reversals_approval BEFORE UPDATE ON sal.receipt_reversals FOR EACH ROW EXECUTE FUNCTION sal.guard_dual_control_approval();
CREATE TRIGGER tg_receipt_reversals_touch_metadata BEFORE UPDATE ON sal.receipt_reversals FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_receipt_reversals_immutable BEFORE UPDATE ON sal.receipt_reversals
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'original_receipt_id', 'currency_code', 'created_at', 'created_by');
ALTER TABLE sal.receipt_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.receipt_reversals FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_receipt_reversals_gated ON sal.receipt_reversals FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_receipt_reversals_gated ON sal.receipt_reversals FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_receipt_reversals_gated ON sal.receipt_reversals FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view'));
GRANT SELECT, INSERT, UPDATE ON sal.receipt_reversals TO app_runtime;
GRANT SELECT ON sal.receipt_reversals TO app_readonly;
