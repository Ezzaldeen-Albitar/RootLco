-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: governed message templates and version lifecycle foundation
-- Tasks: P1-05-DB-007, P1-05-DB-008
-- Owner module: shared
--
-- Purpose
--   message_templates is the dual-scope identity and delivery envelope for a
--   platform-default or tenant-override message template. template_versions
--   stores governed draft content and its one-way approval lifecycle. An active
--   version must structurally belong to its template and must be approved; no
--   customer-facing wording is seeded by this migration.
--
-- Dependencies
--   Phase 1-3 org.tenants and shared.languages, Phase 1-4 iam.user_accounts,
--   0002 iam context readers and shared.touch_row_metadata, and
--   org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only);
--   roll-forward-only once templates/versions exist because approved content
--   and active-version references are governed records. Recorded in
--   docs/database/phase-1-5-migration-classification.md.
--
-- Security implications
--   * Both tables use ENABLE + FORCE RLS. Platform templates/versions are
--     readable by every tenant; tenant overrides are readable only by their
--     owning tenant.
--   * Runtime and readonly roles hold SELECT only. Creating, approving,
--     activating, retiring, or deleting template content is a platform/backend
--     operation; no application-role write grant or policy exists.
--   * A version's nullable tenant_id must mirror its template exactly. Tenant
--     approvals are attributed through a composite tenant/user FK.
--   * Activation locks the version row first and accepts approved versions
--     only. Retirement takes the same row lock and is rejected while active,
--     serializing activation and retirement without a race window.
--   * Approved/retired content is immutable; initial non-draft INSERTs and
--     forged lifecycle timestamps are rejected.
--
-- Objects created
--   Tables:    shared.message_templates, shared.template_versions
--   Functions: shared.guard_template_active_version(),
--              shared.guard_template_version_scope(),
--              shared.guard_template_version_lifecycle()
--   Triggers:  tg_message_templates_active_version,
--              tg_message_templates_immutable,
--              tg_message_templates_touch_metadata,
--              tg_template_versions_guard_lifecycle,
--              tg_template_versions_guard_scope,
--              tg_template_versions_immutable,
--              tg_template_versions_touch_metadata
--   Policies:  sel_message_templates_visible, sel_template_versions_visible
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.message_templates (P1-05-DB-007) — dual-scope identity.
--    The active-version FK is added after template_versions exists.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.message_templates (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope             text        NOT NULL,
  tenant_id         uuid        NULL,
  template_code     text        NOT NULL,
  name              text        NOT NULL,
  channel           text        NOT NULL,
  purpose           text        NOT NULL,
  locale_code       text        NOT NULL,
  description       text        NULL,
  active_version_id uuid        NULL,
  status            text        NOT NULL DEFAULT 'active',
  deleted_at        timestamptz NULL,
  record_version    integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid        NULL,

  CONSTRAINT pk_message_templates PRIMARY KEY (id),
  CONSTRAINT fk_message_templates_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_message_templates_locale
    FOREIGN KEY (locale_code) REFERENCES shared.languages (locale_code) ON DELETE RESTRICT,
  CONSTRAINT ck_message_templates_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_message_templates_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_message_templates_code_format
    CHECK (template_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_message_templates_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_message_templates_channel
    CHECK (channel IN ('email', 'in_app')),
  CONSTRAINT ck_message_templates_purpose
    CHECK (purpose IN ('transactional', 'marketing', 'system')),
  CONSTRAINT ck_message_templates_description_not_blank
    CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_message_templates_status CHECK (status IN ('active', 'disabled'))
);

COMMENT ON TABLE shared.message_templates IS
  'Dual-scope governed message-template identity (P1-05-DB-007). A platform row (tenant_id NULL) is a shared default; a tenant row is an override. active_version_id must identify an approved version belonging to this exact template. No customer-facing wording is seeded. Runtime SELECT-only.';
COMMENT ON COLUMN shared.message_templates.active_version_id IS
  'Currently active approved version. The composite FK guarantees structural ownership by this template; the activation guard locks and verifies approved status.';

CREATE UNIQUE INDEX uq_message_templates_platform_identity
  ON shared.message_templates (template_code, channel, locale_code)
  WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_message_templates_tenant_identity
  ON shared.message_templates (tenant_id, template_code, channel, locale_code)
  WHERE scope = 'tenant' AND deleted_at IS NULL;

-- Non-partial FK/RLS support. The active-version composite FK is covered by
-- (active_version_id, id): the FK-index guard compares the leading-column set.
CREATE INDEX ix_message_templates_active_version
  ON shared.message_templates (active_version_id, id);
CREATE INDEX ix_message_templates_locale ON shared.message_templates (locale_code);
CREATE INDEX ix_message_templates_tenant_status
  ON shared.message_templates (tenant_id, status);

-- ----------------------------------------------------------------------------
-- 2. shared.template_versions (P1-05-DB-008) — governed content lifecycle.
--    tenant_id is nullable only because it mirrors a platform template's NULL.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.template_versions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NULL,
  template_id    uuid        NOT NULL,
  version_number integer     NOT NULL,
  subject        text        NULL,
  body           text        NOT NULL,
  content_hash   bytea       NOT NULL,
  status         text        NOT NULL DEFAULT 'draft',
  approved_at    timestamptz NULL,
  approved_by    uuid        NULL,
  retired_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_template_versions PRIMARY KEY (id),
  CONSTRAINT uq_template_versions_template_id UNIQUE (template_id, id),
  CONSTRAINT uq_template_versions_number UNIQUE (template_id, version_number),
  CONSTRAINT fk_template_versions_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_template_versions_template
    FOREIGN KEY (template_id) REFERENCES shared.message_templates (id) ON DELETE RESTRICT,
  CONSTRAINT fk_template_versions_approved_by
    FOREIGN KEY (tenant_id, approved_by)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_template_versions_number_positive CHECK (version_number >= 1),
  CONSTRAINT ck_template_versions_subject_not_blank
    CHECK (subject IS NULL OR btrim(subject) <> ''),
  CONSTRAINT ck_template_versions_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT ck_template_versions_hash_length CHECK (octet_length(content_hash) = 32),
  CONSTRAINT ck_template_versions_status
    CHECK (status IN ('draft', 'approved', 'retired')),
  CONSTRAINT ck_template_versions_approval_pairing CHECK (
    (status = 'approved' OR status = 'retired')
    = (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT ck_template_versions_retirement_pairing CHECK (
    (status = 'retired') = (retired_at IS NOT NULL)
  )
);

COMMENT ON TABLE shared.template_versions IS
  'Governed message-template content versions (P1-05-DB-008). tenant_id mirrors the parent template, including NULL for platform templates. Rows start draft, may transition draft→approved→retired, and approved content is immutable. Retirement is forbidden while a template references the version as active. Runtime SELECT-only.';
COMMENT ON COLUMN shared.template_versions.content_hash IS
  'SHA-256 of the governed subject/body content, stored as exactly 32 bytes for integrity comparison.';

CREATE INDEX ix_template_versions_approved_by
  ON shared.template_versions (tenant_id, approved_by);
CREATE INDEX ix_template_versions_tenant_status
  ON shared.template_versions (tenant_id, status);

-- The structural ownership FK closes the cross-template activation gap.
ALTER TABLE shared.message_templates
  ADD CONSTRAINT fk_message_templates_active_version
  FOREIGN KEY (id, active_version_id)
  REFERENCES shared.template_versions (template_id, id)
  ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 3. Guard functions. Functions precede every trigger that invokes them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_template_active_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.active_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'message template must be inserted without an active version'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.active_version_id IS NOT NULL THEN
    -- Global lock order for activation/retirement: version row first.
    SELECT status INTO v_status
    FROM shared.template_versions
    WHERE id = NEW.active_version_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'template version % does not exist', NEW.active_version_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_status <> 'approved' THEN
      RAISE EXCEPTION 'template version % is not approved', NEW.active_version_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_template_active_version() IS
  'BEFORE INSERT/UPDATE guard for shared.message_templates. INSERT requires active_version_id NULL. UPDATE locks the selected version row first and permits only approved versions; the composite FK then proves the version belongs to this template.';

REVOKE EXECUTE ON FUNCTION shared.guard_template_active_version() FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.guard_template_version_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_template_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_template_tenant
  FROM shared.message_templates
  WHERE id = NEW.template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message template % does not exist', NEW.template_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM v_template_tenant THEN
    RAISE EXCEPTION 'template version tenant scope must mirror template %', NEW.template_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_template_version_scope() IS
  'BEFORE INSERT/UPDATE guard for shared.template_versions: tenant_id must be IS NOT DISTINCT FROM the parent template tenant_id, including NULL for platform templates.';

REVOKE EXECUTE ON FUNCTION shared.guard_template_version_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.guard_template_version_lifecycle()
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
      RAISE EXCEPTION 'template version must start as an unstamped draft'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Once a row is no longer draft its identity and governed content are fixed.
  IF OLD.status <> 'draft' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
  ) THEN
    RAISE EXCEPTION 'approved or retired template-version content is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
    RETURN NEW;
  ELSIF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'approving a template version requires approved_by'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_at := now();
    NEW.retired_at := NULL;
    RETURN NEW;
  ELSIF OLD.status = 'approved' AND NEW.status = 'retired' THEN
    IF EXISTS (
      SELECT 1
      FROM shared.message_templates
      WHERE active_version_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'active template version % cannot be retired', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_at := OLD.approved_at;
    NEW.approved_by := OLD.approved_by;
    NEW.retired_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid template version transition: % to %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION shared.guard_template_version_lifecycle() IS
  'Initial-state and one-way lifecycle guard for shared.template_versions. INSERT must be an unstamped draft; draft→approved requires approved_by and server-stamps approved_at; approved→retired is blocked while active and server-stamps retired_at; approved/retired content is immutable.';

REVOKE EXECUTE ON FUNCTION shared.guard_template_version_lifecycle() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. Triggers — all functions above are already defined.
-- ----------------------------------------------------------------------------
CREATE TRIGGER tg_message_templates_active_version
  BEFORE INSERT OR UPDATE ON shared.message_templates
  FOR EACH ROW EXECUTE FUNCTION shared.guard_template_active_version();
CREATE TRIGGER tg_message_templates_immutable
  BEFORE UPDATE ON shared.message_templates
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'template_code', 'channel', 'locale_code',
    'created_at', 'created_by');
CREATE TRIGGER tg_message_templates_touch_metadata
  BEFORE UPDATE ON shared.message_templates
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_template_versions_guard_lifecycle
  BEFORE INSERT OR UPDATE ON shared.template_versions
  FOR EACH ROW EXECUTE FUNCTION shared.guard_template_version_lifecycle();
CREATE TRIGGER tg_template_versions_guard_scope
  BEFORE INSERT OR UPDATE OF tenant_id, template_id ON shared.template_versions
  FOR EACH ROW EXECUTE FUNCTION shared.guard_template_version_scope();
CREATE TRIGGER tg_template_versions_immutable
  BEFORE UPDATE ON shared.template_versions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('created_at', 'created_by');
CREATE TRIGGER tg_template_versions_touch_metadata
  BEFORE UPDATE ON shared.template_versions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security — enabled AND forced; SELECT-only visibility.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.message_templates FORCE  ROW LEVEL SECURITY;
ALTER TABLE shared.template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.template_versions FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_message_templates_visible ON shared.message_templates
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());

CREATE POLICY sel_template_versions_visible ON shared.template_versions
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id IS NULL OR tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 6. Grants — explicit, minimal. All writes remain backend/platform operations.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.message_templates TO app_runtime, app_readonly;
GRANT SELECT ON shared.template_versions TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
