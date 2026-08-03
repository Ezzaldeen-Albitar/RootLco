# Phase 1-26 — execution checkpoint

**Classification:** Confidential — Commercial Product and Pilot Planning

> **CANONICAL STATUS: TECHNICAL GATE PASSED — OWNER MANUAL ACCEPTANCE PENDING**
>
> The technical gate (`gate-record.md`, P1-G26 Go, protected `develop`
> `0ad993cc`) is preserved and accurate **as technical verification**. It was not
> Owner acceptance, and it was recorded as a final closure it had not earned —
> the phase's own final report listed five things it had not proven.
>
> P1-26 is reopened for Owner Acceptance Remediation. See
> [owner-acceptance-remediation.md](owner-acceptance-remediation.md). Formal
> closure is pending the Owner's explicit `OWNER ACCEPTANCE: PASS`.

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

## 8. Owner Acceptance Remediation — waves 21–25

Reopened after the technical gate was recorded as a final closure it had not
earned. See [owner-acceptance-remediation.md](owner-acceptance-remediation.md).

| Wave | Scope                                                                        | State        |
| ---- | ---------------------------------------------------------------------------- | ------------ |
| 21   | Superseding status record; Owner logo assets integrated                      | **Complete** |
| 22   | Local-only Owner acceptance account, Tenant A and Tenant B, fixtures         | **Complete** |
| 23   | Authenticated browser suite, authenticated accessibility, cross-tenant proof | **Complete** |
| 24   | Full verification, clean room, remediation PR, protected merge               | In progress  |
| 25   | Owner handoff — servers and browser left running, credentials supplied       | Not started  |

### What running the product actually found

Five defects, none of which any existing tier could have caught, all found by
starting the system and looking at it:

- **`F-045`** — the local provider signed ES256 while the API verifies HMAC only.
  Sign-in returned 200 and the next request 401. Every authentication test uses
  a fake provider, so no suite had ever verified a token this provider signed.
- **`F-046`** — **no page had a `<title>`**, on any route, in either language.
- **`F-047`** — malformed definition lists on two screens.
- **`F-048`** — **no client component ever ran locally.** Every table on every
  screen sat empty for ever, and the application looked fully loaded.
- **`F-049`** — the approved symbol was invisible on the navy surfaces.

`F-048` is the one to remember. The browser suite runs a production build, where
the defect does not exist; the jsdom tier has no server. The single
configuration a developer and the Product Owner actually use was the one no tier
exercised.

### And what the tooling built to find those five was itself hiding

`F-051` — seven CodeQL findings, every one of them in the acceptance tooling this
remediation added. Green in both clean-room runs, green in the running system,
and invisible to every local check, because a security analyser is a fourth tier
that none of the other three contains.

Two of the seven then survived a fix round, because I enumerated the results by
security severity and the repository's gate does not. On that run GitHub's own
`CodeQL` check reported **success** with two open findings in the tree — it
blocks on high and critical only — while the repository's `code-security` gate,
which counts every severity, stayed red. The gate's own baseline file had
predicted exactly that, in writing, before it happened.

Tooling written to verify the product is product code, and it earns review on the
same terms. It now has tests.

### Wave 26 — the fixture lifecycle, and the instrument that lied

Three more, and the first two are about the tooling rather than the product.

**`F-057`** — the acceptance fixtures and the clean-database invariant cannot
both be true at once. Four ways to make the red go away were available and every
one of them shrinks the invariant. The resolution is ordering, now executable as
`npm run acceptance:full-cycle`: clean, prove clean, create, use, reset, prove
removed, prove clean again. **Neither Database test was touched.**

**`F-056`** — the reset's hand-written list of seventeen tables could not be
trusted against **232 tenant-scoped tables**, and its one known error had already
cost the audit trail. Worse, the miss was fatal rather than partial: every one of
those tables has an `ON DELETE RESTRICT` key to `org.tenants`, so a single
surviving row anywhere makes the final delete raise `23503` and the whole reset
roll back — after printing a column of "removed N" lines. It is now generated
from the catalogue, ordered by real foreign keys, and cannot go stale.

**`F-055`** — `next dev` and `next start` share `.next`, and a production build
left there made the dev server answer **404** on routes that were correct. I
measured it, reproduced it, saw it differ cleanly between modes, and reported it
to the Owner as a product defect. It was a contaminated instrument. The tell came
from attempting the fix: removing a locale guard broke a page that had been
working, which is not how a real fix behaves.

**Reproducibility is not validity.** A contaminated instrument produces
consistent readings, and consistency was the entire basis on which I believed it.

## 9. Resume point

Wave 25 — the Owner handoff, then P1-26 closes if and only if the Product Owner
records `OWNER ACCEPTANCE: PASS`.
