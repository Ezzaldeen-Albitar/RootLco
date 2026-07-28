# P1-21 Wave 1 — Protected Inventory Contract Archaeology

**Phase:** P1-21 — Inventory Backend
**Base:** `origin/develop` = `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2` (P1-20 waiver merge)
**Protected schema source:** migrations `20260723090000_svcquoinv_schemas.sql`,
`20260723093000_inv_reference.sql`, `20260723094000_inv_ledger.sql`,
`20260723095000_inv_operations.sql` (Phase 1-10, frozen).
**Migration posture:** 119 migrations, no migration 120, none modified.
**Schema hash at base:** `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`
(242 tables, `inv` = 18, 212 functions, 0 `SECURITY DEFINER`, 0 unforced RLS).

This document records what the protected schema **actually** enforces, verified by
reading the DDL and by executing probes against a live PostgreSQL 17.10 instance
with all 119 migrations applied. Where the P1-10 handoff prose and the deployed
behaviour disagree, **the deployed behaviour is recorded as authoritative** and the
divergence is raised as a finding.

---

## 1. Authoritative quantity and money types

| Concept                       | Column type      | Consequence for the backend                             |
| ----------------------------- | ---------------- | ------------------------------------------------------- |
| Every inventory quantity      | `numeric(12, 3)` | ≤ 9 integer digits, **exactly 3** decimal places        |
| Item / adjustment / PO cost   | `numeric(18, 4)` | ≤ 14 integer digits, 4 decimal places                   |
| `signed_qty`, `available_qty` | `GENERATED`      | Never written by the application; derived by PostgreSQL |

Quantity bounds are therefore `0.001 .. 999999999.999`, and every quantity CHECK in
the protected schema is `> 0` (never `>= 0`): `ck_stock_movements_quantity`,
`ck_stock_reservations_quantity`, `ck_part_issues_quantity`,
`ck_part_returns_quantity`, `ck_damaged_stock_quantity`,
`ck_customer_supplied_parts_quantity`, `ck_external_purchase_parts_quantity`.
**Zero is not a legal inventory quantity anywhere.**

`numeric` crosses the `pg` driver boundary as a **string** for scalars. The backend
therefore carries quantities as exact decimal strings end to end and never uses
`parseFloat`, `Number`, `Math.round`, `toFixed`, or floating-point aggregation on an
authoritative path. Money keeps the existing `schemas.money` contract
(`{ amount: string, currency: ISO-4217 }`) from `src/server/http/validation.ts`.

**No foreign exchange is invented.** `inv.item_cost_details` and
`inv.external_purchase_part_details` each carry their own `currency_code` FK to
`shared.currencies`; costs in different currencies are never summed.

## 2. Is stock stored or derived? — Stored, and coherence-guarded

`inv.stock_balances` **stores** `on_hand_qty` and `reserved_qty` per
`(tenant, company, branch, item, location)` cell. `available_qty` is
`GENERATED ALWAYS AS (on_hand_qty - reserved_qty) STORED`.

`inv.guard_stock_balance_coherence` (BEFORE INSERT OR UPDATE) re-derives and rejects
any incoherent write:

- `on_hand_qty` must equal `Σ signed_qty` of that cell's movements;
- `reserved_qty` must equal `Σ quantity` of that cell's **`active`** reservations.

So the balance table is a cache that the database refuses to let drift. The
**availability formula is therefore fixed by the schema**, not chosen by the backend:

```
available = on_hand − reserved            (GENERATED, not application arithmetic)
```

Damaged units are excluded from sellable availability structurally: damage moves
them **out** of the sellable location and **in** to a `quarantine` location, so they
land in a different balance cell rather than being subtracted by a flag.

## 3. Negative-stock enforcement point

Three CHECK constraints on `inv.stock_balances` are the real enforcement, and they
are enforced on every write regardless of which code path performs it:

| Constraint                    | Predicate                         |
| ----------------------------- | --------------------------------- |
| `ck_stock_balances_on_hand`   | `on_hand_qty >= 0`                |
| `ck_stock_balances_reserved`  | `reserved_qty >= 0`               |
| `ck_stock_balances_available` | `on_hand_qty - reserved_qty >= 0` |

`inv.reserve_stock` additionally raises `check_violation` with an explicit
`insufficient available stock` message before inserting. The constraint is the trust
root; the function message is the ergonomics.

## 4. Concurrency and locking strategy

`inv.lock_stock_balance(tenant, company, branch, item, location)` creates the
zero-balance row when genuinely absent and then holds it `FOR UPDATE`. Every
protected mutation funnels through it, so the balance row is the **single
serialization point** per cell. `inv.reserve_stock` resolves the last-unit race
inside that lock and re-reads `on_hand` and the active-reservation sum **after**
acquiring it — which is why two concurrent reservations for the same final unit
produce exactly one winner and one `23514`.

The backend must therefore never read availability and then write based on the read.
It calls the protected primitives, which lock first.

## 5. Vocabularies (as deployed — not as designed)

| Vocabulary                                  | Values                                                              |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `inv.stock_movements.movement_type`         | `opening`, `issue`, `return`, `damage`, `adjustment`                |
| `inv.stock_movements.reference_kind`        | `opening_line`, `part_issue`, `part_return`, `damage`, `adjustment` |
| `inv.stock_movements.direction`             | `in`, `out`                                                         |
| `inv.stock_reservations.status`             | `active`, `released`, `consumed`, `expired`                         |
| `inv.stock_locations.location_type`         | `warehouse`, `storage`, `quarantine`                                |
| `inv.item_master.item_type`                 | `part`, `material`, `consumable`, `fluid`, `kit`                    |
| `inv.item_master.lifecycle_status`          | `active`, `archived` (terminal)                                     |
| `inv.opening_inventory_batches.status`      | `draft`, `approved`                                                 |
| `inv.stock_adjustments.status`              | `pending`, `approved`, `rejected`                                   |
| `inv.damaged_stock.disposition`             | `quarantined`, `scrapped`, `returned_to_supplier`                   |
| `inv.customer_supplied_parts.custody_state` | `received`, `in_use`, `returned`, `consumed`                        |
| `inv.external_purchase_parts.status`        | `recorded`, `linked`, `cancelled`                                   |
| `inv.units_of_measure.dimension`            | `count`, `mass`, `volume`, `length`, `area`, `time`                 |

**There is no `transfer` movement type and no `transit` location type** — both were
dropped in P1-10 (review-response H7). **There is no `customer_supplied` and no
`external_purchase` movement type or reference kind.** Any P1-21 API that appeared
to move such stock would be inventing persistence, so neither does.

## 6. Movement immutability and the provenance trust root

`inv.stock_movements` is granted **SELECT + INSERT only** to `app_runtime` — no
UPDATE, no DELETE. Corrections are therefore new movements, never edits. Structural
controls:

- `signed_qty` is `GENERATED` from `direction` (`in ⇒ +qty`, `out ⇒ −qty`), so sign
  and magnitude cannot be decoupled;
- `ck_stock_movements_type_direction` couples type to direction (`opening`/`return`
  are `in`, `issue` is `out`, `damage`/`adjustment` may be either);
- `uq_stock_movements_source` is `UNIQUE(reference_kind, reference_id, direction)`,
  which makes every source **single-use** and blocks replay/double-post. Damage
  legitimately posts two rows, distinguished by `direction`.

`inv.guard_stock_movement_provenance` (BEFORE INSERT) requires every movement to
prove a quantity-matched source in the correct state and scope:

