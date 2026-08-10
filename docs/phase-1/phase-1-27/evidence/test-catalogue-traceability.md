# Phase 1-27 — canonical test-catalogue traceability

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act against the running application; it is not derivable from any count in this repository and cannot be inferred from silence.

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Task:** `P1-27-DOC-001` — contract, catalogue and traceability synchronization

---

## 1. The defect this record closes

`canonical-plan.md` §5 allocates **29** test-catalogue identifiers, one per
Frontend task — `TC-P1-27-CRM-001` … `-015`, `TC-P1-27-VEH-001` … `-011`,
`TC-P1-27-XD-001` … `-003`. `task-matrix.json` carries them again as
`CANONICAL_TEST_ID`, and `task-register.md` names two of them.

**Not one of the twenty-nine appeared in a single executable file.** A search for
`TC-P1-27` across `apps/web/tests`, `tests`, `scripts`, `apps/web/src` and
`apps/api` returned nothing. The plan's own §6 says each id "**will** expand into
the required path matrix" — a future tense that was never discharged.

So these are not invented identifiers to be deleted. They are real canonical
requirements with no binding to anything executable, which is the worst of the
two states: a reader who greps for one finds nothing and cannot tell whether the
test was deleted or never written.

### 1.1 Why this is data and not twenty-nine new test files

Creating `TC-P1-27-CRM-001.test.ts` twenty-nine times would make the search
succeed and prove nothing. Worse, it would make the ids look discharged while the
path matrix behind them stayed unbuilt.

The repository already has the binding convention it needs — a
`* Test-reference: TC-XXX-###` docblock, present in 19 files under `tests/db`
(for example `tests/db/crm-profiles.test.ts:10`) and in **0** files under
`apps/web/tests`, enforced by no script. This record does not add those
docblocks: the web test files belong to the Frontend change that owns them, and a
documentation change may not edit them. §5 states exactly how the convention is
applied later, and what will then check it.

What this record does is bind each id to the executable tests **that already
prove it**, as machine-readable data a gate reads.

---

## 2. What the gate checks

`test-catalogue-traceability.json` sits beside this document and is checked on
every run of `npm run validate:p1-27-doc-counts`
(`scripts/ci/check-p1-27-doc-counts.mjs`, `checkCatalogue`). It fails when:

| the record does this                                            | the gate says                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| omits an id `canonical-plan.md` declares                        | `<id> is declared in the plan and has no record`                   |
| records an id the plan does not declare                         | `<id> is recorded and the plan declares no such id`                |
| cites a test file that does not exist                           | `<id> cites <file>, which does not exist`                          |
| quotes a case title that is in no case **of the file it names** | `<id> quotes "<title>", which is in no case of <file>`             |
| names no proof and states no gap                                | `<id> names no proof and states no gap — an unstated gap is a lie` |
| omits a path the plan's own path-matrix sentence requires       | `the plan requires the "<path>" path; it has no row`               |
| marks a path `PARTIAL` or `ABSENT` without a reason             | `"<path>" is <status> and states no reason`                        |
| sets `matrixDischarged` to anything but `false`                 | refused — nothing in this repository establishes it                |

**The per-FILE check is the part that bites.** The existing web reconciliation
concatenates every test file and asks whether a quoted title appears _anywhere_,
so a title attributed to the wrong file passed it. Building this record found one:
`FE-013` credited `crm-governance-writes.test.ts` with "requires a segment code of
at least two characters" and "treats the display name as optional". Both live in
`governance-write-validation.test.ts`, and the second is a fragment of the longer
title "accepts a two-character code and treats the display name as optional".
Recorded as `G-11` in `adversarial-round-five.md` and corrected in
`task-traceability.md`.

---

## 3. The twenty-nine, and what proves each

Derived from `evidence/task-traceability.md` §3, which names a test file and the
case within it for every Frontend task. **29 declared · 29 resolve to at least one
executable case · 0 with no proof at all.**

