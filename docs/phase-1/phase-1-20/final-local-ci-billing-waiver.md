# P1-20 — Owner-Approved Local CI Billing Waiver

> **This document does not claim that GitHub-hosted CI passed.** It records that hosted
> execution was unavailable for a verified external billing reason, and that every
> repository-controlled check hosted CI would have run was reproduced locally at the exact
> protected SHA.

**Phase:** 1-20 — Service Catalog, Pricing, and Quotation Backend
**Decision date:** 2026-07-28 (Asia/Amman)
**Proof SHA:** `66b84a251f763bac096416ef9afd0b1486e5b487`

## Reason

The RootLco GitHub account is a university account. Its included GitHub Actions credits are
exhausted, and GitHub has blocked workflow execution pending payment. The owner has decided
to defer that payment.

The final protected push workflow for P1-20 was:

| Item                      | Value                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| Workflow                  | CI **#271**                                                                    |
| Run ID                    | `30300381579`                                                                  |
| Event                     | `push`                                                                         |
| Branch                    | `develop`                                                                      |
| SHA                       | `66b84a251f763bac096416ef9afd0b1486e5b487`                                     |
| Result                    | **Failure in 11s** — then **Failure in 14s** on an explicit re-run of all jobs |
| Repository steps executed | **zero** — no checkout, no `npm ci`, no test, no build                         |

GitHub's annotation, verbatim, identical on all four jobs and identical again after the
re-run:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased. Please check the 'Billing & plans' section in your settings

This is an account-level execution lock. No repository command ran, so no repository command
failed. It is not a test failure, not a lint failure, and not a build failure.

`Re-run all jobs` was invoked on the same run and the same SHA — no new commit was created —
and produced the identical billing annotation, which is what establishes that the condition is
persistent rather than transient.

## Scope

This waiver:

- applies **only** to P1-20's final protected push CI on `66b84a25`;
- does **not** apply automatically to P1-21 or any later phase;
- does **not** assert that any hosted workflow succeeded;
- does **not** waive any repository-controlled check — every one was executed locally;
- does **not** weaken, skip, or reconfigure any test, gate, or branch-protection rule.

**The feature push CI was not waived.** Push run **#267** (`30296722364`, event `push`, branch
`develop`, SHA `db7ef97a`) completed **Success, 4/4 jobs, 6m 50s** on hosted runners before the
credits were exhausted. Only the final gate-merge push run is covered here.

## Exact protected state

