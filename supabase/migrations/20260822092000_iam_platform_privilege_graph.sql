-- ============================================================================
-- Migration: platform privilege graph (PRE-P1-29 Wave B, slice B1)
--
-- Specification: wave-b-control-plane-design-v2.md revision 4, sections 6 and 7
--                (migration M2). Merged as c081a019, reviewed head 0bb6d882.
--
-- Why this file is written the way it is
--   Three adversarial passes over the design found FIVE instances of one defect,
--   and every one of them was an UNDER-grant: a privilege the runtime path
--   genuinely needs that the design had not enumerated, because it reasoned at
--   the entry point rather than along the whole SECURITY INVOKER call chain.
--
--     B1  the audit writer's three helpers (iam.audit_mask/canonical/hash)
--     B2  the resolver's own read of iam.user_accounts
--     B3  a FOR UPDATE policy whose USING was reused as its check
--     4   org.change_tenant_status's `SELECT ... FOR UPDATE` on org.tenants
--     5   org.change_tenant_status's SECOND write, org.tenant_status_history,
--         left to a policy whose predicate the first write makes false
--
--   So this file is organised BY EXECUTION PATH rather than by object type, and
--   each path lists every link: entry function, called functions, trigger
--   functions, table privileges, and the row-level policy for each action. A
--   privilege with no stated caller does not belong here.
--
--   The repository's own privilege gate could not have caught any of the five:
--   scripts/ci/rls-matrix.mjs:236-237 short-circuits on `if (!granted)`, so it
--   detects OVER-granting and is structurally blind to under-granting, and it
--   tests table privileges only (:87, :221-224) so function grants are outside
--   it entirely. tests/db/platform-privilege-closure.test.ts is the compensating
--   control: it asserts REQUIRED -> PRESENT, the opposite direction.
--
-- Security implications
--   * app_platform receives NO privilege on any tenant business table. The one
--     identity read it holds is column-scoped to three columns of
--     iam.user_accounts and row-scoped to the operator's own row.
--   * Every policy carries a real predicate. There is no USING (true).
--   * The bootstrap window — `org.tenants.status = 'provisioning'` — is the
--     containment for every identity write. It closes on the tenant's first
--     legal transition, and the previous migration makes it impossible to
--     reopen.
--   * The lifecycle UPDATE policy carries an explicit WITH CHECK; without one a
--     FOR UPDATE policy reuses its USING as the check, which is how the design
--     admitted `provisioning` as a destination.
--   * No SECURITY DEFINER is introduced, and none is needed.
--   * app_platform is NOT granted membership in app_runtime, deliberately: the
--     delegation backstop exits early for a non-member (20260727090000:108-110),
--     so membership would silently change that function's behaviour.
--
-- Objects created
--   Grants and policies only. No table, no function, no trigger.
-- ============================================================================

-- ============================================================================
-- PATH 0 — context and authority resolution (design 5.2, 7.2)
--   Reached by: every path below, and by every policy predicate in this file.
-- ============================================================================

-- Context readers. iam.current_user_id() is reached on five paths: the resolver
-- below, org.provision_organization (20260717107000:121),
-- org.change_tenant_status (20260717101000:193), shared.touch_row_metadata
-- (0002_base_schemas.sql:195) fired by every row-metadata trigger, and
-- iam.stamp_user_status_history (20260718090000:238).
-- iam.current_tenant_id() is reached by every audit policy in PATH 4.
GRANT EXECUTE ON FUNCTION iam.current_user_id()   TO app_platform;
GRANT EXECUTE ON FUNCTION iam.current_tenant_id() TO app_platform;

-- B1-UG-002, found by EXECUTION. Design section 7.2 enumerated the two CONTEXT
-- readers and stopped at the two NARROWING readers — and C9, the most dangerous
-- assumption of the whole wave, is only checkable at runtime by calling them.
-- Without these, a platform session asking 'what narrowing do I carry?' raises
-- 42501 instead of answering, so the proof that an absent scope does not widen
-- could not be executed at all.
--
-- Granting them widens nothing: both are STABLE readers that return only what
-- the session itself set, and app_platform holds no grant on any business table
-- for a narrowing value to apply to.
GRANT EXECUTE ON FUNCTION iam.allowed_company_ids() TO app_platform;
GRANT EXECUTE ON FUNCTION iam.allowed_branch_ids()  TO app_platform;

