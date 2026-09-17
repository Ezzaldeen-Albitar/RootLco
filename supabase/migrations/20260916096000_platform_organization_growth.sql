-- ============================================================================
-- P1-32-PRE-151 — the control plane may GROW an existing organisation.
-- Owner module: org (with the iam half of the administrator bootstrap)
--
-- Rollback classification: ROLLBACK-SAFE. Every object here is a function, a
--   policy or a grant. Nothing is written, moved or destroyed, so dropping the
--   one function and the nineteen policies and revoking the two privileges
--   returns the database to exactly its previous state. The exact inverse is
--   given at the foot of this file.
--
-- Purpose
--   Until now the control plane could only create an organisation and then
--   watch it. Every platform INSERT policy on org.legal_companies, org.branches
--   and iam.user_accounts is predicated on the tenant still being
--   `provisioning`, so the moment a tenant went live the console could no
--   longer add a legal entity, open a branch, or give the organisation an
--   administrator when the first one never arrived. The only remedies were a
--   tenant administrator who could log in — which is exactly what is missing
--   when the first owner never accepted their invitation — or a manual write.
--
--   This migration opens that path, and opens it under the SAME database rules
--   the tenant's own operations obey rather than beside them:
--
--     * the capacity triggers added by 20260916093000 apply to the platform
--       writes too. They did not before, and not because anybody exempted them:
--       org.assert_capacity_available returns early for a session that holds no
--       EXECUTE on org.capacity_used, which app_platform did not. Section 1
--       grants it, so the control plane is counted exactly like a tenant
--       administrator and a ceiling refuses it with the same
--       `capacity_limit_reached`.
--     * the counting is only honest if the counting session can SEE the rows.
--       A SELECT policy missing here would not fail loudly: org.capacity_used
--       would return a smaller number and the ceiling would silently admit a
--       write it should have refused. That is why sections 3 and 4 add a
--       reading policy for every table the three counts touch, for BOTH
--       authorities that can reach the arithmetic — platform.organization.manage
--       through the target window, and platform.subscription.manage through the
--       plan-change shortfall in section 2.
--
-- The target window
--   Every policy added for platform.organization.manage carries
--   `tenant_id = iam.current_tenant_id()`. On the control plane that value is
--   the operator's HOME tenant unless a platform-on-target window has moved it,
--   which is what binds a console write to ONE named organisation: the
--   application opens the window for the tenant in the route, and no policy
--   here admits a row of any other tenant while it is open. The pre-existing
--   `withPlatformTarget` window cannot serve this path — it admits only a
--   tenant the same transaction created and which is still `provisioning` — so
--   the application adds a second window for a LIVE tenant. The database rule
--   is the same either way and is stated here, not there.
--
-- What is deliberately NOT here
--   No new table, no new column, no new permission code and no SECURITY
--   DEFINER routine. `platform.organization.manage` has been seeded since the
--   console's first slice and has gated nothing; from here it gates fifteen
--   policies. And no widening of the identity surface: app_platform still
--   reads iam.user_accounts through the column grant (id, tenant_id, status,
--   deleted_at) alone, so every read added below can produce a COUNT and can
--   never produce an identity.
--
-- Dependencies
--   20260831093000 (the platform privilege graph), 20260902130000 (the
--   catalogue read), 20260916090000 (the console read graph), 20260916091000
--   (subscription commerce), 20260916093000 (capacity enforcement).
--
-- Objects created
--   Functions: org.plan_capacity_shortfall(uuid, uuid)
--   Policies:  sel_tenants_platform_manage,
--              sel_legal_companies_platform_growth, ins_legal_companies_platform_manage,
--              sel_branches_platform_growth, ins_branches_platform_manage,
--              sel_user_accounts_platform_growth, ins_user_accounts_platform_manage,
--              ins_user_status_history_platform_manage,
--              sel_roles_platform_manage, ins_roles_platform_manage,
--              ins_role_permissions_platform_manage,
--              sel_role_grants_platform_manage, ins_role_grants_platform_manage,
--              sel_permissions_platform_manage,
--              sel_tenant_subscriptions_platform_manage,
--              sel_subscription_plans_platform_manage,
--              sel_number_sequences_platform_manage,
--              ins_number_sequences_platform_manage,
--              ins_idempotency_keys_platform_organization,
--              sel_idempotency_keys_platform_organization
--   Grants:    EXECUTE on the three capacity readers and the new shortfall
--              function to app_platform; SELECT on shared.number_sequences and
--              column-scoped SELECT on iam.roles to app_platform
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The control plane is COUNTED.
--
--    org.assert_capacity_available contains a deliberate early return for a
--    session that may not count, written when the only platform writers were
--    provisioning ones that the `provisioning` exemption had already released.
--    Granting EXECUTE here is what moves the control plane from "not governed
--    by this rule" to "governed by it": from now on a console write into a live
--    organisation takes the same per-tenant advisory lock, counts the same
--    rows, and is refused by the same `capacity_limit_reached`.
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION org.capacity_limit(uuid, text) TO app_platform;
GRANT EXECUTE ON FUNCTION org.capacity_used(uuid, text) TO app_platform;
GRANT EXECUTE ON FUNCTION org.capacity_usage(uuid) TO app_platform;

