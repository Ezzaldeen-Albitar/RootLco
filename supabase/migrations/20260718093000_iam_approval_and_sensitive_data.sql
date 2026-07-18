-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: approval limits and sensitive-data permissions
-- Tasks: P1-04-DB-010, P1-04-DB-011
-- Owner module: iam
--
-- Purpose
--   Two effective-dated authorization refinements: monetary approval ceilings
--   (per role or user, per company) and explicit permission to view / export /
--   mask-override data of a given classification (per role). Both use NUMERIC
--   (never float), non-overlapping intervals, and immutable identity so a
--   change is a NEW effective-dated row, not an in-place edit.
--
-- Dependencies
--   Increment A (user_accounts), B (roles), Phase 1-3 org.legal_companies and
--   shared.currencies, 0002 guards.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   populated (limits/permissions are authorization evidence). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * Amounts are NUMERIC(18,4) — no FLOAT/DOUBLE anywhere.
--   * An approval limit has EXACTLY ONE subject (role XOR user), enforced by
--     num_nonnulls(role_id, user_id) = 1, with composite FKs carrying the
--     tenant. Intervals per (company, subject, limit_type) cannot overlap, so
--     a point-in-time lookup resolves to at most one row.
--   * Sensitive-data access is by explicit (classification, kind) permission on
--     a role — never by role name. view / export / mask_override are distinct
--     kinds: a view permission does not confer export.
--   * Runtime holds SELECT only; authoring limits/permissions is a platform /
--     Phase-1-14 operation. History is preserved (immutable identity + new
--     effective-dated rows).
--
-- Objects created
--   Tables:    iam.approval_limits, iam.sensitive_data_permissions
--   Triggers:  tg_approval_limits_touch_metadata, tg_approval_limits_immutable,
--              tg_sensitive_data_permissions_touch_metadata,
--              tg_sensitive_data_permissions_immutable
--   Policies:  sel_approval_limits_tenant, sel_sensitive_data_permissions_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.approval_limits (P1-04-DB-010)
-- ----------------------------------------------------------------------------
CREATE TABLE iam.approval_limits (
  id             uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL,
  company_id     uuid          NOT NULL,
  role_id        uuid          NULL,
  user_id        uuid          NULL,
  limit_type     text          NOT NULL,
  amount         numeric(18, 4) NOT NULL,
  currency_code  text          NOT NULL,
  effective_from date          NOT NULL,
  effective_to   date          NULL,
  record_version integer       NOT NULL DEFAULT 1,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          NOT NULL,
  updated_at     timestamptz   NULL,
  updated_by     uuid          NULL,

  CONSTRAINT pk_approval_limits PRIMARY KEY (id),
  CONSTRAINT fk_approval_limits_company
    FOREIGN KEY (tenant_id, company_id) REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_limits_role
    FOREIGN KEY (tenant_id, role_id) REFERENCES iam.roles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_limits_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_limits_currency
    FOREIGN KEY (currency_code) REFERENCES shared.currencies (code),
  CONSTRAINT ck_approval_limits_one_subject CHECK (num_nonnulls(role_id, user_id) = 1),
  CONSTRAINT ck_approval_limits_amount CHECK (amount >= 0),
  CONSTRAINT ck_approval_limits_type_format CHECK (limit_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_approval_limits_dates CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- No overlapping windows for the same role subject / user subject.
  CONSTRAINT ex_approval_limits_role_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =, company_id WITH =, role_id WITH =, limit_type WITH =,
      daterange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (role_id IS NOT NULL),
  CONSTRAINT ex_approval_limits_user_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =, company_id WITH =, user_id WITH =, limit_type WITH =,
      daterange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (user_id IS NOT NULL)
);

COMMENT ON TABLE iam.approval_limits IS
  'Effective-dated monetary approval ceilings (P1-04-DB-010). Exactly one subject (role XOR user). amount is NUMERIC(18,4) — never float. Non-overlapping intervals per (company, subject, limit_type) make point-in-time resolution single-valued. Identity and amount are immutable; a change is a new effective-dated row.';

CREATE INDEX ix_approval_limits_company ON iam.approval_limits (tenant_id, company_id);
CREATE INDEX ix_approval_limits_role ON iam.approval_limits (tenant_id, role_id);
CREATE INDEX ix_approval_limits_user ON iam.approval_limits (tenant_id, user_id);
CREATE INDEX ix_approval_limits_currency ON iam.approval_limits (currency_code);

CREATE TRIGGER tg_approval_limits_touch_metadata
  BEFORE UPDATE ON iam.approval_limits
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_approval_limits_immutable
  BEFORE UPDATE ON iam.approval_limits
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'role_id', 'user_id', 'limit_type', 'amount',
    'currency_code', 'effective_from', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. iam.sensitive_data_permissions (P1-04-DB-011)
-- ----------------------------------------------------------------------------
CREATE TABLE iam.sensitive_data_permissions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  role_id        uuid        NOT NULL,
  classification text        NOT NULL,
  permission_kind text       NOT NULL,
  effective_from date        NOT NULL,
  effective_to   date        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_sensitive_data_permissions PRIMARY KEY (id),
  CONSTRAINT fk_sensitive_data_permissions_role
    FOREIGN KEY (tenant_id, role_id) REFERENCES iam.roles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_sensitive_data_permissions_classification
    CHECK (classification IN ('public', 'internal', 'restricted', 'secret')),
  CONSTRAINT ck_sensitive_data_permissions_kind
    CHECK (permission_kind IN ('view', 'export', 'mask_override')),
  CONSTRAINT ck_sensitive_data_permissions_dates
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ex_sensitive_data_permissions_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =, role_id WITH =, classification WITH =, permission_kind WITH =,
      daterange(effective_from, effective_to, '[)') WITH &&
    )
);

COMMENT ON TABLE iam.sensitive_data_permissions IS
  'Explicit role permission to access data of a classification (P1-04-DB-011). permission_kind view|export|mask_override are DISTINCT — a view permission does not confer export. classification uses the approved vocabulary. Effective-dated, non-overlapping per (role, classification, kind); identity immutable so history is preserved. Access is by permission, never by role name.';

CREATE INDEX ix_sensitive_data_permissions_role ON iam.sensitive_data_permissions (tenant_id, role_id);

CREATE TRIGGER tg_sensitive_data_permissions_touch_metadata
  BEFORE UPDATE ON iam.sensitive_data_permissions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_sensitive_data_permissions_immutable
  BEFORE UPDATE ON iam.sensitive_data_permissions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'role_id', 'classification', 'permission_kind', 'effective_from',
    'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 3. Row-Level Security — enabled AND forced; default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.approval_limits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.approval_limits             FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.sensitive_data_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.sensitive_data_permissions  FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_approval_limits_tenant ON iam.approval_limits
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_sensitive_data_permissions_tenant ON iam.sensitive_data_permissions
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 4. Grants — explicit, minimal (SELECT only).
-- ----------------------------------------------------------------------------
GRANT SELECT ON iam.approval_limits            TO app_runtime, app_readonly;
GRANT SELECT ON iam.sensitive_data_permissions TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
