-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception authorization + custody history (append-only)
-- Tasks: P1-08-DB-019 (authorization), P1-08-DB-020 (custody history)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   rec.authorizations is the append-only record of a party's decision to
--   authorize (or decline) reception/work on a visit. The authorizing partner must
--   hold an ACTIVE authorizing party role on the visit — expired/invalid authority
--   is rejected. Authorization creates NO work order (that is Phase 1-9); it only
--   records the decision. Supersession is by a later row, never a mutation.
--
--   rec.custody_history is the append-only custody ledger: accepted -> in_workshop
--   -> released. A release before acceptance is impossible, a duplicate acceptance
--   is impossible, and the full chain is reconstructable and attributable
--   (server-stamped actor/time, monotonic seq).
--
-- Both tables are append-only: SELECT + INSERT only; UPDATE/DELETE raise 42501.
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); rec.reception_party_roles;
--   crm.business_partners (tenant,id); shared.documents (tenant,id);
--   shared.stamp_status_history; iam.current_tenant_id / allowed_*_ids.
--
-- Objects created
--   Tables:    rec.authorizations, rec.custody_history
--   Functions: rec.guard_authorization_authority(), rec.guard_custody_transition()
--   Triggers:  tg_authorizations_authority, tg_custody_history_transition,
--              tg_custody_history_stamp
--   Policies:  sel/ins_authorizations_scope, sel/ins_custody_history_scope
-- ============================================================================

CREATE TABLE rec.authorizations (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  branch_id          uuid        NOT NULL,
  reception_visit_id uuid        NOT NULL,
  authorizing_role   text        NOT NULL,
  partner_id         uuid        NOT NULL,
  decision           text        NOT NULL,
  channel            text        NOT NULL DEFAULT 'in_person',
  authorized_scope   jsonb       NULL,
  evidence_document_id uuid      NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  correlation_id     uuid        NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,

  CONSTRAINT pk_authorizations PRIMARY KEY (id),
  CONSTRAINT fk_authorizations_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_authorizations_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_authorizations_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_authorizations_role CHECK (authorizing_role IN (
    'approving_party', 'service_requester', 'vehicle_owner', 'authorized_receiver')),
  CONSTRAINT ck_authorizations_decision CHECK (decision IN ('approved', 'declined')),
  CONSTRAINT ck_authorizations_channel CHECK (channel IN (
    'in_person', 'phone', 'email', 'portal', 'other')),
  CONSTRAINT ck_authorizations_scope_object
    CHECK (authorized_scope IS NULL OR jsonb_typeof(authorized_scope) = 'object')
);

COMMENT ON TABLE rec.authorizations IS
  'Phase 1-8 append-only reception authorizations (P1-08-DB-019). The authorizing partner must hold an active authorizing party role; creates NO work order; superseded by later rows. SELECT+INSERT only.';

