# Main promotion

## Method

**Direct `develop` → `main` pull request**, the preferred method under §13.

**No commit was created to open it.** The promotion PR's head is
`FINAL_DEVELOP_SHA` exactly, so the reviewed tree and the promoted tree are the
same object — there is no promotion-only commit whose contents could differ from
what was verified.

The promotion documentation in this directory lands on `develop` **after** the
merge, as a separate documentation-only pull request. That ordering is deliberate:
writing the promotion record before the promotion would mean writing predicted
results as if they were measured, which is the failure this repository has already
paid for once.

## Pull request

| Field                               | Value                                                     |
| ----------------------------------- | --------------------------------------------------------- |
| Number                              | **#95**                                                   |
| Title                               | `release: promote verified develop baseline before P1-22` |
| Base                                | `main` @ `491c4e0882763b5d5864737e63b4e31ca708a6b5`       |
| Head                                | `develop` @ `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de`    |
| Commits introduced by the PR itself | **0**                                                     |

## Merge strategy

**Merge commit.** Not squash, not rebase-merge, not a direct push.

Worth recording explicitly: `main`'s ruleset currently permits
`["merge", "squash", "rebase"]`. The approved strategy is merge-commit, and a
squash here would have been actively destructive — it would have collapsed 166
commits of reviewed history into one and severed the ancestry that §17's
containment proof depends on. The ruleset permitting it is not the same as it
being allowed.

`develop`'s ruleset, by contrast, permits `["merge"]` only.

## Required checks

`main`'s ruleset requires four contexts, all from the legacy `ci.yml`:

- `Lint, types, tests, build`
- `Database migrations and RLS tests`
- `Docker build validation`
- `Secret and sensitive-file scan`

The promotion PR also runs the **full CI/CD platform**, because `pr-ci.yml`
triggers on pull requests into `main` as well as `develop`. `ci-gate` is not a
required context on `main`, but it runs and is recorded.

**No required check was removed, weakened, or bypassed.** No admin override was
used. The `main` ruleset is unchanged by this gate.

## Result

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| `MAIN_PROMOTION_MERGE_SHA` | `9c2fea162e5a270c740bac8db3546ed695a6f58a`                       |
| Parent 1                   | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — previous `main`     |
| Parent 2                   | `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de` — `FINAL_DEVELOP_SHA` |
| `MAIN_PROMOTION_TREE`      | `13c1280e73c506b103380f853a130ef29ea13e3d`                       |
| Conflicts                  | **none**                                                         |
| Unexpected drift           | **none** — 0 files differ, full tree and executable paths        |

**53 of 53 check-runs green** on the promotion head, enumerated through
`/commits/{sha}/check-runs`.

One review thread blocked the merge: the GitHub Advanced Security CodeQL comment
for the documented `js/http-to-file-access` dismissal, because `main`'s ruleset
requires conversation resolution. It was **replied to with the full source/sink
reproduction and then resolved** — not silently dismissed. The alert itself
remains open in the Security tab; resolving a review thread does not close it,
and the repository's own SARIF gate still counts it on every run.

## Post-merge verification of `main`

**17 of 17 check-runs green**, including `protected-gate`. Both workflow runs on
`9c2fea1` — `CI` and `Protected branch verification` — concluded success.

Full-tree CodeQL on `main`: `incrementalMode` **absent**, **719 files**,
**open findings 0**, decision **Go**. The single live finding is tooling-scope
and covered by the documented dismissal; GitHub's alert list for
`refs/heads/main` reports **1 open, medium**, reconciling exactly.

**Deployment: none.** Zero deploy-workflow runs and **zero GitHub deployments**
recorded.

Detail in [`final-tree-identity.md`](final-tree-identity.md).
