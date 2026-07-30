# Post-P1-22 main promotion — measurement log

Commands and their observed output, in execution order. Every figure in `README.md` traces to
a line here.

## Ground truth before promotion

```
git rev-parse origin/develop          -> 6bfa7a26f3bbb9105a207dbb1b924f005922a894
git rev-parse origin/main             -> 9c2fea162e5a270c740bac8db3546ed695a6f58a
git rev-parse origin/develop^{tree}   -> b032e0503f937fe07a9948fb094f94abde19af85
git rev-parse origin/main^{tree}      -> 13c1280e73c506b103380f853a130ef29ea13e3d
git merge-base origin/develop origin/main -> d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de
git status --short --branch           -> branch line only (clean tree, clean index)
git diff --check                      -> exit 0
```

Containment before promotion:

```
merge-base --is-ancestor f5c3a02 origin/develop -> exit 0   (contained)
merge-base --is-ancestor f5c3a02 origin/main    -> exit 1   (not yet — expected)
```

## Tree identity proven BEFORE the merge

```
git merge-tree --write-tree 9c2fea16 6bfa7a26
  -> b032e0503f937fe07a9948fb094f94abde19af85   (exit 0, zero conflicts)
```

Identical to `FINAL_DEVELOP_TREE`, so tree identity was known to be achievable before `main`
was touched. Supporting fact: `git diff --diff-filter=A origin/develop origin/main` returned
**nothing** — `main` held no file that `develop` lacked.

## Database and contract invariants, measured on the develop tree

```
migrations in tree                      -> 119
migration 120                           -> 0 (absent)
highest prefix                          -> 20260730090000_crm_customer_notes_write_capability.sql
git diff --name-only 0a53e540 6bfa7a26 -- supabase/  -> 0 files (1-119 immutable)
validate:schema-inventory --hash-only   -> a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c
validate:openapi                        -> 3.1.0, 189 paths, 219 operations; valid, all guarded
check-operation-test-coverage (P1-22)   -> registered 20, depth 20, invocation-only 0,
                                           pending 0, unit-only 0, unreferenced 0,
                                           metadata-only 0
p1-22-endpoint-inventory --check        -> 20 operations; permissions, audit actions, events
                                           and all 31 task identifiers reconcile
check-exact-money                       -> no forbidden numeric construct
hostile-mutations manifest entries      -> 45
hostile-mutations recorded result       -> 45/45 mutations caught (0 survived, 0 not-found)
```

## Tests re-measured on the promoted tree

```
vitest run                              -> 57 files, 1252 tests passed
vitest run --config vitest.config.backend.ts -> 68 files, 1603 tests passed
vitest run --config vitest.config.db.ts -> 138 files, 1636 tests passed
                                           total 4,491
```

## Security

```
npm audit --omit=dev
  -> {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
security:tracked-secrets   -> OK, 1502 files
security:browser-secrets   -> OK, 1502 files
validate:no-fake-data      -> OK, 1502 files
security:scope-exclusions  -> OK, 1502 files
```

Code-scanning alerts, `state=open`:

```
ref=refs/heads/develop -> 1 alert  | medium | js/http-to-file-access
                                   | scripts/ci/check-commit-checks.mjs | application=false
                          application 0 | critical 0 | high 0
ref=refs/heads/main    -> 1 alert  | identical disposition
                          application 0 | critical 0 | high 0
```

## Check-run populations, non-zero asserted before evaluation

```
develop  6bfa7a26 -> population 17 (total_count 17) tally {"success":17}
                     pending 0 failure 0 cancelled 0 timed_out 0 neutral 0
PR #109  6bfa7a26 -> population 36 (total_count 36) tally {"success":36}
                     ci-gate = success
main     5a043151 -> population 17 (total_count 17) tally {"success":17}
                     protected-gate = success
```

The PR population is larger because the pull-request workflow and the two push workflows run
the same reusable jobs against the same commit, plus the GitHub Advanced Security `CodeQL`
check that a pull request adds.

### Waiter correction

```
first waiter  -> "TERMINAL 18 pending=0"      while pr-ci run #59 was QUEUED
actual state  -> population grew 18 -> 35 -> 36; ci-gate ABSENT until the final iteration
corrected waiter requires, together:
  liveRuns == 0 (no queued/in_progress/waiting workflow run for the SHA)
  pendingChecks == 0
  required check present and completed
  population > 0
```

## Merge

```
PUT /pulls/109/merge  merge_method=merge  sha=6bfa7a26...
  -> HTTP 200, merged: true, sha 5a043151f3a0c3ce61e74515d496ec0622969839
```

## After the merge

```
git rev-parse origin/main            -> 5a043151f3a0c3ce61e74515d496ec0622969839
git rev-parse origin/main^{tree}     -> b032e0503f937fe07a9948fb094f94abde19af85
git rev-list --parents -n1 5a043151  -> 5a043151 9c2fea16 6bfa7a26   (exactly 2 parents)
git diff --exit-code 6bfa7a26 origin/main       -> exit 0
git diff --name-status 6bfa7a26 origin/main     -> empty (0 files)
non-.md diff                                    -> 0 files
merge-base --is-ancestor 6bfa7a26 origin/main   -> exit 0
merge-base --is-ancestor f5c3a02  origin/main   -> exit 0
merge-base --is-ancestor 9c2fea16 origin/main   -> exit 0 (no force push)
main gained 28 commits (the promotion merge plus the 27 develop commits)
```

Schema hash re-measured from the `main` tree: `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`.

## Deployment probes

```
GET /deployments                              -> 0
GET /environments                             -> 0, (none)
GET /actions/workflows/deploy-production.yml/runs    -> total_count 0
GET /actions/workflows/deploy-staging.yml/runs       -> total_count 0
GET /actions/workflows/release-verification.yml/runs -> total_count 0
GET /actions/runs?head_sha=5a043151           -> 2 runs: Protected branch verification, CI
grep -rn "^\s*environment:" .github/workflows  -> no match
git ls-remote --tags origin                   -> release-2-database-baseline only; no tag created
DEPLOYMENT_TRIGGERED = false
```
