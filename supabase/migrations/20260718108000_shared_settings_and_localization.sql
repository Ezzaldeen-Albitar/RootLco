-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: versioned shared settings and governed localization foundation
-- Tasks: P1-05-DB-014, P1-05-DB-015, P1-05-QA-006
-- Owner module: shared
--
-- Purpose
--   system_settings provides immutable, append-only platform defaults and
--   tenant overrides resolved by highest version. localization_keys defines the
--   empty platform catalogue, while localized_texts provides governed,
--   versioned draft/approved/retired content without seeding customer wording.
--
-- Dependencies
--   Phase 1-3 org.tenants, shared.languages, org.validate_setting_value(),
--   org.guard_immutable_columns(), shared.touch_row_metadata(), and Phase 1-4
--   iam.current_tenant_id().
--
-- Rollback classification: ROLLBACK-SAFE while all three tables are empty;
--   roll-forward-only once settings or localization content exist because prior
--   versions and lifecycle stamps are governed operational evidence.
--
-- Security implications
--   * All tables ENABLE and FORCE RLS. Runtime and readonly roles receive SELECT
--     only; no INSERT, UPDATE, or DELETE grant/policy exists.
--   * Settings are immutable versioned rows. A change INSERTs version n+1; even
--     record_version is immutable and no metadata-touch trigger is attached.
--   * Settings contain no secrets. is_sensitive classifies restricted content;
--     it does not encrypt setting_value.
--   * Localization is platform content. Approved wording is immutable and only
--     one approved row per key/locale may exist at a time.
--
-- Objects created
--   Tables:    shared.system_settings, shared.localization_keys,
--              shared.localized_texts
--   Functions: shared.resolve_setting(text),
--              shared.guard_localized_text_lifecycle(),
--              shared.missing_translations(text)
--   Triggers:  tg_system_settings_validate_value,
--              tg_system_settings_immutable,
--              tg_localization_keys_immutable,
--              tg_localization_keys_touch_metadata,
--              tg_localized_texts_guard_lifecycle,
--              tg_localized_texts_immutable,
--              tg_localized_texts_touch_metadata
--   Policies:  sel_system_settings_visible, sel_localization_keys_all,
--              sel_localized_texts_all
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.system_settings (P1-05-DB-014) — immutable versioned rows.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.system_settings (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  setting_key    text        NOT NULL,
  setting_value  jsonb       NOT NULL,
  value_type     text        NOT NULL,
  is_sensitive   boolean     NOT NULL DEFAULT false,
  version        integer     NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,

  CONSTRAINT pk_system_settings PRIMARY KEY (id),
  CONSTRAINT fk_system_settings_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT uq_system_settings_scope_key_version
    UNIQUE NULLS NOT DISTINCT (tenant_id, setting_key, version),
  CONSTRAINT ck_system_settings_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_system_settings_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_system_settings_key_format
    CHECK (setting_key ~ '^[a-z][a-z0-9_.]{1,126}$'),
  CONSTRAINT ck_system_settings_value_type
    CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  CONSTRAINT ck_system_settings_version_positive CHECK (version >= 1)
);

COMMENT ON TABLE shared.system_settings IS
  'Platform and tenant configuration as versioned append-only rows (P1-05-DB-014): a change INSERTs version n+1; prior versions remain readable; no update path exists for any application role. Current value = highest tenant version per key, falling back to the highest platform version; the UNIQUE NULLS NOT DISTINCT constraint referees concurrent version allocation including the NULL platform scope. tenant_id is nullable BY DESIGN for platform rows (NULLABLE_TENANT_EXCEPTIONS). NO SECRETS may be stored here — is_sensitive classifies content as restricted, it does not encrypt.';
COMMENT ON COLUMN shared.system_settings.effective_from IS
  'Informational version metadata matching the organization settings model; current resolution is determined by highest version, not wall-clock eligibility.';

-- The org validator is deliberately reused verbatim: it reads exactly
-- NEW.setting_value and NEW.value_type.
CREATE TRIGGER tg_system_settings_validate_value
  BEFORE INSERT ON shared.system_settings
  FOR EACH ROW EXECUTE FUNCTION org.validate_setting_value();
