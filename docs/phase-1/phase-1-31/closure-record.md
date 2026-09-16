# P1-31 — closure record (inputs to gate P1-G31)

_(2026-09-14, reviewer-assignment correction: the statements below that there is "no certifier",
"no reviewer", or a need to appoint one are superseded. The owner-approved
[solo-developer review policy](../../governance/solo-developer-review-policy.md) already assigns
Eng. Ezzaldeen Al-Bitar the technical, QA and security review roles. Route the completed evidence
and the still-required certification/clearance to that existing owner. No certification, clearance
or acceptance verdict is created by this correction. The historical measurements below retain
their stated heads; final evidence reconciliation remains due.)_

**Measured at protected `develop` `c1a2f9fc5d43799a4ca4beca9fe4927a777a2632` for § 2.8 and § 2.9**
— the merge of PR #398, re-derived there on 2026-09-15 against
[`acceptance-record.md`](./acceptance-record.md) § 10 and change control sections 63 to 71. _(2026-09-15:
the head declared in the next paragraph, `fb65b049`, remains the head of §§ 2.1–2.7 and §§ 3–8,
which are not re-derived at `c1a2f9fc`; every figure in them is true of `fb65b049` as written, and
none is carried to the new head by this note. `main` is still `1262de74`.)_

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
by explicit Owner decision (**CC-04**). _(2026-09-16: **"P-12 … is not started" is false at this
head and is left as written**, because it was true of `849a8e9a` when the paragraph was measured
there — and it is corrected here rather than rewritten. **The backend report export remediation
merged as pull request #397** at `develop` `9729b2b5`, recorded at change control § 70.2, and its
screen half with **#398** at `c1a2f9fc`. Its HTTP witness is
[`acceptance-record.md`](./acceptance-record.md) § 11.5 — **five exports, each carrying exactly one
correlated `rpt.report.exported` audit row**, and the default administrator refused on all four
report codes with `403 ERR-IAM-001`. **So nineteen of the nineteen prerequisite entries now have a
merged contribution**, and [`task-matrix.md`](./task-matrix.md)'s rule 1 already carries the same
correction. **Rule 1 is unchanged and nothing moves on this note**: a prerequisite closes no
canonical task, and the withholding of `rpt.export` from the provisioning bundle under **CC-04**
stands exactly as stated.)_ _(This paragraph read "eighteen of the nineteen" with P-11
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

_(2026-09-15: §§ 2.1–2.7 are the account at `fb65b049`, and they are superseded, not replaced, by
§ 2.8 and § 2.9, which re-derive all twenty-nine rows at protected `develop` `c1a2f9fc`. There the
`missing` column becomes a list of remaining items, each classified as exactly one of five categories
instead of the four kinds above, and the verdict is still counted once.)_

_(2026-09-16: §§ 2.8 and 2.9 are in turn superseded, not replaced, by **§ 2.10 and § 2.11**, which
re-derive all twenty-nine rows at protected `develop` `849a8e9a` — the pull request #400 merge —
against the closing acceptance run's **fourth** attempt, run `mu3ch41f`,
[`acceptance-record.md`](./acceptance-record.md) § 11. **No row's state changed** between the two
heads; the engineering that merged in #399 and #400 changed what rows owe, not what they have
reached. The five categories are the same five.)_

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

_(2026-09-16, beside the **FE-004** row above, which keeps its words. **A limb of this row
disappeared from the later re-derivations without ever being adjudicated, and it is recorded here
rather than quietly dropped.** This subsection named two things owed and two owners: the browser case
(**CC-52 (c)**, since delivered and executed) and, separately, a **scope decision** — the cell's
responsible-owner column reads "Owner for whether template administration is inside FE-004 or a later
phase", and its completion condition reads "plus that scope decision". **§ 2.10's FE-004 row, § 2.11's
four genuine-Owner-decision rows and the reduced Owner decision packet of 2026-09-16 all omit it**:
§ 2.10 classifies what remains on FE-004 as **remaining engineering** only, and the packet asks no
question about it. **What became of it: nothing. It is still owed, and it is still the Owner's.** No
record closes it, no decision answers it, and no authority cited anywhere in this phase settles it.
**It is not closed by the row reaching `end-to-end verified`**, because that state was reached on the
delivery-checklist surface the canonical row names and not on a template-administration surface, and
it is **not** closed by the ruling that a template administration screen is **not automatically
required** by the canonical delivery-checklist row — that ruling is precisely why the allocation is a
question rather than a defect. **It is routed to the Owner as item O-20** of
[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md), unanswered. **FE-004's
state does not move on this note**, and nothing here answers the question.)_

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

| task       | required obligation, with citation                                 | existing implementation (PR / sha)                                                                                                                  | existing evidence (file : section)                                                                                                                                                                                | missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | responsible owner                                                                  | completion condition                                                                                                           |
| ---------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **QA-001** | unit and component coverage (`canonical-plan.md:276`; § 5)         | #379 (`329b19ab`) indexes the web suites; the phase coverage record merged as #385 (`474d89ef`); the delivery DOM races merged as #372 (`821ed668`) | [`coverage-record.md`](./coverage-record.md) — twelve suites, 407 declared cases, five named holes, five figures filled from hosted run `34759286884`; `security-and-qa-evidence.md` § 5                          | **proof** — **CC-50 (a)** is open: the per-tree instrumented-file counts (H-2) and the dashboard route tier measurement (H-3) can be filled from no hosted artefact, because no job uploads the per-file web coverage summary. Coverage across the phase screens is still partial, and no P1-31 feature code is inside the coverage instrument at all                                                                                                                                                                                                                                                                                                 | the CI-automation lane for the upload list; the QA lane for the remaining screens  | H-2 and H-3 filled from a hosted artefact, and the named holes closed or accepted                                              |
| **QA-002** | contract and error-path coverage (`canonical-plan.md:277`; § 6)    | #379 (`329b19ab`) indexes the seam and adapter suites                                                                                               | `security-and-qa-evidence.md` § 6 — the backend seam suites and the adapter suites, plus four error-shape branches driven on real rows (steps 105, 116, 147, 156)                                                 | **implementation + decision** — P-12's export contract does not exist, so its error paths cannot be written; and every P1-31 operation publishes a success schema of exactly `{ "type": "object" }`, which is generator-wide and which A0 classified as chapter-level                                                                                                                                                                                                                                                                                                                                                                                 | **Owner**, to confirm the scope classification (packet **F-6**); P-12 out of phase | the Owner records that typed response schemas are a platform slice outside P1-31, and P-12's status is settled                 |
| **QA-003** | tenant / company / branch isolation (`canonical-plan.md:278`; § 7) | #379 (`329b19ab`); the acceptance isolation cases; the set-wide probes merged as #386 (`e2908f06`)                                                  | `security-and-qa-evidence.md` § 7; register § 59 — **SE-6** refuses a foreign-tenant caller across the tenant-owned operations and **SE-7** across the branch/company-scoped requests, with zero row-count deltas | **proof** — the set-wide probes are integration assertions against a disposable database; the acceptance record drove four probes over four operations, which is a traversal and not the phase                                                                                                                                                                                                                                                                                                                                                                                                                                                        | the QA lane, with an acceptance that exercises the set                             | an acceptance record exercises isolation across the operation set                                                              |
| **QA-004** | concurrency and idempotency (`canonical-plan.md:279`; § 8)         | #386 (`e2908f06`) — `tests/backend/p1-31-concurrency-and-versioning.test.ts`, C17-0 … C17-4                                                         | `security-and-qa-evidence.md` § 8; register § 59 (**CC-49**); acceptance steps 47, 103–104, 105, 116                                                                                                              | **decision** — whether P1-31 owes a **sibling version-sourcing gate** over its own version-guarded operations, or a recorded waiver, is undecided; **no P1-31 version-sourcing gate exists**. And no acceptance record exercises the non-delivery guarded operations                                                                                                                                                                                                                                                                                                                                                                                  | **Owner** (packet **F-5**), then the QA lane                                       | the Owner chooses a gate or a waiver; if a gate, it lands green over the guarded set                                           |
| **QA-005** | regression and evidence packaging (`canonical-plan.md:280`; § 9)   | harness #378 (`6005cfa4`), record #380 (`81b3bce8`), corrected re-run #387 (`fb65b049`)                                                             | `acceptance-record.md` § 8 — **194 HTTP steps, 0 findings**, 40 of 40 P1-31 browser cases, 28 screenshots, 0 shot failures; register § 61 (**CC-51**)                                                             | **proof + decision** — the run is an **engineering** PASS and the record's own § 1 verdict stays **PARTIAL** _(2026-09-15: not true when written — this cell was written after commit `0e40fd42` replaced that verdict, and `acceptance-record.md:27` records an engineering verdict of PASS for run `mtzmvemj`, an engineering result for that one run and not the Owner's phase verdict, which remains unrecorded)_; the **evidence-packaging half is unmet** because nothing of the run is committed except the record; a locally driven run leaves no Playwright reporter document at all (§ 61.6); and D-16's packaging convention is unresolved | the QA lane for packaging; **Owner** for the verdict and for D-16                  | the run's artefacts are packaged and digest-checked into a committed ledger, D-16 is answered, and the Owner records a verdict |

_(2026-09-16, beside the **QA-001** row above, which keeps its words — **the attribution in it is
corrected, and nothing in it is weakened.** The cell reads, in part, "**CC-50 (a)** is open: the
per-tree instrumented-file counts (H-2) and the dashboard route tier measurement (H-3) can be filled
from no hosted artefact, because no job uploads the per-file web coverage summary". **CC-50 (a) is
CLOSED, not open**, determined at change control § 74.2 by reading the row's own content at § 60.5
against the fill: the remedy that cell itself states — adding
`apps/web/coverage/web/coverage-summary.json` and `coverage-gate-web.json` to the
`evidence-web-quality` upload list — landed with pull request **#389**, hosted run `34778434228`
carried both files, and § 63.10 filled the **H-2 and H-3 figures** from it; § 63.8's dated note,
§ 62.6's index row and § 70.7's exclusion list all read it closed. **What the rest of this cell says
stands and is not discharged here**: H-2 and H-3 as coverage **holes** are not closed by that fill,
coverage across the phase screens is still partial, and the statement that no P1-31 feature code was
inside the coverage instrument was true of the head this cell was written at. **The later fact is a
different one**: the coverage record's figures were re-measured **locally** once three feature roots
entered `COVERAGE_INCLUDE`, and **no hosted run has been read for those figures** — **CC-64 (b)**,
open on its own content, with the `LOCAL` labelling standing and limitation **L-2** of the
certification packet refined and **not lifted**. **The completion condition beside this row keeps its
words**: its figures limb is met by the hosted fill, and its second limb — the named holes closed or
accepted — stands. **QA-001's state does not move on this note**: it remains `phase-level incomplete`,
the QA certification is **unissued**, and **no locally measured figure becomes a hosted measurement
here**.)_

_(2026-09-16, beside the **QA-002** row above, which keeps its words. **One of that row's two "missing"
limbs disappeared from the later re-derivations with no recorded closure, and it is accounted for
here.** The cell reads, in part, "**P-12's export contract does not exist, so its error paths cannot be
written**", and names "P-12 out of phase" in its owner column. **§ 2.10's QA-002 row does not carry
it**: what that row classifies is the suites' execution limb, the bare-object success-body contract
gap, and the certification. **What became of it: the limb is discharged by measurement, and the
evidence is cited rather than assumed.** The export contract **exists** — the backend report export
remediation merged as pull request **#397** at `develop` `9729b2b5` (§ 70.2 of the register) and its
screen half as **#398** at `c1a2f9fc`, so the premise "does not exist" is false at this head. Its error
paths are **exercised, not merely writable**: [`acceptance-record.md`](./acceptance-record.md) § 11.5
records **four exports and an empty-selection export**, five correlated export audit events in the
companion's window — exactly one per correlation id, four of them asserted by ledger steps of their own
and the fifth measured from that window read rather than from an assertion of its own — and the default
administrator **refused on all four report codes with `403 ERR-IAM-001`**. **QA-002's state
does not move on this note**, and nothing here treats the limb's discharge as closing the row: QA-002
remains `phase-level incomplete`, still carrying the bare-object success-body contract gap — which is
an **Owner** item, **O-9** of the decision packet — and the QA certification, **unissued**. **The
deeper success testing of every operation is not made a new deliverable by this note**, and none is
implied.)_

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

_(2026-09-16, beside the **DOC-002** row above, which keeps its words. **This row was split into two
halves here and only one half survived into the later re-derivations; the other is recorded rather
than dropped.** The cell states both: "**the routing half is performed by this pull request and the
acknowledgement half is not**", its responsible-owner column reads "**Owner**, to acknowledge", and its
completion condition reads "**the approval owner acknowledges the routed record**, and developer
guidance exists". **§ 2.10's DOC-002 row names only the routing half** — "routing the record **as it
now stands** to the named approval owner" — and **no item of the reduced Owner decision packet asks for
the acknowledgement**. **What became of it: nothing. It is still owed, and it is an Owner act.** An
acknowledgement cannot be supplied by an engineer, a lane or a record; the packet of 2026-09-13 routed
the controlled record and **no reply, acknowledgement or approval is recorded, and none is claimed** —
that sentence is as true now as when it was written, and the record has grown since, which is why
§ 2.10 restates the routing half against the record "as it now stands". **It is routed to the Owner as
item O-21** of [`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md),
unanswered. **DOC-002's state does not move on this note**: the row keeps
`merged (read-only/partial)`, and its second completion condition — that developer guidance exists —
is engineering work and is unaffected by anything here.)_

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

_(2026-09-15: this table and the lists below are true of `fb65b049` and are superseded by § 2.9,
re-derived at protected `develop` `c1a2f9fc`.)_

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

### 2.8 The twenty-nine tasks re-derived at `c1a2f9fc` (2026-09-15)

**Measured at protected `develop` `c1a2f9fc5d43799a4ca4beca9fe4927a777a2632`**, the merge of PR #398.
The `state` column is [`task-matrix.md`](./task-matrix.md)'s value as that file's 2026-09-15 notes
re-derive it at this head; it is quoted, not derived here, and the evidence for it is named beside
it.

**What counts as each row's own proof.** A Frontend row's proof is the closing acceptance run
`mu2ihptd` of [`acceptance-record.md`](./acceptance-record.md) § 10, taken at this protected head: the
HTTP steps named from § 10.4, whose step table is `steps.md` in the run's evidence directory, and the
browser cases named from § 10.7, read from the run's two Playwright reports, each passing in
`authenticated-en`, `authenticated-ar` and `authenticated-tablet`. A security, QA, DevOps or
documentation row is judged by the proof its own criterion calls for, and a browser case is not that
proof. The Owner's evening message of 2026-09-13, quoted verbatim in
`orchestration/evidence/p1-31/closeout-drafts/queue2/owner-decisions-2026-09-13.md` Appendix A, line
715 (the whole line):

> Do not require browser E2E evidence for a non-frontend task whose criterion calls for another proof. Conversely, an evidence index or named test file does not establish that its required behavior was tested.

The Owner's instruction of 2026-09-14 to the coordinating session:

> Assess every one of the 29 tasks against its own acceptance criteria, including security, QA,
> DevOps and documentation. A test collection, index, or passing API path is not interchangeable with
> its required proof.

**Five categories, and each remaining item takes exactly one.** **None** beyond the Owner's verdict;
**remaining engineering**, named concretely; **documented limitation**, one of the ten residual
limitations the closure facts of 2026-09-15 list as G.1 to G.10, which
[`acceptance-record.md`](./acceptance-record.md) § 10.13 carries in the same order as items 1 to 10,
with the criterion it bears on and why that criterion does or does not call for more; **human
certification**; or **genuine Owner decision**, only where an existing record shows the question is
the Owner's, and that record is cited. A row may carry items in several categories; `none` is
exclusive. The Owner's instruction of 2026-09-15:

> Do not automatically turn every limitation into a phase blocker, and do not automatically accept
> it. Apply the canonical criteria and existing decisions.

**Counted once, not per row.** The Owner's verdict is owed by all twenty-nine alike and is gate
condition 4. **D-16**, which task owns the cited test ids and where phase evidence lands, bears on
every row's Test reference; it is counted as a row item only on QA-005 and DOC-001, whose own
criteria name evidence packaging and traceability.

**Human certification is owed by an assigned reviewer, and none is issued.** It means the QA lead's
certification of the test/evidence index (gate condition 2) and the Security reviewer's clearance of
applicable blockers (gate condition 3). Both roles are already held:
[`solo-developer-review-policy.md`](../../governance/solo-developer-review-policy.md) lines 18–20
name Eng. Ezzaldeen Al-Bitar as "technical reviewer, QA reviewer, security reviewer" (partial
quotation), and [`phase-1-1-owner-gate.md`](../phase-1-1/phase-1-1-owner-gate.md) lines 127–137
assign him "Security Implementation and Review Authority" and "QA Execution and Review Authority".
The same policy, lines 36–37, forbids describing a review under it as independent. **No
certification and no clearance is recorded as issued anywhere in this section.**

**Field 14 — Frontend.** Every row's criterion is `canonical-plan.md:220-221`, cited with the row's
own line.

| task       | state               | required behaviour, with citation | existing implementation (PR / commit)                                                                          | existing evidence (file : section)                                                                                                     | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                                                                       | responsible owner                                                   | completion condition                                                 |
| ---------- | ------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **FE-001** | end-to-end verified | ready-for-delivery list (`:230`)  | #367 (`ae0e0354`) on the #366 (`01c32937`) readiness contract                                                  | `acceptance-record.md` § 10.4 step 100; § 10.7, the two readiness cases in `delivery-p1-31.spec.ts`, three projects                    | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | the Owner records a verdict                                          |
| **FE-002** | end-to-end verified | delivery eligibility (`:231`)     | #357 (`fc58f1c2`), #362 (`78d34fbc`), the Start selector #377 (`9b109f63`)                                     | § 10.4 steps 106, 115 and 116; § 10.7, `the handover record shows its own facts`, three projects                                       | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | verdict                                                              |
| **FE-003** | end-to-end verified | authorized receiver (`:232`)      | #357 (`fc58f1c2`), #362 (`78d34fbc`)                                                                           | § 10.4 steps 107 and 157; § 10.7, `the handover record shows its own facts`, three projects                                            | **remaining engineering** — the receiver's optional identity evidence: D-18 approved an optional document category under the existing scoped access rules (`owner-decisions-2026-09-10.md` § 5), the category is not seeded (**CC-26**), and the receiver panel captures none and records that as a gap (`apps/web/src/features/delivery/components/ReceiverPanel.tsx:49-60`); collection stays optional                                              | a Backend slice for the category, the Frontend lane for the capture | the category seeded and an optional capture proven in a recorded run |
| **FE-004** | end-to-end verified | delivery checklist (`:233`)       | P-9 #355, P-9b #363 (`07193258`), #362 (`78d34fbc`), browser cases #393 (`6e50c161`)                           | § 10.4 steps 113, 114, 155 and 156; § 10.7, `delivery-writes-p1-31.spec.ts:264`, three projects                                        | **remaining engineering** — the checklist-template administration screen and its adapters (`coverage-record.md` H-1; its three writes are among **CC-57 (a)**'s seven). The matrix row and H-1 call it FE-004's unfinished half, while § 2.1 above routed its scope to the Owner; no decision record carries that question, so none is raised, and naming the work decides no scope                                                                   | the Frontend lane                                                   | the screen and its adapters merged and proven in a recorded run      |
| **FE-005** | end-to-end verified | final odometer (`:234`)           | #362 (`78d34fbc`), browser cases #393 (`6e50c161`)                                                             | § 10.4 steps 117 and 118; § 10.7, `delivery-writes-p1-31.spec.ts:646`, three projects                                                  | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | verdict                                                              |
| **FE-006** | end-to-end verified | delivery signatures (`:235`)      | #357 (`fc58f1c2`), #362 (`78d34fbc`), browser cases #393 (`6e50c161`)                                          | § 10.4 steps 108 to 112; § 10.7, `delivery-writes-p1-31.spec.ts:479`, three projects                                                   | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | verdict                                                              |
| **FE-007** | end-to-end verified | delivery document (`:236`)        | #368 (`8c4e6a9c`); the stamped employee name from P-17, #370 (`811e9891`)                                      | § 10.4 step 118; § 10.7, `the printable copy is produced and prints exactly once`, three projects                                      | **none**. The sheet prints the stamped display name when the record carries one (`apps/web/src/features/delivery/components/DeliveryDocument.tsx:183-188`); **CC-32**'s state cell still reads `open`, no § 10 case asserts the name, and annotating the register is change control's, not an item of this task                                                                                                                                       | the Owner, for the verdict                                          | verdict                                                              |
| **FE-008** | end-to-end verified | warranty record (`:237`)          | #369 (`deb404c1`), #375 (`6c99e805`)                                                                           | § 10.4 steps 120 to 123; § 10.7, the list, record and plans-screen cases in `warranty-p1-31.spec.ts`, three projects                   | **none** — the plans-screen case § 3.1 of the record left incomplete passed in all three projects                                                                                                                                                                                                                                                                                                                                                     | the Owner, for the verdict                                          | verdict                                                              |
| **FE-009** | end-to-end verified | warranty history (`:238`)         | #375 (`6c99e805`); the reader P-18, #390 (`aa20c959`, register § 65); the ledger panel #396 (`32c79754`, § 69) | § 10.4 steps 531 and 532; § 10.7, `the warranty record shows the transition ledger the journey recorded`, three projects               | **none**. **CC-55 (a)** stands as recorded — the ledger holds one row on every record the product can create, and the register calls a status writer "a product decision nobody has been asked for"; no decision record puts it to the Owner, so none is raised                                                                                                                                                                                       | the Owner, for the verdict                                          | verdict                                                              |
| **FE-010** | end-to-end verified | operational dashboard (`:239`)    | #376 (`72782f48`)                                                                                              | § 10.4 steps 519, 520, 522, 524, 526 and 528; § 10.7, the two overview cases in `overview-p1-31.spec.ts`, three projects               | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | verdict                                                              |
| **FE-011** | end-to-end verified | work-order reports (`:240`)       | #371 (`46be4bb2`), dataset #374 (`6b3c6c45`), export #397 (`9729b2b5`), download control #398 (`c1a2f9fc`)     | § 10.4 steps 130 and 513; § 10.5, its export; § 10.7, the rows case and the tier-2 download case, three projects                       | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | verdict                                                              |
| **FE-012** | end-to-end verified | technician reports (`:241`)       | #371, #374, #397, #398                                                                                         | § 10.4 steps 131 and 514; § 10.5, its export over real HTTP; § 10.7, the `technician_labor_time` rows case, three projects             | **documented limitation** — G.8 (§ 10.13 item 8): the browser download ran for `work_orders_by_status` only. The criterion binds this screen and its states in both locales and at tablet width; it is one generic screen whose download control "Four report codes use the same path" (register § 69.14), passed in three projects, and this code's export is proven over HTTP, so the criterion's words do not call for more; carried, not accepted | the Owner, for the verdict                                          | verdict, with G.8 carried                                            |
| **FE-013** | end-to-end verified | inventory reports (`:242`)        | #371, #374, #397, #398                                                                                         | § 10.4 steps 132 and 515; § 10.5, its export over real HTTP; § 10.7, the `inventory_movements` rows case, three projects               | **documented limitation** — G.8, applied as on FE-012; carried, not accepted                                                                                                                                                                                                                                                                                                                                                                          | the Owner, for the verdict                                          | verdict, with G.8 carried                                            |
| **FE-014** | end-to-end verified | invoice/payment reports (`:243`)  | #371, #374, #397, #398                                                                                         | § 10.4 steps 133, 516, 175 and 176; § 10.5, its export over real HTTP; § 10.7, the `invoice_payment_summary` rows case, three projects | **documented limitation** — G.8, applied as on FE-012; carried, not accepted                                                                                                                                                                                                                                                                                                                                                                          | the Owner, for the verdict                                          | verdict, with G.8 carried                                            |
| **FE-015** | end-to-end verified | audit report (`:244`)             | #360 (`f8958e77`)                                                                                              | § 10.4 steps 134 and 135; § 10.7, the two cases in `audit-log-p1-31.spec.ts`, three projects                                           | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | verdict                                                              |
| **FE-016** | end-to-end verified | branch pilot summary (`:245`)     | #376 (`72782f48`)                                                                                              | § 10.4 steps 521, 523, 525, 527, 529 and 530; § 10.7, the branch-fixed overview case, three projects                                   | **none**                                                                                                                                                                                                                                                                                                                                                                                                                                              | the Owner, for the verdict                                          | verdict                                                              |

**Field 15 — Security.** Criterion `canonical-plan.md:256`, rows `:260-263`; definitions transposed
from P1-28 in [`security-and-qa-evidence.md`](./security-and-qa-evidence.md). The index's body is
measured at `fb65b049` and its § 17 adds the evidence of `c1a2f9fc` without re-deriving it.

| task        | state                  | required behaviour, with citation                            | existing implementation (PR / commit)                                                               | existing evidence (file : section)                                                                                                                                                              | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | responsible owner                                                                                   | completion condition                                          |
| ----------- | ---------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **SEC-001** | phase-level incomplete | least privilege and resolved scope (`:260`; § 1)             | #386 (`e2908f06`); minimal actors and the grant map #394 (`a0620bd2`); the export declaration #397  | index §§ 1, 1.1 and 17.1; register § 68.4 — 13 minimal actors; census 47 operations, 13 codes (§ 69.13); `acceptance-record.md` § 10.5 refusals and § 10.4 steps 174 to 176                     | **remaining engineering** — **CC-58 (a)**, the minimal-actor probe unable to see a service-level authority requirement, closed by driving each operation to a real success with its minimal caller; and the set-wide suites' execution at a protected head recorded in an acceptance record section. **Human certification** — the least-privilege judgement and the Security reviewer's clearance, not issued                                                                                                                                       | a Backend lane for CC-58 (a); the QA lane for the record; Eng. Ezzaldeen Al-Bitar for the clearance | CC-58 (a) closed and the proof recorded; the clearance issued |
| **SEC-002** | phase-level incomplete | sensitive data, export posture and file access (`:261`; § 2) | #385 (`474d89ef`) component negative; the export under D-6, #397 (`9729b2b5`) and #398 (`c1a2f9fc`) | index §§ 2, 2.1 and 17.1; `acceptance-record.md` § 10.5 — default administrator refused four codes, five audited exports — and § 10.7; `apps/web/tests/delivery-signature-refusal.dom.test.tsx` | **remaining engineering** — a server-side negative refusing the signature or identity-evidence document to an actor lacking the code, its execution recorded. **Documented limitation** — G.6 (§ 10.13 item 6): the audit cannot identify the bytes disclosed and there is no daily allowance; D-6 (`owner-decisions-2026-09-09.md` § 5) asks for explicit authorization and explicit auditability and names neither, so the criterion as decided does not call for more; carried, not accepted. **Human certification** — the clearance, not issued | a Backend lane for the negative; Eng. Ezzaldeen Al-Bitar for the clearance                          | the negative merged and recorded; the clearance issued        |
| **SEC-003** | phase-level incomplete | abuse cases and privilege escalation (`:262`; § 3)           | #386 (`e2908f06`); SEC-003-O1 settled by #391 (`852bcebd`, register § 66); replay sets #394         | index §§ 3 and 3.1; register §§ 59, 66 and 68.3; `acceptance-record.md` § 10.5                                                                                                                  | **remaining engineering** — **CC-56 (c)**, the claim guard at `apps/api/src/server/auth/authorization.ts:566-567` failing open on a branch-only claim, unreachable today and owned by "the next backend slice"; SEC-002's file-access negative; the probes' execution recorded in an acceptance record section. **Human certification** — the clearance, with **SEC-003-O2** (undispositioned by design, § 59.6) and the out-of-phase **CC-56 (b)** and **(d)** before it, not issued                                                                | a Backend lane; Eng. Ezzaldeen Al-Bitar for the clearance                                           | CC-56 (c) closed, the proof recorded; the clearance issued    |
| **SEC-004** | phase-level incomplete | security audit-event coverage (`:263`; § 4)                  | #384 (`af924cab`); the emission suite #394 (`a0620bd2`); the export audit action #397 (`9729b2b5`)  | register §§ 58 and 68.2 — 24 of 24 privileged actions with a set-completeness proof; `audit-class-review.md`; `acceptance-record.md` § 10.5; index §§ 17.1 and 17.2                             | **remaining engineering** — the emission suite's execution at a protected head recorded in an acceptance record section. **Documented limitation** — G.6: the export audit cannot identify the exact bytes (**CC-61 (c)**); the criterion is audit-event coverage, which § 10.5 shows for every export, and it does not name file provenance, so it does not call for more; carried, not accepted. **Human certification** — the clearance of the declarations, the four § 4 leaves open among them, not issued                                      | the QA lane for the record; Eng. Ezzaldeen Al-Bitar for the clearance                               | the proof recorded; the clearance issued                      |

**Field 16 — QA.** Criterion `canonical-plan.md:271-272`, rows `:276-280`.

| task       | state                  | required behaviour, with citation                  | existing implementation (PR / commit)                                                                                                      | existing evidence (file : section)                                                                                                                                                                              | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | responsible owner                                                                     | completion condition                                                                    |
| ---------- | ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **QA-001** | phase-level incomplete | unit and component coverage (`:276`; § 5)          | the coverage record #385 (`474d89ef`); its hosted fill #389 (`591763df`); later suites #396 (`32c79754`) and #398 (`c1a2f9fc`)             | `coverage-record.md` §§ 1–4, H-2 and H-3 FILLED and open; register § 63.10 (**CC-53**, **CC-50 (a)** closed); index § 5                                                                                         | **remaining engineering** — **H-2**, the P1-31 feature trees outside the web coverage instrument; **H-3**, the dashboard route tier exempt from its floor; **H-4**, the start-a-handover mount point no suite renders; the coverage record re-derived at one head with the suites added since. H-1 is counted on FE-004. **Human certification** — the QA lead's certification, not issued                                                                                                                                                                                                                                                                                                                                 | the Frontend and coverage-policy lanes; Eng. Ezzaldeen Al-Bitar for the certification | the holes closed or measured at one head; the certification issued                      |
| **QA-002** | phase-level incomplete | contract and error-path coverage (`:277`; § 6)     | the error-path matrix #394 (`a0620bd2`); the export contract #397 (`9729b2b5`)                                                             | register § 68.3 — 428 at 11 of 11, 409 at 11 of 11, replay 16 of 16 both halves, invalid body 27 of 27; § 69.13; `error-path-matrix.md`; `acceptance-record.md` § 10.4 steps 116, 156 and 157                   | **remaining engineering** — **CC-54 (b)**, the published contract listing no 404 for the delivery read and the warranty detail read, corrected at their declarations; the suites' execution recorded in an acceptance record section. **Genuine Owner decision** — the bare-object success schemas, `owner-decision-packet-2026-09-13.md` item **F-6**, recorded there as not blocking. **Human certification** — the QA lead's certification, not issued                                                                                                                                                                                                                                                                  | the lane owning the two reads; the Owner for F-6; Eng. Ezzaldeen Al-Bitar             | CC-54 (b) corrected and the proof recorded; F-6 answered; the certification issued      |
| **QA-003** | phase-level incomplete | tenant, company and branch isolation (`:278`; § 7) | the set probes #386 (`e2908f06`); the per-table negatives #394 (`a0620bd2`)                                                                | register §§ 59 and 68.5 — 16 of 16 tables with a behavioural negative; `isolation-matrix.md`; `acceptance-record.md` § 10.4 steps 157 to 162                                                                    | **remaining engineering** — both layers' set-wide execution at a protected head recorded in an acceptance record section; the index entry **CC-58 (b)** names corrected when the index is re-derived. **Human certification** — the QA lead's certification, not issued                                                                                                                                                                                                                                                                                                                                                                                                                                                    | the QA lane; Eng. Ezzaldeen Al-Bitar                                                  | the proof recorded and the index corrected; the certification issued                    |
| **QA-004** | phase-level incomplete | concurrency and idempotency (`:279`; § 8)          | #386 (`e2908f06`); replay sets #394 (`a0620bd2`); the version-sourcing gate #395 (`e97db8ce`)                                              | register §§ 67 and 68.3; `acceptance-record.md` § 10.4 steps 116 and 156                                                                                                                                        | **remaining engineering** — **CC-57 (a)**, seven guarded operations with no consumer, each closing with the surface that consumes it: three checklist-template writes (FE-004's screen), three report-configuration writes (their consumer is packet item **F-1**) and the employee-register transition; the suites' execution recorded in an acceptance record section. Packet **F-5**'s gate-or-waiver question is answered in fact by the gate § 67 built. **Human certification** — the QA lead's certification, not issued                                                                                                                                                                                            | the lanes owning those surfaces; Eng. Ezzaldeen Al-Bitar                              | the consumers carry version discipline, the proof is recorded; the certification issued |
| **QA-005** | phase-level incomplete | regression and evidence packaging (`:280`; § 9)    | harness #378 (`6005cfa4`), record #380 (`81b3bce8`), re-runs #387 (`fb65b049`) and #393 (`6e50c161`); the fixture runner #398 (`c1a2f9fc`) | `acceptance-record.md` § 10 — 532 HTTP steps with 0 not ok, 78 P1-31 browser cases executed and 0 failed, both Playwright reports retained — and § 10.12, the fixture proof at 12 of 12; index §§ 17.4 and 17.5 | **remaining engineering** — run `mu2ihptd`'s artefacts packaged as committed, digest-checked evidence. **Genuine Owner decision** — **D-16**, where phase evidence lands and which task owns the cited ids (`a0-preflight.md` D-16; packet **B-7**). **Documented limitation** — G.1, G.2, G.3, G.9 and G.10: G.3 bears on the packaging half, which calls for more; G.1 and G.2 leave the fixture proof automated and committed but run by no hosted job with a hand-taken falsifiability control, which the criterion's words do not name; G.9 is outside P1-31; G.10 is carried beside the figures § 10.13 item 10 names — all carried, not accepted. **Human certification** — the QA lead's certification, not issued | the QA lane for packaging; the Owner for D-16; Eng. Ezzaldeen Al-Bitar                | the evidence packaged where D-16 places it; the certification issued                    |

**Field 17 — DevOps.** Criterion `canonical-plan.md:288-289`, rows `:293-294`.

| task       | state               | required behaviour, with citation                               | existing implementation (PR / commit)                                                                                     | existing evidence (file : section)                                                                                                                                                                               | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | responsible owner                                                     | completion condition                                                            |
| ---------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **DO-001** | merged (write path) | continuous-integration quality gate (`:293`; § 10)              | P-16 #357 (`fc58f1c2`); the write-shape gate #384 (`af924cab`); the sourcing gate and allow-list repair #395 (`e97db8ce`) | index § 10; register §§ 67.3 and 67.4; the access gate run on this tree on 2026-09-15 — 10 pages, 12 segments, 7 deferred, 37 operation ids, 0 violations; `acceptance-record.md` § 10.1, check conclusions only | **remaining engineering** — the criterion's rollback-criteria and operator-runbook limbs recorded for the three gates (`developer-guidance.md` § 3 lists their commands only), and their hosted execution at a protected head recorded in an acceptance record section as the proof. **Documented limitation** — G.5 (§ 10.13 item 5): the job summary renders one of two unrun registers (**CC-62 (c)**); the second stays readable and validated in the committed baseline, so observable execution is reduced on one surface and the criterion's words do not call for more; carried, not accepted                                                                                                                        | the DevOps Owner, Eng. Ezzaldeen Al-Bitar (combined-role model)       | both limbs recorded and the execution recorded                                  |
| **DO-002** | merged (write path) | structured logging, monitoring and alert routing (`:294`; § 11) | the operator runbook #383 (`ea3b7fc0`); the local fault router, its suite and `monitoring-runbook.md` #398 (`c1a2f9fc`)   | `monitoring-runbook.md`; register § 69.14 — the injected-fault rehearsal at the pre-merge local head `c2235b97`; `acceptance-record.md` § 10.9 — 1799 read, 0 routed; index § 17.6                               | **remaining engineering** — an alert routed from a qualifying failure record at a protected head, recorded in an acceptance record section. **Documented limitation** — G.7 (§ 10.13 item 7): a local sanitized queue and no external notification; the criterion names alert routing, not an external transport, so its words do not call for more; carried, not accepted. **Genuine Owner decision** — **D-10** (`a0-preflight.md` D-10; packet **B-4**, not blocking there), and packet **F-4**'s authorisation of the four operator acts beyond the shared local database, on which **CC-16** and **CC-20** stay open; F-4's runbook-owner limb is met by the existing DevOps Owner assignment and is not a new question | the DevOps Owner, Eng. Ezzaldeen Al-Bitar; the Owner for D-10 and F-4 | the routed alert recorded; D-10 and F-4 answered; the acts run where authorised |

**Field 18 — Documentation.** Criterion `canonical-plan.md:307-308`, rows `:312-313`.

| task        | state                      | required behaviour, with citation                                     | existing implementation (PR / commit)                                                                                                                                           | existing evidence (file : section)                                                                                                   | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | responsible owner                                        | completion condition                                       |
| ----------- | -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| **DOC-001** | merged (read-only/partial) | contract, catalog and traceability synchronisation (`:312`; § 12)     | corrections #1 and #2, #354 (`0272390b`); correction #3, #383 (`ea3b7fc0`); `canonical-reference-map.md`, #398 (`c1a2f9fc`); the export's contract artefacts, #397 (`9729b2b5`) | `canonical-reference-map.md`; register §§ 57.2, 69.13 and 69.14; index § 12                                                          | **remaining engineering** — the Field 34 synchronisation set outside the repository (traceability matrix, deliverable manifest, change log, acceptance evidence index) brought up to date for P1-31. **Documented limitation** — G.4 (§ 10.13 item 4): the P1-24 register credits one suite for the export operation; it is regenerated by its controlled tool and undercounts attribution, not operations, so synchronisation does not call for more; carried, not accepted. **Genuine Owner decision** — correction #4, `OWR-2026-09-06-G-10` (packet **E-1**); **D-14** (packet **B-6**, not blocking there); **D-16** (packet **B-7**) | the documentation lane; the Owner for E-1, D-14 and D-16 | the external set synchronised; E-1, D-14 and D-16 answered |
| **DOC-002** | merged (read-only/partial) | operator and developer guidance, and the change record (`:313`; § 13) | the operator runbook #383 (`ea3b7fc0`); `developer-guidance.md` and `monitoring-runbook.md`, #398 (`c1a2f9fc`); the register through § 71                                       | `operator-runbook.md`, `developer-guidance.md`, `monitoring-runbook.md`; register §§ 57 to 71; `owner-decision-packet-2026-09-13.md` | **remaining engineering** — the controlled record as it now stands, with both guidance documents, register sections 63 to 71 and acceptance record § 10, routed to the named approval owner; the routing of 2026-09-13 carried the record as it stood that day. **CC-16** and **CC-20** are counted on DO-002                                                                                                                                                                                                                                                                                                                              | the documentation lane                                   | the current record routed to the approval owner            |

### 2.9 Totals, and the five categories, at `c1a2f9fc`

| state                        | count  | rows                               |
| ---------------------------- | ------ | ---------------------------------- |
| `end-to-end verified`        | **16** | FE-001 … FE-016                    |
| `merged (write path)`        | **2**  | DO-001, DO-002                     |
| `merged (read-only/partial)` | **2**  | DOC-001, DOC-002                   |
| `in open PR`                 | **0**  | —                                  |
| `phase-level incomplete`     | **9**  | SEC-001 … SEC-004, QA-001 … QA-005 |
| `not started`                | **0**  | —                                  |
| **total**                    | **29** | —                                  |

_(§ 2.6 counted 12 / 3 / 5 / 0 / 9 / 0 at `fb65b049`, and the matrix's amendment of 2026-09-14
counted fifteen `end-to-end verified` on evidence taken at a branch head. Both were true when
written. Since then FE-004, FE-005 and FE-006 are proven at a protected head, FE-009 is raised on
§ 10.4 steps 531 and 532 and its browser case, and DO-001 and DO-002 move to `merged (write path)`.
No row is lowered.)_

| category                        | count  | rows, with the item's reference                                                                                                                                                            |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| none beyond the Owner's verdict | **11** | FE-001, FE-002, FE-005, FE-006, FE-007, FE-008, FE-009, FE-010, FE-011, FE-015, FE-016                                                                                                     |
| remaining engineering           | **15** | FE-003, FE-004, SEC-001, SEC-002, SEC-003, SEC-004, QA-001, QA-002, QA-003, QA-004, QA-005, DO-001, DO-002, DOC-001, DOC-002                                                               |
| documented limitation           | **9**  | FE-012, FE-013, FE-014 (G.8); SEC-002, SEC-004 (G.6); QA-005 (G.1, G.2, G.3, G.9, G.10); DO-001 (G.5); DO-002 (G.7); DOC-001 (G.4)                                                         |
| human certification             | **9**  | SEC-001, SEC-002, SEC-003, SEC-004 (the Security reviewer's clearance); QA-001, QA-002, QA-003, QA-004, QA-005 (the QA lead's certification) — owed by Eng. Ezzaldeen Al-Bitar, not issued |
| genuine Owner decision          | **4**  | QA-002 (F-6); QA-005 (D-16); DO-002 (D-10, F-4); DOC-001 (E-1, D-14, D-16)                                                                                                                 |

**The arithmetic.** The four categories other than `none` overlap. Their union is **eighteen
distinct rows** — the thirteen non-Frontend rows, and FE-003, FE-004, FE-012, FE-013 and FE-014 —
and 18 + 11 = **29**. Each of the ten limitations G.1 to G.10 is placed on at least one row. The
verdict is owed by all twenty-nine and is counted once, as gate condition 4; the verdict field in § 4
stays empty.

**Sixteen of twenty-nine `end-to-end verified` is not a pass and is not offered as one.** The Owner's
instruction of 2026-09-15:

> Do not equate a merged PR, collection count, index or browser smoke with full phase acceptance.

### 2.10 The twenty-nine tasks re-derived at `849a8e9a` (2026-09-16)

**Measured at protected `develop` `849a8e9a7d8960e784456d5d886d5976350f0b24`**, tree `b8390f33`, the
merge of PR #400 of 2026-09-15T23:32:04Z, whose first parent is `c7298c09` (PR #399) and whose second
parent is `bb9802fd`. **§§ 2.8 and 2.9 are retained and are superseded by this subsection and § 2.11**,
exactly as §§ 2.1–2.7 are retained and superseded by them. Every figure in § 2.8 was true of
`c1a2f9fc` when it was written.

**What counts as each row's own proof, at this head.** A Frontend row's proof is the closing
acceptance run **attempt 4**, run `mu3ch41f`, of [`acceptance-record.md`](./acceptance-record.md)
**§ 11**, taken at this protected head: its HTTP steps, and its browser cases each passing in
`authenticated-en`, `authenticated-ar` and `authenticated-tablet`. **A security, QA, DevOps or
documentation row is judged by the proof its own criterion calls for, and a browser case is not that
proof.** The two Owner quotations § 2.8 records for this rule are not repeated here; they govern this
subsection unchanged.

**The five categories are § 2.8's, unchanged**: **none** beyond the Owner's verdict; **remaining
engineering**; **documented limitation**; **human certification**; **genuine Owner decision**. A row
may carry items in several; `none` is exclusive. **Human certification is owed by an assigned
reviewer, and none is issued** — the QA and security reviewer roles are already held under
[`solo-developer-review-policy.md`](../../governance/solo-developer-review-policy.md), this subsection
appoints nobody, and **no certification and no clearance is recorded as issued anywhere in it**.

**The state column is [`task-matrix.md`](./task-matrix.md)'s own value**, as that file's amendment of
2026-09-16 derives it at this head; it is quoted, not derived here.

**No row's state changed between `c1a2f9fc` and `849a8e9a`.** The engineering that merged in #399 and
#400 changed what rows still owe, not what they have reached. The table records the change in
obligation.

**Field 14 — Frontend.**

| task       | state               | what merged or was proven since `c1a2f9fc`                                                                                                                                                                                               | remaining, each item classified                                                                               |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **FE-001** | end-to-end verified | re-proven at this head: § 11.6, the two readiness cases, three projects                                                                                                                                                                  | **none**                                                                                                      |
| **FE-002** | end-to-end verified | re-proven: § 11.6, the handover-record case, three projects                                                                                                                                                                              | **none**                                                                                                      |
| **FE-003** | end-to-end verified | the optional identity-evidence category is in the repository seed and applied to the one shared acceptance database; the capture merged with #400; the server validates it; **two committed browser cases passed in all three projects** | **none** — the row's former remaining-engineering item is closed                                              |
| **FE-004** | end-to-end verified | nothing                                                                                                                                                                                                                                  | **remaining engineering** — the checklist-template administration screen and its adapters (coverage hole H-1) |
| **FE-005** | end-to-end verified | re-proven: § 11.6, three projects                                                                                                                                                                                                        | **none**                                                                                                      |
| **FE-006** | end-to-end verified | re-proven: § 11.6, three projects                                                                                                                                                                                                        | **none**                                                                                                      |
| **FE-007** | end-to-end verified | re-proven: § 11.6, the printable-copy case, three projects                                                                                                                                                                               | **none**                                                                                                      |
| **FE-008** | end-to-end verified | re-proven: § 11.6, the warranty cases, three projects                                                                                                                                                                                    | **none**                                                                                                      |
| **FE-009** | end-to-end verified | re-proven: § 11.4, the transition-ledger read and its genesis-only assertion                                                                                                                                                             | **none**                                                                                                      |
| **FE-010** | end-to-end verified | re-proven: § 11.4 and § 11.6, three projects                                                                                                                                                                                             | **none**                                                                                                      |
| **FE-011** | end-to-end verified | re-proven: § 11.5 its export, § 11.6 the tier-2 download case, three projects                                                                                                                                                            | **none**                                                                                                      |
| **FE-012** | end-to-end verified | its export again proven over real HTTP (§ 11.5)                                                                                                                                                                                          | **documented limitation** — the browser download ran for one report code only; carried, not accepted          |
| **FE-013** | end-to-end verified | its export again proven over real HTTP                                                                                                                                                                                                   | **documented limitation** — as FE-012                                                                         |
| **FE-014** | end-to-end verified | its export again proven over real HTTP                                                                                                                                                                                                   | **documented limitation** — as FE-012                                                                         |
| **FE-015** | end-to-end verified | re-proven: § 11.6, the two audit-log cases, three projects                                                                                                                                                                               | **none**                                                                                                      |
| **FE-016** | end-to-end verified | re-proven: § 11.4, the branch-fixed overview and its agreement assertion                                                                                                                                                                 | **none**                                                                                                      |

**Field 15 — Security.** Every row keeps `phase-level incomplete`.

| task        | what merged or was proven since `c1a2f9fc`                                                                                                                                            | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEC-001** | the export declaration and the run's refusals are re-exercised (§ 11.5)                                                                                                               | **remaining engineering** — the minimal-actor probe limitation, and the set-wide suites' execution at a protected head **recorded**, which § 11.11 (a) shows is not available at this head. _(2026-09-16: **now available and recorded** at § 11.11 (e) — 19 check runs at this head, all `success`. **The recording limb of this item is closed; the minimal-actor probe limitation is not**, so this row keeps a remaining-engineering item and does not move.)_ **human certification** — the clearance, not issued |
| **SEC-002** | **the server-side refused-download negative EXISTS** (#399), and receiver identity evidence is captured and server-validated (#400), with two browser cases passing in three projects | **remaining engineering** — that suite's execution at a protected head recorded. **documented limitation** — the audit cannot identify the bytes disclosed; **branch scoping on download is proven for one case only**; a soft-deleted target stays reachable; runtime reachability covers three of nine link types. **human certification** — not issued                                                                                                                                                              |
| **SEC-003** | the claim guard's fail-closed half is closed (#399)                                                                                                                                   | **remaining engineering** — the probes' execution at a protected head recorded. **human certification** — the clearance, with the two observations undispositioned by design before it, not issued                                                                                                                                                                                                                                                                                                                     |
| **SEC-004** | the export audit is re-exercised: five exports, each with exactly one correlated event (§ 11.5)                                                                                       | **remaining engineering** — the emission suite's execution recorded. **documented limitation** — the export audit records selection and counts, not bytes. **human certification** — not issued                                                                                                                                                                                                                                                                                                                        |

**Field 16 — QA.** Every row keeps `phase-level incomplete`.

| task       | what merged or was proven since `c1a2f9fc`                                                                                                                                                                                 | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QA-001** | **H-2, H-3 and H-4 closed in code** on the merged branch; `signature-capture.ts` moved 0/25 → 25/25 lines; 141 → 186 instrumented files — **every figure labelled LOCAL by its own record**                                | **remaining engineering** — the hosted web-quality measurement those figures are pending; H-1 is counted on FE-004. **human certification** — not issued                                                                                                                                                                                                                                        |
| **QA-002** | **the two published not-found responses are corrected** (#399)                                                                                                                                                             | **remaining engineering** — the suites' execution recorded; and a **new contract gap**, the quality-control record detail publishing its success body as a bare object. **genuine Owner decision** — the bare-object success schemas. **human certification** — not issued                                                                                                                      |
| **QA-003** | the index entry that read two constraint suites as isolation evidence is **true at this head**, its code half repaired                                                                                                     | **remaining engineering** — both layers' set-wide execution recorded. **human certification** — not issued                                                                                                                                                                                                                                                                                      |
| **QA-004** | nothing                                                                                                                                                                                                                    | **remaining engineering** — the seven guarded operations with no consumer, each closing with the surface that consumes it; the suites' execution recorded. **human certification** — not issued                                                                                                                                                                                                 |
| **QA-005** | **the run of record is attempt 4** — 740 HTTP steps, 0 not ok, 0 findings; 84 P1-31 browser cases executed, 0 failed; both tier reports retained — and **attempt 3's journey is qualified** by its guessed record versions | **remaining engineering** — the run's artefacts packaged as committed, digest-checked evidence. **genuine Owner decision** — where phase evidence lands. **documented limitation** — the instruments outside the repository, the hand-taken falsifiability control, the fixture proof run by no hosted job, the earlier-phase skips, the labelling minors. **human certification** — not issued |

**Field 17 — DevOps.** Both rows keep `merged (write path)`.

| task       | what merged or was proven since `c1a2f9fc`                                                                                                                                                    | remaining, each item classified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DO-001** | **the rollback-criteria and operator-runbook limbs are recorded** for the three P1-31 gates, in [`operator-runbook.md`](./operator-runbook.md) § 11 (#400)                                    | **remaining engineering** — their execution at a protected head recorded, which § 11.11 (a) shows is unavailable here. _(2026-09-16: **now available and recorded** at § 11.11 (e); all three gates run inside the policy aggregate the `hosted-clean-room` job executes. **This closes the only remaining-engineering item this row carried.** Its state is not moved here — the matrix owns state under its own rule — and the documented limitation below stands.)_ **documented limitation** — the job summary renders one of two unrun registers |
| **DO-002** | **an alert was routed at this protected head and is recorded in an acceptance record section** (§ 11.8): unit suite 8 of 8, command exit 0, read 1, routed 1, canary absent from both outputs | **remaining engineering** — routing from a **qualifying failure record of a real run**; the run itself routed 0 and the rehearsal's fault is injected. **documented limitation** — a local sanitized queue, no external notification. **genuine Owner decision** — the event-consumption question, and the authorisation of the operator acts beyond the one shared database                                                                                                                                                                          |

**Field 18 — Documentation.** Both rows keep `merged (read-only/partial)`.

| task        | what merged or was proven since `c1a2f9fc`                                                                                                  | remaining, each item classified                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DOC-001** | the export's contract artefacts and the two published not-found responses are on the tree                                                   | **remaining engineering** — the external synchronisation set. **documented limitation** — the register's substring attribution. **genuine Owner decision** — three named items |
| **DOC-002** | the controlled record grew: both guidance documents, the monitoring runbook, register sections through **§ 72**, and acceptance record § 11 | **remaining engineering** — routing the record **as it now stands** to the named approval owner                                                                                |

### 2.11 Totals, and the five categories, at `849a8e9a`

| state                        | count  | rows                               |
| ---------------------------- | ------ | ---------------------------------- |
| `end-to-end verified`        | **16** | FE-001 … FE-016                    |
| `merged (write path)`        | **2**  | DO-001, DO-002                     |
| `merged (read-only/partial)` | **2**  | DOC-001, DOC-002                   |
| `in open PR`                 | **0**  | —                                  |
| `phase-level incomplete`     | **9**  | SEC-001 … SEC-004, QA-001 … QA-005 |
| `not started`                | **0**  | —                                  |
| **total**                    | **29** | —                                  |

_(§ 2.9 counted the same 16 / 2 / 2 / 0 / 9 / 0 at `c1a2f9fc`, and § 2.6 counted 12 / 3 / 5 / 0 / 9 / 0
at `fb65b049`. All were true when written. **No row rose and no row was lowered between `c1a2f9fc`
and `849a8e9a`.**)_

| category                        | count  | rows                                                                                                                               |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| none beyond the Owner's verdict | **12** | FE-001, FE-002, **FE-003**, FE-005, FE-006, FE-007, FE-008, FE-009, FE-010, FE-011, FE-015, FE-016                                 |
| remaining engineering           | **14** | FE-004, SEC-001 … SEC-004, QA-001 … QA-005, DO-001, DO-002, DOC-001, DOC-002                                                       |
| documented limitation           | **9**  | FE-012, FE-013, FE-014; SEC-002, SEC-004; QA-005; DO-001; DO-002; DOC-001                                                          |
| human certification             | **9**  | SEC-001 … SEC-004 (the security clearance); QA-001 … QA-005 (the QA certification) — owed by the assigned reviewer, **not issued** |
| genuine Owner decision          | **4**  | QA-002, QA-005, DO-002, DOC-001                                                                                                    |

**The arithmetic.** The four categories other than `none` overlap. Their union is **seventeen distinct
rows** — the thirteen non-Frontend rows, and FE-004, FE-012, FE-013 and FE-014 — and 17 + 12 = **29**.
_(§ 2.9 counted 11 / 15 / 9 / 9 / 4 over a union of eighteen. **The single move is FE-003**, whose
remaining engineering closed on the seeded category, the merged capture, the server-side validation
and two browser cases passing in all three authenticated projects; it leaves `remaining engineering`
and joins `none`.)_ The verdict is owed by all twenty-nine and is counted once, as gate condition 4;
**the verdict field in § 4 stays empty.**

**One absence bears on eight rows at once.** **No hosted check run is recorded for `849a8e9a`**, and
none is available to cite: no evidence directory captured one for this head, and the environment that
wrote this record has no authenticated client to query one
([`acceptance-record.md`](./acceptance-record.md) § 11.11 (a)). **Every remaining item of the form
"the suites' or the gates' execution at a protected head, recorded" is therefore still open** — on
SEC-001, SEC-002, SEC-003, SEC-004, QA-002, QA-003, QA-004 and DO-001. Nothing here treats that
absence as satisfied, and no run is invented to fill it.

_(2026-09-16, later the same day: **the paragraph above is retained and was true when written** — the
environment that wrote it had no authenticated client. **The absence is closed, and not by a new run.**
The hosted check runs at `849a8e9a` were read from the repository's own API and are recorded at
[`acceptance-record.md`](./acceptance-record.md) § 11.11 (e). **§ 2.12 below re-derives all eight rows
and every count**, and states which moved.)_

**Sixteen of twenty-nine `end-to-end verified` is not a pass and is not offered as one.** No QA
certification and no security clearance is issued, and the Owner's verdict is not recorded.

### 2.12 The eight rows re-derived once the hosted runs are recorded (2026-09-16)

**What this sub-section is.** § 2.11's "one absence" is closed from an artefact that already existed:
the hosted check runs at `849a8e9a` and at `13732477`, read from the repository's own API and recorded
at [`acceptance-record.md`](./acceptance-record.md) § 11.11 (e) with the job-to-suite mapping the
workflow definitions support. **No job was dispatched or re-run, and no run was invented.**

**What the runs establish, and what they do not.** They establish that the named jobs executed at a
protected head and each concluded `success` — so the merged backend, database and unit tiers, the web
suites, the coverage ratchets and the policy aggregate carrying the three P1-31 gates each have a
citable execution at a protected head. **They are not a human certification and not a verdict.** A row
whose other outstanding item is the QA certification or the security clearance **stays
`phase-level incomplete`**, because a hosted run cannot supply a determination a person owes.

| row         | the recording limb                                | what still stands                                                                                             | state       |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| **SEC-001** | **closed** — the set-wide suites ran at this head | the minimal-actor probe limitation (**CC-58 (a)**) **and** the clearance, unissued                            | **no move** |
| **SEC-002** | **closed** — the refused-download negative ran    | four documented limitations **and** the clearance, unissued                                                   | **no move** |
| **SEC-003** | **closed** — the escalation probes ran            | **SEC-003-O2** open **and** the clearance, unissued                                                           | **no move** |
| **SEC-004** | **closed** — the audit-emission suite ran         | the export audit records selection and counts, not bytes, **and** the clearance, unissued                     | **no move** |
| **QA-002**  | **closed** — the contract suites ran              | the bare-object success-body contract gap, an Owner decision, **and** the certification, unissued             | **no move** |
| **QA-003**  | **closed** — both layers' isolation proofs ran    | the certification, unissued                                                                                   | **no move** |
| **QA-004**  | **closed** — the concurrency suites ran           | the seven guarded operations with no consumer **and** the certification, unissued                             | **no move** |
| **DO-001**  | **closed** — all three gates ran in the aggregate | the job summary rendering one of two unrun registers. **This row owes no human certification** — see the note | **no move** |

**QA-001 is deliberately absent from that table, and the distinction is the point.** Its remaining item
is **the hosted coverage measurement**, not a suite's execution. The hosted `web-quality` job **ran and
concluded `success`** — that is the gate's execution — but **the coverage figures in the record remain
local measurements** and keep their own `LOCAL` labelling, because no hosted artefact publishes the
per-file web summary they come from (**CC-50 (a)**, open). **QA-001's item does not close.**

_(2026-09-16, correction to the identifier, not to the substance — the paragraph above keeps its
words. **Its substance is unchanged and is not weakened: QA-001's item does not close, the coverage
figures are LOCAL measurements, and a hosted gate execution does not convert a local figure into a
hosted one.** **The attribution is what is corrected. CC-50 (a) is CLOSED, not open.** Its whole
content, at change control § 60.5, is that the per-file web coverage summary reached no reader, so
H-2 and H-3 could be filled from no hosted artefact; the remedy landed with **#389**, hosted run
`34778434228` carried both files, and § 63.10 filled H-2 and H-3 from it — § 63.8 carries the dated
closure note, and § 70.7 excludes the row from the open set by name. **The open fact here is later and
different**: the record's figures were re-measured **locally** once three feature roots entered
`COVERAGE_INCLUDE`, and **no hosted run has been read for those figures**. That is **CC-64 (b)** on its
own content, corrected in the register at § 73.4 and § 73.6. **No row moves, and QA-001 stays
`phase-level incomplete`.**)_

_(2026-09-16, beside the **DO-001** row of the table above and the paragraph below it, both of which
keep their words. **The state question this subsection recorded as open rather than decided has since
been answered, by the file it belongs to, and the answer is that the row does not move.**
[`task-matrix.md`](./task-matrix.md)'s amendment of 2026-09-16, "DO-001's state question, answered
against this file's own rule", quotes the rule — the `end-to-end verified` definition and rule 2 — and
applies it. **Outcome: DO-001 stays `merged (write path)`.** The rule's conditions are **not** shown
satisfied: what closed is a **recording limb** and not the criterion's proof, the row still carries the
live documented limitation **CC-62 (c)** on the gate's own observable surface, and **a state does not
move because a citation was added** to runs that already existed and had only never been indexed.
**Nothing is raised and nothing is lowered**, so every count in this subsection stands exactly as
derived: `16 / 2 / 2 / 0 / 9 / 0`, total **29**, and the five categories unchanged. **CC-64 (a) is
closed** by that determination, at change control § 74.)_

**Every count re-derived, with whether it moved.**

| figure                                              | at § 2.11    | now           | moved?                                                         |
| --------------------------------------------------- | ------------ | ------------- | -------------------------------------------------------------- |
| state totals `16 / 2 / 2 / 0 / 9 / 0`, total **29** | 16/2/2/0/9/0 | **identical** | **NO.** No row rose and none was lowered                       |
| `none beyond the Owner's verdict`                   | **12**       | **12**        | **NO**                                                         |
| `remaining engineering`                             | **14**       | **9**         | **YES** — five rows leave it                                   |
| `documented limitation`                             | **9**        | **9**         | **NO**                                                         |
| `human certification`                               | **9**        | **9**         | **NO** — nine determinations are still owed and none is issued |
| `genuine Owner decision`                            | **4**        | **4**         | **NO**                                                         |
| the union of the four overlapping categories        | **17**       | **17**        | **NO**, and 17 + 12 = **29** still holds                       |

**The one count that moves, shown so it can be checked rather than believed.** `remaining engineering`
read **14** — FE-004, SEC-001 … SEC-004, QA-001 … QA-005, DO-001, DO-002, DOC-001, DOC-002. **Five
rows leave it**, because the recording limb was the only remaining-engineering item each of them
carried: **SEC-002, SEC-003, SEC-004, QA-003 and DO-001**. It now reads **9** — FE-004, SEC-001,
QA-001, QA-002, QA-004, QA-005, DO-002, DOC-001, DOC-002. **The union does not move**, because each of
the five stays in the union through another category: SEC-002 and SEC-004 through both a documented
limitation and the clearance, SEC-003 and QA-003 through the clearance and the certification, DO-001
through its documented limitation.

**DO-001 is the one row whose state question is now open, and this record does not answer it.** Its
only remaining-engineering item is closed and **it owes no human certification**, so what remains is a
documented limitation. Whether that permits a rise is **a state decision, and state belongs to
[`task-matrix.md`](./task-matrix.md) under its own rule** — so **nothing here moves it**, and the
question is recorded as open rather than decided.

**What this sub-section does not claim.** **No row rises and none is lowered.** **No QA certification
and no security clearance is issued, recorded or implied**, and no Owner verdict. **Sixteen of
twenty-nine `end-to-end verified` is still not a pass and is not offered as one.** No hosted run was
taken to produce any figure here, and the Definition-of-Done adjudication at § 3 is not reopened by it.

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
own basis.)_ _(2026-09-16: the open set is re-derived at protected `develop` `849a8e9a` as **41**
identifiers — change control § 70.7: twenty-two raised at or before § 62 and nineteen raised by
§§ 63 to 72, with four more holding no usable disposition. **CC-31** and **CC-52 (c)** are not among
them: each is excluded by name there, because a recorded measurement closes it on the condition its own
cell set while that cell still reads open. **CC-54 (d)** closes as the pull request
that lands these records lands, and § 70 raises five open sub-rows of its own, so the set is **45** as
that pull request leaves the register. The
**26** above was true of `fb65b049` on § 62.6's basis and is not carried to the new head by this note.
The verdict — **not evidenced** — is unchanged.)_ The isolation
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

_(2026-09-15: "the record's own § 1 verdict remains **PARTIAL**" was not true when this bullet was
written. It was written after commit `0e40fd42`, merged with #387 at `fb65b049`, replaced § 1 of the
acceptance record, and [`acceptance-record.md:27`](./acceptance-record.md) records an engineering
verdict of PASS for run `mtzmvemj` — an engineering result for that one run, not the Owner's phase
verdict, which remains unrecorded. The closing run `mu2ihptd` of the record's § 10 records
measurements and no verdict (§ 10.14). The bullet is left as written, and this note issues no
verdict.)_

## 4. Gate P1-G31 — the four conditions, and what exists

Quoted from [`canonical-plan.md:464-472`](./canonical-plan.md):

> Gate P1-G31: RootLco may authorize dependent work only when the Definition of Done is evidenced,
> the QA lead certifies the test/evidence index, the Security reviewer clears applicable blockers,
> and the approval owner records Pass / Conditional Pass / Fail / Deferred with conditions. Until
> then, status remains Planned.

| condition                                    | what existed on `develop` `fb65b049`, when this table was written                                                                                                                                                                                                                                                                                                                                                          | what is missing                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.** the Definition of Done is evidenced   | twelve tasks `end-to-end verified` and three more with their write paths exercised; a 194-step HTTP journey with zero findings and 40 of 40 P1-31 browser cases in the corrected re-run, with 28 screenshots and zero shot failures; two phase gates — `validate:p1-31-access` and `validate:p1-31-write-shape` — registered and run by `verify:policies`; a runbook; a phase coverage record; a set-wide escalation suite | **all four bullets fall short** (§ 3). Seventeen tasks are not linked to evidence of their own completion; no task can satisfy its own Test reference; the monitoring half of DO-002 does not exist; `documentation/` is absent; the four operator acts are unperformed everywhere but one database; and no Owner decision exists |
| **2.** the QA lead certifies the index       | the index [`security-and-qa-evidence.md`](./security-and-qa-evidence.md), thirteen sections re-measured at this head, plus [`acceptance-record.md`](./acceptance-record.md), [`coverage-record.md`](./coverage-record.md), [`audit-class-review.md`](./audit-class-review.md) and [`task-matrix.md`](./task-matrix.md)                                                                                                     | **no certification, and no certifier.** The index is marked OPEN and **no QA lead is named in this repository**. A record is not a certificate of itself, and appointing a role holder is not an engineering act — packet item **A-2**                                                                                            |
| **3.** the Security reviewer clears blockers | SEC-001 … SEC-004 as §§ 1–4 of the index; the acceptance record's refusal, concurrency and isolation cases; the write-shape gate and the audit-class review; the set-wide escalation suite of § 59                                                                                                                                                                                                                         | **no clearance, and no reviewer.** No Security reviewer is named in this repository. The open security-relevant dispositions of § 5.1 are recorded, **none is formally accepted**, and SEC-003-O1 and SEC-003-O2 are undispositioned — packet item **A-3**                                                                        |
| **4.** the approval owner records a verdict  | **nothing**                                                                                                                                                                                                                                                                                                                                                                                                                | the verdict itself — see the field below                                                                                                                                                                                                                                                                                          |

_(2026-09-16, beside conditions **2** and **3** of the table above, whose cells keep their words and
were true of the head they were measured at. **They are superseded, and a reader of this section alone
would otherwise take the wrong reason from them.** The cells read "no certification, and no
certifier", "**no QA lead is named in this repository**", "no clearance, and no reviewer" and "No
Security reviewer is named in this repository". **The roles are held, and were already held when those
cells were written.** The owner-approved
[solo-developer review policy](../../governance/solo-developer-review-policy.md)`:18-20` assigns
Eng. Ezzaldeen Al-Bitar as technical, QA and security reviewer, and the Owner-Approved Combined-Role
Model at [`phase-1-1-owner-gate.md`](../phase-1-1/phase-1-1-owner-gate.md)`:135-136` records the same
assignment as explicitly approved by both founders. **This record's own dated correction of 2026-09-14
at `:3-9` said so first**, and
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 2 `:70-74` reads
these very sentences the same way: **as the absence of a CERTIFICATE, not of a certifier.** **So the
right reason for each cell is the one this note supplies:** what is outstanding is an **unissued
certification** and an **unissued clearance**, prepared for the holder already named and routed to
them. **Nobody is appointed or re-appointed here, no certification or clearance exists, none is
issued, implied or inferred, and no signature is written on anybody's behalf.** The packet-item
pointers in those cells — **A-2** and **A-3** — are the earlier packet's ids; the live item is **O-2**,
the independence question, which stays the Owner's. **Both conditions remain unsatisfied**, and the
verdict field below stays empty.)_

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
  _(2026-09-16: **"CC-50 (a) is open" is false at this head and is left as written**, having been true
  of the head this index was derived at. **CC-50 (a) is CLOSED**: its content is that the per-file web
  coverage summary reached no reader, its stated remedy landed with #389, hosted run `34778434228`
  carried both files, and change control § 63.10 filled H-2 and H-3 from it — § 63.8 carries the
  closure note and § 70.7 excludes the row from the open set by name. **The two figures it named are
  no longer the open thing**; what is open is that the record's **later** coverage figures are local
  measurements no hosted run has been read for, which is **CC-64 (b)**. **The open set at the current
  head is re-derived as 47** at change control § 70.7's dated note and § 74.3.)_
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

_(2026-09-16: true of the packet it names, which is retained. The live list at protected `develop`
`849a8e9a` is **[`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md)** —
**nineteen** items in three groups, **six** of them blocking, each re-checked against the committed
records, with the items since closed by engineering or by cited authority listed separately. The QA
and security items a named reviewer would answer are prepared at
**[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)**, whose decision
fields are empty. **No certification, clearance or verdict is created by either document.** Change
control § 70 / **CC-60** carries both.)_

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
- **The Field 34 external synchronisation set — assessed on 2026-09-16, and deliberately not
  performed.** DOC-001's surviving engineering item is the documentation chapters and registry files
  in the **parent workspace** that `canonical-plan.md:474-487` names and
  [`canonical-reference-map.md`](./canonical-reference-map.md)`:17-33` maps. **All ten targets exist**,
  and their byte lengths and SHA-256 digests were recomputed at protected `develop` `55131e44` and are
  **identical, every one, to the LOCAL inventory of 2026-09-14** at
  `orchestration/evidence/p1-31/astra-fe009-20260914/physical-canonical-reference-map.json` — nothing
  in the set has drifted. **The earlier claim that `documentation/` does not exist is already corrected
  at that map's `:52-58`**, and the sentences elsewhere in this record that repeat it keep their words
  as true when written. **The synchronisation owed is not mechanical and was therefore not done**: the
  chapter updates are conditioned on "**approved** findings", and no approval exists; the traceability
  matrix records "Actual executed acceptance evidence | 0" and every evidence cell as "Allocated — not
  produced", so writing P1-31 rows would declare evidence that `phase-1/_acceptance/README.md` forbids
  absent an added artefact (**P1-ASM-025**), which QA-005's unmet packaging half does not provide; the
  open-decision, risk and deliverable registers carry no P1-31 rows and adding them means choosing
  statuses; and appending a change-log row would assert a modification that has not been made and
  require that log's "Meaning Changed?" and "Review Required" values to be chosen — it attributes no
  approval, and the determination rests on the three reasons before it. **Nothing was written to any of
  the ten files, and none of them is committed by this repository.** It stays **remaining engineering**
  on DOC-001 and is **not** added to the Owner packet — DOC-001's genuine Owner items are already
  asked, as O-10, O-11 and O-12. Change control **§ 74.6** carries the full assessment. **DOC-001 does
  not move.** _(2026-09-16 — the change-log clause above is corrected in place, and the correction is
  noted rather than hidden: as first written it said that log's rows carry an "Approved by" column,
  which `documentation/_registry/change-log.md:4` does not — its columns end at "Review Required".
  Appending a row attributes no approval; the three reasons before it carry the determination, which is
  unchanged. Change control **§ 74.6** and **§ 74.11** record it. **Field 34 also names "API/error/event/
  test catalogs" and "data dictionary/ERDs where affected", which the ten inventoried targets do not
  cover**; they are uninventoried and unassessed, and § 74.6 records that too.)_

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

_(2026-09-16, beside conditions **2** and **3** of the table above, whose cells keep their words.
**Both cells give a superseded reason, and the conclusion each supports is unchanged.** They read "no
QA lead is named in this repository and no certification exists" and "no Security reviewer is named in
this repository and no clearance exists". **The first half of each is superseded**: the QA and security
reviewer roles are **held**, under
[solo-developer-review-policy.md](../../governance/solo-developer-review-policy.md)`:18-20` and the
Owner-Approved Combined-Role Model at
[`phase-1-1-owner-gate.md`](../phase-1-1/phase-1-1-owner-gate.md)`:135-136`, and this record's own
correction of 2026-09-14 at `:3-9` records that. **The second half of each stands exactly as written:
no certification exists and no clearance exists** — that is the absence that matters here, and it is
why both conditions are still unsatisfied. **The items a named reviewer would answer are prepared**, at
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md), **whose decision
fields are empty**. **Nobody is appointed here, nothing is certified or cleared, and the phase's
promotion ineligibility is unchanged** — gate P1-G31's four conditions are conjunctive and conditions
2, 3 and 4 are unsatisfied.)_

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
  _(2026-09-16: **this limitation is DISCHARGED and is left as written**, because it states the
  condition that discharged it. **The remedy landed on the lane it names**: #389 added both files to
  the `evidence-web-quality` upload list, hosted run `34778434228` is the first to carry them, and
  change control § 63.10 filled H-2 and H-3 from that artefact and from no earlier run. **CC-50 (a) is
  closed.** **What replaces it as a live limitation is not the same thing**: the coverage record's
  figures measured **after** three feature roots entered `COVERAGE_INCLUDE` are **LOCAL**, no hosted
  run has been read for them, and they keep their `LOCAL` labelling — **CC-64 (b)**, open, and
  limitation **L-2** of the certification packet, refined and **not lifted**. **H-2 and H-3 themselves
  remain OPEN** on the terms each states, which are about what is instrumented and what is enforced,
  not about missing numbers.)_
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
