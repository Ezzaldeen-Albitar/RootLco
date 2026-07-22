-- ============================================================================
-- Phase: 1-14 — Authentication, Authorization, and Administration Backend
-- Migration: tenant-safe runtime administration write capabilities for
--            identity, session, role, permission, scope, approval-limit and
--            tenant-settings administration
-- Change request: DBCR-P1-14-001
-- Owner module: iam / org
--
-- Purpose
--   The Release 2 baseline, as amended by DBCR-P1-13-001, gives `app_runtime`
--   exactly four write capabilities: append an audit record, publish a domain
--   event, store an idempotency key, and record a security event. Every other
--   `iam` and `org` administration table is SELECT-only for the request role,
--   AND carries no INSERT/UPDATE/DELETE policy at all. With FORCE RLS enabled
--   on all seventeen `iam` tables, that is a double block: adding a privilege
--   alone would still deny, and adding a policy alone would still deny.
--
--   DBCR-P1-14-001 measured the gap by executing every write P1-14 requires as
--   `rootlco_test_runtime`: 22 of 24 probes failed with SQLSTATE 42501. This
--   migration is that change request's approved, minimum, additive remediation.
--
--   Nothing here creates a table, column, constraint, index, sequence, trigger,
--   or function. It adds grants and policies only.
--
-- Dependencies
--   0002 (role archetypes and context readers), 20260716* (iam identity,
--   role, grant, approval and session tables), 20260715* (org.tenants),
--   20260725090000 (DBCR-P1-13-001 foundation write capabilities).
--
-- Rollback classification: ROLLBACK-SAFE (grants and policies only — no data is
--   written, moved, or destroyed). The exact inverse is given at the end of this
--   file. Recorded in
--   docs/phase-1/phase-1-14/phase-1-14-migration-classification.md.
--
-- Security implications
--   * `app_runtime` remains NOLOGIN, non-owner, NOBYPASSRLS, and owns nothing.
--     No role is created, no ownership is transferred, no role attribute changes.
--   * `app_readonly` and `app_worker` gain nothing at all.
--   * Every policy added here is anchored on `tenant_id = iam.current_tenant_id()`
--     and additionally gated on a permission that already exists in the frozen
--     catalogue. There is no `USING (true)` and no `WITH CHECK (true)`. A session
--     with no resolved tenant matches nothing, because the comparison is against
--     NULL; a session whose user is not `active` holds no permission at all,
--     because `iam.has_permission` requires an active, non-deleted account.
--   * NO schema USAGE is granted. NO new function is created. NO existing
--     function body is modified.
--   * DELETE is granted on exactly two tables — `iam.role_permissions` and
--     `iam.grant_scopes` — because withdrawing a permission mapping and
--     withdrawing a scope row are genuine removals with no soft-delete column.
--     Identity, roles, grants, sessions, approval limits, login audit and status
--     history are never destroyed through the request path: they carry
--     `deleted_at`, `status`, `revoked_at` or `effective_to` instead.
--   * The permission catalogue (`iam.permissions`) stays read-only for the
--     runtime. Permission codes are platform reference data; a tenant
--     administrator may map them, never invent them.
--   * `iam.sensitive_data_permissions`, `iam.user_profiles` and
--     `iam.user_employee_links` are deliberately untouched — they are outside the
--     P1-14 administration scope, and a capability nobody needs is a capability
--     nobody should hold.
--   * `org.company_settings` and `org.branch_settings` need nothing: the frozen
--     design makes every column immutable on UPDATE and already grants INSERT
--     with a scoped INSERT policy, so a settings change is a new version row.
--     Only `org.tenants` — which is genuinely mutated in place — is added here.
--
-- Escalation controls carried by the policies themselves
--   Two of these policies do more than scope a row to a tenant; they encode the
--   delegation rule in the database, so an application defect cannot bypass it:
--
--     1. A role→permission mapping with `effect = 'allow'` may only be written by
--        an administrator who already holds that permission (section 6). Deny
--        mappings are always permitted: a deny is de-escalation.
--     2. A role grant may only be written when the administrator already holds
--        every allow-permission that role confers (section 7).
--
--   Together these make "you cannot delegate authority you do not possess"
--   enforceable at the last line of defence rather than only at the service
--   layer. Self-escalation via a role one already administers is therefore
--   impossible: the grant is checked against what the actor holds *now*.
--
-- Bootstrap boundary (deliberate, documented, not a defect)
--   No policy here can create the FIRST administrator of a tenant: with no user
--   accounts, nobody holds `iam.user.manage`, so `ins_user_accounts_admin`
--   matches nothing. Tenant provisioning stays an owner/operator capability
--   (ADR-008, scripts/db/provision-organization.mjs) and is intentionally NOT a
--   runtime request-path capability.
--
-- Objects created
--   Policies:  ins_user_accounts_admin, upd_user_accounts_admin,
--              ins_user_status_history_admin,
--              ins_user_sessions_self, upd_user_sessions_self,
--              upd_user_sessions_admin,
--              ins_login_audit_self,
--              ins_roles_admin, upd_roles_admin,
--              ins_role_permissions_delegable, upd_role_permissions_delegable,
--              del_role_permissions_admin,
--              ins_role_grants_delegable, upd_role_grants_admin,
--              ins_grant_scopes_admin, del_grant_scopes_admin,
--              ins_approval_limits_admin, upd_approval_limits_admin,
--              upd_tenants_settings
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Privileges.
--
--    Table-level INSERT, and column-scoped UPDATE wherever the frozen schema
--    does not already immobilise the sensitive columns with a trigger. Where
--    `org.guard_immutable_columns` already raises on a changed column, a column
--    grant would be redundant belt-and-braces; where it does not, the column
--    grant is the control. Both are stated explicitly per table below.
-- ----------------------------------------------------------------------------

