# P1-30 A0 — the read and write surface, measured once

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: FROZEN 2026-09-03 against protected `develop` `5d6953d1`.** This is the matrix every P1-30
slice builds from. No slice rediscovers an API; a slice that finds this document wrong corrects it
here first.

---

## 0. How this was measured

Every `defineOperation` under `apps/api/src/app/api/v1` whose id begins `svc.`, `quo.`, `inv.` or
`sal.` was read from its route file, its Zod schemas, and the module service and repository it
calls. The permission catalogue is `supabase/seeds/04_iam_permission_catalog.sql`. Every claimed
absence was then proved on a **production build of the same head** (`npm run acceptance:serve`, API
`localhost:3000`) against a real organization provisioned through the product that morning
(`rootlco_w7b`), and against the acceptance database directly for row counts.

**Counts, measured not assumed.** 49 commercial operations — `svc` 11, `quo` 6, `inv` 14, `sal` 18 —
which agrees with the count the canonical plan §1.3 recorded at P1-29's closure. 27 commercial
permission codes. Of the 49, **fourteen are GET reads**; the other thirty-five are writes (34 POST, 1 PATCH).

The financial rule is load-bearing and already holds on the Backend side: money is `numeric(18,4)`,
no `setTypeParser` overrides the driver anywhere in `apps/api/src`, and every commercial repository
returns amounts as decimal strings, so PostgreSQL computes and the wire carries text. The Frontend
half is enforced mechanically from today by `scripts/ci/check-p1-30-server-arithmetic.mjs`
(`P1-30 RENDERS SERVER ARITHMETIC ONLY`), which parses rather than greps and is wired into
`verify:policies`.

---

## 1. Two findings that precede every screen

A0 was commissioned to answer "which reads exist, which are missing". The measurement answered that
(§3–§5) and then found two facts that no screen can be built around, both proved at runtime.

### F-01 — no real organization can hold ANY commercial permission

The tenant administrator the First-Owner bootstrap writes
(`apps/api/src/modules/iam/domain/bootstrap-roles.ts`, `TENANT_ADMINISTRATOR_ROLE`) holds 48
permission codes. **None of the 27 commercial codes is among them.** The delegation rule lets an
actor map or grant only codes it holds itself (`ins_role_permissions_delegable`,
`ins_role_grants_delegable`, migration `20260726090000`), and the bundle is written once, at
provisioning (`tenant-bootstrap-service.ts`); the platform surface is `POST /platform/organizations`
and its status route, so nothing re-applies it to an organization that already exists.

Proved on the production build as the Owner of `rootlco_w7b`:

| act                                            | result                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `iam.role-create`                              | 201, corr `81c36b44-648a-45fc-b66f-6d2bb761f98d`                                                                 |
| `iam.role-permission-add` `quo.quotation.read` | **403 `ERR-IAM-001`, `requiredPermissions ["quo.quotation.read"]`**, corr `3c3938f9-b3a4-4beb-a912-de79be08d494` |
| the same call with `wo.work_order.read` (held) | 201, corr `7736259b-1c0e-48c4-90da-5986e8880bb2`                                                                 |

Four Owner accounts on this environment (44, 46, 48 and 48 codes) hold zero commercial codes between
them. **Until this changes, every P1-30 screen answers 403 for every operator of every tenant**, and
no amount of Frontend work alters that.

### F-02 — eleven master-data tables in the commercial chain have no in-product writer

The commercial chain is: service category → service → service version → price list → price-list
version → price rule → **price-list assignment** → resolved price → quotation → revision → item →
decision → invoice → issue → payment → allocation → receipt. Three links of that chain, and eight
further tables the screens need, are written by **nothing that ships**: not a route, not a SQL
function the API calls, not a migration, not a seed. The complete list of `INSERT INTO` statements in
`apps/api/src` was enumerated and cross-checked against the bodies of the eighteen SQL functions the
commercial repositories call.