-- The resolver itself, evaluated as app_platform inside every policy below.
GRANT EXECUTE ON FUNCTION iam.has_platform_authority(text) TO app_platform;

-- Its two reads. Without these the resolver raises insufficient_privilege at
-- executor start rather than answering false, and every policy that calls it
-- becomes unreachable rather than merely restrictive.
GRANT SELECT ON iam.platform_grants TO app_platform;

GRANT SELECT (id, status, deleted_at) ON iam.user_accounts TO app_platform;

CREATE POLICY sel_user_accounts_platform_self ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (id = iam.current_user_id());

COMMENT ON POLICY sel_user_accounts_platform_self ON iam.user_accounts IS
  'The control-plane resolver''s existence-and-active test, and the ONLY read app_platform holds on an identity table outside a bootstrap window. One row — the operator''s own — and three columns, granted separately. It carries no tenant term so it resolves in both platform request shapes, including the one that runs before any tenant exists.';

-- ============================================================================
-- PATH 1 — organisation read (design 6.5)
--   Entry: a SELECT on org.tenants from the control plane.
-- ============================================================================

GRANT SELECT ON org.tenants TO app_platform;

-- Satisfiable by ANY platform authority, not only the read code: the lifecycle
-- path must read the row it is about to change, and the three codes are
-- deliberately separable (design 4.2). Written out rather than described.
CREATE POLICY sel_tenants_platform ON org.tenants
  FOR SELECT TO app_platform
  USING (
    iam.has_platform_authority('platform.organization.read')
    OR iam.has_platform_authority('platform.organization.lifecycle')
    OR iam.has_platform_authority('platform.organization.provision')
  );

COMMENT ON POLICY sel_tenants_platform ON org.tenants IS
  'Control-plane read of the tenant root, and nothing beneath it: an operator can see that a tenant exists and what state it is in, never its customers, vehicles or work. Satisfiable by any of the three platform codes because org.change_tenant_status opens with SELECT ... FOR UPDATE (20260717101000:199) — a lifecycle-only holder that could not read would receive no_data_found instead of acting.';

-- ============================================================================
-- PATH 2 — provisioning (design 6.2)
--   Entry:  org.provision_organization(jsonb, text), SECURITY INVOKER
--   Writes: ten tables, :132 :142 :158 :172 :187 :204 :214 :226 :242 :270
--   Reads:  the replay table, the plan catalogue, and four RETURNING targets
-- ============================================================================

GRANT EXECUTE ON FUNCTION org.provision_organization(jsonb, text) TO app_platform;

-- Trigger functions fired by those ten writes. A role cannot fire a trigger it
-- may not execute, and each of these is a SECURITY INVOKER guard.
GRANT EXECUTE ON FUNCTION org.guard_parent_company_live() TO app_platform;
GRANT EXECUTE ON FUNCTION org.validate_setting_value()    TO app_platform;

-- --- the tenant root ---------------------------------------------------------
-- The platform role may only ever CREATE a tenant in the provisioning state.
-- It may never insert one that is already live.
GRANT INSERT ON org.tenants TO app_platform;

CREATE POLICY ins_tenants_platform_provisioning ON org.tenants
  FOR INSERT TO app_platform
  WITH CHECK (
    status = 'provisioning'
    AND iam.has_platform_authority('platform.organization.provision')
  );

COMMENT ON POLICY ins_tenants_platform_provisioning ON org.tenants IS
  'Provisioning creates a tenant in the provisioning state or not at all. This is the head of the bootstrap window: every identity write below is predicated on the tenant still being in it, and the window closes on the first legal transition.';

