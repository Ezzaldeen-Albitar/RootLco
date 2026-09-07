# P1-30 W10 — inventory setup and opening stock (change-control CC-05)

**Status:** BUILT on `feature/p1-30-w10-inventory-setup`, awaiting the #322 merge before its pull
request opens · **Owner:** P1-30 Frontend lane (`p1-30-frontend` profile) · **Authority:** the
Owner directive of 2026-09-06 and `change-control-2026-09-06.md` CC-05 ("blocking → build")

## 1. What it is

The last screen a fresh organisation lacked before stock could exist through the product. The
F-02 remeasurement (`f02-remeasurement.md`) reduced the inventory half of the acceptance blocker to
three writers, two bundle codes and **one screen**; #322 delivered the writers and the codes, and
this slice delivers the screen — two route pages under `/inventory`:

| route                      | page gate        | offers                                                                                                       |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `/inventory/setup`         | `inv.item.read`  | categories (list + create), units (list), items (create), stock locations per branch (list + create)         |
| `/inventory/opening-stock` | `inv.stock.read` | choose a branch, open a batch, add counted lines, approve — the only path by which stock first appears (C-2) |

The create forms are offered on `inv.item.manage` (which only the server can decide tenant-wide —
a branch-scoped holder is refused 403 and the refusal is rendered); the batch and line forms on
`inv.stock.operate`; the approval on `inv.adjustment.approve`. Every list is the server's page
and every created row is the server's echo — **P1-30 RENDERS SERVER ARITHMETIC ONLY** holds by
construction (the gate finds 0 violations across the five inventory route pages).

## 2. Operations consumed — nothing new on the API

| operation                       | consumed by                      | published by |
| ------------------------------- | -------------------------------- | ------------ |
| `inv.item-category-list`        | setup: categories, item form     | #322         |
| `inv.item-category-create`      | setup: category form             | #322         |
| `inv.uom-list`                  | setup: units, item form          | #322         |
| `inv.item-create`               | setup: item form                 | #322         |
| `inv.stock-location-list`       | setup: locations; opening: lines | A2 S-16      |
| `inv.stock-location-create`     | setup: location form             | #322         |
| `org.branch-list`               | both branch pickers              | P1-14        |
| `inv.item-search`               | opening: the line's item finder  | P1-21        |
| `inv.opening-batch-create`      | opening: batch form              | P1-21        |
| `inv.opening-batch-line-create` | opening: line form               | P1-21        |
| `inv.opening-batch-approve`     | opening: approval                | P1-21        |

Zero migrations, zero permission codes, zero API changes: the `p1-30-frontend` ownership profile
forbids all three and the gate reports 0 violations against the #322 head.

## 3. What the screens say because the API cannot

- **No batch read existed when this screen shipped.** There was no opening-batch list and no detail
  operation (register area C, line C-2). A batch was therefore visible to the opening-stock page only
  through the echoes of the writes that made it, and disappeared from view when the page was left,
  although it persisted on the server. The page states this above the chain and beside the open
  batch, shows the batch id so it can be quoted, and offers the approval on the same page. Building
  a read was a Backend read seam (an A2-shaped slice on `remediation/p1-30-backend-*`), not a
  screen's to invent.

  **Closed 2026-09-07 on the Backend lane** (A0 seam S-17): `inv.opening-batch-list`
  (`GET /opening-inventory-batches`, company and branch required) and `inv.opening-batch-read`
  (`GET /opening-inventory-batches/{batchId}`, with the counted lines) are published on
  `inv.stock.read`, the permission this page already gates on. The screen still renders echoes and
  still carries the statement above; rebuilding it on the two reads is a separate Frontend task.

- **The line create carries no idempotency key, and that is now a decision** (CC-17).
  `inv.opening-batch-line-create` is published without `idempotent: true`, unlike the batch create
  and the approval.

  **Correction, 2026-09-07 — the sentence this record previously carried was false.** It said a
  repeated request "adds a second line". It does not. `uq_opening_inventory_lines_cell` allows one
  live line per item and location inside a batch, so a repeat for the same cell is REFUSED by the
  index — `409 ERR-RES-002` since the mapping landed, and a `500 ERR-SYS-001` with an
  error-monitoring capture before it, which was the real defect. Only a genuinely different cell
  adds a line, and that is a different count rather than a duplicate. The counted cell is therefore
  exactly-once without a key, which is why no key was added: a key would force a header on every
  call, would replay the first answer rather than accept a correction, and would create an
  idempotency-evidence obligation with nothing to prove. The reasoning is written into the route's
  own docblock. Correcting a counted cell — soft-deleting a draft line, or amending a quantity under
  `If-Match` — is a real gap and a separate operation.

