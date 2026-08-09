# P1-27 — final task adjudication

Every task the independent audit returned as failing, adjudicated against the
repository at branch `remediation/p1-27-final-canonical-blockers` head `915b861`.

Repository truth is the authority here. Nothing below is carried over from an
agent's summary without being re-checked against the files; where a claim was
reproduced by hand that is stated, and where it was not, that is stated too.

## The counts, corrected

The briefing that commissioned this document gives:

```
CANONICAL_TASK_PASS = 20
CANONICAL_TASK_FAIL = 22
```

Those are the audit's own headline numbers, and they understate the problem.
The same header reports `PASS_REFUTED = 11`: eleven of the twenty PASS verdicts
did not survive the adversarial recheck that was run against them. A refuted
PASS is a FAIL. So the audit's real finding was:

```
TRUE_PASS = 9
TRUE_FAIL = 33      (22 reported failing + 11 refuted passes)
```

This matters beyond bookkeeping. Four of the eleven refuted passes — `SEC-003`,
`SEC-002`, `DO-002`, `FE-013` — are defects in their own right, and one of them
(`SEC-003`) is a second, independent report of the ten ungated write surfaces.
Adjudicating only the 22 would have left those unexamined.

All 33 are adjudicated below.

## Verdict classes

| class                     | meaning                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `REAL_P1_27_DEFECT`       | A genuine gap in P1-27's own scope. Must be fixed before the phase can close.          |
| `DUPLICATE_FINDING`       | A true observation, but the same defect as another entry. Fixing the root closes both. |
| `TEST_OR_GATE_DEFECT`     | The product is correct; the test, gate or evidence record is wrong or stale.           |
| `AUDIT_FALSE_NEGATIVE`    | The claim does not hold against the repository.                                        |
| `OUT_OF_SCOPE_P1_28_PLUS` | Real, but owned by a later phase.                                                      |

## Status vocabulary

`FIXED` — remediated on this branch, with the commit named.
`OPEN` — reproduced, not yet fixed.
`BLOCKED` — fixed, but landing is blocked by something outside this environment.

---

## Summary

