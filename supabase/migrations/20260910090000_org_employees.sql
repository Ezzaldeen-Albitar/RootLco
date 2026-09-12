-- ============================================================================
-- P1-31 prerequisite P-17 — org.employees, the tenant-owned employee identity.
-- Owner module: org
--
-- Rollback classification: ROLL-FORWARD-ONLY. The companion migration
--   20260910091000 re-points sal.delivery_records.delivering_employee_id at
--   this table and backfills a display-name snapshot from it, so dropping this
--   table would destroy the only record of who handed a vehicle over. No down
--   script.
--
-- Purpose
--   The platform had no employee. It had LOGIN ACCOUNTS (iam.user_accounts),
--   and every attempt to name a person who did something resolved to one:
--   `tech.technician_profiles.user_id` and `iam.user_employee_links.user_id`
--   are both NOT NULL foreign keys into iam.user_accounts, so neither can
--   represent a person who has no reason to sign in. That was measured before
--   this table was proposed, and it is the whole justification for a new one.
--
--   The Owner decision of 2026-09-10 states the shape: an employee is a
--   TENANT-OWNED IDENTITY, distinct from the login account, from the
--   authenticated actor, and from the authorized receiver of a vehicle. The
--   reference and the organisational assignment are validated by the server.
--   Historical attribution survives a rename or a departure. It is deliberately
--   NOT an HR record: no contract, no salary, no contact detail, no document.
--
-- Working assumptions and their standing (Owner clarification of 2026-09-10)
--   Recorded here and in docs/phase-1/phase-1-31/delivering-employee-identity-seam.md
--   with the label each one actually carries, because two are now settled and
--   two are still engineering choices this DDL commits to:
--     A-1  OWNER DECISION (approved). An employee may exist with NO user
--          account (`user_account_id` NULL): employee identity is independent
--          of a login.
--     A-2  OWNER DECISION (approved). `branch_id` is the INFORMATIONAL home
--          branch and it is transferable. It is NOT a restriction — it never
--          decides whether this employee may be named on work recorded in
--          another branch of the same tenant. That is why the immutable guard
--          below does not freeze it and why nothing downstream compares it.
--     A-3  ENGINEERING CHOICE — RECOMMENDATION PENDING OWNER APPROVAL. Rows
--          minted by the companion backfill are `inactive`. Recommendation:
--          keep `inactive`, because a legacy account is evidence that somebody
--          handed a vehicle over once, not that they are on the roster today.
--     A-4  ENGINEERING CHOICE — RECOMMENDATION PENDING OWNER APPROVAL.
--          `employment_ref` is optional, opaque, and unique per tenant when it
--          is present. Recommendation: keep both. A mandatory reference would
--          exclude every employee who has no record in an external system, and
--          a non-unique one would stop it identifying anybody.
--
-- Security implications
--   * READ is TENANT-scoped, on the iam.user_accounts precedent, because A-2
--     says the home branch must not restrict authorized work elsewhere: a
--     branch-restricted operator recording a handover has to be able to resolve
--     an employee whose home branch is another one. WRITE stays scoped —
--     creating, transferring or retiring an employee is administration and the
--     INSERT and UPDATE policies keep the company/branch predicates. Reading the
--     register through the API is still scope-checked by the application, which
--     is where a branch-restricted administrator is refused.
--   * NO DELETE grant and no delete policy for any application role. An
--     employee is retired by `status = 'inactive'`, never removed, because a
--     removed employee would orphan the deliveries that cite them.
--   * `user_account_id` is nullable but never arbitrary: the composite foreign
--     key names (tenant_id, user_account_id), so an account belonging to
--     another tenant is refused by the constraint and invisible to the read
--     that precedes it.
--   * The partial uniques hold the two identity claims that must not be
--     duplicated inside a tenant: one employee per login account, and one
--     employee per employment reference. Both ignore soft-deleted rows.
--
-- Objects created
--   Tables:      org.employees
--   Constraints: pk_employees, uq_employees_tenant_id, fk_employees_tenant,
--                fk_employees_branch, fk_employees_user_account,
--                ck_employees_display_name_not_blank,
--                ck_employees_employment_ref_not_blank, ck_employees_status
--   Indexes:     ix_employees_branch, ix_employees_user_account,
--                ix_employees_tenant_status, uq_employees_user_account_live,
--                uq_employees_employment_ref_live
--   Triggers:    tg_employees_touch_metadata, tg_employees_immutable
--   Policies:    sel_employees_tenant, ins_employees_scope, upd_employees_scope
-- ============================================================================

