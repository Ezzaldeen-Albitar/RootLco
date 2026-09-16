# P1-31 — certification and clearance packet, prepared for the assigned reviewer

**Status:** OPEN, prepared and routed · **Measured at:** protected `develop`
`849a8e9a7d8960e784456d5d886d5976350f0b24` (tree `b8390f33`, the merge of pull request #400) ·
**Allocation:** change control § 70 / **CC-60 (d)** ·
**Companion records:** [`closure-record.md`](./closure-record.md) (the gate inputs),
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) (the evidence index),
[`acceptance-record.md`](./acceptance-record.md) (the runs),
[`task-matrix.md`](./task-matrix.md) (the states),
[`coverage-record.md`](./coverage-record.md) (QA-001's cross-screen artefact),
[`audit-class-review.md`](./audit-class-review.md) (SEC-004's declaration review),
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) (the dispositions)

**THIS DOCUMENT PREPARES CERTIFICATIONS. IT ISSUES NONE.** Every decision field below is empty on
purpose. No certification, no clearance, no waiver, no approval and no phase verdict is recorded,
implied or inferred anywhere in it, and none may be supplied by any session, agent, pull request or
record other than the person who holds the role. **No signature is written on anybody's behalf.**

**No test tier, build, migration, database operation or deployment was run to produce this packet.**
Every figure is a static read of the tree at this head, or a result quoted from a phase record with
the section that states it — and that record, not this prose, is the authority. Bare `.md` filenames
are relative to `docs/phase-1/phase-1-31/`; every other path is written from the repository root.

---

## 1. The gate conditions these items exist to answer

Quoted from [`canonical-plan.md:466-469`](./canonical-plan.md), Field 33:

> Gate P1-G31: RootLco may authorize dependent work only when the Definition of Done is evidenced,
> the QA lead certifies the test/evidence index, the Security reviewer clears applicable blockers,
> and the approval owner records Pass / Conditional Pass / Fail / Deferred with conditions. Until
> then, status remains Planned.

Four conjunctive conditions. **This packet addresses conditions 2 and 3 only**, and it addresses them
by laying out what a certifier would answer — not by answering. Condition 1 is the Definition of Done,
adjudicated bullet by bullet at [`closure-record.md`](./closure-record.md) § 3, where **all four
bullets are recorded as not evidenced**. Condition 4 is the approval owner's verdict, whose field at
§ 4 of that record is deliberately empty.

**A record is not a certificate of itself.** The artefacts below exist; the two certificates do not.

## 2. The assigned holder, and the disclosure every certificate must carry

**The roles are already assigned, and this packet asks for no appointment.**
[`solo-developer-review-policy.md:18-20`](../../governance/solo-developer-review-policy.md):

> Eng. Ezzaldeen Al-Bitar is currently the sole software developer,
> technical reviewer, QA reviewer, security reviewer, and repository
> administrator.

`docs/phase-1/phase-1-1/phase-1-1-owner-gate.md:135-136` names the same holder's "Security
Implementation and Review Authority" and "QA Execution and Review Authority" under the
Owner-Approved Combined-Role Model recorded at `:125-137`, which `:139-140` records the founders as
having explicitly approved.

**The Owner's own instruction on this distinction**, byte-exact from Appendix A line 733 of the
Owner's evening message of 2026-09-13, preserved outside this repository at
`orchestration/evidence/p1-31/closeout-drafts/queue2/owner-decisions-2026-09-13.md`:

> Check the existing governance assignment of Eng. Ezzaldeen Al-Bitar as technical reviewer and
> QA/security reviewer. Reuse that assignment if it remains authoritative. Distinguish an existing
> named role from an actual outstanding certification.

and line 735:

> Do not invent a certification, impersonate a reviewer, or bypass independence/self-approval
> restrictions.

**So what is outstanding is an unissued certification and an unissued clearance, routed to the holder
already named.** Where [`closure-record.md`](./closure-record.md) § 4 reads "no certification, and no
certifier" and "no clearance, and no reviewer", those sentences are read as the absence of a
**certificate**, which is what they are about; the record's own dated correction of 2026-09-14 at
`:3-9` says the same.

### The disclosure sentence each certificate must carry

Adapted from the precedent at
`docs/phase-1/phase-1-12/evidence/security-signoff-recommendation.md:6-11` and required by
`docs/governance/standing-technical-authorization-policy.md:192-194` and
`docs/phase-1/phase-1-1/phase-1-1-owner-gate.md:142-146`:

> **Governance / self-review note.** This determination is made under the Owner-Approved
> Combined-Role Model of `docs/phase-1/phase-1-1/phase-1-1-owner-gate.md:125-137`, by
> Eng. Ezzaldeen Al-Bitar in the role assigned there, under the Solo Developer Review Policy and the
> Standing Technical Authorization Policy. It is an **owner-authorized technical self-review** and
> **must not be represented as an independent external review**. **P1-EC-016 — an independent
> security reviewer before production release — remains open and is not claimed by it.** Every fact
> it rests on traces to an execution or a static read named beside it; **no result is pre-claimed.**

`standing-technical-authorization-policy.md:192-194` states the rule the sentence carries: the
self-review "**must never be represented as an independent review**. P1-EC-016 (independent security
reviewer before production release) remains open and is unaffected."

