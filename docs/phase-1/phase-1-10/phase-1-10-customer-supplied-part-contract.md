# Phase 1-10 — Customer-Supplied Part Contract

**Table:** `inv.customer_supplied_parts`. Customer-supplied parts remain
customer-owned, are custody-tracked, and **never enter valued stock**.

## No stock effect

A customer-supplied part generates **no stock movement and no balance change**. It is
**not** an `inv.item_master` row and is never posted to `inv.stock_movements` /
`inv.stock_balances`. The optional `item_ref` is an opaque catalog reference for
description only, not a stock link.

## Custody, not ownership transfer

| Column                | Contract                                                  |
| --------------------- | --------------------------------------------------------- |
| `work_order_id`       | composite FK → `wo.work_orders(...)`; the custody context |
| `reception_visit_ref` | optional opaque link to the reception visit               |
| `item_ref`            | optional opaque catalog reference (description aid)       |
| `description`         | not blank                                                 |
| `quantity`            | `NUMERIC(12,3) > 0`                                       |
| `custody_state`       | `received` \| `in_use` \| `returned` \| `consumed`        |
| `item_condition`      | optional; not blank if present                            |
| `evidence_ref`        | optional evidence reference                               |
| `customer_owned`      | `boolean` with **CHECK `customer_owned`** — always true   |

The `CHECK (customer_owned)` makes the ownership boundary structural: a
customer-supplied part can never be flipped to shop-owned stock. Branch-scoped RLS;
scope + WO are immutable once set.

## Boundary

Valuation, invoicing, and any conversion into shop inventory are out of scope
(P1-11/accounting). This table records custody and condition for the repair record
only.

**Tests:** the `inv` operations suite (no-stock-effect assertion) in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
