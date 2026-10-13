# P1-31 — the Owner's decisions of 2026-09-12

**Status:** RECORDED · **Authority:** the Owner, 2026-09-12 · **Scope:** two decisions taken on
2026-09-12 and recorded here as **D-19** (the FE-010 operational overview, which also binds FE-016)
and **D-20** (completing the invoice and payment report).

These are NEW decisions taken on 2026-09-12. They are not a restatement of an earlier approval, and
they do not reopen anything recorded in
[`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md),
[`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) or
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md). Each section records what the
Owner decided, the consequences the Owner attached to it, and what it forbids — a decision recorded
only as a permission is the shape that later gets read as a licence.

Nothing here asserts that any gate ran, that any environment exists, or that any of the work below
has been built. It is a record of decisions.

## 1. D-19 — FE-010 is an operational overview of the four approved report domains

FE-010 is an **operational overview of the four approved report domains**, with useful summaries
from their authoritative server results, branch and period filters, visible freshness and timezone,
and drill-through:

- **work-order counts by status**;
- **recorded technician labor duration, without calling it productivity**;
- **inventory movement summaries separated by item and compatible unit**;
- **invoice, credit-note, receipt, unallocated and outstanding values kept semantically distinct and
  grouped by currency**.

Consequences the Owner attached to that answer:

- **Use only supported, approved calculations.**
- **Do not invent profit, performance scores or trends.**
- **If a needed summary contract is absent, name and implement the smallest approved backend
  prerequisite.**
- **Four raw tables alone do not establish the intended overview.**
- **FE-016 reuses this overview for the selected branch, with no hard-coded pilot.**

**Measured facts (not part of the decision).** These are the facts the decision was taken against.

- The four report domains the overview draws on are the four datasets **D-4** approved on
  2026-09-09 and no others: `work_orders_by_status`, `technician_labor_time`,
  `inventory_movements` and `invoice_payment_summary`
  ([`d4-report-definitions.md`](./d4-report-definitions.md)).
- The engine that runs them is P-11's dataset registry and `rpt.report-run`. All four are
  implemented on `remediation/p1-31-backend-report-engine-datasets` and on the branch it is stacked
  on; **both are unmerged at this head**, so on `develop` the overview still has nothing to read.
- The run envelope already carries the facts the overview must display: the period, the timezone it
  was resolved in, the company and branch it was filtered by, and `freshness: 'live'` — which is a
  statement that the rows were read from the operational tables inside the request's own
  transaction, with no snapshot and no cache behind them.
- **There is no export operation.** Prerequisite **P-12** is not built and `rpt.export` stays
  excluded on **CC-04**'s grounds, so the overview has no download path today.
- **`countsByState` is deprecated** on the run envelope and empty for every dataset except
  `work_orders_by_status`. `groups` is the field an overview reads.
- Recorded labour time is published as **whole seconds**, and the definition record states it is a
  duration and not a productivity or payroll figure.

**Engineering consequence (not an Owner decision).**

- The overview is composed from the **published run results** of the four datasets. It does not gain
  a fifth dataset, a cross-domain measure or a figure computed in the browser: "use only supported,
  approved calculations" is answered by rendering what the server published and nothing else.
- "Kept semantically distinct and grouped by currency" is answered by the engine's group key, which
  is `(currency, documentType)` on the invoice and payment dataset — so no measure spans two
  currencies and no measure of one document kind is added to another's.
- Where a summary the overview needs has **no contract**, the smallest approved backend prerequisite
  is named and implemented rather than assembled on the client. The first such prerequisites are
  answered in § 2 below; anything further is raised the same way, as a named prerequisite in
  [`report-engine-seam.md`](./report-engine-seam.md) § 9.
- FE-016 takes the same overview with the branch filter fixed to the selected branch. The branch is
  chosen from the caller's authorized scope, never from a literal in the source: a hard-coded branch
  would be the defect the Owner's sentence forbids and would also fail the repository's own scope
  exclusions.
