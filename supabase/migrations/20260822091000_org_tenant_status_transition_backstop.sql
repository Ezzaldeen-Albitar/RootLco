-- ============================================================================
-- Migration: tenant status transition backstop (PRE-P1-29 Wave B, slice B1)
--
-- Rollback classification: ROLLBACK-SAFE. One function and one trigger, no data.
--     DROP TRIGGER tg_tenants_status_transition ON org.tenants;
--     DROP FUNCTION org.guard_tenant_status_transition();
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
--   BEFORE UPDATE, FOR EACH ROW, and it fires only when the status is actually
--   changing (`OLD.status IS DISTINCT FROM NEW.status`). That condition is
--   load-bearing: app_runtime holds a column-scoped UPDATE on three settings
--   columns (20260726090000:174, policy upd_tenants_settings at :423), and a
--   settings edit must not be refused by a lifecycle rule.
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
--   Functions: org.guard_tenant_status_transition()
--   Triggers:  tg_tenants_status_transition
-- ============================================================================

CREATE OR REPLACE FUNCTION org.guard_tenant_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_tenant_status_transition() IS
  'BEFORE UPDATE backstop on org.tenants: refuses any status change the lifecycle graph does not admit, for EVERY writer rather than only for callers of org.change_tenant_status. Fires only when the status actually changes, so settings updates are untouched. Nothing transitions into `provisioning`, which is what stops a control-plane UPDATE privilege reopening the PRE-P1-29 Wave B bootstrap window (design revision 4, blocker B3). SECURITY INVOKER, empty search_path.';

REVOKE EXECUTE ON FUNCTION org.guard_tenant_status_transition() FROM PUBLIC;

CREATE TRIGGER tg_tenants_status_transition
  BEFORE UPDATE ON org.tenants
  FOR EACH ROW EXECUTE FUNCTION org.guard_tenant_status_transition();
