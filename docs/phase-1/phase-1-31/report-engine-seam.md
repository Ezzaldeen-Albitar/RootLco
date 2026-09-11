# The report engine — P1-31 prerequisite P-11, slices 1 and 2 of 4

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
- **One required permission, `tech.technician.read`** — the code `tech.labor-session-list` already
  declares for the same rows. **Stated so it is not discovered later:** the report resolves each
  session's job to its WORK ORDER and publishes that reference, so a caller holding
  `rpt.report.read` and `tech.technician.read` and NOT `wo.work_order.read` learns which work orders
  carried labour in the branch and their display numbers. Reversing that is one more code in
  `requiredPermissions`. Recorded as **CC-33** for the Owner.
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
  `tech.technician.read` is an existing catalogue row and no bundle moved.
- **No new operation and no new path.** `rpt.report-run` serves the dataset; the register stays at
  407 operations and 316 OpenAPI paths, and the committed contract document is byte-unchanged.
- **No export.** Prerequisite P-12 is untouched and `rpt.export` stays excluded on CC-04's grounds.
- **No frontend.** FE-012 is not started and `apps/web/src` was not edited at all.
- **The remaining two baseline reports are not implemented.** The registry holds exactly two entries
  and a case asserts the exact list, so a third cannot arrive quietly.
- **No allow-list was widened and no gate was suppressed.**
