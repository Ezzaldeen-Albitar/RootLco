# P1-21 — Fresh Exact-SHA Clean Room

**Ran against: this pull request's head commit**, in a fresh clone detached at that
commit. The SHA is deliberately not transcribed here — see `final-local-ci.md` for why
— and is recorded exactly in the gate record, which is created from the protected merge
commit and can name a SHA without moving it.

## Isolation

- **Fresh clone** into a directory outside the working tree, `--no-hardlinks`.
- **Detached** at the exact SHA, so the clone cannot follow a branch that moves.
- **`npm ci`** — lockfile only, never `npm install`.
- **Own database**: a disposable `postgres:17-alpine` container on an isolated port, no
  volume. Verified genuinely empty before use: `PostgreSQL 17.10`, and
  `SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN
('pg_catalog','information_schema')` returned **0**. The script aborts if it does not.
- No developer database, no pre-existing fixtures, no reliance on the working tree.

## Results

| Check                                          | Result                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                       | exit 0                                                                                                                                      |
| Migrations                                     | **119 applied cleanly, no migration 120**                                                                                                   |
| Historical migrations unchanged                | `git diff --diff-filter=MDR` against the base — **empty**                                                                                   |
| Seeds applied twice                            | 7 declared files, idempotent, five exact retention classes, **every business table empty**                                                  |
| Schema hash (before suites)                    | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                                                          |
| Schema totals                                  | 242 tables (`inv` 18), 212 functions, 541 triggers, 631 policies, 999 indexes, 1845 constraints, **0 SECURITY DEFINER**, **0 unforced RLS** |
| `validate:module-boundaries`                   | no boundary or layering violation                                                                                                           |
| `validate:authorization-coverage`              | every operation guarded, every route registered                                                                                             |
| `validate:operation-coverage`                  | every operation invoked with its required evidence                                                                                          |
| `validate:p1-19-inventory`                     | current, 58 operations                                                                                                                      |
| `validate:p1-20-inventory`                     | 17 operations, 27/27 identifiers                                                                                                            |
| `validate:p1-21-inventory`                     | **14 operations, 28/28 identifiers**                                                                                                        |
| `validate:openapi`                             | **169 paths / 199 operations**, all guarded                                                                                                 |
| `validate:encoding`                            | 0 BOM / 0 U+FFFD / 0 mojibake                                                                                                               |
| `lint` / `typecheck` / `format:check`          | exit 0                                                                                                                                      |
| `security:tracked-secrets` / `browser-secrets` | exit 0                                                                                                                                      |
| `validate:no-fake-data`                        | exit 0                                                                                                                                      |
| `npm run test` (unit)                          | **926 passed / 43 files — first attempt, no retry**                                                                                         |
| `npm run test:db`                              | **1624 passed / 137 files**                                                                                                                 |
| `npm run test:backend`                         | **1380 passed / 59 files**                                                                                                                  |
| Schema hash (after suites)                     | `a677eb05…` — **identical to before**                                                                                                       |
| `npm run build`                                | exit 0 — see the incident below                                                                                                             |
| `docker compose config --quiet`                | exit 0                                                                                                                                      |
| `docker build --target runner`                 | exit 0                                                                                                                                      |
| Non-root runtime assertion                     | **uid 1001**                                                                                                                                |
| Worktree after everything                      | **clean** (`git status --short` empty)                                                                                                      |

Inventory-specific coverage inside those totals: the ten-way concurrent reservation
race resolving to exactly one winner, negative stock refused against a **raw** balance
UPDATE that bypasses every function, all illegal movement/reference triples refused,
the single-use source constraint, audit and outbox atomicity, and the H1–H6 regression
suites.

## The unit failure from the previous clean room did not recur

The clean room at the earlier tree reported **925 passed / 1 failed** on its first
`npm run test`, and that run's failure identity was not retained — so it could not be
named, and it was recorded as unexplained rather than guessed at.

**This clean room's first unit run passed 926/926, exit 0, with no retry.** The
complete stdout and stderr of every step were retained this time specifically so that a
recurrence could be identified rather than characterised. There was nothing to identify.

## One environmental incident, diagnosed rather than retried

`npm run build` failed **exit 1** on its first attempt with a Turbopack panic:

```
path length for file "…\scratchpad\cleanroom\RootLco\.next\server\chunks\
1oeh_server_app_api_v1_rework-links_[reworkLinkId]_sign-off_route_actions_0hy3upc.js"
exceeds max length of filesystem
Caused by: file is too long, and could not be normalized
```

This is a **Windows `MAX_PATH` (260 character) limit reached by the clean room's own
directory**, and it is proven rather than assumed — the error names the path and the
cause outright. Three things confirm it is not a repository defect:

1. The clone directory was **156 characters** before Turbopack appended
   `.next\server\chunks\` and an 84-character generated chunk name.
2. The named file belongs to `rework-links/[reworkLinkId]/sign-off` — a **P1-19**
   route, untouched by this phase.
3. The **same clone**, moved to `C:\cr\RootLco` (13 characters) with `.next` removed
   and nothing else changed, built **exit 0**. The local equivalent CI, which runs at
   the ordinary repository path, also built exit 0.

No timeout was raised, no code was changed, and the build was not simply retried in
place until it passed — the cause was identified first and the fix addressed that cause.
The clean-room runbook now requires a short clone path so this cannot recur.

## Stated deviations

- **Node 24.16.0** locally vs Node 22 in the workflow; identical lockfile install.
- **No GitHub Actions layer cache** for the Docker stage.
- Only the `runner` Docker target is rebuilt in the clean room; the `dev` target is
  built in the local equivalent CI at the same tree.
- `npm audit` advisories are not a gate in the workflow and were not treated as one.

## Result

**GREEN**, with the single environmental incident above disclosed, diagnosed and
resolved rather than omitted.
