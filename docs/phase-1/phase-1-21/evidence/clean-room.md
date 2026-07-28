# P1-21 — Fresh Exact-SHA Clean Room

**CLEAN_ROOM_SHA:** `0daacb1692ba0c92d0c39d2fad0d074d7767104a`
**FINAL_FEATURE_SHA:** `0daacb1692ba0c92d0c39d2fad0d074d7767104a` — **identical**
**LOCAL_CI_SHA:** `6e0f3644ca6850fcaa4e01c1e64178e656022c9f`, whose delta to the final
SHA is one documentation commit with an **empty executable diff**, verified by
`git diff --stat 6e0f364..HEAD -- src tests scripts package.json package-lock.json supabase .github`
returning nothing. Every executable and test path proved by the local CI is
byte-identical to the one proved here, and the clean room independently re-ran all of
it at the final SHA anyway.

## Isolation

- **Fresh clone** into a temporary directory outside the working tree, `--no-hardlinks`.
- **Detached** at the exact SHA, so the clone cannot follow a branch that moves.
- **`npm ci`** — lockfile only, never `npm install`.
- **Own database**: a disposable `postgres:17-alpine` container on port **15460**, no
  volume. Verified genuinely empty before use: `PostgreSQL 17.10`, and
  `SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN
('pg_catalog','information_schema')` returned **0**.
- No developer database, no pre-existing fixtures, no reliance on the working tree.

## Results

| Check                                         | Result                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                      | exit 0                                                                                                                                      |
| Migrations                                    | **119 applied cleanly, no migration 120**                                                                                                   |
| Historical migrations unchanged               | `git diff --diff-filter=MDR` against the base — **empty**                                                                                   |
| Seeds applied twice                           | 7 declared files, idempotent, five exact retention classes, **every business table empty**                                                  |
| Permission catalog                            | **100**                                                                                                                                     |
| Schema hash (before suites)                   | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                                                          |
| Schema totals                                 | 242 tables (`inv` 18), 212 functions, 541 triggers, 631 policies, 999 indexes, 1845 constraints, **0 SECURITY DEFINER**, **0 unforced RLS** |
| `npm run lint` / `typecheck` / `format:check` | exit 0                                                                                                                                      |
| `validate:module-boundaries`                  | 378 files, 11 rules, no violation                                                                                                           |
| `validate:authorization-coverage`             | every operation guarded, every route registered                                                                                             |
| `validate:operation-coverage`                 | every operation invoked with its required evidence                                                                                          |
| `validate:p1-19-inventory`                    | current, 58 operations                                                                                                                      |
| `validate:p1-20-inventory`                    | 17 operations, 27/27 identifiers                                                                                                            |
| `validate:p1-21-inventory`                    | **14 operations, 28/28 identifiers**                                                                                                        |
| `validate:openapi`                            | **169 paths / 199 operations**, all guarded                                                                                                 |
| `validate:encoding`                           | 0 BOM / 0 U+FFFD / 0 mojibake                                                                                                               |
| `security:all`                                | clean, 1319 tracked files                                                                                                                   |
| `npm run test` (unit)                         | **926 passed / 43 files**                                                                                                                   |
| `npm run test:db`                             | **1624 passed / 137 files**                                                                                                                 |
| `npm run test:backend`                        | **1376 passed / 59 files**                                                                                                                  |
| Schema hash (after suites)                    | `a677eb05…` — **identical to before**                                                                                                       |
| `npm run build`                               | exit 0                                                                                                                                      |
| `docker compose config --quiet`               | exit 0                                                                                                                                      |
| `docker build --target runner`                | exit 0                                                                                                                                      |
| Non-root runtime assertion                    | **uid 1001**                                                                                                                                |
| Worktree after everything                     | **clean** (`git status --short` empty)                                                                                                      |
| Teardown                                      | container removed, clone removed                                                                                                            |

Inventory-specific coverage inside those totals: the ten-way concurrent reservation
race resolving to exactly one winner, negative stock refused against a **raw** balance
UPDATE that bypasses every function, all 43 illegal movement/reference triples refused,
the single-use source constraint, audit and outbox atomicity, and the H1–H5 regression
suites.

## The one failure, recorded exactly as it happened

The clean room's **first** `npm run test` reported **925 passed / 1 failed of 926**.

I did not retain that run's failure identity — only the summary tail was captured — so
**I cannot name which test failed**, and I am not going to guess. What is known:

- the immediate re-run in the **same clone at the same SHA** gave **926 passed**, exit 0;
- the final local CI at the executable-identical tree gave **926 passed**, exit 0;
- the same suite had given 926 passed on two earlier runs that day;
- **no code, no timeout and no test was changed** between the failing run and the
  passing one.

The likeliest explanation is a cold-filesystem-cache timeout — the clean room's first
unit run is the first touch of every file after a fresh `npm ci`, and P1-20 recorded
exactly that phenomenon in `tests/foundation/operation-coverage-gate.test.ts`. That is
a plausible explanation, **not** a verified one, and it is written here as such. If it
recurs, the identity must be captured before it is characterised.

## Stated deviations

- **Node 24.16.0** locally vs Node 22 in the workflow; identical lockfile install.
- **No GitHub Actions layer cache** for the Docker stage.
- Only the `runner` Docker target was rebuilt in the clean room; the `dev` target was
  built in the final local CI at the executable-identical tree.
- `npm audit` advisories are not a gate in the workflow and were not treated as one.

## Result

**GREEN** at `0daacb1692ba0c92d0c39d2fad0d074d7767104a`, with the single transient
failure above disclosed rather than omitted.
