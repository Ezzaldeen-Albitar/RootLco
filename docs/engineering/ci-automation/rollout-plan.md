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

| #   | Step                                                | Who       | Evidence                                                                              |
| --- | --------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| 1   | First hosted `pr-ci` run                            | automatic | 13 jobs; expect first-run failures — the workflows have never executed                |
| 2   | Diagnose from artifacts, fix, push                  | —         | never re-run blindly                                                                  |
| 3   | Record the measured baselines the run produces      | —         | backend coverage, build size, image size, structural totals, seeded structural tables |
| 4   | `ci-gate` **Go** at one exact SHA                   | —         | run URL                                                                               |
| 5   | Merge with a **merge commit**                       | owner     | no squash, no rebase                                                                  |
| 6   | `protected-gate` on the merge SHA                   | automatic | run URL                                                                               |
| 7   | Gate branch, documentation-only, gate PR            | —         | proves the clean room cannot be skipped                                               |
| 8   | `protected-gate` on the final develop SHA           | automatic | run URL                                                                               |
| 9   | Add `ci-gate` to required checks                    | owner     | branch protection                                                                     |
| 10  | Remove the four `ci.yml` job names; delete `ci.yml` | owner     | separate PR                                                                           |

Steps 5, 9 and 10 are owner actions. Everything else follows from them.

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
