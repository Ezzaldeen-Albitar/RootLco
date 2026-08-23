# P1-29 — technician workspace and diagnostics design

Designed against the model the Backend actually implements, not against the
model the phase title implies. Where the two differ, the difference is stated
and a decision is put to the Owner rather than papered over.

---

# Part A — the technician workspace

## A1. Two personas, and only one of them is fully buildable

| persona                              | what they do                                                                                                                   | buildable today?                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Workshop supervisor / dispatcher** | sees the branch board, adds jobs, finds an available technician, assigns, reassigns, watches progress, presents for QC, closes | **yes**, end to end                                      |
| **Technician**                       | opens their own queue, starts the clock, records diagnostics, pauses, completes                                                | **partly** — everything except _opening their own queue_ |

The gap is `INS-04`, and it is narrower than it first appears:
`tech.technician_profiles.user_id` **already carries the mapping**, uniquely per
tenant and on an index that already exists, and the repository already selects
it. What is missing is a contract — `GET /auth/session` returns
`{userId, tenantId, email, displayName, companyIds, branchIds, permissions[]}`
and no profile reference, no operation resolves the profile from
`iam.current_user_id()`, and there is no technician directory read to search.

**Do not work around this on the client.** Matching on `displayName` or on the
email local-part is a correctness defect (two technicians can share a name) and
a privacy defect (it would let any holder of `tech.technician.read` enumerate
profiles by guessing). The honest options are in
[blocker-register.md](blocker-register.md) under `INS-04`; the design below
assumes the supervisor-navigates-to-a-technician form, which works for both
the _supervisor_ persona fully and the _technician_ persona only through a
supervisor. Note what it does not mean: a technician **selecting themselves**
from `GET /technicians/available` is the self-assertion case the prohibition
covers. There is no interim form of "My jobs", and none should be invented.

## A2. The dispatch flow

```
/work-orders  ── board, filtered by state/kind/date ──────────────┐
                                                                  ▼
/work-orders/{id}  ── Jobs tab ── "add job"  (wo.job.manage) ─────┐
                                                                  ▼
                     per job: "assign"  → pick from
                     GET /technicians/available?companyId&branchId&from&to
                     (tech.technician.read)
                                                                  ▼
                     POST /jobs/{jobId}/assignments  (tech.assignment.manage)
```

Design notes forced by the contract:

- **The availability search has no default window.** `from` and `to` are
  required. The picker must ask for a window — sensible default: now → end of
  the working day — and must show that the list _is_ a window, not a roster.
- **Required skills are not a property of the job.** There is no
  `wo.job_required_skills` table and no requirement column on `wo.jobs`. The
  assigner supplies the requirement at assignment time; it is evaluated once and
  **not retained**. So the picker can filter by requirement, but the job screen
  can never afterwards show "this job needs an A/C certification". Do not
  design a UI that implies otherwise.
- **Reassignment is a distinct operation** (`POST /jobs/{jobId}/reassignments`)
  under the same code as assignment. Ending an assignment _without_ replacing it
  is a third operation (`POST /assignments/{assignmentId}/end`, version-guarded).
  Three controls, not one dropdown.
- **The assignment list needs `tech.technician.read`, not `wo.work_order.read`.**
  A supervisor with work-order read only sees jobs without seeing who is on
  them. The Jobs tab must render that case, not blank out.

## A3. The four composed actions

There is no start, pause, resume or complete endpoint. Each is two calls with
two different permissions and no shared transaction.

| action       | call 1                                                                      | call 2                                                           | permissions                                      |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| **start**    | `POST /jobs/{jobId}/transition` → `in_progress` (If-Match, Idempotency-Key) | `POST /jobs/{jobId}/labor-sessions` (Idempotency-Key)            | `wo.job.transition` + `tech.labor.record`        |
| **pause**    | `POST /labor-sessions/{id}/stop` (If-Match)                                 | `POST /jobs/{jobId}/transition` → `paused`, **reason mandatory** | `tech.labor.record` + `wo.job.transition`        |
| **resume**   | `POST /jobs/{jobId}/transition` → `in_progress`                             | `POST /jobs/{jobId}/labor-sessions`                              | same as start                                    |
| **complete** | `POST /jobs/{jobId}/transition` → `completed`                               | _(optionally)_ `POST /assignments/{id}/end`                      | `wo.job.transition` (+ `tech.assignment.manage`) |

