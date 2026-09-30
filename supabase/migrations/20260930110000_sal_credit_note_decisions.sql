-- ============================================================================
-- P1-32-PRE-OD-FD2A — credit-note withdrawal and rejection, and frozen dates.
-- Owner module: sal (billing and payments)
--
-- Rollback classification: ROLLBACK-SAFE WITH DATA NOTE. Three nullable
--   columns are added to sal.credit_notes, one CHECK is widened and four are
--   added; one trigger function is added and the credit-note approval trigger
--   is re-pointed at it; three functions are added and five are re-issued with
--   the same names and signatures (one of them the shared BEFORE INSERT maker
--   stamp, which now also births every credit note pending and undecided); two column grants are narrowed and one is
--   added. No row is written, moved or deleted. The inverse at the foot of this
--   file restores every previous definition; the data note is that a note
--   withdrawn or rejected after this migration keeps its state only while the
--   widened CHECK stands, so the inverse first refuses to run while any
--   withdrawn note exists.
--
-- Purpose (Owner decisions D3 and D9 of 2026-09-30, ADR-023; finance review
-- GAP-03, GAP-12, and the residual found in the review of #486)
--
--   D3  A pending credit note could be approved and nothing else: the schema
--       admitted 'rejected' but no primitive reached it, so a mistaken or
--       duplicate request stayed "waiting for a second person" forever. From
--       this migration:
--         * the REQUESTER may WITHDRAW their own pending request
--           (sal.withdraw_credit_note);
--         * a DIFFERENT person holding sal.credit.manage in the note's company
--           and branch may REJECT it, with a reason that is not blank and at
--           most 2000 characters (sal.reject_credit_note);
--         * approved, rejected and withdrawn are TERMINAL: every later change to
--           the state, the decider, the decision time, the reason for the
--           decision or the issue date is refused for every role that can still
--           write the row.
--       The rules live in the BEFORE UPDATE trigger sal.guard_credit_note_decision,
--       so a raw UPDATE is held to them exactly as the primitives are. The
--       decider and the decision time are stamped from the session by the
--       trigger (decided_by, decided_at); a caller never supplies them. A raw
--       INSERT cannot bypass that trigger either: the BEFORE INSERT stamp
--       sal.stamp_dual_control_maker (re-issued in section 2a) births every
--       credit note 'pending' with no decider, decision time, decision reason or
--       issue date, whatever the statement names, so the only way to a decision
--       is an UPDATE the guard sees.
--       Withdrawn and rejected notes credit nothing: every credited figure
--       counts approval_state = 'approved' only, so the open receivable and the
--       derived credit status (D7) are unchanged by either decision.
--
--   D9  A return credit counts earlier returns of the same line while their note
--       still stands. A withdrawn note no longer stands, exactly like a rejected
--       one, so sal.request_return_credit_note now leaves out both.
--
--   Frozen dates (review of #486). app_runtime could still UPDATE issued_at on
--   an approved credit note and reversed_at on an approved receipt reversal, so
--   either date could be backdated after the decision. Both are now stamped by
--   the trigger at the moment of approval, frozen afterwards, and no longer
--   granted to the runtime login at all: the two approve primitives no longer
--   name them. sal.receipts and sal.payment_allocations carry no reversal date
--   of their own; a reversal is recorded only in sal.receipt_reversals, whose
--   reverser is approved_by, already frozen once decided.
--
-- Not changed here: the credit ceiling (D2), credit-approval limits (D13), the
-- receipt-reversal request (D4), and every stored amount.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The decision columns, the widened state vocabulary and its shape
-- ----------------------------------------------------------------------------

ALTER TABLE sal.credit_notes
  ADD COLUMN decided_by      uuid        NULL,
  ADD COLUMN decided_at      timestamptz NULL,
  ADD COLUMN decision_reason text        NULL;

COMMENT ON COLUMN sal.credit_notes.decided_by IS
  'Who withdrew or rejected the request (P1-32-PRE-OD-FD2A, D3). Stamped from the session by sal.guard_credit_note_decision; never supplied by a caller. The requester for a withdrawal, a different person for a rejection. NULL while pending and on an approved note, whose approver is approved_by.';
COMMENT ON COLUMN sal.credit_notes.decided_at IS
  'When the request was withdrawn or rejected (P1-32-PRE-OD-FD2A, D3). Stamped by sal.guard_credit_note_decision and frozen afterwards.';
COMMENT ON COLUMN sal.credit_notes.decision_reason IS
  'Why the request was rejected (P1-32-PRE-OD-FD2A, D3). Required for a rejection, not blank, at most 2000 characters; absent on every other state. Frozen once written.';

ALTER TABLE sal.credit_notes DROP CONSTRAINT ck_credit_notes_approval_state;
ALTER TABLE sal.credit_notes
  ADD CONSTRAINT ck_credit_notes_approval_state
    CHECK (approval_state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  -- Only a withdrawal or a rejection names a decider in these columns.
  ADD CONSTRAINT ck_credit_notes_decided_only_when_declined
    CHECK (approval_state IN ('rejected', 'withdrawn') OR (decided_by IS NULL AND decided_at IS NULL)),
  -- A withdrawal is the requester's own act, and is stamped.
  ADD CONSTRAINT ck_credit_notes_withdrawn_by_requester
    CHECK (approval_state <> 'withdrawn' OR (decided_by = requested_by AND decided_at IS NOT NULL)),
  -- A rejection is a different person's act.
  ADD CONSTRAINT ck_credit_notes_rejected_by_other
    CHECK (approval_state <> 'rejected' OR decided_by IS NULL OR decided_by <> requested_by),
  -- A reason for the decision belongs to a rejection only, and says something.
  ADD CONSTRAINT ck_credit_notes_decision_reason
    CHECK (decision_reason IS NULL
           OR (approval_state = 'rejected' AND btrim(decision_reason) <> '' AND char_length(decision_reason) <= 2000));

-- ----------------------------------------------------------------------------
-- 2. The decision guard: transitions, deciders and frozen dates
-- ----------------------------------------------------------------------------

-- Replaces sal.guard_dual_control_approval on sal.credit_notes only; the receipt
-- reversal keeps that function (re-issued in section 4). Each refusal carries a
-- stable token before the colon, so the application can name the rule without
-- reading anything else of the message.
CREATE FUNCTION sal.guard_credit_note_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_actor uuid;
BEGIN
  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'dual control: sal.credit_notes request is frozen once raised (column requested_by); raise a new request instead'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A decided note is frozen: its state, its decider, its dates and its reason.
  IF OLD.approval_state <> 'pending' THEN
    IF NEW.approval_state IS DISTINCT FROM OLD.approval_state
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
       OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'credit_note_decision_frozen: credit note % is % and its decision is frozen', OLD.id, OLD.approval_state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Still pending: nothing of a decision may be written without deciding.
  IF NEW.approval_state = 'pending' THEN
    IF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.issued_at IS NOT NULL
       OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'credit_note_not_decided: credit note % is pending and carries no decision, date or decision reason', OLD.id
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
      RAISE EXCEPTION 'dual control: the approver must differ from the requester (maker<>approver)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'credit_note_decision_reason_misplaced: only a rejection carries a decision reason' USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := v_actor;
    NEW.approved_at := now();
    NEW.issued_at := now();
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
  ELSIF NEW.approval_state = 'rejected' THEN
    IF v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'credit_note_self_rejection: credit note % is rejected by someone other than the person who requested it; the requester withdraws it instead', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT iam.has_permission_in_scope('sal.credit.manage', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'credit_note_reject_permission_missing: rejecting credit note % requires sal.credit.manage in its company and branch', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.decision_reason IS NULL OR btrim(NEW.decision_reason) = '' OR char_length(NEW.decision_reason) > 2000 THEN
      RAISE EXCEPTION 'credit_note_reject_reason_required: rejecting credit note % states why, in at most 2000 characters', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.issued_at := NULL;
    NEW.decided_by := v_actor;
    NEW.decided_at := now();
  ELSIF NEW.approval_state = 'withdrawn' THEN
    IF v_actor <> OLD.requested_by THEN
      RAISE EXCEPTION 'credit_note_withdraw_not_requester: credit note % is withdrawn only by the person who requested it', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'credit_note_decision_reason_misplaced: only a rejection carries a decision reason' USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.issued_at := NULL;
    NEW.decided_by := v_actor;
    NEW.decided_at := now();
  END IF;
  -- Any other value is refused by ck_credit_notes_approval_state.
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_credit_note_decision() IS
  'BEFORE UPDATE guard on sal.credit_notes (P1-32-PRE-OD-FD2A, D3). pending -> approved: approver stamped, different from the requester, issued_at stamped. pending -> rejected: a different person holding sal.credit.manage in the note''s company and branch, with a reason (not blank, at most 2000 characters); decider stamped. pending -> withdrawn: the requester only; decider stamped. A decided note is frozen: state, approver, decider, dates, decision reason and amount. Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_credit_note_decision() FROM PUBLIC;

DROP TRIGGER tg_credit_notes_approval ON sal.credit_notes;
CREATE TRIGGER tg_credit_notes_approval BEFORE UPDATE ON sal.credit_notes
  FOR EACH ROW EXECUTE FUNCTION sal.guard_credit_note_decision();

-- The runtime login writes the state and, for a rejection, its reason. Every
-- date and every decider is assigned by the trigger, and a column a trigger
-- assigns needs no privilege of the caller.
REVOKE UPDATE (issued_at) ON sal.credit_notes FROM app_runtime;
GRANT UPDATE (decision_reason) ON sal.credit_notes TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2a. Every credit note is born pending and undecided
-- ----------------------------------------------------------------------------

-- Re-issued from 20260724092000_sal_payments.sql. The guard above is BEFORE
-- UPDATE only, and app_runtime holds table-level INSERT on sal.credit_notes,
-- which covers the decision columns added in section 1. Without this, one raw
-- INSERT naming approval_state 'rejected' or 'withdrawn' with a chosen decider,
-- a backdated decision time and a reason would create a note terminal from
-- birth that no decision rule ever saw. The stamp is shared with
-- sal.receipt_reversals, whose behaviour is unchanged; for sal.credit_notes it
-- now also forces the state to 'pending' and clears every decision field and
-- the issue date. It overrides rather than refuses, exactly as it already does
-- for requested_by, approved_by and approved_at.
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
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.stamp_dual_control_maker() IS
  'BEFORE INSERT stamp on sal.credit_notes and sal.receipt_reversals: requested_by from the session, approver fields cleared. On sal.credit_notes it also forces approval_state = pending and clears issued_at, decided_by, decided_at and decision_reason (P1-32-PRE-OD-FD2A, D3), so a decision is reached only through an UPDATE that sal.guard_credit_note_decision sees.';
REVOKE EXECUTE ON FUNCTION sal.stamp_dual_control_maker() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. The primitives: approve (re-issued), withdraw and reject (new)
-- ----------------------------------------------------------------------------

-- Re-issued from 20260930090000_sal_finance_controls.sql. The only change: the
-- UPDATE no longer names issued_at, which the trigger now stamps.
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
  UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = p_credit_id; -- trigger stamps approved_by, approved_at, issued_at
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_cn.tenant_id, v_cn.company_id, v_cn.branch_id, 'credit_note_issued', 'credit_note', v_cn.id, v_cn.currency_code, v_cn.amount, v_actor, p_correlation_id, v_actor);
END; $$;
REVOKE EXECUTE ON FUNCTION sal.approve_credit_note(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.approve_credit_note(uuid, uuid) TO app_runtime;

-- The requester withdraws their own pending request. Idempotent for the
-- requester on a note they already withdrew; refused for anyone else and for
-- any other decided state. No financial event: a withdrawn note never credited.
CREATE FUNCTION sal.withdraw_credit_note(p_credit_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_cn sal.credit_notes%ROWTYPE; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_cn FROM sal.credit_notes WHERE id = p_credit_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.withdraw_credit_note: credit note % not found in scope', p_credit_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (the decider cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_cn.requested_by <> v_actor THEN
    RAISE EXCEPTION 'credit_note_withdraw_not_requester: credit note % is withdrawn only by the person who requested it', p_credit_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_cn.approval_state = 'withdrawn' THEN RETURN; END IF; -- idempotent for the requester
  IF v_cn.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'credit_note_decision_frozen: credit note % is % and its decision is frozen', p_credit_id, v_cn.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.credit_notes SET approval_state = 'withdrawn' WHERE id = p_credit_id; -- trigger stamps decided_by, decided_at
END; $$;
COMMENT ON FUNCTION sal.withdraw_credit_note(uuid) IS
  'The requester withdraws their own pending credit note (P1-32-PRE-OD-FD2A, D3). Locks the note; refuses anyone but the requester (credit_note_withdraw_not_requester) and any decided state (credit_note_decision_frozen); returns silently for the requester on a note already withdrawn. The decider and time are stamped by sal.guard_credit_note_decision.';
REVOKE EXECUTE ON FUNCTION sal.withdraw_credit_note(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.withdraw_credit_note(uuid) TO app_runtime;

-- A different person holding sal.credit.manage in the note's company and branch
-- rejects a pending request, with a reason. Idempotent on a note already
-- rejected; refused for the requester and for any other decided state. No
-- financial event: a rejected note never credited.
CREATE FUNCTION sal.reject_credit_note(p_credit_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_cn sal.credit_notes%ROWTYPE; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT * INTO v_cn FROM sal.credit_notes WHERE id = p_credit_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.reject_credit_note: credit note % not found in scope', p_credit_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'dual control: no user context (the decider cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_cn.requested_by = v_actor THEN
    RAISE EXCEPTION 'credit_note_self_rejection: credit note % is rejected by someone other than the person who requested it; the requester withdraws it instead', p_credit_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_cn.approval_state = 'rejected' THEN RETURN; END IF; -- idempotent
  IF v_cn.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'credit_note_decision_frozen: credit note % is % and its decision is frozen', p_credit_id, v_cn.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.credit_notes SET approval_state = 'rejected', decision_reason = p_reason WHERE id = p_credit_id; -- trigger checks the permission and the reason, stamps decided_by, decided_at
END; $$;
COMMENT ON FUNCTION sal.reject_credit_note(uuid, text) IS
  'A different person rejects a pending credit note with a reason (P1-32-PRE-OD-FD2A, D3). Locks the note; refuses the requester (credit_note_self_rejection) and any other decided state (credit_note_decision_frozen); returns silently on a note already rejected. sal.guard_credit_note_decision checks sal.credit.manage in the note''s company and branch and the reason, and stamps the decider and time.';
REVOKE EXECUTE ON FUNCTION sal.reject_credit_note(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.reject_credit_note(uuid, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 4. The receipt reversal's dates: stamped at approval, then frozen
-- ----------------------------------------------------------------------------

-- Re-issued from 20260930090000_sal_finance_controls.sql; now used by
-- sal.receipt_reversals only. Two changes: reversed_at is stamped with the
-- approval rather than written by the caller, and a decided reversal's
-- approved_at and reversed_at are frozen with the rest of its decision.
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
    NEW.reversed_at := now();
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'dual control: no user context (approved_by cannot be stamped)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.approved_by = OLD.requested_by THEN
      RAISE EXCEPTION 'dual control: the approver must differ from the requester (maker<>approver)' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.approval_state = 'pending' AND NEW.approval_state = 'rejected' THEN
    NEW.approved_by := iam.current_user_id();
    NEW.approved_at := now();
    NEW.reversed_at := NULL;
  ELSIF OLD.approval_state = 'pending' THEN
    IF NEW.reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'dual control: a pending reversal carries no reversal date' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.approval_state <> OLD.approval_state OR NEW.requested_by <> OLD.requested_by
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.amount <> OLD.amount
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
      RAISE EXCEPTION 'dual control: a % decision is frozen', OLD.approval_state USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_dual_control_approval() FROM PUBLIC;

-- Re-issued from 20260930090000_sal_finance_controls.sql. The only change: the
-- UPDATE no longer names reversed_at, which the trigger now stamps.
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
  UPDATE sal.receipt_reversals SET approval_state = 'approved' WHERE id = p_reversal_id; -- trigger stamps approved_by, approved_at, reversed_at
  UPDATE sal.receipts SET status = 'reversed' WHERE id = v_rcpt.id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rev.tenant_id, v_rev.company_id, v_rev.branch_id, 'receipt_reversed', 'receipt_reversal', v_rev.id, v_rev.currency_code, v_rev.amount, v_actor, p_correlation_id, v_actor);
END; $$;
REVOKE EXECUTE ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.approve_receipt_reversal(uuid, uuid) TO app_runtime;

REVOKE UPDATE (reversed_at) ON sal.receipt_reversals FROM app_runtime;

-- ----------------------------------------------------------------------------
-- 5. Return credits: a withdrawn note no longer stands (D9)
-- ----------------------------------------------------------------------------

-- Re-issued from 20260930100000_sal_minor_unit_rounding.sql. The only change:
-- earlier returns count while their note is neither rejected nor withdrawn.
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
     AND cn.approval_state NOT IN ('rejected', 'withdrawn');
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
-- Inverse (ROLLBACK-SAFE WITH DATA NOTE — run only while no credit note is
-- withdrawn; a withdrawn note has no state in the previous vocabulary)
--
--   Re-issue sal.stamp_dual_control_maker from 20260724092000_sal_payments.sql
--   (with its REVOKE; COMMENT ON FUNCTION sal.stamp_dual_control_maker() IS NULL),
--   sal.request_return_credit_note from
--   20260930100000_sal_minor_unit_rounding.sql, and sal.approve_credit_note,
--   sal.approve_receipt_reversal and sal.guard_dual_control_approval from
--   20260930090000_sal_finance_controls.sql, each with its REVOKE and GRANT, then:
--   GRANT UPDATE (reversed_at) ON sal.receipt_reversals TO app_runtime;
--   DROP FUNCTION sal.reject_credit_note(uuid, text);
--   DROP FUNCTION sal.withdraw_credit_note(uuid);
--   REVOKE UPDATE (decision_reason) ON sal.credit_notes FROM app_runtime;
--   GRANT UPDATE (issued_at) ON sal.credit_notes TO app_runtime;
--   DROP TRIGGER tg_credit_notes_approval ON sal.credit_notes;
--   CREATE TRIGGER tg_credit_notes_approval BEFORE UPDATE ON sal.credit_notes
--     FOR EACH ROW EXECUTE FUNCTION sal.guard_dual_control_approval();
--   DROP FUNCTION sal.guard_credit_note_decision();
--   ALTER TABLE sal.credit_notes
--     DROP CONSTRAINT ck_credit_notes_decision_reason,
--     DROP CONSTRAINT ck_credit_notes_rejected_by_other,
--     DROP CONSTRAINT ck_credit_notes_withdrawn_by_requester,
--     DROP CONSTRAINT ck_credit_notes_decided_only_when_declined,
--     DROP CONSTRAINT ck_credit_notes_approval_state;
--   ALTER TABLE sal.credit_notes ADD CONSTRAINT ck_credit_notes_approval_state
--     CHECK (approval_state IN ('pending', 'approved', 'rejected'));
--   ALTER TABLE sal.credit_notes DROP COLUMN decision_reason, DROP COLUMN decided_at,
--     DROP COLUMN decided_by;
-- ----------------------------------------------------------------------------
