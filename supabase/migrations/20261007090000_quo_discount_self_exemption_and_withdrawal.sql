-- ============================================================================
-- P1-32-PRE-OD-FD8 — no self-benefit from one's own policy, limit or price
-- changes (Owner decision D8), and the requester's withdrawal of a pending
-- discount request (Owner decision D3), ADR-023, approved 2026-09-30.
-- Owner module: quo (the D8 rule, the provenance snapshot on quotation lines,
--   the withdrawn state of a discount request), svc (who set a discount
--   threshold version, who last changed a price rule, who published a
--   price-list version), inv (who last changed an item selling price)
--
-- Rollback classification: ROLLBACK-SAFE while no discount request has been
--   withdrawn; roll-forward-only once one has, because the withdrawn state and
--   its stamp are the only record that the requester took the request back.
--   The provenance columns are evidence once written. Forward-only — the
--   inverse at the foot of this file is for a rehearsal copy only.
--
-- Purpose
--   D8: "Changing one's own threshold, role limit or price list never exempts
--   one's own quotation from approval. Provenance and snapshots are kept. There
--   is no sole-administrator exception."
--
--   Before this migration a quotation was held to the discount policy version in
--   force when it was written (20260925090000), and an approver's own limit never
--   counted. Three gaps remained:
--     * a person could record a new, higher threshold version and then write a
--       quotation of their own under it: the new quotation was pinned to their
--       own version and its discount needed no approval;
--     * a person could set the approval limit of a colleague (or of a role the
--       colleague holds) high enough for the colleague to approve that person's
--       own discount;
--     * a person could change a price rule or an item selling price and quote at
--       it with a discount measured against a base they had set themselves.
--   And who set a threshold, a price rule or an item selling price was recorded
--   only in the audit trail (and, for the policy, in a created_by the writer
--   supplied); a price changed in place kept no trace of who changed it on the
--   row.
--
--   1. PROVENANCE IS STORED ON THE ROW, stamped by the database from the
--      signed-in person (iam.current_user_id()), never taken from the writer:
--        * svc.pricing_approval_policies.set_by / set_at — who recorded this
--          threshold version and when (a version's content never changes after
--          it is written, so its recording is its only change);
--        * svc.price_rules.price_changed_by / price_changed_at — who last changed
--          the values that price a line (amount, tax class, narrowing, priority,
--          status, deletion) and when;
--        * svc.price_list_versions.published_by / published_at — who published the
--          version and when (its rules are frozen once it is published, so the
--          publication is the last change that put them in force);
--        * inv.item_sale_prices.price_changed_by / price_changed_at — who last
--          changed the selling price, its currency, tax class, status or deletion.
--      COLUMNS, NOT A HISTORY TABLE: the D8 rule needs only "who put the value in
--      force", and a column answers it in one read; the values before a change are
--      already in the audit trail, and a policy version and an approval limit are
--      immutable rows of their own (an approval limit's iam.approval_limits.created_by
--      has been stamped from the signed-in person since 20260925090000, and its
--      amount never changes, so it needs no new column). A write with nobody
--      signed in (a migration, seed or provisioning role) is unattributed (NULL) and
--      is attributed to nobody: the application always writes as a signed-in
--      person.
--
--   2. THE PROVENANCE A QUOTATION LINE WAS PRICED UNDER IS SNAPSHOTTED.
--      quo.quotation_items gains price_changed_by / price_changed_at /
--      price_published_by / price_published_at, copied by the database from the
--      price rule (and its price-list version) or the item selling price the line
--      names, when the line is written. A later change to the source does not move
--      them. The policy version a quotation is pinned to is an immutable row whose
--      set_by never changes, so the pin is already its provenance snapshot.
--
--   3. THE D8 RULE. quo.revision_self_change_basis(revision, person) answers
--      whether that person recorded the discount policy version the revision's
--      quotation is held to (own_policy), or last changed or published the price
--      of any of its lines (own_price). A revision whose discount is not zero and
--      whose REQUESTER (its creator) set either one needs approval by somebody
--      else, whatever the threshold says:
--        * the application records the request when the revision is written;
--        * quo.revision_discount_needs_approval — which the issue guard asks of a
--          revision with no request — answers true, so a revision written around
--          the application cannot be issued without one;
--        * the request records why (requester_set_policy, requester_set_price),
--          computed by the database.
--      READING CHOSEN, AND WHY: the text allows evaluating under the version in
--      force before the person's change. A price changed in place keeps no earlier
--      value on the row, and an earlier policy version may itself be that person's,
--      so a reconstruction is not always possible. Requiring an independent
--      approver whenever the evaluation relied on the requester's own change never
--      grants more than any reconstruction would, and it is the same rule for the
--      threshold and for prices. A discount of zero gives nothing away and needs
--      no discount approval; whether a price a person set themselves, quoted with no
--      discount, needs a second person is an open point for the Owner.
--
--      AN APPROVER'S LIMIT NEVER COUNTS WHEN THE REQUESTER SET IT. The approval
--      limit that counts already excluded a limit the approver created; it now also
--      excludes a limit the REQUESTER created (for the approver or for a role the
--      approver holds), so the requester cannot raise somebody else's limit to get
--      their own discount through. The limit the approval relied on is recorded on
--      the request (approver_limit_id), an immutable row with its own created_by.
--
--      NO SOLE-ADMINISTRATOR EXCEPTION: the requester never decides their own
--      request (unchanged), so a tenant with one person cannot give a discount that
--      needs approval; a second authorised person is required, as for D4.
--
--   4. D3 — THE REQUESTER WITHDRAWS THEIR OWN PENDING REQUEST.
--      quo.discount_approvals gains the state 'withdrawn' and withdrawn_by /
--      withdrawn_at, stamped by quo.guard_discount_approval: only the requester,
--      signed in, withdraws, and only a pending request; a withdrawn request is
--      terminal and is never approved, rejected or superseded. Its revision cannot
--      be issued (the issue guard refuses a request that is not approved) and keeps
--      its lines; revising the quotation writes a new revision that asks again when
--      its discount needs approval, or carries no discount. Rejection by another
--      authorised person with a reason is unchanged (20260925090000).
--
-- Existing rows
--   Policy versions: set_by / set_at from created_by / created_at (the application
--   wrote created_by as the signed-in person). Price rules and item selling prices:
--   price_changed_by / price_changed_at from the last recorded writer
--   (COALESCE(updated_by, created_by), COALESCE(updated_at, created_at)) — the
--   closest evidence the rows hold, not a verified attribution. Price-list
--   versions: published_by / published_at stay NULL — no row recorded who
--   published it. The backfills run with the row-metadata trigger (and, for price
--   rules, the published-version freeze) disabled, so no record_version, updated_by
--   or updated_at moves; a failure rolls the disable back with everything else.
--   Existing quotation lines keep NULL provenance (not snapshotted when written);
--   existing requests keep false reasons and no approver limit id. No request is
--   written, decided or superseded.
--
-- Security implications
--   No new table, role, grant or SECURITY DEFINER. Every function is SECURITY
--   INVOKER and reads under the caller's own row security. The discount-approval
--   UPDATE policy admits a withdrawn row only when the signed-in person withdrew
--   it.
--
-- Dependencies
--   20260723092000 (svc pricing), 20260723096000 (quo quotations),
--   20260917092000 (inv item selling prices), 20260925090000 (discount
--   approvals), 20261005100000 (part line snapshots).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Provenance on the rows that decide a discount approval or price a line.
-- ----------------------------------------------------------------------------

