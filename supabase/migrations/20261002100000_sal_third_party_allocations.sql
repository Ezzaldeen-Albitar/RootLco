-- ============================================================================
-- P1-32-PRE-OD-FD14 — an allocation to someone else's invoice is refused by
-- default; a third-party payer (an insurer, an employer) is accepted only when
-- the allocation says so, by an authorised person, with a recorded reason.
-- Owner module: sal (payments)
--
-- Rollback classification: ROLLBACK-SAFE WITH DATA NOTE. Four nullable columns
--   and two CHECKs are added to sal.payment_allocations; one trigger function and
--   one BEFORE INSERT trigger are added; sal.allocate_receipt is dropped and
--   re-created with three more trailing arguments. No row is written, moved or
--   deleted, and no existing allocation is re-checked: the guard runs on INSERT
--   only. The inverse at the foot of this file restores every previous
--   definition; the data note is that a third-party allocation booked after this
--   migration loses its relationship, authorisation reference, reason and
--   authorising user when the columns are dropped, so the inverse first refuses
--   to run while one exists.
--
-- Purpose (Owner decision D14 of 2026-09-30, ADR-023; finance critique M-03)
--
--   D14  sal.allocate_receipt never compared the receipt's payer with the
--        invoice's: cash taken from one customer could settle another customer's
--        invoice, silently. From this migration, for every NEW allocation, raw
--        INSERT included:
--
--          * SAME PAYER — the receipt's payer_partner_id equals the invoice's —
--            is unchanged, and carries no third-party detail
--            (third_party_same_payer otherwise).
--
--          * A DIFFERENT PAYER is refused (allocation_payer_mismatch) unless the
--            allocation is a THIRD-PARTY allocation, which carries:
--              - a relationship from a fixed vocabulary: insurer, employer or
--                other (third_party_relationship_invalid; the CHECK is the
--                backstop). 'other' must say in the reason what the payer is to
--                the customer (third_party_other_unexplained);
--              - an authorisation reference — the insurer's claim or approval
--                number, say — not blank and at most 100 characters
--                (third_party_authorisation_reference_required);
--              - a reason, not blank and at most 2000 characters
--                (third_party_reason_required);
--              - the authorising user, stamped from the session and never taken
--                from the statement. The session must hold sal.payment.third_party
--                in the receipt's company and branch
--                (third_party_permission_missing); no other payment code
--                satisfies it.
--
--          * CURRENCY — the allocation is in the receipt's currency and the
--            invoice's (allocation_currency_mismatch). sal.allocate_receipt
--            already compared the two; a raw INSERT is now held to it as well.
--            Tenant, company and branch stay the composite foreign keys' rule.
--
--        Nothing changes hands: the invoice stays its customer's, the receipt
--        stays its payer's, and what is left unallocated on the receipt stays the
--        payer's. No credit moves between the two parties, and none is created.
--
--        sal.allocate_receipt takes the three third-party values as trailing
--        arguments, and a repeated idempotency key is refused when the stored
--        allocation differs in any of them, as it already is for the receipt,
--        invoice and amount. Each refusal carries a stable token before the
--        first colon, which the application reads to name the rule.
--
--        Allocations already booked are reported, never rewritten: the count of
--        existing allocations whose receipt payer differs from the invoice payer
--        is raised as a NOTICE, read-only, as the migrating role sees them.
--
-- Not changed here: split billing to an insurer, a separate insurer receivable or
-- any accounting treatment of one, refunds of a third party's overpayment (D2),
-- and any limit on third-party allocations (D14 sets none).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The third-party columns and their shape
-- ----------------------------------------------------------------------------

ALTER TABLE sal.payment_allocations
  ADD COLUMN third_party_relationship            text NULL,
  ADD COLUMN third_party_authorisation_reference text NULL,
  ADD COLUMN third_party_reason                  text NULL,
  ADD COLUMN third_party_authorised_by           uuid NULL;

COMMENT ON COLUMN sal.payment_allocations.third_party_relationship IS
  'What the receipt''s payer is to the invoice''s customer, on a third-party allocation (P1-32-PRE-OD-FD14, ADR-023 D14): insurer, employer or other. NULL on an allocation whose receipt payer is the invoice''s own customer. Frozen with the row (the table takes inserts only).';
COMMENT ON COLUMN sal.payment_allocations.third_party_authorisation_reference IS
  'The authorisation the third-party payment rests on — the insurer''s claim or approval number, an employer''s purchase order — not blank, at most 100 characters (P1-32-PRE-OD-FD14). NULL exactly when third_party_relationship is.';
