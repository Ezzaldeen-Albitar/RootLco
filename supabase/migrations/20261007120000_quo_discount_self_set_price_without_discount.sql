-- ============================================================================
-- P1-32-PRE-OD-FD8 (fix round 3) — a price the requester set needs another
-- person's approval even when the quotation carries no discount
-- (Owner decision D8, ADR-023, approved 2026-09-30).
-- Owner module: quo (the D8 rule and the discount request)
--
-- Rollback classification: ROLLBACK-SAFE. One CHECK replaced under its own name and
--   quo.revision_discount_needs_approval re-issued under its own name and signature.
--   Forward-only — the inverse at the foot of this file is for a rehearsal copy only.
--
-- Purpose
--   D8: "Changing one's own threshold, role limit or price list never exempts one's
--   own quotation from approval. Provenance and snapshots are kept. There is no
--   sole-administrator exception."
--
--   20261007090000 left a revision with a discount total of zero alone, even when
--   its writer had set a price one of its lines was priced at. That is a
--   self-exemption: with a threshold of 50 and a price of 100, a discount of 90
--   needs another person; the same writer then lowers the price to 10 themselves
--   and quotes at 10 with no discount — the customer gets the same 90 off, and
--   nobody approves it. A sole administrator can do exactly this.
--
--   D8 allows evaluating under the price in force before the person's change, but
--   a price changed in place keeps no earlier value, so that cannot be rebuilt. The
--   reading that never grants more is chosen instead:
--
--   FIX: when the writer of a revision set a price one of its lines was priced at
--   (quo.revision_self_change_basis.own_price), the revision needs approval by
--   somebody else WHATEVER its discount, zero included:
--     * quo.revision_discount_needs_approval — which the issue guard asks of a
--       revision with no request — answers true for such a revision;
--     * ck_discount_approvals_amounts admits a request with a discount total of
--       zero only when quo.guard_discount_approval computed requester_set_price
--       for it, so the approver sees why; every other request still carries a
--       discount greater than zero.
--   A threshold the writer recorded (own_policy) still needs another person for
--   any discount greater than zero, and a quotation with no discount under it
--   gives nothing away: the threshold is the only thing in question there, and
--   nothing is measured against it.
--
-- Existing rows
--   No row is written. Every existing request carries a discount greater than
--   zero, so the replaced CHECK holds for all of them. A draft with no discount
--   whose writer set a price it uses, and which has no request, cannot be issued
--   until it is revised (the issue guard refuses it), as for 20261007090000.
--
-- Security implications
--   No new table, column, role, grant, policy or SECURITY DEFINER. The re-issued
--   function is SECURITY INVOKER with a locked search_path; CREATE OR REPLACE keeps
--   its ACL (EXECUTE for app_runtime only), and the REVOKE/GRANT pair is repeated.
--
-- Dependencies
--   20260925090000 (quo.discount_approvals, the issue guard), 20261007090000 (the
--   D8 rule and requester_set_price), 20261007100000 and 20261007110000 (the D8
--   basis and guard as they stand).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The D8 rule at issue: a self-set price needs another person at any discount.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quo.revision_discount_needs_approval(p_revision uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE rev quo.quotation_revisions%ROWTYPE;
        v_policy svc.pricing_approval_policies%ROWTYPE;
        v_needs boolean; v_total numeric; v_own_policy boolean; v_own_price boolean;
BEGIN
  SELECT * INTO rev FROM quo.quotation_revisions WHERE id = p_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quotation revision % not found', p_revision USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT * INTO v_policy FROM quo.quotation_discount_policy(rev.tenant_id, rev.quotation_id);
  SELECT a.needs_approval, a.discount_total INTO v_needs, v_total
    FROM quo.revision_discount_assessment(rev.tenant_id, rev.id, v_policy.id IS NOT NULL,
           v_policy.threshold_kind, v_policy.threshold_value, v_policy.currency_code) a;
  IF v_needs THEN
    RETURN true;
  END IF;
  SELECT b.own_policy, b.own_price INTO v_own_policy, v_own_price
    FROM quo.revision_self_change_basis(rev.id, rev.created_by) b;
  -- A price the writer set: the price itself may carry the discount, so another
  -- person approves whatever the discount total, zero included.
  IF COALESCE(v_own_price, false) THEN
    RETURN true;
  END IF;
  -- A threshold the writer recorded: any discount at all needs another person.
  IF v_total > 0 AND COALESCE(v_own_policy, false) THEN
    RETURN true;
  END IF;
  RETURN false;
END; $$;
COMMENT ON FUNCTION quo.revision_discount_needs_approval(uuid) IS
  'Whether a revision''s discount needs approval: measured against its quotation''s pinned policy, and (ADR-023 D8, P1-32-PRE-OD-FD8) needed whatever the discount, zero included, when the revision''s writer set a price one of its lines was priced at, and for any discount greater than zero when the writer recorded the policy version the quotation is held to. The issue guard asks it of a revision with no request.';
REVOKE EXECUTE ON FUNCTION quo.revision_discount_needs_approval(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.revision_discount_needs_approval(uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. The request: a discount total of zero only for a self-set price.
--    requester_set_price is computed by quo.guard_discount_approval (BEFORE
--    INSERT) from the database's own provenance, never taken from the writer, and
--    frozen afterwards, so the CHECK reads the computed value.
-- ----------------------------------------------------------------------------
ALTER TABLE quo.discount_approvals DROP CONSTRAINT ck_discount_approvals_amounts;
ALTER TABLE quo.discount_approvals
  ADD CONSTRAINT ck_discount_approvals_amounts CHECK (
    discount_total >= 0
    AND discount_base >= discount_total
    AND (discount_total > 0 OR requester_set_price));

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only)
--
--   Re-run, as written in 20261007090000, its quo.revision_discount_needs_approval
--   with its REVOKE and GRANT; then
--   ALTER TABLE quo.discount_approvals DROP CONSTRAINT ck_discount_approvals_amounts;
--   ALTER TABLE quo.discount_approvals ADD CONSTRAINT ck_discount_approvals_amounts
--     CHECK (discount_total > 0 AND discount_base >= discount_total);
--   The inverse fails while any request with a discount total of zero exists.
-- ----------------------------------------------------------------------------
