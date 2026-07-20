-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception vehicle contents (metadata) + restricted content payload
-- Tasks: P1-08-DB-016 (vehicle contents)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   Personal effects / items left in a Vehicle at custody acceptance, split so the
--   descriptive detail is protected:
--     * rec.vehicle_contents         — SAFE metadata (quantity, location, who
--                                      declared/witnessed, evidence, correction).
--     * rec.vehicle_content_details  — the RESTRICTED item_description and optional
--                                      declared_value (P1-OD-018), 1:1, row-gated by
--                                      iam.sensitive.view. What was left in the car,
--                                      and its stated worth, is not exposed by a
--                                      plain SELECT.
--   Corrections are LINKED (correction_of), never silent mutations. declared_value
--   is nullable per the unresolved P1-OD-018 evidence-rules decision (structural
--   superset; no mandatory capture invented here).
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); crm.business_partners (tenant,id);
--   shared.documents (tenant,id); iam.current_tenant_id / allowed_*_ids / has_permission;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    rec.vehicle_contents, rec.vehicle_content_details
--   Triggers:  tg_vehicle_contents_immutable, tg_vehicle_contents_touch_metadata,
--              tg_vehicle_content_details_immutable, tg_vehicle_content_details_touch_metadata
--   Policies:  sel/ins/upd_vehicle_contents_scope, sel/ins/upd_vehicle_content_details_gated
-- ============================================================================

CREATE TABLE rec.vehicle_contents (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  company_id             uuid        NOT NULL,
  branch_id              uuid        NOT NULL,
  reception_visit_id     uuid        NOT NULL,
  quantity               integer     NOT NULL DEFAULT 1,
  location               text        NULL,
  declared_by_partner_id uuid        NULL,
  witnessed_by_employee_id uuid      NULL,
  evidence_document_id   uuid        NULL,
  correction_of          uuid        NULL,
  record_version         integer     NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid        NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid        NULL,
  deleted_at             timestamptz NULL,
  deleted_by             uuid        NULL,

  CONSTRAINT pk_vehicle_contents PRIMARY KEY (id),
  CONSTRAINT uq_vehicle_contents_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_vehicle_contents_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_contents_declared_by
    FOREIGN KEY (tenant_id, declared_by_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_contents_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_contents_correction_of
    FOREIGN KEY (tenant_id, company_id, branch_id, correction_of)
    REFERENCES rec.vehicle_contents (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_contents_quantity CHECK (quantity > 0),
  CONSTRAINT ck_vehicle_contents_location_not_blank CHECK (location IS NULL OR btrim(location) <> ''),
  CONSTRAINT ck_vehicle_contents_not_self_correction CHECK (correction_of IS NULL OR correction_of <> id)
);

COMMENT ON TABLE rec.vehicle_contents IS
  'Phase 1-8 reception vehicle-contents metadata (P1-08-DB-016). SAFE fields only; the restricted item_description + declared_value are in rec.vehicle_content_details. Corrections linked (correction_of), never silent mutation.';

CREATE INDEX ix_vehicle_contents_visit
  ON rec.vehicle_contents (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_vehicle_contents_declared_by
  ON rec.vehicle_contents (tenant_id, declared_by_partner_id);
CREATE INDEX ix_vehicle_contents_evidence ON rec.vehicle_contents (tenant_id, evidence_document_id);
CREATE INDEX ix_vehicle_contents_correction_of
  ON rec.vehicle_contents (tenant_id, company_id, branch_id, correction_of);

CREATE TRIGGER tg_vehicle_contents_immutable
  BEFORE UPDATE ON rec.vehicle_contents
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'created_at', 'created_by');
CREATE TRIGGER tg_vehicle_contents_touch_metadata
  BEFORE UPDATE ON rec.vehicle_contents
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.vehicle_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.vehicle_contents FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_contents_scope ON rec.vehicle_contents
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_vehicle_contents_scope ON rec.vehicle_contents
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_vehicle_contents_scope ON rec.vehicle_contents
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.vehicle_contents TO app_runtime;
GRANT SELECT ON rec.vehicle_contents TO app_readonly;

-- ----------------------------------------------------------------------------
-- rec.vehicle_content_details — restricted 1:1 description + declared value.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.vehicle_content_details (
  id               uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid          NOT NULL,
  company_id       uuid          NOT NULL,
  branch_id        uuid          NOT NULL,
  content_id       uuid          NOT NULL,
  item_description text          NOT NULL,
  declared_value   numeric(14, 2) NULL,
  declared_currency text         NULL,
  classification   text          NOT NULL DEFAULT 'restricted',
  record_version   integer       NOT NULL DEFAULT 1,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  created_by       uuid          NOT NULL,
  updated_at       timestamptz   NULL,
  updated_by       uuid          NULL,
  deleted_at       timestamptz   NULL,
  deleted_by       uuid          NULL,

  CONSTRAINT pk_vehicle_content_details PRIMARY KEY (id),
  CONSTRAINT fk_vehicle_content_details_content
    FOREIGN KEY (tenant_id, company_id, branch_id, content_id)
    REFERENCES rec.vehicle_contents (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_content_details_classification CHECK (classification = 'restricted'),
  CONSTRAINT ck_vehicle_content_details_desc_not_blank CHECK (btrim(item_description) <> ''),
  CONSTRAINT ck_vehicle_content_details_value_nonneg
    CHECK (declared_value IS NULL OR declared_value >= 0),
  -- Currency present only with a value; a plain 3-letter code when present.
  CONSTRAINT ck_vehicle_content_details_currency CHECK (
    (declared_currency IS NULL)
    OR (declared_value IS NOT NULL AND declared_currency ~ '^[A-Z]{3}$')
  )
);

COMMENT ON TABLE rec.vehicle_content_details IS
  'Phase 1-8 RESTRICTED vehicle-content detail (P1-08-DB-016 / P1-OD-018). 1:1 with rec.vehicle_contents; row-gated by iam.has_permission(''iam.sensitive.view''). declared_value is nullable (P1-OD-018 unresolved; no mandatory capture invented).';

-- One live detail per content row (partial) + a non-partial FK-covering index.
CREATE UNIQUE INDEX uq_vehicle_content_details_content
  ON rec.vehicle_content_details (tenant_id, company_id, branch_id, content_id)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_vehicle_content_details_content
  ON rec.vehicle_content_details (tenant_id, company_id, branch_id, content_id);

CREATE TRIGGER tg_vehicle_content_details_immutable
  BEFORE UPDATE ON rec.vehicle_content_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'content_id', 'classification',
    'created_at', 'created_by');
CREATE TRIGGER tg_vehicle_content_details_touch_metadata
  BEFORE UPDATE ON rec.vehicle_content_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.vehicle_content_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.vehicle_content_details FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_content_details_gated ON rec.vehicle_content_details
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view')
  );
CREATE POLICY ins_vehicle_content_details_gated ON rec.vehicle_content_details
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view')
  );
CREATE POLICY upd_vehicle_content_details_gated ON rec.vehicle_content_details
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view')
  )
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
GRANT SELECT, INSERT, UPDATE ON rec.vehicle_content_details TO app_runtime;
GRANT SELECT ON rec.vehicle_content_details TO app_readonly;
