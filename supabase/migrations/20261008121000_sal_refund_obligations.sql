-- ============================================================================
-- P1-32-PRE-OD-FD2A — the D2 credit ceiling and refund obligations (Owner
-- decision D2, part 1; refund requests, approval and execution are FD2B).
-- Owner module: sal (billing and payments)
--
-- Rollback classification: ROLLBACK-SAFE WHILE sal.refund_obligations IS EMPTY;
--   roll-forward-only once an obligation exists, because dropping the table
--   would destroy the only record that the customer is owed money. One table is
--   added with its three policies, two trigger functions and four triggers (one
--   of them a deferred constraint trigger); two CHECKs on sal.financial_events
--   are widened; seven functions are re-issued under their own names and
--   signatures; two table comments are rewritten. No stored row is written,
--   moved or deleted by the migration.
--   Forward-only — the inverse at the foot of this file is for a rehearsal copy
--   only.
--
-- Purpose (Owner decision D2 of 2026-09-30, ADR-023)
--
--   D2  "A credit is at most the eligible invoiced amount minus effective
--       previous credits, concurrency-safe; any excess of credit over what is
--       outstanding becomes a customer credit/refund obligation — no automatic
--       refund; refund approval and execution are separate, with a second
--       approver, and no duplicate or excess refunds."
--
--   Before this migration sal.approve_credit_note refused a credit above the
--   invoice's OPEN receivable (gross less receipts less approved credits), so a
--   paid invoice could not be credited at all. From this migration:
--
--     * THE CEILING IS WHAT THE INVOICE CAN STILL BE CREDITED. A credit note is
--       approved only while its amount is at most the issued invoice's gross
--       total less the credits already APPROVED on it, read under the same two
--       row locks the approval already took (the note, then the invoice), so two
--       approvals racing on one invoice serialise and cannot together exceed the
--       gross. Pending, rejected and withdrawn notes credit nothing and are not
--       counted; the approval re-checks every time. Refused as
--       `credit_note_exceeds_creditable`. The per-line return limits of D9
--       (sal.request_return_credit_note) are untouched.
--
--     * THE EXCESS IS AN OBLIGATION, NOT A REFUND. When the approved credit is
--       larger than what the invoice still owed at that moment (its open
--       receivable before this credit, never below zero), the difference is
--       recorded in the same transaction as ONE row of sal.refund_obligations:
--       the customer is owed that money back. Nothing is paid, moved or posted.
--       The row is bound to its facts by sal.guard_refund_obligation_insert —
--       the approved credit note, its invoice, the invoice's customer, the
--       invoice's currency and exactly the excess — so a raw INSERT cannot
--       invent or inflate one. In this change an obligation is only ever 'open';
--       settling or cancelling one arrives with refund requests (FD2B), and an
--       obligation created by hand is not built (an open Owner question: who may
--       create one).
--
--     * ONE FINANCIAL EVENT PER OBLIGATION. `refund_obligation_recorded` on
--       sal.financial_events, bound to the obligation's amount and currency by
--       the provenance guard and required at commit by the completeness
--       trigger. Like every row of that table it is an operational fact, not an
--       accounting entry: there is no account, no posting and no ledger.
--
--     * THE OPEN RECEIVABLE IS NEVER NEGATIVE. With a paid invoice now
--       creditable, gross less receipts less credits can fall below zero; the
--       part below zero is exactly what the obligation records. Both
--       sal.invoice_open_receivable and sal.invoice_open_receivable_as_of are
--       re-issued to answer at least zero, so for a moment at or after now they
--       still answer the same figure. No existing invoice can change: before
--       this migration no primitive could take an invoice below zero.
--
--     * A PAYMENT BEHIND AN OPEN OBLIGATION IS NOT REVERSED (interim rule, an
--       OPEN policy point and not a reading of D2). Reversing a receipt that
--       paid an invoice with an open refund obligation would change the excess
--       the obligation was computed from. Requesting such a reversal
--       (sal.guard_receipt_reversal_request) and approving one
--       (sal.approve_receipt_reversal) are refused as
--       `receipt_reversal_refund_obligation_open`. Both take a share lock on the
--       invoices the receipt paid before they look, which a credit approval
--       holds FOR UPDATE, so the two cannot pass each other.
--
-- Not in this change (ADR-023 D2 part 2, FD2B): refund requests, the second
--   approver, refund execution and the states 'settled' and 'cancelled'. Not in
--   any change until the accounting questionnaire is answered: refund accounts,
--   ledger postings, cash or bank movement, tax and period close.
--
-- Security implications
--   ENABLE + FORCE RLS on the new table; the WHOLE ROW is gated by
--   sal.finance.view in the caller's tenant, company and branch, as
--   sal.credit_notes and sal.receipt_reversals are. app_runtime holds SELECT
--   and INSERT, and UPDATE of the state column only (every state change is
--   refused in this change); app_readonly SELECT; no DELETE for any
--   application role. Every function is SECURITY INVOKER with an empty
--   search_path; trigger functions have EXECUTE revoked from PUBLIC. No
--   SECURITY DEFINER.
--
-- Dependencies
--   20260724092000 (sal.credit_notes, sal.receipts, sal.payment_allocations),
--   20260724093000 (sal.financial_events and its guards), 20260930100000
--   (shared.fits_minor_unit), 20260930110000 and 20261001090000 (the credit-note
--   decision guard), 20261002090000 (receipt-reversal requests), 20261008090000
--   (sal.invoice_open_receivable_as_of).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sal.refund_obligations — what the customer is owed back
-- ----------------------------------------------------------------------------

