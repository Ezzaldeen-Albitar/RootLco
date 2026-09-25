-- ============================================================================
-- Phase: 1-32 (preparatory) — discount approval: a recorded request, a separate
--        approval by another person, and a versioned company threshold
-- Migration: quo.discount_approvals; svc.pricing_approval_policies.version_no
-- Tasks: P1-32-PRE-OD-DISC-01, P1-32-PRE-OD-DISC-04
-- Owner module: quo (discount approvals), svc (policy versions)
--
-- Rollback classification: ROLL-FORWARD-ONLY once a discount approval has been
--   recorded: it is the only evidence of who asked for a discount and who approved
--   it. ROLLBACK-SAFE while quo.discount_approvals is empty. No down script.
--
-- Purpose
--   Before this migration a discount that needed approval was decided inside the
--   single request that created the quotation. The caller was both the one who
--   asked and the one whose approval limit was checked, and the only separation
--   of duties was a colleague the caller NAMED in the request body. Naming any
--   active colleague satisfied it, so a person could approve their own discount by
--   typing somebody else's name. Nothing about the request was stored.
--
--     * A DISCOUNT THAT NEEDS APPROVAL IS A RECORDED REQUEST. `quo.discount_approvals`
--       holds one row per quotation revision whose discount needs approval.
--       `requested_by` is the signed-in person who created the revision —
--       `ins_discount_approvals_scope` refuses any other value — so the requester is
--       a server fact, never a claim.
--
--     * APPROVAL IS A SEPARATE ACT BY ANOTHER PERSON. The row is born `pending`
--       (`quo.guard_discount_approval`); it becomes `approved` or `rejected` only by
--       an UPDATE whose `decided_by` is the signed-in person
--       (`upd_discount_approvals_scope`), and `ck_discount_approvals_separation`
--       refuses a decider who is the requester. There is no exception for a sole
--       administrator and no column that switches the rule off.
--
--     * AN APPROVAL IS OF AN AMOUNT. The approval records the discount total and
--       currency it approved (`approved_discount_total`, `approved_currency_code`),
--       and the issue guard compares them with the discount `quo.issue_revision`
--       sums from the lines. A revision whose discount is not the one approved is
--       not issued.
--
--     * A DISCOUNT THAT NEEDS APPROVAL IS NOT ISSUED WITHOUT ONE.
--       `quo.guard_revision_discount_approval` refuses the draft -> issued transition
--       of a revision whose approval is not `approved`. A revision with NO approval
--       row is measured at the database (`quo.revision_discount_needs_approval`):
--       against the snapshot of the request it replaced when there was one, and
--       otherwise against the policy in force at issue — so a legacy draft that was
--       discounted under the single-request flow, or a row written around the
--       application, cannot be issued merely because no request exists.
--
--     * LEGACY DRAFTS ASK AGAIN. Draft revisions written before this migration whose
--       discount needs approval under the policy in force now are given a PENDING
--       request (`origin = 'backfilled'`), requested by the revision's own creator,
--       so a different person must approve them. Issued and closed revisions are
--       not touched.
--
--     * THE POLICY IN FORCE AT THE REQUEST IS SNAPSHOTTED, AND IT STAYS IN FORCE FOR
--       THE QUOTATION. The row copies the policy version it was measured against —
--       id, version number, kind, value, currency and the permission an approver
--       must hold. While a quotation holds a pending or rejected request, every new
--       revision of it is measured against that snapshot, not against the company
--       threshold of the moment: the request it replaces becomes `superseded` (never
--       approvable), and a new pending request is recorded under the same snapshot
--       when the discount still needs it. Raising the threshold after asking
--       therefore approves nothing, and revising does not escape it; the snapshot is
--       released only by an approval or by bringing the discount under it. New
--       quotations are measured against the policy in force when they are written —
--       a threshold change is prospective.
--
--     * AN APPROVAL RECORDS THE LIMIT IT WAS WITHIN. `approver_limit_amount` and its
--       currency are the approver's limit at the moment of approval, and
--       `ck_discount_approvals_within_limit` refuses an approval whose limit is in
--       another currency or below the discount.
--
--     * A THRESHOLD CHANGE IS A NEW VERSION. `svc.pricing_approval_policies` gains
--       `version_no`, unique per (tenant, company, policy type) over every row,
--       deleted and inactive ones included. A version is written only as the NEXT
--       number of its scope, and writing it retires the version it replaces
--       (`svc.record_pricing_approval_policy_version`). Nothing else changes a
--       version: its content, `effective_to` and `deleted_at` are immutable
--       (`tg_pricing_approval_policies_version_immutable`) and its status moves only
--       through that retirement (`svc.guard_pricing_approval_policy_status`).
--
--   `maker_approver_distinct` is left in place and is NOT read by anything: it is a
--   legacy column, and no configuration may switch the separation off.
--
-- Dependencies
--   quo.quotations, quo.quotation_revisions, quo.quotation_items (20260723096000);
--   svc.pricing_approval_policies (20260723092000); iam.permissions;
--   shared.currencies; iam.current_tenant_id, iam.current_user_id,
--   iam.allowed_company_ids, iam.allowed_branch_ids (0002_base_schemas);
--   shared.touch_row_metadata; org.guard_immutable_columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. svc.pricing_approval_policies — numbered, immutable versions.
-- ----------------------------------------------------------------------------
ALTER TABLE svc.pricing_approval_policies ADD COLUMN version_no integer NOT NULL DEFAULT 1;

