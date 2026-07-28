# Current-State CI Audit

**Scope.** Everything GitHub Actions executes for this repository as of the protected
baseline `origin/develop = 0f8268ef80a51441625cfe93d037e7c0804f40fa` (P1-21 Inventory
Backend, closed Go). This document is the Wave 0 gate: the comprehensive assurance
platform is designed against what is _actually_ here, not against what the workflow
comments claim.

Every finding below was read out of the files, not inferred. Where a claim is a
judgement rather than an observation it is marked **Assessment**.

---

## 1. Workflow inventory

| File                                     | Name                      | Size     | Triggers                                                                            | Jobs                                       |
| ---------------------------------------- | ------------------------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| `.github/workflows/ci.yml`               | `CI`                      | 19 382 B | `pull_request` → `develop`, `main`; `push` → `develop`, `main`; `workflow_dispatch` | `quality`, `docker`, `database`, `secrets` |
| `.github/workflows/p1-21-clean-room.yml` | `P1-21 Hosted Clean Room` | 9 272 B  | `pull_request` → `develop`, `main`; `workflow_dispatch`                             | `clean-room`                               |

`.github/dependabot.yml` — **does not exist**.

There is no nightly workflow, no release workflow, no deployment workflow, no reusable
workflow, and no composite action.

### 1.1 `ci.yml` job detail