CREATE TABLE sal.refund_obligations (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL,
  company_id      uuid          NOT NULL,
  branch_id       uuid          NOT NULL,
  partner_id      uuid          NOT NULL,
  invoice_id      uuid          NOT NULL,
  credit_note_id  uuid          NOT NULL,
  currency_code   text          NOT NULL,
  amount          numeric(18, 4) NOT NULL,
  source          text          NOT NULL DEFAULT 'credit_excess',
  state           text          NOT NULL DEFAULT 'open',
  record_version  integer       NOT NULL DEFAULT 1,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  created_by      uuid          NOT NULL,
  updated_at      timestamptz   NULL,
  updated_by      uuid          NULL,

  CONSTRAINT pk_refund_obligations PRIMARY KEY (id),
  CONSTRAINT uq_refund_obligations_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  -- One obligation per credit note: an approval creates at most one.
  CONSTRAINT uq_refund_obligations_credit_note UNIQUE (tenant_id, company_id, branch_id, credit_note_id),
  CONSTRAINT fk_refund_obligations_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_credit_note FOREIGN KEY (tenant_id, company_id, branch_id, credit_note_id)
    REFERENCES sal.credit_notes (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_partner FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_refund_obligations_amount CHECK (amount > 0),
  -- Only the excess of an approved credit over what was owed creates one here.
  CONSTRAINT ck_refund_obligations_source CHECK (source IN ('credit_excess')),
  -- 'settled' and 'cancelled' are reserved for refund requests (FD2B); nothing
  -- reaches them in this change.
  CONSTRAINT ck_refund_obligations_state CHECK (state IN ('open', 'settled', 'cancelled'))
);

COMMENT ON TABLE sal.refund_obligations IS
  'P1-32-PRE-OD-FD2A (ADR-023 D2): money the platform records that a customer is owed back because an approved credit note exceeded what the invoice still owed. An operational record, not an accounting entry: no account, posting, cash or bank movement. Created only by sal.approve_credit_note for exactly the excess (sal.guard_refund_obligation_insert binds it to the approved note, its invoice, the invoice''s customer and currency), one per credit note. WHOLE ROW gated by sal.finance.view. Only ''open'' is reachable until refund requests exist (FD2B); no row is ever deleted. Roll-forward-only once a row exists.';
COMMENT ON COLUMN sal.refund_obligations.partner_id IS
  'The customer owed the money: the invoice''s billed party (sal.invoices.payer_partner_id), bound by sal.guard_refund_obligation_insert. Whom to refund when a third party paid (ADR-023 D14) is an open Owner question.';
COMMENT ON COLUMN sal.refund_obligations.credit_note_id IS
  'The approved credit note whose excess created the obligation. Unique: one obligation per credit note.';
COMMENT ON COLUMN sal.refund_obligations.amount IS
  'What is owed, in the invoice''s currency: the credit''s amount less the invoice''s open receivable just before the credit (never below zero). Above zero and within the currency''s minor unit (ADR-023 D1). Frozen.';
COMMENT ON COLUMN sal.refund_obligations.source IS
  'Why the obligation exists. Only credit_excess in this change; an explicit obligation raised by hand is not built (open Owner question).';
COMMENT ON COLUMN sal.refund_obligations.state IS
  'open (owed, nothing refunded yet). settled and cancelled are reserved for refund requests (FD2B) and refused by sal.guard_refund_obligation_update until then.';

CREATE INDEX ix_refund_obligations_invoice
  ON sal.refund_obligations (tenant_id, company_id, branch_id, invoice_id, state);
CREATE INDEX ix_refund_obligations_partner ON sal.refund_obligations (tenant_id, partner_id);
CREATE INDEX ix_refund_obligations_currency ON sal.refund_obligations (currency_code);
-- The list order: newest first within a branch.
CREATE INDEX ix_refund_obligations_list
  ON sal.refund_obligations (tenant_id, company_id, branch_id, created_at DESC, id DESC);

-- ----------------------------------------------------------------------------
-- 2. Every obligation is bound to the credit that created it
-- ----------------------------------------------------------------------------

CREATE FUNCTION sal.guard_refund_obligation_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_cn sal.credit_notes%ROWTYPE;
  v_inv sal.invoices%ROWTYPE;
  v_gross numeric(18, 4);
  v_alloc numeric(18, 4);
  v_other numeric(18, 4);
  v_owed_before numeric(18, 4);
  v_expected numeric(18, 4);
BEGIN
  -- Stamped, never supplied, for the request path's population (the boundary of
  -- 20261008090000 and 20261008100000).
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     AND pg_catalog.pg_has_role(current_user, 'app_runtime', 'MEMBER') THEN
    NEW.created_by := iam.current_user_id();
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'refund_obligation_no_user: a refund obligation is recorded by a signed-in person'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.created_at := now();
  END IF;
  -- Born open and unchanged, whatever the statement names.
  NEW.state := 'open';
  NEW.record_version := 1;
  NEW.updated_at := NULL;
  NEW.updated_by := NULL;

  SELECT * INTO v_cn FROM sal.credit_notes cn
   WHERE cn.tenant_id = NEW.tenant_id AND cn.company_id = NEW.company_id
     AND cn.branch_id = NEW.branch_id AND cn.id = NEW.credit_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_obligation_credit_note_missing: credit note % is not visible in the obligation''s company and branch', NEW.credit_note_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_cn.approval_state <> 'approved' THEN
    RAISE EXCEPTION 'refund_obligation_credit_not_approved: credit note % is %, and only an approved credit can leave the customer owed money', v_cn.id, v_cn.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_cn.invoice_id <> NEW.invoice_id THEN
    RAISE EXCEPTION 'refund_obligation_invoice_mismatch: credit note % credits invoice %, not %', v_cn.id, v_cn.invoice_id, NEW.invoice_id
      USING ERRCODE = 'check_violation';
  END IF;
  -- The invoice lock the approval already holds; a raw INSERT takes it here.
  SELECT * INTO v_inv FROM sal.invoices i
   WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id
     AND i.branch_id = NEW.branch_id AND i.id = NEW.invoice_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_obligation_credit_note_missing: invoice % is not visible in the obligation''s company and branch', NEW.invoice_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.partner_id IS DISTINCT FROM v_inv.payer_partner_id THEN
    RAISE EXCEPTION 'refund_obligation_partner_mismatch: the customer owed is the invoice''s customer'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_code IS DISTINCT FROM v_inv.currency_code OR NEW.currency_code IS DISTINCT FROM v_cn.currency_code THEN
    RAISE EXCEPTION 'refund_obligation_currency_mismatch: an obligation is in its invoice''s currency %, not %', v_inv.currency_code, NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT shared.fits_minor_unit(NEW.amount, NEW.currency_code) THEN
    RAISE EXCEPTION 'refund_obligation_minor_unit: an obligation in % is stated to the currency''s minor unit', NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;

  -- Exactly the excess: the credit less what the invoice owed just before it,
  -- never below zero. "Before it" is every approved credit but this one.
  SELECT COALESCE(a.gross_total, 0) INTO v_gross FROM sal.invoice_amounts a
   WHERE a.tenant_id = v_inv.tenant_id AND a.company_id = v_inv.company_id
     AND a.branch_id = v_inv.branch_id AND a.invoice_id = v_inv.id AND a.deleted_at IS NULL;
  v_gross := COALESCE(v_gross, 0);
  SELECT COALESCE(sum(pa.amount), 0) INTO v_alloc
    FROM sal.payment_allocations pa JOIN sal.receipts r
      ON r.tenant_id = pa.tenant_id AND r.company_id = pa.company_id AND r.branch_id = pa.branch_id AND r.id = pa.receipt_id
   WHERE pa.tenant_id = v_inv.tenant_id AND pa.invoice_id = v_inv.id AND r.status <> 'reversed';
  SELECT COALESCE(sum(cn.amount), 0) INTO v_other FROM sal.credit_notes cn
   WHERE cn.tenant_id = v_inv.tenant_id AND cn.invoice_id = v_inv.id
     AND cn.approval_state = 'approved' AND cn.id <> v_cn.id;
  v_owed_before := greatest(round(v_gross - v_alloc - v_other, 4), 0);
  v_expected := v_cn.amount - v_owed_before;
  IF v_expected <= 0 OR NEW.amount IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'refund_obligation_amount_mismatch: the obligation is the credit''s excess over what the invoice still owed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_obligation_insert() IS
  'BEFORE INSERT guard on sal.refund_obligations (P1-32-PRE-OD-FD2A, ADR-023 D2). For app_runtime and its login members stamps created_by and created_at; for every writer forces state open and record_version 1. Refuses an obligation whose credit note is not approved (refund_obligation_credit_not_approved) or names another invoice (refund_obligation_invoice_mismatch), whose customer is not the invoice''s (refund_obligation_partner_mismatch), whose currency is not the invoice''s (refund_obligation_currency_mismatch), whose amount is finer than the minor unit (refund_obligation_minor_unit) or is not exactly the credit''s excess over the invoice''s open receivable before it (refund_obligation_amount_mismatch). Locks the invoice.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_obligation_insert() FROM PUBLIC;

