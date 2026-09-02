# Phase 1-29 — Work Order, Diagnostics and Technicians — canonical plan

**Status:** ACTIVE · **Base:** protected `develop` `2a0285ec` · **Lane:** Frontend
(`feature/p1-29-` → ownership profile `p1-29-frontend`)

---

## 0. Why this document exists

Before it, the phase's canonical surface on protected `develop` was two documents written by
other phases — a requirement table owned by the product register and a read-model contract
written twenty phases earlier — and one load-bearing rule that was not on `develop` at all.

The governing register, `RootLco_Phase_1_Development_Plan_recovered_v01.docx`, is deliberately
outside Git (`docs/governance/canonical-documents.md`, `"committedToGit": false`), so nothing
in the repository could answer _what closes this phase_ without leaving it.

This document answers four questions and nothing else: what P1-29 owns, what it does not own,
what its work items are, and what completion means. It is a **binding record, not a plan
revision.** Where an authority already exists it is CITED, never copied — a second copy of a
requirement table is a second thing to drift.

**What was recovered, and from where.** The closure condition in §3 was recovered from branch
`planning/p1-29-work-order-diagnostics-technician-preparation` at commit `b5be9f4c`, file
`docs/phase-1/phase-1-29/execution-decision.md` lines 28-30. That branch is **not merged and is
not being merged.** It carries fourteen preparation documents; thirteen of them are preparation
material and are deliberately left where they are. Only the rule below is canonical.

---

## 1. What P1-29 owns

### 1.1 The Owner requirement table — the authority

`docs/product/owner-workflow-requirements.md`, heading `## P1-29 — Work Order, Diagnostics and
Technicians` at line 220, table at lines 222-239.

**That table is the authority. This document does not restate it.** Its shape, so that drift is
detectable: two columns (`Requirement`, `Status`), no id column, **16 data rows** at lines
224-239. Status tally as it stands: `Planned` 3 · `Blocked` 7 · `Partly blocked` 1 ·
`Contracted` 4 · `Partly contracted` 1.

**The Status column predates PRE-P1-29 and is stale.** Every blocker it names has since been
answered by a merged PRE-P1-29 contract, and the reconciliation belongs here rather than in the
Owner's own register:

| Blocker the table names                              | State on `develop` `2a0285ec`                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `INT-036` no customer on a work order                | answered — the work order carries a dated customer/vehicle projection           |
| `INT-042` departments exist nowhere                  | answered — `org.department-create` / `-list` / `-update`, `org.department.read` |
| `INT-045`, `INT-047` no technician profile operation | answered — the `tech.*` surface, including `tech.technician-me-queue`           |
| `INT-048` no pause or resume                         | answered — `tech.labor-session-start` / `-stop` / `-correct`                    |
| `INT-049` no work-log table                          | answered — `wo.job-work-log-record` / `-list`, append-only                      |
| `INT-093`…`INT-095` work evidence                    | answered — `wo.job-evidence-record` / `-list`, `wo.work-order-evidence-list`    |
| `INT-100` no module raises a notification            | answered — `shared.notification-enqueue` and the delivery reads                 |
| `INT-043` history sectioned, not unified             | **NOT answered** — see W6                                                       |

The Owner may wish to restate the Status column. **P1-29 does not edit it**; a Frontend phase
does not rewrite the product register it is measured against.

### 1.2 The read-model contract — the authority

`docs/phase-1/phase-1-9/p1-29-frontend-contract.md`, exactly 27 lines. It names **six** surfaces
and this phase renders all six: work-order board, job/labor view, technician view, diagnostic
report view, quality/closure view, and timelines.

Two of its rules are easy to lose and are repeated here because losing either is a defect:

- evidence is resolved **through the linked document, never by raw object id**;
- restricted narratives — certificate number, additional-work description, rework cost — render
  **only** with `iam.sensitive.view`, while their metadata parents render in scope.

### 1.3 The lane

`apps/web` only. The Backend surface P1-29 consumes was published by P1-15…P1-22 and completed
by PRE-P1-29; this phase adds screens, adapters and the contract mirror that lets them consume
the Backend without importing it.

