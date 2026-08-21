-- ============================================================================
-- P1-28 / FE-007 (DBCR-P1-18-002): the receiving employee is a real, eligible
-- IAM identity — the selected active account that actually accepted custody.
-- Owner module: rec (reference target: iam.user_accounts)
--
-- Rollback classification: ROLL-FORWARD-ONLY once any visit exists. Dropping
--   receiving_employee_display_name destroys the historical custody evidence
--   this migration exists to create, and dropping the foreign key readmits the
--   arbitrary uuid it exists to forbid. Forward-only — no down script.
--
-- Purpose
--   `receiving_employee_id` carried NO foreign key: any uuid at all was a legal
--   custodian, so the column recorded a claim rather than an identity. This
--   binds it to iam.user_accounts in the SAME tenant, requires the account to be
--   active and eligible for the visit's branch at insert time, and captures an
--   immutable server-stamped display-name snapshot so a later rename, lock,
--   archive or soft delete cannot rewrite what a customer already signed.
--
-- What is deliberately NOT here
--   No HR/workforce master. The identity is the IAM account; this migration adds
--   no employee register, no department and no second source of truth.
--
-- Existing rows are backfilled only from the exact same-tenant account id. The
-- migration deliberately raises when a dangling legacy uuid exists: guessing an
-- employee or silently substituting the actor would falsify custody history.
--
-- Security implications
--   * The eligibility guard and the snapshot are enforced by a BEFORE INSERT
--     trigger, so they hold for every writer — the application, a future job,
--     and psql alike. The application layer is not the authority.
--   * Cross-branch selection is possible only for an actor holding
--     `rec.reception.receiving_employee.assign_any` in the visit's own scope.
--     That code is seeded by supabase/seeds/04_iam_permission_catalog.sql and
--     mapped to NO role, so it is held by nobody until a tenant grants it.
--   * A non-active or soft-deleted account, and an account with no live role
--     grant anywhere in the tenant, are refused unconditionally. The
--     cross-branch authority widens WHICH BRANCH may be drawn from; it never
--     waives lifecycle, and it never manufactures standing for an account that
--     belongs to no branch at all.
--   * SECURITY INVOKER with an empty search_path; the lookups run under the
--     caller's RLS, so a cross-tenant id is invisible before the foreign key is
--     ever consulted.
--
-- Objects created
--   Columns:     rec.reception_visits.receiving_employee_display_name
--   Constraints: fk_reception_visits_receiving_employee,
--                ck_reception_visits_receiving_employee_name
--   Indexes:     ix_reception_visits_receiving_employee
--   Functions:   rec.stamp_receiving_employee_identity()
--   Triggers:    tg_reception_visits_receiving_employee;
--                tg_reception_visits_immutable recreated with the new column
-- ============================================================================

ALTER TABLE rec.reception_visits
  ADD COLUMN receiving_employee_display_name text NULL;

UPDATE rec.reception_visits AS visit
   SET receiving_employee_display_name = account.display_name
  FROM iam.user_accounts AS account
 WHERE account.tenant_id = visit.tenant_id
   AND account.id = visit.receiving_employee_id;

DO $$
DECLARE
  v_dangling bigint;
BEGIN
  SELECT count(*) INTO v_dangling
    FROM rec.reception_visits
   WHERE receiving_employee_display_name IS NULL;

  IF v_dangling <> 0 THEN
    RAISE EXCEPTION
      'FE-007 migration refused: % reception visit(s) have a dangling receiving_employee_id; provision the exact same-tenant IAM identities before retrying',
      v_dangling
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

ALTER TABLE rec.reception_visits
  ALTER COLUMN receiving_employee_display_name SET NOT NULL,
  ADD CONSTRAINT fk_reception_visits_receiving_employee
    FOREIGN KEY (tenant_id, receiving_employee_id)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE rec.reception_visits
  ADD CONSTRAINT ck_reception_visits_receiving_employee_name
    CHECK (btrim(receiving_employee_display_name) <> '');

CREATE INDEX ix_reception_visits_receiving_employee
  ON rec.reception_visits (tenant_id, receiving_employee_id);

COMMENT ON COLUMN rec.reception_visits.receiving_employee_id IS
  'The active IAM user who actually accepted vehicle custody. Same-tenant FK; insert-time eligibility requires a live role grant covering this visit branch, or an actor holding rec.reception.receiving_employee.assign_any in that scope.';
COMMENT ON COLUMN rec.reception_visits.receiving_employee_display_name IS
  'Immutable display-name snapshot captured server-side at reception. Historical display remains readable after the IAM account is renamed, locked, archived, or soft-deleted.';

CREATE OR REPLACE FUNCTION rec.stamp_receiving_employee_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_display_name text;
  v_live_grant boolean;
  v_branch_eligible boolean;
