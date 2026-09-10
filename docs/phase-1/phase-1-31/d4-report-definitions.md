# P1-31 — D-4 report definitions and their column-to-contract mapping

**Status:** OPEN · **Authority:** Owner decision **D-4**, taken 2026-09-09, which defines four baseline
reports and their required columns · **Measured at:** protected `develop` `249c6428`, 2026-09-09 · **Companions:**
[`a0-preflight.md`](./a0-preflight.md) (D-4 as it stood open), [`task-matrix.md`](./task-matrix.md)
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

Two questions in the cross-cutting section are marked **proposal, pending Owner confirmation**. They
are not engineering details: they change what a figure means.

---

## Cross-cutting: the shape every one of the four takes

### The engine is a code-registered dataset registry

The sanctioned shape is already recorded as **OWR-2026-09-06-A-12**: a report definition binds a
`report_code` to a **code-registered dataset** — a frozen registry inside the reporting module,
mirroring the export resource registry — declaring the operation or table, the allowed filters, the
required permission codes and the scope. Tenant configuration may select, name, scope and version a
registered dataset. It may never supply a query, a table name or a column.

This matters for what follows: **the four reports below are four registry entries, not four
queries.** A report that needs data no registered dataset can serve is a report waiting on a
prerequisite read, which is why each section ends with one.

The named prerequisites are:

- **P-11** — the reporting writer and the report engine. The writer half is on an open branch; **the
  engine half — this registry plus the run operation — has not begun.**
- **P-12** — the export operation. Not started, and `rpt.export` remains withheld from the
  provisioning bundle on the Owner decision recorded as **CC-04**.

### Every run operation must declare scope `branch`

Not `tenant`. A tenant-scoped operation is evaluated **scope-blind**: `requiresScopedEvaluation` in
`apps/api/src/server/auth/authorization.ts` returns false for `tenant` before it ever looks at the
target, so a company or branch named in the request is not consulted when the permission is
evaluated. A branch-scoped report run that declared `tenant` would therefore be authorized against
the permission-blind union of every grant its caller holds, while its query filtered to one branch —
the two would agree for a single-branch operator and diverge silently for everyone else.

### Period semantics — proposal, pending Owner confirmation

**Proposed:** a report period is **half-open, `[from, to)`**, evaluated in the **branch time zone**
(`org.branches.timezone_name`) for a branch-scoped report.

- _Half-open_ because closed-on-both-ends double-counts a boundary instant across two adjacent
  periods, and because the one existing period filter in the platform — the work-order list — is
  closed on both ends and therefore cannot be reused as-is for a report (see the first report below).
- _Branch time zone_ because a workshop day is a local day. `org.branches.timezone_name` is `NOT
NULL` on every branch and references the approved zone list, so the value always exists.

**The alternative** is the tenant default, `org.tenants.default_timezone`, also `NOT NULL`. It gives
one answer across a multi-branch organisation at the cost of splitting a branch's own working day.
**Both are defensible and the choice changes every figure at a period boundary, so it is the Owner's
and is recorded here rather than taken.**

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

---

## Summary — what D-4 still owes

| #   | prerequisite                                                                   | owning module        | blocks                    |
| --- | ------------------------------------------------------------------------------ | -------------------- | ------------------------- |
| 1   | The dataset registry and the report run operation (**P-11**, engine half)      | reporting            | all four                  |
| 2   | The export operation (**P-12**), while `rpt.export` stays withheld (**CC-04**) | reporting and export | FE-011 … FE-014 export    |
| 3   | `wo.work-order-status-summary`, with a half-open period predicate              | work-order           | `work_orders_by_status`   |
| 4   | A state-label decision                                                         | Owner / presentation | `work_orders_by_status`   |
| 5   | A labour-totals port and a job-to-work-order resolution port                   | technician           | `technician_labor_time`   |
| 6   | Enriched movement rows and `inv.stock-movement-summary`                        | inventory            | `inventory_movements`     |
| 7   | A restricted-amount reporting read gated on both codes                         | billing and payments | `invoice_payment_summary` |
| 8   | Confirmation of the period convention and time zone                            | Owner                | all four                  |

Until item 1 exists, FE-011 … FE-014 have a definition and no engine, which is exactly the state the
task matrix records for them.