CREATE TRIGGER tg_refund_obligations_insert_rules BEFORE INSERT ON sal.refund_obligations
  FOR EACH ROW EXECUTE FUNCTION sal.guard_refund_obligation_insert();

-- Every fact of an obligation is frozen; its state is the only column a later
-- change may write (refund requests, FD2B), and in this change no state change
-- exists at all.
CREATE FUNCTION sal.guard_refund_obligation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.credit_note_id IS DISTINCT FROM OLD.credit_note_id OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'refund_obligation_frozen: refund obligation % cannot be changed; only its state moves, and only with a refund', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'refund_obligation_transition_unavailable: refund obligation % stays open; settling or cancelling it arrives with refund requests', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_obligation_update() IS
  'BEFORE UPDATE guard on sal.refund_obligations (P1-32-PRE-OD-FD2A, ADR-023 D2), for every role: every fact is frozen (refund_obligation_frozen), and no state change exists until refund requests are built (refund_obligation_transition_unavailable).';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_obligation_update() FROM PUBLIC;

CREATE TRIGGER tg_refund_obligations_frozen BEFORE UPDATE ON sal.refund_obligations
  FOR EACH ROW EXECUTE FUNCTION sal.guard_refund_obligation_update();
CREATE TRIGGER tg_refund_obligations_touch_metadata BEFORE UPDATE ON sal.refund_obligations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE sal.refund_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.refund_obligations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_refund_obligations_gated ON sal.refund_obligations FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_refund_obligations_gated ON sal.refund_obligations FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_refund_obligations_gated ON sal.refund_obligations FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON sal.refund_obligations TO app_runtime;
GRANT UPDATE (state) ON sal.refund_obligations TO app_runtime;
GRANT SELECT ON sal.refund_obligations TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. One financial event per obligation
-- ----------------------------------------------------------------------------

