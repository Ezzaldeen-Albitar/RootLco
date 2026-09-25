-- ============================================================================
-- Phase: 1-32 (preparatory) — discount approval: a recorded request, a separate
--        approval by another person, and a versioned company threshold
-- Migration: quo.discount_approvals; svc.pricing_approval_policies.version_no
-- Tasks: P1-32-PRE-OD-DISC-01
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
--       holds one row per quotation revision whose discount needs approval under the
--       company's policy at the moment it was asked for. `requested_by` is the
--       signed-in person who created the revision — `ins_discount_approvals_scope`
--       refuses any other value — so the requester is a server fact, never a claim.
--
--     * APPROVAL IS A SEPARATE ACT BY ANOTHER PERSON. The row is born `pending`
--       (`quo.guard_discount_approval`); it becomes `approved` or `rejected` only by
--       an UPDATE whose `decided_by` is the signed-in person
--       (`upd_discount_approvals_scope`), and `ck_discount_approvals_separation`
--       refuses a decider who is the requester. There is no exception for a sole
--       administrator and no column that switches the rule off.
--
--     * A PENDING OR REJECTED DISCOUNT CANNOT BE ISSUED. `quo.guard_revision_discount_approval`
--       refuses the draft -> issued transition of a revision whose approval is not
--       `approved`, whichever path performs it.
--
--     * THE POLICY IN FORCE AT THE REQUEST IS SNAPSHOTTED. The row copies the policy
--       version it was measured against — id, version number, kind, value, currency
--       and the permission an approver must hold — so a later change to the company
--       threshold cannot make a pending request stop needing approval, and cannot
--       make an approved one need it again. The copies are immutable
--       (`tg_discount_approvals_immutable`). `policy_id` is a reference, not a foreign
--       key: the snapshot columns are the evidence, and a policy row's own lifecycle
--       must not be able to rewrite or strand the record of a decision made under it.
--
--     * AN APPROVAL RECORDS THE LIMIT IT WAS WITHIN. `approver_limit_amount` and its
--       currency are the approver's limit at the moment of approval, and
--       `ck_discount_approvals_within_limit` refuses an approval whose limit is in
--       another currency or below the discount.
--
--     * A THRESHOLD CHANGE IS A NEW VERSION. `svc.pricing_approval_policies` gains
--       `version_no`, unique per (tenant, company, policy type). The versioned columns
--       are immutable (`tg_pricing_approval_policies_version_immutable`) and a
--       superseded version cannot be made active again
--       (`svc.guard_pricing_approval_policy_status`), so the only way to change a
--       threshold is to record the next version — which applies to requests made from
--       then on, and is audited by the operation that writes it.
--
--   `maker_approver_distinct` is left in place and is NOT read by anything: it is a
--   legacy column, and no configuration may switch the separation off.
--
-- Dependencies
--   quo.quotations, quo.quotation_revisions (20260723096000);
--   svc.pricing_approval_policies (20260723092000); iam.permissions;
--   shared.currencies; iam.current_tenant_id, iam.current_user_id,
--   iam.allowed_company_ids, iam.allowed_branch_ids (0002_base_schemas);
--   shared.touch_row_metadata; org.guard_immutable_columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. svc.pricing_approval_policies — numbered, immutable versions.
-- ----------------------------------------------------------------------------
ALTER TABLE svc.pricing_approval_policies ADD COLUMN version_no integer NOT NULL DEFAULT 1;

-- Rows written before versions existed: number each scope's rows in the order they
-- were created, so the unique signature below holds for a database that already
-- carries history. Only a scope's second and later rows are touched.
UPDATE svc.pricing_approval_policies p
   SET version_no = numbered.rn
  FROM (
    SELECT id, row_number() OVER (
             PARTITION BY tenant_id, company_id, policy_type ORDER BY created_at, id) AS rn
      FROM svc.pricing_approval_policies
  ) AS numbered
 WHERE numbered.id = p.id AND numbered.rn > 1;

ALTER TABLE svc.pricing_approval_policies
  ADD CONSTRAINT ck_pricing_approval_policies_version_no CHECK (version_no > 0);
CREATE UNIQUE INDEX uq_pricing_approval_policies_version
  ON svc.pricing_approval_policies (tenant_id, company_id, policy_type, version_no) NULLS NOT DISTINCT;
COMMENT ON COLUMN svc.pricing_approval_policies.version_no IS
  'The version of this (company, policy type) policy, from 1. A threshold change records the next version and marks the previous one inactive; the versioned columns are immutable.';

-- A version's content never changes after it is written.
CREATE TRIGGER tg_pricing_approval_policies_version_immutable BEFORE UPDATE ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'company_id', 'policy_type', 'threshold_kind', 'threshold_value', 'currency_code',
    'required_permission_code', 'version_no', 'effective_from');

-- A superseded version stays superseded: bringing one back would change the
-- threshold without recording a version.
CREATE OR REPLACE FUNCTION svc.guard_pricing_approval_policy_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'inactive' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'svc.pricing_approval_policies: a superseded policy version cannot be made active again; record the next version instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_pricing_approval_policy_status() FROM PUBLIC;
CREATE TRIGGER tg_pricing_approval_policies_status BEFORE UPDATE ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION svc.guard_pricing_approval_policy_status();

