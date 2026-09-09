# The report engine — P1-31 prerequisite P-11, slice 1 of 4

**Status:** published on `remediation/p1-31-backend-report-engine-work-orders` · **Authority:**
prerequisite **P-11** of [`a0-preflight.md`](./a0-preflight.md), Owner decision **D-4** of
2026-09-09 · **Baseline:** protected `develop` `249c6428`

This slice makes one report runnable. It publishes the dataset registry the Owner requirement
describes, one operation that executes a registered dataset, and `work_orders_by_status`
implemented in the module that owns the tables. It does **not** publish the other three baseline
reports, the report-configuration writer, or export.

---

## 1. What P1-23 left, and what actually unblocked it

P1-23 published `GET /reports` and `GET /reports/{reportCode}` and returned `executable: false`
as a **literal**, with a written reason: the frozen `rpt` schema has no data-source column, so
nothing in the approved contracts says what `report_code = 'x'` should select, and inventing one
would have meant inventing a business report definition nobody approved.

The binding did not arrive as a column and was never going to. It arrived as a requirement:

> a report definition binds a `report_code` to a **code-registered dataset**
> — `docs/product/owner-requirements-2026-09-06.md:196`, OWR-2026-09-06-A-12

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

## 5. The timezone decision — OPEN, for the Owner to confirm

**Decided here:** a branch-scoped report resolves its period bounds and its day bucketing in the
**branch's own** timezone, `org.branches.timezone_name`.

This is a coordinator decision recorded as a proposal, not a contract fact. Both candidates exist
and both are foreign keys into `shared.timezones`:

| candidate                                 | argument                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `org.branches.timezone_name` (**chosen**) | the report is branch-scoped; "orders opened on the 3rd" is a claim about the day where the workshop is              |
| `org.tenants.default_timezone`            | one tenant-wide calendar makes two branches' reports addable; a branch report would then not match the branch's day |

**Only two zones are seeded.** `supabase/seeds/01_reference_data.sql` ships `UTC` and `Asia/Amman`,
and `fk_branches_timezone` refuses anything else — so a branch's zone is one of two values today
whichever column a report reads, and the decision is about which COLUMN, not about which zone.

**No query in the platform buckets by either column today**, so nothing was matched and nothing was
broken. If the Owner prefers the tenant default, the change is one lookup in `ReportRunService.run`
and the test that proves the boundary.

The period is **half-open**: `from` is the first day included, `to` is the first day **excluded** —
the day after the last one reported. A closed upper bound over a calendar day either swallows the
next day's first instant or drops the last one's final microsecond, and either shows up only as a
total that does not add up. `WorkOrderRepository.listWorkOrders` compares `opened_at <= openedTo`,
a CLOSED bound, which is correct for the board's instant-valued filter and was deliberately **not**
reused.

## 6. The catalogue merge rule — OPEN to Owner override

**Decided here: a configuration row is CUSTOMIZATION, not a precondition.**

- `GET /reports` returns the code-registered baselines first, marked `source: 'platform'`, then the
  tenant's own published rows by code, marked `source: 'tenant'`.
- A tenant row whose code is registered **suppresses** its baseline entry and is returned in its own
  place, carrying that tenant's scope, export permission and parameter schema.
- `GET /reports/{reportCode}` answers the tenant's row if one is published, the baseline if not, and
  `ERR-RES-001` if neither exists.
- `executable` is now `REPORT_DATASETS` membership rather than a literal `false`: true for a code
  the engine implements, false for a published tenant row whose code it does not.

Baselines are emitted on the **first page only**. They are bounded by the source tree rather than by
tenant data, so they cannot make a page unbounded, and the suppression is decided by one bounded
lookup over the registered codes, so a tenant row on a later page still hides its baseline. What a
caller must not assume is that the whole page is sorted by code: it is baselines, then codes
ascending.

**The alternative, and why it was not taken.** "A report is invisible until an operator configures
it" is defensible and is what a strict reading of P1-23 implies. It would mean every tenant must
author four configuration rows before any report works — and `rpt.report_configurations` has no
seed and, until P-11's remaining writer slice lands, no writer at all. Every report would be
unreachable in every tenant. **This is OPEN to Owner override**; reversing it is a change to two
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

| #   | prerequisite                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Bilingual state labels need a schema change.** `wo.work_order_states.name` is a single `text` column (`supabase/migrations/20260722091000_wo_state_catalogs.sql`), so a client asking for Arabic cannot get a state label from this API. Inventing one here would be a fabricated translation |
| 2   | **`countsByState` is dataset-specific and sits on the shared envelope.** The one dataset registered today groups by work-order state; the other three baseline reports group differently, and generalising the field is their work                                                              |
| 3   | **Aggregate and batch ports for the other three reports.** Each needs its own port on its owning module, on the same rule this slice applied — the module that owns the tables answers for them                                                                                                 |
| 4   | **A configuration writer.** `rpt.report.configure` is still declared by no operation and `rpt.report_configurations` still has no seed and no writer (**CC-02**)                                                                                                                                |

## 10. What this slice does NOT close

- **No migration and no schema change.** Every statement uses grants and policies that already
  existed; `rpt` is exactly as P1-11 left it.
- **No permission was minted and no seed changed.** `rpt.report.read` and `wo.work_order.read` are
  both existing catalogue rows, and this operation is the first thing to require them together.
- **The other three baseline reports** the chapter declares are not implemented. The registry holds
  exactly one entry and a test pins that, so the count cannot drift silently.
- **Export is untouched** (prerequisite P-12). `rpt.export` stays excluded on **CC-04**'s unchanged
  grounds, no export path is offered, and a baseline names no export permission at all.
- **No frontend.** FE-011 … FE-016 are unreleased and `apps/web/src` was not edited except through
  `lib/api/idempotent-operations.ts`, which a repository script regenerates and which every
  published operation moves.
- **No allow-list was widened and no gate was suppressed.** `check-p1-30-payload-parity.mjs` does
  not hold `rpt` operations to a mirror — `P1_30_DOMAINS` is `svc`, `quo`, `inv`, `sal` — and this
  is a GET with no body, so declaring a `PENDING` entry would be a claim about a gate that does not
  look here.
