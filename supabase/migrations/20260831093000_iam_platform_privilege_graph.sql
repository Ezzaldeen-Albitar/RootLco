-- ============================================================================
-- PRE-P1-29 Wave B — M2: the complete privilege graph of §6 and §7.
--
-- Rollback classification: NON-DESTRUCTIVE. Grants and policies only; no object
-- is created or destroyed and no row is touched. Revoking everything here
-- returns app_platform to a role that can reach nothing.
--
-- ## Why this file lands LAST
--
-- Design §15 rule 2. Every guard this graph depends on already exists: M4's
-- transition backstop bounds the `UPDATE (status)` granted below, and M3's
-- coherence guard and stamp bound the `INSERT` on org.tenant_status_history.
-- Shipping the grants first would leave a window where the graph is unenforced
-- and forged attribution is possible. No migration in Wave B grants a privilege
-- on an object a later Wave-B migration creates.
--
-- ## TWO COLUMN-SCOPED GRANTS THAT MUST NEVER BE WIDENED
--
-- Privileges UNION. A table-wide grant anywhere in this file would silently void
-- a narrower one and no gate would catch it: `rls-matrix.mjs` probes with
-- `has_table_privilege`, which is table-level, and does not verify column-scoped
-- grants at all.
--
--   * `iam.user_accounts` — SELECT is `(id, status, deleted_at)` and nothing
--     more. The resolver needs an existence-and-active test, not a person's name
--     or address. B7 writes this table and takes INSERT ONLY, never a
--     table-level SELECT.
--   * `org.tenant_status_history` — INSERT names seven columns and omits `seq`
--     and `id` deliberately. `seq` is GENERATED ALWAYS AS IDENTITY, and
--     `OVERRIDING SYSTEM VALUE` needs no privilege beyond INSERT on the column,
--     so granting it would reopen the RC-D forgery. §6.2's write list therefore
--     EXCLUDES this table: its INSERT is §6.4's, at its narrowest, once.
--
-- ## The EXECUTE list is nine functions, not one — blocker B1
--
-- `iam.audit_append` is SECURITY INVOKER, so its three helpers execute with the
-- caller's privileges too. Granting the writer alone was blocker B1. The context
-- readers are here for a different reason each: `iam.current_user_id()` because
-- the §5.2 policy predicate and `shared.stamp_status_history()` both call it,
-- and `iam.current_tenant_id()` because every audit insert and select policy
-- compares against it even though no path calls it directly.
--
-- Trigger functions are NOT in this list and need no grant: PostgreSQL checks a
-- trigger function's EXECUTE at CREATE TRIGGER, not at fire time (measured on
-- this project's PostgreSQL 17.6). What their bodies CALL is still checked as
-- the invoking role, which is why `iam.current_user_id()` is granted.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. §5.2 — the resolver's own two reads. Both halves, or every policy below is
--    unreachable: a SECURITY INVOKER resolver called from inside a policy is
--    evaluated as app_platform and raises 42501 at executor start rather than
--    answering false (blocker B2).
-- ----------------------------------------------------------------------------
GRANT SELECT ON iam.platform_grants TO app_platform;
-- The policy for this table is sel_platform_grants_own, created in M1.

GRANT SELECT (id, status, deleted_at) ON iam.user_accounts TO app_platform;

CREATE POLICY sel_user_accounts_platform_self ON iam.user_accounts
  FOR SELECT TO app_platform
  USING (id = iam.current_user_id());

COMMENT ON POLICY sel_user_accounts_platform_self ON iam.user_accounts IS
  'One row, the operator''s own, carrying no tenant term so it works in both context shapes. Paired with a COLUMN-SCOPED SELECT (id, status, deleted_at): the resolver needs an existence-and-active test, nothing more.';

-- ----------------------------------------------------------------------------
-- 2. §7.2 — every EXECUTE app_platform receives anywhere in this design.
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION iam.has_platform_authority(text) TO app_platform;
GRANT EXECUTE ON FUNCTION iam.current_user_id() TO app_platform;
GRANT EXECUTE ON FUNCTION iam.current_tenant_id() TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb) TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_mask(text, text) TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid) TO app_platform;
GRANT EXECUTE ON FUNCTION iam.audit_hash(bytea, text) TO app_platform;
GRANT EXECUTE ON FUNCTION org.provision_organization(jsonb, text) TO app_platform;
GRANT EXECUTE ON FUNCTION org.change_tenant_status(uuid, text, text, uuid, uuid) TO app_platform;

