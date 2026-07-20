# Phase 1-10 — Inventory Data Dictionary (`inv`)

Column-level dictionary for the 18 inventory tables across
`20260723093000_inv_reference.sql`, `20260723094000_inv_ledger.sql`, and
`20260723095000_inv_operations.sql`. Money is `NUMERIC(18,4)`; quantities are
`NUMERIC(12,3)`. Every table carries the standard audit tail and is `ENABLE`+`FORCE`
RLS. The three restricted cost tables gate every policy on
`iam.has_permission('inv.cost.view')`.

## Reference (`…093000`)

### `inv.units_of_measure` — dual-scope catalog

| Column      | Type | Null | Notes                                                                                  |
| ----------- | ---- | ---- | -------------------------------------------------------------------------------------- |
| `id`        | uuid | no   | PK                                                                                     |
| `scope`     | text | no   | `platform`\|`tenant` (**immutable**)                                                   |
| `tenant_id` | uuid | yes  | **immutable**; CHECK `(platform ⇒ NULL) / (tenant ⇒ NOT NULL)`; FK → `org.tenants(id)` |
| `code`      | text | no   | **immutable**; `^[a-z][a-z0-9_]{0,31}$`; unique per platform / per tenant (partial)    |
| `name`      | text | no   | not blank                                                                              |
| `dimension` | text | no   | `count`\|`mass`\|`volume`\|`length`\|`area`\|`time`                                    |
| `status`    | text | no   | `active`\|`inactive`, default `active`                                                 |

Platform rows are globally readable structural reference (seeded); tenants may add
their own but may never claim/alter/delete a platform row (write policy `scope='tenant'
AND tenant_id=current`, no DELETE grant).

### `inv.item_categories` — tenant taxonomy

| Column               | Type | Null | Notes                                                 |
| -------------------- | ---- | ---- | ----------------------------------------------------- |
| `id`                 | uuid | no   | PK; `UNIQUE(tenant_id, id)`                           |
| `tenant_id`          | uuid | no   | FK → `org.tenants(id)` RESTRICT                       |
| `parent_category_id` | uuid | yes  | composite self-FK; advisory-locked cycle guard        |
| `code`               | text | no   | `^[a-z][a-z0-9_]{1,62}$`; unique per tenant (partial) |
| `name`               | text | no   | not blank                                             |
| `description`        | text | yes  | not blank if present                                  |
| `status`             | text | no   | `active`\|`inactive`, default `active`                |

### `inv.item_master` — stable SKU

| Column             | Type        | Null | Notes                                                                                 |
| ------------------ | ----------- | ---- | ------------------------------------------------------------------------------------- |
| `id`               | uuid        | no   | PK; `UNIQUE(tenant_id, id)`                                                           |
| `tenant_id`        | uuid        | no   | FK → `org.tenants(id)` RESTRICT                                                       |
| `item_category_id` | uuid        | no   | composite FK → `inv.item_categories(tenant_id, id)`                                   |
| `sku`              | text        | no   | **immutable**; `^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$`; unique per tenant (partial)        |
| `name`             | text        | no   | not blank; trigram GIN index `lower(name)`                                            |
| `description`      | text        | yes  | not blank if present                                                                  |
| `uom_id`           | uuid        | no   | FK → `inv.units_of_measure(id)`; `guard_item_uom_scope` (platform or own tenant only) |
| `item_type`        | text        | no   | `part`\|`material`\|`consumable`\|`fluid`\|`kit`, default `part`                      |
| `is_stock_tracked` | boolean     | no   | default `true`                                                                        |
| `is_serialized`    | boolean     | no   | default `false`                                                                       |
| `lifecycle_status` | text        | no   | `active`\|`archived` (terminal), default `active`                                     |
| `archived_at`      | timestamptz | yes  | CHECK `(archived) = (archived_at IS NOT NULL)`                                        |

Customer-supplied parts are **not** item_master rows (see
`inv.customer_supplied_parts`).

### `inv.item_cost_details` — RESTRICTED 1:1 cost

| Column           | Type          | Null | Notes                                                                      |
| ---------------- | ------------- | ---- | -------------------------------------------------------------------------- |
| `id`             | uuid          | no   | PK                                                                         |
| `tenant_id`      | uuid          | no   | FK → `org.tenants(id)` RESTRICT                                            |
| `item_id`        | uuid          | no   | composite FK → `inv.item_master(tenant_id, id)`; unique per item (partial) |
| `standard_cost`  | numeric(18,4) | no   | CHECK `>= 0` — **gated by `inv.cost.view`**                                |
| `currency_code`  | text          | no   | FK → `shared.currencies(code)`                                             |
| `classification` | text          | no   | `restricted` (immutable)                                                   |

Tenant-scoped (its parent is tenant-scoped); every policy adds `AND
iam.has_permission('inv.cost.view')`.

