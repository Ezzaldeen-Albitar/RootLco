# Phase 1-26 — execution checkpoint

**Classification:** Confidential — Commercial Product and Pilot Planning

Updated after every coherent wave. This is the resume point: if execution stops,
work continues from the first incomplete wave below.

---

## 1. Branch and base

|                         |                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `P1_26_BRANCH`          | `feature/p1-26-authentication-administration-frontend`                               |
| `P1_26_BASE_SHA`        | `3598de624dbc181b742cc40700464115ba5c4fc6`                                           |
| `P1_26_BASE_TREE`       | `23c8a2b504a23ba86cbb7366cb3d8d051397b979`                                           |
| `P1_26_INITIAL_HEAD`    | `3598de624dbc181b742cc40700464115ba5c4fc6` (branch point)                            |
| Worktree                | `C:\Users\Ezzaldeen\OneDrive\Desktop\1millions\RootLco` — the visible Owner checkout |
| `origin/main` at branch | `f085d82001a43de51725707426d5c10eb134c004` — untouched                               |

## 2. Baselines measured at the base SHA

Measured live, on this machine, before any P1-26 file was written.

| Baseline                      | Value                                                                      |
| ----------------------------- | -------------------------------------------------------------------------- |
| `P1_26_API_ROUTE_COUNT`       | **196** route handlers                                                     |
| `P1_26_MIGRATION_COUNT`       | **119**                                                                    |
| `P1_26_SCHEMA_HASH`           | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`         |
| `P1_26_ROOT_TEST_BASELINE`    | **1440 / 1440** across 67 files                                            |
| `P1_26_WEB_TEST_BASELINE`     | **239 / 239** across 12 files                                              |
| `P1_26_BACKEND_TEST_BASELINE` | **1752 / 1752** across 75 files                                            |
| `P1_26_DB_RLS_BASELINE`       | **1636 / 1636** across 138 files                                           |
| `P1_26_CODEQL_BASELINE`       | 0 open alerts on `develop`, `main`, repository-wide                        |
| `P1_26_DEPENDENCY_BASELINE`   | 0 vulnerabilities, 0 waivers; 6 Dependabot PRs open (#166–#171), untouched |
| P1-26 readiness               | **READY — 9 of 9**, captured pre-branch                                    |

> The root count is **1440**, not the 1438 recorded at the P1-25 gate. The
> difference is not a new test file: `tests/ci/canonical-documents.test.ts` and
> `tests/ci/documented-counts.test.ts` derive cases from the documents present in
> the tree, and the P1-25 gate record merged after the count was taken. The
> figure above is the live measurement at the P1-26 base and is the one this
> phase is measured against.

### The DB/RLS baseline needed two measurements, and why

The first full run reported **1635 / 1636** — `tests/db/shared-event-outbox.test.ts`

> "a single claim never returns more than its limit" saw a limit-4 claim return
> 6 rows. That run executed the DB tier immediately after the 469-second backend
> tier in the same shell.

Re-measured: the file passes **3 / 3** in isolation, and the full DB tier passes
**1636 / 1636** when run on its own. The mechanism has **not** been established —
`shared.claim_outbox_events` applies `LIMIT p_limit` inside a
`FOR UPDATE SKIP LOCKED` subquery and cannot over-select within one statement, so
the observation is not yet explained by reading the function. Recorded as
`P1-26-F-012` rather than dismissed. P1-26 has changed no file the DB tier reads.

## 3. Wave status

| Wave  | Scope                                                                          | State                                                  |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1     | Readiness, branch, baselines, architecture, contract archaeology, task records | **Complete**                                           |
| 2     | Login, session expiration, session plumbing                                    | **Complete**                                           |
| 3     | Forgot password, password reset, account activation                            | **Complete**                                           |
| 4     | Invitation, profile                                                            | Profile complete; invitation lands with Users (wave 5) |
| 5–9   | Administration screens                                                         | Not started                                            |
| 10–13 | Security, QA, CI/DevOps, documentation                                         | Not started                                            |
| 14–17 | Browser review, performance, adversarial review, clean room                    | Not started                                            |
| 18–20 | Feature PR, protected merge, gate record                                       | Not started                                            |

## 4. Ownership report — after wave 4

Measured with `node scripts/ci/check-phase-ownership.mjs p1-26-frontend origin/develop`.

```
APPS_API_CHANGED_FILES=0
SUPABASE_CHANGED_FILES=0
MIGRATION_CHANGED_FILES=0
UNCLASSIFIED_CHANGED_FILES=0
DUPLICATE_FRONTEND_AUTHORITIES=0
GENERATED_TRACKED_FILES=0
NESTED_LOCKFILES=0
CURRENT_FAILED_TESTS=0
CURRENT_SKIPPED_TESTS=0
```

## 5. Decisions taken in wave 1–4

**The session is an `httpOnly` cookie.** The backend is bearer-authenticated and
something must hold the token between requests. A cookie the page cannot read
satisfies the "no token in browser storage" rule structurally rather than by
convention. Rules live in one file, `src/lib/api/session-cookie.ts`.

**The refresh token is discarded.** `POST /api/v1/auth/login` returns one and
there is no `/auth/refresh` operation in the route tree, so storing it would be
storing a credential nothing can spend. Session lifetime is therefore the access
token's lifetime — recorded in `known-limitations.md`.

**The gallery moved to a `(design)` route group.** Every screen under
`(dashboard)` now requires a session. The gallery renders fixtures only, holds no
customer or business data, and is already gated by `galleryEnabled()`, which
serves a 404 in production unless a deployment opts in. Putting it behind the
session would have broken the review workflow it exists for. The decision is
recorded in the group's own layout rather than left implicit in a file location.

**The shared table learned cursor pagination.** Every P1-26 list operation is
cursor-based with no total count; the P1-25 table required one. Extended rather
than forked — see `P1-26-F-001`.

**`org.settings.read` was replaced.** The P1-25 Settings entry was gated on a
permission code that appears in no catalogue and no operation, so "unknown means
denied" hid it from every actor who has ever existed. See `P1-26-F-011`.

## 6. Resume point

Wave 5 — Organization settings and Users.
