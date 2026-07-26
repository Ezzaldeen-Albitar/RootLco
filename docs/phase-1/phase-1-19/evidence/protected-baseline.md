# P1-19 — Protected baseline evidence

Executed on the untouched protected base **before** any P1-19 file was created, so
that every later failure is attributable.

```
P1_19_BASE_SHA = f326e24c0340e2ce97a94a768868a26d0cfbb04f
Branch         = feature/p1-19-module-foundation (created from that SHA)
merge-base with origin/develop = f326e24c0340e2ce97a94a768868a26d0cfbb04f
Working tree   = clean
```

## Static gates

| Gate                                              | Exit | Result                                                                                      |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| `npm run format:check`                            | 0    | All matched files use Prettier code style                                                   |
| `npm run lint`                                    | 0    | clean                                                                                       |
| `npm run typecheck`                               | 0    | clean                                                                                       |
| `npm run validate:module-boundaries`              | 0    | no boundary or layering violation                                                           |
| `npm run validate:authorization-coverage`         | 0    | every operation guarded, every route registered                                             |
| `npm run validate:openapi`                        | 0    | OpenAPI 3.1.0 — **94 paths, 110 operations**, all guarded                                   |
| `npm run validate:wo-tech-dia-qms-classification` | 0    | **657** columns classified (3 restricted, 0 searchable); registry and live schema reconcile |
| `npm run security:all`                            | 0    | 4 sub-scripts, 5 OK assertions, **1104** tracked files                                      |

## Test suites

| Suite                  | Files   | Tests    | Result |
| ---------------------- | ------- | -------- | ------ |
| `npm run test` (unit)  | **39**  | **829**  | passed |
| `npm run test:db`      | **132** | **1547** | passed |
| `npm run test:backend` | **38**  | **771**  | passed |

These totals match the P1-18 closure record exactly, confirming the branch really
was cut from the protected P1-18 state and not from a stale local ref.

## Baseline verdict

**Green.** No pre-existing protected failure, no environment failure, no missing
local dependency, no hosted-only divergence. Any red result later in this phase is
therefore a P1-19 regression and must be fixed rather than attributed to inherited
debt.

## Known pre-existing conditions carried from P1-18

Recorded so they are not rediscovered and misattributed:

| Item                      | Note                                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-05-SEEDRESIDUE`       | `npm run validate:seed-state` fails on a developer database **after** `test:db` has run, because `tests/db/shared-retention.test.ts` overwrites governed retention periods and never restores them. It passes in a clean room. Not a P1-19 signal.              |
| `validate:seed-state` env | The script reads `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` and **ignores `DATABASE_URL`**, defaulting to port 54322. A clean-room run must pass `DB_PORT` explicitly or it silently validates the developer database.                               |
| `P1-18-R-08`              | Six gate scripts (`validate:canonical-docs`, `:schema-inventory`, `:structural-review`, `:upgrade-matrix`, `:baseline-manifest`, `gate:p1-12`) are declared in `package.json` but not run by CI. P1-19 must run them locally rather than assume CI covers them. |

## Commands executed

```bash
git fetch --all --prune
git rev-parse origin/develop origin/main HEAD
git merge-base --is-ancestor 315f9d3957150c83cd456146e6027f6978cc8473 origin/develop
git checkout -b feature/p1-19-module-foundation f326e24c0340e2ce97a94a768868a26d0cfbb04f

npm run format:check
npm run lint
npm run typecheck
npm run validate:module-boundaries
npm run validate:authorization-coverage
npm run validate:openapi
npm run validate:wo-tech-dia-qms-classification
npm run security:all
npm run test
npm run test:db
npm run test:backend
```
