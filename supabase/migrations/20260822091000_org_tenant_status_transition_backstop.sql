-- ============================================================================
-- Migration: tenant status transition backstop (PRE-P1-29 Wave B, slice B1)
--
-- Rollback classification: ROLLBACK-SAFE. Three functions and two triggers, no
-- data.
--     DROP TRIGGER tg_tenant_status_history_stamp ON org.tenant_status_history;
--     DROP TRIGGER tg_tenants_status_transition ON org.tenants;
--     DROP FUNCTION org.stamp_tenant_status_history();
--     DROP FUNCTION org.guard_tenant_status_transition();
--     DROP FUNCTION org.tenant_has_recoverable_owner(uuid);
--   Drop the triggers before the functions they call, and the guard before the
--   readiness predicate it depends on.
--   Reversing it does not corrupt anything, but it DOES remove the only
--   table-level enforcement of the tenant lifecycle graph — so it must never be
--   rolled back while the next migration's UPDATE (status) grant is still in
--   place. That ordering is the whole reason this file precedes it.
--
-- Specification: wave-b-control-plane-design-v2.md revision 4, sections 6.4 and
--                15 (migration M4). Merged as c081a019.
--
-- Why this exists, and why it is ordered BEFORE the privilege grants
--   The tenant lifecycle graph lives ONLY inside org.change_tenant_status
--   (20260717101000:210-217). The table itself carries two triggers —
--   tg_tenants_touch_metadata and tg_tenants_immutable_columns (:124-130) — and
--   NEITHER validates a transition. The repository's entire enforcement of the
--   graph is therefore the ABSENCE of an UPDATE privilege on the status column,
--   stated three times (:167-170, :229, and organization-repository.ts:7-11).
--
--   The next migration grants app_platform exactly that privilege, because a
--   control plane must be able to suspend, reactivate and close a tenant. The
--   moment it does, the graph stops being enforced by anything — a direct
--   `UPDATE org.tenants SET status = 'provisioning'` on a LIVE tenant would
--   succeed, writing no history and REOPENING the bootstrap window that the
--   design names as the containment for the whole control plane.
--
--   That was blocker B3 of the design review. The repair is not a narrower
--   grant: it is this backstop, so the invariant holds for EVERY writer rather
--   than resting on who happens to hold the privilege. This migration is
--   deliberately ordered before the grant, so no window exists in which the
--   privilege is reachable and the graph is not enforced.
--
-- Design
--   BEFORE INSERT OR UPDATE, FOR EACH ROW. The two verbs are handled separately
--   and deliberately: the GRAPH applies only to UPDATE, because a row with no
--   previous state has no transition to validate, while the READINESS rule
--   applies to both, because both are ways of ARRIVING at 'active'. An earlier
--   revision covered UPDATE alone and left the INSERT door defended by a single
--   row-level policy, which a BYPASSRLS connection walks straight past.
--
--   On UPDATE it fires only when the status is actually changing
--   (`OLD.status IS DISTINCT FROM NEW.status`). That condition is load-bearing:
--   app_runtime holds a column-scoped UPDATE on three settings columns
--   (20260726090000:174, policy upd_tenants_settings at :423), and a settings
--   edit must not be refused by a lifecycle rule.
--
--   The graph is the SAME graph org.change_tenant_status validates. It is
--   duplicated here rather than extracted, deliberately: extracting it would
--   mean editing an applied migration's function, and a backstop that shares an
--   implementation with the thing it backstops is not a backstop. The
--   duplication is asserted by test rather than by comment.
--
-- Security implications
--   * SECURITY INVOKER, empty search_path. No SECURITY DEFINER is introduced.
--   * It constrains every writer, including the admin/migration connection.
--     That is intended: a bypassing role can still drop the trigger, but it can
--     no longer make an illegal transition BY ACCIDENT, and the canonical
--     function's own validation is unaffected because it never attempts one.
--   * It does NOT enforce history. A status change without its history row is
--     still possible for a caller holding a direct UPDATE privilege; what the
--     backstop guarantees is that no reachable status VALUE is illegal, and in
--     particular that nothing returns a tenant to `provisioning`. History
--     integrity on the sanctioned path is the function's, and the platform
--     policy in the next migration constrains the destination as well.
--
-- Objects created
--   Functions: org.tenant_has_recoverable_owner(uuid),
--              org.guard_tenant_status_transition(),
--              org.stamp_tenant_status_history()
--   Triggers:  tg_tenants_status_transition, tg_tenant_status_history_stamp
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bootstrap readiness — derived from canonical artefacts, not from a new marker.
--
--   The question "can anybody administer this tenant?" already has an answer in
--   the shipped model, and it is not a role NAME. It is whether some ACTIVE,
--   undeleted account of the tenant holds an ACTIVE grant inside its validity
--   window to a live role that MAPS the administrative permissions — resolved
--   with the same allow/deny arithmetic iam.has_permission uses
--   (20260718097000:86-114): allow wins only when no deny is present.
--
--   The role-permission join is the part an earlier revision omitted, and the
--   omission mattered. Without it a grant of an EMPTY role satisfied readiness
--   while iam.has_permission answered false for every code — a tenant activated
--   with an "owner" who could resolve nothing. That state is a trap, not an
--   inconvenience: the bootstrap window is already shut, so the control plane
--   cannot add the mapping, and the tenant-side repair needs iam.role.manage,
--   which by construction nobody in that tenant holds. The suite's own fixtures
--   built exactly that owner and asserted readiness TRUE for it.
--
--   WHICH CODES — derived from the write points, not chosen.
--
--   Recovery means: bring a new administrator into being from nothing. There are
--   four writes on that path and each names exactly one code in its policy:
--
--     create a role                iam.roles / ins_roles_admin              role.manage
--     map a permission onto it     iam.role_permissions / …_delegable       role.manage
--     grant the role to somebody   iam.role_grants / ins_role_grants_delegable  grant.manage
--     create that somebody         iam.user_accounts / ins_user_accounts_admin  user.manage
--
--   The fourth is the one an earlier revision missed, and it is not optional:
--
--     * ck_role_grants_no_self_grant is CHECK (granted_by IS DISTINCT FROM
--       user_id), so recovery CANNOT be performed on oneself. It structurally
--       requires a second account.
--     * iam.user_accounts.status defaults to 'invited', and iam.has_permission
--       returns false for any account that is not 'active'. So even an existing
--       second account is inert until somebody activates it — and the only
--       transition path, upd_user_accounts_admin, also demands user.manage.
--
--   So a holder of {role.manage, grant.manage} alone can define authority and
--   confer it, and has nobody to confer it ON and no way to make one. That
--   tenant is not recoverable, and the earlier predicate called it so.
--
--   The set is CLOSED, which is what makes three the right number and not an
--   arbitrary one: ins_role_permissions_delegable refuses to map a code the
--   actor does not itself hold, so an administrator can only reproduce authority
--   they already have. {role.manage, grant.manage, user.manage} is the smallest
--   set that can reproduce itself.
--
--   TWO SEPARATE QUESTIONS, and mixing them was a defect in its own right.
--
--   (1) Does this account EFFECTIVELY hold the three codes? That is resolved by
--       a FAITHFUL TRANSCRIPTION of iam.has_permission and nothing else: every
--       active in-window grant of that account, joined to role_permissions and
--       permissions, allow aggregated, deny aggregated, deny wins. No scope
--       filter. No iam.roles join. iam.has_permission has neither, and any term
--       this predicate adds INSIDE the aggregation makes the two disagree.
--
--   (2) Can the account act TENANT-WIDE? That needs at least one active
--       in-window grant with scope_mode = 'unrestricted', because
--       iam.grant_delegation_within_authority refuses a scoped actor creating an
--       unrestricted successor — a tenant administered only within branch scopes
--       cannot mint a tenant-wide replacement.
--
--   An earlier revision folded (2) into (1) by filtering the aggregation to
--   unrestricted grants, and that was a CRITICAL false positive: a DENY carried
--   by a scoped grant became invisible here while remaining decisive for
--   iam.has_permission. The predicate reported an owner the authority engine
--   refuses — the exact trap this whole function exists to prevent, reintroduced
--   by the fix for it. The same revision joined iam.roles on deleted_at IS NULL,
--   which hid a deny on a soft-deleted role for the same reason, and dropped an
--   allow on one, giving a false negative to match.
--
--   NOTE, recorded and deliberately NOT fixed here: iam.has_permission never
--   consults iam.roles.deleted_at, so soft-deleting a role does not withdraw the
--   permissions it confers. That is a pre-existing property of the authority
--   engine. This predicate MIRRORS it rather than silently correcting it,
--   because a readiness answer that disagrees with the engine is worse than one
--   that agrees with an engine that could be better.
--
--   All three are canonical catalogue codes. Not names, not display labels, not
--   a new marker.
--
--   Deliberately NOT used: a role named 'owner' (a name is not an authority), a
--   display name, or a new bootstrap_complete column. §3 of the directive
--   forbids inventing a marker when a canonical record already answers the
--   question, and this one does.
--
--   SECURITY INVOKER, so row-level security applies to its two reads. That is
--   the safe direction: a caller who cannot SEE the grant gets false and the
--   activation is REFUSED. Readiness fails closed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.tenant_has_recoverable_owner(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM iam.user_accounts u
     WHERE u.tenant_id = p_tenant
       AND u.status = 'active'
       AND u.deleted_at IS NULL
       -- (2) can act tenant-wide
       AND EXISTS (
         SELECT 1
           FROM iam.role_grants g
          WHERE g.tenant_id = p_tenant
            AND g.user_id = u.id
            AND g.status = 'active'
            AND g.scope_mode = 'unrestricted'
            AND g.valid_from <= now()
            AND (g.valid_to IS NULL OR g.valid_to > now())
       )
       -- (1) no required code this account does not EFFECTIVELY hold, resolved
       --     exactly as iam.has_permission resolves it
       AND NOT EXISTS (
         SELECT 1
           FROM (VALUES ('iam.role.manage'), ('iam.grant.manage'), ('iam.user.manage'))
                  AS req(code)
          WHERE NOT COALESCE((
                  SELECT bool_or(rp.effect = 'allow')
                     AND NOT COALESCE(bool_or(rp.effect = 'deny'), false)
                    FROM iam.role_grants g
                    JOIN iam.role_permissions rp
                      ON rp.tenant_id = g.tenant_id AND rp.role_id = g.role_id
                    JOIN iam.permissions p
                      ON p.id = rp.permission_id AND p.permission_code = req.code
                   WHERE g.tenant_id = p_tenant
                     AND g.user_id = u.id
                     AND g.status = 'active'
                     AND g.valid_from <= now()
                     AND (g.valid_to IS NULL OR g.valid_to > now())
                ), false)
       )
  );
