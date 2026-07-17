-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: departments, warehouses, storage locations, cost centres
-- Tasks: P1-03-DB-008, P1-03-DB-009, P1-03-DB-010, P1-03-DB-011
-- Owner module: org
--
-- Purpose
--   The operational structure beneath a branch. Warehouses and storage
--   locations are ORGANIZATIONAL STRUCTURE ONLY in this phase: no stock
--   balance, stock movement, or accounting column exists anywhere here —
--   inventory and general-ledger implementations belong to their own phases.
--
-- Dependency
--   20260717103000_org_companies_branches.sql (branch composite keys).
--
-- Rollback classification: ROLLBACK-SAFE while empty; roll-forward-only once
--   organizational rows exist.
--
-- Security implications
--   * All four tables are tenant-owned: RLS enabled AND forced, tenant pivot
--     from the server-resolved context, company/branch narrowing as in the
--     rest of the module. DELETE is granted to no application role.
--   * Scope integrity is STRUCTURAL: departments/warehouses carry
--     (tenant_id, company_id, branch_id) → org.branches
--     (tenant_id, company_id, id); locations carry the warehouse composite.
--     A cross-tenant/cross-company/cross-branch parent is an FK violation.
--   * Dead parents reject new children at the database layer:
--     soft-deleted/archived branches take no new departments or warehouses,
--     and soft-deleted/archived warehouses take no new locations.
--
-- Code-uniqueness decision (documented, tested)
--   Child-structure codes (departments, warehouses, locations) are unique
--   among rows that are neither soft-deleted NOR archived: archiving a child
--   structure frees its code, because these codes are internal operational
--   labels. Company and branch codes (previous migration) stay reserved while
--   archived — they are externally referenced identities and only soft delete
--   frees them. This is the "where approved" ruling of the phase instruction,
--   made explicit here rather than left ambiguous.
--
-- Objects created
--   Tables:    org.departments, org.warehouses, org.storage_locations,
--              org.cost_centers
--   Functions: org.guard_parent_branch_live(), org.guard_parent_warehouse_live()
--   Triggers:  touch/immutable per table + live-parent guards
--   Policies:  sel/ins/upd per table
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Live-parent guards.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.guard_parent_branch_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted  timestamptz;
  v_archived timestamptz;
BEGIN
  SELECT b.deleted_at, b.archived_at INTO v_deleted, v_archived
  FROM org.branches b
  WHERE b.tenant_id = NEW.tenant_id
    AND b.company_id = NEW.company_id
    AND b.id = NEW.branch_id;
  IF FOUND AND (v_deleted IS NOT NULL OR v_archived IS NOT NULL) THEN
    RAISE EXCEPTION 'branch % is soft-deleted or archived and cannot receive new children', NEW.branch_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_parent_branch_live() IS
  'BEFORE INSERT guard on branch children (departments, warehouses): a soft-deleted or archived branch takes no new rows (check_violation). Missing parent falls through to the composite FK''s canonical error.';
REVOKE EXECUTE ON FUNCTION org.guard_parent_branch_live() FROM PUBLIC;

CREATE OR REPLACE FUNCTION org.guard_parent_warehouse_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted  timestamptz;
  v_archived timestamptz;
BEGIN
  SELECT w.deleted_at, w.archived_at INTO v_deleted, v_archived
  FROM org.warehouses w
  WHERE w.tenant_id = NEW.tenant_id
    AND w.company_id = NEW.company_id
    AND w.branch_id = NEW.branch_id
    AND w.id = NEW.warehouse_id;
  IF FOUND AND (v_deleted IS NOT NULL OR v_archived IS NOT NULL) THEN
    RAISE EXCEPTION 'warehouse % is soft-deleted or archived and cannot receive new locations', NEW.warehouse_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_parent_warehouse_live() IS
  'BEFORE INSERT guard on org.storage_locations: a soft-deleted or archived warehouse takes no new locations (check_violation).';