-- --- children of a tenant still inside the bootstrap window -------------------
GRANT INSERT ON org.tenant_status_history   TO app_platform;
GRANT INSERT ON org.tenant_subscriptions    TO app_platform;
GRANT INSERT ON org.legal_companies         TO app_platform;
GRANT INSERT ON org.branches                TO app_platform;
GRANT INSERT ON org.company_settings        TO app_platform;
GRANT INSERT ON org.branch_settings         TO app_platform;
GRANT INSERT ON org.tenant_feature_overrides TO app_platform;
GRANT INSERT ON shared.number_sequences     TO app_platform;

CREATE POLICY ins_tenant_subscriptions_platform ON org.tenant_subscriptions
  FOR INSERT TO app_platform
  WITH CHECK (EXISTS (SELECT 1 FROM org.tenants t
                       WHERE t.id = tenant_subscriptions.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_legal_companies_platform ON org.legal_companies
  FOR INSERT TO app_platform
  WITH CHECK (EXISTS (SELECT 1 FROM org.tenants t
                       WHERE t.id = legal_companies.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_branches_platform ON org.branches
  FOR INSERT TO app_platform
  WITH CHECK (EXISTS (SELECT 1 FROM org.tenants t
                       WHERE t.id = branches.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_company_settings_platform ON org.company_settings
  FOR INSERT TO app_platform
  WITH CHECK (EXISTS (SELECT 1 FROM org.tenants t
                       WHERE t.id = company_settings.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_branch_settings_platform ON org.branch_settings
  FOR INSERT TO app_platform
  WITH CHECK (EXISTS (SELECT 1 FROM org.tenants t
                       WHERE t.id = branch_settings.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_tenant_feature_overrides_platform ON org.tenant_feature_overrides
  FOR INSERT TO app_platform
  WITH CHECK (EXISTS (SELECT 1 FROM org.tenants t
                       WHERE t.id = tenant_feature_overrides.tenant_id AND t.status = 'provisioning'));
CREATE POLICY ins_number_sequences_platform ON shared.number_sequences
  FOR INSERT TO app_platform
  WITH CHECK (EXISTS (SELECT 1 FROM org.tenants t
                       WHERE t.id = number_sequences.tenant_id AND t.status = 'provisioning'));

-- The status-history insert performed BY PROVISIONING. It is separate from the
-- lifecycle one in PATH 3 for a reason the design learned the hard way: on the
-- provisioning path the tenant row is inserted first and is still
-- `provisioning` when its history row lands, and on the lifecycle path it is
-- not. One predicate cannot serve both.
CREATE POLICY ins_tenant_status_history_platform_provisioning ON org.tenant_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    to_state = 'provisioning'
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = tenant_status_history.tenant_id AND t.status = 'provisioning')
  );

-- --- reads the provisioning body performs ------------------------------------
-- RETURNING is evaluated against the SELECT policy, so four of these are reads
-- precisely because they are writes.
GRANT SELECT ON org.legal_companies      TO app_platform;
GRANT SELECT ON org.branches             TO app_platform;
GRANT SELECT ON org.tenant_subscriptions TO app_platform;
GRANT SELECT ON org.subscription_plans   TO app_platform;

CREATE POLICY sel_legal_companies_platform ON org.legal_companies
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = legal_companies.tenant_id AND t.status = 'provisioning'));
CREATE POLICY sel_branches_platform ON org.branches
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = branches.tenant_id AND t.status = 'provisioning'));
CREATE POLICY sel_tenant_subscriptions_platform ON org.tenant_subscriptions
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = tenant_subscriptions.tenant_id AND t.status = 'provisioning'));
CREATE POLICY sel_subscription_plans_platform ON org.subscription_plans
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.provision'));

-- --- replay protection --------------------------------------------------------
-- Narrow on BOTH axes: the tenant column absent AND the operation name fixed.
-- app_platform must not be able to read or write any tenant's replay records.
GRANT SELECT, INSERT ON shared.idempotency_keys TO app_platform;

CREATE POLICY sel_idempotency_keys_platform ON shared.idempotency_keys
  FOR SELECT TO app_platform
  USING (tenant_id IS NULL AND operation = 'org_provisioning');
CREATE POLICY ins_idempotency_keys_platform ON shared.idempotency_keys
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id IS NULL AND operation = 'org_provisioning');

COMMENT ON POLICY sel_idempotency_keys_platform ON shared.idempotency_keys IS
  'Platform-scope replay rows only — the tenant column absent AND the operation fixed. The runtime''s own policies read tenant_id = iam.current_tenant_id(), which is never true for a platform row, so provisioning could not use replay protection at all without this pair; and the operation predicate stops the control plane reading any tenant''s replay history.';

-- ============================================================================
-- PATH 3 — tenant lifecycle (design 6.4)
--   Entry:  org.change_tenant_status(...), SECURITY INVOKER
--   Body:   SELECT ... FOR UPDATE (:199), UPDATE (:219), INSERT history (:221)
--   The three statements need three different privileges, and the design
--   enumerated only the middle one until the fourth and fifth review findings.
-- ============================================================================

GRANT EXECUTE ON FUNCTION org.change_tenant_status(uuid, text, text, uuid, uuid) TO app_platform;

-- Trigger functions fired by the UPDATE at :219.
GRANT EXECUTE ON FUNCTION shared.touch_row_metadata()             TO app_platform;
GRANT EXECUTE ON FUNCTION org.guard_immutable_columns()           TO app_platform;
GRANT EXECUTE ON FUNCTION org.guard_tenant_status_transition()    TO app_platform;

-- The status column only, in the shape the repository already uses for a
-- column-scoped grant (20260726090000:174) — noting that grant deliberately
-- WITHHOLDS status, so this is a new privilege and not a precedent for itself.
GRANT UPDATE (status) ON org.tenants TO app_platform;

-- USING selects the rows this operator may act on; WITH CHECK constrains what
-- they may become. Both are required: a FOR UPDATE policy with only a USING
-- clause reuses it as the check, and `provisioning` would pass.
CREATE POLICY upd_tenants_platform_lifecycle ON org.tenants
  FOR UPDATE TO app_platform
  USING (iam.has_platform_authority('platform.organization.lifecycle'))
  WITH CHECK (
    iam.has_platform_authority('platform.organization.lifecycle')
    AND status IN ('active', 'suspended', 'closed')
  );

COMMENT ON POLICY upd_tenants_platform_lifecycle ON org.tenants IS
  'Control-plane lifecycle. The WITH CHECK refuses `provisioning` as a destination, so the bootstrap window cannot be reopened by an UPDATE; org.guard_tenant_status_transition enforces the full graph for every writer as the backstop behind it. The destination list alone is NOT the graph — closed -> active passes this check and is refused by the trigger.';

-- The SECOND write. §6.2's child predicate cannot serve it: the UPDATE two
-- statements earlier has already moved the parent out of `provisioning`, so
-- that predicate is false for EVERY lifecycle transition.
CREATE POLICY ins_tenant_status_history_platform_lifecycle ON org.tenant_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.lifecycle')
    AND to_state IN ('active', 'suspended', 'closed')
  );

