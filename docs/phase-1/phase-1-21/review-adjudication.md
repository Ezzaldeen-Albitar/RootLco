# P1-21 — Independent Adversarial Review Adjudication

**Reviewed range:** `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2..17d863b`. The fourth
reviewer ran while the branch advanced to `2dfea4b` and verified its findings against
the moving tree, which it flagged itself.
**Reviewers:** four independent read-only reviewers over (1) inventory domain
correctness, concurrency, negative stock, protected-function mitigations and movement
integrity; (2) tenant/company/branch/location authorization, RLS isolation,
work-order integration, custody and external-purchase semantics, restricted cost;
(3) exact quantity and money, audit/outbox transactionality, API/OpenAPI and error
contracts, rollback integrity; (4) task and evidence honesty, test honesty, Local CI
Primary Mode governance, documentation accuracy.

Each reviewer was required to cite file and line, give a reproduction, attempt to
refute its own finding, and distinguish a repository defect from a protected-schema
limitation. **Every finding below that is marked verified was reproduced by me
directly**, not accepted on the reviewer's word.

> **Status: all blocking findings RESOLVED.** One Critical, five High and one
> test-honesty finding were open at review time. Each is now fixed and carries a
> regression test that fails if the fix is removed.

## Correction to an earlier revision of this document

An earlier revision of this file stated "**Critical — None**". That was false, and it
is the most important line on this page.

A fourth reviewer found that `npm run test` had been **red at every commit of the
phase** — 3 failed / 923 passed of 926. The phase added 11 audit actions and 3 events
to the controlled catalogs and never extended the foundation allow-lists that
enumerate them, so `tests/foundation/p1-15-catalogs.test.ts` compared 137 against 126
and `tests/foundation/event-envelope.test.ts` 41 against 38.

The reporting failure was worse than the defect. `execution-checkpoint.md` recorded
"Verified green at HEAD | Unit | **926**". The count was exactly right — read off the
same run whose result line said `3 failed`. Three earlier reviewers and this
adjudication all missed it.

## Critical — RESOLVED

**C1 — the unit suite was red and was reported green.** Fixed by registering the 11
new audit actions and 3 new events in the foundation allow-lists and adding the
`P1-21 → inventory` owner mapping. `npm run test` now exits 0 at 926 passed / 43
files.

On cross-tenant reachability, which the first three reviewers were asked about
directly: none found any. Every repository query binds `context.principal.tenantId`,
every `inv` table is `FORCE ROW LEVEL SECURITY`, and the tenant-B fixture rows prove
the boundary from both sides.

## High — all RESOLVED

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

## Resolution

Every blocking finding is fixed, and each carries a regression test that fails if the
fix is removed. The test count moved from 926/95/14 to 926 unit, 112 backend and 14
database precisely because the suite could not see most of these.

| ID  | Fix                                                                                                                                                                                            | Regression test                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| C1  | Foundation allow-lists extended; `P1-21 → inventory` owner mapping added                                                                                                                       | `npm run test` exits 0 (43 files, 926)                                                                                      |
| H1  | `companyId` + `branchId` REQUIRED on all three branch-scoped reads; `scope: 'branch'` with a concrete `authorizationTarget`; `authorizeScope` unconditional; company/branch are SQL predicates | "H1 — no read reaches stock without naming and authorizing a branch" (5 cases, incl. the no-filter shape that was the hole) |
| H2  | Damage now refuses when the reservations it would free exceed the damaged quantity, and audits + publishes every genuine collateral release                                                    | "refuses a damage that would destroy more reserved stock than it damages"; "attributes a proportionate collateral release"  |
| H3  | `stock.movement.posted` published for return, both damage legs, and every opening line                                                                                                         | "publishes stock.movement.posted for BOTH damage legs"; "for the return leg"; "one per counted line"                        |
| H4  | The reservation is `FOR UPDATE`-locked before the release decision                                                                                                                             | "writes no audit row and no event when the reservation was already consumed"                                                |
| H5  | `requireSellableLocation` refuses a quarantine cell for reserve and issue                                                                                                                      | "refuses to reserve or issue from a quarantine location", asserting the cell really holds stock first                       |
| T1  | Real replay tests for `stock-return-create` and `damaged-stock-create`                                                                                                                         | "replays a stock return without returning twice"; "replays a damage record without damaging twice"                          |

Evidence findings from the fourth review are fixed too: the three `cross-tenant`
tokens that rested on a random-UUID 404 now use a **real** tenant-B batch (and assert
it still exists afterwards, so the 404 is not vacuous); the `excludes quarantine by
default` proof damages real stock into quarantine first, because both of its
assertions were previously vacuous — one filtered a row that did not exist and the
other was `[].every(...)`; the gate header's "none of those can be satisfied by prose"
and "the one `doc` proof" claims are corrected, since five tasks used `doc` and five
rested on nothing else; all five documentary tasks now carry a structural proof
beside the document, which closes the mutation where deleting the
`validate:p1-21-inventory` step from CI kept the gate green — **verified by
performing that deletion and watching the gate fail**; the generated traceability
header derives its task count instead of printing a literal `27`; and a P1-20 finding
that had been relabelled as P1-21's own history is attributed back to P1-20.