---

## 2. What P1-29 does not own

### 2.1 The lower boundary, quoted from P1-28

`docs/phase-1/phase-1-28/canonical-plan.md` §6, lines 224-230, binding:

> **P1-28 ends where the work order begins.** P1-28 owns appointment scheduling, vehicle
> reception, and the single conversion ACTION (`rec.reception-convert-to-work-order`) together
> with the read-only display of its result. **No work-order execution, no technician boards, no
> diagnostics authoring** — no work-order editing, assignment, department routing, progress
> recording, or diagnostic finding of any kind is P1-28 work. Those are P1-29.

Read forwards, that sentence is this phase's charter: everything it denies P1-28 is owned here.

### 2.2 Excluded by PRE-P1-29 disposition

- **Tenant tax administration (`org.tax.manage`)** — CANONICAL OUT-OF-SCOPE. Not built, not
  planned, not a P1-29 dependency.
- **Tenant-side subscription mutation (`org.subscription.manage`)** — DEFERRED to platform and
  subscription administration scope.
- **Backend authorship of any kind.** No new operation, permission code, migration, database
  view or authorization framework is P1-29 Frontend work. Where a real runtime proves the
  Backend cannot satisfy a screen, the gap is raised as a Backend item (W5, W6) and travels on
  a Backend branch, never inside a screen.

### 2.3 Not a dependency

`B1-PGNET-BLOCKER` is an external, provider-owned ACL condition on the `net` schema. It remains
**OPEN**. No P1-29 code path touches the `net` schema, and no work item below depends on it.
It is named here only so it is not carried over by association.

---

## 3. Closure condition — the diagnostics experience is mandatory

Recovered verbatim from `planning/p1-29-work-order-diagnostics-technician-preparation`
`b5be9f4c`, `docs/phase-1/phase-1-29/execution-decision.md:28-30`:

> **P1-29 MUST NOT BE DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE REQUIRED BY ITS
> CANONICAL OWNER REQUIREMENTS.** Closure without it is not a reduced pass; it is not a pass.

This rule is **load-bearing and is not negotiable down**. It is not "optional", not a
"follow-up", not a "future enhancement", and not "a separate later phase". A P1-29 closure
record that does not mechanically prove a working diagnostics experience is invalid, however
green every other gate is.

**An early slice may still ship without diagnostics UI.** The same source says so, and that
permission is about ORDER, not about closure: a slice may land before diagnostics exists;
the PHASE may not close before it does.

**One precondition has changed and the record must say so.** The preparation text blocked the
diagnostics slice on `INS-09` — "there is no HTTP authoring surface and no permission
vocabulary for the diagnostic template lifecycle". That reason is retired: `develop` `2a0285ec`
carries **23 `dia.*` operations**, including the full template lifecycle (`dia.template-create`,
`dia.template-item-create`, `dia.template-version-create`,
`dia.template-version-list-publishable`, `dia.template-version-status-set`) and the execution
and review surface (`dia.diagnostic-create`, `-item-result`, `-finding-record`,
`-measurement-record`, `-dtc-record`, `-recommendation-record`, `-evidence-record`, `-review`,
`-complete`, `-transition`, `-detail`, `-list`, `-history`), gated by `dia.catalogue.manage`,
`dia.diagnostic.read`, `dia.diagnostic.record`, `dia.diagnostic.review` and
`dia.diagnostic.complete`.

**What remains is narrower and precise:** the `dia.diagnostic_types` vocabulary is EMPTY — the
table exists (`supabase/migrations/20260722093000_dia_qms_catalogs.sql`) and no row is seeded,
and no read operation publishes it. That is W5, and it is a real dependency of W7, not a reason
to defer diagnostics.

---

## 4. Execution matrix

Nine items. Each is `MEASURE → CODE → TARGETED PROOF → CONTINUE`. Backend items are marked and
travel on a Backend branch.