CREATE TRIGGER tg_system_settings_immutable
  BEFORE UPDATE ON shared.system_settings
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'id', 'scope', 'tenant_id', 'setting_key', 'setting_value', 'value_type',
    'is_sensitive', 'version', 'effective_from', 'record_version', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. shared.localization_keys (P1-05-DB-015) — empty platform catalogue.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.localization_keys (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  key_code       text        NOT NULL,
  context        text        NULL,
  description    text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_localization_keys PRIMARY KEY (id),
  CONSTRAINT uq_localization_keys_code UNIQUE (key_code),
  CONSTRAINT ck_localization_keys_code_format
    CHECK (key_code ~ '^[a-z][a-z0-9_.]{1,126}$'),
  CONSTRAINT ck_localization_keys_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_localization_keys_status CHECK (status IN ('active', 'deprecated'))
);

COMMENT ON TABLE shared.localization_keys IS
  'Platform localization-key catalogue (P1-05-DB-015; TENANT_COLUMN_EXCEPTIONS): no tenant_id exists because keys are shared product vocabulary. The catalogue starts empty and receives no fabricated customer-facing wording. Runtime SELECT-only.';

CREATE TRIGGER tg_localization_keys_immutable
  BEFORE UPDATE ON shared.localization_keys
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('key_code', 'created_at', 'created_by');
CREATE TRIGGER tg_localization_keys_touch_metadata
  BEFORE UPDATE ON shared.localization_keys
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- ----------------------------------------------------------------------------
-- 3. shared.localized_texts (P1-05-DB-015) — governed platform content.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.localized_texts (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  key_id         uuid        NOT NULL,
  locale_code    text        NOT NULL,
  version        integer     NOT NULL,
  text_value     text        NOT NULL,
  status         text        NOT NULL DEFAULT 'draft',
  approved_at    timestamptz NULL,
  approved_by    uuid        NULL,
  retired_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_localized_texts PRIMARY KEY (id),
  CONSTRAINT uq_localized_texts_key_locale_version UNIQUE (key_id, locale_code, version),
  CONSTRAINT fk_localized_texts_key
    FOREIGN KEY (key_id) REFERENCES shared.localization_keys (id) ON DELETE RESTRICT,
  CONSTRAINT fk_localized_texts_locale
    FOREIGN KEY (locale_code) REFERENCES shared.languages (locale_code) ON DELETE RESTRICT,
  CONSTRAINT ck_localized_texts_version_positive CHECK (version >= 1),
  CONSTRAINT ck_localized_texts_value_not_blank CHECK (btrim(text_value) <> ''),
  CONSTRAINT ck_localized_texts_status CHECK (status IN ('draft', 'approved', 'retired')),
  CONSTRAINT ck_localized_texts_approval_pairing CHECK (
    (status = 'approved' OR status = 'retired')
    = (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT ck_localized_texts_retirement_pairing CHECK (
    (status = 'retired') = (retired_at IS NOT NULL)
  )
);

COMMENT ON TABLE shared.localized_texts IS
  'Governed platform localization content (P1-05-DB-015; TENANT_COLUMN_EXCEPTIONS). Rows follow draft→approved→retired; approved content is immutable. Exactly one approved text per key/locale is permitted, so replacement requires retiring the current row before approving a newer version. No localized text is seeded; tests use ephemeral fixtures only. Runtime SELECT-only.';

-- One approved text per key/locale. Concurrent double approval loses with 23505.
CREATE UNIQUE INDEX uq_localized_texts_one_approved
  ON shared.localized_texts (key_id, locale_code)
  WHERE status = 'approved';

-- The key FK is covered by the leading key_id column of the non-partial UNIQUE
-- constraint. locale_code needs its own non-partial leading-column index.
CREATE INDEX ix_localized_texts_locale ON shared.localized_texts (locale_code);

-- ----------------------------------------------------------------------------
-- 4. Routines. Functions precede every trigger that invokes them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.resolve_setting(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := iam.current_tenant_id();
  v_value  jsonb;
BEGIN
  SELECT s.setting_value
    INTO v_value
  FROM shared.system_settings AS s
  WHERE s.setting_key = p_key
    AND (
      (v_tenant IS NOT NULL AND s.scope = 'tenant' AND s.tenant_id = v_tenant)
      OR s.scope = 'platform'
    )
  ORDER BY
    CASE
      WHEN v_tenant IS NOT NULL AND s.scope = 'tenant' AND s.tenant_id = v_tenant THEN 0
      ELSE 1
    END,
    s.version DESC
  LIMIT 1;

  RETURN v_value;
END;
$$;

COMMENT ON FUNCTION shared.resolve_setting(text) IS
  'Returns the highest-version setting for the caller tenant from iam.current_tenant_id(), falling back to the highest-version platform row. With no tenant context, only the platform value is eligible. Returns NULL when the key is absent.';

REVOKE EXECUTE ON FUNCTION shared.resolve_setting(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.guard_localized_text_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft'
       OR NEW.approved_at IS NOT NULL
       OR NEW.approved_by IS NOT NULL
       OR NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'localized text must start as an unstamped draft'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Once content leaves draft, its identity and wording are fixed.
  IF OLD.status <> 'draft' AND (
    NEW.key_id IS DISTINCT FROM OLD.key_id
    OR NEW.locale_code IS DISTINCT FROM OLD.locale_code
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.text_value IS DISTINCT FROM OLD.text_value
  ) THEN
    RAISE EXCEPTION 'approved or retired localized-text content is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
    RETURN NEW;
  ELSIF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'approving localized text requires approved_by'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_at := now();
    NEW.retired_at := NULL;
    RETURN NEW;
  ELSIF OLD.status = 'approved' AND NEW.status = 'retired' THEN
    NEW.approved_at := OLD.approved_at;
    NEW.approved_by := OLD.approved_by;
    NEW.retired_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid localized text transition: % to %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION shared.guard_localized_text_lifecycle() IS
  'Initial-state and one-way lifecycle guard for shared.localized_texts. INSERT must be an unstamped draft; draft→approved requires approved_by and server-stamps approved_at; approved→retired server-stamps retired_at; approved/retired identity and content are immutable.';

REVOKE EXECUTE ON FUNCTION shared.guard_localized_text_lifecycle() FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.missing_translations(p_locale text)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM shared.languages WHERE locale_code = p_locale
  ) THEN
    RAISE EXCEPTION 'unknown locale: %', p_locale
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  SELECT k.key_code
  FROM shared.localization_keys AS k
  WHERE k.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM shared.localized_texts AS t
      WHERE t.key_id = k.id
        AND t.locale_code = p_locale
        AND t.status = 'approved'
    )
  ORDER BY k.key_code;
END;
$$;

COMMENT ON FUNCTION shared.missing_translations(text) IS
  'Returns active localization key codes that have no approved text in the requested registered locale. Raises invalid_parameter_value when the locale is not in shared.languages.';

REVOKE EXECUTE ON FUNCTION shared.missing_translations(text) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 5. Localized-text triggers.
-- ----------------------------------------------------------------------------
CREATE TRIGGER tg_localized_texts_guard_lifecycle
  BEFORE INSERT OR UPDATE ON shared.localized_texts
  FOR EACH ROW EXECUTE FUNCTION shared.guard_localized_text_lifecycle();
CREATE TRIGGER tg_localized_texts_immutable
  BEFORE UPDATE ON shared.localized_texts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('created_at', 'created_by');
CREATE TRIGGER tg_localized_texts_touch_metadata
  BEFORE UPDATE ON shared.localized_texts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- ----------------------------------------------------------------------------
-- 6. Row-Level Security — enabled AND forced; SELECT-only visibility.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.system_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.localization_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.localization_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.localized_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.localized_texts FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_system_settings_visible ON shared.system_settings
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());

CREATE POLICY sel_localization_keys_all ON shared.localization_keys
  FOR SELECT TO app_runtime, app_readonly
  USING (true);

CREATE POLICY sel_localized_texts_all ON shared.localized_texts
  FOR SELECT TO app_runtime, app_readonly
  USING (true);

-- ----------------------------------------------------------------------------
-- 7. Grants — explicit, minimal. All writes remain backend/platform operations.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.system_settings TO app_runtime, app_readonly;
GRANT SELECT ON shared.localization_keys TO app_runtime, app_readonly;
GRANT SELECT ON shared.localized_texts TO app_runtime, app_readonly;

GRANT EXECUTE ON FUNCTION shared.resolve_setting(text) TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION shared.missing_translations(text) TO app_runtime, app_readonly;

-- Deliberately ABSENT: INSERT/UPDATE/DELETE for runtime/readonly on all three
-- tables, and EXECUTE on the trigger-only lifecycle guard.
