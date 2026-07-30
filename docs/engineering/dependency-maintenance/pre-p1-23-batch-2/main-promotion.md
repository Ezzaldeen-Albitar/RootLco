# Pre-P1-23 batch 2 — main promotion

Written **before** the promotion, because §25 forbids adding a documentation-only
commit to `develop` after `main` is synchronized. The post-merge measurements are
reported in the closure report rather than committed here, which is the only way
to satisfy both requirements at once.

## Method

1. Freeze `FINAL_MAINTENANCE_DEVELOP_SHA` once every accepted unit is merged and
   protected `develop` is green.
2. **Pre-prove the merge tree** with `git merge-tree --write-tree origin/main
origin/develop`. Required: zero conflicts, and predicted tree byte-identical
   to `origin/develop^{tree}`. If it differs, diagnose the exact files before
   opening the pull request — never after merging.
3. Open a direct `develop → main` pull request titled
   _release: promote pre-P1-23 dependency maintenance batch_, with head exactly
   at the frozen SHA.
4. Require the full check population: non-zero, zero live runs, zero pending,
   `ci-gate` present, hosted clean room present, CodeQL present, mergeable state
   clean.
5. Merge with a **merge commit** — never squash, never rebase, never a direct
   push.
6. Prove afterwards: `develop` contained in `main`; `main` tree equals `develop`
   tree; full-tree diff 0; executable diff 0; migrations, schema hash, lockfile
   and workflows equal.
7. Wait for protected `main` checks and require the same population discipline.

## Deployment safety

The promotion must not deploy, and the surface is checked rather than assumed:

- `deploy-production.yml` and `deploy-staging.yml` are `workflow_dispatch`-only;
- no workflow declares an `environment:`, so no deployment object is created;
- `release-verification.yml` fires on tags, and **no tag is created**;
- `docker/build-push-action` runs with `push: false` at every call site, so no
  image reaches a registry — this batch upgraded that action, which is precisely
  why the setting was re-checked.

Required outcome: `DEPLOYMENT_TRIGGERED = false`, with deployments, environments
and releases all zero, and the tag count unchanged at one
(`release-2-database-baseline`, from P1-12).

## Merge-commit expectations

Exactly two parents: parent 1 the previous `main`, parent 2 the frozen
`develop`. No third branch is introduced, and no feature branch is merged to
`main` directly.
