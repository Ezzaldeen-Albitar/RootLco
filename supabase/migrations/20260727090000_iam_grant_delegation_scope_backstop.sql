-- ============================================================================
-- Phase: 1-14 — Authentication, Authorization, and Administration Backend
-- Migration: grant-delegation scope-containment backstop
-- Change request: P1-14 gate remediation (confirmed High — unrestricted-grant
--   scope-containment bypass). Companion to the application fix in
--   src/modules/iam/domain/delegation-policy.ts and
--   src/modules/iam/application/access-administration-service.ts.
-- Owner module: iam
--
-- Rollback classification: ROLLBACK-SAFE (functions + constraint triggers only;
--   no data, no change to any existing table). Exact rollback at the foot.
--
-- Purpose
--   Close the confirmed-High escalation at the DATABASE layer, independently of
--   the application service. The pre-remediation gap:
--
--     * The application performed scope containment only INSIDE its per-scope
--       loop, so an EMPTY scope list (an unrestricted, tenant-wide grant) skipped
--       containment entirely — the broadest possible delegation was the one
--       delegation nobody checked.
--     * The RLS policy `ins_role_grants_delegable` (migration 20260726090000)
--       checks permission delegability via `iam.has_permission(text)`, which is
--       deliberately TENANT-WIDE / SCOPE-BLIND (migration 20260718097000). It
--       proves the actor holds the role's permissions SOMEWHERE in the tenant; it
--       does NOT prove the actor may delegate them tenant-wide, nor into a company
--       or branch the actor does not hold.
--
--   Result: a company- or branch-scoped administrator holding `iam.grant.manage`
--   could mint a tenant-wide (or wider-than-their-own) grant. This migration adds
--   a deferred constraint-trigger backstop that refuses exactly that, so a defect
--   in the application layer cannot produce an escalation.
--
-- Design
--   Enforcement is a DEFERRABLE INITIALLY DEFERRED constraint trigger, mirroring
--   the existing `tg_role_grants_require_scope` pattern (migration
--   20260718092000): role_grants and grant_scopes are written in separate
--   statements, so the whole grant (header + scope rows) is only coherent at
--   COMMIT. Firing at commit lets the check see the final state.
--
--   The rule (identical to the application DelegationPolicy):
--     * No acting runtime principal (iam.current_user_id() IS NULL) → NOT a
--       delegated request. The owner/operator provisioning path (ADR-008,
--       org.provision_organization) and the admin test/seed connections create
--       the first tenant administrator here; they set no app.user_id, so the
--       bootstrap boundary is preserved untouched.
--     * The actor holds a tenant-wide (unrestricted) active grant → may delegate
--       anything within the tenant (permission delegability and deny precedence
--       are enforced separately by ins_role_grants_delegable / has_permission).
--     * Otherwise the actor is scoped:
--         - an unrestricted (scope_mode='unrestricted') grant is REFUSED;
--         - every grant_scope row must be COVERED by a scope the actor holds:
--             company C held  → covers company/branch/department in C;
--             branch (C,B) held → covers that branch and its departments only,
--                                  NOT the company;
--             department (C,B,D) held → covers only that exact department.
--
-- Security implications
--   * SECURITY INVOKER, empty search_path. No SECURITY DEFINER is introduced.
--     The function reads only rows the caller may already read under RLS
--     (sel_role_grants_tenant / sel_grant_scopes_tenant are tenant-scoped SELECT),
--     so it cannot see or use another tenant's grants.
--   * No new privilege, ownership, BYPASSRLS, or role is created. FORCE RLS and
--     default deny on iam.role_grants / iam.grant_scopes are unchanged.
--   * The function never writes, so it cannot recurse and cannot widen access.
--   * Cross-tenant delegation is already structurally impossible (composite FKs +
--     tenant SELECT policies); the actor's authority is read tenant-filtered, so a
--     grant can never be covered by another tenant's scope.
--   * Bootstrap boundary: unchanged. Only a request carrying an acting runtime
--     principal is subject to the check.
--
-- Rollback classification: ROLLBACK-SAFE (functions + constraint triggers only;
--   no data, no schema change to existing tables). Exact rollback at the foot.
--
-- Objects created
--   Functions: iam.grant_delegation_within_authority(uuid)  [predicate]
--              iam.enforce_grant_delegation_within_authority() [trigger body]
--   Triggers:  tg_role_grants_delegation_authority  (role_grants, deferred)
--              tg_grant_scopes_delegation_authority  (grant_scopes, deferred)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Predicate: is the given grant a delegation the current actor is entitled to
--    make? Returns true when allowed, false when it escalates beyond the actor's
--    own authority. SECURITY INVOKER — reads only RLS-visible (own-tenant) rows.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.grant_delegation_within_authority(p_grant uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor    uuid;
  v_tenant   uuid;
  v_mode     text;
  v_status   text;
  v_uncovered integer;
BEGIN
  -- Constrain EXACTLY the population `ins_role_grants_delegable` constrains: the
  -- request-path archetype `app_runtime` and its login members, which are
  -- non-superuser and NOBYPASSRLS. Any role that bypasses RLS (a superuser, or the
  -- BYPASSRLS provisioning/admin connection) already bypasses the delegability
  -- policy itself, so it bypasses this backstop too — that is what preserves the
  -- bootstrap boundary (the first tenant administrator via org.provision_organization,
  -- ADR-008) and the fixture/seed path. app_runtime is NOBYPASSRLS in every
  -- environment, so the real request path is always enforced.
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RETURN true;
  END IF;
  IF NOT pg_has_role(current_user, 'app_runtime', 'MEMBER') THEN
    RETURN true;
  END IF;

  v_actor := iam.current_user_id();

  -- No acting principal on a request-path connection: cannot attribute the
  -- delegation, so it cannot be authorised. (In practice ins_role_grants_delegable
  -- already denies an app_runtime insert with no resolved user, because
  -- iam.has_permission is false without one — this is belt-and-braces.)
  IF v_actor IS NULL THEN
    RETURN true;
  END IF;

  SELECT tenant_id, scope_mode, status
    INTO v_tenant, v_mode, v_status
    FROM iam.role_grants
   WHERE id = p_grant;

  -- Grant vanished (e.g. rolled back) or is not active: nothing to constrain.
  IF NOT FOUND OR v_status <> 'active' THEN
    RETURN true;
  END IF;

  -- A tenant-wide (unrestricted) actor may delegate anything within the tenant.
  IF EXISTS (
    SELECT 1
      FROM iam.role_grants g
     WHERE g.tenant_id = v_tenant
       AND g.user_id   = v_actor
       AND g.status    = 'active'
       AND g.scope_mode = 'unrestricted'
       AND g.valid_from <= now()
       AND (g.valid_to IS NULL OR g.valid_to > now())
  ) THEN
    RETURN true;
  END IF;

  -- The actor is scoped. An unrestricted (tenant-wide) delegation is refused.
  IF v_mode = 'unrestricted' THEN
    RETURN false;
  END IF;

  -- Scoped delegation: every scope row of the new grant must be covered by a
  -- scope the actor holds. Coverage is hierarchical (company covers its branches
  -- and departments; branch covers its departments; department covers itself).
  SELECT count(*) INTO v_uncovered
    FROM iam.grant_scopes s
   WHERE s.grant_id = p_grant
     AND NOT EXISTS (
       SELECT 1
         FROM iam.role_grants ag
         JOIN iam.grant_scopes a
           ON a.tenant_id = ag.tenant_id AND a.grant_id = ag.id
        WHERE ag.tenant_id = v_tenant
          AND ag.user_id   = v_actor
          AND ag.status    = 'active'
          AND ag.valid_from <= now()
          AND (ag.valid_to IS NULL OR ag.valid_to > now())
          AND a.company_id = s.company_id
          AND (
                -- actor holds the whole company: covers any scope within it
                a.scope_type = 'company'
                -- actor holds the branch: covers that branch or a department in it
             OR (a.scope_type = 'branch'
                 AND s.branch_id IS NOT NULL
                 AND a.branch_id = s.branch_id)
                -- actor holds the exact department: covers only that department
             OR (a.scope_type = 'department'
                 AND s.branch_id IS NOT NULL
                 AND a.branch_id = s.branch_id
                 AND s.department_id IS NOT NULL
                 AND a.department_id = s.department_id)
          )
     );

  RETURN v_uncovered = 0;
END;
$$;

COMMENT ON FUNCTION iam.grant_delegation_within_authority(uuid) IS
  'True iff the current acting principal (iam.current_user_id()) may issue grant p_grant: a NULL actor (bootstrap/provisioning) or a tenant-wide actor may delegate anything in-tenant; a scoped actor may not issue an unrestricted grant, and every grant_scope must be covered by a scope the actor holds at its own granularity. Companion to DelegationPolicy; SECURITY INVOKER, reads only RLS-visible rows.';

REVOKE EXECUTE ON FUNCTION iam.grant_delegation_within_authority(uuid) FROM PUBLIC;
-- The request path evaluates it inside the constraint trigger (as the invoking
-- runtime role); an explicit EXECUTE grant lets that evaluation succeed.
GRANT EXECUTE ON FUNCTION iam.grant_delegation_within_authority(uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Constraint-trigger body. Deferred to COMMIT so a grant + its scopes, written
--    in separate statements, are validated as a whole. Raises insufficient_privilege
--    (42501) — the same class a policy denial raises — when the delegation exceeds
--    the actor's authority.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.enforce_grant_delegation_within_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_grant uuid;
BEGIN
  IF TG_TABLE_NAME = 'role_grants' THEN
    v_grant := NEW.id;
  ELSE
    v_grant := NEW.grant_id;
  END IF;

  IF NOT iam.grant_delegation_within_authority(v_grant) THEN
    RAISE EXCEPTION
      'grant % delegates authority beyond the administrator effective scope', v_grant
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'A scoped administrator may only delegate within scopes they themselves hold, and may not issue an unrestricted grant.';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION iam.enforce_grant_delegation_within_authority() IS
  'Deferred constraint-trigger body: at COMMIT, refuses a role grant whose scope exceeds the acting administrator authority (P1-14 confirmed-High backstop). Attached to iam.role_grants (INSERT/UPDATE) and iam.grant_scopes (INSERT) as INITIALLY DEFERRED constraint triggers, so header and scope rows are validated together. Raises SQLSTATE 42501.';

REVOKE EXECUTE ON FUNCTION iam.enforce_grant_delegation_within_authority() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. Attach the deferred constraint triggers.
--    * role_grants INSERT: catches an unrestricted grant (which owns no scope
--      rows) and validates a scoped grant's header.
--    * role_grants UPDATE: catches a revoked→active reactivation
--      (upd_role_grants_admin permits status changes; scope_mode is immutable).
--    * grant_scopes INSERT: catches a scope added to a grant, in the same
--      transaction or a later one, so widening after creation is refused too.
-- ----------------------------------------------------------------------------
CREATE CONSTRAINT TRIGGER tg_role_grants_delegation_authority
  AFTER INSERT OR UPDATE ON iam.role_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_grant_delegation_within_authority();

CREATE CONSTRAINT TRIGGER tg_grant_scopes_delegation_authority
  AFTER INSERT ON iam.grant_scopes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_grant_delegation_within_authority();

-- ============================================================================
-- Exact rollback (ROLLBACK-SAFE — no data is created or destroyed):
--
--   DROP TRIGGER tg_grant_scopes_delegation_authority ON iam.grant_scopes;
--   DROP TRIGGER tg_role_grants_delegation_authority  ON iam.role_grants;
--   DROP FUNCTION iam.enforce_grant_delegation_within_authority();
--   DROP FUNCTION iam.grant_delegation_within_authority(uuid);
-- ============================================================================
