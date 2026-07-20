# Phase 1-10 — Opening Inventory Contract

**Tables:** `inv.opening_inventory_batches`, `inv.opening_inventory_lines`. Opening
inventory seeds initial on-hand quantities through the movement ledger, never by a
direct balance insert.

## Batch → approval → movements

`inv.opening_inventory_batches`: `batch_code` (unique per branch), `as_of_date`,
`counted_by`, `approved_by` (NULL until approved), `approved_at`, `status ∈
{draft, approved}`. Guards:

- `ck_opening_inventory_batches_approved`: `(status='approved') = (approved_at IS NOT
NULL)`.
- `ck_opening_inventory_batches_maker` + `guard_opening_batch_approval`: an approved
  batch requires `approved_by`, and `approved_by <> counted_by` (**maker ≠ approver**,
  review-response Medium: opening-batch self-approval); `approved` is terminal.

`inv.opening_inventory_lines`: composite FKs to batch/item/location, `quantity
NUMERIC(12,3) > 0`, unique per `(batch, item, location)`. Lines are **quantity-only** —
valuation is out of scope (P1-11/accounting). Frozen once the batch is approved
(immutable-column guard + the provenance guard's approved-batch requirement).

## Approval posts the movements

`inv.approve_opening_batch(batch)` (`SECURITY INVOKER`), under the batch `FOR UPDATE`
lock:

1. requires the batch to be `draft`;
2. flips it to `approved`, stamping `approved_by = current user` and `approved_at`;
3. for each non-deleted line, posts an `opening`/`in` movement via
   `inv.post_stock_movement` (`reference_kind='opening_line'`).

No direct balance insert occurs — balances derive from the generated movements
(coherence-guarded). The provenance guard requires the source line's batch to be
`approved`, so an opening movement cannot precede approval.

## Maker/approver note

`iam.current_user_id()` becomes `approved_by` at approval time; if the counter and the
approving session are the same identity, the `approved_by <> counted_by` CHECK rejects
the approval — a self-approval cannot post opening stock.

**Tests:** the `inv` operations suite (approval gate, maker≠approver, movement
generation) in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
