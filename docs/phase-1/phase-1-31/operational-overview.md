# P1-31 FE-010 and FE-016 — the operational overview

**Status:** implemented on `feature/p1-31-operational-overview`, open as pull request **#376** and
**UNMERGED**. It was written STACKED on `feature/p1-31-report-screens`, whose head **e3b73277** it
carries by merge; that branch merged with pull request **#371**, so this branch now carries protected
`develop` directly and the stack is gone. It has since been synced again onto `develop`
`811e9891353b466b7788e7ca8a7bddee8496de72`, which carries pull request **#370**, the P-17
delivering-employee Backend slice. Nothing here is
reachable on `develop` until #376 merges. **No hosted run, no database tier, no browser acceptance and
no end-to-end result is claimed.** The change-control entry is section 53 of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md), identifier **CC-41**, both
**PROVISIONAL** — the register at this head runs to section 48 and carries section 50, which is now
merged, and sections 49, 51 and 52 are held by P1-31 lanes that are not merged, so both numbers are
re-checked again before this branch merges. This record replaces no other and changes no chapter
status.

**Authority:** Owner decision **D-19** of 2026-09-12 (the operational overview, which also binds
FE-016), with **D-5** of 2026-09-09 (what a branch summary is) and **D-17** of 2026-09-10 (the period
and the timezone). Everything in this document that is not inside a quoted Owner decision is an
engineering consequence, and it is labelled as one.

---

## 1. The Owner's decisions, in the Owner's words

**D-19 (2026-09-12 § 1) — FE-010 is an operational overview of the four approved report domains.**
The decision is recorded in
[`owner-decisions-2026-09-12.md`](./owner-decisions-2026-09-12.md). It was first read from the
then-unmerged report-engine datasets branch (local commit `a1af21cd`), and it **reached protected
`develop` with PR #374**, so it is present at this head and the quotation below can be checked against
it. It is quoted rather than summarised:

> FE-010 is an **operational overview of the four approved report domains**, with useful summaries
> from their authoritative server results, branch and period filters, visible freshness and timezone,
> and drill-through:
>
> - **work-order counts by status**;
> - **recorded technician labor duration, without calling it productivity**;
> - **inventory movement summaries separated by item and compatible unit**;
> - **invoice, credit-note, receipt, unallocated and outstanding values kept semantically distinct and
>   grouped by currency**.
>
> Consequences the Owner attached to that answer:
>
> - **Use only supported, approved calculations.**
> - **Do not invent profit, performance scores or trends.**
> - **If a needed summary contract is absent, name and implement the smallest approved backend
>   prerequisite.**
> - **Four raw tables alone do not establish the intended overview.**
> - **FE-016 reuses this overview for the selected branch, with no hard-coded pilot.**

**D-5 (2026-09-09 § 4) — what FE-016 is.** A branch summary is a branch-filtered view of the same
approved operational sections, with **no new measures** and **never a hard-coded owner or
product-specific branch**. The full wording is in
[`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md).

**D-17 (2026-09-10 § 4) — the period is half-open, in the branch's timezone.** Every report period is
**half-open**, `[from, to)`, expressed in the **selected branch's timezone**. The **timezone and the
filter context are displayed and preserved** wherever the result is shown, so a number can never be
read without the period that produced it. Local periods from branches in different timezones are
**never silently mixed** into one total. The full wording is in
[`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md).

This slice consumes those three and extends none of them. Nothing below was named by the Owner.

## 2. Measured facts (not part of the decision)

These are the repository facts this slice was built against. The engine facts were first read from
the report run service on the then-unmerged datasets branch (`a1af21cd`), because that is where the
four datasets existed; the frontend facts were read at this branch’s original base, **9ee54fb9**.
**Both were overtaken while the branch was open and are re-stated where they sit rather than
silently rewritten:** PR #374 took all four datasets and the generalised run envelope onto
`develop`, and this branch now carries that head — first through #371, and since that pull request
merged, directly through `develop`, currently `811e9891`.

- **`ReportRunView` already carries everything the overview must display.** The view
  (`apps/api/src/modules/reporting/application/report-run-service.ts`, lines 262–299) publishes
  `period` — `from`, `to` and the `timezone` the two days were resolved in — `filters` (the company
  and branch it was filtered by), `branch` (the resolved branch, named), `generatedAt`, `freshness`,
  `columns`, `groups`, the deprecated `countsByState`, and `rows`.
- **The groups are computed over the WHOLE selection, never over the page.** `ReportGroupView`
  (lines 201–205) is `{ key, label, measures }` with **every measure a string**, and the field's own
  docblock at line 199 states that it is "Computed over the SELECTION and never over the page". That
  sentence is the entire reason an overview can be assembled from these four operations without
  computing anything: a figure that was a page total would be a different claim at every page size.