## 3. The independence question — open, and the Owner's

**This packet does not resolve it, and engineering may not.** `canonical-plan.md:111-112`, Field 11,
asks for "Independent gate reviews: QA lead and Security reviewer where applicable." The combined-role
model supplies an **authority** and explicitly not an **independence**
(`phase-1-1-owner-gate.md:142-146`).

| reading          | what it means for conditions 2 and 3                                                                                          | what it leaves open                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Confirmation** | the assigned holder is the QA lead and the Security reviewer for P1-31, and what is missing is the two written determinations | **P1-EC-016 stays open**, and each determination must be labelled a self-review |
| **Appointment**  | P1-31 requires a person distinct from the implementer, because Field 11 says "independent"                                    | no such person is named in this repository today                                |

**Deciding it one way would bypass the independence restriction the Owner forbade; deciding it the
other way would appoint somebody the Owner has not named.** It is carried to the Owner as item
**O-2** of [`owner-decision-packet-2026-09-16.md`](./owner-decision-packet-2026-09-16.md).

## 4. How to read an item

Each item names **one task**, because the closure record's human-certification category is per task:
five QA tasks owe a certification and four security tasks owe a clearance
([`closure-record.md`](./closure-record.md) § 2.11). Each carries the artefact to examine, the exact
figure the determination would be over with the head it belongs to, and the limitations to weigh.
**The figure is what a signature would be over — not a summary of it.**

**Every item is answerable Certified / Certified-with-conditions / Refused** (QA) or **Cleared /
Cleared-with-conditions / Refused** (security). **The decision fields in § 7 are empty.**

**One absence bears on eight of the nine items and is stated once.** **No hosted check run is recorded
for `849a8e9a`**, and none is available to cite: no evidence directory captured one for this head and
the recording environment has no authenticated client
([`acceptance-record.md`](./acceptance-record.md) § 11.11 (a)). **So every item whose remaining work is
"the suite's or the gate's execution at a protected head, recorded" still has that item open**, and no
run is invented to fill it.

## 5. The QA certification items — gate condition 2

