-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: inventory reference — UoM, item categories, item master, locations
-- Tasks: P1-10-DB (inv reference); FR-INV-001, DEP-06
-- Owner module: inv
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   items exist. Forward-only — no down script.
--
-- Purpose
--     * inv.units_of_measure — dual-scope UoM catalog (platform structural reference
--       seeded separately; tenants may add their own).
--     * inv.item_categories — tenant taxonomy (self-referencing, advisory-locked
--       cycle guard).
--     * inv.item_master — stable tenant-unique SKU, tracking flags, trigram search;
--       cost lives in a restricted 1:1 detail.
--     * inv.item_cost_details — RESTRICTED 1:1 cost (gated by inv.cost.view).
--     * inv.stock_locations — branch-scoped warehouse/storage/quarantine hierarchy.
--
-- Design gate amendments implemented: dedicated inv.cost.view gate (not the broad
--   PII sensitive.view); advisory-locked cycle guard; UoM cross-tenant reference
--   guard; location hierarchy coherence.
--
-- Dependencies
--   org.tenants, org.branches; shared.currencies; iam.current_tenant_id;
--   iam.has_permission; shared.touch_row_metadata; org.guard_immutable_columns;
--   extensions pg_trgm (trigram item search).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Guard functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.guard_item_category_no_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ancestor uuid; v_depth int := 0;
BEGIN
  IF NEW.parent_category_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_category_id = NEW.id THEN
    RAISE EXCEPTION 'inv.item_categories: a category cannot be its own parent' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('inv.item_categories:' || NEW.tenant_id::text));
  v_ancestor := NEW.parent_category_id;
  WHILE v_ancestor IS NOT NULL LOOP
    v_depth := v_depth + 1;
    IF v_ancestor = NEW.id THEN
      RAISE EXCEPTION 'inv.item_categories: parent assignment creates a cycle' USING ERRCODE = 'check_violation';
    END IF;
    IF v_depth > 64 THEN
      RAISE EXCEPTION 'inv.item_categories: hierarchy too deep (possible cycle)' USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_category_id INTO v_ancestor FROM inv.item_categories WHERE tenant_id = NEW.tenant_id AND id = v_ancestor;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_item_category_no_cycle() FROM PUBLIC;

CREATE OR REPLACE FUNCTION inv.guard_item_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.lifecycle_status = 'archived' AND NEW.lifecycle_status <> 'archived' THEN
    RAISE EXCEPTION 'inv.item_master: lifecycle is terminal once archived' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lifecycle_status = 'archived' AND OLD.lifecycle_status <> 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_item_lifecycle() FROM PUBLIC;

-- An item may reference a platform UoM or its own tenant UoM — never another tenant's.
CREATE OR REPLACE FUNCTION inv.guard_item_uom_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_scope text; v_tenant uuid;
BEGIN
  SELECT scope, tenant_id INTO v_scope, v_tenant FROM inv.units_of_measure WHERE id = NEW.uom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.item_master: unit of measure % not found', NEW.uom_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_scope = 'tenant' AND v_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'inv.item_master: unit of measure % belongs to another tenant', NEW.uom_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_item_uom_scope() FROM PUBLIC;

-- Location hierarchy coherence: a warehouse has no parent; storage/quarantine
-- locations must nest under a warehouse in the same scope.
CREATE OR REPLACE FUNCTION inv.guard_stock_location_hierarchy()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_parent_type text;
BEGIN
  IF NEW.location_type = 'warehouse' THEN
    IF NEW.parent_location_id IS NOT NULL THEN
      RAISE EXCEPTION 'inv.stock_locations: a warehouse cannot have a parent location' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_location_id IS NULL THEN
    RAISE EXCEPTION 'inv.stock_locations: a % location requires a parent warehouse', NEW.location_type USING ERRCODE = 'check_violation';
  END IF;
  SELECT location_type INTO v_parent_type FROM inv.stock_locations
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.parent_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.stock_locations: parent location % not found in scope', NEW.parent_location_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_parent_type <> 'warehouse' THEN
    RAISE EXCEPTION 'inv.stock_locations: parent must be a warehouse (found %)', v_parent_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_location_hierarchy() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 1. inv.units_of_measure — dual-scope catalog (platform structural reference).
