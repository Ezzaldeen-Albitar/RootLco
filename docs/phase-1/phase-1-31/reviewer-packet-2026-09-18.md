# P1-31 — the reviewer packet, 2026-09-18

**Status:** ROUTED, awaiting the designated human reviewer ·
**Routed to:** Eng. Ezzaldeen Al-Bitar, in the roles Owner decision **D-32** retains him in ·
**Measured at:** protected `develop` `3b50f26c02bf658d3b83f09b766cfa364bb0425e` (the merge of pull
request #417) ·
**Companions:** [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
(the nine items, and the EMPTY fields that are the only place a determination may be written),
[`determination-evidence-index-2026-09-18.md`](./determination-evidence-index-2026-09-18.md) (the
evidence, four kinds per row), [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 76
(the three excluded dispositions, read against the merged work) and § 77 (what moved beneath the
evidence base since the packet's head)

**THIS IS ONE PACKET, NOT A SERIES OF QUESTIONS.** It exists so that nine determinations can be made
from evidence in one sitting, and it asks for nothing else. **§ 7 carries one further item, routed
here on 2026-09-18 and labelled UNRESOLVED. It is not a tenth determination**, it is not a P1-31
item, and the nine rows can be answered without it.

**IT ISSUES NO DETERMINATION.** It fills no decision field, writes no name, no date and no signature,
records no verdict, moves no task-matrix row and moves no register state cell. **The nine decision
fields at [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 7 are
EMPTY and this packet leaves them empty.** Where it proposes a disposition it marks it **PROPOSED**,
and a **PROPOSED** disposition is an engineering reading of the evidence that the reviewer is free to
adopt, alter or refuse. **A proposal is not a determination and never becomes one by being written
down.**

**No test tier, build, migration, database operation, browser tier or hosted job was run to produce
this packet**, on the Owner's own instruction at
[`owner-decisions-2026-09-16.md`](./owner-decisions-2026-09-16.md) § 1: "Use the existing evidence
packet for QA-C1 through QA-C5 and SEC-C1 through SEC-C4. Do not launch new tests merely to prepare
those determinations."

Bare `.md` filenames are relative to `docs/phase-1/phase-1-31/`; every other path is written from the
repository root.

---

## 1. The three facts, kept separate

1. **The Owner's conditional decision EXISTS and is the Owner's.** **CONDITIONAL PASS** for the
   documented P1-31 scope, dated 2026-09-16 — **D-38**,
   [`owner-decisions-2026-09-16.md`](./owner-decisions-2026-09-16.md) § 7, transcribed into
   [`closure-record.md`](./closure-record.md) § 4. The Owner's own sentence forbids reading it as
   anything more: "Do not change gate rules or claim that the conditional decision itself satisfies
   the missing certification."
2. **The nine QA and Security determinations are ABSENT**, with **empty fields**. A blank row "is not
   a refusal and is not a pending approval; it is an act that has not been performed."
3. **Gate P1-G31's conditions 2 and 3 remain UNSATISFIED**, and condition 1 with them; condition 4 is
   answered. The four are conjunctive, so the gate is not satisfied
   ([`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 75.6). **Promotion stays NOT
   eligible** ([`closure-record.md`](./closure-record.md) § 6).

**The review this packet is routed for is a disclosed, authorized self-review and must never be
described as independent** — **D-32** in the Owner's words ("Do not describe a self-review as
independent"), `docs/governance/solo-developer-review-policy.md:36-37`, and
`docs/governance/standing-technical-authorization-policy.md:192-194`. **P1-EC-016 — an independent
security reviewer before production release — remains open and is claimed by nothing here.**

## 2. How to use this packet

**Where a determination is written.** Only in the nine rows of
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 7. Nothing in
this packet is a field, and writing in this packet determines nothing.

**What each row requires.** The five QA rows take **Certified / Certified-with-conditions / Refused**;
the four security rows take **Cleared / Cleared-with-conditions / Refused**. Each row has four fields:

| field                  | QA rows (QA-C1 … QA-C5)                         | security rows (SEC-C1 … SEC-C4)              |
| ---------------------- | ----------------------------------------------- | -------------------------------------------- |
| **determination**      | Certified / Certified-with-conditions / Refused | Cleared / Cleared-with-conditions / Refused  |
| **conditions, if any** | free text; empty means unconditional            | free text; empty means unconditional         |
| **name**               | the certifier's name, written by the certifier  | the reviewer's name, written by the reviewer |
| **date**               | the date the act was performed                  | the date the act was performed               |

**The disclosure sentence is MANDATORY on every determination, word for word**, from
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 2. It labels the
act an **owner-authorized technical self-review**, forbids representing it as an independent external
review, and records that **P1-EC-016 remains open and is not claimed by it**. The Owner's acceptance
of a self-review is the reason the sentence is required, not a reason to drop it.

**What moved since the head the certification packet was written against.** The nine **questions** are
unchanged and the nine **fields** are still empty, but **seven non-documentary artefacts changed**
between `beebc6c2` and this head, three of them the instruments behind **QA-C1**, **QA-C4** and
**SEC-C4**. They are enumerated, with what does and does not move because of them, at
[`determination-evidence-index-2026-09-18.md`](./determination-evidence-index-2026-09-18.md) § 3.1, and
analysed at [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 77. **One register
figure is stale as a result — CC-57 (a)'s "seven" reads six at this head** — and it is stated in full
in row § 3.4 below rather than left in the quotation. **No register state cell is moved by any of this.**

**What a determination would, and would not, establish** is set out at § 11 of that packet and is not
restated here.

---

## 3. The nine rows

Each row below gives four things and nothing else: **the question**, **the evidence index entry**,
**the PROPOSED disposition**, and **the exact fields to fill**.

### 3.1 QA-C1 — QA-001, coverage stated truthfully and labelled with the provenance it has

**The question.** Is the phase's unit and component coverage stated truthfully, and is every figure
labelled with the provenance it actually has?

**Evidence index entry.**
[`determination-evidence-index-2026-09-18.md`](./determination-evidence-index-2026-09-18.md) § 4.1 —
source/contract present, automated test present, **authenticated browser ABSENT** (coverage is not
that kind of measurement), physical/external **SPLIT**: the `web-quality` gate has a citable hosted
execution, the figures are **LOCAL**.

**PROPOSED — engineering's reading, not a determination.** **Certified-with-conditions**, the
conditions being, verbatim and unabridged: (a) every coverage figure is a **LOCAL** measurement and
keeps its `LOCAL, pending the hosted web-quality run` label — limitation **L-2**, and **CC-64 (b)**,
open; (b) hole **H-1** stays open and is counted on FE-004, deferred behind **`P1-31-FU-001`** and
closed by nothing; (c) `scripts/ci/coverage-gate.mjs` is reachable from no npm script and is invoked
only from the workflows, so no local aggregate enforces the floors; (d) **the instrument moved after
the figures were taken** — `apps/web/vitest.config.ts` widened `COVERAGE_INCLUDE` by two prefixes and
the web coverage baseline gained two critical-module floors between `beebc6c2` and this head (evidence
index § 3.1, rows 1 and 2), so the record's global figures were measured over a **smaller denominator
than the one configured here**, and nothing in this packet re-measures them. **No P1-31 figure and no
global floor moved.**

**Fields to fill, in [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
§ 7, QA table, row QA-C1:** determination; conditions; certifier's name; date. **Plus the § 2
disclosure sentence.**

### 3.2 QA-C2 — QA-002, API, contract and error-path coverage complete as a set

**The question.** Is API, contract and error-path coverage complete **as a set**, and are the contract
gaps found recorded rather than waived?

**Evidence index entry.** § 4.2 of the evidence index — source/contract present, automated test
present (`tests/ci/p1-31-error-path-matrix.test.ts:1027` … `:1159`, including two anti-vacuity
refusals), **authenticated browser ABSENT for the contract set**, physical/external only as the
hosted execution of the tiers.

**PROPOSED — engineering's reading, not a determination.** **Certified-with-conditions**, the
conditions being: (a) the quality-control record detail publishes its success body as a **bare
object** — limitation **L-3**, an instance of the chapter-wide shortfall **CC-46 (c)**, recorded and
**not waived**; (b) **CC-58 (c)** stands — the concurrency suite's header "states a replay coverage it
did not have", left as written and annotated rather than rewritten.

**Fields to fill:** § 7, QA table, row QA-C2 — determination; conditions; certifier's name; date.
**Plus the § 2 disclosure sentence.**

### 3.3 QA-C3 — QA-003, isolation proved at both layers as a set

**The question.** Is tenant, company and branch isolation proved at **both** layers, as a set?

**Evidence index entry.** § 4.3 of the evidence index — the database layer at
`tests/db/p1-11-isolation.test.ts:58`, `:97`, `:117`, `tests/db/shared-hardening.test.ts:336` and four
behavioural read negatives; the application layer at
`tests/backend/p1-31-privilege-escalation.test.ts:2116` (SE-6) and `:2242` (SE-7); a narrow browser
spec that is not the set proof; no external-service evidence.

**PROPOSED — engineering's reading, not a determination.** **Certified-with-conditions**, the
condition being **CC-58 (b)**: the assurance evidence index "reads two constraint suites as isolation
evidence they did not carry". The code half was repaired so the entry is **true at this head**, and the
register's own words — "**it was not true when written**" — stand; the index is not rewritten and the
row is not closed.

**Fields to fill:** § 7, QA table, row QA-C3 — determination; conditions; certifier's name; date.
**Plus the § 2 disclosure sentence.**

### 3.4 QA-C4 — QA-004, record-version sourcing enforced where reachable, the rest disclosed

**The question.** Is record-version sourcing mechanically enforced everywhere it is reachable, and are
the unreachable operations disclosed rather than hidden?

**Evidence index entry.** § 4.4 of the evidence index — the gate
`scripts/ci/check-p1-31-version-sourcing.mjs`, registered at `package.json:133` and run inside
`verify:policies`; `tests/ci/p1-31-version-sourcing.test.ts:83` … `:200`;
[`operator-runbook.md`](./operator-runbook.md) § 11; **authenticated browser ABSENT**.

**A figure in this row's register cell is STALE at this head, and the reviewer is told so before being
asked anything.** **CC-57 (a)** (register § 67) says "the **seven** PENDING operations remain
unreachable". At this head the gate declares **SIX**: `tests/ci/p1-31-version-sourcing.test.ts:111`
asserts `pending.length` is `6`, and `scripts/ci/check-p1-31-version-sourcing.mjs:128` reads "Six of
the eleven have no consumer". The seventh, `org.employee-status-set`, acquired a consumer and its entry
was deleted in that same change — commit `8bc4bfec`, merged with **pull request #413**, inside the
`#411 … #417` window. **No state cell is moved and the register cell is not rewritten**; a corrected
wording is **PROPOSED** at [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 77.2 for
the reviewer to adopt, alter or refuse. **CC-57 (a) is not discharged either way**: six operations
still have no consumer.

**PROPOSED — engineering's reading, not a determination.** **Certified-with-conditions**, the
conditions being: (a) **CC-57 (a)** is **OPEN** — **six** guarded operations have no consumer at this
head (the register cell still says seven, above) and "this gate discloses that rather than closing it";
three of the six are the checklist-template writes **D-36** deferred to **`P1-31-FU-001`**, deferred
and not closed, and three are the report-configuration writes; (b) **CC-57 (b)** is **OPEN** — the
gate "judges the SEND, not the screen state behind it", so no figure from it may be quoted as a
runtime property.

**Fields to fill:** § 7, QA table, row QA-C4 — determination; conditions; certifier's name; date.
**Plus the § 2 disclosure sentence.**

### 3.5 QA-C5 — QA-005, the acceptance record admissible as test evidence, not a verdict

**The question.** Is the acceptance record admissible as test evidence, is it clearly not a verdict,
and is its packaging half honestly recorded as unmet?

**Evidence index entry.** § 4.5 of the evidence index — [`acceptance-record.md`](./acceptance-record.md)
§§ 11.1–11.13; run `mu3ch41f`, **740 HTTP steps, 740 ok, 0 findings**; **84 P1-31 browser cases
executed, 0 failed, 28 per authenticated project**; **30 shot records, 28 images**; the digest table at
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 8.

**PROPOSED — engineering's reading, not a determination.** **Certified-with-conditions**, the
conditions being: (a) the **packaging half is UNMET** — `phase-1/_acceptance/` holds its README and
nothing else, and placing an artefact there is the certifier's and the Owner's act, not engineering's;
(b) the run's artefacts are **uncommitted** (**L-8**) and its five instruments live **outside the
repository, unversioned** (**L-5**, **CC-60 (g)**), identity resting on the digests the runner compared
against its pins before anything ran; (c) the privileged export fixture is a **local fixture on the
shared acceptance database**, absent from hosted execution, with an **uncommitted, hand-taken**
falsifiability control (**L-6**); (d) attempt 3 is retained and **qualified** by its instrument's
guessed record versions (**L-7**); (e) the record's own non-substitution sentence at § 11.13 is
attested **with** the figure and never instead of it.

**Fields to fill:** § 7, QA table, row QA-C5 — determination; conditions; certifier's name; date.
**Plus the § 2 disclosure sentence.**

### 3.6 SEC-C1 — SEC-001, permission and resolved-scope enforcement measured across the surface

**The question.** Is permission and resolved-scope enforcement measured across the phase's surface,
and is the limit of the least-privilege proof disclosed?

**Evidence index entry.** § 5.1 of the evidence index —
[`least-privilege-grant-map.md`](./least-privilege-grant-map.md) over 47 operations and 34 route files;
`tests/ci/p1-31-grant-map.test.ts:338` … `:375`, including "matches the committed document exactly";
`tests/backend/p1-31-privilege-escalation.test.ts:1910` (SE-5) and `:1999` (SE-5M0); the registered
gate `validate:p1-31-access`.

**PROPOSED — engineering's reading, not a determination.** **Cleared-with-conditions**, the condition
being **CC-58 (a)**, stated exactly as its own cell states it: "SE-5M cannot see a service-level
authority requirement for 45 of the 46 operations" — sufficiency is established **at the pre-handler
gate only**, and **one operation alone** is probed against real rows with a minimal caller. It is a
**disclosed input**, and no claim in that section reads past the limit.

**One mismatch in that quotation, flagged so it is not read as a contradiction.** The cell says **46**
operations; the grant map and census this same row cites say **47** over 34 route files, pinned at
`tests/ci/p1-31-grant-map.test.ts:78-79` and stated at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 69.13. **The two are unreconciled in
the source records**, the cell is quoted verbatim rather than corrected, **neither figure is re-derived
in this packet**, and the difference is recorded at § 77.3 of that register. The limitation is the same
in kind under either number: all but one operation are probed at the pre-handler gate only.

**Fields to fill:** § 7, security table, row SEC-C1 — determination; conditions; reviewer's name;
date. **Plus the § 2 disclosure sentence.**

### 3.7 SEC-C2 — SEC-002, sensitive-data, export and file-access controls, and how far the download rule reaches

**The question.** Do sensitive-data, export and file-access controls behave as recorded, and **exactly
how far does the download rule reach**?

**Evidence index entry.** § 5.2 of the evidence index — `attachment-policy.ts:42-52` (the **nine**
allow-listed link types) and `:65`; the download route; ten cases in
`tests/backend/p1-31-signature-download-refusal.test.ts` from `:488` to `:701`, of which **`:664` is
the one branch-scope case**; ten receiver-identity cases in
`tests/backend/p1-31-receiver-identity-evidence.test.ts`; two committed browser cases at
`apps/web/tests/e2e/authenticated/delivery-p1-31.spec.ts:478` and `:552`, recorded as passing in all
three authenticated projects; **no real object store is exercised by any committed evidence**.

**PROPOSED — NONE. Engineering makes no proposal on this row, deliberately.** The reason is the
Owner's own: **CC-63 (a) is marked NOT COVERED BY O-3**, because the carry-forward "creates no new
acceptance of an unresolved critical defect or an unresolved security/isolation blocker", and that row
is a **direct input to this determination** — the register routes it to "the security determination,
which does not exist at this head". A proposal to clear this row, even one labelled with conditions,
would be engineering proposing acceptance of the one thing the Owner declined to accept. **So the row
is routed unaided, with its facts stated and nothing recommended:**

- **CC-63 (a)** — "the download authorization does not refuse a caller whose file-access grant is
  scoped to another branch", **not discharged in whole or in part** by anything merged since
  ([`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 76.2).
- **L-9** — branch scoping on download is proved for **one case only**; the statement about the other
  admitted entity kinds is measured **from the policy catalogue, not proven by a test**.
- **L-10** — a live link to a **soft-deleted** entity still counts as reachable.
- **L-11** — runtime reachability is exercised for **three of the nine** allow-listed link types, with
  a fourth reached through shared fixtures.
- **What the merged work does supply**: the server-side refused-download negative **exists** and is a
  backend suite; the live-link and reachable-target rule is enforced; the receiver's optional identity
  evidence is captured and server-validated.

**Fields to fill:** § 7, security table, row SEC-C2 — determination; conditions; reviewer's name;
date. **Plus the § 2 disclosure sentence.**

### 3.8 SEC-C3 — SEC-003, abuse-case and privilege-escalation controls

**The question.** Do abuse-case and privilege-escalation controls hold, and is the observation left
undispositioned by design seen rather than buried?

**Evidence index entry.** § 5.3 of the evidence index —
`tests/backend/p1-31-privilege-escalation.test.ts:1703` (SE-0), `:1765` (a reason named for every
operation SE-6 and SE-7 do not reach), `:1793`–`:1875` (SE-1 … SE-4, including the database refusing
the same INSERT with the service check bypassed), `:1910` (SE-5), `:2116` (SE-6), `:2242` (SE-7);
`tests/backend/p1-31-concurrency-and-versioning.test.ts:350` … `:452`; **authenticated browser ABSENT**;
**physical/external ABSENT** — the probes run against a **disposable** database and no acceptance
record exercises them (**L-12**).

**PROPOSED — NONE. Engineering makes no proposal on this row, deliberately**, for the same reason as
§ 3.7: **CC-56 (b) is marked NOT COVERED BY O-3** and is named among this row's limitations. The facts,
stated and nothing recommended:

- **SEC-003-O1 is settled** by cited authority ([`change-control-2026-09-08.md`](./change-control-2026-09-08.md)
  § 66, applying CC-14 § 2) and is **not** in this list.
- **SEC-003-O2 is unchanged and open.**
- **CC-56 (b)** — six sites **outside** this phase's operation set still answer a refusal that discloses
  whether the target exists; **not discharged in whole or in part** by anything merged since, every line
  anchor re-read at this head (§ 76.1). Owed by the IAM lane (five sites) and the P1-30 inventory
  master-data lane (one).
- **CC-56 (d)** — carried under O-3, keeping its restriction: the P1-30 tenant-boundary case "pins
  neither code", and the test and the decision "should move together, in that lane".
- **L-12** — the escalation probes run against a disposable database only.

**Fields to fill:** § 7, security table, row SEC-C3 — determination; conditions; reviewer's name;
date. **Plus the § 2 disclosure sentence.**

### 3.9 SEC-C4 — SEC-004, audit-event coverage for the set of privileged actions

**The question.** Is security audit-event coverage proved for the **set** of privileged actions, and is
the export audit's limit disclosed?

**Evidence index entry.** § 5.4 of the evidence index — [`audit-class-review.md`](./audit-class-review.md)
§§ 1–5 (21 `auditClass: 'none'` declarations, 24 `privileged`) and
`apps/api/src/server/auth/audit-actions.ts`; `tests/backend/p1-31-audit-emission.test.ts:1436` … `:1493`,
including "covered by the emission table EXACTLY — no extra case, no unprobed write";
`apps/web/tests/e2e/authenticated/audit-log-p1-31.spec.ts`; and, in the run of record, **each of the
five exports carrying exactly one correlated audit event**, with the default administrator refused all
four report codes with `403 ERR-IAM-001`.

**PROPOSED — engineering's reading, not a determination.** **Cleared-with-conditions**, the condition
being **L-13**, quoted: "the export audit records selection and counts, not a byte length or a content
digest, so it cannot later identify the exact bytes disclosed" — the same fact **CC-61 (c)** carries as
a register row, with its own restriction that the audit is "deliberately not described as durable-file
provenance". **Disclosed with it:** `apps/api/src/server/auth/audit-actions.ts` is **+364/-1** between
`beebc6c2` and this head — later slices registered their own actions and one P1-30 description was
extended — while **no P1-31 action entry was removed, renamed or re-classed**, so the 21 `none` and 24
`privileged` declarations this row rests on are untouched (evidence index § 3.1, row 7).

**Fields to fill:** § 7, security table, row SEC-C4 — determination; conditions; reviewer's name;
date. **Plus the § 2 disclosure sentence.**

---

## 4. The three dispositions the Owner's carry-forward did NOT reach

**Stated here because two of them are direct inputs to a determination in § 3, and the third is the
determinations themselves.** Each is analysed against the merged work at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 76, where **none of the three is
discharged**, **no closure is proposed**, and **no state cell moves**.

| row           | what it is                                                                     | bears on          | discharged by #411 … #417? |
| ------------- | ------------------------------------------------------------------------------ | ----------------- | -------------------------- |
| **CC-56 (b)** | six sites outside this phase whose refusal discloses whether the target exists | **SEC-C3**        | **no — nothing**           |
| **CC-63 (a)** | the download authorization does not refuse a branch-scoped file-access grant   | **SEC-C2**        | **no — nothing**           |
| **CC-60 (d)** | the unissued certification and the unissued clearance                          | **all nine rows** | **no — and it could not**  |

**"NOT COVERED BY O-3" does not downgrade, close or reclassify any of the three.** Each keeps its
identifier, its cell, its owner and its restriction exactly as the register holds them.

## 5. P1-31-FU-001 — deferred, named, and not closed

**`P1-31-FU-001` — Delivery checklist-template administration screen**, recorded at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 75.4 under **D-36**, state **open,
deferred, not built**, owner **unassigned — a later Frontend lane**.

In the Owner's words it "is not a P1-31 closure requirement and must not be inserted into P1-32, whose
purpose is frontend validation rather than new administration features." **It closes nothing**:
coverage hole **H-1** stays open on its own terms, **CC-57 (a)** keeps its state, the five pending
mirror entries stay pending, and **FE-004 does not move**. It bears on **QA-C1** and **QA-C4**, and is
weighed as **deferred work with a named destination**, not as work discharged.

## 6. What this packet does not do

- **It issues no certification and no clearance**, and it fills none of the nine decision fields.
- **It writes no name, no date and no signature**, for anybody, and it substitutes no automated reading
  for a human determination.
- **Every disposition it states is PROPOSED**, and two rows carry no proposal at all, deliberately.
- **It describes no review as independent**, and it does not close **P1-EC-016**.
- **It moves no task-matrix row, no register state cell and no total**, and it marks nothing fixed or
  completed.
- **It records no unconditional Pass, no "100% verified" claim, no production-readiness claim and no
  issued human certification.**
- **It ran no test tier, build, migration, database operation, browser tier or hosted job**, and it
  claims no result of one.
- **It writes nothing into `phase-1/_acceptance/`.**
- **It authorises no promotion.** Promotion stays NOT eligible.
- **It answers nothing in § 7**, approves no prototype, designates no fidelity basis and starts no
  P1-32 task.

## 7. Routed alongside the nine — one UNRESOLVED question that is not a tenth determination

**Read this as routing, not as a question the nine rows depend on.** It is placed here because this
packet is the one thing routed to the reviewer, and the question below has no other destination. It
is **not** a tenth determination: it fills no field in
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 7, it alters no
question in §§ 3.1–3.9 above, it moves no register state cell, and **P1-G31's four conditions are
unchanged by it**. A reviewer may answer the nine without touching it.

**The question is OIR-06's, and it belongs to P1-32.** It is stated in full, with every citation,
at [`../phase-1-32/reconciliation-2026-09-18.md`](../phase-1-32/reconciliation-2026-09-18.md) § 4,
and it is the item that file's § 4.3 routes here.

**The contradiction, compressed to four sentences.** P1-32 Field 6 (¶19909) binds every Frontend task
to an owner-approved prototype and forbids new visual design work. No per-module approved UI
prototype exists for P1-26 through P1-31 — recorded as **MISSING**, per module, at
[`../phase-1-32/fe-001-fidelity-basis.md`](../phase-1-32/fe-001-fidelity-basis.md) § 2.8. What is
recorded instead is a designated basis — "the approved P1-25 design system itself; no separate
package required" at `../phase-1-25/gate-record.md:44` and `../phase-1-26/gate-record.md:273`, and
the replacement rule "**OIR-06 is resolved**" written in P1-27's own name at
`../phase-1-27/canonical-plan.md:66` — while two Accepted ADRs at the same head state the opposite,
`docs/adr/ADR-013-sass-and-scss-styling-architecture.md:9` and
`docs/adr/ADR-020-frontend-styling-framework-and-component-primitives.md:139`, both reading that
OIR-06 **remains open**. P1-28 through P1-31 carry no basis row at all and rest on the P1-27 rule by
an inheritance no document states.

**STATUS: UNRESOLVED. Owner-or-reviewer decision.** Six resolutions are listed with their owners at
[`../phase-1-32/reconciliation-2026-09-18.md`](../phase-1-32/reconciliation-2026-09-18.md) § 4.2 —
supplying the two never-delivered prototype packages; extending the designated basis by an explicit
determination; pinning which version of the design system is the basis; reconciling the ADR wording
through controlled change; re-scoping FE-001 to a composition-conformance review with a stated
verdict vocabulary; or deferring FE-001 with conditions under Field 33. **None is recommended here
and none is ranked.** The one option that is refused rather than offered is declaring the current
implementation an approved prototype — engineering may not convert the thing being reviewed into the
thing it is reviewed against.

**What is not claimed by routing it.** No prototype is approved, no basis is designated, no fidelity
verdict is reached for any module other than the P1-25 one already recorded at
`../phase-1-25/gate-record.md:123-133`, and **no P1-32 task is started** — P1-32's dependency rule in
Field 7 still governs and Gate P1-G31 is still unsatisfied.
