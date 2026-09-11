# The report engine — P1-31 prerequisite P-11, slices 1, 2 and 3 of 4

**Status:** implemented on branch `remediation/p1-31-backend-report-engine-work-orders`,
**UNMERGED**; executable tree at `b14818ce`, with records-only commits after it · **Authority:**
prerequisite **P-11** of [`a0-preflight.md`](./a0-preflight.md); Owner decision **D-4** of
2026-09-09 approved the baseline of four reports and their columns, and everything below about HOW
that baseline is served is an engineering consequence rather than an Owner decision ·
**Baseline:** protected `develop` `249c6428`, with protected `develop` `07193258` merged in on
2026-09-10 and protected `develop` `01c32937` on 2026-09-11

This slice makes one report runnable on this branch. It adds a dataset registry, one operation that
executes a registered dataset, and `work_orders_by_status` implemented in the module that owns the
tables. Nothing here is merged. It does **not** add the other three baseline reports, the
report-configuration writer, or export.

---

## 1. What P1-23 left, and what actually unblocked it

P1-23 published `GET /reports` and `GET /reports/{reportCode}` and returned `executable: false`
as a **literal**, with a written reason: the frozen `rpt` schema has no data-source column, so
nothing in the approved contracts says what `report_code = 'x'` should select, and inventing one
would have meant inventing a business report definition nobody approved.

The binding did not arrive as a column and was never going to. **Engineering consequence (not an
Owner decision):** this design takes its shape from the Owner's PLANNED proposal A-12, adopted here
as an engineering choice. The Owner's register carries it as "Proposed implementation policy ·
Planned" (`docs/product/owner-requirements-2026-09-06.md:198`), so it is a proposal and not an
approved requirement:

> a report definition binds a `report_code` to a **code-registered dataset**
> — `docs/product/owner-requirements-2026-09-06.md:202`, OWR-2026-09-06-A-12

So the query, the columns and the permission a report needs are declared in **source**, where a
reviewer can see them and a gate can read them. `rpt.report_configurations` keeps the job it
always had: configuration **about** a report.

## 2. The registry

`apps/api/src/modules/reporting/domain/report-datasets.ts` — a frozen object keyed by report code.
Each entry declares `code`, `titleKey`, `scope`, `requiredPermission`, `parameterSchema` and
`columns`.

**The registry is split across two files, and that is a boundary rule rather than a preference.**
Boundary rule `B5` forbids a module's `domain/` layer from importing `@/server/db` — even as a
type — so a `resolver` field taking a `DbHandle` cannot live beside the definitions. The
definitions are therefore pure metadata in `domain/`, and the resolvers are a
`Readonly<Record<ReportDatasetCode, ReportResolver>>` in `application/report-run-service.ts`. The
two halves cannot drift: the record is keyed by the registry's own `keyof typeof` union, so a
definition without a resolver does not compile and a resolver for an unregistered code does not
compile either.

## 3. The run operation

| field           | value                                                               |
| --------------- | ------------------------------------------------------------------- |
| id              | `rpt.report-run`                                                    |
| method / path   | `GET /reports/{reportCode}/rows`                                    |
| module          | `reporting`                                                         |
| permissions     | `rpt.report.read`                                                   |
| scope           | `branch` — `companyId` and `branchId` are REQUIRED query parameters |
| auditClass      | `none`                                                              |
| rateLimitPolicy | `expensive-read`                                                    |
| cacheCategory   | `never`                                                             |
| success status  | 200                                                                 |
| response        | `ReportRunView` — a named wire shape                                |

A separate path from the definition read rather than a query parameter on it: running a report is
a different question with a different cost, and one path with two meanings would make the
rate-limit policy and the cache category answer for both at once.

## 4. The authorization model

Two checks, in this order, and they are different questions.

1. **The route** authorizes `rpt.report.read` at `scope: 'branch'` with the caller's company and
   branch as the `authorizationTarget`. Branch scope is not a preference:
   `requiresScopedEvaluation` (`apps/api/src/server/auth/authorization.ts:63`) returns false for a
   TENANT-scoped operation whatever target it is handed, so a tenant-scoped run would be decided by
   the scope-blind `iam.has_permission`, and `app.branch_ids` is the permission-blind union of every
   active grant (P1-18-A-01). A caller holding the code in one branch would report on another.
2. **The service** then evaluates the dataset's own `requiredPermission` — `wo.work_order.read` for
   the only dataset registered today — against the SAME company and branch, through
   `callerHoldsPermission`, which asks the same deployed `iam.has_permission_in_scope` every other
   check asks. No second definition of scope is introduced.

The run then reads the caller tenant's explicit configuration under the same transaction.
No configuration permits the code baseline. An existing draft or archived configuration is
not a baseline fallback; execution returns `ERR-RES-001`, as does a published configuration
without a live published version. Soft-deleted versions are excluded from resolution.
The catalogue also suppresses baseline fallback for existing drafts and archived rows.

