-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: diagnostics + quality configuration catalogs
-- Tasks: P1-09-DB-020 (diagnostic types), P1-09-DB-030 (QC checks)
-- Owner module: dia, qms
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   configured. Forward-only — no down script.
--
-- Purpose
--   Dual-scope catalogs: dia.diagnostic_types classifies templates/reports;
--   qms.qc_checks defines the quality-control check catalog (with mandatory and
--   safety-critical flags read by the closure gate and BR-QMS-001). Configuration
--   only — no business data.
--
-- Dependencies
--   org.tenants; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Objects created
--   Tables:   dia.diagnostic_types, qms.qc_checks
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. dia.diagnostic_types — classification of diagnostic templates/reports.
-- ----------------------------------------------------------------------------
CREATE TABLE dia.diagnostic_types (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope          text    NOT NULL,
  tenant_id      uuid    NULL,
  code           text    NOT NULL,
  name           text    NOT NULL,
  status         text    NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_diagnostic_types PRIMARY KEY (id),
  CONSTRAINT fk_diagnostic_types_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_diagnostic_types_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_diagnostic_types_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)),
  CONSTRAINT ck_diagnostic_types_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_diagnostic_types_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_diagnostic_types_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE dia.diagnostic_types IS
  'Phase 1-9 diagnostic-type catalog (P1-09-DB-020). Classifies inspection templates and reports. Dual-scope; configuration only.';
CREATE INDEX ix_diagnostic_types_tenant ON dia.diagnostic_types (tenant_id);
CREATE UNIQUE INDEX uq_diagnostic_types_platform_code ON dia.diagnostic_types (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_diagnostic_types_tenant_code ON dia.diagnostic_types (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_diagnostic_types_touch_metadata BEFORE UPDATE ON dia.diagnostic_types
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_diagnostic_types_immutable BEFORE UPDATE ON dia.diagnostic_types
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE dia.diagnostic_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE dia.diagnostic_types FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_diagnostic_types_visible ON dia.diagnostic_types FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_diagnostic_types_tenant ON dia.diagnostic_types FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_diagnostic_types_tenant ON dia.diagnostic_types FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON dia.diagnostic_types TO app_runtime;
GRANT SELECT ON dia.diagnostic_types TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. qms.qc_checks — the quality-control check catalog.
-- ----------------------------------------------------------------------------
CREATE TABLE qms.qc_checks (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope              text    NOT NULL,
  tenant_id          uuid    NULL,
  code               text    NOT NULL,
  name               text    NOT NULL,
  is_mandatory       boolean NOT NULL DEFAULT false,
  is_safety_critical boolean NOT NULL DEFAULT false,
  status             text    NOT NULL DEFAULT 'active',
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_qc_checks PRIMARY KEY (id),
  CONSTRAINT fk_qc_checks_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_qc_checks_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_qc_checks_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)),
  CONSTRAINT ck_qc_checks_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_qc_checks_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_qc_checks_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE qms.qc_checks IS
  'Phase 1-9 quality-control check catalog (P1-09-DB-030). is_mandatory checks gate work-order closure (B5); is_safety_critical marks checks whose rework requires independent sign-off (BR-QMS-001). Dual-scope; configuration only.';
CREATE INDEX ix_qc_checks_tenant ON qms.qc_checks (tenant_id);
CREATE UNIQUE INDEX uq_qc_checks_platform_code ON qms.qc_checks (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_qc_checks_tenant_code ON qms.qc_checks (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_qc_checks_touch_metadata BEFORE UPDATE ON qms.qc_checks
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_qc_checks_immutable BEFORE UPDATE ON qms.qc_checks
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE qms.qc_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE qms.qc_checks FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_qc_checks_visible ON qms.qc_checks FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_qc_checks_tenant ON qms.qc_checks FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_qc_checks_tenant ON qms.qc_checks FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON qms.qc_checks TO app_runtime;
GRANT SELECT ON qms.qc_checks TO app_readonly;