| Job        | Runner          | Timeout | Services                      | Steps                                                                                                                                                                                                              |
| ---------- | --------------- | ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quality`  | `ubuntu-latest` | 20 min  | —                             | checkout, setup-node, `npm ci`, lint, module-boundaries, authorization-coverage, operation-coverage, P1-19/20/21 inventories, openapi, typecheck, format:check, style:check, encoding, `npm test`, `npm run build` |
| `docker`   | `ubuntu-latest` | 25 min  | —                             | checkout, buildx, `docker compose config`, build `dev`, build `runner`, assert non-root uid                                                                                                                        |
| `database` | `ubuntu-latest` | 15 min  | `postgres:17-alpine` on 54322 | checkout (depth 0), setup-node, `npm ci`, migration-immutability diff, apply migrations, seed twice, six classification validators, `npm run test:db`, `npm run test:backend`                                      |
| `secrets`  | `ubuntu-latest` | 10 min  | —                             | checkout (depth 0), setup-node, tracked `.env` check, key-material check, scope-exclusions, tracked-secrets, browser-secrets, no-fake-data                                                                         |

### 1.2 `p1-21-clean-room.yml` job detail

One job, `clean-room`, `ubuntu-latest`, 45 min, `postgres:17-alpine`. 21 steps. It is the
only place in the repository that checks out `github.event.pull_request.head.sha`, asserts
zero application tables before migration, computes a schema hash before **and** after the
suites, and asserts a clean worktree afterwards.

---

## 2. Cross-cutting configuration

| Property                    | `ci.yml`                                                                                               | `p1-21-clean-room.yml`                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `permissions`               | `contents: read` (workflow level)                                                                      | `contents: read` (workflow level)                                                       |
| `concurrency`               | `ci-${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`                              | `p1-21-clean-room-${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true` |
| Caching                     | `actions/setup-node` `cache: 'npm'` in `quality` and `database`; `type=gha` BuildKit cache in `docker` | `actions/setup-node` `cache: 'npm'` only                                                |
| Path filters                | none                                                                                                   | none                                                                                    |
| Artifacts uploaded          | **none**                                                                                               | **none**                                                                                |
| Repository secrets consumed | **none**                                                                                               | **none**                                                                                |
| Environment variables       | `NEXT_TELEMETRY_DISABLED`, three `NEXT_PUBLIC_*` placeholders                                          | same                                                                                    |

Both workflows are entirely secret-free. That is a real strength and the new platform
preserves it: nothing in the PR path may require a credential to pass.

---

## 3. Findings

Numbered `CSA-nn`. Severity is about the _assurance_ the pipeline provides, not about
production risk.

### CSA-01 — `cancel-in-progress` on protected-branch pushes can destroy authoritative evidence — **High**

`ci.yml` uses one concurrency group for both `pull_request` and `push` events and sets
`cancel-in-progress: true` unconditionally. Two merges landing on `develop` in quick
succession cancel the older protected-push run. The gate record for every phase cites a
protected push CI run number as proof; a cancelled run is not proof, and the cancellation
is silent unless somebody opens the Actions tab.

_Fix in the new platform:_ protected-branch verification lives in its own workflow with
`cancel-in-progress: false` and a group keyed on the branch.

### CSA-02 — no artifacts are uploaded anywhere — **High**

Neither workflow calls `actions/upload-artifact`. Every piece of evidence — coverage,
schema inventory, structural review, migration log, image digest — exists only inside a
log that GitHub eventually expires. Diagnosis of a failure therefore depends on scrolling
a live log, which is exactly the "truncated failure log used as final diagnosis" failure
mode the initiative is meant to eliminate.

### CSA-03 — third-party and first-party actions are pinned to mutable tags — **High**

Every `uses:` in the repository is a major-version tag:

| Action                       | Current reference     |
| ---------------------------- | --------------------- |
| `actions/checkout`           | `@v4` (5 occurrences) |
| `actions/setup-node`         | `@v4` (3 occurrences) |
| `docker/setup-buildx-action` | `@v3`                 |
| `docker/build-push-action`   | `@v6`                 |

A tag is a moving pointer. `ci.yml` acknowledges this in a comment and defers it to
`docs/phase-1/phase-1-1/security-readiness.md`. On a **public** repository this is a
supply-chain exposure with a trivial fix.

### CSA-04 — `ci.yml` proves commands pass, not that the tree is sound — **High**

Three assertions are absent from `ci.yml` and each fails _silently_:

1. no zero-application-tables check before the first migration;
2. no schema hash at all — a suite that mutated the schema leaves no trace;
3. no clean-worktree check — a suite that writes a tracked file is invisible.

`p1-21-clean-room.yml` closes all three, but it was authored as a phase-scoped workflow
(its name and file both carry `p1-21`) and nothing generalises it.

### CSA-05 — `actions/checkout` uses the merge ref on `pull_request` — **High**

`ci.yml` never sets `ref:`. On a `pull_request` event `actions/checkout` defaults to
`refs/pull/N/merge`, a synthetic commit that exists nowhere in branch history. Every
`ci.yml` result is therefore about a tree that will never be committed. It is a reasonable
default for "will this merge work", but it is **not** exact-SHA evidence, and phase gate
records have been citing `ci.yml` run numbers as if it were.

### CSA-06 — the required-check set is fragile and job-name-shaped — **High**

Branch protection requires the _job names_ `Lint, types, tests, build`, `Docker build
validation`, `Database migrations and RLS tests`, `Secret and sensitive-file scan`. There
is no aggregating gate. Consequences:

- renaming a job silently removes a required check;
- adding a job does not add a required check;
- a job that never runs leaves the check **Pending** forever rather than failing.

### CSA-07 — no coverage gate exists — **High**

`vitest.config.ts` configures a v8 coverage provider with `reporter: ['text-summary',
'json-summary']` and an explicit 13-entry `include` allow-list, but **no thresholds** and
**no CI step invokes it**. `npm run test:coverage` is never called by any workflow.
Measured baseline over the configured include set (this branch, local, Node 24):
statements 91.06 % (1355/1488), branches 93.62 % (338/361), functions 84.87 % (101/119),
lines 91.06 %. Nothing prevents that from going to zero.

### CSA-08 — production dependencies carried three unpatched HIGH advisories — **High** _(remediated in this initiative)_

No workflow runs `npm audit`. At the baseline SHA `npm audit --omit=dev` reported 3 HIGH
findings covering 13 advisories in the production path: `next@16.2.10`
(GHSA-6gpp-xcg3-4w24 proxy bypass, GHSA-89xv-2m56-2m9x SSRF, GHSA-p9j2-gv94-2wf4 SSRF,
GHSA-955p-x3mx-jcvp unauthenticated Server Function disclosure, GHSA-68g3-v927-f742 and
GHSA-4633-3j49-mh5q cache confusion, GHSA-m99w-x7hq-7vfj DoS, GHSA-4c39-4ccg-62r3
unbounded payload, GHSA-q8wf-6r8g-63ch image DoS), `postcss@8.4.31` (GHSA-qx2v-qp2m-jg93,
GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849) and `sharp@0.34.5` (GHSA-f88m-g3jw-g9cj).

See `security-model.md` §4 for the remediation and the one residual dev-only exception.

### CSA-09 — no SAST, no container scanning, no dependency review — **High**

`ci.yml` builds two Docker images and asserts one property (uid ≠ 0). It never scans them.
There is no CodeQL workflow, no SARIF upload anywhere, and no `dependency-review-action`.

### CSA-10 — GitHub-native security features are all disabled — **High**

Carried forward from P1-21 as `P1-21-A-01`. On the now-public repository: Secret Scanning
**disabled**, Push Protection **disabled**, Dependabot alerts **disabled**, Dependabot
security updates **disabled**, Code scanning **not configured**. The absence of alerts is
not evidence of cleanliness — nothing is watching. These are owner/admin settings changes,
not repository content; see `security-model.md` §7.

### CSA-11 — `npm ci` and `setup-node` are duplicated four times — **Medium**

Identical five-line setup blocks appear in `quality`, `database`, `secrets` (partially) and
`clean-room`. Node version `'22'` is written out four times. Drift between them is a matter
of when, not whether.

### CSA-12 — a heavy job cannot be skipped safely — **Medium**

There are no path filters and no change detection, so a docs-only pull request runs the
full Docker build and the full database suite. Adding top-level `paths:` filters would be
worse: a required check that does not run stays **Pending**, blocking the merge forever
(CSA-06). Change detection therefore has to be a _job_, not a trigger filter.

### CSA-13 — database and backend suites share one mutable database — **Medium** _(currently safe)_

In `ci.yml`'s `database` job, `npm run test:db` and `npm run test:backend` run
sequentially against the same service container. Both vitest configs set
`fileParallelism: false`, so _within_ each suite files are serial. The two suites are also
serial because they are consecutive steps. This is correct today and correct only by
accident of step ordering — nothing asserts it. `p1-21-clean-room.yml` adds `npm test`
against the same database.

### CSA-14 — generated evidence is validated but never regenerated in CI — **Medium**

`validate:openapi` checks that the _committed_ `docs/api/openapi.v1.json` is
well-formed. `tests/openapi-contract.test.ts` regenerates it from the operation registry
and compares. The endpoint-inventory scripts run with `--check`. So drift _is_ caught —
but by tests rather than by a `git diff --exit-code` after regeneration, and the P1-20
lesson recorded in memory is that a route stays invisible to the contract test until an
import line is added, at which point _both_ sides agree on the same incomplete registry.
A regenerate-then-diff step is strictly stronger.

### CSA-15 — no test-honesty enforcement — **Medium**

Nothing detects `.only`, unexpected `.skip`, `|| true`, a swallowed exit status, an empty
suite, or a retry configuration. P1-21 hit exactly this class twice: a unit suite that was
red at every commit while being reported green, and a regression assertion that would have
passed against the bug it was written for.

### CSA-16 — Prettier/JSON/YAML/shell/Markdown/workflow linting is partial — **Medium**

`format:check` covers what `.prettierignore` allows. There is no `actionlint`, no
`shellcheck` over `scripts/db/backup-restore-drill.sh` and `scripts/git-push-retry.sh`,
no standalone YAML or JSON schema validation, and no Markdown linting.

### CSA-17 — no build-size, image-size or performance baselines — **Medium**

`npm run build` runs and its output is discarded. Image size is never measured.
`scripts/db/perf-baseline.mjs` and `scripts/db/backup-restore-drill.sh` exist and are
real, but both are written against the **local** Supabase Docker stack
(`docker exec supabase_db_RootLco`, `npx supabase db reset`) and neither is reachable from
a hosted runner.

### CSA-18 — no observability, no flaky-test policy — **Low**

No job summaries (`$GITHUB_STEP_SUMMARY` is never written), no timing capture, no
cache-hit reporting, no flaky-test policy document. Vitest retries are not configured
anywhere, which is the correct default and should be locked in rather than left to chance.

### CSA-19 — workflow expressions and untrusted data — **Low** _(currently clean)_

Audited every `${{ }}` in both files. The complete set is: `github.workflow`,
`github.ref`, `github.event_name`, `github.event.pull_request.head.sha`, `github.sha`.
None is attacker-controlled free text. `GITHUB_BASE_REF` is used inside a shell script but
only via `git rev-parse --verify "origin/${GITHUB_BASE_REF}"` with the variable quoted, and
GitHub constrains ref names. There is no `pull_request_target` anywhere. No finding — but
nothing _enforces_ this, hence the workflow-security linter in the new platform.

### CSA-20 — `set -euo pipefail` is inconsistent — **Low**

`p1-21-clean-room.yml` uses it in every `run:` block. `ci.yml` uses it in exactly one
step (the migration-immutability check); the other four multi-line `run:` blocks do not.
Those blocks happen to be single-pipeline and safe, but the habit is the control.

### CSA-21 — no rollback, mutation, integration-through-HTTP or E2E layer — **Medium**

The repository has strong database and backend-service coverage. It has no failure
injection, no mutation testing, and nothing that drives a complete cross-module business
workflow end to end with a correlation identifier.

---

## 4. Capability matrix

| Capability                                                  | Today              | Where                                  |
| ----------------------------------------------------------- | ------------------ | -------------------------------------- |
| Lint / types / format / style                               | ✅                 | `ci.yml quality`                       |
| Encoding, canonical docs, no-fake-data, scope-exclusion     | ✅                 | `quality`, `secrets`                   |
| Module boundary, authorization coverage, operation coverage | ✅                 | `quality`                              |
| P1-19/20/21 inventories, OpenAPI structural validation      | ✅                 | `quality`                              |
| Unit tests                                                  | ✅                 | `quality`                              |
| Coverage measurement / gate                                 | ❌ / ❌            | —                                      |
| Production build                                            | ✅                 | `quality`                              |
| Build-size baseline                                         | ❌                 | —                                      |
| Migration replay from zero                                  | ✅                 | `database`                             |
| Zero-tables-before assertion                                | ⚠️ clean room only | `p1-21-clean-room`                     |
| Schema hash / drift detection                               | ⚠️ clean room only | `p1-21-clean-room`                     |
| Structural review in CI                                     | ❌                 | script exists, unused                  |
| Seed idempotency                                            | ✅                 | `database`                             |
| Database + backend suites                                   | ✅                 | `database`                             |
| Critical RLS matrix as a first-class artifact               | ❌                 | covered inside `test:db`, not reported |
| Integration through the Route Handler boundary              | ⚠️ partial         | inside `test:backend`                  |
| Backend E2E workflows with correlation IDs                  | ❌                 | —                                      |
| Rollback / failure injection                                | ❌                 | —                                      |
| Mutation testing                                            | ❌                 | —                                      |
| Dependency audit / licence inventory                        | ❌                 | —                                      |
| Dependency review on PRs                                    | ❌                 | —                                      |
| CodeQL / SAST                                               | ❌                 | —                                      |
| Container image scan                                        | ❌                 | —                                      |
| Dockerfile lint                                             | ❌                 | —                                      |
| Secret scan (repository scripts)                            | ✅                 | `secrets`                              |
| Secret scan (git history)                                   | ❌                 | —                                      |
| GitHub Secret Scanning / Push Protection                    | ❌                 | owner setting                          |
| Exact-SHA clean room                                        | ⚠️ phase-scoped    | `p1-21-clean-room`                     |
| Artifacts                                                   | ❌                 | —                                      |
| Job summaries                                               | ❌                 | —                                      |
| Aggregating `ci-gate`                                       | ❌                 | —                                      |
| Change detection                                            | ❌                 | —                                      |
| Nightly assurance                                           | ❌                 | —                                      |
| Performance baseline in CI                                  | ❌                 | local-only script                      |
| Backup/restore drill in CI                                  | ❌                 | local-only script                      |
| SBOM / provenance / attestation                             | ❌                 | —                                      |
| Release verification                                        | ❌                 | —                                      |
| Deployment foundations                                      | ❌                 | —                                      |
| Dependabot                                                  | ❌                 | —                                      |
| Action SHA pinning                                          | ❌                 | —                                      |

---

## 5. Governing decisions the new platform must respect

| ADR                 | Constraint                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-006             | Protected `main`; merge-commit strategy; promotion to `main` is a founders' reserved decision. The platform may never promote.                            |
| ADR-007             | Docker-based local development; non-root runtime is a stated control.                                                                                     |
| ADR-012             | Local-first environment with controlled promotion. No staging or production environment is approved yet — deployment workflows are foundations only.      |
| ADR-003             | Supabase CLI owns the local stack; hosted CI uses a bare `postgres:17-alpine` service and the gap is documented in `docs/database/migration-standard.md`. |
| ADR-011             | Product name pending — the automation must not hard-code a product name.                                                                                  |
| No-fake-data policy | Structural reference data and ephemeral test data only; business tables start empty.                                                                      |

## 6. Baselines measured at the audit

| Baseline                                     | Value                                                              | Method                         |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| Unit tests                                   | 926 passed / 43 files                                              | `npm run test`                 |
| Database tests                               | 1624 (P1-21 hosted)                                                | prior hosted run               |
| Backend tests                                | 1380 (P1-21 hosted)                                                | prior hosted run               |
| Migrations                                   | 119, no `120*`                                                     | `ls supabase/migrations/*.sql` |
| Schema hash                                  | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` | P1-21 hosted clean room        |
| OpenAPI                                      | 169 paths / 199 operations                                         | P1-21 hosted                   |
| Coverage (unit tier, configured include set) | 91.06 / 93.62 / 84.87 / 91.06                                      | `npm run test:coverage`        |
| Tracked files                                | 1324                                                               | `git ls-files`                 |
| Production dependencies                      | 58                                                                 | `npm audit --omit=dev`         |

The authoritative values are re-measured on GitHub-hosted runners and recorded in
`evidence/`. Nothing in this table is copied forward into a gate decision without a hosted
run reproducing it.

---

## 7. Design consequences

The findings above translate directly into the target architecture:

- CSA-01 → protected-branch verification is a separate workflow with `cancel-in-progress: false`.
- CSA-02, CSA-17 → every job uploads machine-readable evidence, and Markdown summaries are generated _from_ that JSON.
- CSA-03 → every `uses:` pinned to a full commit SHA with a version comment, enforced by a linter.
- CSA-04, CSA-05 → the clean room is generalised into `_reusable-clean-room.yml`, phase-independent, exact-head only.
- CSA-06, CSA-12 → one always-running workflow, an always-running change-detection job, and a single `ci-gate` that understands _expected_ skips.
- CSA-07 → a coverage baseline file plus a ratcheting gate with critical-module floors.
- CSA-08, CSA-09, CSA-10 → `dependency-security`, `code-security`, `container-security`, expanded `secret-scan`, and an owner action list for the GitHub-native features.
- CSA-11 → reusable workflows.
- CSA-13 → the database contract is asserted, not assumed.
- CSA-14, CSA-15 → regenerate-then-`git diff --exit-code`, and a mechanical test-honesty checker.
- CSA-16, CSA-20 → `actionlint`, `shellcheck`, YAML/JSON validation, and a workflow-security linter that requires `set -euo pipefail`.
- CSA-21 → backend E2E, rollback injection and targeted mutation testing.
