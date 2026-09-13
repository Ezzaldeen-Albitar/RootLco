# P1-31 — closure record (inputs to gate P1-G31)

**Measured at protected `develop` `81b3bce804626353a1a7b9f4ba52f1306c8f8b6e`** (the merge of PR
#380, the acceptance record); `main` `1262de74`, untouched by this phase.

This record is an **input to gate P1-G31, not the gate's decision.** Field 33 of
[`canonical-plan.md`](./canonical-plan.md) makes the gate four conjunctive conditions, and the
fourth is the approval owner's. Nothing here records that verdict, stands in for it, or implies it
was given — § 4 leaves its field empty and says who may fill it. Until all four conditions hold, the
chapter's own status for all twenty-nine tasks **remains `Planned`**, and this record changes no
chapter status.

Every figure below was read on this head or is quoted from a phase record with its file named. No
test tier, build, migration or database operation was run to produce it, and no hosted result is
claimed anywhere in it.

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
(#363), P-10 (#356), P-11 (#361 writer, #364 and #374 engine), P-2b (#358), P-13 and P-14 (#354),
P-15 (#346), P-16 (#357), P-17 (#370). **P-12, the report export operation, is not started**, and
`rpt.export` is withheld from the provisioning bundle by explicit Owner decision (**CC-04**).

**A prerequisite closes no canonical task.** That is rule 1 of
[`task-matrix.md`](./task-matrix.md:19), it is repeated in every prerequisite section of the
register, and it governs this record: a merged seam removes an obstacle, and removing an obstacle is
not the event that finishes a task. The same rule forbids reading the eighteen merges as eighteen
closures.

## 2. The 29 canonical tasks, reconciled to evidence

The `state` column is **[`task-matrix.md`](./task-matrix.md)'s own value, quoted, not derived here**
— § 7 and **CC-45** record the four rows where that value is older than this head. The matrix's
state vocabulary is at [`task-matrix.md`](./task-matrix.md:36-47); `end-to-end verified` is admitted
only on the acceptance record's evidence, by its rule 2.

**No gate derives this table.** P1-28's register was machine-compared against a generated
`task-matrix.json`; P1-31 has a hand-written matrix, no generated one and no `validate:p1-31-matrix`,
so the count of twenty-nine and every row below are held by reading alone. A reader who needs the
authoritative state must read the matrix, not this summary of it. _(The state column read `state on
`develop` (matrix)`: true when written; corrected by this pull request, whose own three rows —
DO-002, DOC-001 and DOC-002 — are in the matrix on this branch and not yet on `develop`.)_

| task    | item                              | delivered by (slice + pull request)                                  | record-proof pointer                                                      | state in the matrix        |
| ------- | --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| FE-001  | Ready-for-delivery list           | readiness queue #367 (`ae0e0354`), on the #366 (`01c32937`) contract | `acceptance-record.md` § 7.1 (`mtz5ppq8`), HTTP step 118; register § 42   | end-to-end verified        |
| FE-002  | delivery eligibility              | #357 (`fc58f1c2`) read, #362 (`78d34fbc`), Start #377 (`9b109f63`)   | `acceptance-record.md` steps 106, 115, 116; register § 51                 | end-to-end verified        |
| FE-003  | authorized receiver               | #357 (`fc58f1c2`) read, #362 (`78d34fbc`) verification               | `acceptance-record.md` steps 107 and 157                                  | end-to-end verified        |
| FE-004  | delivery checklist                | P-9 #355, P-9b #363 (`07193258`), #362 (`78d34fbc`)                  | `acceptance-record.md` steps 113, 114, 156                                | end-to-end verified        |
| FE-005  | final odometer                    | #362 (`78d34fbc`)                                                    | `acceptance-record.md` steps 117 and 118                                  | end-to-end verified        |
| FE-006  | delivery signatures               | #357 (`fc58f1c2`) read, #362 (`78d34fbc`) upload and link            | `acceptance-record.md` steps 108 to 112                                   | end-to-end verified        |
| FE-007  | delivery document                 | #368 (`8c4e6a9c`)                                                    | `acceptance-record.md` § 7.1 (print counter, both locales); register § 44 | end-to-end verified        |
| FE-008  | warranty record                   | #369 (`deb404c1`) and #375 (`6c99e805`)                              | `acceptance-record.md` steps 120 to 122; `warranty-p1-31.spec.ts`         | end-to-end verified        |
| FE-009  | warranty history                  | #375 (`6c99e805`) — the vehicle-filtered list only                   | `task-matrix.md` FE-009; **CC-10**, **CC-31**                             | merged (read-only/partial) |
| FE-010  | operational dashboard             | #376 (`72782f48`) — `/{locale}/reports/overview`                     | `operational-overview.md`; register § 53; `acceptance-record.md` § 6      | in open PR                 |
| FE-011  | work-order reports                | #371 (`46be4bb2`), dataset #374 (`6b3c6c45`)                         | `report-screens.md`; `acceptance-record.md` § 7.1 class D                 | merged (read-only/partial) |
| FE-012  | technician reports                | #371 (`46be4bb2`), dataset #374 (`6b3c6c45`)                         | `acceptance-record.md` § 7.1; register § 45                               | end-to-end verified        |
| FE-013  | inventory reports                 | #371 (`46be4bb2`), dataset #374 (`6b3c6c45`)                         | `acceptance-record.md` § 7.1; register § 46                               | end-to-end verified        |
| FE-014  | invoice/payment reports           | #371 (`46be4bb2`), dataset #374 (`6b3c6c45`)                         | `acceptance-record.md` § 7.1; register § 47                               | end-to-end verified        |
| FE-015  | audit report                      | #360 (`f8958e77`)                                                    | `acceptance-record.md` § 7.1, HTTP steps 134-135; register § 36           | end-to-end verified        |
| FE-016  | branch pilot summary              | #376 (`72782f48`) — the same screen, branch fixed by the address     | `operational-overview.md`; register § 53; `acceptance-record.md` § 6      | in open PR                 |
| SEC-001 | permission and resolved scope     | #379 (`329b19ab`) indexes the slice proofs (#360, #358, #363)        | `security-and-qa-evidence.md` § 1                                         | phase-level incomplete     |
| SEC-002 | sensitive data, export, files     | #379 (`329b19ab`); D-6 settles the export posture                    | `security-and-qa-evidence.md` § 2                                         | phase-level incomplete     |
| SEC-003 | abuse cases, privilege escalation | § 3.1's four-part breakdown, one part uncovered and routed           | `security-and-qa-evidence.md` § 3                                         | phase-level incomplete     |
| SEC-004 | security audit-event coverage     | nothing closes it; declarations counted, not reviewed                | `security-and-qa-evidence.md` § 4                                         | not started                |
| QA-001  | unit and component coverage       | #379 (`329b19ab`) indexes the web suites; slices carry their own     | `security-and-qa-evidence.md` § 5                                         | phase-level incomplete     |
| QA-002  | contract and error-path coverage  | #379 (`329b19ab`) indexes the seam and adapter suites                | `security-and-qa-evidence.md` § 6                                         | phase-level incomplete     |
| QA-003  | tenant/company/branch isolation   | #379 (`329b19ab`); acceptance isolation cases                        | `security-and-qa-evidence.md` § 7; `acceptance-record.md` § 4             | phase-level incomplete     |
| QA-004  | concurrency and idempotency       | nothing closes it; declarations counted                              | `security-and-qa-evidence.md` § 8; **CC-17**                              | not started                |
| QA-005  | regression, evidence packaging    | harness #378 (`6005cfa4`), record #380 (`81b3bce8`)                  | `acceptance-record.md`; register §§ 52, 54; **CC-42**, **CC-43**          | phase-level incomplete     |
| DO-001  | CI quality gate                   | P-16 #357 (`fc58f1c2`), `validate:p1-31-access`                      | `security-and-qa-evidence.md` § 10                                        | merged (read-only/partial) |
| DO-002  | logging, monitoring, alerting     | the operator half only: `operator-runbook.md`; monitoring untouched  | `security-and-qa-evidence.md` § 11                                        | implemented/unmerged       |
| DOC-001 | contract and traceability sync    | corrections merged (#354); correction #3 retracted in place here     | `security-and-qa-evidence.md` § 12                                        | implemented/unmerged       |
| DOC-002 | guidance and the change record    | the register itself, and `operator-runbook.md` as the guidance       | `security-and-qa-evidence.md` § 13                                        | implemented/unmerged       |

**Totals by state, counted off the column above:** `end-to-end verified` **12**;
`merged (read-only/partial)` **3**; `in open PR` **2**; `phase-level incomplete` **7**;
`implemented/unmerged` **3**; `not started` **2**. Twenty-nine.

_(Four rows and these totals were true when written; corrected by this pull request. SEC-003 moved
to `phase-level incomplete` on `develop` in #382, and DO-002, DOC-001 and DOC-002 move out of
`not started` here; the totals read `phase-level incomplete` **6** and `not started` **6** with no
`implemented/unmerged` class, and are re-counted off all twenty-nine rows of `task-matrix.md` at
the merged head. Every other row is untouched, and nothing moved to `end-to-end verified` —
documentary evidence never earns that state.)_

### 2.1 The four Frontend rows that are not `end-to-end verified`, each checked

Twelve of the sixteen Frontend rows carry `end-to-end verified` on the acceptance record — six on
the HTTP half of run `mtz2geo1` (§ 6) and six on the browser correction pass `mtz5ppq8` (§ 7.1).
The other four are not, and the reasons differ:

- **FE-009, warranty history — no reader exists to verify.** The status-history table has no reader
  anywhere in the API, so the screen states that the transition record is unreadable rather than
  rendering one. The acceptance "cannot confirm a ledger that is not published"
  (`acceptance-record.md` § 6). This is a missing capability, not missing browser evidence:
  **CC-10** and **CC-31**, with **P-18** named as the backend prerequisite that would close it.
- **FE-010 and FE-016, the operational overview — no browser case and no HTTP step exist.** The
  screen was reached at `/{locale}/reports/overview` and rendered thirteen rows in both locales, but
  the acceptance plan was written before #376 merged and covers neither task. `acceptance-record.md`
  § 6 states the consequence in four words: "Reached is not verified." Nothing about them changed in
  the correction pass.
- **FE-011, work-order reports — its own case ran and failed on a count.** With the locator
  ambiguities gone, `work_orders_by_status renders exactly the rows the server answered` reached its
  row count for the first time and failed in both locales: the harness recorded **1** row, the
  screen rendered **2**, and the same read issued over HTTP immediately afterwards **answered 2** —
  the screen rendered exactly what the server answered. The recorded figure was taken before the
  journey's own later writes, on a dataset that publishes its freshness as `live`. The equality was
  therefore never satisfied, the assertion was deliberately left unrelaxed, and the repair belongs to
  the harness, which is held outside this repository (`acceptance-record.md` § 7.1, class D).

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

**Bullet 1 — not evidenced.** Twelve of twenty-nine tasks are `end-to-end verified`; seventeen are
not, of which two are `not started` and three are implemented but unmerged (§ 2). Every merged slice carries its own record and its own
suites, and each pull request was judged by the repository's required checks, which the matrix's
integration reconciliation reports as nineteen post-merge checks per merge — that is the matrix's
report, re-stated here and not re-run. The phase-specific gate **`validate:p1-31-access`** exists and
is run by `verify:policies` (§ 10 of the evidence index). What is missing is not a gate result but
coverage: SEC-004 and QA-004 have no artefact at all, SEC-003, DO-002, DOC-001 and DOC-002 have one
that closes a named part and not the task, and no task can satisfy its own Test reference because
all three cited test ids resolve to nothing (**D-16**, **CC-37**).

_(This bullet read "six are `not started`" and listed all six tasks as having no artefact that
closes them: true when written; corrected by this pull request, which supplies the operator half of
DO-002 and the in-repository half of DOC-001 and DOC-002, and by #382, which moved SEC-003. The
bullet's verdict — **not evidenced** — is unchanged, and none of the four is closed.)_

**Bullet 2 — not evidenced.** The isolation half is strong: every refusal, concurrency and isolation
case the acceptance plan names answered as it should (`acceptance-record.md` § 4, fifteen cases,
including both cross-organisation reads and the three permission refusals). The findings half is
not: SEC-004 is `not started` and SEC-003 is `phase-level incomplete` with one part uncovered
(true when written as "SEC-003 and SEC-004 are `not started`"; SEC-003 moved in #382), the register
carries open dispositions listed in § 5,
and **no formal acceptance by the authorized owner is recorded for any of them**. "Closed or
formally accepted" is satisfied by neither limb today.

**Bullet 3 — not evidenced.** Inside the phase the synchronisation holds: the register runs sections
1 … 57 with CC-01 … CC-47, every slice carries a seam or screen document, the matrix carries a row
per task, and the Owner decisions are in three dated files. Outside it, two things the bullet names
do not exist here — `documentation/` (the Field 34 set) is absent from the repository and
`_acceptance/` is absent — and the runbook `operator-runbook.md` carries the four operator acts this
phase owes after merge, which **remain owed on every environment other than the shared acceptance
database** (`security-and-qa-evidence.md` §§ 11 and 13, **CC-16**, **CC-20**, **CC-37(c)**).

_(This bullet read "sections 1 … 55 with CC-01 … CC-45" and "**no runbook exists**": true when
written; corrected by this pull request, which adds § 57 and CC-47 and the runbook, and by #382,
which added § 56 and CC-46. The bullet's verdict — **not evidenced** — is unchanged: a runbook is
not a run, and CC-16, CC-20 and the Field 34 `documentation/` set all stay open.)_

**Bullet 4 — not evidenced, and not this session's to evidence.** No Owner decision on the phase is
recorded anywhere in the repository. The acceptance record's own verdict is **PARTIAL** and its § 1
says in terms that it does not stand in for the Owner's.

## 4. Gate P1-G31 — the four inputs, and what exists

Quoted from [`canonical-plan.md:464-472`](./canonical-plan.md):

> Gate P1-G31: RootLco may authorize dependent work only when the Definition of Done is evidenced,
> the QA lead certifies the test/evidence index, the Security reviewer clears applicable blockers,
> and the approval owner records Pass / Conditional Pass / Fail / Deferred with conditions. Until
> then, status remains Planned.

| condition                                | what exists on `develop` `81b3bce8`                                                                                                                                                                                                                                         | what is missing                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. the Definition of Done is evidenced   | § 3 above, bullet by bullet: twelve tasks end-to-end verified, the acceptance record's 176-step HTTP journey with zero findings taken twice on two organisations, 32 of 34 browser cases passing, `validate:p1-31-access` registered and run by `verify:policies`           | all four bullets fall short; six tasks `not started`; no runbook; `documentation/` absent; no Owner decision                                                                 |
| 2. the QA lead certifies the index       | the index itself — [`security-and-qa-evidence.md`](./security-and-qa-evidence.md), thirteen sections, one per non-Frontend task, every figure a static read of a named path, plus [`acceptance-record.md`](./acceptance-record.md) and [`task-matrix.md`](./task-matrix.md) | **no certification.** The index is marked OPEN, it has been routed to nobody, and no QA lead is named in this repository. A record is not a certificate of itself            |
| 3. the Security reviewer clears blockers | SEC-001 … SEC-004 as §§ 1-4 of the index; the acceptance record's refusal, concurrency and isolation cases (§ 4); the permission and paired-scope suites the index cites                                                                                                    | **no clearance.** SEC-003 and SEC-004 are `not started`; the open security-relevant dispositions of § 5 are recorded, none is formally accepted, and nobody has cleared them |
| 4. the approval owner records a verdict  | nothing                                                                                                                                                                                                                                                                     | the verdict itself — see the field below                                                                                                                                     |

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

The register carries an index of its open items at change control § 57.4, raised as **CC-47**, and
every disposition in it is filed as recorded rather than fixed. _(This sentence read "The register
carries no index of open items": true when written; corrected by this pull request, which adds that
index. Its partition of the register's seventy identifiers — 27 open, 39 closed or settled, 4
stating nothing — is derived from each disposition's own state cell and counts on a different basis
from the six explicit closures named next; neither figure is re-adjudicated here.)_ **Six closures are stated in the register and nothing else is closed:** **CC-01** (§ 29,
by P-10), **CC-02** (§ 34, by the P-11 writer), **CC-14** (§ 35, by the P-9b migration), **CC-29a**
and **CC-29b** (§ 41, in the slice) and **CC-42** (§ 54, by measurement — the journey half ran).
**CC-43** is closed in part (§ 54.6): twenty-three of its twenty-five cases were repaired, two
remain. Everything below therefore stands open, with the section that records it:

- **Provisioning and bundle:** CC-03 (organisations provisioned before P-1 keep the old bundle, § 3),
  CC-04 (`rpt.export` withheld by Owner decision, § 3), CC-07 (`wty.warranty.read` carried, § 13),
  CC-08 (earlier organisations lose the warranty detail read, § 13), CC-11 (the backfill is an
  operator act, not a route, § 18), CC-16 and CC-20 (organisations provisioned before the widenings
  cannot administer or delegate, §§ 29, 34).
- **Reads and contracts:** CC-05 and CC-09 (reads that are not pure publications, §§ 8, 13), CC-06
  (the checklist-results read does not close P1-27-INT-088, § 8), CC-10 (no warranty status-history
  reader, § 13), CC-19 (a read seam with no consumer, § 33), CC-23 (no index for the list ordering,
  § 37), CC-24 (no batch variant — about 5N round trips per page, § 39).
- **Documentation defects in source:** CC-12 (two Backend docblocks still name a code navigation no
  longer uses, § 22), CC-13 (a corrected claim surviving in six further docblocks and two gate-register
  notes, § 24).
- **Warranty:** CC-15 (the `coverage-windows` segment, § 29), CC-17 (one write version-guarded and
  not replayable, § 29), CC-18 (coverage CHECK constraints unreachable through the routes, § 29),
  CC-31 (FE-009 ships partial, § 43), CC-36 (one error code with three causes, § 48).
- **Delivery:** CC-21 (closing CC-14 required replacing a protected function, § 35), CC-25 and CC-26
  (the execution write paths and the identity-evidence category, § 38), CC-30 (no reduced readiness
  view for an operator without `sal.finance.view`, § 42), CC-32 (the printed sheet names nobody for
  the delivering employee, § 44), CC-39 with (a), (b) and (c) (one error code with two causes; a
  branch typed as an identifier; a read with no production consumer; a gate segment no dashboard area
  is named for, § 51).
- **Reporting:** CC-22 (selectors declared blocked that were not, § 36), CC-27 with (a) and (c) and
  CC-28 (decisions taken ahead of confirmation; two mutation patterns no longer applicable; the
  writer and engine disagreeing about `parameter_schema`, § 40), CC-33 with (a) and (b), CC-34 with
  (a), (b) and (c), CC-35 with (a), (b) and (c) (§§ 45-47), CC-38 with (a) (raw exact strings
  displayed; two drill-through targets with no screen, § 50), CC-41 with (a) (four reads rather than
  one; a non-executable section rendering as not runnable, § 53).
- **Assurance:** CC-37 with (a), (b) and (c) (the thirteen non-Frontend tasks have no definition;
  eleven `wty.`/`rpt.` writes are held to no payload-mirror gate; seven report-configuration writes
  have no consumer outside a generated manifest; the bundle backfill has a prerequisite no repository
  record named, § 49), CC-43 residue (two browser cases still failing, § 54.4), CC-44 (the
  handoff-gated reporting cases can pass only where the browser credentials are overridden, § 54.7),
  and **CC-45** (§ 55, raised by this record).

**One identifier has no disposition anywhere: CC-40.** Two lanes claimed it, the operational
overview settled the range and the harness lane moved to CC-42, so the sequence carries a hole at 40
rather than a finding. It is named here so a reader does not go looking for the row.

### 5.2 The three product observations from the acceptance record

All three are `acceptance-record.md` § 6, recorded for the lanes that own them and not repaired by
any P1-31 slice:

- **O-1 — `wo.work_order.line.manage` is not in the tenant-administrator bundle.** The code is in the
  permission catalogue and is declared by a shipped operation; `wo.service-line-record` answered
  `403 ERR-IAM-001` to a fresh organisation's first administrator. It blocked nothing in the journey,
  because an invoice derives from an accepted quotation revision, but that administrator cannot
  record a service line or a required-part demand at all. Backend `iam` owns it.
- **O-5 — a draft report configuration withdraws its dataset from the catalogue.** A tenant
  configuration in `draft` suppresses the baseline in `listPublished`, and the by-code read refuses
  an unpublished one, so `rpt.report-run` answers `404 ERR-RES-001` for that code. The behaviour is
  documented in the service; the consequence — that creating a configuration and not publishing it
  withdraws a report the tenant already had — is stated nowhere a screen could show it. Backend
  `reporting` owns it.
- **O-6 — closure eligibility answered eligible while the state graph refused.**
  `wo.work-order-closure-eligibility` answered `eligible: true, blockers: []` at a moment when the
  closure command refused with `ERR-TRN-001`, because the eligibility read answers for the closure
  CONDITIONS and not for the state graph. Both answers are correct, and together they mislead a
  caller. Backend `work-order` owns it.

The same section records five further observations that are not product defects in the same sense
and are carried with them: **O-2** and **O-3** (the browser-suite defects the correction pass
closed), **O-4** (a published configuration replaces the translated title with the tenant's own
label, so an Arabic screen can correctly show English text), **O-7** (the warranty list's empty-state
sentence describes an identifier field the screen no longer has) and **O-8** (the status-history
envelope shape).

### 5.3 Owner decisions still unanswered

From [`a0-preflight.md`](./a0-preflight.md)'s own list, twelve of the twenty are settled — D-2
(§ 17 of the register), D-3, D-4, D-5, D-6 (2026-09-09), D-7, D-11, D-12, D-17, D-18 (2026-09-10),
D-19, D-20 (2026-09-12) — and D-15 was decided by precedent. **These remain open:**

| decision | question, in one line                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| **D-1**  | who owns P1-31's backend prerequisites — Phase 1-22 or Phase 1-24, and by which route                        |
| **D-8**  | does the Frontend dependency chain bind execution order, or is it planning notation                          |
| **D-9**  | the warranty half only: which permission gates the warranty reads (the delivery half is settled)             |
| **D-10** | does Field 24 require an event-consumption mechanism, or is polling accepted                                 |
| **D-13** | where the P1-30 / P1-31 split for delivery and warranty lies                                                 |
| **D-14** | whether Field 7's product-name precondition is superseded or the canonical document is re-synchronised first |
| **D-16** | which task owns the cited test ids, and where phase evidence lands given `_acceptance/` does not exist       |

Four further items are **recommendations pending Owner approval**, not questions this record may
answer: **A-3 … A-6** on the delivering-employee identity (**CC-29**,
[`delivering-employee-identity-seam.md`](./delivering-employee-identity-seam.md)), **CC-35(a)** and
**CC-35(b)** on the invoice-and-payment dataset, and D-17's source-column recommendation
(`org.branches.timezone_name`). One register-row update is **owed to an Owner document and still
owed**: `OWR-2026-09-06-G-10` reads `Undecided` in `docs/product/owner-workflow-requirements.md` at
this head, and changing an Owner document is the Owner's act.

### 5.4 Operator facts, and evidence that lives outside this repository

- **The shared local database the acceptance ran against** was confirmed read-only before each run:
  `supabase_migrations.schema_migrations` **141** rows against **141** `supabase/migrations/*.sql`
  files (re-counted on this head: 141); `iam.permissions` **121** codes; every `tenant_administrator`
  role holding exactly **78** permission codes.
- **`org.tenants` went from 25 rows to 39** across the acceptance window. **Fourteen
  `p31_journey_*` organisations remain** — twelve from the six harness runs of § 7 and two from the
  correction pass of § 7.1. **None was deleted**, on the P1-30 precedent: their codes match no
  backend-suite prefix, so no routine run will remove them and none of them will remove anything
  else. Every handoff was removed, so no credential is left on disk.
- **The acceptance evidence is not in this repository.** The HTTP harness and its screenshot
  companion are at `orchestration/acceptance/` in the workspace that contains this checkout
  (**CC-42**, register § 52.6), and each run's `summary.json`, `steps.json`, `steps.md` and images
  are in the unguessable temporary directory the harness creates for itself, named in
  `acceptance-record.md` § 5.
- **The P-17 operator acts of 2026-09-12** are recorded in
  `orchestration/evidence/p1-31/p17-operator-20260912/` — sixteen entries, also outside this
  repository. They were performed by hand against one shared local database in a container: the
  migration ledger brought to parity, the delivering-employee backfill run dry then real, and the
  bundle backfill refusing **exit 5** on its first pass before the permission-catalogue seed was
  applied, then widening 24 administrator roles from 76 to 78 codes. That refusal is **CC-37(c)**:
  the act has a prerequisite no repository record names.
- **Four operator acts remain owed on every environment that is not that one database**: the P-9b
  migration, the two P-17 migrations, the delivering-employee backfill and the tenant-administrator
  bundle backfill (`security-and-qa-evidence.md` § 11). The runbook `operator-runbook.md` carries
  the four acts; the acts remain owed on every environment other than the shared acceptance
  database. _(This bullet read "No runbook carries them": true when written; corrected by this pull
  request. What is owed is unchanged — a runbook is not a run.)_

## 6. What this record does not claim

- **No Owner Pass, and no verdict of any kind.** § 4's field is empty and only the Product Owner may
  fill it.
- **No promotion.** `main` is `1262de74` and this record does not move it. Promotion is a separate
  governed act — a content-free synchronisation, then a merge-commit promotion — recorded in its own
  pull requests.
- **No hosted acceptance.** Every figure in the acceptance record is loopback, taken on a production
  build served on one machine against one local database. Whether the `authenticated-browser` job is
  green at any head is a fact only that job can establish, and it is not asserted here or in
  `acceptance-record.md` § 7.2.
- **The specific browser evidence that does not exist**, named so nobody has to infer it: there is
  **no committed browser case and no HTTP step for the operational overview** (FE-010, FE-016); the
  `work_orders_by_status` row-count case **fails in both locales** and FE-011 rests on nothing else;
  the **warranty plans screen's own case did not run to completion** on the recorded run; and there
  is **no browser evidence at all for a warranty transition ledger**, because none is published.
- **No gate result produced by this record.** It ran no tier, no build, no migration and no database
  operation. The checks run for the pull request that carries it are named there.

## 7. Change control

This record takes **section 55 and CC-45** of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — the next free pair, read on
`develop` `81b3bce8`, where the register runs to section 54 and CC-44 and the one open P1-31 pull
request claims neither. **CC-45** records the four matrix rows whose State is older than this head,
and why this record does not move them.
