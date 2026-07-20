-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: service lines, required parts, additional-work requests, approvals
-- Tasks: P1-09-DB-040 (service lines), DB-041 (required parts),
--        DB-042 (additional-work requests), DB-043 (restricted detail),
--        DB-044 (customer approvals), DB-045 (approval evidence)
-- Owner module: wo
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only.
--
-- Purpose
--   Work-order service/labor lines and required parts (positive quantities;
--   forward references to the P1-10 service/item catalogs are OPAQUE uuids with
--   NO fake FK). Additional-work requests carry a safe summary + a 1:1 RESTRICTED
--   customer-facing description; a request may be marked approved only when an
--   approved customer approval exists (forgery resistance). Customer approvals are
--   immutable decision records binding the deciding reception party role and an
--   exact presented scope; their evidence binds an EXACT immutable document
--   version (append-only, no substitution). No quotation/item table is created.
--
-- Dependencies
--   wo.work_orders / jobs; rec.reception_party_roles; shared.document_versions
--   (tenant_id,id); shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    wo.work_order_service_lines, wo.required_parts,
--              wo.additional_work_requests, wo.additional_work_request_details,
--              wo.customer_approvals, wo.customer_approval_evidence
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. wo.work_order_service_lines — planned service/labor lines.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.work_order_service_lines (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  work_order_id  uuid    NOT NULL,
  job_id         uuid    NULL,
  description    text    NOT NULL,
  quantity       numeric(12, 3) NOT NULL DEFAULT 1,
  unit           text    NOT NULL DEFAULT 'each',
  service_ref    uuid    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_work_order_service_lines PRIMARY KEY (id),
  CONSTRAINT uq_work_order_service_lines_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_work_order_service_lines_wo
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_work_order_service_lines_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_work_order_service_lines_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_work_order_service_lines_quantity CHECK (quantity > 0),
  CONSTRAINT ck_work_order_service_lines_unit_not_blank CHECK (btrim(unit) <> '')
);
COMMENT ON TABLE wo.work_order_service_lines IS
  'Phase 1-9 work-order service/labor line (P1-09-DB-040). Positive quantity. service_ref is an opaque forward reference to the P1-10 service catalog (no FK — that table does not exist).';
CREATE INDEX ix_work_order_service_lines_wo ON wo.work_order_service_lines (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_work_order_service_lines_job ON wo.work_order_service_lines (tenant_id, company_id, branch_id, job_id);
CREATE TRIGGER tg_work_order_service_lines_touch_metadata BEFORE UPDATE ON wo.work_order_service_lines
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_work_order_service_lines_immutable BEFORE UPDATE ON wo.work_order_service_lines
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'created_at', 'created_by');
ALTER TABLE wo.work_order_service_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.work_order_service_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_work_order_service_lines_scope ON wo.work_order_service_lines FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_work_order_service_lines_scope ON wo.work_order_service_lines FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_work_order_service_lines_scope ON wo.work_order_service_lines FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.work_order_service_lines TO app_runtime;
GRANT SELECT ON wo.work_order_service_lines TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. wo.required_parts — parts a job needs (positive quantity; forward item ref).
-- ----------------------------------------------------------------------------
CREATE TABLE wo.required_parts (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  work_order_id  uuid    NOT NULL,
  job_id         uuid    NULL,
  description    text    NOT NULL,
  quantity       numeric(12, 3) NOT NULL,
  unit           text    NOT NULL DEFAULT 'each',
  item_ref       uuid    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_required_parts PRIMARY KEY (id),
  CONSTRAINT uq_required_parts_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_required_parts_wo
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_required_parts_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_required_parts_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_required_parts_quantity CHECK (quantity > 0),
  CONSTRAINT ck_required_parts_unit_not_blank CHECK (btrim(unit) <> '')
);
COMMENT ON TABLE wo.required_parts IS
  'Phase 1-9 required part for a work order/job (P1-09-DB-041). Positive quantity. item_ref is an opaque forward reference to the P1-10 item catalog (no FK).';
