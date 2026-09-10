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
-- The reference names the TENANT and nothing narrower (Owner clarification)
--   The key is (tenant_id, delivering_employee_id). An employee's HOME BRANCH
--   is informational and transferable, and it must not become a restriction
--   against authorized work in another branch of the same tenant — a colleague
--   sent to another site to hand a vehicle over is a normal day, not a defect.
--   So neither the foreign key nor the trigger below compares company or
--   branch. What both still refuse is an employee who is inactive, soft-deleted
--   or of another tenant.
--
-- This is the EXPAND step of section 7 of docs/database/migration-standard.md
--   `delivering_employee_id` keeps its name, its type and its position; what is
--   added beside it is the constraint that gives it meaning and the snapshot
--   that preserves what it meant. There is no contract step to schedule: no
--   column is superseded and none is scheduled for removal.
--
-- The backfill mints, and where it cannot it REPORTS — it never invents
--   Legacy values were unconstrained uuids, so each distinct (tenant, value) is
--   judged on its own:
--     * matches an iam.user_accounts id of the SAME tenant -> one org.employees
--       row is minted carrying THE LEGACY UUID AS ITS OWN id, linked to that
--       account and named from it, so the historical row keeps pointing at
--       exactly the person it always pointed at;
--     * matches nothing -> the value is LEFT UNTOUCHED. It is not replaced by
--       the actor, no person is fabricated for it, and the migration does not
--       fail. The delivery is recorded in sal.delivery_legacy_identity_review
--       so the Owner can see precisely which handovers carry an unresolved
--       identity, and its display-name snapshot stays NULL, which is what NULL
--       means in that column.
--   The foreign key is therefore added NOT VALID and validated in the same
--   migration only when nothing is unresolved. A fresh database and a replay of
--   this migration over history that all resolves both end FULLY VALIDATED; a
--   database carrying unresolved history keeps the constraint NOT VALID, which
--   still enforces every future row, and says so with a NOTICE.
--
-- Security implications
--   * The eligibility rules and the snapshot are enforced by a BEFORE INSERT
--     trigger, so they hold for every writer — the application, a future job,
--     and psql alike. The application layer is not the authority; it exists to
--     turn these refusals into messages an operator can act on.
--   * SECURITY INVOKER with an empty search_path: the employee lookup runs under
--     the caller's own RLS, so an employee in another tenant is invisible before
--     the foreign key is ever consulted.
--   * ON DELETE RESTRICT, and org.employees grants DELETE to no application
--     role, so a handover officer cannot be erased out of a delivery's history.
--   * The review table is READ-ONLY to the application: SELECT to app_runtime
--     and app_readonly, tenant-scoped and RLS-forced, and no role holds INSERT,
--     UPDATE or DELETE on it. It is written once, here.
--
-- Objects created
--   Tables:      sal.delivery_legacy_identity_review
--   Columns:     sal.delivery_records.delivering_employee_display_name
--   Constraints: fk_delivery_records_delivering_employee,
--                ck_delivery_records_delivering_employee_name,
--                pk_delivery_legacy_identity_review,
--                fk_delivery_legacy_identity_review_tenant
--   Indexes:     ix_delivery_records_delivering_employee
--   Functions:   sal.stamp_delivering_employee_identity()
--   Triggers:    tg_delivery_records_delivering_employee;
--                tg_delivery_records_immutable recreated with the new column
--   Policies:    sel_delivery_legacy_identity_review_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Mint one employee per legacy value that resolves to a same-tenant account.
-- ----------------------------------------------------------------------------
-- The minted row takes the legacy uuid as its primary key, so one legacy value
-- becomes exactly one employee however many deliveries cite it. The home branch
-- is taken from that employee's EARLIEST delivery and is informational only
-- (Owner decision A-2), which is why a legacy value appearing in two branches is
-- no longer ambiguous and no longer a reason to refuse: DISTINCT ON picks the
-- first deterministically and nothing downstream reads the choice as a rule.
INSERT INTO org.employees
  (id, tenant_id, company_id, branch_id, display_name, user_account_id, status, created_by)
SELECT legacy.delivering_employee_id,
       legacy.tenant_id,
       legacy.company_id,
       legacy.branch_id,
       account.display_name,
       account.id,
       -- Assumption A-3. A legacy account is evidence that somebody handed a
       -- vehicle over once, not evidence that they are on the roster today.
       'inactive',
       -- The person themselves, because there is no other honest actor to name:
       -- no operator ran this and inventing one would be a fabricated record.
       account.id
  FROM (
    SELECT DISTINCT ON (record.tenant_id, record.delivering_employee_id)
           record.tenant_id,
           record.delivering_employee_id,
           record.company_id,
           record.branch_id
      FROM sal.delivery_records AS record
     ORDER BY record.tenant_id, record.delivering_employee_id, record.created_at, record.id
  ) AS legacy
  JOIN iam.user_accounts AS account
    ON account.tenant_id = legacy.tenant_id
   AND account.id = legacy.delivering_employee_id;

