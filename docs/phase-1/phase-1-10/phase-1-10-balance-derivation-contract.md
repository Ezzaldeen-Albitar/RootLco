# Phase 1-10 — Balance Derivation Contract

**Requirement:** FR-INV-001 (quantities by location), BR-INV-001 (`available = on_hand
− active reservations`).

## Derived, coherence-guarded balances

`inv.stock_balances` holds one row per `(tenant, company, branch, item, location)`
cell (`UNIQUE` cell key):

- `on_hand_qty` and `reserved_qty` are `NUMERIC(12,3)`, both CHECK `>= 0`.
- `available_qty` is **`GENERATED ALWAYS AS (on_hand_qty - reserved_qty) STORED`**, with
  a table CHECK `on_hand_qty - reserved_qty >= 0` — available never goes negative.

`inv.guard_stock_balance_coherence` (BEFORE INSERT/UPDATE) asserts, for the cell:

- `on_hand_qty = Σ signed_qty` over `inv.stock_movements`, and
- `reserved_qty = Σ quantity` over **`active`** `inv.stock_reservations` (activeness by
  the immutable `status` column only — never `expires_at`/`now()`, review-response
  H8).

Any forged or incoherent balance write fails `23514`. Balances are never written
directly to arbitrary values; they are maintained only as a delta consistent with a
just-posted movement (`inv.post_stock_movement`) or by re-syncing to the active
reservation sum (`inv.sync_reserved`), always under the balance-row `FOR UPDATE` lock.

## Locking discipline (H14)

Every balance-writing function first calls `inv.lock_stock_balance` (create-if-absent
then `SELECT … FOR UPDATE`), so concurrent writers to the same cell serialize on the
balance row. `lock_stock_balance` deliberately avoids `INSERT … ON CONFLICT DO
NOTHING` so the BEFORE INSERT coherence trigger does not fire a zero row against an
already-stocked cell.

## Available and quarantine (BR-INV-001)

`available = on_hand − reserved`. Damaged/quarantined stock is moved to a
`quarantine`-type location (a paired `damage` movement), so it leaves the sellable
location's `on_hand` and is therefore excluded from that location's availability. See
[phase-1-10-damage-quarantine-contract.md](phase-1-10-damage-quarantine-contract.md).

## Loss vs. `available ≥ 0` (H9)

When a loss (damage, negative adjustment) would drive `available` below zero, the loss
functions first release conflicting active reservations junior-first
(`inv.free_reservations_for_loss`, `status→released`, reason `stock_loss`) within the
same locked transaction, so `reserved ≤ on_hand` always holds and the STORED-generated
`available_qty >= 0` CHECK stays satisfiable. No-oversell is enforced at the reserve
path, not by blocking loss recording.

## Documented residual

The coherence guard's full re-sum is `O(n)` in the cell's movement/reservation count.
This is an **accepted** performance residual (correctness over performance for a
foundation phase); an incremental running-sum optimization is deferred to P1-21
(review-response Medium).

**Tests:** the `inv` ledger + concurrency suites in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