-- Identity. tg_user_accounts_immutable already freezes tenant_id,
-- identity_provider, provider_subject, created_at, created_by — so an
-- administrator can never re-point an account at a different external identity,
-- which is the account-takeover shape this table has to resist.
GRANT INSERT ON iam.user_accounts        TO app_runtime;
GRANT UPDATE (email, display_name, status, mfa_required, deleted_at)
  ON iam.user_accounts                   TO app_runtime;

-- Lifecycle trail. Append-only by construction: no UPDATE, no DELETE. The
-- BEFORE INSERT trigger overwrites actor_id with iam.current_user_id() and
-- refuses a null actor, so authorship cannot be forged even with this grant.
GRANT INSERT ON iam.user_status_history  TO app_runtime;

-- The validated lifecycle transition. SECURITY INVOKER, so it runs under the
-- caller's privileges and policies — this EXECUTE grant confers nothing on its
-- own; the two grants above are what make its body succeed.
GRANT EXECUTE ON FUNCTION iam.change_user_status(uuid, text, text, uuid) TO app_runtime;

-- Sessions. tg_user_sessions_immutable freezes tenant_id, user_id, session_ref
-- and issued_at, so a session row can never be re-owned or re-referenced.
GRANT INSERT ON iam.user_sessions        TO app_runtime;
GRANT UPDATE (last_seen_at, expires_at, revoked_at, revoke_reason, ip_hash, user_agent_hash)
  ON iam.user_sessions                   TO app_runtime;

-- Login audit. Append-only; occurred_at is server-stamped by tg_login_audit_stamp,
-- so events cannot be backdated.
GRANT INSERT ON iam.login_audit          TO app_runtime;

-- Roles. tg_roles_immutable freezes tenant_id, role_code and is_system, so a
-- tenant role can never be renamed into a different code, nor promoted to a
-- system role.
GRANT INSERT ON iam.roles                TO app_runtime;
GRANT UPDATE (name, description, deleted_at) ON iam.roles TO app_runtime;

-- Role→permission mappings. tg_role_permissions_immutable freezes tenant_id,
-- role_id and permission_id, so the only mutable field is `effect` — flipping a
-- mapping between allow and deny. Removal is a DELETE.
GRANT INSERT, DELETE ON iam.role_permissions TO app_runtime;
GRANT UPDATE (effect) ON iam.role_permissions TO app_runtime;

-- Role grants. tg_role_grants_immutable freezes tenant_id, user_id, role_id,
-- granted_by, scope_mode, valid_from and approval_ref: an issued grant can be
-- revoked or time-bounded, never re-pointed at another user or another role.
GRANT INSERT ON iam.role_grants          TO app_runtime;
GRANT UPDATE (status, valid_to, revoked_at, revoke_reason) ON iam.role_grants TO app_runtime;

-- Grant scopes. No UPDATE: a scope row is added or withdrawn, never edited in
-- place, so there is no partial-edit state for the deferred constraint trigger
-- tg_grant_scopes_require_scope to race against.
GRANT INSERT, DELETE ON iam.grant_scopes TO app_runtime;

