# P1-31 — phase coverage record (QA-001)

**Status:** OPEN · **Task:** `P1-31-QA-001`, unit and component test coverage ·
**Companion records:** [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 5 (the
per-suite index this record is the cross-screen artefact for), [`task-matrix.md`](./task-matrix.md)
(the task states), [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — the
disposition for this record is § 60 / CC-50, pre-allocated by the closure plan and appended to the
register at this lane's merge-queue turn, in pull request #385 (CC-50 closed at the fill; CC-50 (a) open for H-2 and H-3)

**Measured at:** branch `feature/p1-31-refused-download-and-coverage`, at its merge of protected
`develop` **`af924cab`**, on 2026-09-13 — the head carrying pull request #384. Every figure in this
record was RE-DERIVED on that merged tree at this lane's queue turn, not carried over from the
draft's earlier base `d517a5fc`; every one of the twelve per-suite counts in § 3 held, and the
declaration total held at 407. Every figure below was read on that tree out of a committed artefact —
the test files themselves, `apps/web/vitest.config.ts`, the API route sources, or
`.github/ci-baselines/coverage-baseline.web.json`. Everything that needed a coverage or tier run is
now quoted from ONE hosted run and from nothing else: **run `34759286884`** (workflow `PR CI`, job
`Web quality / web-quality`) at head **`1a167c19`**, artefact **`evidence-web-quality`** — artefact
id `10318272841`, 477000 bytes, zip sha256
`616a4318a957ea5ee4d47d3a968cc8bdf3b17203b3cb29824fd820359e92055e`, the digest the artefacts API
publishes for it — files `coverage-web.md`, `test-totals-web.json` and `apps/web/vitest-web.json`.
No local measurement is quoted anywhere in this record, and **no baseline is re-recorded from the
hosted run**: `.github/ci-baselines/` is untouched. Two figures stay **OPEN** because no hosted job
uploads what they would need — they are stated as open in § 4 (H-2, H-3) and are quoted from
nowhere.

QA-001 stood at `phase-level incomplete` for one stated reason: **no phase-level coverage record
existed.** § 5 of the assurance index counted the suites; nothing said, across the whole phase,
which surface is covered, which is not, and why. This file is that statement.

## 1. What this record is, and what it is not

- It states **component and unit** coverage. It makes no end-to-end claim. Rule 2 of the task
  matrix governs: nothing reaches `end-to-end verified` on documentary evidence, and this record
  is documentary evidence.
- **Every DOM suite in this repository mocks the feature's adapter.** A green component suite
  proves how the screen behaves given an adapter outcome. It does not prove the adapter produced
  that outcome, that the API answered it, or that the transport carried it. This project has
  already shipped a frontend defect while every DOM tier was green, and that history is why the
  sentence is repeated here rather than assumed.
- It measures the phase's own surfaces. It is not a report on the web tier as a whole.

## 2. How each figure was taken

| figure                                                                       | method                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| declared cases per suite                                                     | the same `it`/`test` declaration regex `tests/ci/web-test-floor.test.ts` uses, applied to the real files. It counts `it.each` as ONE declaration, so every count below is a **lower bound** on what is executed                                         |
| which screen a suite covers                                                  | the `await import(...)` specifiers at the head of each suite, read on this tree — so a suite is credited with the screen it actually renders and not with the one its filename suggests                                                                 |
| what the instrument covers                                                   | `COVERAGE_INCLUDE` in `apps/web/vitest.config.ts` and the floors in `.github/ci-baselines/coverage-baseline.web.json`, both committed and both read on this tree                                                                                        |
| test files in the tier                                                       | counted on this tree                                                                                                                                                                                                                                    |
| executed tier totals and coverage percentages                                | read out of the hosted artefact named above — `coverage-web.md` for the four percentages, their deltas and the gate verdict; `test-totals-web.json`, cross-checked against `apps/web/vitest-web.json`, for the executed counts and the file count (§ 5) |
| per-tree instrumented-file counts, and the dashboard route tier's own figure | **OPEN — no hosted artefact carries what they need** (§ 4, H-2 and H-3)                                                                                                                                                                                 |

## 3. Surfaces WITH component coverage

Nine route surfaces. Each row's suite renders the route page or the screen named, on this tree.

| surface (task)                                           | route                                        | suite (`apps/web/tests/`)                                          | declared | renders the route page                                                    |
| -------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| ready-for-delivery queue (FE-001)                        | `/{locale}/delivery`                         | `delivery.dom.test.tsx`                                            | 80       | yes                                                                       |
| handover record (FE-002 … FE-006)                        | `/{locale}/delivery/{deliveryId}`            | `delivery.dom.test.tsx`, `delivery-signature-refusal.dom.test.tsx` | 80 + 11  | `delivery.dom` yes; the refusal suite imports `DeliveryDetailScreen` only |
| printable handover sheet (FE-007)                        | same route, a panel of it                    | `delivery-document.dom.test.tsx`                                   | 14       | yes                                                                       |
| start-a-handover panel (FE-002, Start)                   | mounted on the work-order record screen      | `delivery-start.dom.test.tsx`                                      | 20       | **no — see § 4, H-4**                                                     |
| warranty list and record (FE-008, FE-009)                | `/{locale}/warranty`, `/{warrantyId}`        | `warranty.dom.test.tsx`                                            | 42       | yes                                                                       |
| warranty plan administration (FE-008)                    | `/{locale}/warranty/policies`, `/{policyId}` | `warranty-policies.dom.test.tsx`                                   | 27       | yes                                                                       |
| report catalogue and report screen (FE-011 … FE-014)     | `/{locale}/reports`, `/{reportCode}`         | `reports.dom.test.tsx`                                             | 46       | yes                                                                       |
| operational overview and branch summary (FE-010, FE-016) | `/{locale}/reports/overview`                 | `reports-overview.dom.test.tsx`                                    | 28       | yes                                                                       |
| audit log (FE-015)                                       | `/{locale}/administration/audit-log`         | `audit-log.dom.test.tsx`                                           | 20       | yes                                                                       |

Three adapter suites carry the contract mirrors behind those screens, with no DOM of their own:
`delivery-api.test.ts` (48), `warranty-api.test.ts` (45), `reports-api.test.ts` (26).

**Total declared on this surface: 407 across twelve files** — the nine DOM suites above,
`80 + 11 + 14 + 20 + 42 + 27 + 46 + 28 + 20 = 288` (`delivery.dom` serves two rows of the table and
is counted once), plus the three adapter suites, `48 + 45 + 26 = 119`. Six of the twelve use
`it.each` (`delivery.dom` 3, `delivery-api` 4, `reports-api` 3, `reports-overview` 1, `reports.dom`
2, `audit-log` 1), so the executed total is higher.

**Reconciled against the assurance index, re-derived at this head.** § 5 of
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) publishes **396 across eleven
files**, measured at `develop` `81b3bce8`. The two figures agree exactly: the index's eleven files
are this record's twelve less `delivery-signature-refusal.dom.test.tsx`, and `396 + 11 = 407`. Every
one of the eleven shared counts matches this record's, file by file, so nothing is reconciled away
and neither figure supersedes the other — they are the same measurement over two file sets.

**One disagreement is OBSERVED and is NOT corrected here.** § 5's prose says "seven files use
`it.each`" while § 5's own table beside it shows **six** rows with a non-zero `it.each` column, and
six is what the regex returns over those same eleven files on this tree. The number is a floor
qualifier, so neither reading changes the 396; the index is another slice's record and moving a
figure in it is that slice's act, not this one's. Recorded as an observation in § 60.6 of
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md), under no identifier of its own,
rather than edited.

