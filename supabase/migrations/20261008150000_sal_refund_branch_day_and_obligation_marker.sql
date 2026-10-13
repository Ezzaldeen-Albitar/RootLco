-- ============================================================================
-- P1-32-PRE-OD-FRX — the refund payout day is the branch's own day, and a
-- refund obligation names the approval that created it.
-- Owner module: sal (billing and payments)
--
-- Rollback classification: ROLLBACK-SAFE. Three existing functions are
--   re-issued under their own names and signatures with their COMMENTs and
--   REVOKEs; no table, column, constraint, index, trigger, policy, grant, seed
--   or row changes, and no applied migration is edited. The inverse at the foot
--   of this file restores the three previous definitions.
--
-- Purpose (residuals of the CP-20261008-2 retest and the review of #537)
--
--   (a) THE PAYOUT DAY ON THE BRANCH CALENDAR. sal.guard_refund_request_update
--       refused a payout dated after current_date — the SERVER's calendar day.
--       The platform's convention (Owner decision D-17; period.ts,
--       overview-clock-repository.ts) is the branch-local day,
--       (now() AT TIME ZONE org.branches.timezone_name)::date. A branch whose
--       zone is ahead of the server was refused its own today, and a branch
--       behind it was admitted a day it had not reached. The guard now reads the
--       request's branch clock under the caller's own row-level security (the
--       caller already reached the request, in the same company and branch) and
--       refuses, as before, `refund_payout_date_invalid`; an unreadable branch
--       clock refuses rather than falling back to the server's. The application
--       check in RefundRepository reads the same day.
--
--   (b) THE OBLIGATION MARKER (defence in depth). sal.guard_refund_obligation_insert
--       binds an obligation to a note approved in the current transaction and to
--       its exact excess. Two notes approved in ONE transaction both pass the
--       first rule, and once the second is approved the arithmetic of a raw
--       INSERT for the first can match. sal.approve_credit_note now sets the
--       transaction-local setting sal.refund_obligation_credit_note to the note
--       around its one INSERT and clears it after (the precedent is
--       inv.material_request_id, 20260917099000), and the guard requires the
--       marker to name the row's credit note, as its LAST check so every other
--       refusal keeps its token: `refund_obligation_not_from_approval`.
--       This is defence in depth and NOT a security boundary: any session may
--       set a custom setting. The controls stay the guard's arithmetic, the
--       approval in this transaction, the grants and the forced row-level
--       security; the marker closes the same-transaction raw INSERT only.
--
-- Not changed: every other refund, credit-note and obligation rule, every
--   stored amount, approval limits (their effective dates still read
--   current_date, which this residual does not name).
--
-- Security implications
--   None widened. All three functions stay SECURITY INVOKER with an empty
--   search_path and EXECUTE revoked from PUBLIC (sal.approve_credit_note keeps
--   its grant to app_runtime from its first definition); each only refuses
--   more.
--
-- Dependencies
--   20261008121000 (sal.approve_credit_note), 20261008130000
--   (sal.guard_refund_obligation_insert), 20261008140000
--   (sal.guard_refund_request_update).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (a) sal.guard_refund_request_update — the payout day on the branch calendar
-- ----------------------------------------------------------------------------

-- Re-issued from 20261008140000_sal_refund_requests.sql. The only change: "not in
-- the future" is judged on the request branch's own calendar day.
CREATE OR REPLACE FUNCTION sal.guard_refund_request_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor uuid;
  v_executing boolean;
  v_branch_day date;
  v_ob sal.refund_obligations%ROWTYPE;
  v_paid numeric(18, 4);
