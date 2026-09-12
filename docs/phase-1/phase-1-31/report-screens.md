# P1-31 FE-011 … FE-014 — the report screens

**Status:** implemented on `feature/p1-31-report-screens`, branched from protected `develop`
`ae0e035480596243c739beec1a40d2ae5c105e7a` and since carrying the merge of `develop`
`6c99e805225b8ba59f6402188d9967c697d1eb13`, **UNMERGED** and **open as pull request #371**. A merge
of that request is not claimed, and no review verdict is recorded here. **No hosted run, no database
tier, no browser acceptance and no end-to-end result is claimed.** The change-control entry is
section 50 of [`change-control-2026-09-08.md`](./change-control-2026-09-08.md), identifier **CC-38**,
both settled at that merged head. This record does not replace the 29-task matrix and changes no
chapter status.

**Authority:** Owner decision **D-4** of 2026-09-09 (the approved baseline of four reports and their
columns), **D-17** of 2026-09-10 (the period and the timezone), and **D-19** / **D-20** of
2026-09-12 (the FE-010 overview, which binds FE-016; and the completion of the invoice and payment
report). Everything in this document that is not inside a quoted Owner decision is an engineering
consequence, and it is labelled as one.

---

## 1. The Owner's decisions, in the Owner's words

**D-4 (2026-09-09 § 3) — an approved baseline of four reports.** Four report definitions are
approved as the phase baseline: `work_orders_by_status`, `technician_labor_time`,
`inventory_movements` and `invoice_payment_summary`, each with the columns the decision lists. Every
one of the four must additionally specify its **period and date semantics**, its **timezone**, its
**authorization**, its **source**, its **freshness** and its **drill-through**. **All calculation is
done on the server.** Where a field or an aggregation the definition needs does not exist, it
becomes a **named backend prerequisite** — never an invented value, and never a column quietly
dropped from the definition so that the gap disappears. The full wording is in
[`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md).

**D-17 (2026-09-10 § 4) — the period is half-open, in the branch's timezone.** Every report period
is **half-open**, `[from, to)`, expressed in the **selected branch's timezone** and converted
consistently before it reaches a server query. A report that says a day includes every instant of
that local day and no instant of the next. The **timezone and the filter context are displayed and
preserved** wherever the result is shown, printed or recorded, so a number can never be read without
the period that produced it. **Cross-branch reporting uses one explicit reporting timezone**, stated
on the result; local periods from branches in different timezones are **never silently mixed** into
one total. A boundary row belongs to exactly one period — no inclusive `to` and no double counting.
The full wording is in [`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md).

**D-19 (2026-09-12 § 1) — FE-010 is an operational overview of the four approved report domains**,
with useful summaries from their authoritative server results, branch and period filters, visible
freshness and timezone, and drill-through. The consequences the Owner attached: **use only
supported, approved calculations**; **do not invent profit, performance scores or trends**; **if a
needed summary contract is absent, name and implement the smallest approved backend prerequisite**;
**four raw tables alone do not establish the intended overview**; and **FE-016 reuses this overview
for the selected branch, with no hard-coded pilot**.

**D-20 (2026-09-12 § 2) — the invoice and payment report is completed.** **Include authoritative
credit-note and unallocated-receipt amounts as separate fields.** **Show the permitted party name
alongside its identifier, labelled according to its actual role rather than confusing payer and
customer.** **Resolve document drill-through by document kind and authorized target route.** **Do
not invent amounts, perform financial calculations in the browser, or silently omit missing
contracts.**

These screens consume those four decisions. They extend none of them, and nothing below was named by
the Owner.

## 2. Measured facts (not part of the decision)

These are the repository facts this slice was built against, at protected `develop` `ae0e0354`.

- **All three reporting operations are on `develop`.** `rpt.report-catalogue`
  (`GET /api/v1/reports`), `rpt.report-read` (`GET /api/v1/reports/{reportCode}`) and
  `rpt.report-run` (`GET /api/v1/reports/{reportCode}/rows`). All three declare `rpt.report.read`;
  the run additionally evaluates the dataset's own read code in the service, at the operation's own
  branch scope, and answers the same uniform refusal the route's check answers.
- **The registry holds ONE dataset at this head:** `work_orders_by_status`. The other three approved
  codes are implemented on `remediation/p1-31-backend-report-engine-datasets`, which is unmerged, so
  on `develop` `executable` is registry membership for one code and `false` for every other.