ALTER TABLE sal.financial_events DROP CONSTRAINT ck_financial_events_event_type;
ALTER TABLE sal.financial_events DROP CONSTRAINT ck_financial_events_source_type;
ALTER TABLE sal.financial_events
  ADD CONSTRAINT ck_financial_events_event_type CHECK (event_type IN (
    'invoice_issued', 'receipt_recorded', 'payment_allocated',
    'credit_note_issued', 'receipt_reversed', 'warranty_split_recorded',
    'refund_obligation_recorded')),
  ADD CONSTRAINT ck_financial_events_source_type CHECK (source_type IN (
    'invoice', 'receipt', 'payment_allocation', 'credit_note', 'receipt_reversal',
    'refund_obligation'));

COMMENT ON TABLE sal.financial_events IS 'Phase 1-11 IMMUTABLE append-only financial-event ledger (SELECT+INSERT only; WHOLE ROW gated by sal.finance.view). The future accounting integration point (Figure 4.29) — NOT a general ledger: no debit/credit/account columns, and no event is an accounting entry; refund_obligation_recorded (P1-32-PRE-OD-FD2A, ADR-023 D2) records that a customer is owed money back, which is an operational fact and moves no money. Exactly one event per financial command (completeness constraint triggers); provenance-guarded; single-use per (source, event_type). Roll-forward-only.';

-- Re-issued from 20260724093000_sal_financial_events.sql. The only change: the
-- refund_obligation_recorded branch, bound to the obligation's own amount and
-- currency.
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
  ELSIF NEW.event_type = 'refund_obligation_recorded' THEN
    SELECT amount, currency_code INTO v_amount, v_currency FROM sal.refund_obligations
      WHERE tenant_id = NEW.tenant_id AND id = NEW.source_id AND NEW.source_type = 'refund_obligation';
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

-- Re-issued from 20260724093000_sal_financial_events.sql. The only change: an
-- obligation needs its refund_obligation_recorded event at commit.
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
  ELSIF TG_TABLE_NAME = 'refund_obligations' THEN
    v_needed := true; v_type := 'refund_obligation_recorded';
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

CREATE CONSTRAINT TRIGGER tg_refund_obligations_event_completeness AFTER INSERT ON sal.refund_obligations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sal.guard_event_completeness();

-- ----------------------------------------------------------------------------
-- 4. The open receivable is never below zero
-- ----------------------------------------------------------------------------

-- Re-issued from 20260724093000_sal_financial_events.sql. The only change: the
-- answer is at least zero. What lies below zero is owed back to the customer,
-- and sal.refund_obligations records it.
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
  RETURN greatest(round(v_gross - v_alloc - v_credit, 4), 0.0000);
END; $$;
COMMENT ON FUNCTION sal.invoice_open_receivable(uuid) IS
  'What an invoice still owes now: 0 for a draft and a voided invoice; otherwise gross less the allocations of receipts not reversed (H-fin-1) less the approved credit notes, never below zero (P1-32-PRE-OD-FD2A, ADR-023 D2: an approved credit beyond what was owed is recorded in sal.refund_obligations). SECURITY INVOKER: the caller''s row security applies.';

