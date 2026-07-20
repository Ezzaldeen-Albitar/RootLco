# Phase 1-10 — External-Purchase Non-Procurement Contract

**Table:** `inv.external_purchase_parts` (+ restricted `inv.external_purchase_part_details`).
An ad-hoc, work-order-linked purchase reference **only** — deliberately **not** a
procurement workflow.

## The structural boundary

`is_procurement boolean NOT NULL DEFAULT false` carries a **CHECK `is_procurement =
false`**. This makes the non-procurement boundary structural, not a convention: a row
can never claim to be a procurement artifact. The migration COMMENT records the
exclusion.

`status` is `CHECK (status IN ('recorded', 'linked', 'cancelled'))` — an intentionally
closed vocabulary with **no** procurement/goods-receipt tokens (review-response
Medium: open-vocabulary status).

## What it is

| Column                                  | Contract                                                   |
| --------------------------------------- | ---------------------------------------------------------- |
| `work_order_id`                         | composite FK → `wo.work_orders(...)`; the purchase context |
| `supplier_partner_id` / `supplier_name` | at least one required (CHECK)                              |
| `item_ref`                              | optional opaque catalog reference                          |
| `description`                           | not blank                                                  |
| `quantity`                              | `NUMERIC(12,3) > 0`                                        |
| `status`                                | `recorded` \| `linked` \| `cancelled`                      |
| `evidence_ref`                          | optional evidence reference                                |

Cost is **restricted**: `inv.external_purchase_part_details` (1:1, branch-scoped)
carries `unit_cost NUMERIC(18,4)` and `currency_code`, `classification='restricted'`,
with every policy gated by `iam.has_permission('inv.cost.view')`.

## What it is NOT (out of scope)

No purchase order (PO), purchase requisition (PR), goods receipt, supplier bidding, or
any procurement workflow. Those belong to a future procurement (PRC) phase — see
[procurement-exclusion-note.md](procurement-exclusion-note.md). `external_purchase_parts`
generates **no** stock movement in this phase; it is a foundation reference the future
procurement/receipt path will build on.

**Tests:** the `inv` operations suite (`is_procurement=false` CHECK, status
vocabulary, restricted-cost gate) in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