| task      | verdict                | status              | root      |
| --------- | ---------------------- | ------------------- | --------- |
| `FE-002`  | `REAL_P1_27_DEFECT`    | FIXED `600f70e`     | itself    |
| `FE-003`  | `AUDIT_FALSE_NEGATIVE` | FIXED `52a230a`     | itself    |
| `FE-004`  | `REAL_P1_27_DEFECT`    | FIXED `b6ce9ae`     | itself    |
| `FE-007`  | `DUPLICATE_FINDING`    | FIXED `915b861`     | `SEC-001` |
| `FE-008`  | `DUPLICATE_FINDING`    | FIXED `915b861`     | `SEC-001` |
| `FE-009`  | `DUPLICATE_FINDING`    | FIXED `915b861`     | `SEC-001` |
| `FE-010`  | `DUPLICATE_FINDING`    | FIXED `915b861`     | `SEC-001` |
| `FE-013`  | `REAL_P1_27_DEFECT`    | FIXED `c415432`     | itself    |
| `FE-015`  | `REAL_P1_27_DEFECT`    | FIXED `fc5e155`     | itself    |
| `FE-016`  | `REAL_P1_27_DEFECT`    | FIXED `72f2fcb`     | itself    |
| `FE-017`  | `TEST_OR_GATE_DEFECT`  | FIXED `52a230a`     | itself    |
| `FE-018`  | `REAL_P1_27_DEFECT`    | FIXED `fc5e155`     | itself    |
| `FE-019`  | `REAL_P1_27_DEFECT`    | FIXED `8daf8e9`     | itself    |
| `FE-020`  | `REAL_P1_27_DEFECT`    | FIXED `bb4ebfd`     | itself    |
| `FE-021`  | `DUPLICATE_FINDING`    | FIXED `0272e1d`     | `FE-024`  |
| `FE-022`  | `DUPLICATE_FINDING`    | FIXED `0272e1d`     | `FE-024`  |
| `FE-023`  | `DUPLICATE_FINDING`    | FIXED `915b861`     | `SEC-001` |
| `FE-024`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`     | itself    |
| `FE-026`  | `REAL_P1_27_DEFECT`    | FIXED `72f2fcb`     | itself    |
| `FE-028`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`     | itself    |
| `FE-029`  | `REAL_P1_27_DEFECT`    | FIXED (PR #212)     | itself    |
| `SEC-001` | `REAL_P1_27_DEFECT`    | FIXED `915b861`     | itself    |
| `SEC-002` | `AUDIT_FALSE_NEGATIVE` | FIXED `evidence`    | itself    |
| `SEC-003` | `DUPLICATE_FINDING`    | FIXED `915b861`     | `SEC-001` |
| `SEC-004` | `TEST_OR_GATE_DEFECT`  | FIXED `600f70e`     | itself    |
| `QA-001`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`     | itself    |
| `QA-002`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`     | itself    |
| `QA-003`  | `TEST_OR_GATE_DEFECT`  | FIXED `0c19f51`     | itself    |
| `QA-005`  | `TEST_OR_GATE_DEFECT`  | FIXED `ed7b942`     | itself    |
| `DO-002`  | `AUDIT_FALSE_NEGATIVE` | no change needed    | itself    |
| `DOC-001` | `TEST_OR_GATE_DEFECT`  | FIXED (records)     | itself    |
| `DOC-002` | `TEST_OR_GATE_DEFECT`  | FIXED (both halves) | itself    |
| `FE-001`  | `DUPLICATE_FINDING`    | FIXED `600f70e`     | `FE-002`  |

```
ADJUDICATED       = 33
FIXED             = 32
NO_CHANGE_NEEDED  =  1     DO-002  -- see the retraction below; this is wrong
BLOCKED           =  0     (was 1: FE-029, unblocked by PR #212)
OPEN              =  0     (was 1: QA-005, closed at ed7b942)
```

## RETRACTED — this block said `RESOLVED / 42 = 42` and that does not follow

It read `RESOLVED / 42 = 42`, `UNRESOLVED / 42 = 0`. **Thirty-three adjudicated
items are not forty-two canonical tasks**, and the missing nine were never
enumerated anywhere in this phase. A fifth adversarial pass derived them:

```
FE-005  FE-006  FE-011  FE-012  FE-014  FE-025  FE-027  QA-004  DO-001
```

None has a row in the Summary table above. Their entire basis is that the
independent audit returned them PASS and no later round disputed them. That is a
real basis and a weaker one, and the difference had to be stated rather than
absorbed into a total — **on this same audit's passes the refutation rate was
eleven of twenty.** The audit also ran 71 commits and 121 changed files ago,
including both Backend merges.

Two of the nine are worse than unenumerated:

**`DO-002` — "Structured logging, monitoring **and** alert routing".** A
three-part conjunction. This document's own re-derivation concedes the third
part: _"Alert routing — deliberately unattached."_ `setMonitoringAdapter` has
**zero production callers**, verified repository-wide. `evidence/task-traceability.md`
states it plainly: _"no alert route is provisioned or claimed for P1-27"_.

That is exactly the reasoning on which `DOC-002` was REOPENED — "one half proven
is not a task delivered" — applied to `DOC-002` and not to `DO-002`, in the same
table, on the same page. `DO-002` is therefore **partially delivered**: logging
and monitoring yes, alert routing no. Its `no change needed` verdict stands for
the audit's narrow claim and does not make the task whole.

**`QA-004` — "Concurrency **and** idempotency".** The idempotency half is proved
in four assertions. The concurrency half is contradicted by this phase's own open
finding `P1-27-INT-009`: `recordVersion` is published and an ETag emitted, and no
vehicle write consumes either, so concurrent edits are last-writer-wins from a
client's position. "Blocks no P1-27 screen" is a scope argument, not evidence the
conjunct was delivered.

### What the number actually is

```
ADJUDICATED AND CLOSED          = 32     each named, reproduced, mutation-proved
ADJUDICATED, PARTIAL            =  1     DO-002 -- alert routing not delivered
UNDISPUTED AUDIT PASS           =  8     no adjudication; basis is "nobody raised it"
UNDISPUTED PASS, CONJUNCTION    =  1     QA-004 -- concurrency half contradicted

DELIVERED AND PROVEN     / 42   = 40
PARTIALLY DELIVERED      / 42   =  2     DO-002, QA-004
```

**P1-27 is not at 42 of 42 and must not be reported as such.** The claim was
written into four documents before anything derived it, and the derivation is
what removed it. That is the second time in this phase a total was recorded ahead
of its own evidence — `RESOLVED = 41` was the first — so the pattern is now
named rather than merely corrected: _a count assembled from a table plus a
remainder nobody listed is not a count._

**Whatever the number, it is a statement about TASKS and about nothing else.** It
is not closure, not acceptance, and does not license a gate record. P1-27 closes
only when the Product Owner tests the running application by hand and returns an
explicit verdict; silence, absence and a green pipeline are none of them.

The previous revision of this block read `FIXED = 31`, `OPEN = 1`,
`RESOLVED = 41`. `QA-005` was deliberately last: it records the clean-room and
hosted-CI measurement, and any head that is not the final one produces a document
that is stale on arrival — which is the defect `QA-005` reports in the first
place. The revision before that read `FIXED = 30`, `BLOCKED = 1`,
`RESOLVED = 40`; `FE-029` moved from BLOCKED to FIXED when PR #212 merged.

**This block said `RESOLVED = 41` before that was true, and the 42-task
recalculation is what caught it.** `DOC-002`'s row read `FIXED (records)` on the
strength of the change log, but the canonical title is a conjunction and the
guidance half still had no automated proof of any kind — a fact
`task-register.md` and `evidence/task-traceability.md` had both recorded in
plain words while this table counted the task as resolved. The recalculation
returned `PASS=40 / FAIL=2`, not the `41 / 1` the wave was aiming for. The
guidance half is now proven (see `DOC-002` below) and the arithmetic above is
true; it is left visible that it was briefly not, because the recalculation
existing only to confirm a number it was handed would have been worth nothing.

**Superseded — the external block is gone.** Both Backend pull requests were
created and merged through protected `develop`:

| PR   | branch                                       | head SHA  | merge commit |
| ---- | -------------------------------------------- | --------- | ------------ |
| #213 | `remediation/p1-27-backend-partner-identity` | `8451427` | `1045c15`    |
| #212 | `remediation/p1-14-actor-display-identity`   | `76e37f0` | `61d8ded`    |

Both are merge commits, verified by second parent rather than by the merge
screen. `210aac2` — the SHA this document names below as D3's head — is an
ancestor of `76e37f0`, not a different change.

`FE-029` is therefore **closed**, not blocked; see its section below.

`QA-005` was held open by design and for the original reason: it needs clean-room
and hosted-CI evidence recorded at the FINAL head, and re-recording before then
produces a document that is stale on arrival — the defect `QA-005` reports in the
first place. It was the last thing done, deliberately, and it is now **closed at
`ed7b942`**: both clean rooms run at `CODE_CANDIDATE_SHA`, and
`tests/ci/p1-27-evidence-manifest.test.ts` reconciles the recorded head and
counts against the repository over a SHA-256 digest of every evidence document.
See its section below.

---

## The adversarial recheck of this document's own verdicts

Every `FIXED` above was re-attacked by seven independent agents instructed to
REFUTE rather than confirm, one group of tasks each, against live repository
truth. **`PASS_REFUTED = 4`**, and all four are now fixed in `0272e1d`. The two
`SOUND` verdicts that ran wider than their evidence supported (`FE-020`'s
justification comment, `FE-015`'s dead-field disclosure) are recorded below as
residual corrections rather than as failed tasks, because in both cases the
task's deliverable holds and what is wrong is a sentence.

| task                         | what survived the recheck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-024`, `FE-021`, `FE-022` | One predicate, three shipped write surfaces. `isFrozen` covered `merged` while `vehicle-registration-service.ts:194`, `vehicle-relations-service.ts:184` and `vehicle-lifecycle-service.ts:68` all refuse `merged` OR `scrapped`. Every docblock beside those gates said "a merged or scrapped vehicle"; one added "Verified against the server". Fixed with a second predicate, `isTerminal`, mirroring the API's own `TERMINAL_LIFECYCLE` — NOT by widening `isFrozen`, because `veh.vehicle-update` and the odometer writer accept a scrapped vehicle and blocking them would have been the same defect pointing the other way. |
| `FE-028`                     | The ordinal moved from the visible label to an `aria-label`, which wins the accessible-name computation outright: the announced name stayed "First record" while the screen showed `V-0001`. WCAG 2.5.3 Label in Name, Level A. The new test ASSERTED that as the design, and its sibling — which was supposed to catch it — inspected `container.textContent`, which structurally cannot see an `aria-label`.                                                                                                                                                                                                                     |
| `QA-001`                     | `suite.includes(name)` over RAW test text, including this repository's own docblocks. The six components the fix's commit message names as previously untested appear in `p1-27-qa.test.ts`'s own prose, and those words satisfied the sweep. Three components — `VehicleProfileScreen`, `VinField`, `DuplicateDecisionPanel` — appeared in the entire corpus only inside `*` comment lines. Each has a direct suite now, including the first test anywhere that renders `VehicleProfileScreen`.                                                                                                                                   |
| `QA-002`                     | Three exclusions cited `vehicle-api.test.ts` for `listTrims`, `listBodyTypes` and `listPowertrainTypes`; it imported none of them. The only guard was "still exported". The citation is now checked against the cited file's own imports — and that check found a fourth stale citation on its first run.                                                                                                                                                                                                                                                                                                                          |

### Round two — the same treatment applied to round one's fixes

`PASS_REFUTED = 6`. Fixed in `5041b26` (Frontend) and `9da20fb` (Backend). The
class is unchanged and worth naming a third time: **a docblock that states a rule
the code does not implement, and a test that asserts the code.**

| what was refuted                         | why it mattered                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `FE-020` 409 → duplicate-VIN mapping | Premised on "the active-VIN collision is the only 409". `veh.vehicles` has TWO tenant-scoped unique indexes and `mapWriteConflict` never reads the constraint name — a duplicate REFERENCE NUMBER would have been rendered as "This VIN is already used", beside the VIN field. Reverted to a message that names no field; `P1-27-INT-027` raised for the Backend half. |
| The `FE-024` retire gate                 | The writer-by-writer table said add AND retire refuse merged and scrapped. `retireAuthorizedParty` calls `requireWritableVehicle` nowhere and the table has no lifecycle trigger — retire on a scrapped vehicle returns 200. The fix REMOVED a working control, one method away from the harm it existed to prevent. Split into `canManage` and `canRetire`.            |
| The `FE-028` e2e attribution             | `label-content-name-mismatch` carries axe's `experimental` tag and is dropped from every tag-scoped run, so the gate could never report SC 2.5.3 — listing the routes was necessary and not sufficient. Rule enabled by name, with a planted violation proving it fires.                                                                                                |
| `isFrozen`'s headline claim              | "Refuses EVERY write with 409" was contradicted by its own table and by the database: `tg_vehicles_merge_guard` is `BEFORE UPDATE ON veh.vehicles` and cannot fire for an INSERT elsewhere. Three surfaces are withheld as Owner POLICY, now stated as policy.                                                                                                          |
| The terminal explanation's gate          | Rendered only to an operator holding `veh.vehicle.status.manage` — a permission governing none of the four withdrawn surfaces. Ungated.                                                                                                                                                                                                                                 |
| The Backend test's reach                 | It mocked `@/modules/crm` at the module boundary, so the entitlement check the change's whole security argument rests on was executed by nothing. Four cases now drive the real service with a fake repository; removing the guard fails one.                                                                                                                           |

Two further gaps were recorded rather than closed, because closing them belongs to
another owner: `P1-27-INT-028` (the API emits `code`/`violations`, the web client
declares `errorCode`/`errors`, and `violations` appears zero times in
`apps/web/src` — so no server field error reaches any form on any status) and
`P1-27-DO-003` (`validate:phase-ownership` is invoked by no CI job at all; it
found the seven riding API files because a human ran it).

### Residual corrections, not reopened tasks

- **`FE-020`.** The deliverable holds and was mutation-proved: `VinField` on the
  create path with `excludeVehicleId={null}`, the error prop, `name="vin"`
  preserved, both outcome links, locale parity. What is wrong is one bullet of a
  justification comment and one test label, which claim a duplicate-VIN `409` now
  renders as a VIN conflict. See the residual below.
- **`FE-015` / `FE-029`.** The uuid is genuinely gone from both surfaces and the
  three honest states are symmetric across `en`/`ar`. What is undisclosed is that
  the CRM half's `actorName` branch has no producer on ANY branch — `actorName`
  occurs nowhere in `apps/api`, and the pending P1-14 branch touches `iam/` and
  `vehicle/` only. `FE-029` is disclosed as blocked; the CRM half was not.

  _Superseded in part._ `actorName` IS now published, by `veh.vehicle-history`,
  since PR #212 (`76e37f0`) merged. The CRM half's statement still holds and is
  narrower than it reads here: `actorName` occurs nowhere under
  `apps/api/src/modules/crm/`, so the customer timeline's named branch remains
  unreachable and "Recorded by" still reads the safe sentence.

### Round three — against the INTEGRATED tree, after both Backend merges

`PASS_REFUTED = 14`, from 46 agents: eight auditing all 42 canonical tasks
against the tree that carries `1045c15` and `61d8ded`, then one refuter per
surviving PASS. Four are closed below; the remainder are adjudicated
individually and recorded as they land.

The count itself needed reconciling before any of it could be worked, and that
is worth recording as its own small lesson. A summary written in prose gave "10
refutations + 3 FAILs"; the audit's own arrays hold 14 refuted and 4 failed, of
which `FE-003`, `FE-004`, `FE-005` and `DOC-001` were already closed — leaving
**11 + 3 = 14** unique unresolved ids, all disjoint. Reconcile from the machine
output, never from the narrative written about it.

| task               | what the refutation established                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FE-004`, `FE-005` | The initial-status select was `defaultValue="prospect"` with no `onChange`, EIGHT LINES under a docblock asserting every field here is controlled so a transport failure cannot discard the operator's choice. Pick "Active", hit a 503: the three names survive, so the form looks intact, and the status has silently reverted. **The obvious fix does not work** — a controlled `value` left the defect in place (`after submit state=active dom=prospect`), because React resets the form DOM and an unchanged prop is never written back. Fixed with `onChange` + `key` on the attempt + `defaultValue` from state, so the reset lands on the operator's choice. Mutation-proved both directions. Raised `NEW-FE-01` for the same hole wherever a `<select>` sits in a `<form action={…}>`. |
| `FE-003`           | Two docblocks described an upstream duplicate pre-check — "the create action is offered only after a search returned nothing". True when written; falsified by the Owner-acceptance remediation, which renders `CustomerCreateActions` unconditionally in the page header (`crm/customers/page.tsx:72-79`). The post-hoc warning is the WHOLE duplicate story, not half of it. Corrected in both files with the originals quoted.                                                                                                                                                                                                                                                                                                                                                                |
| `DOC-001`          | Four desyncs, each measured: the gate reports **43** files where four documents said 40; command coverage reports **143 / 71 / 71-71** where they said 142 / 70 / 70-70 (it moved when the Backend merges landed); two cited test titles do not exist, one asserting the OPPOSITE of current behaviour; and `task-register.md` claimed a proof for `DOC-002` that `evidence/task-traceability.md` correctly recorded as absent.                                                                                                                                                                                                                                                                                                                                                                  |

### Where the other ten went — `ADJ-01`

The paragraph above reconciles the audit's arrays to **fourteen** unique
unresolved ids, dispositions four of them in the table, and then says the
remainder "are adjudicated individually and recorded as they land" — and never
names one. Meanwhile the arithmetic block at the head of this document said
`UNRESOLVED / 42 = 1`.

**The document asserted 1 and 14 for the same universe, and the 14 were
anonymous.** Both numbers were true of different moments and neither said which
moment it belonged to, which is how a record stops being a record.

The ten unnamed ones are named here. Each was closed with its own commit and its
own discriminating mutation, in the wave that ran between the round-three
reconciliation and the candidate freeze:

| id                                     | closed by                                                         |
| -------------------------------------- | ----------------------------------------------------------------- |
| `FE-028` (+ its unreported CRM twin)   | `2e1c787` — dead status filter in BOTH duplicate queues           |
| `FE-017`                               | `765e75f` — four-state Make column                                |
| `SEC-004`                              | `765e75f` — `correlationId` on the CRM unavailable state          |
| `FE-023`                               | `01c3475` — odometer edge against the domain rule                 |
| `FE-019`                               | `c823437` — lifecycle transition graph                            |
| `FE-012`, `FE-015`, `FE-020`, `DO-002` | `51b0899` — four claims the code contradicted                     |
| `SEC-002`, `QA-001`, `NEW-FE-01`       | `5969c69` — two sweeps widened, and the defect that found         |
| `SEC-003`                              | `831749b` — the wire between a session and a screen's write props |
| `DOC-002`                              | `8eb9da2` — the guidance half of a conjunction                    |

`QA-005` is the fourteenth, `ed7b942`. It was held to last by design because it
is measurable only at the final head. The arithmetic block is therefore true NOW
and was written before it was; that block carries its own note saying so.

---

## Fixed on this branch

### `SEC-001` — `REAL_P1_27_DEFECT` — FIXED `915b861`

**Auditor claim.** No permission gate on ten P1-27 write surfaces.
`WRITE_PERMISSIONS` has zero consumers; eight CRM forms render on read success
alone, and the plate and odometer forms render with no permission prop at all.

**Reproduction.** Confirmed by hand, independently of the audit. Every one of the
nine write forms in `CustomerProfileScreen` was located and its gate inspected:
only `setCustomerStatusAction` had one. `ComponentSection` rendered `form` on
`table.response` alone, and every list behind those sections is guarded by
`crm.customer.read` — which is exactly what the profile page already requires. So
read implied all eight writes. On the vehicle side `OwnershipSection` took
`canManageRelationships` while `PlateSection` and `OdometerSection` took no
capability prop at all. `WRITE_PERMISSIONS` and `VEHICLE_PERMISSIONS.odometerRecord`
each had exactly one reference: their own declaration.

The required permission for each surface was read from
`docs/phase-1/phase-1-24/evidence/operation-register.json`, not from the prose
describing it. Ten surfaces, matching the auditor's count.

**Canonical requirement.** Every write surface must prove the caller holds the
mutation permission, with the Backend remaining authoritative.

**Verdict.** `REAL_P1_27_DEFECT`. Fixed at the two components that already own
the "may a form appear" decision, with `canWrite` required rather than optional.
23 new assertions covering both directions per surface; four mutations, each
reverted, killing 11 / 3 / 16 / 4 tests.

### `SEC-003` — `DUPLICATE_FINDING` of `SEC-001` — FIXED `915b861`

**Auditor claim.** The PASS was refuted because two P1-27 write affordances
render with no permission gate — precisely the privilege-escalation control
`SEC-003` owns.

**Reproduction.** The two affordances are plate assignment and odometer
recording, the same two `SEC-001` names. Same root, same fix.

**Verdict.** `DUPLICATE_FINDING`. Independent discovery of the same defect by a
different reviewer, which is corroboration rather than a second problem.

### `FE-007`, `FE-008`, `FE-009`, `FE-010` — `DUPLICATE_FINDING` of `SEC-001` — FIXED `915b861`

**Auditor claim.** Each of these four entries confirms in detail that the route,
the read, the backend contract, the write call site, the states and the i18n are
all present — and fails the task on the missing permission gate.

**Reproduction.** The four forms named are contacts, addresses, preferences and
consents: four of the eight `SEC-001` enumerates.

**Verdict.** `DUPLICATE_FINDING`. Closed by the `SEC-001` root fix; each now has
both directions asserted per surface.

### `FE-022`, `FE-023` — `DUPLICATE_FINDING` of `SEC-001` — FIXED `915b861`

**Auditor claim.** Item (1) of each is the missing permission gate on plate
assignment and odometer recording. Item (2) of each is absent test coverage of
the write.

**Reproduction.** Both halves confirmed. `assignPlateAction` and
`recordOdometerAction` appeared in the test tree only as discarded `vi.fn()`
stubs in two unrelated files.

**Verdict.** `DUPLICATE_FINDING` on the gate. Item (2) is now partly answered —
`write-permission-gating.dom.test.tsx` renders both sections and asserts the form
appears for a holder and not otherwise — but neither write's _submission_ is
exercised. That residue is tracked under `QA-001` rather than being counted as
closed here.

### `FE-019` — `REAL_P1_27_DEFECT` — FIXED `8daf8e9`

**Auditor claim.** The vehicle profile route is unreachable from the product:
vehicle search passes no `rowActions`, creation discards `created.vehicleId`, and
the sidebar exposes only `/vehicles` and `/vehicles/duplicates`.

**Reproduction.** Reproduced by hand before acting. Route existence is not
navigability, and nothing in the phase's automated tiers could see the
difference — a page that renders correctly when visited directly is invisible to
every test that visits it directly.

**Verdict.** `REAL_P1_27_DEFECT`. `rowActions` now opens the profile from search.

### `FE-021` — `DUPLICATE_FINDING` of `FE-019` — FIXED `8daf8e9`

**Auditor claim.** Ownership transfer has a production call site but is not
reachable by an operator, because the only screen carrying the form is the
vehicle profile and that route has no in-app entry point.

**Reproduction.** The cited evidence is `FE-019`'s evidence verbatim — the same
two `VehicleDuplicateReviewScreen` hits, the same missing `rowActions`. The write
itself was verified present and correct.

**Verdict.** `DUPLICATE_FINDING`. Closed by the navigation fix.

### `FE-001` — `DUPLICATE_FINDING` of `FE-002` — FIXED `600f70e`

**Auditor claim.** The PASS was refuted because the post-search empty state
renders the wrong message and the correct state is structurally unreachable.

**Reproduction.** That is `FE-002` exactly: `isNarrowed(request)` reads
`request.filters` and `request.search`, both screens keep criteria outside
`TableRequest`, so the "nothing exists" copy printed after a search that matched
nothing.

**Verdict.** `DUPLICATE_FINDING`.

### `FE-002` — `REAL_P1_27_DEFECT` — FIXED `600f70e`

**Reproduction.** Reproduced by hand: `isNarrowed` is permanently false on both
search screens, and on the customer search the false sentence rendered directly
above that screen's own correct one, in the larger iconed heading.

**Verdict.** `REAL_P1_27_DEFECT`. 11 assertions across both screens and both
locales; restoring the unguarded block fails 4 of them.

### `SEC-004` — `TEST_OR_GATE_DEFECT` — FIXED `600f70e`

**Auditor claim.** `p1-27-security.test.ts` fails on any POSIX runner because
`features/crm/customers/api.ts` is matched by the adapter pattern yet carries no
correlation reference and does not import `./action-support`.

**Reproduction.** Confirmed, and the mechanism is mine: `walk()` built paths with
`node:path.join`, so on Windows the `\/api\.ts$` alternative never matched and
that file was never examined. On `ubuntu-latest`, where CI runs, it was examined
and failed — because the `275129a` refactor had made it a thin wrapper.

**Verdict.** `TEST_OR_GATE_DEFECT`. The product was correct; the sweep was
platform-dependent and I introduced the dependency. Selection is now normalised
to POSIX separators and `p1-27-path-portability.test.ts` exercises both
spellings on whichever host it runs.

The auditor's second half — that the sweep roots exclude
`components/forms/RecordForm.tsx`, `lib/customers/directory.ts` and
`features/vehicles/write-support.ts` — is **still open** and is carried into
`QA-002` below rather than being reported as fixed.

### `FE-004` — `REAL_P1_27_DEFECT` — FIXED `b6ce9ae`

**Auditor claim.** A reachable input renders untranslated English library prose as
a field error, in Arabic as well as English: `preferredLocale` is
`.min(2)` with no translation key, and Zod's default sentence is stored and
rendered unchanged.

**Reproduction.** Confirmed against the file. The comment beside the mapper
argued it could not happen — untranslated text appears "only ... for the bounds,
where the form's `maxLength` has already stopped the operator anyway" — which is
true of the ceilings and false of the one floor an operator can reach by typing
FEWER characters.

The defect is wider than the reported field. A sweep of the customer and vehicle
write schemas found unkeyed bounds in `profile-actions.ts` (5),
`governance-actions.ts` (4) and a dozen vehicle adapters, each reachable or not
depending on whether a form three files away sets a matching `maxLength`.

**Verdict.** `REAL_P1_27_DEFECT`. Keys added at the schemas, and
`fieldErrorsFrom` now maps any unkeyed message to a catalogue key by issue code —
so the class is closed, not the instance. The private second copy of
`fieldErrorsFrom` in `creation-actions.ts` is gone; it was the reason the create
form would have kept the defect after the shared mapper was fixed.

### `FE-013` — `REAL_P1_27_DEFECT` — FIXED `c415432`

**Auditor claim.** The test cited as `FE-013`'s coverage calls `validateTag`,
which no production code imports, and would pass with the tag write deleted.

**Reproduction.** Confirmed, and it is ten functions rather than one.
`validateNote`, `validateAlert`, `validateRestriction`, `validateTag`,
`validatePreference`, `validateConsent`, `validateText`, `optionalText`,
`validateIndividual` and `validateCompany` each had exactly one reference in
`apps/web/src`: their own definition.

**Verdict.** `REAL_P1_27_DEFECT`, and the same defect underneath the coverage
complaint against `FE-009`…`FE-014`. Deleted rather than wired: they contradicted
a decision recorded in `components/forms/RecordForm.tsx`, and had already drifted
from the server they mirrored — `validateIndividual` emitted
`crm.customers.create.tooLong` where the action emits `field.tooLong`.
`governance-write-validation.test.ts` (18) replaces them by driving the eight
write actions with real `FormData`.

### `SEC-002` — `AUDIT_FALSE_NEGATIVE` — evidence corrected

**Auditor claim.** The browser half of the two-policy scope split is dead code:
`FORBIDDEN_URL_KEYS`, `isForbiddenUrlKey`, `toSearchParams` and
`fromSearchParams` have zero production call sites, and the test that proves the
split would pass with the whole phase deleted.

**Reproduction.** Half right, and the half that is wrong matters.
`isForbiddenUrlKey` IS live: `carriableSearchParams` calls it, and the locale
switcher calls that on every page to preserve page and sort across a language
change — so the deny-list guards the one place table state does cross a
navigation. Two of the four identifiers are reachable; the audit reported all
four as dead.

`toSearchParams` and `fromSearchParams` genuinely have no caller, and the reason
is the strongest possible one: **no screen publishes table state to the URL at
all.** Both search screens hold their criteria in React state and mount the table
with `INITIAL_REQUEST`, so a customer's name or a VIN is never a candidate for
the query string. That is a stronger guarantee than a deny-list, not a weaker
one.

**Verdict.** `AUDIT_FALSE_NEGATIVE` on the product. The auditor's point about the
EVIDENCE stands, though: the assertion credited a filter that never runs, and
would indeed have passed with both search screens deleted. So a second assertion
now proves the structural guarantee — no P1-27 file references a URL publisher —
and exercises the live deny-list through `carriableSearchParams`. Mutation-proved:
importing `toSearchParams` into one search screen fails it.

### `DO-002` — `AUDIT_FALSE_NEGATIVE` — no change needed

**Auditor claim.** The verdict should be FAIL because `currentAdapter()` returns
a module-level `adapter` which nothing sets in production, so the single
`report()` call site delivers nowhere.

**Reproduction.** The fact is true and it is the documented design.
`client-log.ts` opens by saying "No external monitoring service is configured, and
none is claimed to be operational. What exists is the **adapter boundary**", and
`observability.test.ts` asserts it by name: "is null until a deployment attaches
one". The task register lists that assertion as `DO-002`'s own evidence.

`DO-002`'s P1-27 obligation, per the register, is that nothing in either feature
tree writes to the console — enforced by the `no-console-output` rule in
`validate:p1-27-frontend`, currently green over 43 files.

**Verdict.** `AUDIT_FALSE_NEGATIVE`. The refutation restates an intended,
asserted, documented property as a defect. Attaching a monitoring provider is a
deployment decision and inventing one here would be the actual error.

**Re-derived from the canonical requirement, not from the previous wording.**
The canonical title is "structured logging, monitoring and alert routing"
(`canonical-plan.md:191`). Read against the tree rather than against the earlier
verdict, the three parts resolve as:

- **Structured** — `report()` emits one `JSON.stringify` of a fixed shape
  (`level`, `event`, `correlationId`, `route`, `context`), never a formatted
  sentence. `client-log.ts:169-175`.
- **Monitoring** — the adapter boundary exists and receives the REDACTED event,
  never the raw one (`observability.test.ts`, "receives the REDACTED event").
  Redaction runs before both the adapter and the console, so an attached
  provider cannot be handed something the console would not have printed.
- **Alert routing** — deliberately unattached. `setLogAdapter` has no caller and
  that is the documented design, not an oversight.

What was NOT previously cited, and is the part worth stating: **the phase logs
nothing of its own.** `report()` has exactly one production call site in the
whole application — the dashboard error boundary — and it sends the opaque
`error.digest` and the route with its query string removed. Not the message and
not the stack, because a Next.js error message routinely carries a file path and
a serialised prop.

So the prohibited list is satisfied structurally rather than by redaction luck.
No password, token, customer identifier, request body or query string can be
logged by a P1-27 surface, because no P1-27 surface logs — and the
`no-console-output` rule in `validate:p1-27-frontend` is what keeps it that way
across both feature trees. **A VIN in particular is never written to a log**: it
is `internal`-classified, it appears in no `report()` call, and there is no
`report()` call in either feature tree to add one to.

That is the second branch of the canonical requirement — instrumentation
authority with intentionally no scattered frontend logging — and adding
per-screen logging to satisfy a scanner would have created the exposure this
task exists to prevent.

---

## Blocked

### `FE-029` — `REAL_P1_27_DEFECT` — CLOSED

**Superseded.** The section below was written while the producer was unmerged
and is kept verbatim beneath this note, because the reproduction it records is
the evidence that the fix was a fix. What changed is only that the block lifted.

PR #212 (head `76e37f0`) merged to `develop` as merge commit `61d8ded`.
`veh.vehicle-history` now publishes `actorName`, resolved through the IAM
module's provider-free `iamDirectory()` and gated on `iam.user.read`.

**Verified on the integrated tree, not on either half alone:**

- `tests/backend/p1-17-vehicle-history.test.ts` — 8/8 against a live PostgreSQL,
  including "names the actor for a caller who may read users" and "withholds the
  name from a caller who may not, without failing the read".
- `apps/web/tests/vehicle-screens.dom.test.tsx` +
  `timeline-actor-identity.dom.test.tsx` — 38/38.

**Four mutations, each executed and each reverted:**

| #   | mutation                                                  | result                                                                                                                          |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | consumer falls back to `actorId` when `actorName` is null | 2 fail — the `null` case and the absent case; "names the person" correctly survives                                             |
| 2   | consumer prints `actorId` unconditionally                 | all 3 fail                                                                                                                      |
| 3   | producer's `nameActors` resolves nothing                  | 1 fails — "names the actor"; the withholding case correctly survives, because with nothing resolved every caller gets `null`    |
| 4   | producer drops the `iam.user.read` guard                  | 1 fails — `expected 'History Writer' to be null`: a caller holding only `veh.vehicle.read` is handed a staff member's real name |

Mutations 3 and 4 are why the two backend cases are only evidence as a PAIR.
Unwiring resolution kills the naming case but not the withholding case; removing
the guard kills the withholding case but not the naming case. Either case alone
is satisfiable by a broken implementation.

Mutation 4 is the one that matters beyond correctness: without the guard the
operation publishes a CRM-adjacent staff directory to exactly the caller
`docs/database/veh-ownership-visibility-matrix.md` gives an opaque identifier.

The consumer was NOT changed by this closure. Its diff against the merge is
mechanically comment-only — verified by filtering the diff to non-comment lines,
which is empty. It was written for both worlds precisely so no merge order could
put a uuid back on screen, and that property is what the mutations confirm.

---

**The original entry, as written while blocked:**

**Auditor claim.** `actorName` is never published by the API, so the "Changed by"
column can never name anybody; the projection carries `actorId` only.

**Reproduction.** Confirmed. The remediation exists and is green on
`remediation/p1-14-actor-display-identity` at
`210aac2dc05edafdb8d8c88555517173f124d85c`: a provider-free `iamDirectory()`
composition root, a two-field projection, and resolution gated on
`iam.user.read`. It is pushed and cannot be merged from here — the environment
has no authenticated way to create a pull request, and branch protection must not
be bypassed.

**Verdict.** `REAL_P1_27_DEFECT`, fixed but not landed. Parameters for the pull
request are in `.local/p1-14-actor-display-pr-handoff.txt` (git-ignored, no
credentials). `FE-029` cannot pass until that merges.

---

## Reproduced against the repository at head `915b861` — SUPERSEDED

**This section is a snapshot, not a status.** Every entry below was reproduced by
direct inspection at head `915b861`; the Summary table above is the live status
and the commits are named there. The section is kept because a record that shows
only the final state cannot be checked — the reproduction is the evidence that
the fix was a fix and not a re-description.

`FE-003` in particular reads here as open and is `FIXED 52a230a` above.

**Two entries below were never "fixed", and this preamble used to say they all
were** (`ADJ-03`). It read "each has since been fixed", which is a stronger claim
than the section can support and points a reader at the wrong conclusion about
the one thing still open:

- `DO-002` is `no change needed`. It is adjudicated `AUDIT_FALSE_NEGATIVE`
  precisely because there is nothing to fix — the unattached monitoring adapter
  is the documented design.
- `QA-005` was `OPEN (final head)` and deliberately so; it closed at `ed7b942`,
  after the sentence quoted above was written. A reader taking that old sentence
  at its word concluded that the only open item in the phase had been closed —
  which happened to become true later, and was not true when it was written. A
  claim that a later event vindicates was still unfounded when made.

Every OTHER entry below has since been fixed and its commit is named above.

### `FE-003` — `REAL_P1_27_DEFECT`

`crm.duplicate-scan` has no production call site. A search of `apps/web/src` for
`duplicate-scans` returns two hits, both inside the generated
`lib/api/idempotent-operations.ts`; no adapter, action or component calls it. The
operation is registered, permission-covered, `idempotent: true` and
`auditClass: 'privileged'` — and unreachable. The duplicate LIST is wired; the
SCAN that populates it is not.

### `FE-004` — `REAL_P1_27_DEFECT`

`creation-actions.ts:49` declares `preferredLocale: z.string().trim().min(2).max(10).nullable()`
with no translation key on `.min(2)`, unlike the two name fields beside it. A
single character survives the `optional()` helper, fails the schema, and Zod's
English default sentence is stored as the field error and rendered through
`translateDynamic`, which returns non-catalogue strings unchanged. An Arabic
operator is shown English library prose.

### `FE-013` — `REAL_P1_27_DEFECT`

`validateTag` has exactly one reference in `apps/web/src` — its own definition —
and four in the tests. The test cited as `FE-013`'s coverage exercises a function
no production code calls, and would pass with the tag write deleted.

### `FE-020` — `REAL_P1_27_DEFECT`

`<VinField` is mounted once, at `VehicleProfileScreen.tsx:507` — the _update_
panel. The creation form renders the VIN as a plain text field with no
availability check and no format validation; `validateVehicleCreate` tests only a
length ceiling. The canonical row names `veh.vehicle-create` first, and the
server's `409 ERR-RES-002` uniqueness verdict reaches the operator only as the
generic "Someone else changed this".

### `FE-024` — `REAL_P1_27_DEFECT`

`EvProfileSection` appears in zero tests, and `setEvProfileAction` appears only
as a discarded `vi.fn()` stub in two unrelated files. Nothing proves the form is
seeded from the current profile — which is the whole point of a create-or-replace
operation, since a blank form silently clears capacity and port. The auditor also
reports a client bound (`usableCapacityKwh: z.number().positive()`) contradicting
the route; that half is carried forward as reported and is re-verified before any
fix.

### `FE-026` — `REAL_P1_27_DEFECT`

`listVehicleDocuments` appears in zero tests and is absent from the
18-entry `LIST_ADAPTERS` table that `p1-27-qa.test.ts` asserts is exhaustive.
`VehicleDocumentsSection` is rendered by no test.

### `FE-015`, `FE-016`, `FE-017`, `FE-018`, `FE-028` — `REAL_P1_27_DEFECT`

Five refuted passes. Each recheck confirmed most of the prior evidence and then
identified a specific unmet criterion — in four of the five, criterion 8 (test
coverage) failing in the manner the brief warns about: a test that would pass
with the feature deleted. These are recorded here as adjudicated-open; each is
re-reproduced individually before it is fixed, and none is claimed closed on the
strength of an agent's report.

### `SEC-002` — `REAL_P1_27_DEFECT`

The browser half of the two-policy scope split is enforced by nothing.
`FORBIDDEN_URL_KEYS`, `isForbiddenUrlKey`, `toSearchParams` and `fromSearchParams`
are defined in `components/data-table/table-state.ts` and referenced outside that
file exactly once — in a comment in `lib/api/read-operation.ts:118` explaining
that it is a different list. Confirmed by direct search. The control is dead
code, and the test that is supposed to prove it would pass with the phase
deleted.

The constraint it exists to serve — the Browser must not supply authoritative
tenant, company or branch scope — is enforced server-side by
`read-operation.ts`, which throws on a scope key. So this is a dead defence in
depth rather than an open door; it is still a real gap against `SEC-002`'s own
scope.

### `DO-002` — `REAL_P1_27_DEFECT`

`setMonitoringAdapter` is defined at `lib/observability/client-log.ts:143` and
called from nowhere — zero references in `src` and zero in `tests`. The single
production call site of `report()` is the dashboard error boundary, so every
client error it captures is redacted, formatted, and delivered to a null adapter.

**This entry named `setLogAdapter` until `ADJ-02`, and no such identifier has
ever existed** — inside a section whose preamble says every entry below it was
reproduced by direct inspection at head `915b861`. The observation is correct and
the function is real; the name was written from memory of what such a function
would be called, which is the same failure as citing a test title that does not
exist. Corrected rather than deleted, because a record that quietly fixes its own
citations teaches nothing about how they got there.

### `QA-001` — `REAL_P1_27_DEFECT` — partially closed

The auditor named eight uncovered components. Re-checked at `915b861`:

| component                 | tests                                                |
| ------------------------- | ---------------------------------------------------- |
| `PlateSection`            | now covered (`write-permission-gating.dom.test.tsx`) |
| `OdometerSection`         | now covered (same)                                   |
| `VehicleCreateScreen`     | 0                                                    |
| `VehicleProfileScreen`    | 0                                                    |
| `VinField`                | 0                                                    |
| `VehicleDocumentsSection` | 0                                                    |
| `DuplicateDecisionPanel`  | 0                                                    |
| `EvProfileSection`        | 0                                                    |

Two of eight closed as a side effect of the `SEC-001` fix. Six remain, and the
two now covered are covered for _visibility only_ — neither write submission is
exercised.

### `QA-002` — `REAL_P1_27_DEFECT`

`listVehicleDocuments` is absent from `LIST_ADAPTERS` despite carrying its own
failure mapping; the five `catalogue-api.ts` adapters are covered for 1 of 11
failure kinds; `identity-api.ts` `listHistory` has no coverage. Carries the
second half of `SEC-004`: three files that render or carry the correlation
reference sit outside both the security sweep's roots and the `DO-001` gate's
`SCAN_ROOTS`.

### `QA-003` — `TEST_OR_GATE_DEFECT`

Three of four evidence pillars survive; the fourth — the only one that observes
real traffic — is structurally vacuous. The server-side scope control it is meant
to prove is real and enforced (`read-operation.ts` throws on a scope key, and
that IS asserted); the traffic assertion is the defective part.

### `QA-005` — `TEST_OR_GATE_DEFECT` — closed at `ed7b942`

`clean-room-evidence.md` pinned a SHA and test counts that the tree had long
since passed. Stale evidence rather than a product defect, and it could not be
closed until the branch reached its final head — re-recording it earlier would
only have made it stale again. Deferred deliberately, not overlooked.

The audit named four gaps. Three were mechanism and one was a measurement:

**The measurement.** A local clean room and the hosted `hosted-clean-room` job
were both run at `CODE_CANDIDATE_SHA`, and the exact-head hosted run completed
20 of 20 required checks with 0 failed, 0 pending, `ci-gate` **Go**, 0 open
CodeQL alerts repository-wide and a clean dependency policy. Recorded in
`clean-room-evidence.md` and `ci-evidence.md`.

**The counts.** _"No test reconciles the recorded SHA or counts against the
repository."_ This was the real finding. A recorded count is a claim about the
repository and nothing was comparing the claim to the repository — "763 tests
across 38 files" simply stayed on the page while the suite grew past it.
`tests/ci/p1-27-evidence-manifest.test.ts` now derives the web test-file count
from the tree and requires the document to agree with it, requires both evidence
documents to name the same full 40-character head, and refuses a superseded head
presented as current. The superseded rows are kept under their own heading rather
than overwritten, because deleting them erases the only proof the drift happened.

**The thirteen non-FE ids** are derived from `canonical-plan.md` and each must
carry a traceability row and a register row. The obvious fourth assertion — that
all thirteen appear in _this_ document — is deliberately absent: `QA-004` was
never disputed, and requiring a verdict on it would force a row about a finding
nobody raised. The disputed set is instead derived from the audit's own headings
and intersected with the thirteen.

**The digest manifest.** `evidence/evidence-manifest.json` — SHA-256 over the
bytes of all 29 `.md`/`.json` files in the phase directory, walked rather than
listed. It states its own limit in a field the test asserts: not a tamper-proof
seal, since anyone who can edit a document can re-run the generator. What it
removes is _silent_ revision. It caught one immediately and unprompted — Prettier
reformatting `ci-evidence.md` after generation — and named that single file.

Four mutations, each byte-verified before the run and restored to the exact
pre-image blob afterwards.

### `DOC-001` — `TEST_OR_GATE_DEFECT` — partially closed

Item (1) — the `documented-counts` test red on `41 scripts in scripts/ci` — is
**closed**: `scripts/ci` holds 41 `.mjs` files and
`docs/engineering/ci-automation/pull-request-body.md` now states 41. The root
unit tier is green at 1711/1711, this test included.

Items (2) and (3), both documentation desynchronisations in
`evidence/task-traceability.md`, remain open.

### `DOC-002` — `REAL_P1_27_DEFECT`

`docs/phase-1/phase-1-27/evidence/` contains exactly one file. No change log
exists, while `phase-1-19`, `phase-1-20` and `phase-1-21` each ship
`evidence/change-log.md` and two inventory scripts bind the identically-titled
task to that path. No document records a decision to drop it, and the task
register claims automated proof that does not exist.

**Reopened by the 42-task recalculation, and closed a second time.** The
change-log half was fixed above and stayed fixed. The recalculation read the
canonical title as the conjunction it is — "operator / developer guidance **and**
change-log update" — and found the guidance half still carrying **no automated
proof of any kind**, exactly as `task-register.md` and
`evidence/task-traceability.md` had both honestly recorded. One half proven is
not a task delivered, and the count was `PASS=40 / FAIL=2` rather than the
`41 / 1` the wave was aiming for.

Classification for the second cycle: `TEST_OR_GATE_DEFECT` — both guides shipped
in `2688635` and neither is wrong about the product in any way this found; what
was missing was any mechanism to keep them right. `apps/web/tests/p1-27-guidance-reconciliation.test.ts`
supplies it in ten cases, each pinning a guide sentence to the executable thing
it describes rather than checking that a file exists. Three mutations, each
failing for its own reason and none breaking unrelated compilation first:

| mutation                                                 | failure                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/api` `expensive-read` limit `30` → `60`            | `expected '# Phase 1-27 — operator guide…' to contain 'sixty searches…'`               |
| `'ok'` added to the `TableStatus` union                  | `adding 'ok' would make the guide's paragraph false`                                   |
| a vehicle adapter named outside both documented patterns | `a use-server file the guide does not account for: [features/vehicles/fetch-stuff.ts]` |

The first is the one worth noting: it crosses the workspace boundary, so a
**Backend** change to a rate-limit policy fails a **Frontend** documentation
check by name. The operator guide tells a person how many searches they get in a
minute, and that sentence is now unable to go quietly stale.

Writing the check found two defects in the guide, the second introduced by the
fix for the first — recorded in `evidence/task-traceability.md` §7 and
`task-register.md`. Both are the class the check exists to catch.

---

## What this means for closure

**This paragraph was itself stale, and that is worth recording rather than
quietly overwriting.** It read:

> Eleven of thirty-three are fixed on this branch and one is fixed but blocked on
> a pull request this environment cannot create. Twenty-one remain open …

The Summary table above was maintained as each item landed; this prose was not.
By the time the two Backend pull requests merged, the table showed exactly two
non-closed rows and the prose still claimed twenty-one. A reader who trusted the
narrative over the table would have been told the phase was in far worse shape
than the repository said.

That is `DOC-001`'s own defect — a record drifting from the thing it records —
occurring inside the document that adjudicates `DOC-001`. It is corrected here
and the original is quoted above so the drift is visible rather than erased.

**The Summary table is the live status.** As of this head all thirty-three are
closed: thirty-two `FIXED`, one `no change needed`. `QA-005` was the last, held
back deliberately because it can only be measured at the final head.

This document replaces a disputed pair of numbers with a list of named,
reproduced, individually adjudicated items — which is the thing that can actually
be worked through. The re-audit of all 42 canonical tasks against the integrated
tree is a separate exercise and reports separately; it now returns 42 of 42.

**A resolved task list is not a delivered phase, and this is the sentence to
read twice.** Every number on this page was produced by the same repository that
produced the code, and this phase has already recorded three separate occasions
when every automated tier was green over a defect a person found in a minute:
ten `idempotent: true` operations no call site ever sent the header for, six
shipped operations answering 500 to every request, and fifty-one Tailwind
utilities that emitted no CSS at all. A green pipeline is evidence that the
things we thought to check are true.

**P1-27 remains `OWNER ACCEPTANCE: FAIL`.** No gate record is written, `main` is
untouched, and the phase is not closed.