-- 1a. svc.pricing_approval_policies — who recorded the version.
ALTER TABLE svc.pricing_approval_policies
  ADD COLUMN set_by uuid        NULL,
  ADD COLUMN set_at timestamptz NULL;
COMMENT ON COLUMN svc.pricing_approval_policies.set_by IS
  'Who recorded this threshold version (P1-32-PRE-OD-FD8, D8): the signed-in person, stamped by svc.stamp_pricing_approval_policy_provenance and never changed. NULL when nobody was signed in. A quotation whose requester recorded the version it is held to needs approval by somebody else for any discount.';
COMMENT ON COLUMN svc.pricing_approval_policies.set_at IS
  'When this threshold version was recorded (P1-32-PRE-OD-FD8). Stamped with set_by; never changed.';

ALTER TABLE svc.pricing_approval_policies DISABLE TRIGGER tg_pricing_approval_policies_touch_metadata;
UPDATE svc.pricing_approval_policies SET set_by = created_by, set_at = created_at;
ALTER TABLE svc.pricing_approval_policies ENABLE TRIGGER tg_pricing_approval_policies_touch_metadata;

CREATE OR REPLACE FUNCTION svc.stamp_pricing_approval_policy_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.set_by := iam.current_user_id();
    NEW.set_at := now();
  ELSE
    NEW.set_by := OLD.set_by;
    NEW.set_at := OLD.set_at;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.stamp_pricing_approval_policy_provenance() FROM PUBLIC;