CREATE INDEX ix_required_parts_wo ON wo.required_parts (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_required_parts_job ON wo.required_parts (tenant_id, company_id, branch_id, job_id);
CREATE TRIGGER tg_required_parts_touch_metadata BEFORE UPDATE ON wo.required_parts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_required_parts_immutable BEFORE UPDATE ON wo.required_parts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'created_at', 'created_by');
ALTER TABLE wo.required_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.required_parts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_required_parts_scope ON wo.required_parts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_required_parts_scope ON wo.required_parts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_required_parts_scope ON wo.required_parts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.required_parts TO app_runtime;
GRANT SELECT ON wo.required_parts TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. wo.additional_work_requests — extra work discovered mid-repair.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.additional_work_requests (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  work_order_id       uuid    NOT NULL,
  originating_job_id  uuid    NULL,
  originating_finding_id uuid NULL,
  summary             text    NOT NULL,
  state               text    NOT NULL DEFAULT 'pending',
  fulfillment_state   text    NOT NULL DEFAULT 'unfulfilled',
  is_required         boolean NOT NULL DEFAULT true,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_additional_work_requests PRIMARY KEY (id),
  CONSTRAINT uq_additional_work_requests_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_additional_work_requests_wo
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_additional_work_requests_job
    FOREIGN KEY (tenant_id, company_id, branch_id, originating_job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_additional_work_requests_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT ck_additional_work_requests_state CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT ck_additional_work_requests_fulfillment CHECK (fulfillment_state IN ('unfulfilled', 'fulfilled', 'waived'))
);
COMMENT ON TABLE wo.additional_work_requests IS
  'Phase 1-9 additional-work request (P1-09-DB-042). state pending→approved|rejected|withdrawn; fulfillment_state models execution locally (no P1-10 FK). A required pending or approved-unfulfilled request blocks work-order closure (B3). originating_finding_id is an opaque soft link to a diagnostic finding.';
CREATE INDEX ix_additional_work_requests_wo ON wo.additional_work_requests (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_additional_work_requests_job ON wo.additional_work_requests (tenant_id, company_id, branch_id, originating_job_id);
CREATE INDEX ix_additional_work_requests_state
  ON wo.additional_work_requests (tenant_id, company_id, branch_id, work_order_id, state) WHERE deleted_at IS NULL;

-- Integrity: a request may be marked 'approved' only when an approved customer
-- approval exists for it (forgery resistance). Late-bound to wo.customer_approvals.
CREATE OR REPLACE FUNCTION wo.guard_additional_work_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.state = 'approved' AND OLD.state IS DISTINCT FROM 'approved' THEN
    IF NOT EXISTS (
      SELECT 1 FROM wo.customer_approvals ca
      WHERE ca.tenant_id = NEW.tenant_id AND ca.company_id = NEW.company_id
        AND ca.branch_id = NEW.branch_id AND ca.additional_work_request_id = NEW.id
        AND ca.decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'additional-work request % cannot be approved without an approved customer approval', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_additional_work_state() IS
  'BEFORE UPDATE on wo.additional_work_requests: state=approved requires an approved customer approval (forgery resistance).';
REVOKE EXECUTE ON FUNCTION wo.guard_additional_work_state() FROM PUBLIC;

CREATE TRIGGER tg_additional_work_requests_state BEFORE UPDATE OF state ON wo.additional_work_requests
  FOR EACH ROW EXECUTE FUNCTION wo.guard_additional_work_state();
CREATE TRIGGER tg_additional_work_requests_touch_metadata BEFORE UPDATE ON wo.additional_work_requests
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_additional_work_requests_immutable BEFORE UPDATE ON wo.additional_work_requests
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'is_required', 'created_at', 'created_by');
ALTER TABLE wo.additional_work_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.additional_work_requests FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_additional_work_requests_scope ON wo.additional_work_requests FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_additional_work_requests_scope ON wo.additional_work_requests FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_additional_work_requests_scope ON wo.additional_work_requests FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.additional_work_requests TO app_runtime;
GRANT SELECT ON wo.additional_work_requests TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. wo.additional_work_request_details — RESTRICTED customer-facing description.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.additional_work_request_details (
  id                        uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                 uuid    NOT NULL,
  company_id                uuid    NOT NULL,
  branch_id                 uuid    NOT NULL,
  additional_work_request_id uuid   NOT NULL,
  description               text    NOT NULL,
  classification            text    NOT NULL DEFAULT 'restricted',
  record_version            integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid    NOT NULL,
  updated_at                timestamptz NULL,
  updated_by                uuid    NULL,
  deleted_at                timestamptz NULL,
  deleted_by                uuid    NULL,

  CONSTRAINT pk_additional_work_request_details PRIMARY KEY (id),
  CONSTRAINT fk_additional_work_request_details_request
    FOREIGN KEY (tenant_id, company_id, branch_id, additional_work_request_id)
    REFERENCES wo.additional_work_requests (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_additional_work_request_details_classification CHECK (classification = 'restricted'),
  CONSTRAINT ck_additional_work_request_details_description_not_blank CHECK (btrim(description) <> '')
);
COMMENT ON TABLE wo.additional_work_request_details IS
  'Phase 1-9 RESTRICTED additional-work description (P1-09-DB-043). 1:1 with the request; whole table gated by iam.has_permission(''iam.sensitive.view'').';
CREATE UNIQUE INDEX uq_additional_work_request_details_request
  ON wo.additional_work_request_details (tenant_id, company_id, branch_id, additional_work_request_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_additional_work_request_details_request
  ON wo.additional_work_request_details (tenant_id, company_id, branch_id, additional_work_request_id);
CREATE TRIGGER tg_additional_work_request_details_immutable BEFORE UPDATE ON wo.additional_work_request_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'additional_work_request_id', 'classification', 'created_at', 'created_by');
CREATE TRIGGER tg_additional_work_request_details_touch_metadata BEFORE UPDATE ON wo.additional_work_request_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
ALTER TABLE wo.additional_work_request_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.additional_work_request_details FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_additional_work_request_details_gated ON wo.additional_work_request_details FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY ins_additional_work_request_details_gated ON wo.additional_work_request_details FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY upd_additional_work_request_details_gated ON wo.additional_work_request_details FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
GRANT SELECT, INSERT, UPDATE ON wo.additional_work_request_details TO app_runtime;
GRANT SELECT ON wo.additional_work_request_details TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. wo.customer_approvals — immutable customer decision on additional work.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.customer_approvals (
  id                         uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                  uuid    NOT NULL,
  company_id                 uuid    NOT NULL,
  branch_id                  uuid    NOT NULL,
  additional_work_request_id uuid    NOT NULL,
  deciding_party_role_id     uuid    NOT NULL,
  decision                   text    NOT NULL,
  channel                    text    NOT NULL,
  presented_scope            text    NOT NULL,
  quotation_revision_ref     uuid    NULL,
  decided_at                 timestamptz NOT NULL DEFAULT now(),
  record_version             integer NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid    NOT NULL,
  updated_at                 timestamptz NULL,
  updated_by                 uuid    NULL,
  deleted_at                 timestamptz NULL,
  deleted_by                 uuid    NULL,

  CONSTRAINT pk_customer_approvals PRIMARY KEY (id),
  CONSTRAINT uq_customer_approvals_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_customer_approvals_request
    FOREIGN KEY (tenant_id, company_id, branch_id, additional_work_request_id)
    REFERENCES wo.additional_work_requests (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_approvals_party_role
    FOREIGN KEY (deciding_party_role_id) REFERENCES rec.reception_party_roles (id) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_approvals_decision CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT ck_customer_approvals_channel CHECK (channel IN ('in_person', 'phone', 'email', 'sms', 'portal', 'other')),
  CONSTRAINT ck_customer_approvals_presented_scope_not_blank CHECK (btrim(presented_scope) <> '')
);
COMMENT ON TABLE wo.customer_approvals IS
  'Phase 1-9 immutable customer decision on additional work (P1-09-DB-044). Binds the deciding reception party role (scope coherence-guarded), channel, exact presented scope, and an optional forward quotation-revision reference (no FK; P1-10). Decision content is immutable.';
CREATE UNIQUE INDEX uq_customer_approvals_active
  ON wo.customer_approvals (tenant_id, company_id, branch_id, additional_work_request_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_customer_approvals_request ON wo.customer_approvals (tenant_id, company_id, branch_id, additional_work_request_id);
CREATE INDEX ix_customer_approvals_party_role ON wo.customer_approvals (deciding_party_role_id);

-- Coherence: the deciding party role must belong to the same reception visit as
-- the work order of the request (same scope). BEFORE INSERT/UPDATE.
CREATE OR REPLACE FUNCTION wo.guard_customer_approval_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wo_visit uuid;
  v_role_visit uuid;
  v_role_tenant uuid;
BEGIN
  SELECT w.reception_visit_id INTO v_wo_visit
  FROM wo.additional_work_requests r
  JOIN wo.work_orders w
    ON w.tenant_id = r.tenant_id AND w.company_id = r.company_id
   AND w.branch_id = r.branch_id AND w.id = r.work_order_id
  WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
    AND r.branch_id = NEW.branch_id AND r.id = NEW.additional_work_request_id;
  IF v_wo_visit IS NULL THEN
    RAISE EXCEPTION 'additional-work request % not resolvable in scope', NEW.additional_work_request_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT reception_visit_id, tenant_id INTO v_role_visit, v_role_tenant
  FROM rec.reception_party_roles WHERE id = NEW.deciding_party_role_id;
  IF v_role_visit IS NULL THEN
    RAISE EXCEPTION 'deciding party role % is not visible', NEW.deciding_party_role_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_role_tenant IS DISTINCT FROM NEW.tenant_id OR v_role_visit IS DISTINCT FROM v_wo_visit THEN
    RAISE EXCEPTION 'deciding party role % does not belong to the work order reception visit', NEW.deciding_party_role_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_customer_approval_coherence() IS
  'BEFORE INSERT/UPDATE on wo.customer_approvals: the deciding party role must belong to the same tenant and reception visit as the request''s work order.';
REVOKE EXECUTE ON FUNCTION wo.guard_customer_approval_coherence() FROM PUBLIC;

CREATE TRIGGER tg_customer_approvals_coherence BEFORE INSERT OR UPDATE ON wo.customer_approvals
  FOR EACH ROW EXECUTE FUNCTION wo.guard_customer_approval_coherence();
CREATE TRIGGER tg_customer_approvals_immutable BEFORE UPDATE ON wo.customer_approvals
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'additional_work_request_id', 'deciding_party_role_id',
    'decision', 'channel', 'presented_scope', 'quotation_revision_ref', 'decided_at', 'created_at', 'created_by');
CREATE TRIGGER tg_customer_approvals_touch_metadata BEFORE UPDATE ON wo.customer_approvals
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
ALTER TABLE wo.customer_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.customer_approvals FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_customer_approvals_scope ON wo.customer_approvals FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_customer_approvals_scope ON wo.customer_approvals FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_customer_approvals_scope ON wo.customer_approvals FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.customer_approvals TO app_runtime;
GRANT SELECT ON wo.customer_approvals TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. wo.customer_approval_evidence — append-only; binds an exact document version.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.customer_approval_evidence (
  id                   uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid    NOT NULL,
  company_id           uuid    NOT NULL,
  branch_id            uuid    NOT NULL,
  customer_approval_id uuid    NOT NULL,
  document_version_id  uuid    NOT NULL,
  evidence_type        text    NOT NULL,
  note                 text    NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid    NOT NULL,

  CONSTRAINT pk_customer_approval_evidence PRIMARY KEY (id),
  CONSTRAINT fk_customer_approval_evidence_approval
    FOREIGN KEY (tenant_id, company_id, branch_id, customer_approval_id)
    REFERENCES wo.customer_approvals (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_approval_evidence_version
    FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_approval_evidence_type_not_blank CHECK (btrim(evidence_type) <> ''),
  CONSTRAINT ck_customer_approval_evidence_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);
COMMENT ON TABLE wo.customer_approval_evidence IS
  'Phase 1-9 append-only customer-approval evidence (P1-09-DB-045). Binds an EXACT immutable shared.document_versions row; no substitution. SELECT+INSERT only.';
CREATE INDEX ix_customer_approval_evidence_approval ON wo.customer_approval_evidence (tenant_id, company_id, branch_id, customer_approval_id);
CREATE INDEX ix_customer_approval_evidence_version ON wo.customer_approval_evidence (tenant_id, document_version_id);
ALTER TABLE wo.customer_approval_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.customer_approval_evidence FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_customer_approval_evidence_scope ON wo.customer_approval_evidence FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_customer_approval_evidence_scope ON wo.customer_approval_evidence FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON wo.customer_approval_evidence TO app_runtime;
GRANT SELECT ON wo.customer_approval_evidence TO app_readonly;
