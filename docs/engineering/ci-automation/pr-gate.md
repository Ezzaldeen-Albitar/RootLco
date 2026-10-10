# The pull-request gate

`pr-ci.yml`. Fifteen jobs: fourteen governed jobs plus the gate. One required check per base branch: `ci-gate` for a pull request into `main`, and — while the temporary policy [TDP-2026-10](#tdp-2026-10--temporary-development-path-policy) is in force — `ci-gate (development)` for a pull request into `develop`. The job table below predates `web-quality` and `authenticated-browser`; `pull-request-body.md` carries the counts that a test reconciles with the workflow.

## Why the workflow has no `paths:` filter

A required status check that never runs stays **Pending** forever and blocks the
merge with no failure to diagnose. That is CSA-06 and CSA-12 together, and it is
why change detection is a _job_ and not a trigger filter. The workflow always
starts; the jobs inside it decide.

## Jobs

| #   | Job                         | Runs when                                                                    | Blocks on                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `change-detection`          | always                                                                       | classification must be produced                                                                                                                                                                                                                                                                                                                                     |
| 2   | `static-quality`            | always                                                                       | format, lint, types, stylelint, YAML/JSON, actionlint, workflow security, shellcheck, encoding, canonical docs, no-fake-data, scope exclusions, module boundaries, authorization coverage, operation coverage, OpenAPI, P1-19/20/21 inventories, route↔registry parity, test honesty, forbidden files, conflict markers, lockfile consistency, generated-file drift |
| 3   | `unit-tests-coverage`       | always                                                                       | unit suite + coverage ratchet + critical-module floors + touched-file floor                                                                                                                                                                                                                                                                                         |
| 4   | `application-build`         | source, frontend, backend, OpenAPI, deps, config, docker, workflows          | environment contract, production build, output integrity, size ratchet                                                                                                                                                                                                                                                                                              |
| 5   | `database-migration-replay` | database, deps, workflows, scripts                                           | zero tables before, filename order, immutability, replay from zero, count, migration 120 absent, seeds twice, retention classes, permission totals, schema hash vs baseline, structural review, smoke reads, business tables empty, clean tree                                                                                                                      |
| 6   | `database-security`         | database, source, backend, tests, deps, workflows                            | database suite + role × table × action matrix                                                                                                                                                                                                                                                                                                                       |
| 7   | `integration-tests`         | source, backend, frontend, OpenAPI, tests, database, deps, workflows, config | backend suite + backend coverage + idempotency evidence + audit/outbox correlation                                                                                                                                                                                                                                                                                  |
| 8   | `dependency-security`       | always                                                                       | production advisories, dev advisories vs exceptions, prohibited packages, licences, dependency review                                                                                                                                                                                                                                                               |
| 9   | `code-security`             | source, tests, scripts, deps, workflows, config                              | CodeQL over `javascript-typescript` and `actions`                                                                                                                                                                                                                                                                                                                   |
| 10  | `container-security`        | docker, deps, source, config, workflows                                      | hadolint, both targets, Trivy, uid 1001, no secrets in layers, HEALTHCHECK, container serves `/api/health`, size ratchet                                                                                                                                                                                                                                            |
| 11  | `secret-scan`               | always                                                                       | tracked files, key material, repository scanners, workflow policy, build output                                                                                                                                                                                                                                                                                     |
| 12  | `hosted-clean-room`         | **always**                                                                   | the whole battery from nothing, at the exact head                                                                                                                                                                                                                                                                                                                   |
| 13  | `ci-gate`                   | `always()`                                                                   | everything above                                                                                                                                                                                                                                                                                                                                                    |

## Why the clean room can never be skipped

It is the single exact-SHA proof the acceptance criteria rest on, and a
documentation-only gate pull request is _required_ to demonstrate it. A clean
room that can be skipped is not a clean room. It costs one job per pull request;
that is the price of the proof.

## What `ci-gate` refuses

Beyond the obvious failure and cancellation:

- a skip that change detection said was required;
- a skip of an unconditionally required job, whatever the classification says;
- a skip when no classification exists at all;
- a governed job missing from `needs` — someone renamed or removed a job;
- a job in `needs` that the gate does not govern — someone added one;
- a tested SHA that differs from the SHA under review;
- any result that is not one of `success`, `skipped`, `failure`, `cancelled`.

All twenty-six of these paths have tests in `tests/ci/ci-gate.test.ts`.

## The gate summary

Every run writes a Markdown summary containing the head SHA, base SHA, changed
file classification, per-job results with the reason for each, coverage totals,
test totals per tier, OpenAPI totals, migration count, schema hash, image digest,
security findings, and the final **Go** / **No-Go**.

It is generated from the evidence JSON the jobs uploaded, never written
independently. Two hand-maintained copies of the same fact drift, and the one
people read drifts first.

## Migration rollback policy

Rollback is exercised only for migrations that explicitly declare
`-- rootlco:reversible`. None currently do, and the job says so rather than
silently passing.

Every migration in this repository is **forward-only** by policy. Inventing a
down-migration for an irreversible change — a dropped column, a rewritten row —
would prove a rollback that cannot happen in production, which is worse than
having no rollback test because it creates false confidence. Recovery from a bad
migration is a forward migration plus, if data was lost, the restore path the
nightly backup drill exercises.

## TDP-2026-10 — temporary development-path policy

**Approval.** The Owner approved a temporary development and GitHub CI policy on 2026-10-05,
with independent review. This section is the policy text. It takes effect when the pull
request that introduces it merges.

**Scope.** Only pull requests whose base is `develop`, and what happens on `develop` after a
merge. It does not apply to `main`, to tags, releases, deployments or the nightly run, and it
changes no phase-gate or promotion obligation. `main` stays fully protected: its ruleset
(19896793) is read, never written, and the complete required suite runs and must pass on the
final promotion pull request before anything enters `main`.

**Why.** Measured between 2026-09-27 and 2026-10-05 (5.76 days, 26 merged pull requests):
every develop push re-proved a tree that was identical to the pull-request head on 26 of 26
merges, and 38 records-only heads (1.46 per pull request) re-ran the full gate only to refresh
run records. A full green cycle took about 50 minutes on the critical path, set by the clean
room.

### What a pull request into `develop` runs

Every relaxation needs a `pull_request` event whose base is `develop`, decided in the workflow
file itself; anything missing, unknown, or disagreeing resolves to the full value.

| Job                                | When                                   | Minutes (measured mean / p50, 2026-09-27 to 2026-10-05) |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| `change-detection`                 | always                                 | 0.3                                                     |
| `static-quality`                   | always                                 | 2.9 / 3.1                                               |
| `unit-tests-coverage`              | always                                 | 2.8 / 3.0                                               |
| `dependency-security`              | always                                 | 0.7                                                     |
| `secret-scan`                      | always                                 | 0.4                                                     |
| `hosted-clean-room`, development   | always (full on escalation)            | about 5 (est.); the full profile's median is 50.0       |
| `web-quality`                      | when its triggers fire                 | 16.4 mean after #506 / 18.4 p50                         |
| `authenticated-browser`            | when its triggers fire                 | 18.0 p50                                                |
| `integration-tests`                | existing triggers, plus any API source | 10.8                                                    |
| `database-security`                | existing triggers, plus any API source | 3.7                                                     |
| `database-migration-replay`        | existing triggers                      | 1.0                                                     |
| `application-build`                | existing triggers                      | 1.2                                                     |
| `code-security`                    | existing triggers, plus any API source | 5.1                                                     |
| `container-security`               | existing triggers                      | 4.2                                                     |
| `ci-gate (development)` (the gate) | always                                 | 0.3                                                     |

The development clean room keeps the exact-SHA checkout, the lockfile install, the
zero-tables check, migrations and seeds twice, the structural review, the six domain
classification validators (`verify:classifications`, now also on `main`'s path), and the
aggregate leaves no other job proves: `verify:policies` (with the P1-27 records validators in
the requested records mode), `verify:contracts`, `verify:inventories`, and the API
workspace's typecheck, lint and format. It keeps the enumerated gates, the security scans and
the clean-tree check. It runs the serial one-database block (database suite, backend suite,
RLS matrix) and the Docker build with the uid check only when change detection says so.

Estimated wall time with jobs in parallel (est. until measured over the first ten develop
pull requests): documentation no test reads, about 6 minutes; tests outside `tests/ci`, about
6; application code, about 20; a database change, about 20; an escalation, about 50.

### Specialist triggers

`CATEGORY_RULES` and `classifyPath` in `scripts/ci/classify-changes.mjs` are unchanged and
byte-identical (a test compares them with `bd6b9179`). The development profile is an overlay
in `scripts/lib/development-profile.mjs`, matched on raw paths first:

- **Escalation to every job and the full clean room**: `.github/workflows/**`,
  `.github/actions/**`, `scripts/ci/**`, `scripts/lib/**`, `tests/ci/**`, `package.json`,
  `package-lock.json`, `apps/*/package.json`, TypeScript, ESLint, Vitest and Next.js
  configurations, `apps/web/playwright.config.ts`, the Dockerfile, `.dockerignore`, compose
  files, `supabase/config.toml`, any unmapped `.github` path or baseline, any unclassified
  path, and an empty diff. The classifier, the gate and this policy's own files are all
  inside that set.
- **Baselines** are routed to the job that reads them: the schema baseline to migration
  replay, database security and the serial block; the container, build-size, CodeQL and
  backend-coverage baselines to their jobs; every mapped baseline also to `web-quality`.
- **`authenticated-browser`** runs for any change under `apps/web/src/**`,
  `apps/api/src/**`, `supabase/**`, `apps/web/tests/e2e/**`, `apps/web/public/**`,
  `scripts/dev/**` or `scripts/platform/**`, except `**/*.scss`, `**/*.css` and
  `apps/web/src/i18n/messages/**` (Owner-adopted allow-list, pinned by a test). A test maps
  every authenticated spec to a path that triggers it, and a second test derives every
  repository script the job reaches (the npm entry points the job runs, the end-to-end tests,
  and their imports and spawned paths, transitively) and fails on one that is not a trigger.
- **`web-quality`** runs for `apps/web/**`, `apps/api/src/**`, `supabase/**`, `docs/api/**`,
  `docs/phase-1/**`, `docs/database/**`, the route checklist the route-scope test reads,
  `scripts/**`, `.github/ci-baselines/**` and `.prettierignore`. A test scans the web tests for
  repository-root reads and fails on one that is not a trigger.
- **The serial block** runs for `supabase/**`, `scripts/db/**`, `tests/db/**`,
  `tests/backend/**`, the database Vitest configurations, `apps/api/src/**/data/**`,
  `scripts/platform/**`, `scripts/dev/**` and the classification guards
  `scripts/check-*-classification.mjs`. The same derivation test walks every script
  `tests/backend/**` and `tests/db/**` import or spawn, transitively, and fails on one whose
  change would not run this block (the platform operator and backfill scripts and the
  owner-acceptance fixture setup were the gap it closed).
- **`integration-tests`** also runs for `scripts/p1-23-mutation-matrix.mjs` and
  `scripts/p1-24-mutation-matrix.mjs`, the hostile mutation matrices for the route
  authorization gate, the denial document and the finance blocker, which no clean-room
  profile, aggregate or unit test runs (fix round 2). A test reads, for every conditional
  job, the reusable workflow `pr-ci.yml` calls, keeps the steps that job's `task` selects,
  derives every repository script those steps reach (npm entry points and literal
  `scripts/...` paths, transitively), and fails on a non-escalation script whose change would
  not run that job. Two files the history scanner names only as allow-list data are pinned
  as exemptions, each proven to be that data entry.
- **Money and permissions**: any API source change runs integration, database security and
  CodeQL; the money screens (billing, payments, pricing, quotations, inventory, warranty,
  delivery, reports) run both web jobs; `validate:exact-money`, authorization coverage, the
  permission catalogue and `validate:p1-30-server-arithmetic` run on every pull request.

**Base and head.** Change detection runs the head's classifier and the BASE branch's copy of
it on the same diff and keeps the stricter answer for every job, block and profile. A base
copy that is missing, fails, or predates the policy resolves to the full set and to STRICT run
records, never to the head's records mode, and `ci-gate` refuses such a classification if it
says otherwise. Both decisions
are recorded in `classification.json`, and `ci-gate` checks that both are present and that
the result is their union. A skip is accepted only as `EXPECTED_SKIP` when both copies
recorded the job as not required.

**Forks.** In the development profile a fork pull request whose change requires
`authenticated-browser` is a No-Go: a maintainer must push the branch to this repository.

**Cancellation.** A newer push to the same pull request cancels the older run, keyed on the
pull-request number, as it already did for both bases. Nothing that deploys, releases or
touches a database other than an ephemeral CI container is ever cancelled.

### What was removed from the development path (measured job-minutes, 2026-09-27 to 2026-10-05)

| Removed                                                                       | Measured cost                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ci.yml` on pull requests into `develop`                                      | 99 runs, 2,088 job-minutes (about 21 per head)                 |
| `ci.yml` on push to `develop`                                                 | 26 runs, 569 job-minutes                                       |
| Protected verification on push to `develop`                                   | 26 runs, 3,614 job-minutes (median 119.4 per merge)            |
| Per-pull-request records cycles                                               | 38 records-only heads, 5,463 job-minutes (PR CI 4,657, CI 806) |
| Development clean room: the duplicate unit run                                | 113 s per run                                                  |
| Development clean room: the duplicate floored web tier                        | 678 s median per run                                           |
| Development clean room: `verify:web`, `verify:repository`, `format:check:all` | 926 s, 247 s and 109 s per run                                 |
| Development clean room: the serial database tiers, unless triggered           | 699 s per run                                                  |

Not removed: the standing `develop → main` pull request re-runs `main`'s full gate on every
develop push (22 runs, 1,607 job-minutes in the window). That is `main`'s path and no
workflow change touches it; the Owner may close that pull request between promotions.

The npm cache was fixed at the same time: a job that does not install no longer saves an
(empty) npm cache entry, and a version file in the cache key moves past the empty entries
without deleting anything. `npm ci` is unchanged.

### Landing owner and approved head

Owner instruction of 2026-10-06. Every pull request into `develop` has **one** explicit landing
owner — the person or worker assigned to merge it — and nobody else merges, approves, edits or
closes it. Immediately before merging, the landing owner runs, with `GH_TOKEN` in the
environment:

```
node scripts/ci/landing-guard.mjs --pr <number> --approved-head <40-character head SHA> --mark-reviewed
gh pr merge <number> --merge --match-head-commit <the same SHA>
```

The guard refuses (exit 1) unless the pull request is open, not a draft, based on `develop`,
and its current head is exactly the approved head — the head the independent review approved.
With `--mark-reviewed` it then sets the commit status **`independent-review`** to `success` on
that head, and re-reads the pull request to prove the head did not move meanwhile.
`--match-head-commit` makes GitHub refuse the merge if the head moves after that. If the
guard refuses, nothing is merged; the landing owner reports the refusal.

`independent-review` is required by **no ruleset**. Neither `develop`'s ruleset (19896821) nor
`main`'s (19896793) changes. It is checked after the merge, by the integrity job below, so a
merge that skipped the guard, or merged a head other than the one marked, is reported rather
than absorbed. The guard is repository tooling, not orchestration tooling: the status it sets
is read by a workflow in this repository, so the setter and the reader share one context name
and are reviewed and tested together (`tests/ci/landing-guard.test.ts`).

### After a merge into `develop`

`ci.yml` and the protected verification workflow no longer run on a push to `develop`.
`develop-merge-integrity.yml` runs instead, about 0.5 minutes (est.), with read-only
permissions, a sparse checkout of `scripts/ci` and a concurrency group per commit. Through
`scripts/ci/develop-merge-integrity.mjs` it asserts that the pushed commit M is a merge, and
then, failing on any one of them:

1. tree(M) equals tree(M^2), the pull-request head;
2. M^2, the **tested candidate**, carries a successful `ci-gate (development)` check run from
   GitHub Actions, at that commit, produced by `pr-ci.yml`;
3. M^2, the **approved head**, carries a successful `independent-review` status — a missing
   status, a status on another commit, or one that is not `success` fails;
4. exactly one pull request names M as its merge commit; it was based on `develop` and its
   recorded head is M^2. Only that pull request is cited in the summary: the commit-to-pulls
   listing also returns every open pull request that contains the commit, such as the standing
   promotion pull request, and none of those is the one that merged.

It then prints **merged, full checkpoint verification pending**, which is the fixed wording for
every merge. Tree equality holds by construction once `develop` requires branches to be up to
date. `tests/ci/develop-merge-integrity.test.ts` exercises each refusal (a matching status, a
missing one, one on another SHA, a tree mismatch, the gate run and the attribution).

### Known limitations of the landing guard

Recorded at the independent review of 2026-10-06.

- **The integrity script has not run live.** `tests/ci/develop-merge-integrity.test.ts` fails on
  a missing review status, a status on another SHA, a status read answering for a different
  SHA, a pending status, a tree mismatch, a non-merge commit, and a gate run that is missing,
  failed, foreign or from another workflow; it cites only the pull request whose
  `merge_commit_sha` matches. The live `commits/{M}/pulls` listing was read for four recent
  `develop` merges: it returns the merged pull request with a matching `merge_commit_sha` plus
  the open pull requests that contain the commit, so the attribution filter fits real data. The
  first live run is the merge of the pull request that introduces it, and that run needs
  `landing-guard --mark-reviewed` first.
- **`independent-review` is a self-asserted commit status in no ruleset.** Anyone holding a
  token that can write statuses can set it, and a missing status is detected only after the
  merge. No workflow in the repository requests `statuses: write`.
- **The `main` path is unchanged.** `develop-merge-integrity.yml` is the only `.github` file the
  change touches, `workflow-context-producers.test.ts` passes, and `check-workflow-security`
  reports no findings. The change adds no disable, skip or only directive and edits no CI
  baseline.
- **Records outside the repository.** VL-CI-005 and VL-DB-003 in
  `docs/product/owner-directive-2026-09-16/capability-status.md` cite a coordinator record
  outside the repository, which cannot be verified from here; their wording is hedged "per
  coordinator record".
- **Stale record text.** The VL-DB-004 and VL-CI-006 rows still say "number assigned when it
  opens" and "not executed" (hosted), although the pull request is open (#522) and its hosted
  `ci-gate (development)` run at `b9690696` concluded success. That record text is updated at
  closure.
- **Local unit tier under load.** One full local unit run had three timeouts
  (`p1-28-access-gate`, `p1-28-evidence-manifest`, `tailwind-theme-gate`); all three files pass
  when re-run in isolation (192 of 192), and the hosted unit-coverage check passed.

### Checkpoints

A checkpoint is due at the end of every coherent batch (declared by the planner), before
every phase gate, and before any promotion pull request is opened. The first checkpoint
(VL-CI-001) is dispatched immediately after this policy merges, and no new batch starts until
it passes.

1. If `develop` does not contain `main`'s tip, a sync pull request merges first.
2. Every merge-integrity run since the previous checkpoint must be green.
3. Dispatch **Protected branch verification** on `develop` with `candidate-sha` = the
   40-character tip D and `checkpoint-id` = `CP-YYYYMMDD-N`:
   `POST repos/Ezzaldeen-Albitar/RootLco/actions/workflows/protected-develop-verification.yml/dispatches`
   with `{"ref":"develop","inputs":{"candidate-sha":"<D>","checkpoint-id":"CP-YYYYMMDD-N"}}`.
   Every job runs in the full profile; the gate's first step refuses a run whose commit is not
   D; the concurrency group is keyed on the candidate, so two checkpoints never displace each
   other. A cancelled or displaced run is never evidence; it is re-dispatched. The records
   validators defer drift to the next step only on this exact dispatch.
4. One records pull request into `develop` runs `npm run record:p1-27-run -- <tier> --hosted-run <run>`
   per tier and refreshes the pages and manifests as before. It edits the run ledger, so its
   gate judges records STRICT; change detection reports whether it stayed inside the records
   allow-list (`records-only`). It carries nothing else, and nothing merges into `develop`
   between D and it. It merges as D'.
5. The checkpoint passes only with: protected-gate Go at D, the records pull request's STRICT
   gate green with the unit and web tiers at D', `records-only` true for the records pull
   request, D' directly on D (the first parent of D' is D), and green merge-integrity runs.
   Both run links, both commits, the first parent of D' and the records-only value go in the
   hosted checkpoint register, and `tests/ci/verification-ledger.test.ts` refuses a passed
   row that lacks them or that git contradicts: it recomputes the first parent of D' and the
   files between D and D' against the records allow-list.
6. One local runtime rebuild with browser and reconciliation QA at D'. It is recorded as a
   local result and never presented as a GitHub check.

On failure, fixes go through the development gate and a new dispatch follows; no dependent
batch starts, and the failed register row is kept.

### Records and evidence

`scripts/ci/check-p1-27-closing-values.mjs` and `check-p1-27-doc-counts.mjs` run STRICT unless
a deferral is REQUESTED (`--mode checkpoint-deferred`, or the `ROOTLCO_RECORDS_MODE` variable
the clean room sets on purpose) AND corroborated: a pull request into `develop` run by
`pr-ci.yml`, or the checkpoint dispatch of the protected workflow on `develop` with a valid
checkpoint id. Without a request no `GITHUB_*` variable is read. In the deferred mode only
growth since the last record moves to a computed `pending` list
(`RUN_RECORD_EXECUTABLE_DRIFT`, `RUN_RECORD_FILES_BEHIND_TREE`, `DERIVED_VALUE_BEHIND_TREE`,
`DOC_MARKER_BEHIND_TREE`), printed as a notice and in the step summary. A shrink, a lost file,
a record wrong for its own commit or off the tree's history, a dirty or failed run, and every
classification, provenance, digest and lifecycle check stay fatal in both modes. Sealed and
historical pages are not rewritten; pages are refreshed only by checkpoint records pull
requests. `local-run-ledger.json` gains no field.

### Ledger

The verification ledger and the hosted checkpoint register live in
`docs/product/owner-directive-2026-09-16/capability-status.md`, enforced by
`tests/ci/verification-ledger.test.ts`: five states only, a full checkpoint pass must cite a
complete register row, a targeted hosted pass a run at a SHA, a pending row where it is owed,
and no column but State may claim a pass. The register is append-only.

### Activation

The order below is the only feasible one. Until step 3, `develop`'s ruleset requires `ci-gate`
and the four `ci.yml` names; the change's own pull request produces `ci-gate (development)` and
no `ci.yml` run, there are no bypass actors, and no admin bypass is allowed, so the change
cannot merge before the ruleset changes.

1. The independent review of the change (VL-CI-002).
2. Save `develop`'s ruleset (19896821) as the before snapshot, outside the repository.
3. PUT `develop`'s ruleset: the required contexts become `ci-gate (development)`, and strict
   (branches must be up to date) is turned on. Nothing else changes; `main`'s ruleset is only
   read.
4. Update the change pull request to the `develop` tip if strict requires it, and let its gate
   finish on that head.
5. Merge it at once.

Between steps 3 and 5 every other open pull request into `develop` is blocked: its runs come
from the workflow on its merge ref, which still emits `ci-gate` and the `ci.yml` names. Nothing
else merges into `develop` in that window. After step 5 each of those pull requests must be
updated to the `develop` tip, which strict requires anyway, and its next run emits
`ci-gate (development)`. The live probes (VL-CI-004) need the merged workflows and follow step
5: probe A is the next real pull request into `develop`, probe B the next synchronize run of the
standing promotion pull request, observed passively.

### Known limitations

Recorded at the independent reviews of the change (fix round 1, 2026-10-05; fix round 2,
2026-10-06). None of these is hidden by a skip; each is either mitigated as stated or owed at
the next checkpoint.

- **Fix round 1, re-checked at the round-2 review against the head and a probe.** All four
  fixes hold. (1) `scripts/platform/**` and `scripts/dev/**` run the serial database block
  and `authenticated-browser` (probe: `grant-platform-authority.mjs` gives the block and the
  browser job required). (2) The activation order (review, snapshot, `develop` PUT, update,
  merge at once) is consistent here, in `branch-ruleset.md` and in
  `github-required-checks.md`, and VL-CI-002 and VL-CI-004 are split. (3)
  `verification-ledger.test.ts` refuses a passed checkpoint row that lacks `records-only=true`
  or `first-parent(D')==D`, or that git contradicts. (4) `keepStricter` fails closed: a null,
  garbage or pre-policy-shape base gives STRICT records, a full clean room, every job required
  and `recordsOnly=false`, and `profileFailures` also refuses a non-strict mode when the base
  is unavailable.
- **This change is judged STRICT by its own base.** `develop` before this change has no policy
  module, so `keepStricter` resolves this pull request to the full set and STRICT records. It
  refreshes its own records under the old gate; there is no bootstrap exception.
- **Rename blind spot.** Change detection uses `git diff --name-only BASE...HEAD` without
  `--no-renames`, which drops the source path of a rename (seen on `cb40d9e5`: the R100 source
  under `supabase/migrations` is absent from the name-only list). Under the development
  profile a move out of a triggered directory is classified by its destination only. Mostly
  mitigated: shrinks in the `supabase/migrations`, `tests/db` and `tests/backend` derived
  markers stay fatal, and `typecheck:api` and `verify:contracts` always run. Adding
  `--no-renames` for base `develop` would close it.
- **A checkpoint row's dispatch run is checked for URL shape only.** Nothing mechanically ties
  the cited run's `head_sha` or its protected-gate Go to D. The workflow's pin step enforces
  candidate == `github.sha` at dispatch time; the register test cannot.
- **The npm cache fix is UNVERIFIED until observed.** On `609d8628` a non-installing job
  logged automatic npm caching with `cache` empty (setup-node v7 caches on its own when
  `package.json` names npm as its `packageManager`), and the version-1 key was pre-filled by an
  empty entry. Fix round 2 passes `package-manager-cache` beside `cache` and bumps
  `npm-cache.version`; a hosted installing job's log must show a non-trivial cache size before
  the fix is stated as working.
- **Self-certification is inherent to the `pull_request` trigger.** The head's `pr-ci.yml`,
  `keepStricter` and `evaluate-ci-gate.mjs` all come from the pull request's merge ref, so a
  pull request that edits all three can ignore the base copy. Escalation of those paths holds
  only if the head code honours it; every such path escalates to the full set. The real
  mitigations are the independent review (required approvals are 0) and the next checkpoint.
- **`main`'s protection, as read at the round-2 review.** Rulesets 19896793 (`main`, updated
  2026-07-31) and 19896821 (`develop`, updated 2026-07-29) were read only, are unchanged, and
  both still require `ci-gate` plus the four `ci.yml` contexts with no bypass actors. Only
  `ci.yml` jobs (a pull request into `main` or a push to `main`) and `pr-ci.yml`'s gate (base
  `main` only) can emit those contexts. The review's probe ran 12000 `main`, push, dispatch
  and no-option classifications against the `origin/develop` classifier: 0 job mismatches,
  all full and strict. On base `main` the evaluator refuses a skipped `web-quality` or browser
  tier, a neutral or cancelled job, a development classification, a development clean room,
  deferred records and missing profile evidence; on a push to `main` it refuses deferred
  records. No new concurrency group can cancel a `main` or deployment run: the protected group
  falls back to `github.ref` on a push and never cancels, merge integrity is grouped per
  commit with cancel off, and the deploy workflows are untouched.
- **STRICT on `main` is no longer byte-identical; it is stricter.** These now run on `main`,
  release and nightly paths: the always-fatal `RUN_RECORD_HEAD_NOT_ANCESTOR` and
  `RUN_RECORD_FILES_WRONG_FOR_ITS_HEAD` checks (`tierFilesAt` recomputes with today's walk rule
  over an old tree), `markerSelfCheck` inside the doc-counts `evaluate()`,
  `verify:classifications` in every clean room (release verification included), and the
  `cleanRoomProfileFailures` check on a protected push to `main`. That can fail a future
  promotion that `bd6b9179` would have accepted. Nothing on `main` is weakened.
  `verify:classifications` exists at `main` `1262de74`; an older ref may not have it.
- **Unit-tier assertions are narrowed on all paths, `main` and nightly included.** The
  `p1-27-doc-counts`, evidence-manifest and closing-values tests now compare against
  `measuredAtCommit`, use `>=` for the live tree, and filter `DERIVED_VALUE_BEHIND_TREE` and
  `DOC_MARKER_BEHIND_TREE`. `main`'s net gate is unchanged only because the STRICT validators
  still run in its full clean room (`verify:workspaces` → `verify:policies`, with
  `ROOTLCO_RECORDS_MODE=strict`).
- **`clean-room-profile.json` records the REQUESTED records mode, not the effective one.** A
  protected-verification dispatch on `main` records `checkpoint-deferred` while the resolver
  actually applies STRICT. `protected-develop-verification.yml` requests deferral for every
  dispatch instead of keying the request on `refs/heads/develop`.
- **This pull request stays blocked until `develop`'s ruleset is PUT.** Strict up-to-date
  then requires the head to contain the `develop` tip at merge time. At the round-2 review it
  did: `ae1bbc75` merges `develop` `d8d5fa9a`, and a re-merge gives the identical tree
  `b3901b77`. If `develop` moves before activation, a new records and run cycle is owed, and
  the new hosted run is re-triaged before merging.
- **Never executed live, and UNVERIFIED until observed:** the base-`main` path of the new
  `pr-ci.yml` (`ci-gate` name, full profile, clean-room-profile evidence; probe B is the next
  synchronize run of the standing promotion pull request, observed passively only),
  `develop-merge-integrity.yml` (its first run is this change's own merge), and the
  checkpoint dispatch path (the pin step, the candidate-SHA concurrency group, case-b deferral).
- **Commit author identity.** Every commit of this change is authored as `verify`, the
  pre-existing local convention on `develop`; it is not new here.
- **Per-pull-request records edits persist for some changes.** The D1 and D2 assertions of
  `apps/web/tests/p1-27-doc-reconciliation.test.ts` still compare against the live tree, so a
  pull request into `develop` that adds web tests, `scripts/ci` scripts or CRM and vehicle
  features must still edit `deliverable-manifest.md`.
- **Paths outside the triggers get no web tier and no authenticated browser.** For example
  `tests/**` outside `tests/ci`, `CONTRIBUTING.md`, `docs/engineering/**`, and `docs/product/**`
  other than the route checklist. The styles and translations exemption from the browser tier
  follows planner decision 4. An escape surfaces only at the checkpoint.
- **`records-only` was computed and exported but consumed by nothing.** Fix round 1 makes it,
  and D' sitting directly on D, explicit conditions of a passed checkpoint, recorded in the
  register and recomputed from git by `tests/ci/verification-ledger.test.ts` (see
  [Checkpoints](#checkpoints)). Change detection's output is still not consumed by `ci-gate`.
- **Local gaps.** `actionlint` and the workflow-security validator were not run locally (the
  hosted `static-quality` job ran them). Plain `prettier --check` exits 2 on
  `.github/actions/setup-project/npm-cache.version`, which has no parser, and is clean with
  `--ignore-unknown`.

### Proof that `main` is unchanged

- `tests/ci/workflow-context-producers.test.ts`: `main`'s five contexts can be produced only
  by `pr-ci.yml`'s gate on a pull request into `main` and by the four `ci.yml` jobs on a pull
  request into `main` or a push to `main`.
- `tests/ci/development-profile.test.ts`: `declaredJobsFor('full')` is `DECLARED_JOBS` and
  equals the `bd6b9179` declaration; every relaxing expression in `pr-ci.yml` evaluates to
  the full value for a pull request into `main`; the full clean room is a superset of
  `bd6b9179`'s, step for step, including each `if:`, with one enumerated addition
  (`verify:classifications`, plus the step that validates and records the profile).
- Live, without cost: the next run of the standing promotion pull request must show
  `ci-gate`, the full profile, every check run, the full clean room with
  `verify:classifications`, and the four `ci.yml` contexts.
- Rulesets: `main`'s ruleset receives GET calls only; before and after snapshots are kept
  outside the repository.

### Review point and restoration

The review is due at the earliest of: the next `develop → main` promotion or the P1-G31
decision; **2026-11-05**; or immediately on an escape — a checkpoint failure caused by a
defect a skipped specialist job would have caught, recorded as a VL-CI row. There is no
automatic expiry: an automatic flip would leave `develop` requiring a check-run name nothing
produces. The gate summary prints the review date on every development-profile run and warns
once it has passed. The review is logged as VL-CI-003.

Restoration, in this order, which avoids a deadlock:

1. Restore `develop`'s ruleset (19896821) from its saved "before" snapshot: the contexts
   `ci-gate` and the four `ci.yml` names, and strict as it was.
2. Open a pull request into `develop` with `git revert -m 1 <the policy's merge commit>`. Its
   runs come from the reverted workflows, so they emit `ci-gate` and the `ci.yml` contexts.
3. Merge that pull request.

`local-run-ledger.json` gains no field, so the pre-policy validators accept it, and the
ledger rows are documentation the reverted gates ignore. `main` needs no restoration because
it is never changed.

While the policy is in force, full verification remains mandatory at every checkpoint, at
every phase gate, and on the final promotion pull request, which runs `main`'s complete
required suite at its final head.
