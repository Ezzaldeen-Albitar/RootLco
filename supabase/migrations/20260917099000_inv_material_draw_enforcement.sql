-- ============================================================================
-- Phase: 1-32 (preparatory) — material demand control, slice 3c
-- Migration: every work-order draw is governed by an approved requirement, in the
--            database; issue ordering; derivation for a vehicle with no make;
--            soft-deleted returns and ended reservations in the usage
-- Tasks: P1-32-PRE-132
-- Owner module: inv
--
-- Rollback classification: ROLL-FORWARD-ONLY once a governed draw has been made
--   under these rules: its fulfillment links are ledger facts. ROLLBACK-SAFE on a
--   database holding no reservation or part issue. No down script.
--
-- Purpose
--   Slice 3a added approved material requirements and measured a MATERIAL REQUEST
--   against them under the requirement lock — but `inv.reserve_stock`,
--   `inv.issue_part` and a direct INSERT into `inv.stock_reservations` or
--   `inv.part_issues` still took stock for a work order with no requirement at all,
--   so the absence of a requirement meant an unlimited draw. This migration closes
--   that, and four defects found in the slice-3a/3b verification:
--
--     * A WORK-ORDER DRAW NEEDS A MATERIAL REQUEST. Every INSERT into
--       `inv.stock_reservations` that names a work order, and every INSERT into
--       `inv.part_issues` (which always does), is linked AT INSERT to the material
--       request named by the transaction-local setting `inv.material_request_id`
--       (`inv.govern_work_order_draw`). With no request named the row is refused
--       with `material_approval_required: no_requirement`. The link goes through
--       `inv.guard_material_request_fulfillment`, which now locks the REQUIREMENT,
--       then the request, refuses a requirement that is not `approved`, and bounds
--       the link by the request's own quantity — and the request was itself bounded
--       by the approved allowance plus approved exceptions when it was created
--       (`inv.guard_material_request_ceiling`). So a draw with no approved covering
--       requirement cannot be written by the function, by the primitive, or by a
--       raw INSERT. `inv.reserve_material_request` and `inv.issue_material_request`
--       are the path: they name their own request for the duration of the call and
--       clear it after. Counter sales and reservations with no work order are
--       outside this rule, as before.
--
--       The setting is a NAME, not an authority: a caller who sets it by hand still
--       passes every check above, so the worst it can do is make a draw that is
--       governed and counted.
--
--     * `inv.issue_part` CONSUMES THE RESERVATION BEFORE STOCK LEAVES (P1-21-D-01).
--       It posted the `out` movement first, so `on_hand` fell while `reserved` still
--       held the same units and `ck_stock_balances_available` refused every issue of
--       exactly what was reserved. The issue row, then the reservation, then the
--       movement — the order the application had been performing by hand.
--
--     * `inv.derive_material_requirement` AND `inv.recheck_material_requirement`
--       answered a vehicle with no make with `record "s" is not assigned yet`: the
--       resolution record was read on a branch that never assigned it. Both now read
--       the resolution into scalars, so a vehicle no specification can answer for is
--       stored (derive) or kept (recheck) as `approval_required` /
--       `missing_specification`.
--
--     * A SOFT-DELETED PART RETURN GIVES NOTHING BACK. `inv.material_requirement_usage`
--       counted every `inv.part_returns` row; it now counts only live ones.
--
--     * AN EXPIRED RESERVATION GIVES ITS ALLOWANCE BACK LIKE A RELEASE. The usage
--       counted a request's remainder as `quantity - issued - ACTIVE reserved`, so
--       when a linked reservation expired its units came back as an open request
--       remainder and stayed committed. A linked reservation that ended `released`
--       or `expired` now spends that part of its request: it stops counting against
--       the allowance, and the request cannot reserve or issue those units again.
--
--     * A REQUIREMENT WITH COMMITTED QUANTITY IS NOT CANCELLED.
--       `inv.cancel_material_requirement` refused only open requests; it now also
--       refuses while anything is reserved, issued and not returned, or requested
--       against it (`material_requirement_committed`).
--
--   `inv.reserve_material_request` gains the reservation expiry `inv.reserve_stock`
--   already accepts, so a governed reservation can expire like any other, and
--   `inv.issue_material_request` gains the required-part reference `inv.issue_part`
--   already records. Both old forms are dropped rather than overloaded, because a
--   call with the old argument count would otherwise be ambiguous between the two.
--
-- Dependencies
--   inv.stock_reservations, inv.reserve_stock, inv.consume_reservation,
--   inv.post_stock_movement (20260723094000); inv.part_issues, inv.part_returns,
--   inv.issue_part (20260723095000); inv.sales_returns (20260917094000);
--   inv.resolve_vehicle_fluid_specification (20260917096000); inv.material_requirements,
--   inv.material_requests, inv.material_request_fulfillments and their functions
--   (20260917097000).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. inv.issue_part — reservation consumed before the movement (P1-21-D-01).
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
  -- The reservation is consumed FIRST, so `reserved` falls before `on_hand` does and
  -- `ck_stock_balances_available` never sees the same units counted twice.
  IF p_reservation IS NOT NULL THEN PERFORM inv.consume_reservation(p_reservation); END IF;
  PERFORM inv.post_stock_movement(p_item, p_location, 'issue', 'out', p_qty, 'part_issue', v_issue, p_correlation);
  RETURN v_issue;