COMMENT ON POLICY ins_tenant_status_history_platform_lifecycle ON org.tenant_status_history IS
  'The history half of a lifecycle transition. A SEPARATE policy from the provisioning one, because org.change_tenant_status updates the parent (20260717101000:219) BEFORE inserting the history row (:221) — so the provisioning predicate, which requires the parent to still be `provisioning`, is false for every transition the graph permits. This was the fifth under-grant the design review found, and it is why the two paths carry two policies.';

-- ============================================================================
-- PATH 4 — audit (design 7)
--   Entry: iam.audit_append(...), SECURITY INVOKER, whose body performs three
--   inserts, two read-backs and a chain read, and calls three helpers.
-- ============================================================================

GRANT EXECUTE ON FUNCTION
  iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb)
  TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_mask(text, text)  TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid)   TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_hash(bytea, text) TO app_platform;

GRANT INSERT, SELECT ON iam.audit_records         TO app_platform;
GRANT INSERT, SELECT ON iam.audit_record_details  TO app_platform;
GRANT INSERT, SELECT ON iam.audit_integrity_links TO app_platform;

CREATE POLICY ins_audit_records_platform ON iam.audit_records
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_audit_record_details_platform ON iam.audit_record_details
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_audit_integrity_links_platform ON iam.audit_integrity_links
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- Writer-scoped reads, mirroring the runtime's: a record with no chain link yet
-- is the row being written, and after COMMIT it is never any row. Committed
-- audit history stays behind iam.audit.view for every role.
CREATE POLICY sel_audit_records_platform_unlinked ON iam.audit_records
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND NOT EXISTS (SELECT 1 FROM iam.audit_integrity_links l
                     WHERE l.audit_record_id = iam.audit_records.id)
  );
