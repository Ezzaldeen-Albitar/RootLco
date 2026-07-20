-- ============================================================================
-- Phase 1-11 — rpt reporting configuration (P1-11-DB-018)
-- Versioned report configurations (published versions immutable), and user-owned
-- saved filters (visible only to the owning user; saved-filter scope cannot exceed
-- the report scope). No report datasets, KPI formulas, or export backend (Phase 1-23).
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once report
--   configurations or saved filters exist.
--
-- Binding amendments (§19): M-rpt-1 (owner RLS on every command + WITH CHECK; report
-- configs tenant-scoped), M-rpt-2 (coarse scope_level DB-enforced: filter <= report).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rpt.report_configurations — tenant-scoped, versioned
-- ----------------------------------------------------------------------------
CREATE TABLE rpt.report_configurations (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  report_code    text NOT NULL,
  name           text NOT NULL,
  scope_level    text NOT NULL DEFAULT 'branch',
  export_permission_code text NOT NULL,
  owner_user_id  uuid NOT NULL,
  status         text NOT NULL DEFAULT 'draft',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_report_configurations PRIMARY KEY (id),
  CONSTRAINT uq_report_configurations_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_report_configurations_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_configurations_permission FOREIGN KEY (export_permission_code) REFERENCES iam.permissions (permission_code) ON DELETE RESTRICT,
  CONSTRAINT ck_report_configurations_scope CHECK (scope_level IN ('branch', 'company', 'tenant')),
  CONSTRAINT ck_report_configurations_status CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT ck_report_configurations_code CHECK (report_code ~ '^[a-z][a-z0-9_]{1,62}$')
);
COMMENT ON TABLE rpt.report_configurations IS 'Phase 1-11 report configuration (tenant-scoped). Versioned (rpt.report_configuration_versions); published versions immutable. export_permission_code gates export downstream (Phase 1-23). No datasets/KPI formulas.';
CREATE UNIQUE INDEX uq_report_configurations_code ON rpt.report_configurations (tenant_id, report_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_report_configurations_permission ON rpt.report_configurations (export_permission_code);
CREATE INDEX ix_report_configurations_owner ON rpt.report_configurations (tenant_id, owner_user_id);
CREATE TRIGGER tg_report_configurations_touch_metadata BEFORE UPDATE ON rpt.report_configurations FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_report_configurations_immutable BEFORE UPDATE ON rpt.report_configurations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'report_code', 'created_at', 'created_by');
ALTER TABLE rpt.report_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpt.report_configurations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_report_configurations_scope ON rpt.report_configurations FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_report_configurations_scope ON rpt.report_configurations FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_report_configurations_scope ON rpt.report_configurations FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rpt.report_configurations TO app_runtime;
GRANT SELECT ON rpt.report_configurations TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. rpt.report_configuration_versions — monotonic; published immutable
-- ----------------------------------------------------------------------------
CREATE TABLE rpt.report_configuration_versions (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  report_configuration_id uuid NOT NULL,
  version_number   integer NOT NULL,
  parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'draft',
  published_at     timestamptz NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_report_configuration_versions PRIMARY KEY (id),
  CONSTRAINT uq_report_configuration_versions_number UNIQUE (tenant_id, report_configuration_id, version_number),
  CONSTRAINT fk_report_configuration_versions_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_configuration_versions_config FOREIGN KEY (tenant_id, report_configuration_id)
    REFERENCES rpt.report_configurations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_report_configuration_versions_status CHECK (status IN ('draft', 'published')),
  CONSTRAINT ck_report_configuration_versions_number CHECK (version_number >= 1)
);
COMMENT ON TABLE rpt.report_configuration_versions IS 'Phase 1-11 report configuration version (monotonic per config). A published version is immutable (guard_report_version_freeze).';
CREATE UNIQUE INDEX uq_report_configuration_versions_published ON rpt.report_configuration_versions (tenant_id, report_configuration_id) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX ix_report_configuration_versions_config ON rpt.report_configuration_versions (tenant_id, report_configuration_id);

CREATE OR REPLACE FUNCTION rpt.guard_report_version_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF NEW.parameter_schema <> OLD.parameter_schema OR NEW.version_number <> OLD.version_number
       OR NEW.status <> OLD.status OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'rpt.report_configuration_versions: a published version is immutable' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION rpt.guard_report_version_freeze() FROM PUBLIC;