BEGIN
  -- The request's facts never move.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.obligation_id IS DISTINCT FROM OLD.obligation_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.payee_partner_id IS DISTINCT FROM OLD.payee_partner_id OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'refund_request_frozen: refund request % keeps the facts it was raised with; raise a new request instead', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  v_executing := NEW.executed_at IS DISTINCT FROM OLD.executed_at
              OR NEW.executed_by IS DISTINCT FROM OLD.executed_by
              OR NEW.payout_reference IS DISTINCT FROM OLD.payout_reference
              OR NEW.payout_date IS DISTINCT FROM OLD.payout_date
              OR NEW.execution_idempotency_key IS DISTINCT FROM OLD.execution_idempotency_key;

  -- Paid out: everything is frozen.
  IF OLD.executed_at IS NOT NULL THEN
    IF v_executing OR NEW.approval_state IS DISTINCT FROM OLD.approval_state
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
      RAISE EXCEPTION 'refund_already_executed: refund request % was paid out and is frozen', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- A decided request's decision is frozen.
  IF OLD.approval_state <> 'pending' AND (
       NEW.approval_state IS DISTINCT FROM OLD.approval_state
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason) THEN
    RAISE EXCEPTION 'refund_decision_frozen: refund request % is % and its decision is frozen', OLD.id, OLD.approval_state
      USING ERRCODE = 'check_violation';
  END IF;

  v_actor := iam.current_user_id();

  -- The payout: once, on an approved request whose decision does not move.
  IF v_executing THEN
    IF OLD.approval_state <> 'approved' OR NEW.approval_state <> 'approved' THEN
      RAISE EXCEPTION 'refund_not_approved: refund request % is % and is paid out only once approved', OLD.id, OLD.approval_state
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'refund_request_no_user: a payout is recorded by a signed-in person' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT iam.has_permission_in_scope('sal.payment.record', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'refund_execute_permission_missing: recording the payout of refund request % requires sal.payment.record in its company and branch', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.payout_reference IS NULL OR btrim(NEW.payout_reference) = '' OR char_length(NEW.payout_reference) > 200 THEN
      RAISE EXCEPTION 'refund_payout_reference_required: a payout states its reference, in at most 200 characters'
        USING ERRCODE = 'check_violation';
    END IF;
    -- "Not in the future" on the BRANCH's calendar, not the server's (D-17: the
    -- branch-local day is (now() AT TIME ZONE org.branches.timezone_name)::date).
    -- A branch ahead of the server would otherwise be refused its own today, and
    -- one behind it admitted a day it has not reached. An unreadable branch clock
    -- refuses rather than falling back to the server's.
    SELECT (now() AT TIME ZONE b.timezone_name)::date INTO v_branch_day
      FROM org.branches b
     WHERE b.tenant_id = OLD.tenant_id AND b.company_id = OLD.company_id AND b.id = OLD.branch_id;
    IF NEW.payout_date IS NULL OR v_branch_day IS NULL OR NEW.payout_date > v_branch_day THEN
      RAISE EXCEPTION 'refund_payout_date_invalid: a payout states the day it was made, which is not in the future on the branch''s own calendar'
        USING ERRCODE = 'check_violation';
    END IF;
    -- No excess at payout either, under the obligation lock.
    SELECT * INTO v_ob FROM sal.refund_obligations ro
     WHERE ro.tenant_id = OLD.tenant_id AND ro.company_id = OLD.company_id
       AND ro.branch_id = OLD.branch_id AND ro.id = OLD.obligation_id
     FOR UPDATE;
    SELECT COALESCE(sum(rr.amount), 0) INTO v_paid FROM sal.refund_requests rr
     WHERE rr.tenant_id = OLD.tenant_id AND rr.company_id = OLD.company_id
       AND rr.branch_id = OLD.branch_id AND rr.obligation_id = OLD.obligation_id
       AND rr.approval_state = 'approved' AND rr.executed_at IS NOT NULL AND rr.id <> OLD.id;
    IF v_ob.state <> 'open' OR OLD.amount > v_ob.amount - v_paid THEN
      RAISE EXCEPTION 'refund_exceeds_obligation: paying out refund request % would exceed what is still owed on obligation %', OLD.id, OLD.obligation_id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.executed_by := v_actor;
    NEW.executed_at := now();
    RETURN NEW;
  END IF;

  -- Still pending: nothing of a decision may be written without deciding.
  IF NEW.approval_state = 'pending' THEN
    IF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.decided_by IS NOT NULL
       OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'refund_request_not_decided: refund request % is pending and carries no decision', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.approval_state <> 'pending' THEN
    -- Decided, not paid out, and nothing of the decision or payout moves.
    RETURN NEW;
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'refund_request_no_user: a decision is made by a signed-in person' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.approval_state = 'approved' THEN
    IF v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'refund_self_approval: the approver of a refund must differ from the person who requested it' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'refund_decision_reason_misplaced: only a rejection carries a decision reason' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT iam.has_permission_in_scope('sal.refund.approve', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'refund_approve_permission_missing: approving refund request % requires sal.refund.approve in its company and branch', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.approved_by := v_actor;
    NEW.approved_at := now();
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
  ELSIF NEW.approval_state = 'rejected' THEN
    IF v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'refund_self_rejection: refund request % is rejected by someone other than the person who requested it; the requester withdraws it instead', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT iam.has_permission_in_scope('sal.refund.approve', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'refund_reject_permission_missing: rejecting refund request % requires sal.refund.approve in its company and branch', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.decision_reason IS NULL OR btrim(NEW.decision_reason) = '' OR char_length(NEW.decision_reason) > 2000 THEN
      RAISE EXCEPTION 'refund_reject_reason_required: rejecting refund request % states why, in at most 2000 characters', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.decided_by := v_actor;
    NEW.decided_at := now();
  ELSIF NEW.approval_state = 'withdrawn' THEN
    IF v_actor <> OLD.requested_by THEN
      RAISE EXCEPTION 'refund_withdraw_not_requester: refund request % is withdrawn only by the person who requested it', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'refund_decision_reason_misplaced: only a rejection carries a decision reason' USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.decided_by := v_actor;
    NEW.decided_at := now();
  END IF;
  -- Any other value is refused by ck_refund_requests_approval_state.
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_request_update() IS
  'BEFORE UPDATE guard on sal.refund_requests (P1-32-PRE-OD-FD2B, ADR-023 D2; P1-32-PRE-OD-FRX), for every role. The facts a request was raised with never move (refund_request_frozen). pending -> approved: a person other than the requester (refund_self_approval) holding sal.refund.approve in the obligation''s company and branch (refund_approve_permission_missing); approver and time stamped. pending -> rejected: the same, with a reason (refund_reject_reason_required); decider stamped. pending -> withdrawn: the requester only (refund_withdraw_not_requester); decider stamped. A decided request''s decision is frozen (refund_decision_frozen). The payout is written once, on an approved request only (refund_not_approved), by a holder of sal.payment.record in the same scope (refund_execute_permission_missing), with a reference and a date not in the future on the branch''s own calendar (its timezone_name, P1-32-PRE-OD-FRX), within what is still owed on the open obligation under its row lock (refund_exceeds_obligation); executor and time stamped. A paid-out request is frozen (refund_already_executed). Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_request_update() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- (b) sal.approve_credit_note — the transaction-local obligation marker
-- ----------------------------------------------------------------------------

-- Re-issued from 20261008121000_sal_refund_obligations.sql. The only change: the
-- marker naming the note is set around the obligation INSERT and cleared after.
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
    -- Defence in depth (P1-32-PRE-OD-FRX): name the note whose obligation this is,
    -- for this transaction only, around the one INSERT that may cite it, and clear
    -- it at once. sal.guard_refund_obligation_insert requires the marker to name
    -- the row's credit note, so a raw INSERT later in the same transaction — when
    -- another note approved alongside it would make its arithmetic match — is
    -- refused. Not a security boundary: any session may set a custom setting, so
    -- the guard's arithmetic, the approval in this transaction and the grants
    -- remain the controls; the marker only closes the same-transaction case.
    PERFORM pg_catalog.set_config('sal.refund_obligation_credit_note', v_cn.id::text, true);
    INSERT INTO sal.refund_obligations (tenant_id, company_id, branch_id, partner_id, invoice_id, credit_note_id,
                                        currency_code, amount, source, created_by)
      VALUES (v_cn.tenant_id, v_cn.company_id, v_cn.branch_id, v_inv.payer_partner_id, v_inv.id, v_cn.id,
              v_cn.currency_code, v_excess, 'credit_excess', v_actor)
      RETURNING id INTO v_obligation;
    PERFORM pg_catalog.set_config('sal.refund_obligation_credit_note', '', true);
    INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
      VALUES (v_cn.tenant_id, v_cn.company_id, v_cn.branch_id, 'refund_obligation_recorded', 'refund_obligation', v_obligation,
              v_cn.currency_code, v_excess, v_actor, p_correlation_id, v_actor);
  END IF;
END; $$;
COMMENT ON FUNCTION sal.approve_credit_note(uuid, uuid) IS
  'Approves a pending credit note under dual control (P1-11; P1-32-PRE-OD-FIN, FD2A, FD2C). Locks the note, then the invoice; returns silently on an approved note; refuses a decided one, the requester and a currency mismatch. ADR-023 D2: refuses a credit above the issued invoice''s gross less the credits already approved (credit_note_exceeds_creditable); writes the credit_note_issued financial event; and when the credit exceeds what the invoice still owed just before it, records the excess as one sal.refund_obligations row with its refund_obligation_recorded event (P1-32-PRE-OD-FD2A), setting the transaction-local marker sal.refund_obligation_credit_note to the note around that one INSERT and clearing it after (P1-32-PRE-OD-FRX; defence in depth, not a security boundary). sal.guard_credit_note_decision holds the approver to sal.credit.approve and a credit-note approval limit (D13) and stamps the approver and dates.';

-- ----------------------------------------------------------------------------
-- (b) sal.guard_refund_obligation_insert — the marker must name the note
-- ----------------------------------------------------------------------------

-- Re-issued from 20261008130000_sal_refund_obligation_guards.sql. The only change:
-- after every other rule, the obligation's credit note must be the one the
-- transaction-local marker names.
CREATE OR REPLACE FUNCTION sal.guard_refund_obligation_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_cn sal.credit_notes%ROWTYPE;
  v_inv sal.invoices%ROWTYPE;
  v_gross numeric(18, 4);
  v_alloc numeric(18, 4);
  v_other numeric(18, 4);
  v_owed_before numeric(18, 4);
  v_expected numeric(18, 4);
  v_marker text := NULLIF(pg_catalog.current_setting('sal.refund_obligation_credit_note', true), '');
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
  -- The approval that creates an obligation is the one in this transaction:
  -- sal.guard_credit_note_decision stamps approved_at with now(). A note approved
  -- earlier was measured against what the invoice owed THEN, which this guard can
  -- no longer reconstruct, so it takes no obligation afterwards.
  IF v_cn.approved_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'refund_obligation_credit_not_current: credit note % was approved before this transaction, and an obligation is recorded only by the approval that creates it', v_cn.id
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
  -- never below zero. "Before it" is every approved credit but this one — which,
  -- now that the note was approved in this transaction, is what it owed at the
  -- approval.
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
  -- Last, so every other refusal keeps its own token (P1-32-PRE-OD-FRX). Only the
  -- approval that creates the obligation names its note in the transaction-local
  -- marker, around its one INSERT. Two notes approved in one transaction both
  -- pass the "approved in this transaction" rule above, and the arithmetic of a
  -- raw INSERT for the first can match once the second is approved; the marker
  -- is what refuses it. Defence in depth, not a security boundary.
  IF v_marker IS NULL OR v_marker IS DISTINCT FROM NEW.credit_note_id::text THEN
    RAISE EXCEPTION 'refund_obligation_not_from_approval: an obligation for credit note % is recorded only by the approval of that note, in the statement that approves it', NEW.credit_note_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_obligation_insert() IS
  'BEFORE INSERT guard on sal.refund_obligations (P1-32-PRE-OD-FD2A, ADR-023 D2; P1-32-PRE-OD-FD2B; P1-32-PRE-OD-FRX). For app_runtime and its login members stamps created_by and created_at; for every writer forces state open and record_version 1. Refuses an obligation whose credit note is not approved (refund_obligation_credit_not_approved), was approved before the current transaction (refund_obligation_credit_not_current: the approval stamps approved_at with now(), and sal.approve_credit_note records the obligation in that transaction, so a raw INSERT cannot attach one to an earlier credit) or names another invoice (refund_obligation_invoice_mismatch), whose customer is not the invoice''s (refund_obligation_partner_mismatch), whose currency is not the invoice''s (refund_obligation_currency_mismatch), whose amount is finer than the minor unit (refund_obligation_minor_unit) or is not exactly the credit''s excess over the invoice''s open receivable before it (refund_obligation_amount_mismatch); and, last, one the approval of its own note did not write: the transaction-local marker sal.refund_obligation_credit_note, which sal.approve_credit_note sets to the note around its INSERT and clears after, must name the row''s credit note (refund_obligation_not_from_approval; P1-32-PRE-OD-FRX, defence in depth and not a security boundary). Locks the invoice.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_obligation_insert() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Inverse (rehearsal copy only)
--
--   re-issue sal.guard_refund_request_update from
--   20261008140000_sal_refund_requests.sql with its COMMENT and REVOKE;
--   re-issue sal.approve_credit_note from
--   20261008121000_sal_refund_obligations.sql with its COMMENT;
--   re-issue sal.guard_refund_obligation_insert from
--   20261008130000_sal_refund_obligation_guards.sql with its COMMENT and REVOKE.
-- ----------------------------------------------------------------------------
