# P1-21 — Independent Adversarial Review Adjudication

**Reviewed range:** `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2..17d863b`
**Reviewers:** three independent read-only reviewers over (1) inventory domain
correctness, concurrency, negative stock, protected-function mitigations and movement
integrity; (2) tenant/company/branch/location authorization, RLS isolation,
work-order integration, custody and external-purchase semantics, restricted cost;
(3) exact quantity and money, audit/outbox transactionality, API/OpenAPI and error
contracts, rollback integrity.

Each reviewer was required to cite file and line, give a reproduction, attempt to
refute its own finding, and distinguish a repository defect from a protected-schema
limitation. **Every finding below that is marked verified was reproduced by me
directly**, not accepted on the reviewer's word.

> **Status: P1-21 is NOT closeable at this commit.** Five High findings and a
> test-honesty finding are open. The gate requires unresolved Critical 0 and
> unresolved High 0, and that condition is not met.

## Critical

None. All three reviewers reported none, and each independently confirmed no
cross-tenant reachability of any `inv` table: every repository query binds
`context.principal.tenantId`, every `inv` table is `FORCE ROW LEVEL SECURITY`, and
the tenant-B fixture rows prove the boundary from both sides.

## High — open

### H1 — An unfiltered read bypasses the branch scope check entirely

**Verified by direct reproduction.** `readAvailability`, `listMovements` and
`reconcile` call `authorizeScope` **only inside** `if (filter.locationId !== undefined)`
/ `if (filter.branchId !== undefined)`
(`src/modules/inventory/application/inventory-read-service.ts:195`, `:236`, `:286`).
All three filters are `.optional()`, so omitting them skips the check, and the only
remaining predicate is `tenant_id` plus RLS — which narrows on
`iam.allowed_branch_ids()`, the **permission-blind** union of every active grant
(P1-18-A-01).

Measured with the repository's own `INV_PERMISSION_ELSEWHERE` principal (every `inv.*`
permission scoped to branch A2, plus an unrelated permission scoped to A1):

| Request                                        | Result                                     |
| ---------------------------------------------- | ------------------------------------------ |
| `GET /stock-availability?itemId=…&branchId=A1` | **403**                                    |
| `GET /stock-availability?itemId=…` (no branch) | **200 — returns branch A1, onHand 25.500** |
| `GET /stock-movements?itemId=…`                | **200 — returns branch A1**                |
| `GET /inventory-reconciliations?itemId=…`      | **200 — returns branch A1**                |

A control a caller defeats by deleting one query parameter is not partial, it is
ineffective — and the route and module headers both claim it is closed. This is the
same bug class as P1-18-A-01 in mirror image: not an inert `scope: 'branch'`, but a
`scope: 'tenant'` declaration over a branch-scoped table behind an optional filter.

**Repository defect.** The platform already solved this shape: `GET /work-orders`
makes `companyId` and `branchId` **required** precisely so the list read has a
concrete `authorizationTarget` (`src/app/api/v1/work-orders/route.ts:18-27`). The fix
is to require the pair on all three reads, declare `scope: 'branch'`, and pass
`scopeTargetOption` — which additionally brings them under the gate's `scopeEnforced`
guard.

### H2 — A 0.001-unit damage destroys an arbitrarily large reservation, unaudited

`inv.record_damage` calls `inv.free_reservations_for_loss`, which releases **whole
reservation rows** newest-first until the freed quantity covers the loss — it never
releases a partial quantity
(`supabase/migrations/20260723095000_inv_operations.sql:648-670`).

With `on_hand 10.000` and one active reservation of `10.000`, damaging `0.001`
computes `v_need = 0.001 > 0` and releases the entire reservation. The result is
`on_hand 9.999, reserved 0.000, available 9.999` — another work order's guaranteed
part is gone and the caller may immediately reserve it. Only `inv.stock.operate` is
needed.

Compounding it, the application records nothing: the `inv.stock.damaged` audit names
item, locations, quantity, disposition and reason but no released reservation; no
`stock.reservation.released` event is published, though the `/release` route emits one
for the identical transition; and `inv.stock_reservations` has no history table. A
consumer tracking reservation state keeps a phantom `active` reservation forever.

The **release granularity** is a protected-schema limitation. The absence of any
policy check, audit, or event is a **repository defect** — the active reservations at
the cell are readable before and after the call with existing grants.

