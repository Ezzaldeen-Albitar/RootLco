# P1-29 — contract archaeology

**What the Backend actually provides today.** Every statement here was read off
the tree at `c081a019` or the live database, not off a design document. Where a
capability is absent, the entry says _absent_ and names what was searched.

Read this before estimating any screen. The single most expensive mistake
available to P1-29 is designing against the OpenAPI document, which describes
the operations but not their payloads.

---

## 1. The OpenAPI document does not carry the contract

`docs/api/openapi.v1.json` is OpenAPI 3.1.0, 248 paths, 305 operations, and it
is generated from the operation registry rather than from the request/response
types. The consequence is exact and severe:

- **0 of 305 operations declare a `requestBody`.**
- **0 of 305 declare a typed 200/201 response schema.** Every success response
  is `{"type": "object"}` with no properties.
- `components.schemas` holds only the error envelope and shared parameter
  primitives.

So the document is authoritative for _route, method, permission, scope, audit
class, idempotency and version-guard posture_ — and silent on _what you send and
what you get back_. A generated client would compile and transmit nothing.

**Therefore the payload contract for P1-29 must be read off the TypeScript
service interfaces in `apps/api/src/modules/**`, and P1-29 must not treat a
generated type as a source of truth.** This is tracked as `INS-01` in
[blocker-register.md](blocker-register.md), and it is the reason
[test-and-acceptance-plan.md](test-and-acceptance-plan.md) proposes a
contract-parity check rather than schema generation.

### 1.1 The 58 relevant operations

Of 305 registered operations, 58 are in P1-29 scope:

| module                       | operations | notes                                                        |
| ---------------------------- | ---------: | ------------------------------------------------------------ |
| `work-order`                 |         26 | work orders, jobs, assignments, lines, additional work       |
| `diagnostics`                |         13 | inspection reports and their child records                   |
| `quality`                    |         13 | QC records, checks, rework, reopen attempts                  |
| `technician`                 |          6 | queue, availability, labour sessions                         |
| adjacent, consumed not owned |          2 | `rec.reception-convert-to-work-order`, `sal.invoice-preview` |

The two adjacent operations are listed because P1-29 depends on them at its two
boundaries: the only way an `ordinary` work order is created, and the only way a
closed work order becomes money.

---

## 2. The HTTP pipeline contract

`apps/api/src/server/http/route-handler.ts` enforces the operation declaration
uniformly. A frontend that does not honour the declaration gets a deterministic
refusal, not a best-effort result.

| declaration            | client obligation                                                                                    | refusal if omitted     |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- |
| `idempotent: true`     | send `Idempotency-Key`                                                                               | request rejected       |
| `versionGuarded: true` | send `If-Match` with the current `record_version`                                                    | **428**, `ERR-CON-002` |
| `scope: 'branch'`      | name `companyId` + `branchId` (query on collections, resolved from the path resource on item routes) | authorization failure  |
| strict query schemas   | send no unknown parameter                                                                            | validation failure     |

Two properties of this shape the UI:

- **`If-Match` is mandatory, not optional.** Every state-changing operation on
  an existing row is version-guarded. The UI must hold `record_version` for
  every editable entity it displays, and a stale value produces a 428 that must
  be presented as _someone else changed this_, not as a network error. See
  [exception-and-concurrency-model.md](exception-and-concurrency-model.md).
- **Idempotency and version-guarding are independent.** Some operations are
  both (`wo.work-order-transition`, `wo.job-transition`, `wo.work-order-closure`,
  `dia.diagnostic-transition`), some are idempotent only
  (`wo.job-create`, `tech.labor-session-start`, `wo.job-assignment-create`),
  some are version-guarded only (`wo.job-update`, `tech.labor-session-stop`,
  `wo.job-assignment-end`). There is no rule to infer one from the other; the
  registry is the only source.

**Pagination.** `Page<T>` = `{items, nextCursor: string|null, hasMore: boolean}`.
The cursor is opaque and at most 512 characters; `limit` is coerced into 1..100
and **clamped** rather than rejected above 100. Not every list is paginated —
several P1-29 reads return a bare `{items: T[]}` with no cursor and no limit at
all (service lines, required parts, additional work, assignments, diagnostic
reports for a job, QC records for a work order). Those lists are unbounded by
contract; the UI must not assume the Backend will cap them.