## 4. Holes — surfaces with NO component coverage, and why

### H-1 — checklist-template administration has no screen (FE-004's remaining half)

**This is a hole, not a pass.** The delivery-checklist template family publishes **eight**
operations, measured by reading the `defineOperation` ids under `apps/api/src/app/api/v1`:

- `sal.delivery-checklist-template-list` and `-read` — **consumed**, by
  `readActiveChecklistItems()` in `apps/web/src/features/delivery/api.ts`, which the handover
  record screen calls to learn which items a completion must answer;
- `-create`, `-rename`, `-status-set`, `-item-create`, `-item-update`, `-item-remove` — **six
  writes with no adapter, no screen and therefore no component test.**

**Why it is open:** there is nothing to render. A component test cannot be written for a surface
that does not exist, and writing one against a screen this phase has not built would be a test of
an intention. The write-shape gate already records the same fact from the other side: five of its
nine pending mirror entries are `sal.delivery-checklist-template-*` writes carrying the reason
"P1-31 FE-004 owes the mirror, on the frontend lane".

**What closes it:** the template administration screen, with its own DOM suite. Until then FE-004's
`Next dependency` column — "template administration UI remains unfinished" — is the accurate
statement, and no coverage claim may be made for it.

### H-2 — no P1-31 feature code is inside the coverage instrument at all