### `inv.stock_locations` — branch-scoped hierarchy

| Column                               | Type | Null | Notes                                                                                                                             |
| ------------------------------------ | ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                 | uuid | no   | PK; `UNIQUE(tenant_id, company_id, branch_id, id)`                                                                                |
| `tenant_id`/`company_id`/`branch_id` | uuid | no   | composite FK → `org.branches(...)`                                                                                                |
| `location_code`                      | text | no   | `^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$`; unique per branch (partial)                                                                   |
| `name`                               | text | no   | not blank                                                                                                                         |
| `location_type`                      | text | no   | **immutable**; `warehouse`\|`storage`\|`quarantine`                                                                               |
| `parent_location_id`                 | uuid | yes  | composite self-FK; warehouse has no parent, storage/quarantine nest under a warehouse in scope (`guard_stock_location_hierarchy`) |
| `status`                             | text | no   | `active`\|`inactive`, default `active`                                                                                            |

## Ledger (`…094000`)

### `inv.stock_movements` — immutable append-only ledger (BR-INV-002)

| Column                               | Type          | Null | Notes                                                                                           |
| ------------------------------------ | ------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `id`                                 | uuid          | no   | PK                                                                                              |
| `tenant_id`/`company_id`/`branch_id` | uuid          | no   | composite FK → `org.branches(...)`                                                              |
| `item_id`                            | uuid          | no   | composite FK → `inv.item_master(tenant_id, id)`                                                 |
| `location_id`                        | uuid          | no   | composite FK → `inv.stock_locations(...)`                                                       |
| `movement_type`                      | text          | no   | `opening`\|`issue`\|`return`\|`damage`\|`adjustment`                                            |
| `direction`                          | text          | no   | `in`\|`out`; type/direction coupling CHECK                                                      |
| `quantity`                           | numeric(12,3) | no   | CHECK `> 0`                                                                                     |
| `signed_qty`                         | numeric(12,3) | no   | **`GENERATED ALWAYS AS`** `(in ⇒ +quantity, out ⇒ -quantity) STORED` — sign cannot be decoupled |
| `reference_kind`                     | text          | no   | `opening_line`\|`part_issue`\|`part_return`\|`damage`\|`adjustment`                             |
| `reference_id`                       | uuid          | no   | the source row id; `UNIQUE(reference_kind, reference_id, direction)` (single-use)               |
| `occurred_at`                        | timestamptz   | no   | event time                                                                                      |
| `actor_id`                           | uuid          | no   | actor                                                                                           |
| `correlation_id`                     | uuid          | yes  | optional                                                                                        |
| `notes`                              | text          | yes  | not blank if present                                                                            |
| `seq`                                | bigint        | no   | `GENERATED ALWAYS AS IDENTITY`                                                                  |

Grants: **SELECT + INSERT only** (no UPDATE/DELETE). Every INSERT passes
`guard_stock_movement_provenance` — the source row must exist in scope, be in its
authorized/terminal state, and bind the movement quantity/direction (see
[phase-1-10-movement-ledger-contract.md](phase-1-10-movement-ledger-contract.md)).

### `inv.stock_balances` — derived, coherence-guarded

| Column                               | Type          | Null | Notes                                                                           |
| ------------------------------------ | ------------- | ---- | ------------------------------------------------------------------------------- |
| `id`                                 | uuid          | no   | PK; `UNIQUE(tenant_id, company_id, branch_id, item_id, location_id)` (one cell) |
| `tenant_id`/`company_id`/`branch_id` | uuid          | no   | composite FK → `org.branches(...)`                                              |
| `item_id`                            | uuid          | no   | composite FK → `inv.item_master(tenant_id, id)`                                 |
| `location_id`                        | uuid          | no   | composite FK → `inv.stock_locations(...)`                                       |
| `on_hand_qty`                        | numeric(12,3) | no   | CHECK `>= 0`; must equal `Σ signed_qty` (coherence guard)                       |
| `reserved_qty`                       | numeric(12,3) | no   | CHECK `>= 0`; must equal `Σ active reservations`                                |
| `available_qty`                      | numeric(12,3) | no   | **`GENERATED ALWAYS AS (on_hand_qty - reserved_qty) STORED`**; CHECK `>= 0`     |

`guard_stock_balance_coherence` (BEFORE INSERT/UPDATE) rejects any forged/incoherent
write (`23514`). Balances are written only as a delta consistent with the just-posted
movement/reservation, under the balance-row `FOR UPDATE` lock.

### `inv.stock_reservations` — atomic reservations (FR-INV-002)

