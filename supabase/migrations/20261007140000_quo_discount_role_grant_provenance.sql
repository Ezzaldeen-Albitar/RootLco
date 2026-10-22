-- ============================================================================
-- P1-32-PRE-OD-FD8 (fix round 5) — a role grant, a grant scope or a selling-price
-- withdrawal the requester made never counts for the requester's own quotation
-- (Owner decision D8, ADR-023, approved 2026-09-30).
-- Owner module: iam (who issued a role grant, who changed it, who added a grant
--   scope), inv (who withdrew a selling price), quo (the D8 rule)
--
-- Rollback classification: ROLLBACK-SAFE. Four nullable or defaulted columns, three
--   new trigger functions and their triggers; two functions re-issued under their own
--   names and signatures. Forward-only — the inverse at the foot of this file is for
--   a rehearsal copy only.
--
-- Purpose
--   D8: "Changing one's own threshold, role limit or price list never exempts one's
--   own quotation from approval. Provenance and snapshots are kept. There is no
--   sole-administrator exception."
--
--   1. A ROLE LIMIT REACHES THE APPROVER THROUGH A GRANT. quo.guard_discount_approval
--      counted the limit of every role an active grant brought to the approver in the
--      request's company, whoever issued that grant. A requester who may issue grants
--      gave the approver a role whose limit somebody else had set, and the approval
--      that had been refused for want of a limit went through on it. Granting the role
--      raised the approver's ceiling as surely as raising the role's limit would; so
--      did adding a company scope to the approver's grant, and reopening or extending
--      a grant somebody else had issued.
--
--      FIX:
--        * iam.role_grants.issued_by — the signed-in person who wrote the grant,
--          stamped on insert from the session and never moved (granted_by is the
--          writer's own claim; the application writes the signed-in person into it,
--          a direct writer may write anybody), and grant_changed_by — everyone who
--          ever changed whether or when the grant is in force (status, valid_from,
--          valid_to, revoked_at), appended and never removed. Kept by the new trigger
--          function iam.record_role_grant_provenance.
--        * iam.grant_scopes.added_by — the signed-in person who added the scope,
--          stamped on insert from the session (created_by is the writer's claim).
--          Kept by iam.stamp_grant_scope_adder.
--        * quo.guard_discount_approval counts a role's limits toward the approver's
--          ceiling only through a grant that COUNTS for the request: active, in force,
--          neither granted nor issued by the requester, never changed by the
--          requester, and — unless unrestricted — reaching the company through a
--          scope neither created nor added by the requester. A grant the approver
--          issued to themselves, changed themselves, or scoped themselves does not
--          count either: that is raising one's own ceiling, as creating one's own
--          limit is. A limit on the approver as a person is unaffected, and the
--          window-history rules of 20261007110000 still read every role an active
--          grant brings, counting or not. callerApprovalCeiling applies the same rule.
--
--   2. A WITHDRAWN SELLING PRICE. inv.resolve_item_sale_price answers the branch row,
--      else the company row, else the tenant-wide row. A requester who deactivated or
--      deleted the branch's selling price let a cheaper company price somebody else
--      set price their part line, and the line's snapshot named only that company
--      row. inv.item_sale_prices.availability_changed_by records everyone who ever
--      changed a row's status or deletion (appended, never removed; kept by
--      inv.record_item_sale_price_availability_change), and quo.revision_self_change_basis
--      counts a part line as the requester's own price when the requester ever
--      changed the status or deletion of any selling price of the line's item.
--
-- Existing rows
--   issued_by is backfilled from created_by, grant_changed_by from updated_by where a
--   grant was updated, added_by from created_by, and availability_changed_by from
--   deleted_by and updated_by where a selling price is inactive or deleted — the
--   closest evidence the rows hold, not a verified attribution — with the
--   row-metadata triggers disabled so no record_version, updated_by or updated_at
--   moves (the new triggers are created after the backfill); a failure rolls the
--   disables back with everything else. No grant, scope, price, line or request is
--   written otherwise.
--
-- Security implications
--   No new table, role, grant, policy or SECURITY DEFINER. app_runtime keeps its
--   table-level INSERT on iam.role_grants and iam.grant_scopes, its column UPDATE on
--   iam.role_grants (status, valid_to, revoked_at, revoke_reason) and its table-level
--   UPDATE on inv.item_sale_prices; the triggers set the stamp columns on every insert
--   and update whoever writes. The new functions and the re-issued ones are SECURITY
--   INVOKER with a locked search_path, and EXECUTE is revoked from PUBLIC (CREATE OR
--   REPLACE keeps the guard's ACL and the basis function's EXECUTE for app_runtime).
--
-- Dependencies
--   20260718092000 (iam.role_grants, iam.grant_scopes), 20260917092000
--   (inv.item_sale_prices), 20261007110000 (the guard as re-issued here),
--   20261007130000 (the basis as re-issued here).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.role_grants — who issued the grant, and who ever changed when it holds.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.role_grants
  ADD COLUMN issued_by        uuid   NULL,
  ADD COLUMN grant_changed_by uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
