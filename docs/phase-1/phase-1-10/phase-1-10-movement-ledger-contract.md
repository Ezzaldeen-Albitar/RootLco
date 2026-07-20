# Phase 1-10 — Movement Ledger Contract

**Requirement:** FR-INV-003, BR-INV-002 (stock balance changes only through immutable
movements). **This is the C1/C2 trust-root contract** — enforced without
`SECURITY DEFINER`.

## Why constraints, not privilege

The repository forbids `SECURITY DEFINER` entirely and creates no per-feature role, so
`app_runtime` holds direct INSERT on `inv.stock_movements`. A balance coherence guard
alone would be a tautology (it proves `balance = Σ movements`, not that a movement is
legitimate). The trust root is therefore moved **onto the movement ledger itself** —
the constraints and the provenance guard are the real enforcement, and the operation
functions are advisory (review-response C1/C2). A QA test raw-inserts a movement,
bypassing the functions, and asserts rejection.

## Immutable append-only ledger

`inv.stock_movements` grants **SELECT + INSERT only** (no UPDATE/DELETE). Structural
controls:

- **`signed_qty` is `GENERATED ALWAYS`** from `direction`: `in ⇒ +quantity`, `out ⇒
-quantity`. Sign and magnitude cannot be decoupled. `quantity > 0`.
- **Type/direction coupling CHECK:** `opening`/`return` are `in`, `issue` is `out`,
  `damage`/`adjustment` may be either.
- **Single-use source:** `UNIQUE(reference_kind, reference_id, direction)` prevents
  replay/double-post (damage legitimately posts two rows: one `out` of sellable, one
  `in` to quarantine, distinguished by `direction`).

## Per-kind provenance guard (the trust root)

`inv.guard_stock_movement_provenance` (BEFORE INSERT) requires every movement to prove
a legitimate, quantity-matched source in the correct state and scope:

| `reference_kind` | Source requirement                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `opening_line`   | an `inv.opening_inventory_lines` row in an **`approved`** batch, matching item/location; must be `in`/`opening` with the line quantity         |
| `part_issue`     | an `inv.part_issues` row for the item/location; must be `out`/`issue` with the issue quantity                                                  |
| `part_return`    | an `inv.part_returns` row joined to its issue for the item/location; must be `in`/`return` with the return quantity                            |
| `damage`         | an `inv.damaged_stock` row for the item where the location is the from- or quarantine-location; must be type `damage` with the damage quantity |
| `adjustment`     | an **`approved`** `inv.stock_adjustments` row (`approved_by <> requested_by`) for the item/location; direction and quantity must match         |

Any unknown kind, missing source, wrong state, or quantity/direction mismatch fails
(`23514`/`23503`). A forged movement cannot mint stock.

## Reference vocabulary (as implemented)

`movement_type ∈ {opening, issue, return, damage, adjustment}`; `reference_kind ∈
{opening_line, part_issue, part_return, damage, adjustment}`. The design's `transfer`
kind and `in_transit`/`transit` concepts were **dropped** (review-response H7);
inter-location transfers are deferred to P1-21.

## Balances follow the ledger

`inv.post_stock_movement` inserts the movement and applies the `signed_qty` delta to
`inv.stock_balances` under the balance-row `FOR UPDATE` lock; the balance coherence
guard re-verifies `on_hand = Σ signed_qty`. See
[phase-1-10-balance-derivation-contract.md](phase-1-10-balance-derivation-contract.md).

**Tests:** the raw-insert bypass negatives and the `inv` ledger suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