-- ----------------------------------------------------------------------------
-- 2. org.plan_capacity_shortfall — what a plan change would leave over its head.
--
--    A downgrade is refused when the plan being assigned declares a ceiling
--    BELOW what the organisation already holds, and the refusal has to name
--    every kind at once: an operator told only "too many branches" would fix
--    the branches and be refused again for the seats.
--
--    The key rule is `max_<kind>`, exactly as org.capacity_limit reads it, and
--    an ABSENT key is absent rather than zero — the same reading, for the same
--    reason. `used > limit` and not `>=`: an organisation exactly at the new
--    ceiling is not over it, it is full, and refusing that would make a plan
--    unassignable to the organisation it was sized for.
--
--    SECURITY INVOKER, so the counts are the caller's own. A session that
--    cannot see a tenant's rows would compute no shortfall at all, which is why
--    section 3 gives the subscription authority the reads it needs BEFORE this
--    function can be relied on.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.plan_capacity_shortfall(p_tenant uuid, p_plan uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'kind', k.kind, 'used', k.used, 'newLimit', k.new_limit)
             ORDER BY k.ord),
           '[]'::jsonb)
    FROM (
      SELECT v.kind,
             v.ord,
             org.capacity_used(p_tenant, v.kind) AS used,
             pg_catalog.floor(
               (p.capacity_limits ->> ('max_' || v.kind))::numeric)::integer AS new_limit
        FROM org.subscription_plans p
        CROSS JOIN (VALUES ('companies', 1), ('branches', 2), ('users', 3)) AS v(kind, ord)
       WHERE p.id = p_plan
         AND p.capacity_limits ? ('max_' || v.kind)
    ) AS k
   WHERE k.used > k.new_limit;
$$;

COMMENT ON FUNCTION org.plan_capacity_shortfall(uuid, uuid) IS
  'Every capacity kind on which a plan would place a ceiling BELOW what a tenant already holds, as [{"kind","used","newLimit"}] ordered companies, branches, users — and an empty array when the plan fits. Reads capacity_limits -> max_<kind> exactly as org.capacity_limit does, treats an absent key as no ceiling rather than zero, and compares with > so an organisation exactly at the new ceiling is full rather than over. SECURITY INVOKER: the usage counted is the usage the caller may see, which is why the subscription authority is given the reads the count touches.';

