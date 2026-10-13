-- ============================================================================
-- P1-32-PRE-OD-FD2C — credit-approval permission and credit-note approval limits.
-- Owner module: sal (billing and payments), iam (approval limits)
--
-- Rollback classification: ROLLBACK-SAFE WITH DATA NOTE. Two exclusion
--   constraints on iam.approval_limits are re-created under their own names
--   with one more key; one trigger function and its BEFORE INSERT trigger are
--   added on iam.approval_limits; the credit-note decision guard
--   (sal.guard_credit_note_decision) is re-issued with the same name and
--   signature; two function comments are rewritten. No row is written, moved
--   or deleted, and no grant or policy changes. The inverse at the foot of this
--   file restores every previous definition; the data note is that the
--   narrower exclusion constraints can be restored only while no subject holds
--   two overlapping credit-note limits in different currencies, so the inverse
--   first refuses to run while such a pair exists.
--
-- Purpose (Owner decision D13 of 2026-09-30, ADR-023; finance review M-02)
--
--   Before this migration a credit note had no amount authority: any holder of
--   sal.credit.manage who was not the requester approved any amount, while a
--   discount was held to iam.approval_limits. From this migration:
--
--     * APPROVING A CREDIT NOTE NEEDS ITS OWN PERMISSION. The approver holds
--       sal.credit.approve in the note's company and branch
--       (iam.has_permission_in_scope); sal.credit.manage stays the code that
--       requests a credit note and that the requester withdraws with. Refused
--       as `credit_approval_permission_missing`.
--
--     * REJECTING ONE NEEDS THE SAME PERMISSION (D3 as amended by D13). Only an
--       authorised decision-maker turns a request down, so the rejection branch
--       of the guard now checks sal.credit.approve instead of sal.credit.manage.
--       No limit is needed to reject: a rejection never credits anything.
--
--     * AN APPROVAL NEEDS A CREDIT-NOTE LIMIT THAT COUNTS. The limit is an
--       iam.approval_limits row of the limit type `credit_note`, which is
--       separate from every discount type: a discount limit never counts for a
--       credit note and a credit-note limit never counts for a discount. It is
--       resolved by the rule the discount approval already uses — the approver's
--       own limit before a role's, a role whose active grant reaches the
--       company, in force today, and never a limit the approver created — with
--       one difference: a subject may now hold one credit-note limit PER
--       CURRENCY, and the limit in the note's currency is the one consulted.
--       Refused as `credit_no_approval_limit` (none at all),
--       `credit_limit_self_created` (only limits the approver created),
--       `credit_limit_currency_mismatch` (none in the note's currency).
--
--     * THE LIMIT COVERS THE INVOICE, NOT THE NOTE (anti-splitting). The limit
--       must cover the cumulative approved credit on the same invoice INCLUDING
--       the note being approved: every other note on the invoice in the state
--       `approved` (pending, rejected and withdrawn notes credit nothing and do
--       not count). Splitting one large credit into several small notes cannot
--       pass a low limit. Refused as `credit_limit_exceeded`.
--
--     * CONCURRENT APPROVALS SERIALISE ON THE INVOICE. The guard takes the
--       invoice row lock — the same lock sal.approve_credit_note takes for the
--       credit ceiling of #486, in the same order (note, then invoice) — before
--       it reads the approved total, so two approvals of two notes on one
--       invoice cannot each pass the limit on a total that omits the other.
--
--     * A LIMIT IS MONEY IN ITS CURRENCY (D1 carried over). A new limit of any
--       type must fit its currency's minor unit (shared.currencies.minor_unit),
--       and a credit-note limit must be above zero
--       (iam.guard_approval_limit_money). Rows already stored are not touched.
--
--   Every rule lives in the database, whoever issues the UPDATE, so a raw
--   UPDATE by app_runtime is held to them exactly as the primitive is. Each
--   refusal carries a stable token before the first colon, which the
--   application reads to name the rule.
--
-- Not changed here: the credit ceiling (#486), the requester-only withdrawal
-- (D3), refunds (D2), receipt reversals (D4), and every stored amount.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One credit-note limit per subject, company and CURRENCY
-- ----------------------------------------------------------------------------

-- Re-created under their own names. Every limit type but `credit_note` keeps
-- exactly the key it had (the currency expression is the same constant for
-- all of them); a credit-note limit adds its currency to the key, so a role
-- may hold a JOD and a USD credit-note limit at once, and never two in the
-- same currency at once.
ALTER TABLE iam.approval_limits DROP CONSTRAINT ex_approval_limits_role_no_overlap;
ALTER TABLE iam.approval_limits DROP CONSTRAINT ex_approval_limits_user_no_overlap;
ALTER TABLE iam.approval_limits
  ADD CONSTRAINT ex_approval_limits_role_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =, company_id WITH =, role_id WITH =, limit_type WITH =,
      (CASE WHEN limit_type = 'credit_note' THEN currency_code ELSE '' END) WITH =,
      daterange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (role_id IS NOT NULL),
  ADD CONSTRAINT ex_approval_limits_user_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =, company_id WITH =, user_id WITH =, limit_type WITH =,
      (CASE WHEN limit_type = 'credit_note' THEN currency_code ELSE '' END) WITH =,
      daterange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (user_id IS NOT NULL);

COMMENT ON TABLE iam.approval_limits IS
  'Effective-dated monetary approval ceilings (P1-04-DB-010). Exactly one subject (role XOR user). amount is NUMERIC(18,4) — never float — and a new row fits its currency''s minor unit (P1-32-PRE-OD-FD2C). Non-overlapping intervals per (company, subject, limit_type) make point-in-time resolution single-valued; a credit_note limit is keyed by its currency as well, so one subject holds at most one credit-note limit per currency at a time (ADR-023 D13). Identity and amount are immutable; a change is a new effective-dated row.';

-- ----------------------------------------------------------------------------
-- 2. A limit is money in its own currency
-- ----------------------------------------------------------------------------

CREATE FUNCTION iam.guard_approval_limit_money()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_minor smallint;
BEGIN
  SELECT c.minor_unit INTO v_minor FROM shared.currencies c WHERE c.code = NEW.currency_code;
  -- An unknown currency is left to fk_approval_limits_currency, and a negative
  -- amount to ck_approval_limits_amount, so each keeps the refusal it had.
  IF v_minor IS NULL OR NEW.amount IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.amount <> round(NEW.amount, v_minor) THEN
    RAISE EXCEPTION 'approval_limit_minor_unit: an approval limit in % is stated to at most % decimal places', NEW.currency_code, v_minor
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.limit_type = 'credit_note' AND NEW.amount <= 0 THEN
    RAISE EXCEPTION 'approval_limit_not_positive: a credit-note approval limit is above zero'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION iam.guard_approval_limit_money() IS
  'BEFORE INSERT guard on iam.approval_limits (P1-32-PRE-OD-FD2C, ADR-023 D1 and D13): the amount fits the minor unit shared.currencies records for its currency (approval_limit_minor_unit), and a credit_note limit is above zero (approval_limit_not_positive). An unknown currency and a negative amount are left to the foreign key and the CHECK. Rows stored before it are not re-validated: the amount is immutable.';
REVOKE EXECUTE ON FUNCTION iam.guard_approval_limit_money() FROM PUBLIC;

CREATE TRIGGER tg_approval_limits_money BEFORE INSERT ON iam.approval_limits
  FOR EACH ROW EXECUTE FUNCTION iam.guard_approval_limit_money();

-- ----------------------------------------------------------------------------
-- 3. The decision guard: the approval needs the permission and a limit
-- ----------------------------------------------------------------------------

-- Re-issued from 20260930110000_sal_credit_note_decisions.sql. Unchanged except
-- in two places: the approval (pending -> approved) is held to D13 after the
-- maker <> approver check, and the rejection checks sal.credit.approve instead
-- of sal.credit.manage.
CREATE OR REPLACE FUNCTION sal.guard_credit_note_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor uuid;
  v_limit_amount numeric(18, 4);
  v_limit_currency text;
  v_limit_creator uuid;
  v_approved numeric(18, 4);
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
    PERFORM 1 FROM sal.invoices i
      WHERE i.tenant_id = OLD.tenant_id AND i.company_id = OLD.company_id
        AND i.branch_id = OLD.branch_id AND i.id = OLD.invoice_id
      FOR UPDATE;

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
    SELECT COALESCE(sum(cn.amount), 0) INTO v_approved
      FROM sal.credit_notes cn
     WHERE cn.tenant_id = OLD.tenant_id AND cn.company_id = OLD.company_id
       AND cn.branch_id = OLD.branch_id AND cn.invoice_id = OLD.invoice_id
       AND cn.approval_state = 'approved' AND cn.id <> OLD.id;
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
  'BEFORE UPDATE guard on sal.credit_notes (P1-32-PRE-OD-FD2A, D3; P1-32-PRE-OD-FD2C, D13). pending -> approved: approver stamped, different from the requester, holding sal.credit.approve in the note''s company and branch, under the invoice row lock, with a credit_note approval limit in the note''s currency that the approver did not create (own before role) covering every approved credit on the invoice including this note; issued_at stamped. pending -> rejected: a different person holding sal.credit.approve in the note''s company and branch, with a reason (not blank, at most 2000 characters); decider stamped. pending -> withdrawn: the requester only; decider stamped. A decided note is frozen: state, approver, decider, dates, decision reason and amount. Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_credit_note_decision() FROM PUBLIC;

COMMENT ON FUNCTION sal.reject_credit_note(uuid, text) IS
  'A different person rejects a pending credit note with a reason (P1-32-PRE-OD-FD2A, D3). Locks the note; refuses the requester (credit_note_self_rejection) and any other decided state (credit_note_decision_frozen); returns silently on a note already rejected. sal.guard_credit_note_decision checks sal.credit.approve in the note''s company and branch (P1-32-PRE-OD-FD2C, D13) and the reason, and stamps the decider and time.';

COMMENT ON FUNCTION sal.approve_credit_note(uuid, uuid) IS
  'Approves a pending credit note (P1-11; P1-32-PRE-OD-FIN, FD2A, FD2C). Locks the note, then the invoice; refuses the requester, a currency other than the invoice''s and a credit above the open receivable. The UPDATE it issues is held by sal.guard_credit_note_decision to the approval permission sal.credit.approve and to the approver''s credit-note limit over the invoice''s cumulative approved credit (ADR-023 D13). Writes the credit_note_issued financial event.';

-- ----------------------------------------------------------------------------
-- Inverse (ROLLBACK-SAFE WITH DATA NOTE — run only while no subject holds two
-- overlapping credit_note limits in different currencies)
--
--   Re-issue sal.guard_credit_note_decision from
--   20260930110000_sal_credit_note_decisions.sql with its COMMENT and REVOKE,
--   restore the COMMENT on sal.reject_credit_note from that file, then:
--   COMMENT ON FUNCTION sal.approve_credit_note(uuid, uuid) IS NULL;
--   DROP TRIGGER tg_approval_limits_money ON iam.approval_limits;
--   DROP FUNCTION iam.guard_approval_limit_money();
--   ALTER TABLE iam.approval_limits DROP CONSTRAINT ex_approval_limits_role_no_overlap;
--   ALTER TABLE iam.approval_limits DROP CONSTRAINT ex_approval_limits_user_no_overlap;
--   re-create both from 20260718093000_iam_approval_and_sensitive_data.sql, and
--   restore the table COMMENT from that file.
-- ----------------------------------------------------------------------------
