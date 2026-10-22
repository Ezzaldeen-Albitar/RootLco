-- ============================================================================
-- Phase: 1-32 (preparatory) — material demand control, slice 3a
-- Migration: approved material requirements, finite exceptions, material requests
--            and their fulfillment links, with one transactional ceiling
-- Tasks: P1-32-PRE-122
-- Owner module: inv
--
-- Rollback classification: ROLL-FORWARD-ONLY once a material request has been
--   fulfilled: its reservations and issues are ledger facts. ROLLBACK-SAFE while the
--   four tables are empty. No down script.
--
-- Purpose
--   A work order could draw any quantity of any item: `inv.issue_part` checks that
--   stock exists and nothing else, so the only ceiling on what a job consumed was
--   what the shelf held. This migration adds the missing question — "was this
--   quantity approved for this job?" — and makes the database answer it.
--
--     * A DRAW NEEDS AN APPROVED REQUIREMENT. `inv.material_requirements` binds a
--       work order, ONE service line on it, and ONE item or ONE item family to an
--       allowance in a stated unit with the source it came from. A requirement is
--       approved by a person other than the one who asked for it. A material
--       request against a requirement that is not `approved` is refused with
--       `material_approval_required`: the absence of an approval is a refusal, never
--       an unlimited allowance.
--
--     * MISSING FACTS ARE A STATE, NOT A DEFAULT. A requirement derived from a
--       vehicle specification that does not exist is stored as
--       `approval_required` / `missing_specification` with NO allowance; one whose
--       item cannot be converted into the allowance unit is stored as
--       `approval_required` / `missing_unit_conversion`. Both are actionable — supply
--       an entered value with its source, or add the conversion and re-check — and
--       neither can be approved or drawn on until the fact exists.
--
--     * ONE QUANTITY, COUNTED ONCE, WHEREVER IT IS. Demand moves request ->
--       reservation -> issue. `inv.material_requirement_usage` counts each unit in
--       exactly one of those places: an OPEN request contributes its unreserved,
--       unissued remainder; an ACTIVE reservation linked to it contributes its
--       quantity; an issue linked to it contributes its quantity; and a RESTOCKABLE
--       return of that issue gives its quantity back. A reservation consumed by an
--       issue is no longer active, so the same unit is never both. A closed or
--       cancelled request releases its reservations and keeps only what was issued.
--       Everything is converted into the requirement's unit with the exact factor the
--       request recorded.
--
--     * THE CEILING BINDS IN THE DATABASE, UNDER A LOCK. `inv.guard_material_request_ceiling`
--       fires on every INSERT into `inv.material_requests`, locks the requirement
--       row FOR UPDATE, re-reads the usage in a fresh snapshot and refuses a request
--       that would take the committed quantity past the approved allowance plus
--       approved exceptions. Two concurrent requests therefore serialize on the
--       requirement, and the second sees the first. A fulfillment link is bounded
--       the same way against its own request, so a request can never be reserved or
--       issued beyond what it asked for.
--
--     * DUPLICATE DEMAND IS REFUSED. One active requirement per (service line, item
--       or family) (`uq_material_requirements_active`), and an item requirement may
--       not sit beside an active requirement for its own family on the same line —
--       two allowances for one need would each be spendable.
--
--     * EXCEPTIONS ARE FINITE AND TWO-PERSON. `inv.material_requirement_exceptions`
--       adds a stated additional quantity with a mandatory reason; approval records
--       the resulting allowance, and the approver must differ from the requester
--       (`ck_material_requirement_exceptions_separation`). There is no global numeric
--       ceiling.
--
--       WHY NOT `iam.approval_limits`: that table is a MONETARY ceiling —
--       `amount numeric(18,4)` with a NOT NULL `currency_code` foreign key to
--       `shared.currencies` (20260718093000). A quantity of litres has no currency,
--       so a quantity limit type cannot be expressed in the existing model without
--       inventing a currency for it. Authority to approve an exception is therefore
--       a DEDICATED permission, `inv.material.exception.approve`, minted in
--       supabase/seeds/04_iam_permission_catalog.sql; the database enforces the
--       separation of duties and the finite quantity, and the operation that
--       publishes the approval enforces the permission.
--
--   What this migration deliberately does NOT change: `inv.issue_part` and
--   `inv.reserve_stock` keep their existing behaviour, so the stock paths already
--   published (POST /stock-issues, POST /stock-reservations) are not yet governed by
--   a requirement. Routing them through a material request is an application
--   decision for the slice that publishes these operations.
--
-- Dependencies
--   wo.work_orders, wo.work_order_service_lines (20260722095000, 20260722100000);
--   veh.vehicles; inv.item_master, inv.item_categories, inv.units_of_measure;
--   inv.stock_reservations, inv.reserve_stock, inv.release_reservation
--   (20260723094000); inv.part_issues, inv.part_returns, inv.issue_part
--   (20260723095000); inv.sales_returns (20260917094000);
--   inv.unit_conversion_factor (20260917095000);
--   inv.vehicle_fluid_specifications, inv.resolve_vehicle_fluid_specification
--   (20260917096000).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. inv.material_requirements
-- ----------------------------------------------------------------------------
CREATE TABLE inv.material_requirements (
  id                       uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                uuid    NOT NULL,
  company_id               uuid    NOT NULL,
  branch_id                uuid    NOT NULL,
  work_order_id            uuid    NOT NULL,
  service_line_id          uuid    NOT NULL,
  item_id                  uuid    NULL,
  item_category_id         uuid    NULL,
  basis                    text    NOT NULL,
  specification_id         uuid    NULL,
  service_condition        text    NULL,
  engine_variant           text    NULL,
  allowance_quantity       numeric(12, 3) NULL,
  uom_id                   uuid    NULL,
  source_reference         text    NULL,
  status                   text    NOT NULL DEFAULT 'approval_required',
  approval_required_reason text    NULL,
  requested_by             uuid    NOT NULL,
  approved_by              uuid    NULL,
  approved_at              timestamptz NULL,
  rejected_by              uuid    NULL,
  rejected_at              timestamptz NULL,
  rejection_reason         text    NULL,
  cancelled_by             uuid    NULL,
  cancelled_at             timestamptz NULL,
  cancel_reason            text    NULL,
  record_version           integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid    NOT NULL,
  updated_at               timestamptz NULL,
  updated_by               uuid    NULL,

  CONSTRAINT pk_material_requirements PRIMARY KEY (id),
  CONSTRAINT uq_material_requirements_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_material_requirements_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirements_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirements_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirements_service_line FOREIGN KEY (tenant_id, company_id, branch_id, service_line_id)
    REFERENCES wo.work_order_service_lines (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirements_item FOREIGN KEY (tenant_id, item_id)
    REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirements_category FOREIGN KEY (tenant_id, item_category_id)
    REFERENCES inv.item_categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirements_specification FOREIGN KEY (tenant_id, specification_id)
    REFERENCES inv.vehicle_fluid_specifications (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirements_uom FOREIGN KEY (uom_id) REFERENCES inv.units_of_measure (id) ON DELETE RESTRICT,
  CONSTRAINT ck_material_requirements_target CHECK (num_nonnulls(item_id, item_category_id) = 1),
  CONSTRAINT ck_material_requirements_basis CHECK (basis IN ('specification', 'entered')),
  CONSTRAINT ck_material_requirements_entered_no_specification CHECK (basis = 'specification' OR specification_id IS NULL),
  CONSTRAINT ck_material_requirements_specification_condition CHECK (basis <> 'specification' OR service_condition IS NOT NULL),
  CONSTRAINT ck_material_requirements_specification_resolved CHECK (
    basis <> 'specification' OR specification_id IS NOT NULL OR status IN ('approval_required', 'rejected', 'cancelled')),
  CONSTRAINT ck_material_requirements_allowance CHECK (allowance_quantity IS NULL OR allowance_quantity > 0),
  CONSTRAINT ck_material_requirements_allowance_unit CHECK ((allowance_quantity IS NULL) = (uom_id IS NULL)),
  CONSTRAINT ck_material_requirements_allowance_source CHECK ((allowance_quantity IS NULL) = (source_reference IS NULL)),
  CONSTRAINT ck_material_requirements_source_not_blank CHECK (source_reference IS NULL OR btrim(source_reference) <> ''),
  CONSTRAINT ck_material_requirements_decidable CHECK (status NOT IN ('pending_approval', 'approved') OR allowance_quantity IS NOT NULL),
  CONSTRAINT ck_material_requirements_status CHECK (status IN ('approval_required', 'pending_approval', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT ck_material_requirements_reason_state CHECK ((status = 'approval_required') = (approval_required_reason IS NOT NULL)),
  CONSTRAINT ck_material_requirements_reason CHECK (
    approval_required_reason IS NULL OR approval_required_reason IN ('missing_specification', 'missing_unit_conversion')),
  CONSTRAINT ck_material_requirements_missing_specification CHECK (
    approval_required_reason IS DISTINCT FROM 'missing_specification' OR allowance_quantity IS NULL),
  CONSTRAINT ck_material_requirements_condition_format CHECK (service_condition IS NULL OR service_condition ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_material_requirements_engine_not_blank CHECK (engine_variant IS NULL OR btrim(engine_variant) <> ''),
  CONSTRAINT ck_material_requirements_approved CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CONSTRAINT ck_material_requirements_approved_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT ck_material_requirements_separation CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT ck_material_requirements_rejected CHECK ((status = 'rejected') = (rejected_at IS NOT NULL)),
  CONSTRAINT ck_material_requirements_rejected_pair CHECK ((rejected_by IS NULL) = (rejected_at IS NULL)),
  CONSTRAINT ck_material_requirements_rejection_separation CHECK (rejected_by IS NULL OR rejected_by <> requested_by),
  CONSTRAINT ck_material_requirements_rejection_reason CHECK (
    (status <> 'rejected' OR rejection_reason IS NOT NULL) AND (rejection_reason IS NULL OR btrim(rejection_reason) <> '')),
  CONSTRAINT ck_material_requirements_cancelled CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT ck_material_requirements_cancelled_pair CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
  CONSTRAINT ck_material_requirements_cancel_reason CHECK (
    (status <> 'cancelled' OR cancel_reason IS NOT NULL) AND (cancel_reason IS NULL OR btrim(cancel_reason) <> ''))
);
COMMENT ON TABLE inv.material_requirements IS 'What a service line on a work order is approved to consume of one item or one item family: an allowance in a stated unit, with its source (a confirmed vehicle specification, or an entered value). approval_required carries the reason nothing can be approved yet (missing_specification, missing_unit_conversion). A material request draws only on an APPROVED requirement, and only up to its allowance plus approved exceptions (inv.guard_material_request_ceiling). Approver differs from requester.';
COMMENT ON COLUMN inv.material_requirements.approval_required_reason IS 'Why the requirement cannot yet be approved: missing_specification (no confirmed specification answers for the vehicle; no allowance is stored) or missing_unit_conversion (the item cannot be converted exactly into the allowance unit).';

CREATE UNIQUE INDEX uq_material_requirements_active ON inv.material_requirements (tenant_id, service_line_id, item_id, item_category_id)
  NULLS NOT DISTINCT WHERE status IN ('approval_required', 'pending_approval', 'approved');
CREATE INDEX ix_material_requirements_branch ON inv.material_requirements (tenant_id, company_id, branch_id);
CREATE INDEX ix_material_requirements_work_order ON inv.material_requirements (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_material_requirements_service_line ON inv.material_requirements (tenant_id, company_id, branch_id, service_line_id);
CREATE INDEX ix_material_requirements_item ON inv.material_requirements (tenant_id, item_id);
CREATE INDEX ix_material_requirements_category ON inv.material_requirements (tenant_id, item_category_id);
CREATE INDEX ix_material_requirements_specification ON inv.material_requirements (tenant_id, specification_id);
CREATE INDEX ix_material_requirements_uom ON inv.material_requirements (uom_id);

CREATE OR REPLACE FUNCTION inv.guard_material_requirement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_line_wo uuid; v_scope text; v_tenant uuid; v_item_category uuid; v_item_uom uuid;
        v_spec_status text; v_spec_capacity numeric(12, 3); v_spec_uom uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('rejected', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'inv.material_requirements: % is terminal', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF (OLD.status = 'approval_required' AND NEW.status NOT IN ('approval_required', 'pending_approval', 'cancelled'))
       OR (OLD.status = 'pending_approval' AND NEW.status NOT IN ('pending_approval', 'approved', 'rejected', 'cancelled'))
       OR (OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'cancelled')) THEN
      RAISE EXCEPTION 'inv.material_requirements: % cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    -- What was put in front of the approver is what gets approved, and an approved
    -- allowance grows only through an approved exception.
    IF OLD.status IN ('pending_approval', 'approved')
       AND (NEW.allowance_quantity IS DISTINCT FROM OLD.allowance_quantity
         OR NEW.uom_id IS DISTINCT FROM OLD.uom_id
         OR NEW.basis IS DISTINCT FROM OLD.basis
         OR NEW.specification_id IS DISTINCT FROM OLD.specification_id
         OR NEW.source_reference IS DISTINCT FROM OLD.source_reference) THEN
      RAISE EXCEPTION 'inv.material_requirements: a % allowance is not edited; an approved allowance grows only through an approved exception', OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.status NOT IN ('approval_required', 'pending_approval') THEN
      RAISE EXCEPTION 'inv.material_requirements: a requirement is born approval_required or pending_approval; approval is a separate act'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT work_order_id INTO v_line_wo FROM wo.work_order_service_lines
   WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id
     AND id = NEW.service_line_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.material_requirements: service line % not found in scope', NEW.service_line_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_line_wo <> NEW.work_order_id THEN
    RAISE EXCEPTION 'inv.material_requirements: service line % belongs to another work order', NEW.service_line_id USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.uom_id IS NOT NULL THEN
    SELECT scope, tenant_id INTO v_scope, v_tenant FROM inv.units_of_measure WHERE id = NEW.uom_id AND deleted_at IS NULL;
    IF NOT FOUND OR (v_scope = 'tenant' AND v_tenant IS DISTINCT FROM NEW.tenant_id) THEN
      RAISE EXCEPTION 'inv.material_requirements: unit % is not visible to this tenant', NEW.uom_id USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- A requirement taken from a specification carries THAT specification's figure,
  -- and only a confirmed specification can be put forward or approved.
  IF NEW.specification_id IS NOT NULL AND NEW.status IN ('pending_approval', 'approved')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT status, capacity, uom_id INTO v_spec_status, v_spec_capacity, v_spec_uom
      FROM inv.vehicle_fluid_specifications WHERE tenant_id = NEW.tenant_id AND id = NEW.specification_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inv.material_requirements: specification % not found', NEW.specification_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_spec_status <> 'confirmed' THEN
      RAISE EXCEPTION 'material_approval_required: specification % is % and cannot support an allowance', NEW.specification_id, v_spec_status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.allowance_quantity <> v_spec_capacity OR NEW.uom_id <> v_spec_uom THEN
      RAISE EXCEPTION 'inv.material_requirements: a requirement derived from a specification carries its capacity % and unit', v_spec_capacity
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Serialize requirements on one service line, so the family/item overlap below
    -- cannot be raced by two concurrent inserts.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      'inv.material_requirements:' || NEW.tenant_id::text || ':' || NEW.service_line_id::text));
    IF NEW.item_id IS NOT NULL THEN
      SELECT item_category_id INTO v_item_category FROM inv.item_master WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id;
      IF EXISTS (
        SELECT 1 FROM inv.material_requirements r
         WHERE r.tenant_id = NEW.tenant_id AND r.service_line_id = NEW.service_line_id
           AND r.item_category_id = v_item_category
           AND r.status IN ('approval_required', 'pending_approval', 'approved')
      ) THEN
        RAISE EXCEPTION 'material_duplicate_demand: the service line already has an active requirement for the family of item %', NEW.item_id
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM inv.material_requirements r JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
       WHERE r.tenant_id = NEW.tenant_id AND r.service_line_id = NEW.service_line_id
         AND i.item_category_id = NEW.item_category_id
         AND r.status IN ('approval_required', 'pending_approval', 'approved')
    ) THEN
      RAISE EXCEPTION 'material_duplicate_demand: the service line already has an active requirement for an item of family %', NEW.item_category_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- An item requirement is approvable only when the item converts exactly into the
  -- allowance unit. A family is checked per request, item by item.
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status <> 'approved') AND NEW.item_id IS NOT NULL THEN
    SELECT uom_id INTO v_item_uom FROM inv.item_master WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id;
    IF inv.unit_conversion_factor(NEW.tenant_id, NEW.item_id, v_item_uom, NEW.uom_id) IS NULL THEN
      RAISE EXCEPTION 'material_approval_required: missing_unit_conversion: item % has no exact conversion into the allowance unit', NEW.item_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_material_requirement() FROM PUBLIC;

CREATE TRIGGER tg_material_requirements_guard BEFORE INSERT OR UPDATE ON inv.material_requirements
  FOR EACH ROW EXECUTE FUNCTION inv.guard_material_requirement();
CREATE TRIGGER tg_material_requirements_touch_metadata BEFORE UPDATE ON inv.material_requirements
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_material_requirements_immutable BEFORE UPDATE ON inv.material_requirements
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'work_order_id', 'service_line_id', 'item_id',
    'item_category_id', 'service_condition', 'engine_variant', 'requested_by', 'created_at', 'created_by');

ALTER TABLE inv.material_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.material_requirements FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_material_requirements_scope ON inv.material_requirements FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_material_requirements_scope ON inv.material_requirements FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_material_requirements_scope ON inv.material_requirements FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.material_requirements TO app_runtime;
GRANT SELECT ON inv.material_requirements TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. inv.material_requirement_exceptions
-- ----------------------------------------------------------------------------
CREATE TABLE inv.material_requirement_exceptions (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  requirement_id      uuid    NOT NULL,
  additional_quantity numeric(12, 3) NOT NULL,
  resulting_allowance numeric(12, 3) NULL,
  reason              text    NOT NULL,
  status              text    NOT NULL DEFAULT 'pending',
  requested_by        uuid    NOT NULL,
  decided_by          uuid    NULL,
  decided_at          timestamptz NULL,
  decision_note       text    NULL,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,

  CONSTRAINT pk_material_requirement_exceptions PRIMARY KEY (id),
  CONSTRAINT uq_material_requirement_exceptions_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_material_requirement_exceptions_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requirement_exceptions_requirement FOREIGN KEY (tenant_id, company_id, branch_id, requirement_id)
    REFERENCES inv.material_requirements (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_material_requirement_exceptions_additional CHECK (additional_quantity > 0),
  CONSTRAINT ck_material_requirement_exceptions_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_material_requirement_exceptions_status CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT ck_material_requirement_exceptions_decided CHECK ((status <> 'pending') = (decided_at IS NOT NULL)),
  CONSTRAINT ck_material_requirement_exceptions_decided_pair CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT ck_material_requirement_exceptions_separation CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT ck_material_requirement_exceptions_resulting CHECK ((status = 'approved') = (resulting_allowance IS NOT NULL)),
  CONSTRAINT ck_material_requirement_exceptions_resulting_positive CHECK (resulting_allowance IS NULL OR resulting_allowance > 0),
  CONSTRAINT ck_material_requirement_exceptions_note_not_blank CHECK (decision_note IS NULL OR btrim(decision_note) <> '')
);
COMMENT ON TABLE inv.material_requirement_exceptions IS 'A finite additional quantity on an approved material requirement, with a mandatory reason. Approved by a person other than the requester, recording the resulting allowance. There is no global numeric ceiling: iam.approval_limits is monetary (currency_code NOT NULL), so the authority is the dedicated permission inv.material.exception.approve.';

CREATE INDEX ix_material_requirement_exceptions_requirement ON inv.material_requirement_exceptions (tenant_id, company_id, branch_id, requirement_id);

CREATE OR REPLACE FUNCTION inv.guard_material_requirement_exception()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text; v_allowance numeric(12, 3); v_approved numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'inv.material_requirement_exceptions: an exception is born pending; approval is a separate act' USING ERRCODE = 'check_violation';
    END IF;
    SELECT status INTO v_status FROM inv.material_requirements
     WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.requirement_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inv.material_requirement_exceptions: requirement % not found in scope', NEW.requirement_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_status <> 'approved' THEN
      RAISE EXCEPTION 'material_approval_required: an exception extends an APPROVED requirement; this one is %', v_status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inv.material_requirement_exceptions: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    SELECT status, allowance_quantity INTO v_status, v_allowance FROM inv.material_requirements
     WHERE tenant_id = NEW.tenant_id AND id = NEW.requirement_id FOR UPDATE;
    IF v_status <> 'approved' THEN
      RAISE EXCEPTION 'material_approval_required: the requirement is % and can take no exception', v_status USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(sum(additional_quantity), 0) INTO v_approved FROM inv.material_requirement_exceptions
     WHERE tenant_id = NEW.tenant_id AND requirement_id = NEW.requirement_id AND status = 'approved' AND id <> NEW.id;
    IF NEW.resulting_allowance IS DISTINCT FROM v_allowance + v_approved + NEW.additional_quantity THEN
      RAISE EXCEPTION 'inv.material_requirement_exceptions: the resulting allowance is %, not %',
        v_allowance + v_approved + NEW.additional_quantity, NEW.resulting_allowance USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_material_requirement_exception() FROM PUBLIC;

CREATE TRIGGER tg_material_requirement_exceptions_guard BEFORE INSERT OR UPDATE ON inv.material_requirement_exceptions
  FOR EACH ROW EXECUTE FUNCTION inv.guard_material_requirement_exception();
CREATE TRIGGER tg_material_requirement_exceptions_touch_metadata BEFORE UPDATE ON inv.material_requirement_exceptions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_material_requirement_exceptions_immutable BEFORE UPDATE ON inv.material_requirement_exceptions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'requirement_id', 'additional_quantity', 'reason',
    'requested_by', 'created_at', 'created_by');

ALTER TABLE inv.material_requirement_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.material_requirement_exceptions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_material_requirement_exceptions_scope ON inv.material_requirement_exceptions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_material_requirement_exceptions_scope ON inv.material_requirement_exceptions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_material_requirement_exceptions_scope ON inv.material_requirement_exceptions FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.material_requirement_exceptions TO app_runtime;
GRANT SELECT ON inv.material_requirement_exceptions TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. inv.material_requests
-- ----------------------------------------------------------------------------
CREATE TABLE inv.material_requests (
  id                      uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id               uuid    NOT NULL,
  company_id              uuid    NOT NULL,
  branch_id               uuid    NOT NULL,
  requirement_id          uuid    NOT NULL,
  work_order_id           uuid    NOT NULL,
  item_id                 uuid    NOT NULL,
  quantity                numeric(12, 3) NOT NULL,
  requirement_unit_factor numeric(24, 12) NOT NULL,
  status                  text    NOT NULL DEFAULT 'open',
  requested_by            uuid    NOT NULL,
  closed_by               uuid    NULL,
  closed_at               timestamptz NULL,
  close_reason            text    NULL,
  cancelled_by            uuid    NULL,
  cancelled_at            timestamptz NULL,
  cancel_reason           text    NULL,
  idempotency_key         text    NULL,
  correlation_id          uuid    NULL,
  record_version          integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid    NOT NULL,
  updated_at              timestamptz NULL,
  updated_by              uuid    NULL,

  CONSTRAINT pk_material_requests PRIMARY KEY (id),
  CONSTRAINT uq_material_requests_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_material_requests_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requests_requirement FOREIGN KEY (tenant_id, company_id, branch_id, requirement_id)
    REFERENCES inv.material_requirements (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requests_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_requests_item FOREIGN KEY (tenant_id, item_id)
    REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_material_requests_quantity CHECK (quantity > 0),
  CONSTRAINT ck_material_requests_factor CHECK (requirement_unit_factor > 0),
  CONSTRAINT ck_material_requests_status CHECK (status IN ('open', 'closed', 'cancelled')),
  CONSTRAINT ck_material_requests_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT ck_material_requests_closed_pair CHECK ((closed_by IS NULL) = (closed_at IS NULL)),
  CONSTRAINT ck_material_requests_close_reason CHECK (close_reason IS NULL OR btrim(close_reason) <> ''),
  CONSTRAINT ck_material_requests_cancelled CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT ck_material_requests_cancelled_pair CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
  CONSTRAINT ck_material_requests_cancel_reason CHECK (
    (status <> 'cancelled' OR cancel_reason IS NOT NULL) AND (cancel_reason IS NULL OR btrim(cancel_reason) <> ''))
);
COMMENT ON TABLE inv.material_requests IS 'A draw on an approved material requirement: a quantity of one item in its stock unit, and the exact factor that converts it into the requirement unit. Bounded at INSERT by inv.guard_material_request_ceiling under the requirement row lock. Fulfilled through inv.material_request_fulfillments (reservations and issues), never beyond its own quantity.';
COMMENT ON COLUMN inv.material_requests.requirement_unit_factor IS 'How many requirement units ONE stock unit of the item is, read from inv.unit_conversion_factor at request time and re-verified by the ceiling guard.';

CREATE UNIQUE INDEX uq_material_requests_idempotency ON inv.material_requests (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_material_requests_branch ON inv.material_requests (tenant_id, company_id, branch_id);
CREATE INDEX ix_material_requests_requirement ON inv.material_requests (tenant_id, company_id, branch_id, requirement_id);
CREATE INDEX ix_material_requests_work_order ON inv.material_requests (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_material_requests_item ON inv.material_requests (tenant_id, item_id);

-- ----------------------------------------------------------------------------
-- 4. inv.material_request_fulfillments — append-only links to the ledger acts.
-- ----------------------------------------------------------------------------
CREATE TABLE inv.material_request_fulfillments (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  material_request_id uuid    NOT NULL,
  fulfillment_kind    text    NOT NULL,
  reservation_id      uuid    NULL,
  part_issue_id       uuid    NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,

  CONSTRAINT pk_material_request_fulfillments PRIMARY KEY (id),
  CONSTRAINT fk_material_request_fulfillments_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_request_fulfillments_request FOREIGN KEY (tenant_id, company_id, branch_id, material_request_id)
    REFERENCES inv.material_requests (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_request_fulfillments_reservation FOREIGN KEY (tenant_id, company_id, branch_id, reservation_id)
    REFERENCES inv.stock_reservations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_material_request_fulfillments_issue FOREIGN KEY (tenant_id, company_id, branch_id, part_issue_id)
    REFERENCES inv.part_issues (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_material_request_fulfillments_kind CHECK (fulfillment_kind IN ('reservation', 'issue')),
  CONSTRAINT ck_material_request_fulfillments_shape CHECK (
    (fulfillment_kind = 'reservation' AND reservation_id IS NOT NULL AND part_issue_id IS NULL)
    OR (fulfillment_kind = 'issue' AND part_issue_id IS NOT NULL AND reservation_id IS NULL))
);
COMMENT ON TABLE inv.material_request_fulfillments IS 'Append-only link from a material request to the reservation or part issue that fulfilled it. A reservation or an issue fulfills at most one request, and the links of one request never exceed its quantity (inv.guard_material_request_fulfillment).';

CREATE UNIQUE INDEX uq_material_request_fulfillments_reservation ON inv.material_request_fulfillments (tenant_id, reservation_id) WHERE reservation_id IS NOT NULL;
CREATE UNIQUE INDEX uq_material_request_fulfillments_issue ON inv.material_request_fulfillments (tenant_id, part_issue_id) WHERE part_issue_id IS NOT NULL;
CREATE INDEX ix_material_request_fulfillments_request ON inv.material_request_fulfillments (tenant_id, company_id, branch_id, material_request_id);
CREATE INDEX ix_material_request_fulfillments_reservation ON inv.material_request_fulfillments (tenant_id, company_id, branch_id, reservation_id);
CREATE INDEX ix_material_request_fulfillments_issue ON inv.material_request_fulfillments (tenant_id, company_id, branch_id, part_issue_id);

-- ----------------------------------------------------------------------------
-- 5. Usage — one quantity, counted once, in the requirement's unit.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.material_requirement_usage(p_tenant uuid, p_requirement uuid)
RETURNS TABLE (allowance_quantity numeric, approved_exception_quantity numeric, effective_allowance numeric,
               open_request_quantity numeric, reserved_quantity numeric, issued_quantity numeric,
               returned_quantity numeric, committed_quantity numeric, remaining_quantity numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH req AS (
    SELECT r.allowance_quantity AS allowance
      FROM inv.material_requirements r
     WHERE r.tenant_id = p_tenant AND r.id = p_requirement
  ), exc AS (
    SELECT COALESCE(sum(e.additional_quantity), 0) AS extra
      FROM inv.material_requirement_exceptions e
     WHERE e.tenant_id = p_tenant AND e.requirement_id = p_requirement AND e.status = 'approved'
  ), per_request AS (
    SELECT q.status, q.quantity, q.requirement_unit_factor AS factor,
           COALESCE((SELECT sum(pi.quantity)
                       FROM inv.material_request_fulfillments f
                       JOIN inv.part_issues pi ON pi.tenant_id = f.tenant_id AND pi.id = f.part_issue_id
                      WHERE f.tenant_id = p_tenant AND f.material_request_id = q.id AND f.fulfillment_kind = 'issue'), 0) AS issued,
           COALESCE((SELECT sum(sr.quantity)
                       FROM inv.material_request_fulfillments f
                       JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
                      WHERE f.tenant_id = p_tenant AND f.material_request_id = q.id AND f.fulfillment_kind = 'reservation'
                        AND sr.status = 'active'), 0) AS reserved,
           COALESCE((SELECT sum(pr.quantity)
                       FROM inv.material_request_fulfillments f
                       JOIN inv.part_returns pr ON pr.tenant_id = f.tenant_id AND pr.part_issue_id = f.part_issue_id
                      WHERE f.tenant_id = p_tenant AND f.material_request_id = q.id AND f.fulfillment_kind = 'issue'), 0)
         + COALESCE((SELECT sum(sret.quantity)
                       FROM inv.material_request_fulfillments f
                       JOIN inv.sales_returns sret ON sret.tenant_id = f.tenant_id AND sret.source_kind = 'part_issue'
                                                  AND sret.source_id = f.part_issue_id
                      WHERE f.tenant_id = p_tenant AND f.material_request_id = q.id AND f.fulfillment_kind = 'issue'
                        AND sret.return_condition = 'restockable'), 0) AS returned
      FROM inv.material_requests q
     WHERE q.tenant_id = p_tenant AND q.requirement_id = p_requirement
  ), totals AS (
    SELECT COALESCE(sum(CASE WHEN status = 'open' THEN GREATEST(quantity - issued - reserved, 0) ELSE 0 END * factor), 0) AS open_q,
           COALESCE(sum(reserved * factor), 0) AS reserved_q,
           COALESCE(sum(issued * factor), 0) AS issued_q,
           COALESCE(sum(returned * factor), 0) AS returned_q
      FROM per_request
  )
  SELECT req.allowance, exc.extra, req.allowance + exc.extra,
         t.open_q, t.reserved_q, t.issued_q, t.returned_q,
         t.open_q + t.reserved_q + t.issued_q - t.returned_q,
         req.allowance + exc.extra - (t.open_q + t.reserved_q + t.issued_q - t.returned_q)
    FROM req, exc, totals t
$$;
COMMENT ON FUNCTION inv.material_requirement_usage(uuid, uuid) IS 'The committed quantity of a requirement in its own unit: open unreserved request remainders + active linked reservations + linked issues - restockable returns of those issues, each unit counted once. Advisory when read; binding when read by inv.guard_material_request_ceiling under the requirement lock.';
REVOKE EXECUTE ON FUNCTION inv.material_requirement_usage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.material_requirement_usage(uuid, uuid) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 6. The ceilings.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.guard_material_request_ceiling()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r inv.material_requirements%ROWTYPE; v_item_category uuid; v_item_uom uuid; v_factor numeric; u record;
BEGIN
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = NEW.tenant_id AND id = NEW.requirement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.material_requests: requirement % not found', NEW.requirement_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.company_id <> r.company_id OR NEW.branch_id <> r.branch_id OR NEW.work_order_id <> r.work_order_id THEN
    RAISE EXCEPTION 'inv.material_requests: a request draws on a requirement of its own work order' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'open' THEN
    RAISE EXCEPTION 'inv.material_requests: a request is born open' USING ERRCODE = 'check_violation';
  END IF;
  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'material_approval_required: requirement % is % and allows no draw', r.id, r.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT item_category_id, uom_id INTO v_item_category, v_item_uom FROM inv.item_master WHERE tenant_id = NEW.tenant_id AND id = NEW.item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.material_requests: item % not found', NEW.item_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- COALESCE, not a bare OR: a family requirement has no item_id, and
  -- `NULL = x OR false` is NULL, which an IF NOT would read as "covered".
  IF NOT (COALESCE(r.item_id = NEW.item_id, false) OR COALESCE(r.item_category_id = v_item_category, false)) THEN
    RAISE EXCEPTION 'material_item_not_covered: requirement % does not cover item %', r.id, NEW.item_id USING ERRCODE = 'check_violation';
  END IF;
  v_factor := inv.unit_conversion_factor(NEW.tenant_id, NEW.item_id, v_item_uom, r.uom_id);
  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'material_approval_required: missing_unit_conversion: item % has no exact conversion into the requirement unit', NEW.item_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.requirement_unit_factor <> v_factor THEN
    RAISE EXCEPTION 'inv.material_requests: the request must carry the live conversion factor %', v_factor USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO u FROM inv.material_requirement_usage(NEW.tenant_id, r.id);
  IF u.effective_allowance IS NULL THEN
    RAISE EXCEPTION 'material_approval_required: requirement % has no allowance', r.id USING ERRCODE = 'check_violation';
  END IF;
  IF u.committed_quantity + NEW.quantity * v_factor > u.effective_allowance THEN
    RAISE EXCEPTION 'material_allowance_exceeded: requesting % would exceed the % allowed (% already committed); an approved exception is required',
      NEW.quantity * v_factor, u.effective_allowance, u.committed_quantity USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_material_request_ceiling() FROM PUBLIC;

CREATE OR REPLACE FUNCTION inv.guard_material_request_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inv.material_requests: % is terminal', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('closed', 'cancelled') AND OLD.status = 'open' THEN
    IF EXISTS (
      SELECT 1 FROM inv.material_request_fulfillments f
        JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
       WHERE f.tenant_id = NEW.tenant_id AND f.material_request_id = NEW.id AND sr.status = 'active'
    ) THEN
      RAISE EXCEPTION 'inv.material_requests: release the active reservations of a request before it is %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'cancelled' AND EXISTS (
      SELECT 1 FROM inv.material_request_fulfillments f
       WHERE f.tenant_id = NEW.tenant_id AND f.material_request_id = NEW.id AND f.fulfillment_kind = 'issue'
    ) THEN
      RAISE EXCEPTION 'inv.material_requests: a request that issued stock is closed, not cancelled' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_material_request_status() FROM PUBLIC;

CREATE TRIGGER tg_material_requests_ceiling BEFORE INSERT ON inv.material_requests
  FOR EACH ROW EXECUTE FUNCTION inv.guard_material_request_ceiling();
CREATE TRIGGER tg_material_requests_status BEFORE UPDATE ON inv.material_requests
  FOR EACH ROW EXECUTE FUNCTION inv.guard_material_request_status();
CREATE TRIGGER tg_material_requests_touch_metadata BEFORE UPDATE ON inv.material_requests
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_material_requests_immutable BEFORE UPDATE ON inv.material_requests
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'requirement_id', 'work_order_id', 'item_id', 'quantity',
    'requirement_unit_factor', 'requested_by', 'idempotency_key', 'created_at', 'created_by');

ALTER TABLE inv.material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.material_requests FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_material_requests_scope ON inv.material_requests FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_material_requests_scope ON inv.material_requests FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_material_requests_scope ON inv.material_requests FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON inv.material_requests TO app_runtime;
GRANT SELECT ON inv.material_requests TO app_readonly;

CREATE OR REPLACE FUNCTION inv.guard_material_request_fulfillment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q inv.material_requests%ROWTYPE; v_item uuid; v_work_order uuid; v_quantity numeric(12, 3);
        v_status text; v_committed numeric;
BEGIN
  SELECT * INTO q FROM inv.material_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.material_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.material_request_fulfillments: material request % not found', NEW.material_request_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF q.status <> 'open' THEN
    RAISE EXCEPTION 'inv.material_request_fulfillments: material request is % and takes no further fulfillment', q.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.fulfillment_kind = 'reservation' THEN
    SELECT item_id, work_order_id, quantity, status INTO v_item, v_work_order, v_quantity, v_status
      FROM inv.stock_reservations WHERE tenant_id = NEW.tenant_id AND id = NEW.reservation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inv.material_request_fulfillments: reservation % not found', NEW.reservation_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_status <> 'active' THEN
      RAISE EXCEPTION 'inv.material_request_fulfillments: reservation is % (must be active)', v_status USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT item_id, work_order_id, quantity INTO v_item, v_work_order, v_quantity
      FROM inv.part_issues WHERE tenant_id = NEW.tenant_id AND id = NEW.part_issue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inv.material_request_fulfillments: part issue % not found', NEW.part_issue_id USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF v_item <> q.item_id OR v_work_order IS DISTINCT FROM q.work_order_id THEN
    RAISE EXCEPTION 'inv.material_request_fulfillments: the fulfillment is for another item or work order than the request' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE((SELECT sum(pi.quantity) FROM inv.material_request_fulfillments f
                     JOIN inv.part_issues pi ON pi.tenant_id = f.tenant_id AND pi.id = f.part_issue_id
                    WHERE f.tenant_id = NEW.tenant_id AND f.material_request_id = q.id AND f.fulfillment_kind = 'issue'), 0)
       + COALESCE((SELECT sum(sr.quantity) FROM inv.material_request_fulfillments f
                     JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
                    WHERE f.tenant_id = NEW.tenant_id AND f.material_request_id = q.id AND f.fulfillment_kind = 'reservation'
                      AND sr.status = 'active' AND sr.id IS DISTINCT FROM NEW.reservation_id), 0)
    INTO v_committed;
  IF v_committed + v_quantity > q.quantity THEN
    RAISE EXCEPTION 'material_request_exceeded: fulfilling % would take the request past its % (% already reserved or issued)',
      v_quantity, q.quantity, v_committed USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.guard_material_request_fulfillment() FROM PUBLIC;

CREATE TRIGGER tg_material_request_fulfillments_guard BEFORE INSERT ON inv.material_request_fulfillments
  FOR EACH ROW EXECUTE FUNCTION inv.guard_material_request_fulfillment();

ALTER TABLE inv.material_request_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv.material_request_fulfillments FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_material_request_fulfillments_scope ON inv.material_request_fulfillments FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_material_request_fulfillments_scope ON inv.material_request_fulfillments FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
-- SELECT and INSERT only: a link is a fact about which act fulfilled which request.
GRANT SELECT, INSERT ON inv.material_request_fulfillments TO app_runtime;
GRANT SELECT ON inv.material_request_fulfillments TO app_readonly;

-- ----------------------------------------------------------------------------
-- 7. Operations (SECURITY INVOKER; app_runtime executes). Every operation that
--    can change a committed quantity locks the REQUIREMENT first, then the request,
--    then (inside the ledger primitives) the balance row — one order everywhere.
-- ----------------------------------------------------------------------------

-- True when an item requirement's item has no exact conversion into the unit.
CREATE OR REPLACE FUNCTION inv.material_unit_gap(p_tenant uuid, p_item uuid, p_uom uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_item IS NOT NULL AND p_uom IS NOT NULL
     AND inv.unit_conversion_factor(p_tenant, p_item,
           (SELECT i.uom_id FROM inv.item_master i WHERE i.tenant_id = p_tenant AND i.id = p_item), p_uom) IS NULL
$$;
REVOKE EXECUTE ON FUNCTION inv.material_unit_gap(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.material_unit_gap(uuid, uuid, uuid) TO app_runtime, app_readonly;

-- An ENTERED requirement: a known allowance with the source it was taken from.
CREATE OR REPLACE FUNCTION inv.propose_material_requirement(
  p_service_line uuid, p_item uuid, p_item_category uuid, p_allowance numeric, p_uom uuid, p_source_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_co uuid; v_br uuid; v_wo uuid; v_gap boolean; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.propose_material_requirement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_allowance IS NULL OR p_allowance <= 0 OR p_uom IS NULL THEN
    RAISE EXCEPTION 'an entered requirement needs a known positive allowance and its unit; an unknown quantity is derived from a specification'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_source_reference IS NULL OR btrim(p_source_reference) = '' THEN
    RAISE EXCEPTION 'an entered requirement needs the source its allowance was taken from' USING ERRCODE = 'check_violation';
  END IF;
  SELECT company_id, branch_id, work_order_id INTO v_co, v_br, v_wo FROM wo.work_order_service_lines
   WHERE tenant_id = v_tenant AND id = p_service_line AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'service line % not found', p_service_line USING ERRCODE = 'foreign_key_violation'; END IF;
  v_gap := inv.material_unit_gap(v_tenant, p_item, p_uom);
  INSERT INTO inv.material_requirements (
    tenant_id, company_id, branch_id, work_order_id, service_line_id, item_id, item_category_id, basis,
    allowance_quantity, uom_id, source_reference, status, approval_required_reason, requested_by, created_by)
    VALUES (v_tenant, v_co, v_br, v_wo, p_service_line, p_item, p_item_category, 'entered',
            p_allowance, p_uom, btrim(p_source_reference),
            CASE WHEN v_gap THEN 'approval_required' ELSE 'pending_approval' END,
            CASE WHEN v_gap THEN 'missing_unit_conversion' END, v_actor, v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.propose_material_requirement(uuid, uuid, uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.propose_material_requirement(uuid, uuid, uuid, numeric, uuid, text) TO app_runtime;

-- A requirement DERIVED from the confirmed specification for the work order's
-- vehicle. No specification is not a zero and not a guess: the row is stored as
-- approval_required / missing_specification with no allowance.
CREATE OR REPLACE FUNCTION inv.derive_material_requirement(
  p_service_line uuid, p_item uuid, p_item_category uuid, p_service_condition text, p_engine_variant text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_co uuid; v_br uuid; v_wo uuid; v_make uuid; v_model uuid; v_year integer;
        v_family uuid; s record; v_gap boolean; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.derive_material_requirement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT l.company_id, l.branch_id, l.work_order_id, v.make_id, v.model_id, v.model_year
    INTO v_co, v_br, v_wo, v_make, v_model, v_year
    FROM wo.work_order_service_lines l
    JOIN wo.work_orders w ON w.tenant_id = l.tenant_id AND w.company_id = l.company_id AND w.branch_id = l.branch_id AND w.id = l.work_order_id
    JOIN veh.vehicles v ON v.tenant_id = w.tenant_id AND v.id = w.vehicle_id
   WHERE l.tenant_id = v_tenant AND l.id = p_service_line AND l.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'service line % not found', p_service_line USING ERRCODE = 'foreign_key_violation'; END IF;
  v_family := COALESCE(p_item_category, (SELECT i.item_category_id FROM inv.item_master i WHERE i.tenant_id = v_tenant AND i.id = p_item));
  IF v_make IS NOT NULL THEN
    SELECT * INTO s FROM inv.resolve_vehicle_fluid_specification(
      v_tenant, v_make, v_model, v_year, NULLIF(btrim(p_engine_variant), ''), p_service_condition, v_family);
  END IF;
  IF s.specification_id IS NULL THEN
    INSERT INTO inv.material_requirements (
      tenant_id, company_id, branch_id, work_order_id, service_line_id, item_id, item_category_id, basis,
      service_condition, engine_variant, status, approval_required_reason, requested_by, created_by)
      VALUES (v_tenant, v_co, v_br, v_wo, p_service_line, p_item, p_item_category, 'specification',
              p_service_condition, NULLIF(btrim(p_engine_variant), ''), 'approval_required', 'missing_specification', v_actor, v_actor)
      RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  v_gap := inv.material_unit_gap(v_tenant, p_item, s.uom_id);
  INSERT INTO inv.material_requirements (
    tenant_id, company_id, branch_id, work_order_id, service_line_id, item_id, item_category_id, basis,
    specification_id, service_condition, engine_variant, allowance_quantity, uom_id, source_reference,
    status, approval_required_reason, requested_by, created_by)
    VALUES (v_tenant, v_co, v_br, v_wo, p_service_line, p_item, p_item_category, 'specification',
            s.specification_id, p_service_condition, NULLIF(btrim(p_engine_variant), ''), s.capacity, s.uom_id, s.source_reference,
            CASE WHEN v_gap THEN 'approval_required' ELSE 'pending_approval' END,
            CASE WHEN v_gap THEN 'missing_unit_conversion' END, v_actor, v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.derive_material_requirement(uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.derive_material_requirement(uuid, uuid, uuid, text, text) TO app_runtime;

-- Resolve an approval_required requirement with an ENTERED value and its source.
CREATE OR REPLACE FUNCTION inv.supply_material_requirement_basis(
  p_requirement uuid, p_allowance numeric, p_uom uuid, p_source_reference text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.material_requirements%ROWTYPE; v_gap boolean; v_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.supply_material_requirement_basis requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_allowance IS NULL OR p_allowance <= 0 OR p_uom IS NULL THEN
    RAISE EXCEPTION 'a supplied basis needs a known positive allowance and its unit' USING ERRCODE = 'check_violation';
  END IF;
  IF p_source_reference IS NULL OR btrim(p_source_reference) = '' THEN
    RAISE EXCEPTION 'a supplied basis needs the source its allowance was taken from' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status <> 'approval_required' THEN
    RAISE EXCEPTION 'material requirement is % (a basis is supplied only while approval is required)', r.status USING ERRCODE = 'check_violation';
  END IF;
  v_gap := inv.material_unit_gap(v_tenant, r.item_id, p_uom);
  v_status := CASE WHEN v_gap THEN 'approval_required' ELSE 'pending_approval' END;
  UPDATE inv.material_requirements
     SET basis = 'entered', specification_id = NULL, allowance_quantity = p_allowance, uom_id = p_uom,
         source_reference = btrim(p_source_reference), status = v_status,
         approval_required_reason = CASE WHEN v_gap THEN 'missing_unit_conversion' END
   WHERE tenant_id = v_tenant AND id = p_requirement;
  RETURN v_status;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.supply_material_requirement_basis(uuid, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.supply_material_requirement_basis(uuid, numeric, uuid, text) TO app_runtime;

-- Re-check an approval_required requirement after the missing fact was added: a
-- specification confirmed since, or a unit conversion stated since.
CREATE OR REPLACE FUNCTION inv.recheck_material_requirement(p_requirement uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.material_requirements%ROWTYPE;
        v_make uuid; v_model uuid; v_year integer; v_family uuid; s record; v_gap boolean;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.recheck_material_requirement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status <> 'approval_required' THEN RETURN r.status; END IF;

  IF r.approval_required_reason = 'missing_specification' THEN
    SELECT v.make_id, v.model_id, v.model_year INTO v_make, v_model, v_year
      FROM wo.work_orders w JOIN veh.vehicles v ON v.tenant_id = w.tenant_id AND v.id = w.vehicle_id
     WHERE w.tenant_id = v_tenant AND w.id = r.work_order_id;
    v_family := COALESCE(r.item_category_id, (SELECT i.item_category_id FROM inv.item_master i WHERE i.tenant_id = v_tenant AND i.id = r.item_id));
    IF v_make IS NOT NULL THEN
      SELECT * INTO s FROM inv.resolve_vehicle_fluid_specification(
        v_tenant, v_make, v_model, v_year, r.engine_variant, r.service_condition, v_family);
    END IF;
    IF s.specification_id IS NULL THEN RETURN 'approval_required'; END IF;
    v_gap := inv.material_unit_gap(v_tenant, r.item_id, s.uom_id);
    UPDATE inv.material_requirements
       SET specification_id = s.specification_id, allowance_quantity = s.capacity, uom_id = s.uom_id,
           source_reference = s.source_reference,
           status = CASE WHEN v_gap THEN 'approval_required' ELSE 'pending_approval' END,
           approval_required_reason = CASE WHEN v_gap THEN 'missing_unit_conversion' END
     WHERE tenant_id = v_tenant AND id = p_requirement;
    RETURN CASE WHEN v_gap THEN 'approval_required' ELSE 'pending_approval' END;
  END IF;

  IF inv.material_unit_gap(v_tenant, r.item_id, r.uom_id) THEN RETURN 'approval_required'; END IF;
  UPDATE inv.material_requirements SET status = 'pending_approval', approval_required_reason = NULL
   WHERE tenant_id = v_tenant AND id = p_requirement;
  RETURN 'pending_approval';
END; $$;
REVOKE EXECUTE ON FUNCTION inv.recheck_material_requirement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.recheck_material_requirement(uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.approve_material_requirement(p_requirement uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id(); r inv.material_requirements%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.approve_material_requirement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status = 'approval_required' THEN
    RAISE EXCEPTION 'material_approval_required: %: the requirement cannot be approved until it is resolved', r.approval_required_reason
      USING ERRCODE = 'check_violation';
  END IF;
  IF r.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'material requirement is % (must be pending_approval)', r.status USING ERRCODE = 'check_violation';
  END IF;
  IF r.requested_by = v_actor THEN
    RAISE EXCEPTION 'material_separation_of_duties: the requester may not approve their own requirement' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inv.material_requirements SET status = 'approved', approved_by = v_actor, approved_at = now()
   WHERE tenant_id = v_tenant AND id = p_requirement;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.approve_material_requirement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.approve_material_requirement(uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.reject_material_requirement(p_requirement uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id(); r inv.material_requirements%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.reject_material_requirement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a rejection requires a reason' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'material requirement is % (must be pending_approval)', r.status USING ERRCODE = 'check_violation';
  END IF;
  IF r.requested_by = v_actor THEN
    RAISE EXCEPTION 'material_separation_of_duties: the requester may not decide their own requirement' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inv.material_requirements SET status = 'rejected', rejected_by = v_actor, rejected_at = now(), rejection_reason = btrim(p_reason)
   WHERE tenant_id = v_tenant AND id = p_requirement;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.reject_material_requirement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.reject_material_requirement(uuid, text) TO app_runtime;

-- A requirement with an open request is not cancelled out from under it: the
-- request is closed first, which releases its reservations explicitly.
CREATE OR REPLACE FUNCTION inv.cancel_material_requirement(p_requirement uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.material_requirements%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.cancel_material_requirement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a cancellation requires a reason' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'material requirement is already %', r.status USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM inv.material_requests q WHERE q.tenant_id = v_tenant AND q.requirement_id = p_requirement AND q.status = 'open') THEN
    RAISE EXCEPTION 'material requirement has open requests; close them before cancelling it' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inv.material_requirements
     SET status = 'cancelled', cancelled_by = iam.current_user_id(), cancelled_at = now(), cancel_reason = btrim(p_reason),
         approval_required_reason = NULL
   WHERE tenant_id = v_tenant AND id = p_requirement;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.cancel_material_requirement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.cancel_material_requirement(uuid, text) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.request_material_exception(p_requirement uuid, p_additional numeric, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id(); r inv.material_requirements%ROWTYPE; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.request_material_exception requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_additional IS NULL OR p_additional <= 0 THEN
    RAISE EXCEPTION 'an exception states a finite positive additional quantity' USING ERRCODE = 'check_violation';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'an exception requires a reason' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  INSERT INTO inv.material_requirement_exceptions (
    tenant_id, company_id, branch_id, requirement_id, additional_quantity, reason, requested_by, created_by)
    VALUES (v_tenant, r.company_id, r.branch_id, p_requirement, p_additional, btrim(p_reason), v_actor, v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.request_material_exception(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.request_material_exception(uuid, numeric, text) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.decide_material_exception(p_exception uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_requirement uuid; e inv.material_requirement_exceptions%ROWTYPE; v_allowance numeric(12, 3); v_approved numeric; v_result numeric;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.decide_material_exception requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'a decision is approve or reject' USING ERRCODE = 'check_violation'; END IF;
  SELECT requirement_id INTO v_requirement FROM inv.material_requirement_exceptions WHERE tenant_id = v_tenant AND id = p_exception;
  IF NOT FOUND THEN RAISE EXCEPTION 'material exception % not found', p_exception USING ERRCODE = 'foreign_key_violation'; END IF;
  -- Requirement first, then the exception: the order every writer uses.
  SELECT allowance_quantity INTO v_allowance FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = v_requirement FOR UPDATE;
  SELECT * INTO e FROM inv.material_requirement_exceptions WHERE tenant_id = v_tenant AND id = p_exception FOR UPDATE;
  IF e.status <> 'pending' THEN RAISE EXCEPTION 'material exception is % (must be pending)', e.status USING ERRCODE = 'check_violation'; END IF;
  IF e.requested_by = v_actor THEN
    RAISE EXCEPTION 'material_separation_of_duties: the requester may not decide their own exception' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT p_approve THEN
    UPDATE inv.material_requirement_exceptions
       SET status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = NULLIF(btrim(p_note), '')
     WHERE tenant_id = v_tenant AND id = p_exception;
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(additional_quantity), 0) INTO v_approved FROM inv.material_requirement_exceptions
   WHERE tenant_id = v_tenant AND requirement_id = v_requirement AND status = 'approved';
  v_result := v_allowance + v_approved + e.additional_quantity;
  UPDATE inv.material_requirement_exceptions
     SET status = 'approved', decided_by = v_actor, decided_at = now(), decision_note = NULLIF(btrim(p_note), ''),
         resulting_allowance = v_result
   WHERE tenant_id = v_tenant AND id = p_exception;
  RETURN v_result;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.decide_material_exception(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.decide_material_exception(uuid, boolean, text) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.create_material_request(
  p_requirement uuid, p_item uuid, p_quantity numeric, p_idempotency_key text DEFAULT NULL, p_correlation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        r inv.material_requirements%ROWTYPE; v_item_uom uuid; v_factor numeric; v_existing uuid; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.create_material_request requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'a material request quantity must be positive' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  -- Idempotency resolved INSIDE the requirement lock, as inv.reserve_stock does.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM inv.material_requests WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  SELECT uom_id INTO v_item_uom FROM inv.item_master WHERE tenant_id = v_tenant AND id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'item % not found', p_item USING ERRCODE = 'foreign_key_violation'; END IF;
  v_factor := inv.unit_conversion_factor(v_tenant, p_item, v_item_uom, r.uom_id);
  IF v_factor IS NULL AND r.status = 'approved' THEN
    RAISE EXCEPTION 'material_approval_required: missing_unit_conversion: item % has no exact conversion into the requirement unit', p_item
      USING ERRCODE = 'check_violation';
  END IF;
  -- The ceiling guard refuses everything else — an unapproved requirement, an item
  -- the requirement does not cover, a quantity past the allowance — under the lock.
  INSERT INTO inv.material_requests (
    tenant_id, company_id, branch_id, requirement_id, work_order_id, item_id, quantity, requirement_unit_factor,
    requested_by, idempotency_key, correlation_id, created_by)
    VALUES (v_tenant, r.company_id, r.branch_id, p_requirement, r.work_order_id, p_item, p_quantity, COALESCE(v_factor, 1),
            v_actor, p_idempotency_key, p_correlation, v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.create_material_request(uuid, uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.create_material_request(uuid, uuid, numeric, text, uuid) TO app_runtime;

-- Lock the requirement, then the request, in that order, and return the request.
CREATE OR REPLACE FUNCTION inv.lock_material_request(p_tenant uuid, p_request uuid)
RETURNS inv.material_requests LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_requirement uuid; q inv.material_requests%ROWTYPE;
BEGIN
  SELECT requirement_id INTO v_requirement FROM inv.material_requests WHERE tenant_id = p_tenant AND id = p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'material request % not found', p_request USING ERRCODE = 'foreign_key_violation'; END IF;
  PERFORM 1 FROM inv.material_requirements WHERE tenant_id = p_tenant AND id = v_requirement FOR UPDATE;
  SELECT * INTO q FROM inv.material_requests WHERE tenant_id = p_tenant AND id = p_request FOR UPDATE;
  RETURN q;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.lock_material_request(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.lock_material_request(uuid, uuid) TO app_runtime;

CREATE OR REPLACE FUNCTION inv.reserve_material_request(
  p_request uuid, p_location uuid, p_quantity numeric, p_idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); q inv.material_requests%ROWTYPE; v_reservation uuid; v_linked uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.reserve_material_request requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  q := inv.lock_material_request(v_tenant, p_request);
  IF q.status <> 'open' THEN RAISE EXCEPTION 'material request is % (must be open)', q.status USING ERRCODE = 'check_violation'; END IF;
  v_reservation := inv.reserve_stock(q.item_id, p_location, p_quantity, q.work_order_id, p_idempotency_key, NULL, q.correlation_id);
  SELECT material_request_id INTO v_linked FROM inv.material_request_fulfillments WHERE tenant_id = v_tenant AND reservation_id = v_reservation;
  IF FOUND THEN
    IF v_linked <> p_request THEN
      RAISE EXCEPTION 'this idempotency key already reserved stock for another material request' USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_reservation;
  END IF;
  INSERT INTO inv.material_request_fulfillments (tenant_id, company_id, branch_id, material_request_id, fulfillment_kind, reservation_id, created_by)
    VALUES (v_tenant, q.company_id, q.branch_id, p_request, 'reservation', v_reservation, iam.current_user_id());
  RETURN v_reservation;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.reserve_material_request(uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.reserve_material_request(uuid, uuid, numeric, text) TO app_runtime;

-- Issue against a request. When a reservation is named it must be this request's
-- own active reservation at the same cell; the issue consumes it, so the units move
-- from `reserved` to `issued` and are never counted in both.
CREATE OR REPLACE FUNCTION inv.issue_material_request(
  p_request uuid, p_location uuid, p_quantity numeric, p_reservation uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); q inv.material_requests%ROWTYPE; v_issue uuid;
        v_res_location uuid; v_res_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.issue_material_request requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'an issue quantity must be positive' USING ERRCODE = 'check_violation'; END IF;
  q := inv.lock_material_request(v_tenant, p_request);
  IF q.status <> 'open' THEN RAISE EXCEPTION 'material request is % (must be open)', q.status USING ERRCODE = 'check_violation'; END IF;
  IF p_reservation IS NOT NULL THEN
    SELECT sr.location_id, sr.status INTO v_res_location, v_res_status
      FROM inv.material_request_fulfillments f
      JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
     WHERE f.tenant_id = v_tenant AND f.material_request_id = p_request AND f.reservation_id = p_reservation;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reservation % does not belong to this material request', p_reservation USING ERRCODE = 'check_violation';
    END IF;
    IF v_res_status <> 'active' OR v_res_location <> p_location THEN
      RAISE EXCEPTION 'reservation % is not active at the issuing location', p_reservation USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  v_issue := inv.issue_part(q.work_order_id, q.item_id, p_location, p_quantity, p_reservation, NULL, q.correlation_id);
  INSERT INTO inv.material_request_fulfillments (tenant_id, company_id, branch_id, material_request_id, fulfillment_kind, part_issue_id, created_by)
    VALUES (v_tenant, q.company_id, q.branch_id, p_request, 'issue', v_issue, iam.current_user_id());
  RETURN v_issue;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.issue_material_request(uuid, uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.issue_material_request(uuid, uuid, numeric, uuid) TO app_runtime;

-- Close (after issuing) or cancel (nothing issued): both release the request's
-- active reservations EXPLICITLY, so its unfulfilled remainder stops counting
-- against the allowance by an act, not by a filter.
CREATE OR REPLACE FUNCTION inv.finish_material_request(p_request uuid, p_outcome text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id(); q inv.material_requests%ROWTYPE; res RECORD;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.finish_material_request requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'a material request is finished as closed or cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF p_outcome = 'cancelled' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'a cancellation requires a reason' USING ERRCODE = 'check_violation';
  END IF;
  q := inv.lock_material_request(v_tenant, p_request);
  IF q.status <> 'open' THEN RAISE EXCEPTION 'material request is % (must be open)', q.status USING ERRCODE = 'check_violation'; END IF;
  FOR res IN
    SELECT f.reservation_id FROM inv.material_request_fulfillments f
      JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
     WHERE f.tenant_id = v_tenant AND f.material_request_id = p_request AND sr.status = 'active'
     ORDER BY sr.item_id, sr.location_id, sr.id
  LOOP
    PERFORM inv.release_reservation(res.reservation_id, 'material request ' || p_outcome);
  END LOOP;
  IF p_outcome = 'closed' THEN
    UPDATE inv.material_requests SET status = 'closed', closed_by = v_actor, closed_at = now(), close_reason = NULLIF(btrim(p_reason), '')
     WHERE tenant_id = v_tenant AND id = p_request;
  ELSE
    UPDATE inv.material_requests SET status = 'cancelled', cancelled_by = v_actor, cancelled_at = now(), cancel_reason = btrim(p_reason)
     WHERE tenant_id = v_tenant AND id = p_request;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION inv.finish_material_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.finish_material_request(uuid, text, text) TO app_runtime;