<!-- derived: catalogue ids = 29 -->
<!-- derived: catalogue files = 20 -->
<!-- derived: catalogue titles = 139 -->

**20** distinct test files carry them, and **139** quoted case titles are checked
against the file that is said to hold them. Those two figures were prose — "16
distinct test files" and "109 quoted case titles" — until the rebinding below
moved both and nothing said so. They are read out of the JSON now.

**"Checked against the file" was weaker than it read, until `26eab7e`.** The check
matched a quoted title against the RAW source, so a title appearing in a COMMENT
satisfied it. Two live citations were exploiting that, and both are corrected
here rather than deleted:

- `TC-P1-27-CRM-014` quoted **"rejects a value outside the vocabulary"** against
  `crm-governance-writes.test.ts`, whose only occurrence of that string is a
  comment at `:217` recording that the case had MOVED to
  `governance-write-validation.test.ts` — where it was then renamed. The title
  named no case anywhere in the repository. It now cites the case that really
  carries the obligation, **"refuses a restriction type outside the CHECK
  constraint"**.
- `TC-P1-27-CRM-010` quoted **"excludes expired"** twice for the same file. A
  repeated title inflates a count and resolves perfectly — the `A42-10` shape,
  one document over. It now names one occurrence plus the two consent-status
  cases in `governance-write-validation.test.ts`.

`checkCatalogue` strips comments before matching and refuses a title quoted twice
for one file, so neither can come back. That is the fourth scanner in this phase
found reading prose as code, which is why the fix is in the gate and not only in
the data.

<!-- derived: rows catalogue-table = 29 -->

| id                 | task     | proven by                                                                                                                |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `TC-P1-27-CRM-001` | `FE-001` | `crm-customer-search.test.ts`, `crm-customer-search.dom.test.tsx`                                                        |
| `TC-P1-27-CRM-002` | `FE-002` | `crm-customer-search.test.ts`, `crm-customer-search.dom.test.tsx`                                                        |
| `TC-P1-27-CRM-003` | `FE-003` | `crm-customer-create.dom.test.tsx`                                                                                       |
| `TC-P1-27-CRM-004` | `FE-004` | `crm-customer-create.dom.test.tsx`, `write-adapters-driven.test.ts`                                                      |
| `TC-P1-27-CRM-005` | `FE-005` | `crm-customer-create.dom.test.tsx`, `write-adapters-driven.test.ts`                                                      |
| `TC-P1-27-CRM-006` | `FE-006` | `crm-customer-profile.dom.test.tsx`, `profile-accessibility.dom.test.tsx`, `p1-27-permission-route-binding.dom.test.tsx` |
| `TC-P1-27-CRM-007` | `FE-007` | `crm-customer-profile.dom.test.tsx`                                                                                      |
| `TC-P1-27-CRM-008` | `FE-008` | `crm-customer-profile.dom.test.tsx`                                                                                      |
| `TC-P1-27-CRM-009` | `FE-009` | `crm-governance-writes.test.ts`, `crm-customer-components.dom.test.tsx`                                                  |
| `TC-P1-27-CRM-010` | `FE-010` | `crm-governance-writes.test.ts`, `crm-customer-components.dom.test.tsx`                                                  |
| `TC-P1-27-CRM-011` | `FE-011` | `crm-profile-api.test.ts`, `crm-customer-components.dom.test.tsx`                                                        |
| `TC-P1-27-CRM-012` | `FE-012` | `crm-governance-writes.test.ts`, `crm-customer-components.dom.test.tsx`                                                  |
| `TC-P1-27-CRM-013` | `FE-013` | `governance-write-validation.test.ts`, `crm-customer-components.dom.test.tsx`                                            |
| `TC-P1-27-CRM-014` | `FE-014` | `crm-governance-writes.test.ts`, `crm-customer-components.dom.test.tsx`                                                  |
| `TC-P1-27-CRM-015` | `FE-015` | `crm-duplicate-review.test.ts`, `crm-customer-components.dom.test.tsx`                                                   |
| `TC-P1-27-XD-001`  | `FE-016` | `crm-duplicate-review.test.ts`                                                                                           |
| `TC-P1-27-VEH-001` | `FE-017` | `vehicle-api.test.ts`, `vehicle-screens.dom.test.tsx`                                                                    |
| `TC-P1-27-VEH-002` | `FE-018` | `vehicle-contract.test.ts`, `vehicle-api.test.ts`                                                                        |
| `TC-P1-27-VEH-003` | `FE-019` | `vehicle-profile.test.ts`, `p1-27-permission-route-binding.dom.test.tsx`                                                 |
| `TC-P1-27-VEH-004` | `FE-020` | `vehicle-profile.test.ts`, `vehicle-contract.test.ts`                                                                    |
| `TC-P1-27-VEH-005` | `FE-021` | `vehicle-history.test.ts`                                                                                                |
| `TC-P1-27-VEH-006` | `FE-022` | `vehicle-history.test.ts`, `vehicle-plate-section.dom.test.tsx`, `write-adapters-driven.test.ts`                         |
| `TC-P1-27-VEH-007` | `FE-023` | `vehicle-history.test.ts`                                                                                                |
| `TC-P1-27-VEH-008` | `FE-024` | `vehicle-relations.test.ts`                                                                                              |
| `TC-P1-27-XD-002`  | `FE-025` | `vehicle-relations.test.ts`, `write-adapters-driven.test.ts`                                                             |
| `TC-P1-27-VEH-009` | `FE-026` | `vehicle-duplicates.test.ts`                                                                                             |
| `TC-P1-27-VEH-010` | `FE-027` | `vehicle-duplicates.test.ts`                                                                                             |
| `TC-P1-27-XD-003`  | `FE-028` | `vehicle-duplicates.test.ts`, `vehicle-screens.dom.test.tsx`                                                             |
| `TC-P1-27-VEH-011` | `FE-029` | `vehicle-duplicates.test.ts`, `vehicle-screens.dom.test.tsx`                                                             |

