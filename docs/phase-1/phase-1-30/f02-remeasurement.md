# P1-30 F-02 remeasurement at develop `6f6236c3`

**The A0 claim was stale.** The preflight (`a0-read-surface-matrix.md` §1, F-02) recorded eleven
master-data tables in the commercial chain with no in-product writer and routed them back to the
Backend phases. A1 (PR #311, `bf78cea6`) then delivered the service-catalogue half — category
create, service version create, price-list assignment create — and the seven Frontend waves
consumed them. Nobody re-measured the finding afterwards, and the tenant-bootstrap record of
2026-09-06 repeated the eleven-table count. This document is the re-measurement: every entity in
the chain, read on the current head, with the fresh acceptance tenant
`p30_acceptance_ac0zif` (`61647c24-5c46-4d21-be5b-b191b90bf354`) as the product probe.

Method: eight evidence-cited readers, one per entity group (35 entity rows), each claim then
handed to an adversarial verifier. **Eighteen of the thirty-five verifications completed and all
eighteen confirmed the reader**; the remaining seventeen and the synthesis step were cut off by a
session limit, and the load-bearing rows of the incomplete set — the three inventory master
tables, the tax pair, the numbering configuration and the bundle gap — were re-verified by hand
against the route tree, the migrations and the live catalogue before anything below was acted on.

---

## 1. Verdict

Of the eleven tables the preflight named:

| disposition                                              | tables                                                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gained a writer and a screen in A1 / W1–W2**           | `svc.service_categories`, `svc.service_versions`, `svc.price_list_assignments` (and `svc.services`, `svc.price_lists`, `svc.price_list_versions`, `svc.price_rules` beside them) |
| **still no writer — missing implementation**             | `inv.item_categories`, `inv.item_master`, `inv.stock_locations`                                                                                                                  |
| **valid but unconfigured — the chain tolerates absence** | `org.tax_classes`, `org.tax_rates`, `sal.invoice_numbering_configs`, `svc.discount_rules`, `svc.pricing_approval_policies`                                                       |

And two findings the preflight could not have made, because they are about authority rather than
writers:

| gap                                                                                                                                                    | kind          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `inv.adjustment.approve` — approves the opening batch, the ONLY path by which stock appears from nothing — was not in the 65-code administrator bundle | authorization |
| `inv.item.manage` — the write authority for the item catalogue — was not in the bundle either                                                          | authorization |

So the current deficit for a fresh tenant to complete the approved commercial journey was **three
writers, two bundle codes, and one screen** (opening-stock entry). Not eleven tables.

A 404 from `sal.invoice-create` for a work order that does not exist — the boundary probe the
acceptance script ran — establishes nothing about writers; the invoice is built from an accepted
quotation, and the quotation chain is complete (§3).

---

## 2. The matrix

`fresh` = rows the acceptance tenant held at measurement. `bundle` = whether the first
administrator holds the write authority (after PR #321, 65 codes). Every claim is cited in the
reader output; the file:line citations are in the workflow journal and were spot-checked.

| entity / table                               | module          | operation (id · method · path)                                                         | permission · scope                             | bundle | UI                                                       | fresh    | observed failure when absent                                            | depends on                           | class                      | smallest correction                                                  |
| -------------------------------------------- | --------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ | -------------------------------------------------------- | -------- | ----------------------------------------------------------------------- | ------------------------------------ | -------------------------- | -------------------------------------------------------------------- |
| `svc.service_categories`                     | service-catalog | `svc.service-category-create` · POST `/service-categories`                             | `svc.service.manage` tenant-wide               | yes    | services screen, CategoryForm                            | 0        | `svc.service-create` 422 `unknown_category`                             | —                                    | complete                   | none                                                                 |
| `svc.services`                               | service-catalog | `svc.service-create` · POST `/services`                                                | `svc.service.manage`                           | yes    | services screen                                          | 0        | version/availability 404 `ERR-RES-001`                                  | category                             | complete                   | none                                                                 |
| `svc.service_versions`                       | service-catalog | `svc.service-version-create` · POST `/services/{id}/versions`; `-publish`              | `svc.service.manage`                           | yes    | service detail                                           | 0        | quotation line refuses an unsellable service                            | service                              | complete                   | none (no version list read — optional gap)                           |
| `svc.branch_service_availability`            | service-catalog | `svc.branch-availability-set` · POST `/services/{id}/branch-availability`              | `svc.service.manage` branch                    | yes    | service detail                                           | 0        | quotation line refuses at that branch                                   | service, branch                      | complete                   | none                                                                 |
| `svc.price_lists`                            | pricing         | `svc.price-list-create` · POST `/price-lists`                                          | `svc.price.manage`                             | yes    | pricing screen                                           | 0        | `GET /prices` 422 (no book)                                             | —                                    | complete                   | none                                                                 |
| `svc.price_list_versions`                    | pricing         | `svc.price-list-version-create` / `-publish`                                           | `svc.price.manage` / `svc.price.publish`       | yes    | price-list detail                                        | 0        | resolution finds no effective version                                   | price list                           | complete                   | none                                                                 |
| `svc.price_rules`                            | pricing         | `svc.price-rule-record` · POST `/price-lists/{id}/versions/{v}/rules`                  | `svc.price.manage`                             | yes    | price-list detail, RecordRuleForm                        | 0        | resolution finds no rule                                                | version, service                     | complete                   | none                                                                 |
| `svc.price_list_assignments`                 | pricing         | `svc.price-list-assignment-create` · POST `/price-list-assignments`                    | `svc.price.manage` (wildcard tenant-wide)      | yes    | price-list detail, AssignmentForm                        | 0        | `svc.resolve_price` resolves nothing                                    | price list, branch                   | complete                   | none                                                                 |
| `svc.price-resolve` (read)                   | pricing         | `svc.price-resolve` · GET `/prices`                                                    | `svc.price.read` branch                        | yes    | pricing screen, PriceLookupPanel                         | n/a      | 422 until the five writes above exist                                   | all of the above                     | complete                   | none                                                                 |
| `org.tax_classes`                            | organization    | **none**                                                                               | `org.tax.manage` exists; RLS exists            | no     | `/administration/taxes` is a settings-backed placeholder | 0        | none — `price-resolution-service.ts:129-138` tolerates a NULL tax class | company                              | valid-but-unconfigured     | none for the chain; a writer + screen to ever charge tax             |
| `org.tax_rates`                              | organization    | **none**                                                                               | `org.tax.manage`; RLS exists                   | no     | none                                                     | 0        | none — tolerated                                                        | tax class                            | valid-but-unconfigured     | as above                                                             |
| `sal.invoice_numbering_configs`              | billing         | **none**                                                                               | —                                              | —      | `/administration/numbering-rules` placeholder            | 0        | none — `DEFAULT_INVOICE_SEQUENCE` path numbers invoices                 | —                                    | valid-but-unconfigured     | none                                                                 |
| `shared.number_sequences`                    | shared-services | `platform.organization-provision` (PR #321 bootstrap)                                  | control plane                                  | —      | none (no prefix/width screen)                            | 8        | P0002 → 404 on issue/record/quotation                                   | provisioning                         | complete                   | none for a fresh tenant; backfill for pre-#321 tenants (TB-R2)       |
| `sal.payment_methods`                        | payments        | `platform.organization-provision` (PR #321 bootstrap)                                  | control plane                                  | —      | payments screen                                          | 3        | 422 on record                                                           | provisioning                         | complete                   | none; backfill for pre-#321 tenants (TB-R1)                          |
| `inv.item_categories`                        | inventory       | **none**                                                                               | `inv.item.manage` exists; RLS exists           | **no** | none                                                     | 0        | `inv.item-create` impossible; search filter has nothing to pick         | —                                    | **missing-implementation** | POST `/item-categories` + list read; bundle code                     |
| `inv.item_master`                            | inventory       | **none**                                                                               | `inv.item.manage`; RLS exists                  | **no** | search only                                              | 0        | opening line 422/23503; nothing to reserve or issue                     | category, unit                       | **missing-implementation** | POST `/items`; unit list read                                        |
| `inv.stock_locations`                        | inventory       | **none**                                                                               | RLS branch-scoped; no location code            | **no** | list only                                                | 0        | opening line needs `locationId`; nothing to count into                  | branch                               | **missing-implementation** | POST `/stock-locations` under `inv.item.manage` (residual: own code) |
| `inv.units_of_measure`                       | inventory       | platform seed (12 rows); tenant rows: none                                             | `sel_units_of_measure_visible`                 | —      | indirect (uom code inside item rows)                     | 0 tenant | item create needs a `uomId` nothing published                           | —                                    | complete (platform)        | a unit list read                                                     |
| `inv.opening_inventory_batches`              | inventory       | `inv.opening-batch-create` · POST `/opening-inventory-batches`                         | `inv.stock.operate` branch                     | yes    | **none**                                                 | 0        | no stock can be counted in                                              | item, location                       | missing-ui                 | opening-stock screen (Frontend slice)                                |
| `inv.opening_inventory_lines`                | inventory       | `inv.opening-batch-line-create` · POST `…/{batchId}/lines`                             | `inv.stock.operate` branch                     | yes    | none                                                     | 0        | —                                                                       | batch, item, location                | missing-ui                 | same screen                                                          |
| `inv.stock_movements` / `inv.stock_balances` | inventory       | `inv.opening-batch-approve` · POST `…/{batchId}/approval` (the only path from nothing) | `inv.adjustment.approve` branch                | **no** | none                                                     | 0        | 403 for every fresh administrator; maker–checker needs a second person  | batch, a second user                 | **authorization**          | bundle code; the screen's approve action                             |
| `inv.stock_reservations`                     | inventory       | `inv.stock-reservation-create` / `-release`                                            | `inv.stock.operate` branch                     | yes    | W4 ReserveForm                                           | 0        | —                                                                       | balances                             | complete                   | none                                                                 |
| `inv.part_issues` / `inv.part_returns`       | inventory       | `inv.stock-issue-create` / `inv.stock-return-create`                                   | `inv.stock.operate` branch                     | yes    | W5 IssueForm / ReturnForm                                | 0        | —                                                                       | balances, work order                 | complete                   | none                                                                 |
| `quo.quotations` / `_revisions` / `_items`   | quotation       | `quo.quotation-create`, `quo.quotation-revision-create`                                | `quo.quotation.manage` branch (via work order) | yes    | W3 quotation screens                                     | 0        | line refuses an unsellable/unpriced service                             | work order, sellable priced service  | complete                   | none                                                                 |
| `quo.approval_decisions`                     | quotation       | `quo.quotation-item-decide` / `quo.quotation-revision-decide`                          | `quo.decision.record`                          | yes    | W3 DecidePanel                                           | 0        | —                                                                       | issued revision                      | complete                   | none                                                                 |
| `quo.approval_evidence`                      | quotation       | same routes, optional `evidence`                                                       | —                                              | —      | DecidePanel evidence fields                              | 0        | none — optional                                                         | document version for `document` kind | valid-but-unconfigured     | none                                                                 |
| `iam.approval_limits`                        | iam             | `iam.approval-limit-create` · POST `/iam/approval-limits`                              | `iam.approval.manage`                          | yes    | Administration › Approval limits                         | 0        | a discounted line is refused until a limit exists                       | —                                    | complete                   | none (operator configures one for discounts)                         |
| `svc.pricing_approval_policies`              | pricing         | **none**                                                                               | `svc.price.manage`; RLS exists                 | —      | none                                                     | 0        | none — create/issue/accept work; a discount works once a limit exists   | —                                    | valid-but-unconfigured     | none for the chain                                                   |
| `svc.discount_rules`                         | pricing         | **none**                                                                               | `svc.price.manage`; RLS exists                 | —      | none                                                     | 0        | none — dormant: no reader on any executable path                        | —                                    | valid-but-unconfigured     | none; correct the A0 row that ties it to FE-005                      |
| `org.warehouses` / `org.storage_locations`   | organization    | **none**                                                                               | —                                              | —      | none                                                     | 0        | none — superseded in practice by `inv.stock_locations`                  | —                                    | valid-but-unconfigured     | none for the chain; data-dictionary note                             |

---

## 3. The dependency-ordered corrections

For a fresh tenant to complete **service setup → pricing → quotation (issue + accept) → inventory
(stock exists, reserve, issue, return) → invoice (create, issue) → receipt → allocation →
outstanding balance → prints**:

| order | correction                                                                                                | kind                   | owner                       | surface                                      |
| ----- | --------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------- | -------------------------------------------- |
| 1     | `inv.item-category-list`, `inv.item-category-create`                                                      | missing implementation | Backend `inventory` (P1-21) | `remediation/p1-30-backend-commercial-setup` |
| 2     | `inv.uom-list`, `inv.item-create`                                                                         | missing implementation | Backend `inventory`         | same                                         |
| 3     | `inv.stock-location-create`                                                                               | missing implementation | Backend `inventory`         | same                                         |
| 4     | `inv.item.manage` and `inv.adjustment.approve` into `TENANT_ADMINISTRATOR_ROLE` (65 → 67, nothing minted) | authorization          | Backend `iam` bootstrap     | same                                         |
| 5     | inventory setup screen: categories, units, items, locations; opening-stock entry (batch, lines, approval) | missing UI             | Frontend P1-30 corrective   | `feature/p1-30-w10-inventory-setup`          |
| —     | everything else in the chain                                                                              | complete               | —                           | shipped in A1, W1–W7, PR #321                |

Valid-but-unconfigured entities need no correction for the journey. They are recorded as product
gaps for the Owner's register: tax configuration (a writer and a real taxes screen to ever charge
tax), invoice numbering mode, discount rules and approval policies, tenant-specific units.

## 4. Unverified

- Seventeen verifier passes did not complete (session limit). Their rows were re-checked by hand
  where a correction depended on them; the `quo.*`, `inv.stock_reservations`, `inv.part_*` and
  `sal.payment_methods` rows rest on the reader's citations and the W3–W7 suites that already
  exercise those operations.
- Whether store layout deserves an authority distinct from `inv.item.manage` (a
  `inv.location.manage` code) — an A0-style least-privilege decision for the Owner, not made here.
