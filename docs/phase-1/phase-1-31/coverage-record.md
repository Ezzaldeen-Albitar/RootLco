# P1-31 — phase coverage record (QA-001)

**Status:** OPEN · **Task:** `P1-31-QA-001`, unit and component test coverage ·
**Companion records:** [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 5 (the
per-suite index this record is the cross-screen artefact for), [`task-matrix.md`](./task-matrix.md)
(the task states), [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — the
disposition for this record is § 60 / CC-50, pre-allocated by the closure plan and appended to the
register at this lane's merge-queue turn, in pull request #385 (CC-50 closed at the fill; CC-50 (a) open for H-2 and H-3)

_(2026-09-16 — **the status line above keeps its words, and the attribution in it is corrected.**
**CC-50 (a) is CLOSED**, determined at change control § 74.2 by reading the row's own content at § 60.5
against the fill: its stated remedy — adding `apps/web/coverage/web/coverage-summary.json` and
`coverage-gate-web.json` to the `evidence-web-quality` upload list — landed with pull request **#389**,
hosted run `34778434228` carried both files, and § 63.10 filled the **H-2 and H-3 figures** from it.
**The coverage holes H-2 and H-3 measure are a different thing and are not closed by that**, and
neither is the later fact that the figures now in § 4 were re-measured **locally** once three feature
roots entered `COVERAGE_INCLUDE`, with no hosted run read for them — that fact is **CC-64 (b)**, open on
its own content. **No figure in this record becomes a hosted measurement on this note**, and nothing in
it is re-measured.)_

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
hosted run**: `.github/ci-baselines/` is untouched.

_The two figures this record first stated as OPEN are now filled from a SECOND hosted run._ Run
**`34778434228`**, job `103781039915` at head **`03ceac0f`**, artefact **`evidence-web-quality`** —
artefact id `10323344410`, 409408 bytes, zip sha256
`2704a25f8a15a347660d0164c196992b8af23b056e42355a013e120417da3b50`, the digest the artefacts API
publishes for it and the digest of the bytes this record was written from — files
`apps/web/coverage/web/coverage-summary.json` (141 per-file entries) and `coverage-gate-web.json`.
That run is the first to carry them, because
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 63.2 added both to the upload
list. **Every commit on this branch after `03ceac0f` changes only files under `docs/`**, so the
executable tree run `34778434228` measured is the executable tree the merge head carries, and no
figure below describes a tree that will not be merged. The figures are in § 4 under H-2 and H-3, and
they fill a measurement — **neither hole is closed by them**.

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
| per-tree instrumented-file counts, and the dashboard route tier's own figure | **FILLED** from `coverage-summary.json` in hosted run `34778434228` (§ 4, H-2 and H-3)                                                                                                                                                                  |

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
needs no run to establish it. The instrumented-file counts per tree are **FILLED**, from hosted run `34778434228` at head `03ceac0f`, artefact `evidence-web-quality` id `10323344410` sha256 `2704a25f…`, file `coverage-summary.json`:

| tree (a `COVERAGE_INCLUDE` root)           | instrumented files | lines covered / total | lines      |
| ------------------------------------------ | ------------------ | --------------------- | ---------- |
| `apps/web/src/features/crm/**`             | 20                 | 398 / 422             | 94.31%     |
| `apps/web/src/features/vehicles/**`        | 23                 | 675 / 695             | 97.12%     |
| `apps/web/src/app/[locale]/(dashboard)/**` | 64                 | 506 / 819             | 61.78%     |
| `apps/web/src/lib/**`                      | 34                 | 449 / 460             | 97.61%     |
| **all four**                               | **141**            | **2028 / 2396**       | **84.64%** |

**The counting rule, stated so the figures can be recomputed.** One instrumented file is one key of
`coverage-summary.json` other than `total`. Each key is an absolute runner path
(`/home/runner/work/RootLco/RootLco/apps/web/src/…`); it is assigned to the first of the four roots
above whose path fragment the key contains. **No key fell outside the four roots** — the four counts
sum to 141, which is the entry count — so nothing in this measurement is unclassified and no file had
to be judged. The per-tree line percentages are recomputed from the summed `covered`/`total` of the
files in each tree, not averaged over files; the "all four" row reproduces the summary's own `total`
block exactly (2028/2396 = 84.64%), which is the cross-check that the partition lost nothing.

**This fills a figure; it does not close the hole.** The three P1-31 feature trees are still absent
from `COVERAGE_INCLUDE`, and the table above is the evidence of it: `features/crm` and
`features/vehicles` are counted because they are instrumented, and `features/delivery`,
`features/warranty` and `features/reports` appear nowhere because they cannot. **H-2 stays open**,
and what closes it is unchanged — the include list, the re-measurement and the baseline movement
below.

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

_2026-09-15 note (QA-001, LOCAL, pending the hosted web-quality run): closed on branch
`feature/p1-31-frontend-closure-completion` over `develop` `c1a2f9fc`. The three roots are now in
`COVERAGE_INCLUDE`. Measured with `npm run test:ci --workspace @rootlco/web` before and after on that
base: 141 → 186 instrumented files; lines 2037/2408 (84.59%) → 3423/3867 (88.51%), statements
82.80% → 86.09%, functions 87.10% → 90.97%, branches 78.89% → 80.23%. Every global floor in
`coverage-baseline.web.json` (82.48 / 81 / 85 / 77.37) still holds and none moved. The trees
measured: `features/delivery` 596/632 lines (94.30%, 25 files; 592/632, 93.67%, when its floor was set), `features/warranty` 405/444 (91.22%,
9 files), `features/reports` 367/383 (95.82%, 11 files), now floored by critical modules at 92.67,
90.22 and 94.82. No deficit against any floor, so no deficit test was needed; `signature-capture.ts`
measured 0/25 lines because every suite mocks it, and that is recorded in the baseline's
`p131CoverageNote`._

_2026-09-15 later note (QA-001, LOCAL, pending the hosted web-quality run): re-measured with the same
command after this branch merged `develop` `c7298c09`, with the phase-2 FE-003 changes in place.
186 instrumented files; lines 3466/3887 (89.16%), statements 3816/4402 (86.68%), functions
1056/1158 (91.19%), branches 3226/3989 (80.87%). `features/delivery` 639/652 lines (98.01%, 25
files), `features/warranty` 405/444 (91.22%), `features/reports` 367/383 (95.82%). The coverage gate
passed against the unchanged baseline, and no floor moved. The `signature-capture.ts` figure above
no longer holds: it now measures 25/25 lines. A describe block in
`apps/web/tests/delivery.dom.test.tsx` imports the real Server Action past its mock, and only the
adapters it calls are mocked._

_2026-09-15 further note (QA-001, LOCAL, pending the hosted web-quality run): re-measured with the
same command after the receiver panel was changed to keep its verification form mounted while a
re-read lands, with two DOM cases added for that path. 186 instrumented files; lines 3469/3890
(89.17%), statements 3819/4406 (86.67%), functions 1058/1159 (91.28%), branches 3241/4005 (80.92%).
`features/delivery` 642/655 lines (98.02%, 25 files), `features/warranty` 405/444 (91.22%),
`features/reports` 367/383 (95.82%). No floor moved. The figures in the note above describe the tree
before that change._

_2026-09-15 head note (QA-001, LOCAL, pending the hosted web-quality run): measured with the same
command at branch head `8646e31c`, after the receiver form gained a status line that states when no
document is chosen and the Arabic limits case was tightened. 186 instrumented files; lines 3469/3890
(89.17%), statements 3819/4406 (86.67%), functions 1058/1159 (91.28%), branches 3243/4007 (80.93%).
`features/delivery` 642/655 lines (98.02%, 25 files), `features/warranty` 405/444 (91.22%, 9
files), `features/reports` 367/383 (95.82%, 11 files). No floor moved. These are the figures of that
head; the notes above describe earlier trees._

### H-3 — the route tier the P1-31 pages sit in is under its own floor, and exempt from it

The line coverage of the ten P1-31 route pages (two delivery, four warranty, three reports, one
audit log), and of the dashboard route tier as a whole, is **FILLED**, from hosted run `34778434228` at head `03ceac0f`, artefact `evidence-web-quality` id `10323344410` sha256 `2704a25f…`, file `coverage-summary.json`:

| route page (under `src/app/[locale]/(dashboard)/`) | lines covered / total | lines      | branches   |
| -------------------------------------------------- | --------------------- | ---------- | ---------- |
| `delivery/page.tsx`                                | 10 / 10               | 100.00%    | 85.71%     |
| `delivery/[deliveryId]/page.tsx`                   | 21 / 23               | 91.30%     | 81.25%     |
| `warranty/page.tsx`                                | 14 / 14               | 100.00%    | 80.00%     |
| `warranty/[warrantyId]/page.tsx`                   | 23 / 23               | 100.00%    | 93.75%     |
| `warranty/policies/page.tsx`                       | 9 / 9                 | 100.00%    | 75.00%     |
| `warranty/policies/[policyId]/page.tsx`            | 19 / 24               | 79.17%     | 56.25%     |
| `reports/page.tsx`                                 | 9 / 9                 | 100.00%    | 75.00%     |
| `reports/overview/page.tsx`                        | 12 / 12               | 100.00%    | 83.33%     |
| `reports/[reportCode]/page.tsx`                    | 22 / 25               | 88.00%     | 75.00%     |
| `administration/audit-log/page.tsx`                | 13 / 13               | 100.00%    | 75.00%     |
| **the ten together**                               | **152 / 162**         | **93.83%** | **77.78%** |

**The dashboard route tier as a whole: 64 instrumented files, 506 / 819 lines = 61.78%**, with
statements 58.58%, functions 49.04% and branches 55.59%. The same tier **excluding these ten pages**
is 54 files and 354 / 657 lines = **53.88%** — so the P1-31 pages are the better-covered part of the
tier they sit in, and the tier's figure is not held up by them.

**The counting rule.** The ten pages are matched by LITERAL path, listed above, and not by a keyword:
each is the single `coverage-summary.json` key whose path after `(dashboard)/` equals the row. All
ten resolved; none is missing from the summary. The aggregate rows sum `covered` and `total` across
the matched files rather than averaging percentages.

**This fills a figure; it does not close the hole**, and the figure does not soften it. The hole is
below: `apps/web/src/app/` is exempt from the touched-file floor, so **none of the ten percentages
above is enforced by anything**, and every one of them could fall to zero without a gate saying so.
**H-3 stays open.**

_Not reconciled: the baseline's own `knownGaps` records this tier at 52.91% across 55 files from
hosted run `34321869051`. That is a different head with nine fewer instrumented files, and run
`34778434228` does not supersede it here — the baseline belongs to the coverage-policy lane and
nothing in `.github/ci-baselines/` is edited by this record._ The structural point does not wait on it, and is the point of this hole.

The hole is that `apps/web/src/app/` is on `touchedFileExemptPrefixes` in the web coverage
baseline, so the 60% touched-file floor does **not** apply to any of these pages. A P1-31 page
could lose its test and the gate would not say so. The exemption is recorded in the baseline as
temporary and is not this record's to remove.

_2026-09-15 note (QA-001, LOCAL, pending the hosted web-quality run): closed on branch
`feature/p1-31-frontend-closure-completion` over `develop` `c1a2f9fc` by the repository's own
mechanism, without widening or narrowing any exemption. Four critical-module rules cover exactly the
route directories that hold the ten pages — `delivery` 34/39 lines (87.18%, 2 files, floor 86.18),
`warranty` 65/70 (92.86%, 4 files, floor 91.86), `reports` 43/46 (93.48%, 3 files, floor 92.48) and
`administration/audit-log` 13/13 (100%, 1 file, floor 99) — so a page that loses its test now turns
the gate red. The ten together measured 155/168 lines (92.26%) in that local run; no page fell below
its enforced figure, so no page test was needed._

### H-4 — the mount point of the start-a-handover panel is not rendered by any suite

`delivery-start.dom.test.tsx` renders `WorkOrderDeliveryPanel` **directly**. The panel's only
mount is `apps/web/src/features/work-orders/components/WorkOrderDetailScreen.tsx`, and no suite in
`apps/web/tests` imports that screen or its route page. So the panel's own behaviour is covered and
the decision that puts it on the work-order record — including that route's permission branch — is
not.

**What closes it:** a case that renders the work-order record route page with the delivery panel
mounted, or moving that decision into a covered module.

_2026-09-15 note (QA-001, LOCAL, pending the hosted web-quality run): closed on branch
`feature/p1-31-frontend-closure-completion` over `develop` `c1a2f9fc` by
`apps/web/tests/work-order-delivery-mount.dom.test.tsx`, four cases that render the work-order
record ROUTE PAGE: the handover panel's own content inside the record for a caller holding the
delivery read, the write authority carried into the mounted panel, the panel absent and unread
without the delivery read, and the route's permission-denied branch reading neither the record nor a
handover. All four passed in the local web tier of 144 files and 4101 tests._

_2026-09-15 later note (QA-001, LOCAL, pending the hosted web-quality run): after this branch merged
`develop` `c7298c09` and added the FE-003 phase-2 cases, the same four passed again in a local web
tier of 144 files and 4122 tests._

_2026-09-15 further note (QA-001, LOCAL, pending the hosted web-quality run): after two FE-003
receiver-panel cases were added, the same four passed again in a local web tier of 144 files and
4124 tests._

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
record exists" item and closes nothing else. Its first hosted figures came from run `34759286884`;
the two that stayed open then — the per-tree instrumented-file counts (H-2) and the dashboard route
tier's own measurement (H-3) — **are now filled from run `34778434228`**, the first run whose
`evidence-web-quality` artefact carries `apps/web/coverage/web/coverage-summary.json`. **Every
figure in this record is now hosted, and none is derived locally.**

_(2026-09-16, correction — the sentence immediately above is FALSE at this head and is retained
with its words rather than rewritten. It was written of the fill in § 4, and of that fill it was
true: H-2 and H-3 were filled from hosted run `34778434228` and from no other. It was **not** true
of the record as a whole even when it was written, and it is not true now. **This record carries
four figures that are LOCAL and label themselves so** — the four dated notes of 2026-09-15 under
H-2, at `:175`, `:187`, `:197` and `:205`, each headed `LOCAL, pending the hosted web-quality run`,
which is where the 186-instrumented-file position and every percentage beside it come from. The
same reading is recorded at [`acceptance-record.md`](./acceptance-record.md) § 11.11 (c), at
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) **QA-C1** and
limitation **L-2**, and at [`closure-record.md`](./closure-record.md) § 2.12. **What is true at
this head:** the figures filled from run `34778434228` are hosted and are attributed to it; the
figures measured after the three feature roots entered `COVERAGE_INCLUDE` are local and are
labelled local; **no local figure is converted into a hosted one by this note**, and the hosted
`web-quality` job having run and concluded `success` does not make a locally measured figure a
hosted measurement.)_

**Filling them changed no verdict in the table above.** H-2 and H-3 were never holes about missing
numbers; they are holes about what is instrumented and what is enforced, and the numbers make both
sharper rather than smaller. 141 files are instrumented and not one of them is under
`features/delivery`, `features/warranty` or `features/reports`. The ten P1-31 route pages average
93.83% line coverage and **no floor governs any of it**, because `apps/web/src/app/` is exempt from
the touched-file rule. **H-2 and H-3 both stay OPEN**, on the terms each states.

**The remedy landed, and the fill is above.**
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) **§ 63 (CC-53)**, pull request
**#389**, added `apps/web/coverage/web/coverage-summary.json` and `coverage-gate-web.json` to the
`evidence-web-quality` upload list, and hosted run `34778434228` of that pull request is the first
run to carry them. H-2 and H-3 are filled from that artefact and **from no earlier run**: neither
`34759286884` nor `34321869051` carries the file, whatever their numbers look like. **CC-50 (a) and
CC-53 are closed by this fill**, and the register records both closures in place.