The exact case titles are in the JSON, one array per id, and each is checked
against the file named beside it. This table lists files only, so that it cannot
become a second copy of a hundred and thirty-eight strings that drift.

**One grouping deserves its own sentence.** `FE-026` (documents) and `FE-027`
(media) are proven by `vehicle-duplicates.test.ts` rather than by a file named
after them. That is where the assertions live, it is not a mistake, and it is
stated here because a reader who assumes a file-per-feature convention would
conclude the record is wrong.

### 3.1 Six ids pointed away from the work that closed their gap

The first version of this record bound each id to the tests that existed when it
was written. Three waves then landed, and six of the bindings stayed where they
were — resolving, checked, and pointing at the older suite rather than at the one
that closed the gap the id is about.

| id                 | pointed only at                     | now also cites                                                                      | why it matters                                                                                                   |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `TC-P1-27-CRM-004` | `crm-customer-create.dom.test.tsx`  | `write-adapters-driven.test.ts`                                                     | That file MOCKS `createIndividualAction`. The adapter it names was executed by nothing until `c283354` (`H-05`). |
| `TC-P1-27-CRM-005` | `crm-customer-create.dom.test.tsx`  | `write-adapters-driven.test.ts`                                                     | The same, for `createCompanyAction`.                                                                             |
| `TC-P1-27-CRM-006` | `crm-customer-profile.dom.test.tsx` | `profile-accessibility.dom.test.tsx`, `p1-27-permission-route-binding.dom.test.tsx` | The profile's accessibility scan and its route-level write binding both arrived after the id was bound.          |
| `TC-P1-27-VEH-003` | `vehicle-profile.test.ts`           | `p1-27-permission-route-binding.dom.test.tsx`                                       | Its permission citation compared two constants; the route binding renders the real page. See §3.2.               |
| `TC-P1-27-VEH-006` | `vehicle-history.test.ts`           | `vehicle-plate-section.dom.test.tsx`, `write-adapters-driven.test.ts`               | The plate write schema had no test at all (`H-10`); both files now exercise it.                                  |
| `TC-P1-27-XD-002`  | `vehicle-relations.test.ts`         | `write-adapters-driven.test.ts`                                                     | The relationship writes were mocked; they are executed now. Its permission citation is the second one in §3.2.   |