| `reference_kind` | Required source                                                                       |
| ---------------- | ------------------------------------------------------------------------------------- |
| `opening_line`   | a line in an **`approved`** batch, matching item/location, `in`/`opening`, line qty   |
| `part_issue`     | an `inv.part_issues` row for the item/location, `out`/`issue`, issue qty              |
| `part_return`    | an `inv.part_returns` row joined to its issue for the item/location, `in`/`return`    |
| `damage`         | an `inv.damaged_stock` row where the location is the from- or quarantine-location     |
| `adjustment`     | an **`approved`** adjustment (`approved_by <> requested_by`), direction and qty match |

So the **complete legal business-reference set is exactly those five kinds**. This is
the mechanical matrix P1-21-BE-015 enforces; anything else fails with `23514`/`23503`.

## 7. Ownership semantics that must NOT touch the ledger

Two scope items deliberately have **no** stock effect, and the schema says so in its
own table comments:

- **`inv.customer_supplied_parts`** — "custody-tracked, never valued stock, generate
  **NO stock movement and NO balance change** (`customer_owned` always true)".
  `ck_customer_supplied_parts_owned CHECK (customer_owned)` makes company ownership
  unrepresentable. `inv.item_master`'s own comment adds: "Customer-supplied parts are
  NOT `item_master` rows." Custody is the state machine; stock is untouched.
- **`inv.external_purchase_parts`** — "ad-hoc work-order-linked external purchase
  reference **ONLY** … **NOT** a PO/PR/goods-receipt/bidding workflow", with
  `ck_external_purchase_parts_not_procurement CHECK (is_procurement = false)`.
  Unit cost lives in a restricted 1:1 detail gated by `inv.cost.view`.

Both are branch-scoped and both require a work order. Recording either therefore
inserts a reference/custody row and **must not** post a movement or change a balance.

## 8. Grants available to `app_runtime` (no migration needed)

`SELECT, INSERT, UPDATE` on the operation tables (`opening_inventory_batches`,
`opening_inventory_lines`, `stock_adjustments`, `part_issues`, `part_returns`,
`damaged_stock`, `customer_supplied_parts`, `external_purchase_parts`, the two
restricted detail tables, `stock_balances`, `stock_reservations`, `item_master`,
`item_categories`, `units_of_measure`, `stock_locations`);
`SELECT, INSERT` **only** on `stock_movements`; `EXECUTE` on `inv.lock_stock_balance`,
`post_stock_movement`, `sync_reserved`, `reserve_stock`, `release_reservation`,
`consume_reservation`, `expire_reservations`, `free_reservations_for_loss`,
`issue_part`, `return_part`, `record_damage`, `approve_opening_batch`,
`approve_adjustment`. Every function is `SECURITY INVOKER`.

**Write feasibility is proven: P1-21 needs no new migration.**

## 9. Divergences between the P1-10 handoff prose and deployed behaviour

Each was reproduced against a live database at the base SHA. These are the reason the
backend orchestrates the primitives rather than delegating blindly to `inv.issue_part`.

### D-01 — `inv.issue_part` fails when a reservation covers all available stock

`inv.issue_part` posts the `out` movement (line 690) **before** consuming the
reservation (line 691). `post_stock_movement` reduces `on_hand_qty` while
`reserved_qty` is still held, so `ck_stock_balances_available`
(`on_hand − reserved >= 0`) is evaluated at a moment when the reservation has not yet
been released.

Probe (5 on hand, reserve 5, issue 5):

```
FAILED 23514: new row for relation "stock_balances"
violates check constraint "ck_stock_balances_available"
```

The existing P1-10 test passes only because it reserves 5 of 10 and never reaches the
boundary. The natural flow — reserve exactly what is needed, then issue it — is
therefore **broken in the protected function**. P1-21 does not edit the function (no
migration authorized). It orchestrates the same granted primitives in the correct
order: insert `part_issues` → `consume_reservation` → `post_stock_movement`.

### D-02 — `inv.issue_part` does not enforce work-order state

The function selects `state INTO v_wo_state ... FOR UPDATE` and then **never reads
the variable**. The table comment claims "Requires an open work order"; the probe
issued successfully against a work order in state `draft`. There is no trigger on
`inv.part_issues` enforcing state either. `wo.work_order_states` is a data-driven
graph with `is_terminal` / `is_closed` / `allows_jobs` flags and **no** `allows_parts`
flag, so the issuable-lifecycle rule is a backend responsibility.

