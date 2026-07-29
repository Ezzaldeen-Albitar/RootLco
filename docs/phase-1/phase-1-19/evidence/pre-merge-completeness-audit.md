# P1-19 — Pre-merge hostile completeness audit

**Subject.** `feature/p1-19-module-foundation`, proposed merge into protected `develop`.
**Diff audited.** `f326e24c0340e2ce97a94a768868a26d0cfbb04f..3383ead3d77fec8e38c889d18f72b26115bc5d09`
— 129 files, +47,646 / −1,935; 58 HTTP operations across
`src/modules/{work-order,technician,diagnostics,quality}`; routes under `src/app/api/v1`;
tests under `tests/{backend,db,foundation}/p1-19-*`.
**Posture.** Adversarial. No document's self-assessment was accepted. Every claim below was
re-derived by reading source, migrations, seeds, routes and tests at the audited SHA, not by
reading the evidence that describes them. 29 candidate findings were raised across six lenses;
7 survived verification, 22 were refuted, and the refutations are recorded in §5 so the record
shows the audit was adversarial rather than confirmatory.

---

## 1. Verdict

**This PR is NOT safe to merge into protected `develop` as it stands. Two blockers must clear
first. Neither requires a migration; together they are one service-level guard plus one
paragraph of documentation.**

- **Blocker 1 — code.** `wo.job-update` is the only child-write path in the phase with no
  terminality guard. A closed work order's job rows stay writable after the vehicle is
  released, including `requires_diagnostic`, the direct input to closure blocker **B4**.
  (§3.1, High.)
- **Blocker 2 — evidence.** `docs/phase-1/phase-1-19/evidence/change-log.md:96–99` asserts, and
  invites the reader to verify, that Wave 9 changed _no executable application code_. Wave 9
  changed five executable files (+117 / −13) and three existing test suites, and those changes
  are precisely the remediation of the phase's own only High plus a deadlock-sensitive lock
  reorder and a changed response contract. (§3.5, Medium, documentation-only fix.)

Everything else found is non-blocking: one Medium that must be either fixed or written into
`open-decisions.md` before the P1-19 gate is authored, and four Lows.

**Is the completeness claim 100/100 true? No.**

No document in `docs/phase-1/phase-1-19/evidence/` asserts a literal `100/100`; the claim as
reconstructed from the evidence set is that the declared surface is complete, reachable,
permissioned, audited, tested and clean-room reproved. On **surface count** that holds and was
independently re-derived here: 58 operations, 23 `GET` / 30 `POST` / 4 `PUT` / 1 `PATCH`, every
one routed under `src/app/api/v1`, every declared permission present in
`supabase/seeds/04_iam_permission_catalog.sql`, every `x-required-permissions` code in
`docs/api/openapi.v1.json` reconciled against the seeded catalog with an empty missing set, no
migration added, `wo`/`tech`/`dia`/`qms` schema untouched since Phase 1-12.

On **completeness as a property of the invariants the phase claims to enforce** it is false in
three checkable respects:

1. The terminality rule that the phase states, tests and fixed twice inside this very PR
   (`recordLine`, `setFulfillment`) is not applied to `wo.job-update` at all (§3.1), and is
   applied only at creation and never re-applied on the diagnostics entry surface (§3.2).
2. The change log — the phase's single authoritative summary of _what changed_ — denies the
   existence of the commit carrying the phase's only High remediation (§3.5).
3. Three evidence figures are internally self-contradictory: the Wave 3 clean-room permission
   count (§3.6) and the §5 read count in the security review (§3.7).

None of these is a reason to doubt the schema, the clean room, or the route inventory. All of
them are reasons the phase cannot be signed off as 100/100 in its current commit.

---

## 2. Findings at a glance

| #   | Finding                                                                                                                       | File:line                                                                    | Severity (corrected)     | Blocks merge                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------ | ------------------------------------ |
| 3.1 | `wo.job-update` has no terminality guard; a released order's jobs stay writable, including `requires_diagnostic` (B4's input) | `src/modules/work-order/application/work-order-service.ts:639–666`           | **High** (as raised)     | **Yes**                              |
| 3.2 | Diagnostic entries recordable, and a report completable, on an already-closed work order                                      | `src/modules/diagnostics/application/diagnostic-report-service.ts:1010–1024` | **Medium** (raised High) | No — fix or document as `P1-19-A-06` |
| 3.3 | Report creation refuses a terminal parent on unlocked reads, with no DB guard behind it (TOCTOU)                              | `src/modules/diagnostics/application/diagnostic-report-service.ts:217–253`   | **Low** (raised Medium)  | No                                   |
| 3.4 | Reassignment returns a fabricated `validTo` (and a stale `recordVersion`) instead of the stored row                           | `src/modules/work-order/application/job-assignment-service.ts:292`           | **Low** (as raised)      | No                                   |
| 3.5 | `change-log.md` denies the executable code change that fixes the phase's only High                                            | `docs/phase-1/phase-1-19/evidence/change-log.md:96–99`                       | **Medium** (raised High) | **Yes** (docs-only)                  |
| 3.6 | Wave 3 clean-room permission figures wrong (92/21 vs 93/22) and self-contradicting                                            | `docs/phase-1/phase-1-19/evidence/wave-3-module-foundation.md:171`           | **Low** (as raised)      | No                                   |
| 3.7 | Security review miscounts its own read surface (22 where the same section establishes 23)                                     | `docs/phase-1/phase-1-19/evidence/security-review.md:269`                    | **Low** (as raised)      | No                                   |

