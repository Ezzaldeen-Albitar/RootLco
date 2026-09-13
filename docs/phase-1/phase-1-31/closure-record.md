# P1-31 — closure record (inputs to gate P1-G31)

**Measured at protected `develop` `fb65b0493d6ef2f8e65c00c39a2d51a42a98ff1f`** — the merge of PR #387, the corrected acceptance
re-run — and re-derived there in full by the closure re-measure, change control § 62. `main`
`1262de74`, untouched by this phase and far behind. _(This record previously declared
`81b3bce804626353a1a7b9f4ba52f1306c8f8b6e` with a note that its § 2 row states were counted at a
different head again. Both were true when written. **Every figure below is now read at one head**,
and where a figure replaces an earlier one the earlier one is quoted beside it rather than
overwritten.)_

This record is an **input to gate P1-G31, not the gate's decision.** Field 33 of
[`canonical-plan.md`](./canonical-plan.md) makes the gate four conjunctive conditions, and the
fourth is the approval owner's. Nothing here records that verdict, stands in for it, or implies it
was given — § 4 leaves its field empty and says who may fill it. Until all four conditions hold, the
chapter's own status for all twenty-nine tasks **remains `Planned`**, and this record changes no
chapter status.

Every figure below was read on this head or is quoted from a phase record with its file named. No
test tier, build, migration or deployment was run to produce it. Two database facts are quoted from
a **read-only** query against the shared local acceptance database and are labelled where they
appear (§ 5.4); nothing else touched a database, and nothing was written, deleted or reset.

**Three rules bind every sentence in this record**, and they are stated once here rather than
argued row by row:

1. **A merged screen is not end-to-end.** A merge removes an obstacle; the event that finishes a
   task is a recorded acceptance against a running environment
   ([`task-matrix.md`](./task-matrix.md) rule 2).
2. **An evidence-index citation is not completion.** A record that measures a gap is not the
   artefact that closes it, and documentary evidence never earns `end-to-end verified`.
3. **A state is never upgraded without the artefact its own vocabulary requires**
   ([`task-matrix.md`](./task-matrix.md), "State vocabulary").

## 1. Scope and boundary

The canonical chapter turns into **29 tasks — sixteen Frontend, four Security, five QA, two DevOps
and two Documentation** ([`canonical-plan.md`](./canonical-plan.md), Field 14 to Field 18). That is
the whole of what P1-31 owes. The chapter defines none of the thirteen non-Frontend tasks beyond one
boilerplate sentence per chain, and all three test ids it cites for them return zero files — A0's
**D-16**, and the reason [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) transposes
its definitions from P1-28 and says so.