-- Re-issued from 20261008090000_sal_settlement_as_of.sql. The only change: the
-- answer is at least zero, so for a moment at or after now it still equals
-- sal.invoice_open_receivable.
CREATE OR REPLACE FUNCTION sal.invoice_open_receivable_as_of(p_invoice_id uuid, p_as_of timestamptz)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_gross numeric(18, 4); v_alloc numeric(18, 4); v_credit numeric(18, 4);
        v_status text; v_tenant uuid; v_issued timestamptz;
BEGIN
  IF p_as_of IS NULL THEN
    RAISE EXCEPTION 'sal.invoice_open_receivable_as_of: the moment is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  SELECT i.status, i.tenant_id, i.issued_at, a.gross_total INTO v_status, v_tenant, v_issued, v_gross
    FROM sal.invoices i LEFT JOIN sal.invoice_amounts a
      ON a.tenant_id = i.tenant_id AND a.company_id = i.company_id AND a.branch_id = i.branch_id AND a.invoice_id = i.id AND a.deleted_at IS NULL
    WHERE i.id = p_invoice_id;
  IF v_status IS NULL OR v_status IN ('draft', 'void_before_issue') THEN
    RETURN 0;
  END IF;
  -- Not issued yet at that moment: it owed nothing then, as a draft owes nothing now.
  IF v_issued IS NULL OR v_issued > p_as_of THEN
    RETURN 0;
  END IF;
  v_gross := COALESCE(v_gross, 0);
  -- H-fin-1 as of the moment: an allocation of a receipt counts unless the receipt's
  -- reversal had taken effect by then.
  SELECT COALESCE(sum(pa.amount), 0) INTO v_alloc
    FROM sal.payment_allocations pa JOIN sal.receipts r
      ON r.tenant_id = pa.tenant_id AND r.company_id = pa.company_id AND r.branch_id = pa.branch_id AND r.id = pa.receipt_id
    WHERE pa.tenant_id = v_tenant AND pa.invoice_id = p_invoice_id
      AND pa.allocated_at <= p_as_of
      AND (r.status <> 'reversed' OR EXISTS (
        SELECT 1 FROM sal.receipt_reversals rr
         WHERE rr.tenant_id = r.tenant_id AND rr.company_id = r.company_id AND rr.branch_id = r.branch_id
           AND rr.original_receipt_id = r.id AND rr.approval_state = 'approved'
           AND rr.reversed_at > p_as_of));
  SELECT COALESCE(sum(amount), 0) INTO v_credit FROM sal.credit_notes
    WHERE tenant_id = v_tenant AND invoice_id = p_invoice_id AND approval_state = 'approved'
      AND issued_at <= p_as_of;
  RETURN greatest(round(v_gross - v_alloc - v_credit, 4), 0.0000);
END; $$;
COMMENT ON FUNCTION sal.invoice_open_receivable_as_of(uuid, timestamptz) IS
  'sal.invoice_open_receivable as of p_as_of (P1-32-PRE-OD-FD16A, Owner decision D16): 0 for a draft, a voided invoice and an invoice issued after p_as_of; otherwise gross less the allocations made at or before p_as_of of receipts not reversed by then (an approved reversal counts from its reversed_at) and less the approved credit notes issued at or before p_as_of, never below zero (P1-32-PRE-OD-FD2A, ADR-023 D2). For p_as_of at or after now() it equals sal.invoice_open_receivable. SECURITY INVOKER: the caller''s row security applies.';

-- ----------------------------------------------------------------------------
-- 5. The approval: the D2 ceiling, and the obligation for the excess
-- ----------------------------------------------------------------------------

-- The table comment stated the old ceiling; it now states D2's.
COMMENT ON TABLE sal.credit_notes IS 'Phase 1-11 credit-note foundation (invoice-linked, WHOLE ROW gated by sal.finance.view). Dual control: requested_by/approved_by server-stamped, maker<>approver (H-fin-6). currency = invoice currency (M-fin-4). Immutable once approved. Credit <= the issued invoice''s gross less the credits already approved (ADR-023 D2, enforced in approve_credit_note under the invoice lock); an approved credit above the invoice''s open receivable records the excess in sal.refund_obligations (P1-32-PRE-OD-FD2A). Roll-forward-only.';