---

## 3. Confirmed findings

### 3.1 `wo.job-update` has no terminality guard — **High, merge-blocking**

**File:line.** `src/modules/work-order/application/work-order-service.ts:639–666`
(`updateJob`); reached by `PATCH /api/v1/jobs/{jobId}` at
`src/app/api/v1/jobs/[jobId]/route.ts:51–100`.

**Defect.** `updateJob` locks the job, re-authorizes scope against the locked row, compares
`record_version`, and writes. It never reads the job's own state and never touches the parent
work order — there is no `lockWorkOrder`, `findWorkOrder` or `catalog.workOrderStates` call
anywhere in the method. It is the **only** child-write path in the phase without such a check:

- `recordLine` — `work-order-service.ts:977–989` — locks the order and refuses a terminal state.
- `lockOpenWorkOrder` — `additional-work-service.ts:884–897` — refuses terminal / `!allowsAdditionalWork`.
- `lockDecidableRequest` — `additional-work-service.ts:991–999` — refuses a terminal parent.
- `lockAssignableJob` — `job-assignment-service.ts:374–395` — refuses a terminal job _and_ a terminal parent.
- `QualityControlService.open` — `quality-control-service.ts:87–103` — refuses a terminal order.

**The persistence and database layers do not compensate.**
`src/modules/work-order/data/work-order-repository.ts:875–885` locks on
`tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`; `:908–913` updates
`SET title, job_type, requires_diagnostic WHERE tenant_id AND id AND record_version AND deleted_at IS NULL`
— no state predicate in either. In
`supabase/migrations/20260722097000_wo_jobs.sql`: `tg_jobs_immutable` (`:186–188`) freezes only
`tenant_id`, `company_id`, `branch_id`, `work_order_id`, `created_at`, `created_by`;
`tg_jobs_transition` (`:184`) is `BEFORE UPDATE OF state`, so a descriptive-only update never
enters `wo.guard_job_transition`; `wo.guard_job_refs` (`:182`) is `BEFORE INSERT` only and is
the sole place the parent's terminality is ever checked; `upd_jobs_scope` (`:202–206`) carries
no state predicate. `grep -rln "ON wo\.jobs" supabase/migrations/` returns that one file, so no
later migration adds a guard.

**The closure gate cannot re-detect the divergence.**
`supabase/migrations/20260722105000_qms_rework_closure_gate.sql:365–367` returns early when
`NEW.state = OLD.state`, and `:371–372` returns early when the target is not terminal, so **B4**
(`:412–425`) is evaluated exactly once — at the transition into terminal — and never again.

**Concrete failure.** Work order `W` is closed (terminal, non-cancellation). Its job `J` carries
`requires_diagnostic = true` and a completed `dia.diagnostic_reports` row, which is how B4 was
satisfied and the closure granted. After release, a principal holding only `wo.job.manage`
(risk **`medium`**, `supabase/seeds/04_iam_permission_catalog.sql:173`, versus **`high`** for
`wo.work_order.close` at `:170`) in `J`'s own branch sends:

```
PATCH /api/v1/jobs/{J}
If-Match: "<J.record_version>"
{"title":"Oil change only","requiresDiagnostic":false}
```

`lockJob` returns the row (no state filter), `authorizeScope` passes (correct branch), the
version matches, the `UPDATE` affects one row (no state predicate), `tg_jobs_transition` does
not fire (state not in the `SET` list), `tg_jobs_immutable` permits all three columns. Result:
**HTTP 200**, and `J` now records that no diagnostic was ever required and that different work
was performed on an already-released vehicle. The reverse is equally reachable: setting
`requiresDiagnostic = true` on a closed order's job leaves a permanent record that a mandatory
diagnostic was required and never done, with no blocker able to fire. In both directions the
description of work performed on a released vehicle — the warranty and liability record — is
rewritten by a medium-risk permission, while ending that liability required the high-risk
`wo.work_order.close`.

