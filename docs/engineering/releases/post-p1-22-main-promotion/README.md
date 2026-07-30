# Post-P1-22 develop-to-main promotion gate

Records the promotion of the complete approved protected `develop` baseline — including the
officially closed P1-22 feature and gate records — to `main`, and proves that `main`'s tree
is byte-identical to the `develop` tree that was verified.

This record is **documentation only** and is stored on `develop` through its own reviewed
pull request. It deliberately does **not** touch `main`: adding an unreviewed documentation
commit to `main` after promotion would change the promoted tree and destroy the tree-identity
property this record exists to attest.

## Owner authorization

> **OWNER AUTHORIZATION — DEVELOP TO MAIN PROMOTION (POST-P1-22)**
>
> The Product Owner explicitly authorizes promotion of the complete approved protected
> `develop` baseline, including the officially closed P1-22 feature and gate records, to
> `main`.
>
> Authorized scope: promote **only** the exact protected `develop` baseline.
>
> This does **not** authorize:
>
> - reopening P1-22, or modifying P1-22 implementation;
> - starting P1-23;
> - any deployment, or a release build that triggers deployment;
> - direct pushes to `develop` or `main`;
> - squash or rebase-merge;
> - merging the feature branch directly to `main`.

## Identities

| Field                      | Value                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| `PROMOTION_PR`             | **#109** — `release: promote P1-22 verified develop baseline to main` |
| `FINAL_DEVELOP_SHA`        | `6bfa7a26f3bbb9105a207dbb1b924f005922a894`                            |
| `FINAL_DEVELOP_TREE`       | `b032e0503f937fe07a9948fb094f94abde19af85`                            |
| `MAIN_BEFORE_SHA`          | `9c2fea162e5a270c740bac8db3546ed695a6f58a`                            |
| `MAIN_BEFORE_TREE`         | `13c1280e73c506b103380f853a130ef29ea13e3d`                            |
| `MAIN_PROMOTION_MERGE_SHA` | `5a043151f3a0c3ce61e74515d496ec0622969839`                            |
| `MAIN_PROMOTION_PARENT_1`  | `9c2fea162e5a270c740bac8db3546ed695a6f58a` (= `MAIN_BEFORE_SHA`)      |
| `MAIN_PROMOTION_PARENT_2`  | `6bfa7a26f3bbb9105a207dbb1b924f005922a894` (= `FINAL_DEVELOP_SHA`)    |
| `MAIN_AFTER_SHA`           | `5a043151f3a0c3ce61e74515d496ec0622969839`                            |
| `MAIN_AFTER_TREE`          | `b032e0503f937fe07a9948fb094f94abde19af85`                            |
| Merge strategy             | **merge commit** (no squash, no rebase, no direct push)               |
| Third source branch        | none — exactly two parents                                            |

## Tree identity

**`MAIN_AFTER_TREE` == `FINAL_DEVELOP_TREE` == `b032e0503f937fe07a9948fb094f94abde19af85`.**

| Proof                                               | Result                                 |
| --------------------------------------------------- | -------------------------------------- |
| `git diff --exit-code 6bfa7a26 origin/main`         | exit **0**                             |
| `git diff --name-status 6bfa7a26 origin/main`       | **empty**                              |
| full-tree diff                                      | **0 files**                            |
| executable diff (non-`.md`)                         | **0 files**                            |
| `git merge-base --is-ancestor 6bfa7a26 origin/main` | exit **0**                             |
| `git merge-base --is-ancestor f5c3a02 origin/main`  | exit **0**                             |
| `git merge-base --is-ancestor 9c2fea16 origin/main` | exit **0** (no force push, no rewrite) |

The commit SHAs of `develop` and `main` differ, and that is expected: `main`'s tip is a merge
commit. The guarantee is **ancestry plus a byte-identical tree**, not SHA equality. No
back-merge of `main` into `develop` was performed to force SHAs to match.

Tree identity was **proven in advance**, not hoped for: a dry-run `git merge-tree` of
`main` + `develop` resolved to `b032e0503f93…` with zero conflicts before the merge was
executed. `main` held no file that `develop` lacked — its sixteen additional commits were all
prior develop-merges.

### Per-path reconciliation

| Path                       | Identical            |
| -------------------------- | -------------------- |
| `package-lock.json`        | yes — `47ef0c6fec46` |
| `package.json`             | yes — `d133d64d97d1` |
| `docs/api/openapi.v1.json` | yes — `bba3eeb1b16a` |
| `.github/workflows/`       | yes — `6c73e5533c56` |
| `supabase/migrations/`     | yes — `9a25a6aa17be` |
| `src/`                     | yes — `83ad3d202702` |
| `docs/phase-1/phase-1-22/` | yes — `b89a0766a269` |

## P1-22 containment