-- ----------------------------------------------------------------------------
-- 3. §6.4 / §6.5 — the tenant lifecycle and the organisation read.
--
--    ONE SELECT policy on org.tenants, not two: §6.4 and §6.5 write a predicate
--    for the same (org.tenants, SELECT, app_platform) triple, and §6.7.5
--    reconciles them to a single policy serving both paths. Its USING is a
--    disjunction of the three authorities with NO row term, so any holder reads
--    every tenant row — consistent with §5.2, where platform authority carries
--    no tenant column, and recorded as a decision rather than an artefact.
-- ----------------------------------------------------------------------------
GRANT SELECT ON org.tenants TO app_platform;

CREATE POLICY sel_tenants_platform ON org.tenants
  FOR SELECT TO app_platform
  USING (
       iam.has_platform_authority('platform.organization.read')
    OR iam.has_platform_authority('platform.organization.lifecycle')
    OR iam.has_platform_authority('platform.organization.provision')
  );

-- Column-scoped, in the shape the repository already uses.
GRANT UPDATE (status) ON org.tenants TO app_platform;

-- A FOR UPDATE policy with only a USING clause reuses it as the WITH CHECK,
-- which is how revision 1 admitted status = 'provisioning'. Both are stated.
-- The destination list omits 'provisioning': the bootstrap window closes on the
-- first legal transition and nothing reopens it. M4's trigger refuses first —
-- BEFORE ROW fires before the RLS check — so both controls are load-bearing and
-- a single mutation cannot show it.
CREATE POLICY upd_tenants_platform_lifecycle ON org.tenants
  FOR UPDATE TO app_platform
  USING (iam.has_platform_authority('platform.organization.lifecycle'))
  WITH CHECK (
    iam.has_platform_authority('platform.organization.lifecycle')
    AND status IN ('active', 'suspended', 'closed')
  );

-- The second write. §6.2's policy cannot serve it: org.change_tenant_status
-- updates the parent and the emitter writes here, so this table needs its own.
GRANT INSERT (tenant_id, from_state, to_state, reason, actor_id, occurred_at, correlation_id)
  ON org.tenant_status_history TO app_platform;

-- BOTH authorities, because TWO sanctioned paths write this table and each
-- writes a different row. org.provision_organization writes the GENESIS row
-- (from_state NULL) inside provisioning; org.change_tenant_status writes every
-- subsequent transition. §6.2 lists the table among the ten writes and §6.4
-- owns its column-scoped grant, so the grant is stated once, narrowly, above —
-- and the policy admits both holders. Measured: with the lifecycle authority
-- alone, the sanctioned provisioning path fails on its own genesis row with
-- "new row violates row-level security policy for table tenant_status_history".
CREATE POLICY ins_tenant_status_history_platform ON org.tenant_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
       iam.has_platform_authority('platform.organization.lifecycle')
    OR iam.has_platform_authority('platform.organization.provision')
  );

-- No SELECT on org.tenant_status_history: §6.4 specifies TWO policies on two
-- tables, and no path in Wave B reads this table back. An unused grant is
-- authority handed out for no reason.

-- ----------------------------------------------------------------------------
-- 4. §6.2 — the sanctioned path to org.provision_organization.
--
--    Write targets: the ten the function performs, MINUS
--    org.tenant_status_history, whose INSERT is §6.4's above and stays
--    column-scoped. Read targets: all six, because RETURNING is evaluated
--    against the SELECT policy — naming only the first two is the error
--    revision 1 made.
-- ----------------------------------------------------------------------------
GRANT INSERT ON
  org.tenants,
  org.tenant_subscriptions,
  org.legal_companies,
  org.branches,
  org.company_settings,
  org.branch_settings,
  org.tenant_feature_overrides,
  shared.number_sequences,
  shared.idempotency_keys
TO app_platform;

GRANT SELECT ON
  shared.idempotency_keys,
  org.subscription_plans,
  org.legal_companies,
  org.branches,
  org.tenant_subscriptions
TO app_platform;
-- org.tenants SELECT is granted in §6.4 above and is not granted twice.

-- The tenant root: the platform role may only ever create a tenant in the
-- provisioning state, never a live one.
CREATE POLICY ins_tenants_platform ON org.tenants
  FOR INSERT TO app_platform
  WITH CHECK (
    status = 'provisioning'
    AND iam.has_platform_authority('platform.organization.provision')
  );