For a published configuration, `scope_level` is a ceiling, following BR-RPT-001's ordering
`branch < company < tenant`. The branch-only dataset remains branch-only even if a tenant
configures a broader ceiling.

**Engineering consequence (not an Owner decision) — the filter vocabulary.** The existing
`parameter_schema` shape `{ filters: { name: { type } } }` is read as an explicit allowlist: every
supplied report filter (`companyId`, `branchId`, `from`, `to`) must be listed, with the
corresponding `uuid` or `date` type. The frozen database default `{}` adds no filter restriction; an
explicit `{ filters: {} }` permits none. Pagination controls are transport parameters. Unknown
schema properties, filter names, types, or constraints return `ERR-IAM-001` before any dataset read.
This conservative behaviour does not invent a general schema evaluator; supporting richer
constraints requires an agreed executable vocabulary. None of the four names, the two types or the
refusals is part of D-4 or of any other Owner decision.

What IS the Owner's is the standing rule that code-registered availability must not bypass explicit
tenant restrictions: a tenant restriction is never silently discarded in favour of registry
defaults.

**The writer now shares this vocabulary on this branch.** As merged on `develop`, the configuration
writer of PR #361 accepted
any bounded JSON object and deferred vocabulary entirely, so publication alone did not prove a
restriction this engine could evaluate — an administrator could publish `{ branchId: { type:
'uuid' } }`, with the filter named at the top level rather than under `filters`, and every run of
that report would then be refused with no authoring-time signal at all. The rules above are
therefore no longer stated here in prose and separately in code. They live in
`readReportParameterVocabulary`, in `apps/api/src/modules/reporting/domain/report-configuration.ts`,
and BOTH this engine's `assertReportConfiguration` and the version-create route read that one
function. A schema the engine would refuse is refused at authoring, where the person who wrote it
can correct it. That is the behaviour of this unmerged branch; on `develop` the version-create route
still defers the vocabulary.

The engine's own behaviour did not change in the process, and that was a constraint rather than an
accident: rows already published in tenant databases must keep the meaning they had, so
`{ filters: {} }` is still honoured here as an allowlist permitting nothing. It is the WRITER that
refuses to create another one. The vocabulary, the refusal messages and the reason both sides agree
are recorded in [`report-configuration-seam.md`](./report-configuration-seam.md) section 7.

Export remains unavailable for this dataset. The tenant's explicit export permission is
preserved in catalogue metadata; read permission grants no export authority. P-12 must enforce
the configured permission, dataset permissions and these same restrictions before generating
an export. The generic P1-15 export-authorize operation does not itself implement report export.

**Why the second check cannot be a declaration.** `defineOperation` is a literal read statically by
the authorization gate, so one operation cannot declare a code that depends on its path parameter.
The service check answers the **uniform** `ERR-IAM-001` — the same failure the route's own check
produces — so a caller cannot tell the two apart and cannot use the difference to discover which
datasets exist.

**The order is itself a decision.** The permission is evaluated BEFORE the branch is resolved. An
unrestricted grant satisfies `iam.has_permission_in_scope` for a branch id that does not exist, so
resolving the branch first would let a caller holding only `rpt.report.read` distinguish a real
branch from an invented one by the error code.

**The tenant boundary is a control that already existed, and the run does not restate it.**
`requireScopeTargetInTenant` (P1-30 **CC-14**) resolves the caller's (company, branch) pair under the
caller's own RLS before the handler runs, and refuses a foreign tenant's real pair, a pair that exists
nowhere, an in-tenant pair belonging to another company and a soft-deleted branch — all with the same
`ERR-IAM-001`, deliberately not a 404. So the run service's own `ERR-RES-001` for an unresolvable
branch is **unreachable through the published route** for a fully-specified pair; the suite measures
that the 403 arrives first. It is kept as defence in depth because the service is callable without
that pre-handler probe. This was written the other way round first, and the live run corrected it.

## 5. The period and the timezone — APPROVED 2026-09-10; the source column is not