| Anchor                     | Value                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Final reviewed feature SHA | `e7462536d183e410ff2db9792c7a6090df7f4698`                                               |
| Feature merge SHA          | `db7ef97a4c1e090911e22ddac5936f725470f084` (PR #84)                                      |
| Feature merge parents      | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0` + `e7462536d183e410ff2db9792c7a6090df7f4698`  |
| Feature merge tree         | `dc644ea5821d1a8c7da8efd22ddf924cf15d31bf` — byte-identical to `e746253^{tree}`          |
| Reviewed gate head         | `21c5e13a5186298439269eeed510373adbb3721b` (PR #85)                                      |
| Final gate merge SHA       | `66b84a251f763bac096416ef9afd0b1486e5b487`                                               |
| Gate merge parents         | `db7ef97a4c1e090911e22ddac5936f725470f084` + `21c5e13a5186298439269eeed510373adbb3721b`  |
| Gate merge tree            | `9c39a8d9672e598bc450dddfc2d99b01b04981cf` — byte-identical to `21c5e13a^{tree}`         |
| Gate delta                 | documentation-only — 5 files, all under `docs/phase-1/phase-1-20/`                       |
| `origin/main`              | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched, contains no P1-20 commit         |
| Direct protected pushes    | **none** — every first-parent commit on `develop` since the P1-19 gate is a merge commit |

## Local proof

### Runtime

| Item       | Value                                                           |
| ---------- | --------------------------------------------------------------- |
| Host       | Windows 11 Pro 10.0.26200, MINGW64                              |
| Node       | **v24.16.0** (hosted CI pins Node 22 — see deviations)          |
| npm        | 11.13.0                                                         |
| Docker     | 29.5.3                                                          |
| PostgreSQL | 17.10 (`postgres:17-alpine`, matching the CI service container) |

### Command matrix

Every step was read out of `.github/workflows/ci.yml` at the proof SHA rather than recalled.
Four jobs, 36 repository-controlled steps. Steps that are pure GitHub infrastructure
(`actions/checkout`, `actions/setup-node`, `docker/setup-buildx-action`, the GHA layer cache)
carry no repository command and are marked as such.

#### Job `quality` — Lint, types, tests, build

| Command                                   | Result                                                                          | Exit  |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ----- |
| `npm ci`                                  | installed from lockfile                                                         | **0** |
| `npm run lint`                            | eslint clean                                                                    | **0** |
| `npm run validate:module-boundaries`      | 358 files, rules B1–B12, no violation                                           | **0** |
| `npm run validate:authorization-coverage` | every operation guarded, every route registered                                 | **0** |
| `npm run validate:operation-coverage`     | P1-20 pending 0 / unit-only 0 / unreferenced 0 / metadata-only 0                | **0** |
| `npm run validate:p1-19-inventory`        | current, 58 operations                                                          | **0** |
| `npm run validate:p1-20-inventory`        | 17 operations; permissions, audit actions, events and all 27 task ids reconcile | **0** |
| `npm run validate:openapi`                | 3.1.0, **155 paths / 185 operations**, all guarded                              | **0** |
| `npm run typecheck`                       | `tsc --noEmit` clean                                                            | **0** |
| `npm run format:check`                    | all files Prettier-clean                                                        | **0** |
| `npm run style:check`                     | stylelint `--max-warnings 0`                                                    | **0** |
| `npm run validate:encoding`               | 1264 files; 0 BOM, 0 U+FFFD, 0 mojibake                                         | **0** |
| `npm run test`                            | **903 passed**, 42 files                                                        | **0** |
| `npm run build`                           | `next build` succeeded                                                          | **0** |

#### Job `docker` — Docker build validation

| Command                                                            | Result                                     | Exit  |
| ------------------------------------------------------------------ | ------------------------------------------ | ----- |
| `docker compose config --quiet`                                    | compose file valid                         | **0** |
| `docker build --target dev -t rootlco/web:ci-dev .`                | dev stage built                            | **0** |
| `docker build --target runner -t rootlco/web:ci-runner .`          | production stage built                     | **0** |
| `docker run --rm --entrypoint sh rootlco/web:ci-runner -c 'id -u'` | **uid 1001** — non-root, ADR-007 satisfied | **0** |

#### Job `database` — migrations and RLS, against a fresh empty PostgreSQL 17

| Command                                           | Result                                                                                                                                          | Exit  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| database empty before anything ran                | **0** non-system tables                                                                                                                         | —     |
| migration immutability vs `0d86a19`               | no existing migration modified, renamed or deleted                                                                                              | **0** |
| `npm run db:apply-migrations`                     | all **119** applied cleanly; no migration 120                                                                                                   | **0** |
| `npm run validate:seed-state`                     | 7 declared files applied twice; five exact retention classes; every business table empty; counts idempotent                                     | **0** |
| `npm run validate:crm-classification`             | all columns classified                                                                                                                          | **0** |
| `npm run validate:veh-classification`             | all columns classified                                                                                                                          | **0** |
| `npm run validate:aptrec-classification`          | all columns classified                                                                                                                          | **0** |
| `npm run validate:wo-tech-dia-qms-classification` | all columns classified                                                                                                                          | **0** |
| `npm run validate:svc-quo-inv-classification`     | all columns classified                                                                                                                          | **0** |
| `npm run validate:sal-wty-rpt-classification`     | 427 columns classified, 16 restricted, 0 searchable                                                                                             | **0** |
| `node scripts/db/schema-inventory.mjs` (before)   | `schema_hash a677eb05…`                                                                                                                         | **0** |
| `node scripts/db/structural-review.mjs`           | **PASS** — 537 FKs validated, no runtime-reachable destructive cascade, complete FK index coverage, no duplicate indexes, zero dictionary drift | **0** |
| `iam.permissions`                                 | **96**                                                                                                                                          | —     |
| `npm run test:db`                                 | **1610 passed**, 136 files                                                                                                                      | **0** |
| `npm run test:backend`                            | **1264 passed**, 56 files                                                                                                                       | **0** |
| `node scripts/db/schema-inventory.mjs` (after)    | `schema_hash a677eb05…` — **unchanged**                                                                                                         | **0** |

The migration-immutability step is gated `if: github.event_name == 'pull_request'` and would
therefore have been **skipped** on the failed push run. It was executed locally anyway, which
is stricter than the hosted job would have been on this event.

#### Job `secrets` — secret and sensitive-file scan

| Command                                                 | Result                                               | Exit  |
| ------------------------------------------------------- | ---------------------------------------------------- | ----- |
| tracked `.env` / `.env.local` / `.env.production` guard | none tracked                                         | **0** |
| tracked key-material guard (`.pem/.key/.p12/.pfx`)      | none tracked                                         | **0** |
| `node scripts/check-scope-exclusions.mjs`               | 1281 files, no hit outside the allow-list            | **0** |
| `npm run security:tracked-secrets`                      | 1281 files, no credential-shaped value               | **0** |
| `npm run security:browser-secrets`                      | 1281 files, no browser-exposed service-role variable | **0** |
| `npm run validate:no-fake-data`                         | 1281 files, no fabricated-business-data indicator    | **0** |

Worktree after every job: **0 files modified**.

### Stated deviations from hosted CI

1. **Node 24.16.0 locally, Node 22 in CI.** The Dockerfile pins Node 22 and the Docker job
   builds and executes that image, so the pinned runtime is still exercised — but the
   typecheck, unit and build steps ran on Node 24. This is a real difference and is recorded
   rather than hidden.
2. **No GitHub Actions layer cache.** Every Docker layer was built from scratch, which is
   stricter than the hosted job.
3. **`npm audit` advisories** are printed by `npm ci`. No CI step asserts on them and none was
   treated as a gate here either.

## Clean-room proof

An **isolated clone**, detached at `66b84a25`, lockfile-only install, its own disposable
PostgreSQL 17.10 container on an isolated port, no reuse of the developer database and no
build cache.

| Proof                                | Result                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clone detached at the exact SHA      | **YES** — `66b84a251f763bac096416ef9afd0b1486e5b487`                                                                                                                             |
| Untracked or ignored source files    | **0**                                                                                                                                                                            |
| Worktree clean at start              | **0** modified                                                                                                                                                                   |
| Migration files                      | **119**; migration 120 **absent**                                                                                                                                                |
| Historical migrations byte-identical | **0** diffs                                                                                                                                                                      |
| PostgreSQL                           | **17.10**                                                                                                                                                                        |
| Application tables before migration  | **0**                                                                                                                                                                            |
| `npm ci` (lockfile only)             | exit **0**                                                                                                                                                                       |
| `npm run db:apply-migrations`        | exit **0**                                                                                                                                                                       |
| `npm run validate:seed-state` ×2     | exit **0**, **0** — idempotent, five exact retention classes, every business table empty                                                                                         |
| `iam.permissions`                    | **96**                                                                                                                                                                           |
| P1-20 permission codes present       | `svc.service.read`, `svc.service.manage`, `svc.price.read`, `svc.price.manage`, `svc.price.publish`, `quo.quotation.read`, `quo.quotation.manage`, `quo.decision.record` — all 8 |
| `schema_hash` before                 | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                                                                                               |
| Structural review                    | **PASS**                                                                                                                                                                         |
| `npm run validate:openapi`           | 155 paths / 185 operations, exit **0**                                                                                                                                           |
| `npm run validate:p1-19-inventory`   | 58 operations, exit **0**                                                                                                                                                        |
| `npm run validate:p1-20-inventory`   | 17 operations, 27 task ids, exit **0**                                                                                                                                           |
| `npm run test` (unit)                | **903 passed** — see the cold-cache note below                                                                                                                                   |
| `npm run test:backend`               | **1264 passed**, 56 files, exit **0**                                                                                                                                            |
| `npm run test:db`                    | **1610 passed**, 136 files, exit **0**                                                                                                                                           |
| `schema_hash` after all suites       | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — **unchanged**                                                                                               |
| `npm run build`                      | exit **0**                                                                                                                                                                       |
| `docker compose config --quiet`      | exit **0**                                                                                                                                                                       |
| Worktree unchanged by the run        | **0** modified                                                                                                                                                                   |
| Teardown                             | container removed, clone removed                                                                                                                                                 |

### The one clean-room failure, and why it is not a defect

**The clean room's first unit run failed: 902 passed, 1 failed.** That is recorded here rather
than smoothed over, because a clean room that is reported green when it was not is worthless.

| Item         | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| File         | `tests/foundation/operation-coverage-gate.test.ts:502`                           |
| Test         | "classifies every registered operation as public API surface, so none is hidden" |
| Error        | `Test timed out in 5000ms` — the test took **5821 ms**                           |
| Failure kind | **timeout, not an assertion failure**                                            |

Six independent facts establish that this is a cold-filesystem-cache I/O artifact and not a
repository defect:

1. **It is a timeout.** No assertion was violated, so no claim about the code was falsified.
2. **Sibling tests in the same file, doing the same whole-tree scan, took 4161 ms and 4838 ms
   and passed** — the file sits right against the 5000 ms budget when every source file must
   be read from cold storage.
3. **Re-running the identical suite in the identical clone at the identical SHA, warm, gives
   903/903 and exit 0.** Nothing changed between the two runs except the filesystem cache.
4. **The local `quality` job gave 903/903 at the same SHA** minutes earlier.
5. **P1-20 did not touch this file** — `git log 0d86a19..66b84a25 -- tests/foundation/operation-coverage-gate.test.ts`
   is empty. It is pre-existing, and the behaviour is already documented in
   `execution-checkpoint.md` under "Traps already identified — do not rediscover".
6. **The same logic passes as a standalone gate.** `npm run validate:operation-coverage`
   exited 0 in both the local job and the clean room, reporting P1-20 pending 0 / unit-only 0 /
   unreferenced 0 / metadata-only 0. Hosted CI also passed this exact test file on `e746253`
   (run #267) and on the gate branch (run #270).

No executable file was changed in response, because there is no defect to fix. The timeout
budget was **not** raised: raising a timeout to make a red test green is exactly the kind of
change this phase's evidence rules forbid.

## Findings

| Item                                 | Value                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Unresolved Critical                  | **0**                                                                          |
| Unresolved High                      | **0**                                                                          |
| Repository-controlled check failures | **none**                                                                       |
| Hosted execution                     | unavailable — GitHub account billing lock only                                 |
| Accepted limitations                 | nine Low open (`P1-20-A-01`…`A-03`, `A-05`…`A-10`); `P1-20-A-04` **withdrawn** |
| Open scope gaps                      | `P1-20-G-02`, `P1-20-G-03` — both Low; `P1-20-G-01` **closed**                 |

## Owner decision

**Owner-Approved Local CI Billing Waiver — P1-20 Final Hosted Push CI Replaced by Exact-SHA
Local and Clean-Room Reproof**

The RootLco owner authorises this one-time, phase-specific substitution because GitHub Actions
execution is blocked by exhausted university-account credits and payment is intentionally
deferred. The waiver replaces the _unavailable_ hosted push-CI condition with exact-SHA local
execution of every active workflow command plus a fresh clean-room reproof. It does not
replace, relax, or reinterpret any repository-controlled check.

## Formal technical decision

**Go — P1-20 Service Catalog, Pricing, and Quotation Backend Gate Passed**

P1-20 final hosted push CI was unavailable because of a GitHub billing lock and was replaced
by the owner-approved local-CI waiver recorded in this document.

| Closure basis                             | Value                                    |
| ----------------------------------------- | ---------------------------------------- |
| Closure basis                             | Owner-Approved Local CI Billing Waiver   |
| Hosted final push CI                      | **Not executed** — GitHub billing lock   |
| Repository-controlled local equivalent CI | **Passed**                               |
| Exact-SHA clean room                      | **Passed**                               |
| Hosted feature push CI (#267)             | **Passed on hosted runners**, not waived |