---

## 3. Work order — the aggregate root

### 3.1 There is no `POST /work-orders`, deliberately

`apps/api/src/app/api/v1/work-orders/route.ts` exports **GET only**, and its own
header records the reconciliation: the reception conversion already inserts the
`wo.work_orders` row, so a second creation path would be a second truth.

The only path that opens an **ordinary** work order is
**`POST /receptions/{receptionId}/convert-to-work-order`** — module `reception`,
permission `rec.reception.convert`, scope branch, audit class privileged,
idempotent **and** version-guarded.

A consequence worth stating plainly: the permission `wo.work_order.create` is
seeded in `iam.permissions` (risk `high`, described as converting a reception
visit into a work order) and is **required by zero operations**. It is an
orphan. See [permission-matrix.md](permission-matrix.md) and `INS-05`.

### 3.2 Reads

| operation                           | route                                       | permission           | shape                               |
| ----------------------------------- | ------------------------------------------- | -------------------- | ----------------------------------- |
| `wo.work-order-list`                | `GET /work-orders`                          | `wo.work_order.read` | `Page<WorkOrderSummary>`            |
| `wo.work-order-detail`              | `GET /work-orders/{id}`                     | `wo.work_order.read` | `{workOrder, jobs[], nextStates[]}` |
| `wo.work-order-closure-eligibility` | `GET /work-orders/{id}/closure-eligibility` | `wo.work_order.read` | `ClosureEligibility`                |
| `wo.work-order-history`             | `GET /work-orders/{id}/history`             | `wo.work_order.read` | keyset page of transitions          |

`wo.work-order-list` takes a **strict** query — verified against
`apps/api/src/app/api/v1/work-orders/route.ts`:

