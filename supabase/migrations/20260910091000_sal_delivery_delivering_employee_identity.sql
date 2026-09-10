-- ============================================================================
-- P1-31 prerequisite P-17 — the delivering employee becomes a real identity.
-- Owner module: sal (reference target: org.employees)
--
-- Rollback classification: ROLL-FORWARD-ONLY once any delivery exists. Dropping
--   delivering_employee_display_name destroys the historical handover evidence
--   this migration exists to create, and dropping the foreign key readmits the
--   arbitrary uuid it exists to forbid. Forward-only — no down script.
--
-- Purpose
--   `sal.delivery_records.delivering_employee_id` landed in P1-11 as NOT NULL
--   with NO foreign key. Any uuid at all was a legal handover officer, so the
--   column recorded a CLAIM rather than an identity — the same defect
--   20260815093000 closed for the receiving employee, and the reason
--   `docs/product/owner-workflow-requirements.md` carried an unlabelled
--   register row for it.
--
--   The receiving employee was bound to iam.user_accounts because the person
--   accepting custody at reception signs in. The Owner decision of 2026-09-10
--   settles the delivering employee differently and deliberately: it binds to
--   org.employees, so a workshop can name someone who has no login at all.
--
-- This is the EXPAND step of section 7 of docs/database/migration-standard.md
--   `delivering_employee_id` keeps its name, its type and its position; what is
--   added beside it is the constraint that gives it meaning and the snapshot
--   that preserves what it meant. There is no contract step to schedule: no
--   column is superseded and none is scheduled for removal.
--
-- The backfill mints, it never invents
--   Existing values are iam.user_accounts ids. One org.employees row is minted
--   per distinct (tenant, company, branch, delivering_employee_id), carrying
--   THE LEGACY UUID AS ITS OWN id so that every historical row keeps pointing at
--   exactly the person it always pointed at, with `status = 'inactive'` because
--   nothing here has confirmed that a legacy account is a current employee. If a
--   legacy value matches no same-tenant account, this migration RAISES rather
--   than guessing a person or substituting the actor — the same refusal
--   20260815093000 makes, for the same reason: a falsified custody history is
--   worse than a failed deployment.
--
-- Security implications
--   * The eligibility rules and the snapshot are enforced by a BEFORE INSERT
--     trigger, so they hold for every writer — the application, a future job,
--     and psql alike. The application layer is not the authority; it exists to
--     turn these refusals into messages an operator can act on.
--   * SECURITY INVOKER with an empty search_path: the employee lookup runs under
--     the caller's own RLS, so an employee in another tenant is invisible before
--     the foreign key is ever consulted.
--   * The foreign key is on all four scope columns, so an employee of ANOTHER
--     BRANCH is refused by the constraint and not merely by the trigger.
--     ON DELETE RESTRICT, and org.employees grants DELETE to no application
--     role, so a handover officer cannot be erased out of a delivery's history.
--
-- Objects created
--   Columns:     sal.delivery_records.delivering_employee_display_name
--   Constraints: fk_delivery_records_delivering_employee,
--                ck_delivery_records_delivering_employee_name
--   Indexes:     ix_delivery_records_delivering_employee
--   Functions:   sal.stamp_delivering_employee_identity()
--   Triggers:    tg_delivery_records_delivering_employee;
--                tg_delivery_records_immutable recreated with the new column
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Refuse ambiguity BEFORE minting anything.
-- ----------------------------------------------------------------------------
-- The minted row takes the legacy uuid as its primary key, so one legacy value
-- can become exactly one employee. A tenant whose deliveries used the same
-- delivering_employee_id in two different branches cannot be backfilled without
-- deciding which branch that person belongs to, and that is an Owner decision
-- rather than a migration's.
DO $$
DECLARE
  v_ambiguous bigint;
BEGIN
  SELECT count(*) INTO v_ambiguous
    FROM (
      SELECT tenant_id, delivering_employee_id
        FROM sal.delivery_records
       GROUP BY tenant_id, delivering_employee_id
      HAVING count(DISTINCT (company_id, branch_id)) > 1
    ) AS ambiguous;

  IF v_ambiguous <> 0 THEN
    RAISE EXCEPTION
      'P-17 migration refused: % delivering employee id(s) appear in more than one branch of their tenant; assign each one a home branch before retrying',
      v_ambiguous
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Refuse a dangling legacy value, then mint.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_dangling bigint;
BEGIN
  SELECT count(*) INTO v_dangling
    FROM (
      SELECT DISTINCT record.tenant_id, record.delivering_employee_id
        FROM sal.delivery_records AS record
       WHERE NOT EXISTS (
         SELECT 1 FROM iam.user_accounts AS account
          WHERE account.tenant_id = record.tenant_id
            AND account.id = record.delivering_employee_id
       )
    ) AS dangling;

  IF v_dangling <> 0 THEN
    RAISE EXCEPTION
      'P-17 migration refused: % delivering employee id(s) match no same-tenant IAM account; provision the exact org.employees rows before retrying',
      v_dangling
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

INSERT INTO org.employees
  (id, tenant_id, company_id, branch_id, display_name, user_account_id, status, created_by)
