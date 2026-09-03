# BR-06 — execution record

Work Execution Controls. Closes `BE-1`, `BE-10`, `DEP-B4`, `DEP-B5`, findings
`INS-06`, `INS-03`, `INS-13`, `INS-26`, `INS-27`, `INS-31`, `INS-40`, and Owner
requirements 7 and 8.

|                      |                                                                      |
| -------------------- | -------------------------------------------------------------------- |
| Contract             | [br-06-work-execution-controls.md](br-06-work-execution-controls.md) |
| Branch               | `remediation/p1-29-backend-work-execution-controls`                  |
| Migrations           | **one** — `wo.job_work_logs`                                         |
| New permission codes | **zero**                                                             |
| New operations       | **six** — 325 → **331**; paths 263 → **267**                         |

---

## 1. Four problems, one slice

| #   | problem                                                                                                                                          | closed by                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1   | the state graphs were **never published**, so a UI could only hard-code tenant-overridable data (`INS-06`)                                       | `wo.work-order-catalogue`                                   |
| 2   | **no job list at any scope** — `app/api/v1/jobs/` held one directory, `[jobId]`, exporting `PATCH` only (`INS-03`, `INS-13`, `DEP-B4`, `DEP-B5`) | `wo.job-list`, `wo.job-detail`, `qms.qc-record-branch-list` |
| 3   | no pause or resume operation (`INS-26`)                                                                                                          | **deliberately still none** — §4                            |
| 4   | **no work log anywhere in the platform** (`INS-27`, requirement 8)                                                                               | `wo.job-work-log-record` / `-list`                          |

## 2. The migration

`wo.job_work_logs` — the **first** log/note/comment table in `wo`/`tech`/`qms`/`dia`;
a grep across all four returned nothing beforehand.

- **Typed, not `shared.notes`, on containment grounds (`C-08`).** `shared.notes`
  has NULLABLE `company_id`/`branch_id`, so a job note there could carry a NULL
  branch and containment would move out of the row layer into the application —
  in a domain whose whole integrity story is that it does not have to.
- **Append-only at the GRANT layer**, which is the only place it can be meant:
  `SELECT, INSERT` to `app_runtime` and nothing else. Verified on the applied
  table as `app_runtime|INSERT,SELECT`. No `record_version`, no `updated_*`, no
  soft delete — matching `dia.diagnostic_evidence` and
  `wo.customer_approval_evidence`. **No UPDATE or DELETE policy either**: a policy
  for an ungranted verb would suggest the verb exists.
- `logged_at` is the technician's **claim** about when; `created_at` is when the
  platform was told; `created_by` is stamped from the session. Recording at 16:00
  the work done at 14:00 is the normal case.
- Composite FK to `wo.jobs` with its covering index — **zero unindexed FKs across
  the four schemas re-measured green**.
- `migrationCount` 124 → 125. `structuralTotals` moves and must come from CI.

**Rollback** is `DROP TABLE`, safe **only until the first entry is written**;
after that it destroys a record nothing else holds. The migration header says so.

## 3. What each operation is, and the one thing each gets right

| id                          | route                          | permission                 |
| --------------------------- | ------------------------------ | -------------------------- |
| `wo.work-order-catalogue`   | `GET /work-order-catalogue`    | `wo.work_order.read`       |
| `wo.job-list`               | `GET /jobs`                    | `wo.work_order.read`       |
| `wo.job-detail`             | `GET /jobs/{jobId}`            | `wo.work_order.read`       |
| `qms.qc-record-branch-list` | `GET /quality-controls`        | `qms.quality_control.read` |
| `wo.job-work-log-record`    | `POST /jobs/{jobId}/work-logs` | `tech.labor.record`        |
| `wo.job-work-log-list`      | `GET /jobs/{jobId}/work-logs`  | `wo.work_order.read`       |

**Zero permission codes minted.** Every operation reuses an existing one.

- **The catalogue publishes `closureEligible`** — omitting a field the row carries
  is its own defect — **and states that it is not a closure decision.**
  `wo.guard_work_order_closure` tests `is_terminal` and never this flag, and
  `ck_job_states_tenant_not_terminal` only forbids a tenant minting a _terminal_
  state. **S6 proves the containment** rather than asserting it: a tenant state
  with `closure_eligible = true, is_terminal = false` leaves the work order
  un-closable.
- **The two collection reads REQUIRE the company/branch pair** and hand it to
  `scopeTargetOption`. `scope: 'branch'` is **inert without a target**, and RLS
  cannot compensate because `app.branch_ids` is the permission-**blind** union of
  every active grant (`P1-18-A-01`). This is `T-02`; S1 proves it with a principal
  granted in `BRANCH_A2` asking for `BRANCH_A1`.
- **Job `state` is an opaque code; QC `overallResult` is an enum.** `wo.job_states`
  is tenant-extensible, so an unknown job state is an **empty page**, never a 422.
  `qms.qc_status_history` CHECK-constrains the same three QC literals, so that one
  is closed and refuses an unknown value. The two look alike and are governed
  differently; getting either backwards is a defect, and both directions are
  tested.