-- ----------------------------------------------------------------------------
CREATE TABLE inv.units_of_measure (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope          text    NOT NULL,
  tenant_id      uuid    NULL,
  code           text    NOT NULL,
  name           text    NOT NULL,
  dimension      text    NOT NULL,
  status         text    NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_units_of_measure PRIMARY KEY (id),
  CONSTRAINT fk_units_of_measure_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_units_of_measure_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_units_of_measure_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)),
  CONSTRAINT ck_units_of_measure_code_format CHECK (code ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT ck_units_of_measure_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_units_of_measure_dimension CHECK (dimension IN ('count', 'mass', 'volume', 'length', 'area', 'time')),
  CONSTRAINT ck_units_of_measure_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE inv.units_of_measure IS 'Phase 1-10 dual-scope unit-of-measure catalog. Platform rows (each/hour/litre/kilogram/...) are tenant-neutral structural reference (seeded); tenants may add their own. Configuration only.';
CREATE INDEX ix_units_of_measure_tenant ON inv.units_of_measure (tenant_id);
CREATE UNIQUE INDEX uq_units_of_measure_platform_code ON inv.units_of_measure (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_units_of_measure_tenant_code ON inv.units_of_measure (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_units_of_measure_touch_metadata BEFORE UPDATE ON inv.units_of_measure
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_units_of_measure_immutable BEFORE UPDATE ON inv.units_of_measure
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE inv.units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.units_of_measure FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_units_of_measure_visible ON inv.units_of_measure FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_units_of_measure_tenant ON inv.units_of_measure FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_units_of_measure_tenant ON inv.units_of_measure FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.units_of_measure TO app_runtime;
GRANT SELECT ON inv.units_of_measure TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. inv.item_categories — tenant taxonomy.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.item_categories (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  parent_category_id uuid    NULL,
  code               text    NOT NULL,
  name               text    NOT NULL,
  description        text    NULL,
  status             text    NOT NULL DEFAULT 'active',
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_item_categories PRIMARY KEY (id),
  CONSTRAINT uq_item_categories_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_item_categories_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_categories_parent FOREIGN KEY (tenant_id, parent_category_id) REFERENCES inv.item_categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_item_categories_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_item_categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_item_categories_desc_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_item_categories_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE inv.item_categories IS 'Phase 1-10 tenant item taxonomy (advisory-locked cycle guard). Configuration only.';
CREATE UNIQUE INDEX uq_item_categories_code ON inv.item_categories (tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_item_categories_parent ON inv.item_categories (tenant_id, parent_category_id);
CREATE TRIGGER tg_item_categories_no_cycle BEFORE INSERT OR UPDATE ON inv.item_categories
  FOR EACH ROW EXECUTE FUNCTION inv.guard_item_category_no_cycle();
CREATE TRIGGER tg_item_categories_touch_metadata BEFORE UPDATE ON inv.item_categories
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_item_categories_immutable BEFORE UPDATE ON inv.item_categories
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE inv.item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_categories FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_item_categories_tenant ON inv.item_categories FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_item_categories_tenant ON inv.item_categories FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_item_categories_tenant ON inv.item_categories FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.item_categories TO app_runtime;
GRANT SELECT ON inv.item_categories TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. inv.item_master — stable SKU, tracking flags, trigram search.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.item_master (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid    NOT NULL,
  item_category_id uuid    NOT NULL,
  sku              text    NOT NULL,
  name             text    NOT NULL,
  description      text    NULL,
  uom_id           uuid    NOT NULL,
  item_type        text    NOT NULL DEFAULT 'part',
  is_stock_tracked boolean NOT NULL DEFAULT true,
  is_serialized    boolean NOT NULL DEFAULT false,
  lifecycle_status text    NOT NULL DEFAULT 'active',
  archived_at      timestamptz NULL,
  record_version   integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid    NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid    NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid    NULL,

  CONSTRAINT pk_item_master PRIMARY KEY (id),
  CONSTRAINT uq_item_master_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_item_master_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_master_category FOREIGN KEY (tenant_id, item_category_id) REFERENCES inv.item_categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_master_uom FOREIGN KEY (uom_id) REFERENCES inv.units_of_measure (id) ON DELETE RESTRICT,
  CONSTRAINT ck_item_master_sku_format CHECK (sku ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
  CONSTRAINT ck_item_master_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_item_master_desc_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_item_master_type CHECK (item_type IN ('part', 'material', 'consumable', 'fluid', 'kit')),
  CONSTRAINT ck_item_master_lifecycle CHECK (lifecycle_status IN ('active', 'archived')),
  CONSTRAINT ck_item_master_archived_at CHECK ((lifecycle_status = 'archived') = (archived_at IS NOT NULL))
);
COMMENT ON TABLE inv.item_master IS 'Phase 1-10 stable tenant-unique SKU with tracking flags. Cost lives in restricted inv.item_cost_details. Customer-supplied parts are NOT item_master rows.';
CREATE UNIQUE INDEX uq_item_master_sku ON inv.item_master (tenant_id, sku) WHERE deleted_at IS NULL;
CREATE INDEX ix_item_master_category ON inv.item_master (tenant_id, item_category_id);
CREATE INDEX ix_item_master_uom ON inv.item_master (uom_id);
CREATE INDEX ix_item_master_name_trgm ON inv.item_master USING gin (lower(name) extensions.gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE TRIGGER tg_item_master_uom_scope BEFORE INSERT OR UPDATE ON inv.item_master
  FOR EACH ROW EXECUTE FUNCTION inv.guard_item_uom_scope();
CREATE TRIGGER tg_item_master_touch_metadata BEFORE UPDATE ON inv.item_master
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_item_master_lifecycle BEFORE UPDATE ON inv.item_master
  FOR EACH ROW EXECUTE FUNCTION inv.guard_item_lifecycle();
CREATE TRIGGER tg_item_master_immutable BEFORE UPDATE ON inv.item_master
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'sku', 'created_at', 'created_by');
ALTER TABLE inv.item_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_master FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_item_master_tenant ON inv.item_master FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_item_master_tenant ON inv.item_master FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_item_master_tenant ON inv.item_master FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.item_master TO app_runtime;
GRANT SELECT ON inv.item_master TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. inv.item_cost_details — RESTRICTED 1:1 cost (gated by inv.cost.view).
-- ----------------------------------------------------------------------------
CREATE TABLE inv.item_cost_details (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  item_id        uuid    NOT NULL,
  standard_cost  numeric(18, 4) NOT NULL,
  currency_code  text    NOT NULL,
  classification text    NOT NULL DEFAULT 'restricted',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_item_cost_details PRIMARY KEY (id),
  CONSTRAINT fk_item_cost_details_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_cost_details_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_cost_details_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_item_cost_details_cost CHECK (standard_cost >= 0),
  CONSTRAINT ck_item_cost_details_classification CHECK (classification = 'restricted')
);
COMMENT ON TABLE inv.item_cost_details IS 'Phase 1-10 RESTRICTED 1:1 item cost (cost/margin). Every policy gated by iam.has_permission(''inv.cost.view''). Immutable classification.';
CREATE UNIQUE INDEX uq_item_cost_details_item ON inv.item_cost_details (tenant_id, item_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_item_cost_details_item ON inv.item_cost_details (tenant_id, item_id); -- non-partial FK cover
CREATE INDEX ix_item_cost_details_currency ON inv.item_cost_details (currency_code);
CREATE TRIGGER tg_item_cost_details_touch_metadata BEFORE UPDATE ON inv.item_cost_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_item_cost_details_immutable BEFORE UPDATE ON inv.item_cost_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'item_id', 'classification', 'created_at', 'created_by');
ALTER TABLE inv.item_cost_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.item_cost_details FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_item_cost_details_gated ON inv.item_cost_details FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('inv.cost.view'));
CREATE POLICY ins_item_cost_details_gated ON inv.item_cost_details FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('inv.cost.view'));
CREATE POLICY upd_item_cost_details_gated ON inv.item_cost_details FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('inv.cost.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('inv.cost.view'));
GRANT SELECT, INSERT, UPDATE ON inv.item_cost_details TO app_runtime;
GRANT SELECT ON inv.item_cost_details TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. inv.stock_locations — branch-scoped warehouse/storage/quarantine hierarchy.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_locations (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  company_id         uuid    NOT NULL,
  branch_id          uuid    NOT NULL,
  location_code      text    NOT NULL,
  name               text    NOT NULL,
  location_type      text    NOT NULL,
  parent_location_id uuid    NULL,
  status             text    NOT NULL DEFAULT 'active',
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_stock_locations PRIMARY KEY (id),
  CONSTRAINT uq_stock_locations_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_stock_locations_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_locations_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_locations_parent FOREIGN KEY (tenant_id, company_id, branch_id, parent_location_id)
    REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_locations_code_format CHECK (location_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
  CONSTRAINT ck_stock_locations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_stock_locations_type CHECK (location_type IN ('warehouse', 'storage', 'quarantine')),
  CONSTRAINT ck_stock_locations_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE inv.stock_locations IS 'Phase 1-10 branch-scoped stock locations. Warehouse has no parent; storage/quarantine nest under a warehouse in the same scope. Quarantine holds damaged stock (excluded from sellable availability).';
CREATE UNIQUE INDEX uq_stock_locations_code ON inv.stock_locations (tenant_id, company_id, branch_id, location_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_stock_locations_branch ON inv.stock_locations (tenant_id, company_id, branch_id);
CREATE INDEX ix_stock_locations_parent ON inv.stock_locations (tenant_id, company_id, branch_id, parent_location_id);
CREATE TRIGGER tg_stock_locations_hierarchy BEFORE INSERT OR UPDATE ON inv.stock_locations
  FOR EACH ROW EXECUTE FUNCTION inv.guard_stock_location_hierarchy();
CREATE TRIGGER tg_stock_locations_touch_metadata BEFORE UPDATE ON inv.stock_locations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_locations_immutable BEFORE UPDATE ON inv.stock_locations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'location_type', 'created_at', 'created_by');
ALTER TABLE inv.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_locations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_locations_scope ON inv.stock_locations FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_locations_scope ON inv.stock_locations FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_locations_scope ON inv.stock_locations FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_locations TO app_runtime;
GRANT SELECT ON inv.stock_locations TO app_readonly;
