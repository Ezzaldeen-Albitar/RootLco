# Phase 1-10 — Reservation Locking Contract

**Requirement:** FR-INV-002 (atomic reservation; no oversell). Locking is in the
database, not application-only.

## Atomic primitive

`inv.reserve_stock(item, location, qty, work_order, idempotency_key, expires_at,
correlation)` (`SECURITY INVOKER`), for the last-unit race:

1. resolve the location's company/branch; validate `qty > 0`;
2. **lock** the balance row: `inv.lock_stock_balance` (create-if-absent, then `SELECT …
FOR UPDATE`) — the serialization point;
3. **idempotency (in-lock):** if `idempotency_key` matches an existing reservation of
   **any** status, return it (never a raw `23505`);
4. opportunistically expire stale `active` rows for the cell (`expires_at < now()`);
5. compute `available = on_hand − Σ active reservations`; if `qty > available`, `RAISE
… 23514` (insufficient/concurrent stock, ERR-INV-001);
6. insert the reservation (`status='active'`) and re-sync `reserved_qty` under the
   lock (`inv.sync_reserved`).

Two concurrent requests for the last unit serialize on the `FOR UPDATE` lock; the
loser recomputes `available = 0` and fails `23514` — **exactly one winner**, no
oversell, no negative availability.

## Status-only activeness + explicit expiry (H8)

Activeness is the immutable `status` column only — never `expires_at`/`now()`, so the
coherence guard is deterministic. Expiry is an explicit primitive:
`inv.expire_reservations(item?, location?)` flips `active→expired` **and** decrements
`reserved_qty` together, per cell, under the balance lock. `guard_stock_reservation_status`
makes every non-`active` status terminal (no resurrection). `quantity` and
`idempotency_key` are immutable.

## Lifetime idempotency (H10)

`UNIQUE(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL` spans the whole
reservation lifetime (all statuses). A replay always returns the same reservation; a
genuine stock-race loser still gets `23514`.

## Transitions

`inv.release_reservation(id, reason)` and `inv.consume_reservation(id)` transition
`active → released`/`consumed` and re-sync `reserved_qty` under the balance lock;
`inv.free_reservations_for_loss` releases junior-first at loss time (see
[phase-1-10-balance-derivation-contract.md](phase-1-10-balance-derivation-contract.md)).

## Scheduler dependency (documented)

The expiry sweep is a required maintenance primitive; a scheduled caller lands in
P1-21. It is mitigated meanwhile by the opportunistic in-lock expiry inside
`reserve_stock` (review-response Medium; see
[p1-21-inventory-backend-contract.md](p1-21-inventory-backend-contract.md)).

**Tests:** the `inv` concurrency suite (single-winner ×N reps) in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
