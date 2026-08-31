-- ============================================================================
-- PRE-P1-29 Wave B — M4: the tenant transition backstop.
--
-- Rollback classification: NON-DESTRUCTIVE. One function and one trigger; no
-- data is created or destroyed. Dropping both restores the prior behaviour
-- exactly, which is: the graph is enforced ONLY inside org.change_tenant_status
-- and a direct UPDATE bypasses it entirely.
--
-- ## Why this file lands SECOND, before M3 and M2
--
-- Design §15 rule 2: every guard lands before the privilege it exists to bound.
-- M2 grants `UPDATE (status)` on `org.tenants` to `app_platform`. Shipping that
-- grant before this trigger leaves a window in which the lifecycle graph is
-- unenforced for the very role the grant is for — the graph lives only inside
-- `org.change_tenant_status`, and neither existing trigger on `org.tenants`
-- validates a transition. Before this file, the repository's ENTIRE enforcement
-- of the graph was the ABSENCE of an UPDATE privilege. M2 removes that absence,
-- so the guard must already exist.
--
-- ## Why a table-level backstop rather than trusting the function
--
-- `org.change_tenant_status` is SECURITY INVOKER and validates the graph, but a
-- role holding `UPDATE (status)` can bypass it with a direct UPDATE. Blocker B3
-- was exactly this: an unpredicated status grant let a live tenant be set back
-- to `provisioning`, reopening the bootstrap window §6.3 depends on. Two
-- independent controls now refuse that — this trigger, and the `WITH CHECK` of
-- M2's `FOR UPDATE` policy, whose destination list omits `provisioning`.
--
-- PostgreSQL fires BEFORE ROW triggers before it evaluates the RLS `UPDATE WITH
-- CHECK`, so for a return-to-`provisioning` attempt THIS trigger refuses first
-- and the policy check is never reached. That is why the proof for it carries
-- two mutations: drop either control and the other must still refuse, because a
-- single mutation cannot show both are load-bearing.
--
-- ## It validates the graph, not a destination list
--
-- The same graph `org.change_tenant_status` carries
-- (`20260717101000_org_tenants.sql:210-217`), reproduced here rather than
-- referenced, because a trigger cannot call into the function's local logic:
--
--     provisioning -> active | closed
--     active       -> suspended | closed
--     suspended    -> active | closed
--     closed       -> (terminal)
--
-- A destination list would admit `closed -> active`. The graph does not.
--
-- ## It fires only when the status actually changes
--
-- `OLD.status IS DISTINCT FROM NEW.status` guards the whole body, so the
-- runtime's existing three-column settings UPDATE
-- (`20260726090000_iam_org_runtime_administration_capabilities.sql`, policy
-- `upd_tenants_settings`) is untouched: it never names `status`, so the values
-- are equal and the trigger returns immediately.
-- ============================================================================

CREATE OR REPLACE FUNCTION org.guard_tenant_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

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
  'BEFORE UPDATE backstop on org.tenants (PRE-P1-29 Wave B, M4): validates the lifecycle graph on any status change, including a direct UPDATE that bypasses org.change_tenant_status. Closed is terminal and provisioning is not re-enterable, which is what keeps the §6.3 bootstrap window from being reopened on a live tenant (blocker B3). Fires only when status actually changes, so the runtime settings UPDATE is untouched. Validates the GRAPH, not a destination list — a destination list would admit closed -> active.';

REVOKE EXECUTE ON FUNCTION org.guard_tenant_status_transition() FROM PUBLIC;

CREATE TRIGGER tg_tenants_status_transition_guard
  BEFORE UPDATE ON org.tenants
  FOR EACH ROW EXECUTE FUNCTION org.guard_tenant_status_transition();

-- ============================================================================
-- Exact rollback (ROLLBACK-SAFE — no data is created or destroyed):
--
--   DROP TRIGGER tg_tenants_status_transition_guard ON org.tenants;
--   DROP FUNCTION org.guard_tenant_status_transition();
-- ============================================================================