-- ----------------------------------------------------------------------------
-- 2. Record the legacy values that resolve to nobody, rather than guessing one.
-- ----------------------------------------------------------------------------
CREATE TABLE sal.delivery_legacy_identity_review (
  tenant_id     uuid        NOT NULL,
  -- The sal.delivery_records row whose delivering employee did not resolve.
  -- Deliberately NOT a foreign key: sal.delivery_records exposes no
  -- (tenant_id, id) candidate key, and widening one for a review log would put
  -- a diagnostic table in the way of the delivery's own scope contract. The
  -- delivery cannot be deleted anyway — no application role holds DELETE on it.
  delivery_id   uuid        NOT NULL,
  -- The uuid the column held before this migration, preserved verbatim. It is
  -- the same value sal.delivery_records still holds; nothing rewrote it.
  legacy_value  uuid        NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_delivery_legacy_identity_review PRIMARY KEY (tenant_id, delivery_id),
  -- Covered by the primary key's leading column, so it needs no index of its own.
  CONSTRAINT fk_delivery_legacy_identity_review_tenant FOREIGN KEY (tenant_id)
    REFERENCES org.tenants (id) ON DELETE RESTRICT
);

COMMENT ON TABLE sal.delivery_legacy_identity_review IS
  'P1-31 prerequisite P-17. One row per delivery whose pre-P-17 delivering_employee_id matched no same-tenant identity when the identity migration ran. Written once by that migration and by nothing else: the application holds SELECT only. It exists so an unresolved handover identity is VISIBLE to the Owner instead of being silently replaced by a fabricated person or by the migrating actor.';
COMMENT ON COLUMN sal.delivery_legacy_identity_review.legacy_value IS
  'The unconstrained uuid the delivery recorded before P-17, preserved exactly. sal.delivery_records still holds it; this is a pointer, not a replacement.';
COMMENT ON COLUMN sal.delivery_legacy_identity_review.recorded_at IS
  'When the identity migration observed the value as unresolved. Not when the handover happened.';

INSERT INTO sal.delivery_legacy_identity_review (tenant_id, delivery_id, legacy_value)
SELECT record.tenant_id, record.id, record.delivering_employee_id
  FROM sal.delivery_records AS record
 WHERE NOT EXISTS (
   SELECT 1
     FROM org.employees AS employee
    WHERE employee.tenant_id = record.tenant_id
      AND employee.id = record.delivering_employee_id
 );

-- RLS is enabled AFTER the insert above, deliberately. FORCE ROW LEVEL SECURITY
-- applies to the table owner too, and this table carries no INSERT policy for
-- anybody, so enabling it first would make the one honest write in its life
-- depend on the migrating role happening to be a superuser.
ALTER TABLE sal.delivery_legacy_identity_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_legacy_identity_review FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_delivery_legacy_identity_review_tenant ON sal.delivery_legacy_identity_review
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_delivery_legacy_identity_review_tenant ON sal.delivery_legacy_identity_review IS
  'Within-tenant read only. No INSERT, UPDATE or DELETE policy and no such grant for any application role: the review list is evidence, and evidence a tenant can edit is not evidence.';

GRANT SELECT ON sal.delivery_legacy_identity_review TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 3. The historical snapshot, and the reference that now means something.
-- ----------------------------------------------------------------------------
-- NULLABLE, and that nullability carries meaning: NULL is "this handover's
-- delivering identity was never resolved", which is true of exactly the rows
-- listed in sal.delivery_legacy_identity_review and of no row created after
-- this migration — the trigger below stamps every one of those.
ALTER TABLE sal.delivery_records
  ADD COLUMN delivering_employee_display_name text NULL;

UPDATE sal.delivery_records AS record
   SET delivering_employee_display_name = employee.display_name
  FROM org.employees AS employee
 WHERE employee.tenant_id = record.tenant_id
   AND employee.id = record.delivering_employee_id;

