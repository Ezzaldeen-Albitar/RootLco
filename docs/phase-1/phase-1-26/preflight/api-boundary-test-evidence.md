# Pre-P1-26 — API boundary test evidence

Every tier run on the remediation branch. Exit codes read from the commands themselves,
never from a pipeline — a lesson this repository has recorded twice.

## Contract invariants — the ones that prove nothing broke

| Property                            | Base `9e70c61c` | Remediation   | Verdict                  |
| ----------------------------------- | --------------- | ------------- | ------------------------ |
| API Route Handler files             | 196             | **196**       | unchanged                |
| Non-route files in the API app tree | 3               | **0**         | scaffold gone            |
| Stylesheets under `apps/api`        | 18              | **0**         | scaffold gone            |
| OpenAPI paths / operations          | 195 / 226       | **195 / 226** | unchanged                |
| Registered operations covered       | 226             | **226**       | unchanged                |
| Migrations                          | 119             | **119**       | unchanged, none modified |
| Schema hash                         | `a677eb05…`     | `a677eb05…`   | unchanged                |
| Tracked files under `apps/api`      | 456             | 436           | −20, all Frontend        |

The API surface is byte-for-byte the same surface. Twenty files left the workspace and
not one of them was reachable from a route.

## The build is the evidence for the root layout

```text
npm run build:api   →   BUILD_EXIT=0
                        196 routes emitted, all under /api/
                        0 page routes emitted
                        0 non-/api routes emitted
```

Next.js 16.2.12 does not require a root layout for a Route-Handler-only application. This
was measured, not inferred, and the gate's framework allowlist is empty as a result.

## Gate results

| Gate                                    | Result                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate:api-backend-only`             | 196 route handlers, 428 source files scanned, **0 failures**                                                                                          |
| `validate:generated-artifacts`          | 1671 tracked files, 1 lockfile, 7/7 ignore rules, **0 failures**                                                                                      |
| `validate:phase-ownership api-boundary` | 41 changed files, **0 violations** — `apiSource=20 · apiConfig=2 · docs=8 · tooling=6 · tests=3 · rootConfig=1 · web=1`, **migrations=0, supabase=0** |
| `validate:web-topology`                 | 18 expectations, 78 matched files, **0 failures**                                                                                                     |
| `validate:command-coverage`             | 125 registered, 62 required, **62/62** reachable locally and in hosted CI                                                                             |
| `verify:policies`                       | **exit 0**                                                                                                                                            |

## Regression suites

| Tier                    | Result                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| Root unit / CI-contract | 1340 → **1401 / 1401** across 64 files (+61, the new gate suites) |
| Web unit / component    | **236 / 236** across 12 files                                     |
| Web browser matrix      | **81 / 81** across 5 projects                                     |
| Backend tier            | **1752 / 1752** across 75 files                                   |
| Database / RLS tier     | **1636 / 1636** across 138 files                                  |
| `verify:workspaces`     | **exit 0**                                                        |

Every number above was read from the run that produced it. The first draft of this
table carried 1385 and "45 new tests" — both estimated rather than measured, and both
wrong. Corrected before merge, which is the only reason it is worth writing down.

Web behaviour is unchanged by construction: the only web file this remediation touches is
`apps/web/package.json`, which gains the `style:lint` and `style:fix` scripts the API
used to own. No web source, no web test and no web configuration changed.

## The mutation suites are the point

61 tests across three files, and they are not decoration — they caught a real defect
before it merged. `tests/ci/api-backend-only.test.ts` proved that the gate's five import
rules matched nothing, because the gate stripped string literals before scanning and an
import specifier _is_ a string literal. Without those tests the gate would have shipped
green, reporting success while enforcing five fewer rules than it claimed.

| Suite                                  | Tests | Covers                                                                                                                                                                       |
| -------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/ci/api-backend-only.test.ts`    | 31    | healthy tree with anti-vacuity counts · one mutation per violation class · rule-scope integrity · **four false-positive cases** · `stripNonCode` behaviour                   |
| `tests/ci/generated-artifacts.test.ts` | 16    | healthy tree · one mutation per generated class · nested/absent lockfile · deleted ignore rule · the directory-does-not-cover-file case (`P1-25-F-025`) · empty-list vacuity |
| `tests/ci/phase-ownership.test.ts`     | 14    | classification per bucket · both profiles · each forbidden bucket · unclassified file · empty-diff vacuity · unknown profile                                                 |

The four false-positive tests exist because the first draft flagged four lines of correct
Backend code. They pin the domain variable named `document`, the domain property named
`window`, browser words inside comments and strings, and the server-only `typeof window`
guard — so a future tightening of the rules cannot quietly reintroduce the noise that
gets gates switched off.

## ESLint, proven to fire

A probe file reading the real globals was reported and then deleted:

```text
error  Unexpected use of 'navigator'.     no-restricted-globals
error  Unexpected use of 'localStorage'.  no-restricted-globals
```

The same file's local `const document = …` was **not** reported — which is the whole
reason this half of the rule lives in ESLint rather than in a text search.