END; $$;
COMMENT ON FUNCTION inv.issue_part(uuid, uuid, uuid, numeric, uuid, uuid, uuid) IS 'Issues stock to a work order: the part issue row, then the reservation it consumes, then the out movement (P1-21-D-01). The issue row is refused unless the transaction names a material request on an approved requirement (inv.govern_work_order_draw); call inv.issue_material_request.';

-- ----------------------------------------------------------------------------
-- 2. The fulfillment guard — requirement lock, approved requirement, ended
--    reservations spent, an issue's own reservation not counted twice.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.guard_material_request_fulfillment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q inv.material_requests%ROWTYPE; v_requirement uuid; v_requirement_status text;
        v_item uuid; v_work_order uuid; v_quantity numeric(12, 3); v_status text; v_consumes uuid;
        v_consumed_by uuid; v_committed numeric;
BEGIN
  SELECT requirement_id INTO v_requirement FROM inv.material_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.material_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv.material_request_fulfillments: material request % not found', NEW.material_request_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- Requirement first, then the request: the order every material writer uses.
  SELECT status INTO v_requirement_status FROM inv.material_requirements
   WHERE tenant_id = NEW.tenant_id AND id = v_requirement FOR UPDATE;
  SELECT * INTO q FROM inv.material_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.material_request_id FOR UPDATE;
  IF q.status <> 'open' THEN
    RAISE EXCEPTION 'inv.material_request_fulfillments: material request is % and takes no further fulfillment', q.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_requirement_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'material_approval_required: requirement % is % and allows no draw', v_requirement, v_requirement_status
      USING ERRCODE = 'check_violation';
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
    SELECT item_id, work_order_id, quantity, reservation_id INTO v_item, v_work_order, v_quantity, v_consumes
      FROM inv.part_issues WHERE tenant_id = NEW.tenant_id AND id = NEW.part_issue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inv.material_request_fulfillments: part issue % not found', NEW.part_issue_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- An issue that consumes a reservation fulfills the request that reservation
    -- was drawn on, or no request at all: never a second one for the same units.
    IF v_consumes IS NOT NULL THEN
      SELECT material_request_id INTO v_consumed_by FROM inv.material_request_fulfillments
       WHERE tenant_id = NEW.tenant_id AND reservation_id = v_consumes;
      IF FOUND AND v_consumed_by <> NEW.material_request_id THEN
        RAISE EXCEPTION 'inv.material_request_fulfillments: the consumed reservation fulfills another material request'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF v_item <> q.item_id OR v_work_order IS DISTINCT FROM q.work_order_id THEN
    RAISE EXCEPTION 'inv.material_request_fulfillments: the fulfillment is for another item or work order than the request' USING ERRCODE = 'check_violation';
  END IF;
  -- What the request has already spent: its issues, its active reservations (less
  -- the one this link names, and the one this issue consumes), and every linked
  -- reservation that ended released or expired — those units went back to the
  -- allowance and are not the request's to draw again.
  SELECT COALESCE((SELECT sum(pi.quantity) FROM inv.material_request_fulfillments f
                     JOIN inv.part_issues pi ON pi.tenant_id = f.tenant_id AND pi.id = f.part_issue_id
                    WHERE f.tenant_id = NEW.tenant_id AND f.material_request_id = q.id AND f.fulfillment_kind = 'issue'), 0)
       + COALESCE((SELECT sum(sr.quantity) FROM inv.material_request_fulfillments f
                     JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
                    WHERE f.tenant_id = NEW.tenant_id AND f.material_request_id = q.id AND f.fulfillment_kind = 'reservation'
                      AND sr.status IN ('active', 'released', 'expired')
                      AND sr.id IS DISTINCT FROM NEW.reservation_id
                      AND sr.id IS DISTINCT FROM v_consumes), 0)
    INTO v_committed;
  IF v_committed + v_quantity > q.quantity THEN
    RAISE EXCEPTION 'material_request_exceeded: fulfilling % would take the request past its % (% already reserved or issued)',
      v_quantity, q.quantity, v_committed USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION inv.guard_material_request_fulfillment() IS 'Locks the requirement then the request, refuses a requirement that is not approved or a request that is not open, and bounds the link by the request quantity: issues, active reservations, and linked reservations that ended released or expired all spend it.';