CREATE INDEX ix_authorizations_visit
  ON rec.authorizations (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_authorizations_partner ON rec.authorizations (tenant_id, partner_id);
CREATE INDEX ix_authorizations_evidence ON rec.authorizations (tenant_id, evidence_document_id);

-- ----------------------------------------------------------------------------
-- Authority guard: the authorizing partner must currently hold an ACTIVE
-- authorizing party role on the visit (expired/invalid authority is rejected).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_authorization_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rec.reception_party_roles r
    WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
      AND r.branch_id = NEW.branch_id AND r.reception_visit_id = NEW.reception_visit_id
      AND r.partner_id = NEW.partner_id
      AND r.relationship_role IN ('approving_party', 'service_requester', 'vehicle_owner', 'authorized_receiver')
      AND r.valid_to IS NULL AND r.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'partner % holds no active authorizing role on visit %',
      NEW.partner_id, NEW.reception_visit_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_authorization_authority() IS
  'BEFORE INSERT on rec.authorizations: the authorizing partner must hold an active authorizing party role on the visit (expired/invalid authority rejected).';
REVOKE EXECUTE ON FUNCTION rec.guard_authorization_authority() FROM PUBLIC;

CREATE TRIGGER tg_authorizations_authority
  BEFORE INSERT ON rec.authorizations
  FOR EACH ROW EXECUTE FUNCTION rec.guard_authorization_authority();

ALTER TABLE rec.authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.authorizations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_authorizations_scope ON rec.authorizations
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_authorizations_scope ON rec.authorizations
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
GRANT SELECT, INSERT ON rec.authorizations TO app_runtime;
GRANT SELECT ON rec.authorizations TO app_readonly;

-- ----------------------------------------------------------------------------
-- rec.custody_history — append-only custody ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.custody_history (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  company_id          uuid        NOT NULL,
  branch_id           uuid        NOT NULL,
  reception_visit_id  uuid        NOT NULL,
  from_state          text        NULL,
  to_state            text        NOT NULL,
  receiving_partner_id uuid       NULL,
  releasing_partner_id uuid       NULL,
  reason              text        NULL,
  evidence_document_id uuid       NULL,
  correlation_id      uuid        NULL,
  actor_id            uuid        NOT NULL,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  seq                 bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_custody_history PRIMARY KEY (id),
  CONSTRAINT fk_custody_history_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_custody_history_receiving
    FOREIGN KEY (tenant_id, receiving_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_custody_history_releasing
    FOREIGN KEY (tenant_id, releasing_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_custody_history_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_custody_history_to_state CHECK (to_state IN ('accepted', 'in_workshop', 'released')),
  CONSTRAINT ck_custody_history_from_state
    CHECK (from_state IS NULL OR from_state IN ('accepted', 'in_workshop', 'released')),
  CONSTRAINT ck_custody_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_custody_history_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);

COMMENT ON TABLE rec.custody_history IS
  'Phase 1-8 append-only custody ledger (P1-08-DB-020). accepted -> in_workshop -> released; no release before accept, no duplicate accept (partial unique + transition guard). Server-stamped actor/time, monotonic seq. SELECT+INSERT only.';

-- Exactly one acceptance per visit (serializes concurrent duplicate accepts).
CREATE UNIQUE INDEX uq_custody_history_accepted
  ON rec.custody_history (reception_visit_id)
  WHERE to_state = 'accepted';
-- Non-partial FK-covering + newest-first chain read.
CREATE INDEX ix_custody_history_visit
  ON rec.custody_history (tenant_id, company_id, branch_id, reception_visit_id, seq DESC);
CREATE INDEX ix_custody_history_receiving ON rec.custody_history (tenant_id, receiving_partner_id);
CREATE INDEX ix_custody_history_releasing ON rec.custody_history (tenant_id, releasing_partner_id);
CREATE INDEX ix_custody_history_evidence ON rec.custody_history (tenant_id, evidence_document_id);

-- ----------------------------------------------------------------------------
-- Custody transition guard: the chain must be coherent with the last recorded
-- state. First event must be 'accepted' (no from_state); thereafter from_state
-- must equal the last to_state and follow accepted -> in_workshop -> released.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_custody_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_last text;
BEGIN
  SELECT to_state INTO v_last FROM rec.custody_history
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
      AND branch_id = NEW.branch_id AND reception_visit_id = NEW.reception_visit_id
    ORDER BY seq DESC LIMIT 1;
  IF v_last IS NULL THEN
    IF NEW.to_state <> 'accepted' OR NEW.from_state IS NOT NULL THEN
      RAISE EXCEPTION 'first custody event must be an acceptance (no prior state)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.from_state IS DISTINCT FROM v_last THEN
      RAISE EXCEPTION 'custody from_state % does not match the last recorded state %',
        NEW.from_state, v_last USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (
      (v_last = 'accepted' AND NEW.to_state IN ('in_workshop', 'released'))
      OR (v_last = 'in_workshop' AND NEW.to_state = 'released')
    ) THEN
      RAISE EXCEPTION 'invalid custody transition % -> %', v_last, NEW.to_state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_custody_transition() IS
  'BEFORE INSERT on rec.custody_history: enforces accepted-first, from_state=last, and accepted->in_workshop->released (no release-before-accept; duplicate accept blocked by uq_custody_history_accepted).';
REVOKE EXECUTE ON FUNCTION rec.guard_custody_transition() FROM PUBLIC;

CREATE TRIGGER tg_custody_history_transition
  BEFORE INSERT ON rec.custody_history
  FOR EACH ROW EXECUTE FUNCTION rec.guard_custody_transition();
CREATE TRIGGER tg_custody_history_stamp
  BEFORE INSERT ON rec.custody_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE rec.custody_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.custody_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_custody_history_scope ON rec.custody_history
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_custody_history_scope ON rec.custody_history
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
GRANT SELECT, INSERT ON rec.custody_history TO app_runtime;
GRANT SELECT ON rec.custody_history TO app_readonly;
