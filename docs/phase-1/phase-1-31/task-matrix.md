# P1-31 — task matrix

**Status:** OPEN · **Authority:** the canonical chapter's five task tables, reproduced in
[`canonical-plan.md`](./canonical-plan.md) · **Measured at:** protected `develop` `f8958e77cd607b8d9a2ebd62eab08176d4c91cf0`
(PR #360 merge), brought into this branch 2026-09-10 · **Companion records:** [`a0-preflight.md`](./a0-preflight.md)
(readiness), [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) (dispositions),
[`d4-report-definitions.md`](./d4-report-definitions.md) (the reporting mapping)

This record answers one question the readiness artefact deliberately does not: **where does each of
the twenty-nine canonical tasks actually stand today, and what is the artefact that proves it?**
The A0 preflight measured what stood between each task and execution. Several of those obstacles
have since been removed, and removing an obstacle is not the same event as finishing a task.

## Two rules govern every row below

1. **A prerequisite closes no canonical task.** P-1 … P-16 are execution prerequisites and change
   requests against owning backend phases under Field 13. Fifteen of them have merged. Not one canonical
   task moved to `Done` because of it, and the chapter's own `Status` column still reads `Planned`
   for all twenty-nine — this record changes no chapter status and claims no authority to.
2. **No task reaches `end-to-end verified` until a P1-31 acceptance record exists.** None does.
   Every previous Frontend phase closed on an explicit Owner Pass recorded in this repository
   (P1-26, P1-28, P1-30), and until such a record exists for this phase the rightmost state in the
   vocabulary below is unreachable by construction. It is listed so that its emptiness is visible,
   not so that a row can be moved into it.

## State vocabulary

| state                          | means                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **not started**                | no branch, no screen, no operation. The obstacle may or may not still stand; the work has not begun                               |
| **implemented/unmerged**       | code is prepared in its assigned checkout but is not merged; this does not imply end-to-end verification                          |
| **prerequisite landed**        | something the task needs has merged, and the task itself has not begun. This is the state most rows moved into during Wave P      |
| **in open PR**                 | work exists on a branch with an open pull request and is **not** on `develop`. A claim about an open PR is a claim about a branch |
| **merged (read-only/partial)** | on `develop`, and it renders or reads only part of what the task names                                                            |
| **merged (write path)**        | on `develop`, including the commands the task implies                                                                             |
| **phase-level incomplete**     | verified slices exist, but the cross-cutting phase coverage or acceptance record is incomplete                                    |
| **end-to-end verified**        | proven against a running environment and recorded in a phase acceptance record — see rule 2                                       |

## Field 14 — Frontend (16 tasks)

| Task ID      | Task name               | State                      | Proving artefact                                                                                                                      | Next dependency                                                                                                             |
| ------------ | ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| P1-31-FE-001 | Ready-for-delivery list | implemented/unmerged       | local commit `2eceab543a9ee5cbcdef021f7a6c848d052e43b6`; focused 100/3 and affected 50-test rerun plus static checks pass; not merged | authoritative delivery-readiness seam; no end-to-end verification                                                           |
| P1-31-FE-002 | delivery eligibility    | merged (read-only/partial) | #357 (merged) — the eligibility panel of the delivery detail screen, read-only                                                        | an entry point from FE-001; the delivery write paths are in open PR #362                                                    |
| P1-31-FE-003 | authorized receiver     | merged (read-only/partial) | #357 (merged) — the receiver read rendered as a row rather than a blocker; the read landed in P-4 (#348)                              | the verify command still has no screen on `develop`; its write path is in open PR #362                                      |
| P1-31-FE-004 | delivery checklist      | prerequisite landed        | P-9 (#355) publishes eight template operations; #357 (merged) renders checklist results, read-only                                    | a template authoring screen — nothing on `develop` consumes the eight write operations; result recording is in open PR #362 |
| P1-31-FE-005 | final odometer          | prerequisite landed        | none — the write is a field of `sal.delivery-complete`, the read-back is `veh.vehicle-odometer-history`                               | a completion surface, in open PR #362. The route accepts two decimals where the column holds one, recorded in the preflight |
| P1-31-FE-006 | delivery signatures     | merged (read-only/partial) | #357 (merged) — signatures **read**; the read landed in P-4 (#348)                                                                    | a capture surface. Acceptance is image-only; no capture control exists on `develop`, and the attach path is in open PR #362 |
| P1-31-FE-007 | delivery document       | not started                | none                                                                                                                                  | **D-7** — client-composed print view or stored document version. The composition changes with the answer                    |
| P1-31-FE-008 | warranty record         | prerequisite landed        | P-10 (#356) — seven policy and coverage operations, on `/warranty-policies/{policyId}/coverage-windows`                               | a policy administration screen and an issue surface; no screen consumes any of the seven                                    |
| P1-31-FE-009 | warranty history        | prerequisite landed        | P-6 (#349) — the warranty read seam                                                                                                   | a screen. The status-history table still has no reader anywhere (**CC-10**, unchanged)                                      |
| P1-31-FE-010 | operational dashboard   | not started                | none                                                                                                                                  | the report engine (P-11, engine half) **and** an approved metric definition — D-4 covers four reports, not a dashboard      |
| P1-31-FE-011 | work-order reports      | not started                | [`d4-report-definitions.md`](./d4-report-definitions.md) — the mapping only, no code                                                  | the report engine (P-11) and the named work-order status-summary read                                                       |
| P1-31-FE-012 | technician reports      | not started                | [`d4-report-definitions.md`](./d4-report-definitions.md) — the mapping only, no code                                                  | the report engine (P-11) and a labour-totals port that computes duration server-side                                        |
| P1-31-FE-013 | inventory reports       | not started                | [`d4-report-definitions.md`](./d4-report-definitions.md) — the mapping only, no code                                                  | the report engine (P-11), the enriched movement rows and the grouped summary read                                           |
| P1-31-FE-014 | invoice/payment reports | not started                | [`d4-report-definitions.md`](./d4-report-definitions.md) — the mapping only, no code                                                  | the report engine (P-11) and a read that carries the restricted amount fields under both permission codes                   |
| P1-31-FE-015 | audit report            | merged (read-only/partial) | #360 (merged) — text criteria and authorized paired company/branch selectors; no export                                               | D-11 default window remains open; no company-only filter                                                                    |
| P1-31-FE-016 | branch pilot summary    | not started                | D-5 approved in owner-decisions-2026-09-09.md §4                                                                                      | branch-filtered view of the same D-4 report sections; report engine and frontend implementation                             |

## Field 15 — Security (4 tasks)

| Task ID       | Task name                                        | State       | Proving artefact | Next dependency                                                                                                        |
| ------------- | ------------------------------------------------ | ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P1-31-SEC-001 | Permission and resolved-scope enforcement        | not started | none             | a screen surface to review. The scope-refusal rule it would assert is already enforced by the shared query builder     |
| P1-31-SEC-002 | Sensitive-data, export, and file-access controls | not started | none             | FE-007's answer (D-7) and P-12; the phase's export posture is undecided while `rpt.export` stays withheld (CC-04)      |
| P1-31-SEC-003 | Abuse-case and privilege-escalation controls     | not started | none             | the delivery and warranty write paths reaching a screen                                                                |
| P1-31-SEC-004 | Security audit-event coverage                    | not started | none             | the phase's own operations. Every operation merged in Wave P declares an audit action; none has been reviewed as a set |

## Field 16 — QA (5 tasks)

| Task ID      | Task name                                | State                  | Proving artefact                                                                                       | Next dependency                                                                                                  |
| ------------ | ---------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| P1-31-QA-001 | Unit and component test coverage         | phase-level incomplete | #360 audit component/adapter tests and preserved full web record; merged slices carry their own suites | complete coverage across the phase screens and a phase-level coverage record; no end-to-end claim                |
| P1-31-QA-002 | API/contract and error-path coverage     | not started            | none                                                                                                   | the same, plus the contracts P-11 and P-12 have not published                                                    |
| P1-31-QA-003 | Tenant/company/branch isolation coverage | not started            | none                                                                                                   | a phase-level isolation suite. The merged backend slices each prove isolation for their own operations           |
| P1-31-QA-004 | Concurrency and idempotency coverage     | not started            | none                                                                                                   | the write paths reaching screens; **CC-17** already records one write that is version-guarded and not replayable |
| P1-31-QA-005 | Regression and evidence packaging        | not started            | none                                                                                                   | every row above. This is the task that produces the acceptance record rule 2 names                               |

## Field 17 — DevOps (2 tasks)

| Task ID      | Task name                                         | State                      | Proving artefact                                                                                                          | Next dependency                                                                                            |
| ------------ | ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P1-31-DO-001 | Continuous-integration quality gate               | merged (read-only/partial) | #357 (merged) — the P-16 gate-before-read extension and its `validate:p1-31-access` command, which `verify:policies` runs | the phase’s remaining screens: the gate judges an explicit allow-list, so each new one must be added to it |
| P1-31-DO-002 | Structured logging, monitoring, and alert routing | not started                | none                                                                                                                      | a decision about what this phase adds over the platform's existing logging                                 |

## Field 18 — Documentation (2 tasks)

| Task ID       | Task name                                           | State       | Proving artefact | Next dependency                                                                                         |
| ------------- | --------------------------------------------------- | ----------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| P1-31-DOC-001 | Contract, catalog, and traceability synchronization | not started | none             | the phase's operation set settling. The generated registers already moved with each merged slice        |
| P1-31-DOC-002 | Operator/developer guidance and change-log update   | not started | none             | **CC-16** names an operator act after merge that no runbook yet carries; that is this task's first item |

## The prerequisite lane

Two prerequisites were added after the A0 preflight was written and carry a `b` suffix so that no
number is reused: **P-2b** (a delivery-record list, distinct from P-2's by-work-order lookup) and
**P-9b** (a migration the checklist-template seam needs). Neither is a canonical task either.

| #        | Prerequisite                                        | State                                | Where                                                                                                                            |
| -------- | --------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **P-1**  | Widen the provisioning bundle                       | merged                               | #347, with the D-2 backfill in #350                                                                                              |
| **P-2**  | A delivery read that yields the delivery id         | merged                               | #348                                                                                                                             |
| **P-2b** | `GET /api/v1/deliveries` — the delivery-record list | in open PR                           | #358. It is the record list, **not** the readiness queue FE-001 needs                                                            |
| **P-3**  | `GET /deliveries/{deliveryId}`                      | merged                               | #348                                                                                                                             |
| **P-4**  | The three delivery subresource reads                | merged                               | #348                                                                                                                             |
| **P-5**  | A delivery status-history read                      | merged                               | #348                                                                                                                             |
| **P-6**  | `GET /api/v1/warranties`                            | merged                               | #349                                                                                                                             |
| **P-7**  | A warranty read permission code                     | merged                               | #349                                                                                                                             |
| **P-8**  | Resolve the delivery navigation code — RES-05       | merged                               | #353                                                                                                                             |
| **P-9**  | A delivery-checklist template writer                | merged                               | #355 — eight operations                                                                                                          |
| **P-9b** | The migration the template seam needs               | in open PR                           | #363 — open; the checklist-template seam still waits on it                                                                       |
| **P-10** | A warranty-policy and coverage writer               | merged                               | #356 — seven operations, segment `coverage-windows` (**CC-15**)                                                                  |
| **P-11** | A report-configuration writer and a report engine   | merged (writer); in open PR (engine) | #361 writer at 0204f2d1; #364 engine open, existing local checkout ahead at 13cf2fce643eb721bc3408a5c2d4c3c5e54a373f, not merged |
| **P-12** | The report export operation                         | not started                          | no route, and no entry in the export resource registry                                                                           |
| **P-13** | Correct four stale permission rows                  | merged                               | #354                                                                                                                             |
| **P-14** | Correct the stale signatures docblock               | merged                               | #354                                                                                                                             |
| **P-15** | The `p1-31` ownership rules and profiles            | merged                               | #346, on the A0 lane                                                                                                             |
| **P-16** | Extend the gate-before-read check                   | merged                               | #357 — run by `verify:policies`                                                                                                  |

**Fifteen have a merged contribution; P-11 still has its engine in open PR #364.** P-2b and P-9b are also in open pull requests. P-12 remains not started in this snapshot. No canonical task is closed by a prerequisite merge.

## Owner decisions this matrix is waiting on

| decision                       | question                                                                                                                                                                                                                               | what it blocks                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **D-7**                        | Is the delivery document a client-composed print view or a stored document version?                                                                                                                                                    | FE-007 entirely, and SEC-002's file-access half                                                                              |
| **D-11**                       | Is the seven-day audit-log default window (P1-26-OD-007) ratified, deferred or changed?                                                                                                                                                | nothing today — FE-015 ships the window unchanged and carries the decision forward, which is what the preflight warned about |
| **new**                        | The reporting period convention: **[from, to) in the branch time zone** for branch-scoped reports, proposed by the coordinator in [`d4-report-definitions.md`](./d4-report-definitions.md), with the tenant default as the alternative | every report in D-4, because a period boundary is not a presentation choice                                                  |
| **delivering employee**        | Which tenant-owned employee relation identifies the delivering employee, separately from the authenticated actor and authorized receiver?                                                                                              | completed employee selection requires the approved relation and server validation; a typed identifier is insufficient        |
| **optional identity evidence** | Which approved category/access contract and explicit business policy govern optional identity evidence?                                                                                                                                | registering support and access rules; missing category support does not make collection mandatory                            |

The coordinator has already sent one decision packet covering these choices, D-7, D-11 and report timezone semantics. Its recommendations are a distinct tenant-owned employee relation with server validation, a permission-checked printable delivery view, retaining the seven-day audit default and 92-day bound, half-open branch-timezone periods, and optional identity evidence under its approved category/access contract. Answers remain pending; no new decision is inferred. D-3/D-4/D-5/D-6 remain settled.

D-3 was answered on 2026-09-09 and is recorded on FE-001's row above and in the preflight. D-6 was
answered on the same day and is what puts FE-015 in an open pull request rather than in the
`not started` column.

## Integration reconciliation — 2026-09-10

The coordinator verified all 19 post-merge checks for protected `develop` `0204f2d12ae1c6b80888a00a85bb321b6327a43f` against terminal evidence and the live API. The current integration sequence is #360 → #358 → the cleanup tooling prerequisite → #363 → #362 → readiness → #364. The cleanup fix precedes the database-tier proof needed by #363; FE-001 depends on authoritative readiness. FE-001 and report engine implementations remain unmerged. FE-001 has the focused DOM/adapter results recorded above. Report source `13cf2fce643eb721bc3408a5c2d4c3c5e54a373f` has six selected backend cases passing (23 unselected cases), focused unit 15/15 and export policy 20/20, plus static checks. These are slice proofs, not phase acceptance. D-5 is already approved; it is not a new Owner question.

The combined permission rollout was completed once by its reserved database owner: 24 administrator roles moved from 74 to 76 mappings, with 48 new allows (24 per approved code). All 2087 existing mappings were unchanged, including 311 custom-role mappings. Actual deny and export counts were zero before and after; this does not claim an exercised deny-preservation case. The transaction committed 24 audit records and 96 detail rows. This is rollout evidence, not database-suite or product-acceptance evidence. The execution resource ledger references the external `combined-permission-rollout-20260910-*.json` evidence bundle.

#360 merged at `f8958e77cd607b8d9a2ebd62eab08176d4c91cf0` after all five required PR gates passed (19 successful checks, two conditional database skips). Its final unit record is 3277/121 and web record 3619/133, with actual runner exits zero; separate agent-assisted read-only verification found no blocking issue. This is technical slice evidence, not independent human QA or phase acceptance. All 19 postmerge checks succeeded at that exact develop commit, including `protected-gate`; the GitHub-only observers are retired. #358 synced once to that actual merge commit; combined-tree verification is recorded in change-control section 37.4: selected backend 17/17, unit 3277/121 and web 3619/133 passed, with separate agent-assisted technical verification. Its own final-head hosted gates and merge review remain pending.
