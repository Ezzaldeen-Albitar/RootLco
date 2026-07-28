# P1-21 — Final Exact-SHA Local Equivalent CI

**Ran against: this pull request's head commit.**
**Base:** `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2`
**Worktree at the time of the run:** clean (`git status --short` empty)
**Mode:** Owner-Approved Temporary Local CI Primary Mode

The head SHA is deliberately not transcribed here. An earlier revision of this file
hard-coded it, and every subsequent documentation commit made that transcription stale —
including once when it was used to claim an executable diff was empty that no longer
was. The exact SHA is recorded in the gate record, which is created from the protected
merge commit and can name a SHA without moving it.

GitHub-hosted Actions remain configured and required, and are unavailable under the
university-account billing lock. **No claim is made anywhere that hosted CI ran or
passed.** Every command below is a repository-controlled step extracted from
`.github/workflows/ci.yml` at this SHA and run locally, with its real exit code
captured before any pipe. No `|| true`, no ignored result.

## Environment

Node 24.16.0 · npm 11.13.0 · Docker 29.5.3 · PostgreSQL **17.10** in a disposable
`postgres:17-alpine` container on port **15470**, created empty for this run and
**verified to hold zero application tables** before the first migration.

```
NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key-not-a-secret
NEXT_PUBLIC_APP_ENV=local
DB_HOST=127.0.0.1  DB_PORT=15470  DB_NAME=postgres  DB_USER=postgres  DB_PASSWORD=postgres
```

The database port is deliberately not the workflow's `54322`: that belongs to the
developer's Supabase stack, which Docker Desktop starts automatically, and running
against it would mix fixtures into a developer database and let a green run depend on
state the clean room does not have.

Wall clock: 12:00:23 → 12:18:23 UTC, 37 steps, serial throughout.

## Job: quality

| #   | Command                                   | Exit | Result                                             |
| --- | ----------------------------------------- | ---- | -------------------------------------------------- |
| 01  | `npm ci`                                  | 0    | lockfile install                                   |
| 02  | `npm run lint`                            | 0    | clean                                              |
| 03  | `npm run validate:module-boundaries`      | 0    | no boundary or layering violation                  |
| 04  | `npm run validate:authorization-coverage` | 0    | every operation guarded, every route registered    |
| 05  | `npm run validate:operation-coverage`     | 0    | every operation invoked with its required evidence |
| 06  | `npm run validate:p1-19-inventory`        | 0    | current                                            |
| 07  | `npm run validate:p1-20-inventory`        | 0    | 17 operations, 27/27 identifiers                   |
| 08  | `npm run validate:p1-21-inventory`        | 0    | **14 operations, 28/28 identifiers**               |
| 09  | `npm run validate:openapi`                | 0    | **169 paths / 199 operations**, all guarded        |
| 10  | `npm run typecheck`                       | 0    | clean                                              |
| 11  | `npm run format:check`                    | 0    | clean                                              |
| 12  | `npm run style:check`                     | 0    | clean                                              |
| 13  | `npm run validate:encoding`               | 0    | 0 BOM / 0 U+FFFD / 0 mojibake                      |
| 14  | `npm run test`                            | 0    | **926 passed / 43 files**                          |
| 15  | `npm run build`                           | 0    | production build                                   |

## Job: secrets

| #   | Command                                   | Exit | Result                    |
| --- | ----------------------------------------- | ---- | ------------------------- |
| 16  | tracked environment-file guard            | 0    | none tracked              |
| 17  | tracked key material                      | 0    | none                      |
| 18  | `node scripts/check-scope-exclusions.mjs` | 0    | pilot + Zoom guards clean |
| 19  | `npm run security:tracked-secrets`        | 0    | clean                     |
| 20  | `npm run security:browser-secrets`        | 0    | clean                     |
| 21  | `npm run validate:no-fake-data`           | 0    | 1321 tracked files        |

## Job: database (serial — no two suites share a database)

| #   | Command                                           | Exit | Result                                                            |
| --- | ------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| 22  | `npm run db:apply-migrations`                     | 0    | **119 applied cleanly, no migration 120**                         |
| 23  | `npm run validate:seed-state`                     | 0    | 7 files twice, five retention classes, every business table empty |
| 24  | `npm run validate:crm-classification`             | 0    | pass                                                              |
| 25  | `npm run validate:veh-classification`             | 0    | pass                                                              |
| 26  | `npm run validate:aptrec-classification`          | 0    | pass                                                              |
| 27  | `npm run validate:wo-tech-dia-qms-classification` | 0    | pass                                                              |
| 28  | `npm run validate:svc-quo-inv-classification`     | 0    | pass                                                              |
| 29  | `npm run validate:sal-wty-rpt-classification`     | 0    | pass                                                              |
| 30  | `npm run validate:schema-inventory` (before)      | 0    | hash `a677eb05…`                                                  |
| 31  | `npm run test:db`                                 | 0    | **1624 passed / 137 files**                                       |
| 32  | `npm run test:backend`                            | 0    | **1380 passed / 59 files**                                        |
| 33  | `npm run validate:schema-inventory` (after)       | 0    | hash `a677eb05…` — **identical**                                  |

Schema totals: 17 schemas, 242 tables (`inv` 18), 3562 columns, 212 functions, 541
triggers, 631 policies, 999 indexes, 1845 constraints, **0 SECURITY DEFINER**, **0
tables with RLS not forced**.
Schema hash: `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` —
unchanged from the P1-20 baseline, because P1-21 adds no migration.

## Job: docker

| #   | Command                         | Exit | Result       |
| --- | ------------------------------- | ---- | ------------ |
| 34  | `docker compose config --quiet` | 0    | valid        |
| 35  | `docker build --target dev`     | 0    | built        |
| 36  | `docker build --target runner`  | 0    | built        |
| 37  | non-root runtime assertion      | 0    | **uid 1001** |

## Transient failures: none in this run

This is a change from the run at the earlier tree, and it is worth stating plainly
rather than quietly dropping. That run hit one `ERR_IPC_CHANNEL_CLOSED` Vitest worker
crash in `npm run test:db` — diagnosed (container `running`, `exit=0`,
`OOMKilled=false`, ~15 GB host memory free, many files already ✓, no failed assertion)
and passing on re-run.

**This run needed no retry of any kind.** All 37 steps passed on their first attempt.
The two stale P1-21 CI containers from earlier cycles were removed before it started,
which is the most likely reason the worker crash did not recur — but that is an
observation, not a proven cause, and it is recorded as such.

## Stated deviations from the hosted workflow

None of these weakens a check:

- **Node 24.16.0 locally vs Node 22 in the workflow.** The lockfile install is
  identical; the runtime major differs.
- **No GitHub Actions layer cache** for the Docker stage, so both images build from
  scratch. Slower, not weaker.
- **The migration-immutability step is `pull_request`-only** in the workflow. It is
  reproduced as an explicit diff of `supabase/migrations/` against the base, which is
  empty: no migration was added, modified, renamed, or deleted.
- **`npm audit` advisories are not a gate** in the workflow and are not treated as one
  here.

## Result

**ALL 37 STEPS EXIT 0**, zero failures, zero retries, worktree clean.
