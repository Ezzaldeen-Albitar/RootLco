# Phase 1-7 Evidence Register

Every gate claim is tied to a command and its exit code, captured on the local
canonical PostgreSQL 17.6 (Supabase local) against the feature branch. Counts
come from live introspection and actual runner output — never planned values.
The final PR SHA re-runs all of this in hosted CI (the authoritative
environment); this register records the local clean-room evidence used to
declare implementation complete.

## Clean-room sequence (disposable database, from empty)

Executed after deleting the untracked dev helpers (`_veh.mjs`, `_q.mjs`) and
confirming a clean working tree, at the post-red-team-fix state
(commit `44f2210`, migration `20260720105000` included).

| #           | Step                                                                                                                            | Command                                                                               | Result                                                                     | Exit      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| 1–4         | Destroy + rebuild + apply every migration from zero                                                                             | `npx supabase db reset`                                                               | PostgreSQL 17.6; 23 veh + 21 crm tables; 29 veh functions, 57 veh triggers | 0         |
| 5–6         | Apply seeds twice                                                                                                               | `npm run validate:seed-state`                                                         | 4 seed files applied twice; idempotent                                     | 0         |
| 7           | Validate seed/empty state                                                                                                       | (same)                                                                                | every business table empty (org/iam/shared/crm/veh swept)                  | 0         |
| 8           | CRM classification                                                                                                              | `npm run validate:crm-classification`                                                 | 298 crm columns classified (7 restricted)                                  | 0         |
| 9           | Vehicle classification                                                                                                          | `npm run validate:veh-classification`                                                 | 320 veh columns classified (2 restricted, 6 searchable)                    | 0         |
| 10          | No-fake-data                                                                                                                    | `npm run validate:no-fake-data`                                                       | no fabricated-business-data indicators (370 tracked files)                 | 0         |
| 11–15,17–26 | Full DB suite (RLS, constraints, concurrency, isolation, ownership, FK-index, dup-index, dictionary, inventories, immutability) | `npm run test:db`                                                                     | **72 files, 840 tests passed**                                             | 0         |
| 16          | Concurrency ×5 (isolated)                                                                                                       | `vitest run … veh-concurrency.test.ts` ×5                                             | see the concurrency table below                                            | 0 (all 5) |
| 27–28       | Secret + sensitive-file + scope scans                                                                                           | `security:tracked-secrets` / `security:browser-secrets` / `security:scope-exclusions` | clean (370 files)                                                          | 0 / 0 / 0 |
| 29          | Canonical-doc validation                                                                                                        | `npm run validate:canonical-docs`                                                     | 2 canonical documents verified                                             | 0         |
| 30          | Format                                                                                                                          | `npm run format:check`                                                                | all files Prettier-clean                                                   | 0         |
| 31          | Lint                                                                                                                            | `npm run lint`                                                                        | clean                                                                      | 0         |
| 32          | Typecheck                                                                                                                       | `npm run typecheck`                                                                   | clean                                                                      | 0         |
| 33          | Style                                                                                                                           | `npm run style:check`                                                                 | clean (max-warnings 0)                                                     | 0         |
| 34          | Unit tests                                                                                                                      | `npm run test`                                                                        | 5 files, 29 tests passed                                                   | 0         |
| 35          | Production build                                                                                                                | `npm run build`                                                                       | Next.js build succeeded                                                    | 0         |
| 36          | Docker Compose validation                                                                                                       | `docker compose config`                                                               | valid                                                                      | 0         |

Migration immutability: `git diff --name-status origin/develop...HEAD --
supabase/migrations/` shows only additions (`A`) — no pre-P1-07 migration was
modified. All 16 veh migrations are `20260720090000`–`20260720105000`.

## Concurrency evidence (QA-008, five controlled runs)

`tests/db/veh-concurrency.test.ts`, 18 races, on the final SHA `44f2210`, each
run isolated (no other suite touching the database):

| Run | SHA       | Result    | Duration | Exit |
| --- | --------- | --------- | -------- | ---- |
| 1   | `44f2210` | 18 passed | 8.4s     | 0    |
| 2   | `44f2210` | 18 passed | 8.1s     | 0    |
| 3   | `44f2210` | 18 passed | 8.2s     | 0    |
| 4   | `44f2210` | 18 passed | 9.6s     | 0    |
| 5   | `44f2210` | 18 passed | 6.0s     | 0    |

No intermittent failures. Documented accepted loser SQLSTATEs per race:
`23505` (unique), `23P01` (exclusion), `23514` (guard check), and `40P01`
(deadlock — accepted only as a legitimate loser in the two merge races, where
the winner's single valid state still commits). A latent unhandled-rejection
flake in the race harness was root-caused and fixed before this evidence was
captured (commit `4232708`) — the earlier symptom was "all tests pass, exit 1";
post-fix all five runs are clean 18-passed exit 0.

## Note on running suites concurrently

The full DB suite and the concurrency loop MUST NOT run against the same
database simultaneously — both commit fixtures and would cross-contaminate. Each
result above was captured in isolation after a fresh `supabase db reset`.

## Introspection totals (authoritative)

23 tables · 320 columns · 29 functions · 57 triggers · 62 policies · 91
indexes · 54 foreign keys · 104 check constraints · 7 EXCLUDE constraints · 2
restricted columns · 6 searchable columns · 0 veh business rows. Source:
[object inventory](./veh-object-inventory.md), regenerated from the live schema.

## Feature-merge containment (formal closure, 2026-07-19)

Captured after the owner merged the feature PR, from Git and the GitHub PR page:

| Fact                         | Value                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Feature PR                   | [#33](https://github.com/Ezzaldeen-Albitar/RootLco/pull/33) — state **Merged** ("4 checks passed")      |
| Final feature SHA            | `4c9697ae9abe22dafd9bef838ddf9219780d5ef7`                                                              |
| Merge commit                 | `47d0b9b3374a1a3504f60cf3c8cabdb6ed4a875e` (subject "Merge pull request #33 …")                         |
| Merge parents                | `416cf9e` (prior `develop`) + `4c9697a` (feature head)                                                  |
| Merge strategy               | merge commit (`--no-ff`, two parents)                                                                   |
| Merge author / committer     | Eng. Ezzaldeen Al-Bitar / GitHub                                                                        |
| Merge timestamp              | 2026-07-19T19:42:19+03:00                                                                               |
| `origin/develop` after merge | `47d0b9b` (was `416cf9e`)                                                                               |
| Feature-SHA containment      | `git merge-base --is-ancestor 4c9697a origin/develop` → **true**                                        |
| `origin/main`                | `5b189c3` — unchanged; does **not** contain the feature SHA                                             |
| Hosted CI on `4c9697a`       | 4/4 required checks Successful (DB migrations & RLS; lint/types/tests/build; secret scan; Docker build) |

The gate-record for this closure is delivered by the separate
`docs/p1-07-record-technical-gate` PR; the final gate-record SHA and its own CI
result are recorded in that PR and confirmed on protected-history closure.
