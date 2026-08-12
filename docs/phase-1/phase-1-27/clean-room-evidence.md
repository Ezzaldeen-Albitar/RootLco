<!-- seal: narrative masthead -->

# Phase 1-27 — clean-room evidence

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act against the running application; it is not derivable from any count in this repository and cannot be inferred from silence.

**Classification:** Confidential — Commercial Product and Pilot Planning

A clean room answers one question: **does this exact tree verify from nothing?**
Not "does it verify on the machine that built it", where a stale `node_modules`,
a warm cache or a file that was never committed can all carry the result.

## How to read a value on this page

Every value on this page and on `ci-evidence.md` is classified, and the
classification says who decides it. The register is
[`evidence/closing-value-ledger.json`](evidence/closing-value-ledger.json) and
the gate is `npm run validate:p1-27-closing-values`.

| class                      | who decides it                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `DERIVABLE_LOCAL`          | a command in this repository; the gate runs it and refuses a disagreement                                   |
| `DERIVABLE_GIT`            | the git object database — a ref, a tree, a diff                                                             |
| `HOSTED_ARTIFACT_ATTESTED` | a GitHub-hosted run. No local command re-derives it; the record must name a run, a job or artefact, and the head |
| `PROTECTED_POST_MERGE_ONLY` | a push to a protected branch. It does not exist yet, so it carries no figure                               |
| `HISTORICAL_SUPERSEDED`    | a head this record no longer describes. Kept, banner-marked, excluded from the current seal                 |
| `NON_NORMATIVE_EXAMPLE`    | an illustration. Excluded for the same reason                                                               |

The two pages are tiled edge to edge by seal regions and the gate refuses a gap,
so a value cannot be added to either page without being classified. A region
marked `narrative` is a positive claim that it holds no values at all.

**Why a document is never compared to another document.** A stale executed total
sat in this file for a whole wave while the tree ran a suite of a different size,
and two gates were watching it: both compared this page to
`.github/ci-baselines/test-count-baseline.json` and neither compared either to
the repository. The record and the baseline agreed with each other while both
disagreed with the tree. Executed totals are therefore bound to
[`evidence/local-run-ledger.json`](evidence/local-run-ledger.json), which is
written only by the recording command, from the JSON a `vitest` run emits, and
which expires the moment an executable path changes.

<!-- seal: end masthead -->
<!-- seal: historical superseded-record -->

> **SUPERSEDED** — everything from here to the end of "What was measured"
> describes head `356f1a1e937e819b9db94f40a2d6f04f98f9ae39`. It is history. It is
> excluded from the current seal and must not be quoted as this phase's
> clean-room result.

## SUPERSEDED — this record awaits the final candidate

**Everything under "What was measured" describes head
`356f1a1e937e819b9db94f40a2d6f04f98f9ae39` and is no longer current.** It is kept
rather than deleted, and it must not be quoted as this phase's clean-room result.

### The claim that was false, and why it is not simply re-pointed

This section previously read:

> | `EVIDENCE_RECORD_SHA` | the commit carrying this file — a descendant,
> **documents only** |
>
> The distinction is only harmless because of the second half: the recording
> commits change documents and nothing else, so every code-derived number below
> is identical at both heads.

`git diff --name-only 356f1a1e..HEAD` returned **five non-document paths**. The
justification was false when it was written, and the only check on it asserted
that the _sentence was present_ — a docblock stating a rule the code does not
implement, which is this phase's named dominant defect class, appearing in the
document that records the phase.

Re-pointing `CODE_CANDIDATE_SHA` at a newer head would repeat the mistake in a
fresher form. The rule is stated as a derivation instead:

```text
CODE_CANDIDATE_SHA     the newest commit touching any non-document path
EVIDENCE_RECORD_SHA    the commit carrying this file
EXECUTABLE_DIFF_COUNT  git diff --name-only CODE_CANDIDATE_SHA..EVIDENCE_RECORD_SHA
                       excluding docs/ and *.md
```

`DOCUMENTATION_ONLY_RECORDING` may be claimed **only** when
`EXECUTABLE_DIFF_COUNT` is exactly zero. It is not a phrase to be written on a
page; it is a number produced by that command.

### Why there is no current measurement

The branch is still receiving code. Round five refuted the previous candidate —
three product defects, a form-reset inventory that could not see the files
containing them, and a web test-count floor satisfied by a suite in which nothing
executed — so the head described below is not a candidate for anything.

A clean room recorded against a moving branch is stale on arrival, which is the
defect `P1-27-QA-005` was raised about. The measurement is taken ONCE, against
the true final candidate, and **`QA-005` is OPEN until that candidate exists.**

