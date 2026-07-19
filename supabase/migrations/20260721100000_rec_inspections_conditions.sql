-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception visual inspections + condition items
-- Tasks: P1-08-DB-010 (visual inspection), P1-08-DB-011 (condition items)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   rec.visual_inspections is the header for a walk-around inspection of a received
--   Vehicle: inspector, start/completion times, status. Once FINALIZED (completed
--   or cancelled) the header is locked; further findings are recorded only as
--   linked corrections. rec.condition_items are the individual findings (category,
--   Vehicle zone, severity, an internal note, and optional document evidence). A
--   new finding may only be added while the inspection is open; a correction (a row
--   that links correction_of a prior finding) is the approved post-finalization path.
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); shared.documents (tenant,id);
--   iam.current_tenant_id / allowed_*_ids; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Security implications
--   * ENABLE + FORCE RLS; branch-scoped. Findings notes are operational
--     Vehicle-condition text (classified internal, search-excluded) — not personal
--     data, so no restricted-payload separation is required here.
--
-- Objects created
--   Tables:    rec.visual_inspections, rec.condition_items
--   Functions: rec.guard_inspection_lifecycle(), rec.guard_condition_item_open()
--   Triggers:  tg_visual_inspections_lifecycle, tg_visual_inspections_immutable,
--              tg_visual_inspections_touch_metadata, tg_condition_items_open,
--              tg_condition_items_immutable, tg_condition_items_touch_metadata
--   Policies:  sel/ins/upd_visual_inspections_scope, sel/ins/upd_condition_items_scope
-- ============================================================================

CREATE TABLE rec.visual_inspections (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  branch_id          uuid        NOT NULL,
  reception_visit_id uuid        NOT NULL,
  inspector_id       uuid        NOT NULL,
  inspection_status  text        NOT NULL DEFAULT 'in_progress',
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz NULL,
  record_version     integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid        NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid        NULL,

  CONSTRAINT pk_visual_inspections PRIMARY KEY (id),
  CONSTRAINT uq_visual_inspections_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_visual_inspections_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_visual_inspections_status
    CHECK (inspection_status IN ('in_progress', 'completed', 'cancelled')),
  CONSTRAINT ck_visual_inspections_completed_at
    CHECK ((inspection_status = 'completed') = (completed_at IS NOT NULL))
);

COMMENT ON TABLE rec.visual_inspections IS
  'Phase 1-8 reception visual-inspection header (P1-08-DB-010). in_progress -> completed|cancelled; finalized headers are locked (further findings only as linked corrections on rec.condition_items).';

CREATE INDEX ix_visual_inspections_visit
  ON rec.visual_inspections (tenant_id, company_id, branch_id, reception_visit_id);

-- ----------------------------------------------------------------------------
-- Inspection lifecycle guard: valid transitions + finalized lock. A finalized
-- (completed/cancelled) inspection cannot be modified further.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_inspection_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.inspection_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'inspection % is finalized and cannot be modified', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.inspection_status <> OLD.inspection_status
     AND NOT (OLD.inspection_status = 'in_progress'
              AND NEW.inspection_status IN ('completed', 'cancelled')) THEN
    RAISE EXCEPTION 'invalid inspection transition % -> %',
      OLD.inspection_status, NEW.inspection_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_inspection_lifecycle() IS
  'BEFORE UPDATE on rec.visual_inspections: locks finalized inspections and enforces in_progress -> completed|cancelled.';
REVOKE EXECUTE ON FUNCTION rec.guard_inspection_lifecycle() FROM PUBLIC;

CREATE TRIGGER tg_visual_inspections_lifecycle
  BEFORE UPDATE ON rec.visual_inspections
  FOR EACH ROW EXECUTE FUNCTION rec.guard_inspection_lifecycle();
CREATE TRIGGER tg_visual_inspections_immutable
  BEFORE UPDATE ON rec.visual_inspections
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'inspector_id',
    'started_at', 'created_at', 'created_by');