-- Rows written before versions existed: number EVERY row of each scope — deleted
-- and inactive ones included — in the order it was created, with the id breaking a
-- tie, so the unique signature below holds for a database that already carries
-- history and the next version is always one above every number already used.
UPDATE svc.pricing_approval_policies p
   SET version_no = numbered.rn
  FROM (
    SELECT id, row_number() OVER (
             PARTITION BY tenant_id, company_id, policy_type ORDER BY created_at, id) AS rn
      FROM svc.pricing_approval_policies
  ) AS numbered
 WHERE numbered.id = p.id AND p.version_no <> numbered.rn;

ALTER TABLE svc.pricing_approval_policies
  ADD CONSTRAINT ck_pricing_approval_policies_version_no CHECK (version_no > 0);
CREATE UNIQUE INDEX uq_pricing_approval_policies_version
  ON svc.pricing_approval_policies (tenant_id, company_id, policy_type, version_no) NULLS NOT DISTINCT;
COMMENT ON COLUMN svc.pricing_approval_policies.version_no IS
  'The version of this (company, policy type) policy, from 1, unique over every row of the scope including deleted and inactive ones. A threshold change records the next version, which retires the previous one; a version is otherwise immutable.';

-- A version's content, validity and deletion never change after it is written.
CREATE TRIGGER tg_pricing_approval_policies_version_immutable BEFORE UPDATE ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'company_id', 'policy_type', 'threshold_kind', 'threshold_value', 'currency_code',
    'required_permission_code', 'maker_approver_distinct', 'version_no', 'effective_from',
    'effective_to', 'deleted_at', 'deleted_by');

-- A version's status moves once — active -> inactive — and only when the next
-- version of the same scope is recorded (the retirement below runs inside that
-- INSERT, one trigger level down). A direct UPDATE of status, either way, is
-- refused: it would change the threshold without recording a version.
CREATE OR REPLACE FUNCTION svc.guard_pricing_approval_policy_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status = 'inactive' AND pg_trigger_depth() > 1) THEN
    RAISE EXCEPTION 'svc.pricing_approval_policies: a policy version''s status changes only when the next version is recorded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_pricing_approval_policy_status() FROM PUBLIC;
CREATE TRIGGER tg_pricing_approval_policies_status BEFORE UPDATE ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION svc.guard_pricing_approval_policy_status();

-- Recording a version: it must be the NEXT number of its scope, counted over every
-- row the scope has ever held, and an active version retires the one it replaces.
-- Two writers that read the same latest version both try to land the same number;
-- the second fails on uq_pricing_approval_policies_version (or on this check, with
-- the same SQLSTATE) and its transaction rolls back.
CREATE OR REPLACE FUNCTION svc.record_pricing_approval_policy_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_latest integer;
BEGIN
  SELECT max(version_no) INTO v_latest
    FROM svc.pricing_approval_policies
   WHERE tenant_id = NEW.tenant_id AND company_id IS NOT DISTINCT FROM NEW.company_id
     AND policy_type = NEW.policy_type;
  IF NEW.version_no <> COALESCE(v_latest, 0) + 1 THEN
    RAISE EXCEPTION 'svc.pricing_approval_policies: version % is not the next version of this policy (the latest is %)',
      NEW.version_no, COALESCE(v_latest, 0)
      USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.status = 'active' AND NEW.deleted_at IS NULL THEN
    UPDATE svc.pricing_approval_policies
       SET status = 'inactive'
     WHERE tenant_id = NEW.tenant_id AND company_id IS NOT DISTINCT FROM NEW.company_id
       AND policy_type = NEW.policy_type AND status = 'active' AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.record_pricing_approval_policy_version() FROM PUBLIC;