-- ----------------------------------------------------------------------------
-- 2. quo.discount_approvals — one recorded request per revision that needs it.
-- ----------------------------------------------------------------------------
CREATE TABLE quo.discount_approvals (
  id                           uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                    uuid    NOT NULL,
  company_id                   uuid    NOT NULL,
  branch_id                    uuid    NOT NULL,
  quotation_id                 uuid    NOT NULL,
  quotation_revision_id        uuid    NOT NULL,
  status                       text    NOT NULL DEFAULT 'pending',
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
  CONSTRAINT fk_discount_approvals_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_threshold_currency FOREIGN KEY (threshold_currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_limit_currency FOREIGN KEY (approver_limit_currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_approvals_permission FOREIGN KEY (required_permission_code) REFERENCES iam.permissions (permission_code) ON DELETE RESTRICT,
  CONSTRAINT ck_discount_approvals_status CHECK (status IN ('pending', 'approved', 'rejected')),
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
  CONSTRAINT ck_discount_approvals_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT ck_discount_approvals_separation CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT ck_discount_approvals_rejection_reason CHECK (
    (status <> 'rejected' OR decision_reason IS NOT NULL)
    AND (decision_reason IS NULL OR btrim(decision_reason) <> '')),
  CONSTRAINT ck_discount_approvals_limit_pair CHECK (
    (approver_limit_amount IS NULL) = (approver_limit_currency_code IS NULL)),
  CONSTRAINT ck_discount_approvals_limit_state CHECK ((status = 'approved') = (approver_limit_amount IS NOT NULL)),
  CONSTRAINT ck_discount_approvals_within_limit CHECK (
    status <> 'approved'
    OR (approver_limit_currency_code = currency_code AND approver_limit_amount >= discount_total))
);
COMMENT ON TABLE quo.discount_approvals IS 'A quotation revision whose discount needs approval under the company policy in force when it was asked for: who asked (requested_by, always the signed-in person), the discount and its base, a snapshot of the policy version it was measured against, and the decision by a DIFFERENT person with the limit that decision was within. A revision whose approval is not approved cannot be issued (quo.guard_revision_discount_approval).';
COMMENT ON COLUMN quo.discount_approvals.policy_id IS 'The svc.pricing_approval_policies version the request was measured against, or NULL when the company had no policy (the threshold was then zero). A reference, not a foreign key: the snapshot columns beside it are the evidence.';
COMMENT ON COLUMN quo.discount_approvals.required_permission_code IS 'The permission an approver had to hold, copied from the policy version (svc.price.manage when none was configured).';
COMMENT ON COLUMN quo.discount_approvals.approver_limit_amount IS 'The approver''s discount approval limit at the moment of approval, in approver_limit_currency_code. Never a limit the approver set for themselves.';

CREATE INDEX ix_discount_approvals_branch_status ON quo.discount_approvals (tenant_id, company_id, branch_id, status, requested_at DESC);
CREATE INDEX ix_discount_approvals_quotation ON quo.discount_approvals (tenant_id, company_id, branch_id, quotation_id);
CREATE INDEX ix_discount_approvals_revision ON quo.discount_approvals (tenant_id, company_id, branch_id, quotation_revision_id);
CREATE INDEX ix_discount_approvals_currency ON quo.discount_approvals (currency_code);
CREATE INDEX ix_discount_approvals_threshold_currency ON quo.discount_approvals (threshold_currency_code);
CREATE INDEX ix_discount_approvals_limit_currency ON quo.discount_approvals (approver_limit_currency_code);
CREATE INDEX ix_discount_approvals_permission ON quo.discount_approvals (required_permission_code);

CREATE OR REPLACE FUNCTION quo.guard_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_revision_status text; v_revision_quotation uuid;
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
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'discount_approval_already_decided: discount approval % is % and is not awaiting a decision', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'quo.discount_approvals: a pending approval changes only by being approved or rejected'
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
    'tenant_id', 'company_id', 'branch_id', 'quotation_id', 'quotation_revision_id',
    'currency_code', 'discount_total', 'discount_base', 'elevated_line_count', 'policy_id',
    'policy_version_no', 'threshold_kind', 'threshold_value', 'threshold_currency_code',
    'required_permission_code', 'requested_by', 'requested_at', 'created_at', 'created_by');

ALTER TABLE quo.discount_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.discount_approvals FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_discount_approvals_scope ON quo.discount_approvals FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
-- The requester is the signed-in person, never a value the caller chose.
CREATE POLICY ins_discount_approvals_scope ON quo.discount_approvals FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND requested_by = iam.current_user_id()
    AND decided_by IS NULL);
-- The decider is the signed-in person; the separation CHECK keeps them apart from
-- the requester.
CREATE POLICY upd_discount_approvals_scope ON quo.discount_approvals FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND decided_by = iam.current_user_id());
GRANT SELECT, INSERT, UPDATE ON quo.discount_approvals TO app_runtime;
GRANT SELECT ON quo.discount_approvals TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. quo.quotation_revisions — a discount that is not approved is not issued.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quo.guard_revision_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM quo.discount_approvals
   WHERE tenant_id = NEW.tenant_id AND quotation_revision_id = NEW.id;
  IF FOUND AND v_status <> 'approved' THEN
    RAISE EXCEPTION 'discount_approval_%: revision % carries a discount that is % and cannot be issued',
      CASE WHEN v_status = 'rejected' THEN 'rejected' ELSE 'pending' END, NEW.id, v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_revision_discount_approval() FROM PUBLIC;
CREATE TRIGGER tg_quotation_revisions_discount_approval BEFORE UPDATE OF status ON quo.quotation_revisions
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'issued')
  EXECUTE FUNCTION quo.guard_revision_discount_approval();