- **The four datasets' group shapes**, as the run service publishes them:
  - `work_orders_by_status` — key `{ state }`, measures `{ count }`;
  - `technician_labor_time` — key `{ technician }`, measures `{ durationSeconds }`;
  - `inventory_movements` — key `{ item, unit, movementType }`, measures
    `{ quantityIn, quantityOut }`;
  - `invoice_payment_summary` — key `{ currency, documentType }`, measures `{ invoiced, outstanding }`
    for an invoice, `{ creditNotes }` for a credit note and `{ receipts, allocated, unallocated }` for
    a receipt.
- **`limit` accepts 1.** `reports/[reportCode]/rows/route.ts` line 86 admits 1 … 100 and refuses
  anything above the ceiling rather than clamping it; the platform's default for a request that
  sends none is 50.
- **Permissions are conjunctive per dataset, and a refusal is for the whole report.** The run service
  evaluates `rpt.report.read` and the dataset's own read codes at the operation's branch scope and
  answers `ERR-IAM-001` for the report as a whole. There is no partial result and no per-measure
  redaction.
- **`develop` published one dataset and the older envelope shape when this slice was written.** At
  `ae0e0354` only `work_orders_by_status` was registered, with `countsByState` and no `groups`,
  `filters` or `branch`. The web contract was written to treat `groups`, `filters` and `branch` as
  OPTIONAL so that it read both shapes without a change. **Superseded:** PR #374 registered all four
  datasets and published the generalised envelope, so at the head this branch carries only one shape
  exists. The screen needed no edit for that, which is the point of having read both.
- **Recorded labour time is published as whole seconds**, and the definition record states it is a
  duration rather than a productivity or payroll figure.
- **There is no export operation.** P-12 is not built and `rpt.export` stays excluded on **CC-04**'s
  grounds, so the overview has no download path and a platform baseline names no export authority.
- **Three drill-through templates exist across the four datasets and this application serves one**,
  `/work-orders/{id}`. That is unchanged by this slice and is recorded as **CC-38(a)**.

## 3. Engineering consequence (not an Owner decision)

The points below are this slice's own choices. The Owner named none of them.

- **The overview is FOUR calls to `rpt.report-run`, each with `limit=1`, and NO new backend
  contract.** Every summary the decision asks for is already published by the four datasets as
  groups over the whole selection, so there is nothing left to compute and nothing left to add. The
  rows are not needed at all, which is why each read asks for the smallest page the route accepts
  rather than the default fifty.
- **A `summaryOnly` request flag was considered and REJECTED.** It would have been a new parameter on
  a published operation, a new branch in the run service, and a second shape of one envelope — all to
  avoid transporting four rows. `limit=1` is the existing contract answering the same need, and the
  cheapest honest change is the one that changes nothing. If a later measurement shows the single row
  is itself expensive, that is the point at which a prerequisite would be named.
- **Nothing on this screen is computed.** No figure is summed, netted, divided, rounded, re-scaled,
  ranked or compared: no total across the four domains, no figure per day, no share, no change
  against another period, no score. Each measure is rendered as the characters the server sent, which
  is the position `report-screens.md` records as **CC-38** and which **D-19**'s "use only supported,
  approved calculations" requires on a screen whose whole subject is summaries.
- **Four sections, in the Owner's order, declared rather than discovered.**
  `apps/web/src/features/reports/overview-contract.ts` names the four codes and the measures each
  section shows. An overview that rendered whatever arrived would silently narrow its claim when a
  measure was renamed and silently widen it when the engine registered something new — and the claim
  is the Owner's, not the engine's. A measure the server sends that the contract does not name is
  still shown, after the declared ones: dropping it would hide something the engine published.
- **The semantic separations are the engine's own group keys, not a presentation choice.** Stock
  movements are grouped by item, unit AND movement kind, so there is no row on the screen that spans
  two items or two units — there is no such group. The invoice domain is grouped by currency and
  document kind, and its six measures are six columns, none of them added to another in any
  direction. An absent measure renders as an absence: a credit-note group carries no receipt total,
  and printing `0` there would state that no money was received.
- **The recorded-labour section is a duration and says so.** It shows the seconds the engine
  published, per technician, and never the words productivity, utilisation, efficiency or
  performance — in either language. The prohibition is a list in the contract and a test that scans
  the rendered section for every word in it, because a prohibition nobody can fail is not enforced.
