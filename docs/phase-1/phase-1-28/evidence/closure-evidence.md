# Phase 1-28 — closing evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

**THIS IS NOT A CLOSURE RECORD.** The phase is **OPEN**. `OWNER ACCEPTANCE` has
not been asked for and has not been returned, and the permanent Frontend rule
from P1-26 onward is that no Frontend phase closes without the Product Owner
testing the running application in real installed Chrome and returning
`OWNER ACCEPTANCE: PASS` verbatim. **Silence is never Pass.** Automated CI is
necessary and is not sufficient. `main` is untouched.

What this document is: the technical evidence an acceptance session rests on,
frozen against one named commit, sealed so it cannot be revised without the
revision showing in the diff, and honest about the three things this phase could
not close and the one decision it was forbidden to pre-empt.

---

## How to read a value on this page

Every figure below carries the head it was taken at and the artefact it came
from. That is not decoration. P1-27 shipped a closing page pinning a head 47
commits behind the tree it described, and it went on reading like evidence
because nothing compared the claim with the repository.

The machine-readable half of this package is
`docs/phase-1/phase-1-28/evidence/closure-candidate.json`. It is not a summary of
this page and this page is not a summary of it: the gate
(`npm run validate:p1-28-evidence`) refuses a disagreement between the two about
the candidate, and refuses either half that fails to name an unclosed task.

---

## The frozen candidate

| Binding           | Value                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `FINAL_CODE_SHA`  | `38afa5c28e5b78d484a442cf6b8596fb2a5c34aa`                                                 |
| `FINAL_CODE_TREE` | `bbae6c90dd51059be7ea949e0b5bca36cf17402d`                                                 |
| Branch            | `feature/p1-28-appointment-vehicle-reception-frontend`                                     |
| Pull request      | **#226** (draft), base `develop`, 96 commits ahead                                         |
| Subject           | `merge: browser-tier determinism — the tier was rate-limited by the product's own limiter` |

**On the two names, before anything else.** `FINAL_CODE_SHA` and
`FINAL_CODE_TREE` are the names this package was commissioned under. They are
**not** the P1-27 spelling — that phase says `CODE_CANDIDATE_SHA` for the same
idea — and no file in this repository used `FINAL_CODE_*` before this one. The
mapping is written down in `closure-candidate.json` rather than left for a reader
to infer, because two names for one commit is exactly how a superseded head gets
quoted as a current one.

### What freezing means, and what it does not

Every figure in this package describes **that commit**. Commits landing after it
are successors, and they are named by their full id rather than glossed:

1. **`1b9811c8f489cd40b24dd1677add0f0dbfecfd7e` — the packaging commit.**
   P1-28-QA-005 itself: this document, the candidate record, the digest manifest,
   the generator and gate (`scripts/ci/build-p1-28-evidence-manifest.mjs`), its
   test (`tests/ci/p1-28-evidence-manifest.test.ts`), the command-register
   entries and the hosted-job wiring.

   **This successor is NOT a documentation-only recording, and does not claim to
   be.** P1-27's rule is that `DOCUMENTATION_ONLY_RECORDING` may be claimed only
   when `git diff --name-only CODE_CANDIDATE_SHA..EVIDENCE_RECORD_SHA` excluding
   `docs/` and `*.md` is exactly zero, and this commit adds executable files. It
   claims the narrower and checkable thing instead:

   ```text
   git diff --name-only 38afa5c28e5b78d484a442cf6b8596fb2a5c34aa..HEAD -- apps supabase
   ```

   returns **nothing** — and that is now **run by the gate**, not offered to the
   reader as an exercise. No file under `apps/**` or `supabase/**` differs
   between the candidate and HEAD, so the product these measurements describe is
   the product at the candidate. A successor that changes either tree fails
   `validate:p1-28-evidence`, and the candidate must be re-frozen and re-measured.

