# Branch ruleset

## Current state

`develop` requires four status checks, and they are **job names**:

- `Lint, types, tests, build`
- `Docker build validation`
- `Database migrations and RLS tests`
- `Secret and sensitive-file scan`

That shape has three failure modes (CSA-06):

1. **Renaming a job silently removes a required check.** Nothing notices.
2. **Adding a job does not add a required check.** It can fail and the merge
   still goes through.
3. **A job that never runs leaves its check Pending forever**, blocking the merge
   with no failure to diagnose. This is why `pr-ci.yml` has no top-level `paths:`
   filter.

## Target state

**One required check: `ci-gate`.**

`ci-gate` runs `if: always()`, depends on all twelve other jobs, and refuses when
a governed job is missing from `needs` or an ungoverned job appears in it. That
closes failure modes 1 and 2 _inside_ the pipeline, where they can be tested —
and `tests/ci/ci-gate.test.ts` tests exactly that. Failure mode 3 is closed by
the gate treating an unexplained skip as a failure.

| Setting                     | Value                    | Why                                                                                           |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| Require a pull request      | yes                      | no direct push to a protected branch                                                          |
| Required approvals          | as today                 | unchanged by this initiative                                                                  |
| Require status checks       | **`ci-gate` only**       | one stable name that governs everything                                                       |
| Require branches up to date | yes for `develop`        | the gate proves the merge result, not a stale head                                            |
| Block force pushes          | yes                      | protected history                                                                             |
| Block deletions             | yes                      | —                                                                                             |
| Merge strategy              | **merge commit only**    | ADR-006; squash or rebase would rewrite the reviewed SHA and break tree-identity verification |
| Admin bypass                | controlled and auditable | unchanged                                                                                     |
| Merge queue                 | **no**                   | single-developer repository; a merge queue solves a contention problem that does not exist    |

`protected-develop-verification.yml` produces `protected-gate`, which is a
different job in a different workflow. It is **not** a required check — it runs
_after_ the merge. It is the run a gate record cites.

## Cutover — do not skip a step

§24: _do not remove current required checks before the replacement is validated
on real PR and protected-push runs._

| #   | Step                                                                    | Evidence needed                                                     |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `ci-gate` succeeds on the automation feature pull request               | run URL, Go decision                                                |
| 2   | `protected-gate` succeeds on the protected feature-merge push           | run URL, 12/12                                                      |
| 3   | `ci-gate` succeeds on the documentation-only gate pull request          | run URL — this is also what proves the clean room cannot be skipped |
| 4   | `protected-gate` succeeds on the final protected gate push              | run URL                                                             |
| 5   | **Then** add `ci-gate` to the required set, alongside the existing four | —                                                                   |
| 6   | Observe at least one further pull request pass with all five required   | —                                                                   |
| 7   | Remove the four `ci.yml` job names from the required set                | —                                                                   |
| 8   | Delete `.github/workflows/ci.yml` in its own pull request               | —                                                                   |

Steps 5, 7 and 8 are **owner actions**. Branch protection is a repository
setting; no pull request can change it.

Keeping `ci.yml` running through steps 1–6 duplicates work and costs runner
minutes. That is the deliberate price of not removing a control before its
replacement is proven.

## Avoid dynamically named checks

`ci-gate` is a fixed job name with a fixed display name. Nothing about it varies
with the matrix, the event, or an input. A required check whose name depends on
the run cannot be required reliably — which is the same trap as requiring job
names, one level up.