| parameter                | required | notes                                                                                                                                                                               |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companyId`, `branchId`  | **yes**  | uuids; the authorization tuple, not a convenience filter                                                                                                                            |
| `state`                  | no       | an **opaque** lower-snake code, deliberately _not_ a TypeScript enum, because `wo.work_order_states` is tenant-extensible — an unknown code returns an empty page rather than a 422 |
| `kind`                   | no       | a **closed** vocabulary: `ordinary` \| `rework`, matching `ck_work_orders_kind`                                                                                                     |
| `openedFrom`, `openedTo` | no       | ISO date-times with offset                                                                                                                                                          |
| `cursor`, `limit`        | no       | keyset pagination                                                                                                                                                                   |

The reason company and branch are mandatory is recorded in the route's own
header and is a security control, not ergonomics: `scope: 'branch'` is **inert
without a target** — `requiresScopedEvaluation` returns false on an empty one,
so the check degrades to scope-blind `iam.has_permission`, and RLS cannot
compensate because `app.branch_ids` is _the permission-blind union of every
active grant_ (P1-18-A-01). A caller holding `wo.work_order.read` in one branch
and any grant at all in another would otherwise see the second branch's board.
**Every P1-29 collection call must name the pair.** This is carried into
[security-threat-model.md](security-threat-model.md) as T-03.

**Beyond those, the filter set is narrow, and that is a design constraint rather
than an oversight to route around.** There is no `vehicleId`, `customerId`,
`technicianProfileId`, `assignedTo`, `displayNumber` or free-text filter.
_A vehicle cannot list its own repairs from this endpoint._ Any P1-29 screen
that promises "all work orders for this vehicle" or "find work order by number"
is proposing a Backend change. Tracked as `INS-02`.

`wo.work-order-detail` is the only place `nextStates` is computed. It is
computed for the **work order** only — see section 6.3.

### 3.3 Writes

| operation                  | route                                   | permission                                               | guards         |
| -------------------------- | --------------------------------------- | -------------------------------------------------------- | -------------- |
| `wo.work-order-transition` | `POST /work-orders/{id}/transition`     | `wo.work_order.transition`                               | idem + version |
| `wo.work-order-closure`    | `POST /work-orders/{id}/closure`        | `wo.work_order.transition` **AND** `wo.work_order.close` | idem + version |
| `wo.service-line-record`   | `POST /work-orders/{id}/service-lines`  | `wo.work_order.line.manage`                              | idem           |
| `wo.required-part-record`  | `POST /work-orders/{id}/required-parts` | `wo.work_order.line.manage`                              | idem           |

The closure permission is a **conjunction**. A role holding `transition` but not
`close` can drive a work order to `ready_to_close` and no further; the UI must
distinguish those two authorities or it will render a button that always fails.

---

## 4. Jobs

| operation           | route                           | permission           | guards                              |
| ------------------- | ------------------------------- | -------------------- | ----------------------------------- |
| `wo.job-create`     | `POST /work-orders/{id}/jobs`   | `wo.job.manage`      | idem, **not** version-guarded       |
| `wo.job-update`     | `PATCH /jobs/{jobId}`           | `wo.job.manage`      | version-guarded, **not** idempotent |
| `wo.job-transition` | `POST /jobs/{jobId}/transition` | `wo.job.transition`  | idem + version                      |
| `wo.job-history`    | `GET /jobs/{jobId}/history`     | `wo.work_order.read` | keyset page                         |

`wo.job.manage` and `wo.job.transition` are **distinct permissions**. Editing a
job's title and moving it through its lifecycle are separately grantable.

**There is no `GET /jobs/{jobId}`.** `jobs/[jobId]/route.ts` exports `PATCH`
only. A job is readable exclusively as an element of the work-order detail
projection's `jobs[]` array. Every job-centric screen must therefore be reached
through, and refreshed through, the parent work order. This is the most
structurally significant Backend gap for the technician experience, and it is
tracked as `INS-03`.

---

## 5. Assignments, technicians and labour

| operation                    | route                                   | permission                      | guards               |
| ---------------------------- | --------------------------------------- | ------------------------------- | -------------------- |
| `wo.job-assignment-create`   | `POST /jobs/{jobId}/assignments`        | `tech.assignment.manage`        | idem                 |
| `wo.job-assignment-list`     | `GET /jobs/{jobId}/assignments`         | **`tech.technician.read`**      | —                    |
| `wo.job-reassignment`        | `POST /jobs/{jobId}/reassignments`      | `tech.assignment.manage`        | idem                 |
| `wo.job-assignment-end`      | `POST /assignments/{assignmentId}/end`  | `tech.assignment.manage`        | version-guarded      |
| `tech.technician-queue`      | `GET /technicians/{profileId}/queue`    | `tech.technician.read`          | —                    |
| `tech.technician-available`  | `GET /technicians/available`            | `tech.technician.read`          | —                    |
| `tech.labor-session-start`   | `POST /jobs/{jobId}/labor-sessions`     | `tech.labor.record`             | idem                 |
| `tech.labor-session-stop`    | `POST /labor-sessions/{id}/stop`        | `tech.labor.record`             | version-guarded      |
| `tech.labor-session-correct` | `POST /labor-sessions/{id}/corrections` | **`tech.labor.correct`** (high) | version-guarded      |
| `tech.labor-session-list`    | `GET /jobs/{jobId}/labor-sessions`      | `tech.technician.read`          | `Page<LaborSession>` |

Note the permission choices, which encode a real policy: **reading an assignment
or a labour session requires `tech.technician.read`, not `wo.work_order.read`,
because both name a member of staff.** A service advisor with full work-order
read access is not thereby entitled to see who worked on what for how long. Any
IA that renders assignments inside the work-order detail must handle the case
where the caller may read the work order but not the assignment list.

`GET /technicians/available` takes a **strict, fully-required** query:
`companyId`, `branchId`, `from`, `to`. There is no "who is free now" without a
window.

### 5.1 What is absent here

- **No "my queue".** `GET /auth/session` returns
  `{userId, tenantId, email, displayName, companyIds, branchIds, permissions[]}`
  and **no `technicianProfileId`**. Nothing in the platform maps a signed-in
  user to their own technician profile, so a technician cannot load their own
  queue without being told their profile id by some other means. `INS-04`.
- **No start / pause / resume / complete endpoints.** Those are _compositions_:
  start = transition the job to `in_progress` **and** open a labour session;
  pause = stop the session **and** transition to `paused`. Two calls, two
  guards, no transaction spanning them. Partial failure is reachable and the UI
  must own the recovery. See
  [exception-and-concurrency-model.md](exception-and-concurrency-model.md).
- **No labour totals.** No endpoint returns elapsed or billed hours for a job, a
  work order or a technician. Any total is client-side arithmetic over the
  per-job session page.
- **No per-job required skills.** The schema has no `wo.job_required_skills` and
  no requirement column on `wo.jobs`. Required skills are supplied _by the
  assigner at assignment time_, evaluated once, and not retained as a property
  of the job.
- **No technician profile / skill / certification / availability HTTP surface.**
  The `tech` schema holds `technician_profiles`, `skills`, `skill_levels`,
  `certifications`, `technician_skills`, `technician_certifications`,
  `technician_certification_details` and `technician_availability`. Only the
  queue and the availability search are reachable over HTTP at all, and neither
  is writable.

---

## 6. State machines

### 6.1 The graphs are data, not enums

`wo.work_order_states` / `wo.work_order_transitions` and
`wo.job_states` / `wo.job_transitions` are dual-scope catalogue tables
(`scope IN ('platform','tenant')`). A transition is legal **only if an active,
visible edge row exists**. A tenant may add states and edges; a tenant may not
add a terminal job state (`ck_job_states_tenant_not_terminal`).

**A P1-29 UI must therefore not hard-code either graph.** Hard-coding is a
correctness bug the moment a tenant customises, and there is no gate that would
catch it.

### 6.2 The seeded platform graphs (verified in the live database)

**Work order — 9 states, 15 edges.** States: `draft`, `open`, `in_progress`,
`awaiting_parts`, `awaiting_customer`, `qc_pending`, `ready_to_close`,
`closed` (terminal, `is_closed`), `cancelled` (terminal, `is_cancellation`).

The 15 edges, exhaustively — `(R)` marks an edge requiring a reason:

| from                  | to                                                                           |
| --------------------- | ---------------------------------------------------------------------------- |
| `draft`               | `open`, `cancelled` (R)                                                      |
| `open`                | `in_progress`, `cancelled` (R)                                               |
| `in_progress`         | `awaiting_parts` (R), `awaiting_customer` (R), `qc_pending`, `cancelled` (R) |
| `awaiting_parts`      | `in_progress`, `cancelled` (R)                                               |
| `awaiting_customer`   | `in_progress`, `cancelled` (R)                                               |
| `qc_pending`          | `in_progress` (R) — the only return-from-QC edge — and `ready_to_close`      |
| `ready_to_close`      | `closed`                                                                     |
| `closed`, `cancelled` | _(none — terminal)_                                                          |

Per-state flags carried by the catalogue and usable by the UI:
`allows_jobs`, `allows_labor`, `allows_additional_work`, `is_terminal`,
`is_closed`, `is_cancellation`, `reason_required`.

`qc_pending` sets `allows_jobs = false`, `allows_labor = false` and
`allows_additional_work = false` — **presenting for QC freezes scope.**
`awaiting_customer` allows additional work but not jobs or labour.
`awaiting_parts` disallows labour.

The reason for a reason-requiring edge reaches the guard as the session GUC
`app.status_reason`; a missing reason is a validation refusal, not a silent
default. Note that the requirement can come from _either_ the edge
(`requires_reason`) _or_ the target state (`reason_required`) — either alone
makes it mandatory.

**Edges that do not exist** (and so must never be offered): `draft→in_progress`,
`open→qc_pending`, `open→awaiting_parts`, `open→awaiting_customer`,
`in_progress→ready_to_close`, `in_progress→closed`, `qc_pending→closed`,
`ready_to_close→cancelled`, anything out of `closed`, anything out of
`cancelled`.

**Job — 6 states, 10 edges.** `planned`, `assigned`, `in_progress`, `paused`,
`completed` (terminal), `cancelled` (terminal). Flags: `is_terminal`,
`reason_required` (`paused`, `cancelled`), `assignment_required`
(`assigned`, `in_progress`, `paused`), `labor_allowed`
(`assigned`, `in_progress`).

| from                     | to                                         |
| ------------------------ | ------------------------------------------ |
| `planned`                | `assigned`, `cancelled` (R)                |
| `assigned`               | `in_progress`, `cancelled` (R)             |
| `in_progress`            | `paused` (R), `completed`, `cancelled` (R) |
| `paused`                 | `in_progress`, `assigned` (R)              |
| `completed`, `cancelled` | _(none — terminal)_                        |

`paused` is `assignment_required` but **not** `labor_allowed` — pausing does not
release the technician, it stops the clock.

### 6.3 `nextStates` is computed for the work order only

`JobView` carries no next-state list, there is no job detail endpoint, and no
catalogue endpoint publishes the graphs.
`WorkOrderCatalogService` exposes `workOrderStates()`, `jobStates()`,
`workOrderTransitions()` and `jobTransitions()` — and **no HTTP route calls
them.** The reception module has a catalogue endpoint; the work-order module
does not.

So a UI that must not hard-code the job graph currently has no way to learn it.
That is a contradiction, and it is `INS-06` — the smallest high-value Backend
addition in the whole phase.

### 6.4 Terminal freeze

Independently of the graph, `wo.guard_work_order_transition` raises SQLSTATE
`23514` — _"work order state X is terminal; no transition is permitted"_ — so
deleting or deactivating the graph rows would not open a back door. `closed` and
`cancelled` have no outbound edge and the guard says so a second time.

### 6.5 Closure blockers B1–B6

`wo.guard_work_order_closure` is `BEFORE UPDATE OF state`, fires only when the
target state `is_terminal`, and **returns early for a cancellation target** — so
cancelling bypasses every blocker by design.

|     | blocker                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | a job is not terminal                                                                                                                                                                                                                                    |
| B2  | a labour session is still running (open-ended)                                                                                                                                                                                                           |
| B3  | a required additional-work request is unresolved                                                                                                                                                                                                         |
| B4  | a job requiring diagnostics has no completed diagnostic report                                                                                                                                                                                           |
| B5  | quality control has not passed                                                                                                                                                                                                                           |
| B6  | safety-critical rework has no independent sign-off (named by `ERR-WO-001`’s catalogue description; the rework route notes that without its own insert path "closure blocker B6 can never fire, because nothing in the platform can produce its subject") |

`GET /work-orders/{id}/closure-eligibility` reports **all six at once** as
`{workOrderId, state, eligible, blockers[…]}`, so the UI can explain the whole
refusal rather than discovering one blocker per attempt. Design for that: the
closure screen is a checklist, not a button that fails.

Two closure blockers are declared **deliberately absent** —
`DEFERRED_CLOSURE_BLOCKERS` names owner `P1-21` and conditions
`active-reservation` and `open-part-issue`. A work order can therefore close
with stock still reserved. P1-29 must not present closure as proof that parts
are settled.

### 6.6 Reopening is impossible, and the refusal is recorded

`qms.reopen_attempts` plus `qms.attempt_reopen(p_work_order uuid, p_reason text)`:
attempting to reopen a closed work order **always** fails, and the attempt —
with its reason and outcome — is persisted. This is a first-class product
behaviour, not an error path: the UI should offer "request reopen", show the
refusal, and show the rework route as the actual remedy.

---

## 7. Additional work and customer approval

State vocabulary: `pending`, `approved`, **`rejected`** (not _declined_),
`withdrawn`. Only `pending` has outbound edges; the other three are terminal.

| operation                          | permission                                                | notes                    |
| ---------------------------------- | --------------------------------------------------------- | ------------------------ |
| `wo.additional-work-request`       | `wo.additional_work.request`                              | idem                     |
| `wo.additional-work-list`          | `wo.work_order.read`                                      | not paginated            |
| `wo.additional-work-approval`      | **`wo.additional_work.approve`**                          | audit class **APPROVAL** |
| `wo.additional-work-approval-read` | `wo.work_order.read`                                      |                          |
| `wo.additional-work-detail-record` | `wo.additional_work.request` **AND** `iam.sensitive.view` | restricted description   |
| `wo.additional-work-fulfillment`   | `wo.additional_work.request`                              | idem + version           |
| `wo.additional-work-withdraw`      | `wo.additional_work.request`                              | idem + version           |

`request` and `approve` are separate high-risk authorities — the person who
proposes extra work is not, by default, the person who records the customer's
decision.

**Approval evidence binds a `documentVersionId`, never a document id**, and
`wo.customer_approval_evidence` is append-only. Attaching evidence therefore
requires an immutable version to already exist in the shared attachments module.
That is an adapter, and it is scoped in
[integration-handoffs.md](integration-handoffs.md).

`wo.additional_work_requests.originating_finding_id` exists **as a column with
no foreign key** to `dia.findings`. The link from a diagnostic finding to the
additional work it justifies is therefore uni-directional, unenforced, and
unqueryable in reverse. `INS-07`.

---

## 8. Diagnostics — a template-instantiated checklist

The module directory is `apps/api/src/modules/diagnostics` (not `modules/dia`).
Its composition root exports `completion` (`DiagnosticsCompletionService`) and
`reports` (`DiagnosticReportsService`).

`dia.diagnostic_reports` is a real aggregate root, parented on **both**
`wo.work_orders` and `wo.jobs` (both NOT NULL) — **a diagnostic report belongs
to a job, not to a work order in general.**

### 8.1 The 13 operations

Create and list are per-job (`/jobs/{jobId}/inspections`); everything else is per
report (`/inspections/{inspectionId}/…`): `detail`, `history`,
`items/{templateItemId}` (PUT), `measurements`, `dtcs`, `findings`,
`recommendations`, `evidence`, `transition`, `completion`, `reviews`.

`GET /inspections/{inspectionId}` is the only aggregate read:
`{report, items[], measurements[], dtcs[], findings[], recommendations[],
evidence[], reviews[], outstandingMandatory…}`.

Payload notes that matter for form design:

- `POST /jobs/{jobId}/inspections` — body is strictly `{templateVersionId}` and
  nothing else.
- `PUT …/items/{templateItemId}` — `{resultValue?, notApplicableReason?}`;
  exactly one is effectively required, and an absent or empty `resultValue`
  forces `notApplicableReason`.
- `POST …/measurements` — `measuredValue` crosses the wire as a **string**
  matching `^-?\d{1,15}(\.\d{1,6})?$`, never as a JSON number.
- `POST …/dtcs` — `code` must match `^[PBCU][0-9][0-9A-F]{3}$` (upper case;
  second character decimal, last three hexadecimal).
- `POST …/findings` — `{templateItemId?, severity, disposition, description}`.
- `POST …/evidence` — `evidenceType` is **free text**, 1..64 chars, with no
  vocabulary and no CHECK. The UI owns that vocabulary or there will not be one.
- `POST …/transition` and `POST …/completion` — `If-Match` **mandatory**;
  absent is 428 `ERR-CON-002`.
- `dia.diagnostic.complete` is a **separate permission** from
  `dia.diagnostic.record`.

### 8.2 The lifecycle is a fixed four-state graph — hard-coded, unlike the work order

`draft → {in_progress, cancelled}`, `in_progress → {completed, cancelled}`,
`completed → {}`, `cancelled → {}`. Enforced by
`dia.guard_diagnostic_report_transition` in plpgsql, **not** by a catalogue, and
CHECK-constrained again in `dia.diagnostic_report_status_history`.
It is not tenant-overridable and it must be hard-coded by the UI — the exact
opposite of the work-order rule in section 6.1. Getting this backwards in either
direction is a defect.

**A completed report cannot be reopened, and a `needs_rework` review is a dead
end.** `review_result ∈ {approved, rejected, needs_rework}` records an opinion,
changes no state and unlocks nothing. If the product needs rework to _mean_
something, that is a Backend change. `INS-08`.

### 8.3 What diagnostics is, and what it is not

| concept                          | status                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| symptom / customer complaint     | **absent** from `dia` entirely — the nearest thing is `rec.complaint_details`, upstream in reception                                                           |
| checklist answers                | present: `dia.report_item_results`, one answer per template item, `result_value` or `not_applicable_reason`                                                    |
| free observations                | **absent** — every answer hangs off a template item                                                                                                            |
| findings                         | present and first-class: severity ∈ `info \| low \| medium \| high \| critical`, disposition ∈ `monitor \| repair_recommended \| repair_required \| no_action` |
| probable cause / confirmed cause | **absent** — no `cause`, `diagnosis` or `root_cause` column exists anywhere in `dia`                                                                           |
| recommended action               | present, flat: `dia.recommendations` (text plus `priority ∈ low \| medium \| high`)                                                                            |
| measurements                     | present: label, numeric value, unit, `within_range`                                                                                                            |
| DTCs                             | present, code-format enforced, immutable after insert                                                                                                          |
| evidence                         | present, **report-level only** — no `template_item_id`, `finding_id` or `measurement_id`, so a photograph cannot be tied to the item it evidences              |

Severity (5 values, on findings) and priority (3 values, on recommendations) are
**two vocabularies on two different entities**. There is no priority on a
finding, no severity on a recommendation, and no report-level severity roll-up.
A UI that shows one "severity" column across both is inventing data.

### 8.4 The template catalogue is empty and unreachable

`dia.inspection_templates`, `dia.template_versions` and `dia.template_items` are
tenant-scoped (`tenant_id NOT NULL`, **no** `company_id`/`branch_id`) and hold
**zero rows**. There is **no HTTP operation** that creates, reads, versions or
publishes a template.

`POST /jobs/{jobId}/inspections` requires a `templateVersionId` and takes
nothing else. **With no templates, no diagnostic report can be created at all.**
Diagnostics is not partially usable today; it is unreachable. `INS-09` — and it
is the single largest scoping decision in the phase, addressed in
[technician-and-diagnostics-design.md](technician-and-diagnostics-design.md).

---

## 9. Quality control and rework

QC is **per work order**, not per job (`qms.quality_control_records`, parented on
`wo.work_orders`). `overall_result ∈ {pending, passed, failed}` default
`pending`; `qms.qc_status_history` CHECK-constrains the same three literals.
`qms.qc_check_results.result ∈ {pass, fail, na}`, one live result per
(record, check), against the `qms.qc_checks` catalogue, whose rows carry
`is_mandatory` and `is_safety_critical`.

Operations: `qms.qc-record-open` (`qms.quality_control.record`),
`qms.qc-record-list`, `qms.qc-record-detail`, the check-result writes, plus
`qms.rework-create` / `-list` (`qms.rework.manage`, body
`{rootCause, correctiveAction, responsibility?, isSafetyCritical?}`) and the
reopen-attempt surface.

`qms.rework_links` links an original work order to a rework work order, with a
partial unique on the rework side — a rework work order belongs to at most one
link. `wo.work_orders.kind ∈ {ordinary, rework}`.

`qms.rework_link_details` is a sensitive cost sidecar
(`rework_cost numeric(14,4) >= 0`, `cost_currency ^[A-Z]{3}$`, default `JOD`).

**`qms.qc_checks` holds zero rows.** Like diagnostics, QC has no catalogue to
check against — see section 11.

---

## 10. The domain model in aggregate

**44 tables** across the four owned schemas: `wo` 15, `dia` 13 operational
(14 counting the `diagnostic_types` catalogue), `tech` 9, `qms` 7. Every one has
`relrowsecurity` **and** `relforcerowsecurity` true.

### 10.1 Uniform structural facts

- **Scope key.** Every operational table carries
  `UNIQUE (tenant_id, company_id, branch_id, id)` and children join on the full
  composite with `ON DELETE RESTRICT`. Cross-branch parentage is structurally
  impossible.
- **Catalogues are different.** `tech.skills`, `tech.skill_levels`,
  `tech.certifications`, `dia.diagnostic_types`, `qms.qc_checks`,
  `wo.*_states`, `wo.*_transitions` and the `dia` template tree carry
  `tenant_id` nullable or alone, with **no** company/branch, a
  `scope IN ('platform','tenant')` CHECK, and a coherence CHECK forcing
  `tenant_id IS NULL` for platform rows and NOT NULL for tenant rows.
- **Optimistic concurrency.** Every non-history table has
  `record_version integer DEFAULT 1` plus `created_at/by`, `updated_at/by`,
  `deleted_at/by`, maintained by the shared row-metadata trigger on BEFORE
  UPDATE. This is what `If-Match` guards.
- **Soft delete.** Uniqueness is expressed as partial unique indexes
  `WHERE deleted_at IS NULL` throughout.
- **Every foreign key is index-backed.** Verified across all four schemas: zero
  FKs without a covering index. (Contrast the six unindexed FKs found in the
  P1-28 reception work — this domain does not have that problem.)
- **No views, no read projections.** `relkind IN ('v','m')` over the four
  schemas returns **0 rows**. Every list, board and detail read is a multi-table
  join written by the caller in TypeScript.
- **Deletion is impossible for application roles.** `DELETE` is granted only to
  `postgres`. `app_runtime` holds SELECT + INSERT + UPDATE, and UPDATE on only
  36 of the 44 tables — withheld from the append-only history and evidence
  tables.
- **Only two callable database entry points** exist among the 27 functions in
  these schemas; everything else is a trigger:
  `qms.attempt_reopen(uuid, text)` and
  `tech.correct_labor_session(uuid, timestamptz, timestamptz, text)`. The latter
  soft-deletes the original session and requires a non-blank reason.

### 10.2 Session GUCs the write path depends on

Session variables are load-bearing and **invisible in the schema**:
`app.status_reason` is read by `wo.guard_work_order_transition`,
`wo.guard_job_transition` and both `emit_*_status_history` triggers, alongside
the tenant and user identity settings resolved by `iam.current_tenant_id()` and
`iam.current_user_id()`.

They are set by the API's transaction wrapper. Nothing a frontend does sets
them; the frontend's obligation is only to _send the reason in the body_ so the
API can.

### 10.3 Only three tables enforce a permission code inside RLS

A scan of every policy expression in `wo`, `dia`, `tech` and `qms` finds exactly
**one** permission literal — `iam.sensitive.view` — and only on the three
restricted sidecars (`wo.additional_work_request_details`,
`tech.technician_certification_details`, `qms.rework_link_details`).

**Everywhere else, RLS enforces tenancy and scope, and the API operation
declaration is the sole enforcement point for permissions.** This is the most
important security fact in the phase: a permission bug in the API is not caught
by a second line of defence in the database. It governs
[security-threat-model.md](security-threat-model.md) and it is why P1-29 must
never introduce a direct-to-database read path.

---

## 11. Data present today

Exactly **four** tables in these schemas are non-empty:
`wo.work_order_states` 9, `wo.work_order_transitions` 15, `wo.job_states` 6,
`wo.job_transitions` 10 — all `scope='platform'`, all from `supabase/seeds/`.

Everything else is empty, in accordance with the standing no-fake-data policy.
That includes `dia.inspection_templates` / `template_versions` /
`template_items` (section 8.4) and `qms.qc_checks`. Two of the phase's headline
workflows have **no catalogue data and no way to author it**.

---

## 12. Adjacent surfaces, stated so they are not rebuilt

- **`veh.vehicles.workshop_status` is not maintained from `wo`/`dia`/`tech`/`qms`.**
  A scan of every non-catalogue function body for `workshop_status` matches only
  three `veh` triggers. Nothing in the work-order domain writes it. A
  "vehicle is in the workshop" indicator does not exist and cannot be read.
- **There is no customer column in any of the 44 tables.** The route to a
  customer is `wo.work_orders → rec.reception_visits → rec.reception_party_roles