**Measured:** `COVERAGE_INCLUDE` in `apps/web/vitest.config.ts` is four roots —
`src/features/crm/**`, `src/features/vehicles/**`, `src/app/\[locale\]/\(dashboard\)/**` and
`src/lib/**`. No P1-31 feature tree is on that list, and the config is the whole of the
instrument's input, so **no file under `apps/web/src/features/delivery`, `features/warranty` or
`features/reports` can be instrumented at all.** That follows from the committed config alone and
needs no run to establish it. The instrumented-file counts per tree are **OPEN — no hosted job uploads the per-file web coverage summary (`apps/web/coverage/web/coverage-summary.json`) or `coverage-gate-web.json`; remedy: add both to the `evidence-web-quality` upload list at `_reusable-node-quality.yml:864-886` (CI-automation lane); until then this figure is measurable only locally and is not cited**.

So **no line, branch or function coverage figure exists for any P1-31 feature code**, and no
critical-module floor governs any of it: the eight rules in `coverage-baseline.web.json` name CRM,
vehicles, the API client, permissions, the CSP, forms, duplicate scoring and the customer
directory, and none of them name a P1-31 tree.

**Why it is open here rather than fixed here:** the include list is a pinned artefact. Widening it
is a coverage-policy change with a measured consequence — three feature trees join the denominator
carrying whatever they carry — and the baseline's own `denominatorTrapNote` records that class of
movement as a known trap. That is a decision for the lane that owns the coverage policy, not a
side effect of a QA record. **Recorded, not fixed.**

**What closes it:** adding the three feature roots to `COVERAGE_INCLUDE` together with the
re-measurement and the baseline movement that must accompany them, in a commit that says so.

### H-3 — the route tier the P1-31 pages sit in is under its own floor, and exempt from it

The line coverage of the ten P1-31 route pages (two delivery, four warranty, three reports, one
audit log), and of the dashboard route tier as a whole, is **OPEN — no hosted job uploads the per-file web coverage summary (`apps/web/coverage/web/coverage-summary.json`) or `coverage-gate-web.json`; remedy: add both to the `evidence-web-quality` upload list at `_reusable-node-quality.yml:864-886` (CI-automation lane); until then this figure is measurable only locally and is not cited**. The structural point does not wait on it, and is the point of this hole.

The hole is that `apps/web/src/app/` is on `touchedFileExemptPrefixes` in the web coverage
baseline, so the 60% touched-file floor does **not** apply to any of these pages. A P1-31 page
could lose its test and the gate would not say so. The exemption is recorded in the baseline as
temporary and is not this record's to remove.

### H-4 — the mount point of the start-a-handover panel is not rendered by any suite

`delivery-start.dom.test.tsx` renders `WorkOrderDeliveryPanel` **directly**. The panel's only
mount is `apps/web/src/features/work-orders/components/WorkOrderDetailScreen.tsx`, and no suite in
`apps/web/tests` imports that screen or its route page. So the panel's own behaviour is covered and
the decision that puts it on the work-order record — including that route's permission branch — is
not.

**What closes it:** a case that renders the work-order record route page with the delivery panel
mounted, or moving that decision into a covered module.

### H-5 — what the suites deliberately do not assert

- **Warranty history (FE-009).** The record screen states that the transition record is unreadable
  rather than drawing an empty history. There is no transition-history read to cover, so the
  coverage here is of the statement, not of a history.