2. **`897209637c43af8db7633d7e8b91a3766b0933cc` — the seal's own correction and
   the docs re-record.** The seal's test was checking each local tier against the
   other tier's head rather than against its own; and the P1-27 local run ledger
   was re-taken, its closing values reconciled and its evidence package resealed.
   `check-p1-27-closing-values.mjs` expires a local run record when any
   executable path has changed since it was taken, and successor (1) is such a
   change. This commit touches `tests/ci/p1-28-evidence-manifest.test.ts`, so it
   is **executable** and is named here rather than filed as documentation.

3. **The repository-binding commit** — the seal bound to `git` (see _The seal is
   now bound to the repository_ below). It is named by id in
   `closure-candidate.json`, recorded by the documentation-only commit that
   follows it.

**The rule, and the single hole it cannot close.** Every commit in
`git log 38afa5c2..HEAD` that touches an executable path — anything outside
`docs/` that is not `*.md` — must appear in `closure-candidate.json` by its full
40-character id, and the gate computes that range and refuses an unnamed one. A
**documentation-only** successor may go unnamed, and the gate **prints** the ones
that did. The reason is arithmetic, not policy: a commit cannot write its own id
into a file it contains, so "the recorded list is exactly `git log`" is not a
rule any repository can satisfy. The hole is therefore exactly one commit wide,
it is always the commit carrying this record, and it is reported rather than
hidden.

Why the candidate is a _code_ candidate rather than a head: recording the result
of a run changes the tree, so a literal exact-head rule is stale the moment it is
satisfied.

---

## The regression statement — what was re-run, and what was not

**Re-run against the candidate, all five tiers:**

| Tier                     | Tests       | Passed | Failed | Skipped | Files   | Provenance                                                             |
| ------------------------ | ----------- | ------ | ------ | ------- | ------- | ---------------------------------------------------------------------- |
| Root unit and foundation | 2475        | 2475   | **0**  | 0       | 97      | local **and** hosted, agreeing                                         |
| Web component and DOM    | 2669        | 2669   | **0**  | 0       | 98      | local **and** hosted, agreeing; independently re-run in the clean room |
| Backend integration      | 2004        | 2004   | **0**  | 0       | 86      | **hosted only**                                                        |
| Database and RLS         | 1647        | 1647   | **0**  | 0       | 139     | **hosted only**                                                        |
| Authenticated browser    | 370 planned | 366    | **0**  | 4       | 7 specs | **hosted only**                                                        |

**Total: 9161 automated cases at the candidate, 0 failures.**

### What was NOT measured locally, stated plainly

The **backend** and **database** tiers were **not run on this workstation**. Both
need a running PostgreSQL with all 120 migrations applied, which this machine
does not host. They are measured **hosted, at the candidate SHA**, and that is the
only measurement claimed for them — the figures above come from
`test-totals-backend.json` (job `94614564122`) and `test-totals-database.json`
(job `94614564002`), not from a local run that did not happen.

The **browser** tier likewise runs only hosted; the figures are read out of the
run's own Playwright report, not inferred.

### Where each figure is checked, and what "checked" means for each kind

| Kind           | Tiers                      | What the gate does with the number                                                                                                                                                 |
| -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **arithmetic** | all five                   | `passed + failed + skipped` must equal the declared total. The review set `passed: 3, failed: 812` beside `tests: 2475` and the first revision of the gate accepted it.            |
| **computed**   | unit, web                  | the figures must equal the P1-27 run ledger's, read out of git at a **pinned commit**, and the tier may carry no figure the ledger does not write                                  |
| **attested**   | backend, database, browser | cannot be computed from this repository at all; the gate requires a run id, a job id, the head the job ran at and the artefact name, and prints them as **attested, not computed** |

### What the local record covers

`docs/phase-1/phase-1-27/evidence/local-run-ledger.json` records the unit and web
tiers at `cae8bdb0dee6352f6182105b36d1dd3b1d7bf896`, an ancestor of the candidate.
The gate reads that ledger **as it stood at `ab5e3c4932a770eb82105dcf81b1ce1085946391`**,
through `git show`, and requires `tests`, `passed`, `failed`, `skipped`, `files`
and the measured head to match this package exactly. It is pinned to a commit
because the ledger **moves**: `--record` rewrites it at whatever head it was last
taken at, so a check against the working copy would go red on the next unrelated
re-record and would then be relaxed rather than fixed.

