# Hostile mutation results

Initiative §41: prove `ci-gate` fails under each hostile condition, and restore
every mutation byte-identically.

Two kinds of proof appear below, and the difference matters:

- **Unit-proved** — the mutation is a _job result_, so it is exercised against
  the real gate evaluator in `tests/ci/ci-gate.test.ts`. Injecting a genuine
  failure into a hosted job to observe the gate would cost a full pipeline run
  per mutation and prove nothing the evaluator does not already decide.
- **Repository-mutated** — the mutation is a change to a real file. The file was
  actually modified, the real checker was run, the finding was observed, and the
  file was restored. Restoration is verified with `git status --porcelain`.

## Gate-result mutations — unit-proved

Each row corresponds to a named test in `tests/ci/ci-gate.test.ts`. Deleting the
corresponding branch in `scripts/ci/evaluate-ci-gate.mjs` makes exactly one
assertion fail.

| #     | Condition                                                                              | Gate verdict | Evidence                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01  | `static-quality` fails                                                                 | No-Go        | `returns No-Go when static-quality fails`                                                                                                                            |
| M-02  | unit tests fail                                                                        | No-Go        | `returns No-Go when unit-tests-coverage fails`                                                                                                                       |
| M-03  | coverage decreases                                                                     | No-Go        | `unit-tests-coverage` fails → gate No-Go; the ratchet itself is proved in `change-detection-and-coverage.test.ts` (`fails when coverage drops beyond the tolerance`) |
| M-04  | build fails                                                                            | No-Go        | `returns No-Go when application-build fails`                                                                                                                         |
| M-05  | migration replay fails                                                                 | No-Go        | `returns No-Go when database-migration-replay fails`                                                                                                                 |
| M-06  | RLS fails                                                                              | No-Go        | `returns No-Go when database-security fails`                                                                                                                         |
| M-07  | integration fails                                                                      | No-Go        | `returns No-Go when integration-tests fails`                                                                                                                         |
| M-08  | dependency scan fails                                                                  | No-Go        | `returns No-Go when dependency-security fails`                                                                                                                       |
| M-09  | CodeQL reports a blocking finding                                                      | No-Go        | `returns No-Go when code-security fails`                                                                                                                             |
| M-10  | container scan reports blocking severity                                               | No-Go        | `returns No-Go when container-security fails`                                                                                                                        |
| M-11  | secret scan fails                                                                      | No-Go        | `returns No-Go when secret-scan fails`                                                                                                                               |
| M-12  | clean room fails                                                                       | No-Go        | `returns No-Go when hosted-clean-room fails`                                                                                                                         |
| M-13  | a required job is cancelled                                                            | No-Go        | `returns No-Go when a required job is cancelled`                                                                                                                     |
| M-14  | a required job is unexpectedly skipped                                                 | No-Go        | `returns No-Go when a job was skipped although change detection required it`                                                                                         |
| M-14b | an unconditionally required job is skipped, with a tampered classification excusing it | No-Go        | `refuses a skip of an unconditionally required job even when the classification permits it`                                                                          |
| M-14c | a job is skipped and no classification exists                                          | No-Go        | `refuses a skip when no classification exists at all`                                                                                                                |
| M-14d | a job is skipped and change detection has no entry for it                              | No-Go        | `refuses a skip when change detection made no decision about that job`                                                                                               |
| M-15  | a job name changes without updating the gate                                           | No-Go        | `returns No-Go when a governed job is absent from needs (renamed or removed)`                                                                                        |
| M-15b | a job is added without registering it in the gate                                      | No-Go        | `returns No-Go when a job ran that the gate does not govern (newly added)`                                                                                           |
| M-20  | the PR head differs from the tested SHA                                                | No-Go        | `returns No-Go when the tested SHA differs from the SHA under review`                                                                                                |
| M-21  | a job reports an unanticipated result                                                  | No-Go        | `returns No-Go when a job reports a result nobody anticipated`                                                                                                       |

**Control:** `returns Go when every declared job succeeded`, and
`accepts a skip that change detection recorded as not required` — without these,
a gate that always said No-Go would pass every row above.

## Repository mutations — actually applied and restored

| #     | Mutation                                                    | Applied to                                     | Detected by                                                      | Verdict  |
| ----- | ----------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- | -------- |
| M-16a | `npm test \|\| true` added to a workflow run block          | `.github/workflows/pr-ci.yml`                  | `WFS-008`, high, exit 1                                          | detected |
| M-16b | `set -euo pipefail` removed from a multi-line run block     | `.github/workflows/_reusable-node-quality.yml` | `WFS-007`, medium                                                | detected |
| M-17  | one path removed from the committed OpenAPI document        | `docs/api/openapi.v1.json`                     | `tests/openapi-contract.test.ts`, exit 1, `1 failed \| 3 passed` | detected |
| M-18  | `retry: 3` added to a runner configuration                  | `vitest.config.db.ts`                          | `TH-006`, critical                                               | detected |
| M-19  | `fileParallelism: true` on a database-bound project         | `vitest.config.backend.ts`                     | `TH-007`, critical                                               | detected |
| M-22  | an action unpinned from its SHA back to `@v4`               | `.github/workflows/pr-ci.yml`                  | `WFS-001`, high, exit 1                                          | detected |
| M-23  | a route's side-effect import removed from the contract test | `tests/openapi-contract.test.ts`               | `check-route-registry-parity.mjs`, exit 1, named the exact route | detected |

**Restoration verified.** After each block, `git status --porcelain` over the
touched paths was empty — every file byte-identical to its committed state.

## Mutations deliberately NOT run

| Mutation                                     | Why not                                                                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injecting a real failure into a hosted job   | Costs a full pipeline run each and proves only what the gate evaluator already decides deterministically. The evaluator is unit-proved above against its real implementation                 |
| Removing a database guard end-to-end         | That is `mutation-assurance.mjs`, which needs a live PostgreSQL. Its three targets are **anchor-verified** — the exact text is present at the expected multiplicity — and the run is nightly |
| Publishing a real secret to test the scanner | Self-evidently not something to do. The scanners are unit-proved on synthetic values assembled at runtime                                                                                    |

## The honest limitation

`inventory-read-company-scope` in `.github/ci-baselines/mutation-targets.json` is
currently a **placeholder mutation**: its `replace` only appends a comment, so it
proves the anchor is present and the suite still passes with the guard intact —
it does not yet prove the guard is load-bearing.

A faithful removal requires renumbering the bound SQL parameters, because
deleting the clause leaves `$2` unbound and produces 500s rather than the
original cross-company disclosure — a mutant that would look killed for entirely
the wrong reason. This is recorded in the manifest itself, not only here.

The other two targets (`deferred-scope-target-required`,
`idempotency-fingerprint-comparison`) are faithful: each disables the guard with
`if (false && …)`, leaving the code compilable and the behaviour genuinely
removed.