ALTER TABLE sal.delivery_records
  ADD CONSTRAINT ck_delivery_records_delivering_employee_name
    CHECK (delivering_employee_display_name IS NULL
           OR btrim(delivering_employee_display_name) <> ''),
  -- NOT VALID, then validated below when there is nothing left unresolved. It
  -- is enforced for every future row from this moment either way; what
  -- validation adds is the claim that the HISTORY satisfies it too, and that is
  -- a claim this migration is only entitled to make when it is true.
  ADD CONSTRAINT fk_delivery_records_delivering_employee
    FOREIGN KEY (tenant_id, delivering_employee_id)
    REFERENCES org.employees (tenant_id, id) ON DELETE RESTRICT NOT VALID;

DO $$
DECLARE
  v_unresolved bigint;
BEGIN
  SELECT count(*) INTO v_unresolved FROM sal.delivery_legacy_identity_review;

  IF v_unresolved = 0 THEN
    ALTER TABLE sal.delivery_records
      VALIDATE CONSTRAINT fk_delivery_records_delivering_employee;
  ELSE
    RAISE NOTICE
      'P-17: % delivery record(s) carry a delivering employee id that matched no same-tenant identity. They were left exactly as they were and listed in sal.delivery_legacy_identity_review; fk_delivery_records_delivering_employee stays NOT VALID until they are resolved.',
      v_unresolved;
  END IF;
END;
$$;

-- Covers the new foreign key. uq_delivery_records_scope_id ends in `id` rather
-- than `delivering_employee_id`, so it does not.
CREATE INDEX ix_delivery_records_delivering_employee
  ON sal.delivery_records (tenant_id, delivering_employee_id);

COMMENT ON COLUMN sal.delivery_records.delivering_employee_id IS
  'The org.employees identity that handed the vehicle over, of the SAME TENANT by composite foreign key. The employee home branch is deliberately not compared: it is informational and transferable, and a colleague may hand a vehicle over at another branch of their own organisation. Insert-time eligibility requires the employee to be live and active, and is enforced by tg_delivery_records_delivering_employee rather than by the application.';
COMMENT ON COLUMN sal.delivery_records.delivering_employee_display_name IS
  'Immutable display-name snapshot captured server-side at creation, so historical display survives a rename, a retirement or a soft delete. NULL only on a pre-P-17 row whose delivering employee id resolved to nobody; those rows are listed in sal.delivery_legacy_identity_review.';

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
BEGIN
  -- Tenant and lifecycle, and nothing about place. The employee's own company
  -- and branch are not read here at all, which is the strongest form the Owner
  -- clarification can take: a rule that reads no value cannot drift back into
  -- comparing it.
  SELECT employee.display_name, employee.status
    INTO v_display_name, v_status
    FROM org.employees AS employee
   WHERE employee.tenant_id = NEW.tenant_id
     AND employee.id = NEW.delivering_employee_id
     AND employee.deleted_at IS NULL;

  -- Absent, soft-deleted, or in a tenant this session cannot see. The three are
  -- ONE refusal on purpose: distinguishing them would turn the delivery insert
  -- into an existence oracle for another tenant's roster.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivering employee is not a live employee in this tenant'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Unconditionally. There is no permission anywhere in this platform that lets
  -- an operator name a retired employee as the person who handed a vehicle over.
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'delivering employee is not active'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Caller input is never authoritative for historical identity text.
  NEW.delivering_employee_display_name := v_display_name;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sal.stamp_delivering_employee_identity() IS
  'BEFORE INSERT on sal.delivery_records: resolves the named org.employees row of the same tenant under the caller RLS, refuses a soft-deleted or retired employee, and server-stamps the immutable display-name snapshot. It does NOT compare the employee home branch with the delivery branch: the home branch is informational and never a restriction (Owner decision of 2026-09-10).';
REVOKE EXECUTE ON FUNCTION sal.stamp_delivering_employee_identity() FROM PUBLIC;

CREATE TRIGGER tg_delivery_records_delivering_employee
  BEFORE INSERT ON sal.delivery_records
  FOR EACH ROW EXECUTE FUNCTION sal.stamp_delivering_employee_identity();

-- Recreated so the new snapshot, and the id it was taken from, are protected by
-- the same database backstop as the rest of the delivery's provenance. Nothing
-- in the product updates either column; this is what makes that a rule rather
-- than an observation. The guard compares with IS DISTINCT FROM, so an
-- unresolved NULL snapshot is frozen exactly like a stamped one: no application
-- write can fill in a name for a handover whose identity was never established,
-- which is the whole reason the unresolved rows are listed for the Owner
-- instead of being quietly completed.
DROP TRIGGER tg_delivery_records_immutable ON sal.delivery_records;
CREATE TRIGGER tg_delivery_records_immutable
  BEFORE UPDATE ON sal.delivery_records
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'reception_visit_id',
    'vehicle_id', 'delivering_employee_id', 'delivering_employee_display_name',
    'created_at', 'created_by');
