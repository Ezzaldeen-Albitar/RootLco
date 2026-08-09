# P1-27 — adversarial round five

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

## What the review found, and where each stands

`FIXED` entries are closed on this branch with a mutation that fails without the
fix. `OPEN` entries are reproduced and **not** fixed; they are recorded here so
the next reader inherits them rather than rediscovers them.

### Product defects — operator-visible

| id     | severity | finding                                                                                                                                                                                                                              | status                |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `F-01` | HIGH     | `VehicleCreateScreen`'s client-validation branch did not advance `attempt`, so a rejected year reverted every catalogue select — and the retry **succeeded** with an empty make, model and body type.                                | **FIXED** — see below |
| `F-02` | MEDIUM   | The six authorisation-scope checkboxes were controlled `checked=` inside `RecordForm`'s form via `prelude`. A failed write un-ticked all six; the retry passed the client scope guard and the server rejected it for an empty scope. | **FIXED**             |
| `F-03` | MEDIUM   | `CustomerSelector`'s party-type filter reverted to "Any type" after a failed write while `draft.partyType` kept the old value — so the next search was still restricted to companies while the control said it was not.              | **FIXED**             |
| `F-04` | HIGH     | The inventory that was supposed to prevent all three could not see them.                                                                                                                                                             | **FIXED**             |

**`F-01` is the one to read.** It is not a visual revert. `validateVehicleCreate`
reads component STATE, which survives the reset; `createVehicleAction` reads FORM
DATA, which does not. Every catalogue field is optional server-side. So the
sequence _mistype a year → correct it → submit_ created a vehicle with no make,
no model and no body type, and reported success.

### The inventory, and why "0 uncovered" meant nothing

The scan was scoped to text lexically between `<form action={` and `</form>` **in
the same file**, and skipped any file with no literal form. That excluded
`CustomerSelector.tsx`, `Field.tsx`, `VehicleRelationsSections.tsx`,
`VehicleHistorySections.tsx` and `CustomerProfileScreen.tsx` — and `prelude`
exists precisely to render foreign controls inside somebody else's form.

Rewriting it surfaced three further defects **in the scanner itself**, each the
same class it exists to catch:

