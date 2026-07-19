-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: Vehicle-Reception dual-scope configuration catalogs
-- Tasks: P1-08 Wave 3 (reception reference configuration)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   Four tenant-extensible catalogs the reception domain references:
--     * rec.visit_reasons        — why the Vehicle was brought in
--     * rec.fuel_levels          — fuel-gauge code list captured at reception
--     * rec.warning_light_codes  — dashboard warning-light code list
--     * rec.refusal_reasons      — reasons a party refused a reception step
--   Each is DUAL-SCOPE (veh/apt-catalog precedent): a platform default row
--   (scope='platform', tenant_id NULL) OR a tenant extension (scope='tenant',
--   tenant_id NOT NULL). Zero rows ship (no-fake-data); platform rows are
--   provisioned admin-side and tenant rows at runtime. No Benzene identifiers or
--   real operational values are seeded or defaulted. Constrained taxonomies are
--   NOT over-normalized: these are the only reception code lists in this phase.
--
-- Dependencies
--   org.tenants; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns; the rec schema (20260721090000).
--
-- Security implications
--   * ENABLE + FORCE RLS; platform rows visible to every tenant, tenant rows only
--     to their owner; a tenant may only write scope='tenant' rows of its own
--     tenant (platform rows admin-only). scope/tenant_id/code/audit-birth immutable.
--
-- Objects created
--   Tables:    rec.visit_reasons, rec.fuel_levels, rec.warning_light_codes,
--              rec.refusal_reasons
--   Triggers:  tg_<t>_touch_metadata, tg_<t>_immutable (per table)
--   Policies:  sel_<t>_visible, ins_<t>_tenant, upd_<t>_tenant (per table)
--   Indexes:   ix_<t>_tenant, uq_<t>_platform_code, uq_<t>_tenant_code (per table)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rec.visit_reasons
-- ----------------------------------------------------------------------------
CREATE TABLE rec.visit_reasons (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_visit_reasons PRIMARY KEY (id),
  CONSTRAINT fk_visit_reasons_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_visit_reasons_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_visit_reasons_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_visit_reasons_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_visit_reasons_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_visit_reasons_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE rec.visit_reasons IS
  'Phase 1-8 reception visit-reason catalog. Dual-scope (platform default or tenant extension). Zero rows shipped (no-fake-data).';
CREATE INDEX ix_visit_reasons_tenant ON rec.visit_reasons (tenant_id);
CREATE UNIQUE INDEX uq_visit_reasons_platform_code
  ON rec.visit_reasons (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_visit_reasons_tenant_code
  ON rec.visit_reasons (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_visit_reasons_touch_metadata
  BEFORE UPDATE ON rec.visit_reasons
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_visit_reasons_immutable
  BEFORE UPDATE ON rec.visit_reasons
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE rec.visit_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.visit_reasons FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_visit_reasons_visible ON rec.visit_reasons
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_visit_reasons_tenant ON rec.visit_reasons
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_visit_reasons_tenant ON rec.visit_reasons
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.visit_reasons TO app_runtime;
GRANT SELECT ON rec.visit_reasons TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. rec.fuel_levels
-- ----------------------------------------------------------------------------
CREATE TABLE rec.fuel_levels (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_fuel_levels PRIMARY KEY (id),
  CONSTRAINT fk_fuel_levels_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_fuel_levels_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_fuel_levels_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_fuel_levels_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_fuel_levels_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_fuel_levels_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE rec.fuel_levels IS
  'Phase 1-8 reception fuel-gauge code list captured at custody acceptance. Dual-scope. Zero rows shipped (no-fake-data).';
CREATE INDEX ix_fuel_levels_tenant ON rec.fuel_levels (tenant_id);
CREATE UNIQUE INDEX uq_fuel_levels_platform_code
  ON rec.fuel_levels (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_fuel_levels_tenant_code
  ON rec.fuel_levels (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_fuel_levels_touch_metadata
  BEFORE UPDATE ON rec.fuel_levels
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_fuel_levels_immutable
  BEFORE UPDATE ON rec.fuel_levels
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE rec.fuel_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.fuel_levels FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_fuel_levels_visible ON rec.fuel_levels
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_fuel_levels_tenant ON rec.fuel_levels
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_fuel_levels_tenant ON rec.fuel_levels
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.fuel_levels TO app_runtime;
GRANT SELECT ON rec.fuel_levels TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. rec.warning_light_codes
-- ----------------------------------------------------------------------------
CREATE TABLE rec.warning_light_codes (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_warning_light_codes PRIMARY KEY (id),
  CONSTRAINT fk_warning_light_codes_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_warning_light_codes_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_warning_light_codes_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_warning_light_codes_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_warning_light_codes_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_warning_light_codes_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE rec.warning_light_codes IS
  'Phase 1-8 dashboard warning-light code list observed at reception. Dual-scope. Zero rows shipped (no-fake-data).';
CREATE INDEX ix_warning_light_codes_tenant ON rec.warning_light_codes (tenant_id);
CREATE UNIQUE INDEX uq_warning_light_codes_platform_code
  ON rec.warning_light_codes (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_warning_light_codes_tenant_code
  ON rec.warning_light_codes (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_warning_light_codes_touch_metadata
  BEFORE UPDATE ON rec.warning_light_codes
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_warning_light_codes_immutable
  BEFORE UPDATE ON rec.warning_light_codes
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE rec.warning_light_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.warning_light_codes FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_warning_light_codes_visible ON rec.warning_light_codes
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_warning_light_codes_tenant ON rec.warning_light_codes
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_warning_light_codes_tenant ON rec.warning_light_codes
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.warning_light_codes TO app_runtime;
GRANT SELECT ON rec.warning_light_codes TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. rec.refusal_reasons
-- ----------------------------------------------------------------------------
CREATE TABLE rec.refusal_reasons (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_refusal_reasons PRIMARY KEY (id),
  CONSTRAINT fk_refusal_reasons_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_refusal_reasons_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_refusal_reasons_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_refusal_reasons_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_refusal_reasons_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_refusal_reasons_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE rec.refusal_reasons IS
  'Phase 1-8 reception refusal-reason catalog (why a party declined an intake step/signature). Dual-scope. Zero rows shipped (no-fake-data).';
CREATE INDEX ix_refusal_reasons_tenant ON rec.refusal_reasons (tenant_id);
CREATE UNIQUE INDEX uq_refusal_reasons_platform_code
  ON rec.refusal_reasons (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_refusal_reasons_tenant_code
  ON rec.refusal_reasons (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_refusal_reasons_touch_metadata
  BEFORE UPDATE ON rec.refusal_reasons
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_refusal_reasons_immutable
  BEFORE UPDATE ON rec.refusal_reasons
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE rec.refusal_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.refusal_reasons FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_refusal_reasons_visible ON rec.refusal_reasons
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_refusal_reasons_tenant ON rec.refusal_reasons
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_refusal_reasons_tenant ON rec.refusal_reasons
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.refusal_reasons TO app_runtime;
GRANT SELECT ON rec.refusal_reasons TO app_readonly;
