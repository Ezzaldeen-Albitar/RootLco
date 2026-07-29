# Rollout plan

## Where this stands

| Wave                               | State                   |
| ---------------------------------- | ----------------------- |
| 0 — audit and baseline             | complete                |
| 1 — reusable foundations           | complete                |
| 2 — PR CI                          | complete                |
| 3 — nightly assurance              | complete                |
| 4 — release foundations            | complete                |
| 5 — governance and documentation   | complete                |
| 6 — hostile review and remediation | complete                |
| 7 — exact-SHA hosted proof         | in progress — see below |

## The pull request is open

[**PR #89**](https://github.com/Ezzaldeen-Albitar/RootLco/pull/89) —
`feature/platform-comprehensive-ci-automation` into `develop`.

Opening it needed an authenticated GitHub session, which this environment does
not have: neither browser surface is signed in and there is no `gh` CLI or
token. Pushing works only because the remote is SSH. The owner opened it; that
part of the block is cleared.

What remains genuinely owner-only is unchanged — steps 5, 9 and 10 below.

### Hosted state

| Attempt | Head SHA  | `pr-ci`                                                       |
| ------- | --------- | ------------------------------------------------------------- |
| 1       | `8740531` | `startup_failure`, zero jobs — AR-28                          |
| 2       | `67014fc` | every job failed in `Set up the project` — AR-29              |
| 3       | `2654f23` | ran: 7 green, 6 real gate failures — AR-30…AR-33              |
| 4       | `9088013` | 11 of 13 green; container only — AR-34, AR-35, AR-36          |
| 5       | `ca4c594` | **14/14 green, `ci-gate` Go**                                 |
| 6       | `f741d2f` | 12/13; `dependency-security` only — AR-41                     |
| 7       | `0e492bb` | 12/13; `dependency-security` only — AR-42                     |
| 8       | `d166449` | **14/14 green, `ci-gate` Go** — and carrying every review fix |
| 9       | `c95e8d9` | **14/14 green, `ci-gate` Go** — documentation on top          |
| 10      | `a243295` | **14/14 green, `ci-gate` Go** — AR-43/AR-44 corrected         |

The most recent CONFIRMED green run at the time of writing is **`a243295`**.
Like the execution checkpoint, this table cannot contain the result of the run
triggered by the commit that carries it — a document that reports its own
verification is asserting something it has not seen.

The legacy `ci.yml` has passed 4/4 on every one of these commits, which is what
gives independent confidence that the dependency remediation itself is sound —
those four jobs do not use the new reusable workflows at all.

### Reading the evidence without an authenticated session

A constraint that shaped every diagnosis here, and that the gate record has to
work within:

**GitHub requires a signed-in session to read Actions logs, even on a public
repository.** The REST log endpoint returns 403 without admin, the web log route
404s, and the job page offers only _"Sign in to view logs"_.

What IS public:

| Surface                               | Public? | Use                                                           |
| ------------------------------------- | ------- | ------------------------------------------------------------- |
| Run and job conclusions               | yes     | which job failed                                              |
| Per-step conclusions                  | yes     | which STEP failed                                             |
| Check-run **annotations**             | yes     | the error text a step emitted with `::error::`                |
| Job logs                              | **no**  | —                                                             |
| Job summaries (`GITHUB_STEP_SUMMARY`) | **no**  | —                                                             |
| Uploaded artifacts                    | **no**  | —                                                             |
| Actions job `output.summary`          | empty   | Actions does not populate it the way a third-party check does |

Two consequences worth carrying:

1. **Every check that fails on an external response must print what it
   received.** The dependency-graph probe was only diagnosable because it
   interpolated the response body into its `::error::`, which put
   `HTTP 403 … : Forbidden` into a public annotation. Without that there was an
   exit code and nothing else.
2. **The `ci-gate` decision document is owner-retrievable, not public.** The
   verdict is written to the job summary and to `ci-gate.json` in the
   `evidence-ci-gate` artifact. A gate record can cite the run URL and the
   step conclusions as public evidence, and the owner attaches the artifact for
   the decision itself.

## After the pull request is open

| #   | Step                                                | Who       | Evidence                                                               |
| --- | --------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| 1   | First hosted `pr-ci` run                            | automatic | 13 jobs; expect first-run failures — the workflows have never executed |
| 2   | Diagnose from artifacts, fix, push                  | —         | never re-run blindly                                                   |
| 3   | Record the measured baselines the run produces      | **done**  | from run 19 artifacts — see `evidence/hosted-baselines.md`             |
| 4   | `ci-gate` **Go** at one exact SHA                   | —         | run URL                                                                |
| 5   | Merge with a **merge commit**                       | owner     | no squash, no rebase                                                   |
| 6   | `protected-gate` on the merge SHA                   | automatic | run URL                                                                |
| 7   | Gate branch, documentation-only, gate PR            | —         | proves the clean room cannot be skipped                                |
| 8   | `protected-gate` on the final develop SHA           | automatic | run URL                                                                |
| 9   | Add `ci-gate` to required checks                    | owner     | branch protection                                                      |
| 10  | Remove the four `ci.yml` job names; delete `ci.yml` | owner     | separate PR                                                            |

Steps **5**, 9 and 10 are owner actions. Step 3 had been reassigned to the owner
once the measurements turned out to live only in artifacts and job summaries,
neither of which is readable without a signed-in session; it is now closed,
because a session was available and the artifacts were read directly.

## Baselines to record from the first hosted runs

Committed **unset** on purpose. Each has the reason written in its file.

| Baseline                                       | Recorded by                                              |
| ---------------------------------------------- | -------------------------------------------------------- |
| Backend coverage `global`                      | first `integration-tests` run                            |
| Backend `criticalModules` floors               | once the first run proves each prefix matches real files |
| `standaloneBytes`, `staticBytes`, `totalBytes` | first `application-build`                                |
| `imageSizeBytes`                               | first `container-security`                               |
| `structuralTotals`                             | first `database-migration-replay`                        |
| `seededStructuralTables`                       | first `database-migration-replay`                        |
| Performance `queries`                          | after three agreeing nightlies                           |

Until each is recorded, its gate **reports the measurement and passes**. That is
measure-first, not a disabled check — and each file says which it is.

### Step 3 is CLOSED — recorded from run 19

Every baseline that could be established has been, from the artifacts of **PR CI
run 19** (`30431556718`) at `8d7bfff09cf914e00ff5ff4587341ece261185c3`. Full
provenance, per number, in
[`evidence/hosted-baselines.md`](evidence/hosted-baselines.md).

| File                             | Was unset                                      | Now                                                                    |
| -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `build-size-baseline.json`       | `standaloneBytes`, `staticBytes`, `totalBytes` | 34,367,299 / 632,213 / 66,333,419 bytes                                |
| `container-baseline.json`        | `imageSizeBytes`                               | 202,909,674 bytes, uncompressed, plus the local image ID and 12 layers |
| `coverage-baseline.backend.json` | `establishedBy`, `global`, `criticalModules`   | 86.38 / 86.38 / 86.73 / 80.08, and six floors promoted from planned    |
| `schema-baseline.json`           | `structuralTotals`, `seededStructuralTables`   | 242/514/631/541/0, and the seven structural catalogs enumerated        |
| `test-count-baseline.json`       | unit floor rested on a local 1024              | hosted 1082/1624/1380; unit floor raised 1000 → 1050                   |
| `performance-baseline.json`      | `establishedBy`, `queries`                     | **still unset** — see below                                            |

This was previously reassigned to the owner on the grounds that artifacts and
job summaries are unreadable without a signed-in session. That constraint was
real but not permanent: an authenticated GitHub session was available for this
pass, all 17 artifacts were downloaded and parsed, and the numbers were taken
from the machine-readable JSON rather than from any log.

Still NOT closed by measuring locally, which remains the wrong way to do it. A
Windows workstation build is not the artefact the ratchet guards, and seeding a
size or coverage floor from the wrong environment produces a gate that is either
permanently slack or fails on its first honest run.

#### The one that stays open

`performance-baseline.json` could not be established here, and no amount of
session access would have changed that. Its measurement belongs to the
`performance-baseline` job in `nightly-assurance.yml`, and **that workflow has
never run**: a `schedule:` trigger fires only from the default branch, and the
workflow exists only on this feature branch. Across the repository's entire run
history the only workflows that have ever executed are `CI`, `PR CI` and `P1-21
Hosted Clean Room`.

It will be established by the first nightly after this branch merges. No PR-gate
job reads the file, and `nightly-summary.mjs` classifies the job as
`informational`, so a missing budget reports as missing rather than as passing.

## Expected first-run failures

These workflows have never executed. Honest expectations:

| Likely                                             | Why                                                                                                     | Response                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `rls-matrix.mjs` reports `granted-no-policy` cells | the severity of that pattern depends on how the schema grants privileges, which has never been measured | read the matrix; if it is structural, switch the PR tier to `--no-policy-advisory` and record the measured reason — do not silence it |
| CodeQL SARIF upload fails                          | code scanning is not enabled on the repository                                                          | enable it (`security-model.md` §7); the SARIF is attached as an artifact regardless                                                   |
| Container job finds base-image findings            | `node:22-alpine` carries whatever Alpine carries                                                        | fixable ones block and get patched; unfixable ones are reported                                                                       |
| Attestation unavailable                            | never exercised on this plan                                                                            | the manifest records `manifest-only` and says so                                                                                      |
| Backend coverage collection is slow                | 59 files against a real database, with v8 instrumentation                                               | if it dominates, move coverage to nightly and keep the tier blocking without it                                                       |

None of these is a reason to weaken a gate. Each is a reason to look at the
evidence and decide with it.

## What actually happened

Recorded because the table above turned out to be wrong in an instructive way.
**Neither real failure is on it**, and neither was a gate reporting a finding —
both were the pipeline being unable to run at all.

| Run | Result                           | Cause                                                                                             |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `startup_failure`, **zero jobs** | a caller's `permissions:` cap every job in the reusable workflow it calls, including skipped ones |
| 2   | every job failed in `Set up`     | a non-cone bootstrap sparse checkout is never undone, so the workspace held one file              |

Both are recorded as AR-28 and AR-29, and each now has a linter rule — WFS-011
and WFS-012, both _critical_. The pattern worth carrying forward: **both defects
were in the remediation for an earlier finding**, and neither was reachable by
reading the files. Three adversarial reviewers, `actionlint`, and this
repository's own workflow linter all passed the first one.

The honest lesson is the one the table already implied but did not act on: a
workflow that has never executed is not evidence of anything. The first green
run is the first evidence.

## Ongoing

- **Weekly**: read the Dependabot pull requests. They run the same gate.
- **Nightly**: a red `nightly-gate` means a blocking-tier job failed. Triage as a
  defect.
- **Quarterly**: review the exception files. `dependency-exceptions.json` and
  `idempotency-exceptions.json` both fail on an expired entry and on an entry
  that matches nothing, so neither can quietly accumulate.
- **On 2026-10-31**: the ten idempotency exceptions expire. Either the replay
  tests exist by then or the gate goes red.
