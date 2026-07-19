-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: vehicle reference catalogs (makes, models, trims, body types,
--            powertrain types) — dual-scope platform defaults + tenant extensions
-- Tasks: P1-07-DB-006
-- Owner module: veh
--
-- Purpose
--   The reference hierarchy the vehicle master classifies against:
--     trim -> model -> make, plus body_types and powertrain_types.
--   Each catalog is DUAL-SCOPE (mirrors shared.document_categories): a platform
--   row (scope='platform', tenant_id NULL) is a shared default readable by every
--   tenant; a tenant row (scope='tenant', tenant_id NOT NULL) is a tenant
--   extension. A tenant can create/modify ONLY its own extensions and can never
--   read, modify, claim, or reference another tenant's extension. Model year is a
--   vehicle attribute (an int on veh.vehicles), never a catalog table.
--
--   Per the standing no-fake-data policy this migration seeds ZERO rows — platform
--   defaults are provisioned admin-side at onboarding, not baked into a migration.
--
-- Dependencies
--   org.tenants; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns. The veh schema (reserved empty in
--   0002_base_schemas.sql).
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once catalog rows exist. Forward-only — no down script.
--
-- Security implications
--   * ENABLE + FORCE RLS; dual-scope SELECT (platform OR own tenant); INSERT/UPDATE
--     restricted to the caller's OWN tenant extensions (scope='tenant' AND
--     tenant_id = current) — the UPDATE policy carries an explicit USING so a
--     platform row can never enter a tenant's update set (no platform-row claim).
--   * scope, tenant_id, code and created_* are immutable once set.
--   * models.make_id / trims.model_id must reference a platform row or one owned by
--     the SAME tenant — enforced fail-closed by scope guards (a plain FK cannot
--     express "platform OR same-tenant"; an RLS-hidden cross-tenant parent is
--     NOT FOUND and rejected).
--   * Tenant-override precedence: a tenant extension MAY reuse a platform code
--     within its own scope (separate partial-unique namespaces); resolution is
--     tenant-first then platform. This is an intentional override, not corruption
--     — a tenant still cannot alter the platform row itself.
--
-- Objects created
--   Tables:    veh.makes, veh.models, veh.trims, veh.body_types, veh.powertrain_types
--   Functions: veh.guard_model_make_scope(), veh.guard_trim_model_scope()
--   Triggers:  tg_<catalog>_touch_metadata, tg_<catalog>_immutable (x5),
--              tg_models_make_scope, tg_trims_model_scope
--   Policies:  sel_/ins_/upd_<catalog>_* (x5 each)
--   Indexes:   ix_<catalog>_tenant (FK cover x5), ix_models_make, ix_trims_model,
--              uq_<catalog>_platform_code / _tenant_code partial uniques
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. veh.makes
-- ----------------------------------------------------------------------------
CREATE TABLE veh.makes (
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

  CONSTRAINT pk_makes PRIMARY KEY (id),
  CONSTRAINT fk_makes_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_makes_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_makes_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_makes_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_makes_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_makes_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE veh.makes IS
  'Phase 1-7 vehicle make catalog (P1-07-DB-006). Dual-scope: platform default (scope=platform, tenant_id NULL) or tenant extension. Seeded with zero rows (no-fake-data).';

CREATE INDEX ix_makes_tenant ON veh.makes (tenant_id);
CREATE UNIQUE INDEX uq_makes_platform_code
  ON veh.makes (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_makes_tenant_code
  ON veh.makes (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_makes_touch_metadata
  BEFORE UPDATE ON veh.makes
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_makes_immutable
  BEFORE UPDATE ON veh.makes
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. veh.body_types
-- ----------------------------------------------------------------------------
CREATE TABLE veh.body_types (
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

  CONSTRAINT pk_body_types PRIMARY KEY (id),
  CONSTRAINT fk_body_types_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_body_types_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_body_types_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_body_types_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_body_types_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_body_types_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE veh.body_types IS
  'Phase 1-7 vehicle body-type catalog (P1-07-DB-006). Dual-scope; zero seed rows.';

CREATE INDEX ix_body_types_tenant ON veh.body_types (tenant_id);
CREATE UNIQUE INDEX uq_body_types_platform_code
  ON veh.body_types (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_body_types_tenant_code
  ON veh.body_types (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_body_types_touch_metadata
  BEFORE UPDATE ON veh.body_types
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_body_types_immutable
  BEFORE UPDATE ON veh.body_types
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 3. veh.powertrain_types (category drives the EV-profile invariant)
-- ----------------------------------------------------------------------------
CREATE TABLE veh.powertrain_types (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  category       text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_powertrain_types PRIMARY KEY (id),
  CONSTRAINT fk_powertrain_types_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_powertrain_types_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_powertrain_types_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_powertrain_types_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_powertrain_types_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_powertrain_types_category
    CHECK (category IN ('ice', 'ev', 'hybrid', 'phev', 'other')),
  CONSTRAINT ck_powertrain_types_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE veh.powertrain_types IS
  'Phase 1-7 powertrain-type catalog (P1-07-DB-006). category (ice/ev/hybrid/phev/other) is descriptive; the authoritative EV driver is veh.vehicles.powertrain_category. Dual-scope; zero seed rows.';

CREATE INDEX ix_powertrain_types_tenant ON veh.powertrain_types (tenant_id);
CREATE UNIQUE INDEX uq_powertrain_types_platform_code
  ON veh.powertrain_types (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_powertrain_types_tenant_code
  ON veh.powertrain_types (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_powertrain_types_touch_metadata
  BEFORE UPDATE ON veh.powertrain_types
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_powertrain_types_immutable
  BEFORE UPDATE ON veh.powertrain_types
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 4. veh.models (child of make)
-- ----------------------------------------------------------------------------
CREATE TABLE veh.models (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope            text        NOT NULL,
  tenant_id        uuid        NULL,
  make_id          uuid        NOT NULL,
  code             text        NOT NULL,
  name             text        NOT NULL,
  first_model_year integer     NULL,
  last_model_year  integer     NULL,
  status           text        NOT NULL DEFAULT 'active',
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid        NULL,

  CONSTRAINT pk_models PRIMARY KEY (id),
  CONSTRAINT fk_models_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_models_make
    FOREIGN KEY (make_id) REFERENCES veh.makes (id) ON DELETE RESTRICT,
  CONSTRAINT ck_models_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_models_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_models_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_models_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_models_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_models_year_range CHECK (
    (first_model_year IS NULL OR (first_model_year BETWEEN 1900 AND 2100))
    AND (last_model_year IS NULL OR (last_model_year BETWEEN 1900 AND 2100))
    AND (first_model_year IS NULL OR last_model_year IS NULL OR last_model_year >= first_model_year)
  )
);
COMMENT ON TABLE veh.models IS
  'Phase 1-7 vehicle model catalog (P1-07-DB-006), child of veh.makes. model_year is a vehicle attribute, not a catalog. Dual-scope; zero seed rows.';

CREATE INDEX ix_models_tenant ON veh.models (tenant_id);
CREATE INDEX ix_models_make ON veh.models (make_id);
-- Code unique per (make, scope): different makes may reuse a model code.
CREATE UNIQUE INDEX uq_models_platform_code
  ON veh.models (make_id, code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_models_tenant_code
  ON veh.models (tenant_id, make_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_models_touch_metadata
  BEFORE UPDATE ON veh.models
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_models_immutable
  BEFORE UPDATE ON veh.models
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'make_id', 'code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 5. veh.trims (child of model)
-- ----------------------------------------------------------------------------
CREATE TABLE veh.trims (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  model_id       uuid        NOT NULL,
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

  CONSTRAINT pk_trims PRIMARY KEY (id),
  CONSTRAINT fk_trims_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_trims_model
    FOREIGN KEY (model_id) REFERENCES veh.models (id) ON DELETE RESTRICT,
  CONSTRAINT ck_trims_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_trims_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_trims_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_trims_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_trims_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE veh.trims IS
  'Phase 1-7 vehicle trim catalog (P1-07-DB-006), child of veh.models. Dual-scope; zero seed rows.';

CREATE INDEX ix_trims_tenant ON veh.trims (tenant_id);
CREATE INDEX ix_trims_model ON veh.trims (model_id);
CREATE UNIQUE INDEX uq_trims_platform_code
  ON veh.trims (model_id, code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_trims_tenant_code
  ON veh.trims (tenant_id, model_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_trims_touch_metadata
  BEFORE UPDATE ON veh.trims
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_trims_immutable
  BEFORE UPDATE ON veh.trims
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'model_id', 'code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 6. Hierarchy scope guards (fail-closed under RLS). A model's make and a trim's
--    model must be a platform row or one owned by the SAME tenant. The parent FK
--    guarantees existence (bypassing RLS); these guards add the scope check under
--    the caller's RLS, so an RLS-hidden cross-tenant parent is NOT FOUND -> reject.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_model_make_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_scope     text;
  v_make_tenant uuid;
BEGIN
  SELECT scope, tenant_id INTO v_scope, v_make_tenant
  FROM veh.makes WHERE id = NEW.make_id;

  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'veh make % is not visible to this tenant', NEW.make_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_scope = 'tenant' AND v_make_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'veh make % belongs to another tenant', NEW.make_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_model_make_scope() IS
  'BEFORE INSERT/UPDATE guard on veh.models: make_id must be a platform make or one owned by the model''s tenant. Fail-closed under RLS.';
REVOKE EXECUTE ON FUNCTION veh.guard_model_make_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION veh.guard_trim_model_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_scope      text;
  v_model_tenant uuid;
BEGIN
  SELECT scope, tenant_id INTO v_scope, v_model_tenant
  FROM veh.models WHERE id = NEW.model_id;

  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'veh model % is not visible to this tenant', NEW.model_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_scope = 'tenant' AND v_model_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'veh model % belongs to another tenant', NEW.model_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_trim_model_scope() IS
  'BEFORE INSERT/UPDATE guard on veh.trims: model_id must be a platform model or one owned by the trim''s tenant. Fail-closed under RLS.';
REVOKE EXECUTE ON FUNCTION veh.guard_trim_model_scope() FROM PUBLIC;

CREATE TRIGGER tg_models_make_scope
  BEFORE INSERT OR UPDATE OF make_id, tenant_id, scope ON veh.models
  FOR EACH ROW EXECUTE FUNCTION veh.guard_model_make_scope();
CREATE TRIGGER tg_trims_model_scope
  BEFORE INSERT OR UPDATE OF model_id, tenant_id, scope ON veh.trims
  FOR EACH ROW EXECUTE FUNCTION veh.guard_trim_model_scope();

-- ----------------------------------------------------------------------------
-- 7. Row-Level Security — ENABLE + FORCE; dual-scope read, own-tenant write.
-- ----------------------------------------------------------------------------
ALTER TABLE veh.makes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.makes             FORCE  ROW LEVEL SECURITY;
ALTER TABLE veh.body_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.body_types        FORCE  ROW LEVEL SECURITY;
ALTER TABLE veh.powertrain_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.powertrain_types  FORCE  ROW LEVEL SECURITY;
ALTER TABLE veh.models            ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.models            FORCE  ROW LEVEL SECURITY;
ALTER TABLE veh.trims             ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.trims             FORCE  ROW LEVEL SECURITY;

-- makes
CREATE POLICY sel_makes_visible ON veh.makes
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_makes_tenant ON veh.makes
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_makes_tenant ON veh.makes
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.makes TO app_runtime;
GRANT SELECT ON veh.makes TO app_readonly;

-- body_types
CREATE POLICY sel_body_types_visible ON veh.body_types
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_body_types_tenant ON veh.body_types
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_body_types_tenant ON veh.body_types
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.body_types TO app_runtime;
GRANT SELECT ON veh.body_types TO app_readonly;

-- powertrain_types
CREATE POLICY sel_powertrain_types_visible ON veh.powertrain_types
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_powertrain_types_tenant ON veh.powertrain_types
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_powertrain_types_tenant ON veh.powertrain_types
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.powertrain_types TO app_runtime;
GRANT SELECT ON veh.powertrain_types TO app_readonly;

-- models
CREATE POLICY sel_models_visible ON veh.models
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_models_tenant ON veh.models
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_models_tenant ON veh.models
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.models TO app_runtime;
GRANT SELECT ON veh.models TO app_readonly;

-- trims
CREATE POLICY sel_trims_visible ON veh.trims
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_trims_tenant ON veh.trims
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_trims_tenant ON veh.trims
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.trims TO app_runtime;
GRANT SELECT ON veh.trims TO app_readonly;
