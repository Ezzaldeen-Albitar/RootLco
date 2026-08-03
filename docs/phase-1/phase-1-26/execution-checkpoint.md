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

| Wave  | Scope                                                                          | State        |
| ----- | ------------------------------------------------------------------------------ | ------------ |
| 1     | Readiness, branch, baselines, architecture, contract archaeology, task records | **Complete** |
| 2     | Login, session expiration, session plumbing                                    | **Complete** |
| 3     | Forgot password, password reset, account activation                            | **Complete** |
| 4     | Invitation, profile                                                            | **Complete** |
| 5–9   | Administration screens — all eleven                                            | **Complete** |
| 10–13 | Security, QA, CI/DevOps, documentation                                         | **Complete** |
| 14    | Browser review, on pinned chromium and installed Chrome                        | **Complete** |
| 15    | Performance and bundle baseline                                                | **Complete** |
| 16    | Adversarial review and remediation                                             | **Complete** |
| 17    | Exact-SHA clean room                                                           | **Complete** |
| 18    | Feature PR and exact-head CI                                                   | **Complete** |
| 19–20 | Protected merge, gate record                                                   | In progress  |

### Wave 16 is the one worth reading

Six independent review lenses over the complete diff, each finding verified by a
pass instructed to **refute** it. Thirty-three raised; the survivors are
`P1-26-F-015` … `P1-26-F-041` in `findings.md`.

It found a **critical** defect that every other form of assurance in this phase
missed: ten operations declare `idempotent: true`, the backend requires an
`Idempotency-Key` header for each of them, and **no call site sent one**. Every
invitation, lifecycle change, role edit, permission mapping, approval limit and
settings write would have failed with HTTP 400 the first time a real operator
touched them — while `verify:workspaces`, 287 web tests, 1465 root tests, the
production build and 106 browser assertions were all green.

Nothing local could have caught it. The requirement lives on the far side of a
boundary no test in this repository crosses, because crossing it needs a real
account in a real tenant and the no-fake-data policy forbids seeding one. That
gap is recorded in `browser-evidence.md` §3, and this is what it costs.

Two more worth naming: a 403 on the session read cleared a valid cookie and
produced an **unbreakable sign-in loop** for any account without
`iam.user.read` (`F-022`), and the session cookie's `Secure` attribute **failed
open** because its environment variable defaulted to `local` (`F-023`).

## 4. Ownership report — at the candidate

Measured with
`node scripts/ci/check-phase-ownership.mjs p1-26-frontend 3598de62…` at
`b4794e79206396f220af28f523f0e90a6b186e8f`. **123 changed files, 0 violations**:
`web=85 · docs=31 · tests=4 · tooling=2 · rootConfig=1`.

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

The per-file listing is `evidence/changed-file-ownership.md`. The `apiSource`,
`apiConfig`, `supabase` and `migrations` buckets do not merely read zero — no
file classified into any of them, so they are absent from the report entirely.

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

## 6. Decisions taken in waves 5–16

**The shared table learned cursor pagination.** `TableResponse.total` is
`number | null`; `null` renders as no count, no First and no Last. See
`P1-26-F-001`, and `P1-26-F-018` and `P1-26-F-024` for the two places the same
mistake reappeared from different directions inside this phase.

**The API client attaches an idempotency key to every POST.** Semantically
correct only because the client never retries a mutation — one `send` is one
logical attempt. An explicit key always wins. See `P1-26-F-015`.

**A 403 does not clear the session cookie.** Only a 401 does. Destroying a valid
credential because a permission is missing produced an unbreakable sign-in loop.

**`NEXT_PUBLIC_APP_ENV` defaults to `production`.** The unsafe mode is the one
you have to ask for.

**Five screens are settings-backed and say so on the page.** The key namespace is
`P1-26-OD-001`, awaiting Owner ratification.

## 7. What waves 17–18 cost

Three defects surfaced after the phase was "finished", each invisible to
everything that had already run green:

- **`F-042`** — a credential-shaped literal in the test that forbids logging
  credentials. Caught by hosted CI, because `verify:policies` does not include
  `security:all`.
- **`F-043`** — sixteen unformatted `apps/web` files. Caught by hosted CI twice
  over, because the root `format:check` is configured to skip `apps/` and cannot
  see the Frontend at all.
- **`F-044`** — a five-second test timeout that measured process scheduling.
  Caught by the clean room, and by nothing else; hosted CI was 20/20 green at the
  same tree.

The pattern in the first two is one thing said twice: a command's **name** was
mistaken for its **scope**. Both are now pinned by tests, and the clean room runs
the formatter and the secret scan it previously did not.

## 8. Resume point

Wave 19 — merge the feature PR into protected `develop` with a merge commit,
verify the protected SHA, then the P1-26 gate record.
