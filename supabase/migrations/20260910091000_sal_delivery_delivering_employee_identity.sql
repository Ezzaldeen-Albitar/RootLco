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
-- The legacy mint is an OPERATOR COMMAND, not a statement in this file
--   Legacy values were unconstrained uuids, so each distinct (tenant, value) has
--   to be judged on its own: one that matches an iam.user_accounts id of the same
--   tenant can be minted into org.employees carrying the legacy uuid as its own
--   id, and one that matches nothing must be left untouched and reported rather
--   than replaced by a person nobody confirmed.
--
--   Both of those write ROWS, and a migration that writes rows into org.employees
--   is refused by scripts/ci/migration-replay-checks.mjs — correctly, because to
--   any scanner and any reviewer it is indistinguishable from a migration that
--   ships fabricated people. So this file creates STRUCTURE ONLY and the
--   row-level work lives in
--   scripts/platform/backfill-delivering-employee-identity.mjs, an operator
--   command with an explicit target environment, a dry run, one transaction per
--   tenant and printed minted/unmatched counts.
--
--   The foreign key is therefore added NOT VALID. THIS FILE validates it only on
--   a database where sal.delivery_records is EMPTY — a fresh deployment and the
--   hosted replay, where VALIDATE CONSTRAINT is DDL over no rows and there is no
--   legacy history to judge. On a populated database the key stays NOT VALID,
--   still enforcing every future row, and the operator command validates it after
--   the mint, and only when nothing anywhere is left unresolved.
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
--     and app_readonly, tenant-scoped and RLS-forced, and no APPLICATION role
--     holds INSERT, UPDATE or DELETE on it. Its INSERT policy exists and refuses
--     every row (WITH CHECK (false)), so the refusal is stated in the catalog
--     rather than inferred from an absent policy. The owner role that runs
--     migrations and the operator command keeps its own privileges on it, which
--     is how the report is written and how a test fixture is removed again.
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
--   Policies:    sel_delivery_legacy_identity_review_tenant,
--                ins_delivery_legacy_identity_review_refused
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Where the legacy values that resolve to nobody are recorded.
-- ----------------------------------------------------------------------------
-- The rows are written by
-- scripts/platform/backfill-delivering-employee-identity.mjs, never here: see
-- the header. This migration creates the place they are written to, and the
-- read-only surface the Owner sees them through.
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
  'P1-31 prerequisite P-17. One row per delivery whose pre-P-17 delivering_employee_id matched no same-tenant identity when scripts/platform/backfill-delivering-employee-identity.mjs ran. Written by that operator command and by no application role: the application holds SELECT and nothing else. It exists so an unresolved handover identity is VISIBLE to the Owner instead of being silently replaced by a fabricated person or by the operator who ran the command.';
COMMENT ON COLUMN sal.delivery_legacy_identity_review.legacy_value IS
  'The unconstrained uuid the delivery recorded before P-17, preserved exactly. sal.delivery_records still holds it; this is a pointer, not a replacement.';
COMMENT ON COLUMN sal.delivery_legacy_identity_review.recorded_at IS
  'When the operator command observed the value as unresolved. Not when the handover happened.';

-- The operator command runs as the database owner role, which holds BYPASSRLS in
-- the local Supabase stack and is a superuser in the plain postgres:17 CI
-- container: the measured role landscape recorded in section 15 of
-- docs/database/migration-standard.md, lines 364-369. That is the same
-- convention every migration here relies on, and it is how the report below
-- reaches a table no application role may write. What is deliberately NOT used,
-- here or anywhere in this repository, is SET row_security = off -- it raises
-- 42501 for a role without BYPASSRLS, and tests/db/rls.test.ts asserts exactly
-- that.
ALTER TABLE sal.delivery_legacy_identity_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_legacy_identity_review FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_delivery_legacy_identity_review_tenant ON sal.delivery_legacy_identity_review
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_delivery_legacy_identity_review_tenant ON sal.delivery_legacy_identity_review IS
  'Within-tenant read only. The companion INSERT policy refuses every row and no application role holds INSERT, UPDATE or DELETE: the review list is evidence, and evidence a tenant can edit is not evidence.';