| table                           | needed for                                                                                                            | writer in `apps/api` | in a seed | in a migration |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- | -------------- |
| `svc.service_categories`        | `svc.service-create` **requires** an active category id                                                               | none                 | none      | none           |
| `svc.service_versions`          | a service is sellable only with a published version; `svc.service-version-publish` needs a **draft** it cannot create | none                 | none      | none           |
| `svc.price_list_assignments`    | `svc.resolve_price` resolves nothing without one                                                                      | none                 | none      | none           |
| `svc.discount_rules`            | FE-005 discount request                                                                                               | none                 | none      | none           |
| `svc.pricing_approval_policies` | discount authorisation thresholds                                                                                     | none                 | none      | none           |
| `inv.item_categories`           | item master                                                                                                           | none                 | none      | none           |
| `inv.item_master`               | **every** inventory screen; nothing can be searched, reserved, issued or returned                                     | none                 | none      | none           |
| `inv.stock_locations`           | every stock screen; a balance has nowhere to be                                                                       | none                 | none      | none           |
| `sal.invoice_numbering_configs` | `sal.issue_invoice` resolves a sequence (it defaults, so this one is soft)                                            | none                 | none      | none           |
| `org.tax_classes`               | FE-006 tax display                                                                                                    | none                 | none      | none           |
| `org.tax_rates`                 | FE-006 tax display                                                                                                    | none                 | none      | none           |

Confirmed empirically on the acceptance database after two complete acceptance journeys (P1-28
reception through P1-29 closure): every one of those tables holds **0 rows**, as do `svc.services`,
`quo.quotations`, `sal.invoices` and `sal.receipts`. The only populated commercial tables are the two
platform seeds, `inv.units_of_measure` (12) and `sal.payment_methods` (3).

This is the defect class P1-27 named — _declared but never wired_ — sitting under the phase that was
to render it. It is **not** a P1-30 Frontend defect and not a P1-29 regression: it belongs to the
Backend phases that own those tables (P1-20 service catalogue and pricing, P1-21 inventory, P1-22
billing and payments), and the register's own field 13 routes such a finding back to the owning lane
under change control. P1-30 records it, sizes it, and cannot proceed past it.

---

## 2. Runtime proof of the read surface

As the Owner of `rootlco_w7b` on the production build. A 403 proves the route and operation exist and
the permission is the barrier; 405 and 404 prove the shape of the absence.

| request                   | status                       | what it proves                                           |
| ------------------------- | ---------------------------- | -------------------------------------------------------- |
| `GET /services`           | 403 `svc.service.read`       | the list exists                                          |
| `GET /services/{id}`      | **405**                      | no service detail — the id route is `PATCH` only         |
| `GET /price-lists`        | 403 `svc.price.read`         | the list exists                                          |
| `GET /price-lists/{id}`   | **404**                      | no price-list detail                                     |
| `GET /quotations`         | **405**                      | no quotation list — the collection is `POST` only        |
| `GET /invoices`           | **405**                      | no invoice list                                          |
| `GET /payments`           | **405**                      | no receipt list                                          |
| `GET /receipts`           | **404**                      | no such resource (a receipt is read at `/payments/{id}`) |
| `GET /credit-notes`       | **404**                      | no credit-note list                                      |
| `GET /stock-reservations` | **405**                      | no reservation list                                      |
| `GET /deliveries`         | **405**                      | no delivery list                                         |
| `GET /items?q=…`          | 403 `inv.item.read`          | the search exists                                        |
| `GET /stock-availability` | 403 `inv.stock.read`         | exists                                                   |
| `GET /stock-movements`    | 403 `inv.stock.read`         | exists                                                   |
| `GET /payment-methods`    | 403 **`sal.payment.record`** | exists, but a picker read gated by a WRITE code (§7)     |

---

## 3. The read matrix

The fourteen published commercial reads, with what a screen actually receives.