-- Approval limits. tg_approval_limits_immutable freezes tenant_id, company_id,
-- role_id, user_id, limit_type, amount, currency_code and effective_from — an
-- authorised amount is therefore NOT editable in place. Raising or lowering a
-- limit means closing the current row (effective_to) and inserting the new one,
-- which is what leaves an auditable history instead of a silent overwrite.
GRANT INSERT ON iam.approval_limits      TO app_runtime;
GRANT UPDATE (effective_to) ON iam.approval_limits TO app_runtime;

-- Tenant settings. tg_tenants_immutable_columns freezes tenant_code, created_at
-- and created_by. No INSERT and no DELETE: provisioning and de-provisioning a
-- tenant are operator capabilities, not request-path ones.
GRANT UPDATE (display_name, default_locale, default_timezone) ON org.tenants TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Identity administration policies.
--
--    `iam.user.manage` is the high-risk permission the frozen catalogue already
--    defines for this surface. Note what the UPDATE policy does NOT need to say:
--    it cannot be used to grant anything, because roles and grants live in other
--    tables behind other permissions.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_user_accounts_admin ON iam.user_accounts
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.user.manage'));

CREATE POLICY upd_user_accounts_admin ON iam.user_accounts
  FOR UPDATE TO app_runtime
  USING      (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.user.manage'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.user.manage'));

CREATE POLICY ins_user_status_history_admin ON iam.user_status_history
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.user.manage'));

-- ----------------------------------------------------------------------------
-- 3. Session policies.
--
--    A session row is written at login, for oneself, by a context the server
--    resolved from a verified provider session — so the INSERT is self-scoped
--    rather than permission-gated. Requiring a permission here would be wrong in
--    both directions: it would break login for ordinary users, and it would let
--    anyone holding it forge a session for somebody else.
--
--    Revocation has two legitimate actors, so it has two policies: the owner
--    (logout, idle expiry) and an administrator (`iam.user.manage`). Permissive
--    policies are OR-ed, which is exactly the intent.
--
--    **Revocation is terminal.** Both UPDATE policies carry `revoked_at IS NULL`
--    in `USING`, so a revoked session row is invisible to any further update and
--    can never be resurrected by clearing the column — not by an administrator,
--    and not by its owner. `WITH CHECK` deliberately does NOT repeat the test,
--    because the revoking update is precisely the one that must be allowed to
--    set it. Every legitimate update — idle touch, expiry, logout, forced
--    revocation — targets a live session, so nothing is lost.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_user_sessions_self ON iam.user_sessions
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND user_id = iam.current_user_id());

CREATE POLICY upd_user_sessions_self ON iam.user_sessions
  FOR UPDATE TO app_runtime
  USING      (tenant_id = iam.current_tenant_id() AND user_id = iam.current_user_id()
              AND revoked_at IS NULL)
  WITH CHECK (tenant_id = iam.current_tenant_id() AND user_id = iam.current_user_id());

CREATE POLICY upd_user_sessions_admin ON iam.user_sessions
  FOR UPDATE TO app_runtime
  USING      (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.user.manage')
              AND revoked_at IS NULL)
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.user.manage'));

-- ----------------------------------------------------------------------------
-- 4. Login audit policy.
--
--    Self-scoped for the ordinary success/failure/logout path, plus a narrow
--    administrative arm.
--
--    **The administrative arm is restricted to `lockout`.** An administrator
--    needs to record that they locked somebody's account; they have no business
--    writing a `success`, `failure` or `logout` row against another principal,
--    and allowing it would let `iam.user.manage` fabricate another user's login
--    history in the very table that evidences authentication. Automatic lockout
--    after failed attempts is written by the failing principal itself and is
--    already covered by the self arm.
--
--    A failed attempt against an identifier that resolves to NO account writes
--    nothing: there is no tenant to scope the row to, and inventing one would
--    mean accepting an unauthenticated cross-tenant write. Unknown-identifier
--    attempts are throttled by the IP-keyed rate limiter instead, and the login
--    response is generic either way, so this leaks nothing it did not already.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_login_audit_self ON iam.login_audit
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (
      user_id = iam.current_user_id()
      OR (event_type = 'lockout' AND iam.has_permission('iam.user.manage'))
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Role definition policies. System roles are excluded from UPDATE entirely:
--    `is_system` is already immutable, and this stops the *other* columns of a
--    platform-defined role being repurposed.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_roles_admin ON iam.roles
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('iam.role.manage')
    AND is_system = false
  );