- Lane placement is unchanged: the backend prerequisites follow the P-2..P-11 precedent, and the
  screens are a Frontend lane. Nothing here settles **D-1**, and **D-10** — whether Field 24 needs
  an event-consumption mechanism or accepts polling — is **not** answered by this decision. The
  Owner required that freshness be VISIBLE; how a screen refreshes is a separate question and stays
  open ([`a0-preflight.md`](./a0-preflight.md)).

## 2. D-20 — the invoice and payment report is completed

The invoice and payment report is completed as follows.

- **Include authoritative credit-note and unallocated-receipt amounts as separate fields.**
- **Show the permitted party name alongside its identifier, labelled according to its actual role
  rather than confusing payer and customer.**
- **Resolve document drill-through by document kind and authorized target route.**
- **Do not invent amounts, perform financial calculations in the browser, or silently omit missing
  contracts.**

**Measured facts (not part of the decision).** These describe the schema and the register as they
stand; the Owner approved the fields and their treatment, not any of the mechanisms below.

- **Both authorities exist and are deployed.** `sal.credit_notes.amount` is `numeric(18,4)` with
  `CHECK (amount > 0)`, frozen once approved
  (`supabase/migrations/20260724092000_sal_payments.sql`). `sal.receipt_unallocated(uuid)` is a
  deployed function that returns `round(amount − Σ allocations, 4)` and `0` for a reversed receipt
  (`supabase/migrations/20260724093000_sal_financial_events.sql`), and the payments module already
  calls it on its own receipt reads.
- **The party columns are payer columns.** `sal.invoices.payer_partner_id` and
  `sal.receipts.payer_partner_id` both name the PAYER. `sal.credit_notes` carries **no party column
  at all**, so a credit note's party is the payer of the invoice it credits.
- **A partner name is readable through the CRM module's published surface.**
  `crmModule().customerRead.resolveDisplayIdentities` checks `crm.customer.read` for itself and
  resolves nothing for a caller who lacks it — the same treatment the vehicle module's partner
  naming already takes.
- **Two of the three document kinds have a detail operation and the third has none.**
  `sal.invoice-detail` serves `/invoices/{id}` and `sal.receipt-detail` serves `/payments/{id}`. The
  operation register holds `sal.credit-note-create` and `sal.credit-note-approve` and **no
  credit-note read**.
- `sal.invoice_open_receivable` already subtracts approved credit notes and the allocations of
  non-reversed receipts, so the money a credit note represents is already inside `outstanding`.

**Engineering consequence (not an Owner decision).**

- "Authoritative" is taken literally: the credit-note amount is the table's own column and the
  unallocated amount is the deployed function CALLED. Neither is derived from the other columns on
  the row, and neither is netted into a figure the database function has already computed —
  restating money twice is the arithmetic "do not invent amounts" forbids.
- "Labelled according to its actual role" is published as a ROLE the row carries, beside the
  identifier and the name. A column named after a customer over a payer column was the confusion the
  decision names.
- "The permitted party name" is capability-gated where the capability lives: the CRM read decides
  it, the identifier always travels, and the report's declared permission list is unchanged — the
  enrichment can only narrow what a caller already had.
- "By document kind and authorized target route" means the drill-through is published per kind
  against operations that exist. The kind with **no** read operation carries a published **null**
  rather than an invented route, and the absence is recorded rather than omitted — which is what
  "do not silently omit missing contracts" requires. A credit-note read operation is the named
  prerequisite that would fill it; it is not created here.
- Nothing about this decision moves work into the browser. Every figure is summed by PostgreSQL and
  travels as an exact decimal string.
- This answers **CC-35**, **CC-35(a)** and **CC-35(b)** of
  [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 47.2, each of which was recorded
  as an OPEN Owner-level item carrying one recommendation, and closes rows 12 to 15 of
  [`report-engine-seam.md`](./report-engine-seam.md) § 9.
