-- ============================================================================
-- P1-32-PRE-OD-FD8 (fix round 1) — no self-benefit from one's own approval-limit
-- window change or from one's own price amount (Owner decision D8, ADR-023,
-- approved 2026-09-30).
-- Owner module: quo (the D8 rule and the line snapshot), svc (who set a price
--   rule's amount), inv (who set an item selling price's amount)
--
-- Rollback classification: ROLLBACK-SAFE. Four nullable columns and their stamps;
--   three functions re-issued under their own names. Forward-only — the inverse at
--   the foot of this file is for a rehearsal copy only.
--
-- Purpose
--   D8: "Changing one's own threshold, role limit or price list never exempts one's
--   own quotation from approval. Provenance and snapshots are kept. There is no
--   sole-administrator exception."
--
--   20261007090000 left two ways round that rule:
--
--   1. AN APPROVAL LIMIT'S WINDOW. A limit's amount is immutable, but its
--      effective_to is not: app_runtime may UPDATE it (20260726090000), and the
--      access administration route does. The approver's ceiling excluded only
--      limits the requester CREATED, so the requester could reopen an expired limit
--      an administrator had set for the approver (or extend one), or end the
--      approver's own smaller limit so that a larger role limit applied, and then
--      have the approver approve the requester's own discount.
--      FIX: a window change is a limit change. When any discount limit of the
--      approver in the request's company — on the approver, or on a role the
--      approver holds there — was last changed by the REQUESTER, none of the
--      approver's limits counts for that request, and the approval is refused
--      (`discount_no_approval_limit`, the refusal a limit the requester created
--      already gives). Who last changed a limit is iam.approval_limits.updated_by:
--      shared.touch_row_metadata stamps it from the signed-in person on every
--      update, and effective_to is the only column app_runtime may update, so it
--      names who last moved the window. No new column is needed. The rule looks at
--      every such limit, in force or not, because ending a limit is exactly how a
--      larger one is exposed. callerApprovalCeiling applies the same rule.
--
--   2. WHO SET A PRICE'S AMOUNT. price_changed_by names whoever last touched any
--      pricing column. A colleague's later change to a rule's priority, tax class,
--      narrowing or status (or to an item selling price's tax class or status)
--      overwrote the requester's attribution while the requester's amount stayed in
--      force, so a discount measured against the requester's own amount needed no
--      second person.
--      FIX: the amount has its own stamp, next to the last-change stamp:
--        * svc.price_rules.amount_set_by / amount_set_at — stamped on INSERT and
--          when `amount` changes, and never otherwise;
--        * inv.item_sale_prices.amount_set_by / amount_set_at — stamped on INSERT
--          and when `unit_price` or `currency_code` changes, and never otherwise.
--      quo.quotation_items snapshots it (price_amount_set_by / price_amount_set_at)
--      with the rest of the line's provenance, and quo.revision_self_change_basis
--      counts a line as the requester's own price when the requester set its
--      amount, last changed its source, or published its price-list version.
--
-- Existing rows
--   amount_set_by / amount_set_at are backfilled from price_changed_by /
--   price_changed_at — the closest evidence the rows hold (itself
--   COALESCE(updated_by, created_by) for rows written before 20261007090000), not a
--   verified attribution. The backfill runs with the row-metadata, provenance and
--   (for price rules) published-version freeze triggers disabled, so no
--   record_version, updated_by, updated_at or price_changed_by moves; a failure
--   rolls the disable back with everything else. Existing quotation lines keep NULL
--   in the two new snapshot columns; their price_changed_by / price_published_by
--   snapshot still counts. No approval limit, request or line is written.
--
-- Security implications
--   No new table, function, trigger, role, grant, policy or SECURITY DEFINER. The
--   re-issued functions stay SECURITY INVOKER with a locked search_path and keep
--   their grants (CREATE OR REPLACE keeps the ACL).
--
-- Dependencies
--   20260718093000 (iam.approval_limits), 20260726090000 (its runtime UPDATE grant),
--   20261007090000 (the provenance columns and the D8 guard).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Who set a price's AMOUNT.
-- ----------------------------------------------------------------------------

-- 1a. svc.price_rules
ALTER TABLE svc.price_rules
  ADD COLUMN amount_set_by uuid        NULL,
  ADD COLUMN amount_set_at timestamptz NULL;
COMMENT ON COLUMN svc.price_rules.amount_set_by IS
  'Who set this rule''s amount (P1-32-PRE-OD-FD8, D8): the signed-in person, stamped by svc.stamp_price_rule_provenance when the rule is written and when its amount changes, and by nothing else — a later change to priority, tax class, narrowing or status leaves it. NULL when nobody was signed in. Rows written before migration 20261007100000 carry price_changed_by.';
COMMENT ON COLUMN svc.price_rules.amount_set_at IS
  'When amount_set_by set the amount (P1-32-PRE-OD-FD8).';

ALTER TABLE svc.price_rules DISABLE TRIGGER tg_price_rules_touch_metadata;
ALTER TABLE svc.price_rules DISABLE TRIGGER tg_price_rules_parent_frozen;
ALTER TABLE svc.price_rules DISABLE TRIGGER tg_price_rules_provenance;
UPDATE svc.price_rules SET amount_set_by = price_changed_by, amount_set_at = price_changed_at;
ALTER TABLE svc.price_rules ENABLE TRIGGER tg_price_rules_provenance;
ALTER TABLE svc.price_rules ENABLE TRIGGER tg_price_rules_parent_frozen;
ALTER TABLE svc.price_rules ENABLE TRIGGER tg_price_rules_touch_metadata;

CREATE OR REPLACE FUNCTION svc.stamp_price_rule_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    NEW.amount_set_by := iam.current_user_id();
    NEW.amount_set_at := now();
  ELSE
    NEW.amount_set_by := OLD.amount_set_by;
    NEW.amount_set_at := OLD.amount_set_at;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.tax_class_id IS DISTINCT FROM OLD.tax_class_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.customer_class IS DISTINCT FROM OLD.customer_class
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    NEW.price_changed_by := iam.current_user_id();
    NEW.price_changed_at := now();
  ELSE
    NEW.price_changed_by := OLD.price_changed_by;
    NEW.price_changed_at := OLD.price_changed_at;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.stamp_price_rule_provenance() FROM PUBLIC;

-- 1b. inv.item_sale_prices
ALTER TABLE inv.item_sale_prices
  ADD COLUMN amount_set_by uuid        NULL,
  ADD COLUMN amount_set_at timestamptz NULL;
COMMENT ON COLUMN inv.item_sale_prices.amount_set_by IS
  'Who set this selling price''s amount — unit price and currency (P1-32-PRE-OD-FD8, D8): the signed-in person, stamped by inv.stamp_item_sale_price_provenance when the row is written and when the unit price or currency changes, and by nothing else — a later change to tax class or status leaves it. NULL when nobody was signed in. Rows written before migration 20261007100000 carry price_changed_by.';
COMMENT ON COLUMN inv.item_sale_prices.amount_set_at IS
  'When amount_set_by set the amount (P1-32-PRE-OD-FD8).';

ALTER TABLE inv.item_sale_prices DISABLE TRIGGER tg_item_sale_prices_touch_metadata;
ALTER TABLE inv.item_sale_prices DISABLE TRIGGER tg_item_sale_prices_provenance;
UPDATE inv.item_sale_prices SET amount_set_by = price_changed_by, amount_set_at = price_changed_at;
ALTER TABLE inv.item_sale_prices ENABLE TRIGGER tg_item_sale_prices_provenance;
ALTER TABLE inv.item_sale_prices ENABLE TRIGGER tg_item_sale_prices_touch_metadata;

CREATE OR REPLACE FUNCTION inv.stamp_item_sale_price_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
    NEW.amount_set_by := iam.current_user_id();
    NEW.amount_set_at := now();
  ELSE
    NEW.amount_set_by := OLD.amount_set_by;
    NEW.amount_set_at := OLD.amount_set_at;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.tax_class_id IS DISTINCT FROM OLD.tax_class_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    NEW.price_changed_by := iam.current_user_id();
    NEW.price_changed_at := now();
  ELSE
    NEW.price_changed_by := OLD.price_changed_by;
    NEW.price_changed_at := OLD.price_changed_at;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.stamp_item_sale_price_provenance() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. quo.quotation_items — the line snapshots who set the amount it was priced at.
-- ----------------------------------------------------------------------------
ALTER TABLE quo.quotation_items
  ADD COLUMN price_amount_set_by uuid        NULL,
  ADD COLUMN price_amount_set_at timestamptz NULL;
COMMENT ON COLUMN quo.quotation_items.price_amount_set_by IS
  'Who had set the amount of the price this line was priced from — its svc.price_rules row or its inv.item_sale_prices row — when the line was written (P1-32-PRE-OD-FD8, D8). Copied by quo.snapshot_quotation_item_price_provenance; a later change to the source does not move it. NULL when unattributed and for lines written before migration 20261007100000.';
COMMENT ON COLUMN quo.quotation_items.price_amount_set_at IS
  'When price_amount_set_by had set the source amount (P1-32-PRE-OD-FD8).';

-- Copied from the source the line names, whatever the writer supplied; kept while
-- the line keeps its source.
CREATE OR REPLACE FUNCTION quo.snapshot_quotation_item_price_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.price_rule_ref IS NOT DISTINCT FROM OLD.price_rule_ref
     AND NEW.item_sale_price_ref IS NOT DISTINCT FROM OLD.item_sale_price_ref THEN
    NEW.price_changed_by := OLD.price_changed_by;
    NEW.price_changed_at := OLD.price_changed_at;
    NEW.price_published_by := OLD.price_published_by;
    NEW.price_published_at := OLD.price_published_at;
    NEW.price_amount_set_by := OLD.price_amount_set_by;
    NEW.price_amount_set_at := OLD.price_amount_set_at;
    RETURN NEW;
  END IF;
  NEW.price_changed_by := NULL;
  NEW.price_changed_at := NULL;
  NEW.price_published_by := NULL;
  NEW.price_published_at := NULL;
  NEW.price_amount_set_by := NULL;
  NEW.price_amount_set_at := NULL;
  IF NEW.price_rule_ref IS NOT NULL THEN
    SELECT r.price_changed_by, r.price_changed_at, v.published_by, v.published_at,
           r.amount_set_by, r.amount_set_at
      INTO NEW.price_changed_by, NEW.price_changed_at, NEW.price_published_by, NEW.price_published_at,
           NEW.price_amount_set_by, NEW.price_amount_set_at
      FROM svc.price_rules r
      JOIN svc.price_list_versions v
        ON v.tenant_id = r.tenant_id AND v.id = r.price_list_version_id
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.price_rule_ref;
  ELSIF NEW.item_sale_price_ref IS NOT NULL THEN
    SELECT p.price_changed_by, p.price_changed_at, p.amount_set_by, p.amount_set_at
      INTO NEW.price_changed_by, NEW.price_changed_at, NEW.price_amount_set_by, NEW.price_amount_set_at
      FROM inv.item_sale_prices p
     WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.item_sale_price_ref;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.snapshot_quotation_item_price_provenance() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. The D8 basis: a line is the requester's own price when they set its amount.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quo.revision_self_change_basis(p_revision uuid, p_person uuid)
RETURNS TABLE (own_policy boolean, own_price boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT
    p_person IS NOT NULL AND EXISTS (
      SELECT 1
        FROM quo.quotation_revisions r
        JOIN quo.quotations q
          ON q.tenant_id = r.tenant_id AND q.id = r.quotation_id
        JOIN svc.pricing_approval_policies p
          ON p.tenant_id = q.tenant_id AND p.id = q.discount_policy_id
         AND p.version_no = q.discount_policy_version_no
       WHERE r.id = p_revision
         AND q.discount_policy_pinned_at IS NOT NULL
         AND p.set_by = p_person),
    p_person IS NOT NULL AND EXISTS (
      SELECT 1
        FROM quo.quotation_items i
       WHERE i.quotation_revision_id = p_revision
         AND i.deleted_at IS NULL
         AND (i.price_amount_set_by = p_person
              OR i.price_changed_by = p_person
              OR i.price_published_by = p_person));
$$;
COMMENT ON FUNCTION quo.revision_self_change_basis(uuid, uuid) IS
  'D8 (P1-32-PRE-OD-FD8): whether p_person recorded the discount policy version the revision''s quotation is held to (own_policy), or — when the line was written — had set the amount of, last changed, or published the price of any live line of the revision (own_price). A revision whose requester set either needs approval by somebody else for any discount.';

-- ----------------------------------------------------------------------------
-- 4. quo.guard_discount_approval — a limit whose window the requester moved.
--    Re-issued whole; only the approval branch changes: the approver's roles are
--    read once, any discount limit of the approver in the company that the
--    REQUESTER last changed refuses the approval, and the ceiling is then chosen
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
    -- D8: a limit window is a limit change. When the REQUESTER last changed any
    -- discount limit of the approver in this company — reopening or extending one,
    -- or ending one so that another applies — none of the approver's limits counts
    -- for this request. updated_by is stamped from the session by
    -- shared.touch_row_metadata, and effective_to is the only column the
    -- application may change.
    IF EXISTS (
      SELECT 1 FROM iam.approval_limits al
       WHERE al.tenant_id = OLD.tenant_id AND al.company_id = OLD.company_id
         AND al.limit_type = 'discount'
         AND al.updated_by = OLD.requested_by
         AND (al.user_id = v_decider OR (al.user_id IS NULL AND al.role_id = ANY (v_roles)))
    ) THEN
      RAISE EXCEPTION 'discount_no_approval_limit: the approver of discount approval % holds a discount approval limit whose dates the requester changed, so none of their limits counts for it', OLD.id
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
--   Re-run, as written in 20261007090000, its quo.guard_discount_approval,
--   quo.revision_self_change_basis (with its COMMENT),
--   quo.snapshot_quotation_item_price_provenance, svc.stamp_price_rule_provenance
--   and inv.stamp_item_sale_price_provenance; then
--   ALTER TABLE quo.quotation_items DROP COLUMN price_amount_set_at,
--     DROP COLUMN price_amount_set_by;
--   ALTER TABLE inv.item_sale_prices DROP COLUMN amount_set_at, DROP COLUMN amount_set_by;
--   ALTER TABLE svc.price_rules DROP COLUMN amount_set_at, DROP COLUMN amount_set_by;
-- ----------------------------------------------------------------------------
