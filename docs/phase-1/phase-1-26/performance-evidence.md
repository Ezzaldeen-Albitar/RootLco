# Phase 1-26 — performance and bundle baseline

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-26` performance work is a **baseline**, not an optimisation claim. Every
number below was measured on this machine at the candidate SHA and is reported as
measured.

---

## 1. Production build

| Measurement             | Value              |
| ----------------------- | ------------------ |
| Wall-clock build        | **29 s**           |
| Turbopack compile       | 10.0 s             |
| TypeScript              | 9.6 s              |
| Static page generation  | 41 pages in 519 ms |
| `apps/web/.next/static` | **1.1 MB**         |
| Routes                  | **21**             |

Environment: Windows 11, Node 24, Next 16.2.12, Turbopack, 11 build workers.

## 2. Route rendering strategy

| Routes                | Strategy                                     | Why                                                                                                                                      |
| --------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/` and `/_not-found` | static                                       | no request-dependent content                                                                                                             |
| **every other route** | **dynamic** (`ƒ`, server-rendered on demand) | the CSP carries a per-request nonce, and a prerendered page has none — its bootstrap is blocked and the page arrives blank (P1-25-F-022) |

That trade was made in P1-25 and P1-26 inherits it. Every operational screen is
authenticated and request-dependent anyway; a prerendered page with a disabled CSP
would be fast and unprotected.

## 3. What P1-26 added, and what it cost

**No new runtime dependency.** `react-hook-form`, `@hookform/resolvers` and `zod`
were already present; nothing was installed for this phase. The root lockfile is
unchanged.

**No new client bundle for the eleven administration screens' data path.** Every
read goes through a Server Action, so the API client, the bearer token and the
response mapping stay on the server. The browser receives a view model.

**The 1.1 MB static directory** covers 21 routes, the shared design system, both
message catalogues and the component gallery.

## 4. Things deliberately not done

**Every dashboard route is `force-dynamic`**, so route-level bundle splitting
would not change what a first paint costs — the server render is the cost, and
it is already per-request.

**No `next/image`, now that the brand IS an image.** The Owner-acceptance
remediation replaced the text wordmark with two approved PNGs — an 81 KB product
symbol and a 47 KB company wordmark — and they are still rendered by a plain
`<img>`. `next/image` earns its complexity on user-supplied or remote imagery
with unknown dimensions; these are two static, versioned, same-origin files whose
intrinsic sizes are declared in the brand configuration, so the optimiser has
nothing left to decide. It would also add a runtime dependency to the print path,
which must render without JavaScript.

Both are served with explicit `width` and `height` derived from the configured
intrinsic size, so the header reserves its box before the bytes arrive. That is
the layout-shift protection `next/image` is usually reached for, obtained
directly.

**No virtualised table.** Page size is bounded at 100 by the backend contract's
own maximum, so the largest render is 100 rows. Virtualising 100 rows costs more
in complexity than it saves in paint.

**No memoisation added speculatively.** The expensive work in this phase is a
network round trip, not a re-render.

## 5. Checked for, and absent

| Risk                                        | Result                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A duplicate library                         | none — no dependency added                                                                                                                       |
| A heavy accidental import                   | none — the feature tree imports only from `@/components`, `@/lib` and its own folder                                                             |
| An unnecessary client component             | the eleven screens' pages are Server Components; only the interactive body is `'use client'`                                                     |
| Excessive providers                         | none added; there is no context provider in this phase                                                                                           |
| Server-only package leakage into the client | `check-api-boundary.mjs` forbids `pg`, `node:fs`, `node:child_process`, `node:net`; the build would fail on `next/headers` in a client component |
| Hydration mismatch                          | the browser suite asserts a **clean console** on every navigation; a hydration mismatch appears as a console error and nothing else              |
| Layout shift from loading states            | `SkeletonRows` are the same height as real rows, which is the whole point of them                                                                |

## 6. What is not measured

**No Lighthouse or Core Web Vitals run.** Those measure a deployed origin under a
network profile, and this phase has no deployment — claiming a score from a
local production server on a developer machine would be a number with no
referent.

**No render timing for the administration screens.** They need an authenticated
session, which needs a real account, which the no-fake-data policy forbids
seeding. Their first-paint cost is dominated by the API round trip in any case.

Both are recorded rather than estimated. An invented performance figure is worse
than none: it gets quoted.
