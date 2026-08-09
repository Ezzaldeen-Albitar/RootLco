# P1-27 — adversarial round five

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act against the running application; it is not derivable from any count in this repository and cannot be inferred from silence.

**Classification:** Confidential — Commercial Product and Pilot Planning

Five independent read-only reviewers were run against head
`1f300dd3b7db2ac5936c91f8784560d33893067a`, each instructed to **refute** one of
this wave's own claims rather than confirm it. None was allowed to write a file.

**They refuted almost all of it.** Round four returned 27 claimed / 27 survived /
0 refuted, and this document exists because that outcome was treated as a
property of the panel rather than as evidence. This round attacked the fixes that
round four produced, and the claim it damaged most was the headline one:

> the whole form-reset class is now an INVENTORY — 6 forms, 7 selects, 1
> checkbox, 0 radios, **0 uncovered**

The inventory reported zero uncovered because it never opened the files
containing the defects. Three real product defects were sitting in them.

---

## How to read this register

**One table. One row per finding. Every id searchable, unique, and individually
dispositioned.** The first version of this document failed its own standard three
ways, which is recorded rather than quietly corrected:

- it used **three differently-shaped tables**, so no single derivation could read
  it and a count taken from the rows disagreed with the prose;
- it carried a **duplicate id** — `F-02` named both the scope-checkbox product
  defect and a `console.*` gate narrowing, in different sections;
- it wrote **`E-02…`**, a range. A range is not searchable, and that is now the
  fourth occurrence of the same lesson in this phase.

`apps/web/tests/p1-27-round-five-register.test.ts` derives the totals from the
rows below, refuses a duplicate id, refuses any status outside the vocabulary,
and refuses range shorthand in the id column.

### Status vocabulary

| status    | meaning                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| `FIXED`   | Closed on this branch, with a mutation that fails without the fix.                   |
| `OPEN`    | Reproduced and not yet fixed. Inherited by the next reader rather than rediscovered. |
| `PARTIAL` | Reclassified: the finding holds and the task it belongs to is not whole.             |
| `REFUTED` | Examined against repository truth and does not hold.                                 |

`UNKNOWN` is not a status. A finding with no verdict is `OPEN`.

---

## Register

