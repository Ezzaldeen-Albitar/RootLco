-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: role grants and their organizational scopes
-- Tasks: P1-04-DB-008, P1-04-DB-009 (§19.D deferred-scope integrity)
-- Owner module: iam
--
-- Purpose
--   Assigns a role to a user for a validity interval, with revocation and
--   optional approval evidence, and (for scoped grants) restricts the grant to
--   specific companies / branches / departments. A scope-limited ACTIVE grant
--   must carry at least one scope — enforced by a DEFERRABLE constraint trigger
--   so the grant and its scopes can be written in one transaction.
--
-- Dependencies
--   Increment A (iam.user_accounts), Increment B (iam.roles), Phase 1-3 org
--   composite keys (legal_companies/branches/departments), 0002 guards.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   grants exist (audit and permission resolution depend on them). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * Composite FKs carry the tenant through every reference, so a cross-tenant
--     user/role/company/branch/department is an FK violation, not a filtered
--     row. Branch and department scopes carry their parent chain, so a branch
--     that does not belong to the scoped company (cross-company) is rejected
--     structurally by the composite FK to org.branches / org.departments.
--   * scope_mode is immutable: a grant cannot be widened from scoped to
--     unrestricted after creation. The (user, role, granted_by, valid_from,
--     approval_ref) identity is immutable; only status/valid_to/revocation
--     fields change.
--   * Self-grant is denied at the database level: granted_by must differ from
--     the grantee user_id. (A different-actor APPROVAL workflow for privileged
--     grants is a Phase-1-14 backend control — NOT claimed here; approval_ref
--     is merely the column that will carry that evidence.)
--   * Grants are end-dated / revoked, never physically deleted by an
--     application role (no DELETE grant, no DELETE policy). Runtime holds SELECT
--     only; grant administration is a platform / Phase-1-14 operation.
--
-- Additive org change (documented): org.departments gains the composite
--   candidate key UNIQUE (tenant_id, company_id, branch_id, id) so it can be a
--   grant-scope FK target — mirroring org.warehouses' uq_warehouses_scope_id.
--   Purely additive (id is already the PK); no data change; forward migration.
--
-- Objects created
--   Tables:    iam.role_grants, iam.grant_scopes
--   Functions: iam.enforce_scoped_grant_has_scope()
--   Triggers:  tg_role_grants_touch_metadata, tg_role_grants_immutable,
--              tg_role_grants_require_scope (deferred constraint),
--              tg_grant_scopes_require_scope (deferred constraint)
--   Policies:  sel_role_grants_tenant, sel_grant_scopes_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Expose the org.departments composite candidate key for scope FKs.
-- ----------------------------------------------------------------------------
ALTER TABLE org.departments
  ADD CONSTRAINT uq_departments_scope_id UNIQUE (tenant_id, company_id, branch_id, id);

-- ----------------------------------------------------------------------------
-- 1. iam.role_grants (P1-04-DB-008)
-- ----------------------------------------------------------------------------
CREATE TABLE iam.role_grants (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  role_id        uuid        NOT NULL,
  scope_mode     text        NOT NULL DEFAULT 'unrestricted',
  status         text        NOT NULL DEFAULT 'active',
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz NULL,
  granted_by     uuid        NOT NULL,
  approval_ref   text        NULL,
  revoked_at     timestamptz NULL,
  revoke_reason  text        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_role_grants PRIMARY KEY (id),
  CONSTRAINT uq_role_grants_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_role_grants_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_role_grants_role
    FOREIGN KEY (tenant_id, role_id) REFERENCES iam.roles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_role_grants_scope_mode CHECK (scope_mode IN ('unrestricted', 'scoped')),
  CONSTRAINT ck_role_grants_status CHECK (status IN ('active', 'revoked')),
  CONSTRAINT ck_role_grants_interval CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT ck_role_grants_revoke_consistency
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT ck_role_grants_revoke_reason
    CHECK (revoked_at IS NULL OR btrim(COALESCE(revoke_reason, '')) <> ''),
  CONSTRAINT ck_role_grants_no_self_grant CHECK (granted_by IS DISTINCT FROM user_id)
);

COMMENT ON TABLE iam.role_grants IS
  'Assigns a role to a user (P1-04-DB-008) for [valid_from, valid_to). scope_mode unrestricted|scoped; a scoped active grant must carry ≥1 iam.grant_scopes row (deferred constraint). Self-grant is denied (granted_by <> user_id). approval_ref carries privileged-grant evidence; the different-actor approval WORKFLOW is a Phase-1-14 backend control, not enforced here. Grants are revoked/end-dated, never physically deleted by an application role.';
COMMENT ON COLUMN iam.role_grants.scope_mode IS 'unrestricted = tenant-wide; scoped = limited to its grant_scopes. Immutable — a grant cannot be widened after creation.';
COMMENT ON COLUMN iam.role_grants.approval_ref IS 'Reference to the approval evidence for a privileged grant. The enforcing workflow is Phase 1-14; this column only carries the reference.';

CREATE INDEX ix_role_grants_user ON iam.role_grants (tenant_id, user_id);
CREATE INDEX ix_role_grants_role ON iam.role_grants (tenant_id, role_id);