SELECT DISTINCT
       record.delivering_employee_id,
       record.tenant_id,
       record.company_id,
       record.branch_id,
       account.display_name,
       account.id,
       -- Assumption A-3. A legacy account is evidence that somebody handed a
       -- vehicle over once, not evidence that they are on the roster today.
       'inactive',
       -- The person themselves, because there is no other honest actor to name:
       -- no operator ran this and inventing one would be a fabricated record.
       account.id
  FROM sal.delivery_records AS record
  JOIN iam.user_accounts AS account
    ON account.tenant_id = record.tenant_id
   AND account.id = record.delivering_employee_id;

-- ----------------------------------------------------------------------------
-- 3. The historical snapshot, backfilled before it is made mandatory.
-- ----------------------------------------------------------------------------
ALTER TABLE sal.delivery_records
  ADD COLUMN delivering_employee_display_name text NULL;

UPDATE sal.delivery_records AS record
   SET delivering_employee_display_name = employee.display_name
  FROM org.employees AS employee
 WHERE employee.tenant_id = record.tenant_id
   AND employee.company_id = record.company_id
   AND employee.branch_id = record.branch_id
   AND employee.id = record.delivering_employee_id;

ALTER TABLE sal.delivery_records
  ALTER COLUMN delivering_employee_display_name SET NOT NULL,
  ADD CONSTRAINT ck_delivery_records_delivering_employee_name
    CHECK (btrim(delivering_employee_display_name) <> ''),
  -- Fully validated, not NOT VALID: section 2 above proved every existing row
  -- resolves, and a constraint that is only enforced for future rows would
  -- leave the defect this migration closes half open.
  ADD CONSTRAINT fk_delivery_records_delivering_employee
    FOREIGN KEY (tenant_id, company_id, branch_id, delivering_employee_id)
    REFERENCES org.employees (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT;

-- Covers the new foreign key. uq_delivery_records_scope_id ends in `id` rather
-- than `delivering_employee_id`, so it does not.
CREATE INDEX ix_delivery_records_delivering_employee
  ON sal.delivery_records (tenant_id, company_id, branch_id, delivering_employee_id);

COMMENT ON COLUMN sal.delivery_records.delivering_employee_id IS
  'The org.employees identity that handed the vehicle over. Same tenant, company and branch by composite foreign key; insert-time eligibility requires the employee to be live and active, and is enforced by tg_delivery_records_delivering_employee rather than by the application.';
COMMENT ON COLUMN sal.delivery_records.delivering_employee_display_name IS
  'Immutable display-name snapshot captured server-side at creation. Historical display remains readable after the employee is renamed, retired or soft-deleted.';

-- ----------------------------------------------------------------------------
-- 4. The eligibility guard and the stamp.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.stamp_delivering_employee_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_display_name text;
  v_status       text;
  v_company_id   uuid;
  v_branch_id    uuid;
BEGIN
  SELECT employee.display_name, employee.status, employee.company_id, employee.branch_id
    INTO v_display_name, v_status, v_company_id, v_branch_id
    FROM org.employees AS employee
   WHERE employee.tenant_id = NEW.tenant_id
     AND employee.id = NEW.delivering_employee_id
     AND employee.deleted_at IS NULL;

  -- Absent, soft-deleted, or in a tenant or scope this session cannot see. The
  -- three are ONE refusal on purpose: distinguishing them would turn the
  -- delivery insert into an existence oracle for another tenant's roster.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivering employee is not a live employee in this tenant'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lifecycle before scope, and unconditionally. There is no permission
  -- anywhere in this platform that lets an operator name a retired employee as
  -- the person who handed a vehicle over.
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'delivering employee is not active'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The foreign key says the same thing, and it is not redundant: the key
  -- refuses with a 23503 naming a constraint, and this refuses with a message
  -- the application turns into a field-level violation the caller can act on.
  IF v_company_id <> NEW.company_id OR v_branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'delivering employee belongs to another branch'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Caller input is never authoritative for historical identity text.
  NEW.delivering_employee_display_name := v_display_name;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sal.stamp_delivering_employee_identity() IS
  'BEFORE INSERT on sal.delivery_records: resolves the named org.employees row under the caller RLS, refuses a soft-deleted, retired or other-branch employee, and server-stamps the immutable display-name snapshot.';
REVOKE EXECUTE ON FUNCTION sal.stamp_delivering_employee_identity() FROM PUBLIC;

CREATE TRIGGER tg_delivery_records_delivering_employee
  BEFORE INSERT ON sal.delivery_records
  FOR EACH ROW EXECUTE FUNCTION sal.stamp_delivering_employee_identity();

-- Recreated so the new snapshot, and the id it was taken from, are protected by
-- the same database backstop as the rest of the delivery's provenance. Nothing
-- in the product updates either column; this is what makes that a rule rather
-- than an observation.
DROP TRIGGER tg_delivery_records_immutable ON sal.delivery_records;
CREATE TRIGGER tg_delivery_records_immutable
  BEFORE UPDATE ON sal.delivery_records
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'reception_visit_id',
    'vehicle_id', 'delivering_employee_id', 'delivering_employee_display_name',
    'created_at', 'created_by');
