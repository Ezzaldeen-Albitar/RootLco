-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: technician configuration catalogs (skills, skill levels, certs)
-- Tasks: P1-09-DB-010 (skills), P1-09-DB-011 (skill levels), P1-09-DB-012 (certs)
-- Owner module: tech
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   configured. Forward-only — no down script.
--
-- Purpose
--   Dual-scope reference catalogs for the technician domain: a discipline/skill
--   taxonomy, ordered proficiency levels, and certification TYPES (not a person's
--   certificate — that is tech.technician_certifications). Platform defaults are
--   visible to all tenants; a tenant may add tenant-scope rows. No customer or
--   employee business data — configuration only.
--
-- Dependencies
--   org.tenants; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Objects created
--   Tables:   tech.skills, tech.skill_levels, tech.certifications
--   Triggers/Policies/Indexes: dual-scope catalog pattern (per table)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tech.skills — discipline / competency taxonomy.
-- ----------------------------------------------------------------------------
CREATE TABLE tech.skills (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope          text    NOT NULL,
  tenant_id      uuid    NULL,
  code           text    NOT NULL,
  name           text    NOT NULL,
  discipline     text    NULL,
  status         text    NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_skills PRIMARY KEY (id),
  CONSTRAINT fk_skills_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_skills_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_skills_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)),
  CONSTRAINT ck_skills_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_skills_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_skills_discipline_not_blank CHECK (discipline IS NULL OR btrim(discipline) <> ''),
  CONSTRAINT ck_skills_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE tech.skills IS
  'Phase 1-9 technician skill/competency taxonomy (P1-09-DB-010). Dual-scope catalog; configuration only, no business data.';
CREATE INDEX ix_skills_tenant ON tech.skills (tenant_id);
CREATE UNIQUE INDEX uq_skills_platform_code ON tech.skills (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_skills_tenant_code ON tech.skills (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_skills_touch_metadata BEFORE UPDATE ON tech.skills
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_skills_immutable BEFORE UPDATE ON tech.skills
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE tech.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.skills FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_skills_visible ON tech.skills FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_skills_tenant ON tech.skills FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_skills_tenant ON tech.skills FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.skills TO app_runtime;
GRANT SELECT ON tech.skills TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. tech.skill_levels — ordered proficiency levels.
-- ----------------------------------------------------------------------------
CREATE TABLE tech.skill_levels (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope          text    NOT NULL,
  tenant_id      uuid    NULL,
  code           text    NOT NULL,
  name           text    NOT NULL,
  rank           integer NOT NULL,
  status         text    NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_skill_levels PRIMARY KEY (id),
  CONSTRAINT fk_skill_levels_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_skill_levels_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_skill_levels_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)),
  CONSTRAINT ck_skill_levels_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_skill_levels_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_skill_levels_rank CHECK (rank > 0),
  CONSTRAINT ck_skill_levels_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE tech.skill_levels IS
  'Phase 1-9 ordered technician proficiency levels (P1-09-DB-011). rank orders least→most proficient. Dual-scope catalog.';
CREATE INDEX ix_skill_levels_tenant ON tech.skill_levels (tenant_id);
CREATE UNIQUE INDEX uq_skill_levels_platform_code ON tech.skill_levels (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_skill_levels_tenant_code ON tech.skill_levels (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_skill_levels_touch_metadata BEFORE UPDATE ON tech.skill_levels
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_skill_levels_immutable BEFORE UPDATE ON tech.skill_levels
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE tech.skill_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.skill_levels FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_skill_levels_visible ON tech.skill_levels FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_skill_levels_tenant ON tech.skill_levels FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_skill_levels_tenant ON tech.skill_levels FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.skill_levels TO app_runtime;
GRANT SELECT ON tech.skill_levels TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. tech.certifications — certification TYPES (not a person's certificate).
-- ----------------------------------------------------------------------------
CREATE TABLE tech.certifications (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope            text    NOT NULL,
  tenant_id        uuid    NULL,
  code             text    NOT NULL,
  name             text    NOT NULL,
  authority        text    NULL,
  validity_months  integer NULL,
  is_safety_critical boolean NOT NULL DEFAULT false,
  status           text    NOT NULL DEFAULT 'active',
  record_version   integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid    NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid    NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid    NULL,

  CONSTRAINT pk_certifications PRIMARY KEY (id),
  CONSTRAINT fk_certifications_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_certifications_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_certifications_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)),
  CONSTRAINT ck_certifications_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_certifications_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_certifications_authority_not_blank CHECK (authority IS NULL OR btrim(authority) <> ''),
  CONSTRAINT ck_certifications_validity CHECK (validity_months IS NULL OR validity_months > 0),
  CONSTRAINT ck_certifications_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE tech.certifications IS
  'Phase 1-9 certification-type catalog (P1-09-DB-012). Defines certification kinds (name, issuing authority, validity window, safety-critical flag). A person''s certificate is tech.technician_certifications. Dual-scope catalog.';
CREATE INDEX ix_certifications_tenant ON tech.certifications (tenant_id);
CREATE UNIQUE INDEX uq_certifications_platform_code ON tech.certifications (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_certifications_tenant_code ON tech.certifications (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_certifications_touch_metadata BEFORE UPDATE ON tech.certifications
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_certifications_immutable BEFORE UPDATE ON tech.certifications
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE tech.certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.certifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_certifications_visible ON tech.certifications FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_certifications_tenant ON tech.certifications FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_certifications_tenant ON tech.certifications FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.certifications TO app_runtime;
GRANT SELECT ON tech.certifications TO app_readonly;
