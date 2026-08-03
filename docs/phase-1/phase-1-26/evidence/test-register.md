# Phase 1-26 — test register

**Classification:** Confidential — Commercial Product and Pilot Planning

Every tier, the command that produced it, and the actual number. Nothing here is
carried forward from an earlier measurement.

---

## At the P1-26 base — `3598de62`

Measured before any P1-26 file was written.

| Tier                 | Command                | Result                     |
| -------------------- | ---------------------- | -------------------------- |
| Root / CI-contract   | `npm run test:unit`    | **1440 / 1440**, 67 files  |
| Web unit / component | `npm run test:web`     | **239 / 239**, 12 files    |
| Backend              | `npm run test:backend` | **1752 / 1752**, 75 files  |
| Database / RLS       | `npm run test:db`      | **1636 / 1636**, 138 files |

> The DB tier reported **1635 / 1636** on its first run — an outbox claim limited
> to 4 returned 6 rows. It passes 3 / 3 in isolation and 1636 / 1636 as a tier on
> its own. **The mechanism is not established**, and it is recorded as
> unexplained (`P1-26-F-012`) rather than closed as flaky.

## At the P1-26 candidate

| Tier                          | Command                        | Result                                 |
| ----------------------------- | ------------------------------ | -------------------------------------- |
| Repository policies           | `npm run verify:policies`      | **exit 0** — 10 gates                  |
| Root / CI-contract            | `npm run test:unit`            | **1474 / 1474**, 68 files              |
| Web unit / component          | `npm run test:web`             | **313 / 313**, 16 files                |
| Web typecheck                 | `npm run typecheck:web`        | exit 0                                 |
| Web lint                      | `npm run lint:web`             | exit 0, 0 warnings                     |
| Stylelint                     | `npm run style:check:web`      | exit 0                                 |
| Web boundary / brand / tokens | 3 gates                        | 0 violations, 0 raw values             |
| Production build              | `npm run build:web`            | exit 0, 21 routes, 29 s, 1.1 MB static |
| Browser — pinned chromium     | `npm run test:web-e2e`         | **106 passed · 0 failed · 4 skipped**  |
| Browser — installed Chrome    | `ROOTLCO_E2E_CHANNEL=chrome …` | **106 passed · 0 failed · 4 skipped**  |

**The 4 skips are one project-scoped test**, not a suppression: the
reduced-motion assertion declines the four projects it does not apply to and runs
— and passes — in `reduced-motion`. **No required executable test is skipped.**

## What each new suite proves

| Suite                                          | Tests                                                                         | The thing it exists to catch                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/authentication.test.ts`        | schemas, tokens, cookie, scope, action results, initials                      | a failure that becomes an oracle; a token that travels; a cookie that is script-readable; an empty scope read as "no access" |
| `apps/web/tests/administration.test.ts`        | catalogue drift, setting keys, coercion, cursor pagination, source-tree rules | a permission code that has left the catalogue; a business default acquired by accident; a fabricated total                   |
| `apps/web/tests/data-table.dom.test.tsx`       | counted mode, cursor mode, loading, denial                                    | a count nobody sent; a disabled Last that implies a reachable last page; rows painted under a denial                         |
| `apps/web/tests/observability.test.ts`         | redaction by key and by value, route sanitising, adapter                      | a credential in a log, and specifically `{ data: accessToken }` where the key is innocent                                    |
| `apps/web/tests/api-client.test.ts` (extended) | idempotency key, `If-Match`                                                   | **`P1-26-F-015`** — the header ten operations require and no call site sent                                                  |
| `tests/ci/p1-26-frontend-gate.test.ts`         | 27 mutation tests                                                             | a gate that has never failed, and a scanner that reads comments                                                              |
| `tests/ci/command-coverage.test.ts` (extended) | 7 cases on formatter scope                                                    | **`P1-26-F-043`** — a root command whose name reads as repository-wide while it is configured to skip every workspace        |

## Backend and Database at the candidate

P1-26 changed **no** file either tier reads: `apiSource`, `apiConfig`,
`supabase` and `migrations` are all **0** changed files, asserted by
`check-phase-ownership.mjs` on every wave. The base-SHA measurements above stand,
and the clean-room run re-measures both from a fresh checkout — see
`clean-room-evidence.md`.

## How a result is recorded here

The actual number, from the actual run, with the command beside it. Where a run
disagreed with an earlier one — the DB tier, and the root count moving from 1440
to 1467 and then to 1474 as this phase added tests — every figure appears and the
difference is explained. A register that silently carries forward a convenient
number is a register nobody can use.

The last seven are `tests/ci/command-coverage.test.ts`, added for
`P1-26-F-043`: they pin the fact that the root formatter is configured to skip
every workspace, so a green root `format:check` is not evidence about
`apps/web` and cannot be substituted for `verify:web`.
