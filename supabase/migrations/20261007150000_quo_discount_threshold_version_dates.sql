-- ============================================================================
-- P1-32-PRE-OD-FD8 (fix round 6) — a discount threshold version recorded on the
-- request path takes effect on the day it is recorded and stays open-ended
-- (Owner decision D8, ADR-023, approved 2026-09-30).
-- Owner module: svc (the threshold version's dates)
--
-- Rollback classification: ROLLBACK-SAFE. One trigger function re-issued under its
--   own name and signature; no column, table, trigger, grant or policy is added and
--   no row is written. Forward-only — the inverse at the foot of this file is for a
--   rehearsal copy only.
--
-- Purpose
--   D8: "Changing one's own threshold, role limit or price list never exempts one's
--   own quotation from approval. Provenance and snapshots are kept. There is no
--   sole-administrator exception."
--
--   A quotation is held to svc.discount_policy_in_force: the company's own active
--   version in force that day, else the tenant-wide one (20260925090000). Recording
--   an active version retires the active version it replaces
--   (svc.record_pricing_approval_policy_version), whatever its dates. So a requester
--   whose session inserted an active company version dated to start tomorrow, or
--   already ended, retired the company version in force without putting their own in
--   force: the quotation fell back to a tenant-wide version somebody else had set, and
--   quo.revision_self_change_basis, which reads only who set the pinned version,
--   answered own_policy = false. That is a change of one's own threshold that left
--   one's own quotation under a different, possibly more generous, threshold with no
--   second person.
--
--   The application never writes such a version: PricingRepository
--   .insertDiscountPolicyVersion records every version effective from the database's
--   business date (current_date) with no end date. This migration holds every
--   request-path writer to exactly that, so the version that retires the one in force
--   is the one that replaces it in force, and its set_by is the requester's own:
--     * svc.record_pricing_approval_policy_version refuses an INSERT by app_runtime
--       (or a login member of it) whose effective_from is not current_date, or whose
--       effective_to is set (check_violation). Nothing else changes: the version
--       number rule and the retirement are as written in 20260925090000.
--   No commercial rule is added: a version still starts the day it is recorded and
--   still holds until the next one, as the application has always written it.
--
--   WHO IS HELD TO IT. Exactly the population the request path uses: app_runtime and
--   its login members, which are non-superuser and NOBYPASSRLS. A role that bypasses
--   row security (a superuser, or the provisioning/admin connection) is not, the same
--   boundary as iam.grant_delegation_within_authority (20260727090000): that path writes
--   seed and fixture rows and already bypasses every row policy on this table.
--
-- Existing rows
--   None is read or changed. A version already recorded with other dates keeps them;
--   only a new INSERT is checked.
--
-- Security implications
--   No new table, role, grant, policy or SECURITY DEFINER. The function stays
--   SECURITY INVOKER with an empty search_path; CREATE OR REPLACE keeps its ACL
--   (EXECUTE revoked from PUBLIC) and its trigger tg_pricing_approval_policies_record_version.
--
-- Dependencies
--   20260723092000 (svc.pricing_approval_policies), 20260925090000 (the function as
--   re-issued here).
-- ============================================================================

CREATE OR REPLACE FUNCTION svc.record_pricing_approval_policy_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_latest integer;
BEGIN
  -- A version recorded on the request path starts today and holds until the next
  -- one, as the application writes it (ADR-023 D8, fix round 6). Otherwise the
  -- retirement below would end the version in force without the writer's own taking
  -- its place, and the quotation would fall back to a version somebody else set.
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     AND pg_catalog.pg_has_role(current_user, 'app_runtime', 'MEMBER')
     AND (NEW.effective_from IS DISTINCT FROM current_date OR NEW.effective_to IS NOT NULL) THEN
    RAISE EXCEPTION 'svc.pricing_approval_policies: a threshold version takes effect on the day it is recorded (%) and has no end date; this one is dated % to %',
      current_date, NEW.effective_from, COALESCE(NEW.effective_to::text, 'open')
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT max(version_no) INTO v_latest
    FROM svc.pricing_approval_policies
   WHERE tenant_id = NEW.tenant_id AND company_id IS NOT DISTINCT FROM NEW.company_id
     AND policy_type = NEW.policy_type;
  IF NEW.version_no <> COALESCE(v_latest, 0) + 1 THEN
    RAISE EXCEPTION 'svc.pricing_approval_policies: version % is not the next version of this policy (the latest is %)',
      NEW.version_no, COALESCE(v_latest, 0)
      USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.status = 'active' AND NEW.deleted_at IS NULL THEN
    UPDATE svc.pricing_approval_policies
       SET status = 'inactive'
     WHERE tenant_id = NEW.tenant_id AND company_id IS NOT DISTINCT FROM NEW.company_id
       AND policy_type = NEW.policy_type AND status = 'active' AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.record_pricing_approval_policy_version() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only)
--
--   Re-run svc.record_pricing_approval_policy_version as written in
--   20260925090000_quo_discount_approvals.sql.
-- ----------------------------------------------------------------------------