CREATE TRIGGER tg_pricing_approval_policies_provenance BEFORE INSERT OR UPDATE ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION svc.stamp_pricing_approval_policy_provenance();

-- 1b. svc.price_rules — who last changed what a rule prices.
ALTER TABLE svc.price_rules
  ADD COLUMN price_changed_by uuid        NULL,
  ADD COLUMN price_changed_at timestamptz NULL;
COMMENT ON COLUMN svc.price_rules.price_changed_by IS
  'Who last changed the values that price a line from this rule — amount, tax class, company, branch, customer class, priority, status or deletion (P1-32-PRE-OD-FD8, D8). The signed-in person, stamped by svc.stamp_price_rule_provenance; NULL when nobody was signed in. Rows written before migration 20261007090000 carry their last recorded writer.';
COMMENT ON COLUMN svc.price_rules.price_changed_at IS
  'When price_changed_by changed the rule (P1-32-PRE-OD-FD8).';

ALTER TABLE svc.price_rules DISABLE TRIGGER tg_price_rules_touch_metadata;
ALTER TABLE svc.price_rules DISABLE TRIGGER tg_price_rules_parent_frozen;
UPDATE svc.price_rules
   SET price_changed_by = COALESCE(updated_by, created_by),
       price_changed_at = COALESCE(updated_at, created_at);
ALTER TABLE svc.price_rules ENABLE TRIGGER tg_price_rules_parent_frozen;
ALTER TABLE svc.price_rules ENABLE TRIGGER tg_price_rules_touch_metadata;

CREATE OR REPLACE FUNCTION svc.stamp_price_rule_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
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
CREATE TRIGGER tg_price_rules_provenance BEFORE INSERT OR UPDATE ON svc.price_rules
  FOR EACH ROW EXECUTE FUNCTION svc.stamp_price_rule_provenance();

-- 1c. svc.price_list_versions — who published the version.
ALTER TABLE svc.price_list_versions
  ADD COLUMN published_by uuid        NULL,
  ADD COLUMN published_at timestamptz NULL;
COMMENT ON COLUMN svc.price_list_versions.published_by IS
  'Who published this price-list version, putting its frozen rules in force (P1-32-PRE-OD-FD8, D8). The signed-in person, stamped by svc.stamp_price_list_version_publication when the version becomes published and never changed; NULL when nobody was signed in, and for a version published before migration 20261007090000 (no row recorded who).';
COMMENT ON COLUMN svc.price_list_versions.published_at IS
  'When the version was published (P1-32-PRE-OD-FD8); NULL as published_by.';