-- Re-issued from 20260930110000_sal_credit_note_decisions.sql. Two changes: the
-- ceiling is what the invoice can still be credited (its gross less the credits
-- already approved), refused as credit_note_exceeds_creditable; and an approved
-- credit above what the invoice still owed records the excess as one refund
-- obligation with its financial event, in this transaction.
CREATE OR REPLACE FUNCTION sal.approve_credit_note(p_credit_id uuid, p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_cn sal.credit_notes%ROWTYPE; v_inv sal.invoices%ROWTYPE; v_actor uuid := iam.current_user_id();
        v_gross numeric(18, 4); v_credited numeric(18, 4); v_creditable numeric(18, 4);
        v_owed numeric(18, 4); v_excess numeric(18, 4); v_obligation uuid;
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
  SELECT * INTO v_inv FROM sal.invoices WHERE id = v_cn.invoice_id AND tenant_id = v_cn.tenant_id
    AND company_id = v_cn.company_id AND branch_id = v_cn.branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_credit_note: invoice % not found in scope', v_cn.invoice_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_inv.currency_code IS DISTINCT FROM v_cn.currency_code THEN
    RAISE EXCEPTION 'credit note: currency % does not match the invoice currency %', v_cn.currency_code, v_inv.currency_code USING ERRCODE = 'check_violation';
  END IF;
  -- D2: at most the issued invoice's gross less the credits already approved,
  -- read under the note and invoice locks.
  IF v_inv.status IN ('issued', 'credited') THEN
    SELECT a.gross_total INTO v_gross FROM sal.invoice_amounts a
     WHERE a.tenant_id = v_inv.tenant_id AND a.company_id = v_inv.company_id
       AND a.branch_id = v_inv.branch_id AND a.invoice_id = v_inv.id AND a.deleted_at IS NULL;
  END IF;
  v_gross := COALESCE(v_gross, 0);
  SELECT COALESCE(sum(amount), 0) INTO v_credited FROM sal.credit_notes
   WHERE tenant_id = v_inv.tenant_id AND invoice_id = v_inv.id AND approval_state = 'approved';
  v_creditable := v_gross - v_credited;
  IF v_cn.amount > v_creditable THEN
    RAISE EXCEPTION 'credit_note_exceeds_creditable: credit % exceeds the % invoice % can still be credited', v_cn.amount, v_creditable, v_inv.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- What the invoice still owed just before this credit; never below zero.
  v_owed := greatest(sal.invoice_open_receivable(v_inv.id), 0);
  UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = p_credit_id; -- trigger stamps approved_by, approved_at, issued_at
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_cn.tenant_id, v_cn.company_id, v_cn.branch_id, 'credit_note_issued', 'credit_note', v_cn.id, v_cn.currency_code, v_cn.amount, v_actor, p_correlation_id, v_actor);
  v_excess := v_cn.amount - v_owed;
  IF v_excess > 0 THEN
    INSERT INTO sal.refund_obligations (tenant_id, company_id, branch_id, partner_id, invoice_id, credit_note_id,
                                        currency_code, amount, source, created_by)
      VALUES (v_cn.tenant_id, v_cn.company_id, v_cn.branch_id, v_inv.payer_partner_id, v_inv.id, v_cn.id,
              v_cn.currency_code, v_excess, 'credit_excess', v_actor)
      RETURNING id INTO v_obligation;
    INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
      VALUES (v_cn.tenant_id, v_cn.company_id, v_cn.branch_id, 'refund_obligation_recorded', 'refund_obligation', v_obligation,
              v_cn.currency_code, v_excess, v_actor, p_correlation_id, v_actor);
  END IF;
END; $$;
COMMENT ON FUNCTION sal.approve_credit_note(uuid, uuid) IS
  'Approves a pending credit note under dual control (P1-11; P1-32-PRE-OD-FIN, FD2A, FD2C). Locks the note, then the invoice; returns silently on an approved note; refuses a decided one, the requester and a currency mismatch. ADR-023 D2: refuses a credit above the issued invoice''s gross less the credits already approved (credit_note_exceeds_creditable); writes the credit_note_issued financial event; and when the credit exceeds what the invoice still owed just before it, records the excess as one sal.refund_obligations row with its refund_obligation_recorded event (P1-32-PRE-OD-FD2A). sal.guard_credit_note_decision holds the approver to sal.credit.approve and a credit-note approval limit (D13) and stamps the approver and dates.';

-- ----------------------------------------------------------------------------
-- 6. A payment behind an open obligation is not reversed (interim rule)
-- ----------------------------------------------------------------------------

