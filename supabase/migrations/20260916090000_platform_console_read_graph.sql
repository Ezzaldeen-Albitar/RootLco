-- ============================================================================
-- P1-32-PRE-022 — the Platform Owner Console READ graph.
-- Owner module: platform (privileges and policies only)
--
-- Rollback classification: NON-DESTRUCTIVE. Grants and policies only. No object
--   is created or destroyed and no row is touched. Revoking everything here
--   returns app_platform to exactly the reach it had before.
--
-- Purpose
--   The control plane shipped with a READ surface sized for ONE job: creating a
--   tenant. Measured against the live catalogue at this head, every child-table
--   SELECT policy app_platform holds is predicated on
--   `platform.organization.provision` AND on the parent tenant still sitting in
--   `status = 'provisioning'`:
--
--     sel_legal_companies_platform       provisioning only
--     sel_branches_platform              provisioning only
--     sel_tenant_subscriptions_platform  provisioning only
--     sel_subscription_plans_platform    provision authority only
--     org.tenant_status_history          NO SELECT policy and NO SELECT grant
--     iam.user_accounts                  one row, the operator's own
--
--   So an operator holding `platform.organization.read` can list tenant ROOTS
--   and nothing else: the moment a tenant leaves the bootstrap window its
--   companies, branches and subscriptions become unreadable to the very
--   authority whose name says it may read organizations. A console cannot be
--   built on that, and widening the existing policies is not an option — they
--   are already merged and a migration is immutable. This file adds NEW
--   policies beside them.
--
--   Policies are PERMISSIVE and therefore OR together. Each policy below is
--   written so that it admits rows only to a holder of the named read
--   authority; a non-holder sees exactly what it saw before this migration.
--
-- THE COLUMN-SCOPED GRANT ON iam.user_accounts
--   20260831093000 states that its two column-scoped grants must never be
--   WIDENED TO TABLE LEVEL, because privileges union and a table-wide grant
--   would silently void the narrow one. That rule is kept: this file adds ONE
--   further column, `tenant_id`, and adds no table-level grant. The resulting
--   list is (id, tenant_id, status, deleted_at) — an identifier, an owner, a
--   lifecycle state and a tombstone. No email, no display name, no provider
--   subject, no phone. A cross-tenant read of this table can therefore produce
--   a COUNT and nothing a person could be recognised by, which is the whole
--   requirement: the console reports how many accounts an organisation has, not
--   who they are.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT GRANT
--   No UPDATE, no INSERT, no DELETE anywhere. It is a read graph.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. org.tenants children, for a tenant in ANY state.
--
--    Each mirrors its provisioning-window sibling with the window term removed
--    and the authority changed to the read one. The pair is deliberate: the
--    provisioning path keeps its own narrow policy, so revoking the read
--    authority cannot break provisioning and vice versa.
-- ----------------------------------------------------------------------------
CREATE POLICY sel_legal_companies_platform_console ON org.legal_companies
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.read'));

COMMENT ON POLICY sel_legal_companies_platform_console ON org.legal_companies IS
  'Console read: every legal company of every tenant, for a holder of platform.organization.read. Beside sel_legal_companies_platform, which stays bound to the provisioning window.';

CREATE POLICY sel_branches_platform_console ON org.branches
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.read'));

COMMENT ON POLICY sel_branches_platform_console ON org.branches IS
  'Console read: every branch of every tenant, for a holder of platform.organization.read.';

CREATE POLICY sel_tenant_subscriptions_platform_console ON org.tenant_subscriptions
  FOR SELECT TO app_platform
  USING (
       iam.has_platform_authority('platform.organization.read')
    OR iam.has_platform_authority('platform.subscription.manage')
    OR iam.has_platform_authority('platform.statistics.read')
    OR iam.has_platform_authority('platform.organization.lifecycle')
  );

