-- ============================================================================
-- P1-32-PRE-OD-FD8 (fix round 2) — who moved an approval limit's window is kept,
-- and an approver who moved their own limit's window has no limit that counts
-- (Owner decision D8, ADR-023, approved 2026-09-30).
-- Owner module: iam (the window history on iam.approval_limits), quo (the D8 rule)
--
-- Rollback classification: ROLLBACK-SAFE. One defaulted column, one trigger and its
--   function; quo.guard_discount_approval re-issued under its own name. Forward-only
--   — the inverse at the foot of this file is for a rehearsal copy only.
--
-- Purpose
--   D8: "Changing one's own threshold, role limit or price list never exempts one's
--   own quotation from approval. Provenance and snapshots are kept. There is no
--   sole-administrator exception."
--
--   20261007100000 made a changed end date a changed limit, but read who changed it
--   from iam.approval_limits.updated_by, which names the LAST writer only:
--
--   1. THE APPROVER WAS NOT CAUGHT. An approver who reopened or extended their own
--      limit (or a limit on a role they hold), or ended their own smaller limit so
--      that a larger role limit applied, then approved against it. A limit the
--      approver CREATED never counted; a limit whose window they moved did.
--   2. A LATER SAVE ERASED THE REQUESTER'S CHANGE. The requester reopened a limit
--      and was refused; then anybody — the approver, a colleague — saved the same
--      end date again, updated_by moved to them, and the approval went through.
--
--   FIX: iam.approval_limits.window_changed_by — every person who ever changed the
--   limit's end date, appended by iam.record_approval_limit_window_change from the
--   signed-in person when effective_to changes, never removed, and never taken from
--   the writer (an insert starts it empty whatever was supplied). A save that leaves
--   the end date as it was records nothing and removes nothing.
--   quo.guard_discount_approval then refuses an approval
--   (`discount_no_approval_limit`) when any discount limit of the approver in the
--   request's company — on the approver, or on a role whose active grant reaches
--   them there, in force or not — has in its window history
--     * the REQUESTER (none of the approver's limits counts for that requester's
--       request), or
--     * the APPROVER (none of their limits counts for any request: moving the window
--       of one's own limit is raising one's own ceiling, as creating it is).
--   callerApprovalCeiling applies the same two rules.
--
-- Existing rows
--   window_changed_by is backfilled with updated_by where a row was updated — the
--   closest evidence the rows hold (effective_to is the only column the application
--   may update), not a verified attribution — with the row-metadata trigger disabled
--   so no record_version, updated_by or updated_at moves; a failure rolls the disable
--   back with everything else. No approval limit is created or ended, and no request
--   is written.
--
-- Security implications
--   No new table, role, grant, policy or SECURITY DEFINER. app_runtime keeps UPDATE
--   on effective_to only, so it cannot write window_changed_by; the trigger sets it
--   on every insert and update whoever writes. The new function and the re-issued
--   guard are SECURITY INVOKER with a locked search_path, and EXECUTE is revoked
--   from PUBLIC (CREATE OR REPLACE keeps the guard's ACL).
--
-- Dependencies
--   20260718093000 (iam.approval_limits), 20260726090000 (its runtime UPDATE grant),
--   20261007090000 and 20261007100000 (the D8 guard).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.approval_limits.window_changed_by — who ever moved the end date.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.approval_limits
  ADD COLUMN window_changed_by uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
COMMENT ON COLUMN iam.approval_limits.window_changed_by IS
  'Everyone who ever changed this limit''s end date (P1-32-PRE-OD-FD8, ADR-023 D8): appended from the signed-in person by iam.record_approval_limit_window_change when effective_to changes, never removed, and empty on insert whatever the writer supplied. A save that leaves the end date unchanged records nothing. Rows updated before migration 20261007110000 carry their updated_by.';

ALTER TABLE iam.approval_limits DISABLE TRIGGER tg_approval_limits_touch_metadata;
UPDATE iam.approval_limits SET window_changed_by = ARRAY[updated_by] WHERE updated_by IS NOT NULL;
ALTER TABLE iam.approval_limits ENABLE TRIGGER tg_approval_limits_touch_metadata;

CREATE OR REPLACE FUNCTION iam.record_approval_limit_window_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.window_changed_by := ARRAY[]::uuid[];
    RETURN NEW;
  END IF;
  NEW.window_changed_by := OLD.window_changed_by;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    v_actor := iam.current_user_id();
    IF v_actor IS NOT NULL AND NOT (v_actor = ANY (OLD.window_changed_by)) THEN
      NEW.window_changed_by := OLD.window_changed_by || v_actor;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION iam.record_approval_limit_window_change() IS
  'BEFORE INSERT OR UPDATE on iam.approval_limits (P1-32-PRE-OD-FD8, ADR-023 D8): keeps window_changed_by append-only — empty on insert, the previous value on every update, and the signed-in person appended when effective_to changes.';
REVOKE EXECUTE ON FUNCTION iam.record_approval_limit_window_change() FROM PUBLIC;

CREATE TRIGGER tg_approval_limits_window_history
  BEFORE INSERT OR UPDATE ON iam.approval_limits
  FOR EACH ROW EXECUTE FUNCTION iam.record_approval_limit_window_change();

-- ----------------------------------------------------------------------------
-- 2. quo.guard_discount_approval — the window history, for requester and approver.
--    Re-issued whole; only the approval branch changes: the check on updated_by is
--    replaced by two checks on window_changed_by, and the ceiling is then chosen
--    exactly as before.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quo.guard_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_revision_status text; v_revision_quotation uuid; v_revision_number integer;
        v_revision_currency text; v_successor_quotation uuid; v_successor_number integer;
        v_open integer; v_policy svc.pricing_approval_policies%ROWTYPE; v_carried numeric;
        v_decider uuid; v_limit_id uuid; v_limit_amount numeric; v_limit_currency text;
        v_own_policy boolean; v_own_price boolean; v_roles uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'quo.discount_approvals: a discount approval is born pending; approving it is a separate act by another person'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT status, quotation_id, currency_code
      INTO v_revision_status, v_revision_quotation, v_revision_currency
      FROM quo.quotation_revisions
     WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id
       AND id = NEW.quotation_revision_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quo.discount_approvals: revision % not found in scope', NEW.quotation_revision_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_revision_quotation <> NEW.quotation_id THEN
      RAISE EXCEPTION 'quo.discount_approvals: revision % belongs to another quotation', NEW.quotation_revision_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_revision_status <> 'draft' THEN
      RAISE EXCEPTION 'quo.discount_approvals: revision % is %, and only a draft revision asks for a discount approval', NEW.quotation_revision_id, v_revision_status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.origin = 'requested' THEN
      -- The open request of a quotation is superseded by the revision that
      -- replaces it before that revision asks again. A withdrawn request is not
      -- open: it is terminal.
      SELECT count(*)::integer INTO v_open
        FROM quo.discount_approvals
       WHERE tenant_id = NEW.tenant_id AND quotation_id = NEW.quotation_id
         AND status IN ('pending', 'rejected');
      IF v_open > 0 THEN
        RAISE EXCEPTION 'discount_approval_open: quotation % already holds an open discount request; supersede it first', NEW.quotation_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- The snapshot is the QUOTATION's pinned policy and nothing else: a threshold
    -- changed since the quotation was written cannot be reached by asking again.
    SELECT * INTO v_policy FROM quo.quotation_discount_policy(NEW.tenant_id, NEW.quotation_id);
    IF NEW.policy_id IS DISTINCT FROM v_policy.id
       OR NEW.policy_version_no IS DISTINCT FROM v_policy.version_no
       OR NEW.threshold_kind IS DISTINCT FROM v_policy.threshold_kind
       OR NEW.threshold_value IS DISTINCT FROM v_policy.threshold_value
       OR NEW.threshold_currency_code IS DISTINCT FROM v_policy.currency_code
       OR NEW.required_permission_code IS DISTINCT FROM COALESCE(v_policy.required_permission_code, 'svc.price.manage') THEN
      RAISE EXCEPTION 'discount_approval_snapshot_mismatch: a request on quotation % carries the discount policy the quotation is held to', NEW.quotation_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- The request is for the discount the revision's lines carry.
    SELECT COALESCE(sum(i.captured_discount), 0) INTO v_carried
      FROM quo.quotation_items i
     WHERE i.tenant_id = NEW.tenant_id AND i.quotation_revision_id = NEW.quotation_revision_id
       AND i.deleted_at IS NULL;
    IF NEW.discount_total IS DISTINCT FROM v_carried OR NEW.currency_code IS DISTINCT FROM v_revision_currency THEN
      RAISE EXCEPTION 'discount_approval_total_mismatch: revision % carries a discount of % %, not % %',
        NEW.quotation_revision_id, v_carried, v_revision_currency, NEW.discount_total, NEW.currency_code
        USING ERRCODE = 'check_violation';
    END IF;
    -- D8: why another person is needed, computed here — never a writer's claim.
    SELECT b.own_policy, b.own_price INTO v_own_policy, v_own_price
      FROM quo.revision_self_change_basis(NEW.quotation_revision_id, NEW.requested_by) b;
    NEW.requester_set_policy := COALESCE(v_own_policy, false);
    NEW.requester_set_price := COALESCE(v_own_price, false);
    NEW.approver_limit_id := NULL;
    NEW.withdrawn_by := NULL;
    NEW.withdrawn_at := NULL;
    RETURN NEW;
  END IF;

  -- D3: the requester withdraws their own PENDING request. It records no decision,
  -- and nobody else can do it.
  IF NEW.status = 'withdrawn' AND OLD.status IS DISTINCT FROM 'withdrawn' THEN
    IF OLD.status = 'superseded' THEN
      RAISE EXCEPTION 'discount_approval_superseded: discount approval % was replaced by a newer revision and cannot be withdrawn', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'discount_approval_already_decided: discount approval % is % and can no longer be withdrawn', OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    v_decider := iam.current_user_id();
    IF v_decider IS NULL OR v_decider <> OLD.requested_by THEN
      RAISE EXCEPTION 'discount_withdraw_not_requester: discount approval % is withdrawn only by the person who requested it', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR NEW.approver_limit_amount IS DISTINCT FROM OLD.approver_limit_amount
       OR NEW.approver_limit_currency_code IS DISTINCT FROM OLD.approver_limit_currency_code
       OR NEW.approver_limit_id IS DISTINCT FROM OLD.approver_limit_id
       OR NEW.approved_discount_total IS DISTINCT FROM OLD.approved_discount_total
       OR NEW.approved_currency_code IS DISTINCT FROM OLD.approved_currency_code
       OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
       OR NEW.superseded_by_revision_id IS DISTINCT FROM OLD.superseded_by_revision_id THEN
      RAISE EXCEPTION 'quo.discount_approvals: withdrawing a request records no decision'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.withdrawn_by := v_decider;
    NEW.withdrawn_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'discount_approval_withdrawn: discount approval % was withdrawn by its requester and cannot be decided', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Superseding: an open request is replaced by a newer revision of its own
  -- quotation. It records no decision and changes none it had.
  IF NEW.status = 'superseded' AND OLD.status <> 'superseded' THEN
    IF OLD.status NOT IN ('pending', 'rejected') THEN
      RAISE EXCEPTION 'quo.discount_approvals: only a pending or rejected request is superseded, and % is %', OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR NEW.approver_limit_amount IS DISTINCT FROM OLD.approver_limit_amount
       OR NEW.approver_limit_currency_code IS DISTINCT FROM OLD.approver_limit_currency_code
       OR NEW.approver_limit_id IS DISTINCT FROM OLD.approver_limit_id THEN
      RAISE EXCEPTION 'quo.discount_approvals: superseding a request records no decision'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT revision_number INTO v_revision_number
      FROM quo.quotation_revisions WHERE tenant_id = OLD.tenant_id AND id = OLD.quotation_revision_id;
    SELECT quotation_id, revision_number INTO v_successor_quotation, v_successor_number
      FROM quo.quotation_revisions WHERE tenant_id = NEW.tenant_id AND id = NEW.superseded_by_revision_id;
    IF v_successor_quotation IS DISTINCT FROM OLD.quotation_id OR v_successor_number <= v_revision_number THEN
      RAISE EXCEPTION 'quo.discount_approvals: request % is superseded only by a newer revision of its own quotation', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'discount_approval_superseded: discount approval % was replaced by a newer revision and cannot be decided', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'discount_approval_already_decided: discount approval % is % and is not awaiting a decision', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'quo.discount_approvals: a pending approval changes only by being approved, rejected, withdrawn or superseded'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A decision. Checked here, whatever role issues it, with the same rules and in
  -- the same order the application names them.
  v_decider := iam.current_user_id();
  IF v_decider IS NULL OR NEW.decided_by IS DISTINCT FROM v_decider THEN
    RAISE EXCEPTION 'discount_approval_decider_mismatch: a decision on discount approval % is recorded by the signed-in person, in their own name', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_decider = OLD.requested_by THEN
    RAISE EXCEPTION 'discount_approver_must_differ: discount approval % is decided by someone other than the person who requested it', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT iam.has_permission_in_scope(OLD.required_permission_code, OLD.company_id, OLD.branch_id, NULL) THEN
    RAISE EXCEPTION 'discount_approval_permission_missing: deciding discount approval % requires %', OLD.id, OLD.required_permission_code
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'approved' THEN
    -- The roles whose limits reach the approver in this company: an active grant,
    -- in force now, unrestricted or scoped to the company (callerApprovalCeiling).
    SELECT COALESCE(array_agg(DISTINCT g.role_id), ARRAY[]::uuid[]) INTO v_roles
      FROM iam.role_grants g
     WHERE g.tenant_id = OLD.tenant_id AND g.user_id = v_decider
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
       );
    -- D8: a limit window is a limit change, and who moved it is kept for good in
    -- window_changed_by — not read from updated_by, which a later save moves. When
    -- the REQUESTER ever changed the end date of any discount limit of the approver
    -- in this company — reopening or extending one, or ending one so that another
    -- applies — none of the approver's limits counts for this request.
    IF EXISTS (
      SELECT 1 FROM iam.approval_limits al
       WHERE al.tenant_id = OLD.tenant_id AND al.company_id = OLD.company_id
         AND al.limit_type = 'discount'
         AND OLD.requested_by = ANY (al.window_changed_by)
         AND (al.user_id = v_decider OR (al.user_id IS NULL AND al.role_id = ANY (v_roles)))
    ) THEN
      RAISE EXCEPTION 'discount_no_approval_limit: the approver of discount approval % holds a discount approval limit whose dates the requester changed, so none of their limits counts for it', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- Nor when the APPROVER changed the end date of one of their own discount limits
    -- in this company, on themselves or on a role they hold there: moving one's own
    -- window is raising one's own ceiling, as creating the limit is.
    IF EXISTS (
      SELECT 1 FROM iam.approval_limits al
       WHERE al.tenant_id = OLD.tenant_id AND al.company_id = OLD.company_id
         AND al.limit_type = 'discount'
         AND v_decider = ANY (al.window_changed_by)
         AND (al.user_id = v_decider OR (al.user_id IS NULL AND al.role_id = ANY (v_roles)))
    ) THEN
      RAISE EXCEPTION 'discount_no_approval_limit: the approver of discount approval % changed the dates of one of their own discount approval limits, so none of their limits counts', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    -- The approver's ceiling: a limit on the approver before a role's, the largest
    -- role limit whose active grant reaches the company, in force today, and never
    -- one the approver created — nor, D8, one the REQUESTER created.
    SELECT al.id, al.amount, al.currency_code INTO v_limit_id, v_limit_amount, v_limit_currency
      FROM iam.approval_limits al
     WHERE al.tenant_id = OLD.tenant_id AND al.company_id = OLD.company_id
       AND al.limit_type = 'discount'
       AND al.effective_from <= current_date
       AND (al.effective_to IS NULL OR al.effective_to > current_date)
       AND al.created_by <> v_decider
       AND al.created_by <> OLD.requested_by
       AND (al.user_id = v_decider OR (al.user_id IS NULL AND al.role_id = ANY (v_roles)))
     ORDER BY (al.user_id IS NOT NULL) DESC, al.amount DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'discount_no_approval_limit: the approver of discount approval % has no discount approval limit that counts in this company', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_limit_currency <> OLD.currency_code THEN
      RAISE EXCEPTION 'discount_limit_currency_mismatch: the approver''s limit is in %, and discount approval % is in %', v_limit_currency, OLD.id, OLD.currency_code
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_limit_amount < OLD.discount_total THEN
      RAISE EXCEPTION 'discount_over_approval_limit: discount approval % exceeds the approver''s limit', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approver_limit_id := v_limit_id;
    NEW.approver_limit_amount := v_limit_amount;
    NEW.approver_limit_currency_code := v_limit_currency;
  ELSE
    NEW.approver_limit_id := NULL;
    NEW.approver_limit_amount := NULL;
    NEW.approver_limit_currency_code := NULL;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_discount_approval() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only)
--
--   Re-run, as written in 20261007100000, its quo.guard_discount_approval; then
--   DROP TRIGGER tg_approval_limits_window_history ON iam.approval_limits;
--   DROP FUNCTION iam.record_approval_limit_window_change();
--   ALTER TABLE iam.approval_limits DROP COLUMN window_changed_by;
-- ----------------------------------------------------------------------------
