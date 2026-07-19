-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: inspection/diagnostic templates, immutable versions, template items
-- Tasks: P1-09-DB-021 (templates), DB-022 (versions), DB-023 (items)
-- Owner module: dia
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only.
--
-- Purpose
--   Tenant-scoped diagnostic templates with immutable versions. A version is
--   draft while authored; once PUBLISHED it (and its items) are frozen — a report
--   may pin only a published version, and the pinned version can never change
--   afterward (design §10, F3). Items are mutable only while their version is
--   draft (a freeze trigger enforces this).
--
-- Dependencies
--   org.tenants; dia.diagnostic_types; iam.current_tenant_id;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Objects created
--   Tables:    dia.inspection_templates, dia.template_versions, dia.template_items
--   Functions: dia.guard_template_version_publish(), dia.guard_template_item_frozen()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. dia.inspection_templates — tenant-scoped template master.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.inspection_templates (
  id                uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid    NOT NULL,
  code              text    NOT NULL,
  name              text    NOT NULL,
  diagnostic_type_id uuid   NOT NULL,
  status            text    NOT NULL DEFAULT 'active',
  record_version    integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid    NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid    NULL,
  deleted_at        timestamptz NULL,
  deleted_by        uuid    NULL,

  CONSTRAINT pk_inspection_templates PRIMARY KEY (id),
  CONSTRAINT uq_inspection_templates_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_inspection_templates_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inspection_templates_type FOREIGN KEY (diagnostic_type_id) REFERENCES dia.diagnostic_types (id) ON DELETE RESTRICT,
  CONSTRAINT ck_inspection_templates_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_inspection_templates_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_inspection_templates_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE dia.inspection_templates IS
  'Phase 1-9 tenant-scoped diagnostic template master (P1-09-DB-021). Content lives in versioned children; a report pins a published version.';
CREATE UNIQUE INDEX uq_inspection_templates_tenant_code ON dia.inspection_templates (tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_inspection_templates_type ON dia.inspection_templates (diagnostic_type_id);
CREATE TRIGGER tg_inspection_templates_touch_metadata BEFORE UPDATE ON dia.inspection_templates
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_inspection_templates_immutable BEFORE UPDATE ON dia.inspection_templates
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE dia.inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.inspection_templates FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_inspection_templates_tenant ON dia.inspection_templates FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_inspection_templates_tenant ON dia.inspection_templates FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_inspection_templates_tenant ON dia.inspection_templates FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.inspection_templates TO app_runtime;
GRANT SELECT ON dia.inspection_templates TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. dia.template_versions — immutable-once-published version container.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.template_versions (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  template_id    uuid    NOT NULL,
  version_number integer NOT NULL,
  status         text    NOT NULL DEFAULT 'draft',
  published_at   timestamptz NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_template_versions PRIMARY KEY (id),
  CONSTRAINT uq_template_versions_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_template_versions_template
    FOREIGN KEY (tenant_id, template_id) REFERENCES dia.inspection_templates (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_template_versions_number CHECK (version_number > 0),
  CONSTRAINT ck_template_versions_status CHECK (status IN ('draft', 'published', 'retired')),
  CONSTRAINT ck_template_versions_published_at CHECK (
    (status = 'draft' AND published_at IS NULL) OR (status IN ('published', 'retired') AND published_at IS NOT NULL))
);
COMMENT ON TABLE dia.template_versions IS
  'Phase 1-9 diagnostic template version (P1-09-DB-022). draft→published→retired; published/retired are frozen and their items immutable (F3). A report pins only a published version.';
CREATE UNIQUE INDEX uq_template_versions_template_number ON dia.template_versions (tenant_id, template_id, version_number) WHERE deleted_at IS NULL;
CREATE INDEX ix_template_versions_template ON dia.template_versions (tenant_id, template_id);

-- Publish/retire transition guard: draft→published (stamps published_at),
-- published→retired; never back to draft; once published the version is frozen.
CREATE OR REPLACE FUNCTION dia.guard_template_version_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status = 'published')
    OR (OLD.status = 'published' AND NEW.status = 'retired')
  ) THEN
    RAISE EXCEPTION 'invalid template version status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION dia.guard_template_version_publish() IS
  'BEFORE UPDATE OF status on dia.template_versions: enforces draft→published→retired and stamps published_at on publish.';
REVOKE EXECUTE ON FUNCTION dia.guard_template_version_publish() FROM PUBLIC;

CREATE TRIGGER tg_template_versions_publish BEFORE UPDATE OF status ON dia.template_versions
  FOR EACH ROW EXECUTE FUNCTION dia.guard_template_version_publish();
CREATE TRIGGER tg_template_versions_touch_metadata BEFORE UPDATE ON dia.template_versions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_template_versions_immutable BEFORE UPDATE ON dia.template_versions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'template_id', 'version_number', 'created_at', 'created_by');
ALTER TABLE dia.template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.template_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_template_versions_tenant ON dia.template_versions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_template_versions_tenant ON dia.template_versions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_template_versions_tenant ON dia.template_versions FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.template_versions TO app_runtime;
GRANT SELECT ON dia.template_versions TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. dia.template_items — per-version required items (frozen when published, F3).
-- ----------------------------------------------------------------------------
CREATE TABLE dia.template_items (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  template_version_id uuid   NOT NULL,
  item_code          text    NOT NULL,
  prompt             text    NOT NULL,
  response_type      text    NOT NULL,
  unit               text    NULL,
  is_mandatory       boolean NOT NULL DEFAULT false,
  validation_rule    jsonb   NULL,
  sequence           integer NOT NULL DEFAULT 1,
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_template_items PRIMARY KEY (id),
  CONSTRAINT uq_template_items_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_template_items_version
    FOREIGN KEY (tenant_id, template_version_id) REFERENCES dia.template_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_template_items_code_format CHECK (item_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_template_items_prompt_not_blank CHECK (btrim(prompt) <> ''),
  CONSTRAINT ck_template_items_response_type CHECK (response_type IN ('numeric', 'text', 'boolean', 'select')),
  CONSTRAINT ck_template_items_unit CHECK (response_type <> 'numeric' OR unit IS NOT NULL),
  CONSTRAINT ck_template_items_unit_not_blank CHECK (unit IS NULL OR btrim(unit) <> ''),
  CONSTRAINT ck_template_items_sequence CHECK (sequence > 0)
);
COMMENT ON TABLE dia.template_items IS
  'Phase 1-9 diagnostic template item (P1-09-DB-023). Numeric items require a unit. Items are frozen once their version is published (F3). Mandatory items must be answered before a report completes (B4-family completion gate).';
CREATE UNIQUE INDEX uq_template_items_version_code ON dia.template_items (tenant_id, template_version_id, item_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_template_items_version ON dia.template_items (tenant_id, template_version_id);

-- Freeze guard (F3): items are mutable only while their version is draft.
CREATE OR REPLACE FUNCTION dia.guard_template_item_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_version uuid := COALESCE(NEW.template_version_id, OLD.template_version_id);
  v_tenant  uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
BEGIN
  SELECT status INTO v_status FROM dia.template_versions
  WHERE tenant_id = v_tenant AND id = v_version;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'template items are frozen: version % is % (not draft)', v_version, COALESCE(v_status, '(missing)')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION dia.guard_template_item_frozen() IS
  'BEFORE INSERT/UPDATE on dia.template_items: rejects any change (including soft-delete) once the parent version is published/retired (F3 — version immutability includes items).';
REVOKE EXECUTE ON FUNCTION dia.guard_template_item_frozen() FROM PUBLIC;

CREATE TRIGGER tg_template_items_frozen BEFORE INSERT OR UPDATE ON dia.template_items
  FOR EACH ROW EXECUTE FUNCTION dia.guard_template_item_frozen();
CREATE TRIGGER tg_template_items_touch_metadata BEFORE UPDATE ON dia.template_items
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_template_items_immutable BEFORE UPDATE ON dia.template_items
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'template_version_id', 'item_code', 'created_at', 'created_by');
ALTER TABLE dia.template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.template_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_template_items_tenant ON dia.template_items FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_template_items_tenant ON dia.template_items FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_template_items_tenant ON dia.template_items FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.template_items TO app_runtime;
GRANT SELECT ON dia.template_items TO app_readonly;