COMMENT ON COLUMN iam.role_grants.issued_by IS
  'Who wrote this grant (P1-32-PRE-OD-FD8 fix round 5, ADR-023 D8): the signed-in person, stamped by iam.record_role_grant_provenance on insert and never moved, whatever the writer supplied; granted_by is the writer''s claim. NULL when nobody was signed in. Rows written before migration 20261007140000 carry created_by.';
COMMENT ON COLUMN iam.role_grants.grant_changed_by IS
  'Everyone who ever changed whether or when this grant is in force — status, valid_from, valid_to or revoked_at — after it was written (P1-32-PRE-OD-FD8 fix round 5, ADR-023 D8): appended from the signed-in person by iam.record_role_grant_provenance, never removed, and empty on insert whatever the writer supplied. A save that changes none of them records nothing. Rows updated before migration 20261007140000 carry their updated_by.';

ALTER TABLE iam.role_grants DISABLE TRIGGER tg_role_grants_touch_metadata;
UPDATE iam.role_grants
   SET issued_by = created_by,
       grant_changed_by = CASE WHEN updated_by IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[updated_by] END;
ALTER TABLE iam.role_grants ENABLE TRIGGER tg_role_grants_touch_metadata;

CREATE OR REPLACE FUNCTION iam.record_role_grant_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.issued_by := iam.current_user_id();
    NEW.grant_changed_by := ARRAY[]::uuid[];
    RETURN NEW;
  END IF;
  NEW.issued_by := OLD.issued_by;
  NEW.grant_changed_by := OLD.grant_changed_by;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_to IS DISTINCT FROM OLD.valid_to
     OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    v_actor := iam.current_user_id();
    IF v_actor IS NOT NULL AND NOT (v_actor = ANY (OLD.grant_changed_by)) THEN
      NEW.grant_changed_by := OLD.grant_changed_by || v_actor;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION iam.record_role_grant_provenance() IS
  'BEFORE INSERT OR UPDATE on iam.role_grants (P1-32-PRE-OD-FD8 fix round 5, ADR-023 D8): stamps issued_by from the session on insert and keeps it; keeps grant_changed_by append-only — empty on insert, the previous value on every update, and the signed-in person appended when the grant''s status, valid_from, valid_to or revoked_at changes.';
REVOKE EXECUTE ON FUNCTION iam.record_role_grant_provenance() FROM PUBLIC;

CREATE TRIGGER tg_role_grants_provenance
  BEFORE INSERT OR UPDATE ON iam.role_grants
  FOR EACH ROW EXECUTE FUNCTION iam.record_role_grant_provenance();

-- ----------------------------------------------------------------------------
-- 2. iam.grant_scopes — who added the scope.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.grant_scopes
  ADD COLUMN added_by uuid NULL;
COMMENT ON COLUMN iam.grant_scopes.added_by IS
  'Who added this scope to its grant (P1-32-PRE-OD-FD8 fix round 5, ADR-023 D8): the signed-in person, stamped by iam.stamp_grant_scope_adder on insert and never moved, whatever the writer supplied; created_by is the writer''s claim. NULL when nobody was signed in. Rows written before migration 20261007140000 carry created_by.';

UPDATE iam.grant_scopes SET added_by = created_by;

CREATE OR REPLACE FUNCTION iam.stamp_grant_scope_adder()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.added_by := iam.current_user_id();
  ELSE
    NEW.added_by := OLD.added_by;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION iam.stamp_grant_scope_adder() IS
  'BEFORE INSERT OR UPDATE on iam.grant_scopes (P1-32-PRE-OD-FD8 fix round 5, ADR-023 D8): stamps added_by from the session on insert and keeps it on every update.';
REVOKE EXECUTE ON FUNCTION iam.stamp_grant_scope_adder() FROM PUBLIC;

CREATE TRIGGER tg_grant_scopes_adder
  BEFORE INSERT OR UPDATE ON iam.grant_scopes
  FOR EACH ROW EXECUTE FUNCTION iam.stamp_grant_scope_adder();

