# P1-21-DO-001 — Local CI Command Matrix and Temporary Local CI Primary Mode

**Task:** `P1-21-DO-001`
**Phase:** P1-21 — Inventory Backend

## Temporary Local CI Primary Mode

The RootLco owner established this execution policy beginning with P1-21 and
continuing until GitHub Actions credits become available again or the repository
moves to another funded account.

GitHub-hosted Actions **remain configured** and the required checks **remain
enabled**. They are temporarily unavailable because the university GitHub account
exhausted its included Actions credits — the same account-level billing lock that
produced P1-20's waiver (`docs/phase-1/phase-1-20/final-local-ci-billing-waiver.md`).

**No claim is made anywhere in this phase that hosted CI passed.** The authoritative
verification path is instead:

1. exact-SHA local CI reproduction;
2. fresh exact-SHA clean-room reproof;
3. independent adversarial review;
4. hostile completeness audit;
5. protected Pull Request merge;
6. protected-merge local reproof;
7. documentation-only gate record;
8. final protected gate verification.

Under this policy the phase does **not**: disable GitHub Actions, remove required
checks, weaken branch protection, direct-push to `develop` or `main`, skip any
command defined in the active workflow files, or use the billing condition to waive
a repository-controlled test.

### Billing-only PR-check handling

After a verified branch is pushed, GitHub may attach failed required checks because
the jobs cannot start. The owner authorizes an admin bypass **only** when all ten
conditions hold: jobs did not start; no checkout occurred; no repository command
executed; every annotation contains only the known billing/spending-limit message;
local equivalent CI passed on the exact PR head SHA; a fresh clean room passed on
the exact PR head SHA; no conflicts exist; unresolved Critical is 0; unresolved High
is 0; and the merge goes through the Pull Request using the merge-commit strategy.

A bypass is never used for an actual repository failure.

## The command matrix

Extracted mechanically from `.github/workflows/ci.yml` at the P1-21 base
(`bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2`). Four jobs, 37 repository-controlled
steps. Required exit code is `0` for every step.

| #   | Job      | Step                                     | Local equivalent                                          |
| --- | -------- | ---------------------------------------- | --------------------------------------------------------- |
| 01  | quality  | Install dependencies (locked)            | `npm ci`                                                  |
| 02  | quality  | Lint                                     | `npm run lint`                                            |
| 03  | quality  | Module boundary and layering check       | `npm run validate:module-boundaries`                      |
| 04  | quality  | Authorization coverage check             | `npm run validate:authorization-coverage`                 |
| 05  | quality  | Operation-to-test coverage check         | `npm run validate:operation-coverage`                     |
| 06  | quality  | P1-19 endpoint inventory                 | `npm run validate:p1-19-inventory`                        |
| 07  | quality  | P1-20 endpoint inventory                 | `npm run validate:p1-20-inventory`                        |
| 08  | quality  | **P1-21 endpoint inventory**             | `npm run validate:p1-21-inventory`                        |
| 09  | quality  | OpenAPI validation                       | `npm run validate:openapi`                                |
| 10  | quality  | Type check                               | `npm run typecheck`                                       |
| 11  | quality  | Format check                             | `npm run format:check`                                    |
| 12  | quality  | Style lint (SCSS)                        | `npm run style:check`                                     |
| 13  | quality  | Encoding hygiene                         | `npm run validate:encoding`                               |
| 14  | quality  | Unit tests                               | `npm run test`                                            |
| 15  | quality  | Production build                         | `npm run build`                                           |
| 16  | docker   | Validate compose file                    | `docker compose config --quiet`                           |
| 17  | docker   | Build dev stage                          | `docker build --target dev`                               |
| 18  | docker   | Build production runner stage            | `docker build --target runner`                            |
| 19  | docker   | Assert non-root runtime                  | `docker run --entrypoint sh … 'id -u'` ≠ 0                |
| 20  | database | Install dependencies (locked)            | `npm ci`                                                  |
| 21  | database | Migration immutability (PR-only)         | `git diff --diff-filter=MDR … supabase/migrations/` empty |
| 22  | database | Apply all migrations to a clean database | `npm run db:apply-migrations`                             |
| 23  | database | Apply declared seeds twice               | `npm run validate:seed-state`                             |
| 24  | database | CRM classification                       | `npm run validate:crm-classification`                     |
| 25  | database | Vehicle classification                   | `npm run validate:veh-classification`                     |
| 26  | database | Appointment/Reception classification     | `npm run validate:aptrec-classification`                  |
| 27  | database | WO/Tech/Dia/QMS classification           | `npm run validate:wo-tech-dia-qms-classification`         |
| 28  | database | SVC/QUO/INV classification               | `npm run validate:svc-quo-inv-classification`             |
| 29  | database | SAL/WTY/RPT classification               | `npm run validate:sal-wty-rpt-classification`             |
| 30  | database | Database suite                           | `npm run test:db`                                         |
| 31  | database | Backend foundation suite                 | `npm run test:backend`                                    |
| 32  | secrets  | Tracked environment-file guard           | `git ls-files --error-unmatch .env …` must fail           |
| 33  | secrets  | Tracked key material                     | no tracked `*.pem/key/p12/pfx`                            |
| 34  | secrets  | Scope-exclusion guard                    | `node scripts/check-scope-exclusions.mjs`                 |
| 35  | secrets  | Tracked credential patterns              | `npm run security:tracked-secrets`                        |
| 36  | secrets  | Browser service-role guard               | `npm run security:browser-secrets`                        |
| 37  | secrets  | No fake/demo business data               | `npm run validate:no-fake-data`                           |

Step 08 is added by this phase, alongside the P1-19 and P1-20 inventories.

## Environment

Reproduced from the workflow's own `env` block:

```
NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key-not-a-secret
NEXT_PUBLIC_APP_ENV=local
DB_HOST=127.0.0.1  DB_NAME=postgres  DB_USER=postgres  DB_PASSWORD=postgres
DB_PORT=<isolated port, not 54322>
```

The database port is deliberately **not** the workflow's `54322`. That port belongs
to the developer's Supabase stack, which Docker Desktop starts automatically; running
a suite against it would mix P1-21 fixtures into a developer database and, worse,
would let a green run depend on state the clean room does not have.

Database-backed suites run **serially**. No two suites ever share a database
concurrently.

## Stated deviations

Recorded rather than hidden. None of them weakens a check:

- **Node 24.16.0 locally vs Node 22 in the workflow.** The lockfile install is
  identical; the runtime major differs.
- **No GitHub Actions layer cache** for the Docker stage, so the local Docker job
  builds from scratch. Slower, not weaker.
- **The migration-immutability step is `pull_request`-only** in the workflow and is
  reproduced locally as an explicit `git diff --diff-filter=MDR` against the base.

## Ordering requirement discovered during this phase

`npm run validate:seed-state` asserts that every business table is empty and that the
five governed retention classes match their seeded values exactly. It is therefore a
**fresh-database** check and must run **before** any test suite. Running it after
`test:db` fails — not because of a defect, but because suites legitimately mutate
retention configuration and leave fixture rows behind. The workflow already orders it
correctly (step 23 before steps 30–31); the local matrix follows the same order, and
the clean room runs it against a database that has never had a test on it.