CREATE TRIGGER tg_visual_inspections_touch_metadata
  BEFORE UPDATE ON rec.visual_inspections
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.visual_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.visual_inspections FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_visual_inspections_scope ON rec.visual_inspections
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_visual_inspections_scope ON rec.visual_inspections
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_visual_inspections_scope ON rec.visual_inspections
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.visual_inspections TO app_runtime;
GRANT SELECT ON rec.visual_inspections TO app_readonly;

-- ----------------------------------------------------------------------------
-- rec.condition_items — individual findings under an inspection.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.condition_items (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  inspection_id  uuid        NOT NULL,
  finding_category text      NOT NULL,
  vehicle_zone   text        NOT NULL,
  severity       text        NOT NULL DEFAULT 'minor',
  finding_note   text        NULL,
  evidence_document_id uuid  NULL,
  correction_of  uuid        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_condition_items PRIMARY KEY (id),
  CONSTRAINT uq_condition_items_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_condition_items_inspection
    FOREIGN KEY (tenant_id, company_id, branch_id, inspection_id)
    REFERENCES rec.visual_inspections (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_condition_items_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_condition_items_correction_of
    FOREIGN KEY (tenant_id, company_id, branch_id, correction_of)
    REFERENCES rec.condition_items (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_condition_items_category CHECK (finding_category IN (
    'scratch', 'dent', 'crack', 'wear', 'missing_part', 'malfunction', 'other')),
  CONSTRAINT ck_condition_items_severity CHECK (severity IN ('minor', 'moderate', 'major', 'critical')),
  CONSTRAINT ck_condition_items_zone_not_blank CHECK (btrim(vehicle_zone) <> ''),
  CONSTRAINT ck_condition_items_note_not_blank CHECK (finding_note IS NULL OR btrim(finding_note) <> ''),
  CONSTRAINT ck_condition_items_not_self_correction CHECK (correction_of IS NULL OR correction_of <> id)
);

COMMENT ON TABLE rec.condition_items IS
  'Phase 1-8 reception condition findings (P1-08-DB-011). New findings only while the inspection is open; corrections (correction_of) are the approved post-finalization path. finding_note is internal, search-excluded.';

CREATE INDEX ix_condition_items_inspection
  ON rec.condition_items (tenant_id, company_id, branch_id, inspection_id);
CREATE INDEX ix_condition_items_evidence ON rec.condition_items (tenant_id, evidence_document_id);
CREATE INDEX ix_condition_items_correction_of
  ON rec.condition_items (tenant_id, company_id, branch_id, correction_of);

-- ----------------------------------------------------------------------------
-- Condition-item open guard: a NEW finding (correction_of IS NULL) may only be
-- inserted while its inspection is in_progress; a correction is allowed anytime.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_condition_item_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.correction_of IS NULL THEN
    SELECT inspection_status INTO v_status FROM rec.visual_inspections
      WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
        AND branch_id = NEW.branch_id AND id = NEW.inspection_id;
    IF v_status IS DISTINCT FROM 'in_progress' THEN
      RAISE EXCEPTION 'inspection % is not open; only a linked correction may be added',
        NEW.inspection_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_condition_item_open() IS
  'BEFORE INSERT on rec.condition_items: a new finding requires an open (in_progress) inspection; a correction (correction_of set) is exempt.';
REVOKE EXECUTE ON FUNCTION rec.guard_condition_item_open() FROM PUBLIC;

CREATE TRIGGER tg_condition_items_open
  BEFORE INSERT ON rec.condition_items
  FOR EACH ROW EXECUTE FUNCTION rec.guard_condition_item_open();
CREATE TRIGGER tg_condition_items_immutable
  BEFORE UPDATE ON rec.condition_items
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'inspection_id', 'correction_of',
    'created_at', 'created_by');
CREATE TRIGGER tg_condition_items_touch_metadata
  BEFORE UPDATE ON rec.condition_items
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.condition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.condition_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_condition_items_scope ON rec.condition_items
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_condition_items_scope ON rec.condition_items
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_condition_items_scope ON rec.condition_items
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.condition_items TO app_runtime;
GRANT SELECT ON rec.condition_items TO app_readonly;