-- ----------------------------------------------------------------------------
-- 3. inv.item_sale_prices — who ever withdrew or restored a selling price.
-- ----------------------------------------------------------------------------
ALTER TABLE inv.item_sale_prices
  ADD COLUMN availability_changed_by uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
COMMENT ON COLUMN inv.item_sale_prices.availability_changed_by IS
  'Everyone who ever changed this selling price''s status or deletion after it was written (P1-32-PRE-OD-FD8 fix round 5, ADR-023 D8): appended from the signed-in person by inv.record_item_sale_price_availability_change, never removed, and empty on insert whatever the writer supplied. Withdrawing a more specific price hands the line to a less specific one, so quo.revision_self_change_basis reads it for every selling price of the line''s item. Inactive or deleted rows written before migration 20261007140000 carry their deleted_by and updated_by.';

ALTER TABLE inv.item_sale_prices DISABLE TRIGGER tg_item_sale_prices_touch_metadata;
UPDATE inv.item_sale_prices
   SET availability_changed_by = ARRAY(
         SELECT DISTINCT x
           FROM unnest(ARRAY[deleted_by, updated_by]) AS x
          WHERE x IS NOT NULL)
 WHERE status <> 'active' OR deleted_at IS NOT NULL;
ALTER TABLE inv.item_sale_prices ENABLE TRIGGER tg_item_sale_prices_touch_metadata;

CREATE OR REPLACE FUNCTION inv.record_item_sale_price_availability_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.availability_changed_by := ARRAY[]::uuid[];
    RETURN NEW;
  END IF;
  NEW.availability_changed_by := OLD.availability_changed_by;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    v_actor := iam.current_user_id();
    IF v_actor IS NOT NULL AND NOT (v_actor = ANY (OLD.availability_changed_by)) THEN
      NEW.availability_changed_by := OLD.availability_changed_by || v_actor;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION inv.record_item_sale_price_availability_change() IS
  'BEFORE INSERT OR UPDATE on inv.item_sale_prices (P1-32-PRE-OD-FD8 fix round 5, ADR-023 D8): keeps availability_changed_by append-only — empty on insert, the previous value on every update, and the signed-in person appended when the row''s status or deletion changes.';
REVOKE EXECUTE ON FUNCTION inv.record_item_sale_price_availability_change() FROM PUBLIC;

CREATE TRIGGER tg_item_sale_prices_availability_history
  BEFORE INSERT OR UPDATE ON inv.item_sale_prices
  FOR EACH ROW EXECUTE FUNCTION inv.record_item_sale_price_availability_change();

-- ----------------------------------------------------------------------------
-- 4. The D8 basis: a part line is the requester's own price also when the
--    requester ever withdrew or restored any selling price of its item.
--    Re-issued whole from 20261007130000; one clause is added.
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
    p_person IS NOT NULL AND (
      EXISTS (
        SELECT 1
          FROM quo.quotation_items i
         WHERE i.quotation_revision_id = p_revision
           AND i.deleted_at IS NULL
           AND (i.price_amount_set_by = p_person
                OR i.price_changed_by = p_person
                OR i.price_published_by = p_person
                OR i.price_assigned_by = p_person
                OR p_person = ANY (i.price_assignment_changed_by)))
      OR EXISTS (
        SELECT 1
          FROM quo.quotation_items i
          JOIN svc.price_list_assignments a
            ON a.tenant_id = i.tenant_id
         WHERE i.quotation_revision_id = p_revision
           AND i.deleted_at IS NULL
           AND i.price_rule_ref IS NOT NULL
           AND p_person = ANY (a.assignment_changed_by))
      OR EXISTS (
        SELECT 1
          FROM quo.quotation_items i
          JOIN inv.item_sale_prices src
            ON src.tenant_id = i.tenant_id AND src.id = i.item_sale_price_ref
          JOIN inv.item_sale_prices p
            ON p.tenant_id = src.tenant_id AND p.item_id = src.item_id
         WHERE i.quotation_revision_id = p_revision
           AND i.deleted_at IS NULL
           AND p_person = ANY (p.availability_changed_by)));