## What was measured

A fresh `git clone`, checked out at the exact SHA, `npm ci` from the lockfile,
then every tier run in that copy.

| property                          | value                                              |
| --------------------------------- | -------------------------------------------------- |
| Clean-room path                   | `C:\cr27f`                                          |
| Tree hash vs the source checkout  | **identical**, verified by `rev-parse HEAD^{tree}`  |
| Working tree                      | 0 dirty files                                       |
| `npm ci`                          | exit 0                                              |
| `format:check` root / web / api   | clean                                               |
| `typecheck` root / web / api      | 0 errors                                            |
| `lint` root / web                 | 0 errors                                            |
| `build:web`, `build:api`          | compiled                                            |
| Web tier                          | **1216** tests, 0 failed, across 65 web test files  |
| Root unit tier                    | **1762** tests, 0 failed, across 82 files           |
| `verify:policies`                 | pass                                                |
| `verify:contracts`                | pass                                                |
| `verify:inventories`              | pass                                                |
| `verify:classifications`          | pass                                                |
| `validate:*` exceptions           | two, named below, both properties of the room       |

The web figure above was 65 files at that head. The count reconciled against the
LIVE tree is stated in `## Current tree` below; it moves as the branch does,
which is why a superseded block must never be the thing a test reads.

Every web test file must be matched by a
`vitest` project. That last clause is a separate assertion for a reason — the
`logic` project includes `tests/**/*.test.ts` and `dom` includes
`tests/**/*.dom.test.{ts,tsx}`, so a plain `*.test.tsx` matches neither and would
sit in the tree looking like coverage while running nowhere.

<!-- seal: end superseded-record -->
<!-- seal: current tree-derived -->

## Current tree

The live web suite holds **70 web test files**, every one matched by a `vitest`
project, and the current tree executes **1867** tests. Both are derived on every
run of `npm run validate:p1-27-closing-values` rather than recorded by hand.

That executed figure is the one a test reads. It used to read the `Web tier` row
of the superseded table above — the block whose own preamble says a superseded
block must never be the thing a test reads. It said it, and the check did it
anyway, so raising the committed floor for the remediation broke a case that was
comparing a live baseline against a record of a head the branch had left behind.
The superseded figures are left exactly as they were, because they are a true
account of that head; what moved is which number the check consults.

**The 1867 is local, and it is the binding measurement.** It is the output of
`node scripts/ci/check-p1-27-closing-values.mjs --record web` against this tree,
recorded in `evidence/local-run-ledger.json` with the commit it was taken at. A
hosted run at a superseded head agreed with it, and that agreement is recorded
below as history rather than as the authority — a hosted number describing a
different tree is not evidence about this one.

### `DERIVABLE_LOCAL` — a command in this repository answers it

| measure                                    | value | the command that decides it                                       |
| ------------------------------------------ | ----- | ------------------------------------------------------------------ |
| Web test files under `apps/web/tests`       | 70    | a walk of the tree                                                 |
| Web tier — tests executed                   | 1867  | `--record web`, from the `vitest` JSON report                      |
| Web tier — files the run reported           | 70    | the same report, cross-checked against the walk above              |
| Root unit tier — tests executed             | 2149  | `--record unit`, from the `vitest` JSON report                     |
| Root unit tier — files the run reported     | 91    | the same report, cross-checked against the tier's include rule      |
| Committed web floor (`minTests`)            | 1793  | `.github/ci-baselines/test-count-baseline.json`                    |
| Committed unit floor (`minTests`)           | 1050  | the same baseline                                                  |
| Migrations on disk                          | 120   | a walk of `supabase/migrations`                                    |

The floor and the measurement are different questions and they have different
authorities. The baseline file defines the FLOOR, so binding "the floor is 1793"
to it is a definition. It does not define the MEASUREMENT, and the wave in which
it was allowed to is the wave in which this page carried a total far below what
the tree was running.

### `DERIVABLE_GIT` — the object database answers it

| measure                                             | value                                      |
| --------------------------------------------------- | ------------------------------------------- |
| Tracked files under `docs/phase-1/phase-1-27`        | 40                                          |
| Tracked `.md` files under the same directory         | 30                                          |
| Migrations tracked by git at `HEAD`                  | 120                                         |
| The CODE candidate this branch descends from         | `bbcffa08851d919d5705dd2810bd4c614e83f826`  |

The migration count appears twice on purpose. The first is a walk of the
filesystem and the second is `git ls-tree` at `HEAD`; a disagreement between them
is an untracked migration, which is a thing that can happen and which neither
answer detects alone.

