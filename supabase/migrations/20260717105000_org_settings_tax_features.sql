-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: versioned settings, tax foundation, tenant feature overrides,
--            and deterministic feature resolution
-- Tasks: P1-03-DB-012, P1-03-DB-014, P1-03-DB-015 (tenant overrides + resolution)
-- Owner module: org
--
-- Purpose
--   Company/branch configuration as VERSIONED APPEND-ONLY rows (a change is a
--   new version, never an overwrite), the jurisdiction-neutral tax foundation
--   (classes + effective-dated NUMERIC rates), tenant feature overrides, and
--   the resolution function that makes precedence deterministic:
--   override > plan entitlement > platform default.
--
-- Dependency
--   20260717103000 (companies/branches composites), 20260717102000 (flags,
--   plans, subscriptions, current_subscription_plan_id).
--
-- Rollback classification: ROLLBACK-SAFE while empty; roll-forward-only once
--   configuration rows exist (settings and tax history are evidence).
--
-- Security implications
--   * Settings rows are IMMUTABLE VERSIONS: runtime holds INSERT+SELECT only;
--     no UPDATE/DELETE grant or policy exists, and an immutability trigger
--     pins the identity columns even against admin mistakes. Prior values
--     remain readable forever — no destructive overwrite is possible.
--   * NO SECRETS IN SETTINGS: credentials, tokens, and keys are prohibited
--     (retention/sensitive-data standard); is_sensitive marks values whose
--     CONTENT is business-sensitive (classification: restricted) — it is not
--     an encryption mechanism and must never be treated as one. Phase 1-4+
--     owns masking/export controls; a settings catalogue with per-key rules
--     is documented future work (Phase 1-14) and is not pretended here.
--   * Tax rates are NUMERIC(9,6) fractions in [0,1]. Never float. ZERO
--     jurisdiction rules are seeded; OIR-04 remains OPEN.
--   * Overrides are platform-assigned in this phase (like subscriptions):
--     runtime reads its own, writes nothing. Override history is preserved
--     (no delete path; intervals close via effective_to).
--
-- JSONB justification (P1-03-DB-012)
--   setting_value is jsonb because settings are an open, growing catalogue of
--   typed values; one column per setting would migrate the schema for every
--   new key. Containment: value_type constrains the JSON type by trigger,
--   keys are format-checked, and per-key catalogue enforcement is documented
--   Phase 1-14 work. Values are read individually by (scope, key) — the
--   partial-index/current-version query path below serves it; no GIN index is
--   justified yet.
--
-- Objects created
--   Tables:    org.company_settings, org.branch_settings,
--              org.tax_classes, org.tax_rates, org.tenant_feature_overrides
--   Functions: org.validate_setting_value(), org.resolve_feature_enabled()
--   Triggers:  validate/immutable on both settings tables; touch/immutable on
--              tax tables; immutable on overrides
--   Policies:  sel/ins on settings; sel/ins/upd on tax; sel on overrides
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Setting-value validation (shared by both settings tables).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.validate_setting_value()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_json_type text;
BEGIN
  v_json_type := jsonb_typeof(NEW.setting_value);
  IF (NEW.value_type = 'string'  AND v_json_type IS DISTINCT FROM 'string')
  OR (NEW.value_type = 'number'  AND v_json_type IS DISTINCT FROM 'number')
  OR (NEW.value_type = 'boolean' AND v_json_type IS DISTINCT FROM 'boolean')
  OR (NEW.value_type = 'json'    AND v_json_type NOT IN ('object', 'array')) THEN
    RAISE EXCEPTION 'setting % declares value_type % but the value is JSON %',
      NEW.setting_key, NEW.value_type, v_json_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.validate_setting_value() IS
  'BEFORE INSERT trigger on settings tables: the JSON type of setting_value must match the declared value_type (string|number|boolean|json→object/array). The typed-validation containment for the open-schema settings model (P1-03-DB-012).';
