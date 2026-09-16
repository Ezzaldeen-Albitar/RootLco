# P1-31 — the reduced Owner decision packet, 2026-09-16

**Status:** OPEN, routed · **Measured at:** protected `develop`
`849a8e9a7d8960e784456d5d886d5976350f0b24` (tree `b8390f33`, the merge of pull request #400) ·
**Allocation:** change control § 70 / **CC-60 (c)** ·
**Supersedes as the live list:** [`owner-decision-packet-2026-09-13.md`](./owner-decision-packet-2026-09-13.md),
which is a delivered record, is **retained**, and is **not edited** except for one dated note pointing
here.

**Nothing in this document is a decision, a verdict, an approval, a certification or a clearance**,
and nothing in it asserts that any gate ran, that any environment exists, or that any approval was
granted. It is the list of acts only the Owner can supply, after all authorized engineering work.

**No test tier, build, migration, database operation or deployment was run to produce it.** Every
figure is a static read of the tree at this head or a figure quoted from a phase record with the
section that states it. Bare `.md` filenames are relative to `docs/phase-1/phase-1-31/`; every other
path is written from the repository root.

---

## 1. The Owner's instructions this packet is written under

Byte-exact, from the Owner's instructions to the coordinating session, preserved outside this
repository at
`orchestration/evidence/p1-31/closeout-drafts/queue3/closure-facts-20260915.md` section H.

**Of 2026-09-14 — a PARTIAL quotation, the second sentence of its paragraph:**

> Do not silently accept open risks, claim a reduced-scope completion, or record the Owner's verdict.

**Of 2026-09-15 — quoted whole:**

> Finish all authorized engineering work before presenting the reduced Owner decision packet. Do not
> ask for blanket acceptance of unfinished tasks.

and, on promotion, quoted whole:

> Do not promote or start P1-32 until the applicable gate conditions and actual approvals are
> satisfied. Once they are satisfied, complete the already-authorized promotion and protected
> verification without asking again for routine push/merge permission.

**This packet asks for no blanket acceptance**, of unfinished tasks or of the limitations as a set,
and it records no verdict.

## 2. The inclusion criterion, stated once and applied once

> **An item belongs in this packet when, and only when, the Owner is the only party who can supply
> the act it needs — and it is still unsupplied at `849a8e9a`.**

Four consequences, applied to every row without exception:

1. **Buildable work is excluded.** If an engineer, a lane or an operator may lawfully do the thing
   without the Owner saying a word, it is not here however open it is.
2. **A record defect is excluded.** Correcting a stale citation or a superseded figure is an
   engineering act. The single exception is a row inside an **Owner document**, which only the Owner
   may change (**O-12**).
3. **An item settled by cited authority since the earlier packets is not re-asked.** § 5 lists those,
   with how each closed.
4. **A role already assigned is not re-requested.** The QA and security reviewer roles are held under
   [`solo-developer-review-policy.md:18-20`](../../governance/solo-developer-review-policy.md).
   **What is outstanding there is an unissued certification and an unissued clearance**, prepared at
   [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) — not an
   appointment. The one genuine Owner question in that area is **independence**, and it is **O-2**.

Every item gives: **(a)** the question, in one answerable sentence; **(b)** why it is the Owner's,
with its citation; **(c)** the options; **(d)** **engineering's recommendation, labelled as a
recommendation and never as an approval**; **(e)** the evidence; **(f)** what changes with the
answer, and which gate condition or Definition-of-Done bullet it touches.

**The ids are this packet's own**, and each names the earlier id it carries so nothing is lost.

---

## 3. Group A — the gate's own acts

### O-1 — the phase verdict _(earlier id: A-1)_

**(a)** "For P1-31 at `develop` `849a8e9a`, I record the phase decision as **Pass / Conditional Pass /
Fail / Deferred**, with these conditions: \_\_\_\_\_\_."

**(b)** [`closure-record.md`](./closure-record.md) § 4 leaves the verdict field deliberately empty and
states that only the approval owner named in Field 35 may fill it: "No engineering session, no agent,
no pull request and no record may supply it, infer it, or treat its absence as any of the four
values." No recorded Owner decision file carries a phase verdict.

**(c)** One of the four values, with conditions.

**(d) Recommendation.** **Do not record a Pass on this record.** On the evidence at this head the
defensible values are **Conditional Pass**, with the conditions being O-2, O-3 and O-6, or
**Deferred**. **This is a recommendation and is not an answer.**

**(e)** The account at [`closure-record.md`](./closure-record.md) §§ 2.10 and 2.11 and
[`task-matrix.md`](./task-matrix.md)'s amendment of 2026-09-16: **16** of 29 `end-to-end verified`,
**9** `phase-level incomplete`, **no row raised or lowered** since `c1a2f9fc`.

**(f)** Until a value is recorded the chapter's own status for all twenty-nine tasks remains
`Planned`, no dependent work may be authorised, and no promotion may be justified by phase closure.
**Blocks the phase: YES** — gate condition **4**.

### O-2 — which reading governs gate conditions 2 and 3 _(earlier ids: A-2 and A-3, merged)_

**(a)** "For P1-31, conditions 2 and 3 are satisfied by **the assigned combined-role holder's written
certification and clearance, labelled as owner-authorized self-review** / **a review by a person
independent of the implementer, whom I name** — choose one."

**(b)** This is **not** a request to appoint a role already assigned, and the Owner's own instruction
forbids treating it as one (Appendix A line 733 of the 2026-09-13 message, quoted in
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 2). The genuine
question is independence: `canonical-plan.md:111-112`, Field 11, asks for "Independent gate reviews:
QA lead and Security reviewer where applicable", while
`docs/phase-1/phase-1-1/phase-1-1-owner-gate.md:142-143` records that the current review "is an
owner-authorized technical self-review and must not be represented as an independent external
review", and `docs/governance/standing-technical-authorization-policy.md:192-194` keeps **P1-EC-016**
open. **Engineering may not decide it in either direction**: one way bypasses the independence
restriction, the other appoints somebody the Owner has not named.

**(c)** Confirmation, or appointment of a named independent reviewer.

**(d) Recommendation.** **None on the reading itself** — it is the Owner's by construction.
Engineering records only that the items are prepared either way and that each determination must
carry the self-review disclosure sentence.

**(e)** [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md), nine items
with empty decision fields; `solo-developer-review-policy.md:18-20`.

**(f)** Conditions 2 and 3 cannot be executed until the reading is fixed. **Blocks the phase: YES** —
gate conditions **2** and **3**.

### O-3 — formal acceptance, or refusal, of the open dispositions _(earlier id: A-4)_

**(a)** "I formally accept the open P1-31 dispositions as carried out of the phase — or I name the
ones that must be closed before P1-31 closes."

**(b)** Definition-of-Done bullet 2 (`canonical-plan.md:458-459`) requires findings to be "closed **or
formally accepted by the authorized owner**". [`closure-record.md`](./closure-record.md) § 3 records
that neither limb is satisfied. The register files each disposition as _recorded_, which is an
engineering act and not an acceptance.

**(c)** Accept the set as carried; accept with named carve-outs; or name the rows that must close
first.

**(d) Recommendation.** Accept as carried **with three carve-outs the Owner should not accept blind**:
**CC-16** and **CC-20**, which are operator acts (**O-6**); **CC-44**, which is why the browser half is
credential-dependent; and **CC-63 (a)**, the one-case branch-scope proof on download, which belongs in
front of the security determination rather than in a set. **A recommendation, not an answer.**

**(e)** Change control § 70.7 re-derives the set at this head: **41 open** before this pull request,
and **45** as it leaves the register — **CC-54 (d)** closes and § 70 raises five open sub-rows of its
own; **four state no usable disposition**. The derivation states its counting rule and names every
exclusion, so the set this item asks about can be checked row by row rather than taken on trust.
**Two rows § 7 lists as closed are outside this set** — **CC-31** and **CC-52 (c)** — because a
recorded measurement closes each one while its own cell still reads open; **this item does not ask the
Owner to accept either as open.**

**(f)** Without it, bullet 2 cannot be evidenced by either limb and the rows travel to the next phase
with no owner and no deadline. **Blocks the phase: YES** — Definition-of-Done bullet **2**, and through
it gate condition **1**.

### O-4 — what P1-31 closes at, and what is carried _(earlier id: F-2)_

**(a)** "P1-31 closes at the account recorded at `849a8e9a`, with the residue formally carried to a
named later phase — or P1-31 stays open until the residue is discharged. Choose, and if carrying, name
the phase."

**(b)** Nothing authorises scoping a canonical task out; no decision file reduces the twenty-nine.
The Owner has already refused one formulation of this question, byte-exact from Appendix A line 667 of
the 2026-09-13 message:

> My goal remains a complete, correctly evidenced phase. I am not approving closure at “12 of 29,”
> blanket acceptance of the 26 packet items, or a phase Pass through this message.

**(c)** Carry the residue to a named phase; or hold P1-31 open.

**(d) Recommendation.** **Do not carry the nine `phase-level incomplete` rows out silently.** Most of
what they still owe is one thing — the recorded execution of already-merged suites and gates at a
protected head — and that is engineering work, not a phase. **Answer O-2 first**, because five of the
nine rows also owe a determination that turns on it. **A recommendation, not an answer.**

**(e)** [`closure-record.md`](./closure-record.md) §§ 2.10 and 2.11; the union of the four non-`none`
categories is **seventeen** distinct rows.

**(f)** The difference between a partial closure with a named successor and an open phase.
**Blocks the phase: YES** — Definition-of-Done bullet **1** and gate condition **1**.

---

## 4. Group B — scope and authorisation acts

### O-5 — D-10, the event-consumption mechanism _(earlier id: B-4)_

**(a)** "Field 24's event-consumption requirement is satisfied by **polling** / **requires a push
mechanism this platform does not have** — choose one, or record it explicitly not-applicable for
P1-31."

**(b)** `a0-preflight.md:380-386` records the question as undecided and records that D-19 of
2026-09-12 does not settle it. Neither tier has a push surface, so a required mechanism is a contract
that does not exist. The implementations differ by kind, so it is not a detail engineering may choose.

**(c)** Polling; a push mechanism; or explicitly not-applicable under Field 30.

**(d) Recommendation.** Record it **not-applicable for P1-31** under Field 30 and raise the push
surface as a platform item. **A recommendation, not an answer.**

**(e)** [`acceptance-record.md`](./acceptance-record.md) § 11.8 and
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.6: monitoring is a **local
sanitized alert queue**; the run itself routed **0**, and the rehearsal routed **1** from an
**injected** fault. **No external delivery exists or is claimed.**

**(f)** DO-002 keeps a genuine-Owner-decision item until it is answered. **Blocks the phase: NO.**
Touches Definition-of-Done bullet **1**.

### O-6 — the operator acts, and the runbook's owner _(earlier id: F-4)_

**(a)** "I authorise the post-merge operator acts on every environment, in the recorded order, and I
name \_\_\_\_\_\_ as the owner of the runbook that carries them."

**(b)** Existing authority covers the **content** of the acts and not the **environments**:
`owner-decisions-2026-09-09.md` records that the combined permission rollout "runs **once**, for newly
approved codes only", which is a rule about how a backfill runs and not an authorisation to run it
anywhere. Naming a runbook owner is a role assignment.

**(c)** Authorise in present terms; authorise prospectively, binding on the first environment ever
provisioned; or withhold. And name the owner.

**(d) Recommendation.** Read the first limb as **binding prospectively** — the acts become a
precondition at the moment an environment is provisioned — and name the DO-002 / DOC-002 lane as
runbook owner. **A recommendation, not an answer**, and it reduces nothing: the obligation does not
disappear.

**(e)** **Exactly one environment exists — Local** (`docs/phase-1/phase-1-1/environment-matrix.md:11`,
rows at `:17-20`; ADR-012 at `:7`), with Development, Staging and Production each "Planned — not
provisioned". [`operator-runbook.md`](./operator-runbook.md) carries the acts in the order that is
load-bearing. **Act 5, the identity-evidence category seed, was performed on the one shared local
acceptance database on 2026-09-15 at 15:57:54Z** — one row inserted, platform document categories 7 to
8, the digest taken afterwards with the inserted row excluded equal to the one taken before (§ 10 of
that runbook, dated note). **It remains owed on every other environment**, and **a runbook is not a
run**: **CC-16** and **CC-20** close on a run.

**(f)** Without it, any environment brought up from the merged tree gets a partial entitlement set and
an unvalidated constraint. **Blocks the phase: YES** — Definition-of-Done bullet **3**, which names
runbooks explicitly.

### O-7 — the work-order line-management code, declared by shipped operations and absent from the bundle _(earlier id: F-7)_

**(a)** "The work-order line-management permission code is **added to the tenant-administrator bundle
and backfilled on every environment** / **deliberately withheld with a recorded reason** — choose one."

**(b)** The determination the Owner asked for was made and came back negative: the code is declared by
two shipped operations and is in the catalogue seed, and it is **silently absent** from the bundle,
while the one code that is deliberately withheld carries a recorded reason in the same source file
(`apps/api/src/modules/iam/domain/bootstrap-roles.ts:378-390`, citing Owner decision **CC-04**).
**There is no equivalent sentence for this code**, so the entitlement definition does not authorise
inclusion and the specific grant decision is presented — and nothing wider.

**(c)** Include and backfill; or withhold with a recorded reason.

**(d) Recommendation.** **Include.** The bundle's own stated rule is to carry a code only when a
shipped operation declares it, and two shipped operations declare this one. **A recommendation, not an
answer.**

**(e)** Acceptance observation **O-1** at [`closure-record.md`](./closure-record.md) § 5.2: a fresh
organisation's first administrator was refused and **it blocked nothing in the journey**, because an
invoice derives from an accepted quotation revision — but that administrator cannot record a service
line or a required-part demand at all.

**(f)** Including costs the bundle size, the test pins that assert it, and a backfill that should ride
with **O-6**. **Blocks the phase: NO.** Touches Definition-of-Done bullet **2**.

### O-8 — the residue journey organisations on the shared acceptance database _(earlier id: F-8)_

**(a)** "The journey organisations left on the shared local acceptance database are **deleted** /
**left in place** — choose one." **Deletion is destructive and irreversible**, so it may proceed only
on an explicit choice of the first option; no answer, or the second option, means they stay.

**(b)** No decision file authorises deleting tenant data, and existing practice is the P1-30 precedent
of not deleting.

**(c)** Delete; or leave in place.

**(d) Recommendation.** **Leave them in place** until the verdict is recorded — a deleted organisation
removes the ability to re-read the acceptance evidence it was created for. **A recommendation, not an
answer.**

**(e)** [`acceptance-record.md`](./acceptance-record.md) § 11.9: `org.tenants` moved **57 → 59** with
this run's pair. **That figure is derived from a read-only query and is not recorded by the runner.**
The standing rule that keeps the residue safe is that the backend suites delete tenants by **prefix**
on that database, so acceptance data is named to match no suite prefix.

**(f)** Nothing in the phase turns on it except that the evidence lives on those rows.
**Blocks the phase: NO.**

### O-9 — the bare-object success schemas _(earlier id: F-6, with the new instance)_

**(a)** "Typed OpenAPI response schemas are **a platform-wide slice outside P1-31** / **in P1-31's
scope** — confirm which."

**(b)** The shortfall is generator-wide and A0 classified it as chapter-level; the chapter asks only
that every public operation be represented in OpenAPI and no gate reads response properties. What is
missing is the Owner's explicit confirmation of that classification. The Owner's own instruction
requires the existing disposition to be carried accurately and a determination made about whether any
mandatory P1-31 criterion is blocked by it.

**(c)** Out of P1-31's scope, raised as a platform slice; or in scope.

**(d) Recommendation.** Confirm it is **out of P1-31's scope** and raise it as a platform slice.
**A recommendation, not an answer.**

**(e)** A **new instance** was found by the run of record and is recorded, not dispositioned: the
quality-control record detail answers a body carrying the record, its results and an
unresolved-mandatory count, and the published contract declares that success body as a bare object
([`acceptance-record.md`](./acceptance-record.md) § 11.12 item 10;
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.4). **That instance had a real
cost**: the journey instrument read the wrong place for a record version and carried guessed
fallbacks, which is why attempt 3's journey is qualified (§ 11.2).

**(f)** QA-002 keeps a genuine-Owner-decision item until it is confirmed. **Blocks the phase: NO.**
Touches Definition-of-Done bullet **3**.

### O-10 — D-16: which task owns the cited test ids, and where phase evidence lands _(earlier id: B-7)_

**(a)** "The cited test-case ids are **retired as unresolvable** / **owned by task \_\_\_\_\_\_** — and
phase evidence lands at **`docs/phase-1/phase-1-NN/*acceptance*.md` (this repository's convention)** /
**`_acceptance/` (the chapter's)** — choose one of each."

**(b)** Which task owns which id, and where phase evidence lands, are chapter questions; inventing a
mapping would be engineering deciding what the chapter meant. **The premise has changed and the
decision has not**: the definitions exist, outside this repository, with unexecuted result columns
([`canonical-reference-map.md`](./canonical-reference-map.md)), so the reason D-16 is open is no longer
that they cannot be found.

**(c)** Retire the ids, or assign them; and ratify one evidence convention.

**(d) Recommendation.** Ratify the repository convention and retire the ids that describe behaviour
outside this phase. **A recommendation, not an answer.**

**(e)** `phase-1/_acceptance/README.md:3` names controlling assumption **P1-ASM-025** and requires one
evidence artefact per criterion id; **the directory holds its README and nothing else**. Five
**proposed** references are prepared outside the repository and are named in
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 10. **Nothing was
written into `phase-1/_acceptance/`.**

**(f)** Definition-of-Done bullet 1 requires each task "linked to immutable evidence"; while the
question is open, that link cannot be made in the chapter's own vocabulary for any of the twenty-nine.
**Blocks the phase: YES, in one limb.**

### O-11 — D-14: Field 7's product-name precondition _(earlier id: B-6)_

**(a)** "Field 7's product-name precondition is **superseded by the recorded closure of the
product-name item** / **must be discharged by re-synchronising the canonical document first** — choose
one."

**(b)** `a0-preflight.md:413-417`: the repository has already replaced the placeholder and a gate
enforces it, so the chapter's precondition is stale rather than violated; P1-25's gate record logs the
document re-synchronisation as non-blocking for a phase gate but blocking before production release.
No decision file records the supersession.

**(c)** Record it superseded for gate purposes; or require the document re-synchronisation first.

**(d) Recommendation.** Record it **superseded for gate purposes** and carry the re-synchronisation as
a pre-release item. **A recommendation, not an answer.**

**(e)** `a0-preflight.md:413-417`.

**(f)** Without it, a reader of Field 7 concludes the phase started without a precondition met.
**Blocks the phase: NO.** Touches Definition-of-Done bullet **3**.

### O-12 — the Owner-document row `OWR-2026-09-06-G-10` _(earlier id: E-1)_

**(a)** "I update the register row **OWR-2026-09-06-G-10** from `Undecided` to the answer I gave on
2026-09-10 — the delivering employee's identity is in scope and is delivered as the employee entity —
or I confirm it stays `Undecided`."

**(b)** The substance was answered on 2026-09-10; what was not done is the row update, and changing an
Owner document is the Owner's act. The row still reads `Undecided` at
`docs/product/owner-requirements-2026-09-06.md:1496`.

**(c)** Update the row, or confirm it stays.

**(d) Recommendation.** Update it, quoting the 2026-09-10 answer, and correct the table name its
evidence line carries in the same edit. **A recommendation, not an answer.**

**(e)** `owner-decisions-2026-09-10.md` § 1, which is headed as answering that row.

**(f)** While it reads `Undecided`, **CC-32** has no authority to close against and DOC-001 cannot
report all four A0 corrections as made. **Blocks the phase: NO.** Touches Definition-of-Done bullet
**3**.

---

## 5. Group C — ratifications of engineering decisions already taken, open to Owner override

**These are not fresh questions.** Each records a decision already taken and shipped, with its
reasoning, and asks the Owner to ratify or override. **None is blocking**, and each is presented as a
ratification precisely because the act was taken while the decision was open.

| id       | earlier id | the question, in one sentence                                                                                                                              | engineering's recommendation, labelled as one                                                                                     | where the act is recorded                                                                                                             |
| -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **O-13** | B-3        | the warranty read permission code that gates the P1-31 warranty reads, its inclusion in the tenant-administrator bundle and the backfill already performed | **ratify** — reversing it withdraws a granted code from twenty-four roles on a live database                                      | change control **CC-07**; `a0-preflight.md:372-379`                                                                                   |
| **O-14** | C-1        | whether rows minted by the delivering-employee backfill are created `inactive` or `active`                                                                 | **approve `inactive`**                                                                                                            | [`delivering-employee-identity-seam.md`](./delivering-employee-identity-seam.md)`:125`                                                |
| **O-15** | C-2        | whether the employment reference stays optional, opaque and unique per tenant when present                                                                 | **approve as recommended**                                                                                                        | `delivering-employee-identity-seam.md:126`                                                                                            |
| **O-16** | C-3        | whether administering an employee stays branch-scoped while reading is tenant-wide                                                                         | **approve the split** — widening the write is a policy change                                                                     | `delivering-employee-identity-seam.md:127`                                                                                            |
| **O-17** | C-4        | how an unresolved legacy delivering-employee identity is resolved                                                                                          | **approve the recommended operator command**                                                                                      | `delivering-employee-identity-seam.md:128`                                                                                            |
| **O-18** | C-5        | which column supplies the reporting timezone                                                                                                               | **approve the branch's own timezone column**, which is what the approved branch-scoped semantics imply and what is implemented    | change control § 40.2, CC-27 (a); `owner-decisions-2026-09-10.md` § 4                                                                 |
| **O-19** | D-1        | whether a tenant report configuration is **customisation** of a report the platform already implements, or a **precondition**                              | **confirm the implemented rule** (customisation), and pair it with directing that the draft-configuration consequence be surfaced | [`report-engine-seam.md`](./report-engine-seam.md)`:190-193`; observation **O-5** at [`closure-record.md`](./closure-record.md) § 5.2 |

**Why these are still the Owner's.** Four of them are the delivering-employee recommendations the
register carries as **CC-29**, whose state cell reads "open, four recommendations pending"; **O-16** is
marked a **policy** question in the seam record; **O-18** is the one residue the 2026-09-10 approval
did not cover; and **O-19**'s register cell names the Owner as its owner and reads "(b) open".

---

## 6. The count, derived

| group                                            | items  |
| ------------------------------------------------ | ------ |
| A — the gate's own acts (O-1 … O-4)              | 4      |
| B — scope and authorisation acts (O-5 … O-12)    | 8      |
| C — ratifications open to override (O-13 … O-19) | 7      |
| **Total**                                        | **19** |

**Blocking, counted from each item's own (f) line: 6** — O-1 (condition 4), O-2 (conditions 2 and 3),
O-3 (bullet 2, and through it condition 1), O-4 (bullet 1 and condition 1), O-6 (bullet 3) and O-10 in
one limb (bullet 1). The 2026-09-13 packet counted **eight** over twenty-six items; the difference is
derived and not asserted: **its two appointment items are one question here** (O-2), and **its FE-009
item is closed by engineering** (§ 7).

**No item in this packet asks the Owner to accept an unfinished task, and none asks for acceptance of
the limitations as a set.** The limitations are carried, each with its own disposition, at
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 9 and
[`acceptance-record.md`](./acceptance-record.md) § 11.12.

---

## 7. Closed since the earlier packets — listed so nothing is asked twice

**None of these is a decision, and none of them is asked as an item above.** Each says how it closed
and where. **Two of the identifiers named below are inside the open set O-3 asks about** — **CC-37 (b)**
and **CC-57 (a)**, named again at the end of this section — **and no other identifier in this table is
in it.** In particular **CC-31** and **CC-52 (c)** are outside it: change control § 70.7 excludes both
by name, on the measurements the rows below cite, so nothing here is listed as closed and asked as open
at the same time.

| earlier item                                                          | how it closed                                                                                                                                                                                                                     | where                                                                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **F-3** — accept FE-009 as delivered partial, or authorise the reader | **closed by engineering.** The reader landed, the screen half landed, and the run of record read the transition ledger and passed the warranty browser cases in all three authenticated projects. FE-009 is `end-to-end verified` | change control §§ 65, 69 and the dated note at § 69.7; [`acceptance-record.md`](./acceptance-record.md) §§ 11.4, 11.6 |
| **F-5** — build a sibling version-sourcing gate, or waive             | **construction executed.** The gate exists, is registered and runs in the policy aggregate. **CC-57 (a) is carried as a recorded limitation**, not as an Owner item                                                               | change control § 67                                                                                                   |
| **F-1** — the report-configuration family with no consumer            | **documented limitation** governed by **CC-37 (b)**, which remains open and is covered by **O-3**                                                                                                                                 | change control § 49.3                                                                                                 |
| **F-9** — the tablet verification allocation                          | **an interpretation note, not a decision.** The two canonical texts are consistent: the criterion binds each P1-31 task, and Phase 1-32 consolidates the class. The run of record executed the tablet project                     | change control § 70; [`acceptance-record.md`](./acceptance-record.md) § 11.6                                          |
| **B-1** — who owns the backend prerequisites                          | **already settled in practice and recorded**; the prerequisite lane carried the work                                                                                                                                              | [`closure-record.md`](./closure-record.md) § 1                                                                        |
| **B-2** — whether the Frontend dependency chain binds order           | **already settled in practice**; the phase executed out of chain order and nothing contradicted it                                                                                                                                | `a0-preflight.md:368-371`                                                                                             |
| **B-5** — the P1-30 / P1-31 split                                     | **already settled in practice**; sixteen Frontend rows were built and proved on the P1-31 reading                                                                                                                                 | [`task-matrix.md`](./task-matrix.md)                                                                                  |
| **SEC-003-O1** — the differing foreign-company refusals               | **settled by cited authority** (CC-14 § 2), not by an Owner act                                                                                                                                                                   | change control § 66 / **CC-56**                                                                                       |
| **SEC-002's missing server-side negative**                            | **closed by engineering** — a backend suite, not a component assertion behind a mocked adapter                                                                                                                                    | change control § 72.4; [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.2                          |
| **D-18's identity-evidence binding, and pending/scanning states**     | **engineering choices** under the established evidence-state rule; the download path still refuses a version that is not accepted. **Not Owner items**                                                                            | change control **CC-63 (b)**; § 18.3 of the index                                                                     |
| **CC-50 (a)** and **CC-53** — the per-file coverage artefact          | **closed by the hosted fill**                                                                                                                                                                                                     | change control § 63                                                                                                   |
| **CC-52 (c)** — three owed browser cases                              | **closed** by the delivery write proofs — 48 of 48 browser cases in run `mu0g1b1a`, and the three matrix rows raised                                                                                                              | change control § 64 / **CC-54**, the dated note at § 62.7, and the exclusion in § 70.7                                |
| **CC-10** and **CC-31** — the warranty ledger                         | **closed** in both halves, **CC-31** on the closing-head browser proof its own cell named as its one condition                                                                                                                    | change control §§ 65 and 69, the dated notes at §§ 69.7 and 43.3, and the exclusion in § 70.7                         |
| **CC-54 (b)** and **CC-56 (c)**                                       | **closed** by the backend closure hardening merged as pull request #399                                                                                                                                                           | change control § 72, and the dated notes at §§ 64.8 and 66.8                                                          |
| **CC-63 (b)** and **CC-63 (c)**                                       | **closed** — the binding rule as an engineering choice, the live-link contract by a fix with six new cases                                                                                                                        | change control § 72.6                                                                                                 |
| **CC-59** and **CC-59 (a)**                                           | **closed by measurement** at the run of record                                                                                                                                                                                    | the dated note at change control § 69.7                                                                               |

**Two of the rows above remain open as dispositions even though the question closed** — CC-37 (b) and
CC-57 (a) — and they are inside **O-3**, not asked separately.

---

## 8. Promotion, and P1-32

**P1-31 is not promoted.** `main` is `1262de74` and is unchanged by this phase.
[`closure-record.md`](./closure-record.md) § 6 records that the phase is **not eligible** for
promotion, and gate P1-G31's four conditions are conjunctive.

**Promotion and P1-32 wait for the Owner's verdict and for the actual certifications**, in the Owner's
own words of 2026-09-15, quoted whole in § 1 above. Nothing in this packet advances either, and
nothing in it should be read as saying the phase is complete.

---

**This packet does not contain the Owner's verdict; it lists what only the Owner can decide.**