COMMENT ON COLUMN sal.payment_allocations.third_party_reason IS
  'Why this payer settles this customer''s invoice, not blank, at most 2000 characters; for the relationship ''other'' it says what the payer is to the customer (P1-32-PRE-OD-FD14). NULL exactly when third_party_relationship is.';
COMMENT ON COLUMN sal.payment_allocations.third_party_authorised_by IS
  'Who authorised the third-party allocation: stamped from the session by sal.guard_allocation_payer, never supplied by a caller, and only for a session holding sal.payment.third_party in the receipt''s company and branch (P1-32-PRE-OD-FD14). NULL exactly when third_party_relationship is.';

ALTER TABLE sal.payment_allocations
  ADD CONSTRAINT ck_payment_allocations_third_party_relationship
    CHECK (third_party_relationship IS NULL
           OR third_party_relationship IN ('insurer', 'employer', 'other')),
  ADD CONSTRAINT ck_payment_allocations_third_party_shape
    CHECK ((third_party_relationship IS NULL AND third_party_authorisation_reference IS NULL
            AND third_party_reason IS NULL AND third_party_authorised_by IS NULL)
        OR (third_party_relationship IS NOT NULL AND third_party_authorised_by IS NOT NULL
            AND third_party_authorisation_reference IS NOT NULL
            AND btrim(third_party_authorisation_reference) <> ''
            AND char_length(third_party_authorisation_reference) <= 100
            AND third_party_reason IS NOT NULL AND btrim(third_party_reason) <> ''
            AND char_length(third_party_reason) <= 2000));

COMMENT ON TABLE sal.payment_allocations IS
  'Phase 1-11 append-only receipt->invoice allocation (SELECT+INSERT only). WHOLE ROW gated by sal.finance.view. Composite scoped FKs force same-branch receipt+invoice (M-fin-5). Σ active allocations + unallocated = receipt amount (BR-SAL-002); reversed receipts excluded from the derivation. The receipt''s payer and the invoice''s customer are the same party, or the row is a third-party allocation carrying a relationship, an authorisation reference, a reason and the authorising user (ADR-023 D14, sal.guard_allocation_payer). Roll-forward-only.';

-- ----------------------------------------------------------------------------
-- 2. The payer rule, for every INSERT
-- ----------------------------------------------------------------------------

CREATE FUNCTION sal.guard_allocation_payer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_receipt_payer uuid; v_receipt_currency text;
  v_invoice_payer uuid; v_invoice_currency text;
  v_actor uuid;
