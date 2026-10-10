-- ============================================================================
-- P1-32-PRE-OD-FD2B (residuals of the FD2A review) — an obligation is born only
-- in the approval that creates it, and the D2 credit ceiling is held by the
-- credit-note decision trigger as well as by the approval primitive.
-- Owner module: sal (billing and payments)
--
-- Rollback classification: ROLLBACK-SAFE. Two trigger functions are re-issued
--   under their own names and signatures with their COMMENTs; no table, column,
--   constraint, index, grant or policy changes and no stored row is written,
--   moved or deleted. The inverse at the foot of this file restores both
--   previous definitions.
--
-- Purpose (Owner decision D2 of 2026-09-30, ADR-023; review of #536)
--
--   (a) AN OBLIGATION BELONGS TO THE APPROVAL THAT CREATED IT.
--       sal.guard_refund_obligation_insert bound a raw INSERT to an approved
--       credit note and to the excess of that note over what the invoice owed
--       "before it" — every approved credit but this one. For a note approved in
--       an EARLIER transaction that figure is not what the invoice owed when it
--       was approved, so a raw INSERT could attach an obligation to it. The
--       reviewer's case: gross 100; credit A of 50 approved while nothing was
--       paid (no excess, no obligation); a receipt of 50; credit B of 50 approved
--       and correctly owed back in full (obligation 50). A raw INSERT of 50 for A
--       then matched the guard's arithmetic (50 less max(100 - 50 - 50, 0)) and
--       would have doubled what the customer is owed. From this migration the
--       guard also requires the credit note to have been approved IN THE CURRENT
--       TRANSACTION: its approved_at, which sal.guard_credit_note_decision stamps
--       with now() at the approval, equals now(). sal.approve_credit_note inserts
--       the obligation in the approving transaction, so the only writer is
--       unchanged; a note approved before is refused as
--       `refund_obligation_credit_not_current`.
--
--   (b) THE CEILING IN THE DECISION TRIGGER. sal.approve_credit_note refuses a
--       credit above the issued invoice's gross less the credits already
--       approved (credit_note_exceeds_creditable), but a raw UPDATE of
--       approval_state — which app_runtime may write, and which the decision
--       trigger otherwise admits for a holder of sal.credit.approve within a
--       limit — reached the approved state without that check. The trigger now
--       makes it too, under the invoice row lock it already takes, with the same
--       token, before the approval-limit rules. The primitive's own check is
--       unchanged; the trigger is the backstop for every writer.
--
-- Not changed: refund requests (the next migration), every stored amount, the
--   D13 approval-limit rules, rejection and withdrawal.
--
-- Security implications
--   None widened. Both functions stay SECURITY INVOKER with an empty
--   search_path and EXECUTE revoked from PUBLIC; both only refuse more.
--
-- Dependencies
--   20261001090000 (sal.guard_credit_note_decision), 20261008121000
--   (sal.refund_obligations and sal.guard_refund_obligation_insert).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (a) sal.guard_refund_obligation_insert — the note was approved in this
--     transaction
-- ----------------------------------------------------------------------------

-- Re-issued from 20261008121000_sal_refund_obligations.sql. The only change: an
-- obligation cites a credit note approved in the current transaction.
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
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_obligation_insert() IS
  'BEFORE INSERT guard on sal.refund_obligations (P1-32-PRE-OD-FD2A, ADR-023 D2; P1-32-PRE-OD-FD2B). For app_runtime and its login members stamps created_by and created_at; for every writer forces state open and record_version 1. Refuses an obligation whose credit note is not approved (refund_obligation_credit_not_approved), was approved before the current transaction (refund_obligation_credit_not_current: the approval stamps approved_at with now(), and sal.approve_credit_note records the obligation in that transaction, so a raw INSERT cannot attach one to an earlier credit) or names another invoice (refund_obligation_invoice_mismatch), whose customer is not the invoice''s (refund_obligation_partner_mismatch), whose currency is not the invoice''s (refund_obligation_currency_mismatch), whose amount is finer than the minor unit (refund_obligation_minor_unit) or is not exactly the credit''s excess over the invoice''s open receivable before it (refund_obligation_amount_mismatch). Locks the invoice.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_obligation_insert() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- (b) sal.guard_credit_note_decision — the D2 ceiling for every writer
-- ----------------------------------------------------------------------------

-- Re-issued from 20261001090000_sal_credit_approval_limits.sql. The only change:
-- on pending -> approved, after the invoice row lock, the note's amount is held to
-- the issued invoice's gross less the credits already approved on it
-- (credit_note_exceeds_creditable), so a raw UPDATE of approval_state cannot
-- exceed the ceiling sal.approve_credit_note enforces.
CREATE OR REPLACE FUNCTION sal.guard_credit_note_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor uuid;
  v_limit_amount numeric(18, 4);
  v_limit_currency text;
  v_limit_creator uuid;
  v_approved numeric(18, 4);
  v_status text;
  v_gross numeric(18, 4);
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

    -- D13: the approval permission, in the note's own company and branch.
    IF NOT iam.has_permission_in_scope('sal.credit.approve', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'credit_approval_permission_missing: approving credit note % requires sal.credit.approve in its company and branch', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- D13: decisions on the notes of one invoice serialise on the invoice row,
    -- the lock sal.approve_credit_note already holds for the credit ceiling.
    -- Taken before the approved total is read, so the total below includes
    -- every approval that committed while this one waited.
    SELECT i.status INTO v_status FROM sal.invoices i
      WHERE i.tenant_id = OLD.tenant_id AND i.company_id = OLD.company_id
        AND i.branch_id = OLD.branch_id AND i.id = OLD.invoice_id
      FOR UPDATE;

    -- Every approved credit on the invoice but this note, read under that lock;
    -- the D2 ceiling and the D13 limit both count it.
    SELECT COALESCE(sum(cn.amount), 0) INTO v_approved
      FROM sal.credit_notes cn
     WHERE cn.tenant_id = OLD.tenant_id AND cn.company_id = OLD.company_id
       AND cn.branch_id = OLD.branch_id AND cn.invoice_id = OLD.invoice_id
       AND cn.approval_state = 'approved' AND cn.id <> OLD.id;

    -- D2 (P1-32-PRE-OD-FD2B): at most the issued invoice's gross less the credits
    -- already approved, the ceiling sal.approve_credit_note applies, held here for
    -- a raw UPDATE of approval_state too.
    IF v_status IN ('issued', 'credited') THEN
      SELECT a.gross_total INTO v_gross FROM sal.invoice_amounts a
       WHERE a.tenant_id = OLD.tenant_id AND a.company_id = OLD.company_id
         AND a.branch_id = OLD.branch_id AND a.invoice_id = OLD.invoice_id AND a.deleted_at IS NULL;
    END IF;
    v_gross := COALESCE(v_gross, 0);
    IF OLD.amount > v_gross - v_approved THEN
      RAISE EXCEPTION 'credit_note_exceeds_creditable: credit % exceeds the % invoice % can still be credited', OLD.amount, v_gross - v_approved, OLD.invoice_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- D13: the approver's credit-note limit, by the discount rule — own before a
    -- role's, a role whose active grant reaches the company, in force today,
    -- never one the approver created — consulted in the note's currency. The
    -- ordering puts a limit that counts first, so the row found says which
    -- rule refuses when none does.
    SELECT al.amount, al.currency_code, al.created_by
      INTO v_limit_amount, v_limit_currency, v_limit_creator
      FROM iam.approval_limits al
     WHERE al.tenant_id = OLD.tenant_id AND al.company_id = OLD.company_id
       AND al.limit_type = 'credit_note'
       AND al.effective_from <= current_date
       AND (al.effective_to IS NULL OR al.effective_to > current_date)
       AND (al.user_id = v_actor
            OR (al.user_id IS NULL AND al.role_id IN (
                  SELECT g.role_id
                    FROM iam.role_grants g
                   WHERE g.tenant_id = OLD.tenant_id AND g.user_id = v_actor
                     AND g.status = 'active'
                     AND g.valid_from <= now()
                     AND (g.valid_to IS NULL OR g.valid_to > now())
                     AND (
                       g.scope_mode = 'unrestricted'
                       OR EXISTS (
                         SELECT 1 FROM iam.grant_scopes s
                          WHERE s.tenant_id = g.tenant_id AND s.grant_id = g.id
                            AND s.company_id = OLD.company_id
                       )
                     ))))
     ORDER BY (al.created_by <> v_actor) DESC,
              (al.currency_code = OLD.currency_code) DESC,
              (al.user_id IS NOT NULL) DESC,
              al.amount DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'credit_no_approval_limit: the approver of credit note % has no credit-note approval limit in this company', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_limit_creator = v_actor THEN
      RAISE EXCEPTION 'credit_limit_self_created: the approver of credit note % holds only credit-note limits they set themselves, which never count', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_limit_currency <> OLD.currency_code THEN
      RAISE EXCEPTION 'credit_limit_currency_mismatch: the approver of credit note % has no credit-note approval limit in %', OLD.id, OLD.currency_code
        USING ERRCODE = 'check_violation';
    END IF;

    -- D13 anti-splitting: the limit covers every approved credit on the invoice,
    -- this note included.
    IF v_approved + OLD.amount > v_limit_amount THEN
      RAISE EXCEPTION 'credit_limit_exceeded: approving credit note % would take the approved credit on its invoice past the approver''s limit', OLD.id
        USING ERRCODE = 'check_violation';
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
    IF NOT iam.has_permission_in_scope('sal.credit.approve', OLD.company_id, OLD.branch_id, NULL) THEN
      RAISE EXCEPTION 'credit_note_reject_permission_missing: rejecting credit note % requires sal.credit.approve in its company and branch', OLD.id
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
  'BEFORE UPDATE guard on sal.credit_notes (P1-32-PRE-OD-FD2A, D3; P1-32-PRE-OD-FD2C, D13; P1-32-PRE-OD-FD2B, D2). pending -> approved: approver stamped, different from the requester, holding sal.credit.approve in the note''s company and branch, under the invoice row lock, within the D2 ceiling — the issued invoice''s gross less the credits already approved on it (credit_note_exceeds_creditable), for every writer and not only sal.approve_credit_note — and with a credit_note approval limit in the note''s currency that the approver did not create (own before role) covering every approved credit on the invoice including this note; approved_at and issued_at stamped with now(). pending -> rejected: a different person holding sal.credit.approve in the note''s company and branch, with a reason (not blank, at most 2000 characters); decider stamped. pending -> withdrawn: the requester only; decider stamped. A decided note is frozen: state, approver, decider, dates, decision reason and amount. Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_credit_note_decision() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Inverse (rehearsal copy only)
--
--   re-issue sal.guard_credit_note_decision from
--   20261001090000_sal_credit_approval_limits.sql with its COMMENT and REVOKE;
--   re-issue sal.guard_refund_obligation_insert from
--   20261008121000_sal_refund_obligations.sql with its COMMENT and REVOKE.
-- ----------------------------------------------------------------------------