### `HOSTED_ARTIFACT_ATTESTED` — pending, and collected externally

No hosted run has been taken against this tree, so this page states no current
hosted value. The fields below are declared with no figure. Each is collected
from the GitHub API during exact-head CI, by a reader of the run rather than by
any command in this repository, and recorded in the ledger with its run id, its
job id and the head it describes. A local validator cannot reproduce them and
this record does not pretend that it can; what the gate proves about them is that
nothing claims hosted provenance without naming a run, and nothing claims local
provenance for a hosted fact.

| field awaiting collection             | where it comes from                                     |
| ------------------------------------- | -------------------------------------------------------- |
| `ci-gate` decision                    | the `ci-gate` job's summary on the candidate's run       |
| Required-check completion             | `/commits/{sha}/check-runs` for the candidate            |
| Coverage — lines and branches         | the `Web quality` job's coverage artefact                |
| Hosted clean-room schema hash         | the `hosted-clean-room` job's replay output              |
| Application tables before migration   | the same job, against a database no local machine has    |
| RLS matrix cells                      | the `integration-tests` job's matrix artefact            |
| Container image digest and size       | the `Docker build validation` job                        |
| `npm audit` production and development | the dependency-policy step                              |
| Authenticated browser tier            | the `authenticated-browser` job                          |

### `PROTECTED_POST_MERGE_ONLY` — it cannot exist before the merge

`PROTECTED_GATE_GO` — PENDING PROTECTED MERGE. `protected-gate` runs only on a
push to a protected branch, so nothing before the merge can produce its verdict.

`CODEQL_REPOSITORY_CEILING` — PENDING PROTECTED MERGE. A CodeQL pull-request
analysis is diff-informed and says so in its own output, so it cannot establish a
repository-wide ceiling. The figure recorded below is what the analysed refs
carried at a superseded head; it is not the ceiling and this page does not
present it as one.

<!-- seal: end tree-derived -->
<!-- seal: historical hosted-corroboration -->

> **HISTORICAL** — the run below is `31312531302`, taken at
> `356f1a1e937e819b9db94f40a2d6f04f98f9ae39`. Executable files have changed since —
> the count is `EXECUTABLE_DIFF_COUNT` from that head, and it is not stated here
> because a figure that moves with every commit would be stale by the next one.
> Every value in this section is excluded from the current seal.

## Hosted corroboration at the head this record supersedes

A local clean room and a hosted runner fail differently, and neither is a
superset of the other. Both were run at the head named in the banner above — NOT
at the current tree, and the heading says so because an earlier revision of this
section was titled "at the same head" while `CODE_CANDIDATE_SHA` resolved to
nothing.

| measure                    | value                                                     |
| -------------------------- | --------------------------------------------------------- |
| Workflow run               | `31312531302` — PR #214                                    |
| Required checks            | **20 completed, 0 failed, 0 pending**                      |
| `ci-gate` decision         | **Go**                                                     |
| Web tests                  | 1216 passed, 0 failed                                      |
| Unit tests                 | 1762 passed, 0 failed                                      |
| Backend tests              | 1842 passed, 0 failed                                      |
| Database tests             | 1647 passed, 0 failed                                      |
| Coverage — lines / branches | 95.53% / 93.89%                                           |
| Migrations applied         | 120                                                        |
| Schema hash                | `f6b4f023d9e6b1e7d823dac4e5550379202a216ab1ae1fe9e5a2826703061f79` |
| Application tables before migration | 0                                                 |
| RLS matrix                 | 113 tables, 1356 cells, 0 RLS disabled, 0 unforced, 0 `SECURITY DEFINER` |
| CodeQL open alerts         | **0** on the three refs that analysis covered              |
| `npm audit` production / development | 0 / 0 advisories, 0 prohibited packages          |

The hosted clean-room job re-derived the schema hash before and after migration
replay and got the same value both times, which is the check that a migration
series is a function of its files rather than of the order someone ran them in.

The web tier's executed total was measured again at
`424e5d884ed7c8f608c446408743cbf88ac80515` by GitHub-hosted run `31508526699`,
job `93836261711` (`Web quality / web-quality`), which reported
`Tests executed | 1867`. That head is not this tree either. It is recorded
because it agrees with the local measurement above, and agreement between two
independent measurements is worth keeping — but the authority for the current
figure is the local run, because it is the only one taken against these bytes.