COMMENT ON POLICY sel_tenant_subscriptions_platform_console ON org.tenant_subscriptions IS
  'Console read: every subscription assignment of every tenant. Four authorities because four surfaces read it — the organisation detail, the subscription administration, the statistics roll-up, and the lifecycle transition, which attaches a suspended/reactivated event to the assignment it interrupts.';

CREATE POLICY sel_subscription_plans_platform_console ON org.subscription_plans
  FOR SELECT TO app_platform
  USING (
       iam.has_platform_authority('platform.organization.read')
    OR iam.has_platform_authority('platform.subscription.manage')
    OR iam.has_platform_authority('platform.statistics.read')
  );

COMMENT ON POLICY sel_subscription_plans_platform_console ON org.subscription_plans IS
  'Console read of the plan catalogue. The pre-existing sel_subscription_plans_platform serves the provisioning path alone.';

-- ----------------------------------------------------------------------------
-- 2. org.tenant_status_history — the first SELECT app_platform has ever held.
--
--    20260831093000 states plainly that it grants none, because no Wave-B path
--    read the table back. The console's organisation detail publishes the
--    lifecycle trail, so the grant is made here, narrowly, with its own policy.
--    The INSERT stays exactly as it was: column-scoped, two authorities.
-- ----------------------------------------------------------------------------
GRANT SELECT ON org.tenant_status_history TO app_platform;

CREATE POLICY sel_tenant_status_history_platform ON org.tenant_status_history
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.read'));

COMMENT ON POLICY sel_tenant_status_history_platform ON org.tenant_status_history IS
  'Console read of the tenant lifecycle trail. Read only: the append path is ins_tenant_status_history_platform and is unchanged.';

-- ----------------------------------------------------------------------------
-- 3. iam.user_accounts — counts across tenants, identities never.
--
--    The grant gains ONE column so a count can be grouped by owner. The policy
--    carries no row term beyond the authority test, which is what makes it a
--    platform read; the COLUMN grant is what keeps it anonymous.
--
--    THE AUTHORITY TEST HERE IS NOT iam.has_platform_authority, AND MUST NOT BE.
--    That resolver JOINs iam.user_accounts to check the operator's account is
--    active. A policy ON iam.user_accounts that calls it would re-enter this
--    same policy while evaluating it, and PostgreSQL answers that with
--    "infinite recursion detected in policy" (or a blown stack) on EVERY read
--    of the table by app_platform — including the resolver's own read inside
--    every other platform policy, which would take the whole control plane down.
--
--    So the predicate reads iam.platform_grants alone, under
--    sel_platform_grants_own, which never touches iam.user_accounts. What it
--    omits is the account-active half of the resolver, and that omission is
--    closed elsewhere rather than ignored: no statement reaches this table on
--    the request path without first passing the operation's own authorization,
--    which IS iam.has_platform_authority, account-active test included. A
--    suspended operator is refused before this policy is ever evaluated.
-- ----------------------------------------------------------------------------
GRANT SELECT (tenant_id) ON iam.user_accounts TO app_platform;

CREATE POLICY sel_user_accounts_platform_census ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (
    EXISTS (
      SELECT 1
        FROM iam.platform_grants g
       WHERE g.account_id = iam.current_user_id()
         AND g.revoked_at IS NULL
         AND g.permission_code IN ('platform.organization.read', 'platform.statistics.read')
    )
  );

COMMENT ON POLICY sel_user_accounts_platform_census ON iam.user_accounts IS
  'Console census: rows of ANY tenant, readable ONLY through the column-scoped grant (id, tenant_id, status, deleted_at). No email, display name or provider subject is reachable, so this policy can produce a count and can never produce an identity. Its authority test reads iam.platform_grants directly rather than calling iam.has_platform_authority, because that resolver reads this table and would recurse into this policy. Beside sel_user_accounts_platform_self, which remains the resolver''s own one-row read.';

DO $$
BEGIN
  RAISE NOTICE '[RootLco] Platform console read graph applied: 6 SELECT policies, 2 grants.';
END $$;