| id         | area          | severity | status  | finding                                                                                                                                                                                                                                                             |
| ---------- | ------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F-01`     | PRODUCT       | HIGH     | FIXED   | `VehicleCreateScreen`'s client-validation branch did not advance `attempt`; the retry then SUCCEEDED with an empty make, model and body type.                                                                                                                       |
| `F-02`     | PRODUCT       | MEDIUM   | FIXED   | Six authorisation-scope checkboxes were controlled `checked=` inside `RecordForm`'s form via `prelude`; a failed write un-ticked all six and the retry sent an empty scope.                                                                                         |
| `F-03`     | PRODUCT       | MEDIUM   | FIXED   | `CustomerSelector`'s party-type filter reverted to "Any type" while `draft.partyType` kept the old value, so the search stayed restricted while the control said it was not.                                                                                        |
| `F-04`     | TEST/GATE     | HIGH     | FIXED   | The form-reset inventory reported "0 uncovered" over files it never opened.                                                                                                                                                                                         |
| `WTF-01`   | TEST/GATE     | HIGH     | FIXED   | The baseline claimed 36 headroom meant "a whole deleted test file still trips the floor"; two web files carry 36 cases, so it did not.                                                                                                                              |
| `WTF-02`   | TEST/GATE     | HIGH     | FIXED   | The baseline-to-`verdict()` lookup lived in `main()`, which nothing imports; renaming `tiers` to `tier` disarmed the floor with every test green.                                                                                                                   |
| `WTF-03`   | TEST/GATE     | HIGH     | FIXED   | `numTotalTests` counts skipped tests, so `it.skip` across the tier satisfied the floor with nothing executed.                                                                                                                                                       |
| `WTF-04`   | TEST/GATE     | MEDIUM   | FIXED   | Fail-open: an unresolvable baseline path warned and exited 0, so a wrong working directory disarmed every tier.                                                                                                                                                     |
| `WTF-05`   | TEST/GATE     | MEDIUM   | FIXED   | The tier derivation read one of the three workflows that invoke the summariser, reporting full coverage of a subset.                                                                                                                                                |
| `WTF-06`   | TEST/GATE     | MEDIUM   | FIXED   | `files` reported `numTotalTestSuites`; all four tiers stored a suite count under a name that says files.                                                                                                                                                            |
| `WTF-07`   | TEST/GATE     | MEDIUM   | FIXED   | The headroom bounds did not implement the criterion their own message stated.                                                                                                                                                                                       |
| `WTF-08`   | TEST/GATE     | LOW      | OPEN    | Lowering `minTests` and `measured` together passes every committed assertion; the anchor chain terminates in a hand-written number in prose.                                                                                                                        |
| `WTF-09`   | TEST/GATE     | LOW      | OPEN    | The deleted-file property is asserted against a frozen `measured`, so it decays silently as the suite grows.                                                                                                                                                        |
| `WTF-10`   | TEST/GATE     | LOW      | OPEN    | `tests-web.md` is never concatenated into the job summary, so the web honesty verdict is not rendered where a reviewer reads it.                                                                                                                                    |
| `WTF-11`   | TEST/GATE     | LOW      | OPEN    | The clean-room job runs the web tier through `verify:web`, with no summariser and therefore no floor — redundancy lost rather than a hole.                                                                                                                          |
| `QA005-01` | EVIDENCE      | HIGH     | OPEN    | `clean-room-evidence.md` claimed the recording commits change "documents only"; `git diff` returned five non-document paths, and the only check asserted the sentence was present.                                                                                  |
| `QA005-02` | EVIDENCE      | HIGH     | OPEN    | The recorded root-unit figures were stale at HEAD by exactly the test file the closure commit added.                                                                                                                                                                |
| `QA005-03` | EVIDENCE      | MEDIUM   | OPEN    | "the recorded head is real" was a describe title; the check was a 40-hex regex that `deadbeef` repeated five times satisfies.                                                                                                                                       |
| `QA005-04` | EVIDENCE      | MEDIUM   | OPEN    | `SUPERSEDED_HEADS` was a hard-coded list of two while the same page listed a third superseded head.                                                                                                                                                                 |
| `QA005-05` | EVIDENCE      | MEDIUM   | OPEN    | `toContain('65 web test files')` also matches "165 web test files", so the derived count only caught understatement.                                                                                                                                                |
| `QA005-06` | EVIDENCE      | MEDIUM   | OPEN    | The digest was recomputed with the function imported from the module under test; truncating it to 16 bytes left every case green.                                                                                                                                   |
| `QA005-07` | EVIDENCE      | MEDIUM   | OPEN    | Only `.md`/`.json` were digested, case-sensitively, and the docblock's claim that binaries are "listed" was false.                                                                                                                                                  |
| `QA005-08` | EVIDENCE      | MEDIUM   | OPEN    | Eight unreferenced evidence documents could be deleted and regenerated with every case green, because the only floor was greater-than-20.                                                                                                                           |
| `QA005-09` | EVIDENCE      | MEDIUM   | OPEN    | Most numbers on both evidence pages are decorative — recorded from named artefacts, checked by nothing.                                                                                                                                                             |
| `QA005-10` | EVIDENCE      | LOW      | FIXED   | `measuredFiles: 379` contradicted the same entry's "65 test files"; no assertion read the field.                                                                                                                                                                    |
| `QA005-11` | TEST/GATE     | LOW      | FIXED   | `evidence:p1-27` was registered `tier: 'optional'`, which is not one of the four defined tiers; any unrecognised string means "not a gate".                                                                                                                         |
| `QA005-12` | TEST/GATE     | LOW      | OPEN    | Directory symlinks were invisible to both walks, including the supposedly independent one.                                                                                                                                                                          |
| `A42-01`   | CANONICAL     | HIGH     | FIXED   | 42 was 33 adjudicated plus nine tasks no document enumerated.                                                                                                                                                                                                       |
| `A42-02`   | CANONICAL     | HIGH     | PARTIAL | `DO-002` counted as delivered while its own record concedes alert routing is unattached.                                                                                                                                                                            |
| `A42-03`   | DOCUMENTATION | HIGH     | OPEN    | `DO-002` is "no change needed" in the Summary and "closed by `51b0899`" in ADJ-01, and that commit assigns a fifth verdict class the table does not define.                                                                                                         |
| `A42-04`   | DOCUMENTATION | HIGH     | OPEN    | ADJ-01 says "the ten unnamed ones are named here" and names thirteen.                                                                                                                                                                                               |
| `A42-05`   | DOCUMENTATION | MEDIUM   | OPEN    | `setLogAdapter` was corrected at one occurrence and left at the other, and the survivor sits inside `DO-002`'s load-bearing sentence.                                                                                                                               |
| `A42-06`   | DOCUMENTATION | MEDIUM   | OPEN    | `FE-021` and `FE-022` carry different roots AND different commits in the Summary than in their own sections.                                                                                                                                                        |
| `A42-07`   | DOCUMENTATION | MEDIUM   | OPEN    | `canonical-plan.md` assigns `FE-003` two operations it does not use, and that stale line is the decision reference for two deliberately-absent classifications.                                                                                                     |
| `A42-08`   | DOCUMENTATION | MEDIUM   | OPEN    | `independent-task-audit.md` still says "P1-27 is not at 42/42" with no supersession note.                                                                                                                                                                           |
| `A42-09`   | DOCUMENTATION | LOW      | OPEN    | Four Summary rows say `FIXED` with no commit, against the table's own status vocabulary.                                                                                                                                                                            |
| `A42-10`   | DOCUMENTATION | LOW      | OPEN    | `FE-005`'s evidence cell names four cases of which two are the identical string; the file contains three.                                                                                                                                                           |
| `A42-11`   | DOCUMENTATION | MEDIUM   | OPEN    | `FE-021`/`FE-022`/`FE-023` traceability rows list only the GET of each canonical operation pair, contradicting section 9 of the same document.                                                                                                                      |
| `A42-12`   | TEST/GATE     | MEDIUM   | OPEN    | The only automated check that all 42 exist is a substring existence check, which this phase itself rejected as the wrong proof.                                                                                                                                     |
| `A42-13`   | CANONICAL     | MEDIUM   | PARTIAL | `QA-004`'s concurrency half is contradicted by `P1-27-INT-009`: no vehicle write consumes `recordVersion` or the ETag.                                                                                                                                              |
| `A42-14`   | DOCUMENTATION | LOW      | OPEN    | `SEC-002` is a five-part conjunction adjudicated on one part, on a commit-less row.                                                                                                                                                                                 |
| `A-01`     | TEST/GATE     | HIGH     | FIXED   | The closure-banner block was dead code once no row was OPEN, permitting the task-count banners in all three documents.                                                                                                                                              |
| `A-02`     | TEST/GATE     | HIGH     | FIXED   | `OWNER ACCEPTANCE: PASS` was banned nowhere, and the required `FAIL` string was satisfiable by a past-tense narrative.                                                                                                                                              |
| `A-03`     | TEST/GATE     | HIGH     | FIXED   | The banned spelling was one no document uses, while five unbanned spellings of the identical claim were already on the page.                                                                                                                                        |
| `A-04`     | TEST/GATE     | MEDIUM   | FIXED   | `P1-27 CLOSED GO` — this repository's actual closure vocabulary — was not banned.                                                                                                                                                                                   |
| `A-05`     | TEST/GATE     | HIGH     | OPEN    | "the evidence records point at this branch" is a describe title whose only case is an existence check.                                                                                                                                                              |
| `B-01`     | TEST/GATE     | MEDIUM   | OPEN    | A case that cannot fail: both regexes are start-anchored, so the conjunction is a logical impossibility.                                                                                                                                                            |
| `B-02`     | TEST/GATE     | MEDIUM   | OPEN    | A banned sentence is present in the document and escapes the ban only because Prettier wrapped it across a newline.                                                                                                                                                 |
| `B-03`     | TEST/GATE     | MEDIUM   | OPEN    | The open-total check fires only on one exact five-word phrasing and is dormant at zero.                                                                                                                                                                             |
| `B-04`     | TEST/GATE     | LOW      | OPEN    | Four cases are existence-only or assert nothing about P1-27.                                                                                                                                                                                                        |
| `B-05`     | TEST/GATE     | MEDIUM   | OPEN    | The citation check covers 136 of 239 quoted titles; a case count after a filename breaks the match and drops that whole cell.                                                                                                                                       |
| `B-06`     | TEST/GATE     | LOW      | OPEN    | The round-four closed count matches `FIXED` anywhere in the cell, so "NOT FIXED" would count as closed.                                                                                                                                                             |
| `D-01`     | TEST/GATE     | LOW      | OPEN    | The guidance test opens `en.json` only, so "quoted from the product" is proven for one locale of two.                                                                                                                                                               |
| `D-02`     | TEST/GATE     | LOW      | OPEN    | The guide's feature roots are narrower than the gate's tree, so a server file just outside them sits outside the guide's "exhaustive" partition.                                                                                                                    |
| `E-01`     | DOCUMENTATION | HIGH     | FIXED   | `deliverable-manifest.md` said "119 migrations, there is no migration 120" while `supabase/migrations` holds 120.                                                                                                                                                   |
| `E-02`     | DOCUMENTATION | MEDIUM   | OPEN    | Section 6.1 prose reports 64 files and 1208 passed against a measured 65 and 1216, contradicting the heading four lines above it.                                                                                                                                   |
| `E-03`     | DOCUMENTATION | MEDIUM   | OPEN    | The 1216-case figure is unchecked; only the file count is pinned, so the case half can drift silently.                                                                                                                                                              |
| `E-04`     | DOCUMENTATION | MEDIUM   | OPEN    | Two section headings state 20 and 23 files; the tables beneath them list 18 and 22 rows.                                                                                                                                                                            |
| `E-05`     | DOCUMENTATION | MEDIUM   | OPEN    | Two stale "40"s survive the fix that corrected the sentence directly above the first of them.                                                                                                                                                                       |
| `E-06`     | DOCUMENTATION | MEDIUM   | OPEN    | Section 9.1 line counts: eight of fifteen are wrong, under a row asserting "26 of 26 exact".                                                                                                                                                                        |
| `E-07`     | DOCUMENTATION | MEDIUM   | OPEN    | "15 tracked" phase documents against a tracked-file listing that returns 30.                                                                                                                                                                                        |
| `E-08`     | DOCUMENTATION | MEDIUM   | OPEN    | `tests/ci` stated as 31 files in two places and 33 in a third, in one document.                                                                                                                                                                                     |
| `E-09`     | DOCUMENTATION | LOW      | OPEN    | `tests/db` stated as 138 test files against a measured 139.                                                                                                                                                                                                         |
| `E-10`     | DOCUMENTATION | LOW      | OPEN    | Superseded command snapshots are presented in section 1.1 without a superseded marker.                                                                                                                                                                              |
| `E-11`     | DOCUMENTATION | LOW      | OPEN    | Three of four "measured case counts" in the row that exists to correct a stale register are themselves wrong.                                                                                                                                                       |
| `E-12`     | DOCUMENTATION | LOW      | OPEN    | The command-coverage gate is reported with two different measured outputs in one document.                                                                                                                                                                          |
| `G-06`     | TEST/GATE     | MEDIUM   | OPEN    | The console gate was widened to any `console.*` and the cited test left at the five-name list, so `console.table(customer)` passes the cited proof.                                                                                                                 |
| `G-07`     | DOCUMENTATION | MEDIUM   | OPEN    | Four case counts are stated twice in `task-traceability.md` and the two statements disagree; no test reads any case count in that document.                                                                                                                         |
| `G-08`     | DOCUMENTATION | LOW      | OPEN    | The frontend-gate suite is cited as 28 cases in one document and 26 in another; measured 28.                                                                                                                                                                        |
| `G-09`     | TEST/GATE     | HIGH     | FIXED   | `check-test-honesty.mjs` computed `stripComments` and then iterated the RAW lines, so `TH-001`/`TH-002` fired on docblocks that merely explain the `it.skip` hazard; the strip also deleted block comments outright, breaking every reported line number after one. |

<!-- prettier-ignore-start -->
```text
ROUND5_TOTAL   = 70
ROUND5_FIXED   = 20
ROUND5_PARTIAL =  2
ROUND5_OPEN    = 48
ROUND5_REFUTED =  0
```
<!-- prettier-ignore-end -->

These totals are DERIVED from the rows by
`apps/web/tests/p1-27-round-five-register.test.ts`, which fails if they disagree.

**The earlier revision of this document claimed "26 findings remain open" from
prose, and its rows supported no single number** — they lived in three tables of
different shapes, one id was used twice, and one entry was a range. The count was
not wrong so much as underived, which is the defect this phase keeps finding.

---

## The findings that mattered most

### `F-01` — a silent wrong write

Not a visual revert. `validateVehicleCreate` reads component STATE, which
survives React's post-action `form.reset()`; `createVehicleAction` reads FORM
DATA, which does not. Every catalogue field is optional server-side. So _mistype
a year → correct it → submit_ created a vehicle with no make, no model and no
body type, and reported success.

### `F-04` — why "0 uncovered" meant nothing

The scan was scoped to text lexically between `<form action={` and `</form>` **in
the same file**, and skipped any file with no literal form. `prelude` exists
precisely to render foreign controls inside somebody else's form.

Rewriting it surfaced three further defects **in the scanner itself**, each the
same class it exists to catch:

| defect                                             | consequence                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| the tag end was the first `>` in the file          | every head truncated at the first arrow function, hiding all following attributes      |
| the comment stripper replaced newlines with spaces | byte offsets stayed right, line numbers did not — a control at 370 was reported at 322 |
| `value=` treated as controlled state on a checkbox | a false positive on a correct control, where `value` is the submitted payload          |

### `WTF-03` — the floor was satisfied by a suite that ran nothing

`it.skip` across the tier leaves `numTotalTests` at 1216, `failed` 0 and
`success` true. The floor now compares EXECUTED tests, and a tier that collects
tests and executes none of them fails on its own rule.

### `A-01` and `A-02` — the guard disarmed itself on success

The Owner-status requirement was nested inside a condition on the open-task
count, so it evaporated on the commit that closed the last task — the exact
moment a premature closure claim becomes likely.

---

## What survived

Stated because a review that refutes everything is as suspect as one that refutes
nothing, and these were attacked in earnest:

- **`allowedLifecycleTargets` and `allowedWorkshopTargets` are correct on both
  axes.** The reviewer read the server's own lifecycle module and could not
  construct a UI-allowed / server-rejected pair.
- **The table hook's render-phase page reset is legal and converges**, and cannot
  leak a stale page.
- **`RecordForm`'s checkbox is genuinely uncontrolled** and its docblock is
  accurate.
- **`validate:p1-27-evidence` is genuinely reachable from hosted CI**, traced
  rather than assumed.
- **The round-four register reconciles exactly** — 27 ids on both sides, one per
  row, no ranges.
- **Every failure message quoted in the operator guide resolves** in `en.json`
  and in `ar.json`.