**Why the phase's own material does not cover it.** This is the third instance of a defect class
the PR already found and fixed twice. `additional-work-service.ts:740–750` records verbatim
that "an earlier draft used the non-checking helper, leaving a closed order's record writable
after the vehicle was released", citing exactly the three reasons that apply here.
`work-order-service.ts:966–990` records the same for `recordLine`.
`final-adversarial-review.md:168–170` refuted only the narrower _pre-closure_ claim ("the edit
crosses no authority boundary"), which is silent on the post-closure case.
`endpoint-inventory.md:61`, `task-traceability.md:88`, `wave-4-work-order-core.md:17` and
`security-review.md:263` are inventory/idempotency rows with no terminality claim. No test
covers it: the `wo.job-update` block at `tests/backend/p1-19-work-order-jobs.test.ts:321–530`
exercises success, `jobType` set/clear, stale version, missing `If-Match`, blank title, bad
uuid, 401/403/404, cross-tenant and cross-branch — all against a freshly created **planned** job
under an **open** order. No terminal-parent or terminal-job case exists anywhere in `tests/`.

**Severity.** Held at **High**, not raised and not lowered. Mitigating: the change is fully
attributable — `work-order-service.ts:676–716` emits `wo.job.updated` with
`previousValue`/`value` for exactly the columns that moved — and the actor must already hold
`wo.job.manage` in the job's own branch, so there is no cross-tenant or cross-scope escalation.
A Medium adjudication on attributability grounds is defensible. It remains merge-blocking: the
mutable column is the direct input to a closure blocker on a vehicle whose liability was already
ended, no guard can re-fire after the fact, and the remedy is a handful of lines already written
elsewhere in the same file.

**Minimal fix — no migration.** Reuse the six lines that already exist at
`work-order-service.ts:985–989`, against a repository method that already exists
(`work-order-repository.ts:412`):

1. In `updateJob`, after `lockJob` and before the version compare, take
   `this.repository.lockWorkOrder(db, locked.workOrderId)`, read
   `catalog.workOrderStates`, and throw `ERR-TRN-001` when the parent state is terminal.
   Lock the parent **before** the job, matching the order established at
   `additional-work-service.ts:991–999`, so no new deadlock edge is introduced.
2. Optionally refuse a terminal **job** as well, matching `lockAssignableJob`.
3. Add one backend test: closed parent → `PATCH /jobs/{J}` → refused; and one for a terminal job.
4. Record the rule in the `updateJob` doc comment the way `recordLine` does.

Module-local. No schema change, no seed change, no OpenAPI change.

---

### 3.2 Diagnostic entries recordable, and a report completable, on a closed work order — **Medium (raised High)**

**File:line.** `src/modules/diagnostics/application/diagnostic-report-service.ts:1010–1024`
(`lockRecordableReport`), and `:426–451` (`move`, the single write path behind both `transition`
and `complete`).

**Defect.** `create()` refuses a terminal parent explicitly (`:228–237`, "Starting a diagnostic
on finished work would record an observation about a vehicle that has already left"), but the
rule is never applied again. `lockRecordableReport` locks the **report**, authorizes scope, and
calls `assertRecordable(report.status)` at `:1023`; it never reads `wo.work_orders` or
`wo.jobs`. It is the sole gate for all six entry paths — `recordItemResult` (`:570`),
`recordMeasurement` (`:654`), `recordDtc` (`:723`), `recordFinding` (`:764`), `recordEvidence`
(`:819`), `recordRecommendation` (`:889`). `RECORDABLE_REPORT_STATUSES` is
`['draft','in_progress']` (`src/modules/diagnostics/domain/diagnostics.ts:121–124`, assertion at
`:285–290`) — the report's own status only. `move()` checks `lockReport` visibility,
`recordVersion` and `assertReportTransition`, and reads no parent.

**Nothing else prevents it.** `supabase/migrations/20260722102000_dia_reports.sql:149–158`: the
only triggers on `dia.diagnostic_reports` are refs (`BEFORE INSERT`), transition
(`BEFORE UPDATE OF status`), immutable-columns and touch-metadata;
`guard_diagnostic_report_refs` (`:75–100`) reads `wo.jobs.work_order_id` for parentage only,
never a state; `guard_diagnostic_report_transition` (`:106–144`) checks the status graph and
unanswered mandatory items only. In
`supabase/migrations/20260722103000_dia_findings_measurements_evidence.sql` the **only** triggers
on `report_item_results`, `findings`, `measurements`, `dtc_records`, `recommendations` are
`touch_metadata` and `guard_immutable_columns` (`:66/68`, `:125/127`, `:184/186`, `:240/242`,
`:334/336`); no child table reads the parent work order, and every INSERT policy (`:77`, `:136`,
`:195`, `:251`, `:297`, `:345`) is tenant/company/branch scope only.
`diagnostics-repository.ts:316–338` filters on `tenant_id`, `id`, `deleted_at` only.
`wo.guard_job_transition` (`20260722097000_wo_jobs.sql:127–180`) never consults `dia.`, so a job
with an `in_progress` report may go terminal. B4
(`20260722105000_qms_rework_closure_gate.sql:412–423`) fires only for
`requires_diagnostic = true`, so a report on a `requires_diagnostic = false` job never blocks
closure.

Contrast `tech.guard_labor_session`
(`supabase/migrations/20260722099000_tech_labor_sessions.sql:122–132`), which locks the parent
work order and refuses labour on a terminal one: the platform enforces this invariant for
labour and not for diagnostics, and this phase does not add it.

**Concrete failure.** Job `J` on open work order `W`, `requires_diagnostic = false`.
`POST /jobs/J/inspections` succeeds. `PUT /inspections/R/transition` → `in_progress`. Drive `J`
terminal (B4 inapplicable, B1 satisfied) and close `W` (B1–B6 pass). **After release**,
`POST /api/v1/inspections/R/{findings,measurements,dtcs,evidence,recommendations}` and
`PUT /inspections/R/items/{itemId}` all reach `lockRecordableReport`, see `in_progress`, and
return 201; `POST /inspections/R/completion` then moves `R` to `completed` and publishes
`diagnostic-report.completed`; `/inspections/R/reviews` then accepts a review. All routes exist.
The end state is a signed, completed diagnostic report with findings and evidence, dated after
the vehicle left, attached to a closed work order whose record was supposed to be frozen.

**Severity corrected High → Medium.** No authorization boundary is crossed: the caller must
legitimately hold `dia.diagnostic.record` / `.complete` in the report's own company and branch,
and every write is audited (`dia.diagnostic.entry_recorded`, `dia.diagnostic.completed`), so
nothing is silent or untraceable. No cross-tenant read, no data loss, no financial effect. The
closure-gate outcome is unchanged (B4 was inapplicable), nothing reopens, and a post-closure
finding cannot be laundered into new work: `additional-work-service.ts:894` refuses a terminal
order and `findingOrigin` binds a finding to its own work order. Completing paperwork is
arguably legitimate; the real defect is narrower than raised — the **six entry paths recording
new observations about a released vehicle**. The module header (`:13–24`) claims to enumerate
"two rules the database does NOT enforce"; that enumeration is now demonstrably incomplete,
which makes this a documentation gap as well as a code gap.

**Merge posture.** Not strictly blocking. This project's demonstrated bar (P1-18 closed with
three Mediums open and transparent) treats an undocumented High as a blocker and a documented
Medium as acceptable debt. This is Medium and currently **undocumented** — `open-decisions.md`
lists only `A-01`…`A-05`, and `final-adversarial-review.md` L-01/L-02/L-03 concern work-order
lines and closure eligibility, not diagnostics. Merging it **silent** is the one outcome to
object to.

**Minimal fix — no migration.** Either (a) thread the parent state through
`lockRecordableReport` the way `recordLine` does: after locking the report, resolve
`workOrderModule().workOrders.jobScope` (or a locked accessor) under the lock and refuse a
terminal parent for the six entry paths; or (b) add `P1-19-A-06` to
`docs/phase-1/phase-1-19/evidence/open-decisions.md` stating the rule is enforced at creation
only, with the reachable sequence written out, and correct the module header at `:13–24`.
Option (a) is preferred and is application-only.

---

### 3.3 Report creation's terminal refusal is unenforced across the read-write window — **Low (raised Medium)**

**File:line.** `src/modules/diagnostics/application/diagnostic-report-service.ts:217`
(scope/state read), `:228` and `:233` (refusals), `:253` (insert).

**Defect.** `create()` resolves the job's scope and both states through
`workOrderModule().workOrders.jobScope`, which uses `findJob` /`findWorkOrder` — both **unlocked**
(`src/modules/work-order/application/work-order-service.ts:292–294`; `lockJob` /`lockWorkOrder`
exist at `work-order-repository.ts:865` and `:412` and are not used on this path). The only
insert-time trigger is `tg_diagnostic_reports_refs`
(`supabase/migrations/20260722102000_dia_reports.sql:149`) running
`dia.guard_diagnostic_report_refs` (`:75–99`), which checks job↔order coherence and
`template_versions.status = 'published'`, reads no `wo`/job state and takes no lock — as the
service header at `:224–227` itself states. Transactions are default `READ COMMITTED`
(`src/server/db/transaction.ts:127` issues `BEGIN READ WRITE` with no isolation clause), so the
window is real. `nextRevisionNumber`'s advisory lock
(`src/modules/diagnostics/data/diagnostics-repository.ts:365–372`) is keyed `tenant:job` for the
revision lineage and does not serialize against a work-order state change.
`fk_diagnostic_reports_work_order` gives no protection: the FK check takes `FOR KEY SHARE`,
blocks behind the closer's `FOR UPDATE`, then succeeds because the parent row still exists — a
state change is not a key change.

**Concrete failure (one competing request).** `wo.guard_work_order_closure` returns early for
`is_cancellation` (`20260722105000_qms_rework_closure_gate.sql:375–377`), so a cancellation needs
no terminal jobs and travels the transition command (`work-order-service.ts:1218`).
T1 `POST /api/v1/jobs/{jobId}/inspections` reads the job and parent as non-terminal;
T2 `POST /api/v1/work-orders/{id}/transition` to a cancellation state commits; T1's insert
satisfies the guard and returns **201**, leaving a `draft` diagnostic report on a cancelled work
order — exactly what `:228` exists to prevent. The non-cancellation `close` variant additionally
needs a job completion inside T1's window, so it is tighter but not impossible.

**Severity corrected Medium → Low.** The stronger impact originally claimed (entries afterwards,
completion, `diagnostic-report.completed` on a closed order) is **not produced by the race** —
it is already reachable with zero concurrency via §3.2, so the race's marginal consequence is
only that the creation-time refusal can be dodged. No privilege escalation, no cross-tenant
disclosure, no financial effect, no database invariant broken, and B4 is not falsified by an
extra draft. §3.2 is the sharper statement of the same region; this is its weaker instance.

**Minimal fix — no migration.** Re-check the parent state under a lock after the insert, or
expose a locked job/work-order accessor on the work-order module's public surface (ADR-001
rule 3 forces the cross-module hop, not an unlocked one). Alternatively fold into the
`P1-19-A-06` entry from §3.2.

