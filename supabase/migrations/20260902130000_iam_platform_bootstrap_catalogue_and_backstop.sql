-- ============================================================================
-- P1-29 W9 — the two privileges the First-Owner bootstrap (B7, §6.3) still owed.
--
-- The bootstrap policies shipped in 20260831093000 admit the whole two-role
-- bootstrap as they stand: measured live as the platform login, every one of
-- iam.user_accounts, iam.user_status_history, iam.roles, iam.role_permissions
-- and iam.role_grants takes its INSERT under the three-term predicate (row
-- tenant = current tenant, that tenant still `provisioning`, the actor holding
-- `platform.organization.provision`). None of them pins a role code or a
-- permission set, so a second, server-owned role written in the same window is
-- admitted by the same predicate. THIS FILE DOES NOT TOUCH THEM.
--
-- What the same measurement refused, and this file grants — nothing more:
--
--   1. `iam.permissions` is unreadable by app_platform, and
--      iam.role_permissions.permission_id is a surrogate key with a foreign key
--      into it (20260718091000:125,138). Mapping a role to permission CODES means
--      resolving each code to its row first, as the writing role. The grant is
--      COLUMN-SCOPED to the two columns that resolution needs; `description`,
--      `domain`, `risk_level` and the metadata stay unreadable (measured: the
--      column read is admitted, a `description` read is still refused). The
--      policy carries the same authority term as every §6.3 policy: a platform
--      login without a provisioning grant resolves nothing.
--
--   2. The deferred constraint trigger tg_role_grants_delegation_authority
--      (20260727090000) fires on every iam.role_grants INSERT and calls
--      iam.grant_delegation_within_authority() AS THE WRITING ROLE. That function
--      was granted to app_runtime only, so the bootstrap's grant write aborted at
--      COMMIT with "permission denied for function
--      grant_delegation_within_authority" — after every row-level policy had
--      admitted the row. The function's own second clause returns true for any
--      role that is not an app_runtime member, which is the frozen decision for
--      the bootstrap path (design v2 §9.2: containment is the window, the row
--      term and the authority term, not the backstop). EXECUTE is what lets that
--      clause be reached.
--
-- Neither statement widens what a tenant administrator may delegate:
-- ins_role_permissions_delegable and ins_role_grants_delegable are untouched,
-- app_runtime receives nothing here, and app_platform still holds no privilege
-- on iam.permissions beyond the two columns, none on iam.grant_scopes, and no
-- table-level SELECT on iam.user_accounts.
-- ============================================================================

GRANT SELECT (id, permission_code) ON iam.permissions TO app_platform;

CREATE POLICY sel_permissions_platform_bootstrap ON iam.permissions
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.provision'));

COMMENT ON POLICY sel_permissions_platform_bootstrap ON iam.permissions IS
  'P1-29 W9 (B7 §6.3): the catalogue read the First-Owner bootstrap needs to resolve permission codes to rows, admitted only to a platform login holding platform.organization.provision. The GRANT is column-scoped to (id, permission_code).';

GRANT EXECUTE ON FUNCTION iam.grant_delegation_within_authority(uuid) TO app_platform;

-- Rollback: DROP POLICY sel_permissions_platform_bootstrap ON iam.permissions;
--           REVOKE SELECT (id, permission_code) ON iam.permissions FROM app_platform;
--           REVOKE EXECUTE ON FUNCTION iam.grant_delegation_within_authority(uuid) FROM app_platform;