REVOKE EXECUTE ON FUNCTION org.plan_capacity_shortfall(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.plan_capacity_shortfall(uuid, uuid) TO app_platform;

-- ----------------------------------------------------------------------------
-- 3. The reads the two authorities need.
--
--    Two shapes, and the difference is deliberate:
--
--      * platform.organization.manage reads through the target window, so every
--        one of its policies is `tenant_id = iam.current_tenant_id()`. It never
--        sees a second organisation, which is the tenant-isolation property the
--        console writes are asserted on.
--      * platform.subscription.manage reads ACROSS tenants, because the
--        shortfall above is computed for the organisation named in the request
--        from the operator's own home context — there is no window open. It
--        gains no write anywhere.
--
--    The user-account policy reads iam.platform_grants DIRECTLY rather than
--    calling iam.has_platform_authority, for the reason the census policy gives:
--    that resolver reads iam.user_accounts and would recurse into this policy.
-- ----------------------------------------------------------------------------
CREATE POLICY sel_tenants_platform_manage ON org.tenants
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.manage'));

COMMENT ON POLICY sel_tenants_platform_manage ON org.tenants IS
  'The organisation an administration act names must be readable before it can be acted on, and org.assert_capacity_available reads org.tenants to decide whether the organisation is running at all — a status it cannot see would return early and enforce nothing. Beside sel_tenants_platform, which serves the read, lifecycle and provisioning authorities.';

CREATE POLICY sel_legal_companies_platform_growth ON org.legal_companies
  FOR SELECT TO app_platform
  USING (
    (tenant_id = iam.current_tenant_id()
      AND iam.has_platform_authority('platform.organization.manage'))
    OR iam.has_platform_authority('platform.subscription.manage')
  );

COMMENT ON POLICY sel_legal_companies_platform_growth ON org.legal_companies IS
  'Two readers of the company count: the administration window, narrowed to the tenant it is open on, and the subscription authority, which must count what a plan change would leave over its ceiling. Without the second the shortfall would compute zero companies and a downgrade would be admitted silently.';

CREATE POLICY sel_branches_platform_growth ON org.branches
  FOR SELECT TO app_platform
  USING (
    (tenant_id = iam.current_tenant_id()
      AND iam.has_platform_authority('platform.organization.manage'))
    OR iam.has_platform_authority('platform.subscription.manage')
  );

COMMENT ON POLICY sel_branches_platform_growth ON org.branches IS
  'The branch half of the same pair. See sel_legal_companies_platform_growth.';

CREATE POLICY sel_user_accounts_platform_growth ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (
    EXISTS (
      SELECT 1
        FROM iam.platform_grants g
       WHERE g.account_id = iam.current_user_id()
         AND g.revoked_at IS NULL
         AND (
              (g.permission_code = 'platform.organization.manage'
                AND iam.user_accounts.tenant_id = iam.current_tenant_id())
              OR g.permission_code = 'platform.subscription.manage'
         )
    )
  );

COMMENT ON POLICY sel_user_accounts_platform_growth ON iam.user_accounts IS
  'The seat count, for the administration window (its own tenant only) and for the subscription shortfall (any tenant). Reachable ONLY through the column grant (id, tenant_id, status, deleted_at) that has bounded app_platform since the control plane shipped, so this policy can produce a count and can never produce an identity. Reads iam.platform_grants directly because iam.has_platform_authority reads this table and would recurse.';

CREATE POLICY sel_roles_platform_manage ON iam.roles
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY sel_roles_platform_manage ON iam.roles IS
  'The administrator bootstrap must find the tenant_administrator role of the organisation it is acting on before deciding whether to establish one. Column-scoped to (id, tenant_id, role_code, is_system, deleted_at): a role name is not an identity and no permission mapping is reachable through it.';

CREATE POLICY sel_role_grants_platform_manage ON iam.role_grants
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY sel_role_grants_platform_manage ON iam.role_grants IS
  'Whether the organisation already HAS an administrator is the question the invitation refusal turns on, and it is answered from the grants rather than from a flag. Beside sel_role_grants_platform_bootstrap, which serves provisioning.';

CREATE POLICY sel_permissions_platform_manage ON iam.permissions
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.manage'));

COMMENT ON POLICY sel_permissions_platform_manage ON iam.permissions IS
  'The catalogue read the administrator bootstrap needs to resolve the tenant_administrator permission codes to rows when the role has to be established. Beside sel_permissions_platform_bootstrap, which serves the provisioning authority; the GRANT stays column-scoped to (id, permission_code).';

CREATE POLICY sel_tenant_subscriptions_platform_manage ON org.tenant_subscriptions
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY sel_tenant_subscriptions_platform_manage ON org.tenant_subscriptions IS
  'org.capacity_limit resolves the ceiling from the active assignment. An administration session that could not see it would read every ceiling as NULL — unlimited — and walk through it. This policy is what makes the refusal real inside the target window.';

CREATE POLICY sel_subscription_plans_platform_manage ON org.subscription_plans
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.manage'));

COMMENT ON POLICY sel_subscription_plans_platform_manage ON org.subscription_plans IS
  'The plan half of the same resolution: the assignment names a plan and the ceiling lives in its capacity_limits document. No row term — a plan version belongs to no tenant.';

GRANT SELECT (id, tenant_id, role_code, is_system, deleted_at) ON iam.roles TO app_platform;
GRANT SELECT ON shared.number_sequences TO app_platform;

CREATE POLICY sel_number_sequences_platform_manage ON shared.number_sequences
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY sel_number_sequences_platform_manage ON shared.number_sequences IS
  'A branch opened from the console owes its invoice, quotation and receipt runs, and the bootstrap verifies the resulting SET rather than trusting an affected-row count — which it cannot do without reading the rows back. Tenant-scoped to the window; no UPDATE and no DELETE accompany it.';

-- ----------------------------------------------------------------------------
-- 4. The writes, each one bound to the tenant the window is open on.
--
--    Every policy below repeats two terms — the tenant and the authority — and
--    neither is redundant. The tenant term is what makes a platform write reach
--    exactly one organisation; the authority term is what makes
--    platform.organization.manage mean something at the database rather than in
--    a route declaration.
--
--    The capacity triggers are NOT restated here. They are on the tables, they
--    fire for every writer, and section 1 is what puts this role inside their
--    arithmetic.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_legal_companies_platform_manage ON org.legal_companies
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY ins_legal_companies_platform_manage ON org.legal_companies IS
  'A legal company added to a LIVE organisation from the console. ins_legal_companies_platform cannot serve it: that policy admits only a tenant still in `provisioning`. tg_legal_companies_capacity refuses the row when the plan ceiling is spent, exactly as it does for the tenant operation.';

CREATE POLICY ins_branches_platform_manage ON org.branches
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY ins_branches_platform_manage ON org.branches IS
  'The branch half. The parent company is resolved inside the tenant by the service and by fk_branches_company, so a company of another organisation cannot be named through it.';

CREATE POLICY ins_number_sequences_platform_manage ON shared.number_sequences
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
    AND company_id IS NOT NULL
    AND branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org.branches b
       WHERE b.tenant_id = shared.number_sequences.tenant_id
         AND b.company_id = shared.number_sequences.company_id
         AND b.id = shared.number_sequences.branch_id
    )
  );