That **no executable path differs** between `cae8bdb0` and the candidate — the
whole diff is two P1-27 evidence documents — is likewise **computed by the gate**
now. The previous revision of this page asked the reader to "verify with
`git diff --name-only cae8bdb0..38afa5c2`", which is an assertion with a suggested
homework exercise attached.

`suites: 549` and `suites: 651` used to stand beside these figures and have been
**removed**. The run ledger records no suite count, so there was nothing those
numbers could be checked against and nothing that would have noticed them change.

**A reader running the unit suite today will count more than 2475, and that is
not drift.** The successors that package this evidence add QA-005's own gate
test, so the run ledger has since been re-recorded at the packaging head and
reports a larger unit tier over 98 files rather than 97. The figure in the table
above is frozen at the candidate deliberately; the ledger tracks whichever head
it was last taken at. The two are different measurements of different commits,
and the seal's own test checks each against the head it names rather than
against the other — an equality between a frozen figure and a moving one is
exactly the confusion this package exists to prevent.

### What no tier measures

No automated tier in this repository observes the product the way the Product
Owner will. Every mocked tier passed a seam this phase shipped dead — the walk-in
intake building `/reception/check-in`, singular, against a wizard mounted at
`/receptions/check-in`, plural — and the browser tier is what found it. That is
the standing reason `OWNER ACCEPTANCE` is required and CI is not sufficient.

---

## The authenticated browser tier — the numbers actually found

Run **`31750364479`** · job **`94614564003`** · head_sha
**`38afa5c28e5b78d484a442cf6b8596fb2a5c34aa`** · conclusion **success**
(11m 37s).

**Whole tier:** 370 planned · **366 passed** · **0 failed** · 4 skipped · **0
flaky**.

The four skips are two cases each in `authenticated/accessibility.spec.ts` under
`authenticated-en` and `authenticated-ar`. **No P1-28 case is skipped** — which
matters, because a skipped test still counts toward a tier's executed total, and
that is how a "0 uncovered" number gets reported over a case that measured
nothing.

**The P1-28 spec specifically** —
`authenticated/appointments-and-receptions.spec.ts`, read per test entry out of
the run's own `playwright-report.json` and grouped by `projectName`:

| Project                | Viewport | Locale  | Planned | Passed  | Failed | Skipped |
| ---------------------- | -------- | ------- | ------- | ------- | ------ | ------- |
| `authenticated-en`     | 1440×900 | `en-GB` | 47      | **47**  | 0      | 0       |
| `authenticated-ar`     | 1440×900 | `ar-JO` | 47      | **47**  | 0      | 0       |
| `authenticated-tablet` | 1024×768 | `en-GB` | 47      | **47**  | 0      | 0       |
| **Total**              |          |         | **141** | **141** | **0**  | **0**   |

These are **hosted** figures. They are not the local Playwright numbers and are
not a keyword count over the spec file.

**A stale claim this package corrects.** Documents written before the tablet merge
(`88af8acd`, merged as `4c6ccfe7`) state that this tier runs no P1-28 screen at a
tablet viewport, citing `apps/web/playwright.config.ts`. That was true when
written and is **false at this candidate**: the `authenticated-tablet` project's
`testMatch` at `apps/web/playwright.config.ts:255` now names two specs —
`administration` and `appointments-and-receptions` — and the run above executed
47 P1-28 cases in that project. The P1-28 surface is observed at two viewports
and two locales.

---

## Hosted CI at the candidate

Run **`31750364479`** — workflow **PR CI** (`.github/workflows/pr-ci.yml`), event
`pull_request`, attempt 1, head_sha `38afa5c28e5b78d484a442cf6b8596fb2a5c34aa`.

