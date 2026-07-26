# P1-19 — Final adversarial review

Reviewed diff: `git diff f326e24..3b39328` — 126 files, ~46,700 insertions, 58
operations. Five independent lenses (authorization, correctness, transactions, module
boundaries, evidence accuracy), then a **refute-first** verification pass in which each
finding got its own verifier instructed to default to REFUTED and to open every file the
claim depended on.

|           | Count  |
| --------- | ------ |
| Raised    | **24** |
| Refuted   | **15** |
| Confirmed | **9**  |
| Critical  | 0      |
| **High**  | **1**  |
| Medium    | 0      |
| Low       | 8      |

Five of the nine had their severity **lowered** during verification and one was partly
refuted — the documentation half stood, the security half did not. That the refute rate
is roughly 60% is the point of the pass: a confirmatory review of a diff this size
produces a long list of plausible observations, and plausible is not the same as true.

**Every confirmed finding is fixed in the tree.** None was accepted as an open item, and
none required a migration.

---

## H-01 (High) — `tech.labor-session-list` left P1-18-A-01 open on timesheet data

`GET /jobs/{jobId}/labor-sessions` declared `scope: 'branch'`
(`src/app/api/v1/jobs/[jobId]/labor-sessions/route.ts`) while its handler destructured
`{ db }` alone and `LaborSessionService.forJob` took no `ScopeAuthorizer` at all. The
path names no branch, so `handleOperation` had no target, `requiresScopedEvaluation`
returned false on the empty one, and the decision was made by scope-blind
`iam.has_permission('tech.technician.read')`. The only remaining narrowing was
`sel_labor_sessions_scope`, which matches `iam.allowed_branch_ids()` — the
permission-**blind** union of every grant the caller holds anywhere.

**Failure.** A principal holding `tech.technician.read` in branch A2, and RLS-visible in
A1 through an unrelated grant, reads A1's labour sessions: who worked, and for how long,
in a branch where it holds no technician-read permission. The phase's own
`PERMISSION_ELSEWHERE` fixture is exactly that principal.

**Why it survived nine waves.** The suite for the operation made every read as
fully-permitted `FULL`, and asserted that a cross-tenant caller got `200` with an empty
list — with a comment justifying it as "the job id is not resolved first here". The
comment was describing the defect as a decision. The coverage manifest claimed
`authorization … isolation` on the strength of two 403s that only proved the permission
code was required at all.

**Fix, in three parts.**

1. `forJob` resolves the job's company and branch through the `work-order` module's
   public `jobScope` — `technician` may not read `wo.jobs` (ADR-001 rule 3) — and
   re-checks **before any session row is read**. The route forwards `authorizeScope`.
2. The suite runs the standard four-way probe (unpermitted 403, permitted-elsewhere 403,
   no-grant-here 404, cross-tenant 404), and the old empty-`200` assertion is replaced.
3. **A structural guard.** `scripts/p1-19-endpoint-inventory.mjs` now fails the build
   when an operation declares `scope: 'branch'` and its handler neither forwards
   `authorizeScope`, nor passes an `authorizationTarget`, nor derives one with
   `scopeTargetOption`. `wo.work-order-list` and `tech.technician-available` pass on the
   third form; nothing else on the surface lacked all three.

**The guard needed fixing before it worked.** Its first version was satisfied by the
comment explaining the fix — prose containing the word `authorizeScope` made the check
pass while the handler did nothing. It strips comments now, which is the same ratchet the
operation-coverage gate uses and for the same reason. Mutation-tested: reverting the
route fix makes it fail naming exactly `tech.labor-session-list`.

---

## L-01 — `recordLine` branched on a parent state it read unlocked

`WorkOrderService.recordLine` resolved the work order through the non-locking
`requireWorkOrder`, then refused if the order was terminal. `wo.work_order_service_lines`
and `wo.required_parts` carry no trigger that reads the order, so a closure committing
between the check and the insert appended a line to a released order.

**Fix.** `lockWorkOrder`. The order — not the line — is the row locked, because it is the
same row the transition and closure paths take `FOR UPDATE`, so a line write and a
closure serialise instead of interleaving.

## L-02 — `lockDecidableRequest` locked the child and read the parent unlocked

Same shape on the approval path: the request row was locked, the parent order read
without a lock, and the terminal-parent refusal branched on that read.

**Fix, and the part that needed thought.** The parent is locked **first**, then the
request. Locking the request first and the order second would have inverted the module's
own lock order — every other path takes `wo.work_orders` before its children — and opened
a deadlock against a concurrent closure. So the request's `work_order_id` is read unlocked
to learn _which_ order to lock (safe: `tg_additional_work_requests_immutable` freezes that
column), the order is locked, and the request is then re-read under its own lock.

## L-03 — `closure-eligibility` reported `eligible: true` for a terminal order

`eligible` was `blockers.length === 0`, and a terminal order has no blockers because the
gate does not run on it. So a closed or cancelled order reported `eligible: true`, which
is what the word says and not what a client acts on.