**Approved by the Owner on 2026-09-10**, in the Owner's words: half-open `[from, to)` periods in the
selected branch's timezone, converted consistently for server queries; timezone and filter context
displayed and preserved; cross-branch reporting uses one explicit reporting timezone. The record is
[`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) § 4, which reached this branch
with the protected `develop` `01c32937` sync.

**Recommendation pending Owner approval.** One question the approval does not answer is which SOURCE
column supplies "the selected branch's timezone"; this slice reads `org.branches.timezone_name`, and
that choice is a recommendation rather than an approved one.

**Measured facts (not part of the decision).** Both candidates exist and both are foreign keys into
`shared.timezones`:

| candidate                                      | argument                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `org.branches.timezone_name` (**recommended**) | the report is branch-scoped; "orders opened on the 3rd" is a claim about the day where the workshop is              |
| `org.tenants.default_timezone`                 | one tenant-wide calendar makes two branches' reports addable; a branch report would then not match the branch's day |

**Only two zones are seeded.** `supabase/seeds/01_reference_data.sql` ships `UTC` and `Asia/Amman`,
and `fk_branches_timezone` refuses anything else — so a branch's zone is one of two values today
whichever column a report reads, and the open question is about which COLUMN, not about which zone.

**No query in the platform buckets by either column today**, so nothing was matched and nothing was
broken. If the Owner prefers the tenant default, the change is one lookup in `ReportRunService.run`
and the test that proves the boundary.

**Engineering consequence (not an Owner decision).** The approved half-open period is implemented as
`from` the first day included and `to` the first day **excluded** — the day after the last one
reported. A closed upper bound over a calendar day either swallows the next day's first instant or
drops the last one's final microsecond, and either shows up only as a total that does not add up.
`WorkOrderRepository.listWorkOrders` compares `opened_at <= openedTo`, a CLOSED bound, which is
correct for the board's instant-valued filter and was deliberately **not** reused.

## 6. The catalogue merge rule — OPEN to Owner override

**Engineering consequence (not an Owner decision) — this is CC-27(b), and the Owner has not
confirmed it: a configuration row is CUSTOMIZATION, not a precondition.**

- `GET /reports` returns the code-registered baselines first, marked `source: 'platform'`, then the
  tenant's own published rows by code, marked `source: 'tenant'`.
- A tenant row whose code is registered **suppresses** its baseline entry and is returned in its own
  place, carrying that tenant's scope, export permission and parameter schema.
- `GET /reports/{reportCode}` answers the tenant's row if one is published, the baseline only
  when no live configuration exists, and `ERR-RES-001` for an unpublished/archived row or an
  unknown code. An explicit tenant decision cannot be bypassed by registry fallback.
- `executable` becomes `REPORT_DATASETS` membership rather than a literal `false` — true for a code
  the engine implements, false for a published tenant row whose code it does not. That is the
  behaviour on this branch; on `develop` it is still the literal `false` until this branch merges.

Baselines are emitted on the **first page only**. They are bounded by the source tree rather than by
tenant data, so they cannot make a page unbounded, and the suppression is decided by one bounded
lookup over the registered codes, so a tenant row on a later page still hides its baseline. What a
caller must not assume is that the whole page is sorted by code: it is baselines, then codes
ascending.

**The alternative, and why it was not taken.** "A report is invisible until an operator configures
it" is defensible and is what a strict reading of P1-23 implies. It would mean every tenant must
author four configuration rows before any report works — and `rpt.report_configurations` has no
seed and had no writer at the time of this slice. PR #361 subsequently merged the writer; the
catalogue-merge rule above is **CC-27(b)**, an engineering decision the Owner has not confirmed, and
it is what this branch implements. **It is OPEN to Owner override**; reversing it is a change to two
methods in `ReportCatalogueService` and their cases.

A baseline entry publishes `exportPermissionCode: null` rather than naming `rpt.export`. Report
export is prerequisite P-12 and `rpt.export` is deliberately excluded from the provisioning bundle
(change control **CC-04**), so naming a code would advertise a path that does not exist.

## 7. `work_orders_by_status` — the definition

Rows are one keyset page, newest opened first, of the work orders **opened** in the period in the
branch. Cells carry two halves: `label` is what a human reads, `value` is the machine-readable id,
code or instant.

| column      | kind        | label                                           | value            | source                                                  |
| ----------- | ----------- | ----------------------------------------------- | ---------------- | ------------------------------------------------------- |
| `workOrder` | `reference` | `displayNumber` (null until a number is issued) | work-order id    | `wo.work_orders`                                        |
| `branch`    | `text`      | `org.branches.name`                             | branch id        | the iam branch-context port                             |
| `customer`  | `reference` | party display name, or null                     | partner id       | `WorkOrderSummary.customer`, the dated BR-05 projection |
| `vehicle`   | `reference` | plate, else make and model, else null           | vehicle id       | `WorkOrderSummary.vehicle`                              |
| `openedAt`  | `date`      | —                                               | ISO-8601 instant | `wo.work_orders.opened_at`                              |
| `state`     | `text`      | `wo.work_order_states.name`                     | state code       | the tenant/platform-resolved state catalogue            |

Drill-through: `workOrder` declares the route TEMPLATE `/work-orders/{id}`, which the cell's
`value` fills. A template rather than a built URL — the API does not own the client's route table.

Beside the rows, `countsByState` gives every state's count **over the whole scoped selection**,
computed in SQL without the keyset window. Counting the page would answer for at most `limit` rows
and call it the branch's position, which is the P1-28 round-two defect exactly. States with no rows
appear at **zero**, filled in from the tenant's own state catalogue, because "no order is awaiting
parts" is an answer a manager needs to be able to read and a `GROUP BY` cannot produce it. A state
holding rows that is no longer ACTIVE in the catalogue is still reported, labelled by its code —
dropping it would make the counts disagree with the rows on the same page.

The envelope also carries `period` (with the zone it was resolved in), `generatedAt` and
`freshness: 'live'`. `live` is a claim about provenance: the rows are read from the operational
tables inside the request's own transaction. There is no snapshot, no cache and no materialised
view behind this answer, and a client must not present it as one.

## 8. Ports added

| port                                                            | why it exists                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workOrderModule().reportPort` (`WorkOrderReportPort`)          | `wo.*` is private to the work-order module (ADR-001 rule 3), so the SQL lives there and reporting asks for the answer — the `OpenInventoryCommitments` / reception party-context precedent |
| `iamOrganizationContext().branches` (`BranchContextRepository`) | the period is bucketed in the branch's timezone, so every run resolves one branch of `org.*`; nothing on the iam surface offered a single-branch read                                      |

`iamOrganizationContext` is a THIRD composition root in the iam module, beside `iamDirectory`, and
for the same measured reason that one exists: `iamModule()` calls `installIamRuntime()`, so
composing it to read one organizational column would make a report run depend on the identity
provider's configuration and answer `ERR-SYS-001` wherever it is unset. A separate root rather than
a key on `iamDirectory` because a branch's timezone is not an identity.

The branch-name prerequisite the plan anticipated is therefore **closed rather than deferred**: the
run resolves the branch anyway, so the name costs nothing extra and the `branch` column emits a
name instead of a bare id.

## 9. Named prerequisites — what a later slice will need

| #   | prerequisite                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Bilingual state labels need a schema change.** `wo.work_order_states.name` is a single `text` column (`supabase/migrations/20260722091000_wo_state_catalogs.sql`), so a client asking for Arabic cannot get a state label from this API. Inventing one here would be a fabricated translation                                                                                                                                        |
| 2   | **`countsByState` is dataset-specific and sits on the shared envelope.** The one dataset registered today groups by work-order state; the other three baseline reports group differently, and generalising the field is their work                                                                                                                                                                                                     |
| 3   | **Aggregate and batch ports for the other three reports.** Each needs its own port on its owning module, on the same rule this slice applied — the module that owns the tables answers for them                                                                                                                                                                                                                                        |
| 4   | **Richer executable filter vocabulary.** On this branch the writer of PR #361 is integrated and validates against this engine's vocabulary through one shared function, so the drift is closed here and closes on `develop` only when this branch merges. What remains open is the vocabulary's SIZE: four filter names, because four is what the engine implements. A fifth is a change to the engine and to the shared list together |

**Movement on this table, recorded by engine slice 2** (branch
`remediation/p1-31-backend-report-engine-datasets`, stacked on the slice-1 branch and equally
unmerged). Row 1 is unchanged. Rows 2 and 3 are addressed, and the rows below are what slice 2
itself leaves for the two datasets after it:

| #   | prerequisite                                                                                                                                                                                                                                                                                                                                                                               | state after slice 2                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `countsByState` on the shared envelope                                                                                                                                                                                                                                                                                                                                                     | **closed.** `groups` replaces it — group key, label and string-valued measures, computed over the whole selection. `countsByState` is retained, marked deprecated and DERIVED from `work_orders_by_status`'s own groups, so the two cannot disagree; it is empty for every other dataset |
| 3   | Aggregate and batch ports for the other reports                                                                                                                                                                                                                                                                                                                                            | **closed for the technician report only.** `technicianModule().reportPort` and a second method on `workOrderModule().reportPort` (below). `inventory_movements` and `invoice_payment_summary` still owe theirs                                                                           |
| 5   | **Retiring `countsByState`.** It is published, deprecated and correct. Removing a published field in the same change that adds its replacement leaves a consumer no window in which both exist, so the removal belongs to a later slice — and belongs with a check that no consumer still reads it                                                                                         | open, raised by slice 2                                                                                                                                                                                                                                                                  |
| 6   | **A localised label for `source`.** `tech.labor_sessions.source` is a CHECK-constrained vocabulary (`manual`, `timer`, `correction`) and no catalogue carries a name for any of the three, so the report publishes the code and no label. The client renders it from an i18n key; an English word invented in the API would ship as though it were a catalogue value                       | open, raised by slice 2                                                                                                                                                                                                                                                                  |
| 7   | **No technician detail screen consumes the `technician` drill-through.** The column publishes the route template `/technicians/{id}`, which the API states and the client resolves; `apps/web` has `technicians/me` and no per-technician route at this head. FE-012 is not started, so the template names a screen that does not yet exist and a client without it simply renders no link | open, raised by slice 2                                                                                                                                                                                                                                                                  |
| 8   | **A duration is seconds, not hours.** Every `duration` cell and every `durationSeconds` measure is whole seconds as an integer string. Presenting hours is a DIVISION and therefore a rounding decision; nobody has taken it, and taking it in the API would make every total built on the figure carry the error                                                                          | open, raised by slice 2                                                                                                                                                                                                                                                                  |

**Movement recorded by engine slice 3** (same branch, same unmerged state). Row 3 closes for the
inventory report; rows 9 to 11 are what slice 3 itself leaves behind:

| #   | prerequisite                                                                                                                                                                                                                                                                                                                                                                                              | state after slice 3                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 3   | Aggregate and batch ports for the other reports                                                                                                                                                                                                                                                                                                                                                           | **closed for the inventory report too.** `inventoryModule().reportPort`. Only `invoice_payment_summary` still owes one |
| 9   | **There is NO PER-ITEM READ OPERATION.** The `item` column is a `reference` with no `drillThrough`, because the register holds `inv.item-search` (a list) and no `inv.item-read`. A template naming an operation that does not exist would publish a link that cannot resolve, so none is published. Adding one is a new operation, not a change to this dataset                                          | open, raised by slice 3                                                                                                |
| 10  | **`inv.stock_movements` records no unit.** The report joins `inv.item_master.uom_id`, so the unit on a row is the item's unit AS IT IS NOW — re-pointing an item's unit restates its whole movement history. The unit is in the group key regardless, which keeps the separation visible; carrying the unit on the movement is a schema change nobody has authorised                                      | open, raised by slice 3                                                                                                |
| 11  | **The ledger cannot record a BACKDATED movement.** `shared.stamp_status_history` assigns `occurred_at := now()` unconditionally on every insert, and `app_runtime` holds SELECT and INSERT and no UPDATE. A movement's date is the date it was written, and a period report over `occurred_at` is exactly as accurate as that. Nothing here is wrong; what nobody can do is post a movement dated earlier | open, raised by slice 3                                                                                                |

## 10. What this slice does NOT close

**Measured facts (not part of the decision) — what was actually run, and where.** On 2026-09-11, at
head `b14818ce` — the executable tree of this branch after the `01c32937` sync, the commits after it
being records only — the following controlled runs were observed. Every database-bound one used a
DISPOSABLE LOCAL CLONE, `p131_report_controls_20260910` on `127.0.0.1:55432`, carrying 139
migrations on PostgreSQL 17.10:

| run                                                         | result               | database window (UTC) |
| ----------------------------------------------------------- | -------------------- | --------------------- |
| `npm run test:backend` — the whole tier, on the clone       | 136 files, 2906/2906 | 09:43:04 → 09:57:30   |
| `tests/db/rpt-reporting.test.ts`, on the clone              | 3/3                  | 09:57:47 → 09:57:51   |
| `tests/backend/p1-23-reporting.test.ts` alone, on the clone | 13/13                | not timed separately  |
| `npm run test:unit`, through the P1-27 recorder             | 3300/3300, 122 files | no database           |
| the web tier, through the P1-27 recorder                    | 3664/3664, 133 files | no database           |

The engine suite, the configuration seam and the unit controls were each observed at 29/29, 29/29
and 23/23 on 2026-09-10 at `3cb65df9`; the whole-tier run above contains the two backend ones and
the recorded unit tier contains the third.

**There was no hosted gate, no run against the shared database, and no merge.** PR #364's remote
head `59be1698` has no checks recorded, it is behind this local branch, and no hosted result exists
for `b14818ce` or for any commit after it. Final integration and shared-database evidence follow the
coordinator's dependency and database ownership sequence. Change control section 40.4 states the
same runs in the same terms.

- **No migration and no schema change.** Every statement uses grants and policies that already
  existed; `rpt` is exactly as P1-11 left it.
- **No permission was minted and no seed changed.** `rpt.report.read` and `wo.work_order.read` are
  both existing catalogue rows, and this operation is the first thing to require them together.
- **The other three baseline reports** the chapter declares are not implemented. The registry holds
  exactly one entry and a test pins that, so the count cannot drift silently. _(Sections 1-10 record
  slice 1 as it stood. Slice 2 added `technician_labor_time` and moved the pin to two; see § 11.)_
- **Export is untouched** (prerequisite P-12). `rpt.export` stays excluded on **CC-04**'s unchanged
  grounds, no export path is offered, and a baseline names no export permission at all.
- **No frontend.** FE-011 … FE-016 are unreleased and `apps/web/src` was not edited except through
  `lib/api/idempotent-operations.ts`, which a repository script regenerates and which every
  published operation moves.
- **No allow-list was widened and no gate was suppressed.** `check-p1-30-payload-parity.mjs` does
  not hold `rpt` operations to a mirror — `P1_30_DOMAINS` is `svc`, `quo`, `inv`, `sal` — and this
  is a GET with no body, so declaring a `PENDING` entry would be a claim about a gate that does not
  look here.

---

## 11. Engine slice 2 — `technician_labor_time`

**Status:** implemented on `remediation/p1-31-backend-report-engine-datasets`, **stacked on the
slice-1 branch and equally UNMERGED**; no hosted result exists for it. **Authority:** Owner
decision **D-4** of 2026-09-09 for the columns and the contributing rule, Owner decision **D-17** of
2026-09-10 for the period. Everything below headed _Engineering consequence_ is this coordinator's
choice and not an Owner decision.

### 11.1 The Owner's text, quoted

> **`technician_labor_time`** — technician, branch, work-order reference, work-log date and the
> recorded duration. The definition states which log states contribute; cancelled and deleted logs
> are excluded. Recorded duration is duration, and the definition says so: it is not productivity
> and it is not a payroll figure.
> — [`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md) § 3 (D-4)

> Every report period is **half-open**, `[from, to)`, expressed in the **selected branch's
> timezone** and converted consistently before it reaches a server query. … The **timezone and the
> filter context are displayed and preserved** wherever the result is shown, printed or recorded.
> — [`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) § 4 (D-17)

### 11.2 Measured facts (not part of the decision)

- `tech.labor_sessions` (`supabase/migrations/20260722099000_tech_labor_sessions.sql`) carries
  `technician_profile_id`, `job_id`, `started_at`, a NULLABLE `ended_at`, `source` constrained to
  `manual` / `timer` / `correction`, `correction_of_id`, and `deleted_at`.
- **The table has no status column and no cancelled state.** The soft delete and
  `source = 'correction'` are its entire lifecycle. So "cancelled logs are excluded" is satisfied by
  there being nothing of that kind to exclude, and the report shows **no cancelled bucket**: an
  empty one would read as a real zero for a concept that does not exist.
- **There is no duration column.** `ck_labor_sessions_window` guarantees only
  `ended_at IS NULL OR ended_at > started_at`.
- **A session names a JOB, never a work order.** The work-order id lives on `wo.jobs`
  (`20260722097000_wo_jobs.sql`), which is the work-order module's private schema.
- `ex_labor_sessions_overlap` is a partial GiST EXCLUDE per technician over
  `tstzrange(started_at, COALESCE(ended_at,'infinity'))`, so an open session overlaps everything
  starting after it. That is why the suite gives each excluded case its own fixture technician.

### 11.3 Engineering consequence (not an Owner decision)

- **Contributing = `ended_at IS NOT NULL AND deleted_at IS NULL`.** An open session has no duration,
  and running one to `now()` would make the same report over the same CLOSED period total
  differently on every run. A corrected session is counted once, on its amended window.
- **The duration is computed in SQL as whole seconds, carried as an integer string.**
  `extract(epoch from (ended_at - started_at))::bigint::text`. No float is constructed anywhere, and
  each technician's total is the SUM OF THE SAME per-row expression, so adding a page can never
  disagree with the group.
- **Seconds rather than hours.** Hours is a division and therefore a rounding decision nobody has
  taken; see § 9 row 8.
- **Two required permissions, `tech.technician.read` AND `wo.work_order.read`.** The first is the
  code `tech.labor-session-list` already declares for the same rows. The second is there because the
  report resolves each session's job to its WORK ORDER and publishes that reference: without it, a
  caller holding `rpt.report.read` and `tech.technician.read` alone would learn which work orders
  carried labour in the branch and their display numbers, which is the work-order module's record
  read through a report. **A report is not a way to be told something the record's own read
  operation would refuse**, so the dataset names the column's own read code and the check is
  CONJUNCTIVE — the whole report is refused to a caller who lacks either, on the same fail-closed
  shape the delivery readiness seam took when one read spanned two modules. This is not a
  broadening: no caller gains anything, and the only callers affected are those who could previously
  see a reference they could not have read directly. It is an Engineering consequence of D-4's own
  column list ("work-order reference") rather than an Owner decision. Recorded as **CC-33**, whose
  disposition is now CLOSED by this change rather than left for the Owner.
- **The technician's NAME comes from the iam directory** and is `null` for a caller without
  `iam.user.read`, with the profile id published beside it either way. A null label is a real
  state — "this caller may not be told who that is" — not a missing value, and nothing is invented
  to fill it.
- **Groups list only the technicians who contributed.** Unlike the work-order state counts there is
  no zero row for a technician who logged nothing: a state is a catalogue entry and "none are
  awaiting parts" is an answer, whereas a roster listed at zero would make this an attendance
  record, which D-4 says it is not.
- **Columns, in the Owner's order:** `technician` (reference, drill-through `/technicians/{id}`),
  `branch` (text), `workOrder` (reference, drill-through `/work-orders/{id}`), `workLogDate` (date,
  the session's START instant), `duration` (duration, seconds), and `source` (text) — added beside
  the Owner's five because a reader who cannot see that a row is a correction cannot tell an amended
  figure from an original one. Nothing else was added.
- **The period predicate is on `started_at`**, through the shared helper, so the "work-log date" is
  the day the work was STARTED in the branch's own zone. A session that begins one second before the
  period closes is included and its end may fall outside the period; that is the half-open rule
  applied to one column rather than to an interval, and choosing the start is what makes each
  session belong to exactly one period.

### 11.4 Ports added

| port                                                | why it exists                                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `technicianModule().reportPort` (`LaborReportPort`) | `tech.*` is the technician module's private schema, so the selection, the totals and the name resolution live there and reporting asks for the answer |
| `workOrderModule().reportPort.workOrdersForJobs`    | `tech.labor_sessions` carries a job id and `wo.jobs` is the work-order module's, so that module answers for it — the same rule in the other direction |

Both are branch-scoped and batched over one page, and neither performs authorization: the dataset
registry declares the codes and `ReportRunService` evaluates them, in one place.

### 11.5 The shared engine changes this dataset required

They are recorded in commit `P1-31-P-11-020` and in change control § 45: `groups` on the envelope
with `countsByState` retained, deprecated and derived; the filter context and the branch on the
envelope for D-17; `requiredPermissions` as a conjunctive list; three measure column kinds; and
`apps/api/src/server/db/period.ts`, which holds the half-open local-day predicate ONCE because D-17
requires the conversion to be consistent and a second copy is how two reports over one period stop
adding up. `WorkOrderRepository.statusSummary` composes the helper; the expression it ran before is
unchanged.

### 11.6 What slice 2 does NOT close

- **No migration, no schema change, no seed row, no permission and no audit action.**
  `tech.technician.read` and `wo.work_order.read` are both existing catalogue rows and no bundle
  moved. The dataset naming a second EXISTING code is a narrowing of what the report discloses, not
  a new grant.
- **No new operation and no new path.** `rpt.report-run` serves the dataset; the register stays at
  407 operations and 316 OpenAPI paths, and the committed contract document is byte-unchanged.
- **No export.** Prerequisite P-12 is untouched and `rpt.export` stays excluded on CC-04's grounds.
- **No frontend.** FE-012 is not started and `apps/web/src` was not edited at all.
- **The remaining two baseline reports are not implemented.** The registry holds exactly two entries
  and a case asserts the exact list, so a third cannot arrive quietly.
- **No allow-list was widened and no gate was suppressed.**

---

## 12. Engine slice 3 — `inventory_movements`

**Status:** implemented on `remediation/p1-31-backend-report-engine-datasets`, **stacked on the
slice-1 branch and equally UNMERGED**; no hosted result exists for it. **Authority:** Owner decision
**D-4** of 2026-09-09 for the columns and the totals rule, **D-5** for the prohibition on a single
quantity across unlike items, **D-17** of 2026-09-10 for the period. Everything below headed
_Engineering consequence_ is this coordinator's choice and not an Owner decision.

### 12.1 The Owner's text, quoted

> **`inventory_movements`** — movement date, reference and type, the item, the warehouse or location,
> and the quantity with its unit. Totals are separated by item and by compatible unit, and the
> distinct meanings of a return and a transfer are preserved rather than netted away.
> — [`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md) § 3 (D-4)

> No single inventory quantity is presented across unlike items; a quantity is meaningful only within
> an item and a compatible unit.
> — [`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md) § 4 (D-5)

> Every report period is **half-open**, `[from, to)`, expressed in the **selected branch's
> timezone** and converted consistently before it reaches a server query. … The **timezone and the
> filter context are displayed and preserved** wherever the result is shown, printed or recorded.
> — [`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) § 4 (D-17)

### 12.2 Measured facts (not part of the decision)

- `inv.stock_movements` (`supabase/migrations/20260723094000_inv_ledger.sql`) carries `item_id`,
  `location_id`, `movement_type`, `direction`, `quantity numeric(12,3)`, a GENERATED `signed_qty`, a
  `reference_kind` / `reference_id` pair, `occurred_at` and a `seq` identity. It is **append-only and
  immutable**: no `deleted_at`, no status column, and `app_runtime` holds SELECT and INSERT only.
- **`movement_type` is CHECK-constrained to exactly five terms** — `opening`, `issue`, `return`,
  `damage`, `adjustment`. **`transfer` is not one of them**, and neither is `receipt`: the inventory
  module disclaims transfers by design, the `transfer` movement kind and the `transit` location type
  having been dropped in Phase 1-10.
- **`ck_stock_movements_type_direction` constrains the pair**: `opening` and `return` are always
  `in`, `issue` is always `out`, `damage` and `adjustment` may be either. **Damage is the only kind
  that posts a PAIR from one source row** — out of the sellable location and in to quarantine — which
  `uq_stock_movements_source`, unique on `(reference_kind, reference_id, direction)`, is what permits.
- **There is no unit column on the movement.** The unit is `inv.item_master.uom_id →
inv.units_of_measure (code, name, dimension)`, a property of the ITEM.
- **`occurred_at` cannot be chosen.** `tg_stock_movements_stamp` runs `shared.stamp_status_history`,
  which assigns `NEW.occurred_at := now()` on every insert.
- **There is no per-item read operation.** The register holds `inv.item-search`, a list, and no
  `inv.item-read`.

### 12.3 Engineering consequence (not an Owner decision)

- **Columns, in the Owner's order:** `occurredAt` (date), `reference` (text — the kind labels the
  ledger's `(reference_kind, reference_id)` pair and the id identifies it, NOT concatenated, because
  joining them would make this module the authority on how a reference is spelled), `movementType`
  (text), `direction` (text), `item` (reference — SKU label, item id), `location` (text — name as the
  label, branch-unique `location_code` as the value), `quantity` (quantity — an unrounded decimal
  string) and `unit` (text — the UOM code). **`direction` is the one column added beside the Owner's
  list**, because the CHECK constrains it together with the type and a reader who cannot see it
  cannot tell an adjustment up from an adjustment down. Nothing else was added, and `signed_qty` is
  deliberately NOT published.
- **The group key is `(item, unit, movementType)` and there is no grand total.** D-5 forbids a single
  quantity across unlike items and D-4 requires totals separated by item and by compatible unit, so
  both are in the key: two units can never merge into one number because they are two groups. The
  measures are `quantityIn` and `quantityOut`, TWO FILTERed sums rather than one signed sum, so **a
  return is never netted against an issue** — which is what D-4's sentence about preserving distinct
  meanings binds on a ledger that has no transfer.
- **The transfer that does not exist is STATED, not shown as an empty bucket.** An empty transfer row
  would read as a real zero for a concept the ledger cannot express. The suite proves the absence
  against the live CHECK constraint rather than against a comment.
- **Every quantity is a decimal string, end to end.** `numeric(12,3)` arrives from `pg` as text and
  stays text: no `Number`, no `toFixed`, no arithmetic in TypeScript. The sums are computed in SQL
  over the same expression the rows carry, so adding a page by hand can never disagree with a group.
  A FILTERed sum over an empty set is NULL and the zero is supplied as `0::numeric(12,3)`, so a
  measure is a decimal string at the same scale as a real one; **the sum itself is never cast**,
  because casting it back to `numeric(12,3)` would make a large branch's total raise an overflow
  instead of reporting a number.
- **One required permission, `inv.stock.read`** — the code `inv.stock-movement-list` declares for the
  same rows. One and not two: every column is `inv` master data or the ledger itself, so unlike the
  labour report there is no second module's record in the row.
- **The ordering is `occurred_at DESC, id`, under its OWN qualified contract key.** Not the ledger
  screen's `seq`: this is a report ABOUT A PERIOD, and sorting it on an insertion sequence would let
  a movement dated the third be paged between two dated the fifth. `occurred_at` is not unique, so
  the row id is the tie-break — the damage pair shares an instant, which is the case that needs it —
  and the cursor value is the microsecond-precision string, never a JS `Date` (`P1-27-INT-006`).
- **The port is a separate class, not a method on `InventoryReadService`.**
  `InventoryReadService.listMovements` takes a scope authorizer and writes an
  `inv.movement_history.read` audit row on every call. A report run is audited as itself; a second
  entry attributed to an operation the caller never invoked would be a false trail.

### 12.4 Ports added

| port                                                           | why it exists                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventoryModule().reportPort` (`InventoryReportPort`)         | `inv.*` is the inventory module's private schema, so the selection, the totals and the master-data joins live there and reporting asks for the answer                                                                         |
| `InventoryRepository.movementReport` + `MOVEMENT_REPORT_ORDER` | one scope predicate composed by both statements, so a total can never stop matching the rows it totals; and a second ordering contract over the same table, qualified so a ledger cursor is refused rather than reinterpreted |

The port performs NO authorization: the dataset registry declares the code and `ReportRunService`
evaluates it, in one place.

### 12.5 What slice 3 does NOT close

- **No migration, no schema change, no seed row, no permission and no audit action.**
  `inv.stock.read` is an existing catalogue row and no bundle moved.
- **No new operation and no new path.** `rpt.report-run` serves the dataset; the register stays at
  407 operations and 316 OpenAPI paths, and the committed contract document is byte-unchanged.
- **No export, and no frontend.** P-12 is untouched, `rpt.export` stays excluded on CC-04's grounds,
  and `apps/web/src` was not edited at all (FE-013 is not started).
- **`invoice_payment_summary` is not implemented.** The registry holds exactly three entries and a
  case asserts the exact list, so a fourth cannot arrive quietly.
- **The ledger's own limitations are not fixed here.** No unit on the movement, no backdated
  movement, no per-item read operation — all three are recorded in § 9 rather than worked around.
- **No allow-list was widened and no gate was suppressed.**
