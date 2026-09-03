-- ============================================================================
-- PRE-P1-29 BR-02 — the job/department routing relationship.
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-ROUTING. While the column is
-- nullable and every value is NULL, the three statements at the foot of this
-- file restore the prior state exactly. Once a job carries a department, dropping
-- the column destroys routing history that NOTHING else in the schema records —
-- wo.job_status_history tracks state, not routing — so the rollback window closes
-- the moment the first non-null value is written.
--
-- ## What this closes, and what it deliberately does not
--
-- Owner requirement 3 is "multiple departments may work on one vehicle" and
-- requirement 4 is "configurable department list". Requirement 4 landed with
-- PRE-P1-29 Wave C, which gave org.departments its first create/list/update
-- surface. This migration is the other half: the relationship that makes a
-- department mean something to work execution.
--
-- The superseded claim that departments do not exist is FALSE and must not be
-- repeated. org.departments has been modelled thoroughly since 20260717104000 —
-- scope FK, code format, status, live-code uniqueness, RLS enabled AND forced,
-- three scope policies. iam.grant_scopes has been able to name a department since
-- 20260718092000, and iam.has_permission_in_scope has resolved
-- scope_type = 'department' since 20260718097000. What was missing was never the
-- table; it was a way in (Wave C) and a work-domain record that could belong to
-- one (this).
--
-- ## Why the column goes on wo.jobs and nowhere else
--
--   wo.work_orders     — cannot express "multiple departments on one vehicle",
--                        which IS the requirement. One order, two jobs, two
--                        departments is the only shape this schema offers.
--   wo.job_assignments — conflates WHO with WHICH UNIT, and a job with no
--                        assignment would lose its department.
--   tech.technician_profiles — a technician's home unit is a roster fact, not a
--                        routing fact; the job's department would then depend on
--                        who happened to be assigned.
--   a wo.job_departments join — a job is worked by one department at a time; a
--                        many-to-many models a situation nobody has asked for and
--                        makes every read a join.
--
-- ## Nullable is required, not preferred
--
-- Every existing job has no department and there is no honest value to backfill.
-- A NOT NULL column would need a default department, which would be fabricated
-- business data — forbidden by the standing no-fake-data policy and, for this
-- table, meaningless. A job that predates routing legitimately has none.
--
-- ## The FK is a transcription, not a design
--
-- wo.jobs already carries (tenant_id, company_id, branch_id) NOT NULL, and
-- org.departments already carries uq_departments_scope_id UNIQUE on the matching
-- tuple — added at 20260718092000:58 for exactly this purpose. Carrying the full
-- composite makes a cross-branch or cross-tenant department reference
-- STRUCTURALLY IMPOSSIBLE rather than merely checked, which is how every other
-- parentage in this domain works.
--
-- ## What is NOT changed here, each deliberately
--
--   RLS      — wo.jobs' policies are tenant/company/branch and need no edit. No
--              wo policy reads department_id, and none should be added: the
--              delegation backstop already says "branch covers its departments",
--              so a department-scoped grant narrows nothing new. That is asserted
--              by test rather than assumed, because the combination has never
--              been exercised against a table that actually carries the column.
--   grants   — app_runtime already holds UPDATE on wo.jobs.
--   immutability — department_id is deliberately ABSENT from tg_jobs_immutable.
--              Re-routing a job to another department is a legitimate operational
--              act, and freezing it would make the column write-once by accident.
-- ============================================================================

ALTER TABLE wo.jobs
  ADD COLUMN department_id uuid NULL;

COMMENT ON COLUMN wo.jobs.department_id IS
  'The organisational unit working this job, or NULL when the job predates routing or has been unrouted. Nullable by necessity rather than preference: no honest backfill exists and a default department would be fabricated business data. Bound to the job''s own (tenant_id, company_id, branch_id) by fk_jobs_department, so a cross-branch reference is structurally impossible rather than checked. Not frozen by tg_jobs_immutable — re-routing is a legitimate operational act.';

-- The FULL composite. Anything narrower would let a job in one branch name a
-- department in another, and the application would become the only thing
-- standing between the two.
ALTER TABLE wo.jobs
  ADD CONSTRAINT fk_jobs_department
    FOREIGN KEY (tenant_id, company_id, branch_id, department_id)
    REFERENCES org.departments (tenant_id, company_id, branch_id, id)
    ON DELETE RESTRICT;

-- Required, not speculative: these four schemas hold a measured ZERO unindexed
-- foreign keys, and the P1-28 reception work shipped six before that was noticed.
-- The leading columns also serve the department-filtered job read.
CREATE INDEX ix_jobs_department
  ON wo.jobs (tenant_id, company_id, branch_id, department_id);

-- ============================================================================
-- Exact rollback (safe ONLY while every department_id is NULL):
--   DROP INDEX wo.ix_jobs_department;
--   ALTER TABLE wo.jobs DROP CONSTRAINT fk_jobs_department;
--   ALTER TABLE wo.jobs DROP COLUMN department_id;
-- ============================================================================