-- ----------------------------------------------------------------------------
-- 3. inv.govern_work_order_draw — no work-order draw without a material request.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.govern_work_order_draw()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_request text := NULLIF(pg_catalog.current_setting('inv.material_request_id', true), '');
BEGIN
  IF v_request IS NULL THEN
    RAISE EXCEPTION 'material_approval_required: no_requirement: a % for work order % draws only on a material request against an approved requirement covering the item',
      CASE TG_TABLE_NAME WHEN 'stock_reservations' THEN 'reservation' ELSE 'part issue' END, NEW.work_order_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'stock_reservations' THEN
    INSERT INTO inv.material_request_fulfillments (tenant_id, company_id, branch_id, material_request_id, fulfillment_kind, reservation_id, created_by)
      VALUES (NEW.tenant_id, NEW.company_id, NEW.branch_id, v_request::uuid, 'reservation', NEW.id, NEW.created_by);
  ELSE
    INSERT INTO inv.material_request_fulfillments (tenant_id, company_id, branch_id, material_request_id, fulfillment_kind, part_issue_id, created_by)
      VALUES (NEW.tenant_id, NEW.company_id, NEW.branch_id, v_request::uuid, 'issue', NEW.id, NEW.created_by);
  END IF;
  RETURN NULL;
END; $$;
COMMENT ON FUNCTION inv.govern_work_order_draw() IS 'AFTER INSERT on inv.stock_reservations (with a work order) and inv.part_issues: links the row to the material request named by the transaction-local setting inv.material_request_id through inv.guard_material_request_fulfillment, or refuses it with material_approval_required: no_requirement. A work-order draw is never unlimited.';
REVOKE EXECUTE ON FUNCTION inv.govern_work_order_draw() FROM PUBLIC;

CREATE TRIGGER tg_stock_reservations_material_draw AFTER INSERT ON inv.stock_reservations
  FOR EACH ROW WHEN (NEW.work_order_id IS NOT NULL) EXECUTE FUNCTION inv.govern_work_order_draw();
CREATE TRIGGER tg_part_issues_material_draw AFTER INSERT ON inv.part_issues
  FOR EACH ROW WHEN (NEW.work_order_id IS NOT NULL) EXECUTE FUNCTION inv.govern_work_order_draw();

-- ----------------------------------------------------------------------------
-- 4. The governed draw functions.
-- ----------------------------------------------------------------------------
DROP FUNCTION inv.reserve_material_request(uuid, uuid, numeric, text);

CREATE OR REPLACE FUNCTION inv.reserve_material_request(
  p_request uuid, p_location uuid, p_quantity numeric, p_idempotency_key text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); q inv.material_requests%ROWTYPE; v_reservation uuid; v_linked uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.reserve_material_request requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  q := inv.lock_material_request(v_tenant, p_request);
  IF q.status <> 'open' THEN RAISE EXCEPTION 'material request is % (must be open)', q.status USING ERRCODE = 'check_violation'; END IF;
  -- The reservation row is linked to this request as it is inserted.
  PERFORM pg_catalog.set_config('inv.material_request_id', p_request::text, true);
  v_reservation := inv.reserve_stock(q.item_id, p_location, p_quantity, q.work_order_id, p_idempotency_key, p_expires_at, q.correlation_id);
  PERFORM pg_catalog.set_config('inv.material_request_id', '', true);
  SELECT material_request_id INTO v_linked FROM inv.material_request_fulfillments WHERE tenant_id = v_tenant AND reservation_id = v_reservation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this idempotency key already reserved stock that no material request governs' USING ERRCODE = 'check_violation';
  END IF;
  IF v_linked <> p_request THEN
    RAISE EXCEPTION 'this idempotency key already reserved stock for another material request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_reservation;
