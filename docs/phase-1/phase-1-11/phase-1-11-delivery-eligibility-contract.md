# Phase 1-11 — Delivery Eligibility Contract (P1-OD-023)

**Requirement:** BR-REC-001, UC-WO-002, P1-11-DB-011, TC-P1-11-003; open decision **P1-OD-023**
(delivery eligible-state set). Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar
under the Solo Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review.

## Delivery record

`sal.delivery_records` is branch-scoped: `work_order_id` (→ `wo.work_orders`),
`reception_visit_id` (→ `rec.reception_visits`), `vehicle_id` (→ `veh.vehicles`),
`delivering_employee_id`, `status`, `delivered_at`, `final_odometer_reading_id` (composite FK →
`veh.odometer_readings(tenant_id, vehicle_id, id)`), `idempotency_key`. `status` CHECK IN
`('ready','receiver_verified','signed','delivered','exception')`;
`ck_delivery_records_delivered_shape` binds `status='delivered'` iff `delivered_at` **and**
`final_odometer_reading_id` are set.

- **One live delivery per WO:** `uq_delivery_records_work_order_active UNIQUE(tenant_id,
company_id, branch_id, work_order_id) WHERE status <> 'exception' AND deleted_at IS NULL`.

## Coherence (M-dlv-1)

`sal.guard_delivery_coherence` (BEFORE INSERT OR UPDATE) enforces `delivery.vehicle_id =
wo.vehicle_id` **and** `delivery.reception_visit_id = wo.reception_visit_id` — the delivery,
the work order, the visit, and the vehicle are one coherent unit within scope.

## Eligible-state set is configuration (P1-OD-023)

The specific "closed/billable" **eligible source state** that permits opening a delivery is a
**documented open contract**, not invented state names in P1-11. Eligibility as built requires
the WO to be in scope with vehicle/visit coherence; the exact WO-state gate (e.g. work
completed / quality-signed / billable) is resolved as configuration once P1-OD-023 is decided.
The mechanism (`sal.complete_delivery` verifying gates under a lock) supports whatever eligible
set is chosen.

**Tests:** `sal-delivery` (TC-P1-11-003).