**21 checks · 21 success · 0 failure · 0 pending.** Taken from
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs` — the per-commit endpoint,
because `/actions/runs` does not list every check.

| Check                                                   | Job id        | Conclusion |
| ------------------------------------------------------- | ------------- | ---------- |
| `ci-gate` — **the single required check**               | `94617578352` | success    |
| `CodeQL`                                                | `94614731700` | success    |
| `code-security / code-security (actions)`               | `94614564183` | success    |
| `Web quality / web-quality`                             | `94614564128` | success    |
| `integration-tests / integration-tests`                 | `94614564122` | success    |
| `hosted-clean-room / hosted-clean-room`                 | `94614564119` | success    |
| `code-security / code-security (javascript-typescript)` | `94614564116` | success    |
| `secret-scan / secret-scan`                             | `94614564097` | success    |
| `container-security / container-security`               | `94614564067` | success    |
| `dependency-security / dependency-security`             | `94614564057` | success    |
| `static-quality / static-quality`                       | `94614564036` | success    |
| `authenticated-browser / authenticated-browser`         | `94614564003` | success    |
| `database-security / security-matrix`                   | `94614564002` | success    |
| `database-migration-replay / migration-replay`          | `94614563937` | success    |
| `unit-tests-coverage / unit-coverage`                   | `94614563908` | success    |
| `application-build / build`                             | `94614563886` | success    |
| `change-detection`                                      | `94614500823` | success    |
| `Lint, types, tests, build`                             | `94614499574` | success    |
| `Secret and sensitive-file scan`                        | `94614499549` | success    |
| `Database migrations and RLS tests`                     | `94614499541` | success    |
| `Docker build validation`                               | `94614499502` | success    |

### CodeQL

Two analyses at this exact head, ref `refs/pull/226/head`:

| Analysis     | Language                | Rules | Results |
| ------------ | ----------------------- | ----- | ------- |
| `1616577501` | `javascript-typescript` | 201   | **0**   |
| `1616569830` | `actions`               | 27    | **0**   |

Open alerts repository-wide: **0**.

**What this does not prove.** A CodeQL run on a pull request is
**diff-informed**. Two analyses returned 0 results and the repository carries 0
open alerts on any analysed ref, but a pull-request analysis does not by itself
establish the repository ceiling — only a run on a protected ref does. It is
recorded here as the pull-request result it is.

### Dependency security · job `94614564057`

Production vulnerabilities **0** · development vulnerabilities **0** · critical,
high, moderate and low all **0** across **830** resolved dependencies. Licence
policy clean; no prohibited licence.

### Production build · job `94614563886`

Build **ok**. 239 routes in the manifest against 237 route files on disk; 6249
files emitted; standalone server 37 476 308 bytes, ×1.0905 against the committed
baseline.

### Database · jobs `94614563937` and `94614564119`

120 migrations applied to an empty database; 242 tables, 631 policies, a
1356-cell RLS matrix, **0** `SECURITY DEFINER` functions. The clean room
re-applies them at the exact SHA and re-derives the same matrix independently.

---

## The 35-task matrix

Derived from `docs/phase-1/phase-1-28/canonical-plan.md`, recorded in
`docs/phase-1/phase-1-28/task-matrix.json` and
`docs/phase-1/phase-1-28/task-matrix-verdicts.json`, regenerated by
`npm run matrix:p1-28` and held against drift by `npm run validate:p1-28-matrix`.

**35 tasks · 32 PASS · 3 PARTIAL · 0 FAIL.**

Supporting records, each sealed by the manifest:
`docs/phase-1/phase-1-28/evidence/traceability.json` and
`docs/phase-1/phase-1-28/evidence/traceability.md` (the record against the tree),
`docs/phase-1/phase-1-28/write-reachability.json` (write classification),
`docs/phase-1/phase-1-28/composed-permissions.json`,
`docs/phase-1/phase-1-28/contract-archaeology.md`,
`docs/phase-1/phase-1-28/media-capture-decision-record.md`,
`docs/phase-1/phase-1-28/operator-guide.md`,
`docs/phase-1/phase-1-28/developer-guide.md` and
`docs/phase-1/phase-1-28/evidence/change-log.md`.

---

## The three tasks this phase could NOT close

**Each is blocked on a decision or a contract that belongs to someone else. This
phase may not pre-empt any of them, and did not try.** The gate derives this list
from the verdicts file on every run: a fourth task turning PARTIAL fails
`validate:p1-28-evidence` until this section names it.

### `P1-28-FE-007` — vehicle check-in wizard core · **PARTIAL**

- **Blocker:** `G-EMP` / **R6** — Owner register question A.
- **OWNER: the Product Owner**, with the contract half owned by **P1-18**.
- **What is open:** the receiving-employee **referent**. The wizard writes
  `receiving_employee_id` on every check-in while the column has no foreign key
  and no defined meaning, so the visit records a value whose meaning is
  undecided. That is not an empty catalogue an administrator can fill — it is an
  open question about what the column _means_, aimed by name at a field of this
  row's own form.
- **What is NOT open:** the UUID-on-screen defect this row used to carry is
  **fixed**. Both read-back surfaces resolve the name through `iam.user-detail`
  and render one of four honest outcomes — named, denied, unresolved,
  unavailable — and none prints the identifier. The plan §7 sentence "The UI
  shows names, never UUIDs" is now true.

### `P1-28-FE-012` — exterior damage marking · **PARTIAL**

- **Blocker:** `P1-OD-025` — document and media file policy, an **OPEN Owner
  decision this phase is forbidden to pre-empt** — with `G-MEDIA` / **R8** behind
  it.
- **OWNER: the Product Owner** (the decision) and **P1-15 / P1-18** (the contract
  half). Neither is P1-28's to close.
- **What is open:** the damage-map half. `damage_map` requires a registered
  `documentId` **and** the exact `documentVersionId`, and neither can exist while
  the document-category table is empty, no storage provider is configured and no
  version can be accepted. Because a mark hangs off a map, the wired mark capture
  is unreachable in practice too, and the step says exactly that where the
  control would have been.
- **What is NOT open:** the mark write itself is delivered and unusually well
  proved — the operator's exact coordinates travel unrounded, the mark is
  placeable by keyboard, it clamps at the contract bounds and it refuses a blank
  coordinate by name.

### `P1-28-FE-018` — customer signature capture · **PARTIAL**

- **Blockers:** `P1-OD-025` (**OWNER: the Product Owner**), and the unowned
  signature read-back gap (**OWNER: P1-18, unassigned**).
- **What is open:** the task binds exactly one operation,
  `rec.reception-signature`, and the product calls it **zero** times. The write
  needs a registered document and its exact version, and nothing in this product
  registers a document. The blocker is a document registration, not an empty
  catalogue.
- **What is NOT open:** what ships is honest — the block, the roles and purposes
  a signature would attribute, the hash bound, the visit's active parties, and no
  control that could not work. The **absence** of a submit control is asserted, so
  it cannot creep back.

### The rule applied to all three

A task is graded against **the capability it canonically owns** — its §5 binding
in `canonical-plan.md` — and against nothing else. A row does not stay PARTIAL
merely because a fresh tenant starts empty, provided both halves are evidenced:
its own journey works against a configured tenant, and the unconfigured state is
truthful. Equally, **a row does not close while its own canonical journey is
impossible**, and a capability no canonical P1-28 task binds is not this
register's to withhold a verdict over.

---

## `P1-28-OD-001` — the open decision this package does not pre-empt

**Who administers the intake catalogues, and through which surface · OPEN ·
raised by this phase.** Recorded at `docs/phase-1/phase-1-28/canonical-plan.md`
§7. **OWNER: the Product Owner.**

**What the Owner must decide:** (a) **who** administers the intake catalogues — a
tenant administrator, a head-office role, or the platform operator; and (b)
**through which surface** — a screen inside this product, a separate
administration application, or provisioning performed outside the product
altogether. Nothing here pre-empts either half and no candidate answer is
recommended.

**The consequence today, stated plainly:** seven intake catalogues ship zero rows
and no screen in this product can add one. Two of those tables sit on a
**required** foreign key of an operator path — `appointmentTypeId` on
`apt.appointment-create` and `cancellationReasonId` on `apt.appointment-cancel` —
so **until a catalogue is populated no appointment can be booked and none can be
cancelled**.

**What shipped instead:** the API capability and nothing in `apps/web`. PR #227
registered 21 catalogue-management writes behind `apt.catalogue.manage` /
`rec.catalogue.manage`; **no seed grants either code to any role**, so the
capability is held by nobody until somebody decides who should hold it. All 21
are recorded `DELIBERATELY_ABSENT` against this decision in
`docs/phase-1/phase-1-28/write-reachability.json`, and
`check-p1-28-write-reachability.mjs` resolves that reference against the §7
headings — so the classification cannot be entered with a fabricated decision id.

**On the identifier:** `P1-28-OD-001` is an id in **this phase's own namespace**,
following the `P1-26-OD-###` and `P1-27-OD-###` precedent. It is **not** a
`P1-OD-###` allocation and must not be read as one. If the Owner records this
decision, the number the Owner assigns supersedes it.

