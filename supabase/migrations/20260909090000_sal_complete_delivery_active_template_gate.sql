-- ============================================================================
-- Phase: 1-31 — Backend prerequisite lane (P-9b)
-- Migration: sal.complete_delivery honours ACTIVE, non-deleted checklist templates
-- Owner module: sal
-- Related: 20260724094000_sal_delivery.sql (the original definition, lines 426-471)
--          docs/phase-1/phase-1-31/delivery-checklist-template-seam.md (the finding)
--          docs/phase-1/phase-1-31/change-control-2026-09-08.md (CC-14, closed here)
--
-- Rollback classification: ROLLBACK-SAFE. One CREATE OR REPLACE FUNCTION with an
--   IDENTICAL signature and nothing else — no table, no column, no policy, no
--   trigger, no index, no row, and no grant that was not already there. A later
--   forward migration re-issuing the previous body returns sal.complete_delivery
--   to exactly what 20260724094000 left it, and no state is lost by doing so:
--   the change narrows a COUNT inside a gate and writes nothing. (Forward-only
--   still applies: nothing is ever corrected by editing a merged file — see
--   docs/database/migration-standard.md §4.)
--
-- ## The hole this closes
--
-- `sal.delivery_checklist_templates` carries a lifecycle — `status` is
-- NOT NULL CHECK IN ('active', 'inactive') and the row soft-deletes through
-- `deleted_at` — and until now the completion gate could not see either column.
--
-- The mandatory-item count in `sal.complete_delivery` reads
-- `sal.delivery_checklist_template_items` alone, filtered by (tenant, company),
-- `is_mandatory`, and the ITEM's own `deleted_at`. It never joins the parent
-- template. So:
--
--   * Deactivating a template withdraws NOTHING from the gate. Every mandatory
--     item under it keeps blocking every handover in the company, and the
--     operator who retired the template has no way to tell from the template
--     surface that it is still load-bearing.
--   * Soft-deleting a template is worse: the row disappears from every read
--     (`uq_delivery_checklist_templates_code` is partial on `deleted_at IS NULL`,
--     and the detail read filters it out), while its items go on refusing
--     completions from behind a template nobody can list, open or reactivate.
--
-- The only remedy the deployed behaviour offered was withdrawing each ITEM one
-- at a time, which is why the item-removal route exists. That makes template
-- status decorative on the one surface where it has to mean something: whether
-- the checklist is in force.
--
-- The P1-31 delivery checklist template seam proved this on real rows authored
-- through the published routes and recorded it as a finding rather than fixing
-- it, because correcting the gate is a change to a protected function and
-- therefore a migration. This is that migration. The Owner approved P-9b on
-- 2026-09-09, and it closes CC-14, whose recorded disposition was exactly "a
-- later `sal` migration slice".
--
-- ## What changed
--
-- The `v_missing` count, and only the `v_missing` count. It now joins
-- `sal.delivery_checklist_templates t` on the scoped unique key
-- `uq_delivery_checklist_templates_scope_id (tenant_id, company_id, id)` — the
-- constraint that exists to be joined against, so the join cannot cross a tenant
-- or a company — and admits an item only when its template is `status = 'active'`
-- AND `t.deleted_at IS NULL`.
--
-- An INNER JOIN is correct rather than a LEFT JOIN with a null-tolerant
-- predicate: `fk_delivery_checklist_template_items_template` makes
-- `(tenant_id, company_id, template_id)` a mandatory reference, so an item
-- without a template does not exist and a LEFT JOIN would only be describing an
-- impossible row.
--
-- ## What is preserved, verbatim
--
-- Everything else in the function is character-for-character the text migration
-- 20260724094000 established, and each preserved element is load-bearing:
--
--   * The signature (uuid, numeric, text, uuid), RETURNS uuid, LANGUAGE plpgsql,
--     VOLATILE, SECURITY INVOKER, SET search_path = ''. SECURITY INVOKER is what
--     keeps every RLS policy in force for the caller; the replay check hard-fails
--     a SECURITY DEFINER function, and the identical signature is what keeps this
--     a REPLACEMENT rather than a second overload.
--   * `SELECT ... FOR UPDATE` on the delivery row, scoped by
--     `iam.current_tenant_id()` — the lock and the tenant boundary.
--   * The idempotent early return on `status = 'delivered'` (C1), which returns
--     the odometer reading already captured rather than capturing a second one.
--   * The authorized-receiver gate, and the receiver it resolves, which is then
--     written as `receiving_partner_id` on the custody release.
--   * The signature gate.
--   * The odometer INSERT into veh.odometer_readings.
--   * The flip to `delivered` BEFORE the custody release, so the rec custody
--     guard sees a delivered record.
--   * The custody-release row and the delivery status-history row.
--   * The results arm of the checklist gate: `outcome IN ('passed', 'waived')`
--     AND `r.deleted_at IS NULL`, scoped by tenant, company, branch, delivery and
--     item. A soft-deleted result still stops satisfying its item.
--   * The ITEM's own `ti.deleted_at IS NULL` filter. A withdrawn item is still
--     withdrawn; the template join ADDS a condition and removes none.
--   * The COMPANY-wide scan across all templates. `sal.delivery_records` carries
--     no `template_id`, so there is no applicable template to resolve, and
--     narrowing the scan to one template is not a decision this migration is
--     entitled to make. What changes is which templates count as in force.
--   * ERRCODE `check_violation` (23514) and the message shape, so every caller
--     that maps the refusal keeps mapping it.
--   * The REVOKE from PUBLIC and the GRANT to app_runtime, re-issued because
--     CREATE OR REPLACE preserves privileges and re-stating them keeps this file
--     a complete account of the function's access.
--
-- The application mirror (`mandatoryChecklistGaps` in
-- apps/api/src/modules/delivery/data/delivery-repository.ts) moves in the SAME
-- commit and gains the SAME join. That rule has not changed either: the mirror
-- must never be better than the primitive, or the eligibility read reports a
-- delivery eligible that the primitive then refuses.
-- ============================================================================