- **Four honesty states are kept apart.** A report the caller's catalogue does not publish, and one
  the platform cannot run, have **no read issued** and say the report has nothing behind it; a refused
  or failed read is drawn as the refusal it is, with the reference the backend logged, beside the
  sections that did answer; a run that published **no grouping** says so and nothing is derived in its
  place — the single exception being the work-order domain, whose older envelope answers the same
  question through the field it deprecated; and a run that published an **empty** grouping says
  nothing was recorded in the period, which is a measurement. A refusal is never a zero.
- **One context banner, from the first run that answered.** All four runs carry the same selection, so
  **D-17**'s period, timezone, filter context, freshness and generation instant are stated once. When
  no run answered there is no banner: a period drawn from the form would be the screen asserting what
  the server answered over. Dates and instants are shown as published, never re-rendered in the
  browser's own zone.
- **Every section links to its own report, carrying the four filters.** The link is
  `/{locale}/reports/{code}?companyId&branchId&from&to`, and the report screen fills its form in from
  those values after resolving them against the caller's authorized directory. A drill-through that
  landed on an empty form would invite an operator to retype a different selection and read the rows
  under a heading about another one.
- **The scope form is now shared** (`ReportScopeForm`), with behaviour unchanged: the same four
  controls, the same validation in the same order, the same refusal of an empty or reversed period
  before a request is spent, and no default period anywhere.
- **FE-016 is the same screen with the branch fixed by the ADDRESS.** `?branchId=` fixes the branch
  selector — shown disabled at the branch it is fixed to rather than hidden, because a filter an
  operator cannot see is one they cannot correct — with the company derived from the same authorized
  directory so the pair can never disagree. A branch the caller's directory does not hold renders the
  no-branch body rather than a guess or a substitute, and **there is no default branch and no branch
  literal anywhere in the feature**. That is how "no hard-coded pilot" is made structurally true
  rather than promised.
- **The page gate is `rpt.report.read` alone, decided before any read.** The datasets' own codes are
  per-report and are left to the service that can evaluate them; a page cannot declare a code that
  depends on which reports it is about to run.
- **The route is `/reports/overview`, and navigation names it.** The reports entry gains two children —
  the catalogue, naming its parent's own route, and the overview — because a parent with children is a
  disclosure control and the page it points at would otherwise have nothing to mark as current. FE-016
  gets no entry of its own: a rail link to one branch would be a branch written into the source.
  A static route segment wins over the sibling `[reportCode]` segment, so a report whose code were
  literally `overview` could not be opened from the address; none of the four approved codes is.

## 4. Task standing

| task         | standing                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- |
| P1-31-FE-010 | **in open PR** — pull request #376 on this branch. Not merged, not end-to-end verified            |
| P1-31-FE-016 | **in open PR** — the same screen with the branch fixed by the address; no second screen was built |

Rule 2 of [`task-matrix.md`](./task-matrix.md) keeps `end-to-end verified` unreachable until a P1-31
acceptance record exists. Neither task claims it.

## 5. Backend prerequisites named by this slice: none

**D-19** requires that a missing summary contract be named and implemented as the smallest approved
backend prerequisite. Measured against the four datasets' published groups (§ 2), **no summary the
overview shows is absent**: every figure on the screen is a measure the engine already publishes over
the whole selection. So this slice names no new backend prerequisite, adds no operation, no
permission, no audit action, no migration and no seed, and changes no backend file.

Two prerequisites already recorded elsewhere remain open and are NOT closed here: the export
operation **P-12** / `rpt.export` (**CC-04**), and the two drill-through targets this application has
no screen for (**CC-38(a)**). Nothing in this slice creates either.

## 6. What is not claimed

- **No hosted run, no database tier, no browser acceptance and no end-to-end result**, and no pull
  request for this branch existed when this record was written.
- **No backend file changed**, and no operation, permission, migration, seed or audit action moved.
- **No figure was computed, derived, rounded, re-scaled or reformatted anywhere in this tier.**
- **No export path of any kind was added** — not an operation call, and not a file assembled in the
  browser.
- **All four sections have a registered dataset at this head**, because PR #374 merged the remaining
  three. A section whose dataset the catalogue answers as not executable still renders as not
  runnable rather than as a zero — that path is kept and tested, because it is what an unpublished
  or archived configuration must look like. **No end-to-end result is claimed for any of the four:**
  #371 has merged, so the overview is not reachable on `develop` until this branch's own pull request
  #376 merges, and nothing here has been exercised against a database or a browser.
- **No gate was weakened, no allow-list narrowed and no suppression added.** The one gate figure that
  moved is the P1-31 access gate's pinned page count, which rose from 15 to 16 because a page was
  added, read off the gate's own report line on this head. Its owned-segment count is unchanged at 8
  and no operation joined its allow-list: the overview consumes the same three reporting operations
  the report screens already named.