### D-03 — `inv.issue_part` accepts a reservation belonging to a different item

Probe: reserve 4 of item B, then issue 2 of item A citing B's reservation →
**SUCCEEDED**. The function consumes whatever reservation id it is handed, releasing
reserved quantity on an unrelated cell. `fk_part_issues_reservation` only constrains
scope, not item/location/work-order coherence. P1-21 validates reservation ↔
item ↔ location ↔ work-order coherence before use.

### D-04 — reservation-expiry scheduler and closure blockers remain owned but unbuilt

`docs/phase-1/phase-1-10/p1-21-inventory-backend-contract.md` assigns P1-21 the
scheduled `inv.expire_reservations` caller. Separately,
`src/modules/work-order/domain/work-order.ts` (`DEFERRED_CLOSURE_BLOCKERS`) assigns
P1-21 ownership of turning `wo.work_orders.parts_forward_state` into a closure
blocker for `active-reservation` and `open-part-issue`. Extending the **database**
guard `wo.guard_work_order_closure()` from B1–B6 would require a new migration, which
P1-21 is not authorized to add, and neither item appears in the canonical 15-task
backend scope. Both are recorded as carried-forward obligations in the accepted
limitations rather than silently dropped or silently half-built.

## 10. Existing catalogs — reuse before adding

Five inventory permissions already exist in `supabase/seeds/04_iam_permission_catalog.sql`
(96 permissions total at the base):

| Code                     | Risk   | Stated meaning                            |
| ------------------------ | ------ | ----------------------------------------- |
| `inv.item.manage`        | medium | Manage item master, categories, UoM       |
| `inv.stock.read`         | low    | Read stock balances and movements         |
| `inv.stock.operate`      | medium | Post movements, reserve, issue, return    |
| `inv.adjustment.approve` | high   | Approve stock adjustments/opening batches |
| `inv.cost.view`          | high   | View item/purchase/adjustment cost        |

`inv.stock.operate` already covers reserve / release / issue / return / damage by its
own description, and `inv.adjustment.approve` already covers opening-batch approval.
New codes are added only where no existing code carries the meaning.

## 11. Scope and coherence rules the backend must resolve server-side

- Tenant comes from `iam.current_tenant_id()`; **client-supplied tenant is never
  authoritative**.
- Company/branch for a movement are resolved from the **stock location**
  (`post_stock_movement` looks them up), so the location is the scope anchor.
- `inv.stock_locations` requires `warehouse` to have no parent and
  `storage`/`quarantine` to nest under a warehouse in the same
  `(tenant, company, branch)`.
- An item may reference a `platform` UoM or its own tenant's UoM, never another
  tenant's (`inv.guard_item_uom_scope`).
- RLS is `ENABLE` + **`FORCE`** on every `inv` table, with company/branch narrowing
  via `iam.allowed_company_ids()` / `iam.allowed_branch_ids()`. Per **P1-18-A-01**
  those arrays are the union of every active grant regardless of which permission it
  carries, so RLS is defence in depth only: every branch-scoped operation must still
  pass a concrete `authorizationTarget` so evaluation uses
  `iam.has_permission_in_scope` rather than the scope-blind `iam.has_permission`.
- Restricted cost tables are gated by `iam.has_permission('inv.cost.view')` **inside
  the RLS policy**, so a caller without it sees no cost row at all.

## 12. Task coverage

This document is the deliverable of **P1-21-DOC-001** (contract, catalog, and
traceability synchronization). It records the protected contract as read at the base
SHA, the vocabulary each application constant is transcribed from, and the four
divergences (`D-01`…`D-04`) that shaped the implementation. The catalog and
traceability reconciliation it synchronizes with is enforced mechanically by
`npm run validate:p1-21-inventory`.
