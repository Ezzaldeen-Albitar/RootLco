-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: inventory operations — issues, returns, damage, customer-supplied,
--            external purchase, opening inventory, adjustments + provenance guard
-- Tasks: P1-10-DB (inv operations); FR-INV-003/004, BR-INV-001/002
-- Owner module: inv
--
-- Rollback classification: roll-forward-only once operations exist.
--
-- Purpose
--   The operational sources that authorize stock movements, plus the PROVENANCE
--   guard that makes every movement prove a legitimate, approved, quantity-matched
--   source (the trust root — a raw stock_movements INSERT cannot mint stock because
--   the guard rejects any movement without a valid source in the correct state).
--   Loss events (damage, negative adjustment) release conflicting active
--   reservations junior-first so available_qty never goes negative (H9).
--
-- Dependencies
--   inv.stock_movements/balances/reservations + primitives (094000);
--   wo.work_orders; shared.currencies; iam.*; org.guard_immutable_columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Maker/approver + status guards
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.guard_opening_batch_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL THEN RAISE EXCEPTION 'inv.opening_inventory_batches: approved batch requires approved_by' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.approved_by = NEW.counted_by THEN RAISE EXCEPTION 'inv.opening_inventory_batches: approver must differ from counter (maker<>approver)' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'inv.opening_inventory_batches: approved is terminal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_opening_batch_approval() FROM PUBLIC;