END; $$;
COMMENT ON FUNCTION inv.reserve_material_request(uuid, uuid, numeric, text, timestamptz) IS 'Reserves stock for an open material request, linked at insert under the requirement then request lock. A replayed idempotency key returns the reservation only when it already fulfills this request.';
REVOKE EXECUTE ON FUNCTION inv.reserve_material_request(uuid, uuid, numeric, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.reserve_material_request(uuid, uuid, numeric, text, timestamptz) TO app_runtime;

DROP FUNCTION inv.issue_material_request(uuid, uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION inv.issue_material_request(
  p_request uuid, p_location uuid, p_quantity numeric, p_reservation uuid DEFAULT NULL, p_required_part_ref uuid DEFAULT NULL)
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
  -- The part issue row is linked to this request as it is inserted.
  PERFORM pg_catalog.set_config('inv.material_request_id', p_request::text, true);
  v_issue := inv.issue_part(q.work_order_id, q.item_id, p_location, p_quantity, p_reservation, p_required_part_ref, q.correlation_id);
  PERFORM pg_catalog.set_config('inv.material_request_id', '', true);
  RETURN v_issue;
END; $$;
COMMENT ON FUNCTION inv.issue_material_request(uuid, uuid, numeric, uuid, uuid) IS 'Issues stock for an open material request, optionally consuming its own active reservation at the same cell and citing the required-part line it satisfies; the issue is linked at insert under the requirement then request lock.';
REVOKE EXECUTE ON FUNCTION inv.issue_material_request(uuid, uuid, numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inv.issue_material_request(uuid, uuid, numeric, uuid, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 5. Usage — live returns only; ended reservations spend their request.
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
           COALESCE((SELECT sum(sr.quantity)
                       FROM inv.material_request_fulfillments f
                       JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
                      WHERE f.tenant_id = p_tenant AND f.material_request_id = q.id AND f.fulfillment_kind = 'reservation'
                        AND sr.status IN ('released', 'expired')), 0) AS ended,
           COALESCE((SELECT sum(pr.quantity)
                       FROM inv.material_request_fulfillments f
                       JOIN inv.part_returns pr ON pr.tenant_id = f.tenant_id AND pr.part_issue_id = f.part_issue_id
                      WHERE f.tenant_id = p_tenant AND f.material_request_id = q.id AND f.fulfillment_kind = 'issue'
                        AND pr.deleted_at IS NULL), 0)
         + COALESCE((SELECT sum(sret.quantity)
                       FROM inv.material_request_fulfillments f
                       JOIN inv.sales_returns sret ON sret.tenant_id = f.tenant_id AND sret.source_kind = 'part_issue'
                                                  AND sret.source_id = f.part_issue_id
                      WHERE f.tenant_id = p_tenant AND f.material_request_id = q.id AND f.fulfillment_kind = 'issue'
                        AND sret.return_condition = 'restockable'), 0) AS returned
      FROM inv.material_requests q
     WHERE q.tenant_id = p_tenant AND q.requirement_id = p_requirement
  ), totals AS (
    SELECT COALESCE(sum(CASE WHEN status = 'open' THEN GREATEST(quantity - issued - reserved - ended, 0) ELSE 0 END * factor), 0) AS open_q,
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
COMMENT ON FUNCTION inv.material_requirement_usage(uuid, uuid) IS 'The committed quantity of a requirement in its own unit: open request remainders (less what was issued, is reserved, or was reserved and then released or expired) + active linked reservations + linked issues - live restockable returns of those issues, each unit counted once. Advisory when read; binding when read by inv.guard_material_request_ceiling under the requirement lock.';

-- ----------------------------------------------------------------------------
-- 6. Derivation and re-check for a vehicle with no make.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.derive_material_requirement(
  p_service_line uuid, p_item uuid, p_item_category uuid, p_service_condition text, p_engine_variant text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_actor uuid := iam.current_user_id();
        v_co uuid; v_br uuid; v_wo uuid; v_make uuid; v_model uuid; v_year integer; v_family uuid;
        v_spec uuid; v_capacity numeric; v_uom uuid; v_source text; v_gap boolean; v_id uuid;
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
  -- A specification is keyed on a make: a vehicle with none resolves nothing.
  IF v_make IS NOT NULL THEN
    SELECT s.specification_id, s.capacity, s.uom_id, s.source_reference INTO v_spec, v_capacity, v_uom, v_source
      FROM inv.resolve_vehicle_fluid_specification(
             v_tenant, v_make, v_model, v_year, NULLIF(btrim(p_engine_variant), ''), p_service_condition, v_family) s;
  END IF;
  IF v_spec IS NULL THEN
    INSERT INTO inv.material_requirements (
      tenant_id, company_id, branch_id, work_order_id, service_line_id, item_id, item_category_id, basis,
      service_condition, engine_variant, status, approval_required_reason, requested_by, created_by)
      VALUES (v_tenant, v_co, v_br, v_wo, p_service_line, p_item, p_item_category, 'specification',
              p_service_condition, NULLIF(btrim(p_engine_variant), ''), 'approval_required', 'missing_specification', v_actor, v_actor)
      RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  v_gap := inv.material_unit_gap(v_tenant, p_item, v_uom);
  INSERT INTO inv.material_requirements (
    tenant_id, company_id, branch_id, work_order_id, service_line_id, item_id, item_category_id, basis,
    specification_id, service_condition, engine_variant, allowance_quantity, uom_id, source_reference,
    status, approval_required_reason, requested_by, created_by)
    VALUES (v_tenant, v_co, v_br, v_wo, p_service_line, p_item, p_item_category, 'specification',
            v_spec, p_service_condition, NULLIF(btrim(p_engine_variant), ''), v_capacity, v_uom, v_source,
            CASE WHEN v_gap THEN 'approval_required' ELSE 'pending_approval' END,
            CASE WHEN v_gap THEN 'missing_unit_conversion' END, v_actor, v_actor)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION inv.recheck_material_requirement(p_requirement uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.material_requirements%ROWTYPE;
        v_make uuid; v_model uuid; v_year integer; v_family uuid;
        v_spec uuid; v_capacity numeric; v_uom uuid; v_source text; v_gap boolean;
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
      SELECT s.specification_id, s.capacity, s.uom_id, s.source_reference INTO v_spec, v_capacity, v_uom, v_source
        FROM inv.resolve_vehicle_fluid_specification(
               v_tenant, v_make, v_model, v_year, r.engine_variant, r.service_condition, v_family) s;
    END IF;
    IF v_spec IS NULL THEN RETURN 'approval_required'; END IF;
    v_gap := inv.material_unit_gap(v_tenant, r.item_id, v_uom);
    UPDATE inv.material_requirements
       SET specification_id = v_spec, allowance_quantity = v_capacity, uom_id = v_uom,
           source_reference = v_source,
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

-- ----------------------------------------------------------------------------
-- 7. Cancellation refuses a requirement with committed quantity.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inv.cancel_material_requirement(p_requirement uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); r inv.material_requirements%ROWTYPE; v_committed numeric;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inv.cancel_material_requirement requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a cancellation requires a reason' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO r FROM inv.material_requirements WHERE tenant_id = v_tenant AND id = p_requirement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'material requirement % not found', p_requirement USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'material requirement is already %', r.status USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM inv.material_requests q WHERE q.tenant_id = v_tenant AND q.requirement_id = p_requirement AND q.status = 'open') THEN
    RAISE EXCEPTION 'material_requirement_committed: the requirement has open requests; close or cancel them before cancelling it'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT u.committed_quantity INTO v_committed FROM inv.material_requirement_usage(v_tenant, p_requirement) u;
  IF COALESCE(v_committed, 0) > 0 THEN
    RAISE EXCEPTION 'material_requirement_committed: % is still reserved or issued and not returned against the requirement', v_committed
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inv.material_requirements
     SET status = 'cancelled', cancelled_by = iam.current_user_id(), cancelled_at = now(), cancel_reason = btrim(p_reason),
         approval_required_reason = NULL
   WHERE tenant_id = v_tenant AND id = p_requirement;
END; $$;
COMMENT ON FUNCTION inv.cancel_material_requirement(uuid, text) IS 'Cancels a requirement with a reason. Refused while it has an open request or any committed quantity (material_requirement_committed): what was drawn on it stays accounted to it.';
