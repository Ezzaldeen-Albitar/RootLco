-- ============================================================================
-- P1-32-PRE-OD-FD2B — refund requests: a request, a second person's decision,
-- and the one-time record of the payout (Owner decision D2, part 2). No
-- accounting.
-- Owner module: sal (billing and payments)
--
-- Rollback classification: ROLLBACK-SAFE WHILE sal.refund_requests IS EMPTY;
--   roll-forward-only once a request exists, because dropping the table would
--   destroy the record of who asked, who decided and what was paid out. One
--   table is added with its three policies, four trigger functions and five
--   triggers (two of them deferred constraint triggers), five primitives, and
--   three functions are re-issued under their own names and signatures; two
--   CHECKs on sal.financial_events are widened and two table comments are
--   rewritten. No stored row is written, moved or deleted by the migration.
--   Forward-only — the inverse at the foot of this file is for a rehearsal copy
--   only.
--
-- Purpose (Owner decision D2 of 2026-09-30, ADR-023)
--
--   D2  "... any excess of credit over what is outstanding becomes a customer
--       credit/refund obligation — no automatic refund; refund approval and
--       refund execution are separate, with a second approver, and no
--       duplicate or excess refunds", concurrency-safe.
--
--   Part 1 (20261008121000) records the obligation. From this migration:
--
--     * A REQUEST is the payment recorder's act. sal.request_refund raises one
--       against an OPEN obligation, under the obligation's row lock: an amount
--       above zero, to the currency's minor unit (ADR-023 D1), at most the
--       obligation less what has already been paid out on it
--       (`refund_exceeds_obligation`); the obligation's currency and customer
--       (the payee — a third-party payee is an open point); a tenant payment
--       method that is active (cash, card terminal or bank transfer — the same
--       vocabulary a receipt uses, `ck_payment_methods_kind`); and a reason. The
--       requester holds sal.payment.record in the obligation's company and
--       branch. Every rule is the BEFORE INSERT guard's, so a raw INSERT is held
--       to it too, and every stamp is the database's.
--
--     * ONE LIVE REQUEST PER OBLIGATION: pending, or approved and not yet paid
--       out. A partial unique index is the backstop under concurrency
--       (`refund_request_live_exists`); a rejected, withdrawn or paid-out request
--       does not block the next one.
--
--     * THE DECISION is a DIFFERENT person's: approving and rejecting need
--       sal.refund.approve (a code of its own, minted with this change in the
--       permission catalogue seed) in the obligation's company and branch, and
--       the approver is never the requester (`refund_self_approval`). A rejection
--       states why. Only the requester withdraws a pending request
--       (`refund_withdraw_not_requester`). Approved, rejected and withdrawn are
--       terminal decisions (`refund_decision_frozen`).
--
--     * THE PAYOUT is recorded ONCE, as a separate step after the approval
--       (`refund_not_approved` before it, `refund_already_executed` after it):
--       by a holder of sal.payment.record in the same scope, with a payout
--       reference, a payout date that is not in the future and the approved
--       payment method (`refund_payout_method_mismatch` otherwise). The executor
--       and the moment are stamped by the database, and every fact is frozen
--       afterwards. One `refund_executed` row of sal.financial_events records it
--       — an operational fact like every row of that table, NOT an accounting
--       entry: no account, no posting, no ledger, no cash or bank movement.
--
--     * SETTLED, the one new obligation state reached. When what has been paid
--       out on an obligation reaches its amount, the payout's transaction moves
--       it from open to settled (sal.guard_refund_obligation_update admits that
--       transition and no other; a deferred constraint trigger refuses a payout
--       that reaches the amount without it). 'cancelled' stays unreachable — an
--       open point.
--
--     * No DELETE for any application role; history is append-only, as for
--       receipt reversals (D4).
--
-- Not in this change, and not in any change until the accounting questionnaire
--   is answered: refund accounts, ledger postings, cash or bank movement, tax
--   and period close. Open policy points, not built: explicit obligations, a
--   third-party payee, cancelling an obligation, refund approval limits (the D13
--   mechanism is not applied to refunds), refunds in the D16 report and its
--   snapshots, and a printed refund voucher.
--
-- Security implications
--   ENABLE + FORCE RLS on the new table; the WHOLE ROW is gated by
--   sal.finance.view in the caller's tenant, company and branch, as
--   sal.refund_obligations is. app_runtime holds SELECT and INSERT, and UPDATE
--   of the decision and payout columns only (every date and every person is
--   assigned by a trigger); app_readonly SELECT; no DELETE for any application
--   role. Every function is SECURITY INVOKER with an empty search_path; trigger
--   functions have EXECUTE revoked from PUBLIC and the primitives are granted to
--   app_runtime only. No SECURITY DEFINER.
--
-- Dependencies
--   20260724092000 (sal.payment_methods), 20260724093000 (sal.financial_events
--   and its guards), 20260930100000 (shared.fits_minor_unit), 20261008121000
--   (sal.refund_obligations), 20261008130000 (the obligation insert guard).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sal.refund_requests
-- ----------------------------------------------------------------------------