BEGIN
  SELECT r.payer_partner_id, r.currency_code INTO v_receipt_payer, v_receipt_currency
    FROM sal.receipts r
   WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
     AND r.branch_id = NEW.branch_id AND r.id = NEW.receipt_id;
  -- Not visible: the row is refused anyway, by the receipt foreign key or by
  -- ins_payment_allocations_gated, whose predicate is sel_receipts_gated's. Left to
  -- them so the refusal is the one it always was.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT i.payer_partner_id, i.currency_code INTO v_invoice_payer, v_invoice_currency
    FROM sal.invoices i
   WHERE i.tenant_id = NEW.tenant_id AND i.company_id = NEW.company_id
     AND i.branch_id = NEW.branch_id AND i.id = NEW.invoice_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW.currency_code IS DISTINCT FROM v_receipt_currency
     OR NEW.currency_code IS DISTINCT FROM v_invoice_currency THEN
    RAISE EXCEPTION 'allocation_currency_mismatch: an allocation is in the receipt''s currency % and the invoice''s %, not %', v_receipt_currency, v_invoice_currency, NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_receipt_payer = v_invoice_payer THEN
    IF NEW.third_party_relationship IS NOT NULL OR NEW.third_party_authorisation_reference IS NOT NULL
       OR NEW.third_party_reason IS NOT NULL THEN
      RAISE EXCEPTION 'third_party_same_payer: receipt % was paid by the invoice''s own customer, so the allocation carries no third-party detail', NEW.receipt_id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.third_party_authorised_by := NULL;
    RETURN NEW;
  END IF;

  -- A different payer. Refused by default: only a third-party allocation passes.
  IF NEW.third_party_relationship IS NULL AND NEW.third_party_authorisation_reference IS NULL
     AND NEW.third_party_reason IS NULL THEN
    RAISE EXCEPTION 'allocation_payer_mismatch: receipt % was paid by a different party from the customer of invoice %, and the allocation is not a third-party allocation', NEW.receipt_id, NEW.invoice_id
      USING ERRCODE = 'check_violation';
  END IF;
  v_actor := iam.current_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'third_party_permission_missing: no user context, so nobody can authorise a third-party allocation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT iam.has_permission_in_scope('sal.payment.third_party', NEW.company_id, NEW.branch_id, NULL) THEN
    RAISE EXCEPTION 'third_party_permission_missing: a third-party allocation of receipt % requires sal.payment.third_party in its company and branch', NEW.receipt_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.third_party_relationship IS NULL
     OR NEW.third_party_relationship NOT IN ('insurer', 'employer', 'other') THEN
    RAISE EXCEPTION 'third_party_relationship_invalid: a third-party payer is an insurer, an employer or other'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.third_party_authorisation_reference IS NULL OR btrim(NEW.third_party_authorisation_reference) = ''
     OR char_length(NEW.third_party_authorisation_reference) > 100 THEN
    RAISE EXCEPTION 'third_party_authorisation_reference_required: a third-party allocation names the authorisation it rests on, in at most 100 characters'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.third_party_relationship = 'other'
     AND (NEW.third_party_reason IS NULL OR btrim(NEW.third_party_reason) = '') THEN
    RAISE EXCEPTION 'third_party_other_unexplained: a payer whose relationship is other must be explained in the reason'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.third_party_reason IS NULL OR btrim(NEW.third_party_reason) = ''
     OR char_length(NEW.third_party_reason) > 2000 THEN
    RAISE EXCEPTION 'third_party_reason_required: a third-party allocation states why, in at most 2000 characters'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.third_party_authorised_by := v_actor;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_allocation_payer() IS
  'BEFORE INSERT guard on sal.payment_allocations (P1-32-PRE-OD-FD14, ADR-023 D14). Refuses an allocation in another currency than its receipt''s and invoice''s (allocation_currency_mismatch); a same-payer allocation carrying third-party detail (third_party_same_payer); an allocation whose receipt payer is not the invoice''s customer unless it is a third-party allocation (allocation_payer_mismatch); a third-party allocation by a session without sal.payment.third_party in the receipt''s company and branch (third_party_permission_missing), with a relationship outside insurer, employer and other (third_party_relationship_invalid), without an authorisation reference of at most 100 characters (third_party_authorisation_reference_required), with the relationship other and no explanation (third_party_other_unexplained), or without a reason of at most 2000 characters (third_party_reason_required). Stamps third_party_authorised_by from the session on a third-party allocation and clears it on every other. Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_allocation_payer() FROM PUBLIC;

CREATE TRIGGER tg_payment_allocations_payer BEFORE INSERT ON sal.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION sal.guard_allocation_payer();

-- ----------------------------------------------------------------------------
-- 3. The primitive: three more trailing arguments
-- ----------------------------------------------------------------------------

-- Dropped and re-created from 20260930090000_sal_finance_controls.sql with three
-- more trailing arguments, the third-party relationship, authorisation reference
-- and reason. Two changes in the body: a repeated key is refused when the stored
-- allocation differs in any of the three, and the INSERT carries them. The payer
-- rule, the permission and the authorising user are sal.guard_allocation_payer's.
DROP FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text);