### A3.1 Ordering is not arbitrary

The job-state catalogue carries `labor_allowed`, and `paused` has it **false**
while `assigned` and `in_progress` have it **true**. So:

- **start**: transition first, then open the session. Opening a session against
  a `planned` job would be refused.
- **pause**: stop the session **first**, then transition. Transitioning to
  `paused` while a session is open would be refused for the same reason, and
  worse, B2 (an open-ended labour session) would then block closure with no
  obvious cause.

The UI must encode this ordering; it is not symmetric and it is not guessable.

### A3.2 Partial failure is reachable and the UI owns it

Two calls, no transaction. Every one of these is a real state:

| after call 1                        | call 2 fails                   | resulting state                            | what the user sees, and the remedy                                                                                                                                |
| ----------------------------------- | ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| job `in_progress`                   | session not opened             | job running, **clock not started**         | a job in progress with no open session. Offer "start the clock" as a distinct recovery, not a retry of the whole action.                                          |
| session stopped                     | transition to `paused` refused | **clock stopped, job still `in_progress`** | the more dangerous case: the technician believes they are paused and time is not being recorded. The UI must surface this loudly and offer to complete the pause. |
| transition to `completed` succeeded | assignment not ended           | job complete, assignment still open        | benign; the assignment can be ended later.                                                                                                                        |

**Design rule:** never present a composed action as atomic. Show the two steps,
show which one failed, and offer the completing step — not a blanket retry,
which would re-run the already-successful call (and, because the transition is
idempotent but the session start is _also_ idempotent under a **new** key, could
open a second session).

**Idempotency-Key discipline matters here.** A retry must reuse the same key or
it is not a retry. `PUBLISHED_OPERATIONS` supplies the operation's idempotency
posture; the key itself must be minted once per user intent and held across
retries of that intent.

## A4. The labour session model

- A session belongs to a **job**, never directly to a work order
  (`tech.labor_sessions` parents on `tech.technician_profiles` and `wo.jobs`).
- Stop is **version-guarded**; start is **idempotent**; correction is
  **version-guarded** and requires `tech.labor.correct` (risk `high`).
- A correction goes through `tech.correct_labor_session(uuid, timestamptz,
timestamptz, text)`, which **soft-deletes the original** to free the
  uniqueness slot and requires a non-blank reason. So a correction is not an
  edit — it is a replacement with an audit trail, and the UI should say so.
- **There are no totals.** No endpoint returns elapsed or billed hours for a
  job, a work order or a technician.

### A4.1 The totals trap

`GET /jobs/{jobId}/labor-sessions` is a **`Page<LaborSession>`**. Summing the
first page and calling it "total time on this job" is exactly the P1-28
round-two defect — a paged read answering for the whole set.

If P1-29 displays a total it must use the existing
`read-completeness` helpers (`readCompleteness()`, `hasFurtherPage()`,
`canPage()`) and either page to exhaustion before summing, or label the figure
as a partial sum. **Preferred: do not display a total at all in the first
slice**, and record it as a Backend request. A wrong number on a timesheet is
worse than no number.

## A5. What the technician screen can honestly contain

| element                      | source                                         | present?                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the jobs assigned to me      | `GET /technicians/{profileId}/queue`           | yes, given a profile id                                                                                                                                               |
| job title, state, work order | queue projection + parent detail               | yes                                                                                                                                                                   |
| the vehicle                  | `wo.work_orders.vehicle_id` → `veh.vehicles`   | reachable, one extra read                                                                                                                                             |
| the customer                 | —                                              | **no** (`INS-10`)                                                                                                                                                     |
| the customer's complaint     | `rec.complaint_details`, upstream in reception | reachable in principle, no work-order-side read                                                                                                                       |
| my current open session      | labour session list for the job                | yes                                                                                                                                                                   |
| my hours today               | —                                              | **no** (A4.1)                                                                                                                                                         |
| what I need to do            | job `title` and `job_type` (free text)         | thin — there is no task list on a job                                                                                                                                 |
| a blocker or escalation      | —                                              | **no**; expressible only as a work-order transition to `awaiting_parts` / `awaiting_customer` with a reason, which is the _supervisor's_ action, not the technician's |
| attach a photo to my work    | —                                              | **no** at job level; only diagnostic-report evidence and customer-approval evidence exist                                                                             |

