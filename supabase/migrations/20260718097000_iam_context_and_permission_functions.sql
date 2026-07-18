-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: runtime context wrappers and permission-resolution helpers
-- Tasks: P1-04-DB-020, P1-04-DB-021 (BR-IAM-001 deny precedence)
-- Owner module: iam
--
-- Purpose
--   Complete the authorization contract: current_company_ids/current_branch_ids
--   (forward-compatible wrappers over the existing allowed_* readers) and
--   has_permission / has_permission_in_scope, which resolve a permission from
--   the current user's ACTIVE role grants with real deny precedence and scope
--   enforcement.
--
-- Dependencies
--   0002 context readers, Increment A (user_accounts), B (roles/permissions/
--   role_permissions), C (role_grants/grant_scopes).
--
-- Rollback classification: ROLLBACK-SAFE (functions only; no data). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * All SECURITY INVOKER with an empty search_path. NO SECURITY DEFINER — the
--     helpers read only what the calling session may read (RLS applies), and
--     they trust ONLY the server-set transaction context, never client input.
--   * Unset or invalid context resolves to DENY (false), never an error or an
--     allow. An unparsable UUID in the context is caught and denied.
--   * Authorization is by permission, never by role name. Deny precedence is
--     real: a deny mapping in ANY active granted role overrides every allow.
--   * Archived/locked/deleted users, and expired or revoked grants, resolve to
--     deny. A scoped grant only applies where one of its scopes matches.
--   * EXECUTE is revoked from PUBLIC and granted only to the app archetypes.
--
-- Objects created
--   Functions: iam.current_company_ids(), iam.current_branch_ids(),
--              iam.has_permission(text),
--              iam.has_permission_in_scope(text, uuid, uuid, uuid)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Forward-compatible context wrappers (§19.B). Named per the approved
--    contract; delegate to the existing allowed_* readers (no behaviour change).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.current_company_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT iam.allowed_company_ids();
$$;

CREATE OR REPLACE FUNCTION iam.current_branch_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT iam.allowed_branch_ids();
$$;

COMMENT ON FUNCTION iam.current_company_ids() IS
  'Approved-contract name for the company narrowing set; wraps iam.allowed_company_ids() (0002). NULL when unset.';
COMMENT ON FUNCTION iam.current_branch_ids() IS
  'Approved-contract name for the branch narrowing set; wraps iam.allowed_branch_ids() (0002). NULL when unset.';

-- ----------------------------------------------------------------------------
-- 2. iam.has_permission — tenant-wide resolution (P1-04-DB-020/021).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.has_permission(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user   uuid;
  v_tenant uuid;
  v_perm   uuid;
  v_allow  boolean;
  v_deny   boolean;
BEGIN
  v_user := iam.current_user_id();
  v_tenant := iam.current_tenant_id();
  IF v_user IS NULL OR v_tenant IS NULL THEN
    RETURN false; -- unset context → deny
  END IF;

  -- Only an ACTIVE, non-deleted user in this tenant can hold any permission.
  IF NOT EXISTS (
    SELECT 1 FROM iam.user_accounts
    WHERE id = v_user AND tenant_id = v_tenant AND status = 'active' AND deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  SELECT id INTO v_perm FROM iam.permissions WHERE permission_code = p_code;
  IF v_perm IS NULL THEN
    RETURN false;
  END IF;

  -- Aggregate allow/deny across the user's ACTIVE grants → roles → mappings.
  SELECT bool_or(rp.effect = 'allow'), bool_or(rp.effect = 'deny')
    INTO v_allow, v_deny
  FROM iam.role_grants g
  JOIN iam.role_permissions rp
    ON rp.tenant_id = g.tenant_id AND rp.role_id = g.role_id
  WHERE g.tenant_id = v_tenant AND g.user_id = v_user AND g.status = 'active'
    AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now())
    AND rp.permission_id = v_perm;

  RETURN COALESCE(v_allow, false) AND NOT COALESCE(v_deny, false);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN false; -- invalid UUID in the context → deny, never error
END;
$$;

COMMENT ON FUNCTION iam.has_permission(text) IS
  'True iff the current session user (active, in-tenant) holds p_code through an ACTIVE role grant with an allow mapping and NO deny mapping (deny precedence, BR-IAM-001). Unset/invalid context, inactive user, expired/revoked grant, or an unmapped role all resolve to false. SECURITY INVOKER; trusts only the server-set context.';

-- ----------------------------------------------------------------------------
-- 3. iam.has_permission_in_scope — scoped resolution (P1-04-DB-021).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.has_permission_in_scope(
  p_code       text,
  p_company    uuid DEFAULT NULL,
  p_branch     uuid DEFAULT NULL,
  p_department uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user     uuid;
  v_tenant   uuid;
  v_perm     uuid;
  v_deny     boolean;
  v_in_scope boolean;
BEGIN
  v_user := iam.current_user_id();
  v_tenant := iam.current_tenant_id();
  IF v_user IS NULL OR v_tenant IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM iam.user_accounts
    WHERE id = v_user AND tenant_id = v_tenant AND status = 'active' AND deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  SELECT id INTO v_perm FROM iam.permissions WHERE permission_code = p_code;
  IF v_perm IS NULL THEN
    RETURN false;
  END IF;

  -- Deny is global: any deny mapping in an active granted role denies outright.
  SELECT bool_or(rp.effect = 'deny') INTO v_deny
  FROM iam.role_grants g
  JOIN iam.role_permissions rp
    ON rp.tenant_id = g.tenant_id AND rp.role_id = g.role_id
  WHERE g.tenant_id = v_tenant AND g.user_id = v_user AND g.status = 'active'
    AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now())
    AND rp.permission_id = v_perm;
  IF COALESCE(v_deny, false) THEN
    RETURN false;
  END IF;

  -- Allow only if an active granting grant is unrestricted OR carries a scope
  -- that matches the requested target.
  SELECT EXISTS (
    SELECT 1
    FROM iam.role_grants g
    JOIN iam.role_permissions rp
      ON rp.tenant_id = g.tenant_id AND rp.role_id = g.role_id
     AND rp.permission_id = v_perm AND rp.effect = 'allow'
    WHERE g.tenant_id = v_tenant AND g.user_id = v_user AND g.status = 'active'
      AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now())
      AND (
        g.scope_mode = 'unrestricted'
        OR EXISTS (
          SELECT 1 FROM iam.grant_scopes s
          WHERE s.tenant_id = g.tenant_id AND s.grant_id = g.id
            AND (
                 (s.scope_type = 'company'    AND s.company_id = p_company)
              OR (s.scope_type = 'branch'     AND s.branch_id = p_branch)
              OR (s.scope_type = 'department' AND s.department_id = p_department)
            )
        )
      )
  ) INTO v_in_scope;

  RETURN COALESCE(v_in_scope, false);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN false;
END;
$$;

COMMENT ON FUNCTION iam.has_permission_in_scope(text, uuid, uuid, uuid) IS
  'Scoped resolution: deny precedence is global; an allow counts only if an active granting grant is unrestricted or has a matching company/branch/department scope. A scoped grant with no matching scope does not apply. SECURITY INVOKER; trusts only the server-set context.';

-- ----------------------------------------------------------------------------
-- 4. EXECUTE grants — revoke PUBLIC default, grant to app archetypes only.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION iam.current_company_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION iam.current_branch_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION iam.has_permission(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION iam.has_permission_in_scope(text, uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION iam.current_company_ids() TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION iam.current_branch_ids() TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION iam.has_permission(text) TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION iam.has_permission_in_scope(text, uuid, uuid, uuid) TO app_runtime, app_readonly;