REVOKE EXECUTE ON FUNCTION org.validate_setting_value() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. org.company_settings / org.branch_settings (P1-03-DB-012).
--    Versioned row model: rows are immutable; the current value of a key is
--    the row with the highest version for that scope+key.
-- ----------------------------------------------------------------------------
CREATE TABLE org.company_settings (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  setting_key    text        NOT NULL,
  setting_value  jsonb       NOT NULL,
  value_type     text        NOT NULL,
  is_sensitive   boolean     NOT NULL DEFAULT false,
  version        integer     NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,

  CONSTRAINT pk_company_settings PRIMARY KEY (id),
  CONSTRAINT fk_company_settings_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_company_settings_scope_key_version
    UNIQUE (tenant_id, company_id, setting_key, version),
  CONSTRAINT ck_company_settings_key_format CHECK (setting_key ~ '^[a-z][a-z0-9_.]{1,126}$'),
  CONSTRAINT ck_company_settings_value_type
    CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  CONSTRAINT ck_company_settings_version_positive CHECK (version >= 1)
);

COMMENT ON TABLE org.company_settings IS
  'Company configuration as versioned append-only rows (P1-03-DB-012): a change INSERTs version n+1; prior versions remain readable; no update path exists for any application role. Current value = highest version per (tenant, company, key); the unique constraint referees concurrent version allocation. NO SECRETS may be stored here (binding; see the retention/sensitive-data standard) — is_sensitive classifies content as restricted, it does not encrypt. Per-key catalogue enforcement is documented Phase 1-14 work.';

CREATE TRIGGER tg_company_settings_validate_value
  BEFORE INSERT ON org.company_settings
  FOR EACH ROW EXECUTE FUNCTION org.validate_setting_value();
CREATE TRIGGER tg_company_settings_immutable
  BEFORE UPDATE ON org.company_settings
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'setting_key', 'setting_value', 'value_type', 'version');

CREATE TABLE org.branch_settings (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  setting_key    text        NOT NULL,
  setting_value  jsonb       NOT NULL,
  value_type     text        NOT NULL,
  is_sensitive   boolean     NOT NULL DEFAULT false,
  version        integer     NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,

  CONSTRAINT pk_branch_settings PRIMARY KEY (id),
  CONSTRAINT fk_branch_settings_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_branch_settings_scope_key_version
    UNIQUE (tenant_id, company_id, branch_id, setting_key, version),
  CONSTRAINT ck_branch_settings_key_format CHECK (setting_key ~ '^[a-z][a-z0-9_.]{1,126}$'),
  CONSTRAINT ck_branch_settings_value_type
    CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  CONSTRAINT ck_branch_settings_version_positive CHECK (version >= 1)
);

COMMENT ON TABLE org.branch_settings IS
  'Branch configuration as versioned append-only rows (P1-03-DB-012). Same model, rules, and prohibitions as org.company_settings, scoped by the full branch composite.';

CREATE TRIGGER tg_branch_settings_validate_value
  BEFORE INSERT ON org.branch_settings
  FOR EACH ROW EXECUTE FUNCTION org.validate_setting_value();
CREATE TRIGGER tg_branch_settings_immutable
  BEFORE UPDATE ON org.branch_settings
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'setting_key', 'setting_value', 'value_type', 'version');

