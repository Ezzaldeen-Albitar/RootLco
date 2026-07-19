-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception damage maps (version-bound) + damage marks
-- Tasks: P1-08-DB-012 (damage map), P1-08-DB-013 (damage marks)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   rec.damage_maps binds a reception visit to a specific diagram TEMPLATE and,
--   crucially, to the EXACT immutable document VERSION of that template — not just
--   the mutable document id. Marks placed on a map therefore reference frozen
--   geometry: if the template is later revised, that is a NEW map bound to a new
--   version, and prior marks stay anchored to the version they were drawn on.
--   rec.damage_marks are the individual annotations (type, zone, normalized 0..1
--   coordinates, optional internal note, optional evidence).
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); shared.documents (tenant,id);
--   shared.document_versions (tenant,id); iam.current_tenant_id / allowed_*_ids;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Security implications
--   * ENABLE + FORCE RLS; branch-scoped. A guard binds document_version to its
--     document (exact-version integrity); the version link is immutable.
--
-- Objects created
--   Tables:    rec.damage_maps, rec.damage_marks
--   Functions: rec.guard_damage_map_version()
--   Triggers:  tg_damage_maps_version, tg_damage_maps_immutable,
--              tg_damage_maps_touch_metadata, tg_damage_marks_immutable,
--              tg_damage_marks_touch_metadata
--   Policies:  sel/ins/upd_damage_maps_scope, sel/ins/upd_damage_marks_scope
-- ============================================================================

CREATE TABLE rec.damage_maps (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  company_id          uuid        NOT NULL,
  branch_id           uuid        NOT NULL,
  reception_visit_id  uuid        NOT NULL,
  document_id         uuid        NOT NULL,
  document_version_id uuid        NOT NULL,
  map_type            text        NOT NULL,
  perspective         text        NULL,
  record_version      integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid        NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid        NULL,

  CONSTRAINT pk_damage_maps PRIMARY KEY (id),
  CONSTRAINT uq_damage_maps_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_damage_maps_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damage_maps_document
    FOREIGN KEY (tenant_id, document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damage_maps_document_version
    FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_damage_maps_type CHECK (map_type IN (
    'exterior', 'interior', 'undercarriage', 'other')),
  CONSTRAINT ck_damage_maps_perspective_not_blank
    CHECK (perspective IS NULL OR btrim(perspective) <> '')
);

COMMENT ON TABLE rec.damage_maps IS
  'Phase 1-8 reception damage-map reference (P1-08-DB-012). Binds a visit to a template document AND its exact immutable version; a revised template is a new map, so prior marks never move.';

CREATE INDEX ix_damage_maps_visit
  ON rec.damage_maps (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_damage_maps_document ON rec.damage_maps (tenant_id, document_id);
CREATE INDEX ix_damage_maps_document_version ON rec.damage_maps (tenant_id, document_version_id);

-- ----------------------------------------------------------------------------
-- Version guard: the bound document_version must belong to the bound document
-- (exact-version integrity). SECURITY INVOKER so RLS scopes the lookup.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_damage_map_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_doc uuid;
BEGIN
  SELECT document_id INTO v_doc FROM shared.document_versions
    WHERE tenant_id = NEW.tenant_id AND id = NEW.document_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document version % is not visible to this tenant', NEW.document_version_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_doc IS DISTINCT FROM NEW.document_id THEN
    RAISE EXCEPTION 'document version % does not belong to document %',
      NEW.document_version_id, NEW.document_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_damage_map_version() IS
  'BEFORE INSERT/UPDATE on rec.damage_maps: the bound document_version must belong to the bound document (exact-version integrity).';
REVOKE EXECUTE ON FUNCTION rec.guard_damage_map_version() FROM PUBLIC;

CREATE TRIGGER tg_damage_maps_version
  BEFORE INSERT OR UPDATE OF document_id, document_version_id ON rec.damage_maps
  FOR EACH ROW EXECUTE FUNCTION rec.guard_damage_map_version();
CREATE TRIGGER tg_damage_maps_immutable
  BEFORE UPDATE ON rec.damage_maps
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'document_id',
    'document_version_id', 'created_at', 'created_by');
CREATE TRIGGER tg_damage_maps_touch_metadata
  BEFORE UPDATE ON rec.damage_maps
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.damage_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.damage_maps FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_damage_maps_scope ON rec.damage_maps
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_damage_maps_scope ON rec.damage_maps
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_damage_maps_scope ON rec.damage_maps
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.damage_maps TO app_runtime;
GRANT SELECT ON rec.damage_maps TO app_readonly;

-- ----------------------------------------------------------------------------
-- rec.damage_marks — annotations on a specific (version-bound) map.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.damage_marks (
  id             uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL,
  company_id     uuid          NOT NULL,
  branch_id      uuid          NOT NULL,
  damage_map_id  uuid          NOT NULL,
  mark_type      text          NOT NULL,
  vehicle_zone   text          NOT NULL,
  coord_x        numeric(6, 5) NOT NULL,
  coord_y        numeric(6, 5) NOT NULL,
  note           text          NULL,
  evidence_document_id uuid    NULL,
  record_version integer       NOT NULL DEFAULT 1,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          NOT NULL,
  updated_at     timestamptz   NULL,
  updated_by     uuid          NULL,
  deleted_at     timestamptz   NULL,
  deleted_by     uuid          NULL,

  CONSTRAINT pk_damage_marks PRIMARY KEY (id),
  CONSTRAINT fk_damage_marks_map
    FOREIGN KEY (tenant_id, company_id, branch_id, damage_map_id)
    REFERENCES rec.damage_maps (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damage_marks_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_damage_marks_type CHECK (mark_type IN (
    'scratch', 'dent', 'crack', 'chip', 'rust', 'missing', 'other')),
  CONSTRAINT ck_damage_marks_zone_not_blank CHECK (btrim(vehicle_zone) <> ''),
  CONSTRAINT ck_damage_marks_coord_x CHECK (coord_x >= 0 AND coord_x <= 1),
  CONSTRAINT ck_damage_marks_coord_y CHECK (coord_y >= 0 AND coord_y <= 1),
  CONSTRAINT ck_damage_marks_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

COMMENT ON TABLE rec.damage_marks IS
  'Phase 1-8 reception damage marks (P1-08-DB-013). Normalized 0..1 coordinates on a specific version-bound rec.damage_maps row; a template revision is a new map, so marks never move. note is internal.';

CREATE INDEX ix_damage_marks_map
  ON rec.damage_marks (tenant_id, company_id, branch_id, damage_map_id);
CREATE INDEX ix_damage_marks_evidence ON rec.damage_marks (tenant_id, evidence_document_id);

CREATE TRIGGER tg_damage_marks_immutable
  BEFORE UPDATE ON rec.damage_marks
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'damage_map_id', 'created_at', 'created_by');
CREATE TRIGGER tg_damage_marks_touch_metadata
  BEFORE UPDATE ON rec.damage_marks
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.damage_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.damage_marks FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_damage_marks_scope ON rec.damage_marks
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_damage_marks_scope ON rec.damage_marks
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_damage_marks_scope ON rec.damage_marks
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.damage_marks TO app_runtime;
GRANT SELECT ON rec.damage_marks TO app_readonly;
