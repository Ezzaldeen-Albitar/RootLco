# P1-21-DOC-002 — Change Log and Operator Guidance

**Task:** `P1-21-DOC-002`
**Phase:** P1-21 — Inventory Backend
**Base:** `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2`

## What changed

### New module — `@/modules/inventory`

Owns the whole `inv` schema. Three services over one repository, split by authority:
reads (`inv.stock.read`, `inv.item.read`, `inv.audit.read`), stock mutations
(`inv.stock.operate`), and intake (`inv.adjustment.approve`, `inv.custody.manage`,
`inv.external_purchase.record`).

No other module may read or write an `inv` table; the boundary checker enforces it.
That is not bureaucracy — the balance invariants hold only because every mutation
funnels through the protected `inv` functions that take the balance-row lock first,
so a second module writing `inv.stock_balances` would be a read-then-write race by
construction.

### Fourteen operations

`GET /items`, `GET /stock-availability`, `GET /stock-movements`,
`GET /inventory-reconciliations`, `POST /opening-inventory-batches`,
`POST /opening-inventory-batches/{batchId}/lines`,
`POST /opening-inventory-batches/{batchId}/approval`, `POST /stock-reservations`,
`POST /stock-reservations/{reservationId}/release`, `POST /stock-issues`,
`POST /stock-returns`, `POST /damaged-stock`, `POST /customer-supplied-parts`,
`POST /external-purchase-parts`.

The phase plan proposed colon-action paths such as `/stock-reservations/{id}:release`.
Those are unexpressible: the operation registry's `PATH_PATTERN` accepts only
lower-case literals and `{camelCase}` parameters, so such a route is rejected at
module load. The repository's noun/subresource grammar is the supported equivalent.

OpenAPI moves from 155 paths / 185 operations to **169 / 199** — exactly `+14`, in
both directions.

### Four permissions, and four deliberately not added

Added: `inv.item.read`, `inv.custody.manage`, `inv.external_purchase.record`,
`inv.audit.read`. Catalog total 96 → **100**.

Not added, because an existing code already carries the meaning:
`inv.stock.operate` covers reserve / release / issue / return / damage by its own
catalog description, and `inv.adjustment.approve` covers opening-batch approval.
Minting a near-duplicate would have made the authority model less legible, not more
precise.

`inv.cost.view` is declared by **no** operation, and that is deliberate: it gates the
RLS policies on the two restricted cost tables. Declaring it on
`inv.external-purchase-part-create` would refuse the whole operation to a caller who
supplies no cost at all, which is a different and wrong rule.

### Eleven audit actions, three events

Audit actions cover opening batch creation and approval, reservation and release,
issue, return, damage, custody, external purchase, movement-history read, and
reconciliation. Quantity movements are `privileged` rather than `financial`: Phase
1-10 put valuation out of scope, `inv.stock_movements` carries a quantity and no
amount, and filing a stock issue as a money event would mislead whoever triages the
trail. `inv.external_purchase.recorded` **is** `financial`, because it carries a unit
cost.

Events are `stock.reserved`, `stock.reservation.released`, and
`stock.movement.posted`. The plan proposed `inventory.stock-reserved.v1` and two
siblings; `event_type` carries no version segment (`schema_version` is its own
column) and the established namespace is `stock.*`. One `stock.movement.posted`
carrying `movementType`, `direction`, and the business reference describes issue,
return, damage, and opening postings without four consumers subscribing to four names
for one fact. No `stock.reservation-expired` name is reserved, because no producer
exists for it.

### Database

**No migration.** 119 migrations, no 120, none modified. Schema hash unchanged at
`a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`. Every write uses
an existing `app_runtime` grant or an existing `SECURITY INVOKER` function, so no
database change request was raised.

### Gate

`scripts/p1-21-endpoint-inventory.mjs` (`npm run validate:p1-21-inventory`) enforces
all 28 task identifiers against **artifacts**, not prose — a registered operation, a
seeded-and-declared permission, an audit action with a real producer, a published
event, an exported symbol, or a test title with comments stripped. It reuses the
P1-20 machinery, which had already been hardened three times against the failure mode
where an identifier "resolves" to a comment. `inv.` is registered in **both** hooks of
`check-operation-test-coverage.mjs` — the derived-prefix list and the evidence-parser
alternation — because P1-20 proved that extending one without the other yields a gate
that looks stricter than it is.

## Documents that keep pre-final figures on purpose

`wave-1-contract-archaeology.md` records the protected contract **as read at the
base SHA**, including the three reproduced divergences. It is a point-in-time
finding record and is not updated as the implementation lands; the fixes are
described in the module and route headers and in `regression-package.md`.

## Operator guidance

**Stock only ever appears through an approved opening batch.** There is no
"set stock level" endpoint and there cannot be one: `app_runtime` does hold `UPDATE`
on `inv.stock_balances`, but `inv.guard_stock_balance_coherence` requires `on_hand` to
equal the movement sum, so stock without a movement behind it is unrepresentable.
Approving a batch is a maker-checker act — the counter is the authenticated caller and
may not be the approver.

**Damaged stock is not deleted; it is moved.** A damage record posts a paired
`out`/`in` movement into a quarantine location, so the units leave sellable
availability by changing cell rather than by a flag a query might forget to filter on.
`GET /stock-availability` excludes quarantine unless `includeQuarantine=true`.

**A customer's part is never company stock,** and an external purchase is never a
goods receipt. Both record a reference and change no balance. Both responses say
`affectsStock: false` explicitly so no consumer has to infer it.

**Reservations are advisory until consumed.** Releasing a reservation that an issue
already consumed does nothing and returns no stock — those units left through an `out`
movement and can only come back through a return against the issue.

**If `inventory-reconciliations` ever reports `incoherentCells > 0`, escalate.** That
number is structurally zero while the coherence guard is intact, so a non-zero value
means it was bypassed. The endpoint reports it and never repairs it, because repairing
it would destroy the only evidence that it happened.

## Carried forward

Two obligations earlier phases assigned to P1-21 that sit outside its canonical
15-task scope, recorded rather than silently dropped or half-built:

- **The reservation-expiry scheduler.** `inv.expire_reservations` exists and is
  granted; `inv.reserve_stock` opportunistically expires stale rows for the cell it
  locks. A scheduled caller is not built.
- **`parts_forward_state` closure blockers.** `DEFERRED_CLOSURE_BLOCKERS` in the
  work-order module assigns P1-21 the `active-reservation` and `open-part-issue`
  blockers. Extending the database guard `wo.guard_work_order_closure()` from B1–B6
  would require a migration this phase is not authorized to add.
  `InventoryRepository.countOpenCommitments` supplies the fact an application-level
  blocker would need, and the reconciliation endpoint surfaces it.