CREATE TABLE org.employees (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  company_id        uuid        NOT NULL,
  branch_id         uuid        NOT NULL,
  -- The name the organisation uses for this person. It is the value the
  -- delivery snapshot is taken from, so it is required and never blank.
  display_name      text        NOT NULL,
  -- NULL when this employee has no reason to sign in. That nullability is the
  -- reason this table exists rather than a column on an existing one.
  user_account_id   uuid        NULL,
  -- An opaque link to an employment record held elsewhere. Never a name, never
  -- a contact detail, never a national identifier.
  employment_ref    text        NULL,
  status            text        NOT NULL DEFAULT 'active',
  record_version    integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid        NULL,
  deleted_at        timestamptz NULL,
  deleted_by        uuid        NULL,

  CONSTRAINT pk_employees PRIMARY KEY (id),
  -- The candidate key sal.delivery_records points at, and it names the TENANT
  -- and nothing narrower. A four-column key would have made the home branch a
  -- constraint on every record that cites an employee, which is exactly what
  -- A-2 forbids. Its index also covers fk_employees_tenant, which is why that
  -- key gets no index of its own.
  CONSTRAINT uq_employees_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_employees_tenant FOREIGN KEY (tenant_id)
    REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_user_account FOREIGN KEY (tenant_id, user_account_id)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_employees_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT ck_employees_employment_ref_not_blank
    CHECK (employment_ref IS NULL OR btrim(employment_ref) <> ''),
  CONSTRAINT ck_employees_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE org.employees IS
  'P1-31 prerequisite P-17. Tenant-owned employee identity, distinct from the login account (iam.user_accounts), from the authenticated actor and from the authorized receiver. RLS-forced, read tenant-wide and written scope-restricted; exposes UNIQUE (tenant_id, id) so a record such as sal.delivery_records can name an employee of the same tenant whatever branch that employee calls home. Deliberately NOT an HR master: no contract, salary, contact detail or document lives here.';
COMMENT ON COLUMN org.employees.user_account_id IS
  'The login account this employee signs in with, or NULL when they have none. Same-tenant by composite foreign key. Nullable on purpose: tech.technician_profiles and iam.user_employee_links both REQUIRE an account, which is why neither could carry this identity.';
COMMENT ON COLUMN org.employees.employment_ref IS
  'Opaque, optional link to an employment record held outside this platform. Unique per tenant among live rows. Never a name, a contact detail or a national identifier.';
COMMENT ON COLUMN org.employees.branch_id IS
  'The INFORMATIONAL home branch, transferable by design, which is why the immutable guard on this table does not freeze it (Owner decision A-2 of 2026-09-10). It records where this employee is based; it never restricts where they may be named. Nothing compares it to the branch of a record that cites this employee.';
COMMENT ON COLUMN org.employees.status IS
  'active or inactive. Retirement is a status change and never a delete: no application role holds DELETE on this table, because a removed employee would orphan every delivery that cites them.';

-- Covers fk_employees_branch, which uq_employees_tenant_id no longer does now
-- that the candidate key names only the tenant. It also serves the register
-- LIST, which is filtered on exactly this pair by the application.
CREATE INDEX ix_employees_branch ON org.employees (tenant_id, company_id, branch_id);
-- Covers fk_employees_user_account. NOT partial, deliberately: the foreign-key
-- index sweep ignores any index carrying a predicate, so the partial unique
-- below cannot stand in for it.
CREATE INDEX ix_employees_user_account ON org.employees (tenant_id, user_account_id);
CREATE INDEX ix_employees_tenant_status ON org.employees (tenant_id, status);

-- One employee per login account, and one per employment reference, among live
-- rows in a tenant. Both partial on the value being present AND the row not
-- soft-deleted, so a retired reference can be reissued after a soft delete and
-- an accountless employee is not competing for a NULL slot.
CREATE UNIQUE INDEX uq_employees_user_account_live
  ON org.employees (tenant_id, user_account_id)
  WHERE user_account_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_employees_employment_ref_live
  ON org.employees (tenant_id, employment_ref)
  WHERE employment_ref IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER tg_employees_touch_metadata
  BEFORE UPDATE ON org.employees
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
-- branch_id is absent from this list on purpose: a transfer is a legitimate
-- update (assumption A-2). Everything that would rewrite provenance is frozen.
CREATE TRIGGER tg_employees_immutable
  BEFORE UPDATE ON org.employees
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'created_at', 'created_by');

ALTER TABLE org.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.employees FORCE  ROW LEVEL SECURITY;

-- TENANT-wide read, on the iam.user_accounts precedent and for the same reason:
-- this is a directory of people, and Owner decision A-2 says the home branch of
-- a person is not a fence around them. A branch-restricted operator recording a
-- handover must be able to resolve a colleague based elsewhere in the same
-- tenant, and both the pre-check in the delivery module and
-- sal.stamp_delivering_employee_identity read through THIS policy. Scope is
-- still enforced where it belongs: the register's own read operations authorize
-- the row's company and branch in the application before answering.
CREATE POLICY sel_employees_tenant ON org.employees
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_employees_scope ON org.employees
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_employees_scope ON org.employees
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );

GRANT SELECT, INSERT, UPDATE ON org.employees TO app_runtime;
GRANT SELECT ON org.employees TO app_readonly;