CREATE OR REPLACE FUNCTION svc.stamp_price_list_version_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    NEW.published_by := iam.current_user_id();
    NEW.published_at := now();
  ELSIF TG_OP = 'INSERT' THEN
    NEW.published_by := NULL;
    NEW.published_at := NULL;
  ELSE
    NEW.published_by := OLD.published_by;
    NEW.published_at := OLD.published_at;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.stamp_price_list_version_publication() FROM PUBLIC;
CREATE TRIGGER tg_price_list_versions_publication BEFORE INSERT OR UPDATE ON svc.price_list_versions
  FOR EACH ROW EXECUTE FUNCTION svc.stamp_price_list_version_publication();

-- 1d. inv.item_sale_prices — who last changed the selling price.
ALTER TABLE inv.item_sale_prices
  ADD COLUMN price_changed_by uuid        NULL,
  ADD COLUMN price_changed_at timestamptz NULL;
COMMENT ON COLUMN inv.item_sale_prices.price_changed_by IS
  'Who last changed this selling price — unit price, currency, tax class, status or deletion (P1-32-PRE-OD-FD8, D8). The signed-in person, stamped by inv.stamp_item_sale_price_provenance; NULL when nobody was signed in. Rows written before migration 20261007090000 carry their last recorded writer.';
COMMENT ON COLUMN inv.item_sale_prices.price_changed_at IS
  'When price_changed_by changed the selling price (P1-32-PRE-OD-FD8).';

ALTER TABLE inv.item_sale_prices DISABLE TRIGGER tg_item_sale_prices_touch_metadata;
UPDATE inv.item_sale_prices
   SET price_changed_by = COALESCE(updated_by, created_by),
       price_changed_at = COALESCE(updated_at, created_at);
ALTER TABLE inv.item_sale_prices ENABLE TRIGGER tg_item_sale_prices_touch_metadata;

CREATE OR REPLACE FUNCTION inv.stamp_item_sale_price_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
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
CREATE TRIGGER tg_item_sale_prices_provenance BEFORE INSERT OR UPDATE ON inv.item_sale_prices
  FOR EACH ROW EXECUTE FUNCTION inv.stamp_item_sale_price_provenance();

-- ----------------------------------------------------------------------------
-- 2. quo.quotation_items — the provenance a line was priced under.
-- ----------------------------------------------------------------------------
ALTER TABLE quo.quotation_items
  ADD COLUMN price_changed_by   uuid        NULL,
  ADD COLUMN price_changed_at   timestamptz NULL,
  ADD COLUMN price_published_by uuid        NULL,
  ADD COLUMN price_published_at timestamptz NULL;
COMMENT ON COLUMN quo.quotation_items.price_changed_by IS
  'Who had last changed the price this line was priced from — its svc.price_rules row or its inv.item_sale_prices row — when the line was written (P1-32-PRE-OD-FD8, D8). Copied by quo.snapshot_quotation_item_price_provenance; a later change to the source does not move it. NULL when unattributed and for lines written before migration 20261007090000.';
COMMENT ON COLUMN quo.quotation_items.price_changed_at IS
  'When price_changed_by had changed the source price (P1-32-PRE-OD-FD8).';
COMMENT ON COLUMN quo.quotation_items.price_published_by IS
  'For a line priced from a price rule: who had published the rule''s price-list version when the line was written (P1-32-PRE-OD-FD8). NULL for a part line, when unattributed, and for lines written before migration 20261007090000.';