CREATE TRIGGER tg_pricing_approval_policies_record_version BEFORE INSERT ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION svc.record_pricing_approval_policy_version();

-- The discount policy in force for a company on a date: the company's own active
-- version, else the organisation-wide one. The same rule, in the same order, as
-- PricingRepository.findApprovalPolicy. No row means none is configured, which the
-- callers read as a threshold of zero.
CREATE OR REPLACE FUNCTION svc.discount_policy_in_force(p_tenant uuid, p_company uuid, p_as_of date)
RETURNS svc.pricing_approval_policies LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p.*
    FROM svc.pricing_approval_policies p
   WHERE p.tenant_id = p_tenant AND p.policy_type = 'discount'
     AND p.status = 'active' AND p.deleted_at IS NULL
     AND (p.company_id IS NULL OR p.company_id = p_company)
     AND p.effective_from <= p_as_of
     AND (p.effective_to IS NULL OR p.effective_to > p_as_of)
   ORDER BY (p.company_id IS NOT NULL) DESC, p.id
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION svc.discount_policy_in_force(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION svc.discount_policy_in_force(uuid, uuid, date) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Measuring a revision's discount against a threshold — at the database.
-- ----------------------------------------------------------------------------
-- The application measures a discount when the revision is written
-- (DiscountAuthorizationService.assess); this is the same measurement, so the
-- database can hold the line where no request exists. Each discounted line AND the
-- whole revision are measured — a per-line check alone is defeated by splitting —
-- and each one fails closed exactly as the application does: no policy means a
-- threshold of zero; an amount threshold in another currency, a percentage outside
-- 0..100 or an unknown kind count as exceeded. A percentage is compared by cross
-- multiplication (discount * 100 >= threshold * base), never by dividing.
CREATE OR REPLACE FUNCTION quo.revision_discount_assessment(
  p_tenant uuid, p_revision uuid, p_configured boolean, p_kind text, p_value numeric,
  p_currency text)
RETURNS TABLE (discount_total numeric, discount_base numeric, elevated_lines integer, needs_approval boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH lines AS (
    SELECT i.captured_discount AS d,
           i.captured_unit_price * i.captured_quantity AS b,
           i.currency_code AS c
      FROM quo.quotation_items i
     WHERE i.tenant_id = p_tenant AND i.quotation_revision_id = p_revision
       AND i.deleted_at IS NULL
  ), measured AS (
    SELECT l.d, l.b, l.c, false AS aggregate FROM lines l WHERE l.d > 0
    UNION ALL
    SELECT sum(l.d), sum(l.b), min(l.c), true FROM lines l HAVING sum(l.d) > 0
  ), judged AS (
    SELECT m.aggregate,
           (NOT p_configured
             OR p_kind IS NULL
             OR p_kind NOT IN ('amount', 'percentage')
             OR (p_kind = 'amount' AND (p_currency IS DISTINCT FROM m.c OR m.d >= p_value))
             OR (p_kind = 'percentage'
                 AND (p_value < 0 OR p_value > 100 OR m.d * 100 >= p_value * m.b))) AS reaches
      FROM measured m
  )
  SELECT COALESCE((SELECT sum(l.d) FROM lines l), 0),
         COALESCE((SELECT sum(l.b) FROM lines l), 0),
         (SELECT count(*)::integer FROM judged j WHERE NOT j.aggregate AND j.reaches),
         EXISTS (SELECT 1 FROM judged j WHERE j.reaches);
$$;
REVOKE EXECUTE ON FUNCTION quo.revision_discount_assessment(uuid, uuid, boolean, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.revision_discount_assessment(uuid, uuid, boolean, text, numeric, text) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 3. quo.discount_approvals — one recorded request per revision that needs it.
-- ----------------------------------------------------------------------------
CREATE TABLE quo.discount_approvals (
  id                           uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                    uuid    NOT NULL,
  company_id                   uuid    NOT NULL,
  branch_id                    uuid    NOT NULL,
  quotation_id                 uuid    NOT NULL,
  quotation_revision_id        uuid    NOT NULL,
  status                       text    NOT NULL DEFAULT 'pending',
  origin                       text    NOT NULL DEFAULT 'requested',
  currency_code                text    NOT NULL,
  discount_total               numeric(18, 4) NOT NULL,
  discount_base                numeric(18, 4) NOT NULL,
  elevated_line_count          integer NOT NULL,
  policy_id                    uuid    NULL,
  policy_version_no            integer NULL,
  threshold_kind               text    NULL,
  threshold_value              numeric(18, 4) NULL,
  threshold_currency_code      text    NULL,
  required_permission_code     text    NOT NULL,
  requested_by                 uuid    NOT NULL,
  requested_at                 timestamptz NOT NULL DEFAULT now(),
  decided_by                   uuid    NULL,
  decided_at                   timestamptz NULL,
  decision_reason              text    NULL,
  approver_limit_amount        numeric(18, 4) NULL,
  approver_limit_currency_code text    NULL,
  approved_discount_total      numeric(18, 4) NULL,
  approved_currency_code       text    NULL,
  superseded_at                timestamptz NULL,
  superseded_by_revision_id    uuid    NULL,
  record_version               integer NOT NULL DEFAULT 1,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid    NOT NULL,
  updated_at                   timestamptz NULL,
  updated_by                   uuid    NULL,

  CONSTRAINT pk_discount_approvals PRIMARY KEY (id),
  CONSTRAINT uq_discount_approvals_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT uq_discount_approvals_revision UNIQUE (tenant_id, quotation_revision_id),
  CONSTRAINT fk_discount_approvals_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_quotation FOREIGN KEY (tenant_id, company_id, branch_id, quotation_id)
    REFERENCES quo.quotations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_revision FOREIGN KEY (tenant_id, company_id, branch_id, quotation_revision_id)
    REFERENCES quo.quotation_revisions (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_superseded_by FOREIGN KEY (tenant_id, company_id, branch_id, superseded_by_revision_id)
    REFERENCES quo.quotation_revisions (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_threshold_currency FOREIGN KEY (threshold_currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_limit_currency FOREIGN KEY (approver_limit_currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_permission FOREIGN KEY (required_permission_code) REFERENCES iam.permissions (permission_code) ON DELETE RESTRICT,
  CONSTRAINT ck_discount_approvals_status CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  CONSTRAINT ck_discount_approvals_origin CHECK (origin IN ('requested', 'backfilled')),
  CONSTRAINT ck_discount_approvals_amounts CHECK (discount_total > 0 AND discount_base >= discount_total),
  CONSTRAINT ck_discount_approvals_elevated_lines CHECK (elevated_line_count >= 0),
  CONSTRAINT ck_discount_approvals_policy_snapshot CHECK (
    (policy_id IS NULL) = (policy_version_no IS NULL)
    AND (policy_id IS NULL) = (threshold_kind IS NULL)
    AND (policy_id IS NULL) = (threshold_value IS NULL)),
  CONSTRAINT ck_discount_approvals_threshold_kind CHECK (
    (threshold_kind IS NULL AND threshold_currency_code IS NULL)
    OR (threshold_kind = 'percentage' AND threshold_currency_code IS NULL)
    OR (threshold_kind = 'amount' AND threshold_currency_code IS NOT NULL)),
  CONSTRAINT ck_discount_approvals_threshold_value CHECK (threshold_value IS NULL OR threshold_value >= 0),
  CONSTRAINT ck_discount_approvals_decided_pair CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  -- Pending has no decision and approved/rejected have one; a superseded request
  -- keeps whatever it had (a rejection stays on record when it is superseded).
  CONSTRAINT ck_discount_approvals_decided CHECK (
    CASE status
      WHEN 'pending' THEN decided_at IS NULL
      WHEN 'superseded' THEN true
      ELSE decided_at IS NOT NULL
    END),
  CONSTRAINT ck_discount_approvals_separation CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT ck_discount_approvals_rejection_reason CHECK (
    (status <> 'rejected' OR decision_reason IS NOT NULL)
    AND (decision_reason IS NULL OR btrim(decision_reason) <> '')),
  CONSTRAINT ck_discount_approvals_limit_pair CHECK (
    (approver_limit_amount IS NULL) = (approver_limit_currency_code IS NULL)),
  CONSTRAINT ck_discount_approvals_limit_state CHECK ((status = 'approved') = (approver_limit_amount IS NOT NULL)),
  CONSTRAINT ck_discount_approvals_within_limit CHECK (
    status <> 'approved'
    OR (approver_limit_currency_code = currency_code AND approver_limit_amount >= discount_total)),
  -- An approval is OF an amount: exactly the discount that was asked for, in its
  -- currency, and nothing on any other status.
  CONSTRAINT ck_discount_approvals_approved_amount CHECK (
    (status = 'approved') = (approved_discount_total IS NOT NULL)
    AND (approved_discount_total IS NULL) = (approved_currency_code IS NULL)
    AND (approved_discount_total IS NULL
         OR (approved_discount_total = discount_total AND approved_currency_code = currency_code))),
  CONSTRAINT ck_discount_approvals_superseded CHECK (
    (status = 'superseded') = (superseded_at IS NOT NULL)
    AND (superseded_at IS NULL) = (superseded_by_revision_id IS NULL))
);
COMMENT ON TABLE quo.discount_approvals IS 'A quotation revision whose discount needs approval: who asked (requested_by, always the signed-in person), the discount and its base, a snapshot of the policy version it was measured against, and the decision by a DIFFERENT person with the limit that decision was within and the amount it approved. A revision whose approval is not approved cannot be issued (quo.guard_revision_discount_approval); a request replaced by a newer revision of its quotation is superseded and can no longer be decided.';
COMMENT ON COLUMN quo.discount_approvals.origin IS 'requested: recorded when the revision was written. backfilled: recorded by migration 20260925090000 for a draft written under the single-request flow whose discount needs approval under the policy in force at that migration; requested_by is then the revision''s creator.';
COMMENT ON COLUMN quo.discount_approvals.policy_id IS 'The svc.pricing_approval_policies version the request was measured against, or NULL when the company had no policy (the threshold was then zero). A reference, not a foreign key: the snapshot columns beside it are the evidence.';
COMMENT ON COLUMN quo.discount_approvals.required_permission_code IS 'The permission an approver had to hold, copied from the policy version (svc.price.manage when none was configured).';
COMMENT ON COLUMN quo.discount_approvals.approver_limit_amount IS 'The approver''s discount approval limit at the moment of approval, in approver_limit_currency_code. Never a limit the approver set for themselves. Restricted: readers of the request never see it.';
COMMENT ON COLUMN quo.discount_approvals.approved_discount_total IS 'The discount total the approval was given for, in approved_currency_code. The issue guard refuses a revision whose summed discount is not this amount.';
COMMENT ON COLUMN quo.discount_approvals.superseded_by_revision_id IS 'The newer revision of the same quotation that replaced this pending or rejected request. A superseded request can no longer be decided.';

CREATE INDEX ix_discount_approvals_branch_status ON quo.discount_approvals (tenant_id, company_id, branch_id, status, requested_at DESC);
CREATE INDEX ix_discount_approvals_quotation ON quo.discount_approvals (tenant_id, company_id, branch_id, quotation_id);
CREATE INDEX ix_discount_approvals_revision ON quo.discount_approvals (tenant_id, company_id, branch_id, quotation_revision_id);
CREATE INDEX ix_discount_approvals_superseded_by ON quo.discount_approvals (tenant_id, company_id, branch_id, superseded_by_revision_id);
CREATE INDEX ix_discount_approvals_currency ON quo.discount_approvals (currency_code);
CREATE INDEX ix_discount_approvals_threshold_currency ON quo.discount_approvals (threshold_currency_code);
CREATE INDEX ix_discount_approvals_limit_currency ON quo.discount_approvals (approver_limit_currency_code);
CREATE INDEX ix_discount_approvals_permission ON quo.discount_approvals (required_permission_code);

CREATE OR REPLACE FUNCTION quo.guard_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_revision_status text; v_revision_quotation uuid; v_revision_number integer;
        v_successor_quotation uuid; v_successor_number integer;
        v_open integer; v_prior quo.discount_approvals%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'quo.discount_approvals: a discount approval is born pending; approving it is a separate act by another person'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT status, quotation_id INTO v_revision_status, v_revision_quotation
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
      -- A quotation holding an open (pending or rejected) request keeps its
      -- snapshot: the open request is superseded first, and the new one is measured
      -- under the SAME policy snapshot — a threshold changed since cannot be reached
      -- by asking again.
      SELECT count(*)::integer INTO v_open
        FROM quo.discount_approvals
       WHERE tenant_id = NEW.tenant_id AND quotation_id = NEW.quotation_id
         AND status IN ('pending', 'rejected');
      IF v_open > 0 THEN
        RAISE EXCEPTION 'discount_approval_open: quotation % already holds an open discount request; supersede it first', NEW.quotation_id
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT * INTO v_prior
        FROM quo.discount_approvals
       WHERE tenant_id = NEW.tenant_id AND quotation_id = NEW.quotation_id
         AND superseded_by_revision_id = NEW.quotation_revision_id
       ORDER BY requested_at DESC, id DESC
       LIMIT 1;
      IF FOUND AND (
           NEW.policy_id IS DISTINCT FROM v_prior.policy_id
           OR NEW.policy_version_no IS DISTINCT FROM v_prior.policy_version_no
           OR NEW.threshold_kind IS DISTINCT FROM v_prior.threshold_kind
           OR NEW.threshold_value IS DISTINCT FROM v_prior.threshold_value
           OR NEW.threshold_currency_code IS DISTINCT FROM v_prior.threshold_currency_code
           OR NEW.required_permission_code IS DISTINCT FROM v_prior.required_permission_code) THEN
        RAISE EXCEPTION 'discount_approval_snapshot_changed: a request replacing % must carry its policy snapshot', v_prior.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Superseding: an open request is replaced by a newer revision of its own
  -- quotation. It records no decision and changes none it had.
  IF NEW.status = 'superseded' AND OLD.status <> 'superseded' THEN
    IF OLD.status NOT IN ('pending', 'rejected') THEN
      RAISE EXCEPTION 'quo.discount_approvals: only a pending or rejected request is superseded, and % is %', OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
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
    RAISE EXCEPTION 'quo.discount_approvals: a pending approval changes only by being approved, rejected or superseded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_discount_approval() FROM PUBLIC;

CREATE TRIGGER tg_discount_approvals_guard BEFORE INSERT OR UPDATE ON quo.discount_approvals
  FOR EACH ROW EXECUTE FUNCTION quo.guard_discount_approval();
CREATE TRIGGER tg_discount_approvals_touch_metadata BEFORE UPDATE ON quo.discount_approvals
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_discount_approvals_immutable BEFORE UPDATE ON quo.discount_approvals
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'quotation_id', 'quotation_revision_id', 'origin',
    'currency_code', 'discount_total', 'discount_base', 'elevated_line_count', 'policy_id',
    'policy_version_no', 'threshold_kind', 'threshold_value', 'threshold_currency_code',
    'required_permission_code', 'requested_by', 'requested_at', 'created_at', 'created_by');

ALTER TABLE quo.discount_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.discount_approvals FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_discount_approvals_scope ON quo.discount_approvals FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
-- The requester is the signed-in person, never a value the caller chose, and only
-- this migration writes a backfilled request.
CREATE POLICY ins_discount_approvals_scope ON quo.discount_approvals FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND requested_by = iam.current_user_id()
    AND origin = 'requested'
    AND decided_by IS NULL);
-- The decider is the signed-in person; the separation CHECK keeps them apart from
-- the requester. Superseding records no decision, which the guard holds.
CREATE POLICY upd_discount_approvals_scope ON quo.discount_approvals FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (status = 'superseded' OR decided_by = iam.current_user_id()));
GRANT SELECT, INSERT, UPDATE ON quo.discount_approvals TO app_runtime;
GRANT SELECT ON quo.discount_approvals TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. Whether a revision with NO request may be issued.
-- ----------------------------------------------------------------------------
-- The snapshot a revision without a request is held to: the request it replaced
-- (superseded_by_revision_id = the revision), else an open request elsewhere on
-- its quotation, else — for a legacy draft or a quotation that never asked — the
-- policy in force on p_as_of.
CREATE OR REPLACE FUNCTION quo.revision_discount_needs_approval(p_revision uuid, p_as_of date)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE rev quo.quotation_revisions%ROWTYPE; v_lock quo.discount_approvals%ROWTYPE;
        v_policy svc.pricing_approval_policies%ROWTYPE; v_needs boolean;
BEGIN
  SELECT * INTO rev FROM quo.quotation_revisions WHERE id = p_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quotation revision % not found', p_revision USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT * INTO v_lock
    FROM quo.discount_approvals
   WHERE tenant_id = rev.tenant_id AND quotation_id = rev.quotation_id
     AND quotation_revision_id <> rev.id
     AND (superseded_by_revision_id = rev.id OR status IN ('pending', 'rejected'))
   ORDER BY requested_at DESC, id DESC
   LIMIT 1;
  IF FOUND THEN
    SELECT a.needs_approval INTO v_needs
      FROM quo.revision_discount_assessment(rev.tenant_id, rev.id, v_lock.policy_id IS NOT NULL,
             v_lock.threshold_kind, v_lock.threshold_value, v_lock.threshold_currency_code) a;
    RETURN v_needs;
  END IF;
  SELECT * INTO v_policy FROM svc.discount_policy_in_force(rev.tenant_id, rev.company_id, p_as_of);
  SELECT a.needs_approval INTO v_needs
    FROM quo.revision_discount_assessment(rev.tenant_id, rev.id, v_policy.id IS NOT NULL,
           v_policy.threshold_kind, v_policy.threshold_value, v_policy.currency_code) a;
  RETURN v_needs;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.revision_discount_needs_approval(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.revision_discount_needs_approval(uuid, date) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 5. quo.quotation_revisions — a discount that needs approval is issued only
--    once it is approved, and only for the amount approved.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quo.guard_revision_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a quo.discount_approvals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM quo.discount_approvals
   WHERE tenant_id = NEW.tenant_id AND quotation_revision_id = NEW.id;
  IF FOUND THEN
    IF a.status <> 'approved' THEN
      RAISE EXCEPTION 'discount_approval_%: revision % carries a discount that is % and cannot be issued',
        a.status, NEW.id, a.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- The approval is of an amount: `quo.issue_revision` has just summed the lines
    -- into captured_discount_total, and it must be the discount that was approved.
    IF a.approved_currency_code IS DISTINCT FROM NEW.currency_code
       OR a.approved_discount_total IS DISTINCT FROM NEW.captured_discount_total THEN
      RAISE EXCEPTION 'discount_approval_amount_mismatch: revision % carries a discount of % %, and % % was approved',
        NEW.id, NEW.captured_discount_total, NEW.currency_code, a.approved_discount_total, a.approved_currency_code
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF quo.revision_discount_needs_approval(NEW.id, current_date) THEN
    RAISE EXCEPTION 'discount_approval_required: revision % carries a discount that needs approval and none was requested', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_revision_discount_approval() FROM PUBLIC;
CREATE TRIGGER tg_quotation_revisions_discount_approval BEFORE UPDATE OF status ON quo.quotation_revisions
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'issued')
  EXECUTE FUNCTION quo.guard_revision_discount_approval();

-- ----------------------------------------------------------------------------
-- 6. Legacy drafts: a discount that needs approval asks for it.
-- ----------------------------------------------------------------------------
-- Every DRAFT revision written before this migration whose discount needs approval
-- under the policy in force today gets a PENDING request, requested by the person
-- who created the revision and marked `backfilled`, so somebody else has to approve
-- it before it can be issued. Issued, superseded, rejected and expired revisions are
-- left exactly as they are: they are the record of what was presented.
INSERT INTO quo.discount_approvals
  (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, status, origin,
   currency_code, discount_total, discount_base, elevated_line_count, policy_id,
   policy_version_no, threshold_kind, threshold_value, threshold_currency_code,
   required_permission_code, requested_by, requested_at, created_by)
SELECT r.tenant_id, r.company_id, r.branch_id, r.quotation_id, r.id, 'pending', 'backfilled',
       r.currency_code, a.discount_total, round(a.discount_base, 4), a.elevated_lines, p.id,
       p.version_no, p.threshold_kind, p.threshold_value, p.currency_code,
       COALESCE(p.required_permission_code, 'svc.price.manage'), r.created_by, r.created_at,
       r.created_by
  FROM quo.quotation_revisions r
  LEFT JOIN LATERAL svc.discount_policy_in_force(r.tenant_id, r.company_id, current_date) p ON true
 CROSS JOIN LATERAL quo.revision_discount_assessment(r.tenant_id, r.id, p.id IS NOT NULL,
         p.threshold_kind, p.threshold_value, p.currency_code) a
 WHERE r.status = 'draft' AND r.deleted_at IS NULL AND a.needs_approval;
