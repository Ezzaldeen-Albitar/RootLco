# Owner directive of 2026-09-16 — SaaS operation before daily use

## Status

Recorded 2026-09-16 at protected develop `2c573a24`. Implementation in progress; nothing in this
directive is complete until its row in `capability-status.md` says so.

## The directive

The Owner's eleven numbered sections, restated as requirements. Each requirement is the statement
the work is measured against; the measurement itself lives in `capability-status.md`, and every
prerequisite found while measuring is a row in `change-control.md`.

### OD-1 — Environment configuration

A complete inventory of every environment value the platform reads, with tracked templates that
carry no secret; a working local configuration; a production template in which every value that
must come from outside the repository is identified as such; validation at startup that refuses to
run on an incomplete or contradictory configuration; and one list of the values the Owner or a
provider must supply.

### OD-2 — Platform Owner Console

A console operated on the existing platform-operator identity, never on a tenant administrator.
It must list, search and open organisations; create a tenant together with its first company and
its first branch; add further companies and branches where the tenant's plan permits; create or
invite the tenant's first administrator; record a subscription term with its dates, plan, enabled
modules, branch limit and user limit; support annual and multi-year terms; support renewal,
upgrade, downgrade, suspension and reactivation; show usage against entitlement; keep the
subscription lifecycle and its change history; and enforce every limit on the server under
concurrency, so two simultaneous requests cannot both pass the last seat.

It must also report platform statistics: active, suspended and expiring tenants, counts, amounts
by currency, service health, and a searchable administrative audit history. Subscription revenue
is reported separately from workshop revenue, because they are different businesses that happen to
share a database. The initial commercial flow is owner-recorded sales and receipts; no card
provider is assumed to exist. Plan prices are configurable.

### OD-3 — Organisation administration

Administration of companies, branches, departments, employees, users, invitations, roles and
scopes, each with a clear explanation when an action is refused — the reason in the operator's
language, not a transport code.

### OD-4 — Inventory, sales, barcodes and returns

**Inventory.** Warehouses and their locations; on-hand, reserved, available and in-transit
quantities; receiving, transfers, issues, returns and approved adjustments; stock counts that
record variances and cope with movements that happen during a count; and a traceable cost history
that is appended to rather than rewritten.

**Sales.** Both the internal issue against a work order and the external sale with no work order
at all. An external garage buying parts is a customer of the selling tenant, and the sale is
recorded as such.

**Barcodes.** Tenant-scoped identification of items, manufacturer codes, packaging units,
printable labels, camera and hand scanner input, a manual fallback when neither reads, and
duplicate-frame protection so one physical scan is one event. A product barcode identifies a
product; a serialized unit identifier identifies one physical unit. They are not the same field.

**Returns.** A return is linked to the original lines, may be partial, and enforces the remaining
returnable quantity. It distinguishes what was received from what is restockable and what is
damaged. Its effects are applied exactly once. Cancelling a document is not a physical return and
must not be recorded as one.

Screens that show stock update as it moves, and when an update cannot be delivered the screen says
the figure is stale rather than presenting an old number as current.

### OD-5 — Duplicate-demand controls

The approved material requirement for a work order and service operation is a business quantity,
and it must not be exceeded across separate requests, reservations or issues, including under
concurrency. Exceeding it is possible only as an authorized exception carrying the authorizing
role, a reason and an audit entry. Quantity arithmetic is exact in the declared unit. An oil
specification is attributable to a source; capacity is never guessed by a language model.

### OD-6 — Operational intelligence

Concrete intelligence, not a slogan: dashboards, low-stock suggestions, discrepancy and unusual
consumption alerts, routing of duplicate demand to whoever decides it, expiring-subscription and
capacity alerts, a stated freshness for every figure and drill-through to the records behind it. A
suggestion is a suggestion until a person accepts it; it never becomes a transaction on its own.
No external AI provider is required. Camera capture of a chassis number or an odometer reading is
a separate question from barcode scanning and is judged separately.

### OD-7 — Search

Search by customer name, by customer phone, by vehicle make and model, by chassis number and by
plate number including a plate's history; consistent normalization between Arabic and English
input, including digits; paging on the server; and the same scope isolation that governs every
other read.

### OD-8 — Execution order and reporting

Work proceeds in the order A to F the Owner set, and progress is reported as a compact status row
per capability rather than as prose. `capability-status.md` is that report.

### OD-9 — The pending code-scanning result

Consume the pending code-scanning result on `2c573a24` once, and fix the classification defect
that produced it narrowly, without widening any allow-list.

### OD-10 — Prove the journey

Prove the business journey end to end with controlled isolated acceptance records, never against
the shared working data of another run.

### OD-11 — Delivery

Correct the administrator runbook so it provisions the Platform Owner identity rather than a
tenant's first owner; deliver that access privately; update the manual and the quick start; and
state the deployment status plainly.

## Coordinator decisions

**D-OD-01 — Who the Platform Owner is.** The Platform Owner is the holder of a row in
`iam.platform_grants`: the platform-operator identity created by
`scripts/platform/genesis-platform-operator.mjs`. It is never a tenant administrator, and a tenant
administrator is never given platform authority to stand in for one.

**D-OD-02 — How this work travels.** Branches are named `feature/owner-directive-*` and are judged
under ownership profile `owner-directive-saas-operation`. Every prerequisite discovered while
measuring is recorded in `change-control.md` under change control, not inserted as a P1-32 task.
P1-32 remains the validation phase and its task list is not reopened by this directive.

**D-OD-03 — Who creates companies and branches.** A tenant's administrator creates further
companies and branches inside the tenant, and the server enforces the plan's limits on those
creations. The console can also create them, and can raise the limits — that is the console's
distinct authority, not a duplicate of the administrator's.

**D-OD-04 — The commercial flow.** The initial flow is owner-recorded subscription charges and
owner-recorded receipts against them, with configurable plan prices. No payment provider exists in
this repository and none is assumed; a future integration is its own decision.

**D-OD-05 — Deployment status.** The application is LOCAL-ONLY (ADR-012). The deploy workflows
present in the repository are inert. A merge to `main` is a promotion of reviewed source, not a
deployment, and must never be reported as one.

**D-OD-06 — The classification correction.** The correction is a new `docsTooling` change category
that triggers the `code-security` job and no other. It is deliberately narrower than reusing the
`scripts` category, which would also trigger two database jobs that a documentation tool cannot
affect.

**D-OD-07 — Task identifiers.** Task ids for this work are `P1-32-PRE-NNN`, carried in the commit
subject and in the `change-control.md` row the commit closes or opens.

**D-OD-08 — Acceptance data.** Acceptance uses controlled isolated records whose tenant codes match
no backend suite prefix, so no suite's cleanup can delete them and they can delete nothing of a
suite's. Acceptance never wipes the shared database.

## Code-scanning result on `2c573a24`, consumed once (section 9)

Observed 2026-09-16, read-only, through the check-runs API.

At develop head `2c573a24` all 40 check runs completed with conclusion `success`, including both
code-security language jobs — `code-security / code-security (javascript-typescript)` and
`code-security / code-security (actions)` — and `protected-gate`.

At the head commit of pull request #409, `7926f634`, the umbrella `code-security` check was
`skipped`. The pull request changed one file, `docs/user-manual/tools/build-pdf.mjs`, and the
change classifier read every path under `docs/` as prose, so the change was classified
documentation-only and the conditional job was recorded as not required.

Stated plainly: code scanning passed on the merge commit, not on the pull request. The window in
which a finding could have been reviewed before merge did not exist. That is the defect corrected
by P1-32-PRE-001, recorded as CC-OD-01.