COMMENT ON COLUMN quo.quotation_items.price_published_at IS
  'When price_published_by had published the version (P1-32-PRE-OD-FD8).';

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
    RETURN NEW;
  END IF;
  NEW.price_changed_by := NULL;
  NEW.price_changed_at := NULL;
  NEW.price_published_by := NULL;
  NEW.price_published_at := NULL;
  IF NEW.price_rule_ref IS NOT NULL THEN
    SELECT r.price_changed_by, r.price_changed_at, v.published_by, v.published_at
      INTO NEW.price_changed_by, NEW.price_changed_at, NEW.price_published_by, NEW.price_published_at
      FROM svc.price_rules r
      JOIN svc.price_list_versions v
        ON v.tenant_id = r.tenant_id AND v.id = r.price_list_version_id
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.price_rule_ref;
  ELSIF NEW.item_sale_price_ref IS NOT NULL THEN
    SELECT p.price_changed_by, p.price_changed_at
      INTO NEW.price_changed_by, NEW.price_changed_at
      FROM inv.item_sale_prices p
     WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.item_sale_price_ref;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.snapshot_quotation_item_price_provenance() FROM PUBLIC;
CREATE TRIGGER tg_quotation_items_price_provenance BEFORE INSERT OR UPDATE ON quo.quotation_items
  FOR EACH ROW EXECUTE FUNCTION quo.snapshot_quotation_item_price_provenance();

-- ----------------------------------------------------------------------------
-- 3. The D8 rule.
-- ----------------------------------------------------------------------------
-- Whether p_person recorded the discount policy version the revision's quotation
-- is held to, or had last changed or published the price of any live line of the
-- revision when it was written. A NULL person matches nothing.
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
         AND (i.price_changed_by = p_person OR i.price_published_by = p_person));
$$;
COMMENT ON FUNCTION quo.revision_self_change_basis(uuid, uuid) IS
  'D8 (P1-32-PRE-OD-FD8): whether p_person recorded the discount policy version the revision''s quotation is held to (own_policy) or had last changed or published the price of any live line of the revision when it was written (own_price). A revision whose requester set either needs approval by somebody else for any discount.';