CREATE FUNCTION sal.allocate_receipt(
  p_receipt_id uuid, p_invoice_id uuid, p_amount numeric,
  p_correlation_id uuid DEFAULT NULL, p_idempotency_key text DEFAULT NULL,
  p_third_party_relationship text DEFAULT NULL,
  p_third_party_authorisation_reference text DEFAULT NULL,
  p_third_party_reason text DEFAULT NULL)
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
      IF v_prior.receipt_id <> p_receipt_id OR v_prior.invoice_id <> p_invoice_id OR v_prior.amount <> p_amount
         OR v_prior.third_party_relationship IS DISTINCT FROM p_third_party_relationship
         OR v_prior.third_party_authorisation_reference IS DISTINCT FROM p_third_party_authorisation_reference
         OR v_prior.third_party_reason IS DISTINCT FROM p_third_party_reason THEN
        RAISE EXCEPTION 'sal.allocate_receipt: idempotency key already booked a different allocation (key reused for another receipt, invoice, amount or third-party detail)'
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
  INSERT INTO sal.payment_allocations (tenant_id, company_id, branch_id, receipt_id, invoice_id, currency_code, amount, allocated_by, correlation_id, idempotency_key,
                                       third_party_relationship, third_party_authorisation_reference, third_party_reason, created_by)
    VALUES (v_rcpt.tenant_id, v_rcpt.company_id, v_rcpt.branch_id, p_receipt_id, p_invoice_id, v_rcpt.currency_code, p_amount, v_actor, p_correlation_id, p_idempotency_key,
            p_third_party_relationship, p_third_party_authorisation_reference, p_third_party_reason, v_actor)
    RETURNING id INTO v_id;
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rcpt.tenant_id, v_rcpt.company_id, v_rcpt.branch_id, 'payment_allocated', 'payment_allocation', v_id, v_rcpt.currency_code, p_amount, v_actor, p_correlation_id, v_actor);
  SELECT COALESCE(sum(amount), 0) INTO v_alloc_total FROM sal.payment_allocations WHERE tenant_id = v_rcpt.tenant_id AND receipt_id = p_receipt_id;
  UPDATE sal.receipts SET status = CASE WHEN v_alloc_total >= v_rcpt.amount THEN 'allocated' ELSE 'partially_allocated' END
    WHERE id = p_receipt_id;
  RETURN v_id;
END; $$;
COMMENT ON FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text, text, text, text) IS
  'Applies part or all of a receipt to one issued invoice (P1-11; P1-32-PRE-OD-FIN M-09; P1-32-PRE-OD-FD14). Locks the receipt then the invoice; answers a repeated idempotency key with the allocation it made and refuses a key reused for another receipt, invoice, amount or third-party detail; bounds the amount by the receipt''s remainder and the invoice''s open receivable; writes the payment_allocated financial event and re-states the receipt''s status. The trailing third-party relationship, authorisation reference and reason make a third-party allocation (ADR-023 D14): sal.guard_allocation_payer refuses an allocation to another customer''s invoice without them, holds them to their rules and to sal.payment.third_party, and stamps the authorising user.';
REVOKE EXECUTE ON FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text, text, text, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Reported, never rewritten: allocations booked across payers before this rule
-- ----------------------------------------------------------------------------

DO $$
DECLARE v_crossed bigint;
BEGIN
  SELECT count(*) INTO v_crossed
    FROM sal.payment_allocations pa
    JOIN sal.receipts r
      ON r.tenant_id = pa.tenant_id AND r.company_id = pa.company_id
     AND r.branch_id = pa.branch_id AND r.id = pa.receipt_id
    JOIN sal.invoices i
      ON i.tenant_id = pa.tenant_id AND i.company_id = pa.company_id
     AND i.branch_id = pa.branch_id AND i.id = pa.invoice_id
   WHERE r.payer_partner_id <> i.payer_partner_id;
  RAISE NOTICE 'P1-32-PRE-OD-FD14: % existing allocation(s) apply a receipt to an invoice of a different customer; they are left unchanged, and only new allocations are held to the payer rule (count as seen by the migrating role)', v_crossed;
END; $$;

-- ----------------------------------------------------------------------------
-- Inverse (ROLLBACK-SAFE WITH DATA NOTE — run only while no allocation carries a
-- third-party relationship)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM sal.payment_allocations WHERE third_party_relationship IS NOT NULL) THEN
--       RAISE EXCEPTION 'third-party allocations exist; the inverse would drop their record';
--     END IF;
--   END $$;
--   DROP FUNCTION sal.allocate_receipt(uuid, uuid, numeric, uuid, text, text, text, text);
--   re-create sal.allocate_receipt(uuid, uuid, numeric, uuid, text) from
--   20260930090000_sal_finance_controls.sql with its REVOKE and GRANT;
--   DROP TRIGGER tg_payment_allocations_payer ON sal.payment_allocations;
--   DROP FUNCTION sal.guard_allocation_payer();
--   restore the table COMMENT from 20260724092000_sal_payments.sql;
--   ALTER TABLE sal.payment_allocations
--     DROP CONSTRAINT ck_payment_allocations_third_party_shape,
--     DROP CONSTRAINT ck_payment_allocations_third_party_relationship;
--   ALTER TABLE sal.payment_allocations
--     DROP COLUMN third_party_authorised_by, DROP COLUMN third_party_reason,
--     DROP COLUMN third_party_authorisation_reference, DROP COLUMN third_party_relationship;
-- ----------------------------------------------------------------------------