| Id     | Item                                                      | Lane     | Adds backend?     |
| ------ | --------------------------------------------------------- | -------- | ----------------- |
| **W1** | Work-order queue and history at `/work-orders`            | Frontend | no                |
| **W2** | This canonical record                                     | Docs     | no                |
| **W3** | Work-order detail: lifecycle, jobs, routing, assignment   | Frontend | no                |
| **W4** | Technician workspace: queue, sessions, work log, evidence | Frontend | no                |
| **W5** | Diagnostic-type vocabulary read operation                 | Backend  | **yes, one read** |
| **W6** | Unified work-order history, and a blocker record          | Backend  | **yes**           |
| **W7** | Diagnostics experience — authoring, execution, review     | Frontend | no                |
| **W8** | Quality and closure view; additional work; submit for QA  | Frontend | no                |
| **W9** | Owner acceptance                                          | Both     | provisioning only |

**W1** — `/work-orders`, consuming `wo.work-order-list` (`wo.work_order.read`, branch scope).
Zero new operations, permissions or migrations. Proves the whole chain — contract mirror →
adapter → gated page → real response — on the smallest surface.

**W3 — DELIVERED.** `/work-orders/{workOrderId}`, on `wo.work-order-detail`,
`wo.work-order-transition`, `wo.job-update`, `wo.job-assignment-create` /
`wo.job-assignment-list` and `org.department-list`. Zero new backend. Department routing reads
`org.department-list` and did not grow a second picker.

Its four load-bearing paths are proved on real responses in
`tests/backend/p1-29-w3-work-order-detail.test.ts` — the detail with the web mirror held against
the row that came back, the job graph, a persisted department routing re-read to prove it
changed, and a persisted technician assignment. Concurrency is proved in both directions
(a fresh version writes, a stale one is refused and changes nothing), and the request the screen
actually builds — the `If-Match`, the three-way `departmentId`, the assignment window — is
proved in `apps/web/tests/work-orders-detail-api.test.ts`, which a backend test cannot cover.

It also closed the one thing PRE-P1-29 left owing to this lane: the
`wo.job-update.departmentId` mirror field. BR-02 added it to the API and could not add it to
`apps/web`; the gap was carried as a `PENDING` disposition. W3 is its first caller, so the mirror
carries the field and `check-p1-29-payload-parity` now declares **zero** dispositions.

Still open in this item, deliberately and not silently: `wo.work-order-history`,
`wo.job-create`, `wo.job-transition`, `wo.job-assignment-end` and `wo.job-reassignment` are
published and unconsumed. The unified history is W6; the rest are the write surface a later
slice adds to this screen.

**W4 — DELIVERED.** `/technicians/me`, on `tech.technician-me-queue`, `wo.job-assignment-list`,
`tech.labor-session-list` / `-start` / `-stop` / `-correct`, `wo.job-work-log-list` / `-record`,
`wo.job-evidence-list` / `-record`, and the shipped attachments chain for capture. Zero new
backend.

**The identity seam closed on existing operations.** `tech.technician-me-queue` withholds the
caller's own `technicianProfileId` by design; `tech.labor-session-start` requires it and has no
`me` variant. The queue row carries the caller's own `assignmentId`, and `wo.job-assignment-list`
— on the same `tech.technician.read` — carries the profile of every assignment on the job, so
matching the one row whose id equals the caller's assignment yields the caller's own profile
with no ambiguity, even on a job two technicians share. Proved on real responses in
`tests/backend/p1-29-w4-technician-workspace.test.ts` (`W4-2`, `W4-2b`, `W4-2c`). The web
adapters perform that resolution server-side on every write and take the ASSIGNMENT, never a
technician id: there is no parameter through which one can enter, which
`apps/web/tests/technicians-workspace-api.test.ts` holds.

Proved on real responses: the personal queue with the mirror held against the row; a persisted
labour start re-read; a persisted stop re-read, with a stale stop refused and the record left
alone; a correction as a separate, higher authority; a free-text work-log entry re-read
verbatim; an evidence binding re-read; no-permission, read-is-not-write, cross-branch and
cross-tenant refusals.

Three measured facts the screen renders truthfully rather than papering over:

- The queue read parses `limit` and **discards it** — the response is `{ items }` with no
  cursor. The screen offers no paging control and says the list is not paged.