Rows marked **no** are the honest content limit of a Frontend-only technician
experience. A design that fills them is designing a Backend phase.

---

# Part B — diagnostics

## B1. What diagnostics _is_ here

Not a free-form investigation. A **template-instantiated checklist** bound to a
single job:

```
dia.inspection_templates
  └ dia.template_versions          ← a report cites ONE version
      └ dia.template_items         ← one answer per item

dia.diagnostic_reports  (job_id NOT NULL, work_order_id NOT NULL)
  ├ report_item_results   one per template item: result_value | not_applicable_reason
  ├ measurements          label, value, unit, within_range   (+ optional template_item_id)
  ├ dtc_records           OBD-II code, immutable after insert
  ├ findings              severity × disposition × description (+ optional template_item_id)
  ├ recommendations       text + priority
  ├ diagnostic_evidence   documentVersionId — REPORT-LEVEL ONLY
  └ diagnostic_reviews    approved | rejected | needs_rework — an opinion, no state change
```

Lifecycle: `draft → {in_progress, cancelled}`, `in_progress → {completed,
cancelled}`, both terminals closed. **Hard-coded in plpgsql**, not a catalogue —
the opposite of the work-order graph, which must never be hard-coded. Getting
this backwards in either direction is a defect.

## B2. The blocking fact: there are no templates and no way to make one

- `dia.inspection_templates`, `dia.template_versions`, `dia.template_items`:
  **zero rows**.
- **Zero HTTP operations** create, read, version or publish a template.
- `POST /jobs/{jobId}/inspections` takes `{templateVersionId}` and nothing else.

**Therefore no diagnostic report can be created at all today.** Diagnostics is
not thin, or partial, or unpolished. It is unreachable. This is `INS-09` and it
is the largest single scoping decision in the phase.

### B2.1 The four options, with a recommendation

| #   | option                                                                                                                                                                                                         | what it costs                                                                                             | what it delivers                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | **Expose the template lifecycle that already exists** — HTTP authoring, versioning, publish/retire, read (~6–8 operations), plus catalogue-management permission codes which **do not exist** in the catalogue | a Backend slice; new permission codes; **no schema work** — the tables and their guards are already built | the real product                                                                             |
| 2   | **Platform-seed a standard template catalogue** (migration + seed)                                                                                                                                             | **not representable** — see below                                                                         | nothing; it cannot be built                                                                  |
| 3   | **Defer the diagnostics UI out of the FIRST P1-29 slice** — not out of the phase; [execution-decision.md](execution-decision.md) §1.1 keeps diagnostics in P1-29 final scope                                   | the phase cannot close until option 1 lands and the diagnostics slice ships                               | an honest first slice that ships, with diagnostics sequenced behind its Backend prerequisite |
| 4   | Build the diagnostics UI against templates that do not exist                                                                                                                                                   | nothing ships that can be demonstrated                                                                    | nothing                                                                                      |

**Recommendation: option 1. Template authoring is the Backend prerequisite; the
diagnostics slice is blocked until it closes, and an early P1-29 slice may ship
without diagnostics UI. Option 3 is rejected — that is sequencing, and
diagnostics stays in P1-29 scope. What changes is implementation order, not the
phase definition.**

Reasoning:

**Option 2 is not merely policy-forbidden, it is structurally impossible.**
`dia.inspection_templates` carries `tenant_id uuid NOT NULL` with **no `scope`
column** — unlike `dia.diagnostic_types`, which is dual-scope
(`scope IN ('platform','tenant')` with the usual coherence CHECK). **A platform
template cannot be represented in this schema.** Every template belongs to
exactly one tenant, by design. So even setting aside the standing no-fake-data
policy, which would independently forbid shipping an invented "standard
30-point inspection" to every tenant, there is no row to insert. (The _type_
vocabulary is a different question: `dia.diagnostic_types` **is** dual-scope, so
a platform type catalogue is representable and is a legitimate seed candidate.
It is also empty, and `inspection_templates.diagnostic_type_id` is NOT NULL, so
it is the first link in the chain.)

**Option 1 is much smaller than "build a template system", because the system is
already built.** Migration `20260722101000_dia_templates_versions_items.sql`
delivers all three tables with their guards: `dia.guard_template_version_publish`
enforces `draft → published → retired` and stamps `published_at`;
`dia.guard_template_item_frozen` rejects any change to an item — including a
soft delete — once its parent version leaves `draft`;
`template_items` carries `response_type IN ('numeric','text','boolean','select')`,
`unit` (mandatory for numeric), `is_mandatory`, `validation_rule jsonb` and
`sequence`; and RLS grants SELECT to `app_runtime`/`app_readonly` with INSERT and
UPDATE to `app_runtime`. **The database is ready and the write path is already
permitted.** What is missing is an HTTP surface and a permission vocabulary —
routes, a service, and seeded codes. No schema design, no new guard, no
migration to the `dia` tables themselves.

The permission codes should be **derived from precedent, not invented**. The
catalogue already contains `apt.catalogue.manage` for the appointment intake
catalogue and `svc.price.publish` for a separate publish authority alongside
`svc.price.manage`. Applying both conventions gives a `dia` catalogue-management
code and a separate publish authority — which matches the schema, since publish
is the irreversible act that freezes the items. That derivation, and its
evidence, belongs in
[backend-prerequisite-gate.md](backend-prerequisite-gate.md) under `BE-4`;
nothing here should be treated as the naming decision.

Option 4 is not a real option.

**The phase is not Frontend-only either way.** The other two Critical findings —
`INS-04` and `INS-10` — are both fixed in the Backend, and `INS-11`, `INS-12`
and `INS-49` are declaration and CI work. Keeping diagnostics adds the
**largest** Backend prerequisite to a phase that already carries several small
ones; it changes the size of the Backend slice, not whether there is one.
[execution-decision.md](execution-decision.md) records the decision: diagnostics
stays in P1-29 final scope, `BE-4` is funded as a prerequisite of this phase,
and the diagnostics slice is sequenced behind it. That is the decision, plainly.

## B3. The report screen, if and when it is built

`GET /inspections/{inspectionId}` is the only aggregate read and returns
everything: `{report, items[], measurements[], dtcs[], findings[],
recommendations[], evidence[], reviews[], outstandingMandatory…}`. One read, one
screen, no fan-out. Proposed layout:

| section             | write                          | notes                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Checklist**       | `PUT …/items/{templateItemId}` | one row per template item; exactly one of `resultValue` / `notApplicableReason` — an absent or empty `resultValue` **forces** a reason. `outstandingMandatory` from the read drives the completion gate.                                  |
| **Measurements**    | `POST …/measurements`          | `measuredValue` crosses the wire as a **string** matching `^-?\d{1,15}(\.\d{1,6})?$` — never a JSON number. Client-side validation must match that regex exactly or the user gets a server-side refusal for something the field accepted. |
| **DTCs**            | `POST …/dtcs`                  | `^[PBCU][0-9][0-9A-F]{3}$` — upper case, second character **decimal**, last three **hex**. Immutable after insert.                                                                                                                        |
| **Findings**        | `POST …/findings`              | severity `info \| low \| medium \| high \| critical`× disposition`monitor \| repair_recommended \| repair_required \| no_action`                                                                                                          |
| **Recommendations** | `POST …/recommendations`       | text + priority `low \| medium \| high`                                                                                                                                                                                                   |
| **Evidence**        | `POST …/evidence`              | needs a `documentVersionId` first — see B4                                                                                                                                                                                                |
| **Reviews**         | `POST …/reviews`               | read-only history plus, for a holder of `dia.diagnostic.review`, one verdict                                                                                                                                                              |