-- ----------------------------------------------------------------------------
-- 3. Tax foundation (P1-03-DB-014). NUMERIC only; zero seeded rules; OIR-04
--    remains OPEN; no assumption that companies share one tax model.
-- ----------------------------------------------------------------------------
CREATE TABLE org.tax_classes (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  tax_class_code text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_tax_classes PRIMARY KEY (id),
  CONSTRAINT uq_tax_classes_scope_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_tax_classes_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_tax_classes_code_format CHECK (tax_class_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_tax_classes_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_tax_classes_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE org.tax_classes IS
  'Company-scoped tax classes (P1-03-DB-014): each company defines its own — no shared tax model is assumed across companies or tenants, and NOTHING is seeded (OIR-04 open). Classification of the concept: restricted (tax configuration).';

CREATE UNIQUE INDEX uq_tax_classes_company_code_active
  ON org.tax_classes (tenant_id, company_id, tax_class_code)
  WHERE deleted_at IS NULL;

CREATE TRIGGER tg_tax_classes_touch_metadata
  BEFORE UPDATE ON org.tax_classes
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_tax_classes_immutable
  BEFORE UPDATE ON org.tax_classes
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'tax_class_code');

CREATE TABLE org.tax_rates (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  tax_class_id   uuid        NOT NULL,
  rate           numeric(9,6) NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  effective_from date        NOT NULL,
  effective_to   date        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_tax_rates PRIMARY KEY (id),
  CONSTRAINT fk_tax_rates_tax_class
    FOREIGN KEY (tenant_id, company_id, tax_class_id)
    REFERENCES org.tax_classes (tenant_id, company_id, id) ON DELETE RESTRICT,
  -- A decimal FRACTION: 0.16 means 16%. NUMERIC only — float money/rates are
  -- prohibited by the architecture standard.
  CONSTRAINT ck_tax_rates_range CHECK (rate >= 0 AND rate <= 1),
  CONSTRAINT ck_tax_rates_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_tax_rates_effective_interval
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- One active rate per class at any date.
  CONSTRAINT ex_tax_rates_no_active_overlap
    EXCLUDE USING gist (
      tenant_id WITH =,
      company_id WITH =,
      tax_class_id WITH =,
      daterange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (deleted_at IS NULL AND status = 'active')
);

COMMENT ON TABLE org.tax_rates IS
  'Effective-dated tax rates per class (P1-03-DB-014). rate is a NUMERIC(9,6) decimal fraction in [0,1] (0.160000 = 16%) — never float. Active rates for one class cannot overlap (EXCLUDE over daterange). ZERO rows are seeded: every rate is tenant configuration entered at onboarding or later; OIR-04 (jurisdiction policy) remains OPEN. Classification: restricted.';

CREATE INDEX ix_tax_rates_tenant_company_class
  ON org.tax_rates (tenant_id, company_id, tax_class_id);

CREATE TRIGGER tg_tax_rates_touch_metadata
  BEFORE UPDATE ON org.tax_rates
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_tax_rates_immutable
  BEFORE UPDATE ON org.tax_rates
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'tax_class_id');

-- ----------------------------------------------------------------------------
-- 4. org.tenant_feature_overrides (P1-03-DB-015) + deterministic resolution.
-- ----------------------------------------------------------------------------
CREATE TABLE org.tenant_feature_overrides (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  flag_code      text        NOT NULL,
  enabled        boolean     NOT NULL,
  reason         text        NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to   timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,

  CONSTRAINT pk_tenant_feature_overrides PRIMARY KEY (id),
  CONSTRAINT fk_tenant_feature_overrides_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_feature_overrides_flag
    FOREIGN KEY (flag_code) REFERENCES org.feature_flags (flag_code),
  CONSTRAINT ck_tenant_feature_overrides_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_tenant_feature_overrides_interval
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- At most one override per tenant+flag covers any instant: precedence stays
  -- deterministic. History is preserved by closing intervals, never rewriting.
  CONSTRAINT ex_tenant_feature_overrides_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =,
      flag_code WITH =,
      tstzrange(effective_from, effective_to, '[)') WITH &&
    )
);

COMMENT ON TABLE org.tenant_feature_overrides IS
  'Tenant-level feature overrides (P1-03-DB-015). Platform-assigned in this phase (application roles read their own, write nothing). Overlapping intervals per tenant+flag are rejected, so point-in-time resolution is deterministic; ended overrides remain as history. reason is mandatory. A tenant can never modify the platform definition itself — only this override row exists at tenant level.';

CREATE INDEX ix_tenant_feature_overrides_tenant_flag
  ON org.tenant_feature_overrides (tenant_id, flag_code);
-- FK-support for the platform-reference flag FK (documented non-tenant-leading
-- justification: reference FK path, not a tenant query path).
CREATE INDEX ix_tenant_feature_overrides_flag_code
  ON org.tenant_feature_overrides (flag_code);