-- Re-issued from 20261002090000_sal_receipt_reversal_requests.sql. The only
-- change: after the receipt lock, the invoices the receipt paid are share-locked
-- and a reversal is refused while any of them has an open refund obligation.
CREATE OR REPLACE FUNCTION sal.guard_receipt_reversal_request()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor uuid := iam.current_user_id();
  v_amount numeric(18, 4);
  v_currency text;
  v_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (requested_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The receipt lock a request holds is what an allocation's share lock waits on.
  SELECT r.amount, r.currency_code, r.status INTO v_amount, v_currency, v_status
    FROM sal.receipts r
   WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
     AND r.branch_id = NEW.branch_id AND r.id = NEW.original_receipt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt_reversal_receipt_missing: receipt % is not visible in the reversal''s scope', NEW.original_receipt_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT iam.has_permission_in_scope('sal.payment.record', NEW.company_id, NEW.branch_id, NULL) THEN
    RAISE EXCEPTION 'receipt_reversal_request_permission_missing: requesting the reversal of receipt % requires sal.payment.record in its company and branch', NEW.original_receipt_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status = 'reversed' THEN
    RAISE EXCEPTION 'receipt_reversal_receipt_reversed: receipt % is already reversed', NEW.original_receipt_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sal.receipt_reversals rr
     WHERE rr.tenant_id = NEW.tenant_id AND rr.company_id = NEW.company_id
       AND rr.branch_id = NEW.branch_id AND rr.original_receipt_id = NEW.original_receipt_id
       AND rr.approval_state IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'receipt_reversal_exists: receipt % already has a reversal waiting for a decision or approved', NEW.original_receipt_id
      USING ERRCODE = 'check_violation';
  END IF;
  -- The invoices this receipt paid, share-locked: a credit approval holds its
  -- invoice FOR UPDATE, so an obligation it creates is seen here.
  PERFORM 1 FROM sal.invoices i
   WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id AND i.branch_id = NEW.branch_id
     AND i.id IN (SELECT pa.invoice_id FROM sal.payment_allocations pa
                   WHERE pa.tenant_id = NEW.tenant_id AND pa.company_id = NEW.company_id
                     AND pa.branch_id = NEW.branch_id AND pa.receipt_id = NEW.original_receipt_id)
   ORDER BY i.id
   FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM sal.payment_allocations pa JOIN sal.refund_obligations ro
      ON ro.tenant_id = pa.tenant_id AND ro.company_id = pa.company_id
     AND ro.branch_id = pa.branch_id AND ro.invoice_id = pa.invoice_id
     WHERE pa.tenant_id = NEW.tenant_id AND pa.company_id = NEW.company_id
       AND pa.branch_id = NEW.branch_id AND pa.receipt_id = NEW.original_receipt_id
       AND ro.state = 'open'
  ) THEN
    RAISE EXCEPTION 'receipt_reversal_refund_obligation_open: receipt % paid an invoice whose customer is owed a refund, so it is not reversed while that refund is open', NEW.original_receipt_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount IS DISTINCT FROM v_amount THEN
    RAISE EXCEPTION 'receipt_reversal_amount_mismatch: a reversal reverses the whole receipt, % and not %', v_amount, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_code IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'receipt_reversal_currency_mismatch: a reversal is in the receipt''s currency %, not %', v_currency, NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reason IS NULL OR btrim(NEW.reason) = '' OR char_length(NEW.reason) > 2000 THEN
    RAISE EXCEPTION 'receipt_reversal_reason_required: a reversal request states why, in at most 2000 characters'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_receipt_reversal_request() IS
  'BEFORE INSERT guard on sal.receipt_reversals (P1-32-PRE-OD-FD4, ADR-023 D4). Locks the receipt FOR UPDATE; refuses a caller without sal.payment.record in the receipt''s company and branch (receipt_reversal_request_permission_missing), a reversed receipt (receipt_reversal_receipt_reversed), a receipt that already has a pending or approved reversal (receipt_reversal_exists), a receipt that paid an invoice with an open refund obligation (receipt_reversal_refund_obligation_open, P1-32-PRE-OD-FD2A, after share-locking those invoices), an amount or currency other than the receipt''s (receipt_reversal_amount_mismatch, receipt_reversal_currency_mismatch) and a blank or over-long reason (receipt_reversal_reason_required). Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_receipt_reversal_request() FROM PUBLIC;

