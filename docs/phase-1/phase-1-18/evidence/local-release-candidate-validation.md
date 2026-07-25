# P1-18 — Local release-candidate validation

Full local validation and exact-SHA clean room for the third P1-18 remediation.
Everything below was produced on one candidate, serially, with no other
PostgreSQL consumer and no concurrent Vitest process.

| Item          | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| Branch        | `fix/p1-18-scoped-authorization-containment`                    |
| Candidate SHA | `b9b412e13f104715532c0b5ac209a14745cf49cd`                      |
| Base          | `origin/develop` = `fb50ef408354d83cedfb21d358a647673dca91f8`   |
| `origin/main` | `3e2c44d9e32e609186f4a6b9f9bfd246cdccda1a` — untouched by P1-18 |
| Merge-base    | equals `origin/develop`, so the branch carries no divergence    |
| Migrations    | 119, no migration 120, none added, modified, renamed or deleted |
| Owner gate    | `Decision: Pending`                                             |

## 1. Repository validation, CI-equivalent order

| #   | Gate                                | Result                                                                                    |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Repo-wide Prettier                  | green                                                                                     |
| 2   | ESLint                              | green                                                                                     |
| 3   | TypeScript `tsc --noEmit`           | green                                                                                     |
| 4   | Unit / foundation suite             | **815 passed**, 39 files                                                                  |
| 5   | Production build (`next build`)     | green                                                                                     |
| 6   | Module boundaries                   | green — 253 files, 11 rules                                                               |
| 7   | Authorization coverage              | green — every operation guarded, every route registered                                   |
| 8   | Operation coverage                  | green — see §2                                                                            |
| 9   | OpenAPI structural validation       | green — 3.1.0, 94 paths, 110 operations                                                   |
| 10  | Encoding                            | green — clean UTF-8, no BOM                                                               |
| 11  | Canonical documents                 | green — 2 documents, hashes match                                                         |
| 12  | Stylelint                           | green                                                                                     |
| 13  | APT/REC classification              | green — 454 columns, 4 restricted, 0 searchable                                           |
| 14  | Tracked secrets                     | green — 1097 files                                                                        |
| 15  | Browser-exposed secrets             | green                                                                                     |
| 16  | Scope exclusions (Benzene, Zoom)    | green                                                                                     |
| 17  | No-fake-data                        | green                                                                                     |
| 18  | Seed state                          | green — 7 files applied twice, every business table empty, idempotent                     |
| 19  | Schema inventory                    | green — see §4                                                                            |
| 20  | Database suite                      | **1547 passed**, 132 files                                                                |
| 21  | Backend suite                       | **767 passed**, 38 files                                                                  |
| 22  | Docker                              | `compose config` green; dev and runner stages build; runtime uid 1001, non-root (ADR-007) |
| 23  | Migration immutability vs `develop` | green — zero M/D/R, zero additions                                                        |

### Floors

| Tier     | Floor | Actual   | Margin |
| -------- | ----- | -------- | ------ |
| Unit     | 746   | **815**  | +69    |
| Database | 1547  | **1547** | 0      |
| Backend  | 693   | **767**  | +74    |

The margins are exactly the two suites this remediation adds, which confirms
they are counted in the aggregates rather than run separately: unit 815 − 69
foundation = 746, and backend 767 − 74 containment = 693.

Targeted re-proof: authorization foundation **69/69**, scoped containment
**74/74**.

The database suite prints five `✖ APT/REC classification guard FAILED` and three
`✖ SVC/QUO/INV classification guard FAILED` lines. These are **deliberate
negative-control output**: `tests/db/apt-rec-classification-guard.test.ts` and
its siblings spawn the real validator against tampered registries and require it
to fail, then require the untampered committed registry to pass. All 132 files
and all 1547 tests pass.

## 2. Operation coverage

```
P1-18 registered public operations: 12
P1-18 operation-depth:              12
P1-18 invocation-only:               0
P1-18 pending:                       0
P1-18 unit-only:                     0
P1-18 unreferenced:                  0
P1-18 metadata-only:                 0
```

## 3. Independent OpenAPI route inventory

The repository gate builds its list from the operation registry. To avoid one
list checking itself, a second inventory was taken that shares no import list,
no registry module and no helper with it: it walks every
`src/app/api/v1/**/route.ts`, strips all comments, parses each
`defineOperation({...})` declaration directly, and compares the result against
`docs/api/openapi.v1.json` by operationId, path and method.

| Measure                 | Value                |
| ----------------------- | -------------------- |
| `route.ts` files walked | 94                   |
| Declared operations     | **110** (110 unique) |
| Published operations    | **110** (110 unique) |
| Guarded operations      | **110**              |
| Unguarded               | **0**                |
| Public operations       | 6                    |
| P1-18 declared          | 12                   |
| P1-18 published         | **12/12**            |
| Missing from OpenAPI    | **0**                |
| Orphan published        | **0**                |
| Path/method drift       | **0**                |

Both methods agree at 110, which is the point of running two.

## 4. Generated-artifact stability

Both generators were run twice, with repository formatting applied after each
run: the operation matrices via `validate:operation-coverage`, and the OpenAPI
document via `UPDATE_OPENAPI=1 vitest run tests/openapi-contract.test.ts`.

| Artifact                                         | Committed   | After run 1 | After run 2 |
| ------------------------------------------------ | ----------- | ----------- | ----------- |
| `phase-1-14/evidence/operation-test-matrix.json` | `179ef098…` | `179ef098…` | `179ef098…` |
| `phase-1-18/evidence/operation-test-matrix.json` | `ad6123ae…` | `ad6123ae…` | `ad6123ae…` |
| `docs/api/openapi.v1.json`                       | `4b878a7a…` | `4b878a7a…` | `4b878a7a…` |