**Fix.** `eligible: !alreadyTerminal && blockers.length === 0`. No information is lost —
the three states are now distinguishable without reading `state` against a catalog:
`{eligible: true, alreadyTerminal: false, blockers: []}`, `{eligible: false,
alreadyTerminal: false, blockers: [...]}`, `{eligible: false, alreadyTerminal: true,
blockers: []}`. The test that asserted the old value is corrected with its reasoning.

## L-04 — `POST /jobs/{jobId}/assignments` accepted a `reason` it discarded

The body schema is `.strict()` and declared `reason`; nothing read it. A caller sending
one got a 201 and had no way to learn the field was dropped.

**Fix.** The field is removed. `wo.job_assignments.reason` belongs to _ending_ an
assignment — `ck_job_assignments_end_reason` makes it mandatory once `valid_to` is
stamped — so a reason recorded at assignment time would occupy the column a later ending
is required to fill, making the ending's own reason ambiguous. Accepting a field and
ignoring it is worse than rejecting it: the rejection is information.

---

## Evidence findings — four claims in this phase's own documents were false

These are recorded in full because the phase's credibility rests on its evidence being
checkable, and four pieces of it were not.

## L-05 — "Every id-addressed command locks its authoritative row `FOR UPDATE`"

`qa-evidence.md` said this without distinguishing a command's **own** row from its
**parent's**. L-01 and L-02 above are the counterexamples. The claim is narrowed to what
is true and the two commands are fixed rather than excused.

## L-06 — The restricted-token leak test inspected no event payload

`security-review.md` and `devops-observability.md` both said the Wave 6 leak test asserts
the token is absent from "every audit detail, every event payload and every non-detail
response". It queried `iam.audit_record_details` **only**.

**Fix.** The test was extended, not the sentence narrowed. It now searches
`shared.event_outbox.payload::text`, the list response, and asserts the authorized detail
read _does_ contain the token — so the three negative assertions cannot pass against a
write that silently stored nothing. All four assertions pass.

## L-07 — `security-review.md` cited a comment that is not at the cited site

It said `rework-service.ts` "comments the omission explicitly at the publication site".
The comment naming that reasoning is at the **audit** site of `writeCost`, not at the
`publishEvent` call. The omission itself is real; the citation was wrong.

## L-08 — The per-file test table summed to 295, not the 303 delta it broke down

`p1-19-work-order-lines.test.ts` was listed as 10 tests. It is a `describe.each` over two
tuples, so its eight `it` blocks instantiate sixteen, plus two outside: **18**. Every
figure in that column is now the count Vitest reports per file, not a count of source
lines that look like tests.

---

## What was refuted, and why it matters that it was

Fifteen candidates fell. A representative sample, with the ground each fell on:

- **"Nothing in the build can detect the B2/B4 blocker reads"** — the reviewer checked
  the wrong guard; the reads are byte-faithful transcriptions of the frozen enforcing
  authority and the reconciliation test pins them.
- **"QC finalization never checks the parent work order's state"** — mechanically true,
  but the state it describes is one the design explicitly sanctions, and where B5 has
  teeth the scenario cannot produce the forbidden combination.
- **"Closure blocker B4 is clearable by editing the job"** — the edit crosses no
  authority boundary, is fully attributable, and the proposed remedy would make the
  system worse.
- **Three module-header prose inaccuracies** — real drift, unreachable failure, so
  documentation notes rather than defects.
- **Eleven unreferenced exports** — accurate inventory, no input produces a wrong output;
  both halves of the stated failure were hypothetical future edits.
- **Two COVERAGE-EVIDENCE manifests over-declaring flags on the new Wave 9 suites** —
  the over-declaration is real and the flags are backed elsewhere for the same
  operations, so no operation is credited on evidence that does not exist anywhere.

A review that confirmed all 24 would have produced a longer document and a worse one.

---

## Verification of the fixes

| Gate                                               | Result                            |
| -------------------------------------------------- | --------------------------------- |
| Unit                                               | **843** passed                    |
| Database                                           | **1610** passed                   |
| Backend                                            | **1074** passed                   |
| P1-19 operation depth                              | **58/58**, 0 pending              |
| `validate:p1-19-inventory`                         | OK, including the new scope guard |
| Module boundaries, authorization coverage, OpenAPI | OK                                |
| `typecheck`, `lint`, `format:check`                | green                             |

The backend total is **unchanged at 1074**, and that is worth stating rather than
glossing: every fix above landed as new _assertions_ inside existing tests, not as new
test cases. The four-way probe on `tech.labor-session-list`, the outbox and response
searches in the leak test, and the corrected eligibility expectation all strengthened
tests that already existed. A phase that reported a rising test count here would be
implying it had added coverage it did not add.

The scope guard was mutation-tested against the defect it exists to catch. The extended
leak assertions were run against a tree where the restricted description is genuinely
written, so they assert absence from a populated system rather than from an empty one.