CREATE OR REPLACE FUNCTION inv.guard_adjustment_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL THEN RAISE EXCEPTION 'inv.stock_adjustments: approved adjustment requires approved_by' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.approved_by = NEW.requested_by THEN RAISE EXCEPTION 'inv.stock_adjustments: approver must differ from requester (maker<>approver)' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'rejected') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'inv.stock_adjustments: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_adjustment_approval() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 1. inv.opening_inventory_batches / lines
-- ----------------------------------------------------------------------------
CREATE TABLE inv.opening_inventory_batches (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  batch_code     text    NOT NULL,
  as_of_date     date    NOT NULL,
  counted_by     uuid    NOT NULL,
  approved_by    uuid    NULL,
  approved_at    timestamptz NULL,
  status         text    NOT NULL DEFAULT 'draft',
  notes          text    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_opening_inventory_batches PRIMARY KEY (id),
  CONSTRAINT uq_opening_inventory_batches_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_opening_inventory_batches_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_opening_inventory_batches_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_opening_inventory_batches_code_format CHECK (batch_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
  CONSTRAINT ck_opening_inventory_batches_status CHECK (status IN ('draft', 'approved')),
  CONSTRAINT ck_opening_inventory_batches_approved CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CONSTRAINT ck_opening_inventory_batches_maker CHECK (approved_by IS NULL OR approved_by <> counted_by)
);
COMMENT ON TABLE inv.opening_inventory_batches IS 'Phase 1-10 opening inventory batch (as-of, counted-by, approved-by). Approval generates immutable opening movements and locks the batch. Maker<>approver.';
CREATE UNIQUE INDEX uq_opening_inventory_batches_code ON inv.opening_inventory_batches (tenant_id, company_id, branch_id, batch_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_opening_inventory_batches_branch ON inv.opening_inventory_batches (tenant_id, company_id, branch_id);
CREATE TRIGGER tg_opening_inventory_batches_approval BEFORE INSERT OR UPDATE ON inv.opening_inventory_batches
  FOR EACH ROW EXECUTE FUNCTION inv.guard_opening_batch_approval();
CREATE TRIGGER tg_opening_inventory_batches_touch_metadata BEFORE UPDATE ON inv.opening_inventory_batches
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_opening_inventory_batches_immutable BEFORE UPDATE ON inv.opening_inventory_batches
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'batch_code', 'as_of_date', 'counted_by', 'created_at', 'created_by');
ALTER TABLE inv.opening_inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.opening_inventory_batches FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_opening_inventory_batches_scope ON inv.opening_inventory_batches FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_opening_inventory_batches_scope ON inv.opening_inventory_batches FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_opening_inventory_batches_scope ON inv.opening_inventory_batches FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.opening_inventory_batches TO app_runtime;
GRANT SELECT ON inv.opening_inventory_batches TO app_readonly;

CREATE TABLE inv.opening_inventory_lines (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  batch_id       uuid    NOT NULL,
  item_id        uuid    NOT NULL,
  location_id    uuid    NOT NULL,
  quantity       numeric(12, 3) NOT NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_opening_inventory_lines PRIMARY KEY (id),
  CONSTRAINT uq_opening_inventory_lines_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_opening_inventory_lines_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_opening_inventory_lines_batch FOREIGN KEY (tenant_id, company_id, branch_id, batch_id) REFERENCES inv.opening_inventory_batches (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_opening_inventory_lines_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_opening_inventory_lines_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_opening_inventory_lines_quantity CHECK (quantity > 0)
);
COMMENT ON TABLE inv.opening_inventory_lines IS 'Phase 1-10 opening inventory line (quantity only; valuation is out of scope). Frozen once the batch is approved.';
CREATE UNIQUE INDEX uq_opening_inventory_lines_cell ON inv.opening_inventory_lines (tenant_id, company_id, branch_id, batch_id, item_id, location_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_opening_inventory_lines_batch ON inv.opening_inventory_lines (tenant_id, company_id, branch_id, batch_id);
CREATE INDEX ix_opening_inventory_lines_item ON inv.opening_inventory_lines (tenant_id, item_id);
CREATE INDEX ix_opening_inventory_lines_location ON inv.opening_inventory_lines (tenant_id, company_id, branch_id, location_id);
CREATE TRIGGER tg_opening_inventory_lines_touch_metadata BEFORE UPDATE ON inv.opening_inventory_lines
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_opening_inventory_lines_immutable BEFORE UPDATE ON inv.opening_inventory_lines
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'batch_id', 'item_id', 'location_id', 'created_at', 'created_by');
ALTER TABLE inv.opening_inventory_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.opening_inventory_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_opening_inventory_lines_scope ON inv.opening_inventory_lines FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_opening_inventory_lines_scope ON inv.opening_inventory_lines FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_opening_inventory_lines_scope ON inv.opening_inventory_lines FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.opening_inventory_lines TO app_runtime;
GRANT SELECT ON inv.opening_inventory_lines TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. inv.stock_adjustments (+ restricted value detail)
-- ----------------------------------------------------------------------------
CREATE TABLE inv.stock_adjustments (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  item_id        uuid    NOT NULL,
  location_id    uuid    NOT NULL,
  direction      text    NOT NULL,
  quantity       numeric(12, 3) NOT NULL,
  reason         text    NOT NULL,
  requires_approval boolean NOT NULL DEFAULT true,
  status         text    NOT NULL DEFAULT 'pending',
  requested_by   uuid    NOT NULL,
  approved_by    uuid    NULL,
  approved_at    timestamptz NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_stock_adjustments PRIMARY KEY (id),
  CONSTRAINT uq_stock_adjustments_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_stock_adjustments_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustments_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_adjustments_direction CHECK (direction IN ('in', 'out')),
  CONSTRAINT ck_stock_adjustments_quantity CHECK (quantity > 0),
  CONSTRAINT ck_stock_adjustments_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_stock_adjustments_status CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ck_stock_adjustments_approved CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CONSTRAINT ck_stock_adjustments_maker CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
COMMENT ON TABLE inv.stock_adjustments IS 'Phase 1-10 stock adjustment request. Over-threshold stays pending until approved (maker<>approver). Movement generated only on approval. Value impact in restricted detail.';
CREATE INDEX ix_stock_adjustments_branch ON inv.stock_adjustments (tenant_id, company_id, branch_id);
CREATE INDEX ix_stock_adjustments_item ON inv.stock_adjustments (tenant_id, item_id);
CREATE INDEX ix_stock_adjustments_location ON inv.stock_adjustments (tenant_id, company_id, branch_id, location_id);
CREATE TRIGGER tg_stock_adjustments_approval BEFORE INSERT OR UPDATE ON inv.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION inv.guard_adjustment_approval();
CREATE TRIGGER tg_stock_adjustments_touch_metadata BEFORE UPDATE ON inv.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_adjustments_immutable BEFORE UPDATE ON inv.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'item_id', 'location_id', 'direction', 'quantity', 'requested_by', 'created_at', 'created_by');
ALTER TABLE inv.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_adjustments FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_adjustments_scope ON inv.stock_adjustments FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_stock_adjustments_scope ON inv.stock_adjustments FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_stock_adjustments_scope ON inv.stock_adjustments FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.stock_adjustments TO app_runtime;
GRANT SELECT ON inv.stock_adjustments TO app_readonly;

CREATE TABLE inv.stock_adjustment_details (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  adjustment_id  uuid    NOT NULL,
  value_impact   numeric(18, 4) NOT NULL,
  currency_code  text    NOT NULL,
  classification text    NOT NULL DEFAULT 'restricted',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_stock_adjustment_details PRIMARY KEY (id),
  CONSTRAINT fk_stock_adjustment_details_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustment_details_adjustment FOREIGN KEY (tenant_id, company_id, branch_id, adjustment_id) REFERENCES inv.stock_adjustments (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_adjustment_details_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_adjustment_details_classification CHECK (classification = 'restricted')
);
COMMENT ON TABLE inv.stock_adjustment_details IS 'Phase 1-10 RESTRICTED 1:1 adjustment value impact (cost/margin). Branch-scoped; gated by iam.has_permission(''inv.cost.view'').';
CREATE UNIQUE INDEX uq_stock_adjustment_details_adjustment ON inv.stock_adjustment_details (tenant_id, company_id, branch_id, adjustment_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_stock_adjustment_details_adjustment ON inv.stock_adjustment_details (tenant_id, company_id, branch_id, adjustment_id); -- non-partial FK cover
CREATE INDEX ix_stock_adjustment_details_currency ON inv.stock_adjustment_details (currency_code);
CREATE TRIGGER tg_stock_adjustment_details_touch_metadata BEFORE UPDATE ON inv.stock_adjustment_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_stock_adjustment_details_immutable BEFORE UPDATE ON inv.stock_adjustment_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'adjustment_id', 'classification', 'created_at', 'created_by');
ALTER TABLE inv.stock_adjustment_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.stock_adjustment_details FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_stock_adjustment_details_gated ON inv.stock_adjustment_details FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())) AND iam.has_permission('inv.cost.view'));
CREATE POLICY ins_stock_adjustment_details_gated ON inv.stock_adjustment_details FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())) AND iam.has_permission('inv.cost.view'));
CREATE POLICY upd_stock_adjustment_details_gated ON inv.stock_adjustment_details FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())) AND iam.has_permission('inv.cost.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('inv.cost.view'));
GRANT SELECT, INSERT, UPDATE ON inv.stock_adjustment_details TO app_runtime;
GRANT SELECT ON inv.stock_adjustment_details TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. inv.part_issues / inv.part_returns
-- ----------------------------------------------------------------------------
CREATE TABLE inv.part_issues (
  id                uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid    NOT NULL,
  company_id        uuid    NOT NULL,
  branch_id         uuid    NOT NULL,
  work_order_id     uuid    NOT NULL,
  item_id           uuid    NOT NULL,
  location_id       uuid    NOT NULL,
  reservation_id    uuid    NULL,
  required_part_ref uuid    NULL,
  quantity          numeric(12, 3) NOT NULL,
  record_version    integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid    NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid    NULL,
  deleted_at        timestamptz NULL,
  deleted_by        uuid    NULL,

  CONSTRAINT pk_part_issues PRIMARY KEY (id),
  CONSTRAINT uq_part_issues_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_part_issues_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_part_issues_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_part_issues_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id) REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_part_issues_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_part_issues_location FOREIGN KEY (tenant_id, company_id, branch_id, location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_part_issues_reservation FOREIGN KEY (tenant_id, company_id, branch_id, reservation_id) REFERENCES inv.stock_reservations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_part_issues_quantity CHECK (quantity > 0)
);
COMMENT ON TABLE inv.part_issues IS 'Phase 1-10 issue of a part to a work order (generates an issue movement; consumes a reservation). Requires an open work order.';
CREATE INDEX ix_part_issues_branch ON inv.part_issues (tenant_id, company_id, branch_id);
CREATE INDEX ix_part_issues_work_order ON inv.part_issues (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_part_issues_item ON inv.part_issues (tenant_id, item_id);
CREATE INDEX ix_part_issues_location ON inv.part_issues (tenant_id, company_id, branch_id, location_id);
CREATE INDEX ix_part_issues_reservation ON inv.part_issues (tenant_id, company_id, branch_id, reservation_id);
CREATE TRIGGER tg_part_issues_touch_metadata BEFORE UPDATE ON inv.part_issues
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_part_issues_immutable BEFORE UPDATE ON inv.part_issues
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'work_order_id', 'item_id', 'location_id', 'quantity', 'created_at', 'created_by');
ALTER TABLE inv.part_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.part_issues FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_part_issues_scope ON inv.part_issues FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_part_issues_scope ON inv.part_issues FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_part_issues_scope ON inv.part_issues FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.part_issues TO app_runtime;
GRANT SELECT ON inv.part_issues TO app_readonly;

CREATE TABLE inv.part_returns (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  part_issue_id  uuid    NOT NULL,
  quantity       numeric(12, 3) NOT NULL,
  reason         text    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_part_returns PRIMARY KEY (id),
  CONSTRAINT uq_part_returns_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_part_returns_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_part_returns_issue FOREIGN KEY (tenant_id, company_id, branch_id, part_issue_id) REFERENCES inv.part_issues (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_part_returns_quantity CHECK (quantity > 0),
  CONSTRAINT ck_part_returns_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);
COMMENT ON TABLE inv.part_returns IS 'Phase 1-10 return of a previously issued part (generates a return movement). Sum of returns cannot exceed the issued quantity (row-locked in inv.return_part).';
CREATE INDEX ix_part_returns_issue ON inv.part_returns (tenant_id, company_id, branch_id, part_issue_id);
CREATE TRIGGER tg_part_returns_touch_metadata BEFORE UPDATE ON inv.part_returns
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_part_returns_immutable BEFORE UPDATE ON inv.part_returns
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'part_issue_id', 'quantity', 'created_at', 'created_by');
ALTER TABLE inv.part_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.part_returns FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_part_returns_scope ON inv.part_returns FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_part_returns_scope ON inv.part_returns FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_part_returns_scope ON inv.part_returns FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.part_returns TO app_runtime;
GRANT SELECT ON inv.part_returns TO app_readonly;

-- Return-ceiling enforcement at the CONSTRAINT layer (not just inv.return_part):
-- row-lock the parent issue and reject if the running sum of returns would exceed
-- the issued quantity. This closes the phantom-stock path where a raw part_returns
-- INSERT (bypassing the function) + a matching return movement could otherwise mint
-- stock, since the movement provenance guard binds the movement to this row's quantity.
CREATE OR REPLACE FUNCTION inv.guard_part_return_ceiling()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_issued numeric(12, 3); v_returned numeric(12, 3);
BEGIN
  SELECT quantity INTO v_issued FROM inv.part_issues
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.part_issue_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.part_returns: part issue % not found in scope', NEW.part_issue_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO v_returned FROM inv.part_returns
    WHERE tenant_id = NEW.tenant_id AND part_issue_id = NEW.part_issue_id;
  IF v_returned + NEW.quantity > v_issued THEN
    RAISE EXCEPTION 'inv.part_returns: total returns %.% exceed the issued quantity %',
      v_returned, NEW.quantity, v_issued USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_part_return_ceiling() FROM PUBLIC;
CREATE TRIGGER tg_part_returns_ceiling BEFORE INSERT ON inv.part_returns
  FOR EACH ROW EXECUTE FUNCTION inv.guard_part_return_ceiling();

-- ----------------------------------------------------------------------------
-- 4. inv.damaged_stock
-- ----------------------------------------------------------------------------
CREATE TABLE inv.damaged_stock (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  company_id            uuid    NOT NULL,
  branch_id             uuid    NOT NULL,
  item_id               uuid    NOT NULL,
  from_location_id      uuid    NOT NULL,
  quarantine_location_id uuid   NOT NULL,
  quantity              numeric(12, 3) NOT NULL,
  disposition           text    NOT NULL DEFAULT 'quarantined',
  reason                text    NOT NULL,
  responsible_party_ref uuid    NULL,
  evidence_ref          uuid    NULL,
  record_version        integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid    NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid    NULL,

  CONSTRAINT pk_damaged_stock PRIMARY KEY (id),
  CONSTRAINT uq_damaged_stock_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_damaged_stock_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_damaged_stock_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damaged_stock_item FOREIGN KEY (tenant_id, item_id) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damaged_stock_from_location FOREIGN KEY (tenant_id, company_id, branch_id, from_location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damaged_stock_quarantine FOREIGN KEY (tenant_id, company_id, branch_id, quarantine_location_id) REFERENCES inv.stock_locations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_damaged_stock_quantity CHECK (quantity > 0),
  CONSTRAINT ck_damaged_stock_locations CHECK (from_location_id <> quarantine_location_id),
  CONSTRAINT ck_damaged_stock_disposition CHECK (disposition IN ('quarantined', 'scrapped', 'returned_to_supplier')),
  CONSTRAINT ck_damaged_stock_reason_not_blank CHECK (btrim(reason) <> '')
);
COMMENT ON TABLE inv.damaged_stock IS 'Phase 1-10 damaged stock disposition. Generates a paired damage movement (out of sellable, in to quarantine) so damaged units are excluded from sellable availability.';
CREATE INDEX ix_damaged_stock_branch ON inv.damaged_stock (tenant_id, company_id, branch_id);
CREATE INDEX ix_damaged_stock_item ON inv.damaged_stock (tenant_id, item_id);
CREATE INDEX ix_damaged_stock_from_location ON inv.damaged_stock (tenant_id, company_id, branch_id, from_location_id);
CREATE INDEX ix_damaged_stock_quarantine ON inv.damaged_stock (tenant_id, company_id, branch_id, quarantine_location_id);
CREATE TRIGGER tg_damaged_stock_touch_metadata BEFORE UPDATE ON inv.damaged_stock
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_damaged_stock_immutable BEFORE UPDATE ON inv.damaged_stock
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'item_id', 'from_location_id', 'quarantine_location_id', 'quantity', 'created_at', 'created_by');
ALTER TABLE inv.damaged_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.damaged_stock FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_damaged_stock_scope ON inv.damaged_stock FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_damaged_stock_scope ON inv.damaged_stock FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_damaged_stock_scope ON inv.damaged_stock FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.damaged_stock TO app_runtime;
GRANT SELECT ON inv.damaged_stock TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. inv.customer_supplied_parts (no stock effect)
-- ----------------------------------------------------------------------------
CREATE TABLE inv.customer_supplied_parts (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  work_order_id       uuid    NOT NULL,
  reception_visit_ref uuid    NULL,
  item_ref            uuid    NULL,
  description         text    NOT NULL,
  quantity            numeric(12, 3) NOT NULL,
  custody_state       text    NOT NULL DEFAULT 'received',
  item_condition      text    NULL,
  evidence_ref        uuid    NULL,
  customer_owned      boolean NOT NULL DEFAULT true,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_customer_supplied_parts PRIMARY KEY (id),
  CONSTRAINT uq_customer_supplied_parts_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_customer_supplied_parts_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_supplied_parts_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id) REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_supplied_parts_desc_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_customer_supplied_parts_quantity CHECK (quantity > 0),
  CONSTRAINT ck_customer_supplied_parts_custody CHECK (custody_state IN ('received', 'in_use', 'returned', 'consumed')),
  CONSTRAINT ck_customer_supplied_parts_condition CHECK (item_condition IS NULL OR btrim(item_condition) <> ''),
  CONSTRAINT ck_customer_supplied_parts_owned CHECK (customer_owned)
);
COMMENT ON TABLE inv.customer_supplied_parts IS 'Phase 1-10 customer-owned parts: custody-tracked, never valued stock, generate NO stock movement and NO balance change (customer_owned always true).';
CREATE INDEX ix_customer_supplied_parts_branch ON inv.customer_supplied_parts (tenant_id, company_id, branch_id);
CREATE INDEX ix_customer_supplied_parts_work_order ON inv.customer_supplied_parts (tenant_id, company_id, branch_id, work_order_id);
CREATE TRIGGER tg_customer_supplied_parts_touch_metadata BEFORE UPDATE ON inv.customer_supplied_parts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_customer_supplied_parts_immutable BEFORE UPDATE ON inv.customer_supplied_parts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'work_order_id', 'created_at', 'created_by');
ALTER TABLE inv.customer_supplied_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.customer_supplied_parts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_customer_supplied_parts_scope ON inv.customer_supplied_parts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_customer_supplied_parts_scope ON inv.customer_supplied_parts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_customer_supplied_parts_scope ON inv.customer_supplied_parts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.customer_supplied_parts TO app_runtime;
GRANT SELECT ON inv.customer_supplied_parts TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. inv.external_purchase_parts (+ restricted cost detail) — NON-procurement.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.external_purchase_parts (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  company_id         uuid    NOT NULL,
  branch_id          uuid    NOT NULL,
  work_order_id      uuid    NOT NULL,
  supplier_partner_id uuid   NULL,
  supplier_name      text    NULL,
  item_ref           uuid    NULL,
  description        text    NOT NULL,
  quantity           numeric(12, 3) NOT NULL,
  status             text    NOT NULL DEFAULT 'recorded',
  is_procurement     boolean NOT NULL DEFAULT false,
  evidence_ref       uuid    NULL,
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_external_purchase_parts PRIMARY KEY (id),
  CONSTRAINT uq_external_purchase_parts_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_external_purchase_parts_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_external_purchase_parts_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id) REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_external_purchase_parts_desc_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT ck_external_purchase_parts_quantity CHECK (quantity > 0),
  CONSTRAINT ck_external_purchase_parts_supplier CHECK (supplier_partner_id IS NOT NULL OR supplier_name IS NOT NULL),
  CONSTRAINT ck_external_purchase_parts_supplier_name CHECK (supplier_name IS NULL OR btrim(supplier_name) <> ''),
  CONSTRAINT ck_external_purchase_parts_status CHECK (status IN ('recorded', 'linked', 'cancelled')),
  CONSTRAINT ck_external_purchase_parts_not_procurement CHECK (is_procurement = false)
);
COMMENT ON TABLE inv.external_purchase_parts IS 'Phase 1-10 ad-hoc work-order-linked external purchase reference ONLY (status recorded/linked/cancelled; is_procurement=false). NOT a PO/PR/goods-receipt/bidding workflow (deliberately excluded; deferred to a future procurement phase).';
CREATE INDEX ix_external_purchase_parts_branch ON inv.external_purchase_parts (tenant_id, company_id, branch_id);
CREATE INDEX ix_external_purchase_parts_work_order ON inv.external_purchase_parts (tenant_id, company_id, branch_id, work_order_id);
CREATE TRIGGER tg_external_purchase_parts_touch_metadata BEFORE UPDATE ON inv.external_purchase_parts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_external_purchase_parts_immutable BEFORE UPDATE ON inv.external_purchase_parts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'work_order_id', 'created_at', 'created_by');
ALTER TABLE inv.external_purchase_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.external_purchase_parts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_external_purchase_parts_scope ON inv.external_purchase_parts FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_external_purchase_parts_scope ON inv.external_purchase_parts FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_external_purchase_parts_scope ON inv.external_purchase_parts FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.external_purchase_parts TO app_runtime;
GRANT SELECT ON inv.external_purchase_parts TO app_readonly;