Byte-identical throughout. **Zero drift**, so no generated change needed
committing and the candidate SHA is unchanged by this step.

## 5. Exact-SHA PostgreSQL 17 clean room

**Method.** A fresh `postgres:17-alpine` container (PostgreSQL 17.10) was
started on an isolated port with an empty database — verified empty: zero tables
outside `pg_catalog`/`information_schema` before anything ran. The repository's
own commands were driven against it through `DB_HOST`/`DB_PORT`/`DB_NAME`/
`DB_USER`/`DB_PASSWORD`, which is the same convention CI uses. The worktree was
verified clean and at the candidate SHA immediately before and after, so the
tree under test is exactly `b9b412e`. Repository gates are the authority
throughout; no scratchpad probe substitutes for one.

| Proof                                         | Result                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 119 migrations apply to an empty database | **green** — "All 119 migrations applied cleanly."                                                                                                   |
| Migration 120 absent                          | **green**                                                                                                                                           |
| Migrations 1–119 unchanged                    | **green** — zero M/D/R against `develop`                                                                                                            |
| Supported seeds apply                         | **green** — 7 declared files                                                                                                                        |
| Seeds apply twice idempotently                | **green** — counts idempotent                                                                                                                       |
| Business tables empty where required          | **green**                                                                                                                                           |
| Clean seed-state validation                   | **green**                                                                                                                                           |
| Schema inventory                              | **green**                                                                                                                                           |
| Structural review                             | **PASS** — 537 FKs all validated, no runtime-reachable destructive cascade, FK index coverage complete, no duplicate indexes, zero dictionary drift |
| Full database suite                           | **1547 passed**, 132 files                                                                                                                          |
| Full backend suite                            | **767 passed**, 38 files                                                                                                                            |
| Authorization foundation                      | **69 passed**                                                                                                                                       |
| Scoped containment                            | **74 passed**                                                                                                                                       |
| All 12 P1-18 operation evidences              | **green** — 12/12 operation-depth                                                                                                                   |
| Artifact regeneration drift                   | **zero**                                                                                                                                            |

### Structural posture

| Measure          | Expected | Clean room |
| ---------------- | -------- | ---------- |
| Tables           | 242      | **242**    |
| Functions        | 212      | **212**    |
| Policies         | 631      | **631**    |
| Triggers         | 541      | **541**    |
| Indexes          | 999      | **999**    |
| Constraints      | 1845     | **1845**   |
| Permissions      | 71       | **71**     |
| SECURITY DEFINER | 0        | **0**      |
| RLS not forced   | 0        | **0**      |

Per-schema tables: org 17, iam 17, shared 29, crm 21, veh 23, apt 6, rec 23,
wo 15, tech 9, dia 13, qms 7, svc 11, quo 6, inv 18, sal 19, wty 5, rpt 3.

### Security posture

| Control                             | Result                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| No app role is superuser            | **green** — `app_readonly`, `app_runtime`, `app_worker` all `rolsuper=f` |
| No app role has BYPASSRLS           | **green** — all `rolbypassrls=f`                                         |
| No app role owns application tables | **green** — 0 across all 17 schemas                                      |
| No app-role DELETE grant on `apt`   | **green** — 0                                                            |
| No app-role DELETE grant on `rec`   | **green** — 0                                                            |
| No app-role DELETE grant on `wo`    | **green** — 0                                                            |
| `app_readonly` SELECT-only          | **green** — 0 non-SELECT grants                                          |
| `app_worker` within approved scope  | **green** — SELECT/INSERT/UPDATE/DELETE confined to the `shared` schema  |

### Schema hash

```
a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c
```

Byte-identical to the frozen P1-17 baseline, and identical to the local
development database. P1-18 adds no DDL, so an unchanged hash is the expected
result and any change would have been a blocker.

Clean-room evidence was preserved before teardown, and the container was
removed afterwards.

## 6. A finding the clean room surfaced, and its attribution

Running `validate:seed-state` **after** the database suite, in the same
database, FAILS: `Retention classes do not match the five governed values`. All
five governed `class_code` values are present and correct; the residue is in
`min_retention_days` — `evidence-audit` reads `3650` and `operational` reads `0`
where the governed baseline is `null` for both.

**This is not P1-18's.** It was attributed definitively rather than by argument.
On a second, pristine `postgres:17-alpine` container, with all 119 migrations
and the seeds applied and `validate:seed-state` passing, running **only**
`tests/db/shared-retention.test.ts` — a P1-05-era file this branch does not
touch, whose own 14 tests all pass — reproduces the identical failure with no
P1-18 code involved at all. `git diff --name-only origin/develop...HEAD --
tests/db/` is empty: this branch changes no database test.

Recorded as **`P1-05-SEEDRESIDUE`, severity Low**, and deliberately not fixed
here: it belongs to another phase's test hygiene and repairing it would widen
this remediation into unrelated code. Its practical consequence is bounded and
worth stating: `validate:seed-state` is only meaningful before the database
suite has run against that database, or after a re-seed. The clean-room sequence
above runs it in that order, which is why it passes there.

## 7. What this document does not claim

No push, no pull request, no gate-record branch, and no Go decision. The owner
gate remains `Decision: Pending`. Hosted CI has not run — every result above is
local. Nothing here authorises P1-19.