---

### 3.4 Reassignment returns a fabricated `validTo` and a stale `recordVersion` — **Low**

**File:line.** `src/modules/work-order/application/job-assignment-service.ts:292`.

**Defect.** `reassign` builds the `ended` view as
`toView({ ...current, validTo: new Date(), reason: input.reason })` — the pre-close locked row
plus the **Node process clock**, with no read-back. `work-order-repository.ts:1593` stamps
`SET valid_to = now()` and `closeAssignment` returns only a boolean, so the stored value never
reaches the service. The sibling `end()` at `:248–251` re-reads via `lockAssignment` precisely
for this reason and says so ("`valid_to` was stamped by the database, so the only honest source
for it is the row"), so `reassign` contradicts a standard stated two methods earlier in the same
file.

The whole operation runs in one explicit transaction
(`src/server/http/route-handler.ts:319` → `src/server/db/transaction.ts:127`), so PostgreSQL
`now()` is transaction-start time; the returned value is therefore always strictly later than
the stored one by the elapsed time of `lockJob` + two catalog reads + `findWorkOrder` +
`lockActivePrimaryAssignment` + the `UPDATE` + the audit `INSERT`, plus any app↔DB clock skew.

**Concrete failure.** `POST /api/v1/jobs/{jobId}/reassignments` on a job with an incumbent active
primary. The route (`src/app/api/v1/jobs/[jobId]/reassignments/route.ts:99`) returns `moved`
verbatim, so `ended.validTo` reaches the client, while
`GET /api/v1/jobs/{jobId}/assignments` maps the stored row and reports a different instant for
the same event. Worse: `wo.job_assignments.valid_from` is `DEFAULT now()`
(`supabase/migrations/20260722098000_wo_job_assignments.sql:34`) and `openAssignment` supplies
none, so in the database the outgoing `valid_to` and the incoming `valid_from` are the **same**
instant; the response instead depicts `ended.validTo` after `opened.validFrom`, an overlap of
two primary intervals the stored data never contains. With skew in the other direction the
fabricated `validTo` can precede the row's own `valid_from`, an interval
`ck_job_assignments_window` (`:54`) forbids.

Second wrong field in the same reconstruction: `shared.touch_row_metadata`
(`0002_base_schemas.sql:196`, attached at `20260722098000_wo_job_assignments.sql:75`) advances
`record_version` on `UPDATE`, so `ended.recordVersion` is stale by one; a client feeding it back
as `If-Match` receives `ERR-CON-001` "modified by another request" rather than the truthful
`ERR-TRN-001` "already ended" (service `:225–234` checks version before ended-state).

**Not pinned by any test.** `tests/backend/p1-19-job-assignments.test.ts:697` asserts only
`body.ended?.id`; the `end()` test at `:588` asserts only `not.toBeNull()`.

**Severity Low, as raised.** The persisted data is correct; there is no state corruption and no
authorization, tenancy or financial impact. Blast radius is one field of one command's response.

**Minimal fix — no migration.** Call `this.repository.lockAssignment(db, current.id)` after
`closeAssignment` and build `ended` from the re-read row, exactly as `end()` already does; add
one assertion on `ended.validTo` / `ended.recordVersion`.

---

### 3.5 `change-log.md` denies the executable code change that fixes the phase's only High — **Medium (raised High), merge-blocking**

**File:line.** `docs/phase-1/phase-1-19/evidence/change-log.md:96–99`, as committed at
`3383ead`.

**The false text.**

> Wave 9 changed **no executable application code**. That is deliberate and checkable:
> `git diff f326e24..HEAD -- src/app src/modules` is unchanged by this wave's commits. Its
> only additions to `tests/` are the two new suites above and one corrected comment in
> `p1-19-diagnostics.test.ts`.

Both sentences are false, verified at the audited SHA. Wave 9 opens at `7b7ffa4` ("record the
Wave 8 result and open Wave 9").

```
$ git diff --stat 7b7ffa4 3383ead -- src/app src/modules
 src/app/api/v1/jobs/[jobId]/assignments/route.ts             | 17 ++++++++--
 src/app/api/v1/jobs/[jobId]/labor-sessions/route.ts          | 20 +++++++++---
 src/modules/technician/application/labor-session-service.ts  | 31 +++++++++++++++++-
 src/modules/work-order/application/additional-work-service.ts| 25 +++++++++++++--
 src/modules/work-order/application/work-order-service.ts     | 37 ++++++++++++++++++++--
 5 files changed, 117 insertions(+), 13 deletions(-)

$ git diff --stat 7b7ffa4 3383ead -- tests
 6 files changed, 1049 insertions(+), 10 deletions(-)
```

All five executable files come from Wave 9 commit `918347a`; the test count is 6, not 3 — besides
the two new suites and the `p1-19-diagnostics` comment, `918347a` also changed
`p1-19-additional-work.test.ts` (+27), `p1-19-labor-sessions.test.ts` (+26) and
`p1-19-work-order-core.test.ts` (+7).

**What the sentence conceals is substantive, not cosmetic** (read from `git show 918347a`):

- `LaborSessionService.forJob` now takes a `ScopeAuthorizer` and resolves the job's
  company/branch through `workOrderModule().workOrders.jobScope` before any session row is read
  — the phase's **only High**, H-01 (`final-adversarial-review.md:29–69`).
- `AdditionalWorkService.lockDecidableRequest` is restructured to lock the **parent** first and
  the request second — a deliberate lock-order decision against concurrent closure.
- `WorkOrderService.recordLine` replaces non-locking `requireWorkOrder` with `lockWorkOrder`.
- `closureEligibility` **changes its response contract**:
  `eligible: !alreadyTerminal && blockers.length === 0`, so `eligible` now reports `false` for a
  terminal order — any existing client branching on `eligible` reads it differently.

The sentence was written at `cbe0177`, before `918347a`, and never updated. A correction exists
in the working tree but is **uncommitted** and therefore not in the diff under audit; that draft
itself concedes "Those are Wave 9 commits and pretending otherwise would make the diff
contradict this document" — and, note, says "four executable files" while listing five, which
must also be fixed before it is committed.

**Severity corrected High → Medium.** The engineering evidence for these fixes is **not**
missing: `final-adversarial-review.md` (H-01, L-01, L-02, L-03, with file names, failure modes
and a mutation-tested guard), `pull-request-body.md:111–131`, `security-review.md` and
`qa-evidence.md` all document the same fixes, all landed in the same commit `918347a`, and the
commit message is exhaustive. An owner merging via the PR body is correctly informed, so the
"reviewer skips re-reviewing the authorization fix and the lock reorder" outcome requires the
reader to consult `change-log.md` and ignore four sibling documents in the same directory. What
remains is a verifiable self-contradiction inside the evidence set — aggravated by the Wave 9
table at `change-log.md:75–89`, which also omits `final-adversarial-review.md` and
`pull-request-body.md`, so a reader confined to that section has no pointer to the remediation
at all, and by the sentence's own invitation to trust it as "checkable" instead of checking.

**Why it still blocks.** There is no code defect here — the code at `3383ead` is the fixed code.
But merging bakes into protected `develop` a false, self-refuting claim in the document the
eventual gate record will cite as the authoritative summary of what P1-19 changed, covering
precisely the commit that carries the phase's only High and a deadlock-sensitive lock reorder.
The fix is one paragraph, is already drafted, and costs nothing to commit first. This project's
own practice (P1-18 PRs #80/#81) is to correct evidence falsehoods **before** merge, not after.

**Minimal fix — documentation only.** Commit the corrected paragraph (with "five", not "four"),
list the five executable files and the three amended suites, name the four behavioural changes
including the `closureEligibility` contract change, and add `final-adversarial-review.md` and
`pull-request-body.md` to the Wave 9 artefact table.

---

### 3.6 Wave 3 clean-room permission figures are wrong and self-contradicting — **Low**

**File:line.** `docs/phase-1/phase-1-19/evidence/wave-3-module-foundation.md:171` —
``| `iam.permissions` | **92** (21 in `wo`/`tech`/`dia`/`qms`) |``.

**Defect.** Both figures are false for the SHA the same section names at `:158` ("Built from
`81c9d5c` only"). `supabase/seeds/04_iam_permission_catalog.sql` seeds **22** codes across those
domains (`wo` 9 at `:161–181`, `tech` 4 at `:184–193`, `dia` 4 at `:196–201`, `qms` 5 at
`:210–217`), and `git show 81c9d5c` states in its own body "Split into `.record` and `.finalize`
(22 codes, catalog 93)". `git log f326e24..3383ead` on that seed shows only `e8d6235` and
`81c9d5c`, both Wave 3 — so 22/93 was already Wave 3's end state. The stale figure traces to
`662b2f3` ("move the permission-catalog total pin from 71 to 92", body: "seeds 21 codes"), which
`81c9d5c` superseded without updating this table.

The document contradicts itself eight lines later at `:179` ("grew from 71 to 93") and at `:114`
("twenty-two codes, 71 to 93"), and contradicts `clean-room-validation.md:74,77`,
`change-log.md:13–17`, `security-review.md:11–12` and `pull-request-body.md:19–20`, all of which
say 22/93. The live assertion
`tests/db/p1-15-shared-services-runtime-capabilities.test.ts:374` pins "the catalog totals 93";
no `92` pin exists anywhere, and `92` occurs exactly once in the whole phase-1-19 doc tree — this
line.

**Concrete consequence.** A table presented as a _measurement_ asserts a permission count one
lower than the tree it names, which reads as a permission code seeded **after** clean-room
validation, on the one seed change this phase makes. That is an audit question that does not
need to exist.

**Severity Low, not blocking.** The authoritative clean-room reproof at the final SHA, the DB
census pin and the shipped seed are all correct; no code, gate, test or schema depends on the
wrong number.

**Minimal fix.** One table cell: `**93** (22 in wo/tech/dia/qms)`.

---

### 3.7 Security review miscounts its own read surface — **Low**

**File:line.** `docs/phase-1/phase-1-19/evidence/security-review.md:269` (committed at
`3383ead`) — "The remaining 22 are reads." _(In the current working tree the same sentence has
drifted to line 277; see §4.)_

**Defect.** The arithmetic in the same section forbids 22. Re-derived independently from the
generator-produced table in `endpoint-inventory.md` (58 P1-19 rows, read out of the
`defineOperation` literals): **GET 23, POST 30, PUT 4, PATCH 1 = 58**; no `DELETE`/`HEAD`, so
commands = 35 and reads = **23**. Idempotency column: `yes` 31, `no` 27 = 58; the 27 non-idempotent
rows are exactly the 23 GETs plus the four commands named at `:271–272`
(`tech.labor-session-correct`, `tech.labor-session-stop`, `wo.job-assignment-end`,
`wo.job-update`); no GET declares `idempotent: true`. Audit-action column: 37 filled, 21 dashes,
all 21 dashes GET — corroborating `errors-and-events.md:107` ("21 reads declare none") plus the
two audited reads named at `:115–116` = 23. The document also contradicts itself at `:257–258`
("All 30 `POST`, 4 `PUT` and 1 `PATCH` are standard-command; **22 of the 23 GET** are
expensive-read"), where `22` is correct in its own rate-limit context (`wo.work-order-detail` is
the exception, accepted as `P1-19-A-04`) and appears to have been carried over by accident.

**Concrete consequence.** The sentence closes §5's idempotency reconciliation over all 58
operations, so a reviewer computes 31 + 4 + 22 = 57 and hunts for a 58th operation that does not
exist.

**Severity Low, not blocking.** No executable behaviour, test, gate condition, rate-limit tier,
audit-action set, permission or security control is misdescribed.

**Minimal fix.** One character: `22` → `23`.

---

## 4. Working-tree drift (procedural note, not a finding)

At the time of audit the working tree is **not** the audited SHA. Uncommitted modifications
exist in five evidence documents — `change-log.md` (+26/−4), `devops-observability.md` (+4),
`errors-and-events.md` (+2), `qa-evidence.md` (+8), `security-review.md` (+8) — and
`docs/phase-1/phase-1-19/evidence/task-register.md` is **untracked**. Consequences for this
record:

- The §3.5 correction exists only in the working tree, so the falsehood is what would merge.
- `security-review.md` line numbers differ between the committed file (§3.7 sentence at `:269`)
  and the working tree (`:277`); the sentence is still uncorrected in both.
- `wave-3-module-foundation.md:171` still reads `92` in both.
- `task-register.md` being untracked means any gate condition that cites it cannot be evidenced
  from the merged tree. Commit it or stop citing it.

Nothing here needs a migration. All of it needs one commit before the merge.

---

## 5. Refuted candidates (22)

Recorded so the record shows what was attacked and failed, not only what stuck.

| Candidate                                                                                                                  | Raised | Ground for refutation                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QC finalization not gated on the order's terminal state, so B5 is defeatable                                               | High   | Mechanics accurate (`quality-control-service.ts:224–248` locks only the QC row via `quality-repository.ts:296–321`), but no wrong outcome: the end state is reachable with zero concurrency, B5's requirement is existence of a finalized record, and nothing reopens. |
| QC finalization after closure defeats B5 permanently                                                                       | High   | Duplicate of the above at a different framing; same refutation — the mechanics hold, the asserted consequence does not, and it is the consequence that made it High.                                                                                                   |
| QC `open` branches on an unlocked work-order row (the `recordLine` defect)                                                 | Medium | Mechanism described correctly (`quality-control-service.ts:93` → unlocked `requireWorkOrder`), but the end state it reaches is already legally reachable with no concurrency at all, so the race adds nothing.                                                         |
| Wave 8 "immutable history" has no read path, no repository read, no test, `reason` always NULL                             | Medium | The stated failure mode is factually wrong: a QC record can only ever have one `qms.qc_status_history` row, and the correlation the finding says is unreachable is available from the audit ledger. Remainder has no consequence.                                      |
| Eleven of thirteen SEC/QA/DO/DOC task ids appear nowhere in the repo                                                       | Medium | Premise fabricated: nothing in the repository _declares_ those eleven ids (the grep yields exactly 22 — `P1-19-BE-001…020`, `P1-19-QA-001`, `P1-19-DOC-001`), so there is no gap, and the asserted failure cannot occur at this merge.                                 |
| Wave 5 (16 operations) has no wave evidence document and no wave-level review                                              | Low    | Raw facts hold, consequences do not: `change-log.md:51` states exactly which waves were reviewed adversarially and does not claim Wave 5 among them; Wave 5's operations are covered by the final adversarial review and the per-operation suites.                     |
| OpenAPI declares no path/query parameters and no request bodies, so 56 of 58 operations cannot be called from the contract | Medium | Every measurement reproduces (`src/server/openapi/document.ts:205–233` emits header refs only), but it is pre-existing platform behaviour unchanged by this diff, not a P1-19 defect.                                                                                  |
| `wo.work_order.create` is seeded but declared by zero operations                                                           | Low    | Facts hold (seed at `04_iam_permission_catalog.sql:164`), consequences do not: P1-18 reception conversion is the authoritative creation path, the grant is meaningful there, and the invoked `wo.work_order.close` precedent is a misreading.                          |
| Same, restated as "seeded high-risk, reconciled one direction only"                                                        | Low    | Same refutation; the asserted norm, the asserted invisibility and the asserted failure mode all collapse on reading.                                                                                                                                                   |
| "Declares a permission that exists in the seeded catalog" only validates the domain prefix                                 | Low    | No live violation: all 63 distinct `x-required-permissions` codes in `docs/api/openapi.v1.json` reconcile against all 93 seeded rows with an empty missing set, across every domain; and an existing mandatory gate already blocks the case described.                 |
| Rework sign-off and restricted rework cost writable after the rework order closes                                          | Medium | Code reading accurate, but no wrong outcome, and the constraint the finding proposes would break the feature.                                                                                                                                                          |
| `final-adversarial-review` refutes a real finding on a basis the named test does not provide                               | Medium | Misreads the candidate that was refuted; the review's first stated ground ("the reviewer checked the wrong guard") is verified present in `tests/foundation/`.                                                                                                         |
| The new P1-19 CI gate fails open on the artifact it protects; devops-observability claims two controls it lacks            | Medium | The fail-open (`scripts/p1-19-endpoint-inventory.mjs:427–435`) is unreachable in the pipeline it claims to compromise: the immediately preceding CI step regenerates the artifact the finding corrupts.                                                                |
| Two Wave 9 suites carry COVERAGE-EVIDENCE manifests no assertion backs and no gate reads                                   | Low    | Mechanical facts hold (neither suite is named in `scripts/check-operation-test-coverage.mjs`), but the failure mode is impossible — the gate's credit comes from the named suites, which do assert.                                                                    |
| qa-evidence's "every If-Match command asserts ERR-CON-001" is falsified by `wo.work-order-closure`                         | Low    | Closure is not a separate write path — `work-order-service.ts:1195–1202` delegates to `move()`, one source location for the concurrency predicate, and the assertion exists on that identical path.                                                                    |
| A configured mandatory QC check is enforced by no layer                                                                    | Medium | Central assertion false: `is_mandatory` is the sole trigger of B5b (`20260722105000_qms_rework_closure_gate.sql:438…`), and the behaviour called a hole is the specified semantics of the frozen schema.                                                               |
| The journey's diagnostic-evidence precondition is fabricated by admin SQL although a usable route chain exists             | Medium | The one accurate sub-claim (no storage-existence check in `attachment-service.ts:236–383`) yields neither asserted failure mode; the posited `storage_key`-dependent rule does not exist.                                                                              |
| The journey's enumeration of admin-SQL exceptions is inaccurate ("the two places" is at least four)                        | Low    | Header prose does undercount (`tests/backend/p1-19-helpers.ts:1319–1397`), but a test fixture's narrative undercount produces no defect in shipped behaviour and no gate depends on the count.                                                                         |
| "Technician eligibility" is not exercised as a step — no `tech.technician-available` call, no skill requirement supplied   | Low    | Observations accurate but describe no defect: the coverage is present elsewhere for the same operation, an explicit refutation criterion.                                                                                                                              |
| Five journey steps asserted by HTTP status alone with no read-back                                                         | Low    | The read-back exists for all five operations in the dedicated per-operation suites exercising the same handlers (e.g. `tests/backend/p1-19-diagnostics.test.ts:845–850` counts the `dia.dtc_records` row after an idempotent replay).                                  |
| Additional-work request decisions writable after closure                                                                   | Medium | Refuted at source: `additional-work-service.ts:991–999` (`lockDecidableRequest`) refuses a terminal parent under the parent lock.                                                                                                                                      |
| Labour sessions startable on a closed work order                                                                           | Medium | Refuted at source: `tech.guard_labor_session` (`20260722099000_tech_labor_sessions.sql:122–132`) locks the parent work order and refuses labour on a terminal one.                                                                                                     |

**Hard constraints honoured.** No finding proposes a migration, index, FK, unique constraint or
column. None re-reports `P1-19-A-01`…`A-05`. None treats `openRework`'s authorised
`wo.work_orders` insert as a duplicate creation path, or the tenant-overridable transition
catalog tables as a mirroring gap. None requires a caller that bypasses the HTTP surface. None
misreads `permissions: [...]` as a disjunction, and none rests on a decimal crossing the
boundary as a number.

---

## 6. Conditions to clear before merge

1. **Fix §3.1** — add the terminal-parent (and preferably terminal-job) refusal to
   `updateJob`, parent-locked-first, plus two backend tests. Service-level only.
2. **Fix §3.5** — commit the corrected `change-log.md` Wave 9 paragraph (five files, not four;
   three amended suites; the four behavioural changes including the `closureEligibility`
   contract change) and add the two missing artefacts to the Wave 9 table.
3. **Before the P1-19 gate is written** — either fix §3.2 in the service or register it as
   `P1-19-A-06` in `open-decisions.md` and correct the `diagnostic-report-service` header's
   claim to enumerate the rules the database does not enforce. Fold §3.3 into the same entry.
4. **Housekeeping, same commit** — §3.6 (one cell), §3.7 (one character), §3.4 (read back the
   closed assignment), and commit or stop citing `task-register.md`.

With items 1 and 2 committed, this audit has no remaining objection to merging into protected
`develop`. Until then the answer is no, and the completeness claim cannot be stated as
100/100.