BEGIN
  -- Lifecycle first, and unconditionally. A locked, archived or soft-deleted
  -- account is never selectable for a NEW reception, whatever authority the
  -- actor holds: the cross-branch permission below widens WHICH branch may be
  -- drawn from, never WHICH lifecycle state may be drawn from.
  SELECT account.display_name
    INTO v_display_name
    FROM iam.user_accounts AS account
   WHERE account.tenant_id = NEW.tenant_id
     AND account.id = NEW.receiving_employee_id
     AND account.status = 'active'
     AND account.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'receiving employee is not an active IAM user in this tenant'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Operational standing, and it is NOT waivable. An account with no live role
  -- grant anywhere in the tenant belongs to no branch at all, so there is no
  -- branch for the cross-branch authority below to reach ACROSS. Waiving this
  -- would let an administrator name a dormant or never-provisioned account as
  -- the person who took the keys, which is the failure this whole migration
  -- exists to end — a custodian nobody can be held to.
  v_live_grant := EXISTS (
    SELECT 1
      FROM iam.role_grants AS grant_row
     WHERE grant_row.tenant_id = NEW.tenant_id
       AND grant_row.user_id = NEW.receiving_employee_id
       AND grant_row.status = 'active'
       AND grant_row.valid_from <= now()
       AND (grant_row.valid_to IS NULL OR grant_row.valid_to > now())
  );

  IF NOT v_live_grant THEN
    RAISE EXCEPTION 'receiving employee holds no live role grant in this tenant'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_branch_eligible := EXISTS (
    SELECT 1
      FROM iam.role_grants AS grant_row
     WHERE grant_row.tenant_id = NEW.tenant_id
       AND grant_row.user_id = NEW.receiving_employee_id
       AND grant_row.status = 'active'
       AND grant_row.valid_from <= now()
       AND (grant_row.valid_to IS NULL OR grant_row.valid_to > now())
       AND (
         grant_row.scope_mode = 'unrestricted'
         OR EXISTS (
           SELECT 1
             FROM iam.grant_scopes AS grant_scope
            WHERE grant_scope.tenant_id = grant_row.tenant_id
              AND grant_scope.grant_id = grant_row.id
              AND (
                (grant_scope.scope_type = 'company'
                  AND grant_scope.company_id = NEW.company_id)
                OR (grant_scope.scope_type = 'branch'
                  AND grant_scope.company_id = NEW.company_id
                  AND grant_scope.branch_id = NEW.branch_id)
                OR (grant_scope.scope_type = 'department'
                  AND grant_scope.company_id = NEW.company_id
                  AND grant_scope.branch_id = NEW.branch_id)
              )
         )
       )
  );

  -- Normal selection is limited to accounts eligible for THIS branch. Reaching
  -- into ANOTHER branch is an ADMINISTRATIVE act, so it is decided by a
  -- permission the ACTOR holds in this visit's own scope — never by the caller
  -- asserting it, and never by the selected employee's own authority. Nested
  -- rather than a single AND: PostgreSQL does not promise short-circuit
  -- evaluation, and this reads as the two-stage decision it is.
  IF NOT v_branch_eligible THEN
    IF NOT iam.has_permission_in_scope(
      'rec.reception.receiving_employee.assign_any', NEW.company_id, NEW.branch_id
    ) THEN
      RAISE EXCEPTION 'receiving employee is not eligible for this branch'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- Caller input is never authoritative for historical identity text.
  NEW.receiving_employee_display_name := v_display_name;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rec.stamp_receiving_employee_identity() IS
  'BEFORE INSERT on rec.reception_visits: resolves the selected same-tenant ACTIVE IAM user, requires a live role grant (always) covering the visit company/branch (or, failing that, an actor holding rec.reception.receiving_employee.assign_any in that scope), and server-stamps the immutable display-name snapshot. Lifecycle and live standing are never waivable; only the BRANCH is.';
REVOKE EXECUTE ON FUNCTION rec.stamp_receiving_employee_identity() FROM PUBLIC;

CREATE TRIGGER tg_reception_visits_receiving_employee
  BEFORE INSERT ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION rec.stamp_receiving_employee_identity();

-- Recreate the immutable-column trigger so the new historical snapshot is
-- protected by the same database backstop as the employee id itself.
DROP TRIGGER tg_reception_visits_immutable ON rec.reception_visits;
CREATE TRIGGER tg_reception_visits_immutable
  BEFORE UPDATE ON rec.reception_visits
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'appointment_id', 'walk_in_id', 'vehicle_id',
    'odometer_reading_id', 'fuel_level_id', 'ev_soc_percent', 'receiving_employee_id',
    'receiving_employee_display_name', 'custody_accepted_at', 'created_at', 'created_by');