CREATE POLICY upd_roles_admin ON iam.roles
  FOR UPDATE TO app_runtime
  USING      (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.role.manage')
              AND is_system = false)
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.role.manage')
              AND is_system = false);

-- ----------------------------------------------------------------------------
-- 6. Role→permission mapping policies — WITH THE DELEGATION RULE.
--
--    An `allow` mapping may only be written by an administrator who already
--    holds the permission being mapped. This is the database-level answer to
--    privilege escalation through role composition: an administrator with
--    `iam.role.manage` cannot mint themselves `sal.invoice.issue` by adding it
--    to a role they hold, because the WITH CHECK re-evaluates their CURRENT
--    authority against the permission code being written.
--
--    `deny` is unconditional. Removing authority is never an escalation, and a
--    deny that could not be recorded would be a safety regression.
--
--    System roles are protected here too: their mappings are platform contract.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_role_permissions_delegable ON iam.role_permissions
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('iam.role.manage')
    AND NOT EXISTS (
      SELECT 1 FROM iam.roles r
       WHERE r.tenant_id = role_permissions.tenant_id
         AND r.id = role_permissions.role_id
         AND r.is_system
    )
    AND (
      effect = 'deny'
      OR iam.has_permission(
           (SELECT p.permission_code FROM iam.permissions p WHERE p.id = permission_id)
         )
    )
  );

CREATE POLICY upd_role_permissions_delegable ON iam.role_permissions
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('iam.role.manage')
    AND NOT EXISTS (
      SELECT 1 FROM iam.roles r
       WHERE r.tenant_id = role_permissions.tenant_id
         AND r.id = role_permissions.role_id
         AND r.is_system
    )
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('iam.role.manage')
    AND (
      effect = 'deny'
      OR iam.has_permission(
           (SELECT p.permission_code FROM iam.permissions p WHERE p.id = permission_id)
         )
    )
  );

CREATE POLICY del_role_permissions_admin ON iam.role_permissions
  FOR DELETE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('iam.role.manage')
    AND NOT EXISTS (
      SELECT 1 FROM iam.roles r
       WHERE r.tenant_id = role_permissions.tenant_id
         AND r.id = role_permissions.role_id
         AND r.is_system
    )
  );

-- ----------------------------------------------------------------------------
-- 7. Role grant policies — WITH THE DELEGATION RULE.
--
--    Issuing a grant hands the target every allow-permission the role confers.
--    The INSERT policy therefore requires the issuer to already hold all of
--    them: you cannot elevate someone (or, via a second account, yourself) past
--    your own authority by handing over a role you were never entitled to give.
--
--    Revocation (UPDATE) carries no such test. Withdrawing a grant is
--    de-escalation, and the immutability trigger already confines an UPDATE to
--    status, valid_to, revoked_at and revoke_reason.
--
--    `ck_role_grants_no_self_grant` already forbids granted_by = user_id at the
--    constraint layer, so the trivial self-grant is rejected before any policy
--    is consulted.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_role_grants_delegable ON iam.role_grants
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND iam.has_permission('iam.grant.manage')
    AND NOT EXISTS (
      SELECT 1
        FROM iam.role_permissions rp
        JOIN iam.permissions p ON p.id = rp.permission_id
       WHERE rp.tenant_id = role_grants.tenant_id
         AND rp.role_id   = role_grants.role_id
         AND rp.effect    = 'allow'
         AND NOT iam.has_permission(p.permission_code)
    )
  );

CREATE POLICY upd_role_grants_admin ON iam.role_grants
  FOR UPDATE TO app_runtime
  USING      (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.grant.manage'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.grant.manage'));

-- ----------------------------------------------------------------------------
-- 8. Grant scope policies. The company/branch/department columns are already
--    constrained by composite foreign keys into org.legal_companies,
--    org.branches and org.departments carrying tenant_id, so a scope row cannot
--    reference another tenant's company even if a policy tried to allow it.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_grant_scopes_admin ON iam.grant_scopes
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.grant.manage'));

CREATE POLICY del_grant_scopes_admin ON iam.grant_scopes
  FOR DELETE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.grant.manage'));