---

## The seal, and how to prove it can fail

`docs/phase-1/phase-1-28/evidence/evidence-manifest.json` records a SHA-256 over
the **bytes** of every file in the phase directory, derived by walking the tree
rather than from a hand-written list. Regenerate with `npm run evidence:p1-28`;
check with `npm run validate:p1-28-evidence`.

**What it proves:** an evidence document cannot be edited without the manifest
changing in the same diff. Digests are over bytes, so an encoding change counts
as a change.

**What it does NOT prove:** this is not a tamper-proof seal. Anyone able to edit a
document is able to re-run the generator and commit both. It removes **silent**
revision, not revision.

### The seal is now bound to the repository

**The first revision of this seal never invoked `git`.** `candidateBinding`
tested `FINAL_CODE_SHA` with `/^[0-9a-f]{40}$/` and compared the two halves of
the package with each other; the tier figures were copied into
`closure-candidate.json` and verified against nothing. A final material review
put that to the test and it failed in the two ways it was built to prevent:

- replacing the candidate with `deadbeef…` — forty hex characters naming no
  object in this repository — **in both halves** produced
  `evidence manifest in sync … candidate deadbeef`, exit 0, and 37/37 green tests;
- setting `tiers.unit.passed = 3, failed = 812` while leaving
  `provenance: "LOCAL_AND_HOSTED_AGREE"` also passed.

