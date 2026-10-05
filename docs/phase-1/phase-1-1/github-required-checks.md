# GitHub Required Status Checks — Exact Names

**Date:** 2026-07-16 · **Owner:** Eng. Ezzaldeen Al-Bitar (repository administrator) ·
**Related:** ADR-006 (Git Branching and Protected Main);
[solo-developer-review-policy.md](../../governance/solo-developer-review-policy.md)
(approving-review count is 0 under that policy; required CI checks remain mandatory)

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

| Job ID (YAML key) | Job display name (`name:`)          | Check-run name reported to GitHub   | Shown in the PR UI as                    |
| ----------------- | ----------------------------------- | ----------------------------------- | ---------------------------------------- |
| `quality`         | `Lint, types, tests, build`         | `Lint, types, tests, build`         | `CI / Lint, types, tests, build`         |
| `docker`          | `Docker build validation`           | `Docker build validation`           | `CI / Docker build validation`           |
| `database`        | `Database migrations and RLS tests` | `Database migrations and RLS tests` | `CI / Database migrations and RLS tests` |
| `secrets`         | `Secret and sensitive-file scan`    | `Secret and sensitive-file scan`    | `CI / Secret and sensitive-file scan`    |

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
4. **Add** the four checks by searching and selecting them:
   - `Lint, types, tests, build`
   - `Docker build validation`
   - `Database migrations and RLS tests` _(added by Phase 1-2 — carries the migration
     immutability, clean-database replay, RLS-isolation, and business-table scope
     controls; with required approving reviews at 0 under the Solo Developer Review
     Policy, required status checks are the only technical merge gate, so this check
     is not optional)_
   - `Secret and sensitive-file scan`
5. Keep **Require branches to be up to date before merging** enabled.
6. **Save** the ruleset.
7. Confirm on an open pull request that the four checks now report a result rather than
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

## Dated note — 2026-10-05: the temporary development-path policy (TDP-2026-10)

This note records live state read from the GitHub API on 2026-10-05 and a change made in a
pull request; it changes no ruleset by itself. Each branch has one ruleset and no classic
branch protection. Both rulesets require five contexts from GitHub Actions: `ci-gate` and the
four `ci.yml` display names in the table above. Required approvals are 0 on both, there are no
bypass actors, and `main` requires branches to be up to date while `develop` did not.

Under TDP-2026-10 (Owner approval 2026-10-05), the pull-request gate's check run is named by
its base branch:

- a pull request into `main` emits `ci-gate`, exactly as before, and `ci.yml` still runs on a
  pull request into `main` and on a push to `main`, so all five of `main`'s contexts are still
  produced, at the final head, by the same jobs;
- a pull request into `develop` emits `ci-gate (development)` and does not run `ci.yml`.

`main`'s ruleset is not changed by this policy and must not be. `develop`'s ruleset is changed
in a separate, recorded step to require only `ci-gate (development)` with branches required
to be up to date. That step comes BEFORE the change merges, not after: until it, `develop`'s
ruleset requires `ci-gate` and the four `ci.yml` names, which the change's own pull request
does not produce, so the change cannot merge first. The activation order is the only feasible one, because `develop`'s current ruleset requires contexts this change no longer produces on a pull request into `develop`, there are no bypass actors, and no admin bypass is allowed: (1) the independent review of the change (VL-CI-002); (2) save `develop`'s ruleset as the before snapshot, outside the repository; (3) PUT `develop`'s ruleset with the required context `ci-gate (development)` and strict on; (4) update the change pull request to the `develop` tip if strict requires it and let its gate finish; (5) merge it at once. Between steps 3 and 5 every other open pull request into `develop` is blocked, because its runs still come from the old workflow and emit `ci-gate`; after the merge each one must be updated to the `develop` tip (which strict requires anyway), and its next run emits `ci-gate (development)`. No other pull request merges into `develop` in that window. The live probes (VL-CI-004) follow the merge. `tests/ci/workflow-context-producers.test.ts` holds `main`'s five
contexts to their only permitted producers. The policy, its review point and the restoration
order are in `docs/engineering/ci-automation/pr-gate.md`.