- **Two envelope shapes exist.** `develop` publishes `countsByState` and no `groups`, `filters` or
  `branch`. The dataset branch publishes `groups` (the generalisation of `countsByState`, which it
  deprecates and derives), `filters` (D-17's echoed company and branch) and `branch` (the resolved
  branch, named). It also adds three column kinds — `duration`, `quantity` and `money` — and a
  per-kind `drillThroughByKind`.
- **`schemas.limit` on all three routes refuses a page size above 100** rather than clamping it, and
  the platform's own default for a request that sends none is 50.
- **The period parameters are calendar DAYS**, `YYYY-MM-DD`, and the route's schema refuses an
  instant. `from >= to` is refused with `ERR-VAL-001` before anything is read.
- **`apps/web/src/lib` holds no decimal-string display formatter.** `money.ts` is the one sanctioned
  money helper; `formatMoney` requires a currency beside the amount and a canonical four-place
  scale, and it converts to a number internally to reach `Intl`. `trimTrailingZeros` throws on a
  value that is not canonical to four places. `lib/format.ts` offers `formatNumber`,
  `formatInteger`, `formatDate`, `formatTime` and `formatDateTime`, and every one of them takes a
  number or constructs a date.
- **Three drill-through templates are published across the four approved datasets** —
  `/work-orders/{id}`, `/technicians/{id}` and, per document kind, `/invoices/{id}` and
  `/payments/{id}` with an explicit absence for a credit note. **This application serves exactly one
  of them:** `(dashboard)/work-orders/[workOrderId]` exists; there is no per-technician page, no
  invoice detail page and no receipt detail page.
- **The navigation entry for `/reports` already existed**, gated on `rpt.report.read` and marked
  `planned`. `rpt.report.read` is a row of `supabase/seeds/04_iam_permission_catalog.sql`.
- **The P1-31 access gate examines 11 route pages across 7 owned segments** with the three reporting
  operations named; it examined 9 across the same 7 before this slice. The segment count did not
  move because `reports` was already a named dashboard area and is also the resource root the three
  operations derive.
- **There is no export operation.** Prerequisite P-12 is not built and `rpt.export` stays excluded
  on **CC-04**'s grounds, so a platform baseline publishes no export authority at all.

## 3. Engineering consequence (not an Owner decision)

Every point below is this slice's own choice. The Owner named none of them.

### 3.1 One generic screen, parameterised by report code

D-4 approves four reports and the engine registers them one slice at a time. Four screens would
differ only by a string, and three of them would have to be written against registry entries that do
not exist on `develop` — which is guessing at a contract, the defect class P1-27 recorded as
_declared but never wired_. So there is **one catalogue screen and one report screen**, and the
report screen branches on no report code anywhere:

- the **catalogue** is the authority for WHICH reports exist, including whether each can be run;
- the **run envelope** is the authority for WHAT one renders — its columns, their kinds, its
  grouping and its drill-through all arrive in the response.

The consequence is that FE-011, FE-012, FE-013 and FE-014 are all served by the same screen, and the
three unregistered codes need no further frontend work when the dataset branch merges. It also means
the screen is honest about a report it cannot run today rather than absent for it.

### 3.2 Nothing is computed in the browser

No total is summed, no duration is divided into hours, no quantity is re-scaled, no amount is
reformatted, no percentage is derived and no two values are compared. A measure is rendered as the
characters the server sent.

That is a consequence of the measured fact in section 2: there is no decimal-string display
formatter in this application that does not either convert to a number or demand a currency and a
four-place scale, and a report cell carries neither — the currency is a separate column on the one
dataset that has one. **Recorded rather than worked around:** the screens display raw exact strings,
so `1234.5600` reads as `1234.5600`. A grouped, currency-suffixed presentation is a named frontend
prerequisite (section 5, row 1) and not something to approximate here, because a formatter that
guessed the scale or the currency would be changing money on the way to the screen.

### 3.3 A date is shown as the server published it

`Intl` renders an instant in the BROWSER's timezone, and D-17 fixes the period in the BRANCH's. A
row selected into "opened on the 3rd in the branch's zone" would then be drawn under the 2nd or the
4th for a reader sitting elsewhere, and the report would visibly disagree with itself. So `date`
cells and the generation instant are rendered as sent, left to right, and the zone the period was
resolved in is displayed beside them as read-only context from `period.timezone`.

### 3.4 The period is stated where it is typed, and an empty one is refused there