-- Every child table: the check is that the PARENT tenant is in that state.
-- This is the bootstrap window, and it recurs throughout §9.
CREATE POLICY ins_tenant_subscriptions_platform ON org.tenant_subscriptions
  FOR INSERT TO app_platform
  WITH CHECK (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_legal_companies_platform ON org.legal_companies
  FOR INSERT TO app_platform
  WITH CHECK (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_branches_platform ON org.branches
  FOR INSERT TO app_platform
  WITH CHECK (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_company_settings_platform ON org.company_settings
  FOR INSERT TO app_platform
  WITH CHECK (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_branch_settings_platform ON org.branch_settings
  FOR INSERT TO app_platform
  WITH CHECK (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_tenant_feature_overrides_platform ON org.tenant_feature_overrides
  FOR INSERT TO app_platform
  WITH CHECK (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_number_sequences_platform ON shared.number_sequences
  FOR INSERT TO app_platform
  WITH CHECK (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

-- The four RETURNING targets get a FOR SELECT policy mirroring their insert
-- predicate, so the role reads back exactly the rows it may create and no more.
-- org.tenants is covered by sel_tenants_platform above.
CREATE POLICY sel_legal_companies_platform ON org.legal_companies
  FOR SELECT TO app_platform
  USING (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY sel_branches_platform ON org.branches
  FOR SELECT TO app_platform
  USING (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY sel_tenant_subscriptions_platform ON org.tenant_subscriptions
  FOR SELECT TO app_platform
  USING (
    EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = tenant_id AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

-- The plan catalogue is platform reference data with no tenant column: a plain
-- read. Without it the sanctioned path raises 42501 on the plan lookup.
CREATE POLICY sel_subscription_plans_platform ON org.subscription_plans
  FOR SELECT TO app_platform
  USING (iam.has_platform_authority('platform.organization.provision'));

-- NOTE: the operation literal is `org_provisioning`, which is what
-- org.provision_organization actually writes (20260717107000:271) — NOT the
-- permission code. Binding the predicate to the permission code would refuse
-- the replay insert and make the sanctioned path fail on its own first write.
-- The replay table. Two policies scoped to PLATFORM rows only: the tenant column
-- absent AND the operation name fixed to the provisioning one. The existing
-- policies read tenant_id = iam.current_tenant_id() and the provisioning record
-- is written with the tenant absent, so without these the platform role cannot
-- use replay protection at all. The narrowness matters: app_platform must not be
-- able to read any tenant's replay records.
CREATE POLICY ins_idempotency_keys_platform ON shared.idempotency_keys
  FOR INSERT TO app_platform
  WITH CHECK (
    (
      -- (a) the record org.provision_organization writes itself, inside the
      --     provisioning transaction: tenant absent, its own operation name.
      (tenant_id IS NULL AND operation = 'org_provisioning')
      -- (b) the record the HTTP idempotency layer writes for the operation,
      --     which is tenant-scoped because withIdempotency stores
      --     db.context.principal.tenantId — the operator's HOME tenant. Two
      --     records exist per provisioning call, under two different operation
      --     names, and a policy admitting only (a) refuses the request before
      --     the handler runs. Measured: ERR-INT-002 on every call.
      OR (tenant_id = iam.current_tenant_id() AND operation = 'platform_organization_provision')
    )
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY sel_idempotency_keys_platform ON shared.idempotency_keys
  FOR SELECT TO app_platform
  USING (
    (
      -- (a) the record org.provision_organization writes itself, inside the
      --     provisioning transaction: tenant absent, its own operation name.
      (tenant_id IS NULL AND operation = 'org_provisioning')
      -- (b) the record the HTTP idempotency layer writes for the operation,
      --     which is tenant-scoped because withIdempotency stores
      --     db.context.principal.tenantId — the operator's HOME tenant. Two
      --     records exist per provisioning call, under two different operation
      --     names, and a policy admitting only (a) refuses the request before
      --     the handler runs. Measured: ERR-INT-002 on every call.
      OR (tenant_id = iam.current_tenant_id() AND operation = 'platform_organization_provision')
    )
    AND iam.has_platform_authority('platform.organization.provision')
  );

-- ----------------------------------------------------------------------------
-- 5. §6.3 — the First Owner bootstrap (B7).
--
--    Each policy carries THREE terms, not two. The row term is the load-bearing
--    one: the other two are row-INDEPENDENT — iam.platform_grants has no tenant
--    column, and the window term names a tenant without binding the written row
--    to it — so without `tenant_id = iam.current_tenant_id()` a bootstrap-path
--    holder could plant rows into ANY tenant that happened to be provisioning.
--
--    iam.user_accounts takes INSERT ONLY. Its SELECT is the column-scoped
--    resolver read above, and a table-level SELECT here would union with it and
--    void both halves of a frozen decision.
-- ----------------------------------------------------------------------------
GRANT INSERT ON
  iam.user_accounts,
  iam.user_status_history,
  iam.roles,
  iam.role_permissions,
  iam.role_grants
TO app_platform;

-- Load-bearing for ENFORCEMENT, not merely for reading: the deferred constraint
-- iam.enforce_scoped_grant_has_scope() does SELECT … INTO then IF NOT FOUND
-- RETURN NULL, so a row this policy does not admit makes the constraint FAIL
-- OPEN rather than refuse.
GRANT SELECT ON iam.role_grants TO app_platform;

CREATE POLICY sel_role_grants_platform_bootstrap ON iam.role_grants
  FOR SELECT TO app_platform
  USING (
    tenant_id = iam.current_tenant_id()
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_user_accounts_platform_bootstrap ON iam.user_accounts
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_user_status_history_platform_bootstrap ON iam.user_status_history
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

-- is_system = false, lifted verbatim from ins_roles_admin. is_system is frozen
-- by tg_roles_immutable and no product path writes it TRUE; an Owner role
-- written is_system = true could never afterwards be renamed, re-permissioned,
-- soft-deleted, or have its role_code reused by any tenant administrator.
CREATE POLICY ins_roles_platform_bootstrap ON iam.roles
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
    AND is_system = false
  );

CREATE POLICY ins_role_permissions_platform_bootstrap ON iam.role_permissions
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

CREATE POLICY ins_role_grants_platform_bootstrap ON iam.role_grants
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND EXISTS (SELECT 1 FROM org.tenants t WHERE t.id = iam.current_tenant_id() AND t.status = 'provisioning')
    AND iam.has_platform_authority('platform.organization.provision')
  );

-- ----------------------------------------------------------------------------
-- 6. §7.1 — the audit tables. Three insert privileges, the matching SELECTs
--    (a policy grants nothing without one), and a policy per pair, each
--    predicated on the row's tenant matching the current one exactly as the
--    runtime's are.
-- ----------------------------------------------------------------------------
GRANT INSERT, SELECT ON iam.audit_records TO app_platform;
GRANT INSERT, SELECT ON iam.audit_record_details TO app_platform;
GRANT INSERT, SELECT ON iam.audit_integrity_links TO app_platform;

CREATE POLICY ins_audit_records_platform ON iam.audit_records
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_audit_records_platform ON iam.audit_records
  FOR SELECT TO app_platform
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY ins_audit_record_details_platform ON iam.audit_record_details
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_audit_record_details_platform ON iam.audit_record_details
  FOR SELECT TO app_platform
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY ins_audit_integrity_links_platform ON iam.audit_integrity_links
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_audit_integrity_links_platform ON iam.audit_integrity_links
  FOR SELECT TO app_platform
  USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 7. iam.security_events — INSERT only.
--
--    Slice 06 recorded B9's breach obligation as "discharged by reuse" and
--    stated that B9 creates no database object. Measured against the live
--    catalogue, that is wrong, and the failure is silent rather than loud:
--
--      grantees of iam.security_events : app_readonly SELECT, app_runtime
--                                        INSERT + SELECT. app_platform: NOTHING.
--      INSERT policies                 : ins_security_events_runtime, TO
--                                        app_runtime alone.
--
--    recordSecurityEvent() catches its own insert failure on purpose —
--    "telemetry must never escalate into a request failure" — and returns
--    persisted: false. So wiring the call without this grant would log a
--    warning, drop the row, report success, and leave the highest-privilege
--    surface in the product as the ONE surface whose breaches are never
--    persisted. A proof asserting only that the call was made would pass.
--
--    INSERT and no SELECT: recordSecurityEvent only inserts, and a platform
--    operator has no reason to read the breach log through the request path.
--
--    The predicate mirrors ins_security_events_runtime exactly and deliberately
--    carries NO iam.has_platform_authority() term. A breach by a caller holding
--    no platform grant is precisely the event most worth keeping; an authority
--    term would drop exactly those rows and invert the control. Role membership
--    plus the column grant is the boundary here, and binding the row to the
--    session's own tenant is what stops a platform session forging an event
--    against an arbitrary one.
-- ----------------------------------------------------------------------------
GRANT INSERT ON iam.security_events TO app_platform;

CREATE POLICY ins_security_events_platform ON iam.security_events
  FOR INSERT TO app_platform
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- ============================================================================
-- Exact rollback (ROLLBACK-SAFE — grants and policies only):
--   DROP every policy named above, then REVOKE every grant above from
--   app_platform. No object is dropped and no row is touched.
-- ============================================================================
