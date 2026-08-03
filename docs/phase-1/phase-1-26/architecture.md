# Phase 1-26 — Authentication and Administration Frontend — architecture

**Classification:** Confidential — Commercial Product and Pilot Planning

|                  |                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| **Phase**        | P1-26 — Authentication and Administration Frontend                                                              |
| **Workspace**    | `apps/web` only. `apps/api` is Backend/API-only and its executable diff stays **0**.                            |
| **Base**         | protected `develop` `3598de624dbc181b742cc40700464115ba5c4fc6`, tree `23c8a2b504a23ba86cbb7366cb3d8d051397b979` |
| **Design basis** | the approved P1-25 design system and component gallery (Owner decision, no separate prototype package)          |
| **Product name** | **CRM**, resolved from the single brand authority — never written literally in a component                      |

---

## 1. What this phase is

Eighteen screens, in two families, on top of a foundation that already exists.

**Authentication** — login, forgot password, password reset, invitation, account
activation, profile, session expiration.

**Administration** — organization settings, users, roles, permissions, approval
limits, numbering rules, taxes, currencies, languages, audit log, system
settings.

Everything visual is composed from P1-25: the shell, the sidebar, the data
table, the form framework, the overlays, the shared states, the Arabic and
English catalogues, the RTL/LTR system, the API client, the accessibility
helpers, the print foundation, the brand configuration and the token layer.
**No second design system, no second table, no second form system, no second
API client, no second i18n or brand authority.**

## 2. Directory layout

```
apps/web/src/
├── app/[locale]/
│   ├── (auth)/                    ← no shell: centred card, brand, locale switcher
│   │   ├── layout.tsx
│   │   ├── login/
│   │   ├── forgot-password/
│   │   ├── reset-password/
│   │   └── activate-account/
│   └── (dashboard)/               ← inherits AppShell
│       ├── profile/
│       └── administration/
│           ├── organization/  users/  roles/  permissions/
│           ├── approval-limits/  numbering-rules/
│           ├── taxes/  currencies/  languages/
│           └── audit-log/  system-settings/
│
├── features/
│   ├── authentication/            api · actions · components · schemas · types
│   └── administration/            one folder per domain, same internal shape
│
├── components/                    P1-25 shared primitives (extended, never forked)
├── config/  i18n/  lib/  styles/  test/
```

`apps/web/features/` (root level) is a **forbidden** prefix in
`scripts/ci/check-web-topology.mjs`; features live under `src/`.

## 3. The session, and why it is a cookie

The Backend authenticates with a **Bearer token** (`iam/auth/bearer-authenticator`).
`POST /api/v1/auth/login` returns `accessToken`, `refreshToken`, `expiresAt` and
the caller's own identity.

That token is held in a **`httpOnly`, `sameSite=lax`, `secure`-in-production
cookie**, written by a Server Action and never readable by page script.

Three properties follow, and each is a P1-26 requirement:

1. **No token in browser storage.** `localStorage`, `sessionStorage`, IndexedDB
   and any persisted store hold nothing. A `httpOnly` cookie is not script-
   reachable, which is the point — the prohibition exists to stop XSS from
   reading a credential, and a cookie the page cannot read satisfies it.
2. **No protected-content flash.** Every dashboard route is a Server Component
   that calls `requireSession()` _before it renders_. An expired or missing
   session redirects; protected markup is never generated, so it can never be
   sent and then hidden.
3. **Scope is server-resolved, always.** `GET /api/v1/auth/session` runs the
   full authorization pipeline and returns `tenantId`, `companyIds`, `branchIds`
   and `permissions` as the server resolved them for that request. The browser
   supplies none of it and cannot override any of it.

The cookie name, attributes and clearing rules live in exactly one file,
`src/lib/api/session-cookie.ts`.

## 4. How the web tier talks to the Backend

`src/lib/api/` is the only place network I/O happens —
`apps/web/scripts/check-api-boundary.mjs` fails the build otherwise.