- `wo.job_work_logs` is granted `SELECT, INSERT` only and carries no `recordVersion`. The
  screen offers ADD and nothing else — no edit, no delete, and no action vocabulary, because
  no column holds one.
- `wo.jobs` is not a linkable entity type. A captured document is authorised and linked
  against the **work order** the caller's own queue row named; `wo.job-evidence-record` binds
  its version to the job. No platform document category exists for work evidence, so the
  capture form offers the tenant's own categories from the server and invents none.

**One finding, recorded and not endorsed — `W4-F1`.** `tech.labor.record` is a branch-scoped
recording authority, as P1-19 designed it for a timekeeper: a caller holding it may start a
session for ANY active technician profile in the branch, and the backend does not refuse a
same-branch technician naming another technician's profile (`W4-5e`, measured `201`). The
workspace adapter refuses to build that request, but an adapter is not a boundary. This is not
a W4 blocker — the composition introduces no ambiguity and the frontend asserts no identity —
and it is not this lane's to change. The smallest Backend delta, when the Owner wants it: have
`tech.labor-session-start` refuse a body naming a profile other than the caller's own whenever
the caller HOLDS a live profile in the target scope, leaving the timekeeper path open to callers
who do not. `W4-5e` is a tripwire that fails the day that lands.

Still open in this item, deliberately: `wo.job-transition` is not consumed here — the platform
has no pause operation, stopping the clock is `tech.labor-session-stop`, and moving the job is a
separate authority a later slice adds beside the W3 screen.

**W5 — DELIVERED.** `dia.diagnostic-type-list`, `GET /diagnostic-types`, on the existing
`dia.diagnostic.read`. **No new permission code, no migration, no seed.** The read publishes the
set `dia.diagnostic_types` resolves for the caller tenant — a tenant row shadowing the platform
row of the same code, the predicate `diagnosticTypeByCode` has applied since P1-19 — with each
row's `status`, so a report typed against a retired type can still name it; whether a code may
be USED for a new template stays the write path's decision. Unpaged, empty `.strict()` query,
as `wo.work-order-catalogue`. Approved vocabulary content is an Owner input; the operation
answers an empty set until it exists, which `tests/backend/p1-29-w5-diagnostic-type-list.test.ts`
holds alongside the shadowing, the statuses, the refusals and the per-tenant isolation.

**W6 — DELIVERED.** Backend: the two Owner requirements with no owning prerequisite.

The unified history (`INT-043`, requirement row 16) is `wo.work-order-timeline`,
`GET /work-orders/{workOrderId}/timeline` on `wo.work_order.read`: one keyset page, newest first,
over every ledger the order's history lives in — its own and its jobs' status ledgers, assignments,
labour sessions, the work log, evidence, blockers, report status and QC status. It stays a VIEW, as
the Owner's own rule demands ("these must not become three independently mutable copies"): no table
is added and nothing is written. The four owning modules answer the same windowed question over
their own schemas and the work-order module merges the windows with keyset semantics
(`apps/api/src/server/db/timeline.ts`), because ADR-001 forbids the cross-schema `UNION` that would
have been the shorter code. Kinds the caller may not see — staff kinds without
`tech.technician.read`, report status without `dia.diagnostic.read`, QC status without
`qms.quality_control.read` — are **omitted and named** in `omittedKinds`, never emptied.

The blocker record (requirement row 13) is `wo.job_blocker_events`, one migration: an append-only
EVENT ledger — `wo.job-blocker-raise`, `wo.job-blocker-resolve`, `wo.job-blocker-list` — under the
work-log precedent (`tech.labor.record` to write, `wo.work_order.read` to read). It reconciles
`VHM-16`: a blocker was "expressed as `awaiting_parts` or `awaiting_customer` with a mandatory
reason", which is a work-order STATE and cannot say that one job of three is waiting. The record
can, and it moves no state — those states stay exactly what they are. A blocker's status is derived
(open while no resolution references the raise); one resolution per raise is a partial unique index
and a second is a conflict. No new permission code.