→ crm.business_partners`, three joins, none of them exposed by an HTTP read.
  This is `INT-036` in the P1-27 register, confirmed against the live catalogue.
  Carried here as `INS-10`.
- **Quotation linkage is one-directional**: `quo.quotations.work_order_id`
  points at the work order; there is no `quotation_id` on `wo.work_orders`.
- **Four `inv` tables point at `wo.work_orders`** by the composite scope key,
  `inv.stock_reservations` among them (`status ∈ active|released|consumed|expired`).
  The parts relationship is owned by inventory, and P1-29 consumes it. See
  [integration-handoffs.md](integration-handoffs.md).
- **`shared.status_history` / `shared.status_evidence` exist and are not used by
  these schemas** — `wo`, `dia` and `qms` each have their own typed history
  table. Do not build a timeline against the generic one.
- **`shared.notes`, `shared.comments`, `shared.entity_tags` and
  `shared.search_metadata`** address rows polymorphically by
  `(entity_type, entity_id)` and are available as adapters rather than
  purpose-built surfaces.
- **`org.departments` exists** (one of 17 tables in `org`), with
  `org.department.manage` seeded — but it has no HTTP surface, and no
  work-order-domain entity carries a `department_id`.

---

## 13. What `apps/web` consumes today

Exactly one file: `apps/web/src/features/receptions/work-order-api.ts`, 23
lines, a single `GET` of `/api/v1/work-orders/{id}` used to confirm that the
reception conversion succeeded.

P1-29 starts from effectively nothing on the client, and from a complete,
carefully-guarded Backend with the specific holes enumerated above.

---

## 14. Prepared design material already in the repository

`docs/product/workshop/` carries `end-to-end-workshop-workflow.md`,
`frontend-implementation-program.md`, `inspection-and-diagnostics.md`,
`vehicle-history-model.md` and `pricing-payment-and-…`. These are product
narratives written before the Backend existed in its current form. They are
useful as intent and **must not be read as contract** — where they and this
document disagree, this document was measured and they were not.
