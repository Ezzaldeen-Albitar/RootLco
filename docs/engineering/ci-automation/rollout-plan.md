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
| 7 — exact-SHA hosted proof         | **blocked** — see below |

## The block

Opening the pull request requires an authenticated GitHub session. Neither
available browser surface is signed in, and no `gh` CLI or token is configured.
Pushing works because the remote is SSH; creating a pull request is a REST/web
operation and is not.

Everything that does not depend on that is done. The branch
`feature/platform-comprehensive-ci-automation` is pushed and ready.

### What the owner needs to do

1. Open <https://github.com/Ezzaldeen-Albitar/RootLco/compare/develop...feature/platform-comprehensive-ci-automation?expand=1>
2. Title: `ci(platform): build comprehensive automated assurance pipeline`
3. Body: paste [`pull-request-body.md`](pull-request-body.md)
4. Create.

That starts the first hosted run of the whole pipeline.

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

## Ongoing

- **Weekly**: read the Dependabot pull requests. They run the same gate.
- **Nightly**: a red `nightly-gate` means a blocking-tier job failed. Triage as a
  defect.
- **Quarterly**: review the exception files. `dependency-exceptions.json` and
  `idempotency-exceptions.json` both fail on an expired entry and on an entry
  that matches nothing, so neither can quietly accumulate.
- **On 2026-10-31**: the ten idempotency exceptions expire. Either the replay
  tests exist by then or the gate goes red.