CREATE OR REPLACE FUNCTION sal.complete_delivery(
  p_delivery_id uuid, p_final_odometer_value numeric, p_odometer_unit text DEFAULT 'km',
  p_correlation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_del sal.delivery_records%ROWTYPE; v_actor uuid := iam.current_user_id();
  v_odo uuid; v_last_state text; v_missing int; v_receiver uuid;
BEGIN
  SELECT * INTO v_del FROM sal.delivery_records WHERE id = p_delivery_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.complete_delivery: delivery % not found in scope', p_delivery_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_del.status = 'delivered' THEN RETURN v_del.final_odometer_reading_id; END IF; -- idempotent (C1)
  -- Gate: authorized receiver verified.
  SELECT receiver_partner_id INTO v_receiver FROM sal.authorized_receivers
    WHERE tenant_id = v_del.tenant_id AND company_id = v_del.company_id AND branch_id = v_del.branch_id AND delivery_record_id = v_del.id;
  IF v_receiver IS NULL THEN RAISE EXCEPTION 'sal.complete_delivery: no verified authorized receiver' USING ERRCODE = 'check_violation'; END IF;
  -- Gate: every mandatory checklist item of an ACTIVE, non-deleted template passed or waived.
  SELECT count(*)::int INTO v_missing FROM sal.delivery_checklist_template_items ti
    JOIN sal.delivery_checklist_templates t
      ON t.tenant_id = ti.tenant_id AND t.company_id = ti.company_id AND t.id = ti.template_id
    WHERE ti.tenant_id = v_del.tenant_id AND ti.company_id = v_del.company_id AND ti.is_mandatory AND ti.deleted_at IS NULL
      AND t.status = 'active' AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM sal.delivery_checklist_results r
        WHERE r.tenant_id = v_del.tenant_id AND r.company_id = v_del.company_id AND r.branch_id = v_del.branch_id
          AND r.delivery_record_id = v_del.id AND r.template_item_id = ti.id AND r.outcome IN ('passed', 'waived') AND r.deleted_at IS NULL);
  IF v_missing > 0 THEN RAISE EXCEPTION 'sal.complete_delivery: % mandatory checklist item(s) not passed/waived', v_missing USING ERRCODE = 'check_violation'; END IF;
  -- Gate: at least one signature.
  IF NOT EXISTS (SELECT 1 FROM sal.delivery_signatures s WHERE s.tenant_id = v_del.tenant_id
    AND s.company_id = v_del.company_id AND s.branch_id = v_del.branch_id AND s.delivery_record_id = v_del.id) THEN
    RAISE EXCEPTION 'sal.complete_delivery: a delivery signature is required' USING ERRCODE = 'check_violation';
  END IF;
  -- Capture the final odometer reading (guard_odometer_reading enforces coherence).
  INSERT INTO veh.odometer_readings (tenant_id, vehicle_id, value, unit, observed_at, capture_method, recorded_by)
    VALUES (v_del.tenant_id, v_del.vehicle_id, p_final_odometer_value, p_odometer_unit, now(), 'delivery', v_actor)
    RETURNING id INTO v_odo;
  -- Flip to delivered FIRST so the custody release guard sees a delivered record.
  UPDATE sal.delivery_records SET status = 'delivered', delivered_at = now(), final_odometer_reading_id = v_odo WHERE id = v_del.id;
  -- Write the custody release row once (uq_custody_history_released + rec guard enforce once + gated).
  SELECT to_state INTO v_last_state FROM rec.custody_history
    WHERE tenant_id = v_del.tenant_id AND company_id = v_del.company_id AND branch_id = v_del.branch_id
      AND reception_visit_id = v_del.reception_visit_id ORDER BY seq DESC LIMIT 1;
  INSERT INTO rec.custody_history (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, releasing_partner_id, receiving_partner_id, reason, correlation_id, actor_id)
    VALUES (v_del.tenant_id, v_del.company_id, v_del.branch_id, v_del.reception_visit_id, v_last_state, 'released', NULL, v_receiver, 'delivery', p_correlation_id, v_actor);
  INSERT INTO sal.delivery_status_history (tenant_id, company_id, branch_id, delivery_record_id, from_status, to_status, correlation_id, actor_id)
    VALUES (v_del.tenant_id, v_del.company_id, v_del.branch_id, v_del.id, v_del.status, 'delivered', p_correlation_id, v_actor);
  RETURN v_odo;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.complete_delivery(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.complete_delivery(uuid, numeric, text, uuid) TO app_runtime;
