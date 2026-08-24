# BR-06 — Work Execution Controls

|                      |                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closes               | `BE-1` · `BE-10` · `DEP-B4` · `DEP-B5` · findings `INS-06`, `INS-03`, `INS-13`, `INS-26`, `INS-27`, `INS-31`, `INS-40` · Owner requirements 7 and 8 |
| Depends on           | `BR-05` (soft) — a branch job board wants the customer                                                                                              |
| Database change      | **one table** for the work log; none for the rest                                                                                                   |
| New permission codes | **none**                                                                                                                                            |
| Complexity           | **M**                                                                                                                                               |

---

## 1. Problem statement

Four separate problems that share one service and one review:

1. **The state graphs are not published.** They are tenant-overridable data a UI must not hard-code,
   and no operation exposes them. `nextStates` is computed for the work order only; the **job graph
   is not published at all** (`INS-06`).
2. **There is no job list at any scope.** `apps/api/src/app/api/v1/jobs/` contains one directory,
   `[jobId]`, exporting `PATCH` only. A supervisor's board is unbuildable, and so is a QC
   supervisor's queue (`INS-03`, `INS-13`, `DEP-B4`, `DEP-B5`).
3. **There is no pause or resume operation**, and none should be added — see §4.2 (`INS-26`).
4. **There is no progressive work log.** No work-log table exists; no note is bound to a job or an
   assignment (`INS-27`, Owner requirement 8).

## 2. Existing repository evidence

### 2.1 The catalogue service exists and no route calls it

`WorkOrderCatalogService` — `apps/api/src/modules/work-order/application/work-order-catalog-service.ts`:
`workOrderStates()` `:33`, `jobStates()` `:38`, `workOrderTransitions()` `:43`,
`jobTransitions()` `:48`. Constructed at `modules/work-order/index.ts:122`, exposed as
`workOrderCatalog` at `:125`.

**It is not dead code.** `workOrderStates()` has 14 internal call sites, three in other modules
(`delivery-read-service.ts:317`, `quality-control-service.ts:98`, `quotation-service.ts:788`).
Only `jobTransitions()` is uncalled anywhere. A grep for either full-graph reader across
`apps/api/src/app` returns nothing, and no `/api/v1/work-order-catalogue/…` path exists among the
248 OpenAPI paths.

The repository query already resolves the tenant override correctly:

```sql
SELECT DISTINCT ON (code) … WHERE (scope = 'platform' OR tenant_id = $1) AND deleted_at IS NULL
ORDER BY code, (scope = 'tenant') DESC
```

filtered to `status = 'active'`, unpaged.

### 2.2 The job-state row carries FIVE flags, and one of them is a trap

`supabase/seeds/06_wo_job_state_graph.sql:65`:

```
(scope, code, name, is_terminal, reason_required, assignment_required, labor_allowed,
 closure_eligible, created_by)
```

Projected as `closureEligible` at `work-order-catalog-repository.ts:42`, `:108`, `:113`, `:130`.

**Closure blocker B1 does not read it.** `wo.guard_work_order_closure` tests `js.is_terminal`
(`20260722105000_qms_rework_closure_gate.sql:378-388`). `ck_job_states_tenant_not_terminal CHECK
(scope = 'platform' OR is_terminal = false)` (`20260722091000_wo_state_catalogs.sql:223-225`) stops
a tenant creating a _terminal_ state and says nothing about `closure_eligible`.