REVOKE EXECUTE ON FUNCTION quo.revision_self_change_basis(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.revision_self_change_basis(uuid, uuid) TO app_runtime;

-- Whether a revision's discount needs approval: measured against its quotation's
-- pinned policy (unchanged), and — D8 — needed for any discount at all when the
-- revision's creator set that policy version or a price its lines were priced at.
CREATE OR REPLACE FUNCTION quo.revision_discount_needs_approval(p_revision uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE rev quo.quotation_revisions%ROWTYPE; v_policy svc.pricing_approval_policies%ROWTYPE;
        v_needs boolean; v_total numeric; v_own boolean;
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
  IF v_total > 0 THEN
    SELECT b.own_policy OR b.own_price INTO v_own
      FROM quo.revision_self_change_basis(rev.id, rev.created_by) b;
    RETURN COALESCE(v_own, false);
  END IF;
  RETURN false;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.revision_discount_needs_approval(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.revision_discount_needs_approval(uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 4. quo.discount_approvals — why a request needs another person, the limit an
--    approval relied on, and the requester's withdrawal.
-- ----------------------------------------------------------------------------
ALTER TABLE quo.discount_approvals
  ADD COLUMN requester_set_policy boolean     NOT NULL DEFAULT false,
  ADD COLUMN requester_set_price  boolean     NOT NULL DEFAULT false,
  ADD COLUMN approver_limit_id    uuid        NULL,
  ADD COLUMN withdrawn_by         uuid        NULL,
  ADD COLUMN withdrawn_at         timestamptz NULL;
COMMENT ON COLUMN quo.discount_approvals.requester_set_policy IS
  'D8 (P1-32-PRE-OD-FD8): the requester recorded the discount policy version the quotation is held to, so the discount needs another person''s approval whatever the threshold. Computed by quo.guard_discount_approval when the request is written; never changed.';
COMMENT ON COLUMN quo.discount_approvals.requester_set_price IS
  'D8 (P1-32-PRE-OD-FD8): the requester had last changed or published the price of a line of the revision, so the discount needs another person''s approval whatever the threshold. Computed by quo.guard_discount_approval when the request is written; never changed.';
COMMENT ON COLUMN quo.discount_approvals.approver_limit_id IS
  'The iam.approval_limits row an approval relied on (P1-32-PRE-OD-FD8), written by quo.guard_discount_approval with approver_limit_amount; never one the approver or the requester created. A reference, not a foreign key: the row''s amount and created_by are immutable. NULL unless approved, and for approvals given before migration 20261007090000. Restricted, as the amount.';
COMMENT ON COLUMN quo.discount_approvals.withdrawn_by IS
  'Who withdrew the pending request (P1-32-PRE-OD-FD8, D3): always its requester, stamped from the signed-in person by quo.guard_discount_approval.';
COMMENT ON COLUMN quo.discount_approvals.withdrawn_at IS
  'When the requester withdrew the request (P1-32-PRE-OD-FD8, D3). Stamped by quo.guard_discount_approval.';

ALTER TABLE quo.discount_approvals
  ADD CONSTRAINT fk_discount_approvals_withdrawn_by FOREIGN KEY (tenant_id, withdrawn_by)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX ix_discount_approvals_withdrawn_by ON quo.discount_approvals (tenant_id, withdrawn_by);

ALTER TABLE quo.discount_approvals DROP CONSTRAINT ck_discount_approvals_status;
ALTER TABLE quo.discount_approvals
  ADD CONSTRAINT ck_discount_approvals_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'withdrawn'));
ALTER TABLE quo.discount_approvals DROP CONSTRAINT ck_discount_approvals_decided;
-- Pending and withdrawn have no decision; approved and rejected have one; a
-- superseded request keeps whatever it had.
ALTER TABLE quo.discount_approvals
  ADD CONSTRAINT ck_discount_approvals_decided CHECK (
    CASE status
      WHEN 'pending' THEN decided_at IS NULL
      WHEN 'withdrawn' THEN decided_at IS NULL
      WHEN 'superseded' THEN true
      ELSE decided_at IS NOT NULL
    END);
-- A withdrawal is the requester's own act, stamped, and only a withdrawn request
-- carries one.
ALTER TABLE quo.discount_approvals
  ADD CONSTRAINT ck_discount_approvals_withdrawn CHECK (
    (status = 'withdrawn') = (withdrawn_at IS NOT NULL)
    AND (withdrawn_by IS NULL) = (withdrawn_at IS NULL)
    AND (withdrawn_by IS NULL OR withdrawn_by = requested_by));
ALTER TABLE quo.discount_approvals
  ADD CONSTRAINT ck_discount_approvals_limit_id CHECK (approver_limit_id IS NULL OR status = 'approved');

CREATE OR REPLACE FUNCTION quo.guard_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_revision_status text; v_revision_quotation uuid; v_revision_number integer;
        v_revision_currency text; v_successor_quotation uuid; v_successor_number integer;
        v_open integer; v_policy svc.pricing_approval_policies%ROWTYPE; v_carried numeric;
        v_decider uuid; v_limit_id uuid; v_limit_amount numeric; v_limit_currency text;
        v_own_policy boolean; v_own_price boolean;
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
    -- The approver's ceiling, by the rule of callerApprovalCeiling: a limit on the
    -- approver before a role's, the largest role limit whose active grant reaches
    -- the company, in force today, and never one the approver created — nor, D8,
    -- one the REQUESTER created.
    SELECT al.id, al.amount, al.currency_code INTO v_limit_id, v_limit_amount, v_limit_currency
      FROM iam.approval_limits al
     WHERE al.tenant_id = OLD.tenant_id AND al.company_id = OLD.company_id
       AND al.limit_type = 'discount'
       AND al.effective_from <= current_date
       AND (al.effective_to IS NULL OR al.effective_to > current_date)
       AND al.created_by <> v_decider
       AND al.created_by <> OLD.requested_by
       AND (al.user_id = v_decider
            OR (al.user_id IS NULL AND al.role_id IN (
                  SELECT g.role_id
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
                     ))))
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

-- The two D8 reasons are frozen with the rest of the request's snapshot.
DROP TRIGGER tg_discount_approvals_immutable ON quo.discount_approvals;
CREATE TRIGGER tg_discount_approvals_immutable BEFORE UPDATE ON quo.discount_approvals
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'quotation_id', 'quotation_revision_id', 'origin',
    'currency_code', 'discount_total', 'discount_base', 'elevated_line_count', 'policy_id',
    'policy_version_no', 'threshold_kind', 'threshold_value', 'threshold_currency_code',
    'required_permission_code', 'requested_by', 'requested_at', 'created_at', 'created_by',
    'requester_set_policy', 'requester_set_price');

