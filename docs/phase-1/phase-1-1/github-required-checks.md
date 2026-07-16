# GitHub Required Status Checks — Exact Names

**Date:** 2026-07-16 · **Owner:** Eng. Ezzaldeen Al-Bitar (repository administrator) ·
**Related:** ADR-006 (Git Branching and Protected Main)

## The problem

The branch ruleset requires three status checks entered by hand as:

```
quality
docker
secrets
```

Those are the **job IDs** — the YAML keys in the workflow. GitHub does not report
checks under the job ID. It reports them under each job's **display name** (`name:`).
Because no check with the name `quality`, `docker`, or `secrets` is ever reported, the
ruleset waits forever and the pull request can never satisfy it.

This is a configuration mismatch, not a CI failure. Nothing in the workflow is broken by it.

## What the workflow actually produces

Read from `.github/workflows/ci.yml` (workflow `name: CI`):

| Job ID (YAML key) | Job display name (`name:`)       | Check-run name reported to GitHub | Shown in the PR UI as                 |
| ----------------- | -------------------------------- | --------------------------------- | ------------------------------------- |
| `quality`         | `Lint, types, tests, build`      | `Lint, types, tests, build`       | `CI / Lint, types, tests, build`      |
| `docker`          | `Docker build validation`        | `Docker build validation`         | `CI / Docker build validation`        |
| `secrets`         | `Secret and sensitive-file scan` | `Secret and sensitive-file scan`  | `CI / Secret and sensitive-file scan` |

The **check-run name is the job display name**. The `CI / ` prefix visible in the pull
request's checks list is the workflow name shown as the source; the ruleset matches on the
check-run name, and the picker lists it with the reporting app (GitHub Actions) beside it.

> Do not type these names by hand. Use the ruleset's search box, which lists checks GitHub
> has actually observed, and select them. Typing a name that is never reported reproduces
> exactly the bug documented here.

## Manual correction (required — not applied by this change)

Repository rules could not be modified from the build environment: no GitHub CLI is
installed and no API token is available. **No claim is made here that any ruleset was
changed.** The repository administrator must apply the following for `main` and again for
`develop`:

1. **Settings → Rules → Rulesets** → open the ruleset that targets the branch.
2. **Require status checks to pass** → ensure it is enabled.
3. **Remove the stale hand-entered names**: `quality`, `docker`, `secrets`.
4. **Add** the three checks by searching and selecting them:
   - `Lint, types, tests, build`
   - `Docker build validation`
   - `Secret and sensitive-file scan`
5. Keep **Require branches to be up to date before merging** enabled.
6. **Save** the ruleset.
7. Confirm on an open pull request that the three checks now report a result rather than
   showing "Waiting for status to be reported".

If a check does not appear in the search box, it is because GitHub has not yet observed a
run of it on the target branch. Push a commit (or re-run CI) once, then re-open the picker.

## Alternative the owners may prefer

The mismatch can be closed from either side. Instead of editing the ruleset, the job
display names in `.github/workflows/ci.yml` could be renamed to `quality`, `docker`, and
`secrets`, which would make the reported check names match the names already entered in the
ruleset — no GitHub UI access required.

That is **not** what this change does, for two reasons: the descriptive names are more
useful in the pull request UI, and renaming would silently change the check-run names,
invalidating any other ruleset or integration that references them. It is recorded here as
an option, not a recommendation, and it is the owners' decision.

## Why this matters beyond convenience

A required check that is never reported is indistinguishable, at a glance, from a required
check that is passing — both leave the merge button blocked with no red X. The failure mode
is a pull request that cannot merge for reasons the UI never states plainly. Recording the
exact names here means the next person does not have to rediscover it.