- **`wo.job-detail` computes `nextStates` from the catalogue**, asserted against
  the catalogue endpoint's own graph rather than a constant.
- **`assignments` is OMITTED, not empty**, without `tech.technician.read` (`T-05`).
  An empty array asserts _this job has no assignments_ — a claim about the data.
  An absent key says _this response does not answer that_, which is the truth.
- **`pendingRequiredAdditionalWork`** is the `ERR-WO-002` predicate computed
  server-side, so a board disables start/resume with a reason instead of surfacing
  a 409 that was predictable all along.
- **`hasOpenLaborSession` is a warning, never a guarantee.** `tech.labor_sessions`
  has no one-open-session-per-job constraint (`INS-40`); two technicians genuinely
  can open a session on one job. The flag lets a board say so and prevents nothing.

## 4. What this slice deliberately does NOT ship

**No pause, resume, start or complete endpoint** — asserted by a test that reads
the route directory, because "add a pause endpoint" is the obvious move.

- It would have to stop the labour session **and** transition the job in one
  transaction across two aggregates with two permissions (`tech.labor.record`,
  `wo.job.transition`). Composing them server-side either **collapses two
  permissions into one** — a silent widening — or refuses when the caller holds
  one and not the other, which the two-call form already does more legibly.
- The ordering is asymmetric and not guessable: **start** transitions first (a
  session against a `planned` job is refused, `labor_allowed` false); **pause**
  stops the session first (transitioning to `paused` with a session open is
  refused, and blocker B2 would then bite with no obvious cause).
- `ERR-WO-002` refuses **resume** and not **pause**, so one pause/resume pair would
  have to explain an error that applies in one direction only.

What ships instead is the data that makes the composition unguessable-free: the
published job graph with `laborAllowed` per state, and
`pendingRequiredAdditionalWork` per row.

## 5. Owner decisions recorded, not invented

- **`BR-06-OPEN-01` — priority.** There is **no priority column anywhere** in the
  four schemas; `grep` finds `priority` once, on `dia.recommendations`, a different
  entity. Adding one raises questions only the Owner can settle (work order or
  job? ordered enum or integer? sort order or display only? tenant-configurable
  like the state catalogues?). **This slice does not create it.** The board sorts
  by `created_at`. A frontend "priority" that is really a client-side sort would be
  a second source of truth for a field the backend does not hold, and is forbidden.
- **`BR-06-OPEN-02` — labour totals.** Summing a page of
  `GET /jobs/{jobId}/labor-sessions` and calling it "total time" is the P1-28
  round-two defect. A backend total needs a definition (elapsed or billable?
  corrected sessions once or twice? open sessions included?) that only the Owner
  can give. Until then the frontend displays none. _A wrong number on a timesheet
  is worse than no number._
- **`INS-40`** — two open sessions on one job — remains an **unfixed platform
  property**, surfaced as a warning and not claimed as prevented.

## 6. Three defects this slice's own work exposed

1. **A defect in shared teardown, affecting every suite.**
   `deleteTenantCascade` did not know about `wo.job_work_logs`, and
   `fk_job_work_logs_job` is `ON DELETE RESTRICT` like every other child here — so
   the moment any test wrote a work log, teardown failed with a foreign-key
   violation and took the whole file down. Fixed by deleting the log before the
   job it describes.
2. **`set_config(..., true)` is TRANSACTION-local.** Issued outside a transaction,
   each statement is its own transaction and the GUC is discarded before the next
   one runs — so `app.branch_ids` would be NULL, the row invisible, and an
   `UPDATE` a zero-row no-op that **resolves**. "The write was refused" would have
   passed while nothing was attempted. **The reachability guard caught this**,
   which is precisely why it exists after BR-04.
3. **`wo.guard_job_transition` is authoritative, not advisory** — it refuses a move
   with no active edge even for a direct admin `UPDATE`, and the status-history
   emitter refuses an unattributed transition. The S6 fixture authors the **edge**
   as well as the state, which is what a tenant would have to do.

## 7. Evidence

| tier                                         | result                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| BR-06 suite                                  | **28 / 28**                                                                                                    |
| Backend tier                                 | measured at the candidate — see the run ledger                                                                 |
| `verify:contracts`                           | green — **331 operations / 267 paths**, agreeing across registry, OpenAPI, coverage checker and P1-24 register |
| Typecheck, format (root **and** `apps/api`)  | clean                                                                                                          |
| Zero unindexed FKs (`wo`/`tech`/`qms`/`dia`) | re-measured green                                                                                              |
| `app_runtime` grant on `wo.job_work_logs`    | `INSERT,SELECT` — measured                                                                                     |

`apps/web/src/lib/api/idempotent-operations.ts` is regenerated by its canonical
generator, **proved reproducible by hashing**, and carries exactly the six new
operations and the counts they move. No authored frontend work: no page, no
component, no style.
