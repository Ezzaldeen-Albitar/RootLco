# Phase 1-26 — file ownership

**Classification:** Confidential — Commercial Product and Pilot Planning

The permanent rule, and this phase's measured compliance with it.

---

## 1. The permanent rule

```
apps/api   = Backend / API only
apps/web   = Frontend only
```

`apps/api/src/app/api/**/route.ts` is correct and stays. The repeated `api` is
not a mistake: `apps/api` is the API workspace and `src/app/api` is Next.js's
Route Handler namespace. Renaming it would break 196 handlers to fix a reading
of the path.

## 2. What P1-26 was allowed to change

| Bucket       | Permitted | What P1-26 used it for                                       |
| ------------ | --------- | ------------------------------------------------------------ |
| `web`        | yes       | every screen, feature, test and shared extension             |
| `docs`       | yes       | this phase's documentation                                   |
| `tooling`    | yes       | `scripts/ci/check-p1-26-frontend.mjs`, the command register  |
| `tests`      | yes       | `tests/ci/p1-26-frontend-gate.test.ts`                       |
| `rootConfig` | yes       | `package.json` — the new gate script and the description fix |
| `apiSource`  | **no**    | —                                                            |
| `apiConfig`  | **no**    | —                                                            |
| `migrations` | **no**    | —                                                            |
| `supabase`   | **no**    | —                                                            |

Enforced by `scripts/ci/check-phase-ownership.mjs` under the `p1-26-frontend`
profile, which **fails on an unclassified file**. A file nobody predicted is
exactly the one worth looking at.

## 3. Measured

Run after every wave:

```bash
node scripts/ci/check-phase-ownership.mjs p1-26-frontend origin/develop
```

```
APPS_API_CHANGED_FILES=0
SUPABASE_CHANGED_FILES=0
MIGRATION_CHANGED_FILES=0
UNCLASSIFIED_CHANGED_FILES=0
DUPLICATE_FRONTEND_AUTHORITIES=0
GENERATED_TRACKED_FILES=0
NESTED_LOCKFILES=0
```

## 4. No duplicate authority

P1-26 **extended** the P1-25 foundation and forked none of it.

| Authority      | The one place                         | What P1-26 added                    |
| -------------- | ------------------------------------- | ----------------------------------- |
| Design system  | `src/styles/tokens`, `src/components` | nothing; composed only              |
| Data table     | `src/components/data-table`           | a cursor mode on the existing table |
| Form framework | `src/components/forms/Field.tsx`      | nothing                             |
| Overlays       | `src/components/overlays`             | nothing                             |
| Shared states  | `src/components/states`               | nothing                             |
| API client     | `src/lib/api/client.ts`               | default headers and `If-Match`      |
| i18n           | `src/i18n`                            | keys only, in both catalogues       |
| Brand          | `src/config/brand.ts`                 | nothing                             |
| Colour tokens  | `src/styles/tokens/_colors.scss`      | nothing                             |
| Session        | `src/lib/api/session-cookie.ts`       | **new, and the only one**           |

`check-web-topology.mjs` asserts exactly one brand authority and exactly one
colour-token file. `check-p1-26-frontend.mjs` asserts exactly one session-cookie
authority.

## 5. Route groups

```
apps/web/src/app/[locale]/
├── (auth)      — no session. login, forgot-password, reset-password, activate-account
├── (dashboard) — requires a session. overview, profile, administration/**
└── (design)    — no session. the gallery, and nothing else
```

`(design)` exists because P1-26 made every operational screen require a session
and the gallery is not an operational screen — it renders fixtures, holds no
customer or business data, and is gated by `galleryEnabled()`, which serves a 404
in production unless a deployment opts in.

`apps/web/tests/gallery-and-print.dom.test.tsx` asserts the group holds **only**
the gallery, so a second screen appearing there forces the reasoning to be
re-made rather than inherited.

## 6. If a Backend defect is found

It is not fixed here. The route is:

1. record it as a P1-26 integration finding;
2. name the owning Backend phase;
3. open a **separate** protected remediation branch and pull request;
4. add Backend regression coverage there;
5. bring protected `develop` into the P1-26 branch;
6. re-run every affected P1-26 check.

P1-26 raised eight contract findings (`P1-26-F-003` … `P1-26-F-010`) and routed
**none** of them into this branch: each is a missing capability owned by a later
Backend phase, not a defect in existing behaviour. `P1-26-F-012` is an
unexplained observation in P1-5's shared-services surface, carried and
re-measured rather than patched.
