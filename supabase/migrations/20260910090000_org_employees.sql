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
-- Working ASSUMPTIONS, pending Owner confirmation
--   Recorded here and in docs/phase-1/phase-1-31/delivering-employee-identity-seam.md
--   as assumptions rather than decisions, because each one is a shape this DDL
--   commits to and each could be answered the other way:
--     A-1  an employee may exist with NO user account (`user_account_id` NULL);
--     A-2  an employee has ONE home branch, and it is transferable, which is
--          why `branch_id` is NOT frozen by the immutable guard below;
--     A-3  rows minted by the companion backfill are `inactive`, because
--          nothing has confirmed that the legacy account is a current employee;
--     A-4  `employment_ref` is optional, opaque, and unique per tenant when it
--          is present.
--
-- Security implications
--   * Tenant/company/branch RLS on the sal.delivery_records template: SELECT to
--     app_runtime and app_readonly, INSERT and UPDATE to app_runtime, and NO
--     DELETE grant and no delete policy for any application role. An employee
--     is retired by `status = 'inactive'`, never removed, because a removed
--     employee would orphan the deliveries that cite them.
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
--   Constraints: pk_employees, uq_employees_scope_id, fk_employees_tenant,
--                fk_employees_branch, fk_employees_user_account,
--                ck_employees_display_name_not_blank,
--                ck_employees_employment_ref_not_blank, ck_employees_status
--   Indexes:     ix_employees_user_account, ix_employees_tenant_status,
--                uq_employees_user_account_live, uq_employees_employment_ref_live
--   Triggers:    tg_employees_touch_metadata, tg_employees_immutable
--   Policies:    sel_employees_scope, ins_employees_scope, upd_employees_scope
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
  -- The composite candidate key sal.delivery_records points at. Its index also
  -- covers fk_employees_tenant and fk_employees_branch, which is why neither
  -- gets an index of its own: a second one would be redundant and the
  -- duplicate-index sweep in tests/db/org-security.test.ts exists to say so.
  CONSTRAINT uq_employees_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
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
  'P1-31 prerequisite P-17. Tenant-owned employee identity, distinct from the login account (iam.user_accounts), from the authenticated actor and from the authorized receiver. Branch-scoped and RLS-forced; exposes UNIQUE (tenant_id, company_id, branch_id, id) so a branch-scoped record such as sal.delivery_records can name an employee without widening its own scope. Deliberately NOT an HR master: no contract, salary, contact detail or document lives here.';
COMMENT ON COLUMN org.employees.user_account_id IS
  'The login account this employee signs in with, or NULL when they have none. Same-tenant by composite foreign key. Nullable on purpose: tech.technician_profiles and iam.user_employee_links both REQUIRE an account, which is why neither could carry this identity.';
COMMENT ON COLUMN org.employees.employment_ref IS
  'Opaque, optional link to an employment record held outside this platform. Unique per tenant among live rows. Never a name, a contact detail or a national identifier.';
COMMENT ON COLUMN org.employees.branch_id IS
  'The home branch. Mutable by design (Owner assumption A-2, transfer), which is why the immutable guard on this table does not freeze it.';
COMMENT ON COLUMN org.employees.status IS
  'active or inactive. Retirement is a status change and never a delete: no application role holds DELETE on this table, because a removed employee would orphan every delivery that cites them.';

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

CREATE POLICY sel_employees_scope ON org.employees
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
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