- **Export (SEC-002).** There is no export path on any P1-31 screen — `rpt.export` is withheld by
  Owner decision D-6 and recorded as CC-04 — so there is no export control to test, and no suite
  claims one.
- **Signature-document download (SEC-002, file-access half).** No adapter in `apps/web/src` calls
  `shared.attachment-download-authorize`, and the signatures panel dereferences nothing by design.
  `delivery-signature-refusal.dom.test.tsx` covers the refusal the screen CAN meet — the read that
  publishes the document reference answering `403` — and asserts that no download affordance
  exists. It does not cover a download, because there is none to cover. Its mock boundary is the
  seven-module set from `delivery-document.dom.test.tsx`, not the `delivery.dom.test.tsx` set,
  because it renders the record screen and opens the printable sheet; and it carries an ok-read
  control case, so its "the reference is not in the DOM" assertions are made where the reference
  was in the adapter's answer.

## 5. The coverage gate, its wiring, and the hosted measurement

**Both of the tooling warnings below were checked on this tree, and both hold.**

**`scripts/ci/coverage-gate.mjs` is referenced by no npm script.** Measured: no entry in the root
or workspace `scripts` blocks names it. It is invoked only from the hosted node-quality workflow.
**Consequence, stated plainly: a green `verify:workspaces` is not evidence that the declared
coverage floors hold, and no run of it is cited here as though it were.** The gate therefore has to
be driven by hand, with this spelling:

```
npm run test --workspace @rootlco/web -- --coverage --coverage.reporter=json-summary \
  --coverage.reporter=text-summary --coverage.reportsDirectory=coverage/web
node scripts/ci/coverage-gate.mjs --summary apps/web/coverage/web/coverage-summary.json \
  --baseline .github/ci-baselines/coverage-baseline.web.json --changed <changed files>
```

The workspace-direct spelling is deliberate: the baseline's `ciWiringTrap` records that
`npm run test:web -- --coverage` loses the separator at the second npm layer and runs a plain
`vitest run` that emits no report while exiting 0.

**Tier size:** 142 test files under `apps/web/tests`, counted on this tree — the same figure the
P1-27 deliverable manifest carries for this branch, and the same figure the hosted run reports
(`files: 142` in `test-totals-web.json`, 142 file entries in `apps/web/vitest-web.json`).

**The executed tier, from the hosted run.** `test-totals-web.json`: **4020 cases collected, 4020
executed, 4020 passed, 0 failed, 0 skipped, 0 todo**, across **142 files** and **952 `describe`
blocks**. `apps/web/vitest-web.json` reports the same figures independently, so the summary is not
the only witness to them.

**Gate verdict: `coverage-web.md` records `Coverage gate: pass`.** That is the hosted gate's own
verdict on that run, transcribed — not a local observation, and not this record's inference. All
eight critical-module rows in that file stand above their floors, on line coverage:
`crm-customer-surface` 94.31% over 92% (20 files), `vehicle-surface` 97.12% over 91% (23),
`api-client` 98.51% over 92% (6), `client-permissions` 100% over 95% (1),
`content-security-policy` 100% over 95% (1), `form-results-and-field-errors` 95.24% over 90% (2),
`duplicate-scoring` 95.65% over 90% (2), `customer-directory` 96.55% over 90% (4). The same file
states the ratchet's terms: **tolerance 0.5 pp, touched-file floor 60%**.

The floors are committed (`.github/ci-baselines/coverage-baseline.web.json`); the measured column
and the delta are `coverage-web.md`'s own four rows from hosted run `34759286884`, transcribed and
not recomputed here:

| metric     | baseline | measured (hosted run `34759286884`) | Δ        |
| ---------- | -------- | ----------------------------------- | -------- |
| lines      | 82.48%   | 84.64%                              | +2.16 pp |
| statements | 81%      | 82.88%                              | +1.88 pp |
| functions  | 85%      | 87.21%                              | +2.21 pp |
| branches   | 77.37%   | 79%                                 | +1.63 pp |

Nothing in `.github/ci-baselines/` was edited by the branch that carries this record. **These four
figures are a measurement of this head and are NOT a new baseline**; a baseline moves on the
coverage-policy lane's own act. The local run taken at this lane's queue turn, which existed only
to see the gate execute, is quoted nowhere in this file.