-- Re-issued from 20261002090000_sal_receipt_reversal_requests.sql. The only
-- change: after the receipt and reversal locks and the state checks, the
-- invoices the receipt paid are share-locked and the approval is refused while
-- any of them has an open refund obligation.
CREATE OR REPLACE FUNCTION sal.approve_receipt_reversal(p_reversal_id uuid, p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rev sal.receipt_reversals%ROWTYPE; v_rcpt sal.receipts%ROWTYPE; v_receipt uuid;
        v_actor uuid := iam.current_user_id();
BEGIN
  SELECT original_receipt_id INTO v_receipt FROM sal.receipt_reversals
   WHERE id = p_reversal_id AND tenant_id = iam.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: reversal % not found in scope', p_reversal_id USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO v_rcpt FROM sal.receipts WHERE id = v_receipt AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: original receipt not found in scope' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO v_rev FROM sal.receipt_reversals WHERE id = p_reversal_id AND tenant_id = v_rcpt.tenant_id
    AND company_id = v_rcpt.company_id AND branch_id = v_rcpt.branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_receipt_reversal: reversal % not found in scope', p_reversal_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_rev.approval_state = 'approved' THEN RETURN; END IF; -- idempotent
  IF v_rev.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'receipt_reversal_decision_frozen: receipt reversal % is % and its decision is frozen', p_reversal_id, v_rev.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (approved_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_rev.requested_by = v_actor THEN
    RAISE EXCEPTION 'receipt_reversal_self_approval: the approver must differ from the requester (maker<>approver)' USING ERRCODE = 'check_violation';
  END IF;
  IF v_rcpt.status = 'reversed' THEN
    RAISE EXCEPTION 'receipt_reversal_receipt_reversed: receipt % is already reversed', v_rcpt.id USING ERRCODE = 'check_violation';
  END IF;
  IF v_rev.amount <> v_rcpt.amount THEN
    RAISE EXCEPTION 'sal.approve_receipt_reversal: full-receipt reversal amount % must equal receipt amount %', v_rev.amount, v_rcpt.amount USING ERRCODE = 'check_violation';
  END IF;
  -- The invoices this receipt paid, share-locked, then the open obligations on them.
  PERFORM 1 FROM sal.invoices i
   WHERE i.tenant_id = v_rcpt.tenant_id AND i.company_id = v_rcpt.company_id AND i.branch_id = v_rcpt.branch_id
     AND i.id IN (SELECT pa.invoice_id FROM sal.payment_allocations pa
                   WHERE pa.tenant_id = v_rcpt.tenant_id AND pa.company_id = v_rcpt.company_id
                     AND pa.branch_id = v_rcpt.branch_id AND pa.receipt_id = v_rcpt.id)
   ORDER BY i.id
   FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM sal.payment_allocations pa JOIN sal.refund_obligations ro
      ON ro.tenant_id = pa.tenant_id AND ro.company_id = pa.company_id
     AND ro.branch_id = pa.branch_id AND ro.invoice_id = pa.invoice_id
     WHERE pa.tenant_id = v_rcpt.tenant_id AND pa.company_id = v_rcpt.company_id
       AND pa.branch_id = v_rcpt.branch_id AND pa.receipt_id = v_rcpt.id
       AND ro.state = 'open'
  ) THEN
    RAISE EXCEPTION 'receipt_reversal_refund_obligation_open: receipt % paid an invoice whose customer is owed a refund, so it is not reversed while that refund is open', v_rcpt.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- Approve the reversal FIRST, then flip the receipt: guard_receipt_freeze (H-fin-1
  -- hardening) permits receipt->'reversed' only when an approved reversal already exists.
  UPDATE sal.receipt_reversals SET approval_state = 'approved' WHERE id = p_reversal_id; -- the guard checks the permission and stamps approved_by, approved_at, reversed_at
  UPDATE sal.receipts SET status = 'reversed' WHERE id = v_rcpt.id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rev.tenant_id, v_rev.company_id, v_rev.branch_id, 'receipt_reversed', 'receipt_reversal', v_rev.id, v_rev.currency_code, v_rev.amount, v_actor, p_correlation_id, v_actor);
END; $$;
COMMENT ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) IS
  'Approves a pending receipt reversal (P1-11; P1-32-PRE-OD-FIN, FD2A, FD4). Locks the receipt, then the reversal; returns silently on an approved one; refuses a decided one (receipt_reversal_decision_frozen), the requester (receipt_reversal_self_approval), a receipt already reversed, and a receipt that paid an invoice with an open refund obligation (receipt_reversal_refund_obligation_open, P1-32-PRE-OD-FD2A, after share-locking those invoices). sal.guard_receipt_reversal_decision holds the approver to sal.reversal.approve in the receipt''s company and branch. Flips the receipt to reversed — its allocations stay recorded and stop counting toward every invoice''s open amount — and writes the receipt_reversed financial event.';

-- ----------------------------------------------------------------------------
-- Inverse (rehearsal copy only — refused once an obligation exists)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM sal.refund_obligations) THEN
--       RAISE EXCEPTION 'refund obligations exist; this migration is forward-only';
--     END IF;
--   END $$;
--   re-issue sal.approve_receipt_reversal and sal.guard_receipt_reversal_request
--   from 20261002090000_sal_receipt_reversal_requests.sql with their COMMENTs;
--   re-issue sal.approve_credit_note from 20260930110000_sal_credit_note_decisions.sql
--   and restore its COMMENT from 20261001090000_sal_credit_approval_limits.sql;
--   re-issue sal.invoice_open_receivable_as_of from 20261008090000_sal_settlement_as_of.sql
--   with its COMMENT; re-issue sal.invoice_open_receivable,
--   sal.guard_event_completeness and sal.guard_financial_event_provenance from
--   20260724093000_sal_financial_events.sql, and
--   COMMENT ON FUNCTION sal.invoice_open_receivable(uuid) IS NULL;
--   restore the sal.financial_events table COMMENT and its two CHECKs from
--   20260724093000_sal_financial_events.sql, and the sal.credit_notes table
--   COMMENT from 20260724092000_sal_payments.sql;
--   DROP TABLE sal.refund_obligations;
--   DROP FUNCTION sal.guard_refund_obligation_update();
--   DROP FUNCTION sal.guard_refund_obligation_insert();
-- ----------------------------------------------------------------------------
