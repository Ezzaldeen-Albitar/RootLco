# Phase 1-10 — Append-Only / Immutability Matrix

Every one of the 35 tables is classified by its mutability contract. Deletion is a
soft-delete UPDATE (no application role holds DELETE); the append-only ledgers have no
soft-delete at all. "Frozen" means content-immutable once the gating status is reached.

## Append-only ledger — SELECT + INSERT only (4)

No UPDATE/DELETE grant. `inv.stock_movements` (immutable, `GENERATED signed_qty`,
provenance-guarded, single-use source), `quo.approval_decisions` (one per
revision-item, exact composite FK), `quo.approval_evidence` (document-bound),
`quo.quotation_status_history` (trigger-emitted, server-stamped).

## Frozen-once-published / issued (5)

- `svc.service_versions` — frozen once `published`/`archived` (identity,
  `effective_from`, `notes`; `effective_to` closes forward only).
- `svc.standard_labor_times` — frozen (no INSERT/UPDATE/DELETE) once the parent version
  is published.
- `svc.price_list_versions` — frozen once `published`/`archived`.
- `svc.price_rules` — frozen (no INSERT/UPDATE/DELETE) once the parent version is
  published.
- `quo.quotation_revisions` + `quo.quotation_items` — frozen once the revision is
  `issued` (items frozen against INSERT/UPDATE/DELETE while not `draft`; captured
  totals reconciled by a deferred constraint trigger).

## Approval-terminal masters (2)

- `inv.opening_inventory_batches` — `approved` is terminal (maker≠approver);
  `inv.opening_inventory_lines` frozen once the batch is approved.
- `inv.stock_adjustments` — `approved`/`rejected` are terminal (maker≠approver).

## Reservation state machine (1)

`inv.stock_reservations` — `active` is the only mutable state; `released`/`consumed`/
`expired` are terminal (`guard_stock_reservation_status`); `quantity` and
`idempotency_key` immutable.

## Derived / coherence-guarded (1)

`inv.stock_balances` — `on_hand_qty`/`reserved_qty` mutate only as movement/reservation
deltas under the balance lock; `available_qty` is generated; the coherence guard
rejects any incoherent write.

## Mutable master / config, with immutable anchors (rest)

Soft-deletable configuration and masters, updated in place subject to immutable-column
guards (identity codes, scope, and audit anchors frozen): `svc.service_categories`,
`svc.services` (immutable `service_code`; `archived` terminal), `svc.price_lists`
(immutable `price_list_code`/`currency_code`), `svc.price_list_assignments`,
`svc.discount_rules` (immutable `discount_code`), `svc.pricing_approval_policies`,
`svc.branch_service_availability`, `inv.units_of_measure` (dual-scope; immutable
`scope`/`tenant_id`/`code`), `inv.item_categories`, `inv.item_master` (immutable `sku`;
`archived` terminal), `inv.item_cost_details` (restricted; immutable classification),
`inv.stock_locations` (immutable `location_type`), `inv.part_issues`, `inv.part_returns`,
`inv.damaged_stock`, `inv.customer_supplied_parts` (`customer_owned` always true),
`inv.external_purchase_parts` (`is_procurement=false`),
`inv.external_purchase_part_details` (restricted),
`inv.stock_adjustment_details` (restricted), `quo.quotations`.

Operation records (`part_issues`, `part_returns`, `damaged_stock`) are effectively
write-once in practice — their stock effect is mediated entirely by the immutable
movement ledger, and their scope/reference/quantity columns are immutable once set.