**The property this record said to check when the run was taken — checked.** `lines` and
`statements` do NOT report the same figure: 84.64% against 82.88%. So the report came from vitest
4's AST-aware remapping and not from the vitest-3 v8 range mapping, whose signature across every
tier in this repository was a byte-identical `lines === statements`. `coverage.all` no
longer exists in vitest 4 — the guarantee moved to `coverage.include`, which is why H-2 is a
coverage hole rather than a reporting detail: a tree outside that list is not added at zero, it is
not counted at all.

For reference, the baseline's own `knownGaps` records the dashboard route tier at 52.91% across 55
files from hosted run 34321869051. That hosted figure remains the authority, and this record
reconciles nothing against it — H-3 could not be re-measured at this head, for the reason H-3 now
states.

**An inconsistency in that baseline is OBSERVED here and deliberately NOT corrected.**
`.github/ci-baselines/coverage-baseline.web.json:5` (`establishedBy`) cites "hosted run id
34321869051, job `Web quality / web-quality`, artifact `evidence-web-quality`, file
`apps/web/coverage/web/coverage-summary.json`" — but the `evidence-web-quality` artefact does not
carry that file, and the upload list at
`.github/workflows/_reusable-node-quality.yml:864-886` shows it never did: that list names
`coverage/unit/coverage-summary.json`, `apps/web/vitest-web.json`, `test-totals-web.json` and the
markdown files, and no per-file web summary. Read directly on run `34759286884`'s artefact:
fourteen files, and neither the web summary nor `coverage-gate-web.json` among them. The
131-instrumented-file figure in that same field therefore has no published artefact behind it that
this record could re-read, which is the same gap H-2 and H-3 are open on. The baseline belongs to
the coverage-policy lane and a figure in it moves by that lane's measurement, so this is recorded
as an observation under no identifier of its own and **nothing in `.github/ci-baselines/` is
edited**.

_The upload list is repaired by `change-control-2026-09-08.md` § 63.2, and § 63.3 records why
`establishedBy` is still not edited: the field is machine-read — `scripts/ci/coverage-gate.mjs:92`
reads its truthiness and `:350` writes it — so the citation is made true by making the artefact carry
the file, not by rewording the field. The range quoted above, `864-886`, is the range on `develop`
`72f3a71e`; § 63.2 moves the same list to `882-905`._

## 6. Summary

| statement                                                                   | verdict                                 |
| --------------------------------------------------------------------------- | --------------------------------------- |
| every P1-31 route surface that EXISTS has a component suite that renders it | **yes**, nine of nine (§ 3)             |
| every P1-31 canonical Frontend task has component coverage                  | **no** — FE-004's template half (H-1)   |
| a coverage FIGURE exists for P1-31 feature code                             | **no** — outside the instrument (H-2)   |
| the declared coverage floors are enforced by a command a developer runs     | **no** — the gate is in no script (§ 5) |
| the component suites prove the screens work end to end                      | **no** — the adapter is mocked (§ 1)    |

QA-001 therefore stays `phase-level incomplete`. This record closes the "no phase-level coverage
record exists" item and closes nothing else. Its hosted figures are now filled from run
`34759286884`; **two figures stay open** — the per-tree instrumented-file counts (H-2) and the
dashboard route tier's own measurement (H-3) — and they stay open until the `evidence-web-quality`
upload list carries the per-file web coverage summary.

**The remedy is in flight, and it is not a figure.**
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) **§ 63 (CC-53)**, pull request
**#389**, adds
`apps/web/coverage/web/coverage-summary.json` and `coverage-gate-web.json` to that upload list, so a
hosted run of the web-quality job keeps the per-file measurement it already takes. **No number in
this record moves on that change**, and H-2 and H-3 stay open here. They are filled by a second
slice, from the artefact a hosted run of § 63 produces, under the rule § 63.6 states: the run id,
the head sha, the artefact id and the published digest are named beside every figure, and **never an
older run** — neither `34759286884` nor `34321869051` carries the file, so neither can fill these two
however good its numbers look.