CREATE TABLE sal.refund_requests (
  id                         uuid           NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                  uuid           NOT NULL,
  company_id                 uuid           NOT NULL,
  branch_id                  uuid           NOT NULL,
  obligation_id              uuid           NOT NULL,
  invoice_id                 uuid           NOT NULL,
  payee_partner_id           uuid           NOT NULL,
  currency_code              text           NOT NULL,
  amount                     numeric(18, 4) NOT NULL,
  payment_method_id          uuid           NOT NULL,
  reason                     text           NOT NULL,
  approval_state             text           NOT NULL DEFAULT 'pending',
  requested_by               uuid           NOT NULL,
  requested_at               timestamptz    NOT NULL DEFAULT now(),
  approved_by                uuid           NULL,
  approved_at                timestamptz    NULL,
  decided_by                 uuid           NULL,
  decided_at                 timestamptz    NULL,
  decision_reason            text           NULL,
  executed_by                uuid           NULL,
  executed_at                timestamptz    NULL,
  payout_reference           text           NULL,
  payout_date                date           NULL,
  idempotency_key            text           NULL,
  execution_idempotency_key  text           NULL,
  record_version             integer        NOT NULL DEFAULT 1,
  created_at                 timestamptz    NOT NULL DEFAULT now(),
  created_by                 uuid           NOT NULL,
  updated_at                 timestamptz    NULL,
  updated_by                 uuid           NULL,

  CONSTRAINT pk_refund_requests PRIMARY KEY (id),
  CONSTRAINT uq_refund_requests_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_refund_requests_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_obligation FOREIGN KEY (tenant_id, company_id, branch_id, obligation_id)
    REFERENCES sal.refund_obligations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_invoice FOREIGN KEY (tenant_id, company_id, branch_id, invoice_id)
    REFERENCES sal.invoices (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_payee FOREIGN KEY (tenant_id, payee_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requests_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  -- The tenant's own method row, as fk_receipts_method requires of a receipt.
  CONSTRAINT fk_refund_requests_method FOREIGN KEY (tenant_id, payment_method_id)
    REFERENCES sal.payment_methods (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_refund_requests_amount CHECK (amount > 0),
  CONSTRAINT ck_refund_requests_reason CHECK (btrim(reason) <> '' AND char_length(reason) <= 2000),
  CONSTRAINT ck_refund_requests_approval_state
    CHECK (approval_state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT ck_refund_requests_approved_only_when_approved
    CHECK (approval_state = 'approved' OR (approved_by IS NULL AND approved_at IS NULL)),
  CONSTRAINT ck_refund_requests_decided_only_when_declined
    CHECK (approval_state IN ('rejected', 'withdrawn') OR (decided_by IS NULL AND decided_at IS NULL)),
  CONSTRAINT ck_refund_requests_withdrawn_by_requester
    CHECK (approval_state <> 'withdrawn' OR (decided_by = requested_by AND decided_at IS NOT NULL)),
  CONSTRAINT ck_refund_requests_approved_by_other
    CHECK (approval_state <> 'approved' OR (approved_by IS NOT NULL AND approved_by <> requested_by AND approved_at IS NOT NULL)),
  CONSTRAINT ck_refund_requests_rejected_by_other
    CHECK (approval_state <> 'rejected' OR (decided_by IS NOT NULL AND decided_by <> requested_by)),
  CONSTRAINT ck_refund_requests_decision_reason
    CHECK (decision_reason IS NULL
           OR (approval_state = 'rejected' AND btrim(decision_reason) <> '' AND char_length(decision_reason) <= 2000)),
  -- A payout is recorded only on an approved request, whole or not at all.
  CONSTRAINT ck_refund_requests_executed_only_when_approved
    CHECK (executed_at IS NULL OR approval_state = 'approved'),
  CONSTRAINT ck_refund_requests_execution_whole
    CHECK ((executed_at IS NULL AND executed_by IS NULL AND payout_reference IS NULL AND payout_date IS NULL)
        OR (executed_at IS NOT NULL AND executed_by IS NOT NULL AND payout_reference IS NOT NULL AND payout_date IS NOT NULL)),
  CONSTRAINT ck_refund_requests_payout_reference
    CHECK (payout_reference IS NULL OR (btrim(payout_reference) <> '' AND char_length(payout_reference) <= 200)),
  CONSTRAINT ck_refund_requests_execution_key
    CHECK (execution_idempotency_key IS NULL OR executed_at IS NOT NULL)
);

COMMENT ON TABLE sal.refund_requests IS
  'P1-32-PRE-OD-FD2B (ADR-023 D2, part 2): a request to pay back part or all of a refund obligation, decided by a second person and paid out once. Requested by a holder of sal.payment.record; approved or rejected by a DIFFERENT holder of sal.refund.approve; withdrawn only by the requester; the payout recorded once, after the approval, by a holder of sal.payment.record with a reference, a date and the approved method. At most one live request (pending, or approved and not paid out) per obligation (uq_refund_requests_obligation_live); the amount is at most the obligation less what has been paid out on it, checked under the obligation row lock. Every person and date is stamped by the database. WHOLE ROW gated by sal.finance.view. An operational record, not an accounting entry: no account, posting, cash or bank movement. No DELETE. Roll-forward-only once a row exists.';
COMMENT ON COLUMN sal.refund_requests.obligation_id IS
  'The refund obligation this request pays back (part of). Same tenant, company and branch.';
COMMENT ON COLUMN sal.refund_requests.invoice_id IS
  'The obligation''s invoice, bound by sal.guard_refund_request_insert, so a branch''s requests can be found by invoice.';
COMMENT ON COLUMN sal.refund_requests.payee_partner_id IS
  'Who is paid: the obligation''s customer, bound by sal.guard_refund_request_insert. Paying a third party is an open Owner question (ADR-023 D2 and D14).';
COMMENT ON COLUMN sal.refund_requests.amount IS
  'What is to be paid back, in the obligation''s currency: above zero, within the currency''s minor unit (ADR-023 D1), at most the obligation less what has already been paid out on it, checked under the obligation row lock. Frozen.';
COMMENT ON COLUMN sal.refund_requests.payment_method_id IS
  'The tenant''s payment method the payout is to be made by (cash, card terminal or bank transfer); active when requested. The payout must be recorded by the same method.';
COMMENT ON COLUMN sal.refund_requests.approval_state IS
  'pending until decided; approved (by a different holder of sal.refund.approve), rejected (with a reason) or withdrawn (by the requester) are terminal decisions. Whether an approved request has been paid out is executed_at.';
COMMENT ON COLUMN sal.refund_requests.decision_reason IS
  'Why the request was rejected. Required for a rejection, not blank, at most 2000 characters; absent on every other state. Frozen once written.';
COMMENT ON COLUMN sal.refund_requests.executed_at IS
  'When the payout was recorded, stamped by sal.guard_refund_request_update; NULL until then. Set once, on an approved request only, and frozen afterwards.';
COMMENT ON COLUMN sal.refund_requests.payout_reference IS
  'The reference of the payout as made (a transfer reference, a cash slip number), not blank, at most 200 characters. Not a payment credential; written once.';
COMMENT ON COLUMN sal.refund_requests.payout_date IS
  'The day the money was paid out, as the executor states it; not in the future. Written once.';
COMMENT ON COLUMN sal.refund_requests.idempotency_key IS
  'The Idempotency-Key the request was raised with; a repeat answers the same request (uq_refund_requests_idempotency).';
COMMENT ON COLUMN sal.refund_requests.execution_idempotency_key IS
  'The Idempotency-Key the payout was recorded with; a repeat answers the recorded payout (uq_refund_requests_execution_idempotency).';

-- One LIVE request per obligation: pending, or approved and not yet paid out.
CREATE UNIQUE INDEX uq_refund_requests_obligation_live
  ON sal.refund_requests (tenant_id, company_id, branch_id, obligation_id)
  WHERE approval_state = 'pending' OR (approval_state = 'approved' AND executed_at IS NULL);
-- The partial index covers only the live rows; the foreign key needs every row.
CREATE INDEX ix_refund_requests_obligation
  ON sal.refund_requests (tenant_id, company_id, branch_id, obligation_id);
CREATE INDEX ix_refund_requests_invoice
  ON sal.refund_requests (tenant_id, company_id, branch_id, invoice_id);
CREATE INDEX ix_refund_requests_payee ON sal.refund_requests (tenant_id, payee_partner_id);
CREATE INDEX ix_refund_requests_method ON sal.refund_requests (tenant_id, payment_method_id);
CREATE INDEX ix_refund_requests_currency ON sal.refund_requests (currency_code);
-- The list order: newest first within a branch.
CREATE INDEX ix_refund_requests_list
  ON sal.refund_requests (tenant_id, company_id, branch_id, requested_at DESC, id DESC);
CREATE UNIQUE INDEX uq_refund_requests_idempotency
  ON sal.refund_requests (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_refund_requests_execution_idempotency
  ON sal.refund_requests (tenant_id, execution_idempotency_key) WHERE execution_idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. The request rules, for every INSERT
-- ----------------------------------------------------------------------------

CREATE FUNCTION sal.guard_refund_request_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor uuid := iam.current_user_id();
  v_ob sal.refund_obligations%ROWTYPE;
  v_paid numeric(18, 4);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'refund_request_no_user: a refund request is raised by a signed-in person'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Born pending and undecided, whatever the statement names; every person and
  -- date is the database's.
  NEW.requested_by := v_actor;
  NEW.requested_at := now();
  NEW.approval_state := 'pending';
  NEW.approved_by := NULL;
  NEW.approved_at := NULL;
  NEW.decided_by := NULL;
  NEW.decided_at := NULL;
  NEW.decision_reason := NULL;
  NEW.executed_by := NULL;
  NEW.executed_at := NULL;
  NEW.payout_reference := NULL;
  NEW.payout_date := NULL;
  NEW.execution_idempotency_key := NULL;
  NEW.record_version := 1;
  NEW.updated_at := NULL;
  NEW.updated_by := NULL;
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     AND pg_catalog.pg_has_role(current_user, 'app_runtime', 'MEMBER') THEN
    NEW.created_by := v_actor;
    NEW.created_at := now();
  END IF;

  -- The obligation row lock: two requests on one obligation serialise here, and
  -- the second sees the first.
  SELECT * INTO v_ob FROM sal.refund_obligations ro
   WHERE ro.tenant_id = NEW.tenant_id AND ro.company_id = NEW.company_id
     AND ro.branch_id = NEW.branch_id AND ro.id = NEW.obligation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_request_obligation_missing: refund obligation % is not visible in the request''s company and branch', NEW.obligation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT iam.has_permission_in_scope('sal.payment.record', NEW.company_id, NEW.branch_id, NULL) THEN
    RAISE EXCEPTION 'refund_request_permission_missing: requesting a refund on obligation % requires sal.payment.record in its company and branch', NEW.obligation_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_ob.state <> 'open' THEN
    RAISE EXCEPTION 'refund_obligation_not_open: refund obligation % is %, and only an open obligation is paid back', v_ob.id, v_ob.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM sal.refund_requests rr
     WHERE rr.tenant_id = NEW.tenant_id AND rr.company_id = NEW.company_id
       AND rr.branch_id = NEW.branch_id AND rr.obligation_id = NEW.obligation_id
       AND (rr.approval_state = 'pending' OR (rr.approval_state = 'approved' AND rr.executed_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'refund_request_live_exists: refund obligation % already has a request waiting for a decision or for its payout', v_ob.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.invoice_id IS DISTINCT FROM v_ob.invoice_id THEN
    RAISE EXCEPTION 'refund_request_invoice_mismatch: a refund request names its obligation''s invoice %', v_ob.invoice_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payee_partner_id IS DISTINCT FROM v_ob.partner_id THEN
    RAISE EXCEPTION 'refund_request_payee_mismatch: the payee is the obligation''s customer'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_code IS DISTINCT FROM v_ob.currency_code THEN
    RAISE EXCEPTION 'refund_request_currency_mismatch: a refund is paid in its obligation''s currency %, not %', v_ob.currency_code, NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'refund_request_amount_invalid: a refund is above zero'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT shared.fits_minor_unit(NEW.amount, NEW.currency_code) THEN
    RAISE EXCEPTION 'refund_request_minor_unit: a refund in % is stated to the currency''s minor unit', NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  -- No excess: at most the obligation less what has already been paid out on it,
  -- read under the obligation lock every payout takes too.
  SELECT COALESCE(sum(rr.amount), 0) INTO v_paid FROM sal.refund_requests rr
   WHERE rr.tenant_id = NEW.tenant_id AND rr.company_id = NEW.company_id
     AND rr.branch_id = NEW.branch_id AND rr.obligation_id = NEW.obligation_id
     AND rr.approval_state = 'approved' AND rr.executed_at IS NOT NULL;
  IF NEW.amount > v_ob.amount - v_paid THEN
    RAISE EXCEPTION 'refund_exceeds_obligation: a refund of % exceeds the % still owed on obligation %', NEW.amount, v_ob.amount - v_paid, v_ob.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sal.payment_methods pm
     WHERE pm.tenant_id = NEW.tenant_id AND pm.id = NEW.payment_method_id
       AND pm.status = 'active' AND pm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'refund_request_method_unavailable: payment method % is not an active method of this organisation', NEW.payment_method_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reason IS NULL OR btrim(NEW.reason) = '' OR char_length(NEW.reason) > 2000 THEN
    RAISE EXCEPTION 'refund_request_reason_required: a refund request states why, in at most 2000 characters'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_request_insert() IS
  'BEFORE INSERT guard on sal.refund_requests (P1-32-PRE-OD-FD2B, ADR-023 D2). Stamps the requester and time from the session and births the row pending with no decision and no payout, for every writer. Locks the obligation FOR UPDATE; refuses a caller without sal.payment.record in its company and branch (refund_request_permission_missing), an obligation that is not open (refund_obligation_not_open), a second live request (refund_request_live_exists), another invoice, payee or currency than the obligation''s (refund_request_invoice_mismatch, refund_request_payee_mismatch, refund_request_currency_mismatch), an amount not above zero or finer than the minor unit (refund_request_amount_invalid, refund_request_minor_unit), above the obligation less what was paid out on it (refund_exceeds_obligation), a method that is not an active method of the tenant (refund_request_method_unavailable) and a blank or over-long reason (refund_request_reason_required). Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_request_insert() FROM PUBLIC;

CREATE TRIGGER tg_refund_requests_insert_rules BEFORE INSERT ON sal.refund_requests
  FOR EACH ROW EXECUTE FUNCTION sal.guard_refund_request_insert();

-- ----------------------------------------------------------------------------
-- 3. The decision and payout rules, for every UPDATE
-- ----------------------------------------------------------------------------

CREATE FUNCTION sal.guard_refund_request_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor uuid;
  v_executing boolean;
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
    IF NEW.payout_date IS NULL OR NEW.payout_date > current_date THEN
      RAISE EXCEPTION 'refund_payout_date_invalid: a payout states the day it was made, which is not in the future'
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
  'BEFORE UPDATE guard on sal.refund_requests (P1-32-PRE-OD-FD2B, ADR-023 D2), for every role. The facts a request was raised with never move (refund_request_frozen). pending -> approved: a person other than the requester (refund_self_approval) holding sal.refund.approve in the obligation''s company and branch (refund_approve_permission_missing); approver and time stamped. pending -> rejected: the same, with a reason (refund_reject_reason_required); decider stamped. pending -> withdrawn: the requester only (refund_withdraw_not_requester); decider stamped. A decided request''s decision is frozen (refund_decision_frozen). The payout is written once, on an approved request only (refund_not_approved), by a holder of sal.payment.record in the same scope (refund_execute_permission_missing), with a reference and a date not in the future, within what is still owed on the open obligation under its row lock (refund_exceeds_obligation); executor and time stamped. A paid-out request is frozen (refund_already_executed). Refusals carry a stable token before the first colon.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_request_update() FROM PUBLIC;

CREATE TRIGGER tg_refund_requests_rules BEFORE UPDATE ON sal.refund_requests
  FOR EACH ROW EXECUTE FUNCTION sal.guard_refund_request_update();
CREATE TRIGGER tg_refund_requests_touch_metadata BEFORE UPDATE ON sal.refund_requests
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- At commit, a payout that brought what has been paid out on an obligation to its
-- amount left the obligation settled — in the payout's own transaction.
CREATE FUNCTION sal.guard_refund_request_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_amount numeric(18, 4); v_state text; v_paid numeric(18, 4);
BEGIN
  SELECT ro.amount, ro.state INTO v_amount, v_state FROM sal.refund_obligations ro
   WHERE ro.tenant_id = NEW.tenant_id AND ro.company_id = NEW.company_id
     AND ro.branch_id = NEW.branch_id AND ro.id = NEW.obligation_id;
  SELECT COALESCE(sum(rr.amount), 0) INTO v_paid FROM sal.refund_requests rr
   WHERE rr.tenant_id = NEW.tenant_id AND rr.company_id = NEW.company_id
     AND rr.branch_id = NEW.branch_id AND rr.obligation_id = NEW.obligation_id
     AND rr.approval_state = 'approved' AND rr.executed_at IS NOT NULL;
  IF (v_paid >= v_amount) IS DISTINCT FROM (v_state = 'settled') THEN
    RAISE EXCEPTION 'refund_obligation_not_settled: refund obligation % is % while % of its % has been paid out', NEW.obligation_id, v_state, v_paid, v_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_request_settlement() IS
  'Deferred constraint trigger on sal.refund_requests (P1-32-PRE-OD-FD2B, ADR-023 D2): at commit, after a payout, the obligation is settled exactly when what has been paid out on it reaches its amount (refund_obligation_not_settled). sal.execute_refund_request does both in one transaction.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_request_settlement() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER tg_refund_requests_settlement AFTER UPDATE ON sal.refund_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.executed_at IS NOT NULL)
  EXECUTE FUNCTION sal.guard_refund_request_settlement();

ALTER TABLE sal.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.refund_requests FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_refund_requests_gated ON sal.refund_requests FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_refund_requests_gated ON sal.refund_requests FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_refund_requests_gated ON sal.refund_requests FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.finance.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON sal.refund_requests TO app_runtime;
-- The runtime login writes the state, a rejection's reason and the payout's own
-- facts; every person and every moment is assigned by the triggers.
GRANT UPDATE (approval_state, decision_reason, payout_reference, payout_date, execution_idempotency_key)
  ON sal.refund_requests TO app_runtime;
GRANT SELECT ON sal.refund_requests TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. The obligation: settled is reached by a payout, and by nothing else
-- ----------------------------------------------------------------------------

-- Re-issued from 20261008121000_sal_refund_obligations.sql. The only change: open
-- -> settled is admitted when what has been paid out on the obligation equals its
-- amount; every other state change stays refused.
CREATE OR REPLACE FUNCTION sal.guard_refund_obligation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_paid numeric(18, 4);
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
    IF OLD.state = 'open' AND NEW.state = 'settled' THEN
      SELECT COALESCE(sum(rr.amount), 0) INTO v_paid FROM sal.refund_requests rr
       WHERE rr.tenant_id = OLD.tenant_id AND rr.company_id = OLD.company_id
         AND rr.branch_id = OLD.branch_id AND rr.obligation_id = OLD.id
         AND rr.approval_state = 'approved' AND rr.executed_at IS NOT NULL;
      IF v_paid <> OLD.amount THEN
        RAISE EXCEPTION 'refund_obligation_not_paid_out: refund obligation % is settled only once its whole amount has been paid out', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'refund_obligation_transition_unavailable: refund obligation % moves only from open to settled, by its payouts', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.guard_refund_obligation_update() IS
  'BEFORE UPDATE guard on sal.refund_obligations (P1-32-PRE-OD-FD2A; P1-32-PRE-OD-FD2B, ADR-023 D2), for every role: every fact is frozen (refund_obligation_frozen); open -> settled is admitted only once the payouts of its approved refund requests add up to its amount (refund_obligation_not_paid_out); every other state change is refused (refund_obligation_transition_unavailable) — cancelled stays unreachable, an open Owner question.';
REVOKE EXECUTE ON FUNCTION sal.guard_refund_obligation_update() FROM PUBLIC;

COMMENT ON TABLE sal.refund_obligations IS
  'P1-32-PRE-OD-FD2A (ADR-023 D2): money the platform records that a customer is owed back because an approved credit note exceeded what the invoice still owed. An operational record, not an accounting entry: no account, posting, cash or bank movement. Created only by sal.approve_credit_note for exactly the excess (sal.guard_refund_obligation_insert binds it to the note approved in the same transaction, its invoice, the invoice''s customer and currency), one per credit note. Paid back through sal.refund_requests (P1-32-PRE-OD-FD2B): open until what has been paid out reaches its amount, then settled; cancelled stays unreachable (open Owner question). WHOLE ROW gated by sal.finance.view; no row is ever deleted. Roll-forward-only once a row exists.';
COMMENT ON COLUMN sal.refund_obligations.state IS
  'open (owed, not yet fully paid back) or settled (its approved refund requests have paid out its whole amount, P1-32-PRE-OD-FD2B). cancelled is reserved and refused by sal.guard_refund_obligation_update (open Owner question).';

-- ----------------------------------------------------------------------------
-- 5. One financial event per payout — an operational fact, not an accounting entry
-- ----------------------------------------------------------------------------

ALTER TABLE sal.financial_events DROP CONSTRAINT ck_financial_events_event_type;
ALTER TABLE sal.financial_events DROP CONSTRAINT ck_financial_events_source_type;
ALTER TABLE sal.financial_events
  ADD CONSTRAINT ck_financial_events_event_type CHECK (event_type IN (
    'invoice_issued', 'receipt_recorded', 'payment_allocated',
    'credit_note_issued', 'receipt_reversed', 'warranty_split_recorded',
    'refund_obligation_recorded', 'refund_executed')),
  ADD CONSTRAINT ck_financial_events_source_type CHECK (source_type IN (
    'invoice', 'receipt', 'payment_allocation', 'credit_note', 'receipt_reversal',
    'refund_obligation', 'refund_request'));

COMMENT ON TABLE sal.financial_events IS 'Phase 1-11 IMMUTABLE append-only financial-event ledger (SELECT+INSERT only; WHOLE ROW gated by sal.finance.view). The future accounting integration point (Figure 4.29) — NOT a general ledger: no debit/credit/account columns, and no event is an accounting entry; refund_obligation_recorded (P1-32-PRE-OD-FD2A, ADR-023 D2) records that a customer is owed money back and refund_executed (P1-32-PRE-OD-FD2B) records that a refund was paid out — operational facts, with no account, posting, cash or bank movement. Exactly one event per financial command (completeness constraint triggers); provenance-guarded; single-use per (source, event_type). Roll-forward-only.';

-- Re-issued from 20261008121000_sal_refund_obligations.sql. The only change: the
-- refund_executed branch, bound to the paid-out request's own amount and currency.
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
  ELSIF NEW.event_type = 'refund_executed' THEN
    SELECT amount, currency_code INTO v_amount, v_currency FROM sal.refund_requests
      WHERE tenant_id = NEW.tenant_id AND id = NEW.source_id AND NEW.source_type = 'refund_request'
        AND approval_state = 'approved' AND executed_at IS NOT NULL;
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

-- Re-issued from 20261008121000_sal_refund_obligations.sql. The only change: a
-- paid-out refund request needs its refund_executed event at commit.
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
  ELSIF TG_TABLE_NAME = 'refund_requests' THEN
    v_needed := (NEW.executed_at IS NOT NULL); v_type := 'refund_executed';
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

CREATE CONSTRAINT TRIGGER tg_refund_requests_event_completeness AFTER UPDATE ON sal.refund_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.executed_at IS NOT NULL)
  EXECUTE FUNCTION sal.guard_event_completeness();

-- ----------------------------------------------------------------------------
-- 6. The primitives. Every one locks the obligation before the request, so a
--    request, a decision and a payout on one obligation serialise and never
--    deadlock.
-- ----------------------------------------------------------------------------

-- A payment recorder asks for (part of) an obligation to be paid back. A repeated
-- key answers the request it raised; a key reused for another obligation is
-- refused. Every other rule is the BEFORE INSERT guard's. No financial event: a
-- request pays nothing.
CREATE FUNCTION sal.request_refund(p_obligation_id uuid, p_amount numeric, p_payment_method_id uuid,
                                   p_reason text, p_idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_ob sal.refund_obligations%ROWTYPE; v_prior sal.refund_requests%ROWTYPE; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'sal.request_refund requires a tenant context' USING ERRCODE = 'raise_exception';
  END IF;
  SELECT * INTO v_ob FROM sal.refund_obligations WHERE id = p_obligation_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sal.request_refund: refund obligation % not found in scope', p_obligation_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM sal.refund_requests
     WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_prior.obligation_id <> p_obligation_id THEN
        RAISE EXCEPTION 'refund_request_idempotency_reused: the idempotency key already raised a refund request on another obligation'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN v_prior.id;
    END IF;
  END IF;
  INSERT INTO sal.refund_requests (tenant_id, company_id, branch_id, obligation_id, invoice_id, payee_partner_id,
                                   currency_code, amount, payment_method_id, reason, requested_by, idempotency_key, created_by)
    VALUES (v_ob.tenant_id, v_ob.company_id, v_ob.branch_id, v_ob.id, v_ob.invoice_id, v_ob.partner_id,
            v_ob.currency_code, p_amount, p_payment_method_id, p_reason, v_actor, p_idempotency_key, v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
COMMENT ON FUNCTION sal.request_refund(uuid, numeric, uuid, text, text) IS
  'Requests that (part of) a refund obligation be paid back (P1-32-PRE-OD-FD2B, ADR-023 D2). Locks the obligation; answers a repeated idempotency key with the request it raised and refuses a key reused for another obligation (refund_request_idempotency_reused); inserts a pending request in the obligation''s invoice, payee and currency. sal.guard_refund_request_insert holds the permission, state, one-live-request, amount, method and reason rules and stamps the requester. No financial event.';
REVOKE EXECUTE ON FUNCTION sal.request_refund(uuid, numeric, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.request_refund(uuid, numeric, uuid, text, text) TO app_runtime;

-- A different holder of sal.refund.approve approves a pending request. Idempotent
-- on an approved request. No financial event: an approval pays nothing.
CREATE FUNCTION sal.approve_refund_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rr sal.refund_requests%ROWTYPE; v_obligation uuid; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT obligation_id INTO v_obligation FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.approve_refund_request: refund request % not found in scope', p_request_id USING ERRCODE = 'no_data_found'; END IF;
  PERFORM 1 FROM sal.refund_obligations WHERE id = v_obligation AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  SELECT * INTO v_rr FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF v_rr.approval_state = 'approved' THEN RETURN; END IF; -- idempotent
  IF v_rr.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'refund_decision_frozen: refund request % is % and its decision is frozen', p_request_id, v_rr.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'refund_request_no_user: a decision is made by a signed-in person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_rr.requested_by = v_actor THEN
    RAISE EXCEPTION 'refund_self_approval: the approver of a refund must differ from the person who requested it' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.refund_requests SET approval_state = 'approved' WHERE id = p_request_id; -- the guard checks the permission and stamps approved_by, approved_at
END; $$;
COMMENT ON FUNCTION sal.approve_refund_request(uuid) IS
  'Approves a pending refund request (P1-32-PRE-OD-FD2B, ADR-023 D2). Locks the obligation, then the request; returns silently on an approved request; refuses a decided one (refund_decision_frozen) and the requester (refund_self_approval). sal.guard_refund_request_update holds the approver to sal.refund.approve in the obligation''s company and branch and stamps the approver and time. Pays nothing: the payout is a separate step.';
REVOKE EXECUTE ON FUNCTION sal.approve_refund_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.approve_refund_request(uuid) TO app_runtime;

-- A different holder of sal.refund.approve rejects a pending request, with a
-- reason. Idempotent on a rejected request.
CREATE FUNCTION sal.reject_refund_request(p_request_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rr sal.refund_requests%ROWTYPE; v_obligation uuid; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT obligation_id INTO v_obligation FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.reject_refund_request: refund request % not found in scope', p_request_id USING ERRCODE = 'no_data_found'; END IF;
  PERFORM 1 FROM sal.refund_obligations WHERE id = v_obligation AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  SELECT * INTO v_rr FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'refund_request_no_user: a decision is made by a signed-in person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_rr.requested_by = v_actor THEN
    RAISE EXCEPTION 'refund_self_rejection: refund request % is rejected by someone other than the person who requested it; the requester withdraws it instead', p_request_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_rr.approval_state = 'rejected' THEN RETURN; END IF; -- idempotent
  IF v_rr.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'refund_decision_frozen: refund request % is % and its decision is frozen', p_request_id, v_rr.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.refund_requests SET approval_state = 'rejected', decision_reason = p_reason WHERE id = p_request_id; -- the guard checks the permission and the reason, stamps decided_by, decided_at
END; $$;
COMMENT ON FUNCTION sal.reject_refund_request(uuid, text) IS
  'A different person rejects a pending refund request with a reason (P1-32-PRE-OD-FD2B, ADR-023 D2). Locks the obligation, then the request; refuses the requester (refund_self_rejection) and any other decided state (refund_decision_frozen); returns silently on a request already rejected. sal.guard_refund_request_update checks sal.refund.approve in the obligation''s company and branch and the reason, and stamps the decider and time.';
REVOKE EXECUTE ON FUNCTION sal.reject_refund_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.reject_refund_request(uuid, text) TO app_runtime;

-- The requester withdraws their own pending request. Idempotent for the
-- requester on a request they already withdrew.
CREATE FUNCTION sal.withdraw_refund_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rr sal.refund_requests%ROWTYPE; v_obligation uuid; v_actor uuid := iam.current_user_id();
BEGIN
  SELECT obligation_id INTO v_obligation FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.withdraw_refund_request: refund request % not found in scope', p_request_id USING ERRCODE = 'no_data_found'; END IF;
  PERFORM 1 FROM sal.refund_obligations WHERE id = v_obligation AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  SELECT * INTO v_rr FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'refund_request_no_user: a decision is made by a signed-in person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_rr.requested_by <> v_actor THEN
    RAISE EXCEPTION 'refund_withdraw_not_requester: refund request % is withdrawn only by the person who requested it', p_request_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_rr.approval_state = 'withdrawn' THEN RETURN; END IF; -- idempotent for the requester
  IF v_rr.approval_state <> 'pending' THEN
    RAISE EXCEPTION 'refund_decision_frozen: refund request % is % and its decision is frozen', p_request_id, v_rr.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.refund_requests SET approval_state = 'withdrawn' WHERE id = p_request_id; -- the guard stamps decided_by, decided_at
END; $$;
COMMENT ON FUNCTION sal.withdraw_refund_request(uuid) IS
  'The requester withdraws their own pending refund request (P1-32-PRE-OD-FD2B, ADR-023 D2). Locks the obligation, then the request; refuses anyone but the requester (refund_withdraw_not_requester) and any decided state (refund_decision_frozen); returns silently for the requester on a request already withdrawn. The decider and time are stamped by sal.guard_refund_request_update.';
REVOKE EXECUTE ON FUNCTION sal.withdraw_refund_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.withdraw_refund_request(uuid) TO app_runtime;

-- A holder of sal.payment.record records the payout of an approved request, once:
-- the reference, the day and the approved method. Writes the refund_executed
-- financial event and, when what has been paid out reaches the obligation's
-- amount, settles the obligation — all in this transaction. A repeat under the
-- key the payout was recorded with answers it; any other repeat is refused.
CREATE FUNCTION sal.execute_refund_request(p_request_id uuid, p_payment_method_id uuid, p_payout_reference text,
                                           p_payout_date date, p_idempotency_key text DEFAULT NULL,
                                           p_correlation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rr sal.refund_requests%ROWTYPE; v_ob sal.refund_obligations%ROWTYPE; v_obligation uuid;
        v_actor uuid := iam.current_user_id(); v_paid numeric(18, 4);
BEGIN
  SELECT obligation_id INTO v_obligation FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.execute_refund_request: refund request % not found in scope', p_request_id USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO v_ob FROM sal.refund_obligations WHERE id = v_obligation AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  SELECT * INTO v_rr FROM sal.refund_requests WHERE id = p_request_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF v_rr.executed_at IS NOT NULL THEN
    IF p_idempotency_key IS NOT NULL AND v_rr.execution_idempotency_key = p_idempotency_key THEN
      RETURN; -- the same payout, asked again
    END IF;
    RAISE EXCEPTION 'refund_already_executed: refund request % was paid out already', p_request_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_rr.approval_state <> 'approved' THEN
    RAISE EXCEPTION 'refund_not_approved: refund request % is % and is paid out only once approved', p_request_id, v_rr.approval_state
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_payment_method_id IS DISTINCT FROM v_rr.payment_method_id THEN
    RAISE EXCEPTION 'refund_payout_method_mismatch: refund request % is paid out by the method it was approved with', p_request_id
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE sal.refund_requests
     SET payout_reference = p_payout_reference, payout_date = p_payout_date,
         execution_idempotency_key = p_idempotency_key
   WHERE id = p_request_id; -- the guard checks the permission, the reference, the date and the remaining amount, and stamps executed_by, executed_at
  INSERT INTO sal.financial_events (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, correlation_id, created_by)
    VALUES (v_rr.tenant_id, v_rr.company_id, v_rr.branch_id, 'refund_executed', 'refund_request', v_rr.id, v_rr.currency_code, v_rr.amount, v_actor, p_correlation_id, v_actor);
  SELECT COALESCE(sum(rr.amount), 0) INTO v_paid FROM sal.refund_requests rr
   WHERE rr.tenant_id = v_ob.tenant_id AND rr.company_id = v_ob.company_id
     AND rr.branch_id = v_ob.branch_id AND rr.obligation_id = v_ob.id
     AND rr.approval_state = 'approved' AND rr.executed_at IS NOT NULL;
  IF v_paid = v_ob.amount THEN
    UPDATE sal.refund_obligations SET state = 'settled' WHERE id = v_ob.id;
  END IF;
END; $$;
COMMENT ON FUNCTION sal.execute_refund_request(uuid, uuid, text, date, text, uuid) IS
  'Records the payout of an approved refund request, once (P1-32-PRE-OD-FD2B, ADR-023 D2). Locks the obligation, then the request; answers a repeat under the key the payout was recorded with, and refuses any other repeat (refund_already_executed), a request not approved (refund_not_approved) and another method than the approved one (refund_payout_method_mismatch). sal.guard_refund_request_update holds the executor to sal.payment.record in scope, the reference, the date and the amount still owed, and stamps the executor and time. Writes the refund_executed financial event — an operational fact, not an accounting entry — and settles the obligation when what has been paid out reaches its amount.';
REVOKE EXECUTE ON FUNCTION sal.execute_refund_request(uuid, uuid, text, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.execute_refund_request(uuid, uuid, text, date, text, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- Inverse (rehearsal copy only — refused once a refund request exists)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM sal.refund_requests) THEN
--       RAISE EXCEPTION 'refund requests exist; this migration is forward-only';
--     END IF;
--   END $$;
--   DROP FUNCTION sal.execute_refund_request(uuid, uuid, text, date, text, uuid);
--   DROP FUNCTION sal.withdraw_refund_request(uuid);
--   DROP FUNCTION sal.reject_refund_request(uuid, text);
--   DROP FUNCTION sal.approve_refund_request(uuid);
--   DROP FUNCTION sal.request_refund(uuid, numeric, uuid, text, text);
--   re-issue sal.guard_event_completeness and sal.guard_financial_event_provenance
--   from 20261008121000_sal_refund_obligations.sql;
--   restore the sal.financial_events table COMMENT and its two CHECKs from
--   20261008121000_sal_refund_obligations.sql;
--   re-issue sal.guard_refund_obligation_update with its COMMENT, and restore the
--   sal.refund_obligations table and state-column COMMENTs, from
--   20261008121000_sal_refund_obligations.sql;
--   DROP TABLE sal.refund_requests;
--   DROP FUNCTION sal.guard_refund_request_settlement();
--   DROP FUNCTION sal.guard_refund_request_update();
--   DROP FUNCTION sal.guard_refund_request_insert();
-- ----------------------------------------------------------------------------
