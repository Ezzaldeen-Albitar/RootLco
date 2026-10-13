-- ============================================================================
-- P1-32-PRE-OD-FD4 — receipt reversal: request, decision, withdrawal and the
-- replacement receipt.
-- Owner module: sal (payments)
--
-- Rollback classification: ROLLBACK-SAFE WITH DATA NOTE. Three nullable
--   columns are added to sal.receipt_reversals and one to sal.receipts; one
--   CHECK is widened, five CHECKs and one foreign key are added; the table-wide
--   unique constraint uq_receipt_reversals_receipt is replaced by a partial
--   unique index over the live states plus a plain index for the foreign key,
--   and one partial unique index and one plain index are added on sal.receipts;
--   five trigger functions and four triggers are added (one of them a deferred
--   constraint trigger) and tg_receipt_reversals_approval is re-pointed at the
--   new decision guard; three primitives are added, sal.record_receipt is
--   dropped and re-created with one more trailing argument, and three functions
--   are re-issued under their own names and signatures; one column grant is
--   added. No row is written, moved or deleted. The inverse at the foot of this
--   file restores every previous definition; the data note is that a reversal
--   withdrawn after this migration has no state in the previous vocabulary, and
--   two reversals of one receipt (one declined, one live) cannot stand under the
--   previous table-wide unique constraint, so the inverse first refuses to run
--   while either exists.
--
-- Purpose (Owner decision D4 of 2026-09-30, ADR-023; finance review GAP-06 and
-- the residual found in the review of #489)
--
--   D4  A mis-recorded receipt could not be corrected: sal.receipt_reversals and
--       the approval primitive existed, but nothing raised a request and no route
--       reached either. From this migration:
--
--         * REQUESTING is the payment recorder's act. sal.request_receipt_reversal
--           raises a FULL reversal — the amount and currency are the receipt's,
--           read under the receipt lock, never a caller's — with a reason that is
--           not blank and at most 2000 characters. The requester is stamped from
--           the session and must hold sal.payment.record in the receipt's company
--           and branch. A raw INSERT is held to every one of those rules by the
--           BEFORE INSERT guard sal.guard_receipt_reversal_request, and is born
--           'pending' and undecided by sal.stamp_dual_control_maker (re-issued),
--           which closes the residual of #489: a row born 'rejected' with a
--           chosen decision date could not be raised any longer, and could not
--           block the receipt anyway (next point).
--
--         * ONE LIVE REVERSAL PER RECEIPT. The table-wide unique constraint becomes
--           a partial unique index over 'pending' and 'approved', so a withdrawn or
--           rejected request no longer blocks a corrected one, and a second live
--           request is refused (receipt_reversal_exists; the index is the
--           backstop under concurrency).
--
--         * A PENDING REVERSAL FREEZES THE RECEIPT. While a request is pending (and
--           for ever once it is approved) no new allocation of the receipt is
--           booked: the BEFORE INSERT guard sal.guard_allocation_receipt_open takes
--           a share lock on the receipt — which a request holds FOR UPDATE — and
--           refuses (receipt_reversal_pending_blocks_allocation). So an approval
--           can never race a new allocation into a reversal it did not see.
--
--         * APPROVING AND REJECTING are a DIFFERENT person's act, holding
--           sal.reversal.approve in the receipt's company and branch — a code of
--           its own that no credit-note code satisfies. A rejection states why.
--           The REQUESTER may withdraw their own pending request (D3 parity). The
--           rules live in the BEFORE UPDATE guard sal.guard_receipt_reversal_decision,
--           which replaces sal.guard_dual_control_approval on this table; the
--           decider and every date are stamped from the session; approved,
--           rejected and withdrawn are terminal.
--
--         * APPROVAL IS ATOMIC. sal.approve_receipt_reversal (re-issued) locks the
--           receipt and then the reversal — the order the request takes, so the two
--           cannot deadlock — approves, flips the receipt to 'reversed' and writes
--           the receipt_reversed financial event in one statement sequence. Every
--           allocation of the receipt stays recorded (history is never deleted)
--           and stops counting: sal.invoice_open_receivable already leaves out the
--           allocations of a reversed receipt (H-fin-1), so each invoice's open
--           amount is restored exactly. The deferred constraint trigger
--           tg_receipt_reversals_applied refuses, at commit, an approved reversal
--           whose receipt was not reversed in the same transaction.
--
--         * A REPLACEMENT IS LINKED. sal.receipts.replaces_receipt_id names the
--           reversed receipt a new one replaces: same tenant, company and branch
--           (composite foreign key), only a receipt reversed by an approved
--           reversal (sal.guard_receipt_replacement), at most one replacement per
--           reversed receipt (uq_receipts_replaces), and frozen once recorded
--           (sal.guard_receipt_freeze, re-issued). sal.record_receipt takes it as a
--           trailing argument.
--
--       A bookkeeping reversal is not a cash refund: nothing here creates a refund
--       or a refund obligation (D2). Each refusal carries a stable token before the
--       first colon, which the application reads to name the rule.
--
-- Not changed here: refunds (D2), historical as-of reporting (D16), every stored
-- amount, the credit-note rules, and the event-completeness and provenance guards.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Decision columns, the widened state vocabulary and its shape
-- ----------------------------------------------------------------------------

ALTER TABLE sal.receipt_reversals
  ADD COLUMN decided_by      uuid        NULL,
  ADD COLUMN decided_at      timestamptz NULL,
  ADD COLUMN decision_reason text        NULL;

COMMENT ON COLUMN sal.receipt_reversals.decided_by IS
  'Who withdrew or rejected the request (P1-32-PRE-OD-FD4, ADR-023 D4). Stamped from the session by sal.guard_receipt_reversal_decision; never supplied by a caller. The requester for a withdrawal, a different person for a rejection. NULL while pending and on an approved reversal, whose approver is approved_by.';
COMMENT ON COLUMN sal.receipt_reversals.decided_at IS
  'When the request was withdrawn or rejected (P1-32-PRE-OD-FD4). Stamped by sal.guard_receipt_reversal_decision and frozen afterwards.';
COMMENT ON COLUMN sal.receipt_reversals.decision_reason IS
  'Why the request was rejected (P1-32-PRE-OD-FD4). Required for a rejection, not blank, at most 2000 characters; absent on every other state. Frozen once written.';

ALTER TABLE sal.receipt_reversals DROP CONSTRAINT ck_receipt_reversals_approval_state;
ALTER TABLE sal.receipt_reversals
  ADD CONSTRAINT ck_receipt_reversals_approval_state
    CHECK (approval_state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  ADD CONSTRAINT ck_receipt_reversals_decided_only_when_declined
    CHECK (approval_state IN ('rejected', 'withdrawn') OR (decided_by IS NULL AND decided_at IS NULL)),
  ADD CONSTRAINT ck_receipt_reversals_withdrawn_by_requester
    CHECK (approval_state <> 'withdrawn' OR (decided_by = requested_by AND decided_at IS NOT NULL)),
  ADD CONSTRAINT ck_receipt_reversals_rejected_by_other
    CHECK (approval_state <> 'rejected' OR decided_by IS NULL OR decided_by <> requested_by),
  ADD CONSTRAINT ck_receipt_reversals_decision_reason
    CHECK (decision_reason IS NULL
           OR (approval_state = 'rejected' AND btrim(decision_reason) <> '' AND char_length(decision_reason) <= 2000));

-- ----------------------------------------------------------------------------
-- 2. One LIVE reversal per receipt
-- ----------------------------------------------------------------------------

ALTER TABLE sal.receipt_reversals DROP CONSTRAINT uq_receipt_reversals_receipt;
CREATE UNIQUE INDEX uq_receipt_reversals_receipt_live
  ON sal.receipt_reversals (tenant_id, company_id, branch_id, original_receipt_id)
  WHERE approval_state IN ('pending', 'approved');
-- The partial index covers only the live rows; the reversal -> receipt foreign key
-- needs an index over every row.
CREATE INDEX ix_receipt_reversals_receipt
  ON sal.receipt_reversals (tenant_id, company_id, branch_id, original_receipt_id);

COMMENT ON TABLE sal.receipt_reversals IS
  'Phase 1-11 full-receipt reversal (WHOLE ROW gated by sal.finance.view), raised and decided under ADR-023 D4 (P1-32-PRE-OD-FD4). Original receipt retained; at most one LIVE (pending or approved) reversal per receipt (uq_receipt_reversals_receipt_live), so a withdrawn or rejected request does not block a corrected one; amount and currency = the original receipt''s (sal.guard_receipt_reversal_request). Requested by a holder of sal.payment.record, decided by a different holder of sal.reversal.approve, withdrawn only by the requester; requester, decider and dates server-stamped; decided rows are terminal. Roll-forward-only.';

-- ----------------------------------------------------------------------------
-- 3. The request rules, for every INSERT
-- ----------------------------------------------------------------------------

CREATE FUNCTION sal.guard_receipt_reversal_request()
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
  'BEFORE INSERT guard on sal.receipt_reversals (P1-32-PRE-OD-FD4, ADR-023 D4). Locks the receipt FOR UPDATE; refuses a caller without sal.payment.record in the receipt''s company and branch (receipt_reversal_request_permission_missing), a reversed receipt (receipt_reversal_receipt_reversed), a receipt that already has a pending or approved reversal (receipt_reversal_exists), an amount or currency other than the receipt''s (receipt_reversal_amount_mismatch, receipt_reversal_currency_mismatch) and a blank or over-long reason (receipt_reversal_reason_required). Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_receipt_reversal_request() FROM PUBLIC;

CREATE TRIGGER tg_receipt_reversals_request_rules BEFORE INSERT ON sal.receipt_reversals
  FOR EACH ROW EXECUTE FUNCTION sal.guard_receipt_reversal_request();

-- Re-issued from 20260930110000_sal_credit_note_decisions.sql. The only change: a
-- receipt reversal, like a credit note, is now born 'pending' with no reversal
-- date, decider, decision time or decision reason, whatever the statement names.
-- It overrides rather than refuses, exactly as it already does for requested_by,
-- approved_by and approved_at.
CREATE OR REPLACE FUNCTION sal.stamp_dual_control_maker()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.requested_by := iam.current_user_id();
  IF NEW.requested_by IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (requested_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.approved_by := NULL;
  NEW.approved_at := NULL;
  IF TG_TABLE_SCHEMA = 'sal' AND TG_TABLE_NAME = 'credit_notes' THEN
    NEW.approval_state := 'pending';
    NEW.issued_at := NULL;
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
    NEW.decision_reason := NULL;
  ELSIF TG_TABLE_SCHEMA = 'sal' AND TG_TABLE_NAME = 'receipt_reversals' THEN
    NEW.approval_state := 'pending';
    NEW.reversed_at := NULL;
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
    NEW.decision_reason := NULL;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.stamp_dual_control_maker() IS
  'BEFORE INSERT stamp on sal.credit_notes and sal.receipt_reversals: requested_by from the session, approver fields cleared, approval_state forced to pending and every decision field cleared — issued_at, decided_by, decided_at and decision_reason on a credit note (P1-32-PRE-OD-FD2A, D3); reversed_at, decided_by, decided_at and decision_reason on a receipt reversal (P1-32-PRE-OD-FD4, D4) — so a decision is reached only through an UPDATE the table''s decision guard sees.';
REVOKE EXECUTE ON FUNCTION sal.stamp_dual_control_maker() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. The decision guard: transitions, deciders, permission and frozen dates
-- ----------------------------------------------------------------------------

CREATE FUNCTION sal.guard_receipt_reversal_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_actor uuid;
BEGIN
  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'dual control: sal.receipt_reversals request is frozen once raised (column requested_by); raise a new request instead'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A decided reversal is frozen: its state, its deciders, its dates and its reason.
  IF OLD.approval_state <> 'pending' THEN
    IF NEW.approval_state IS DISTINCT FROM OLD.approval_state
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
       OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'receipt_reversal_decision_frozen: receipt reversal % is % and its decision is frozen (a % decision is frozen)', OLD.id, OLD.approval_state, OLD.approval_state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Still pending: nothing of a decision may be written without deciding.
  IF NEW.approval_state = 'pending' THEN
    IF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.reversed_at IS NOT NULL
       OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_reversal_not_decided: receipt reversal % is pending and carries no decision, reversal date or decision reason', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  v_actor := iam.current_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (the decider cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.approval_state = 'approved' THEN
    IF v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'receipt_reversal_self_approval: the approver must differ from the requester (maker<>approver)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_reversal_decision_reason_misplaced: only a rejection carries a decision reason' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT iam.has_permission_in_scope('sal.reversal.approve', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'receipt_reversal_approve_permission_missing: approving receipt reversal % requires sal.reversal.approve in its company and branch', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.approved_by := v_actor;
    NEW.approved_at := now();
    NEW.reversed_at := now();
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
  ELSIF NEW.approval_state = 'rejected' THEN
    IF v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'receipt_reversal_self_rejection: receipt reversal % is rejected by someone other than the person who requested it; the requester withdraws it instead', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT iam.has_permission_in_scope('sal.reversal.approve', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'receipt_reversal_reject_permission_missing: rejecting receipt reversal % requires sal.reversal.approve in its company and branch', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.decision_reason IS NULL OR btrim(NEW.decision_reason) = '' OR char_length(NEW.decision_reason) > 2000 THEN
      RAISE EXCEPTION 'receipt_reversal_reject_reason_required: rejecting receipt reversal % states why, in at most 2000 characters', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.reversed_at := NULL;
    NEW.decided_by := v_actor;
    NEW.decided_at := now();
  ELSIF NEW.approval_state = 'withdrawn' THEN
    IF v_actor <> OLD.requested_by THEN
      RAISE EXCEPTION 'receipt_reversal_withdraw_not_requester: receipt reversal % is withdrawn only by the person who requested it', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_reversal_decision_reason_misplaced: only a rejection carries a decision reason' USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.reversed_at := NULL;
    NEW.decided_by := v_actor;
    NEW.decided_at := now();
  END IF;
  -- Any other value is refused by ck_receipt_reversals_approval_state.
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_receipt_reversal_decision() IS
  'BEFORE UPDATE guard on sal.receipt_reversals (P1-32-PRE-OD-FD4, ADR-023 D4). pending -> approved: a person other than the requester holding sal.reversal.approve in the receipt''s company and branch; approver, approval time and reversal time stamped. pending -> rejected: the same, with a reason (not blank, at most 2000 characters); decider stamped. pending -> withdrawn: the requester only; decider stamped. A decided reversal is frozen: state, approver, decider, dates, decision reason and amount. Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_receipt_reversal_decision() FROM PUBLIC;

DROP TRIGGER tg_receipt_reversals_approval ON sal.receipt_reversals;
CREATE TRIGGER tg_receipt_reversals_approval BEFORE UPDATE ON sal.receipt_reversals
  FOR EACH ROW EXECUTE FUNCTION sal.guard_receipt_reversal_decision();

-- The runtime login writes the state and, for a rejection, its reason. Every date
-- and every decider is assigned by the trigger.
GRANT UPDATE (decision_reason) ON sal.receipt_reversals TO app_runtime;

-- At commit, an approved reversal's receipt is reversed: a raw approval that did
-- not flip the receipt in the same transaction is refused, so the approval, the
-- receipt's state and the financial event cannot come apart.
CREATE FUNCTION sal.guard_receipt_reversal_applied()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.approval_state = 'approved' AND NOT EXISTS (
    SELECT 1 FROM sal.receipts r
     WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
       AND r.branch_id = NEW.branch_id AND r.id = NEW.original_receipt_id
       AND r.status = 'reversed'
  ) THEN
    RAISE EXCEPTION 'receipt_reversal_not_applied: receipt reversal % was approved but its receipt was not reversed in the same transaction', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END; $$;
COMMENT ON FUNCTION sal.guard_receipt_reversal_applied() IS
  'Deferred constraint trigger on sal.receipt_reversals (P1-32-PRE-OD-FD4, ADR-023 D4): at commit, an approved reversal''s receipt is ''reversed''. sal.approve_receipt_reversal does both in one transaction; a raw approval that does not is refused (receipt_reversal_not_applied).';
REVOKE EXECUTE ON FUNCTION sal.guard_receipt_reversal_applied() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER tg_receipt_reversals_applied AFTER UPDATE ON sal.receipt_reversals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.approval_state = 'approved')
  EXECUTE FUNCTION sal.guard_receipt_reversal_applied();

-- ----------------------------------------------------------------------------
-- 5. A receipt with a live reversal takes no new allocation
-- ----------------------------------------------------------------------------

CREATE FUNCTION sal.guard_allocation_receipt_open()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- A share lock on the receipt: a reversal request holds it FOR UPDATE, so an
  -- allocation waits for the request to commit and then sees it.
  PERFORM 1 FROM sal.receipts r
    WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
      AND r.branch_id = NEW.branch_id AND r.id = NEW.receipt_id
    FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM sal.receipt_reversals rr
     WHERE rr.tenant_id = NEW.tenant_id AND rr.company_id = NEW.company_id
       AND rr.branch_id = NEW.branch_id AND rr.original_receipt_id = NEW.receipt_id
       AND rr.approval_state IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'receipt_reversal_pending_blocks_allocation: receipt % has a reversal waiting for a decision or approved, and takes no new allocation', NEW.receipt_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_allocation_receipt_open() IS
  'BEFORE INSERT guard on sal.payment_allocations (P1-32-PRE-OD-FD4, ADR-023 D4): a receipt with a pending or approved reversal takes no new allocation (receipt_reversal_pending_blocks_allocation). Takes a share lock on the receipt first, which serialises it behind a reversal request holding the receipt FOR UPDATE.';
REVOKE EXECUTE ON FUNCTION sal.guard_allocation_receipt_open() FROM PUBLIC;

CREATE TRIGGER tg_payment_allocations_receipt_open BEFORE INSERT ON sal.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION sal.guard_allocation_receipt_open();

-- ----------------------------------------------------------------------------
-- 6. The primitives: request (new), approve (re-issued), withdraw and reject (new)
-- ----------------------------------------------------------------------------

-- A payment recorder requests the full reversal of a receipt. The amount and the
-- currency are the receipt's; the requester is the session. A repeated key
-- answers the request it already raised; a key reused for another receipt is
-- refused. Every other rule is the BEFORE INSERT guard's. No financial event: a
-- pending reversal reverses nothing.
CREATE FUNCTION sal.request_receipt_reversal(p_receipt_id uuid, p_reason text, p_idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_rcpt sal.receipts%ROWTYPE; v_prior sal.receipt_reversals%ROWTYPE; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'sal.request_receipt_reversal requires a tenant context' USING ERRCODE = 'raise_exception';
  END IF;
  SELECT * INTO v_rcpt FROM sal.receipts WHERE id = p_receipt_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sal.request_receipt_reversal: receipt % not found in scope', p_receipt_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM sal.receipt_reversals
     WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_prior.original_receipt_id <> p_receipt_id THEN
        RAISE EXCEPTION 'receipt_reversal_idempotency_reused: the idempotency key already raised the reversal of another receipt'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN v_prior.id;
    END IF;
  END IF;
  INSERT INTO sal.receipt_reversals (tenant_id, company_id, branch_id, original_receipt_id, currency_code, amount,
                                     reason, requested_by, idempotency_key, created_by)
    VALUES (v_rcpt.tenant_id, v_rcpt.company_id, v_rcpt.branch_id, v_rcpt.id, v_rcpt.currency_code, v_rcpt.amount,
            p_reason, v_actor, p_idempotency_key, v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
COMMENT ON FUNCTION sal.request_receipt_reversal(uuid, text, text) IS
  'Requests the full reversal of a receipt (P1-32-PRE-OD-FD4, ADR-023 D4). Locks the receipt; answers a repeated idempotency key with the reversal it raised and refuses a key reused for another receipt (receipt_reversal_idempotency_reused); inserts a pending reversal of the receipt''s own amount and currency. sal.guard_receipt_reversal_request holds the permission, state, uniqueness and reason rules; sal.stamp_dual_control_maker stamps the requester.';
REVOKE EXECUTE ON FUNCTION sal.request_receipt_reversal(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.request_receipt_reversal(uuid, text, text) TO app_runtime;

-- Re-issued from 20260930110000_sal_credit_note_decisions.sql. Two changes: the
-- receipt is locked BEFORE the reversal, the order sal.request_receipt_reversal
-- takes, so a request and an approval cannot deadlock; and the refusals carry the
-- tokens of the decision guard. The approval permission, the decider and the
-- dates are the guard's.
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
  -- Approve the reversal FIRST, then flip the receipt: guard_receipt_freeze (H-fin-1
  -- hardening) permits receipt->'reversed' only when an approved reversal already exists.
  UPDATE sal.receipt_reversals SET approval_state = 'approved' WHERE id = p_reversal_id; -- the guard checks the permission and stamps approved_by, approved_at, reversed_at
  UPDATE sal.receipts SET status = 'reversed' WHERE id = v_rcpt.id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rev.tenant_id, v_rev.company_id, v_rev.branch_id, 'receipt_reversed', 'receipt_reversal', v_rev.id, v_rev.currency_code, v_rev.amount, v_actor, p_correlation_id, v_actor);
END; $$;
COMMENT ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) IS
  'Approves a pending receipt reversal (P1-11; P1-32-PRE-OD-FIN, FD2A, FD4). Locks the receipt, then the reversal; returns silently on an approved one; refuses a decided one (receipt_reversal_decision_frozen), the requester (receipt_reversal_self_approval) and a receipt already reversed. sal.guard_receipt_reversal_decision holds the approver to sal.reversal.approve in the receipt''s company and branch. Flips the receipt to reversed — its allocations stay recorded and stop counting toward every invoice''s open amount — and writes the receipt_reversed financial event.';
REVOKE EXECUTE ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) TO app_runtime;

-- The requester withdraws their own pending request. Idempotent for the requester
-- on a request they already withdrew. No financial event: nothing was reversed.
CREATE FUNCTION sal.withdraw_receipt_reversal(p_reversal_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rev sal.receipt_reversals%ROWTYPE; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_rev FROM sal.receipt_reversals WHERE id = p_reversal_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.withdraw_receipt_reversal: reversal % not found in scope', p_reversal_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (the decider cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_rev.requested_by <> v_actor THEN
    RAISE EXCEPTION 'receipt_reversal_withdraw_not_requester: receipt reversal % is withdrawn only by the person who requested it', p_reversal_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_rev.approval_state = 'withdrawn' THEN RETURN; END IF; -- idempotent for the requester
  IF v_rev.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'receipt_reversal_decision_frozen: receipt reversal % is % and its decision is frozen', p_reversal_id, v_rev.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.receipt_reversals SET approval_state = 'withdrawn' WHERE id = p_reversal_id; -- the guard stamps decided_by, decided_at
END; $$;
COMMENT ON FUNCTION sal.withdraw_receipt_reversal(uuid) IS
  'The requester withdraws their own pending receipt reversal (P1-32-PRE-OD-FD4, ADR-023 D4, D3 parity). Locks the reversal; refuses anyone but the requester (receipt_reversal_withdraw_not_requester) and any decided state (receipt_reversal_decision_frozen); returns silently for the requester on a reversal already withdrawn. The decider and time are stamped by sal.guard_receipt_reversal_decision.';
REVOKE EXECUTE ON FUNCTION sal.withdraw_receipt_reversal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.withdraw_receipt_reversal(uuid) TO app_runtime;

-- A different person holding sal.reversal.approve rejects a pending request, with a
-- reason. Idempotent on a reversal already rejected. No financial event.
CREATE FUNCTION sal.reject_receipt_reversal(p_reversal_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rev sal.receipt_reversals%ROWTYPE; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_rev FROM sal.receipt_reversals WHERE id = p_reversal_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.reject_receipt_reversal: reversal % not found in scope', p_reversal_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (the decider cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_rev.requested_by = v_actor THEN
    RAISE EXCEPTION 'receipt_reversal_self_rejection: receipt reversal % is rejected by someone other than the person who requested it; the requester withdraws it instead', p_reversal_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_rev.approval_state = 'rejected' THEN RETURN; END IF; -- idempotent
  IF v_rev.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'receipt_reversal_decision_frozen: receipt reversal % is % and its decision is frozen', p_reversal_id, v_rev.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.receipt_reversals SET approval_state = 'rejected', decision_reason = p_reason WHERE id = p_reversal_id; -- the guard checks the permission and the reason, stamps decided_by, decided_at
END; $$;
COMMENT ON FUNCTION sal.reject_receipt_reversal(uuid, text) IS
  'A different person rejects a pending receipt reversal with a reason (P1-32-PRE-OD-FD4, ADR-023 D4). Locks the reversal; refuses the requester (receipt_reversal_self_rejection) and any other decided state (receipt_reversal_decision_frozen); returns silently on a reversal already rejected. sal.guard_receipt_reversal_decision checks sal.reversal.approve in the receipt''s company and branch and the reason, and stamps the decider and time.';
REVOKE EXECUTE ON FUNCTION sal.reject_receipt_reversal(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.reject_receipt_reversal(uuid, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 7. The replacement receipt, linked to the reversed one
-- ----------------------------------------------------------------------------

ALTER TABLE sal.receipts ADD COLUMN replaces_receipt_id uuid NULL;
COMMENT ON COLUMN sal.receipts.replaces_receipt_id IS
  'The reversed receipt this receipt replaces (P1-32-PRE-OD-FD4, ADR-023 D4). Same tenant, company and branch (fk_receipts_replaces), only a receipt reversed by an approved reversal (sal.guard_receipt_replacement), at most one replacement per reversed receipt (uq_receipts_replaces), frozen once recorded (sal.guard_receipt_freeze). NULL for every receipt that replaces none.';
ALTER TABLE sal.receipts
  ADD CONSTRAINT fk_receipts_replaces FOREIGN KEY (tenant_id, company_id, branch_id, replaces_receipt_id)
    REFERENCES sal.receipts (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_receipts_replaces_other CHECK (replaces_receipt_id IS NULL OR replaces_receipt_id <> id);
CREATE UNIQUE INDEX uq_receipts_replaces ON sal.receipts (tenant_id, company_id, branch_id, replaces_receipt_id)
  WHERE replaces_receipt_id IS NOT NULL;
-- The partial index covers only the linked rows; the self-referencing foreign key
-- needs an index over every row, as ix_service_categories_parent does.
CREATE INDEX ix_receipts_replaces ON sal.receipts (tenant_id, company_id, branch_id, replaces_receipt_id);

CREATE FUNCTION sal.guard_receipt_replacement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  IF NEW.replaces_receipt_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.status INTO v_status FROM sal.receipts r
   WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
     AND r.branch_id = NEW.branch_id AND r.id = NEW.replaces_receipt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt_replacement_not_reversed: receipt % is not visible in the replacement''s company and branch', NEW.replaces_receipt_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'reversed' OR NOT EXISTS (
    SELECT 1 FROM sal.receipt_reversals rr
     WHERE rr.tenant_id = NEW.tenant_id AND rr.company_id = NEW.company_id
       AND rr.branch_id = NEW.branch_id AND rr.original_receipt_id = NEW.replaces_receipt_id
       AND rr.approval_state = 'approved'
  ) THEN
    RAISE EXCEPTION 'receipt_replacement_not_reversed: receipt % has no approved reversal, so nothing replaces it', NEW.replaces_receipt_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sal.receipts r
     WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
       AND r.branch_id = NEW.branch_id AND r.replaces_receipt_id = NEW.replaces_receipt_id
  ) THEN
    RAISE EXCEPTION 'receipt_replacement_exists: receipt % already has a replacement', NEW.replaces_receipt_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_receipt_replacement() IS
  'BEFORE INSERT guard on sal.receipts (P1-32-PRE-OD-FD4, ADR-023 D4): a receipt that names replaces_receipt_id replaces a receipt of the same company and branch that an approved reversal reversed (receipt_replacement_not_reversed), and that has no replacement yet (receipt_replacement_exists; uq_receipts_replaces is the backstop). Locks the reversed receipt so two replacements serialise.';
REVOKE EXECUTE ON FUNCTION sal.guard_receipt_replacement() FROM PUBLIC;

CREATE TRIGGER tg_receipts_replacement BEFORE INSERT ON sal.receipts
  FOR EACH ROW EXECUTE FUNCTION sal.guard_receipt_replacement();

-- Re-issued from 20260724092000_sal_payments.sql. The only change: the link to the
-- replaced receipt is frozen with the money-bearing facts.
CREATE OR REPLACE FUNCTION sal.guard_receipt_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.amount <> OLD.amount OR NEW.currency_code <> OLD.currency_code
     OR NEW.payment_method_id <> OLD.payment_method_id OR NEW.payer_partner_id <> OLD.payer_partner_id
     OR NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.receipt_number <> OLD.receipt_number
     OR NEW.replaces_receipt_id IS DISTINCT FROM OLD.replaces_receipt_id THEN
    RAISE EXCEPTION 'sal.receipts: a recorded receipt''s amount/method/payer/currency/received_at/number/replaced receipt are frozen (corrections via reversal only)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'reversed' THEN
      RAISE EXCEPTION 'sal.receipts: reversed is terminal' USING ERRCODE = 'check_violation';
    END IF;
    -- H-fin-1 hardening: a receipt may reach 'reversed' ONLY through an approved
    -- sal.receipt_reversals row (i.e. only via sal.approve_receipt_reversal).
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

-- Dropped and re-created with one more trailing argument, p_replaces_receipt_id.
-- Every other line is the body of 20260724093000_sal_financial_events.sql.
DROP FUNCTION sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid);

CREATE FUNCTION sal.record_receipt(
  p_company_id uuid, p_branch_id uuid, p_method_id uuid, p_payer_partner_id uuid,
  p_currency_code text, p_amount numeric, p_evidence_document_version_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_replaces_receipt_id uuid DEFAULT NULL)
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
    currency_code, amount, received_by, evidence_document_version_id, idempotency_key, replaces_receipt_id, created_by)
    VALUES (v_tenant, p_company_id, p_branch_id, v_number, p_method_id, p_payer_partner_id,
      p_currency_code, p_amount, v_actor, p_evidence_document_version_id, p_idempotency_key, p_replaces_receipt_id, v_actor)
    RETURNING id INTO v_id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, idempotency_key, created_by)
    VALUES (v_tenant, p_company_id, p_branch_id, 'receipt_recorded', 'receipt', v_id, p_currency_code, p_amount, v_actor, p_correlation_id, p_idempotency_key, v_actor);
  RETURN v_id;
END; $$;
COMMENT ON FUNCTION sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid, uuid) IS
  'Records a receipt: allocates the receipt number, inserts the receipt and writes the receipt_recorded financial event (P1-11). The trailing p_replaces_receipt_id (P1-32-PRE-OD-FD4, ADR-023 D4) links a replacement to the receipt an approved reversal reversed; sal.guard_receipt_replacement holds that link to its rules.';
REVOKE EXECUTE ON FUNCTION sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- Inverse (ROLLBACK-SAFE WITH DATA NOTE — run only while no receipt reversal is
-- withdrawn, no receipt has two reversals and no receipt names a replaced one)
--
--   DROP FUNCTION sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid, uuid);
--   re-create sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid)
--   from 20260724093000_sal_financial_events.sql with its REVOKE and GRANT;
--   re-issue sal.guard_receipt_freeze from 20260724092000_sal_payments.sql;
--   DROP TRIGGER tg_receipts_replacement ON sal.receipts;
--   DROP FUNCTION sal.guard_receipt_replacement();
--   DROP INDEX sal.ix_receipts_replaces;
--   DROP INDEX sal.uq_receipts_replaces;
--   ALTER TABLE sal.receipts DROP CONSTRAINT ck_receipts_replaces_other,
--     DROP CONSTRAINT fk_receipts_replaces, DROP COLUMN replaces_receipt_id;
--   DROP FUNCTION sal.reject_receipt_reversal(uuid, text);
--   DROP FUNCTION sal.withdraw_receipt_reversal(uuid);
--   re-issue sal.approve_receipt_reversal from
--   20260930110000_sal_credit_note_decisions.sql with its REVOKE and GRANT, and
--   COMMENT ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) IS NULL;
--   DROP FUNCTION sal.request_receipt_reversal(uuid, text, text);
--   DROP TRIGGER tg_payment_allocations_receipt_open ON sal.payment_allocations;
--   DROP FUNCTION sal.guard_allocation_receipt_open();
--   DROP TRIGGER tg_receipt_reversals_applied ON sal.receipt_reversals;
--   DROP FUNCTION sal.guard_receipt_reversal_applied();
--   REVOKE UPDATE (decision_reason) ON sal.receipt_reversals FROM app_runtime;
--   DROP TRIGGER tg_receipt_reversals_approval ON sal.receipt_reversals;
--   CREATE TRIGGER tg_receipt_reversals_approval BEFORE UPDATE ON sal.receipt_reversals
--     FOR EACH ROW EXECUTE FUNCTION sal.guard_dual_control_approval();
--   DROP FUNCTION sal.guard_receipt_reversal_decision();
--   re-issue sal.stamp_dual_control_maker from
--   20260930110000_sal_credit_note_decisions.sql with its COMMENT and REVOKE;
--   DROP TRIGGER tg_receipt_reversals_request_rules ON sal.receipt_reversals;
--   DROP FUNCTION sal.guard_receipt_reversal_request();
--   restore the table COMMENT from 20260724092000_sal_payments.sql;
--   DROP INDEX sal.ix_receipt_reversals_receipt;
--   DROP INDEX sal.uq_receipt_reversals_receipt_live;
--   ALTER TABLE sal.receipt_reversals ADD CONSTRAINT uq_receipt_reversals_receipt
--     UNIQUE (tenant_id, company_id, branch_id, original_receipt_id);
--   ALTER TABLE sal.receipt_reversals
--     DROP CONSTRAINT ck_receipt_reversals_decision_reason,
--     DROP CONSTRAINT ck_receipt_reversals_rejected_by_other,
--     DROP CONSTRAINT ck_receipt_reversals_withdrawn_by_requester,
--     DROP CONSTRAINT ck_receipt_reversals_decided_only_when_declined,
--     DROP CONSTRAINT ck_receipt_reversals_approval_state;
--   ALTER TABLE sal.receipt_reversals ADD CONSTRAINT ck_receipt_reversals_approval_state
--     CHECK (approval_state IN ('pending', 'approved', 'rejected'));
--   ALTER TABLE sal.receipt_reversals DROP COLUMN decision_reason, DROP COLUMN decided_at,
--     DROP COLUMN decided_by;
-- ----------------------------------------------------------------------------