Proved on the real database in `tests/backend/p1-29-w6-history-and-blockers.test.ts`: ten kinds
from four modules driven through their real routes and returned as one descending chronology; pages
at `limit=3` concatenating to the unpaged set with nothing skipped and nothing twice; the withheld
kinds named for a work-order reader; raise, resolve, the folded status, the conflict, and the job's
state unchanged by any of it; no-permission, cross-branch and cross-tenant refusals.

**W7** — the diagnostics experience, on the 23 operations above. **Closure depends on it (§3).**

**W7's Backend seam — DELIVERED.** Measuring W7 against the routes found that no operation
published a template version's **items**: `dia.template-detail` returns the template and its
versions, each with an `itemCount` and nothing else, and `dia.diagnostic-detail` returns the
report's RESULTS — a fresh report's `items` is empty, and `outstandingMandatory` names only the
mandatory items still open, by code and prompt, with no id to answer them by. A screen that
executes an inspection could not show what each item asks or address a result to it; a screen
that authors one could not show what was authored. `dia.template-version-item-list`,
`GET /template-versions/{versionId}/items` on the existing `dia.diagnostic.read`, is that one
read: unpaged, `.strict()`, in checklist order, not gated by version status (a draft's items are
what authoring renders; a retired version's are what an old report still names). **No new
permission code, no migration.** Both absences and the read are proved on real responses in
`tests/backend/p1-29-w7-template-version-item-list.test.ts`. The Frontend W7 slice follows on
the 23 operations.

**W8** — `wo.work-order-closure`, `wo.work-order-closure-eligibility`, QC records and per-check
results, the `B1..B6` closure-gate blocker state, rework links, the append-only reopen-attempt
log, additional-work request and submit-for-QA.

**W8's Backend seam — DELIVERED.** Measuring W8 against the routes found that no operation
published the QC **check vocabulary**: `qms.qc-record-detail` returns the record's RESULTS and
`unresolvedMandatory` — the mandatory checks still open — so a screen could address a mandatory
check by id only while it was unanswered, and an optional check never; the module resolved
`qms.qc_checks` internally (tenant shadowing platform by code) to decide the gate and handed it
out to nobody. `qms.qc-check-list`, `GET /qc-checks` on the existing `qms.quality_control.read`,
is that one read: unpaged, `.strict()`, by code, both statuses with each row saying which, so a
record written against a retired check can still name it; whether a check may be answered stays
the write path's decision. **No new permission code, no migration.** The absence and the read are
proved on real responses in `tests/backend/p1-29-w8-qc-check-list.test.ts`.

**W9** — Owner acceptance on a production build. **Known executable dependency:** `iam.roles`
holds zero rows, so no human actor carries any domain permission code and every operation
refuses a hand-driven journey. The smallest legitimate provisioning path must be derived from
the existing IAM architecture and executed; a privileged test shortcut is not acceptance.

---

## 5. What completion means

P1-29 is complete when **all** of the following hold. Any one failing means the phase is open.

1. Every one of the **six** read-model surfaces in §1.2 is implemented and reachable.
2. The **diagnostics experience exists and works** (§3), proved mechanically — not asserted.
3. Every screen proves **PC-1 on a real response**: an authorized actor retrieves and sees the
   data; an unauthorized actor is refused; a cross-tenant record is not visible. A route that
   exists, a permission that exists, a hook that exists and a component that renders are **not**
   proof — that combination has shipped operations that answered 500 to every request while
   every structural gate stayed green.
4. No screen renders static fixtures on the production path. Tests may use fixtures; the
   product consumes the real read model.
5. The Frontend/Backend boundary holds: no API source changed by a P1-29 Frontend branch.
6. `scripts/ci/check-p1-29-access.mjs` and `scripts/ci/check-p1-29-payload-parity.mjs` pass **non-vacuously** — with
   route pages actually examined, not zero.
7. Owner acceptance is recorded as an explicit verdict on a production build (W9).

---

## 6. How this document is kept honest

It states no count it does not cite, and copies no authority it can reference. Everything in §1
and §2 resolves against protected `develop` `2a0285ec`; §3's rule resolves against the branch and
commit named there and is otherwise absent from `develop`, which is the reason it was recovered.

The closure condition is discoverable by searching this repository for
`DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE`.
