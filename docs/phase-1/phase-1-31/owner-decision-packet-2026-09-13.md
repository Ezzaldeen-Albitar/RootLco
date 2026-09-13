# P1-31 — Owner decision packet

**Status:** OPEN, routed. **Nothing in this document is a decision, a verdict, an approval, a
certification or a clearance**, and nothing in it asserts that any gate ran, that any environment
exists, or that any approval was granted. It is the list of acts only the Owner can supply.

**Measured at** protected `develop` `fb65b0493d6ef2f8e65c00c39a2d51a42a98ff1f` — the merge of pull
request #387 — as the pull request that publishes this packet leaves the tree. Every `file:line`
citation below was resolved against that tree. Bare `.md` filenames are relative to
`docs/phase-1/phase-1-31/`; every other path is written in full from the repository root.

**No test tier, build, migration or deployment was run to produce this packet.** Every figure is a
static read of the tree, a figure quoted from a phase record with the place it is stated, or — in
item **F-8** only, and labelled there — a **read-only** query against the shared local acceptance
database.

---

## The inclusion criterion, stated once and applied once

> **An item belongs in this packet when, and only when, the Owner is the only party who can supply
> the act it needs.**

Five consequences, applied to every row below without exception:

1. **The register's `owner` column is not the test.** A row owned by "a Backend seam lane" can still
   carry an act only the Owner may supply — authorising a scope change is the Owner's even where
   building it is a lane's (this admits item **F-3**, change-control-2026-09-08.md:1825). A row
   owned by "Owner" can already be answered and is then excluded (change-control-2026-09-08.md:2347).
2. **Buildable work is excluded.** If an engineer, a lane or an operator can lawfully do the thing
   without the Owner saying a word, it is not in this packet however open it is.
3. **A record defect is excluded.** Correcting a wrong citation or a stale table in an engineering
   record is an engineering act. The defects found while assembling this packet were corrected by
   the pull request that publishes it and are listed at the end, not asked of the Owner. The single
   exception is a row inside an **Owner document**, which only the Owner may change (item **E-1**).
4. **An already-recorded decision is not re-asked.** The section "Already decided — not re-asked"
   lists what is settled, with where it is recorded, so that nothing here is a second bite.
5. **A bundle widening that no slice of this phase owns is an Owner act.** This is the one place
   where consequence 2 does not apply, and it is stated here once and applied once rather than
   argued per row. The bundle is the platform's least-privilege declaration: every principal in every
   freshly provisioned organisation receives exactly what it lists. Two legs carry the argument.
   **First, the distinguishing fact.** The engineering-side widenings of this phase were lawful
   because of _who made them_: the register's stated carry rule is "**the slice that publishes them
   owns the widening**", and CC-01 and CC-02 were carried by the very slices that published the
   declaring operations (change-control-2026-09-08.md:614,
   change-control-2026-09-08.md:796), CC-07 likewise
   (change-control-2026-09-08.md:227). That rule cannot reach `wo.work_order.line.manage`: its two
   declaring routes shipped in an **earlier phase**, so **no P1-31 slice publishes them and no P1-31
   slice owns the widening**. The only route left is the cross-environment backfill of item **F-4** —
   an operator act on every database, not a slice's own change — and authorising that is the Owner's.
   **Second, the precedent in the file itself.** The single code deliberately excluded from the
   bundle is excluded "on least-privilege grounds **by Owner decision** … (P1-31 CC-04)"
   (`apps/api/src/modules/iam/domain/bootstrap-roles.ts:384-387`), so the file already treats a
   grant decision of exactly this shape as the Owner's to take.
   **This admits item F-7 and only item F-7.** It does not admit CC-44, whose repair is a change to
   how a CI tier signs in and whose register disposition explicitly refuses the grant-widening route
   (change-control-2026-09-08.md:3632) — arranging an authentication grants nothing.

Every item gives (a) the decision wording, one sentence answerable yes / no / choose; (b) why the
existing authorisations do not resolve it; (c) a recommendation; (d) practical impact; (e) whether it
blocks the phase, and which gate condition of P1-G31 (`canonical-plan.md:464-472`) or
Definition-of-Done bullet (`canonical-plan.md:454-462`) it touches.

---

## Block A — gate and role acts (4 items)

### A-1. The approval owner's verdict

**(a) Decision wording.** "For P1-31 at `develop` `fb65b049`, I record the phase decision as **Pass /
Conditional Pass / Fail / Deferred**, with these conditions: ______."

**(b) Why existing authorisation does not resolve it.** closure-record.md:298-300 leaves the verdict
field deliberately empty and states that only the approval owner named in Field 35 may fill it — "No
engineering session, no agent, no pull request and no record may supply it, infer it, or treat its
absence as any of the four values." None of the three recorded Owner decision files carries a phase
verdict: `owner-decisions-2026-09-09.md:1-14` scopes itself to D-3 … D-6, P-9b and three governance
items; `owner-decisions-2026-09-10.md:18-176` to D-7, D-11, D-12, D-17, D-18;
`owner-decisions-2026-09-12.md:18-118` to D-19 and D-20. `a0-preflight.md` raises decisions and takes
none. `change-control-2026-09-08.md` records dispositions, not phase verdicts.

**(c) Recommendation.** Do not record Pass today. On the evidence in this packet the defensible values
are **Conditional Pass** (with the conditions being items A-2, A-3, A-4 and F-2 below) or **Deferred**.

**(d) Practical impact.** Until a value is recorded, the chapter's own `Status` for all twenty-nine
tasks remains `Planned` (`canonical-plan.md:471-472`), no dependent work may be authorised, and no
promotion of `develop` to `main` may be justified by phase closure —
closure-record.md:438 states in terms that the phase is **not eligible**.

**(e) Blocks this phase: YES.** Gate condition **4** (`canonical-plan.md:466-469`;
closure-record.md:288) and DoD bullet **4** (`canonical-plan.md:462`).

---

### A-2. Appointment of a QA lead, and that lead's certification of the test/evidence index

**(a) Decision wording.** "I appoint ______ as QA lead for P1-31 and require that person's written
certification of the evidence index before the gate is judged — or I record that the certification is
waived for this phase and say on whose authority."

**(b) Why existing authorisation does not resolve it.** The artefacts the condition would certify all
exist, and there are more of them than there were: the index `security-and-qa-evidence.md` (thirteen
sections, one per non-Frontend task, **re-measured in full at this head** —
security-and-qa-evidence.md:3), the acceptance record
`acceptance-record.md`, the phase coverage record `coverage-record.md`, the audit-class review
`audit-class-review.md`, the operator runbook `operator-runbook.md` and the matrix `task-matrix.md`.
**What does not exist is the certificate and the certifier**:
closure-record.md:286 states "**no certification, and no certifier.** The index is marked OPEN and
**no QA lead is named in this repository**." Appointing a role holder is not an engineering act, and
a record is not a certificate of itself.

