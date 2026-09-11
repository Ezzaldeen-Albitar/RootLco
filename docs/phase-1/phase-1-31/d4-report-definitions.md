# P1-31 — D-4 report definitions and their column-to-contract mapping

**Status:** PARTIALLY IMPLEMENTED — engine slice 1 of 4 is implemented on
`remediation/p1-31-backend-report-engine-work-orders` (PR #364) and is unmerged; slices 2–4 have not
started · **Authority:** Owner decision **D-4**, taken 2026-09-09, which defines four baseline
reports and their required columns · **Measured at:** protected `develop` `249c6428`, 2026-09-09 · **Companions:**
[`a0-preflight.md`](./a0-preflight.md) (the P-11 row), [`task-matrix.md`](./task-matrix.md)
(FE-011 … FE-014 rows), `docs/product/owner-requirements-2026-09-06.md` (OWR-2026-09-06-A-12)

## What this record is, and what it is not

The report catalogue service states in its own source that inventing a binding from a report code to
a data source would mean inventing a business report definition the Product Owner has not approved.
That is why D-4 existed as an open decision and why no such binding was written. **The Owner approved the four baseline reports and their required columns**, recorded in `owner-decisions-2026-09-09.md` §3. This record maps those approved requirements to the contracts that supply them or the prerequisites that must exist first. The source mapping is an engineering assessment; it does not narrow the approved columns.

Three honesty rules apply throughout:

- **The four report definitions and required columns are the Owner's.** Contract mappings and explicitly marked proposals are this record's engineering assessment. The full approved column lists in `owner-decisions-2026-09-09.md` §3 remain authoritative.
- **No figure appears anywhere in this document.** A report definition is a shape; a number in a
  definition document is a fabricated measurement.
- **An unknown is written as a named prerequisite, never as a value.** Where a column has no source,
  the row says which read must be built, in which module, and what it must return.

The two questions the cross-cutting section once carried as proposals — the period convention and
the timezone — were approved by the Owner on 2026-09-10. One question there remains a
**recommendation pending Owner approval**: which SOURCE column supplies the branch timezone. It is
not an engineering detail: it changes what a figure means.

---

## Cross-cutting: the shape every one of the four takes

### The engine is a code-registered dataset registry

The shape is the Owner's PLANNED proposal **OWR-2026-09-06-A-12**, adopted here as an engineering
choice — the Owner's register carries it as "Proposed implementation policy · Planned"
(`docs/product/owner-requirements-2026-09-06.md:198`) rather than as an approved requirement: a
report definition binds a
`report_code` to a **code-registered dataset** — a frozen registry inside the reporting module,
mirroring the export resource registry — declaring the operation or table, the allowed filters, the
required permission codes and the scope. Tenant configuration may select, name, scope and version a
registered dataset. It may never supply a query, a table name or a column.

This matters for what follows: **the four reports below are four registry entries, not four
queries.** A report that needs data no registered dataset can serve is a report waiting on a
prerequisite read, which is why each section ends with one.

The named prerequisites are:

- **P-11** — the reporting writer and the report engine. The writer merged in PR #361. **Engine
  slice 1 of 4 — this registry, the run operation and `work_orders_by_status` — is implemented on
  `remediation/p1-31-backend-report-engine-work-orders` (PR #364) and is NOT merged.** **Engine
  slice 2 — `technician_labor_time` — is implemented on
  `remediation/p1-31-backend-report-engine-datasets`, which is STACKED on that branch and is
  likewise NOT merged and carries no hosted result. Engine slices 3 and 4 —
  `inventory_movements` and `invoice_payment_summary` — are implemented on the same branch and are
  equally unmerged.** All four datasets D-4 approves now exist in code; none of them has a hosted
  result, and none of the four screens has been started.
- **P-12** — the export operation. Not started, and `rpt.export` remains withheld from the
  provisioning bundle on the Owner decision recorded as **CC-04**.

### Every run operation must declare scope `branch`

Not `tenant`. A tenant-scoped operation is evaluated **scope-blind**: `requiresScopedEvaluation` in
`apps/api/src/server/auth/authorization.ts` returns false for `tenant` before it ever looks at the
target, so a company or branch named in the request is not consulted when the permission is
evaluated. A branch-scoped report run that declared `tenant` would therefore be authorized against
the permission-blind union of every grant its caller holds, while its query filtered to one branch —
the two would agree for a single-branch operator and diverge silently for everyone else.

### Period semantics — APPROVED 2026-09-10; one recommendation remains

**The Owner approved, on 2026-09-10:** half-open `[from, to)` periods in the selected branch's
timezone, converted consistently for server queries; the timezone and the filter context displayed
and preserved wherever a result is shown; and cross-branch reporting under one explicit reporting
timezone, never a silent mixing of local periods. The record is
[`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) § 4, which reached this branch
with the protected `develop` `01c32937` sync.

**Engineering consequence (not an Owner decision).** A half-open bound is not what the platform's one
existing period filter gives: the work-order list is closed on both ends and therefore cannot be
reused as-is for a report (see the first report below). A helper converting a local calendar period
into UTC query bounds is a named prerequisite.

**Recommendation pending Owner approval.** Which SOURCE column supplies "the selected branch's
timezone" is not settled. The recommendation is `org.branches.timezone_name`, `NOT NULL` on every
branch and referencing the approved zone list. The alternative is the tenant default,
`org.tenants.default_timezone`, also `NOT NULL`, which gives one answer across a multi-branch
organisation at the cost of splitting a branch's own working day.

### Freshness and drill-through

- **Freshness: live query.** No materialisation, no cache, no scheduled refresh. A cached report
  needs an invalidation rule per dataset and an "as at" label on screen; neither exists, and a stale
  figure with no label is worse than a slower one.
- **Drill-through: the existing detail routes.** Each report's identifier column links to the screen
  that already renders that record. No report introduces a detail view of its own.

---

## 1. `work_orders_by_status`

**Owner's text:** work orders by status.

### Columns and their contracts

| column            | source                                                                   | status                                                                      |
| ----------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| state             | `wo.work_orders.state`, exposed as `state` on `WorkOrderSummary`         | available                                                                   |
| count per state   | —                                                                        | **prerequisite.** No server count-by-status exists anywhere in the platform |
| work-order number | `displayNumber` — nullable, and the absence is real                      | available                                                                   |
| opened            | `openedAt`                                                               | available                                                                   |
| customer          | the customer block on `WorkOrderSummary`, carrying the relationship role | available; nullable by contract, and the absence must render                |
| vehicle           | the vehicle block on `WorkOrderSummary`                                  | available                                                                   |
| branch            | `branchId`                                                               | available as an identifier; a branch NAME needs the organisation read       |
| state label       | `wo.work_order_states.name`                                              | **single `text` column — there is no bilingual label.** See below           |

### Named prerequisites

1. **A `wo.work-order-status-summary` read, inside the work-order module.** A `GROUP BY state` over
   the scoped selection, returning the counts **and** the paged rows. It must live in the work-order
   module because ADR-001 keeps the `wo.*` tables private to it; a reporting module that queried them
   directly would be the boundary violation the module rule exists to prevent.
2. **Its own period predicate.** `wo.work-order-list` filters `opened_at >= from AND opened_at <= to`
   — closed on both ends. The proposed report period is half-open, so the summary read owns its own
   `[from, to)` predicate rather than borrowing the list's.
3. **A decision on the state label.** `wo.work_order_states.name` is one `text` value. An Arabic
   report either shows that value untranslated or the label comes from the interface catalogue keyed
   by `code`. This is a presentation decision with a data consequence and is not taken here.

---

## 2. `technician_labor_time`

**Owner's text:** technician labour time.

### Columns and their contracts

| column                  | source                                             | status                                                                       |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| technician              | `tech.labor_sessions.technician_profile_id`        | available as an identifier; a name needs the technician profile read         |
| session start / end     | `started_at`, `ended_at`                           | available                                                                    |
| duration                | —                                                  | **prerequisite. There is no duration column.** It is `ended_at - started_at` |
| work order              | —                                                  | **prerequisite.** The row carries `job_id`, not a work-order identifier      |
| how the time was booked | `source` — exactly `manual`, `timer`, `correction` | available                                                                    |
| status                  | —                                                  | **there is no status column, and no cancelled state exists.** See below      |

### The three rules that decide which rows contribute

1. **`ended_at IS NOT NULL`.** An open session has no duration. Treating an open session as running
   to "now" would make the same report return different totals each time it is run over a closed
   period, which is the defect that makes a report untrustworthy rather than merely wrong.
2. **`deleted_at IS NULL`.** A corrected session is soft-deleted and replaced by a row linked through
   `correction_of_id`. Counting both double-counts the correction.
3. **There is no cancelled state.** The table has no status column at all; `source = 'correction'`
   and the soft delete are the entire lifecycle. The report must say so rather than show an empty
   "cancelled" bucket that reads as a real zero.

**Duration is computed server-side**, never in the browser: two clients in different zones must not
produce two totals, and a client-side subtraction over a paged set silently totals a page.

### Named prerequisites

1. **A labour-totals port in the technician module**, returning per-technician totals over a period
   with the three rules above applied in the query.
2. **A job-to-work-order resolution port**, so a session can be attributed to the work order the
   report groups by.

### Status — implemented on an unmerged branch

**Engine slice 2 implements this definition** on `remediation/p1-31-backend-report-engine-datasets`,
stacked on PR #364's branch. Both are UNMERGED and neither carries a hosted result.

Every prerequisite this section named is answered, and none was answered by relaxing the definition:

| prerequisite named above                   | how it was answered                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| a technician NAME, not just an id          | resolved through the iam directory from `tech.technician_profiles.user_id`; `null` for a caller without `iam.user.read`, never invented         |
| there is no duration column                | computed in SQL as `extract(epoch from (ended_at - started_at))::bigint`, carried as an integer string of WHOLE SECONDS and never as a float    |
| the row carries `job_id`, not a work order | `workOrderModule().reportPort.workOrdersForJobs` — the owning module answers for `wo.jobs`; the technician repository never joins a `wo.` table |
| there is no status column                  | the report states the absence instead of showing an empty bucket; contributing is `ended_at IS NOT NULL AND deleted_at IS NULL`                 |

The columns are the Owner's five in the Owner's order, plus `source`, so an amended figure can be
told from an original one. The period is half-open on `started_at` in the branch's timezone (D-17).
The required permissions are `tech.technician.read` **and** `wo.work_order.read`, checked
conjunctively: the report publishes a work-order reference, and a report is not a way to be told
something the record's own read operation would refuse, so a caller lacking either code is refused
the WHOLE report rather than served one with the reference column blanked. Both are existing
catalogue rows and nothing was minted. That is recorded as **CC-33**, now closed by implementation.
The full record is [`report-engine-seam.md`](./report-engine-seam.md) § 11.

---

## 3. `inventory_movements`

**Owner's text:** inventory movements.

### The vocabulary is exactly five terms

`inv.stock_movements.movement_type` is CHECK-constrained to `opening`, `issue`, `return`, `damage`,
`adjustment`. **There is no `receipt` and no `transfer`** — the module disclaims transfers by design.
The report renders the five terms that exist and **states the absence of the other two**, because a
reader who expects a receipts line and sees none will conclude the data is missing rather than that
the concept is.

`direction` is CHECK-forced per type (`opening` and `return` are always `in`; `damage` and
`adjustment` may be either), and `signed_qty` is a GENERATED column. **Damage is the only movement
that writes two rows.** Neither direction nor the signed quantity is ever recomputed by a consumer.

### Columns and their contracts

| column          | source                                             | status                                                      |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| when            | `occurredAt`                                       | available on `inv.stock-movement-list`                      |
| movement type   | `movementType`                                     | available                                                   |
| direction       | `direction`                                        | available                                                   |
| quantity        | `quantity`, `signedQuantity` — decimal **strings** | available; they stay strings end to end                     |
| item code       | `sku`                                              | available                                                   |
| item name       | —                                                  | **prerequisite.** The row carries no name                   |
| unit            | —                                                  | **prerequisite.** The unit is on the item, not the movement |
| location        | `locationId`                                       | identifier only; no code and no name on the row             |
| source document | `reference` — a kind and an id                     | available                                                   |

The unit lives at `inv.item_master.uom_id → inv.units_of_measure (code, name, dimension)`. It is a
property of the item, so it cannot be derived from a movement row alone.

### Named prerequisites

1. **Enrich the `inv.stock-movement-list` rows** with the item name, the unit and the location's code
   and name.
2. **An `inv.stock-movement-summary` read grouping by `(item, unit, movement_type)` only.** Never one
   quantity across unlike items: summing litres and pieces into a single figure produces a number that
   looks authoritative and means nothing. The unit is part of the grouping key precisely so that the
   query cannot be written the other way.

### Status — implemented on an unmerged branch

**Engine slice 3 implements this definition** on `remediation/p1-31-backend-report-engine-datasets`,
stacked on PR #364's branch. Both are UNMERGED and neither carries a hosted result.

Every prerequisite this section named is answered, and none was answered by relaxing the definition:

| prerequisite named above                            | how it was answered                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the row carries no item name, unit or location code | `InventoryRepository.movementReport` joins `inv.item_master`, `inv.units_of_measure` and `inv.stock_locations` in the same statement, so the report row carries the SKU, the item name, the unit code and name, and the location code and name |
| a summary grouping by `(item, unit, movement_type)` | the group key is exactly `(item, unit, movementType)` with `quantityIn` and `quantityOut` as two FILTERed sums. There is no grand total, no cross-item measure and no signed sum                                                               |

The columns are the Owner's, in the Owner's order, with `direction` published beside `movementType`
because `ck_stock_movements_type_direction` constrains the pair together and a reader who cannot see
the direction cannot tell an adjustment up from an adjustment down. Nothing else was added. The
period is half-open on `occurred_at` in the branch's timezone (D-17). The required permission is
`inv.stock.read`, the code `inv.stock-movement-list` declares for the same rows — one code, because
every column is `inv` master data or the ledger itself.

**Two absences this slice measured and did not paper over**, both recorded as named prerequisites in
[`report-engine-seam.md`](./report-engine-seam.md) § 9:

- **The ledger has no unit column.** The unit on a report row is the item's unit AS IT IS NOW, so
  re-pointing an item's unit restates its movement history. The unit is in the group key anyway,
  which is what makes the separation visible rather than implicit.
- **The ledger cannot record a backdated movement.** `shared.stamp_status_history` assigns
  `occurred_at := now()` on every insert and `app_runtime` holds SELECT and INSERT and no UPDATE, so
  a movement's date is the date it was written. The report is correct over that column; what nobody
  can do is post a movement dated earlier.

The full record is [`report-engine-seam.md`](./report-engine-seam.md) § 12.

---

## 4. `invoice_payment_summary`

**Owner's text:** invoice and payment summary.

### Permission: both codes, and the whole report refuses without either

**`rpt.report.read` AND `sal.finance.view`.** The second is not optional and the report must refuse
**as a whole** without it.

The precedent is exact and was paid for: the invoice read returns `null` amounts to a caller lacking
`sal.finance.view`, and the payments work found that a derived aggregate over such a read becomes a
silent **zero** rather than an absence. A report that computes an outstanding total from amounts it
was not allowed to read renders a confident, wrong figure — indistinguishable on screen from a real
one. Refusing the report is the only honest failure available.

### Columns and their contracts

| column                   | source                                                                             | status                                               |
| ------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| invoiced amount          | `sal.invoice_amounts` — restricted, gated on `sal.finance.view`                    | available under both codes                           |
| receipts received        | `sal.receipts.amount`                                                              | available                                            |
| receipts not yet applied | `sal.receipt_unallocated`                                                          | available                                            |
| applied to invoices      | `sal.payment_allocations` — append-only                                            | available                                            |
| outstanding              | `sal.invoice_open_receivable` — `round(gross − allocations − approved credits, 4)` | available; **do not reimplement it**                 |
| credit notes             | `sal.credit_notes`, contributing only when `approval_state = 'approved'`           | available                                            |
| invoice status           | `sal.invoices.status` — `draft`, `issued`, `credited`, `void_before_issue`         | available                                            |
| period grouping          | —                                                                                  | **prerequisite** — the run operation's own predicate |

### The five rules a naive version of this report gets wrong

1. **Outstanding is `sal.invoice_open_receivable`, not a subtraction the report performs.** The
   function already excludes reversed receipts' allocations, counts only approved credit notes, and
   returns zero for `draft` and `void_before_issue`. Re-deriving it produces a second authority that
   disagrees with the invoice screen.
2. **`credited` is a status, and it must be shown as one.** An invoice fully credited is not paid and
   is not outstanding. Folding it into either bucket misstates both.
3. **Per-currency receipt totals exclude `status = 'reversed'`.** A reversed receipt is a receipt that
   did not happen.
4. **Totals are per currency, never across currencies.** There is no rate anywhere in this platform,
   and inventing one would be inventing a figure.
5. **Amounts stay strings.** The driver returns numeric as a string; the money rules for these modules
   forbid the numeric conversions that would round it. A report is exactly where that temptation
   appears, and exactly where a half-cent becomes visible.

`sal.financial_events` is the immutable append-only source for the movement of these amounts and is
the correct basis for a period view of them. It is not a general ledger and this report must not
present it as one.

### Named prerequisite

**A reporting read that carries the restricted amount fields under both permission codes**, refusing
the whole report rather than nulling a column — the refusal has to happen where the permission is
evaluated, not where the column is rendered.

### Status — implemented on an unmerged branch

**Engine slice 4 implements this definition** on `remediation/p1-31-backend-report-engine-datasets`,
stacked on PR #364's branch. Both are UNMERGED and neither carries a hosted result.

The named prerequisite above is answered, and it was not answered by relaxing the definition: the
dataset declares `sal.finance.view`, `ReportRunService` evaluates it BEFORE it reads anything and
refuses the whole report with `ERR-IAM-001`, and a case proves the refusal carries no amount and no
zero standing in for one.

The five rules are implemented as written. `outstanding` is `sal.invoice_open_receivable` CALLED,
compared in a test against the function itself rather than against a number written in the test;
`credited` travels as the invoice's own status and the function reports nothing open for it; a
reversed receipt is excluded from the rows and from every total; the groups are keyed on the
currency so no measure can span two; every amount is a decimal string at `numeric(18,4)` scale, and
the reporting module is now inside the exact-money gate's scanned surface.

The rows are DOCUMENTS of three kinds — an invoice by its `issued_at`, a receipt by its
`received_at`, an approved credit note by its own `issued_at` — with `documentType` as the
discriminator and a NULL, never a zero, in every amount column a type has no equivalent for. The
period is half-open in the branch's timezone (D-17).

**Three absences this slice measured and did not paper over**, all recorded as named prerequisites
in [`report-engine-seam.md`](./report-engine-seam.md) § 9 and raised in the change-control register
as **OPEN Owner-level items** — CC-35, CC-35(a) and CC-35(b) — each carrying one recommendation
pending Owner approval:

- **The `document` column publishes no drill-through** (CC-35(a)), because one column addresses
  three kinds of document and a column carries one route template. **Recommendation pending Owner
  approval:** a drill-through per document KIND against the two detail operations that already
  exist — an invoice through `sal.invoice-detail`, a receipt through `sal.receipt-detail` — with a
  credit note carrying none until the register holds a credit-note read; the column stays without a
  template until that is approved.
- **The `customer` cell carries the payer's id and no name** (CC-35(b)), because naming it means
  reading another module's record and therefore naming that module's read code, `crm.customer.read`.
  **Recommendation pending Owner approval:** keep the cell id-only; if the Owner wants the name,
  declare `crm.customer.read` beside `sal.finance.view` conjunctively so the whole report is refused
  to a caller who may not read customers.
- **Two figures this section's own source table names are published by no column** (CC-35) — a
  credit-note amount and `sal.receipt_unallocated`. The column list implemented is the one in
  "Columns and their contracts" above. **Recommendation pending Owner approval:** add neither
  column until the Owner names it, because either would be a column nobody has decided on.

---

## Summary — what D-4 still owes

| #   | prerequisite                                                                                                                                                                               | owning module        | blocks                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------- |
| 1   | The dataset registry and the report run operation (**P-11**, engine half) — implemented on PR #364's branch, unmerged                                                                      | reporting            | slices 2–4, and all four on `develop` until it merges |
| 2   | The export operation (**P-12**), while `rpt.export` stays withheld (**CC-04**)                                                                                                             | reporting and export | FE-011 … FE-014 export                                |
| 3   | A work-order status summary with a half-open period predicate — met on PR #364's branch by `workOrderModule().reportPort`, unmerged                                                        | work-order           | `work_orders_by_status` on `develop`                  |
| 4   | A state-label decision                                                                                                                                                                     | Owner / presentation | `work_orders_by_status`                               |
| 5   | A labour-totals port and a job-to-work-order resolution port — MET on the slice-2 branch by `technicianModule().reportPort` and `workOrderModule().reportPort.workOrdersForJobs`, unmerged | technician           | `technician_labor_time` on `develop`                  |
| 6   | Enriched movement rows and `inv.stock-movement-summary`                                                                                                                                    | inventory            | `inventory_movements`                                 |
| 7   | A restricted-amount reporting read gated on both codes                                                                                                                                     | billing and payments | `invoice_payment_summary`                             |
| 8   | The SOURCE column for the branch timezone — a recommendation pending Owner approval; the period convention and timezone semantics were approved 2026-09-10                                 | Owner                | nothing today                                         |

Item 1 exists on PR #364's branch and not on `develop`. Until that branch merges, FE-011 … FE-014
have a definition and no engine on `develop`, which is exactly the state the task matrix records for
them.