| id        | task, and what would be certified                                                                                                              | artefact                                                                                                                                                                                   | the figure, with its head                                                                                                                                                                                                                                                                                                     | limitations to weigh                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **QA-C1** | **QA-001** — that the phase's unit and component coverage is stated truthfully and that its figures are labelled with the provenance they have | [`coverage-record.md`](./coverage-record.md); [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.7                                                                        | at `849a8e9a`: holes **H-2, H-3 and H-4 closed in code**; **141 → 186 instrumented files**; the delivery signature-capture module moved **0/25 lines to 25/25**; **H-1 remains open** and is counted on FE-004. **Every one of those figures labels itself `LOCAL, pending the hosted web-quality run`**                      | L-1, L-2                                 |
| **QA-C2** | **QA-002** — that API, contract and error-path coverage is complete as a **set**, and that the contract gaps found are recorded and not waived | change control § 68.3; `tests/ci/p1-31-error-path-matrix.test.ts`; [`error-path-matrix.md`](./error-path-matrix.md); [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.4 | the set-shaped counts § 68.3 records; the two published not-found answers corrected by pull request #399; **a new contract gap** — the quality-control record detail's success body published as a bare object ([`acceptance-record.md`](./acceptance-record.md) § 11.12 item 10)                                             | L-1, L-3; and change control CC-58 (c)   |
| **QA-C3** | **QA-003** — that tenant, company and branch isolation is proved at both layers as a set                                                       | change control § 68.5; [`isolation-matrix.md`](./isolation-matrix.md); [`acceptance-record.md`](./acceptance-record.md) § 11.11 (d)                                                        | § 68.5's per-table set proof; the index entry that read two constraint suites as isolation evidence is **true at this head** because the code half was repaired, **and it was not true when written**                                                                                                                         | L-1; change control CC-58 (b)            |
| **QA-C4** | **QA-004** — that record-version sourcing is mechanically enforced where it is reachable, and that the unreachable operations are disclosed    | `scripts/ci/check-p1-31-version-sourcing.mjs`; `tests/ci/p1-31-version-sourcing.test.ts`; change control § 67                                                                              | the gate exists, is a registered npm script and runs inside the policy aggregate; [`operator-runbook.md`](./operator-runbook.md) § 11 records how to run it, read a red and roll back. **CC-57 (a) is OPEN** — seven guarded operations have no consumer and the gate discloses that rather than closing it                   | L-1; change control CC-57 (a), CC-57 (b) |
| **QA-C5** | **QA-005** — that the acceptance record is admissible as test evidence, that it is not a verdict, and that its packaging half is unmet         | [`acceptance-record.md`](./acceptance-record.md) §§ 11.1–11.13                                                                                                                             | run `mu3ch41f` at `849a8e9a`: **740 HTTP steps, 740 ok, 0 findings**; **84 P1-31 browser cases executed, 0 failed, 28 per authenticated project**, derived from both tier reports and from neither alone; **30 shot records, 28 images**. Attempt 3 is retained and **qualified** by its instrument's guessed record versions | L-1 … L-8                                |

**QA-C5's non-substitution sentence, attested with the figure and never instead of it**, quoted from
[`acceptance-record.md`](./acceptance-record.md) § 11.13:

> **No Owner verdict, no phase Pass, no promotion and no human certification**, and no claim that the
> phase is complete.

## 6. The security clearance items — gate condition 3

| id         | task, and what would be cleared                                                                                                                                   | artefact                                                                                                                                                                               | the figure, with its head                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | limitations to weigh                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **SEC-C1** | **SEC-001** — that permission and resolved-scope enforcement is measured across the phase's surface, and that the limit of the least-privilege proof is disclosed | [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) §§ 1 and 18; [`least-privilege-grant-map.md`](./least-privilege-grant-map.md); change control § 68.4                    | the surface and code reconciliation the index publishes, re-measured at this head; § 68.4's minimal-actor counts. **CC-58 (a) is OPEN and is the precise limitation**: the minimal-actor probe establishes sufficiency at the pre-handler gate only, and one operation alone is probed against real rows with a minimal caller                                                                                                                                                                                   | L-1; change control **CC-58 (a)**                  |
| **SEC-C2** | **SEC-002** — that sensitive-data, export and file-access controls behave as recorded, **and exactly how far the download rule reaches**                          | `tests/backend/p1-31-signature-download-refusal.test.ts`; [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.2 and § 18.3; change control § 72.4, § 72.4.1 and § 72.5 | the **server-side refused-download negative now EXISTS** and is a backend suite, merged with pull request #399; the download authorization applies a live-link and reachable-target rule; the receiver's optional identity evidence is captured and server-validated, with **two committed browser cases passing in all three authenticated projects**                                                                                                                                                           | L-1, L-9, L-10, L-11; change control **CC-63 (a)** |
| **SEC-C3** | **SEC-003** — that abuse-case and privilege-escalation controls hold, and that the two observations left undispositioned by design are seen                       | `tests/backend/p1-31-privilege-escalation.test.ts`; `tests/backend/p1-31-concurrency-and-versioning.test.ts`; change control §§ 59, 66 and 72.2                                        | the set-wide escalation and cross-tenant probes; the claim guard's fail-closed half closed by pull request #399. **SEC-003-O1 is settled** by cited authority (change control § 66, applying CC-14 § 2) and is **not** in this list; **SEC-003-O2 is unchanged and open**                                                                                                                                                                                                                                        | L-1, L-12; change control CC-56 (b), CC-56 (d)     |
| **SEC-C4** | **SEC-004** — that security audit-event coverage is proved for the **set** of privileged actions, and that the export audit's limit is disclosed                  | `tests/backend/p1-31-audit-emission.test.ts`; [`audit-class-review.md`](./audit-class-review.md); change control § 68.2; [`acceptance-record.md`](./acceptance-record.md) § 11.5       | § 68.2's derived emission set with a set-completeness proof; in the run of record, **each of the five exports carried exactly one correlated audit event** — four asserted by ledger steps of their own and the empty selection's measured from the same window read ([`acceptance-record.md`](./acceptance-record.md) § 11.5), and the default administrator was refused all four report codes with `403 ERR-IAM-001`. **The export audit records selection and counts, not a byte length or a content digest** | L-1, L-13                                          |

**SEC-C4's own caution, quoted from [`security-and-qa-evidence.md`](./security-and-qa-evidence.md)
§ 17.8:**

> **No Owner verdict, no phase Pass, no promotion and no human certification**, and no security or
> QA clearance, recorded or implied.

## 7. The decision fields — EMPTY

**Only the person holding the role may fill a row.** A blank row is not a refusal and is not a
pending approval; it is an act that has not been performed.

### QA certification — gate condition 2

| item      | determination (Certified / Certified-with-conditions / Refused) | conditions, if any | certifier's name | date |
| --------- | --------------------------------------------------------------- | ------------------ | ---------------- | ---- |
| **QA-C1** |                                                                 |                    |                  |      |
| **QA-C2** |                                                                 |                    |                  |      |
| **QA-C3** |                                                                 |                    |                  |      |
| **QA-C4** |                                                                 |                    |                  |      |
| **QA-C5** |                                                                 |                    |                  |      |

### Security clearance — gate condition 3

| item       | determination (Cleared / Cleared-with-conditions / Refused) | conditions, if any | reviewer's name | date |
| ---------- | ----------------------------------------------------------- | ------------------ | --------------- | ---- |
| **SEC-C1** |                                                             |                    |                 |      |
| **SEC-C2** |                                                             |                    |                 |      |
| **SEC-C3** |                                                             |                    |                 |      |
| **SEC-C4** |                                                             |                    |                 |      |

## 8. The evidence, with the digests the run of record used

All of it is outside this repository, at
`orchestration/evidence/p1-31/acceptance-20260916-0008/` and
`orchestration/evidence/p1-31/acceptance-20260916-0008-monitoring-rehearsal/`, and all of it is quoted
from [`acceptance-record.md`](./acceptance-record.md) § 11.

| what                            | sha256 and size, as § 11 records them                                            |
| ------------------------------- | -------------------------------------------------------------------------------- |
| journey instrument              | `66949016d5bad0f2e56e4839a09c6888606ab2531335cc1d65ba335152359fc8`, 229236 bytes |
| export companion instrument     | `09d75d886def13ed193710c4120e2f92e91e997163b2f753d685ffec8ff56d7b`, 108070 bytes |
| screens instrument              | `d91f213afba9bf1cdf319421e447e6076043999e54e94c3304c8fd98667055cc`, 9235 bytes   |
| runner                          | `75d6598864f527ee8d4d531534f3726332a3f49376f2177dd0abf7a4931c3ccd`, 57172 bytes  |
| plan                            | `ce2132fb10aa07db704b3aaa273b60adae8b716a0c5c5eff528d1770e75e2abb`, 116013 bytes |
| browser report, tier 1          | `4ad1f7e92dd365917a8434b994e8d05469c3511bbd6306b91f2611e3fe4dd2d8`, 951815 bytes |
| browser report, tier 2          | `c1e0f0bb3cfdcbf2e0487a7428aa7fb15b74b2cfdba279ce35b99a732daf74f3`, 11542 bytes  |
| the four export bodies          | `1c6954f2…` (17 rows), `8d7057d6…` (1), `0f347d21…` (1), `3333dadd…` (2)         |
| the empty-selection export      | `db0eb13e…` (0 rows)                                                             |
| monitoring input                | `4c61339c…`, 2180 records                                                        |
| the rehearsal's three artefacts | `848163c0…` input, `5c1ab4ec…` in-memory alert, `0d041c14…` written queue        |

**The runner differs from its preserved attempt-3 copy at exactly two pin lines** — its journey pin
and its head pin — and at nothing else (§ 11.2). **The dedicated privileged-fixture database proof is
recorded at § 10.12** of the same record and is unchanged by this run.

## 9. The limitations a determination must weigh

Each is carried as it stands. **Nothing here turns a limitation into a blocker and nothing here
accepts one.** The Owner's instruction of **2026-09-15**, quoted from
[`acceptance-record.md`](./acceptance-record.md) § 11.12 and **quoted partially** — it is the first
sentence of a two-sentence paragraph, whose second sentence directs that the canonical criteria and
existing decisions be applied, and nothing below stands for that second sentence:

> Do not automatically turn every limitation into a phase blocker, and do not automatically accept
> it.

| id       | limitation                                                                                                                                                                                                                                                                                      | where                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **L-1**  | **no hosted check run is recorded for `849a8e9a`**, so no merged suite's and no gate's execution at this protected head can be cited                                                                                                                                                            | § 11.11 (a); § 18.8 item 12                     |
| **L-2**  | every coverage figure at this head is **local**, pending a hosted web-quality run                                                                                                                                                                                                               | § 11.11 (c); § 18.7                             |
| **L-3**  | the quality-control record detail publishes its success body as a bare object — an instance of the generator-wide shortfall already before the Owner                                                                                                                                            | § 11.12 item 10; § 18.4                         |
| **L-4**  | **no hosted job executes any P1-31 browser case**, the two new receiver cases included; they run only in the closing runner                                                                                                                                                                     | § 11.12 item 2; § 18.8 item 11                  |
| **L-5**  | the five instruments live outside the repository, unversioned, identified only by digests                                                                                                                                                                                                       | § 11.2; § 17.7 item 3; change control CC-60 (g) |
| **L-6**  | the privileged export fixture is a **privileged local fixture on the shared acceptance database** and is absent from hosted execution; its deferred-constraint falsifiability control is an **uncommitted, hand-taken** measurement                                                             | § 11.5; § 17.7 items 1 and 2; § 18.8 item 13    |
| **L-7**  | attempt 3's journey carried guessed record-version values, so its quality-control steps read nothing                                                                                                                                                                                            | § 11.2; § 11.12 item 9                          |
| **L-8**  | the run's artefacts are not committed: nothing of the run is in this repository except the record                                                                                                                                                                                               | § 18.5                                          |
| **L-9**  | **branch scoping on download is proved for one case only**; documents linked to the other admitted entity kinds remain downloadable by any tenant holder of the permission, and that statement is **measured from the policy catalogue, not proven by a test**, except for one test-proven case | § 18.2                                          |
| **L-10** | **a live link to a soft-deleted entity still counts as reachable**                                                                                                                                                                                                                              | § 18.2                                          |
| **L-11** | **runtime reachability is exercised for three of the nine allow-listed link types**, with a fourth reached through shared fixtures                                                                                                                                                              | § 18.2                                          |
| **L-12** | the escalation probes run against a **disposable** database, and no acceptance record exercises them                                                                                                                                                                                            | § 17.7; change control § 59                     |
| **L-13** | the export audit records selection and counts, not a byte length or a content digest, so it cannot later identify the exact bytes disclosed                                                                                                                                                     | § 17.7 item 6                                   |
| **L-14** | the browser download was exercised for one report code; the other three were proved over real HTTP                                                                                                                                                                                              | § 11.6; § 17.7 item 8                           |
| **L-15** | monitoring is a **local sanitized alert queue**; the run itself routed 0 and routing is proved only by the rehearsal, from an **injected** fault; **D-10 is unresolved**                                                                                                                        | § 11.8; § 18.6                                  |
| **L-16** | the P1-24 operation register undercounts the export operation's database-backed suites, because it matches references by raw substring                                                                                                                                                          | § 17.7 item 4                                   |

## 10. The acceptance-evidence obligation, and the proposed artefacts

`phase-1/_acceptance/README.md:3` names controlling assumption **P1-ASM-025** and states that
"**no acceptance, test pass, migration acceptance, production readiness, or sign-off exists unless a
referenced evidence artifact is added here**", one file per criterion id, named
`<criterion-id>-<slug>.md`. **That directory holds its README and nothing else.**

**Five proposed evidence references have been prepared, and none of them is in that directory.** They
are at
`orchestration/evidence/p1-31/closeout-drafts/_acceptance-proposed/`, outside every git working tree,
one per criterion identifier the chapter's own Test-reference column cites — `TC-WTY-001`,
`TC-RPT-001`, `TC-QMS-001`, `TC-P1-31-001` and `TC-P1-31-002`. Each names the evidence by path and
digest and is marked plainly as a **PROPOSED evidence reference and not an acceptance**.

**Placing an artefact in `phase-1/_acceptance/` is the certifier's and the Owner's act, not
engineering's**, and **which task owns which criterion id remains unresolved** — that is **D-16**,
carried as item **O-10** of the Owner decision packet. **Nothing has been written into
`phase-1/_acceptance/`.**

## 11. What these two determinations would, and would not, establish

**Would establish.** That the holder of the assigned authority read each artefact at one head and
accepted it, accepted it with stated conditions, or refused it — which is what conditions 2 and 3 ask
for on their face.

**Would NOT establish.**

1. **Independence.** § 3 above; P1-EC-016 remains open and unclaimed.
2. **That the Definition of Done is evidenced.** That is condition 1, and all four bullets are
   recorded as not evidenced at [`closure-record.md`](./closure-record.md) § 3.
3. **A phase verdict.** That is condition 4, and its field is empty.
4. **That the nine `phase-level incomplete` rows are finished.** A determination is over the evidence
   that exists, not over evidence that does not.
5. **A hosted result of anything.** L-1.
6. **That the acceptance evidence artefacts exist.** § 10.

## 12. What this document does not do

- **It issues no certification and no clearance**, and it fills no decision field.
- **It appoints nobody.** The roles are held; it asks for no appointment and requests no waiver.
- **It records no verdict and recommends none**, and it does not ask for blanket acceptance of the
  limitations as a set.
- **It claims no hosted run**, no environment, and no approval.
- **It moves no task-matrix row and changes no disposition.**
- **It writes nothing into `phase-1/_acceptance/`.**