-- The decider is the signed-in person, and so is the person who withdraws;
-- quo.guard_discount_approval checks the rest. Superseding records no decision.
DROP POLICY upd_discount_approvals_scope ON quo.discount_approvals;
CREATE POLICY upd_discount_approvals_scope ON quo.discount_approvals FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (status = 'superseded'
         OR decided_by = iam.current_user_id()
         OR (status = 'withdrawn' AND withdrawn_by = iam.current_user_id())));

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only — refused once a request was withdrawn)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM quo.discount_approvals WHERE status = 'withdrawn') THEN
--       RAISE EXCEPTION 'withdrawn discount requests exist; this migration is forward-only';
--     END IF;
--   END $$;
--   Re-run sections 4 (the guard, the immutable trigger, the update policy and the
--   two CHECKs ck_discount_approvals_status / ck_discount_approvals_decided) and 3
--   (quo.revision_discount_needs_approval) of 20260925090000 as written there;
--   ALTER TABLE quo.discount_approvals DROP CONSTRAINT ck_discount_approvals_limit_id,
--     DROP CONSTRAINT ck_discount_approvals_withdrawn,
--     DROP CONSTRAINT fk_discount_approvals_withdrawn_by;
--   DROP INDEX quo.ix_discount_approvals_withdrawn_by;
--   ALTER TABLE quo.discount_approvals DROP COLUMN withdrawn_at, DROP COLUMN withdrawn_by,
--     DROP COLUMN approver_limit_id, DROP COLUMN requester_set_price,
--     DROP COLUMN requester_set_policy;
--   DROP FUNCTION quo.revision_self_change_basis(uuid, uuid);
--   DROP TRIGGER tg_quotation_items_price_provenance ON quo.quotation_items;
--   DROP FUNCTION quo.snapshot_quotation_item_price_provenance();
--   ALTER TABLE quo.quotation_items DROP COLUMN price_published_at,
--     DROP COLUMN price_published_by, DROP COLUMN price_changed_at, DROP COLUMN price_changed_by;
--   DROP TRIGGER tg_item_sale_prices_provenance ON inv.item_sale_prices;
--   DROP FUNCTION inv.stamp_item_sale_price_provenance();
--   ALTER TABLE inv.item_sale_prices DROP COLUMN price_changed_at, DROP COLUMN price_changed_by;
--   DROP TRIGGER tg_price_list_versions_publication ON svc.price_list_versions;
--   DROP FUNCTION svc.stamp_price_list_version_publication();
--   ALTER TABLE svc.price_list_versions DROP COLUMN published_at, DROP COLUMN published_by;
--   DROP TRIGGER tg_price_rules_provenance ON svc.price_rules;
--   DROP FUNCTION svc.stamp_price_rule_provenance();
--   ALTER TABLE svc.price_rules DROP COLUMN price_changed_at, DROP COLUMN price_changed_by;
--   DROP TRIGGER tg_pricing_approval_policies_provenance ON svc.pricing_approval_policies;
--   DROP FUNCTION svc.stamp_pricing_approval_policy_provenance();
--   ALTER TABLE svc.pricing_approval_policies DROP COLUMN set_at, DROP COLUMN set_by;
-- ----------------------------------------------------------------------------