| Column                               | Type          | Null | Notes                                                                                          |
| ------------------------------------ | ------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `id`                                 | uuid          | no   | PK; `UNIQUE(tenant_id, company_id, branch_id, id)`                                             |
| `tenant_id`/`company_id`/`branch_id` | uuid          | no   | composite FK → `org.branches(...)`                                                             |
| `item_id`                            | uuid          | no   | composite FK → `inv.item_master(tenant_id, id)`                                                |
| `location_id`                        | uuid          | no   | composite FK → `inv.stock_locations(...)`                                                      |
| `work_order_id`                      | uuid          | yes  | composite FK → `wo.work_orders(...)`                                                           |
| `quantity`                           | numeric(12,3) | no   | **immutable**; CHECK `> 0`                                                                     |
| `status`                             | text          | no   | `active`\|`released`\|`consumed`\|`expired`; **activeness is status only**, never time-derived |
| `idempotency_key`                    | text          | yes  | **immutable**; `UNIQUE(tenant_id, idempotency_key)` (partial, full lifetime)                   |
| `correlation_id`                     | uuid          | yes  | optional                                                                                       |
| `expires_at`                         | timestamptz   | yes  | explicit expiry (drives `expire_reservations`, not the coherence guard)                        |
| `released_reason`                    | text          | yes  | e.g. `released`, `expired`, `stock_loss`                                                       |

Single-winner last-unit race serialized on the balance-row `FOR UPDATE` lock; a
replay of an existing `idempotency_key` returns the existing reservation (never a raw
`23505`); the genuine race loser gets `23514`.

## Operations (`…095000`)

### `inv.opening_inventory_batches` / `inv.opening_inventory_lines`

Batch: `batch_code` (unique per branch), `as_of_date`, `counted_by`, `approved_by`
(NULL until approved), `approved_at`, `status` `draft`\|`approved`, CHECK `approved_by
<> counted_by` (maker≠approver) and `(approved) = (approved_at IS NOT NULL)`.
`inv.approve_opening_batch` (under batch `FOR UPDATE`) flips draft→approved and posts
one `opening`/`in` movement per line. Line: composite FK to batch/item/location,
`quantity NUMERIC(12,3) > 0`, quantity-only (valuation out of scope), frozen once
approved.

### `inv.stock_adjustments` / `inv.stock_adjustment_details`

Adjustment: `direction` (`in`/`out`), `quantity > 0`, `reason` (not blank),
`requires_approval`, `status` `pending`\|`approved`\|`rejected`, `requested_by`,
`approved_by`, `approved_at`; CHECK `approved_by <> requested_by` and `(approved) =
(approved_at IS NOT NULL)`. `inv.approve_adjustment` posts the `adjustment` movement
**only after** approval (over-threshold stays `pending`); an `out` adjustment first
releases conflicting reservations (H9). Detail (RESTRICTED 1:1, branch-scoped, gated
by `inv.cost.view`): `value_impact NUMERIC(18,4)`, `currency_code`,
`classification='restricted'`.

### `inv.part_issues` / `inv.part_returns`

Issue: composite FK to WO/item/location/reservation, `required_part_ref` (opaque,
later covered by the P1-09 forward FK on `wo.required_parts`), `quantity > 0`. Created
by `inv.issue_part` (requires the WO to exist in scope, `FOR UPDATE`), which posts an
`issue`/`out` movement and consumes the reservation. Return: composite FK to the
issue, `quantity > 0`, optional `reason`. Created by `inv.return_part` under the issue
`FOR UPDATE` lock enforcing `Σ returns ≤ issued`, posting a `return`/`in` movement.

### `inv.damaged_stock`

Composite FK to item + `from_location_id` + `quarantine_location_id` (CHECK
`from ≠ quarantine`), `quantity > 0`, `disposition`
(`quarantined`\|`scrapped`\|`returned_to_supplier`), `reason`, optional
`responsible_party_ref`/`evidence_ref`. `inv.record_damage` releases conflicting
reservations at the sellable location, then posts a **paired** `damage` movement
(`out` of sellable, `in` to quarantine) so damaged units leave sellable availability.

### `inv.customer_supplied_parts`

Composite FK to WO, optional `reception_visit_ref`/`item_ref`/`evidence_ref`,
`description` (not blank), `quantity > 0`, `custody_state`
(`received`\|`in_use`\|`returned`\|`consumed`), optional `item_condition`,
`customer_owned boolean` with CHECK `customer_owned` (always true). **No** stock
movement and **no** balance change — never valued stock.

### `inv.external_purchase_parts` / `inv.external_purchase_part_details`

Part: composite FK to WO, `supplier_partner_id`/`supplier_name` (at least one),
`item_ref` (opaque), `description` (not blank), `quantity > 0`, `status`
(`recorded`\|`linked`\|`cancelled`), `is_procurement boolean` with CHECK
`is_procurement = false` (the structural non-procurement boundary),
`evidence_ref`. Detail (RESTRICTED 1:1, branch-scoped, gated by `inv.cost.view`):
`unit_cost NUMERIC(18,4)`, `currency_code`, `classification='restricted'`.