- `client.ts` — the P1-25 typed client. Extended in this phase with
  request headers (`Authorization`, `If-Match`), because version-guarded
  operations require `If-Match` and the Backend is Bearer-authenticated. It
  still never retries a mutation.
- `server-client.ts` — a server-only factory that reads the session cookie and
  returns a client already carrying the bearer token. Server Components and
  Server Actions use it; nothing in the browser can.
- Feature `api/` adapters define request and response types, call approved
  `/api/v1/**` operations through the client, and map problem details into the
  shared view states. They do **not** fetch, do not hard-code a host, and do not
  invent an endpoint.

Server Actions live in `features/authentication/actions/` and
`features/administration/*/actions.ts`. They are the only place a mutation is
issued, so the correlation ID, the `If-Match` guard and the failure mapping are
in one place per operation instead of scattered through components.

## 5. Pagination: the shared table now speaks both dialects

P1-25's table is **offset-based** — `page`, `pageSize`, `total`. Every P1-26
list operation is **cursor-based** — `{ items, nextCursor, hasMore }` with **no
total count** (`apps/api/src/server/db/pagination.ts`).

The table was extended rather than forked (finding `P1-26-F-001`):

- `TableResponse.total` is now `number | null`. `null` means _the server does
  not publish a count_, which is the truth for every cursor-paginated list.
- `TableResponse.hasMore` carries the server's own end-of-set signal.
- With `total === null` the pagination control shows the current page and
  Previous/Next only. First and Last are hidden, because the last page of a
  cursor-paginated set is not knowable without walking it.
- `useCursorPages` keeps the cursor for each visited page so Previous is exact
  rather than a re-query from the start.

Inventing a total — by counting the current page, by guessing, or by adding a
count the Backend does not expose — would have produced a pager that is correct
on page one and wrong everywhere else.

## 6. Permissions

`src/lib/permissions.ts` is unchanged and remains the authority: **unknown means
denied**, and there is no role shortcut anywhere. P1-26 adds:

- `PERMISSIONS` — the codes this phase's screens reference, as named constants,
  so a typo is a compile error rather than a silently hidden control.
- Route-level enforcement: a page whose operation the actor cannot hold renders
  `PermissionDeniedState` **instead of** its content, never over it.

The client check is usability only. Every screen still issues the request, and
the Backend's denial is the only denial that means anything. Where the two
disagree, the Backend wins and the screen shows the denial.

## 7. Decision-neutrality, and where it bites

Five screens have **no dedicated Backend operation**. Their tables exist in the
database and are unexposed; see `findings.md` (`P1-26-F-003` … `P1-26-F-007`).

They are implemented on the approved, deliberately decision-neutral organization
settings contracts —
`GET|POST /api/v1/org/companies/{companyId}/settings`,
`GET|POST /api/v1/org/branches/{branchId}/settings`,
`GET|PATCH /api/v1/org/tenant` — which store a caller-supplied key and value,
validate it against its declared type, version it append-only, and **supply no
defaults of their own**. The service says so in its own header comment, and this
phase does not change that.

So: no country is assumed, no tax rate is invented, no base currency is chosen,
no numbering format is presumed. The operator supplies the value; the screen
supplies structure, validation, conflict handling and an audit-aware save. Each
screen states plainly, in the interface, that the platform reference catalogue
behind it has no approved read operation in this phase.

The setting **key namespace** these editors write under is an engineering
decision recorded in `open-decisions.md` for Owner ratification — it is where a
value is stored, not what the value should be.

## 8. What this phase must not do

- No file under `apps/api/`, `supabase/`, or any migration.
- No direct PostgreSQL or Supabase access; the web tier holds no credential.
- No import of API source. The published HTTP contract is the interface.
- No invented endpoint. If an operation is absent, that is a finding, not a gap
  to paper over.
- No hard-coded tenant, company or branch. Benzene is a configurable pilot
  tenant and appears nowhere as an identity or a default.
- No floating-point money. Amounts are canonical decimal strings end to end.
- No secret, token or free text in a URL. No sensitive value in browser storage.
