# Phase 1-26 — developer guide

**Classification:** Confidential — Commercial Product and Pilot Planning

For the next person adding a screen. It says where things go, which rules are
enforced mechanically, and which mistakes this phase already made so you do not
have to.

---

## 1. Where a new screen goes

```
apps/web/src/
├── app/[locale]/(dashboard)/<area>/page.tsx     Server Component. Session + permission + header.
└── features/<area>/
    ├── types.ts        types, constants, pure helpers        ← NOT 'use server'
    ├── api.ts          'use server' — reads, async only
    ├── actions.ts      'use server' — mutations, async only
    └── components/     'use client' — the interactive body
```

**The `types.ts` split is not stylistic.** A `'use server'` module may export
**only async functions**. Export a constant, a type re-export or a sync helper
and Turbopack rejects the _whole module_, then reports it at the **importer** as
"the module has no exports at all" — which sends you to the wrong file. Eight
build errors in this phase traced to three such exports (`P1-26-F-014`).

## 2. The page is a Server Component and does four things

```tsx
const { locale } = await params;
if (!isLocale(locale)) notFound();

const session = await requireSession(locale);       // 1. session, before any markup
if (!holds(session.permissions, PERMISSIONS.x)) {   // 2. permission
  return <PermissionDeniedState … />;               //    INSTEAD of the content
}
const data = await readSomething();                 // 3. server-side read, if any
return <Screen … />;                                // 4. serialisable props only
```

**Only serialisable props cross into a client component.** A function prop is
not serialisable, and the failure is a **500 in the production build only** —
typecheck passes, ESLint passes, the unit suite passes because it never renders
the page, and `next dev` masks it. That is `P1-26-F-013`; it took the browser
suite to find it.

**Render the denial instead of the content, never over it.** A screen that mounts
and then discovers it is denied has already issued its first read.

## 3. Talking to the Backend

Every network call goes through `src/lib/api/`. `check-api-boundary.mjs` fails
the build on a `fetch` anywhere else.

```ts
const client = await authorizedClient();   // reads the httpOnly cookie
if (!client) return { status: 'expired', … };
const result = await client.get<T>('/api/v1/…');
```

- `authorizedClient()` — carries the caller's bearer token. Server only.
- `anonymousClient()` — the four public authentication operations.
- `clientWithToken(t)` — sign-out, and nothing else.

**Reads retry once. Mutations never retry.** A retried POST that succeeded the
first time creates a second record.

**`If-Match` is mandatory where the operation declares `versionGuarded: true`**,
and the version comes from the record the form was rendered from. Never default
it, and never re-read to obtain one: that turns a lost-update guard into a lost
update, and it looks like a success.

## 4. Before you write a screen, do the archaeology

1. Find the route file: `apps/api/src/app/api/v1/<path>/route.ts`.
2. Read its `defineOperation` — permissions, scope, `auditClass`, `idempotent`,
   `versionGuarded`, rate policy.
3. Read the zod schema. Field names must match **exactly**; an invented name
   fails at runtime only, and only for the user who triggers it.
4. Read the service method to learn the response shape.

**If there is no operation, that is a finding, not a gap to paper over.** Record
it in `findings.md`, implement decision-neutrally on a contract that _does_
exist, and say so on the page.

## 5. The rules a gate enforces

`npm run validate:p1-26-frontend`

| Rule                       | What fails                                                                      |
| -------------------------- | ------------------------------------------------------------------------------- |
| `browser-storage`          | `localStorage` / `sessionStorage` / `indexedDB` outside `use-persisted-flag.ts` |
| `float-money`              | `parseFloat` / `toFixed` outside `money.ts`                                     |
| `auth-redirect-parameter`  | `returnTo` / `redirectTo` / `redirect_uri` inside `features/authentication/`    |
| `session-cookie-authority` | the cookie name outside `session-cookie.ts`                                     |
| `unsafe-html`              | `dangerouslySetInnerHTML` anywhere                                              |
| `use-server-exports`       | a non-async export from a `'use server'` module                                 |

Plus `check-api-boundary`, `check-brand-isolation`, `check-design-tokens`,
`check-web-topology`, `check-phase-ownership`.

## 6. Things that will trip you

**`react-hooks/set-state-in-effect`.** Setting state synchronously at the top of
an effect is flagged, and the rule is right — it cascades. Two shapes work:

- Reading an external source that does not exist on the server →
  `useSyncExternalStore` (see `usePersistedFlag`, `RecoveryTokenBridge`).
- Fetching → `await` first, then set. The write is no longer synchronous.

**`react-hooks/refs`.** A ref read during render is flagged. For "reset state when
a prop changes", use **state** and adjust during render — React's documented
pattern — not a ref (`useCursorPages`).

**Deriving loading beats storing it.** `useServerTable` records _which_ request
produced the page it holds; "loading" is `held.key !== wanted`. One state, no
cascade, and a stale page cannot be shown as current.

**Race handling is not optional.** A `cancelled` flag per effect run, checked
before every state write. Without it a slow page-1 response landing after a fast
page-2 response shows rows from a request the operator has already left.

## 7. Adding a message

Both `en.json` and `ar.json`, same keys. `i18n.test.ts` fails on a key present in
one and missing from the other, on an empty value, and on an Arabic entry
containing no Arabic script — the copy-paste that reads as translated to anyone
who does not read Arabic.

Keys are dotted and namespaced: `^[a-z][a-zA-Z]*\.`.

**No user-facing text in a component.** Ever. `translate(messages, key)`.

## 8. Adding a permission

Add it to `features/administration/shared/permissions.ts`, and make sure it
exists in `supabase/seeds/04_iam_permission_catalog.sql`.
`administration.test.ts` asserts every code against that file, because
`P1-26-F-011` shipped a gate on a code that was in neither the catalogue nor any
operation — and under "unknown means denied" it hid the entry from every actor
who has ever existed. **A filter that hides too much looks exactly like a filter
working.**

## 9. Running it

```bash
npm run dev:all          # API + web, with the repository's own PID tracking
npm run dev:status       # what is actually running
npm run dev:stop         # stops only launcher-owned processes
```

The API on port 3000 needs an `app_runtime` login, not `postgres`.

```bash
npm run typecheck:web && npm run lint:web && npm run test:web
npm run build:web                        # the production build is where SSR bugs appear
npm run test:web-e2e                     # pinned chromium
ROOTLCO_E2E_CHANNEL=chrome npm run test:web-e2e    # the installed browser
npm run verify:workspaces                # everything
```

**The browser suite needs a production build present.** It serves `.next`; if a
previous step deleted it, the web server fails to start and the failure looks
like a test problem.

**Do not write files while `verify:workspaces` runs** — `format:check` races the
write and reports a file it read half of.

## 10. A note on tests

A test that cannot fail is not evidence. Three habits from this phase:

- Assert the thing **and** assert a known-bad case fails, so the assertion is
  proven capable of failing.
- Any scan asserts it inspected a non-zero number of files. A scan root that has
  moved reports clean over nothing.
- Strip comments before scanning source — and then prove the stripper still finds
  a planted violation. The first money rule flagged the file that documents why
  `parseFloat` is never called, and the obvious fix would have been a blindfold.