-- ----------------------------------------------------------------------------
-- 9. Approval-limit policies. `iam.approval.manage` is the frozen catalogue's
--    high-risk permission for authorised-amount administration.
-- ----------------------------------------------------------------------------
CREATE POLICY ins_approval_limits_admin ON iam.approval_limits
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.approval.manage'));

CREATE POLICY upd_approval_limits_admin ON iam.approval_limits
  FOR UPDATE TO app_runtime
  USING      (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.approval.manage'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.approval.manage'));

-- ----------------------------------------------------------------------------
-- 10. Tenant settings policy. `id = iam.current_tenant_id()` on both sides: a
--     tenant administrator edits their own tenant row and no other, and cannot
--     move the row to another tenant because the primary key is the tenant.
-- ----------------------------------------------------------------------------
CREATE POLICY upd_tenants_settings ON org.tenants
  FOR UPDATE TO app_runtime
  USING      (id = iam.current_tenant_id() AND iam.has_permission('org.settings.manage'))
  WITH CHECK (id = iam.current_tenant_id() AND iam.has_permission('org.settings.manage'));

-- ============================================================================
-- ROLLBACK (exact inverse — grants and policies only; no data is touched)
--
-- DROP POLICY upd_tenants_settings              ON org.tenants;
-- DROP POLICY upd_approval_limits_admin         ON iam.approval_limits;
-- DROP POLICY ins_approval_limits_admin         ON iam.approval_limits;
-- DROP POLICY del_grant_scopes_admin            ON iam.grant_scopes;
-- DROP POLICY ins_grant_scopes_admin            ON iam.grant_scopes;
-- DROP POLICY upd_role_grants_admin             ON iam.role_grants;
-- DROP POLICY ins_role_grants_delegable         ON iam.role_grants;
-- DROP POLICY del_role_permissions_admin        ON iam.role_permissions;
-- DROP POLICY upd_role_permissions_delegable    ON iam.role_permissions;
-- DROP POLICY ins_role_permissions_delegable    ON iam.role_permissions;
-- DROP POLICY upd_roles_admin                   ON iam.roles;
-- DROP POLICY ins_roles_admin                   ON iam.roles;
-- DROP POLICY ins_login_audit_self              ON iam.login_audit;
-- DROP POLICY upd_user_sessions_admin           ON iam.user_sessions;
-- DROP POLICY upd_user_sessions_self            ON iam.user_sessions;
-- DROP POLICY ins_user_sessions_self            ON iam.user_sessions;
-- DROP POLICY ins_user_status_history_admin     ON iam.user_status_history;
-- DROP POLICY upd_user_accounts_admin           ON iam.user_accounts;
-- DROP POLICY ins_user_accounts_admin           ON iam.user_accounts;
--
-- REVOKE UPDATE (display_name, default_locale, default_timezone) ON org.tenants FROM app_runtime;
-- REVOKE UPDATE (effective_to) ON iam.approval_limits FROM app_runtime;
-- REVOKE INSERT ON iam.approval_limits FROM app_runtime;
-- REVOKE INSERT, DELETE ON iam.grant_scopes FROM app_runtime;
-- REVOKE UPDATE (status, valid_to, revoked_at, revoke_reason) ON iam.role_grants FROM app_runtime;
-- REVOKE INSERT ON iam.role_grants FROM app_runtime;
-- REVOKE UPDATE (effect) ON iam.role_permissions FROM app_runtime;
-- REVOKE INSERT, DELETE ON iam.role_permissions FROM app_runtime;
-- REVOKE UPDATE (name, description, deleted_at) ON iam.roles FROM app_runtime;
-- REVOKE INSERT ON iam.roles FROM app_runtime;
-- REVOKE INSERT ON iam.login_audit FROM app_runtime;
-- REVOKE UPDATE (last_seen_at, expires_at, revoked_at, revoke_reason, ip_hash, user_agent_hash)
--   ON iam.user_sessions FROM app_runtime;
-- REVOKE INSERT ON iam.user_sessions FROM app_runtime;
-- REVOKE EXECUTE ON FUNCTION iam.change_user_status(uuid, text, text, uuid) FROM app_runtime;
-- REVOKE INSERT ON iam.user_status_history FROM app_runtime;
-- REVOKE UPDATE (email, display_name, status, mfa_required, deleted_at)
--   ON iam.user_accounts FROM app_runtime;
-- REVOKE INSERT ON iam.user_accounts FROM app_runtime;
-- ============================================================================