### B3.1 Three properties the UI must not hide

- **Nothing here can be edited or deleted.** The findings route exports `POST`
  only; there is no update and no delete for a finding, a DTC, a measurement or
  a recommendation. A typo is permanent. Every one of these forms needs a
  review-before-submit step, and the UI must say that the record is permanent —
  not discover it when a user asks how to fix one.
- **Evidence attaches to the report, not to an item.** There is no
  `template_item_id`, `finding_id` or `measurement_id` on
  `dia.diagnostic_evidence`. A photograph cannot be tied to the item it
  evidences. Do not render evidence _inside_ an item row as though it were —
  that would be a false claim about the data. Put it in one report-level
  gallery, and record the granularity request as `INS-15`.
- **`evidenceType` is free text, 1..64 characters, with no vocabulary and no
  CHECK.** Whatever the UI offers becomes the de-facto vocabulary. Offer a
  short picker with an "other" escape, and translate the picker — otherwise the
  column fills with unqueryable prose.

### B3.2 Severity and priority are two vocabularies on two entities

Severity (5 values) is on **findings**. Priority (3 values) is on
**recommendations**. There is no priority on a finding, no severity on a
recommendation, and **no report-level severity roll-up**. A single "severity"
column spanning both, or a report header badge reading "critical", would be
inventing data. If a roll-up is wanted, it is a Backend projection.

### B3.3 Completion and review

- `POST …/completion` needs `dia.diagnostic.complete` — a **separate** code from
  `dia.diagnostic.record` — plus a mandatory `If-Match`. Body is
  `{summary?}` and may be omitted.
- The completion gate is `outstandingMandatory` from the detail read. Show it
  as a checklist of what remains, before the button.
- **A review changes nothing.** `review_result ∈ {approved, rejected,
needs_rework}` records an opinion; `completed` has no outbound transition, so
  `needs_rework` unlocks nothing and cannot be acted on. The UI must not offer
  "send back for rework" — there is no such thing. It may show the verdict and,
  where rework is genuinely needed, direct the user to the QMS rework route,
  which is a different mechanism on the work order. `INS-08`.

## B4. Evidence, end to end

Both evidence surfaces in this domain (`dia.diagnostic_evidence` and
`wo.customer_approval_evidence`) bind a **`documentVersionId`** — an immutable
version in the shared attachments module — never a document id, and both tables
are append-only.

The client route already exists:
`features/attachments/api.ts` → `captureDocument(CaptureInput {categoryCode,
entityType, entityId, fileName, contentType, bytes, capturedAt?})`, plus
`listDocumentCategories()`.

So attaching evidence is **two steps**: capture the document (yielding a
version), then bind the version. Same partial-failure discipline as A3.2 — a
captured-but-unbound document is an orphan the user cannot see, so the UI must
either bind immediately or make the orphan recoverable.

The `categoryCode` vocabulary comes from `listDocumentCategories()`; P1-29 must
check whether a diagnostics-appropriate category exists before designing the
picker, and must not invent one client-side.

## B5. What diagnostics cannot express

Restating from [contract-archaeology.md](contract-archaeology.md) section 8.3,
because each one is a screen someone will otherwise try to design:

| wanted                                                | status                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the customer's symptom / complaint                    | **absent** from `dia` — lives upstream in `rec.complaint_details`                                                                                          |
| a free observation not tied to a template item        | **absent** — every answer hangs off an item                                                                                                                |
| probable cause                                        | **absent** — no such column anywhere in `dia`                                                                                                              |
| confirmed cause / diagnosis                           | **absent**                                                                                                                                                 |
| linking a finding to the additional work it justifies | `wo.additional_work_requests.originating_finding_id` exists as a **column with no foreign key** — writable, not enforced, not reverse-queryable (`INS-07`) |
| reopening a completed report                          | **impossible** — `completed` is terminal                                                                                                                   |

A diagnostics screen that shows "symptom → probable cause → confirmed cause →
recommended action" is describing a system that does not exist. The system that
does exist is: _answer the checklist, record what you measured, record what you
found, recommend what to do._