Well-formedness is not existence, and two documents agreeing is not evidence
about a repository. What the gate now computes, on every invocation:

| Binding                  | How it is established                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| the candidate **exists** | `git cat-file -e 38afa5c2^{commit}`                                                                                                       |
| its **tree**             | `git rev-parse 38afa5c2^{tree}` must equal the recorded `bbae6c90dd51059be7ea949e0b5bca36cf17402d`                                        |
| its **ancestry**         | `git merge-base --is-ancestor 38afa5c2 HEAD`                                                                                              |
| **product identity**     | `git diff --name-only 38afa5c2..HEAD -- apps supabase` must be empty — computed, where the package used to assert it in a sentence        |
| **successors**           | `git log 38afa5c2..HEAD`, every executable commit of which must be named by id; documentation-only ones are printed                       |
| **local tier figures**   | `git show ab5e3c49:…/local-run-ledger.json`, matched field by field, plus no executable drift between the measured head and the candidate |
| **hosted tier figures**  | not computable here, so required to be fetchable: run id, job id, head sha, artefact — and printed as **attested, not computed**          |
| **documented claims**    | anchored sentences measured against the tree, and `PROTECTED_REPROOF` citations resolved into the files they name                         |

### The eight rules, each of which can be made to fail

Every rule fires in exactly one function, `judge`, and the gate drives that
function over a table of **known-bad inputs on every invocation, before it looks
at the tree**. This is not decoration: an adversarial pass once defeated the
P1-27 sibling three ways and it exited 0 each time, because no test named the
reporters and the real tree was sound — so a rule that always returns true and a
rule that works produced identical output.