This is where the figure **1586** stood, in the present tense, 281 tests below
the tree. Recorded rather than quietly overwritten, because of HOW it survived:
both gates that guarded the sentence compared it to
`.github/ci-baselines/test-count-baseline.json`, never to the repository, so the
record and the baseline agreed with each other while both disagreed with the
tree. `validate:p1-27-doc-counts` reported `0 disagreement(s)` about a page whose
headline number was wrong. It was found by running the tier.

<!-- seal: end hosted-corroboration -->
<!-- seal: narrative clean-room-exceptions -->

## The two gates that cannot pass in a clean room, and why

Both are properties of **where the clean room is** and **what the shared database
contains**. Neither is a property of the tree, and reporting either as a tree
failure would be as wrong as reporting the green tiers as a pass.

**`validate:canonical-docs`.** The Owner's two canonical DOCX files live _beside_
the repository, not inside it — `../RootLco_Phase_1_Development_Plan_recovered_v01.docx`.
A clone has no such sibling. The gate verifies the Owner's documents were not
modified; with nothing to read it correctly refuses to report clean. It passes in
the source checkout, where the documents are present.

**`validate:seed-state`.** The gate asserts business tables are empty before seed
execution. The shared local PostgreSQL holds the **Owner-acceptance fixtures** —
two tenants, five identities, roles and grants — created deliberately so the
Owner can sign in at all. The clean room shares that database; it does not get
its own.

This gate also fails in the source checkout, for the same reason, and that is
**correct behaviour rather than a defect to work around**. It was not weakened,
its threshold was not raised, and no dirty-database baseline was recorded. Hosted
CI runs it against a clean database and it passes there — the
`Application tables before migration` row in the table above is that answer, at
the head that table describes.

<!-- seal: end clean-room-exceptions -->
<!-- seal: historical superseded-measurements -->

> **SUPERSEDED** — three heads this record used to describe. Kept as the only
> evidence that the drift happened, and excluded from the current seal.

## Superseded measurements

Kept, not overwritten. Deleting them would erase the only evidence that the drift
happened, and the next reader would have no reason to distrust the next stale
number. `P1-27-QA-005` exists because of the first row.

| head       | what it recorded                     | why it is superseded                                                                                                                  |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `36fccbc`  | web 752 tests / 37 files             | Superseded within the same wave when the pre-merge adversarial review added `server-vocabularies.test.ts`.                              |
| `e14984e`  | web 763 / 38, repository 1640 / 74   | **The defect `QA-005` names.** It stayed on this page while the tree moved 47 commits and 5 test files past it, and nothing noticed because nothing was comparing the number to the repository. |
| `d0a6008`  | no clean-room record at all          | The head the independent audit was briefed against. It had no clean-room or hosted-CI evidence of its own, which was the other half of the finding. |

<!-- seal: end superseded-measurements -->
<!-- seal: historical first-clean-room -->

> **HISTORICAL** — two failures of the FIRST clean room, kept because each names
> a way a clean room can lie. Neither describes the current tree.
>
> no commit is named here because both failures happened before any clean-room
> record existed to pin one to: the first was a property of the directory the
> clone sat in, the second of the clone's refs. Neither is a fact about a tree.

## Two ways the first clean room lied

**The build never ran.** The first clean room was cloned under the session
scratchpad. Everything passed except `build:web`, which failed with
`TurbopackInternalError: path length … exceeds max length of filesystem` — the
generated chunk name for `CustomerProfileScreen` plus a long scratchpad prefix
crosses Windows' `MAX_PATH`. Reporting that as a build failure would have been a
statement about the tree that was really a statement about a directory name. The
clean room was moved to a short path, where the build compiles. Every clean room
since has used one.

**The phase-ownership gate accused this branch of changing `apps/api`.** Thirteen
API files, each reported as "a Frontend phase must not change API source".

The cause was the clone, not the branch. `git clone` from the _local_ working
copy makes the clone's `origin/develop` point at the working copy's **local**
`develop` branch — which was stale, before the P1-17 backend remediations merged.
The gate diffed against a develop that predated those commits and correctly
reported that files had changed relative to it. Those changes arrived _from_
develop through a merge; they are not this branch's.

Pointing the clean room's `origin` at the real GitHub remote and fetching
`develop` makes the merge-base correct, and the gate reports 0 violations.

A clean room cloned from the machine under test inherits that machine's stale
refs. It is meant to be independent of the working copy and, for anything that
diffs against a base, it silently was not.

<!-- seal: end first-clean-room -->
<!-- seal: narrative closing -->

---

**P1-27 remains `OWNER ACCEPTANCE: FAIL`.** A verifying tree is not an accepted
phase, and this document does not claim otherwise.

<!-- seal: end closing -->
