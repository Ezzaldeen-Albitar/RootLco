-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: roles, the platform permission catalog, and role→permission
--            mappings with explicit allow/deny semantics
-- Tasks: P1-04-DB-005, P1-04-DB-006, P1-04-DB-007 (BR-IAM-001 deny precedence)
-- Owner module: iam
--
-- Purpose
--   Authorization is by PERMISSION, never by role name. A tenant defines roles;
--   the platform owns the permission catalog; role_permissions maps a role to a
--   permission with an explicit effect (allow | deny). Deny precedence is a
--   PERSISTED state (an effect='deny' row), not an assumption — the resolution
--   helper (Increment H) lets any active deny override every allow.
--
-- Dependencies
--   0002 (schemas, roles, guards), org.tenants (tenant scope),
--   org.guard_immutable_columns, shared.touch_row_metadata.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   roles/permissions are populated (grants and audit reference them).
--   Recorded in docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * The permission catalog (iam.permissions) is PLATFORM-owned and read-only
--     to every application role: SELECT policy USING(true), SELECT grant, and NO
--     INSERT/UPDATE/DELETE grant or policy. A tenant runtime session cannot add,
--     alter, or remove a permission.
--   * iam.roles are tenant-scoped; is_system marks protected platform-seeded
--     roles and is immutable. Role code is immutable; roles soft-delete.
--   * role_permissions carries the allow/deny effect. A mapped permission cannot
--     be deleted (FK ON DELETE RESTRICT) — deletion would silently drop
--     authorization state. The (tenant, role, permission) mapping is unique and
--     immutable; only the effect may be re-decided.
--   * Runtime holds SELECT only on all three tables; authoring roles and
--     mappings is a platform / Phase-1-14 authorized-surface operation.
--
-- Objects created
--   Tables:    iam.permissions, iam.roles, iam.role_permissions
--   Triggers:  tg_permissions_touch_metadata, tg_permissions_immutable,
--              tg_roles_touch_metadata, tg_roles_immutable,
--              tg_role_permissions_touch_metadata, tg_role_permissions_immutable
--   Policies:  sel_permissions_all, sel_roles_tenant, sel_role_permissions_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.permissions — platform-owned catalog (P1-04-DB-006). Not tenant-scoped.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.permissions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  permission_code text       NOT NULL,
  domain         text        NOT NULL,
  description    text        NOT NULL,
  risk_level     text        NOT NULL DEFAULT 'low',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_permissions PRIMARY KEY (id),
  CONSTRAINT uq_permissions_code UNIQUE (permission_code),
  CONSTRAINT ck_permissions_code_format
    CHECK (permission_code ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  CONSTRAINT ck_permissions_domain_format CHECK (domain ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_permissions_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_permissions_risk CHECK (risk_level IN ('low', 'medium', 'high', 'critical'))
);

COMMENT ON TABLE iam.permissions IS
  'Platform-owned permission catalog (P1-04-DB-006). permission_code (e.g. iam.user.read) is the immutable unit of authorization — authorization is by permission, never by role name. Read-only to every application role; the catalog is additive and platform-managed.';
COMMENT ON COLUMN iam.permissions.risk_level IS 'low|medium|high|critical — drives which grants require approval evidence (Increment C/D).';

CREATE TRIGGER tg_permissions_touch_metadata
  BEFORE UPDATE ON iam.permissions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_permissions_immutable
  BEFORE UPDATE ON iam.permissions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('permission_code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. iam.roles — tenant-scoped (P1-04-DB-005).
-- ----------------------------------------------------------------------------
CREATE TABLE iam.roles (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  role_code      text        NOT NULL,
  name           text        NOT NULL,
  description    text        NULL,
  is_system      boolean     NOT NULL DEFAULT false,
  deleted_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_roles PRIMARY KEY (id),
  CONSTRAINT uq_roles_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_roles_code_format CHECK (role_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_roles_name_not_blank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE iam.roles IS
  'Tenant-scoped roles (P1-04-DB-005). A role is a NAMED BUNDLE of permissions; it confers nothing by its name. is_system marks protected platform-seeded roles (immutable flag). role_code is immutable and unique per tenant among non-deleted rows; roles soft-delete.';

CREATE UNIQUE INDEX uq_roles_tenant_code_active
  ON iam.roles (tenant_id, role_code) WHERE deleted_at IS NULL;

CREATE TRIGGER tg_roles_touch_metadata
  BEFORE UPDATE ON iam.roles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_roles_immutable
  BEFORE UPDATE ON iam.roles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'role_code', 'is_system', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 3. iam.role_permissions — allow/deny mapping (P1-04-DB-007, BR-IAM-001).
-- ----------------------------------------------------------------------------
CREATE TABLE iam.role_permissions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  role_id        uuid        NOT NULL,
  permission_id  uuid        NOT NULL,
  effect         text        NOT NULL DEFAULT 'allow',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_role_permissions PRIMARY KEY (id),
  CONSTRAINT uq_role_permissions_map UNIQUE (tenant_id, role_id, permission_id),
  CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (tenant_id, role_id) REFERENCES iam.roles (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES iam.permissions (id) ON DELETE RESTRICT,
  CONSTRAINT ck_role_permissions_effect CHECK (effect IN ('allow', 'deny'))
);

COMMENT ON TABLE iam.role_permissions IS
  'Maps a role to a catalog permission with an explicit effect allow|deny (P1-04-DB-007). Deny precedence (BR-IAM-001) is PERSISTED: a deny row for a permission overrides any allow the same principal holds (resolved by iam.has_permission, Increment H). One effect per (tenant, role, permission) — the mapping identity is immutable; the effect may be re-decided. A mapped permission cannot be deleted (ON DELETE RESTRICT).';
COMMENT ON COLUMN iam.role_permissions.effect IS 'allow | deny. A single deny beats every allow at resolution time — deny precedence is real persisted state, not a naming convention.';

CREATE INDEX ix_role_permissions_permission ON iam.role_permissions (permission_id);

CREATE TRIGGER tg_role_permissions_touch_metadata
  BEFORE UPDATE ON iam.role_permissions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_role_permissions_immutable
  BEFORE UPDATE ON iam.role_permissions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'role_id', 'permission_id', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 4. Row-Level Security — enabled AND forced; default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.permissions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.roles            FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.role_permissions FORCE  ROW LEVEL SECURITY;

-- The catalog is readable platform-wide (it contains no tenant data); it is
-- never writable by an application role.
CREATE POLICY sel_permissions_all ON iam.permissions
  FOR SELECT TO app_runtime, app_readonly USING (true);
CREATE POLICY sel_roles_tenant ON iam.roles
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_role_permissions_tenant ON iam.role_permissions
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_permissions_all ON iam.permissions IS
  'The permission catalog is platform reference data — readable by application roles, writable by none. No INSERT/UPDATE/DELETE policy or grant exists.';

-- ----------------------------------------------------------------------------
-- 5. Grants — explicit, minimal (SELECT only).
-- ----------------------------------------------------------------------------
GRANT SELECT ON iam.permissions      TO app_runtime, app_readonly;
GRANT SELECT ON iam.roles            TO app_runtime, app_readonly;
GRANT SELECT ON iam.role_permissions TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on all three tables.
