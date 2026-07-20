# Phase 1-11 — Warranty-Record Contract

**Requirement:** FR-WTY-002 (covered items traceable), FR-WTY-003 (immutable status history),
P1-11-DB-016/017, M-wty-2, P1-OD-024. Owner-authorized technical self-review by Eng. Ezzaldeen
Al-Bitar under the Solo Developer Review Policy and the Standing Technical Authorization Policy
— not an independent third-party review.

## Record issued from a delivery

`wty.warranty_records` is branch-scoped: `vehicle_id` (→ `veh.vehicles`), `work_order_id`
(→ `wo.work_orders`), `delivery_record_id` (→ `sal.delivery_records`), `policy_id`
(→ `wty.warranty_policies`), `coverage_id` (composite FK → `wty.warranty_coverage(tenant_id,
company_id, id)`), `start_date`, `expiry_date` (`> start_date`), `odometer_at_issue` (>=0),
`odometer_limit` (optional, `>= odometer_at_issue`), `status`, `idempotency_key`.

- **Bound to the delivery (M-wty-2):** `start_date` binds `delivery.delivered_at`;
  `odometer_at_issue` binds the delivery's `final_odometer_reading_id` value.
- **No overlapping live record (M-wty-1):** `ex_warranty_records_no_overlap` gist `EXCLUDE` over
  `(tenant_id, vehicle_id, coverage_id, daterange(start_date, expiry_date, '[]'))` `WHERE status
IN ('issued','active')`.

## `wty.issue_warranty` + immutability

`wty.issue_warranty(p_delivery_id uuid, p_policy_id uuid, p_correlation_id uuid,
p_idempotency_key text)` (SECURITY INVOKER, `app_runtime`) issues the record from a delivered
delivery, idempotent by `uq_warranty_records_idempotency`. `wty.guard_warranty_record_freeze`
(BEFORE UPDATE) freezes the record after issue.

## Covered items + status history

- `wty.warranty_record_items` — `item_kind` CHECK IN `('service','part')`, `source_job_id` /
  `source_part_id` (opaque source links, FR-WTY-002 traceability), `description`.
- `wty.warranty_status_history` — append-only, server-stamped ledger recording
  issued/active/expired/voided/claimed_against (FR-WTY-003), aligned to the Figure 4.25
  claim-history pattern.

**No full claim adjudication (P1-OD-024).** Claim structures activate with the P1-22 backend; the
`…claimed_against` status is prepared so a later claim links to the record without schema change.

**Tests:** `wty-warranty`.