CREATE POLICY sel_audit_record_details_platform_unlinked ON iam.audit_record_details
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND NOT EXISTS (SELECT 1 FROM iam.audit_integrity_links l
                     WHERE l.audit_record_id = iam.audit_record_details.audit_record_id)
  );
CREATE POLICY sel_audit_integrity_links_platform_chain ON iam.audit_integrity_links
  FOR SELECT TO app_platform
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_audit_records_platform_unlinked ON iam.audit_records IS
  'Writer-scoped read, NOT an audit-history read: exposes only a record with no chain link, which inside iam.audit_append is the row under construction and after COMMIT is never any row. No UPDATE or DELETE privilege exists on any audit table for any role, so the platform principal can append its own event and read it back, and can never amend or remove one — its own included.';

-- ============================================================================
-- PATH 5 — initial Owner bootstrap (design 6.3)
--   Every write is predicated on BOTH the bootstrap window and the provisioning
--   authority. The window closes on the tenant's first legal transition, so
--   this reach is self-limiting with no second mechanism to remember.
-- ============================================================================

GRANT EXECUTE ON FUNCTION iam.stamp_user_status_history()               TO app_platform;
GRANT EXECUTE ON FUNCTION iam.enforce_scoped_grant_has_scope()          TO app_platform;
GRANT EXECUTE ON FUNCTION iam.grant_delegation_within_authority(uuid)   TO app_platform;
GRANT EXECUTE ON FUNCTION iam.enforce_grant_delegation_within_authority() TO app_platform;

GRANT INSERT ON iam.user_accounts       TO app_platform;
GRANT INSERT ON iam.user_status_history TO app_platform;
GRANT INSERT ON iam.roles               TO app_platform;
GRANT INSERT ON iam.role_permissions    TO app_platform;
GRANT INSERT, SELECT ON iam.role_grants TO app_platform;
GRANT INSERT, SELECT ON iam.grant_scopes TO app_platform;

-- The permission catalogue is platform reference data with no tenant column;
-- mapping the Owner role to permission CODES means resolving each to its row,
-- because iam.role_permissions.permission_id is a surrogate key
-- (20260718091000:125, :138).
GRANT SELECT ON iam.permissions TO app_platform;
CREATE POLICY sel_permissions_platform ON iam.permissions
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.provision'));

CREATE POLICY ins_user_accounts_platform_bootstrap ON iam.user_accounts
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = user_accounts.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_user_status_history_platform_bootstrap ON iam.user_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = user_status_history.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_roles_platform_bootstrap ON iam.roles
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = roles.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_role_permissions_platform_bootstrap ON iam.role_permissions
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = role_permissions.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_role_grants_platform_bootstrap ON iam.role_grants
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = role_grants.tenant_id AND t.status = 'provisioning')
  );
CREATE POLICY ins_grant_scopes_platform_bootstrap ON iam.grant_scopes
  FOR INSERT TO app_platform
  WITH CHECK (
    iam.has_platform_authority('platform.organization.provision')
    AND EXISTS (SELECT 1 FROM org.tenants t
                 WHERE t.id = grant_scopes.tenant_id AND t.status = 'provisioning')
  );