REVOKE EXECUTE ON FUNCTION org.guard_parent_warehouse_live() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. org.departments (P1-03-DB-008)
-- ----------------------------------------------------------------------------
CREATE TABLE org.departments (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  company_id      uuid        NOT NULL,
  branch_id       uuid        NOT NULL,
  department_code text        NOT NULL,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'active',
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,
  deleted_at      timestamptz NULL,
  deleted_by      uuid        NULL,
  archived_at     timestamptz NULL,
  archived_by     uuid        NULL,

  CONSTRAINT pk_departments PRIMARY KEY (id),
  CONSTRAINT fk_departments_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_departments_code_format CHECK (department_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_departments_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_departments_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE org.departments IS
  'Departments of a branch (P1-03-DB-008). Tenant-owned; RLS forced. Scope is structural: (tenant_id, company_id, branch_id) → org.branches composite key. Codes unique among live (non-deleted, non-archived) rows per branch — archive frees the code (documented decision in the migration header).';

CREATE UNIQUE INDEX uq_departments_branch_code_live
  ON org.departments (tenant_id, company_id, branch_id, department_code)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX ix_departments_tenant_id_status ON org.departments (tenant_id, status);

CREATE TRIGGER tg_departments_touch_metadata
  BEFORE UPDATE ON org.departments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_departments_immutable
  BEFORE UPDATE ON org.departments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'department_code', 'created_at', 'created_by');
CREATE TRIGGER tg_departments_parent_branch_live
  BEFORE INSERT ON org.departments
  FOR EACH ROW EXECUTE FUNCTION org.guard_parent_branch_live();

-- ----------------------------------------------------------------------------
-- 3. org.warehouses (P1-03-DB-009)
-- ----------------------------------------------------------------------------
CREATE TABLE org.warehouses (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  warehouse_code text        NOT NULL,
  name           text        NOT NULL,
  warehouse_type text        NOT NULL DEFAULT 'general',
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

  CONSTRAINT pk_warehouses PRIMARY KEY (id),
  -- Composite candidate key for storage locations.
  CONSTRAINT uq_warehouses_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_warehouses_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_warehouses_code_format CHECK (warehouse_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_warehouses_name_not_blank CHECK (btrim(name) <> ''),
  -- Initial platform set; extended only by migration, never by data.
  CONSTRAINT ck_warehouses_type CHECK (warehouse_type IN ('general', 'parts', 'consumables', 'other')),
  CONSTRAINT ck_warehouses_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE org.warehouses IS
  'Warehouses of a branch (P1-03-DB-009). ORGANIZATIONAL STRUCTURE ONLY in this phase: deliberately NO stock-balance or stock-movement column — inventory arrives in its own phase and consumes this structure. Codes unique among live rows per branch; archive frees the code. Exposes UNIQUE (tenant_id, company_id, branch_id, id) for storage locations.';

CREATE UNIQUE INDEX uq_warehouses_branch_code_live
  ON org.warehouses (tenant_id, company_id, branch_id, warehouse_code)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX ix_warehouses_tenant_id_status ON org.warehouses (tenant_id, status);

CREATE TRIGGER tg_warehouses_touch_metadata
  BEFORE UPDATE ON org.warehouses
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_warehouses_immutable
  BEFORE UPDATE ON org.warehouses
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'warehouse_code', 'created_at', 'created_by');
CREATE TRIGGER tg_warehouses_parent_branch_live
  BEFORE INSERT ON org.warehouses
  FOR EACH ROW EXECUTE FUNCTION org.guard_parent_branch_live();

-- ----------------------------------------------------------------------------
-- 4. org.storage_locations (P1-03-DB-010)
-- ----------------------------------------------------------------------------
CREATE TABLE org.storage_locations (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  warehouse_id   uuid        NOT NULL,
  location_code  text        NOT NULL,
  name           text        NOT NULL,
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

  CONSTRAINT pk_storage_locations PRIMARY KEY (id),
  -- The full warehouse composite travels through the reference: a location can
  -- never point at a warehouse in another tenant/company/branch.
  CONSTRAINT fk_storage_locations_warehouse
    FOREIGN KEY (tenant_id, company_id, branch_id, warehouse_id)
    REFERENCES org.warehouses (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_storage_locations_code_format CHECK (location_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_storage_locations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_storage_locations_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE org.storage_locations IS
  'Storage locations within a warehouse (P1-03-DB-010). NO stock-quantity column exists — consumed later by inventory phases. Scope is the full warehouse composite, so cross-tenant warehouse references are FK violations. Codes unique among live rows per warehouse; archive frees the code.';

CREATE UNIQUE INDEX uq_storage_locations_warehouse_code_live
  ON org.storage_locations (tenant_id, warehouse_id, location_code)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX ix_storage_locations_tenant_id_status
  ON org.storage_locations (tenant_id, status);
-- FK-support: the full warehouse-composite reference path.
CREATE INDEX ix_storage_locations_warehouse_scope
  ON org.storage_locations (tenant_id, company_id, branch_id, warehouse_id);

CREATE TRIGGER tg_storage_locations_touch_metadata
  BEFORE UPDATE ON org.storage_locations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_storage_locations_immutable
  BEFORE UPDATE ON org.storage_locations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'warehouse_id', 'location_code', 'created_at', 'created_by');
CREATE TRIGGER tg_storage_locations_parent_warehouse_live
  BEFORE INSERT ON org.storage_locations
  FOR EACH ROW EXECUTE FUNCTION org.guard_parent_warehouse_live();

-- ----------------------------------------------------------------------------
-- 5. org.cost_centers (P1-03-DB-011) — company-scoped, effective-dated.
--    NO general-ledger implementation: this is the organizational register
--    later accounting phases reference.
-- ----------------------------------------------------------------------------
CREATE TABLE org.cost_centers (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  company_id       uuid        NOT NULL,
  cost_center_code text        NOT NULL,
  name             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'active',
  effective_from   date        NOT NULL,
  effective_to     date        NULL,
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid        NULL,

  CONSTRAINT pk_cost_centers PRIMARY KEY (id),
  CONSTRAINT fk_cost_centers_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_cost_centers_code_format CHECK (cost_center_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_cost_centers_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_cost_centers_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_cost_centers_effective_interval
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Successive versions of one code are fine; SIMULTANEOUS ones are not.
  CONSTRAINT ex_cost_centers_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =,
      company_id WITH =,
      cost_center_code WITH =,
      daterange(effective_from, effective_to, '[)') WITH &&
    ) WHERE (deleted_at IS NULL)
);

COMMENT ON TABLE org.cost_centers IS
  'Cost centres of a company (P1-03-DB-011). Effective-dated: one code may have successive validity versions, never overlapping ones (EXCLUDE over daterange among non-deleted rows). Company-scoped via the composite FK. No general-ledger implementation exists — later accounting phases reference this register.';

CREATE INDEX ix_cost_centers_tenant_company_code
  ON org.cost_centers (tenant_id, company_id, cost_center_code);

CREATE TRIGGER tg_cost_centers_touch_metadata
  BEFORE UPDATE ON org.cost_centers
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_cost_centers_immutable
  BEFORE UPDATE ON org.cost_centers
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'cost_center_code', 'effective_from', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 6. Row-Level Security — enabled AND forced on all four; standard scope
--    pivots and narrowing.
-- ----------------------------------------------------------------------------
ALTER TABLE org.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.departments FORCE ROW LEVEL SECURITY;
ALTER TABLE org.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE org.storage_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.storage_locations FORCE ROW LEVEL SECURITY;
ALTER TABLE org.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.cost_centers FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_departments_scope ON org.departments
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_departments_scope ON org.departments
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_departments_scope ON org.departments
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_warehouses_scope ON org.warehouses
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_warehouses_scope ON org.warehouses
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_warehouses_scope ON org.warehouses
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_storage_locations_scope ON org.storage_locations
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_storage_locations_scope ON org.storage_locations
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_storage_locations_scope ON org.storage_locations
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_cost_centers_scope ON org.cost_centers
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );
CREATE POLICY ins_cost_centers_scope ON org.cost_centers
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  );
CREATE POLICY upd_cost_centers_scope ON org.cost_centers
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 7. Grants — SELECT/INSERT/UPDATE for runtime, SELECT for readonly.
--    DELETE deliberately absent everywhere.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON org.departments TO app_runtime;
GRANT SELECT ON org.departments TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON org.warehouses TO app_runtime;
GRANT SELECT ON org.warehouses TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON org.storage_locations TO app_runtime;
GRANT SELECT ON org.storage_locations TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON org.cost_centers TO app_runtime;
GRANT SELECT ON org.cost_centers TO app_readonly;