COMMENT ON POLICY ins_number_sequences_platform_manage ON shared.number_sequences IS
  'The console equivalent of ins_number_sequences_branch_authority: the per-branch runs a new branch owes. Deliberately cannot mint a tenant-wide run — both scope columns are required — and cannot name a pair that is not a real branch of the tenant the window is open on.';

CREATE POLICY ins_user_accounts_platform_manage ON iam.user_accounts
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY ins_user_accounts_platform_manage ON iam.user_accounts IS
  'The administrator account the console establishes for an organisation that has none. ins_user_accounts_platform_bootstrap requires the tenant to be `provisioning`, which is precisely not the case when an organisation went live without a usable administrator. tg_user_accounts_capacity owns the seat ceiling and refuses this row when the seats are spent.';

CREATE POLICY ins_user_status_history_platform_manage ON iam.user_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY ins_user_status_history_platform_manage ON iam.user_status_history IS
  'The account above is born active and says so in its own trail, exactly as the first-owner bootstrap does. Without this policy the account would commit with no history row and the organisation could not answer when its administrator was established.';

CREATE POLICY ins_roles_platform_manage ON iam.roles
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
    AND is_system = false
  );

COMMENT ON POLICY ins_roles_platform_manage ON iam.roles IS
  'An organisation provisioned before the first-owner bootstrap existed may hold no tenant_administrator role at all, and an administrator with no role is an account that can do nothing. `is_system = false` for the same reason the bootstrap policy states it: the control plane never mints a protected role.';

CREATE POLICY ins_role_permissions_platform_manage ON iam.role_permissions
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY ins_role_permissions_platform_manage ON iam.role_permissions IS
  'The fixed mapping of the tenant_administrator role, written only when that role had to be established. The code set is a server-owned constant; no request field names a permission.';

