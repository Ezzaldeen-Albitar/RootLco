-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception warning-light + visible-leak observations
-- Tasks: P1-08-DB-014 (warning lights), P1-08-DB-015 (leaks)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   Two at-reception observation ledgers for a received Vehicle:
--     * rec.warning_light_observations — a governed dashboard warning-light code
--       (from rec.warning_light_codes) and its observed state. An archived
--       (inactive) code cannot be newly selected.
--     * rec.leak_observations — a visible leak by type, Vehicle zone, and severity.
--   Notes are operational Vehicle-technical text (internal, search-excluded).
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); rec.warning_light_codes (id);
--   shared.documents (tenant,id); iam.current_tenant_id / allowed_*_ids;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    rec.warning_light_observations, rec.leak_observations
--   Functions: rec.guard_warning_light_observation()
--   Triggers:  tg_warning_light_observations_code, tg_warning_light_observations_immutable,
--              tg_warning_light_observations_touch_metadata, tg_leak_observations_immutable,
--              tg_leak_observations_touch_metadata
--   Policies:  sel/ins/upd_warning_light_observations_scope, sel/ins/upd_leak_observations_scope
-- ============================================================================

CREATE TABLE rec.warning_light_observations (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  company_id            uuid        NOT NULL,
  branch_id             uuid        NOT NULL,
  reception_visit_id    uuid        NOT NULL,
  warning_light_code_id uuid        NOT NULL,
  observed_state        text        NOT NULL DEFAULT 'on',
  note                  text        NULL,
  evidence_document_id  uuid        NULL,
  record_version        integer     NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid        NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid        NULL,

  CONSTRAINT pk_warning_light_observations PRIMARY KEY (id),
  CONSTRAINT fk_warning_light_observations_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_warning_light_observations_code
    FOREIGN KEY (warning_light_code_id) REFERENCES rec.warning_light_codes (id) ON DELETE RESTRICT,
  CONSTRAINT fk_warning_light_observations_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_warning_light_observations_state
    CHECK (observed_state IN ('on', 'flashing', 'intermittent')),
  CONSTRAINT ck_warning_light_observations_note_not_blank
    CHECK (note IS NULL OR btrim(note) <> ''),
  -- One active observation per visit+code.
  CONSTRAINT uq_warning_light_observations_active UNIQUE (reception_visit_id, warning_light_code_id)
);

COMMENT ON TABLE rec.warning_light_observations IS
  'Phase 1-8 reception dashboard warning-light observations (P1-08-DB-014). Governed code (archived codes cannot be newly selected) + observed state. note is internal.';

CREATE INDEX ix_warning_light_observations_visit
  ON rec.warning_light_observations (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_warning_light_observations_code
  ON rec.warning_light_observations (warning_light_code_id);
CREATE INDEX ix_warning_light_observations_evidence
  ON rec.warning_light_observations (tenant_id, evidence_document_id);

CREATE OR REPLACE FUNCTION rec.guard_warning_light_observation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM rec.warning_light_codes WHERE id = NEW.warning_light_code_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'warning_light_code % is not visible to this tenant', NEW.warning_light_code_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'warning_light_code % is not active and cannot be newly selected',
      NEW.warning_light_code_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_warning_light_observation() IS
  'BEFORE INSERT/UPDATE on rec.warning_light_observations: the code must be platform-or-same-tenant visible AND active (archived codes cannot be newly selected).';
REVOKE EXECUTE ON FUNCTION rec.guard_warning_light_observation() FROM PUBLIC;

CREATE TRIGGER tg_warning_light_observations_code
  BEFORE INSERT OR UPDATE OF warning_light_code_id ON rec.warning_light_observations
  FOR EACH ROW EXECUTE FUNCTION rec.guard_warning_light_observation();
CREATE TRIGGER tg_warning_light_observations_immutable
  BEFORE UPDATE ON rec.warning_light_observations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'warning_light_code_id',
    'created_at', 'created_by');
CREATE TRIGGER tg_warning_light_observations_touch_metadata
  BEFORE UPDATE ON rec.warning_light_observations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.warning_light_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.warning_light_observations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_warning_light_observations_scope ON rec.warning_light_observations
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_warning_light_observations_scope ON rec.warning_light_observations
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_warning_light_observations_scope ON rec.warning_light_observations
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.warning_light_observations TO app_runtime;
GRANT SELECT ON rec.warning_light_observations TO app_readonly;

-- ----------------------------------------------------------------------------
-- rec.leak_observations — visible leaks (bounded type CHECK, no catalog).
-- ----------------------------------------------------------------------------
CREATE TABLE rec.leak_observations (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  company_id           uuid        NOT NULL,
  branch_id            uuid        NOT NULL,
  reception_visit_id   uuid        NOT NULL,
  leak_type            text        NOT NULL,
  vehicle_zone         text        NOT NULL,
  severity             text        NOT NULL DEFAULT 'minor',
  note                 text        NULL,
  evidence_document_id uuid        NULL,
  record_version       integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NULL,
  updated_by           uuid        NULL,
  deleted_at           timestamptz NULL,
  deleted_by           uuid        NULL,

  CONSTRAINT pk_leak_observations PRIMARY KEY (id),
  CONSTRAINT fk_leak_observations_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_leak_observations_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_leak_observations_type CHECK (leak_type IN (
    'oil', 'coolant', 'fuel', 'brake_fluid', 'transmission', 'water', 'other')),
  CONSTRAINT ck_leak_observations_severity CHECK (severity IN ('minor', 'moderate', 'major', 'critical')),
  CONSTRAINT ck_leak_observations_zone_not_blank CHECK (btrim(vehicle_zone) <> ''),
  CONSTRAINT ck_leak_observations_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

COMMENT ON TABLE rec.leak_observations IS
  'Phase 1-8 reception visible-leak observations (P1-08-DB-015). Bounded leak type, Vehicle zone, severity. note is internal.';

CREATE INDEX ix_leak_observations_visit
  ON rec.leak_observations (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_leak_observations_evidence ON rec.leak_observations (tenant_id, evidence_document_id);

CREATE TRIGGER tg_leak_observations_immutable
  BEFORE UPDATE ON rec.leak_observations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'reception_visit_id', 'created_at', 'created_by');
CREATE TRIGGER tg_leak_observations_touch_metadata
  BEFORE UPDATE ON rec.leak_observations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.leak_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.leak_observations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_leak_observations_scope ON rec.leak_observations
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_leak_observations_scope ON rec.leak_observations
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_leak_observations_scope ON rec.leak_observations
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.leak_observations TO app_runtime;
GRANT SELECT ON rec.leak_observations TO app_readonly;