`from` is labelled as the first day included and `to` as the day AFTER the last one reported, with
the rule repeated beneath both controls. An equal or reversed pair is refused by the form before a
request is spent — the route refuses it too, and refusing it here means the operator is told which
box to correct instead of receiving a validation failure about a request they never saw. The
comparison is lexicographic on `YYYY-MM-DD`, which is chronological for that format, so no date
object is constructed and no zone is applied to a value that carries none.

**There is no default period.** A report over a whole history is a response whose size the caller
chooses, and "the last thirty days" is a business rule nobody has taken.

### 3.5 The filter context travels with every page, so the context is never a different read's

D-17 requires the period and the filter context to be shown wherever the result is. A report's answer
is therefore the whole envelope, not its rows: the period, the zone, the generation instant, the
freshness, the company and branch, and the groups computed over the entire selection. The shared
`useServerTable` hook hands back rows and a table status and discards the rest, so a screen built on
it would have to hold the envelope beside the rows — which is how a later page's rows come to be
displayed under an earlier page's generation instant. This slice therefore holds **one response at a
time** (`use-cursor-trail.ts`): Previous and Next walk a trail of cursors already visited, every page
carries its own context, and nothing is accumulated across pages.

**There are no page numbers.** The operation publishes `{ items, nextCursor, hasMore }` and no total,
so a position in a count of pages would be a number this screen invented (`P1-26-F-001`).

### 3.6 The groups are rendered above the rows, and the deprecation is resolved in one place

The groups answer a different question from the rows: the rows are one page and the groups are the
totals of everything the period and the branch selected, computed in the database without the keyset
window. Presenting a page's contents as a branch's position is the P1-28 round-two defect exactly, so
the table is labelled as covering the whole period and the rows are labelled as one page of it.

`countsByState` is read **only** when `groups` is absent. The newer envelope DERIVES the deprecated
field from the new one, so reading both would count the one dataset that carries both twice. On
`develop` that fallback is what puts D-4's "counts by status computed on the server for the scoped
selection" on screen.

### 3.7 A reference links only to a route this application serves

The API publishes a route TEMPLATE rather than a built URL, precisely because it does not own the
client's route table — and the client's route table is what decides whether a template resolves. Of
the three templates the four datasets publish, only `/work-orders/{id}` has a page here. A reference
whose template names a route this application does not serve renders as the reference it is, with no
link: a link to a route that answers as missing is the defect the navigation model refuses for the
same reason, and D-20's "authorized target route" cannot be satisfied by a route that does not exist.

The per-kind resolution D-20 asked for is implemented as published: the discriminating column's own
cell value selects the template, a kind published as having no target yields no link, and a kind the
report never mentioned also yields no link rather than the first template in the map. The three
answers are kept apart because D-20 asked that a missing contract not be silently omitted.

A reference whose label is absent shows the ABSENCE and never the internal identifier. A reference
slot holding a raw identifier reads to an operator as the record's own number, which is the finding
the delivery queue recorded.

### 3.8 The page gate is `rpt.report.read`, and the dataset codes are not approximated

Both pages test `rpt.report.read` and return before any read. The dataset's own codes are per-report
and this side cannot see the registry that holds them; the run service evaluates them at the same
company and branch and answers the uniform refusal, which the screen draws as a refusal. Guessing
which codes a report needs would either hide a report an operator may read or offer one they may not.

The navigation entry names one code, as every other row does, and moves from `planned` to
`available` with `scope: 'tenant'` — the catalogue operation is tenant-scoped, so the set of reports
a caller may read is not a company's. The RUN is branch-scoped, and the company and branch the
screen asks for are a question about the resource, not a scope the browser asserts: they travel
through `branchTargetQuery`, which refuses a half-built target and refuses to carry either half
among the ordinary filters.

### 3.9 A machine name is shown as a machine name

A report code, a column key and a measure key are identifiers, not language. A platform baseline
carries a translation KEY and a workshop's own row carries the name that workshop wrote; when
neither resolves, the code is drawn monospaced and left to right rather than dropped into a heading
as though somebody had written it. This is the position the work-order board already takes on
workshop-owned state codes, and for the same reason: a translation table keyed on names somebody else
owns is a second, rotting copy of their configuration.

English and Arabic copy is provided for the four approved report titles and for the column, group-key
and measure names of all four D-4 datasets. Three of those four datasets are unregistered on
`develop`, so most of that copy is unreachable there — it is provided because the columns are the
Owner's approved list, and anything it does not cover degrades to a machine name rather than to a
blank.

