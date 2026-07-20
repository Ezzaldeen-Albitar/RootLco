# P1-21 (Inventory Backend) Data Contract

Phase 1-10 is database-only. This document records the inventory database primitives
P1-21 will orchestrate, the two deferred residuals it owns, and the outbox event
contracts it will publish. **No inventory backend is implemented in this phase.**

## Inventory database contract (no backend built here)

| Operation                       | DB primitive / invariant                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Post a movement                 | `inv.post_stock_movement(...)` — provenance-guarded, single-use, balance delta under `FOR UPDATE`                                      |
| Reserve stock                   | `inv.reserve_stock(item, location, qty, wo, idempotency_key, expires_at, correlation)` — single-winner (`23514`), lifetime idempotency |
| Release / consume a reservation | `inv.release_reservation(id, reason)` / `inv.consume_reservation(id)`                                                                  |
| Expire stale reservations       | `inv.expire_reservations(item?, location?)` — status→expired + reserved decrement under lock                                           |
| Issue / return a part           | `inv.issue_part(...)` (open WO, consumes reservation) / `inv.return_part(...)` (`Σ returns ≤ issued`)                                  |
| Record damage                   | `inv.record_damage(...)` — paired out/in move to quarantine; releases conflicting reservations                                         |
| Approve opening batch           | `inv.approve_opening_batch(batch)` — maker≠approver; posts `opening` movements                                                         |
| Approve an adjustment           | `inv.approve_adjustment(adjustment)` — maker≠approver; posts the `adjustment` movement (over-threshold stays pending)                  |
| Read cost (restricted)          | the three 1:1 cost tables, gated by `iam.has_permission('inv.cost.view')`                                                              |

The database rejects impossible states directly (forged movement, oversell, negative
availability, unapproved movement, self-approval, return over ceiling), so the backend
cannot create them even under concurrency. Integrity is enforced by movement provenance

- coherence guards, **not** by any `SECURITY DEFINER` role.

## Residuals P1-21 owns

- **Reservation-expiry scheduler.** `inv.expire_reservations` is a required maintenance
  primitive; P1-21 provides the scheduled caller. Meanwhile `reserve_stock` opportunistically
  expires stale rows for the cell under the lock (review-response H8/Medium).
- **Incremental balance running-sum.** The coherence guard's `O(n)` full re-sum is an
  accepted foundation-phase residual; P1-21 may introduce an incremental running-sum
  optimization (review-response Medium).

## Deferred inventory features (not schema'd in P1-10)

- **Inter-location transfers.** The `transfer` movement kind, `transit` location type,
  and `in_transit_qty` were dropped from P1-10 (review-response H7). A general transfer
  primitive (two coupled movements or a transfer aggregate) is a P1-21 concern.
- **Reorder prediction (FR-INV-005).** Explicitly future.

## Outbox event contracts (documented, not implemented)

Anticipated via `shared.event_outbox`: `stock.movement-posted.v1`,
`stock.reserved.v1`, `stock.reservation-released.v1`, `stock.reservation-expired.v1`,
`part.issued.v1`, `part.returned.v1`, `stock.damaged.v1`,
`opening-inventory.approved.v1`, `stock-adjustment.approved.v1`. No producer is
implemented in this phase.
