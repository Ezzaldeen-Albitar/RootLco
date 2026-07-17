-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: legal companies, branches, and branch status history
-- Tasks: P1-03-DB-005, P1-03-DB-006, P1-03-DB-007
-- Owner module: org
--
-- Purpose
--   The Tenant → Legal Company → Branch levels of the hierarchy, with the
--   composite keys that make cross-tenant references STRUCTURALLY impossible
--   (not merely filtered), plus append-only branch lifecycle history with an
--   atomic transition function usable by tenant runtime sessions.
--
-- Dependency
--   20260717101000_org_tenants.sql (org.tenants, guard),
--   20260717100000_org_reference_tables.sql (currencies, timezones).
--
-- Rollback classification: ROLLBACK-SAFE while empty; roll-forward-only once
--   organizational rows exist (the hierarchy is load-bearing for every later
--   business table).
--
-- Security implications
--   * Companies and branches are tenant-owned: RLS enabled AND forced,
--     default deny, tenant pivot exclusively from the server-resolved
--     transaction context. Client-supplied tenant/company/branch values are
--     never authorization.
--   * Composite FKs carry the tenant through every reference:
--     branches (tenant_id, company_id) → legal_companies (tenant_id, id).
--     A branch pointing at another tenant's company does not violate a
--     policy — it violates the FOREIGN KEY, which no session can bypass.
--   * Company/branch narrowing: the optional app.company_ids/app.branch_ids
--     context lists narrow visibility further (NULL = tenant-wide, matching
--     the Phase 1-2 allocator semantics).
--   * Branch history is append-only: INSERT+SELECT only for runtime (the
--     Phase 1-2 status-history pattern), no UPDATE/DELETE grant or policy.
--   * No jurisdiction assumption: registration fields are nullable
--     configuration-led text; no country-specific field is mandatory;
--     country_code is optional ISO 3166-1 alpha-2 shape-checked text.
--
-- Objects created
--   Tables:    org.legal_companies, org.branches, org.branch_status_history
--   Functions: org.guard_parent_company_live(), org.change_branch_status()
--   Triggers:  tg_legal_companies_touch_metadata, tg_legal_companies_immutable,
--              tg_branches_touch_metadata, tg_branches_immutable,
--              tg_branches_parent_company_live
--   Policies:  sel/ins/upd on legal_companies and branches;
--              sel/ins on branch_status_history
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. org.legal_companies (P1-03-DB-005)
--    Lifecycle class: soft-deletable + archivable.
-- ----------------------------------------------------------------------------
CREATE TABLE org.legal_companies (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL,
  company_code            text        NOT NULL,
  legal_name              text        NOT NULL,
  registration_number     text        NULL,
  tax_registration_number text        NULL,
  base_currency_code      text        NOT NULL,
  status                  text        NOT NULL DEFAULT 'active',
  record_version          integer     NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid        NOT NULL,
  updated_at              timestamptz NULL,
  updated_by              uuid        NULL,
  deleted_at              timestamptz NULL,
  deleted_by              uuid        NULL,
  archived_at             timestamptz NULL,
  archived_by             uuid        NULL,

  CONSTRAINT pk_legal_companies PRIMARY KEY (id),
  -- Composite candidate key: children reference (tenant_id, id) so the tenant
  -- travels through every FK — cross-tenant links are structurally impossible.
  CONSTRAINT uq_legal_companies_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_legal_companies_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_legal_companies_base_currency
    FOREIGN KEY (base_currency_code) REFERENCES shared.currencies (code),
  CONSTRAINT ck_legal_companies_code_format CHECK (company_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_legal_companies_legal_name_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT ck_legal_companies_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE org.legal_companies IS
  'Legal companies of a tenant (P1-03-DB-005). Tenant-owned; RLS forced; company codes are unique among ACTIVE (non-deleted) rows per tenant and reusable after soft delete; the same code may exist in different tenants. Registration fields are nullable configuration-led text — no jurisdiction-specific field is mandatory (OIR-04 open). base_currency_code references platform reference data; no application-wide default currency exists. Exposes UNIQUE (tenant_id, id) as the composite candidate key for all child FKs.';
COMMENT ON COLUMN org.legal_companies.registration_number IS
  'Commercial registration identifier as issued by the company''s own jurisdiction. Nullable, free-form: no format or presence assumption is baked in. Sensitivity: restricted.';
COMMENT ON COLUMN org.legal_companies.tax_registration_number IS
  'Tax registration identifier. Nullable, free-form, jurisdiction-neutral. Sensitivity: restricted.';

-- Active-only uniqueness: code frees after soft delete (proven pattern).
CREATE UNIQUE INDEX uq_legal_companies_tenant_code_active
  ON org.legal_companies (tenant_id, company_code)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_legal_companies_tenant_id_status
  ON org.legal_companies (tenant_id, status);
-- FK-support index (reverse lookup / RESTRICT enforcement on currency changes).
-- Not tenant-leading: it supports a platform-reference FK, which is the
-- documented justification the index standard requires.
CREATE INDEX ix_legal_companies_base_currency_code
  ON org.legal_companies (base_currency_code);

CREATE TRIGGER tg_legal_companies_touch_metadata
  BEFORE UPDATE ON org.legal_companies
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_legal_companies_immutable
  BEFORE UPDATE ON org.legal_companies
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_code');

-- ----------------------------------------------------------------------------
-- 2. org.branches (P1-03-DB-006)
-- ----------------------------------------------------------------------------
CREATE TABLE org.branches (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_code    text        NOT NULL,
  name           text        NOT NULL,
  address_line1  text        NULL,
  address_line2  text        NULL,
  city           text        NULL,
  region         text        NULL,
  postal_code    text        NULL,
  country_code   text        NULL,
  timezone_name  text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,
  archived_at    timestamptz NULL,
  archived_by    uuid        NULL,

  CONSTRAINT pk_branches PRIMARY KEY (id),
  CONSTRAINT uq_branches_tenant_id_id UNIQUE (tenant_id, id),
  -- Composite candidate key for branch children (departments, warehouses, …).
  CONSTRAINT uq_branches_tenant_company_id UNIQUE (tenant_id, company_id, id),
  -- The parent reference CARRIES THE TENANT: a cross-tenant or cross-company
  -- parent is a foreign-key violation, not a filtered-away row.
  CONSTRAINT fk_branches_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_branches_timezone
    FOREIGN KEY (timezone_name) REFERENCES shared.timezones (zone_name),
  CONSTRAINT ck_branches_code_format CHECK (branch_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_branches_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_branches_country_code_format
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT ck_branches_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE org.branches IS
  'Branches of a legal company (P1-03-DB-006). Tenant-owned; RLS forced. A branch belongs to exactly one company and tenant, enforced STRUCTURALLY by the composite FK (tenant_id, company_id) → org.legal_companies (tenant_id, id). Branch codes unique among active rows within tenant+company, reusable after soft delete, repeatable across tenants. Address fields are nullable configuration-led text — no jurisdiction assumption. timezone_name references the approved IANA approval list. Exposes UNIQUE (tenant_id, company_id, id) for branch children. No hidden pilot-tenant defaults exist.';

CREATE UNIQUE INDEX uq_branches_company_code_active
  ON org.branches (tenant_id, company_id, branch_code)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_branches_tenant_id_status ON org.branches (tenant_id, status);
-- FK-support index for the platform-reference timezone FK (documented
-- justification: reference FK, not a tenant query path).
CREATE INDEX ix_branches_timezone_name ON org.branches (timezone_name);

CREATE TRIGGER tg_branches_touch_metadata
  BEFORE UPDATE ON org.branches
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_branches_immutable
  BEFORE UPDATE ON org.branches
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_code');

-- A new branch may not be attached to a soft-deleted or archived company.
-- (A CHECK cannot subquery; RLS alone would not stop it; the FK alone would
-- accept it. This guard closes that gap at the database layer.)
CREATE OR REPLACE FUNCTION org.guard_parent_company_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted  timestamptz;
  v_archived timestamptz;
BEGIN
  SELECT c.deleted_at, c.archived_at INTO v_deleted, v_archived
  FROM org.legal_companies c
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.company_id;
  IF NOT FOUND THEN
    -- The composite FK produces the canonical error; nothing to add here.
    RETURN NEW;
  END IF;
  IF v_deleted IS NOT NULL OR v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'company % is soft-deleted or archived and cannot receive new branches', NEW.company_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_parent_company_live() IS
  'BEFORE INSERT guard on org.branches: rejects attaching a new branch to a soft-deleted or archived company (ERRCODE check_violation). Runs SECURITY INVOKER — under the inserting session''s own RLS, which already restricts it to its own tenant.';

REVOKE EXECUTE ON FUNCTION org.guard_parent_company_live() FROM PUBLIC;

CREATE TRIGGER tg_branches_parent_company_live
  BEFORE INSERT ON org.branches
  FOR EACH ROW EXECUTE FUNCTION org.guard_parent_company_live();

-- ----------------------------------------------------------------------------
-- 3. org.branch_status_history (P1-03-DB-007) — the Phase 1-2 status-history
--    pattern, applied to a real table.
-- ----------------------------------------------------------------------------
CREATE TABLE org.branch_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NOT NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,

  CONSTRAINT pk_branch_status_history PRIMARY KEY (id),
  CONSTRAINT fk_branch_status_history_branch
    FOREIGN KEY (tenant_id, branch_id)
    REFERENCES org.branches (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_branch_status_history_state_change
    CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_branch_status_history_states
    CHECK (
      to_state IN ('active', 'inactive')
      AND (from_state IS NULL OR from_state IN ('active', 'inactive'))
    ),
  CONSTRAINT ck_branch_status_history_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE org.branch_status_history IS
  'Append-only branch lifecycle evidence (P1-03-DB-007): every transition records who, when, why (reason mandatory — deactivation always carries its reason), and an optional correlation id. Written atomically with the status change by org.change_branch_status(). Runtime holds INSERT+SELECT only (the pinned Phase 1-2 pattern); no UPDATE/DELETE grant or policy exists. FR-ORG-004''s "block deactivation while active work exists" is a Phase 1-14 backend rule: the database cannot know about work-order tables that do not exist yet, and this record does not pretend it can.';

CREATE INDEX ix_branch_status_history_tenant_branch_occurred
  ON org.branch_status_history (tenant_id, branch_id, occurred_at);

-- ----------------------------------------------------------------------------
-- 4. Atomic branch transition (P1-03-DB-007). SECURITY INVOKER: it runs under
--    the caller's OWN grants and RLS — a runtime session can only transition
--    branches its context lets it see and update.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.change_branch_status(
  p_branch_id      uuid,
  p_to_state       text,
  p_reason         text,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_from      text;
  v_tenant_id uuid;
  v_actor     uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'branch status transition requires a reason'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_to_state NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'invalid branch status %', p_to_state USING ERRCODE = 'check_violation';
  END IF;

  v_actor := iam.current_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'branch status transition requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;

  -- RLS applies to this read: another tenant's branch is simply not found.
  SELECT b.status, b.tenant_id INTO v_from, v_tenant_id
  FROM org.branches b WHERE b.id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'branch % does not exist in this scope', p_branch_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_from = p_to_state THEN
    RAISE EXCEPTION 'branch % is already %', p_branch_id, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE org.branches SET status = p_to_state WHERE id = p_branch_id;

  INSERT INTO org.branch_status_history
    (tenant_id, branch_id, from_state, to_state, reason, actor_id, correlation_id)
  VALUES
    (v_tenant_id, p_branch_id, v_from, p_to_state, p_reason, v_actor, p_correlation_id);
END;
$$;

COMMENT ON FUNCTION org.change_branch_status(uuid, text, text, uuid) IS
  'Atomic branch lifecycle transition (P1-03-DB-007): row lock, no-op rejection, status UPDATE + append-only history INSERT in one transaction. SECURITY INVOKER — executes under the caller''s grants and RLS, so tenant scope and actor attribution come from the server-resolved context, never from parameters.';

REVOKE EXECUTE ON FUNCTION org.change_branch_status(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org.change_branch_status(uuid, text, text, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security — enabled AND forced; tenant pivot + narrowing.
-- ----------------------------------------------------------------------------
ALTER TABLE org.legal_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.legal_companies FORCE ROW LEVEL SECURITY;
ALTER TABLE org.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.branches FORCE ROW LEVEL SECURITY;
ALTER TABLE org.branch_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.branch_status_history FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_legal_companies_tenant ON org.legal_companies
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR id = ANY (iam.allowed_company_ids()))
  );

CREATE POLICY ins_legal_companies_tenant ON org.legal_companies
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY upd_legal_companies_tenant ON org.legal_companies
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR id = ANY (iam.allowed_company_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_branches_scope ON org.branches
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR id = ANY (iam.allowed_branch_ids()))
  );

CREATE POLICY ins_branches_scope ON org.branches
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );

CREATE POLICY upd_branches_scope ON org.branches
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );

CREATE POLICY sel_branch_status_history_tenant ON org.branch_status_history
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY ins_branch_status_history_tenant ON org.branch_status_history
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 6. Grants — explicit; DELETE deliberately absent everywhere (soft delete is
--    an UPDATE; history is append-only).
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON org.legal_companies TO app_runtime;
GRANT SELECT ON org.legal_companies TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON org.branches TO app_runtime;
GRANT SELECT ON org.branches TO app_readonly;
GRANT SELECT, INSERT ON org.branch_status_history TO app_runtime;
GRANT SELECT ON org.branch_status_history TO app_readonly;
