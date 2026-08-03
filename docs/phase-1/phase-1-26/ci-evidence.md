# Phase 1-26 — CI and DevOps evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-26-DO-001` and `P1-26-DO-002`.

---

## 1. `P1-26-DO-001` — the quality gate

`scripts/ci/check-p1-26-frontend.mjs`, wired into `verify:policies` and therefore
into `verify:workspaces` and hosted CI. Registered as **`required`** in
`scripts/ci/check-command-coverage.mjs`, which fails the build if a command is
not classified.

### What it fails on

| Rule                       | Why it exists                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-storage`          | `localStorage`, `sessionStorage` and IndexedDB are readable by any script in the document. The session is a `httpOnly` cookie precisely so a cross-site scripting defect cannot read it; one `setItem` puts it back within reach and nothing else fails. |
| `float-money`              | `parseFloat` and `toFixed` on an amount each round silently, and the rounded value looks exactly like the right one.                                                                                                                                     |
| `auth-redirect-parameter`  | An open redirect on the page that completes a credential change is the highest-value one in any application.                                                                                                                                             |
| `session-cookie-authority` | One file owns the attributes that make the cookie unreadable. A second `cookies().set` is a second set of attributes to get wrong.                                                                                                                       |
| `unsafe-html`              | —                                                                                                                                                                                                                                                        |
| `use-server-exports`       | Turbopack rejects the whole module and reports it at the **importer** as "the module has no exports at all", which sends a reader to the wrong file.                                                                                                     |

### Two properties the gate is built around

**Comments are stripped before scanning.** The first version of the money rule
flagged `organization/types.ts` — the file that documents _why_ `parseFloat` is
never called. A scanner that reads prose accuses the explanation of a rule of
breaking it, and the obvious "fix" is to delete the explanation.

**A rule that matches nothing fails.** Every rule declares the files it expects
to inspect, and reports a failure when that number is zero. A scan root that has
moved reports clean over an empty set, which reads as evidence and is blindness —
PR #161 exists because a documented check named a directory that did not exist.

### Mutation coverage

`tests/ci/p1-26-frontend-gate.test.ts` — **27 tests**. Each plants exactly one
violation and asserts the gate catches _that_ one; a clean fixture asserts it does
not cry wolf. It also proves:

- an empty file set fails rather than reporting clean;
- a scoped rule whose scope matches nothing fails;
- a tree with no `'use server'` module fails that rule as vacuous;
- `export type` and `export interface` are **permitted**, because they are erased;
- a comment mentioning `parseFloat` is **not** flagged;
- the comment stripper still detects a planted violation — otherwise the fix for
  a false positive would be a blindfold.

No mutation defect is left in the tree: the fixtures are inline strings, not
edits to real files.

### The gates P1-26 runs under

| Gate                                       | Enforces                                                                             | Result                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------ |
| `check-phase-ownership.mjs p1-26-frontend` | apiSource/apiConfig/migrations/supabase = 0, no unclassified file                    | 0 violations             |
| `check-web-topology.mjs`                   | one App Router root, the proxy convention, one brand authority, one colour authority | 0 failures               |
| `check-api-backend-only.mjs`               | `apps/api` holds no page, stylesheet or client component                             | 0 failures, 196 handlers |
| `check-generated-artifacts.mjs`            | no tracked build output, one lockfile                                                | 0 failures               |
| `check-product-name-authority.mjs`         | both tiers name the product identically                                              | 0 failures               |
| `check-api-boundary.mjs` (web)             | no `fetch` outside `src/lib/api`, no API/Supabase/server-only import, no unsafe HTML | 0 violations             |
| `check-brand-isolation.mjs`                | one brand consumer; `RootLco` never rendered as the product                          | 0 violations             |
| `check-design-tokens.mjs`                  | no raw colour outside the token layer                                                | 0 raw values             |
| `check-command-coverage.mjs`               | every command classified and reachable                                               | 0 gaps                   |
| `check-p1-26-frontend.mjs`                 | the rules above                                                                      | 0 failures               |

### What hosted CI reported, including the runs that were red

Exact-head runs on the feature branch. Only the last one matters for the merge;
the others are here because a record that shows only the green run is a record of
nothing.

| Head      | Checks | Result                                                                                                       |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `9c4a37b` | 19     | **red** — `secret-scan`: a JWT-shaped literal in a test fixture (`P1-26-F-042`)                              |
| `c6c20ce` | 20     | **red** — `Web quality`, `hosted-clean-room`, `ci-gate`: one formatting defect, three checks (`P1-26-F-043`) |
| `72e3ca2` | 20     | **green** — 20 success, 0 failure                                                                            |

`ci-gate` is the PR aggregate and `protected-gate` the push aggregate; a single
job failure reddens the aggregate, which is why one defect produced three red
checks at `c6c20ce`.

`CodeQL` reported `neutral` at `c6c20ce` and `success` at `72e3ca2`. A neutral
CodeQL result is not a pass — it means a docs-only path skip left no
configuration to diff — and it is recorded as such rather than counted green.

### What CI could not have caught

`P1-26-F-044` — a five-second test timeout that measured process scheduling
rather than the code — was **green in all 20 checks** at the tree it was present
in. It was found by the local clean room and by nothing else. The reverse of
`F-042` and `F-043`, which were green locally and found only by CI.

Neither tier is a superset of the other. That is the argument for running both,
and it is the reason this phase ran the clean room twice.

## 2. `P1-26-DO-002` — logging, monitoring and alert routing

### What exists

`apps/web/src/lib/observability/client-log.ts` — one place every client-side
diagnostic passes through, with redaction applied **before** it leaves.

- **Redaction by key name**: password, every token variant, secret, API key,
  authorization, cookie, session, email, phone, VIN, plate, amount, total,
  balance, IBAN, card. Keys are normalised first, so `accessToken`,
  `access_token` and `ACCESS-TOKEN` are one key.
- **Redaction by value shape**: a JWT or a long opaque run is dropped whatever it
  is called. That is the shape that actually happens — `{ data: accessToken }`,
  where the key is innocent.
- **The route is reported without its query string**, because the query string is
  where secrets end up.
- **The error boundary reports `error.digest` and the route.** Not the message and
  not the stack: a Next.js error message routinely contains a file path and a
  serialised prop.

Proven by `apps/web/tests/observability.test.ts`.

### What does NOT exist, stated plainly

**No external monitoring service is configured, and none is claimed to be
operational.** What exists is the adapter boundary: `setMonitoringAdapter` is
`null` until a deployment attaches one, and nothing reaches for a global or a
bundler-injected key.

The redaction was built **before** any provider, deliberately. The first thing a
monitoring integration does is capture everything, and the second is discover
what it captured.

**Alert routing is not configured** and is not claimed. What is defined is where
it would attach and what it would be allowed to carry.

## 3. Failure triage, rollback and recovery

| Situation                                               | Action                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A screen shows "service unavailable"                    | check `npm run dev:status`; the web tier holds no database credential, so this is always the API or the network                                                  |
| A screen shows a denial the operator expected to pass   | read the correlation ID from the screen, match it in the API log; the permission decision is recorded there, not here                                            |
| A conflict on save                                      | re-read and re-apply. **Never** re-submit blind: the other writer's change would be overwritten                                                                  |
| A session ends unexpectedly                             | the access token expired. There is no refresh operation (`P1-26-OD-006`); signing in again is the whole remedy                                                   |
| The build fails with "the module has no exports at all" | a `'use server'` module is exporting something that is not an async function. The error names the importer, not the cause                                        |
| Rollback                                                | revert the merge commit on a branch and merge it through the protected workflow. P1-26 created **no migration**, so a Frontend rollback needs no database action |
