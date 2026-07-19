-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception party roles + visit-reason links
-- Tasks: P1-08-DB-007 (party roles), P1-08-DB-008 (visit reasons)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   rec.reception_party_roles binds business partners to a reception visit in a
--   typed, dated role (who requested service, who owns/uses the Vehicle, who pays,
--   who is authorized to receive it back). The taxonomy is distinct and preserved;
--   a role is "removed" by dating it out (valid_to), never by mutation, so history
--   is intact. At least one service_requester is required before the visit may be
--   ACTIVATED (advanced to authorized) — enforced as a deferred activation contract
--   in Wave 5 (the atomic check-in primitive / authorized-transition guard), so
--   there is no impossible initial-insert rule.
--
--   rec.visit_reason_links attaches governed visit reasons to a visit. An archived
--   (inactive) reason cannot be newly linked, but existing links are preserved. The
--   human label lives in rec.visit_reasons (localized-label contract) — not copied.
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); crm.business_partners
--   (tenant,id); rec.visit_reasons (id); iam.current_tenant_id / allowed_*_ids;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant + company + branch scoped; identity immutable;
--     visit-reason links fail-closed to visible + active reasons.
--
-- Objects created
--   Tables:    rec.reception_party_roles, rec.visit_reason_links
--   Functions: rec.guard_visit_reason_link()
--   Triggers:  tg_reception_party_roles_immutable, tg_reception_party_roles_touch_metadata,
--              tg_visit_reason_links_reason, tg_visit_reason_links_immutable,
--              tg_visit_reason_links_touch_metadata
--   Policies:  sel/ins/upd_reception_party_roles_scope, sel/ins/upd_visit_reason_links_scope
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rec.reception_party_roles
-- ----------------------------------------------------------------------------
CREATE TABLE rec.reception_party_roles (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  branch_id          uuid        NOT NULL,
  reception_visit_id uuid        NOT NULL,
  partner_id         uuid        NOT NULL,
  relationship_role  text        NOT NULL,
  valid_from         timestamptz NOT NULL DEFAULT now(),
  valid_to           timestamptz NULL,
  assignment_source  text        NULL,
  record_version     integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid        NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid        NULL,

  CONSTRAINT pk_reception_party_roles PRIMARY KEY (id),
  CONSTRAINT fk_reception_party_roles_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_party_roles_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_reception_party_roles_role CHECK (relationship_role IN (
    'service_requester', 'vehicle_owner', 'vehicle_user', 'payer',
    'billing_party', 'approving_party', 'authorized_receiver')),
  CONSTRAINT ck_reception_party_roles_window CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT ck_reception_party_roles_source_not_blank
    CHECK (assignment_source IS NULL OR btrim(assignment_source) <> '')
);

COMMENT ON TABLE rec.reception_party_roles IS
  'Phase 1-8 dated typed party roles on a reception visit (P1-08-DB-007). Distinct taxonomy (service_requester/vehicle_owner/vehicle_user/payer/billing_party/approving_party/authorized_receiver); dated (valid_to) not mutated, so history is preserved. >=1 service_requester required before activation (deferred contract, Wave 5).';

-- One active identical role per visit+partner; historical (dated-out) rows persist.
CREATE UNIQUE INDEX uq_reception_party_roles_active
  ON rec.reception_party_roles (reception_visit_id, partner_id, relationship_role)
  WHERE valid_to IS NULL AND deleted_at IS NULL;
-- Non-partial FK-covering indexes (P1-03-DB-017).
CREATE INDEX ix_reception_party_roles_visit
  ON rec.reception_party_roles (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_reception_party_roles_partner
  ON rec.reception_party_roles (tenant_id, partner_id);

CREATE TRIGGER tg_reception_party_roles_immutable
  BEFORE UPDATE ON rec.reception_party_roles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'partner_id',
    'relationship_role', 'valid_from', 'created_at', 'created_by');
CREATE TRIGGER tg_reception_party_roles_touch_metadata
  BEFORE UPDATE ON rec.reception_party_roles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.reception_party_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.reception_party_roles FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_reception_party_roles_scope ON rec.reception_party_roles
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_reception_party_roles_scope ON rec.reception_party_roles
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_reception_party_roles_scope ON rec.reception_party_roles
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.reception_party_roles TO app_runtime;
GRANT SELECT ON rec.reception_party_roles TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. rec.visit_reason_links
-- ----------------------------------------------------------------------------
CREATE TABLE rec.visit_reason_links (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  branch_id          uuid        NOT NULL,
  reception_visit_id uuid        NOT NULL,
  visit_reason_id    uuid        NOT NULL,
  note               text        NULL,
  record_version     integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid        NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid        NULL,

  CONSTRAINT pk_visit_reason_links PRIMARY KEY (id),
  CONSTRAINT fk_visit_reason_links_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_visit_reason_links_reason
    FOREIGN KEY (visit_reason_id) REFERENCES rec.visit_reasons (id) ON DELETE RESTRICT,
  CONSTRAINT ck_visit_reason_links_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

COMMENT ON TABLE rec.visit_reason_links IS
  'Phase 1-8 governed visit-reason attachments on a reception visit (P1-08-DB-008). An archived (inactive) reason cannot be newly linked; existing links are preserved. Label lives in rec.visit_reasons (not copied).';

-- One active link per visit+reason; soft-deleted links may be re-added.
CREATE UNIQUE INDEX uq_visit_reason_links_active
  ON rec.visit_reason_links (reception_visit_id, visit_reason_id)
  WHERE deleted_at IS NULL;
-- Non-partial FK-covering indexes (P1-03-DB-017).
CREATE INDEX ix_visit_reason_links_visit
  ON rec.visit_reason_links (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_visit_reason_links_reason ON rec.visit_reason_links (visit_reason_id);

-- ----------------------------------------------------------------------------
-- Reason guard: the linked reason must be platform-or-same-tenant VISIBLE and
-- ACTIVE (archived reasons cannot be newly linked). SECURITY INVOKER so RLS hides
-- another tenant's private reason.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_visit_reason_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM rec.visit_reasons WHERE id = NEW.visit_reason_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'visit_reason % is not visible to this tenant', NEW.visit_reason_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'visit_reason % is not active and cannot be newly linked', NEW.visit_reason_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_visit_reason_link() IS
  'BEFORE INSERT/UPDATE guard on rec.visit_reason_links: the reason must be platform-or-same-tenant visible AND active (archived reasons cannot be newly linked).';
REVOKE EXECUTE ON FUNCTION rec.guard_visit_reason_link() FROM PUBLIC;

CREATE TRIGGER tg_visit_reason_links_reason
  BEFORE INSERT OR UPDATE OF visit_reason_id ON rec.visit_reason_links
  FOR EACH ROW EXECUTE FUNCTION rec.guard_visit_reason_link();
CREATE TRIGGER tg_visit_reason_links_immutable
  BEFORE UPDATE ON rec.visit_reason_links
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'visit_reason_id',
    'created_at', 'created_by');
CREATE TRIGGER tg_visit_reason_links_touch_metadata
  BEFORE UPDATE ON rec.visit_reason_links
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.visit_reason_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.visit_reason_links FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_visit_reason_links_scope ON rec.visit_reason_links
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_visit_reason_links_scope ON rec.visit_reason_links
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_visit_reason_links_scope ON rec.visit_reason_links
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.visit_reason_links TO app_runtime;
GRANT SELECT ON rec.visit_reason_links TO app_readonly;