CREATE TABLE inv.external_purchase_part_details (
  id                       uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                uuid    NOT NULL,
  company_id               uuid    NOT NULL,
  branch_id                uuid    NOT NULL,
  external_purchase_part_id uuid   NOT NULL,
  unit_cost                numeric(18, 4) NOT NULL,
  currency_code            text    NOT NULL,
  classification           text    NOT NULL DEFAULT 'restricted',
  record_version           integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid    NOT NULL,
  updated_at               timestamptz NULL,
  updated_by               uuid    NULL,
  deleted_at               timestamptz NULL,
  deleted_by               uuid    NULL,

  CONSTRAINT pk_external_purchase_part_details PRIMARY KEY (id),
  CONSTRAINT fk_external_purchase_part_details_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_external_purchase_part_details_parent FOREIGN KEY (tenant_id, company_id, branch_id, external_purchase_part_id) REFERENCES inv.external_purchase_parts (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_external_purchase_part_details_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_external_purchase_part_details_cost CHECK (unit_cost >= 0),
  CONSTRAINT ck_external_purchase_part_details_classification CHECK (classification = 'restricted')
);
COMMENT ON TABLE inv.external_purchase_part_details IS 'Phase 1-10 RESTRICTED 1:1 external-purchase unit cost. Branch-scoped; gated by iam.has_permission(''inv.cost.view'').';
CREATE UNIQUE INDEX uq_external_purchase_part_details_parent ON inv.external_purchase_part_details (tenant_id, company_id, branch_id, external_purchase_part_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_external_purchase_part_details_parent ON inv.external_purchase_part_details (tenant_id, company_id, branch_id, external_purchase_part_id); -- non-partial FK cover
CREATE INDEX ix_external_purchase_part_details_currency ON inv.external_purchase_part_details (currency_code);
CREATE TRIGGER tg_external_purchase_part_details_touch_metadata BEFORE UPDATE ON inv.external_purchase_part_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_external_purchase_part_details_immutable BEFORE UPDATE ON inv.external_purchase_part_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'external_purchase_part_id', 'classification', 'created_at', 'created_by');
ALTER TABLE inv.external_purchase_part_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.external_purchase_part_details FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_external_purchase_part_details_gated ON inv.external_purchase_part_details FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())) AND iam.has_permission('inv.cost.view'));
CREATE POLICY ins_external_purchase_part_details_gated ON inv.external_purchase_part_details FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())) AND iam.has_permission('inv.cost.view'));
CREATE POLICY upd_external_purchase_part_details_gated ON inv.external_purchase_part_details FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())) AND iam.has_permission('inv.cost.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('inv.cost.view'));
GRANT SELECT, INSERT, UPDATE ON inv.external_purchase_part_details TO app_runtime;
GRANT SELECT ON inv.external_purchase_part_details TO app_readonly;

-- ----------------------------------------------------------------------------
-- 7. PROVENANCE guard — the trust root (a movement must prove a valid source).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.guard_stock_movement_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_qty numeric(12, 3); v_status text; v_dir text; v_batch_status text;
BEGIN
  IF NEW.reference_kind = 'opening_line' THEN
    SELECT l.quantity, b.status INTO v_qty, v_batch_status
      FROM inv.opening_inventory_lines l JOIN inv.opening_inventory_batches b
        ON b.tenant_id = l.tenant_id AND b.company_id = l.company_id AND b.branch_id = l.branch_id AND b.id = l.batch_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.reference_id AND l.item_id = NEW.item_id AND l.location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: opening line % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_batch_status <> 'approved' THEN RAISE EXCEPTION 'stock movement: opening batch is % (must be approved)', v_batch_status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'opening' OR NEW.direction <> 'in' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: opening movement must be in/opening with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'part_issue' THEN
    SELECT quantity INTO v_qty FROM inv.part_issues WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id AND location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: part issue % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF NEW.movement_type <> 'issue' OR NEW.direction <> 'out' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: issue movement must be out/issue with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'part_return' THEN
    SELECT r.quantity INTO v_qty FROM inv.part_returns r JOIN inv.part_issues i
        ON i.tenant_id = r.tenant_id AND i.company_id = r.company_id AND i.branch_id = r.branch_id AND i.id = r.part_issue_id
      WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.reference_id AND i.item_id = NEW.item_id AND i.location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: part return % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF NEW.movement_type <> 'return' OR NEW.direction <> 'in' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: return movement must be in/return with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'damage' THEN
    SELECT quantity INTO v_qty FROM inv.damaged_stock
      WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id
        AND (from_location_id = NEW.location_id OR quarantine_location_id = NEW.location_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: damaged stock % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF NEW.movement_type <> 'damage' OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: damage movement must be type damage with quantity %', v_qty USING ERRCODE = 'check_violation'; END IF;

  ELSIF NEW.reference_kind = 'adjustment' THEN
    SELECT quantity, status, direction INTO v_qty, v_status, v_dir FROM inv.stock_adjustments
      WHERE tenant_id = NEW.tenant_id AND id = NEW.reference_id AND item_id = NEW.item_id AND location_id = NEW.location_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stock movement: adjustment % not found for this item/location', NEW.reference_id USING ERRCODE = 'foreign_key_violation'; END IF;
    IF v_status <> 'approved' THEN RAISE EXCEPTION 'stock movement: adjustment is % (must be approved)', v_status USING ERRCODE = 'check_violation'; END IF;
    IF NEW.movement_type <> 'adjustment' OR NEW.direction <> v_dir OR NEW.quantity <> v_qty THEN
      RAISE EXCEPTION 'stock movement: adjustment movement must match the approved adjustment (dir %, qty %)', v_dir, v_qty USING ERRCODE = 'check_violation'; END IF;
  ELSE
    RAISE EXCEPTION 'stock movement: unknown reference_kind %', NEW.reference_kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_stock_movement_provenance() FROM PUBLIC;
CREATE TRIGGER tg_stock_movements_provenance BEFORE INSERT ON inv.stock_movements
  FOR EACH ROW EXECUTE FUNCTION inv.guard_stock_movement_provenance();

-- ----------------------------------------------------------------------------
-- 8. Loss-time reservation release (H9): free active reservations junior-first
--    so a sellable-location on_hand reduction never drives available < 0.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.free_reservations_for_loss(p_item uuid, p_location uuid, p_reduce_by numeric)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_co uuid; v_br uuid; v_onhand numeric(12, 3); v_reserved numeric(12, 3);
        v_need numeric(12, 3); v_freed numeric(12, 3) := 0; r RECORD;
BEGIN
  SELECT company_id, branch_id INTO v_co, v_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_location;
  PERFORM inv.lock_stock_balance(v_tenant, v_co, v_br, p_item, p_location);
  SELECT on_hand_qty, reserved_qty INTO v_onhand, v_reserved FROM inv.stock_balances
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = p_item AND location_id = p_location;
  v_need := v_reserved - (v_onhand - p_reduce_by);
  IF v_need <= 0 THEN RETURN; END IF;
  FOR r IN
    SELECT id, quantity FROM inv.stock_reservations
    WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND item_id = p_item AND location_id = p_location AND status = 'active'
    ORDER BY created_at DESC, id DESC
  LOOP
    EXIT WHEN v_freed >= v_need;
    UPDATE inv.stock_reservations SET status = 'released', released_reason = 'stock_loss' WHERE tenant_id = v_tenant AND id = r.id;
    v_freed := v_freed + r.quantity;
  END LOOP;
  PERFORM inv.sync_reserved(v_tenant, v_co, v_br, p_item, p_location);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.free_reservations_for_loss(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.free_reservations_for_loss(uuid, uuid, numeric) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 9. Operation functions (SECURITY INVOKER; app_runtime executes).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.issue_part(
  p_work_order uuid, p_item uuid, p_location uuid, p_qty numeric,
  p_reservation uuid DEFAULT NULL, p_required_part_ref uuid DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_co uuid; v_br uuid; v_wo_state text; v_issue uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT company_id, branch_id INTO v_co, v_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_location;
  IF NOT FOUND THEN RAISE EXCEPTION 'stock location % not found', p_location USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT state INTO v_wo_state FROM wo.work_orders WHERE tenant_id = v_tenant AND company_id = v_co AND branch_id = v_br AND id = p_work_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order % not found in scope', p_work_order USING ERRCODE = 'foreign_key_violation'; END IF;
  INSERT INTO inv.part_issues (tenant_id, company_id, branch_id, work_order_id, item_id, location_id, reservation_id, required_part_ref, quantity, created_by)
    VALUES (v_tenant, v_co, v_br, p_work_order, p_item, p_location, p_reservation, p_required_part_ref, p_qty, iam.current_user_id())
    RETURNING id INTO v_issue;
  PERFORM inv.post_stock_movement(p_item, p_location, 'issue', 'out', p_qty, 'part_issue', v_issue, p_correlation);
  IF p_reservation IS NOT NULL THEN PERFORM inv.consume_reservation(p_reservation); END IF;
  RETURN v_issue;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.issue_part(uuid, uuid, uuid, numeric, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.issue_part(uuid, uuid, uuid, numeric, uuid, uuid, uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.return_part(p_part_issue uuid, p_qty numeric, p_reason text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); i inv.part_issues%ROWTYPE; v_returned numeric(12, 3); v_return uuid; v_wo_state text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  -- lock the issue to serialize the return-ceiling check
  SELECT * INTO i FROM inv.part_issues WHERE tenant_id = v_tenant AND id = p_part_issue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'part issue % not found', p_part_issue USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT state INTO v_wo_state FROM wo.work_orders WHERE tenant_id = v_tenant AND company_id = i.company_id AND branch_id = i.branch_id AND id = i.work_order_id;
  SELECT COALESCE(SUM(quantity), 0) INTO v_returned FROM inv.part_returns WHERE tenant_id = v_tenant AND part_issue_id = p_part_issue;
  IF v_returned + p_qty > i.quantity THEN
    RAISE EXCEPTION 'return exceeds issued quantity (issued %, already returned %, requested %)', i.quantity, v_returned, p_qty USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO inv.part_returns (tenant_id, company_id, branch_id, part_issue_id, quantity, reason, created_by)
    VALUES (v_tenant, i.company_id, i.branch_id, p_part_issue, p_qty, p_reason, iam.current_user_id())
    RETURNING id INTO v_return;
  PERFORM inv.post_stock_movement(i.item_id, i.location_id, 'return', 'in', p_qty, 'part_return', v_return, p_correlation);
  RETURN v_return;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.return_part(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.return_part(uuid, numeric, text, uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.record_damage(
  p_item uuid, p_from_location uuid, p_quarantine_location uuid, p_qty numeric, p_reason text,
  p_disposition text DEFAULT 'quarantined', p_responsible uuid DEFAULT NULL, p_evidence uuid DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_co uuid; v_br uuid; v_dmg uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT company_id, branch_id INTO v_co, v_br FROM inv.stock_locations WHERE tenant_id = v_tenant AND id = p_from_location;
  IF NOT FOUND THEN RAISE EXCEPTION 'from location % not found', p_from_location USING ERRCODE = 'foreign_key_violation'; END IF;
  INSERT INTO inv.damaged_stock (tenant_id, company_id, branch_id, item_id, from_location_id, quarantine_location_id, quantity, disposition, reason, responsible_party_ref, evidence_ref, created_by)
    VALUES (v_tenant, v_co, v_br, p_item, p_from_location, p_quarantine_location, p_qty, p_disposition, p_reason, p_responsible, p_evidence, iam.current_user_id())
    RETURNING id INTO v_dmg;
  -- free conflicting reservations at the sellable location so available stays >= 0
  PERFORM inv.free_reservations_for_loss(p_item, p_from_location, p_qty);
  PERFORM inv.post_stock_movement(p_item, p_from_location, 'damage', 'out', p_qty, 'damage', v_dmg, p_correlation);
  PERFORM inv.post_stock_movement(p_item, p_quarantine_location, 'damage', 'in', p_qty, 'damage', v_dmg, p_correlation);
  RETURN v_dmg;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.record_damage(uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.record_damage(uuid, uuid, uuid, numeric, text, text, uuid, uuid, uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.approve_opening_batch(p_batch uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); b inv.opening_inventory_batches%ROWTYPE; ln RECORD;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO b FROM inv.opening_inventory_batches WHERE tenant_id = v_tenant AND id = p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'opening batch % not found', p_batch USING ERRCODE = 'foreign_key_violation'; END IF;
  IF b.status <> 'draft' THEN RAISE EXCEPTION 'opening batch is % (must be draft)', b.status USING ERRCODE = 'check_violation'; END IF;
  UPDATE inv.opening_inventory_batches SET status = 'approved', approved_by = iam.current_user_id(), approved_at = now() WHERE tenant_id = v_tenant AND id = p_batch;
  FOR ln IN SELECT id, item_id, location_id, quantity FROM inv.opening_inventory_lines WHERE tenant_id = v_tenant AND batch_id = p_batch AND deleted_at IS NULL LOOP
    PERFORM inv.post_stock_movement(ln.item_id, ln.location_id, 'opening', 'in', ln.quantity, 'opening_line', ln.id);
  END LOOP;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.approve_opening_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.approve_opening_batch(uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.approve_adjustment(p_adjustment uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); a inv.stock_adjustments%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO a FROM inv.stock_adjustments WHERE tenant_id = v_tenant AND id = p_adjustment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'adjustment % not found', p_adjustment USING ERRCODE = 'foreign_key_violation'; END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'adjustment is % (must be pending)', a.status USING ERRCODE = 'check_violation'; END IF;
  UPDATE inv.stock_adjustments SET status = 'approved', approved_by = iam.current_user_id(), approved_at = now() WHERE tenant_id = v_tenant AND id = p_adjustment;
  IF a.direction = 'out' THEN PERFORM inv.free_reservations_for_loss(a.item_id, a.location_id, a.quantity); END IF;
  PERFORM inv.post_stock_movement(a.item_id, a.location_id, 'adjustment', a.direction, a.quantity, 'adjustment', a.id);
END; $$;
REVOKE EXECUTE ON FUNCTION inv.approve_adjustment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.approve_adjustment(uuid) TO app_runtime;