**(c) Recommendation.** Appoint, rather than waive. The index is the only artefact that reconciles the
thirteen non-Frontend tasks, and it transposes its own definitions from a different phase's chapter —
a transposition is exactly the thing a certifier should either accept or reject.

**(d) Practical impact.** Without an appointment nobody can execute condition 2, so the gate cannot be
judged even if every task were finished.

**(e) Blocks this phase: YES.** Gate condition **2**.

---

### A-3. Appointment of a Security reviewer, and that reviewer's clearance of applicable blockers

**(a) Decision wording.** "I appoint ______ as Security reviewer for P1-31 and require that person's
written clearance of the applicable blockers before the gate is judged — or I record that clearance is
waived for this phase and say on whose authority."

**(b) Why existing authorisation does not resolve it.** Per-task security evidence exists for all four
SEC rows and is stronger than it was: SEC-001's phase-level code × operation × catalogue
reconciliation; SEC-002's export posture closed by disposition and a committed refused-download
negative behind a mocked adapter; SEC-003's set-wide privilege-escalation and cross-tenant probes
(`tests/backend/p1-31-privilege-escalation.test.ts`, merged #386 at `e2908f06`); and SEC-004's
sibling write-shape gate plus `audit-class-review.md`. **What does not exist is the clearance, and
there is no reviewer to give it**: closure-record.md:287 states "**no clearance, and no
reviewer.**"

**Four residues a clearance would have to address, named so they are not discovered afterwards.**

1. **SEC-001's least-privilege judgement has not been made by anybody.** The reconciliation is a
   mapping; that each of the twelve codes is the least code that would do is a judgement the record
   explicitly declines to make.
2. **SEC-004's review is documentary and unsigned.** `audit-class-review.md` reviews every
   `auditClass: 'none'` declaration one line each and leaves open the ones that could reasonably have
   gone the other way. A review is not a clearance.
3. **SEC-003-O1 and SEC-003-O2 are recorded and undispositioned** (change-control-2026-09-08.md:4602):
   the three body-scoped creates refuse a foreign company with two different documents — 404
   `ERR-RES-001` from one and 422 `ERR-VAL-001` from the other two, all three writing nothing — and
   `rpt.report-run` resolves a platform dataset rather than a tenant configuration, so a 404 on that
   path carries no tenancy information.
4. **The escalation probes run against a disposable database, not an acceptance.** They are
   integration assertions, and no acceptance record exercises them.

**(c) Recommendation.** Appoint. All four SEC rows sit at `phase-level incomplete` on the matrix's own
vocabulary (task-matrix.md:57-68), and a clearance given over that shape should be given by a
named person, in writing.

**(d) Practical impact.** Same as A-2 — condition 3 has no executor.

**(e) Blocks this phase: YES.** Gate condition **3**.

---

### A-4. Formal acceptance (or refusal) of the change-control dispositions that are open at this head

**(a) Decision wording.** "I formally accept the open P1-31 dispositions listed below as carried out of
the phase — or I name the ones that must be closed before P1-31 closes."

**(b) Why existing authorisation does not resolve it.** DoD bullet 2 (`canonical-plan.md:458-459`)
requires findings to be "closed **or formally accepted by the authorized owner**".
closure-record.md:235 states that neither limb is satisfied. The register files each
disposition as _recorded_, which is an engineering act, not an acceptance.

**The open set is now a derived index rather than a reading.** change-control-2026-09-08.md:4946 re-derives
every identifier's state at this head — **25 open, 4 stating no usable disposition, 47 closed or
settled**, out of 76 before this section — and it supersedes the earlier index at § 57.4 rather than
adjusting it. The twenty-five, each read off the row that carries its own state:

| id        | subject                                                                                                                                                                   | state as written                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| CC-04     | `rpt.export` withheld from the provisioning bundle                                                                                                                        | open                                                 |
| CC-06     | the checklist-results read does not close P1-27-INT-088                                                                                                                   | open                                                 |
| CC-10     | no reader anywhere for the warranty status ledger                                                                                                                         | open                                                 |
| CC-12     | two Backend docblocks name a code navigation no longer uses                                                                                                               | open                                                 |
| CC-16     | organisations provisioned before the widening cannot administer                                                                                                           | open                                                 |
| CC-20     | organisations provisioned before the widening cannot delegate                                                                                                             | open                                                 |
| CC-23     | no index for the list ordering                                                                                                                                            | open, recorded                                       |
| CC-24     | no batch variant — about 5N round trips per page                                                                                                                          | open                                                 |
| CC-27     | the catalogue merge rule, carried in CC-27's own cell (see item **D-1**)                                                                                                  | (b) open                                             |
| CC-27(b)  | the same open half, filed separately so it is not lost                                                                                                                    | open                                                 |
| CC-29     | delivering-employee identity, four recommendations pending (see **C-1 … C-4**)                                                                                            | open, four recommendations pending                   |
| CC-30     | no reduced readiness view without `sal.finance.view`                                                                                                                      | open, recorded                                       |
| CC-31     | FE-009 ships partial (see item **F-3**)                                                                                                                                   | open, recorded                                       |
| CC-32     | the printed sheet names nobody for the delivering employee                                                                                                                | open                                                 |
| CC-34     | D-4 names a TRANSFER the ledger cannot express                                                                                                                            | recorded — no action here; **ambiguous**, filed open |
| CC-37(a)  | eleven `wty.`/`rpt.` writes held to no payload-mirror gate — **superseded by CC-48**, which builds the gate; the row stays open until its own section is re-dispositioned | open, recorded                                       |
| CC-37(b)  | the report-configuration operation family has no consumer (see item **F-1**)                                                                                              | open, recorded                                       |
| CC-38     | amounts, quantities and durations shown as raw exact strings                                                                                                              | open, recorded                                       |
| CC-38(a)  | two drill-through targets have no screen                                                                                                                                  | open, recorded                                       |
| CC-41     | the overview is four report runs, not one summary read                                                                                                                    | open, recorded                                       |
| CC-43     | two browser cases were failing; **repaired by the corrected re-run**, and the row's own cell is left to the lane that owns it                                             | closed in part; one cause open                       |
| CC-44     | the handoff-gated reporting cases need overridden browser credentials                                                                                                     | open, stated                                         |
| CC-46(c)  | the OpenAPI bare-object shortfall (see item **F-6**)                                                                                                                      | open, recorded                                       |
| CC-47     | the register's index of its own open dispositions                                                                                                                         | open, indexed                                        |
| CC-50 (a) | the per-file web coverage summary reaches no reader, so two coverage figures can be filled from no hosted artefact                                                        | open                                                 |

**Four identifiers state no usable disposition and are therefore NOT in the table above**: CC-25 and
CC-26 are prose bullets with no state cell, CC-40 is allocated and never used, and **CC-48 has no
disposition row at all** because section 58 carries no dispositions table. That last one is new at
this head and is filed as **CC-52 (a)**.

**Two security residues are not register rows and are carried with the set**: SEC-003-O1 and
SEC-003-O2 (change-control-2026-09-08.md:4602).

**Deliberately NOT in this list, because the register records them closed or settled at this head:**
CC-01, CC-02, CC-17, CC-18, CC-22, CC-33 with (a) and (b), CC-34 with (a), (b) and (c), CC-35 with
(a), (b) and (c), CC-36, CC-37(c), CC-39 with (a), (b) and (c), CC-42, CC-45, CC-46 with (a), (b) and
(d), CC-49, CC-50 and CC-51. The closure record previously listed several of them as open; those were
record defects and are corrected by the pull request that publishes this packet.

**(c) Recommendation.** Accept the set as carried, with three carve-outs the Owner should refuse to
accept blind: **CC-16** and **CC-20** (they are operator acts owed on every environment — item
**F-4**), **CC-44** (it is why the acceptance's browser half is credential-dependent), and
**CC-50 (a)** (it is a hole in what CI can ever publish, not a hole in this phase's work).

**(d) Practical impact.** Without a formal acceptance, DoD bullet 2 cannot be evidenced by either limb,
and twenty-five rows travel into the next phase with no owner and no deadline.

**(e) Blocks this phase: YES.** DoD bullet **2** and, through it, gate condition **1**.

---

## Block B — the A0 decisions still open (7 items)

Each is a question A0 raised (`a0-preflight.md`) and no recorded decision has answered.

### B-1. D-1 — who owns P1-31's backend prerequisites

**(a)** "P1-31's backend prerequisites belong to **Phase 1-22** / **Phase 1-24**, and they travel as
**change requests against that phase** / **a P1-31 prerequisite lane on the P1-30 precedent** — choose one
of each."
**(b)** `a0-preflight.md:325-329` states the contradiction directly: every P1-27 disposition row says
Phase 1-22, the chapter's Field 8 and Field 13 say Phase 1-24. No Owner decision file addresses ownership
of a prerequisite lane. `owner-decisions-2026-09-09.md:16-33` approved P-9b narrowly, which settles one
prerequisite's content and not the lane's ownership.
**(c)** Ratify what actually happened: a P1-31 prerequisite lane on the P1-30 precedent. **Eighteen of
the nineteen** entries have a merged contribution on that footing (closure-record.md:46).
**(d)** Low. The work has been executed either way; what is unresolved is which phase's record owes the
history, which matters at P1-22 / P1-24 re-audit, not at P1-31 runtime.
**(e) Blocks this phase: NO.** Touches DoD bullet **3** (traceability synchronised).

### B-2. D-8 — does the Frontend dependency chain bind execution order

**(a)** "The Field 14 dependency chain is **binding execution order** / **planning notation** — choose one."
**(b)** `a0-preflight.md:368-371`: read literally it serialises all sixteen Frontend items and places the
already-shipped FE-015 fifteenth. A0 says "This answer changes the phase's shape more than any other." No
Owner decision touches it; the three decision files are all about content, not sequence.
**(c)** Planning notation. The phase has already been executed out of chain order — FE-015 landed at #360
before FE-009 … FE-014 — so a literal reading would retroactively invalidate the sequence of merged work.
**(d)** Retrospective only for P1-31; forward-looking for how the next chapter's chains are read.
**(e) Blocks this phase: NO.** Touches DoD bullet **1**.

### B-3. D-9, the warranty half — a RATIFICATION, not a fresh question

**(a)** "I ratify `wty.warranty.read` as the permission that gates the P1-31 warranty reads, and I ratify
its inclusion in the tenant-administrator bundle and the backfill already performed — or I name a
different code and direct the correction."
**(b) This must be presented honestly as a ratification, because the act was taken while the decision was
open.** A0 records the warranty half as still open and belonging to P-7's Backend lane
(`a0-preflight.md:372-379`, closing "The warranty half stands open and remains P-7's Backend decision").
Meanwhile: `wty.warranty.read` was **minted** — described as "the phase's ONLY minted code" at
`apps/api/src/modules/iam/domain/bootstrap-roles.ts:395-396` and carried into the bundle at
`apps/api/src/modules/iam/domain/bootstrap-roles.ts:401`; the disposition is CC-07
(change-control-2026-09-08.md:227, state `closed`); re-pointing `wty.warranty-detail` onto it withdrew a read from
earlier administrators, which is CC-08; and the bundle backfill of 2026-09-12 widened **24**
administrator roles from 76 to 78 codes on one shared local database. So the code exists, is granted,
and has been backfilled, while the decision authorising it has never been recorded.
**(c)** Ratify. Reversing it would mean withdrawing a granted code from 24 roles on a live database.
**(d)** If the Owner declines to ratify, the correction is a Backend `iam` slice plus a second backfill on
every environment, and the warranty reads lose their gate in the interim.
**(e) Blocks this phase: NO** for the delivery half (settled by precedent, `a0-preflight.md:376-379`).
For the warranty half it touches DoD bullet **2** — an ungoverned permission grant is exactly the class of
finding condition 3 exists to clear.

### B-4. D-10 — does Field 24 require an event-consumption mechanism

**(a)** "Field 24's event-consumption requirement is satisfied by **polling** / **requires a push
mechanism this platform does not have** — choose one, or record it explicitly not-applicable for P1-31."
**(b)** `a0-preflight.md:380-386`: neither tier has any push surface, so a required mechanism is a contract
that does not exist; Field 30 permits an explicit not-applicable decision as a deliverable. The record adds
"**Still open.** **D-19** of 2026-09-12 requires FE-010 to make its freshness and timezone VISIBLE, which is
a display requirement and not a refresh mechanism". So the newest Owner decision explicitly does not settle
it, and the assurance index records it unchanged at this head
(security-and-qa-evidence.md:1158).
**(c)** Record it not-applicable for P1-31 under Field 30, and raise the push surface as a platform item.
**(d)** Without the decision, DO-002 cannot state what the phase owes over the platform's existing logging,
and it is one of the two things standing between DO-002 and a definition — the other being that the
monitoring and alerting half does not exist at all.
**(e) Blocks this phase: NO.** Touches DoD bullet **1**.

### B-5. D-13 — where the P1-30 / P1-31 split for delivery and warranty lies

**(a)** "The delivery and warranty split between P1-30 and P1-31 is ______ — confirm the split as executed,
or name the items that belong to the other phase."
**(b)** `a0-preflight.md:409-412`: WFP-15 records the owning Frontend phase as "P1-30 / P1-31 — the split is
not established", corroborated in three further places, and the same question governs DTA-18. No Owner
decision file names a phase split.
**(c)** Confirm as executed. Sixteen Frontend rows were built to the P1-31 reading and **fifteen** are
end-to-end verified on it (task-matrix.md:79).
**(d)** Low now that the work has merged; the risk A0 named — building a screen in the wrong phase — has
already been taken.
**(e) Blocks this phase: NO.** Touches DoD bullet **3**.

### B-6. D-14 — Field 7's product-name precondition

**(a)** "Field 7's product-name precondition is **superseded by OIR-01's closure** / **must be discharged by
re-synchronising the canonical document first** — choose one."
**(b)** `a0-preflight.md:413-417`: the repository has already replaced the placeholder and a gate enforces
it, so the chapter's precondition is stale rather than violated; P1-25's gate record logs the document
re-synchronisation as **non-blocking for a phase gate but blocking before production release or formal
external delivery**. No decision file records the supersession.
**(c)** Record it superseded for gate purposes and carry the document re-synchronisation as a
pre-release item, which is exactly what P1-25's gate record already says.
**(d)** If not recorded, a reader of Field 7 concludes P1-31 started without a precondition met.
**(e) Blocks this phase: NO,** by P1-25's own finding. Touches DoD bullet **3**.

### B-7. D-16 — which task owns the cited test ids, and where phase evidence lands

**(a)** "TC-P1-31-001, TC-P1-31-002, TC-WTY-001, TC-RPT-001 and TC-QMS-001 are **retired as unresolvable**
/ **owned by task ______** — and phase evidence lands at **`docs/phase-1/phase-1-NN/*acceptance*.md`
(this repository's convention)** / **`_acceptance/` (the chapter's)** — choose one of each."
**(b)** `a0-preflight.md:428-434`: all five ids return zero files and the testing-plan document Field 9 names
does not exist here, so **no task can satisfy its own Test reference** — this is why the evidence index
transposes its definitions from another phase and why CC-37 exists. The convention half is still
unresolved at this head (security-and-qa-evidence.md:1027), and #378 and #380 have now instantiated the
repository's convention twice without reconciling it.
**(c)** Retire the five ids and ratify the repository convention. Inventing files to match dead ids would be
the worse outcome.
**(d)** This is the single decision that most affects how the twenty-nine rows can ever be closed against
their own Test reference column (`canonical-plan.md:230-245`, `canonical-plan.md:260-263`,
`canonical-plan.md:276-280`, `canonical-plan.md:293-294`, `canonical-plan.md:312-313`).
**(e) Blocks this phase: YES, in one limb.** DoD bullet **1** requires each task "linked to immutable
evidence"; while every task's cited test id resolves to nothing, that link cannot be made
(closure-record.md:220).

---

## Block C — recommendations pending Owner approval (5 items)

Four are the delivering-employee identity recommendations (change-control-2026-09-08.md:1549, state
"open, four recommendations pending"; the rows are at
`delivering-employee-identity-seam.md:125-128`, with `delivering-employee-identity-seam.md:130-134`
confirming that A-1 and A-2 are approved and pending nothing). The fifth is D-17's source column.

### C-1. A-3 — the status of rows minted by the delivering-employee backfill

**(a)** "Rows minted by the delivering-employee backfill are created **`inactive`** / **`active`** — choose one."
**(b)** `delivering-employee-identity-seam.md:125` marks it "ENGINEERING CHOICE — recommendation pending
Owner approval", and `delivering-employee-identity-seam.md:245` shows the DDL already mints
`status = 'inactive'`. No Owner decision covers it: `owner-decisions-2026-09-10.md:18-67` answered D-12 and
OWR-2026-09-06-G-10 on whether the delivering employee is in scope, not on roster status.
**(c)** Approve `inactive`, as recommended: "A legacy account proves a handover happened once, not that the
person is on the roster today; an operator reinstates the ones who are"
(`delivering-employee-identity-seam.md:125`).
**(d)** The backfill has been run once, on one shared local database, minting nothing because the delivery
table was empty. So the choice is still costless today and stops being costless on the first environment
with delivery history.
**(e) Blocks this phase: NO.** Touches DoD bullet **2** via CC-29.

### C-2. A-4 — whether `employment_ref` stays optional, opaque and tenant-unique

**(a)** "`employment_ref` stays **optional and unique per tenant when present** / **mandatory** /
**non-unique** — choose one."
**(b)** `delivering-employee-identity-seam.md:126`, same pending status. Not addressed by any decision file.
**(c)** Approve as recommended — "Mandatory would exclude every employee with no external record, and
non-unique would stop it identifying anybody" (`delivering-employee-identity-seam.md:126`).
**(d)** Changing it later is a migration on a shipped table.
**(e) Blocks this phase: NO.** DoD bullet **2** via CC-29.

### C-3. A-5 — the administer/read scope split for employees

**(a)** "Administering an employee stays **branch-scoped while reading is tenant-wide** / **both are
tenant-wide** — choose one."
**(b)** `delivering-employee-identity-seam.md:127` marks it pending and flags it as a **policy** question:
"Choosing a colleague is not the same authority as editing the roster; widening the write is a policy change,
not a code change." A policy change is the Owner's by construction. `owner-decisions-2026-09-10.md:18-67`
settled that the home branch is informational and did not settle the write scope.
**(c)** Approve the split as recommended.
**(d)** Widening later re-grants a write across every branch of every tenant.
**(e) Blocks this phase: NO.** DoD bullet **2** via CC-29.

### C-4. A-6 — how an unresolved legacy identity is resolved

**(a)** "An unresolved legacy delivering-employee identity is resolved through **one Owner-approved operator
command that names a real employee and then re-runs `VALIDATE CONSTRAINT`** / **some other route I will
name** — choose one."
**(b)** `delivering-employee-identity-seam.md:128`, "RECOMMENDATION PENDING OWNER APPROVAL"; restated at
`delivering-employee-identity-seam.md:466` and `delivering-employee-identity-seam.md:514`. The recommendation
is explicit that the resolution must never happen inside a migration, and that "Leaving it undecided keeps the
key `NOT VALID` on every database that carries unresolved history".
**(c)** Approve the recommended command. The alternative is a foreign key that stays `NOT VALID` indefinitely.
**(d)** Direct: every environment carrying unresolved handover history holds an unvalidated constraint until
this is answered.
**(e) Blocks this phase: NO.** DoD bullet **2** via CC-29.

### C-5. D-17's source column — which column supplies the reporting timezone

**(a)** "A report period's timezone is read from **`org.branches.timezone_name`** / **`org.tenants.default_timezone`**
— choose one."
**(b)** The Owner approved D-17's semantics on 2026-09-10 — half-open `[from, to)` periods in the selected
branch's timezone, timezone and filter context displayed, one explicit timezone for cross-branch reporting
(`owner-decisions-2026-09-10.md:113-124`). The register records the approval as covering everything **apart
from the source column**: the CC-27 row's state reads "(a) approved 2026-09-10 apart from the source column;
(b) open", and its resolution column names the residue — "**Recommendation pending Owner approval:** that the
selected branch's timezone be read from the SOURCE column `org.branches.timezone_name` rather than
`org.tenants.default_timezone`; reversing that one choice is one lookup in `ReportRunService.run` plus the
case that proves the boundary" (change-control-2026-09-08.md:1402).
**(c)** Approve `org.branches.timezone_name`. It is what the branch-scoped semantics the Owner already approved
imply, and it is what is implemented.
**(d)** Small and bounded: one lookup and one boundary case.
**(e) Blocks this phase: NO.** DoD bullet **2** via CC-27(a).

---

## Block D — an engineering decision taken ahead of confirmation, and open to Owner override (1 item)

### D-1. CC-27(b) — the report catalogue merge rule

**(a) Decision wording.** "A tenant `rpt.report_configurations` row is **customisation of a report the
platform already implements (the code-registered baseline keeps answering when no tenant row is published)**
/ **a precondition, so a report code answers nothing until the tenant authors a configuration** — choose one."

**(b) Why existing authorisation does not resolve it.** The register row's owner column reads **Owner** and
its state reads "(b) open". The seam record states the same in its own words —
`report-engine-seam.md:190-193`: "**Engineering consequence (not an Owner decision) — this is CC-27(b),
and the Owner has not confirmed it: a configuration row is CUSTOMIZATION, not a precondition.**" — and
`report-engine-seam.md:212-219` names the alternative and its cost: "'A report is invisible until an operator
configures it' is defensible and is what a strict reading of P1-23 implies. It would mean every tenant must
author four configuration rows before any report works… **It is OPEN to Owner override**; reversing it is a
change to two methods in `ReportCatalogueService` and their cases." D-4's approved four-report baseline
(`owner-decisions-2026-09-09.md:51-79`) settles _which_ reports exist, not _whether a tenant row is required
for one to answer_.

**(c) Recommendation.** Confirm the implemented rule (configuration is customisation). The alternative makes
every report unreachable in every tenant until four rows are authored, and `rpt.report_configurations` has no
seed.

**(d) Practical impact.** The rule already has an observed operator-visible consequence: acceptance
observation **O-5** records that a tenant configuration left in `draft` **suppresses** the baseline in
`listPublished`, so `rpt.report-run` answers `404 ERR-RES-001` for a report the tenant previously had, and
the consequence "is stated nowhere a screen could show it"
(closure-record.md:371). Confirming the rule should be paired with directing that
consequence be surfaced.

**(e) Blocks this phase: NO.** Touches DoD bullet **2** and DoD bullet **3**.

---

## Block E — an Owner document that only the Owner may change (1 item)

### E-1. OWR-2026-09-06-G-10

**(a) Decision wording.** "I update the register row **OWR-2026-09-06-G-10** from `Undecided` to the answer
I already gave on 2026-09-10 — the delivering employee's identity is in scope and is delivered as the
`org.employees` entity — or I confirm it stays `Undecided`."

**(b) Why existing authorisation does not resolve it.** The substance was answered:
`owner-decisions-2026-09-10.md:18` is headed "The delivering employee — D-12 answered; answers
OWR-2026-09-06-G-10 (register row update owed to the Owner document)". What was not done is the row update
itself, and changing an Owner document is the Owner's act. The row is verifiably still `Undecided`:
`docs/product/owner-requirements-2026-09-06.md:1496` reads
"### OWR-2026-09-06-G-10 — Owner requirement · **Undecided**", with
`docs/product/owner-requirements-2026-09-06.md:1550` and
`docs/product/owner-requirements-2026-09-06.md:1552-1553` carrying the dependent gap rows. Three engineering
records still cite it as Undecided and therefore render a reference rather than a name —
`delivery-detail-screen.md:205`, `delivery-read-seam.md:169`, `a0-preflight.md:405` — and
`delivery-start-selector.md:280` records the update as still owed. **The same row also carries A0's fourth
named DOC-001 correction**: its evidence line names `sal.deliveries.delivering_employee_id` where the table
is `sal.delivery_records`, and that too is inside an Owner document.

**(c) Recommendation.** Update the row to Decided, quoting the 2026-09-10 answer, and correct the table name
in the same edit.

**(d) Practical impact.** While the row reads `Undecided`, CC-32 — the printed handover sheet names nobody for
the delivering employee — has no authority to close against, and DOC-001 cannot report all four A0 corrections
as made.

**(e) Blocks this phase: NO.** DoD bullet **3**.

---

## Block F — scope and authorisation acts (8 items)

### F-1. CC-37(b) — the `rpt.report-configuration-*` family with no consumer

**(a) Decision wording.** "The seven `rpt.report-configuration-*` operations — five writes and two reads — are
**kept as published API with no UI consumer** / **given a canonical authoring task in a named later phase** /
**withdrawn** — choose one."

**(b) Why existing authorisation does not resolve it.** The register row's owner column reads "Owner / a later
slice" and its state reads "open, recorded", and the disposition says in terms that "the decision belongs to
whoever owns the writer". The measurement: the family is "**referenced in `apps/web` only by the generated
`apps/web/src/lib/api/idempotent-operations.ts` manifest; no screen and no adapter calls them**", which is "the
declared-but-never-wired shape this task exists to catch, and P1-31 ships it knowingly"
(security-and-qa-evidence.md:590). Nothing in the three decision files authorises shipping seven published
operations with no consumer.

**A figure corrected while asking this.** The family is **seven operations, of which five are writes and two
are reads**: `-create`, `-status-set`, `-update`, `-version-create` and `-version-publish` are writes; `-list`
and `-read` are reads. The register's CC-37(b) row and the index's § 14 both said "the seven … **writes**";
both are annotated in place by the pull request that publishes this packet. **The Owner is being asked about
five writes plus two reads.**

**(c) Recommendation.** Keep and scope: name the authoring screen as a later Frontend task rather than
withdrawing operations that the report catalogue's own merge rule (item **D-1**) depends on being writable.

**(d) Practical impact.** Today a tenant can only get a configuration row by direct API call. Item **D-1**'s
O-5 consequence — a `draft` row withdrawing a working report — is reachable only through that unmediated path.

**(e) Blocks this phase: NO.** Touches DoD bullet **1** (a shipped surface with no consumer is not
"implemented, reviewed, tested, documented").

### F-2. What P1-31 closes at, and what is carried

**(a) Decision wording.** "P1-31 closes at **N of 29**, with the residues listed below formally carried to a
named later phase — or P1-31 stays open until they are discharged. Choose, and if carrying, name the phase."

**(b) Why existing authorisation does not resolve it, and how the question has changed.** **No task is
`not started` at this head, and no task is in an open pull request.** Every lane the closure plan named has
merged, so the counts are **15 `end-to-end verified`, 5 `merged (read-only/partial)`, 9 `phase-level
incomplete`** (task-matrix.md:70). _(The closure record previously asked this question over **six**
tasks it counted `not started`, and then five. Both were true when written; the shape of the question has
changed and the question has not gone away.)_

**Fourteen of the twenty-nine are not finished, and what each one lacks is tabled per row in
closure-record.md:60.** Grouped by kind: **four** rows lack implementation
(FE-009's history reader, QA-002's export contract, DO-002's monitoring half, DOC-001's Field 34 tree),
**nine** lack proof — which is the honest headline, because proof rather than implementation is what this
phase is short of — and **seven** lack a decision, most of them decisions in this packet.

Nothing authorises scoping a canonical task out. `owner-decisions-2026-09-09.md:102-121` covers documentation,
governance and verification policy; no decision file reduces the twenty-nine.

**(c) Recommendation.** Do not close at 15 of 29 on the current record, and do not carry the nine
`phase-level incomplete` rows out silently. Three of them — SEC-001, SEC-004 and, through the index, every
other — turn on appointments the Owner has not made (**A-2**, **A-3**), so answer those first and re-ask this
one afterwards.

**(d) Practical impact.** This is the difference between a partial closure with a named successor phase and an
open phase.

**(e) Blocks this phase: YES.** DoD bullet **1** and gate condition **1**.

### F-3. FE-009 — accept the partial, or authorise P-18

**(a) Decision wording.** "FE-009 is **accepted as delivered partial** — a vehicle-filtered warranty list with
the record screen stating that the transition ledger is unreadable — **or** I authorise **P-18**, a new
backend warranty-history reader, as in-scope work."

**(b) Why existing authorisation does not resolve it, and why it is here despite its owner column.** The
register row has owner "**a Backend seam lane**" and state "open, recorded" — but under criterion
consequence 1, the act being asked for is not _building_ the reader (a lane can do that) but _authorising a
new backend operation into scope_, which is the Owner's. The facts: the status-history table has "**no reader
anywhere in `apps/api/src`**"; CC-31 records that the screen "states in the operator's own language that the
transition record cannot be read yet. No sequence is composed from the record's current state: an invented
ledger would be believed, which is worse than an absent one"; and the acceptance found the same from the
outside — "this run confirms the statement and cannot confirm a ledger that is not published". Note also a
naming discrepancy the register itself flags: the real table is `wty.warranty_status_history`, and "CC-10
above records it as `wty.warranty_record_status_history`, which no migration ever created"
(change-control-2026-09-08.md:1825).

**(c) Recommendation.** Accept the partial for P1-31 and authorise P-18 into the next backend phase. The screen
tells the truth today; a rushed reader would not be exercised by any P1-31 acceptance case.

**(d) Practical impact.** Accepting holds FE-009 at `merged (read-only/partial)` and therefore holds the
end-to-end count at fifteen. **FE-009 is the only Frontend row that is not `end-to-end verified`**
(closure-record.md:191).

**(e) Blocks this phase: YES if the Owner requires 16/16 Frontend.** Touches DoD bullet **1**.

### F-4. The four post-merge operator acts, on every environment that is not the one local database

**(a) Decision wording.** "I authorise the four post-merge operator acts on every environment, in the recorded
order, and I name ______ as the owner of the runbook that carries them."

**(b) Why existing authorisation does not resolve it.** **The runbook now exists** —
[`operator-runbook.md`](./operator-runbook.md), merged as #383 at `ea3b7fc0` — and it carries the acts in the
order that is load-bearing, each with preconditions, the exact command, a verification query, a rollback
criterion and a statement of what done looks like. _(This item previously read "**No runbook carries them**":
true when written.)_ **What a runbook is not is a run.** The acts were performed once, by hand, against one
shared local Docker database on 2026-09-12, and that evidence is **outside** the repository at
`orchestration/evidence/p1-31/p17-operator-20260912/`. The most useful thing in it is a refusal: the bundle
backfill "**refused on its first pass with exit 5**" because the permission catalogue lacked the two minted
codes, and completed only after the declared seed `supabase/seeds/04_iam_permission_catalog.sql` was applied —
which was **CC-37(c)**, now closed by the runbook. Existing authority covers the content, not the
environments: `owner-decisions-2026-09-09.md:16-33` approved P-9b's correction, and
`owner-decisions-2026-09-09.md:112-114` recorded that "The combined permission rollout (backfill) runs
**once**, for newly approved codes only" — a rule about how the backfill runs, not an authorisation to run it
on environments no record names.

**(c) Recommendation.** Authorise, and name the DO-002 / DOC-002 lane as runbook owner. The ordering
constraint the exit-5 refusal exposed is already the runbook's first act; keep it there.

**(d) Practical impact.** Without the authorisation, any environment brought up from the merged tree gets
administrator roles at 78 codes only where the backfill has been run, and a `NOT VALID` foreign key — which is
CC-16 and CC-20, both open (change-control-2026-09-08.md:4968).

**(e) Blocks this phase: YES.** DoD bullet **3** names runbooks explicitly (`canonical-plan.md:460-461`), and
the bullet is not evidenced while the acts stay unperformed (closure-record.md:250).

### F-5. QA-004 — a sibling version-sourcing gate, or a recorded waiver

**(a) Decision wording.** "P1-31 **builds a sibling version-sourcing gate over its own eleven `versionGuarded`
operations** / **records a waiver relying on P1-28's gate and the concurrency cases now committed** — choose
one."

**(b) Why existing authorisation does not resolve it.** The existing gate's scope is P1-28's:
`scripts/ci/check-p1-28-version-sourcing.mjs` re-ran green on this tree — "22 guarded operations, 15
deliberately absent, 7 this application must reach, 30 adapters, 31 guarded call sites" — and the assurance
index states plainly that whether P1-31 owes a sibling gate "is a decision this record does not take", with
"**No P1-31 version-sourcing gate exists**" as an open item
(security-and-qa-evidence.md:903). The escalation lane merged the concurrency cases that were owed
(**CC-49**) and recorded the decision as "unchanged and undecided: … This slice does not decide it"
(change-control-2026-09-08.md:4560).

**(c) Recommendation.** Build the sibling gate. P1-29 and P1-30 each shipped their own gate rather than
widening a closed phase's, A0 recorded that precedent as the reason P1-31 ships `check-p1-31-access.mjs`
(`a0-preflight.md:418-427`), and P1-31 has since shipped a second sibling gate on the same reasoning
(`check-p1-31-write-shape.mjs`, **CC-48**). A waiver would be the first departure from that pattern in three
phases.

**(d) Practical impact.** QA-004 sits at `phase-level incomplete` and this decision is the whole of what would
move it further.

**(e) Blocks this phase: NO on its own; YES through F-2.** DoD bullet **1**.

### F-6. Bare-object OpenAPI success schemas — confirm the scope classification

**(a) Decision wording.** "Typed OpenAPI response schemas are **a platform-wide slice outside P1-31** /
**in P1-31's scope** — confirm which."

**(b) Why existing authorisation does not resolve it.** The shortfall is **generator-wide, not P1-31's**: every
operation's success response is emitted with `schema: { type: 'object' }` from a single literal at
`apps/api/src/server/openapi/document.ts:224`. Re-counted against the generated document at this head,
**411 of 411 operations** publish exactly `{"type":"object"}` as their success schema, and all 45 P1-31
operations are among them (security-and-qa-evidence.md:767). The chapter asks only that every public operation be
"represented in OpenAPI" (`canonical-plan.md:370-372`) — it does not require typed response bodies — **no gate
reads response properties**, and A0 classified the shortfall as **chapter-level rather than a P1-31 defect**
(`a0-preflight.md:81`). What is missing is the Owner's explicit confirmation of that classification.

**(c) Recommendation.** Confirm it is out of P1-31's scope and raise it as a platform slice.

**(d) Practical impact.** A consumer reading the published contract learns the status code and nothing about
the body. That is true of the whole platform, not of this phase.

**(e) Blocks this phase: NO.** Touches DoD bullet **3** and QA-002's completion condition.

### F-7. `wo.work_order.line.manage` — a code declared by shipped operations and absent from the bundle

**(a) Decision wording.** "`wo.work_order.line.manage` is **added to the tenant-administrator bundle (78 → 79)
and backfilled on every environment** / **deliberately withheld with a recorded reason** — choose one."

**(b) Why existing authorisation does not resolve it.** The code is declared by two shipped operations —
`apps/api/src/app/api/v1/work-orders/[workOrderId]/service-lines/route.ts:55` and
`apps/api/src/app/api/v1/work-orders/[workOrderId]/required-parts/route.ts:58` — and it exists in the catalogue
seed at `supabase/seeds/04_iam_permission_catalog.sql:253`. It is **silently absent** from the bundle: a source
read of `apps/api/src/modules/iam/domain/bootstrap-roles.ts:280-423` finds 78 codes and no mention of it. The
contrast is the point — the one code that _is_ deliberately withheld carries a recorded reason in the same file:
`apps/api/src/modules/iam/domain/bootstrap-roles.ts:378-390` explains that `rpt.export` "remains deliberately
EXCLUDED … on least-privilege grounds by Owner decision … (P1-31 CC-04)". There is no equivalent sentence for
this code, so its absence reads as an omission rather than a decision. The acceptance observed the consequence
and recorded that it blocked nothing (closure-record.md:365).

**(c) Recommendation.** **INCLUDE.** The bundle's own stated rule is "carry a code only when a shipped operation
declares it", and two shipped operations declare this one.

**(d) Practical impact.** Cost of including: bundle 78 → 79, the test pins that assert the bundle size, and a
backfill on every environment (the same act as **F-4**, so it should ride with it). Cost of not including: a
fresh organisation's first administrator cannot record a service line or a required-part demand at all.

**(e) Blocks this phase: NO.** It is in this packet under criterion consequence **5** — the act asked for is
the grant decision, not the code change that follows it. It touches DoD bullet **2** as a finding that is
either closed or formally accepted.

### F-8. The residue journey organisations on the shared acceptance database

**(a) Decision wording.** "The journey organisations left on the shared local acceptance database are
**deleted** / **left in place** — choose one." **Deletion is destructive and irreversible**, so it may proceed
only on an explicit choice of the first option; no answer, or the second option, means they stay.

**(b) Why existing authorisation does not resolve it.** No decision file authorises deleting tenant data.
Existing practice is the P1-30 precedent of **not** deleting: their codes match no backend-suite prefix, so no
routine run will remove them and none of them will remove anything else
(closure-record.md:411).

**The count, measured on 2026-09-13 by a read-only query and labelled as one.** `org.tenants` holds **41**
rows; **16** are `p31_journey_*` and **18** are `p30_journey_*`. Two of the sixteen are the pair the corrected
re-run provisioned. **Nothing was written, deleted or reset to produce these three figures.**

**(c) Recommendation.** Leave them in place for now and delete only after the phase verdict is recorded — a
deleted organisation removes the ability to re-read the acceptance evidence it was created for.

**(d) Practical impact.** Every one is a live tenant on the shared local database that other checkouts also
use. The standing rule that keeps this safe is that the backend suites delete tenants by **prefix** on that
database, so acceptance data is deliberately named to match no suite prefix.

**(e) Blocks this phase: NO.** Touches DoD bullet **1** only in that the evidence lives on those rows.

---

## Tested against the criterion and EXCLUDED

Two items were explicitly re-tested and are **not** Owner items.

- **CC-44 — the handoff-gated reporting cases need overridden browser credentials.** Owner column "the
  Frontend lane", state "open, stated". The finding is that the cases "assert on screens that gate on
  `rpt.report.read`, and the account the tier signs in as by default does not hold it… Repairing it means
  changing how the tier signs in — a different decision, on a different lane". **Excluded** under criterion
  consequence 2, and expressly not admitted by consequence 5: changing how a CI tier authenticates is an
  engineering act a lane can perform, and it grants nothing. It would become an Owner item only if the chosen
  repair were to widen what the acceptance account is granted — and the disposition already rules that route
  out. **What has since happened is measured rather than assumed**: the credential-kind design of #387 pins one
  outcome per credential kind, and the hosted run of that pull request shows the handoff-gated cases skipping
  and every legacy case executing (change-control-2026-09-08.md:4876). No grant was widened.
- **CC-10 — no reader for the warranty status ledger.** Owner "a later `wty` read slice, with FE-009", state
  "open". Building a read operation is an engineering act. **Excluded as a separate item** — the Owner-only part
  of it, authorising P-18 into scope, is already asked as **F-3**, and asking twice would inflate the packet.

---

## Already decided — not re-asked

Each of the following has a recorded decision. It is listed so the Owner is not asked a second time, and so a
reader can see what the packet is _not_ asking.

| subject                                                                                                                                 | decided                                             | where recorded                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee separation (employee identity independent of a login; A-1)                                                                     | approved                                            | `delivering-employee-identity-seam.md:101`, `delivering-employee-identity-seam.md:123`                                                                                                                                                                                                    |
| Branch selection (the home branch is informational and transferable, never a restriction; A-2)                                          | approved 2026-09-10                                 | `delivering-employee-identity-seam.md:124`; `owner-decisions-2026-09-10.md:18-67`                                                                                                                                                                                                         |
| Reporting periods (half-open `[from, to)` in the selected branch's timezone; one explicit timezone across branches)                     | approved 2026-09-10 (D-17)                          | `owner-decisions-2026-09-10.md:113-124` — the **source column** residue is item **C-5**                                                                                                                                                                                                   |
| Operational printing (the delivery document is a client-composed printable operational view)                                            | approved 2026-09-10 (D-7)                           | `owner-decisions-2026-09-10.md:68-90`                                                                                                                                                                                                                                                     |
| Financial report enrichment (the invoice and payment report completed; fifteen columns, party split, unallocated and credit-note money) | approved 2026-09-12 (D-20)                          | `owner-decisions-2026-09-12.md:81-118`                                                                                                                                                                                                                                                    |
| Overview requirements (FE-010 as an operational overview of the four approved report domains, with visible freshness and timezone)      | approved 2026-09-12 (D-19)                          | `owner-decisions-2026-09-12.md:18-80`                                                                                                                                                                                                                                                     |
| P-9b (delivery completion respects active, non-deleted checklist templates)                                                             | approved 2026-09-09, narrowly                       | `owner-decisions-2026-09-09.md:16-33`                                                                                                                                                                                                                                                     |
| D-3 (what the ready-for-delivery list lists)                                                                                            | settled 2026-09-09                                  | `owner-decisions-2026-09-09.md:34-50`                                                                                                                                                                                                                                                     |
| D-4 (the approved baseline of four reports)                                                                                             | approved 2026-09-09                                 | `owner-decisions-2026-09-09.md:51-79`                                                                                                                                                                                                                                                     |
| D-5 (the branch summary is a branch-filtered view of the same approved sections, no new measures)                                       | approved 2026-09-09                                 | `owner-decisions-2026-09-09.md:80-88`                                                                                                                                                                                                                                                     |
| D-6 (FE-015 reuses the audit screen; no export added; export authorisation stays explicit)                                              | approved 2026-09-09                                 | `owner-decisions-2026-09-09.md:89-101`                                                                                                                                                                                                                                                    |
| **D-20 / CC-35, CC-35(a), CC-35(b)**                                                                                                    | **decided by the Owner 2026-09-12 and implemented** | the three register rows all state "decided by the Owner 2026-09-12; implemented in § 47.5" (change-control-2026-09-08.md:2347). **The closure record listed (a) and (b) as pending Owner approval; that was a record defect and is corrected by the pull request publishing this packet** |
| CC-33, CC-33(a), CC-33(b)                                                                                                               | settled                                             | the three register rows read "settled — implemented" and "settled" (change-control-2026-09-08.md:2059). **Listed open in the closure record; corrected**                                                                                                                                  |
| CC-34(a), CC-34(b), CC-34(c)                                                                                                            | settled                                             | all three read "settled — recorded in § 9". CC-34 itself is "recorded — no action here" and is carried in item **A-4**. **Listed open in the closure record; corrected**                                                                                                                  |
| Combined permission rollout runs once, for newly approved codes only; tenant customisations and denials preserved                       | decided 2026-09-09                                  | `owner-decisions-2026-09-09.md:112-114`                                                                                                                                                                                                                                                   |
| Standing verification policy — targeted local checks plus required hosted gates; `verify:workspaces` is not a per-commit prerequisite   | decided 2026-09-09                                  | `owner-decisions-2026-09-09.md:116-121`                                                                                                                                                                                                                                                   |
| Media-retrievability statements may be corrected factually; portable approved project instructions brought under version control        | decided 2026-09-09                                  | `owner-decisions-2026-09-09.md:102-111`                                                                                                                                                                                                                                                   |
| D-2, D-11, D-12, D-18                                                                                                                   | settled                                             | `owner-decisions-2026-09-10.md`; D-2 at the CC row in register § 3                                                                                                                                                                                                                        |
| D-15 (the `/delivery` href and a sibling gate-before-read check)                                                                        | decided by precedent, recorded not escalated        | `a0-preflight.md:418-427`                                                                                                                                                                                                                                                                 |

---

## Count

| block                                           | items  |
| ----------------------------------------------- | ------ |
| A — gate and role acts                          | 4      |
| B — A0 decisions still open                     | 7      |
| C — recommendations pending Owner approval      | 5      |
| D — engineering decision open to Owner override | 1      |
| E — Owner-document update                       | 1      |
| F — scope and authorisation acts                | 8      |
| **Total**                                       | **26** |

**Eight items are marked "blocks this phase: YES":** A-1, A-2, A-3, A-4, B-7 (in one limb), F-2,
F-3 (conditional on the Owner requiring 16/16 Frontend) and F-4. Five of the eight — A-1, A-2, A-3,
A-4 and F-4 — are unconditional. Two items (CC-44, CC-10) were tested and excluded.

---

## Record defects found while assembling this packet — all corrected by the pull request that publishes it

These are engineering corrections, not Owner items. They are listed so the Owner can see that they were found,
what they were, and that none of them was left for the Owner to absorb. The full before → after table is
change-control-2026-09-08.md:4848.

1. **The closure record listed CC-17, CC-18, CC-36 and CC-39 with (a), (b) and (c) as open.** The register
   records all seven closed.
2. **It listed CC-33 with (a) and (b), and CC-34 with (a), (b) and (c), as open.** The register records them
   settled.
3. **It listed CC-35(a) and CC-35(b) as recommendations pending Owner approval.** The Owner decided all three
   on 2026-09-12 and § 47.5 implements the decision.
4. **It cited the wrong file for OWR-2026-09-06-G-10** — `docs/product/owner-workflow-requirements.md`, which
   exists and carries no `G-10` row. The row is in `docs/product/owner-requirements-2026-09-06.md:1496`.
5. **The "seven writes" mislabel.** The `rpt.report-configuration-*` family is seven **operations** — five
   writes and two reads. Annotated in both places that said otherwise.
6. **"Six closures are stated in the register and nothing else is closed" was wrong in both directions.**
   The derived index at § 62.6 replaces the reading: 25 open, 4 stating nothing, 47 closed or settled.
7. **CC-25 and CC-26 have prose dispositions and no state cell**, so no state can be read for them; they are
   filed under "states no usable disposition" rather than counted open on prose alone.
8. **CC-17 was contradicted twice inside the assurance index**, called "a closed disposition" in one place and
   listed under "Open items" in another. Resolved against the register's own cell: **the finding is closed and
   the property it describes is live**, and both places now say which they mean.
9. **Four state cells were stale in the register** — CC-01, CC-02, CC-22 and CC-42 — and are annotated in
   place, with the original wording kept visible.
10. **The task matrix carried two measurement heads at once** and two prerequisite rows that contradicted the
    first-parent history (P-11 and P-17). All twenty-nine rows are now measured on one head.
11. **A derivation in the register's § 61.4 did not reconcile** — "eleven `test(...)` declarations, two of
    which stand inside a four-code loop" gives 17, not the 14 stated beside it. Exactly one declaration stands
    inside that loop: 10 + 4 = 14. Corrected in place and confirmed against a hosted run.

**Two gate weaknesses were also observed, recorded and deliberately not worked around**: the doc-counts pin
accepts a provenance word without reading the run ledger (**CC-52 (b)**), and
`.github/ci-baselines/coverage-baseline.web.json:5` names a file its artefact has never carried, which belongs
to the coverage-policy lane and is recorded under no identifier.

---

**This packet does not contain the Owner's verdict; it lists what only the Owner can decide.**