-- B1-UG-001, found by EXECUTION and not by review: every bootstrap write is
-- read back. `INSERT ... RETURNING id` is evaluated against the SELECT policy,
-- and the bootstrap needs each id it creates — the account to grant a role to,
-- the role to map permissions onto. With only the write policies a plain INSERT
-- succeeds and the same INSERT with RETURNING fails 42501, which is the most
-- misleading shape this defect class has produced so far.
--
-- These are permissive policies alongside sel_user_accounts_platform_self, so
-- they ADD the window-scoped read rather than widening the operator self-read.
-- Each closes with the window: once the tenant leaves `provisioning`, the
-- control plane can no longer read that tenant's identity rows at all.
GRANT SELECT ON iam.roles            TO app_platform;
GRANT SELECT ON iam.role_permissions TO app_platform;
GRANT SELECT ON iam.user_status_history TO app_platform;

CREATE POLICY sel_user_accounts_platform_bootstrap ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = user_accounts.tenant_id AND t.status = 'provisioning'));
CREATE POLICY sel_roles_platform_bootstrap ON iam.roles
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = roles.tenant_id AND t.status = 'provisioning'));
CREATE POLICY sel_role_permissions_platform_bootstrap ON iam.role_permissions
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = role_permissions.tenant_id AND t.status = 'provisioning'));
CREATE POLICY sel_user_status_history_platform_bootstrap ON iam.user_status_history
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = user_status_history.tenant_id AND t.status = 'provisioning'));

COMMENT ON POLICY sel_user_accounts_platform_bootstrap ON iam.user_accounts IS
  'The read-back half of the Owner bootstrap (B1-UG-001). Scoped to a tenant still inside its provisioning window, so it closes on the first legal transition and the control plane holds no standing read on any live tenant''s identity rows. Separate from sel_user_accounts_platform_self, which is the resolver''s own-row read and carries no tenant term.';

-- Reads the deferred constraint triggers perform as the writing role.
-- tg_role_grants_require_scope reads iam.role_grants unconditionally
-- (20260718092000:183-184), so a write-only grant aborts the bootstrap at
-- COMMIT rather than at the statement — the hardest kind of failure to trace.
CREATE POLICY sel_role_grants_platform_bootstrap ON iam.role_grants
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = role_grants.tenant_id AND t.status = 'provisioning'));
CREATE POLICY sel_grant_scopes_platform_bootstrap ON iam.grant_scopes
  FOR SELECT TO app_platform
  USING (EXISTS (SELECT 1 FROM org.tenants t
                  WHERE t.id = grant_scopes.tenant_id AND t.status = 'provisioning'));

COMMENT ON POLICY ins_role_grants_platform_bootstrap ON iam.role_grants IS
  'The initial Owner grant, and the reason the delegation backstop is not this path''s containment: iam.grant_delegation_within_authority returns true unconditionally for a caller that is not an app_runtime member (20260727090000:108-110), which app_platform deliberately is not. Containment is the conjunction here — platform authority AND the tenant still inside its bootstrap window — and the window closes on the tenant''s first legal transition, which the previous migration makes impossible to reverse.';

-- ============================================================================
-- Deliberately absent, named rather than merely omitted.
--
--   Not granted to app_platform anywhere above: BYPASSRLS; ownership of any
--   object; UPDATE or DELETE on ANY table except the single column-scoped
--   UPDATE (status) on org.tenants; TRUNCATE, REFERENCES or TRIGGER on any
--   table; any privilege on a tenant BUSINESS table (crm, veh, apt, rec, wo,
--   tech, dia, qms, svc, quo, inv, sal, wty, rpt) — none appears in this file;
--   EXECUTE on iam.audit_verify_chain, iam.change_user_status,
--   iam.has_permission, iam.has_permission_in_scope, org.change_branch_status,
--   shared.claim_outbox_events, shared.complete_outbox_event or
--   shared.fail_outbox_event; any access to shared.event_outbox,
--   shared.processed_events, shared.error_records or iam.security_events; and
--   any INSERT, UPDATE or DELETE on iam.platform_grants — establishing platform
--   authority stays an out-of-band act, which is what makes tenant-side
--   escalation structurally impossible rather than merely forbidden.
--
--   A list of withholdings is what makes a later over-grant visible. The
--   over-grant direction is checked by scripts/ci/rls-matrix.mjs; the
--   under-grant direction, which is where all five design defects lived, is
--   checked by tests/db/platform-privilege-closure.test.ts.
-- ============================================================================