The existing test (`tests/backend/p1-21-inventory-stock.test.ts`, "releases
conflicting reservations rather than driving available negative") exercises this exact
path and asserts only that the status flipped and `available >= 0`. It documents the
inflation as intended rather than catching it.

### H3 — `stock.movement.posted` is published for issues only

`publishMovementPosted` has exactly one call site
(`inventory-stock-service.ts:455`). Returns, damage (two legs), and opening-batch
approval (one movement per line) all post movements and publish nothing.

This contradicts the repository's own written contract in two places.
`src/server/events/envelope.ts:507-512` states that one `stock.movement.posted`
"describes them without four consumers having to subscribe to four names", and
`docs/phase-1/phase-1-21/evidence/change-log.md` repeats it. **I wrote both.** A
consumer maintaining an availability projection from this event would see stock leave
on every issue and never see it return, be damaged, or be opened — a monotonically
diverging projection, which is the availability inflation this phase claims to
prevent.

**Repository defect**, and undisclosed: the "Carried forward" section lists only the
expiry scheduler and the closure blockers. The protected functions return the business
row id rather than the movement id, so publishing needs one extra `SELECT` on
`inv.stock_movements` by `(reference_kind, reference_id)` — friction, not a barrier.

### H4 — `release()` decides "did this change anything" from an unlocked pre-read

`wasActive` came from a lock-free read taken before an `authorizeScope` round trip,
while `inv.release_reservation` silently no-ops on a non-`active` row. If a concurrent
issue consumes the reservation in the window, `wasActive` is still `true`, so the
method commits an `inv.stock.reservation_released` audit record reading
`active → consumed` and publishes `stock.reservation.released` for a release that
never happened — telling consumers the quantity returned to available when it left
through an `out` movement. Two genuinely concurrent releases also both pass the gate,
and the second's `publishEvent` hits `uq_event_outbox_event_key`, contradicting the
route's own claim that a duplicate release is a safe no-op.

**Repository defect.** Fixed by locking the reservation before the decision
(`FOR UPDATE`), which makes the pre-read and the release one atomic decision.

### H5 — Quarantined (damaged) stock can be reserved and issued back onto a vehicle

**Verified by direct reproduction.** `requireLocation` checks only
`status === 'active'`, never `locationType`. Damage moves units into quarantine, and
nothing then prevents naming that cell:

| Request                                               | Result  |
| ----------------------------------------------------- | ------- |
| `POST /damaged-stock` (5 units → quarantine)          | **201** |
| `POST /stock-reservations` at the quarantine location | **201** |
| `POST /stock-issues` from the quarantine location     | **201** |

Damaged parts are fitted to a customer's vehicle, and because `/stock-availability`
excludes quarantine by default the drawdown is invisible in the operator view. This
directly undoes the `/damaged-stock` route's own claim that damaged units "leave
sellable availability".

`addLine` already refuses a quarantine destination for opening counts; reserve and
issue have no equivalent. Quarantined stock should leave through the approved
disposition path (`inv.stock_adjustments` + `inv.approve_adjustment`, needing
`inv.adjustment.approve` and a second person), not through `inv.stock.operate`.

**Repository defect.**

## Test-honesty — open

### T1 — `idempotency` is declared for two operations with no backing assertion

`tests/backend/p1-21-inventory-stock.test.ts` declares `idempotency` for
`inv.stock-return-create` and `inv.damaged-stock-create`, and the coverage manifest
requires it for both — but neither describe block contains a replay test. The `post()`
helper always mints a fresh `randomUUID()` key, so no key is ever reused. Deleting
`idempotent: true` from either route leaves every test in those blocks green.

This is the P1-17 lesson recurring: **the gate checks that a token is present, not
that an assertion backs it.** The intake suite does it correctly, with four real
replay tests.

## Fixed during this review cycle

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                  | Resolution                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Seven balance assertions used IEEE-754 arithmetic in the two suites whose purpose is exact decimal handling; they passed only because 3.5/7.5/4/3/2 are binary-exact and would have kept passing against an implementation that truncated the third decimal                                                                                                                              | All seven now compare exact strings through `Quantity` (`e06d8ae`)                                                             |
| F2  | `lockWorkOrderState` omitted the platform's tenant-shadows-platform precedence. `wo.work_order_states` carries two unique indexes, so a tenant row may legally shadow a platform code and the join matches both; `runOne` then returns whichever row the planner chose, and two call sites could reach opposite lifecycle verdicts — defeating the D-02 mitigation non-deterministically | `ORDER BY (s.scope = 'tenant') DESC LIMIT 1` added, matching `wo.guard_work_order_transition` and `WorkOrderCatalogRepository` |

## Medium — open

| ID  | Finding                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | The gate is blind to H1: `scopeEnforced` is evaluated only for `scope: 'branch'` operations, so declaring `'tenant'` exempts an operation from it; and `inv.stock-movement-list` / `inv.inventory-reconciliation-read` carry no `isolation` requirement, so the suite has no cross-branch test for either |
| M2  | An opening line can be appended to an already-approved batch: `readOpeningBatch` takes no `FOR UPDATE`, and `inv.opening_inventory_lines` has no BEFORE-INSERT guard. The approved batch then carries a line with no movement, and that orphan line is a valid `opening_line` provenance source           |
| M3  | The reconciliation payload compares strings of inconsistent scale: `COALESCE(sum, 0)` yields `"0"` (scale 0) while the stored column yields `"0.000"`, so a client comparing the pair reports a false discrepancy on nearly every row. `coherent` is computed in SQL and stays correct, which masks it    |
| M4  | A partial issue consumes the whole reservation — `inv.consume_reservation` releases the row in full — and neither the audit nor `IssueView` reports the forfeited remainder                                                                                                                               |
| M5  | Every P1-21 refusal collapses to an indistinguishable `409 ERR-TRN-001` with no detail across at least ten distinct conditions; four in-repo comments claim the caller "learns why". `problem.ts` never serialises `message`, so the fix is `safeDetails.violations` or distinct catalog codes            |
| M6  | `ITEM_ORDER` was shared by two endpoints with different tie-breaker columns, so `decodeCursor`'s contract-key check could not reject a crossed cursor and a stock-availability page could silently drop cells                                                                                             |
| M7  | The DB integrity suite proves the _defective_ `inv.issue_part`, not the P1-21 ordering: all three issue tests call the protected function and none passes a reservation, so the D-01 mitigation has only single-threaded backend proof                                                                    |

## Low — open

| ID  | Finding                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Row state (batch status, location code and status) is disclosed via a 409 before `authorizeScope` runs; the isolation tests use fresh draft batches and active locations so they cannot catch it                                                         |
| L2  | `requiredPartRef`, external-purchase `itemRef`, `supplierPartnerId`, `receptionVisitRef`, `evidenceRef`, `responsiblePartyRef` are written unvalidated — and customer-supplied `itemRef` **is** validated, so the same field behaves two ways            |
| L3  | The two privileged read audits omit `companyId`/`branchId`, so a single-branch reconciliation is indistinguishable in the trail from a tenant-wide sweep                                                                                                 |
| L4  | OpenAPI declares `200` as the only success for eight operations that return `201`, and no operation declares `404` though `ERR-RES-001` is reachable on all fourteen. Pre-existing generator limitation, newly widened                                   |
| L5  | `QUANTITY_PRECISION`/`QUANTITY_SCALE` are not actually cross-checked against the column — the database test compares a string literal — and `unit_cost numeric(18,4)` has no catalog assertion at all                                                    |
| L6  | `assertPostable`'s upper bound is unreachable (the parser already caps integer digits), and `plus`/`minus` results are never re-bounded, so an overflow would surface as an unmapped `22003`/500                                                         |
| L7  | `assertLegalMovementReference` is called with three literal constants at all five sites, so it can never fire — decorative rather than protective                                                                                                        |
| L8  | `lockWorkOrderState` does not exclude soft-deleted work orders, unlike every sibling read in the repository                                                                                                                                              |
| L9  | `expiresAt` is accepted in the past, nothing expires it, and `countOpenCommitments` counts `status='active'` regardless — so a time-expired reservation blocks work-order closure indefinitely. Partly disclosed as D-04; the closure consequence is not |
| L10 | A cross-branch idempotency-key collision surfaces as `ERR-INT-001` for a reservation the caller cannot see — a confusing error and a key-existence oracle                                                                                                |
| L11 | An explicitly named quarantine location reads as an empty page rather than reporting its contents                                                                                                                                                        |

## What the reviewers tried to break and could not

Recorded because a review that only lists defects overstates them:

- **Exact quantity and money handling in production code is clean.** No `parseFloat`,
  `Math.round`, `toFixed`, `parseInt`, unary `+`, or binary float arithmetic anywhere
  on an authoritative path; the only `Number()` calls are on `count(*)` results.
  `Quantity.toString()` is correct for zero, sub-unit and negative values.
- **Audit and outbox transactionality is sound.** No path commits an audit or outbox
  row without its business row or vice versa; there is no publish-after-commit path.
- **The D-01 ordering holds under concurrency.** All three statements share one
  transaction, and both `consume_reservation` and `post_stock_movement` take the
  balance-row lock, held to commit — so the window where `reserved` has dropped and
  `on_hand` has not is invisible to any concurrent writer. Lock order is uniform and
  contains no cycle.
- **Custody and external purchase never touch stock.** Both are plain inserts with no
  stock trigger, and no `customer_supplied`/`external_purchase` reference kind exists
  for a movement to cite. `customer_owned = false` and `is_procurement = true` are
  unrepresentable.
- **Restricted cost never leaks.** No read path selects a cost column; the write is
  gated by `inv.cost.view` inside the RLS policy, `42501` maps to `ERR-IAM-001`, and
  the audit detail is masked to `***` before storage.
- **Movement immutability and provenance hold.** `app_runtime` has `SELECT, INSERT`
  only, asserted from `information_schema`; the 43-refusal matrix walk and the
  single-use test would both fail against a weakened guard.
- **No internal detail can reach a caller.** `problemFor` serialises only the catalog
  entry and whitelisted `safeDetails`; `AppFailure.message` is log-only.

## Required before closure

1. Fix H1, H2, H3, H4, H5 and T1, each with a regression test that fails if the fix is
   removed.
2. Re-run the reviews against the fixed tree — H1 and H5 were both invisible to the
   existing suite, so the suite is not yet sufficient evidence.
3. Then the hostile 100/100 audit, the final exact-SHA local CI, and the clean room.
