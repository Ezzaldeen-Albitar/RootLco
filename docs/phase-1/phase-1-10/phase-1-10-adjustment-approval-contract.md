# Phase 1-10 — Adjustment Approval Contract

**Requirement:** FR-INV-004 (adjustment approval), P1-OD-022 (adjustment threshold
kept configurable). Tables: `inv.stock_adjustments` (+ restricted
`inv.stock_adjustment_details`).

## Request → approval → movement

`inv.stock_adjustments`: `direction ∈ {in, out}`, `quantity NUMERIC(12,3) > 0`,
`reason` (not blank), `requires_approval`, `status ∈ {pending, approved, rejected}`,
`requested_by`, `approved_by`, `approved_at`. Guards:

- `ck_stock_adjustments_approved`: `(status='approved') = (approved_at IS NOT NULL)`.
- `ck_stock_adjustments_maker` + `guard_adjustment_approval`: an approved adjustment
  requires `approved_by`, and `approved_by <> requested_by` (**maker ≠ approver**);
  `approved`/`rejected` are terminal.

An over-threshold adjustment simply stays `pending` until approved — the **threshold
itself is configuration** (P1-OD-022), not invented; no threshold value is seeded.

`inv.approve_adjustment(adjustment)` (`SECURITY INVOKER`), under the adjustment `FOR
UPDATE` lock:

1. requires the adjustment to be `pending`;
2. flips it to `approved`, stamping `approved_by`/`approved_at`;
3. if the direction is `out`, first releases conflicting active reservations
   (`inv.free_reservations_for_loss`) so `available` stays `>= 0` (H9);
4. posts the `adjustment` movement (matching the approved direction and quantity).

The movement provenance guard requires the source adjustment to be `approved` with a
matching direction/quantity, so an adjustment movement cannot precede approval and
cannot mismatch the approved figures.

## Restricted value impact

`inv.stock_adjustment_details` (1:1, branch-scoped) carries `value_impact
NUMERIC(18,4)` and `currency_code`, `classification='restricted'`, every policy gated
by `iam.has_permission('inv.cost.view')` — the financial impact of an adjustment never
leaks to operational roles.

**Tests:** the `inv` operations suite (approval gate, maker≠approver, restricted-value
gate) in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