$$;
COMMENT ON FUNCTION quo.revision_self_change_basis(uuid, uuid) IS
  'D8 (P1-32-PRE-OD-FD8): whether p_person recorded the discount policy version the revision''s quotation is held to (own_policy), or — when the line was written — had set the amount of, last changed, or published the price of any live line of the revision, or had made or changed the price-list assignment that selected its list; or has ever changed any price-list assignment of the tenant while the revision has a line priced from a price rule; or has ever withdrawn or restored any selling price of the item of a live line priced from a selling price (own_price). A revision whose requester set a price it uses needs approval by somebody else whatever its discount; one whose requester set the threshold, for any discount.';

-- ----------------------------------------------------------------------------
-- 5. quo.guard_discount_approval — only a grant that counts brings a role's limit.
--    Re-issued whole from 20261007110000; only the approval branch changes: the
--    roles whose limits may be chosen are those a COUNTING grant brings, and the
--    ceiling is then chosen exactly as before.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quo.guard_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_revision_status text; v_revision_quotation uuid; v_revision_number integer;
        v_revision_currency text; v_successor_quotation uuid; v_successor_number integer;
        v_open integer; v_policy svc.pricing_approval_policies%ROWTYPE; v_carried numeric;
        v_decider uuid; v_limit_id uuid; v_limit_amount numeric; v_limit_currency text;
        v_own_policy boolean; v_own_price boolean; v_roles uuid[]; v_counting_roles uuid[];
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
    -- D8 (fix round 5): of those, the roles a grant that COUNTS for this request
    -- brings. A grant the requester granted or issued, or whose dates or status the
    -- requester ever changed, does not count; nor one the approver issued or changed
    -- themselves. A scoped grant reaches the company only through a scope neither
    -- the requester nor the approver created or added.
    SELECT COALESCE(array_agg(DISTINCT g.role_id), ARRAY[]::uuid[]) INTO v_counting_roles
      FROM iam.role_grants g
     WHERE g.tenant_id = OLD.tenant_id AND g.user_id = v_decider
       AND g.status = 'active'
       AND g.valid_from <= now()
       AND (g.valid_to IS NULL OR g.valid_to > now())
       AND g.granted_by IS DISTINCT FROM OLD.requested_by
       AND g.issued_by IS DISTINCT FROM OLD.requested_by
       AND g.issued_by IS DISTINCT FROM v_decider
       AND NOT (OLD.requested_by = ANY (g.grant_changed_by))
       AND NOT (v_decider = ANY (g.grant_changed_by))
       AND (
         g.scope_mode = 'unrestricted'
         OR EXISTS (
           SELECT 1 FROM iam.grant_scopes s
            WHERE s.tenant_id = g.tenant_id AND s.grant_id = g.id
              AND s.company_id = OLD.company_id
              AND s.created_by IS DISTINCT FROM OLD.requested_by
              AND s.added_by IS DISTINCT FROM OLD.requested_by
              AND s.created_by IS DISTINCT FROM v_decider
              AND s.added_by IS DISTINCT FROM v_decider
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
    -- limit of a role a counting grant brings, in force today, and never one the
    -- approver created — nor, D8, one the REQUESTER created.
    SELECT al.id, al.amount, al.currency_code INTO v_limit_id, v_limit_amount, v_limit_currency
      FROM iam.approval_limits al
     WHERE al.tenant_id = OLD.tenant_id AND al.company_id = OLD.company_id
       AND al.limit_type = 'discount'
       AND al.effective_from <= current_date
       AND (al.effective_to IS NULL OR al.effective_to > current_date)
       AND al.created_by <> v_decider
       AND al.created_by <> OLD.requested_by
       AND (al.user_id = v_decider OR (al.user_id IS NULL AND al.role_id = ANY (v_counting_roles)))
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
--   Re-run, as written in 20261007110000, its quo.guard_discount_approval, and, as
--   written in 20261007130000, its quo.revision_self_change_basis (with its
--   COMMENT); then
--   DROP TRIGGER tg_item_sale_prices_availability_history ON inv.item_sale_prices;
--   DROP FUNCTION inv.record_item_sale_price_availability_change();
--   ALTER TABLE inv.item_sale_prices DROP COLUMN availability_changed_by;
--   DROP TRIGGER tg_grant_scopes_adder ON iam.grant_scopes;
--   DROP FUNCTION iam.stamp_grant_scope_adder();
--   ALTER TABLE iam.grant_scopes DROP COLUMN added_by;
--   DROP TRIGGER tg_role_grants_provenance ON iam.role_grants;
--   DROP FUNCTION iam.record_role_grant_provenance();
--   ALTER TABLE iam.role_grants DROP COLUMN grant_changed_by, DROP COLUMN issued_by;
-- ----------------------------------------------------------------------------