See [C-02](repository-corrections.md#c-02--closure_eligible-is-a-fifth-job-state-flag-published-to-a-ui-and-enforced-by-nothing).
This slice publishes the flag and must forbid deriving closure readiness from it.

### 2.3 The seeded graphs

**Work order — 9 states, 15 edges.** `qc_pending` sets `allows_jobs`, `allows_labor` and
`allows_additional_work` all false: **presenting for QC freezes scope.** `qc_pending → in_progress`
is the only return-from-QC edge. `closed` and `cancelled` are terminal with no outbound edge, and
`wo.guard_work_order_transition` raises `23514` independently, so deleting a graph row opens no
back door.

**Job — 6 states, 10 edges.** `paused` is `assignment_required` **true** and `labor_allowed`
**false** — pausing does not release the technician, it stops the clock.

### 2.4 What is absent

| absent                                | evidence                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /jobs` at any scope              | `apps/api/src/app/api/v1/jobs/` holds `[jobId]` only                                                                                                  |
| `GET /jobs/{jobId}`                   | that route file exports `PATCH` only                                                                                                                  |
| a QC read spanning a branch           | 13 `qms` operations; QC records are readable per work order only                                                                                      |
| pause / resume endpoints              | compositions of two calls each (`permission-matrix.md` A19, A20)                                                                                      |
| **any priority column**               | `grep` over `wo`/`tech`/`qms`/`dia` migrations finds `priority` **once** — `dia.recommendations.priority` (`20260722103000…:314`), a different entity |
| **any work-log or note table**        | `grep -rniE "CREATE TABLE (wo\|tech\|qms\|dia)\.[a-z_]*(log\|note\|comment)"` returns **nothing**                                                     |
| labour totals                         | no endpoint returns elapsed or billed hours; the per-job session read is a `Page<T>`                                                                  |
| a one-open-session-per-job constraint | `tech.labor_sessions` (`20260722099000…:32-52`) has none — two technicians can open a session on one job (`INS-40`)                                   |

### 2.5 The five-way classification the directive asks for

| capability                             | classification                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| job create, update, transition         | **already implemented** — `wo.job-create`, `wo.job-update`, `wo.job-transition`       |
| assignment, reassignment, end          | **already implemented** — three distinct operations under `tech.assignment.manage`    |
| accept / start / complete              | **already implemented as compositions**; no single operation, and none needed         |
| **pause / resume**                     | **already implemented as compositions**; ordering is load-bearing (§4.2)              |
| state-transition legality              | **backend-authoritative** — catalogue-driven, guarded, and `ERR-TRN-001` on refusal   |
| **publishing the graphs**              | **incomplete** — the service exists, the route does not                               |
| **job list / QC list at branch scope** | **missing**                                                                           |
| **work log / technician notes**        | **missing** — new modelling                                                           |
| **priority**                           | **missing entirely** — see §4.4                                                       |
| labour totals                          | **missing**; frontend-only arithmetic is refused (§4.5)                               |
| time/labour recording                  | **already implemented** — `tech.labor-session-*`, four operations                     |
| concurrency control                    | **backend-authoritative** — `record_version` + `If-Match` on every existing-row write |

## 3. Gap

| gap                                                            | class                                       |
| -------------------------------------------------------------- | ------------------------------------------- |
| state and transition catalogues have no HTTP surface           | **Contract**                                |
| `closureEligible` is published to a UI and enforced by nothing | **Domain model**                            |
| no job list at branch scope                                    | **Contract**                                |
| no QC list at branch scope                                     | **Contract**                                |
| no single-job read                                             | **Contract**                                |
| no work-log table or contract                                  | **DB** + **API**                            |
| no priority anywhere                                           | **Domain model**                            |
| labour totals absent; a client sum over a page would be wrong  | **Contract**                                |
| two technicians can open a session on one job                  | **Domain model** — recorded, not fixed here |

## 4. Proposed architecture

### 4.1 One catalogue route over four existing methods

`GET /work-order-catalogue` returns all four graphs in one response. Follow the shipped precedent
`rec.catalogue-visit-reason-list` — `defineOperation` at
`apps/api/src/app/api/v1/reception-catalogue/visit-reasons/route.ts:58-69`, handler `:71-78`,
`.strict()` query `:41-43`, **no `authorizeScope` call**.

The transferable rule is stated at `intake-catalogue-repository.ts:24-28`: a picker read is the one
statement deliberately permitted to trust RLS alone **because it is not id-addressed**. A catalogue
read is exactly that shape.

**One route, not four.** A UI needs the job graph and the work-order graph on the same screen; four
routes means four round trips for data that changes at tenant-configuration frequency.

**Publish `closureEligible`, and state its meaning.** Omitting a field the row carries is its own
defect. The contract must say: _closure eligibility for a work order comes from
`GET /work-orders/{id}/closure-eligibility` and from nothing else._ No consumer may compute closure
readiness from this flag.

### 4.2 Pause and resume stay compositions — and this is a decision, not an omission

`INS-26` records that both are compositions of two calls. The directive asks this slice to cover
them. **The answer is that no pause endpoint should be built**, and the reasoning must be recorded
because "add a pause endpoint" is the obvious move:

- A pause endpoint would need to stop the labour session **and** transition the job, in one
  transaction, across two aggregates with two different permissions (`tech.labor.record` and
  `wo.job.transition`). Composing them server-side either **collapses the two permissions into one**
  — a silent widening — or refuses when the caller holds one and not the other, which is what the
  two-call form already does, more legibly.
- The ordering is not symmetric and not guessable, and the platform already encodes it:
  **start** = transition first (a session against a `planned` job is refused, `labor_allowed` false),
  **pause** = stop the session **first** (transitioning to `paused` with a session open is refused
  for the same reason, and B2 would then block closure with no obvious cause).
- `ERR-WO-002` refuses _resume_ — not pause — while a required additional-work request originating
  from that job is `pending`. A single pause/resume pair would have to explain an error that applies
  to one direction only.

**What this slice adds instead** is the data that lets the UI get the composition right without
guessing: the published job graph with `labor_allowed` per state (§4.1), and the pending-required-
additional-work signal on the job list (§4.3) so start/resume can be disabled _before_ the attempt
rather than discovered as a 409.

### 4.3 Branch-scoped job and QC reads, keyset-paged

`GET /jobs` and `GET /quality-controls`, both requiring the company/branch pair, both keyset-paged.

**Iterating the work-order list is not an alternative**, and `DEP-B5`'s disposition says so: every
one of those calls is registered `expensive-read`, and it would be wrong under paging besides.

The job list carries a `pendingRequiredAdditionalWork: boolean` per row — derived from
`wo.additional_work_requests` where `originating_job_id` names the job, `is_required`, and the state
is `pending`. This is the `ERR-WO-002` predicate, computed once server-side, so the board can
disable start/resume with a reason instead of surfacing a 409 for a rule that is entirely
predictable from data the screen already has.

**A single-job read is added too** (`GET /jobs/{jobId}`), closing `INS-03`. Every job screen is
currently reached and refreshed through its parent work order; that is workable for a detail screen
reached from the board and impossible for one reached from a queue.

### 4.4 Priority: recorded as absent, not invented

There is **no priority column anywhere** in the four schemas. The directive lists priority among the
controls this slice must cover; the honest coverage is:

> **Priority does not exist and this slice does not create it.**

Adding one is new modelling with unanswered questions the repository cannot settle — is priority a
property of the work order or the job; is it an ordered enum or an integer; does it affect the
queue's sort order or only its display; is it tenant-configurable like the state catalogues. Those
are Owner questions.

**Recorded as `BR-06-OPEN-01`**, an Owner decision, blocking nothing else. The board sorts by
`opened_at` until it is answered. A frontend "priority" that is really a client-side sort would be
a second source of truth for a field the backend does not hold, and is forbidden.

### 4.5 Labour totals: refused, with a named reason

`GET /jobs/{jobId}/labor-sessions` is a `Page<LaborSessionView>`. Summing the first page and calling
it "total time on this job" is **the P1-28 round-two defect** — a paged read answering for the whole
set.

Options: (a) do not display a total; (b) page to exhaustion with the existing `read-completeness`
helpers before summing; (c) add a backend total.

**This slice does (c) — but only as `BR-06-OPEN-02`, deferred**, because a total needs a definition
(elapsed or billable? corrected sessions counted once or twice? open sessions included?) that only
the Owner can give. Until then the frontend does (a). _A wrong number on a timesheet is worse than
no number._

### 4.6 The work log is a typed table, not a polymorphic adapter

`shared.notes` addresses rows by `(entity_type, entity_id)` with **NULLABLE** `company_id` and
`branch_id` (`20260718110000…:127-128`), while every operational table in this domain carries
`UNIQUE (tenant_id, company_id, branch_id, id)` with children joining on the full composite. See
[C-08](repository-corrections.md#c-08--sharednotes-cannot-express-this-domains-scope-guarantee).

A job note in `shared.notes` could be written with a NULL branch, so branch containment would have
to be enforced by the application on every read and write, in a domain whose entire integrity story
is that it does not have to be. **The typed form is selected on containment grounds.**

## 5. Database impact

**One new table.** Everything else in this slice is contract-only.

```sql
CREATE TABLE wo.job_work_logs (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  job_id         uuid    NOT NULL,
  entry          text    NOT NULL,
  logged_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,

  CONSTRAINT pk_job_work_logs PRIMARY KEY (id),
  CONSTRAINT uq_job_work_logs_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_job_work_logs_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_work_logs_entry_not_blank CHECK (btrim(entry) <> '')
);
CREATE INDEX ix_job_work_logs_job ON wo.job_work_logs (tenant_id, company_id, branch_id, job_id);
-- RLS enabled AND forced; three scope policies matching wo.jobs.
-- GRANT SELECT, INSERT TO app_runtime;  GRANT SELECT TO app_readonly;   -- append-only
```

| property                               | value and why                                                                                                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **append-only**                        | `SELECT, INSERT` only — no `UPDATE`, no `record_version`, no `updated_*`, no `deleted_*`. It matches `dia.diagnostic_evidence` and `wo.customer_approval_evidence`, the domain's two existing append-only tables. A progress log that can be edited is not a log. |
| no `deleted_at`                        | deliberate; append-only tables in this domain carry none                                                                                                                                                                                                          |
| `logged_at` distinct from `created_at` | a technician recording work done earlier is the normal case; conflating them would make the log unusable for its purpose                                                                                                                                          |
| composite FK                           | cross-branch parentage structurally impossible, matching every other child in the domain                                                                                                                                                                          |
| covering index                         | zero unindexed FKs is a measured property of these four schemas; preserve it                                                                                                                                                                                      |
| RLS                                    | enabled **and forced**, three policies, matching `wo.jobs`                                                                                                                                                                                                        |

**Rollback.** `DROP TABLE`. Safe until the first entry is written; after that, dropping destroys a
record nothing else holds. State the closing window in the migration header.

**`structuralTotals` moves** and cannot be reproduced locally — Supabase schemas inflate it. Take
the figure from a CI run.

## 6. API impact

Six operations.

| #   | id                          | method | route                     | permission                 |
| --- | --------------------------- | ------ | ------------------------- | -------------------------- |
| 1   | `wo.work-order-catalogue`   | `GET`  | `/work-order-catalogue`   | `wo.work_order.read`       |
| 2   | `wo.job-list`               | `GET`  | `/jobs`                   | `wo.work_order.read`       |
| 3   | `wo.job-detail`             | `GET`  | `/jobs/{jobId}`           | `wo.work_order.read`       |
| 4   | `qms.qc-record-branch-list` | `GET`  | `/quality-controls`       | `qms.quality_control.read` |
| 5   | `wo.job-work-log-record`    | `POST` | `/jobs/{jobId}/work-logs` | `tech.labor.record`        |
| 6   | `wo.job-work-log-list`      | `GET`  | `/jobs/{jobId}/work-logs` | `wo.work_order.read`       |

### 1 · `wo.work-order-catalogue`

query `{}` `.strict()` (no parameters) · `200` ·

```
{
  workOrderStates:      WorkOrderStateRow[],   // 11 fields, already projected
  workOrderTransitions: TransitionRow[],
  jobStates:            JobStateRow[],         // 5 flags, incl. closureEligible
  jobTransitions:       TransitionRow[]
}
```

`scope: 'tenant'`, unpaged, no `authorizeScope` call — matching the precedent. Not id-addressed, so
RLS alone is the sanctioned control here.

### 2 · `wo.job-list`

query `{companyId*, branchId*, state?, workOrderId?, technicianProfileId?, cursor?, limit?}`
`.strict()` · `200` · `Page<JobBoardRow>`.

`JobBoardRow` = `JobView` + `{workOrderDisplayNumber, workOrderState, customer?, vehicle?,
pendingRequiredAdditionalWork, openAssignmentCount, hasOpenLaborSession}`.

`customer` and `vehicle` come from [`BR-05`](br-05-work-order-customer-context-projection.md) — the
soft dependency. If `BR-05` has not landed, ship the row without them rather than resolving them a
second way.

`state` is an **opaque lower-snake code**, deliberately not a TypeScript enum, because
`wo.job_states` is tenant-extensible: an unknown code returns an empty page rather than a 422. The
mirror must **not** declare an enum for it.

### 3 · `wo.job-detail`

`200` · `JobDetail = {job, workOrder: WorkOrderSummary, assignments?, nextStates}`.

**`nextStates` for the job, computed the same way `wo.work-order-detail` computes it for the work
order** — from the catalogue, not from a constant.

`assignments` is **omitted, not empty**, for a caller lacking `tech.technician.read`. This is
`T-05`: assignment and labour reads require `tech.technician.read`, **not** `wo.work_order.read`,
because both name a member of staff. Folding them into a work-order-read response would quietly
undo a control the Backend set deliberately.

### 4 · `qms.qc-record-branch-list`

query `{companyId*, branchId*, overallResult?: 'pending'|'passed'|'failed', cursor?, limit?}` ·
`200` · `Page<QcRecordView>`.

`overall_result` **is** a closed vocabulary (`qms.qc_status_history` CHECK-constrains the same
three literals), so unlike job `state` this one is an enum and the mirror declares it.

### 5 · `wo.job-work-log-record`

body `{entry: string(1..4000), loggedAt?: datetime(offset)}` `.strict()` · `201` ·
`WorkLogEntryView` · **idempotent**.

`tech.labor.record` is the code — _"Start, pause, resume and stop labor sessions"_ — because the
work log is the technician's narration of the labour they are recording, by the same person, in the
same act. Requiring `wo.job.manage` would mean a technician cannot describe their own work.

**`loggedAt` may not be in the future**, and may not precede the job's `created_at`.

### 6 · `wo.job-work-log-list`

`200` · `Page<WorkLogEntryView>` — keyset-paged, newest first.

`wo.work_order.read`, matching `wo.job-history`, which uses the **work-order** code rather than a
job or tech code. A work log describes work, not a person; unlike an assignment it names no member
of staff beyond the `created_by` attribution every row in this platform carries.

### Error cases

| condition                              | status                        | code          |
| -------------------------------------- | ----------------------------- | ------------- |
| collection call without the scope pair | 422                           | `ERR-VAL-001` |
| job not found or out of scope          | 404                           | `ERR-RES-001` |
| unknown job `state` filter             | **200, empty page** — not 422 |
| `loggedAt` in the future               | 422                           | `ERR-VAL-001` |
| blank `entry`                          | 422                           | `ERR-VAL-001` |
| missing `Idempotency-Key` on 5         | 400                           | `ERR-INT-002` |

## 7. Permission model

**Mint nothing.** Every operation reuses an existing code.

| operation        | code                       | justification                                                              |
| ---------------- | -------------------------- | -------------------------------------------------------------------------- |
| 1 catalogue      | `wo.work_order.read`       | a catalogue read is not a new authority                                    |
| 2 job list       | `wo.work_order.read`       | jobs are work-order content; the same code already covers `wo.job-history` |
| 3 job detail     | `wo.work_order.read`       | as above                                                                   |
| 4 QC list        | `qms.quality_control.read` | the existing QC read code                                                  |
| 5 work-log write | `tech.labor.record`        | the technician's own narration of their own labour                         |
| 6 work-log read  | `wo.work_order.read`       | describes work, not a person                                               |

**The separation this slice must not destroy** (`permission-matrix.md` §5): `wo.job.manage` /
`wo.job.transition` remain distinct, and operation 3's `assignments` block remains behind
`tech.technician.read`. A screen that composes an action out of two calls must check **both** codes
before offering it and degrade gracefully — not silently — when the caller holds one and not the
other.

| actor                       | board                                   | job detail | assignments on it | write a work log |
| --------------------------- | --------------------------------------- | ---------- | ----------------- | ---------------- |
| service advisor             | yes                                     | yes        | **no** — omitted  | no               |
| workshop supervisor         | yes                                     | yes        | yes               | typically no     |
| technician                  | yes if granted                          | yes        | yes if granted    | **yes**          |
| QC user                     | QC list with `qms.quality_control.read` | —          | —                 | no               |
| cross-tenant / cross-branch | refused at scope evaluation and by RLS  |            |                   |                  |

## 8. Security requirements

| abuse case                                                | required behaviour                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cross-branch exposure through an omitted scope target** | operations 2 and 4 are collection reads; `scope: 'branch'` is **inert without a target** and RLS cannot compensate because `app.branch_ids` is the permission-blind union of every active grant (`P1-18-A-01`). The pair is **required** and `.strict()`. This is `T-02` and it applies with full force here. |
| **staff-data over-exposure**                              | `assignments` and any labour data omitted for a caller without `tech.technician.read` (`T-05`)                                                                                                                                                                                                                |
| **IDOR**                                                  | `jobId` resolves under RLS; out of scope is 404                                                                                                                                                                                                                                                               |
| **tenant-authored vocabulary reaching an unsafe context** | state codes are tenant data, bounded by `^[a-z][a-z0-9_]{1,62}$`. Look them up in a map; never interpolate into a key path that could reach a dynamic import, never build a CSS class by concatenation (`T-15`)                                                                                               |
| **catalogue enumeration**                                 | low risk, but operation 1 must still be tenant-scoped by RLS                                                                                                                                                                                                                                                  |
| **`closureEligible` misuse**                              | the contract states it is not a closure decision; a test asserts a tenant state with `closure_eligible = true, is_terminal = false` does **not** make a work order closable                                                                                                                                   |
| **work-log forgery**                                      | `created_by` is stamped from `iam.current_user_id()`, never from the body. `loggedAt` is caller-supplied and bounded — it is a claim about when, not about who                                                                                                                                                |
| **work-log tampering**                                    | impossible — append-only, `UPDATE` not granted                                                                                                                                                                                                                                                                |
| **free-text in the log**                                  | React escapes by default and `dangerouslySetInnerHTML` is forbidden tree-wide by the `unsafe-html` rule. Length is capped server-side. Treat the entry as operational text (`T-08`)                                                                                                                           |
| **race**                                                  | two technicians opening a session on one job is **not prevented by the platform** (`INS-40`). The board shows `hasOpenLaborSession` so the UI can warn; **it cannot prevent the second.** Say so; do not imply a guarantee.                                                                                   |
| **paging**                                                | a conclusion drawn from one page is the P1-28 round-two defect; both new lists are keyset-paged and tested across page boundaries                                                                                                                                                                             |

## 9. Validation

| concern                                    | rule                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ids                                        | `schemas.uuid` throughout; `companyId`/`branchId` **required** on 2 and 4                                                                                                                                                                                        |
| **enums, and where there must NOT be one** | `overallResult` is `z.enum(['pending','passed','failed'])`. Job and work-order `state` are `z.string().regex(/^[a-z][a-z0-9_]{1,62}$/)` — **never** an enum, because the catalogue is tenant-extensible. Getting this backwards in either direction is a defect. |
| lengths                                    | `entry` 1..4000, non-blank, mirroring the CHECK                                                                                                                                                                                                                  |
| timestamps                                 | `loggedAt`: `z.string().datetime({offset: true})`, not future, not before the job's creation                                                                                                                                                                     |
| state compatibility                        | none — a work log may be recorded in any job state, including terminal. A technician writing up finished work is normal.                                                                                                                                         |
| duplicate prevention                       | operation 5 is idempotent; the key is the control                                                                                                                                                                                                                |
| relationship validation                    | the job's scope is resolved from the job row, never from the request                                                                                                                                                                                             |
| empty / partial                            | not applicable — no update operation in this slice                                                                                                                                                                                                               |
| unknown parameter                          | `.strict()` everywhere                                                                                                                                                                                                                                           |

Export every `Body`, `Params` and `Query`.

## 10. Error contract

**No new error codes.**

| condition                               | HTTP | code          | frontend behaviour                                    |
| --------------------------------------- | ---- | ------------- | ----------------------------------------------------- |
| scope pair omitted                      | 422  | `ERR-VAL-001` | a client defect; the adapter must always send it      |
| unknown state filter                    | 200  | —             | empty page, not an error — the code may be a tenant's |
| job out of scope                        | 404  | `ERR-RES-001` | existence not disclosed                               |
| blank / oversized entry, bad `loggedAt` | 422  | `ERR-VAL-001` | field errors as keys                                  |
| not permitted                           | 403  | `ERR-IAM-001` | denial + correlation id                               |
| `Idempotency-Key` absent                | 400  | `ERR-INT-002` | one key per intent, held across retries               |

**Two existing codes this slice makes explicable rather than mysterious:**

- **`ERR-WO-002`** — a job may not enter a `labor_allowed` state while a **required**
  additional-work request **originating from that job** is `pending`. Three qualifications, each of
  which changes the UI: pausing is never refused; approved-but-unfulfilled does not refuse
  execution; it refuses **one job movement**, not the whole work order. `pendingRequiredAdditionalWork`
  on the job list is what lets the UI disable start/resume with that reason before the attempt.
- **`ERR-TRN-001` versus `ERR-CON-001`** — the move is illegal from here, versus your copy is old.
  Same banner for both trains users to reload and retry an action that will never succeed.

## 11. Audit and history behaviour

| operation         | `auditClass`   |
| ----------------- | -------------- |
| 1, 2, 3, 4, 6     | `none` — reads |
| 5 work-log record | `privileged`   |

**What is historically visible:**

- **Job state history** — unchanged, via `GET /jobs/{jobId}/history`, `{origin, transitions[]}` with
  `from_state`, `to_state`, `reason`, `correlation_id`, `actor_id`, `occurred_at`.
- **The work log** is itself a history surface: append-only, attributed, ordered by `logged_at`.
  It satisfies the _work logs_ limb of the permanent history requirement, which nothing satisfied
  before.
- **`actor_id` is an id.** There is no user-directory read in scope to resolve it to a name. Render
  the id, or render "a user" — do not invent a name.
- **The four timelines stay four.** Work order, job, diagnostic report and QC are independently
  keyset-paginated with three different permissions. **Do not merge them client-side and claim
  completeness** — interleaving pages produces a list that is ordered but not complete, which is the
  P1-28 round-two defect in a new costume. If merged, use the `read-completeness` helpers and label
  the result honestly. The work log makes it **five**, and the same rule applies.

## 12. Tests

### Positive

| #   | case                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | the catalogue returns 9 work-order states, 15 edges, 6 job states, 10 edges on a clean platform seed                                        |
| P2  | **the decisive catalogue test** — insert a tenant row into `wo.job_states`; the response carries it and **not** the platform row it shadows |
| P3  | `jobStates[]` carries all five flags including `closureEligible`                                                                            |
| P4  | the job list pages across a branch; the union of pages equals the whole set                                                                 |
| P5  | `pendingRequiredAdditionalWork` is true exactly when a required `pending` request names the job as its origin                               |
| P6  | `wo.job-detail` returns `nextStates` computed from the catalogue, not a constant                                                            |
| P7  | the QC branch list pages and filters by `overallResult`                                                                                     |
| P8  | a work-log entry is recorded and read back in order, with `loggedAt` distinct from `created_at`                                             |

### Negative

| #   | case                                            | expected           |
| --- | ----------------------------------------------- | ------------------ |
| N1  | no auth                                         | 401                |
| N2  | job list without `branchId`                     | 422                |
| N3  | QC list without `companyId`                     | 422                |
| N4  | unknown job `state` filter                      | 200, empty page    |
| N5  | unknown query parameter                         | 422                |
| N6  | job detail for an out-of-scope job              | 404                |
| N7  | work log with a blank entry                     | 422                |
| N8  | work log with `loggedAt` in the future          | 422                |
| N9  | work log longer than 4000 characters            | 422                |
| N10 | work log without `Idempotency-Key`              | 400                |
| N11 | `UPDATE wo.job_work_logs` as `app_runtime`      | refused — no grant |
| N12 | `DELETE FROM wo.job_work_logs` as `app_runtime` | refused — no grant |

### Security

| #   | case                                                                                                                                                                                                                  | expected                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| S1  | **`T-02`**: caller holds `wo.work_order.read` in branch X and _any_ grant in branch Y, requests the job list for Y                                                                                                    | 403                                        |
| S2  | **cross-branch**: the job list for branch X never returns a branch-Y job                                                                                                                                              | restricted user                            |
| S3  | **`T-05`**: a caller with `wo.work_order.read` but not `tech.technician.read` gets `wo.job-detail` **without** an `assignments` field — omitted, not empty                                                            |                                            |
| S4  | **cross-tenant**: work logs from tenant B are unreachable                                                                                                                                                             | restricted user                            |
| S5  | **forged attribution**: a body carrying `createdBy`                                                                                                                                                                   | 422                                        |
| S6  | **the `closureEligible` trap** — a tenant job state with `closure_eligible = true, is_terminal = false`; a work order with a job in that state is **not** closable, and `GET /closure-eligibility` reports blocker B1 | **the test that proves C-02 is contained** |
| S7  | **paging completeness** on both new lists across ≥ 3 pages                                                                                                                                                            |                                            |

S1–S4 as restricted users.

### Regression — must remain green

- Every existing `wo.job-*`, `tech.labor-session-*` and `qms.qc-*` test.
- `wo.work-order-detail`'s `nextStates` — unchanged.
- The terminal-freeze guard `wo.guard_work_order_transition` — still raises `23514` independently of the graph rows.
- Closure blockers B1–B6 — unchanged; S6 exercises B1 against a tenant-authored state for the first time.
- Zero unindexed FKs across the four schemas — one new FK, one new index.
- `check-authorization-coverage` / `check-openapi`: **+6**.
- `structuralTotals` — a new table and index move it; take the figure from CI.

## 13. Definition of Done

- [ ] Six operations registered, published, in the operation register.
- [ ] Exactly **one** migration: `wo.job_work_logs`, append-only, RLS enabled and forced, composite FK, covering index, `SELECT`+`INSERT` grants only.
- [ ] **Zero** permission codes added.
- [ ] P2 passes — a tenant override appears and shadows the platform row.
- [ ] P3 passes — `closureEligible` is published.
- [ ] **S6 passes** — publishing `closureEligible` cannot make an ineligible work order closable, and the contract says so in prose.
- [ ] S3 passes — `assignments` is **omitted**, not empty, without `tech.technician.read`.
- [ ] S7 passes — both lists are complete across page boundaries.
- [ ] N11 and N12 pass — the work log is append-only at the grant layer, not by convention.
- [ ] The mirror declares an enum for `overallResult` and **no** enum for job or work-order `state`.
- [ ] No pause, resume, start or complete endpoint exists — `grep` confirms it, and the slice evidence records why.
- [ ] `BR-06-OPEN-01` (priority) and `BR-06-OPEN-02` (labour totals) are recorded as Owner decisions, and **no** client-side substitute for either exists in `apps/web`.
- [ ] `INS-40` — two open sessions on one job — is recorded as an unfixed platform property, with the UI warning and not claiming prevention.
- [ ] No file under `apps/web` is changed by this slice.
- [ ] No unresolved Critical or High finding open against this slice.