### 3.10 No download, and no write

There is no export operation to call, so none is offered, and nothing here assembles a file in the
browser: that would be a copy of restricted data leaving through a path with no server-side
authorization and no record of it. Authoring a report definition is a separate surface with its own
authority and is not built here. The adapter module publishes four reads and nothing that sends.

### 3.11 An unusable page size falls back to the platform default, not to the ceiling

`reportPageSize` repairs a request that is not a whole number of rows — zero, a negative, a fraction.
It first answered such a request with `MAX_REPORT_PAGE_SIZE`, the largest page the route accepts,
which turns a caller's mistake into the heaviest read available. It now answers with
`REPORT_PAGE_SIZE`, the same size the operation would have chosen for a request that named no limit
at all, so a repaired request costs what an ordinary one costs. The ceiling still applies to a
request that is a whole number and merely too large, and the two constants are different numbers, so
the test asserts the inequality as well as the value.

The same file previously exported a `REPORT_REFUSALS` map of three error codes. Nothing imported it.
The refusal a caller actually branches on is decided in `apps/web/src/lib/api/read-operation.ts`,
which maps the client's failure kind to the screen's status, so a second unused declaration of the
same idea is a place for the two to drift apart. It was removed rather than wired, because wiring it
would have meant two authorities for one mapping.

## 4. What each task stands at

| task       | this slice                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| **FE-011** | screen implemented; dataset availability per registry — `work_orders_by_status` is registered on `develop`       |
| **FE-012** | screen implemented; dataset availability per registry — `technician_labor_time` is not registered on `develop`   |
| **FE-013** | screen implemented; dataset availability per registry — `inventory_movements` is not registered on `develop`     |
| **FE-014** | screen implemented; dataset availability per registry — `invoice_payment_summary` is not registered on `develop` |

"Screen implemented" is a claim about the frontend and about nothing else. None of the four reaches
`end-to-end verified`: no P1-31 acceptance record exists, and rule 2 of
[`task-matrix.md`](./task-matrix.md) makes that state unreachable until one does.

**FE-010 and FE-016 are NOT built here.** D-19 defines FE-010 as an operational overview composed
from the published run results of the four approved datasets, and FE-016 as the same overview with
the branch filter fixed to the selected branch. Both are the **next slice**, and neither is
approximated by these screens: a catalogue and a per-report run are not an overview, and D-19 says in
terms that four raw tables alone do not establish the intended one.

## 5. Named prerequisites this slice leaves

| #   | prerequisite                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A decimal-string display formatter.** Grouped digits and a currency beside an amount need a helper that never converts to a number and never assumes a scale, plus a decision about where the currency comes from (it is a separate column on one dataset). Until then measures render as exact raw strings        |
| 2   | **The screens D-20's drill-through names.** An invoice detail page and a receipt detail page do not exist in this application, and a credit note has no read operation at all. Until the first two exist those references render without a link, and the third is an absence the engine already publishes explicitly |
| 3   | **A per-technician page**, for `technician_labor_time`'s own reference column, on the same grounds                                                                                                                                                                                                                   |
| 4   | **The dataset registry slice.** Three of the four approved codes are unregistered on `develop`; the screen needs no change when they land, and the four titles and their field names are already translated                                                                                                          |
| 5   | **FE-010 and FE-016**, per D-19, as the next slice                                                                                                                                                                                                                                                                   |

## 6. What this slice did NOT do, and what is not claimed

- **No backend file changed.** No route, no service, no repository, no migration, no seed, no
  permission, no audit action and no operation. The operation register is untouched.
- **No report definition was authored, published, archived or exported**, and no export path of any
  kind was added.
- **No figure was computed, derived, rounded, re-scaled or reformatted anywhere in this tier.**
- **No gate was weakened and no allow-list was relaxed.** The one CI edit adds three operations to
  the P1-31 access gate's reach and moves its pinned page count from 13 to 15, both numbers read
  from the gate's own report line on the merged head rather than carried forward from the figure
  this branch first measured.
- **No hosted run, no database tier, no browser acceptance and no end-to-end result is claimed.** The
  evidence is the local frontend chain and the focused web run recorded in change control section 50.
- **D-19 and D-20 are recorded in [`owner-decisions-2026-09-12.md`](./owner-decisions-2026-09-12.md),
  which reached protected `develop` with the dataset slices and is present at this head.** They are
  quoted above from that record rather than restated, and this slice neither adds to that file nor
  changes it.