| operation                           | route                                   | permission                                | scope                                                          | paging                                           | a screen receives                                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svc.service-list`                  | `GET /services`                         | `svc.service.read`                        | tenant (branch re-checked when `availableAtBranchId` is given) | keyset `cursor`/`limit` ≤100                     | `{id, serviceCode, name, description, categoryId, lifecycleStatus, recordVersion}`. **No price, no category name, no version.** Filters: `categoryId`, `lifecycleStatus`, `availableAtBranchId`, `effectiveOn`, prefix `search` |
| `svc.price-list-list`               | `GET /price-lists`                      | `svc.price.read`                          | tenant                                                         | **bounded, not paged** (`limit` ≤100, no cursor) | price-list headers `{id, priceListCode, name, currency, description, status, recordVersion}`. No versions, no rules, no amounts                                                                                                 |
| `svc.price-resolve`                 | `GET /prices`                           | `svc.price.read`                          | branch (on the named company/branch)                           | n/a                                              | one `ResolvedPrice` `{asOf, unitPrice, currency, taxRate, taxClassId, taxClassCode, …}` — decimal strings. **Answers `ERR-VAL-001` "no price configured" for every service today (F-02)**                                       |
| `quo.quotation-detail`              | `GET /quotations/{id}`                  | `quo.quotation.read`                      | branch (row)                                                   | n/a                                              | the quotation header and **exactly one** revision (the current, else the latest) with its priced lines; four totals as decimal strings; `recordVersion` as `ETag`                                                               |
| `inv.item-search`                   | `GET /items`                            | `inv.item.read`                           | tenant                                                         | keyset                                           | `{id, itemCategoryId, sku, name, description, unitOfMeasure{id,code}, itemType, isStockTracked, isSerialized, lifecycleStatus, recordVersion}`. **Zero rows for every tenant today (F-02)**                                     |
| `inv.stock-availability-read`       | `GET /stock-availability`               | `inv.stock.read`                          | branch (required `companyId`+`branchId`)                       | keyset                                           | `{itemId, sku, locationId, locationCode, locationType, onHand, reserved, available}` as decimal strings — only for cells that already have a balance                                                                            |
| `inv.stock-movement-list`           | `GET /stock-movements`                  | `inv.stock.read`                          | branch                                                         | keyset on `seq` desc                             | the ledger `{id, sequence, itemId, sku, locationId, movementType, direction, quantity, signedQuantity, reference{kind,id}, occurredAt}`; filters incl. `workOrderId`, `referenceKind`, dates                                    |
| `inv.inventory-reconciliation-read` | `GET /inventory-reconciliations`        | `inv.audit.read` (**high**)               | branch                                                         | n/a                                              | reconciliation evidence and commitment counts                                                                                                                                                                                   |
| `sal.invoice-preview`               | `GET /work-orders/{id}/invoice-preview` | `sal.invoice.manage` + `sal.finance.view` | branch                                                         | n/a                                              | the invoice a work order _would_ produce: lines with descriptions, `serviceId`/`itemId`, quantities and every total. The only read carrying line descriptions                                                                   |
| `sal.invoice-detail`                | `GET /invoices/{id}`                    | **`sal.invoice.manage`**                  | branch                                                         | n/a                                              | header, status, number, `issuedAt`, totals and lines (money `null` without `sal.finance.view`); `ETag` = the `If-Match` for issue/cancel. **Lines carry no description**                                                        |
| `sal.invoice-outstanding-read`      | `GET /invoices/{id}/outstanding`        | `sal.finance.view`                        | branch                                                         | n/a                                              | `{invoiceId, status, outstanding{amount,currency}, isSettled}`                                                                                                                                                                  |
| `sal.receipt-detail`                | `GET /payments/{id}`                    | `sal.finance.view`                        | branch                                                         | ≤100 allocations, **no cursor**                  | `{reference, payerPartnerId, method{…}, money, unallocated, status, receivedAt, allocations[…], recordVersion}`                                                                                                                 |
| `sal.payment-method-list`           | `GET /payment-methods`                  | **`sal.payment.record`**                  | tenant                                                         | n/a                                              | the platform and tenant methods, each with `recordable`                                                                                                                                                                         |
| `sal.delivery-eligibility-read`     | `GET /deliveries/{id}/eligibility`      | `sal.delivery.view` + `sal.finance.view`  | branch                                                         | n/a                                              | delivery eligibility and its blocking reasons                                                                                                                                                                                   |

_(All fourteen `GET` operations of the four domains. Three of them — `sal.invoice-preview`,
`sal.delivery-eligibility-read` and `sal.payment-method-list` — live in folders whose other
operations write.)_

## 4. The write matrix — what is already sufficient

Thirty-eight commercial writes exist and **P1-30 needs no new mutation** for its scope except the
prerequisites of §6. Contract facts they share, verified in `route-handler.ts`, `idempotency.ts` and
`concurrency.ts`:

- `idempotent: true` makes `Idempotency-Key` **required** (8–200 chars; `ERR-INT-002` without it;
  the fingerprint binds method, path template, params and body, so a replay with a different body is
  `ERR-INT-001`). Every commercial `POST` except three list-shaped reads is idempotent.
- `versionGuarded: true` makes `If-Match` **required** (`ERR-CON-002` without it; a positive integer
  or `W/"n"`; no wildcard), compared against the locked row's `record_version` (`ERR-CON-001` on
  mismatch). It applies to `svc.service-update`, `quo.quotation-revision-create`,
  `quo.quotation-issue`, `sal.invoice-issue`, `sal.invoice-cancel` and the delivery completion.
- Money bodies are decimal strings validated tighter than the shared catalogue (`sal` money is
  `numeric(18,4)`, unsigned, ≤14 integer digits): exceeding scale is refused rather than rounded,
  because PostgreSQL would round silently on the cast.
- Terminal states are terminal: an archived service refuses every write (`ERR-TRN-001`), a published
  price-list version and a published template version are frozen, an issued invoice cannot be
  re-issued, an allocation cannot be reversed (no refund route exists — P1-22-L-05).

## 5. The screen matrix

Against the register's twenty-one Frontend tasks. "Existing" is judged **for a real operator of a
real tenant**, so F-01 and F-02 are counted where they bite.

| task                       | reads it needs                                                                    | writes it needs                                                           | existing   | the gap                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FE-001 service catalog     | `svc.service-list`, `org.branch-list`                                             | `svc.service-create`, `svc.service-update`, `svc.branch-availability-set` | partial    | no category list and **no category writer**; no service detail; no service-version writer, so nothing is sellable                                                                                |
| FE-002 price lists         | `svc.price-list-list`, `svc.price-resolve`                                        | the four price-list writes                                                | partial    | no price-list detail, no versions list, no rules list; **no assignment writer**, so `svc.price-resolve` resolves nothing                                                                         |
| FE-003 quotation builder   | work-order reads, `svc.service-list`, `svc.price-resolve`, `quo.quotation-detail` | `quo.quotation-create`, `quo.quotation-issue`                             | partial    | no quotation list and no quotations-by-work-order — the id exists only in a create response                                                                                                      |
| FE-004 quotation versions  | `quo.quotation-detail`                                                            | `quo.quotation-revision-create`                                           | partial    | one revision only; superseded, rejected and expired revisions are unreadable                                                                                                                     |
| FE-005 discount request    | `quo.quotation-detail`, `iam.approval-limit-list`                                 | `quo.quotation-create`                                                    | partial    | there is **no discount-request resource**: the discount is authorised or refused synchronously inside the quotation write. No pending state, no approve step, and no `svc.discount_rules` writer |
| FE-006 tax display         | `svc.price-resolve`, `quo.quotation-detail`, the invoice reads                    | —                                                                         | yes (read) | the rate is always `0.000000`: `org.tax_classes`/`org.tax_rates` are empty with no writer                                                                                                        |
| FE-007 approval display    | `quo.quotation-detail`                                                            | the two decision writes                                                   | partial    | no read of per-line decisions or evidence — they appear only in the 201 body of the write                                                                                                        |
| FE-008 item search         | `inv.item-search`                                                                 | —                                                                         | yes (read) | zero items can exist (**no `inv.item_master` writer**); category is an id with no list; no item detail                                                                                           |
| FE-009 stock balance       | `inv.stock-availability-read`                                                     | —                                                                         | yes (read) | zero locations can exist (**no `inv.stock_locations` writer**); no location list                                                                                                                 |
| FE-010 reservations        | availability, item search, work-order reads                                       | `inv.stock-reservation-create`, `…-release`                               | partial    | **no reservation read of any kind** — a reservation is visible only as an aggregate or a count                                                                                                   |
| FE-011 issues              | `wo.required-part-list`, movements                                                | `inv.stock-issue-create`                                                  | partial    | no part-issue read; the ledger gives ids but no `reservationId`, location code or returned-so-far                                                                                                |
| FE-012 returns             | movements                                                                         | `inv.stock-return-create`                                                 | partial    | "returned so far / remaining" exists only in a return's own 201 body                                                                                                                             |
| FE-013 stock movements     | `inv.stock-movement-list`                                                         | —                                                                         | yes (read) | `locationId` without a code; no `reference_id` filter                                                                                                                                            |
| FE-014 invoice preview     | `sal.invoice-preview`                                                             | `sal.invoice-create`                                                      | yes (read) | the screen cannot tell whether an invoice already exists for the work order                                                                                                                      |
| FE-015 invoice issue       | `sal.invoice-detail`                                                              | `sal.invoice-issue`, `sal.invoice-cancel`                                 | partial    | no invoice list and no invoice-for-work-order — the id exists only in a create response                                                                                                          |
| FE-016 payment form        | `sal.payment-method-list`, outstanding, invoice detail                            | `sal.payment-record`, `sal.payment-allocate`                              | partial    | no invoice list, no invoices-by-partner, no open-receivables list: the cashier must already hold the invoice id                                                                                  |
| FE-017 partial payment     | outstanding, receipt detail                                                       | `sal.payment-allocate`                                                    | yes        | allocations are append-only and no reversal route exists; the screen must say so                                                                                                                 |
| FE-018 receipt             | `sal.receipt-detail`                                                              | —                                                                         | partial    | no receipt list, no receipts-by-partner, no allocations-by-invoice                                                                                                                               |
| FE-019 outstanding balance | `sal.invoice-outstanding-read`                                                    | —                                                                         | yes        | the partner-level balance view is exposed by no route (recorded, not needed by the plan)                                                                                                         |
| FE-020 invoice print       | invoice detail + preview                                                          | —                                                                         | partial    | invoice lines carry **no description**; the only descriptions come from the preview, which recomputes from the quotation                                                                         |
| FE-021 receipt print       | receipt detail, invoice detail                                                    | —                                                                         | partial    | no cashier name; invoice numbers need a second read per allocation                                                                                                                               |

Every task is blocked by F-01 in addition to whatever its own row says.

## 6. The seams, classified

Preference order `A → B → C`; `D` requires a proven schema fault and none was found. `A` = an
existing repository or service read is merely unpublished; `B` = an existing model needs a thin
route; `C` = a new read model or write path is required.

### 6.1 Authority and master data — the prerequisites (no screen works without these)

| #    | seam                                                                      | class | what it is                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | the commercial permission set for a tenant                                | C     | F-01. The administrator bundle must carry the commercial codes a P1-30 operator needs, derived the way P1-29's 48 were derived — by walking the routes the twenty-one tasks call — **and** organizations provisioned before the change need a path to receive them. Owner decision territory: it widens the finite administration set P1-29 froze |
| S-02 | `svc.service-category-list` + `svc.service-category-create`               | B     | the row shape and its projection exist (`findCategory`); the list wrapper and a writer do not. Without the writer `svc.service-create` cannot be called at all                                                                                                                                                                                    |
| S-03 | `svc.service-version-create` (draft)                                      | C     | `svc.service-version-publish` needs a draft nothing can create; without it no API-created service is ever sellable and every quotation line is refused                                                                                                                                                                                            |
| S-04 | price-list **assignment** write                                           | C     | `svc.resolve_price` requires an active assignment row; nothing writes that table, so every price resolution fails                                                                                                                                                                                                                                 |
| S-05 | `inv.item_master` + `inv.item_categories` + `inv.stock_locations` writers | C     | the inventory half of the phase has no items, no categories and no places. Every FE-008…FE-013 screen renders an empty product without them                                                                                                                                                                                                       |
| S-06 | `org.tax_classes` / `org.tax_rates` writers                               | C     | FE-006 displays a real rate only when one can exist                                                                                                                                                                                                                                                                                               |

S-02…S-06 are ordinary Backend work owned by P1-20, P1-21 and P1-11, entering P1-30 as prerequisites
on the `remediation/p1-30-backend-` lane. S-01 is different in kind and is set out below.

#### S-01, derived

The method is not new. P1-29 derived its administrator set "by walking every route the W1–W8
experiences call" (`bootstrap-roles.ts`), and widened it once — 44 codes to 48 — when the acceptance
proved four were missing. Walking the routes the twenty-one P1-30 tasks call yields **24 commercial
codes**, every one already in the catalogue:

`svc.service.read` · `svc.service.manage` · `svc.price.read` · `svc.price.manage` ·
`svc.price.publish` · `quo.quotation.read` · `quo.quotation.manage` · `quo.decision.record` ·
`inv.item.read` · `inv.stock.read` · `inv.stock.operate` · `inv.adjustment.approve` ·
`inv.custody.manage` · `inv.external_purchase.record` · `inv.audit.read` · `sal.invoice.manage` ·
`sal.invoice.issue` · `sal.finance.view` · `sal.payment.record` · `sal.payment.allocate` ·
`sal.credit.manage` · `sal.delivery.manage` · `sal.delivery.view` · `sal.delivery.complete`

Three catalogue codes are **not** reachable by the walk and are therefore not proposed:
`inv.cost.view` (a field-level gate on cost and margin, risk **high** — the P1-10 contract says those
fields render only with it, so holding it by default would defeat the split the contract asks for),
`inv.item.manage` (declared by no route — the item master has no writer, which is F-02), and
`sal.reversal.approve` (no reversal route exists; P1-22-L-05 records the absence).

Two questions the derivation cannot answer, and which are the Owner's:

1. **Should one role hold all 24?** They span selling, stock operations, invoicing and cash. The
   P1-29 set already mixes duties on the same reasoning — an administrator must hold a code to
   delegate it — but `sal.finance.view` and `inv.audit.read` are the codes P1-11 and P1-21 designed
   the amount-hiding and audit splits around.
2. **What happens to organizations provisioned before the change?** The bundle is written once, at
   provisioning; nothing re-applies it. A fresh organization gets the new set; an existing one does
   not, and no route can widen it. That is a separate remediation whether or not question 1 is
   answered generously.

### 6.2 Read seams

| #    | seam                                  | class | operation                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-07 | quotations by work order              | B     | `quo.quotation-list`, `GET /work-orders/{workOrderId}/quotations`, `quo.quotation.read`, branch, keyset                                                                                                                                                                                                                                                                                        |
| S-08 | revision history and revision by id   | B     | `quo.quotation-revision-list` `GET /quotations/{id}/revisions` (headers only) and `quo.quotation-revision-detail` `GET /quotation-revisions/{id}` (the lines-bearing drill-down). **Corrected by §6.3:** `listRevisions` and `findRevision` are NOT unrouted — `quo.quotation-detail` reaches both — so this is class B, and the real gap is that the detail returns only the CURRENT revision |
| S-09 | per-line decisions and evidence       | C     | `quo.quotation-revision-decisions-read`, `GET /quotation-revisions/{id}/decisions`, bounded                                                                                                                                                                                                                                                                                                    |
| S-10 | the invoice a work order has          | **A** | `sal.work-order-invoice-read`, `GET /work-orders/{workOrderId}/invoice` — `liveInvoiceForWorkOrder` exists, unrouted; at most one row by unique index                                                                                                                                                                                                                                          |
| S-11 | receipts by scope, partner or invoice | B     | `sal.receipt-list`, `GET /payments`, `sal.finance.view`, keyset                                                                                                                                                                                                                                                                                                                                |
| S-12 | service by id                         | **A** | `svc.service-detail`, `GET /services/{serviceId}` — `ServiceCatalogService.detail` exists, unrouted                                                                                                                                                                                                                                                                                            |
| S-13 | price-list detail, versions and rules | C     | `svc.price-list-detail` and `svc.price-rule-list`, `svc.price.read`                                                                                                                                                                                                                                                                                                                            |
| S-14 | reservations                          | B     | `inv.stock-reservation-list`, `GET /stock-reservations`, `inv.stock.read`                                                                                                                                                                                                                                                                                                                      |
| S-15 | part issues with returned-so-far      | B     | `inv.work-order-part-issue-list`, `GET /work-orders/{workOrderId}/part-issues`, `inv.stock.read` — `readPartIssue` already computes the returned sum in SQL. **Corrected by §6.3:** the collection shape `GET /stock-issues` filtered only by `workOrderId` would be scope-INERT (P1-18-A-01); the per-parent path pins the scope from the row                                                 |
| S-16 | stock locations                       | B     | `inv.stock-location-list`, `GET /stock-locations`, `inv.stock.read`                                                                                                                                                                                                                                                                                                                            |

Two of the ten read seams are class **A** — `sal.work-order-invoice-read` (S-10) and
`svc.service-detail` (S-12): the read already exists as a service method and is only unpublished.
S-08 was classified A and corrected to B by the adversarial pass (§6.3).

### 6.3 Adversarial review

The refutation pass re-read every seam against the code rather than against this document. It
produced two corrections, both applied to §6.2 above:

- **S-08 was class A and is class B.** `listRevisions` and `findRevision` are not unrouted —
  `quo.quotation-detail` reaches both. The real gap is narrower and different in kind: the detail
  returns only the current revision, so history needs a route, not a read model.
- **S-15's collection shape was scope-inert.** `GET /stock-issues` filtered only by `workOrderId`
  repeats P1-18-A-01: the filter is caller-controlled and the scope is not pinned by the row. The
  per-parent path `GET /work-orders/{workOrderId}/part-issues` pins it.

**The attack phase of that pass did not execute.** Both of its agents terminated at zero tokens and
zero tool calls; only the classification and refutation phases ran. The two lanes lost were
`attack:administrator-bundle` and `attack:completeness` — precisely the checks that would have tested
whether F-01 was correctly bounded. This section is written knowing that, and the bundle attack was
re-run by hand afterwards.

#### The re-run bundle attack — F-01 is wider than §1 states

Cross-referencing `TENANT_ADMINISTRATOR_ROLE.permissionCodes` (48) in
`apps/api/src/modules/iam/domain/bootstrap-roles.ts` against the 23 permission gates in
`apps/web/src/config/navigation.ts` and the 118-code catalogue in
`supabase/seeds/04_iam_permission_catalog.sql`: **12 of the 23 gates are not held.**

| disposition                                  | codes                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| deliberate (named in the bootstrap docblock) | `iam.approval.manage`, `crm.customer.duplicate.review`, `veh.vehicle.duplicate.review`                                  |
| recorded elsewhere                           | `org.settings.manage` (W9-R2), `sal.invoice.read` and `sal.delivery.read` (RES-05 — absent from the catalogue entirely) |
| commercial — F-01's own                      | `inv.item.read`, `svc.service.read`                                                                                     |
| **undocumented and unrecorded**              | `apt.appointment.read`, `iam.audit.view`, `rpt.report.read`, `shared.notification.read`                                 |

The last four gate surfaces of phases the Owner has already accepted — appointments (P1-28), the
audit log (P1-26), reporting and notifications (P1-23). The bundle holds **zero** `apt.*` codes while
four exist in the catalogue.

The cause is the derivation method, not the codes: the 48 were derived by walking the routes the
P1-29 W1–W8 experiences call, and a walk of one phase's journey cannot see another phase's
navigation. **§6.1's S-01 derivation uses the same method and inherits the same blind spot** — it
walks the twenty-one P1-30 tasks. A bundle derived against `navigation.ts`, which is the actual
reachability surface, would not.

This does not change A1's scope. It changes what S-01 must decide: not "which commercial codes does
an administrator need", but "which codes does an administrator need, and how does an organization
already provisioned receive them" — a question that now has four non-commercial codes in it, and one
that outlives P1-30.

## 7. Least-privilege review

- `sal.payment-method-list` requires **`sal.payment.record`** — a write code for a picker read. A
  cashier composing a payment holds it, but a screen that merely displays a receipt's method does
  not. Recorded as a least-privilege gap; the correction is a read code, and the decision belongs to
  the Backend lane that owns `sal`.
- `sal.invoice-detail` requires **`sal.invoice.manage`** while `sal.invoice-outstanding-read`
  requires only `sal.finance.view`. The two reads of the same invoice disagree about who may see it.
  New read seams follow `sal.finance.view` (the narrower, and the code every consumer's next command
  already needs), which is why S-10 and S-11 declare it.
- `inv.inventory-reconciliation-read` is `inv.audit.read` (**high**). No P1-30 screen should reach
  for it where `inv.stock.read` serves; S-14…S-16 all declare `inv.stock.read`.
- No seam mints a permission code. If S-01's derivation shows a code is missing from the catalogue,
  that is a separate, declared act on the Backend lane.

## 8. Financial contract review

Authoritative server-returned decimal strings a P1-30 screen displays and never computes:
`ResolvedPrice.unitPrice` and `taxRate`; the quotation revision's `subtotal`, `discountTotal`,
`taxTotal`, `grandTotal` and each line's `unitPrice`, `quantity`, `discount`, `taxRate`, `taxAmount`,
`lineTotal`; the invoice's `net`, `tax`, `gross` per line and in total, and the payer split; the
outstanding `amount`; the receipt's `amount` and `unallocated`; every inventory quantity
(`numeric(12,3)`, likewise a string).

The web already carries these correctly: `apps/web/src/lib/money.ts` forbids `Number`, `parseFloat`,
arithmetic and `toFixed` on money and confines `Intl.NumberFormat` to `formatMoney`, and
`MoneyField` submits the canonical string. From today
`scripts/ci/check-p1-30-server-arithmetic.mjs` refuses any of that inside a P1-30 area by parsing the
TypeScript rather than reading it as text; it runs in `verify:policies`, examines zero files at A0
and says so, and the phase's completion condition raises its floor.

## 9. Execution order

Dependency order, not the label order the plan sketched. Nothing after A1 can be usefully built
before A1 lands.

| slice  | what                                                                                       | gated on                                             |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **A0** | this matrix, the two ownership lanes, the server-arithmetic gate                           | —                                                    |
| **A1** | the master-data and authority prerequisites: S-02…S-06, and the Owner decision behind S-01 | A0                                                   |
| **A2** | the read seams S-07…S-16, one branch per coherent business read                            | A1 (a read of rows that cannot exist proves nothing) |
| **A3** | service catalogue and pricing screens (FE-001, FE-002, FE-006)                             | A1, A2                                               |
| **A4** | quotation and approval screens (FE-003, FE-004, FE-005, FE-007)                            | A3                                                   |
| **A5** | inventory and parts screens (FE-008 … FE-013)                                              | A1, A2                                               |
| **A6** | invoice and billing screens (FE-014, FE-015, FE-019, FE-020)                               | A4                                                   |
| **A7** | payment and receipt screens (FE-016, FE-017, FE-018, FE-021)                               | A6                                                   |
| **A8** | security, QA, documentation evidence; Owner acceptance on a production build               | all                                                  |

## 10. What this document does not claim

It does not claim the twenty-one screens are designable today: F-01 and F-02 say they are not, and
A1 exists to change that. It does not decide S-01, which widens a set the Owner froze during P1-29.
It records the surface as it stood at `develop` `5d6953d1`; a later figure supersedes these by
measurement, not by edit.