| defect                                             | consequence                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src.indexOf('>')` took the first `>` in the file  | every head truncated at the first `onChange={() =>`, hiding all following attributes   |
| the comment stripper replaced newlines with spaces | byte offsets stayed right, line numbers did not — a control at 370 was reported at 322 |
| `value=` treated as controlled state on a checkbox | a false positive on a correct control, where `value` is the submitted payload          |

The rewrite is derived rather than listed: a file is "inside a form" if it owns
one **or renders `<RecordForm` or passes `prelude={`**. Which control types the
reset can strand is read off React's DOM code rather than assumed — text inputs
and textareas re-sync their `defaultValue` every commit and are safe controlled;
selects and checkboxes never do. Exemptions are explicit, carry a reason, and
must each still match exactly one control.

Mutation, four, each byte-verified and restored to the exact pre-image blob:

| mutation                                             | result                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| revert the six scope checkboxes to `checked=`        | 2 of 6 red                                                                                                       |
| drop `attempt` from one `CustomerSelector` call site | 1 red                                                                                                            |
| revert the party-type filter to `value=`             | 2 red                                                                                                            |
| stop bumping `attempt` on client validation          | **static scan stays green** — closed instead by a DOM case that submits twice and reads what the action RECEIVED |

That last row is the honest limit of a static inventory, and it is why `F-01`
carries a DOM test rather than a scanner rule.

### The web test-count floor — refuted, then repaired

| id       | severity | finding                                                                                                                                                                                                                                                          | status    |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `WTF-03` | HIGH     | **Skipped tests count toward the total.** `it.skip` applied to the whole tier leaves `total` at 1216, `failed` 0, `success` true — the floor is satisfied by a suite that executed nothing.                                                                      | **FIXED** |
| `WTF-02` | HIGH     | The only code joining the baseline to `verdict()` lived inside `main()`, which nothing imports. Renaming `baseline.tiers` to `baseline.tier` disarmed the floor and all 21 tests still passed.                                                                   | **FIXED** |
| `WTF-04` | MEDIUM   | Fail-open: an unresolvable baseline path produced a warning and exit 0. A wrong working directory silently disarmed every tier.                                                                                                                                  | **FIXED** |
| `WTF-06` | MEDIUM   | `files` reported `numTotalTestSuites` — every `describe` block — so the web tier recorded `files: 379` for a run over 65 files, and all four tiers stored a suite count under a name that says files.                                                            | **FIXED** |
| `WTF-01` | HIGH     | The baseline's stated property — "a whole deleted test file still trips the floor" — is **false**. Two web files carry 36 cases; 1216 − 36 = 1180 is not below 1180. The headroom was derived from the LARGEST file when the binding constraint is the smallest. | **OPEN**  |
| `WTF-05` | MEDIUM   | The tier derivation reads one of the three workflows that invoke the summariser, so it reports full coverage of a subset.                                                                                                                                        | **OPEN**  |
| `WTF-07` | MEDIUM   | The headroom bounds (`> 0`, `< 10%`) do not implement the criterion their own message states; 10% of 1216 is 121, three times the largest file.                                                                                                                  | **OPEN**  |

`executed()` — `total − pending − todo` — is now what the floor is compared
against, and a tier that collects tests and runs none of them fails on its own
rule. `resolveFloor()` is exported so the lookup is testable, and every way it
can fail is now exit 2 rather than a warning.

### The QA-005 evidence package

| id         | severity | finding                                                                                                                                                                                                                                      | status   |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `QA005-01` | HIGH     | `clean-room-evidence.md` states the recording commits change "documents only". `git diff 356f1a1e..HEAD` returns five non-document paths. The document's central justification is false, and the only check asserts the SENTENCE is present. | **OPEN** |
| `QA005-02` | HIGH     | The recorded root-unit figures (1762 / 82 files) are stale at HEAD by exactly the test file the closure commit added.                                                                                                                        | **OPEN** |
| `QA005-03` | MEDIUM   | "the recorded head is real" is a describe title; the check is a 40-hex regex. `deadbeef` repeated five times satisfies it.                                                                                                                   | **OPEN** |
| `QA005-04` | MEDIUM   | `SUPERSEDED_HEADS` is a hard-coded list of two, and the same page lists a **third** superseded head it does not contain.                                                                                                                     | **OPEN** |
| `QA005-05` | MEDIUM   | `toContain('65 web test files')` also matches "165 web test files" — the derived count only catches understatement.                                                                                                                          | **OPEN** |
| `QA005-06` | MEDIUM   | The digest is recomputed with the `digest` function imported from the module under test. Truncating it to 16 bytes leaves every case green.                                                                                                  | **OPEN** |
| `QA005-07` | MEDIUM   | Only `.md`/`.json` are digested, case-sensitively, and the docblock's claim that binaries are "listed" is false — there is no listing code.                                                                                                  | **OPEN** |
| `QA005-08` | MEDIUM   | Eight unreferenced evidence documents could be deleted and regenerated: 29 → 21 > 20, every case green.                                                                                                                                      | **OPEN** |
| `QA005-11` | LOW      | `evidence:p1-27` was registered `tier: 'optional'` — not one of the four defined tiers. Any unrecognised string means "not a gate".                                                                                                          | **OPEN** |
| `QA005-12` | LOW      | Directory symlinks are invisible to both walks, including the supposedly independent one.                                                                                                                                                    | **OPEN** |

### The 42-of-42 claim — withdrawn

| id       | severity | finding                                                                                                                                                                                                            | status                      |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `A42-01` | HIGH     | 42 = 33 adjudicated + **9 that no document enumerates**: `FE-005`, `FE-006`, `FE-011`, `FE-012`, `FE-014`, `FE-025`, `FE-027`, `QA-004`, `DO-001`.                                                                 | **RETRACTED**               |
| `A42-02` | HIGH     | `DO-002` — "Structured logging, monitoring **and** alert routing" — is counted as delivered while the document itself concedes alert routing is unattached and `setMonitoringAdapter` has zero production callers. | **RECLASSIFIED as partial** |
| `A42-13` | MEDIUM   | `QA-004` — "Concurrency **and** idempotency" — the concurrency half is contradicted by `P1-27-INT-009` (last-writer-wins).                                                                                         | **RECLASSIFIED as partial** |
| `A42-03` | HIGH     | `DO-002` is "no change needed" in the Summary and "closed by `51b0899`" in ADJ-01, and that commit assigns a fifth verdict class the table does not define.                                                        | **OPEN**                    |
| `A42-04` | HIGH     | ADJ-01 says "the ten unnamed ones are named here" and names thirteen.                                                                                                                                              | **OPEN**                    |
| `A42-05` | MEDIUM   | `setLogAdapter` — corrected at one occurrence, left at the other, and the survivor is inside `DO-002`'s load-bearing sentence.                                                                                     | **OPEN**                    |
| `A42-06` | MEDIUM   | `FE-021` and `FE-022` carry different roots AND different commits in the Summary than in their own sections.                                                                                                       | **OPEN**                    |
| `A42-07` | MEDIUM   | `canonical-plan.md:144` still assigns `FE-003` two operations it does not use, and that stale line is the `decisionRef` for two `DELIBERATELY_ABSENT` classifications.                                             | **OPEN**                    |
| `A42-08` | MEDIUM   | `independent-task-audit.md:14` still says "P1-27 is not at 42/42" with no supersession note.                                                                                                                       | **OPEN**                    |
| `A42-09` | LOW      | Four Summary rows say `FIXED` with no commit, against the table's own vocabulary.                                                                                                                                  | **OPEN**                    |

### The document-reconciliation guards

| id      | severity | finding                                                                                                                                                                | status    |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `A-01`  | HIGH     | The `CLOSURE_BANNERS` block is dead code now that no row is OPEN — `PASS=42` and `FAIL=0` are permitted in all three documents.                                        | **OPEN**  |
| `A-02`  | HIGH     | `OWNER ACCEPTANCE: PASS` is banned nowhere, and in `task-traceability.md` the required `FAIL` string is a past-tense narrative about a superseded event, not a status. | **OPEN**  |
| `A-03`  | HIGH     | The banned spelling is one no P1-27 document uses; five unbanned spellings of the identical claim are already on the page.                                             | **OPEN**  |
| `A-04`  | MEDIUM   | `P1-27 CLOSED GO` — the repository's actual closure vocabulary — is not banned.                                                                                        | **OPEN**  |
| `A-05`  | HIGH     | "the evidence records point at this branch" is a describe title; the only case is `existsSync`.                                                                        | **OPEN**  |
| `B-01`  | MEDIUM   | `expect(fixed && unresolved).toBe(false)` with both regexes `^`-anchored — a case that cannot fail.                                                                    | **OPEN**  |
| `B-05`  | MEDIUM   | The citation check covers 136 of 239 quoted titles; a case count after the filename breaks the match and drops that whole cell.                                        | **OPEN**  |
| `E-01`  | HIGH     | `deliverable-manifest.md` said "**119** migrations … There is no migration 120" while `supabase/migrations` holds 120.                                                 | **FIXED** |
| `E-02`… | MEDIUM   | Eleven further stale counts in `deliverable-manifest.md` (§9.1 line counts 8 of 15 wrong, §5.2/§5.3 row counts, two stale "40"s, `tests/ci` 31 vs 33).                 | **OPEN**  |
| `F-02`  | MEDIUM   | `G-04`'s fix widened the gate to any `console.*` and left the cited test at the five-name list, so `console.table(customer)` passes the cited proof.                   | **OPEN**  |

---

## What survived

Stated because a review that refutes everything is as suspect as one that refutes
nothing, and these were attacked in earnest:

- **`allowedLifecycleTargets` / `allowedWorkshopTargets` are correct on both
  axes.** The reviewer read the server's own `vehicle-lifecycle.ts:275-281` and
  could not construct a UI-allowed / server-rejected pair. The option-removal
  hazard was enumerated specifically and does not occur.
- **`use-server-table.ts`'s render-phase page reset is legal and converges**, and
  cannot leak a stale page: the render that schedules the update is discarded, so
  the effect built from it never runs.
- **`RecordForm`'s checkbox is genuinely uncontrolled** and its docblock is
  accurate.
- **`validate:p1-27-evidence` is genuinely reachable from hosted CI**, traced
  through `verify:policies` → `verify:workspaces` → the unconditional
  `hosted-clean-room` job rather than assumed from the register.
- **The round-four register reconciles exactly** — 27 ids on both sides, one per
  row, no ranges.
- **Every failure message quoted in the operator guide resolves** in `en.json`
  and in `ar.json`.

---

**P1-27 remains `OWNER ACCEPTANCE: FAIL`.** This round found four product defects
and withdrew the phase's headline number; the open rows above are the honest
state of the branch and are not closed by this document.