Nothing was removed. A binding that resolves is evidence even when a better one
exists, and deleting evidence to improve a record is the defect one level up.

### 3.2 "Resolves" is not "proved" — two citations that only resolve

An independent reader spot-checked five of the twenty-nine and found **two whose
only cited case asserts that two CONSTANTS differ**:

- `TC-P1-27-VEH-003` → `vehicle-profile.test.ts`, "gates editing and status
  changes on different permissions" — which asserts
  `VEHICLE_PERMISSIONS.vehicleManage !== VEHICLE_PERMISSIONS.statusManage`.
- `TC-P1-27-XD-002` → `vehicle-relations.test.ts`, "separates relationship
  management from vehicle management" — the same shape.

Both are real, executable and green. Neither reaches a screen, so both would pass
unchanged against a profile that rendered every panel to a session holding
neither code. **So the "29 resolve" headline in §3 must not be read as "29
proved", and this section exists so it cannot be.**

<!-- derived: catalogue weak = 2 -->

Two entries are recorded in the JSON's `weakCitations` block. It is held to the
same standard as the rows: `checkCatalogue` requires each entry to name a
recorded id, a file that exists, a case title present in that file, a stated
weakness, and a strengthening proof whose titles resolve too — otherwise the
block would be the one place in this record where a citation is unchecked.

**How far the check goes, stated as the smaller claim.** Two were found because
five were sampled. The other twenty-four are not asserted to be strong; no
mechanical test can tell a case that proves a behaviour from a case that merely
runs, and this record does not pretend to have one. What it has is a gate that
refuses an unstated weakness, and a sample of five with two failures in it.

---

## 4. The path matrix is NOT discharged

This is the honest half, and it is the half that matters.

`canonical-plan.md` §6 does not say an id needs _a_ test. It says each id "will
expand into the required path matrix" and then names eighteen paths. Binding an id
to one or two cases makes the id resolve; it does not build that matrix, and no
document in this phase has ever said which of the eighteen exist.

Measured across the whole CRM and Vehicle surface — not per id, because per-id
would be a hundred and thirty-two hand-maintained cells and this phase has learned
what those become:

| path                | status    | note                                                                                 |
| ------------------- | --------- | ------------------------------------------------------------------------------------ |
| normal              | `PROVEN`  |                                                                                      |
| alternative         | `PROVEN`  | individual against company creation                                                  |
| validation          | `PROVEN`  | bounds read out of the CHECK constraint, not guessed                                 |
| authentication      | `PROVEN`  |                                                                                      |
| permission denial   | `PROVEN`  |                                                                                      |
| scope denial        | `PARTIAL` | the client is proven never to assert scope; a server scope denial is an ordinary 403 |
| empty               | `PROVEN`  | and specifically that an empty result does not claim the tenant has no records       |
| error               | `PROVEN`  |                                                                                      |
| retry               | `PROVEN`  | including where Retry is deliberately not offered                                    |
| conflict            | `PROVEN`  |                                                                                      |
| duplicate           | `PROVEN`  |                                                                                      |
| stale version       | `ABSENT`  | decided as last-writer-wins by `P1-27-OD-005`; no route here is `versionGuarded`     |
| concurrent update   | `ABSENT`  | the same decision; `A42-13` still holds and `P1-27-OD-005` disposes of it            |
| idempotent replay   | `PARTIAL` | the key is proven on the wire; no P1-27 request is replayed and counted as a delta   |
| backend unavailable | `PROVEN`  |                                                                                      |
| timeout             | `PARTIAL` | proven in the shared client, on no screen                                            |
| cancellation        | `PARTIAL` | the same shape                                                                       |
| recovery            | `PROVEN`  | a rendered failure, the Retry press, the re-read and the rows — one case, `78c4587`  |