| Rule             | What it refuses                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| digest **shape** | a digest that is not 64 lower-case hex, or repeats across different files                                                                                                                                                             |
| digest **bytes** | a digest that is not the hash of the file it names — checked by an oracle that **does not call** `digest()`, because verifying a hash with the function that produced it is `f(x) === f(x)`                                           |
| **reachability** | a sealed document no index cites; a cited document that was deleted; an exemption that outlived its file                                                                                                                              |
| **candidate**    | a `FINAL_CODE_SHA` that is not 40 hex characters, or a candidate the prose half of this package does not state                                                                                                                        |
| **blockers**     | an unclosed task this document fails to name, one recorded without a blocker or without an owner, or a closed task still presented as blocked                                                                                         |
| **repository**   | a candidate that names no commit, a recorded tree that commit does not have, a candidate that is not an ancestor of HEAD, a product file changed after the freeze, an unnamed executable successor, a successor id in no commit range |
| **tiers**        | figures that do not add up, a local figure the run ledger contradicts, a local figure the ledger cannot carry at all, a hosted figure with no run id, job id, head or artefact                                                        |
| **claims**       | a sentence the candidate refutes — in a verdict cell, in the CI baseline or on this page — and a `PROTECTED_REPROOF` citation that is missing, out of range, or comment-only                                                          |

#### The self-check was itself the defect, and is rebuilt

The previous self-check handed `judge` an analysis a human had already written
by hand — `{ dangling: ['…'] }` — and asked whether `judge` complained. Fifteen
cases drove the candidate rule that way, and not one of them could have noticed
that **nothing in the file ever computed a candidate verdict from a repository**.

`WORLD_CHECK_CASES` now hands the **analysers** a synthetic world — a `git` that
answers from a table, a candidate document, a verdict register, a
`playwright.config.ts` — and each case passes only if the code derives the
failure itself. It includes the case that must be **accepted**: the same tablet
sentence, against a narrowed config, is true and is allowed.

#### The four falsifications, run against this tree

1. a candidate SHA naming no object → `the candidate … names no commit in this repository`;
2. a recorded tree the commit does not have → `git rev-parse … is <other>`;
3. a successor touching an executable path and not named → `unrecorded executable successor: <sha>`;
4. a fabricated tier figure → `the package records 3; …local-run-ledger.json at ab5e3c49 records 2475`.

`tests/ci/p1-28-evidence-manifest.test.ts` drives each rule against fixtures in a
temporary directory, so the repository is never mutated, and asserts that the
intact fixture is sound **before** each mutation — otherwise the proof would be
two empty sets agreeing.

---

## What closes this phase

Not this document. **`OWNER ACCEPTANCE: PASS`, returned verbatim by the Product
Owner after testing the running application in real installed Chrome.**

Run the acceptance session on `npm run acceptance:serve` — a **production build**,
never `dev:all`. A development stack compiles route bundles lazily and the API's
authenticator is installed as a side effect of composing the IAM module, so an
acceptance session on a dev stack reports product defects that do not exist:
measured twice on this checkout, `GET /api/v1/receptions` answered 200 while
`GET /api/v1/vehicles` and `GET /api/v1/work-orders` answered 401, and a second
`next dev` process refused a completely different subset.

The Owner-acceptance workspace holds **no business rows** — no customers, no
vehicles, no appointment types, no visits. That is deliberate and permanent
policy, not an oversight: several things a reader would expect to see proved are
asserted instead as the honest **blocked state** the screen actually shows. The
configured half is proved separately, in the same browser run, against a
fixture tenant provisioned at run time through the published management contracts
an administrator would use.