- **No tenant unit writer exists** (register B-22). The units section lists the platform set plus
  whatever the organisation holds and says that organisation-specific units cannot be created here
  yet, instead of offering a form that would send nothing.
- **Maker ≠ checker is the server's.** The approval is offered to whoever holds
  `inv.adjustment.approve`; when the server refuses the person who counted (409) the refusal is
  rendered and the page says a second person is needed. Nothing on the client pre-empts it.

## 4. Client-side validation mirrors the server, never replaces it

Codes (`CATEGORY_CODE`, `SKU_CODE`, `LOCATION_CODE`), the ISO date, the quantity shape and the
storage/quarantine-needs-a-warehouse rule are checked before a request so an obviously wrong
value is refused without a round trip; every other rule (unknown or inactive category or unit,
duplicate code or SKU, warehouse-has-no-parent, parent-outside-branch, parent-not-warehouse) is the
server's, answered by the field, and the eleven `form.violation.*` messages added in both
languages render exactly that.

## 5. Payload mirrors

`apps/web/src/lib/contracts/inventory-contract.ts` gains `ItemCategoryCreateBody`,
`ItemCreateBody`, `StockLocationCreateBody`, `OpeningBatchCreateBody` and
`OpeningBatchLineCreateBody`; the approval is already declared BODYLESS. The five PENDING entries
those replace are deleted in the same change (`check-p1-30-payload-parity.mjs`: 70 operations in
scope, 31 mirror interfaces, 9 still pending — damage, intake, credit notes, deliveries — 0
problems).

## 6. Proof

- `apps/web/tests/inventory-setup.dom.test.tsx` — 17 cases: reads on first paint; no form without
  `inv.item.manage`; a category created with the typed body and no empty optional field, listed
  from the echo; a malformed code refused before any request; a server refusal by the field landing
  on that field; an item created from the chosen category and unit with the tracked flag; two
  required pickers refused; "create a category first" when none exist; the location list read for
  the chosen branch and a warehouse created with no parent; a storage place refused without a
  warehouse and then sent with the chosen one; no location read without `inv.stock.read`; a refused
  location read rendered where the list would be; the route page denying before any read, listing
  on `inv.item.read` alone, offering the three forms on `inv.item.manage`, not-found on a locale it
  does not serve; Arabic right-to-left.
- `apps/web/tests/inventory-opening-stock.dom.test.tsx` — 14 cases: the no-batch-read statement;
  nothing offered without operate or approve; the batch opened with the code and date as typed and
  no empty notes, echo rendered, batch form replaced by the line form; a malformed code and an empty
  date refused before sending; a line sent with the found item, the chosen location and the quantity
  as typed, listed from the echo; zero and malformed quantities refused; approval offered only to
  `inv.adjustment.approve` holders; approval rendered with links to the stock and the movements and
  no further lines; the maker ≠ checker refusal shown as one with the batch still a draft; the route
  page denying before any read; Arabic.
- `apps/web/tests/inventory-api.test.ts` — 8 further cases: the two setup reads' paths and refusals;
  every W10 write resolved to its published operation, five requiring the transport key and the
  line create asserted NOT to; the three setup writes' bodies untouched; a refusal by the field with
  its correlation reference; an expired session reported before any request; the batch and line
  routes; the bodyless approval; the counter's conflict.

Web workspace: typecheck clean, lint 0 errors, theme validation 0 unresolvable; gates
`check-p1-28-access` and `check-p1-29-access` pass over the two new route pages (gate before read);
`check-p1-30-server-arithmetic` 0 violations.

## 7. What it does NOT do

No batch list or detail (Backend); no tenant unit writer (B-22); no stock adjustment surface
(PROC-10); no cost anywhere — the item form carries no cost field because `inv.item-create` takes
none. The Owner register's row "Internal inventory parts" moves from Contracted to Delivered only
when this branch and #322 are both on protected `develop`.