CREATE TRIGGER tg_tenant_feature_overrides_immutable
  BEFORE UPDATE ON org.tenant_feature_overrides
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'flag_code', 'enabled', 'effective_from');

-- Precedence: tenant override > plan entitlement > platform default.
CREATE OR REPLACE FUNCTION org.resolve_feature_enabled(
  p_flag_code text,
  p_at        timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result  boolean;
  v_plan_id uuid;
BEGIN
  -- 1. Tenant override wins.
  SELECT o.enabled INTO v_result
  FROM org.tenant_feature_overrides o
  WHERE o.tenant_id = iam.current_tenant_id()
    AND o.flag_code = p_flag_code
    AND tstzrange(o.effective_from, o.effective_to, '[)') @> p_at;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- 2. Plan entitlement of the subscription active at p_at.
  v_plan_id := org.current_subscription_plan_id(p_at);
  IF v_plan_id IS NOT NULL THEN
    SELECT (p.entitlement_document ->> p_flag_code)::boolean INTO v_result
    FROM org.subscription_plans p
    WHERE p.id = v_plan_id
      AND p.entitlement_document ? p_flag_code;
    IF FOUND THEN
      RETURN v_result;
    END IF;
  END IF;

  -- 3. Platform default. Unknown flags are an error, never a silent false.
  SELECT f.default_enabled INTO v_result
  FROM org.feature_flags f
  WHERE f.flag_code = p_flag_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feature flag % is not registered', p_flag_code
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION org.resolve_feature_enabled(text, timestamptz) IS
  'Deterministic feature resolution (P1-03-DB-015): tenant override > plan entitlement > platform default, all evaluated at p_at under the caller''s own RLS (SECURITY INVOKER). Overlap EXCLUDEs on overrides and subscriptions make each step single-valued. Unknown flags raise no_data_found rather than silently returning false. No frontend toggle implementation exists.';

REVOKE EXECUTE ON FUNCTION org.resolve_feature_enabled(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.resolve_feature_enabled(text, timestamptz)
  TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security — enabled AND forced on all five.
-- ----------------------------------------------------------------------------
ALTER TABLE org.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.company_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE org.branch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.branch_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE org.tax_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.tax_classes FORCE ROW LEVEL SECURITY;
ALTER TABLE org.tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.tax_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE org.tenant_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.tenant_feature_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_company_settings_scope ON org.company_settings
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );
CREATE POLICY ins_company_settings_scope ON org.company_settings
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );

CREATE POLICY sel_branch_settings_scope ON org.branch_settings
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_branch_settings_scope ON org.branch_settings
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );

CREATE POLICY sel_tax_classes_scope ON org.tax_classes
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );
CREATE POLICY ins_tax_classes_scope ON org.tax_classes
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );
CREATE POLICY upd_tax_classes_scope ON org.tax_classes
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_tax_rates_scope ON org.tax_rates
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );
CREATE POLICY ins_tax_rates_scope ON org.tax_rates
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );
CREATE POLICY upd_tax_rates_scope ON org.tax_rates
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_tenant_feature_overrides_tenant ON org.tenant_feature_overrides
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 6. Grants. Settings: INSERT+SELECT (versioned append-only). Tax:
--    SELECT/INSERT/UPDATE (tenant-managed configuration; soft delete is an
--    UPDATE). Overrides: SELECT only (platform-assigned). DELETE nowhere.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON org.company_settings TO app_runtime;
GRANT SELECT ON org.company_settings TO app_readonly;
GRANT SELECT, INSERT ON org.branch_settings TO app_runtime;
GRANT SELECT ON org.branch_settings TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON org.tax_classes TO app_runtime;
GRANT SELECT ON org.tax_classes TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON org.tax_rates TO app_runtime;
GRANT SELECT ON org.tax_rates TO app_readonly;
GRANT SELECT ON org.tenant_feature_overrides TO app_runtime, app_readonly;