| Artefact                | SHA            | In develop | In main |
| ----------------------- | -------------- | ---------- | ------- |
| Pre-phase base          | `0a53e540d723` | yes        | yes     |
| Reviewed feature head   | `f5c3a02dca8a` | yes        | yes     |
| Feature merge (PR #107) | `c864183a564e` | yes        | yes     |
| Gate branch head        | `6b1c404e4aae` | yes        | yes     |
| Gate merge (PR #108)    | `6bfa7a26f3bb` | yes (tip)  | yes     |

All P1-22 executable work, all P1-22 gate documentation (`gate-record.md`,
`execution-checkpoint.md`, `blocker-treatment.md`, `contract-archaeology.md`,
`operation-inventory.md`, `number-sequence-runbook.md`, `evidence/`), and the CI-integrity
fixes merged before closure are present on `main`. No approved P1-22 commit is stranded on a
remote branch, and no open P1-22 pull request exists. No old P1-22 feature or gate branch was
merged independently.

## Evidence carried into main

| Item                                    | Result                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-22 task gate                         | **31/31**                                                                                                                                   |
| P1-22 operation depth                   | **20/20**, with `pending`, `unit-only`, `invocation-only`, `unreferenced`, `metadata-only` all measured **0**                               |
| Hostile mutation matrix                 | **45/45 caught** (0 survived, 0 not-found)                                                                                                  |
| Tests, re-measured on the promoted tree | unit **1252** / backend **1603** / database **1636** = **4,491**                                                                            |
| Migrations in tree                      | **119** on both `develop` and `main`                                                                                                        |
| Migration `120`                         | **absent**                                                                                                                                  |
| Migrations 1–119                        | immutable — `supabase/` diff against the pre-P1-22 base is 0 files                                                                          |
| Schema hash                             | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`, measured from the `main` tree                                           |
| OpenAPI                                 | 3.1.0, 189 paths, 219 operations, valid, every operation guarded                                                                            |
| Production dependency audit             | **0 vulnerabilities**                                                                                                                       |
| Static battery on the `main` tree       | module boundaries, authorization coverage, OpenAPI, operation coverage, exact-money, task gate, secret/no-fake-data/scope guards — all pass |

## Continuous-integration results

Every check-run population was enumerated through `/commits/{sha}/check-runs` and asserted
**non-zero before evaluation**. `/actions/runs` was never used as the source of truth.

| Stage               | SHA        | Population | Result                                 |
| ------------------- | ---------- | ---------- | -------------------------------------- |
| Protected `develop` | `6bfa7a26` | 17         | **17/17 success**                      |
| Promotion PR #109   | `6bfa7a26` | 36         | **36/36 success**, including `ci-gate` |
| Protected `main`    | `5a043151` | 17         | **17/17 success**                      |

Zero pending, zero failure, zero cancelled, zero timed-out, zero neutral at every stage.

Named checks green on `main`: `protected-gate` · `hosted-clean-room` · full-tree CodeQL for
**JavaScript/TypeScript** and **Actions** · `unit-tests-coverage / unit-coverage` ·
`database-migration-replay / migration-replay` · `database-security / security-matrix` ·
`integration-tests` · `dependency-security` · `container-security` · `secret-scan` and
`Secret and sensitive-file scan` · `application-build / build` · `Docker build validation` ·
`Lint, types, tests, build` · `static-quality`.

`ci-gate` is pull-request-scoped. It is **success on PR #109** and legitimately **absent** on
both protected pushes; that absence is not treated as a failure.

A methodological note worth keeping: the first waiter reported "terminal" while `pr-ci` run
\#59 was still **queued** with no check-runs registered. _Every present check being terminal is
not every check having been created._ Merging on that reading would have proceeded with
`ci-gate` missing and 17 of the eventual 36 checks not yet in existence. The corrected waiter
requires, together: no workflow run queued or in progress, every check-run completed, the
required check present, and a non-zero population.

## Security

Proven from the **full-tree** analysis on each protected branch, never from a diff-informed
pull-request analysis alone.

| Item                                 | develop | main  |
| ------------------------------------ | ------- | ----- |
| Application **Critical**             | **0**   | **0** |
| Application **High**                 | **0**   | **0** |
| Application alerts                   | 0       | 0     |
| Open alerts total                    | 1       | 1     |
| New findings introduced by promotion | —       | **0** |

The single open alert is unchanged in both places and matches its existing documented
disposition: **#33**, `js/http-to-file-access` in `scripts/ci/check-commit-checks.mjs` — a CI
script, not application source. No new secret finding.

## Deployment

**`DEPLOYMENT_TRIGGERED = false`.**

| Probe                                | Result                                                               |
| ------------------------------------ | -------------------------------------------------------------------- |
| GitHub deployments                   | **0**                                                                |
| GitHub environments                  | **none**                                                             |
| `deploy-production.yml` runs         | **0**                                                                |
| `deploy-staging.yml` runs            | **0**                                                                |
| `release-verification.yml` runs      | **0**                                                                |
| Workflow runs on the promotion merge | 2 — `Protected branch verification` and `CI`, both verification-only |

Structural reasons, verified in the workflow sources rather than inferred:

- `deploy-production.yml` — `workflow_dispatch` **only**, with four mandatory inputs (a
  staging-verified immutable image digest, source SHA, explicit staging confirmation, change
  record). No push, pull-request, tag or release trigger.
- `deploy-staging.yml` — `workflow_dispatch` **only**.
- `release-verification.yml` — fires on `release-*` / `v*` **tags**. **No tag was created.**
  The only tag in the repository remains `release-2-database-baseline` from P1-12.
- **No workflow declares a GitHub `environment:`**, so no deployment object can be created.

## Protected-branch integrity

Both `develop` and `main` carry `deletion`, `non_fast_forward` and `pull_request` rules, so
force pushes, branch deletion and direct pushes are structurally blocked. `main`'s ruleset
permits `merge`, `squash` and `rebase`; **`merge` was used explicitly**. No direct protected
push and no force push occurred — `MAIN_BEFORE_SHA` remains an ancestor of `MAIN_AFTER_SHA`.

## P1-23

**Not started.** No P1-23 branch, no P1-23 source, no P1-23 operation, no P1-23 documentation
claiming execution. The one path matching the string is
`docs/phase-1/phase-1-11/phase-1-11-p1-23-reporting-backend-contract.md`, a **P1-11 forward
contract** which states that no report dataset, KPI formula or export backend is implemented.
The two matching commits are `docs(p1-22)` records that merely reference the phase.

## Decision

**Go — RootLco Post-P1-22 Main Promotion Gate Passed**