$$;

COMMENT ON FUNCTION org.tenant_has_recoverable_owner(uuid) IS
  'True iff the tenant has at least one person who could actually RECOVER it: an ACTIVE undeleted account of that tenant that (a) holds at least one ACTIVE UNRESTRICTED in-window grant, so it can act tenant-wide, and (b) effectively holds ALL THREE of iam.role.manage, iam.grant.manage and iam.user.manage. Those are two separate conjuncts on purpose — the permission arithmetic is a faithful transcription of iam.has_permission with no extra filters, because any term added inside it makes the two disagree and a deny the engine honours becomes invisible here — allow/deny resolved exactly as iam.has_permission resolves it. Asks what the grant CONFERS, not merely that one exists. user.manage is not optional: ck_role_grants_no_self_grant forbids granting to oneself, so recovery needs a second account, and creating or activating one is gated on user.manage alone. SECURITY INVOKER, so a caller who cannot see the rows gets false and the activation is refused — readiness fails closed.';

REVOKE EXECUTE ON FUNCTION org.tenant_has_recoverable_owner(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION org.guard_tenant_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- ---- INSERT ---------------------------------------------------------------
  --
  -- The graph does not apply to a row that has no previous state, but the
  -- readiness rule does. Without this branch the entire invariant rested on one
  -- row-level policy (ins_tenants_platform_provisioning), which a BYPASSRLS
  -- connection walks straight past — so a tenant could be CREATED live and
  -- ownerless, reaching by the INSERT door exactly the state the UPDATE door
  -- refuses. The file's own header claimed the invariant held for every writer;
  -- until this branch existed that was true of one verb out of two.
  --
  -- Be precise about what the readiness call does here: at BEFORE INSERT the
  -- tenant row does not exist yet, so no iam.user_accounts row can reference it
  -- (fk_user_accounts_tenant), so the predicate is false for EVERY possible
  -- NEW.id. Creating a tenant already ACTIVE is therefore refused
  -- unconditionally, not conditionally. The call is kept rather than replaced by
  -- a flat comparison because it makes the RULE the same rule on both verbs —
  -- but it discriminates nothing, and a comment claiming it weighs the tenant's
  -- administrators would be describing something that cannot happen.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' AND NOT org.tenant_has_recoverable_owner(NEW.id) THEN
      RAISE EXCEPTION
        'tenant % cannot be created active: no account of it holds an unrestricted effective allow on iam.role.manage, iam.grant.manage and iam.user.manage, so nobody could recover its administration',
        NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- ---- UPDATE ---------------------------------------------------------------
  --
  -- Readiness is asked about NEW.id, so the row must not be able to change
  -- identity underneath the question. org.guard_immutable_columns does not
  -- protect id (20260717101000:128-130 covers tenant_code, created_at and
  -- created_by), and nothing else did either.
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a tenant may not change identity: % -> %', OLD.id, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Not a lifecycle change: leave every other update alone, including the
  -- runtime's column-scoped settings edit.
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- The lifecycle graph of P1-03-DB-002, duplicated from
  -- org.change_tenant_status (20260717101000:210-217) so that a writer holding
  -- a direct UPDATE cannot route around it. `closed` is terminal, and NOTHING
  -- transitions INTO `provisioning` — which is what keeps the Wave B bootstrap
  -- window closed once a tenant has left it.
  IF NOT (
       (OLD.status = 'provisioning' AND NEW.status IN ('active', 'closed'))
    OR (OLD.status = 'active'       AND NEW.status IN ('suspended', 'closed'))
    OR (OLD.status = 'suspended'    AND NEW.status IN ('active', 'closed'))
  ) THEN
    RAISE EXCEPTION 'invalid tenant status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---- the state-integrity half -------------------------------------------
  --
  -- A tenant may not go LIVE for the first time with nobody able to administer
  -- it. org.provision_organization carries an optional activation branch
  -- (20260717107000:254-261) that calls org.change_tenant_status inside the
  -- provisioning transaction, so an operator holding both platform codes could
  -- otherwise produce ACTIVE + no Owner + a closed bootstrap window in one call.
  -- That is not an escalation — the operator already holds both authorities —
  -- but it is a tenant nobody can administer, and the window shuts behind it.
  --
  -- Enforced HERE rather than in the application, and rather than by narrowing a
  -- grant, so the invalid state is unrepresentable for EVERY writer: the
  -- provisioning function, the control plane, and the admin connection alike.
  --
  -- EVERY transition into ACTIVE is gated, not only the first.
  --
  -- An earlier revision gated provisioning -> active alone, reasoning that
  -- suspended -> active is a RE-activation of a tenant that already had an
  -- owner. That is a claim about history, and the invariant is about the
  -- present: a tenant can be suspended PRECISELY BECAUSE its last administrator
  -- was revoked or disabled, and reactivating it would then produce a live
  -- tenant nobody can administer — the identical state reached through a
  -- different door. Recoverability is evaluated at the moment of activation, or
  -- it is not evaluated at all.
  --
  -- Transitions to closed and to suspended stay ungated: abandoning or pausing
  -- a tenant nobody can administer is exactly what must remain possible.
  --
  -- CONSEQUENCE, stated rather than discovered: this makes the tenant.activate
  -- option of org.provision_organization (20260717107000:254-261) INERT. Not
  -- deprecated — impossible. Provisioning creates no accounts, so inside its own
  -- transaction no grant exists and none can, and the activation branch always
  -- raises and rolls the whole call back. That option described precisely the
  -- state this guard exists to forbid: live, unadministrable, and with the
  -- bootstrap window already shut. Callers activate as a second, separate act,
  -- after establishing an Owner. Pinned by tests/db/org-provisioning.test.ts.
  IF NEW.status = 'active'
     AND NOT org.tenant_has_recoverable_owner(NEW.id) THEN
    RAISE EXCEPTION
      'tenant % cannot be activated: no account of it holds an unrestricted effective allow on iam.role.manage, iam.grant.manage and iam.user.manage, so nobody could recover its administration',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_tenant_status_transition() IS
  'BEFORE INSERT OR UPDATE backstop on org.tenants: refuses any status change the lifecycle graph does not admit, and any arrival at ACTIVE without a recoverable administrator, for EVERY writer rather than only for callers of org.change_tenant_status. Covers INSERT because otherwise a bypassing connection could create a tenant live and ownerless rather than transition one. Fires only when the status actually changes, so settings updates are untouched. Nothing transitions into `provisioning`, which is what stops a control-plane UPDATE privilege reopening the PRE-P1-29 Wave B bootstrap window (design revision 4, blocker B3). SECURITY INVOKER, empty search_path.';

REVOKE EXECUTE ON FUNCTION org.guard_tenant_status_transition() FROM PUBLIC;

CREATE TRIGGER tg_tenants_status_transition
  BEFORE INSERT OR UPDATE ON org.tenants
  FOR EACH ROW EXECUTE FUNCTION org.guard_tenant_status_transition();

-- ----------------------------------------------------------------------------
-- The history half, on the precedent the sibling table already sets.
--
--   B1 gives org.tenant_status_history its FIRST application-role write path.
--   Until now only a bypassing connection could write it, so nothing needed to
--   defend attribution. org.branch_status_history has had that defence since
--   20260717103000:262-286 — org.stamp_branch_history overwrites actor_id and
--   occurred_at 'so a direct INSERT cannot spoof attribution or backdate a
--   transition' — and the tenant table had no equivalent.
--
--   Without this, a lifecycle operator could record a transition that never
--   happened, attribute it to another actor and backdate it. The status column
--   is protected by the graph above; the RECORD of how it got there was not.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.stamp_tenant_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- The session principal WINS whenever there is one, which is what stops the
  -- spoof: a caller that supplies somebody else's id has it overwritten.
  --
  -- The fallback is deliberate and was briefly removed as if it were the defect.
  -- It is not reachable by any writer this trigger defends against.
  -- org.change_tenant_status itself takes p_actor_id and prefers
  -- iam.current_user_id() over it (20260717101000:~205), and every non-bypassing
  -- path into this table needs a session principal to get here at all:
  -- iam.has_platform_authority returns false when app.user_id is unset, and
  -- every platform policy on org.tenant_status_history calls it. So the only
  -- caller that can reach the COALESCE's second arm is a BYPASSRLS connection —
  -- a DBA or the migration runner — which can write the row directly anyway.
  --
  -- Removing it broke three shipped org.change_tenant_status tests that pass an
  -- actor by argument from the admin connection, which is the contract that
  -- function has always had.
  NEW.actor_id := COALESCE(iam.current_user_id(), NEW.actor_id);
  IF NEW.actor_id IS NULL THEN
    RAISE EXCEPTION 'tenant status history requires an actor'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.occurred_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.stamp_tenant_status_history() IS
  'BEFORE INSERT on org.tenant_status_history: server-stamps occurred_at, and stamps actor_id from the session context whenever there is one, so a caller holding a direct INSERT cannot backdate a transition or attribute it to someone else. COALESCE rather than an outright overwrite because org.provision_organization runs on a connection that sets no app.user_id and passes its actor explicitly (20260717107000:121, :142-143) — that path keeps working, and every session-bearing path is stamped. Mirrors org.stamp_branch_history (20260717103000:262).';

REVOKE EXECUTE ON FUNCTION org.stamp_tenant_status_history() FROM PUBLIC;

CREATE TRIGGER tg_tenant_status_history_stamp
  BEFORE INSERT ON org.tenant_status_history
  FOR EACH ROW EXECUTE FUNCTION org.stamp_tenant_status_history();