CREATE POLICY ins_role_grants_platform_manage ON iam.role_grants
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY ins_role_grants_platform_manage ON iam.role_grants IS
  'The grant that makes the new account an administrator. tg_role_grants_delegation_authority still applies and still returns true for a session that is not a member of app_runtime, exactly as it does during provisioning.';

CREATE POLICY ins_idempotency_keys_platform_organization ON shared.idempotency_keys
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND operation IN (
      'platform_organization_company_create',
      'platform_organization_branch_create',
      'platform_organization_administrator_invite'
    )
    AND iam.has_platform_authority('platform.organization.manage')
  );

CREATE POLICY sel_idempotency_keys_platform_organization ON shared.idempotency_keys
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND operation IN (
      'platform_organization_company_create',
      'platform_organization_branch_create',
      'platform_organization_administrator_invite'
    )
    AND iam.has_platform_authority('platform.organization.manage')
  );

COMMENT ON POLICY ins_idempotency_keys_platform_organization ON shared.idempotency_keys IS
  'The replay record of the three administration operations, named one by one rather than by a prefix. It is written in the operator HOME tenant — the window is closed by the time the route stores the response — which is also where the audit record of the act lives.';
COMMENT ON POLICY sel_idempotency_keys_platform_organization ON shared.idempotency_keys IS
  'The read half of the replay record above, under the same three names and the same authority.';

DO $$
BEGIN
  RAISE NOTICE '[RootLco] Platform organization growth applied: 1 function, 20 policies, 5 grants.';
END $$;

-- ----------------------------------------------------------------------------
-- Exact inverse (ROLLBACK-SAFE — nothing here writes data)
--
--   DROP POLICY sel_idempotency_keys_platform_organization ON shared.idempotency_keys;
--   DROP POLICY ins_idempotency_keys_platform_organization ON shared.idempotency_keys;
--   DROP POLICY ins_role_grants_platform_manage ON iam.role_grants;
--   DROP POLICY ins_role_permissions_platform_manage ON iam.role_permissions;
--   DROP POLICY ins_roles_platform_manage ON iam.roles;
--   DROP POLICY ins_user_status_history_platform_manage ON iam.user_status_history;
--   DROP POLICY ins_user_accounts_platform_manage ON iam.user_accounts;
--   DROP POLICY ins_number_sequences_platform_manage ON shared.number_sequences;
--   DROP POLICY ins_branches_platform_manage ON org.branches;
--   DROP POLICY ins_legal_companies_platform_manage ON org.legal_companies;
--   DROP POLICY sel_number_sequences_platform_manage ON shared.number_sequences;
--   REVOKE SELECT ON shared.number_sequences FROM app_platform;
--   REVOKE SELECT (id, tenant_id, role_code, is_system, deleted_at) ON iam.roles FROM app_platform;
--   DROP POLICY sel_subscription_plans_platform_manage ON org.subscription_plans;
--   DROP POLICY sel_tenant_subscriptions_platform_manage ON org.tenant_subscriptions;
--   DROP POLICY sel_permissions_platform_manage ON iam.permissions;
--   DROP POLICY sel_role_grants_platform_manage ON iam.role_grants;
--   DROP POLICY sel_roles_platform_manage ON iam.roles;
--   DROP POLICY sel_user_accounts_platform_growth ON iam.user_accounts;
--   DROP POLICY sel_branches_platform_growth ON org.branches;
--   DROP POLICY sel_legal_companies_platform_growth ON org.legal_companies;
--   DROP POLICY sel_tenants_platform_manage ON org.tenants;
--   DROP FUNCTION org.plan_capacity_shortfall(uuid, uuid);
--   REVOKE EXECUTE ON FUNCTION org.capacity_usage(uuid) FROM app_platform;
--   REVOKE EXECUTE ON FUNCTION org.capacity_used(uuid, text) FROM app_platform;
--   REVOKE EXECUTE ON FUNCTION org.capacity_limit(uuid, text) FROM app_platform;
-- ----------------------------------------------------------------------------