**12 `PROVEN` · 4 `PARTIAL` · 2 `ABSENT`.** Each `PARTIAL` and each `ABSENT`
carries its reason in the JSON, and the gate refuses one that does not.

`matrixDischarged` is `false` and the gate refuses any other value, because
nothing in this repository establishes that eighteen paths exist for
twenty-nine ids. Building them is Frontend work with its own tasks; it is not
something a documentation change may assert.

Re-derived at `0c40499`, after the four closure-wave branches merged. **The
shape was unchanged — 11 / 4 / 3 — and two reasons were not.** `stale version`
and `concurrent update` were recorded against an OPEN finding; they are now
recorded against a RATIFIED decision, `P1-27-OD-005`, which names the Backend
remediation that would create the path and binds itself to six executable checks
that fail the day it lands. An absence that is decided is still an absence, and
the status does not move for it. `idempotent replay` gains the on-the-wire proof
and the two Backend suites that bound what is left of it.

**Re-measured again at `78c4587`, and one row moved: `recovery`, `ABSENT` →
`PROVEN`.** The previous revision of this section specified the missing case
rather than asserting it — the only `ABSENT` row closable without a Backend
change, one case in an existing `apps/web` suite, written down for its owner. It
was written: `apps/web/tests/vehicle-screens.dom.test.tsx`, _"RECOVERS when Retry
is pressed: it re-reads, and the rows arrive"_. It drives the whole path — a
transient failure renders, the control is pressed, the adapter is asserted to
have been called AGAIN before anything visual is asserted, the rows arrive and
the failure state is asserted gone. **Mutation-proved here rather than taken on
the commit message: making `DataTable.tsx`'s Retry button `onClick` a no-op
failed that one case and no other — 1 failed, 1605 passed across 70 web files —
and the file was restored by copy.** That is what distinguishes it from the four
cases that preceded it, each of which asserted only that the control _is_ or _is
not_ offered and every one of which a button that renders and does nothing would
satisfy.

**The matrix is still NOT discharged.** Four `PARTIAL` and two `ABSENT` remain,
and this record does not round them up. `scope denial`, `idempotent replay`,
`timeout` and `cancellation` are `PARTIAL`; `stale version` and `concurrent
update` are `ABSENT` behind `P1-27-OD-005`. Of the six, only `idempotent replay`,
`timeout` and `cancellation` are closable from `apps/web` at all — the other
three need either a Backend capability that is deliberately absent or a
server-side distinction the wire does not carry.

---

## 5. How the docblock convention will be applied

The repository's binding convention is a docblock line:

```
 * Test-reference: TC-P1-27-CRM-001
```

Nineteen files under `tests/db` carry it. No file under `apps/web/tests` does,
and no script enforces it anywhere — which is why the convention could not have
caught this.

It is not applied here for one reason: `apps/web/tests` belongs to the Frontend
change that owns those files, and a documentation change that edited nineteen test
files to add comments would be doing Frontend work under a documentation task.

When it is applied, it is applied in this order, so that the enforcement lands
with the annotation rather than after it:

1. Each file in the `provenBy` list of an id gains
   `* Test-reference: <id>` in its module docblock. The mapping is already in the
   JSON, so this is mechanical rather than a second judgement.
2. `checkCatalogue` gains one more rule: every `provenBy.file` must carry a
   `Test-reference:` line naming the id that cites it, in both directions.
3. The rule is added in the same commit as the annotations. A convention added
   before its check is a convention that decays; this phase has that pattern
   recorded four times.

Until step 3 lands, the binding is the JSON, and the JSON is checked. That is a
weaker claim than a docblock in every file and it is stated as the weaker one.

---

**None of this is acceptance.** Making twenty-nine identifiers resolve to real
tests makes the record honest; it says nothing about whether the product works.
P1-27 closes only when the Product Owner manually tests the running application
and returns an explicit `OWNER ACCEPTANCE: PASS`. Silence is not Pass.