-- An INSERT policy that admits NOTHING, and that is the point.
--
-- Every sal, wty and rpt table carries a tenant-scoped SELECT and INSERT policy;
-- tests/db/p1-11-isolation.test.ts enumerates them from the catalog and requires
-- both of every table. This table is deliberately not writable by an application
-- role, so the invariant is satisfied the honest way rather than by exempting the
-- table from it: the policy EXISTS and its WITH CHECK is `false`, so the refusal
-- is a declared decision readable in pg_policy instead of an absence a reader has
-- to interpret. app_runtime also holds no INSERT grant, so the refusal happens at
-- 42501 before a policy is ever consulted — asserted in tests/db/org-employees.test.ts
-- obligation 6 — and this policy is what states WHY there is no grant.
CREATE POLICY ins_delivery_legacy_identity_review_refused ON sal.delivery_legacy_identity_review
  FOR INSERT TO app_runtime
  WITH CHECK (false);

COMMENT ON POLICY ins_delivery_legacy_identity_review_refused ON sal.delivery_legacy_identity_review IS
  'Refuses every application write, deliberately. The review list is written only by scripts/platform/backfill-delivering-employee-identity.mjs on a privileged connection; app_runtime holds no INSERT grant either, so this policy declares the decision rather than enforcing it alone.';

GRANT SELECT ON sal.delivery_legacy_identity_review TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 2. The historical snapshot, and the reference that now means something.
-- ----------------------------------------------------------------------------
-- NULLABLE, and that nullability carries meaning: NULL is "this handover's
-- delivering identity was never resolved". It is true of exactly the rows the
-- operator command lists in sal.delivery_legacy_identity_review and of no row
-- created after this migration — the trigger below stamps every one of those,
-- and the command stamps the legacy rows whose identity it mints.
ALTER TABLE sal.delivery_records
  ADD COLUMN delivering_employee_display_name text NULL;

-- The rows whose delivering employee ALREADY exists — nothing is minted here, so
-- on a fresh database this matches nothing and on a populated one it matches only
-- what was already resolvable. The legacy rows are stamped by the operator
-- command, in the same transaction as their mint.
UPDATE sal.delivery_records AS record
   SET delivering_employee_display_name = employee.display_name
  FROM org.employees AS employee
 WHERE employee.tenant_id = record.tenant_id
   AND employee.id = record.delivering_employee_id;

ALTER TABLE sal.delivery_records
  ADD CONSTRAINT ck_delivery_records_delivering_employee_name
    CHECK (delivering_employee_display_name IS NULL
           OR btrim(delivering_employee_display_name) <> ''),
  -- NOT VALID, and validated below only on a database with no delivery history at
  -- all. It is enforced for every future row from this moment either way; what
  -- validation adds is the claim that the HISTORY satisfies it too, and that is a
  -- claim this migration is only entitled to make when there is no history.
  ADD CONSTRAINT fk_delivery_records_delivering_employee
    FOREIGN KEY (tenant_id, delivering_employee_id)
    REFERENCES org.employees (tenant_id, id) ON DELETE RESTRICT NOT VALID;

-- A fresh database validates HERE. A populated one validates through the operator
-- command, after the mint, and only when nothing anywhere is left unresolved.
--
-- The condition is "sal.delivery_records is empty" rather than "nothing is
-- unresolved", and the difference is deliberate: with the mint moved out of this
-- file, every legacy row is unresolved AT THIS MOMENT however resolvable it may
-- be, so validating on an emptiness of the review table would validate against a
-- report nothing has written yet. `VALIDATE CONSTRAINT` is DDL, which is why it
-- may live in a migration while the mint may not.
DO $$
DECLARE
  v_deliveries bigint;
BEGIN
  SELECT count(*) INTO v_deliveries FROM sal.delivery_records;

  IF v_deliveries = 0 THEN
    ALTER TABLE sal.delivery_records
      VALIDATE CONSTRAINT fk_delivery_records_delivering_employee;
  ELSE
    RAISE NOTICE
      'P-17: % delivery record(s) predate this migration, so fk_delivery_records_delivering_employee stays NOT VALID — binding every future row, proving no past one. Run scripts/platform/backfill-delivering-employee-identity.mjs to mint the identities that resolve, list the ones that do not, and validate the key when nothing is left unresolved.',
      v_deliveries;
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
  'Immutable display-name snapshot captured server-side at creation, so historical display survives a rename, a retirement or a soft delete. NULL only on a pre-P-17 row whose delivering employee id resolved to nobody, or one scripts/platform/backfill-delivering-employee-identity.mjs has not yet processed; the unresolved rows are listed in sal.delivery_legacy_identity_review.';

-- ----------------------------------------------------------------------------
-- 3. The eligibility guard and the stamp.
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