Beside the 29 runs a **prerequisite lane** of nineteen entries, **P-1 … P-17** with **P-2b** and
**P-9b**, raised by [`a0-preflight.md`](./a0-preflight.md) and travelling as change requests against
the owning Backend phases. Measured on this head, **eighteen of the nineteen have a merged
contribution**: P-1 (#347), P-2 … P-5 (#348), P-6 and P-7 (#349), P-8 (#353), P-9 (#355), P-9b
(#363), P-10 (#356), P-11 (#361 writer, #364 engine at `c1b1a8cd`, #374 datasets at `6b3c6c45`),
P-2b (#358), P-13 and P-14 (#354), P-15 (#346), P-16 (#357), P-17 (#370 at `811e9891`). **P-12, the
report export operation, is not started**, and `rpt.export` is withheld from the provisioning bundle
by explicit Owner decision (**CC-04**). _(This paragraph read "eighteen of the nineteen" with P-11
carried as "#364 and #374 engine" and P-17 as merged; the two merge commits are now named, and
[`task-matrix.md`](./task-matrix.md)'s prerequisite table, which read P-11 as "in open PR (engine)"
and P-17 as "implemented, not merged", is corrected in the same pull request.)_

**A prerequisite closes no canonical task.** That is rule 1 of
[`task-matrix.md`](./task-matrix.md), it is repeated in every prerequisite section of the register,
and it governs this record: a merged seam removes an obstacle, and removing an obstacle is not the
event that finishes a task. The same rule forbids reading the eighteen merges as eighteen closures.

## 2. The account of the twenty-nine canonical tasks

The `state` column is **[`task-matrix.md`](./task-matrix.md)'s own value, quoted, not derived here**.
At this head the matrix is re-measured on one head for all twenty-nine rows, so this record no
longer carries a note about rows older than the head they were measured on — **CC-45 is discharged
by this re-measure** and § 62 records that.

**No gate derives this table.** P1-28's register was machine-compared against a generated
`task-matrix.json`; P1-31 has a hand-written matrix, no generated one and no `validate:p1-31-matrix`,
so the count of twenty-nine and every row below are held by reading alone. A reader who needs the
authoritative state must read the matrix, not this summary of it.

**The `missing` column takes one of four values** — `implementation`, `proof`, `decision`, `none` —
and a row may carry more than one. **`none` never means finished**: it means the row owes nothing
except the Owner's verdict, which is owed by all twenty-nine alike and is counted once, as gate
condition 4, never as a per-row decision.

### 2.1 Field 14 — Frontend (16 tasks)

**Chapter obligation, identical for all sixteen** ([`canonical-plan.md:220-221`](./canonical-plan.md)):
implement the task "against the approved UI prototype and approved backend contract, including
Arabic/English, RTL/LTR, desktop/tablet, accessibility, and loading/empty/error/permission states".
`canonical-plan.md:223-226` names the five binding obligations and records that **mobile is never
named anywhere in the chapter**.

| task       | required behaviour, with citation                                   | existing implementation (PR / sha)                                 | existing evidence (file : section)                                                                                                | missing                                                                                                                                                                                                                                                                                                                 | responsible owner                                                                                                    | completion condition                                                                           |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **FE-001** | ready-for-delivery list, five obligations (`canonical-plan.md:230`) | #367 (`ae0e0354`) on the #366 (`01c32937`) readiness contract      | `acceptance-record.md` § 7.1, run `mtz5ppq8`, over the records HTTP step 118 established; register § 42                           | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | the Owner records a verdict                                                                    |
| **FE-002** | delivery eligibility (`canonical-plan.md:231`)                      | #357 (`fc58f1c2`) read, #362 (`78d34fbc`), Start #377 (`9b109f63`) | `acceptance-record.md` steps 106, 115, 116; register § 51                                                                         | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-003** | authorized receiver (`canonical-plan.md:232`)                       | #357 (`fc58f1c2`), #362 (`78d34fbc`)                               | `acceptance-record.md` steps 107, 157                                                                                             | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-004** | delivery checklist (`canonical-plan.md:233`)                        | P-9 #355, P-9b #363 (`07193258`), #362 (`78d34fbc`)                | `acceptance-record.md` steps 113, 114, 156                                                                                        | **proof** — no committed browser case exercises this surface in either locale; the HTTP steps beside it are the whole of the evidence. **CC-52 (c)**; and **decision** — the checklist-**template administration** half has no screen and five payload mirrors stand PENDING for it (`security-and-qa-evidence.md` § 4) | the acceptance re-run lane for the case; Owner for whether template administration is inside FE-004 or a later phase | verdict, and the owed browser case in both locales (**CC-52 (c)**), plus that scope decision   |
| **FE-005** | final odometer (`canonical-plan.md:234`)                            | #362 (`78d34fbc`)                                                  | `acceptance-record.md` steps 117, 118                                                                                             | **proof** — no committed browser case exercises this surface in either locale; the HTTP steps beside it are the whole of the evidence. **CC-52 (c)**                                                                                                                                                                    | the acceptance re-run lane; Owner for the verdict                                                                    | verdict, and the owed browser case in both locales (**CC-52 (c)**)                             |
| **FE-006** | delivery signatures (`canonical-plan.md:235`)                       | #357 (`fc58f1c2`) read, #362 (`78d34fbc`) upload and link          | `acceptance-record.md` steps 108–112                                                                                              | **proof** — no committed browser case exercises this surface in either locale; the HTTP steps beside it are the whole of the evidence. **CC-52 (c)**. SEC-002's refused-download negative rides on this screen and is now committed (#385, `474d89ef`)                                                                  | the acceptance re-run lane; Owner for the verdict                                                                    | verdict, and the owed browser case in both locales (**CC-52 (c)**)                             |
| **FE-007** | delivery document (`canonical-plan.md:236`)                         | #368 (`8c4e6a9c`)                                                  | `acceptance-record.md` § 7.1 — print counter, both locales; register § 44                                                         | none for the task; **CC-32** open — the printed sheet names nobody for the delivering employee                                                                                                                                                                                                                          | Owner (lane merged); CC-32 rides on the packet's E-1 and F-4                                                         | verdict                                                                                        |
| **FE-008** | warranty record (`canonical-plan.md:237`)                           | #369 (`deb404c1`) and #375 (`6c99e805`)                            | `acceptance-record.md` steps 120–122; `warranty-p1-31.spec.ts`                                                                    | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-009** | warranty history (`canonical-plan.md:238`)                          | #375 (`6c99e805`) — the vehicle-filtered list only                 | `task-matrix.md` FE-009; **CC-10**, **CC-31**; `acceptance-record.md` § 6                                                         | **implementation + decision** — `wty.warranty_status_history` has no reader anywhere in `apps/api/src`, and the screen states the ledger is unreadable rather than composing one                                                                                                                                        | **Owner** (accept the partial, or authorise **P-18**), then a Backend `wty` read slice                               | an Owner acceptance of the partial, or P-18 merged with a browser case over a published ledger |
| **FE-010** | operational dashboard (`canonical-plan.md:239`)                     | #376 (`72782f48`) — `/{locale}/reports/overview`                   | `acceptance-record.md` § 8.3 steps 183, 184, 186, 188, 190, 192 and § 8.5; `operational-overview.md`; register § 53               | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-011** | work-order reports (`canonical-plan.md:240`)                        | #371 (`46be4bb2`), dataset #374 (`6b3c6c45`)                       | `acceptance-record.md` § 8.2 and § 8.4 — the class-D staleness repaired by construction, 2 rows at step 177 against 1 at step 130 | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-012** | technician reports (`canonical-plan.md:241`)                        | #371 (`46be4bb2`), dataset #374 (`6b3c6c45`)                       | `acceptance-record.md` § 7.1; register § 45                                                                                       | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-013** | inventory reports (`canonical-plan.md:242`)                         | #371, dataset #374                                                 | `acceptance-record.md` § 7.1; register § 46                                                                                       | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-014** | invoice/payment reports (`canonical-plan.md:243`)                   | #371, dataset #374                                                 | `acceptance-record.md` § 7.1; register § 47                                                                                       | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-015** | audit report (`canonical-plan.md:244`)                              | #360 (`f8958e77`)                                                  | `acceptance-record.md` § 7.1, HTTP steps 134–135; register § 36                                                                   | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |
| **FE-016** | branch pilot summary (`canonical-plan.md:245`)                      | #376 (`72782f48`) — the same screen, branch fixed by the address   | `acceptance-record.md` § 8.3 steps 185, 187, 189, 191, 193, 194 and § 8.5                                                         | none                                                                                                                                                                                                                                                                                                                    | Owner (lane merged)                                                                                                  | verdict                                                                                        |

### 2.2 Field 15 — Security (4 tasks)

**Chapter obligation, identical for all four** (`canonical-plan.md:260-263`, described at
`canonical-plan.md:256`): "Complete and evidence `<task name>` under the Phase 1 engineering and
governance standards." No per-task obligation and no resolving test id, so each definition below is
**transposed from P1-28 and declared as a transposition**
([`security-and-qa-evidence.md`](./security-and-qa-evidence.md), "Why this record transposes its
definitions"; **CC-37**).

| task        | required obligation, with citation                                                                                                              | existing implementation (PR / sha)                                                                                                                                                                 | existing evidence (file : section)                                                                                                                            | missing                                                                                                                                                                                                                                                                                                                                                                                        | responsible owner                                                                     | completion condition                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **SEC-001** | least-privilege permission and resolved-scope enforcement (`canonical-plan.md:260`; transposed definition at `security-and-qa-evidence.md` § 1) | #379 (`329b19ab`) indexes the slice proofs #360, #358, #363                                                                                                                                        | `security-and-qa-evidence.md` §§ 1 and 1.1 — the twelve codes reconciled against the operation set and each catalogue row; acceptance steps 15–16 and 174–176 | **proof** — § 1.1 is a mapping, not the least-privilege **judgement** the task names, and § 1.1 says so of itself                                                                                                                                                                                                                                                                              | **Owner**, to appoint a Security reviewer; the judgement is that reviewer's act       | a named reviewer records, per code, that it is the least code that would do                             |
| **SEC-002** | sensitive data, export posture and file access (`canonical-plan.md:261`; § 2)                                                                   | #379 (`329b19ab`); export posture settled by D-6; the file-access negative merged as #385 (`474d89ef`)                                                                                             | `security-and-qa-evidence.md` §§ 2 and 2.1; `apps/web/tests/delivery-signature-refusal.dom.test.tsx`, 11 declared cases; register § 60                        | **proof** — the negative is a component assertion behind a mocked adapter; nothing proves the **server** refuses a download to an actor lacking the code. Separately **P-12 has not started**, so no export contract exists                                                                                                                                                                    | the Backend lane for the server-side negative; the Owner for P-12's scope             | a server-side refused-download negative, and P-12 scoped out by the Owner or delivered by its own phase |
| **SEC-003** | abuse cases and privilege escalation (`canonical-plan.md:262`; § 3)                                                                             | #386 (`e2908f06`) — `tests/backend/p1-31-privilege-escalation.test.ts` and its concurrency sibling                                                                                                 | `security-and-qa-evidence.md` §§ 3 and 3.1; register § 59 (**CC-49**), 213 cases across the two suites                                                        | **proof** — the probes are integration assertions against a **disposable** database and no acceptance record exercises them, so rule 2 is not satisfied; and the abuse set beyond least privilege, tenancy and client-asserted scope — replay abuse, export posture, file access — is unaddressed. Two observations stand undispositioned: **SEC-003-O1** and **SEC-003-O2** (register § 59.6) | the Backend lane for O-1's refusal-document disagreement; the Owner for the clearance | an acceptance record exercises the set, and a named Security reviewer clears it                         |
| **SEC-004** | security audit-event coverage (`canonical-plan.md:263`; § 4)                                                                                    | #384 (`af924cab`) — `scripts/ci/check-p1-31-write-shape.mjs` in `verify:policies`, mutation-proved by `tests/ci/p1-31-write-shape.test.ts`, and [`audit-class-review.md`](./audit-class-review.md) | register § 58 (**CC-48**); the gate's own report; the review's line-per-declaration table                                                                     | **proof** — the review is **documentary and unsigned**: nobody has reviewed the declarations as a set with authority, which is exactly what gate condition 3 asks for. § 4's remaining open items — the two `sal.finance.view` reads, `rpt.report-run` and the employee-register reads — are unclosed                                                                                          | **Owner**, to appoint a Security reviewer                                             | a named reviewer signs the set, and the four open declarations are settled                              |

### 2.3 Field 16 — QA (5 tasks)

**Chapter obligation, identical for all five** (`canonical-plan.md:276-280`, described at
`canonical-plan.md:271-272`): "Design and automate `<task name>` with positive, negative, isolation,
failure, and recovery coverage appropriate to the affected workflow."

| task       | required obligation, with citation                                 | existing implementation (PR / sha)                                                                                                                  | existing evidence (file : section)                                                                                                                                                                                | missing                                                                                                                                                                                                                                                                                                                                               | responsible owner                                                                  | completion condition                                                                                                           |
| ---------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **QA-001** | unit and component coverage (`canonical-plan.md:276`; § 5)         | #379 (`329b19ab`) indexes the web suites; the phase coverage record merged as #385 (`474d89ef`); the delivery DOM races merged as #372 (`821ed668`) | [`coverage-record.md`](./coverage-record.md) — twelve suites, 407 declared cases, five named holes, five figures filled from hosted run `34759286884`; `security-and-qa-evidence.md` § 5                          | **proof** — **CC-50 (a)** is open: the per-tree instrumented-file counts (H-2) and the dashboard route tier measurement (H-3) can be filled from no hosted artefact, because no job uploads the per-file web coverage summary. Coverage across the phase screens is still partial, and no P1-31 feature code is inside the coverage instrument at all | the CI-automation lane for the upload list; the QA lane for the remaining screens  | H-2 and H-3 filled from a hosted artefact, and the named holes closed or accepted                                              |
| **QA-002** | contract and error-path coverage (`canonical-plan.md:277`; § 6)    | #379 (`329b19ab`) indexes the seam and adapter suites                                                                                               | `security-and-qa-evidence.md` § 6 — the backend seam suites and the adapter suites, plus four error-shape branches driven on real rows (steps 105, 116, 147, 156)                                                 | **implementation + decision** — P-12's export contract does not exist, so its error paths cannot be written; and every P1-31 operation publishes a success schema of exactly `{ "type": "object" }`, which is generator-wide and which A0 classified as chapter-level                                                                                 | **Owner**, to confirm the scope classification (packet **F-6**); P-12 out of phase | the Owner records that typed response schemas are a platform slice outside P1-31, and P-12's status is settled                 |
| **QA-003** | tenant / company / branch isolation (`canonical-plan.md:278`; § 7) | #379 (`329b19ab`); the acceptance isolation cases; the set-wide probes merged as #386 (`e2908f06`)                                                  | `security-and-qa-evidence.md` § 7; register § 59 — **SE-6** refuses a foreign-tenant caller across the tenant-owned operations and **SE-7** across the branch/company-scoped requests, with zero row-count deltas | **proof** — the set-wide probes are integration assertions against a disposable database; the acceptance record drove four probes over four operations, which is a traversal and not the phase                                                                                                                                                        | the QA lane, with an acceptance that exercises the set                             | an acceptance record exercises isolation across the operation set                                                              |
| **QA-004** | concurrency and idempotency (`canonical-plan.md:279`; § 8)         | #386 (`e2908f06`) — `tests/backend/p1-31-concurrency-and-versioning.test.ts`, C17-0 … C17-4                                                         | `security-and-qa-evidence.md` § 8; register § 59 (**CC-49**); acceptance steps 47, 103–104, 105, 116                                                                                                              | **decision** — whether P1-31 owes a **sibling version-sourcing gate** over its own version-guarded operations, or a recorded waiver, is undecided; **no P1-31 version-sourcing gate exists**. And no acceptance record exercises the non-delivery guarded operations                                                                                  | **Owner** (packet **F-5**), then the QA lane                                       | the Owner chooses a gate or a waiver; if a gate, it lands green over the guarded set                                           |
| **QA-005** | regression and evidence packaging (`canonical-plan.md:280`; § 9)   | harness #378 (`6005cfa4`), record #380 (`81b3bce8`), corrected re-run #387 (`fb65b049`)                                                             | `acceptance-record.md` § 8 — **194 HTTP steps, 0 findings**, 40 of 40 P1-31 browser cases, 28 screenshots, 0 shot failures; register § 61 (**CC-51**)                                                             | **proof + decision** — the run is an **engineering** PASS and the record's own § 1 verdict stays **PARTIAL**; the **evidence-packaging half is unmet** because nothing of the run is committed except the record; a locally driven run leaves no Playwright reporter document at all (§ 61.6); and D-16's packaging convention is unresolved          | the QA lane for packaging; **Owner** for the verdict and for D-16                  | the run's artefacts are packaged and digest-checked into a committed ledger, D-16 is answered, and the Owner records a verdict |

### 2.4 Field 17 — DevOps (2 tasks)

**Chapter obligation, identical for both** (`canonical-plan.md:293-294`, described at
`canonical-plan.md:288-289`): "Prepare and automate `<task name>` with environment segregation,
least privilege, observable execution, rollback criteria, and **a recorded operator runbook**."

| task       | required obligation, with citation                                               | existing implementation (PR / sha)                                                                      | existing evidence (file : section)                                                                                                                           | missing                                                                                                                                                                                                                                                                                                              | responsible owner                                                                                                        | completion condition                                                                                               |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **DO-001** | continuous-integration quality gate (`canonical-plan.md:293`; § 10)              | P-16 #357 (`fc58f1c2`) — `validate:p1-31-access`, run by `verify:policies`                              | `security-and-qa-evidence.md` § 10 — the gate's registration, its report and its mutation proof `tests/ci/p1-31-access-gate.test.ts`                         | **proof, of the incremental kind** — the gate judges an explicit allow-list, so completeness is a property of the closing head and not of the gate. Two observations stay carried: no hosted job names the gate, and `validate:exact-money` rides `verify:contracts` rather than `verify:policies`                   | per-slice maintenance; no dedicated lane                                                                                 | every P1-31 screen and consumed operation is in the allow-list at the head the phase closes on                     |
| **DO-002** | structured logging, monitoring and alert routing (`canonical-plan.md:294`; § 11) | the **operator half only**: [`operator-runbook.md`](./operator-runbook.md), merged as #383 (`ea3b7fc0`) | register § 57; `security-and-qa-evidence.md` § 11 — the correlation surface measured, the owed operator acts tabled, and the external artefact of 2026-09-12 | **implementation + decision** — the **monitoring and alerting half does not exist and is not claimed**; **D-10** (whether Field 24 requires an event-consumption mechanism, or accepts polling) is unanswered; and the four operator acts remain owed on every environment that is not the one shared local database | **Owner** for D-10 (packet **B-4**) and for the environment authorisation (packet **F-4**); a DevOps lane for monitoring | the Owner answers D-10 and authorises the acts, the acts are run, and a monitoring surface exists or is scoped out |

### 2.5 Field 18 — Documentation (2 tasks)

**Chapter obligation, identical for both** (`canonical-plan.md:312-313`, described at
`canonical-plan.md:307-308`): "Produce the controlled record for `<task name>`, link all supporting
evidence, identify unresolved limitations, and **route the result to the named approval owner**."

| task        | required obligation, with citation                                                     | existing implementation (PR / sha)                                                                                                                                     | existing evidence (file : section)                        | missing                                                                                                                                                                                                                                                                                                                                                                                                       | responsible owner                                                                                                 | completion condition                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **DOC-001** | contract, catalog and traceability synchronisation (`canonical-plan.md:312`; § 12)     | corrections #1 and #2 merged as #354 (`0272390b`); correction #3 retracted in place by #383 (`ea3b7fc0`)                                                               | `security-and-qa-evidence.md` § 12; register § 57.2       | **implementation + decision** — **correction #4 is the Owner's act** (`OWR-2026-09-06-G-10` names a table that does not exist, in a requirement whose status is `Undecided`); `documentation/` does not exist and Field 34's numbered targets resolve to nothing; **D-14** and **D-16** are unanswered; and the task's own stated dependency, the operation set settling, is unmet while P-12 has not started | **Owner** for correction #4, D-14 and D-16 (packet **E-1**, **B-6**, **B-7**); a documentation slice for the rest | the Owner acts on the requirement row and answers D-14 and D-16, Field 34's tree is reconciled, and the operation set is declared settled |
| **DOC-002** | operator and developer guidance, and the change record (`canonical-plan.md:313`; § 13) | the register itself; [`operator-runbook.md`](./operator-runbook.md) merged as #383 (`ea3b7fc0`); the register's open-disposition index at § 57.4, re-derived at § 62.x | register §§ 57 and 62; `security-and-qa-evidence.md` § 13 | **proof** — **the routing half is performed by this pull request and the acknowledgement half is not.** [`owner-decision-packet-2026-09-13.md`](./owner-decision-packet-2026-09-13.md) routes the controlled record to the approval owner; **no reply, acknowledgement or approval is recorded, and none is claimed.** Developer guidance beyond the two gate scripts § 13 names is unwritten                 | **Owner**, to acknowledge; a documentation slice for developer guidance                                           | the approval owner acknowledges the routed record, and developer guidance exists                                                          |

### 2.6 Totals

| state                        | count  | rows                                                    |
| ---------------------------- | ------ | ------------------------------------------------------- |
| `end-to-end verified`        | **12** | FE-001, FE-002, FE-003, FE-007, FE-008, FE-010 … FE-016 |
| `merged (write path)`        | **3**  | FE-004, FE-005, FE-006                                  |
| `merged (read-only/partial)` | **5**  | FE-009, DO-001, DO-002, DOC-001, DOC-002                |
| `in open PR`                 | **0**  | —                                                       |
| `phase-level incomplete`     | **9**  | SEC-001 … SEC-004, QA-001 … QA-005                      |
| `not started`                | **0**  | —                                                       |
| **total**                    | **29** | —                                                       |

_(These totals read `end-to-end verified` **12**, `merged (read-only/partial)` **3**, `in open PR`
**5**, `phase-level incomplete` **7**, `not started` **2**, and before that 12 / 3 / 2 / 6 / 6, and
this re-measure first counted them 15 / 5 / 0 / 9 / 0. All were true when written. Nothing moved to
`end-to-end verified` on documentary evidence: the three Frontend rows that moved — FE-010, FE-011
and FE-016 — moved on the corrected acceptance re-run `mtzmvemj` recorded at `acceptance-record.md`
§ 8, and the rows that left `not started` and `in open PR` did so because their lanes merged, which
is a change of state and not a closure. **Three rows were LOWERED**: FE-004, FE-005 and FE-006 held
`end-to-end verified` on their HTTP chains alone and no committed browser case exercises the
checklist, final-odometer or signature surfaces in either locale, so they take
`merged (write path)` — the vocabulary's state for work on `develop` including the commands the task
implies. That is **CC-52 (c)**, and the coincidence of arriving back at twelve is arithmetic, not
the earlier twelve returning.)_

**Missing, by kind, counted off the rows above.** A row appears under every kind its own column
names.

- **implementation — 4 rows:** FE-009 (no history reader), QA-002 (P-12's export contract), DO-002
  (the monitoring half), DOC-001 (Field 34's tree, and the operation set).
- **proof — 12 rows:** FE-004, FE-005 and FE-006 (no committed browser case for the checklist, the
  final odometer or the signature evidence), SEC-001, SEC-002, SEC-003, SEC-004, QA-001, QA-003,
  QA-005, DO-001, DOC-002 — and the honest reading of that list is that **proof, not implementation,
  is what P1-31 is short of.** _(This list read **9 rows** and did not carry the three Frontend
  rows.)_
- **decision — 7 rows:** FE-004 (template administration's scope), FE-009 (accept the partial or
  authorise P-18), QA-002 (the OpenAPI classification), QA-004 (sibling gate or waiver), QA-005
  (D-16), DO-002 (D-10 and the environment authorisation), DOC-001 (correction #4, D-14, D-16).
- **none — 12 rows:** FE-001, FE-002, FE-003, FE-007, FE-008 and FE-010 … FE-016, which owe only
  the verdict. _(This read **14 rows**, before FE-005 and FE-006 took a `proof` entry; FE-004 was
  already outside it on its `decision`.)_

**The arithmetic.** The three "missing" lists overlap; their union is **seventeen distinct rows** —
every row except the twelve marked `none` — and 17 + 12 = **29**. The verdict itself is owed by
all twenty-nine and is counted once, as gate condition 4. _(This read "**fifteen distinct rows** …
15 + 14 = 29", before FE-005 and FE-006 joined the `proof` list.)_

### 2.7 The four Frontend rows that are not `end-to-end verified`

**FE-004 delivery checklist, FE-005 final odometer, FE-006 delivery signatures — the write path is
exercised and the screen is not.** All three moved on the acceptance record's § 6, on their HTTP
chains: steps 113, 114 and 156, steps 117 and 118, and steps 108 to 112. **No committed browser case
exercises any of the three surfaces in either locale.** The delivery case that opens the handed-over
record asserts the summary panel, the eligibility panel and the receiver panel, and asserts nothing
about a recorded checklist item, the final odometer reading or the signature evidence; a search of
the five `*-p1-31.spec.ts` files for those three subjects returns only the warranty screen's
odometer-limit column. § 6 of the record states its own standard as "both an HTTP chain that ran
**and** a browser case that passed in both locales", and applies that standard to the rows it
withheld — so the three are lowered here to **`merged (write path)`**, which is what the vocabulary
gives for work on `develop` including the commands the task implies. The three owed cases are
**CC-52 (c)**, and the correction is noted in the acceptance record beside the paragraph it
corrects.

**FE-009, warranty history — no reader exists to verify.** `wty.warranty_status_history` has no
reader anywhere in the API, so the screen states that the transition record is unreadable rather
than rendering one. The acceptance "cannot confirm a ledger that is not published"
(`acceptance-record.md` § 6). This is a missing capability, not missing browser evidence:
**CC-10** and **CC-31**, with **P-18** named as the backend prerequisite that would close it.

_(This subsection listed **four** rows — FE-009, FE-010, FE-016 and FE-011 — and then **one**.
Both were true when written. FE-010
and FE-016 had no committed browser case and no HTTP step, and FE-011's own case failed in both
locales on a row count the harness recorded before the journey's later writes. All three are
answered by the corrected re-run of `acceptance-record.md` § 8: the overview's figures are read after
the last write and asserted in both locales, the branch-fixed reading is required to agree with the
chosen one, and `work_orders_by_status` answered 2 rows at step 177 against 1 at step 130 — the
figure moved, not the assertion. The class-D narrative that followed is superseded by § 8.2.)_

## 3. Definition of Done, bullet by bullet

The four bullets, quoted from [`canonical-plan.md:454-462`](./canonical-plan.md):

> - Every applicable task is implemented, reviewed, tested, documented, and linked to immutable
>   evidence; CI and phase-specific gates pass.
> - Security and isolation findings are closed or formally accepted by the authorized owner; no
>   critical unresolved defect passes.
> - Traceability, risks, decisions, changes, contracts, catalogs, runbooks, and Master Documentation
>   references are synchronized.
> - The Product Owner records the phase decision; a planning document alone is not execution
>   evidence.

**Bullet 1 — not evidenced. The exact residue: seventeen of twenty-nine tasks are not linked to
immutable evidence of their own completion.** Twelve are `end-to-end verified`; the other seventeen
are `merged (write path)`, `merged (read-only/partial)` or `phase-level incomplete`, and § 2 names,
per row, what each one lacks. _(This bullet read "fourteen … Fifteen are `end-to-end verified`":
true of the count it was written against, and recounted when FE-004, FE-005 and FE-006 were lowered
— CC-52 (c).)_ Every merged slice carries its own record and its own suites, and each pull request was
judged by the repository's required checks — that is the matrix's report, restated here and not
re-run. The phase-specific gates **`validate:p1-31-access`** and **`validate:p1-31-write-shape`**
both exist and are run by `verify:policies`. What is missing is not a gate result but coverage, and
one further thing the bullet names in terms: **no task can satisfy its own Test reference, because
all three cited test ids resolve to nothing** (**D-16**, **CC-37**), so "linked to immutable
evidence" cannot be discharged in the chapter's own vocabulary for any of the twenty-nine.

_(This bullet read "Twelve of twenty-nine … seventeen are not, of which two are `not started` and
three are in open pull request #383", and earlier "six are `not started`". All were true when
written. The verdict — **not evidenced** — is unchanged.)_

**Bullet 2 — not evidenced. The exact residue: no formal acceptance by the authorized owner exists
for any open disposition, and the open set is 26 identifiers at this head — the derived index at
change control § 62.6, quoted in § 5.1.** _(The lineage of that figure, so no reader has to
reconstruct it: **28** was § 57.4's, derived at `821ed668` plus #383 and now superseded; **25** was
§ 62.6 as first derived at this head, `25 + 4 + 47 = 76`; **26** is § 62.6 as it stands, `76 +
CC-52 (c) = 77`, the twenty-sixth open row being the three owed browser cases. Each was true of its
own basis.)_ The isolation
half is now strong on the engineering side: every refusal, concurrency and isolation case the
acceptance plan names answered as it should (`acceptance-record.md` § 4), and #386 added a
set-wide privilege-escalation and cross-tenant probe suite against a disposable database (register
§ 59). The findings half is not: the register carries the open dispositions § 5.1 indexes, **none is
formally accepted by the authorized owner**, and two named security observations —
**SEC-003-O1** and **SEC-003-O2** — stand undispositioned by design (register § 59.6). "Closed **or**
formally accepted" is satisfied by neither limb.

_(This bullet read "SEC-004 is `not started` and SEC-003 is `phase-level incomplete` with one part
uncovered", and earlier "SEC-003 and SEC-004 are `not started`". Both were true when written; #384
and #386 merged. The verdict — **not evidenced** — is unchanged, because the limb that fails is
formal acceptance, not the artefacts.)_

**Bullet 3 — not evidenced. The exact residue: `documentation/` and `_acceptance/` do not exist,
the four operator acts are documented and unperformed everywhere but one database, and one
Master-Documentation row is owed to the Owner.** Inside the phase the synchronisation holds: the
register runs sections **1 … 62** with **CC-01 … CC-52** and no gap other than the permanent
**CC-40** hole, every slice carries a seam or screen document, the matrix carries a row per task
re-measured on one head, and the Owner decisions are in three dated files. Outside it: `documentation/`
(the Field 34 set) is absent and `_acceptance/` is absent; [`operator-runbook.md`](./operator-runbook.md)
carries the four acts and they **remain owed on every environment other than the shared acceptance
database** (**CC-16**, **CC-20**, and **CC-37(c)** closed by the runbook); and
`OWR-2026-09-06-G-10` still reads `Undecided` in `docs/product/owner-requirements-2026-09-06.md`,
which is an Owner document and not this record's to change.

_(This bullet read "sections 1 … 57 with CC-01 … CC-47", and before that "1 … 55 with CC-01 … CC-45"
and "**no runbook exists**". All were true when written. It also said the row reads `Undecided` in
`docs/product/owner-workflow-requirements.md`; **that file carries no `G-10` row** — the row is in
`docs/product/owner-requirements-2026-09-06.md`, and the citation is corrected here. The verdict —
**not evidenced** — is unchanged: a runbook is not a run.)_

**Bullet 4 — not evidenced, and not this session's to evidence. The exact residue: the verdict
itself.** No Owner decision on the phase is recorded anywhere in the repository. The acceptance
record's § 8 verdict is an **engineering** PASS for the run it describes — 194 HTTP steps with zero
findings and 40 of 40 P1-31 browser cases — and the record's own § 1 verdict remains **PARTIAL**;
neither is the Product Owner's, and § 8.10 says so in terms.

## 4. Gate P1-G31 — the four conditions, and what exists

Quoted from [`canonical-plan.md:464-472`](./canonical-plan.md):

> Gate P1-G31: RootLco may authorize dependent work only when the Definition of Done is evidenced,
> the QA lead certifies the test/evidence index, the Security reviewer clears applicable blockers,
> and the approval owner records Pass / Conditional Pass / Fail / Deferred with conditions. Until
> then, status remains Planned.

| condition                                    | what exists on `develop` `fb65b049`                                                                                                                                                                                                                                                                                                                                                                                        | what is missing                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.** the Definition of Done is evidenced   | twelve tasks `end-to-end verified` and three more with their write paths exercised; a 194-step HTTP journey with zero findings and 40 of 40 P1-31 browser cases in the corrected re-run, with 28 screenshots and zero shot failures; two phase gates — `validate:p1-31-access` and `validate:p1-31-write-shape` — registered and run by `verify:policies`; a runbook; a phase coverage record; a set-wide escalation suite | **all four bullets fall short** (§ 3). Seventeen tasks are not linked to evidence of their own completion; no task can satisfy its own Test reference; the monitoring half of DO-002 does not exist; `documentation/` is absent; the four operator acts are unperformed everywhere but one database; and no Owner decision exists |
| **2.** the QA lead certifies the index       | the index [`security-and-qa-evidence.md`](./security-and-qa-evidence.md), thirteen sections re-measured at this head, plus [`acceptance-record.md`](./acceptance-record.md), [`coverage-record.md`](./coverage-record.md), [`audit-class-review.md`](./audit-class-review.md) and [`task-matrix.md`](./task-matrix.md)                                                                                                     | **no certification, and no certifier.** The index is marked OPEN and **no QA lead is named in this repository**. A record is not a certificate of itself, and appointing a role holder is not an engineering act — packet item **A-2**                                                                                            |
| **3.** the Security reviewer clears blockers | SEC-001 … SEC-004 as §§ 1–4 of the index; the acceptance record's refusal, concurrency and isolation cases; the write-shape gate and the audit-class review; the set-wide escalation suite of § 59                                                                                                                                                                                                                         | **no clearance, and no reviewer.** No Security reviewer is named in this repository. The open security-relevant dispositions of § 5.1 are recorded, **none is formally accepted**, and SEC-003-O1 and SEC-003-O2 are undispositioned — packet item **A-3**                                                                        |
| **4.** the approval owner records a verdict  | **nothing**                                                                                                                                                                                                                                                                                                                                                                                                                | the verdict itself — see the field below                                                                                                                                                                                                                                                                                          |

**Approval owner's verdict — Pass / Conditional Pass / Fail / Deferred, with conditions:**

|                        |     |
| ---------------------- | --- |
| **Verdict**            |     |
| **Date**               |     |
| **Conditions, if any** |     |

**This field is deliberately empty.** Only the approval owner named in Field 35 — the Product Owner
— may fill it. No engineering session, no agent, no pull request and no record may supply it, infer
it, or treat its absence as any of the four values. It has not been given, and nothing in this
document should be read as suggesting otherwise.

## 5. Open items carried out of the phase

### 5.1 Change-control dispositions still open

**The authoritative index is change control § 62.6**, which re-derives every disposition's state at
this head across sections 1 … 62 and CC-01 … CC-52: **26 open, 4 stating no usable disposition, 47
closed or settled — 77.** § 57.4 carried the previous index — 28 open, 38 closed or settled, 4
stating no usable disposition, derived at `821ed668` plus #383 — and it is **marked superseded in
place** rather than deleted. This subsection quotes § 62.6 and adjudicates nothing of its own.

**Four corrections this record owes, and makes:**

- **"Six closures are stated in the register and nothing else is closed" was wrong in both
  directions, and is withdrawn.** The register's own state cells read `closed` or `settled` for far
  more than six identifiers, and § 62.x counts them; and three rows the earlier list counted open
  were closed or stale rather than open. Neither the state column alone nor this record alone was a
  reliable index, which is what § 62.x exists to fix.
- **CC-01 and CC-02 are closed in the register's prose and their disposition rows never moved.**
  The prose closes both — the bundle moving 74 → 75 and 74 → 76 — and this pull request adds an
  italic note beside each row so the two readings no longer disagree.
- **CC-25 and CC-26 have prose dispositions under § 38.3 and no row in a disposition table, so no
  state can be read for either.** They are therefore not counted as open on a state cell they do not
  have; § 62.x files them under "states no usable disposition", as § 57.4 did.
- **CC-27's open sub-item is (b), not (a).** (a) was approved on 2026-09-10 apart from its source
  column, which is the residue the packet asks as **C-5**; (b) — the catalogue merge rule — is the
  open half and is packet item **D-1**.

**Further corrections to what this record previously listed as open:**

- **CC-17 and CC-18** are `closed` in the register's own state cells; this record listed both open.
  The one live thing CC-17 describes is a **property** — `wty.warranty-coverage-status-set` is
  version-guarded and deliberately not replayable — and #386 pins it (C17-0 … C17-4). A closed
  finding may still describe a live property, and the two files now say which they mean.
- **CC-33 with (a) and (b), and CC-34 with (a), (b) and (c)**, are `settled` in the register; this
  record listed them open. **CC-34 itself** reads "recorded — no action here" and is carried in the
  packet's **A-4** on that wording.
- **CC-35(a) and CC-35(b)** were **decided by the Owner on 2026-09-12 (D-20) and implemented**;
  § 5.3 previously listed them as recommendations pending approval, and that is corrected below.
- **CC-36 and CC-39 with (a), (b) and (c)** are `closed` in the register; this record listed them
  open.
- **CC-42** is `open, recorded, PROVISIONAL` in its own state cell and "closed by measurement" in
  § 54 — the journey half ran. The state cell is annotated in place by this pull request.
- **CC-22** reads "implemented, pending merge"; #360 merged at `f8958e77`, so the cell is **stale**
  rather than open, and it is annotated in place.
- **CC-46(d)** re-opened when the phase directory grew past the count the index stated. This
  re-measure states the directory count at this head and **closes CC-46(d) by that measurement**.
- **CC-45** — four matrix rows older than the head they were measured on — is **discharged by this
  re-measure**, which re-measures all twenty-nine on one head.
- **CC-37(c)** is closed by the runbook (§ 57.3). **CC-50** is closed by the hosted fill;
  **CC-50 (a)** is open and names the two coverage figures no hosted artefact carries.
- **CC-51** withdraws § 52.6's claim that relocation _resolved_ the two CodeQL findings.
- **CC-52 (c)** is raised open by this re-measure: **three committed browser cases are owed** —
  delivery checklist recording, the final odometer, and the signature evidence — in both locales,
  on the next acceptance pass. **FE-004, FE-005 and FE-006 stay `merged (write path)` until
  then.** Two further sub-items are open on the same identifier: **CC-52 (a)**, the register's
  own shape leaving four states unreadable, and **CC-52 (b)**, a doc-count pin that accepts a
  provenance word without reading the run ledger.

**One identifier has no disposition anywhere: CC-40.** Two lanes claimed it, the operational
overview settled the range and the harness lane moved to CC-42, so the sequence carries a permanent
hole at 40 rather than a finding (register § 57.5). It is named here so a reader does not go looking
for the row.

### 5.2 The product observations from the acceptance record

All three are `acceptance-record.md` § 6, recorded for the lanes that own them and **not repaired by
any P1-31 slice**:

- **O-1 — `wo.work_order.line.manage` is not in the tenant-administrator bundle.** The code is in the
  permission catalogue and is declared by two shipped operations; `wo.service-line-record` answered
  `403 ERR-IAM-001` to a fresh organisation's first administrator. It blocked nothing in the journey,
  because an invoice derives from an accepted quotation revision, but that administrator cannot
  record a service line or a required-part demand at all. Backend `iam` owns the change; the grant
  decision is packet item **F-7**.
- **O-5 — a draft report configuration withdraws its dataset from the catalogue.** A tenant
  configuration in `draft` suppresses the baseline in `listPublished`, and the by-code read refuses
  an unpublished one, so `rpt.report-run` answers `404 ERR-RES-001` for that code. The behaviour is
  documented in the service; the consequence is stated nowhere a screen could show it. Backend
  `reporting` owns it; the rule behind it is packet item **D-1**.
- **O-6 — closure eligibility answered eligible while the state graph refused.**
  `wo.work-order-closure-eligibility` answered `eligible: true, blockers: []` at a moment when the
  closure command refused with `ERR-TRN-001`, because the eligibility read answers for the closure
  CONDITIONS and not for the state graph. Both answers are correct, and together they mislead a
  caller. Backend `work-order` owns it.

The same section records five further observations carried with them: **O-2** and **O-3** (the
browser-suite defects the correction pass closed), **O-4** (a published configuration replaces the
translated title with the tenant's own label), **O-7** (the warranty list's empty-state sentence) and
**O-8** (the status-history envelope shape).

### 5.3 The Owner decision packet

Everything this record previously listed under "Owner decisions still unanswered" is carried, with
the rest of what only the Owner can supply, in one routed document:
**[`owner-decision-packet-2026-09-13.md`](./owner-decision-packet-2026-09-13.md)** — twenty-six
items in six blocks, of which eight are marked as blocking this phase. It states its own inclusion
criterion, excludes anything an engineer or an operator may lawfully do, and lists what is **already
decided** so that nothing is asked a second time.

Two corrections this record owes, and makes, to what it previously said here:

- **CC-35(a) and CC-35(b) are not pending.** The Owner decided them, with CC-35, on 2026-09-12
  (D-20), and register § 47.5 implements the decision. They are listed in the packet's "already
  decided" table, not among its questions.
- **The `OWR-2026-09-06-G-10` row is in `docs/product/owner-requirements-2026-09-06.md`**, not in
  `docs/product/owner-workflow-requirements.md`; that file exists and carries no `G-10` row. The
  packet's **E-1** cites the correct path.

### 5.4 Operator facts, and evidence that lives outside this repository

- **The shared local database the acceptance ran against** was confirmed read-only before and after
  each run: `supabase_migrations.schema_migrations` **141** rows against **141**
  `supabase/migrations/*.sql` files; `iam.permissions` **121** codes; every `tenant_administrator`
  role holding exactly **78** permission codes.
- **The residue on that database, measured by a read-only query on this date and labelled as such.**
  `org.tenants` holds **41** rows; **16** of them are `p31_journey_*` organisations and **18** are
  `p30_journey_*`. Two of the sixteen are the pair the corrected re-run provisioned. **None was
  deleted**, on the P1-30 precedent: their codes match no backend-suite prefix, so no routine run
  will remove them and none of them will remove anything else. _(This bullet read "`org.tenants`
  went from 25 rows to 39 … **Fourteen `p31_journey_*` organisations remain**": true when written,
  before the corrected re-run provisioned its own pair.)_ **The standing rule that makes this safe is
  that the backend suites delete tenants by prefix on this shared database**, so acceptance data is
  named to match no suite prefix. Deleting any of them is destructive and irreversible and is asked
  of the Owner as packet item **F-8**; nothing here deletes anything.
- **The acceptance evidence is not in this repository.** The HTTP harness and its screenshot
  companion are at `orchestration/acceptance/` in the workspace that contains this checkout
  (**CC-42**, register § 52.6, as amended by **CC-51**), and each run's `summary.json`, `steps.json`,
  `steps.md` and images are outside every git working tree — the corrected re-run's at
  `orchestration\evidence\p1-31\acceptance-20260913-1247\`.
- **The P-17 operator acts of 2026-09-12** are recorded in
  `orchestration/evidence/p1-31/p17-operator-20260912/` — sixteen entries, also outside this
  repository. They were performed by hand against one shared local database in a container: the
  migration ledger brought to parity, the delivering-employee backfill run dry then real, and the
  bundle backfill refusing **exit 5** on its first pass before the permission-catalogue seed was
  applied, then widening 24 administrator roles from 76 to 78 codes. That refusal is **CC-37(c)**,
  and the runbook now carries the ordering it exposed.
- **Four operator acts remain owed on every environment that is not that one database**: the P-9b
  migration, the two P-17 migrations, the delivering-employee backfill and the tenant-administrator
  bundle backfill. [`operator-runbook.md`](./operator-runbook.md) carries all four in the order that
  is load-bearing. **A runbook is not a run**, and CC-16 and CC-20 close on the run.

## 6. Promotion eligibility

**P1-31 is NOT eligible for promotion, and this record does not recommend one.** Promotion of
`develop` to `main` on the strength of phase closure requires the phase to be closed, and gate
P1-G31's four conditions are conjunctive. The unsatisfied conditions, named exactly:

| condition                                    | unsatisfied because                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. the Definition of Done is evidenced**   | all four DoD bullets fall short, with the residues named in § 3: seventeen of twenty-nine tasks unlinked to evidence of their own completion, three of them for want of a committed browser case alone (CC-52 (c)); no task able to satisfy its own Test reference; DO-002's monitoring half absent; `documentation/` absent; the four operator acts unperformed except on one database |
| **2. the QA lead certifies the index**       | **no QA lead is named in this repository and no certification exists**                                                                                                                                                                                                                                                                                                                  |
| **3. the Security reviewer clears blockers** | **no Security reviewer is named in this repository and no clearance exists**; no open security disposition is formally accepted                                                                                                                                                                                                                                                         |
| **4. the approval owner records a verdict**  | **the verdict field in § 4 is empty**                                                                                                                                                                                                                                                                                                                                                   |

**Separately from the gate, three facts a promoter would need and does not have:** the phase's
acceptance is loopback and local, not hosted; the evidence-packaging half of QA-005 is unmet, so the
run's artefacts are not in the repository; and `main` `1262de74` is far behind `develop`, so a
promotion would be a large content move judged on a phase that is not closed. **Nothing in this
record should be read as saying the phase is complete or promotable.**

## 7. Handover

### 7.1 What is merged and usable

Seven pull requests landed on `develop` in this closure sequence, each with its merge commit:

| pull request | lane                                                                            | merge commit |
| ------------ | ------------------------------------------------------------------------------- | ------------ |
| **#382**     | the assurance evidence index re-measured at the acceptance head (§ 56, CC-46)   | `63f19764`   |
| **#372**     | QA-006 / QA-007, the delivery DOM test races                                    | `821ed668`   |
| **#383**     | the operator runbook, the INT-084 retraction and register hygiene (§ 57, CC-47) | `ea3b7fc0`   |
| **#384**     | the write-shape gate and the audit-class review (§ 58, CC-48)                   | `af924cab`   |
| **#385**     | the refused-download negative and the phase coverage record (§ 60, CC-50)       | `474d89ef`   |
| **#386**     | the privilege-escalation and concurrency suites (§ 59, CC-49)                   | `e2908f06`   |
| **#387**     | the corrected acceptance re-run and the credential-kind specs (§ 61, CC-51)     | `fb65b049`   |

### 7.2 The criteria that are proven, and the evidence for each

| lane                                | criterion proven                                                                                                                                                                                                                                                    | evidence                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #383, the runbook                   | the four merge-time operator acts are documented in the order that is load-bearing, with the catalogue-seed prerequisite first                                                                                                                                      | [`operator-runbook.md`](./operator-runbook.md); register § 57.3 closes **CC-37(c)**                                                                                           |
| #384, the write-shape gate          | the eleven `wty`/`rpt` writes no payload gate covered are now covered, and the gate can go red                                                                                                                                                                      | `scripts/ci/check-p1-31-write-shape.mjs` in `verify:policies`, mutation-proved by `tests/ci/p1-31-write-shape.test.ts`; register § 58                                         |
| #384, the audit-class review        | every `auditClass: 'none'` declaration on the surface carries a written line, and every `'privileged'` one carries an `auditAction` with a matching class                                                                                                           | [`audit-class-review.md`](./audit-class-review.md)                                                                                                                            |
| #385, the refused-download negative | a refused signature-ledger read renders the permissions message with the logged reference, requests no second page, disables no unrelated command and leaks no document version id, in both text directions, with a success control that stops it passing vacuously | `apps/web/tests/delivery-signature-refusal.dom.test.tsx`, 11 declared cases; register § 60.2                                                                                  |
| #385, the coverage record           | the phase's component and unit coverage is stated per suite with five named holes, and four percentages plus the gate verdict come from one hosted run                                                                                                              | [`coverage-record.md`](./coverage-record.md); hosted run `34759286884`, artefact `evidence-web-quality`                                                                       |
| #386, escalation and concurrency    | holding one P1-31 code does not reach an operation gated on another, a foreign-tenant caller is refused across the tenant-owned operations with zero row-count deltas, and CC-17's deliberate non-idempotency is pinned                                             | `tests/backend/p1-31-privilege-escalation.test.ts` and `tests/backend/p1-31-concurrency-and-versioning.test.ts` — 213 cases, run against a disposable database; register § 59 |
| #387, the acceptance re-run         | 194 HTTP steps with zero findings, 40 of 40 P1-31 browser cases across two locale projects, 28 screenshots and zero shot failures, with every published figure read after the last write                                                                            | `acceptance-record.md` § 8; register § 61                                                                                                                                     |

**One limit of #387's browser half, stated here rather than left in the matrix.** Its forty cases
are the P1-31 set that exists, and that set does not reach every P1-31 surface: **nothing in it
exercises the delivery checklist, the final odometer or the signature evidence**, which is why
FE-004, FE-005 and FE-006 sit at `merged (write path)` and why **CC-52 (c)** is open.

**None of the seven is a phase closure, and none is claimed as one.** Each proves the property its
own row names, on the tier its own record names.

### 7.3 Failures and limitations, stated so nobody has to infer them

- **SEC-003-O1 — the three body-scoped creates do not agree on how they refuse a foreign company.**
  `org.employee-create` answers `404 ERR-RES-001`; `sal.delivery-checklist-template-create` and
  `wty.warranty-policy-create` answer `422 ERR-VAL-001` with an `unknown_company` violation. All
  three write nothing, proved as a zero row-count delta. The candidate repair is a Backend change to
  make the three agree; it is **not made**, it carries no identifier, and it is a contract question
  for the Backend lane (register § 59.6).
- **SEC-003-O2 — `rpt.report-run` resolves a platform dataset, not a tenant's own configuration**, so
  a `404` on that path carries no information about tenancy and is not offered as isolation evidence.
- **CC-50 (a) — H-2 and H-3 can be filled from no hosted artefact.** No job uploads
  `apps/web/coverage/web/coverage-summary.json` or `coverage-gate-web.json`, so the per-tree
  instrumented-file counts and the dashboard route tier measurement are measurable only locally and
  are cited nowhere. The remedy is on the CI-automation lane.
- **The Playwright JSON reporter is conditional on `CI`.** A locally driven acceptance leaves no
  reporter document, so its pass counts are operator-recorded from the console while its failures are
  evidenced by retained per-failure directories (register § 61.6). The two kinds of figure are cited
  differently in `acceptance-record.md` § 8.4, and the difference is not cosmetic.
- **The doc-counts gate accepts a provenance word without reading the ledger.**
  `tests/ci/p1-27-doc-counts.test.ts:613` accepts `local|HOSTED` as a provenance marker without
  checking the run ledger behind it, so a marker can say `HOSTED` over a locally derived figure and
  the gate stays green. Recorded as a gate weakness; nothing in this phase relies on it, and it is
  not worked around.
- **`.github/ci-baselines/coverage-baseline.web.json:5` names a file its artefact never carried.**
  The `establishedBy` field cites `apps/web/coverage/web/coverage-summary.json` inside
  `evidence-web-quality`, and that artefact has never carried it. Pre-existing, on the coverage-policy
  lane, and untouched here.
- **Three P1-31 surfaces have no committed browser case at all**: the delivery checklist recording,
  the final odometer, and the signature evidence. Their write paths are exercised by the HTTP
  journey and their screens are not asserted by anything, in either locale. **CC-52 (c)**, owed to
  the next acceptance pass.
- **`wo.work_order.line.manage` is absent from the tenant-administrator bundle** although two shipped
  operations declare it, and unlike the one code deliberately withheld it carries no recorded reason.
  Observation O-1; the grant decision is the Owner's (packet **F-7**).
- **Every operation on this surface publishes a bare-object OpenAPI success schema.** The shortfall is
  generator-wide rather than this phase's — one literal in `apps/api/src/server/openapi/document.ts`
  — and A0 classified it as chapter-level. No gate reads response properties. Confirming that
  classification is packet item **F-6**.
- **Residue organisations on the shared local acceptance database.** 41 tenants, 16 of them
  `p31_journey_*` and 18 `p30_journey_*`, measured read-only on this date. Nothing was deleted, and
  the standing rule is that the backend suites delete by prefix on this shared database, so
  acceptance data is deliberately named to match no suite prefix. Deletion is packet item **F-8**.

### 7.4 Heads, and the verdict

- **`develop` `fb65b0493d6ef2f8e65c00c39a2d51a42a98ff1f`** — the head every figure in this record was measured at.
- **`main` `1262de74`** — untouched by this phase and far behind `develop`. This record does not move
  it and does not recommend moving it (§ 6).

**The verdict field in § 4 is empty, and only the Product Owner may fill it.** No engineering
session, no agent, no pull request and no record may supply it, infer it, or treat its absence as any
of the four values.

## 8. What this record does not claim

- **No Owner Pass, and no verdict of any kind.**
- **No promotion, and no eligibility for one** (§ 6).
- **No hosted acceptance.** Every figure in the acceptance record is loopback, taken on a production
  build served on one machine against one local database.
- **No completion.** Twelve of twenty-nine tasks are `end-to-end verified`; the phase is not
  complete and is not promotable, and nothing here should be read as saying otherwise.
- **No gate result produced by this record.** It ran no tier, no build, no migration and no
  deployment. The two database figures in § 5.4 are a read-only query, labelled as one. The checks
  run for the pull request that carries this record are named there.

## 9. Change control

This re-measure takes **section 62 and CC-52** of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — the next free pair at this head,
where the register runs to section 61 and CC-51 and no unmerged P1-31 branch claims either. The
slice that carries this revision is pull request
[#388](https://github.com/Ezzaldeen-Albitar/RootLco/pull/388), opened against `develop` on
2026-09-13; no result of its own checks is claimed here.
_(This section previously recorded section 55 and CC-45, taken at `81b3bce8`; that allocation stands
where it was raised and is never renumbered, under the register's § 48.1 rule.)_