CREATE TRIGGER tg_role_grants_touch_metadata
  BEFORE UPDATE ON iam.role_grants
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_role_grants_immutable
  BEFORE UPDATE ON iam.role_grants
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'user_id', 'role_id', 'granted_by', 'scope_mode', 'valid_from',
    'approval_ref', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. iam.grant_scopes (P1-04-DB-009) — append-only scope rows.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.grant_scopes (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  grant_id      uuid        NOT NULL,
  scope_type    text        NOT NULL,
  company_id    uuid        NULL,
  branch_id     uuid        NULL,
  department_id uuid        NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid        NOT NULL,

  CONSTRAINT pk_grant_scopes PRIMARY KEY (id),
  CONSTRAINT uq_grant_scopes_row
    UNIQUE NULLS NOT DISTINCT (grant_id, scope_type, company_id, branch_id, department_id),
  CONSTRAINT fk_grant_scopes_grant
    FOREIGN KEY (tenant_id, grant_id) REFERENCES iam.role_grants (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_grant_scopes_company
    FOREIGN KEY (tenant_id, company_id) REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_grant_scopes_branch
    FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_grant_scopes_department
    FOREIGN KEY (tenant_id, company_id, branch_id, department_id)
    REFERENCES org.departments (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_grant_scopes_type CHECK (scope_type IN ('company', 'branch', 'department')),
  CONSTRAINT ck_grant_scopes_shape CHECK (
    (scope_type = 'company'    AND company_id IS NOT NULL AND branch_id IS NULL     AND department_id IS NULL)
 OR (scope_type = 'branch'     AND company_id IS NOT NULL AND branch_id IS NOT NULL AND department_id IS NULL)
 OR (scope_type = 'department' AND company_id IS NOT NULL AND branch_id IS NOT NULL AND department_id IS NOT NULL)
  )
);

COMMENT ON TABLE iam.grant_scopes IS
  'Organizational scope rows for a scoped grant (P1-04-DB-009). One of company/branch/department is targeted; the parent chain is carried and validated by composite FKs, so cross-tenant and cross-company scopes are FK violations. Append-only; removing the last scope of an active scoped grant is rejected by the deferred constraint.';

CREATE INDEX ix_grant_scopes_grant ON iam.grant_scopes (tenant_id, grant_id);
-- One index covers the company (2), branch (3), and department (4) FK prefixes.
CREATE INDEX ix_grant_scopes_org
  ON iam.grant_scopes (tenant_id, company_id, branch_id, department_id);

-- ----------------------------------------------------------------------------
-- 3. Deferred integrity: a scoped ACTIVE grant must have at least one scope.
--    Constraint triggers run at COMMIT (INITIALLY DEFERRED), so a grant and its
--    scopes can be inserted in the same transaction. Concurrent transactions
--    each see their own uncommitted scopes; a transaction that commits a scoped
--    active grant with zero scopes fails — there is no interleaving that lets a
--    scoped active grant reach a committed state without a scope.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.enforce_scoped_grant_has_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_grant  uuid;
  v_mode   text;
  v_status text;
  v_count  integer;
BEGIN
  IF TG_TABLE_NAME = 'role_grants' THEN
    v_grant := NEW.id;
  ELSE
    v_grant := OLD.grant_id;
  END IF;

  SELECT scope_mode, status INTO v_mode, v_status
    FROM iam.role_grants WHERE id = v_grant;
  IF NOT FOUND THEN
    RETURN NULL; -- grant itself is gone; nothing to enforce
  END IF;

  IF v_mode = 'scoped' AND v_status = 'active' THEN
    SELECT count(*) INTO v_count FROM iam.grant_scopes WHERE grant_id = v_grant;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'scoped active grant % must have at least one scope', v_grant
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION iam.enforce_scoped_grant_has_scope() IS
  'Deferred constraint-trigger body: at COMMIT, a scope_mode=scoped, status=active grant must own ≥1 iam.grant_scopes row. Attached to role_grants (AFTER INSERT/UPDATE) and grant_scopes (AFTER DELETE) as INITIALLY DEFERRED constraint triggers, so grant+scopes commit together but an empty scoped active grant never persists.';

REVOKE EXECUTE ON FUNCTION iam.enforce_scoped_grant_has_scope() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER tg_role_grants_require_scope
  AFTER INSERT OR UPDATE ON iam.role_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_scoped_grant_has_scope();

CREATE CONSTRAINT TRIGGER tg_grant_scopes_require_scope
  AFTER DELETE ON iam.grant_scopes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_scoped_grant_has_scope();

-- ----------------------------------------------------------------------------
-- 4. Row-Level Security — enabled AND forced; default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.role_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.role_grants  FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.grant_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.grant_scopes FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_role_grants_tenant ON iam.role_grants
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_grant_scopes_tenant ON iam.grant_scopes
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 5. Grants — explicit, minimal (SELECT only).
-- ----------------------------------------------------------------------------
GRANT SELECT ON iam.role_grants  TO app_runtime, app_readonly;
GRANT SELECT ON iam.grant_scopes TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