CREATE TRIGGER tg_report_configuration_versions_freeze BEFORE UPDATE ON rpt.report_configuration_versions FOR EACH ROW EXECUTE FUNCTION rpt.guard_report_version_freeze();
CREATE TRIGGER tg_report_configuration_versions_touch_metadata BEFORE UPDATE ON rpt.report_configuration_versions FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_report_configuration_versions_immutable BEFORE UPDATE ON rpt.report_configuration_versions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'report_configuration_id', 'version_number', 'created_at', 'created_by');
ALTER TABLE rpt.report_configuration_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpt.report_configuration_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_report_configuration_versions_scope ON rpt.report_configuration_versions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_report_configuration_versions_scope ON rpt.report_configuration_versions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_report_configuration_versions_scope ON rpt.report_configuration_versions FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rpt.report_configuration_versions TO app_runtime;
GRANT SELECT ON rpt.report_configuration_versions TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. rpt.saved_filters — user-owned (owner-only RLS); scope <= report scope
-- ----------------------------------------------------------------------------
CREATE TABLE rpt.saved_filters (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  report_configuration_id uuid NOT NULL,
  owner_user_id     uuid NOT NULL,
  name              text NOT NULL,
  filter_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope_level       text NOT NULL DEFAULT 'branch',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_saved_filters PRIMARY KEY (id),
  CONSTRAINT uq_saved_filters_name UNIQUE (tenant_id, owner_user_id, report_configuration_id, name),
  CONSTRAINT fk_saved_filters_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_saved_filters_config FOREIGN KEY (tenant_id, report_configuration_id)
    REFERENCES rpt.report_configurations (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_saved_filters_scope CHECK (scope_level IN ('branch', 'company', 'tenant'))
);
COMMENT ON TABLE rpt.saved_filters IS 'Phase 1-11 user-owned saved filter. Visible/mutable ONLY to the owning user (owner-only RLS on every command; owner cannot be reassigned). scope_level cannot exceed the report scope (BR-RPT-001, guard_saved_filter_scope).';
CREATE INDEX ix_saved_filters_owner_report ON rpt.saved_filters (tenant_id, owner_user_id, report_configuration_id);
CREATE INDEX ix_saved_filters_config ON rpt.saved_filters (tenant_id, report_configuration_id);

-- M-rpt-2 / BR-RPT-001: a saved filter's scope cannot exceed the report's scope.
CREATE OR REPLACE FUNCTION rpt.guard_saved_filter_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_report_scope text; v_rank int; v_filter_rank int;
        v_ranks jsonb := '{"branch":1,"company":2,"tenant":3}'::jsonb;
BEGIN
  SELECT scope_level INTO v_report_scope FROM rpt.report_configurations
    WHERE tenant_id = NEW.tenant_id AND id = NEW.report_configuration_id;
  IF v_report_scope IS NULL THEN
    RAISE EXCEPTION 'rpt.saved_filters: report configuration % not found in scope', NEW.report_configuration_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  v_rank := (v_ranks ->> v_report_scope)::int;
  v_filter_rank := (v_ranks ->> NEW.scope_level)::int;
  IF v_filter_rank > v_rank THEN
    RAISE EXCEPTION 'rpt.saved_filters: filter scope % exceeds the report scope % (BR-RPT-001)', NEW.scope_level, v_report_scope USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION rpt.guard_saved_filter_scope() FROM PUBLIC;
CREATE TRIGGER tg_saved_filters_scope BEFORE INSERT OR UPDATE ON rpt.saved_filters FOR EACH ROW EXECUTE FUNCTION rpt.guard_saved_filter_scope();
CREATE TRIGGER tg_saved_filters_touch_metadata BEFORE UPDATE ON rpt.saved_filters FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_saved_filters_immutable BEFORE UPDATE ON rpt.saved_filters
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'report_configuration_id', 'owner_user_id', 'created_at', 'created_by');
ALTER TABLE rpt.saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpt.saved_filters FORCE  ROW LEVEL SECURITY;
-- Owner-only on EVERY command; owner_user_id pinned in USING and WITH CHECK (no hijack).
CREATE POLICY sel_saved_filters_owner ON rpt.saved_filters FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND owner_user_id = iam.current_user_id());
CREATE POLICY ins_saved_filters_owner ON rpt.saved_filters FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND owner_user_id = iam.current_user_id());
CREATE POLICY upd_saved_filters_owner ON rpt.saved_filters FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND owner_user_id = iam.current_user_id())
  WITH CHECK (tenant_id = iam.current_tenant_id() AND owner_user_id = iam.current_user_id());
-- No hard DELETE for application roles (platform invariant): an owner removes a saved
-- filter by soft-delete (UPDATE deleted_at) through the owner UPDATE policy above.
GRANT SELECT, INSERT, UPDATE ON rpt.saved_filters TO app_runtime;
GRANT SELECT ON rpt.saved_filters TO app_readonly;
