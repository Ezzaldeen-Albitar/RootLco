# Phase 1-26 — findings

**Classification:** Confidential — Commercial Product and Pilot Planning

Severity: **Critical** blocks the gate · **High** blocks the gate ·
**Medium** blocks unless explicitly accepted · **Low** recorded and carried.

Status: **Open** · **Fixed** · **Accepted** · **Routed** (to another phase's
change control).

---

## P1-26-F-001 — the shared table could not express the Backend's pagination

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/components/data-table`

P1-25's data table is offset-based: `page`, `pageSize`, and a **required
numeric `total`** that drives the page count, the "showing X–Y of Z" line and
the First/Last buttons. Every P1-26 list operation is cursor-based and returns
`{items, nextCursor, hasMore}` with **no count at all**
(`apps/api/src/server/db/pagination.ts`).

**Why it matters.** The only ways to satisfy the old type were to fabricate a
total or to fork the table. A fabricated total — the current page's length, or a
guess — produces a pager that looks right on page one and lies from page two
onward, and the lie is invisible in review because the type is satisfied.

**Fix.** `TableResponse.total` is now `number | null`; `hasMore` carries the
server's own end-of-set signal. With `total === null` the pager shows the
current page and Previous/Next only, and hides First/Last because the last page
of a cursor set is not knowable without walking it. `useCursorPages` retains the
cursor for each visited page so Previous is exact.

**Regression coverage.** `apps/web/tests/data-table.dom.test.tsx` asserts that a
null total renders no count and neither First nor Last, that Next follows the
server's `hasMore`, that the counted mode is unchanged, and that a loading table
prints no total at all. `apps/web/tests/administration.test.ts` covers
`pageCount(null, …)` and cursor invalidation.

> That citation was wrong when it was first written: it named a file that did not
> exist and assertions no test made (`P1-26-F-027`). The file exists now.

---

## P1-26-F-002 — the root package description still said the product name was pending

**Severity:** Low · **Status:** Fixed · **Area:** `package.json`

`package.json` `description` carried `[PRODUCT NAME — Pending Final Approval]`
after OIR-01 closed. It is a **live** artefact — it is published in
`npm ls`, in tooling output and in any generated manifest — not historical
evidence tied to an earlier SHA, so the "204 documents keep the placeholder
deliberately" carve-out does not cover it.

**Fix.** Replaced with the approved working name, phrased so the name's
temporary status stays visible.

---

## P1-26-F-003 — numbering rules have no approved HTTP operation

**Severity:** Medium · **Status:** Accepted (decision-neutral implementation) ·
**Area:** contract

`sal.invoice_numbering_configs` exists in the schema. No route handler exposes
it; `apps/api/src/app/api/v1` has no numbering path.

**Disposition.** The screen is built on the approved organization-settings
contracts, which are explicitly decision-neutral and supply no defaults of their
own. The interface states that the invoice-numbering configuration table has no
approved read operation in this phase and that what is edited here is
organization settings. **No endpoint was invented and no numbering format is
presumed.** Exposing `sal.invoice_numbering_configs` is Backend work owned by
the billing phase, not by P1-26.

---

## P1-26-F-004 — taxes have no approved HTTP operation

**Severity:** Medium · **Status:** Accepted (decision-neutral implementation) ·
**Area:** contract

`org.tax_classes` and `org.tax_rates` exist. No route handler exposes either.

**Disposition.** As `F-003`. No jurisdiction is assumed, no rate is invented,
Jordan is not hard-coded, and rates are handled as decimal strings. The screen
says plainly that the platform tax catalogue is not published by an approved
operation.

---

## P1-26-F-005 — currencies have no approved HTTP operation

**Severity:** Medium · **Status:** Accepted (decision-neutral implementation) ·
**Area:** contract

`shared.currencies` holds the ISO 4217 reference list. No route handler reads
it.

**Disposition.** As `F-003`. No base currency is chosen and no exchange-rate
provider is implied. Currency codes are validated for **shape** (`^[A-Z]{3}$`,
the same expression the approval-limit contract uses) and never against a list
the Frontend does not have.

---

## P1-26-F-006 — languages have no approved catalogue operation

**Severity:** Medium · **Status:** Accepted (partial contract) · **Area:** contract

`shared.languages` holds the approved locales and their direction. No route
handler reads it. The only approved language surface is the tenant's
`defaultLocale`, writable through `PATCH /api/v1/org/tenant` and foreign-key
constrained server-side.

**Disposition.** The Languages screen shows the application's own enabled
locales — Arabic and English, from the single i18n authority, which is Frontend-
owned and approved — and lets an authorised operator set the tenant default
through the approved contract. An unregistered value is refused by the Backend
with `ERR-VAL-001` and that verdict is surfaced verbatim in meaning. The screen
does not claim to manage the platform language registry.

---

## P1-26-F-007 — platform system settings have no approved HTTP operation

**Severity:** Medium · **Status:** Accepted (partial contract) · **Area:** contract

`shared.system_settings` carries a `scope` column for platform-scope
configuration. No route handler exposes it.

**Disposition.** The System settings screen edits the three settings surfaces
that **are** published — tenant, company and branch — and states that the
platform-scope table is not reachable from the API in this phase.

---

## P1-26-F-008 — no company or branch directory operation

**Severity:** Medium · **Status:** Accepted (documented constraint) · **Area:** contract

`org.legal_companies` and `org.branches` have no list operation and no
name-read operation. `GET /api/v1/auth/session` returns `companyIds` and
`branchIds` as **bare UUIDs**, and returns them **empty** for an unrestricted
actor.

**Consequence.** The Organization screen cannot show company or branch _names_,
and for an unrestricted actor it has no identifiers to offer at all. It
therefore pre-fills the identifiers from the caller's resolved scope when there
are any, and otherwise accepts an explicit identifier which the server
validates.

**Why that is not client-authoritative scope.** `requireCompanyInScope` runs
`assertScopeWithinAuthority` **before** `companyExists`, so an identifier outside
the caller's authority is refused identically whether or not it names a real
company. Typing an identifier buys no information and no access; the server
decides, as it does for every other request.

---

## P1-26-F-009 — no self-service profile update operation

**Severity:** Medium · **Status:** Accepted (documented constraint) · **Area:** contract

`PATCH /api/v1/iam/users/{userId}` is the only way to change a display name or
MFA requirement, and it requires `iam.user.manage` — an administrative
permission. A user without it cannot edit their own profile.

**Disposition.** The Profile screen is **read-only** for an actor without
`iam.user.manage`, and says so rather than presenting a form that will be
refused. An actor holding the permission edits through the approved contract,
with `If-Match`. The screen never pretends a self-service capability the
platform does not have.

---

## P1-26-F-042 — the file forbidding written-down credentials wrote one down

**Severity:** Medium · **Status:** Fixed · **Area:** `apps/web/tests/observability.test.ts`

The tracked-secret scanner failed the exact-head CI on a JWT-shaped **literal**
used as a fixture in the test that asserts a credential must never reach a log.

The scanner was right. A credential-shaped constant in a tracked file is one
whether or not it is real, and a scanner taught to ignore some of them stops
being worth running. Its own guidance says to construct synthetic values at
runtime, which the fixture now does.

**Why it reached CI.** `verify:policies` does **not** include `security:all` —
the secret scan lives in `verify:repository`. Every local run during this phase
was policies plus the test tiers, so the scan never executed until hosted CI ran
it. Both were run before the fix was pushed, and `security:all` is now part of
this phase's local routine.

There is a joke here worth not losing, and a general point under it: a rule is
easiest to break in the file that states it.

---

## P1-26-F-043 — the root formatter cannot see the Frontend, and is named as though it can

**Severity:** Low · **Status:** Fixed · **Area:** `apps/web` formatting, local
verification routine

Sixteen files under `apps/web` were unformatted. They failed hosted CI in two
places at once — `Web quality / web-quality` and `hosted-clean-room` — which
together failed `ci-gate`. Three red checks, one defect.

`npm run format:check` at the repository root is `prettier --check .`, and it
had been run locally, and it was green. It was green because
[`.prettierignore`](../../../.prettierignore) excludes `apps/` outright: each
workspace ships its own prettier configuration, and two formatters disagreeing
over one file is a permanent conflict rather than a style preference. So the
root command is structurally incapable of reporting on the Frontend, while
carrying a name — and an argument, `.` — that reads as the whole repository.

The workspace command has the **identical** name and the identical body,
`prettier --check .`. Only the working directory differs, and the working
directory is the entire difference in what gets checked.

**Why it reached CI.** Nothing here was a repository defect except the sixteen
files. `check-command-coverage.mjs` already classified `@rootlco/web
::format:check` as _required_, already proved it reachable, and hosted CI duly
ran it and caught the problem — the arrangement worked exactly as designed. What
failed was the local proof: it used the root command and treated a green result
as coverage it never had.

`tests/ci/command-coverage.test.ts` now pins the arrangement — that `apps/` is
excluded at the root, that the exclusion hides real source rather than an empty
directory, that both commands share a name, and that `verify:web` and
`verify:workspaces` are what actually reach the workspace formatter. Any future
edit that quietly makes the root command look sufficient fails there.

This is the second time in this phase that a command's _name_ was mistaken for
its _scope_ — `F-042` was `verify:policies` not containing the secret scan. The
lesson is the same one twice: reachability is a property of the graph, not of
what a script is called.

---

## How findings `F-015` … `F-041` were found

An adversarial review of the complete P1-26 diff, run as six independent lenses —
security, backend-contract fidelity, React/Next correctness, honesty,
internationalisation and accessibility, and phase boundary — each followed by a
verification pass whose instruction was to **refute** the claim, defaulting to
refuted when uncertain. Thirty-three findings were raised; the ones below
survived refutation and were then re-verified by hand against the source.

It is worth saying what it caught that the rest of this phase's assurance did
not. `verify:workspaces` was green. Typecheck, ESLint, 287 web tests, 1465 root
tests, the production build and 106 browser assertions were all green. And
**every user-administration command, every role and permission change, every
approval limit and every settings write would have failed with HTTP 400 the first
time a real operator touched them** — because none of them sent a header the
backend requires and no local check could see the omission.

---

## P1-26-F-015 — every idempotent operation was called without its mandatory header

**Severity:** Critical · **Status:** Fixed · **Area:** `apps/web/src/lib/api/client.ts`

`apps/api/src/server/http/route-handler.ts` runs
`operation.idempotent ? requireIdempotencyKey(request.headers) : null`
unconditionally, **before permissions are evaluated**, and
`requireIdempotencyKey` throws `ERR-INT-002` — HTTP 400 — when the header is
absent.

Ten operations in P1-26's surface declare `idempotent: true`: invitation create
and activate, user status change, role create, role-permission add, grant issue,
grant scope add, approval-limit create, and both settings writes.

**Not one call site sent a key.** Inviting a user, activating an invitation,
locking an account, creating a role, mapping a permission, adding an approval
limit and saving any setting on any of the six settings-backed screens would have
failed **100% of the time** — and the 400 maps through `kindFor` to `validation`,
so the operator would have seen a generic "check the form" banner naming no
field, on a form with nothing wrong with it.

**Why nothing local caught it.** Every check in this phase is static or runs
against the web tier alone. The header is required by the _other_ side of a
boundary that no test in this repository crosses, because crossing it needs a
real account in a real tenant and the no-fake-data policy forbids seeding one.
This is precisely the gap `browser-evidence.md` §3 records — and it was not
hypothetical.

**Fix.** `ApiClient.send` attaches a generated key to every `POST` when the
caller does not supply one. That is semantically correct **only because** of the
rule directly above it in the same file: this client never retries a mutation, so
one `send` is one logical attempt and a fresh key says exactly that. A caller
wanting to re-present the same attempt passes its own key, which always wins.
`PATCH` and `DELETE` are not marked idempotent anywhere in the contract and get
no key.

**Regression coverage.** `apps/web/tests/api-client.test.ts` asserts the header
is present on POST, absent on GET, and that an explicit key is not overwritten.

---

## P1-26-F-016 — approval limits read a currency field the API does not publish

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/features/administration/access/api.ts`

The create body takes `currency` (`approval-limits/route.ts`). The read returns
**`currencyCode`** (`authorization-repository.ts`). The row type declared
`currency`, so `formatMoney` received `undefined` and every amount rendered as
`"1234.5000 undefined"` — no error, no warning, just a wrong cell.

An asymmetric contract is the easiest kind to get wrong and the hardest to
notice, because the write path works.

---

## P1-26-F-017 — the audit detail drawer invented all four field names

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/features/administration/audit/types.ts`

Declared `field`, `value`, `previousValue`, `classification`. The API publishes
`fieldName`, `oldValueMasked`, `newValueMasked`, `valueClassification`.

Every detail row rendered blank-named and empty — **including for a caller
holding `iam.sensitive.view`**, which is the reading the screen exists to serve.
The type also invented an optional `createdAt` and a `result` the record does not
have, and made `occurredAt` and `entityType` optional when both are required.

A response shape is a contract. Guessing at it produces a screen that renders
without erroring and shows nothing, which is the worst available failure.

---

## P1-26-F-018 — a server-truncated window was labelled "the complete list"

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/features/administration/access/api.ts`

`access.listApprovalLimits` calls the repository with a hard **`200`** and the
response carries no cursor, no `hasMore` and no count — nothing that says it
stopped. The screen reported `items.length` as a total and printed _"This is the
complete list for the current filters, not a page of it."_

At 200 limits that sentence is false, and it is false in the direction that
matters: an administrator checking whether a ceiling exists would be told they
had seen everything.

**Fix.** At the cap, `total` becomes `null` — the table's "no count published"
mode — and the screen says the list may be incomplete and how to narrow it. This
is the same defect as `P1-26-F-001` arrived at from the other direction, in the
same phase, by the same author.

---

## P1-26-F-019 — changing the audit date range re-rendered the same rows

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/features/administration/shared/use-server-table.ts`

The effect key was `ordering#page#generation`. The audit screen's date range
lives outside `TableRequest`, so changing it produced a new `load` closure and
**no key change** — the effect did not re-run. The operator changed the dates and
watched the same rows sit there.

Adding `load` to the dependency array is not the fix: an inline loader is a new
function every render, which re-reads on every render.

**Fix.** `useServerTable` takes an explicit `loadKey` for anything outside the
request that changes what `load` returns. The audit screen passes its range.

---

## P1-26-F-020 — a dialog kept its success state after being closed

**Severity:** High · **Status:** Fixed · **Area:** three screens

`<InviteDialog open={inviteOpen}>` was always mounted; `Dialog` returns `null`
when closed but the form inside kept its `useActionState`. After one successful
invitation, reopening showed the previous success message and a Close button
where the submit should be — **no second user could be invited without reloading
the page.** The same shape existed on Create role and Add approval limit.

**Fix.** Mounted only while open. Unmounting is what resets the state.

---

## P1-26-F-021 — a token delivered in the query string was never erased

**Severity:** High · **Status:** Fixed · **Area:** `RecoveryTokenBridge.tsx`

Only the fragment path called `history.replaceState`. A provider that delivers
`?token=…` left the credential in the address bar for the life of the tab —
copied with the URL, restored when the tab reopened, and visible to anything that
reads it.

That is the exposure the fragment handling exists to prevent, on the delivery
shape the server _can_ see.

---

## P1-26-F-022 — a 403 on the session read deleted a valid cookie and locked the account out

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/features/authentication/api/session.ts`

`GET /api/v1/auth/session` requires `iam.user.read`. `readSession` treated
`unauthenticated` **and** `forbidden` identically: clear the cookie, redirect,
report "your session ended".

For an account that authenticates successfully and does not hold that permission
this is an unbreakable loop — sign in, receive a valid cookie, load the
dashboard, 403, cookie cleared, back to sign-in, for ever — while being told the
session expired. The credentials are correct and the operator can never get in.

**Fix.** Only a 401 clears the cookie. A 403 keeps it (destroying a valid
credential because a permission is missing is the wrong remedy) and the sign-in
page says the account is not permitted to open the application and needs an
administrator — which is the actual problem.

---

## P1-26-F-023 — the session cookie's `Secure` attribute failed open

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/lib/env.ts`

`secure: appEnv !== 'local'` is correct. `NEXT_PUBLIC_APP_ENV` **defaulted to
`'local'`**, so a deployment that did not set it served the session cookie over
plain HTTP, silently.

A security attribute whose safe state depends on a variable being present is not
a control.

**Fix.** The schema defaults to `production`. The local runtime sets `local`
explicitly, which is the right way round: the unsafe mode is the one you have to
ask for.

---

## P1-26-F-024 — the table printed a fabricated total while loading

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/components/data-table/DataTable.tsx`

`const total = response ? response.total : 0` put the table in **counted** mode
before its first page arrived, so every cursor-paginated screen flashed
"Showing 0–0 of 0" and "1 / 1".

The line above it had just been rewritten to explain why `?? 0` was wrong. The
replacement did the same thing for a different input.

**Fix.** `response ? response.total : null`. No response and no published count
are both "do not print a total".

**Regression coverage.** `apps/web/tests/data-table.dom.test.tsx` — the file
`P1-26-F-001` previously cited and which did not exist (`P1-26-F-027`).

---

## P1-26-F-027 — `P1-26-F-001` cited a test file that did not exist

**Severity:** Medium · **Status:** Fixed · **Area:** `docs/phase-1/phase-1-26/findings.md`

The regression-coverage line named `apps/web/tests/data-table.dom.test.tsx` and
assertions in `table-state.test.ts` that no test made. A finding record whose
"proven by" line points at nothing is worse than one with no such line: it stops
the next reader looking.

**Fix.** The file now exists and makes those assertions.

---

## P1-26-F-028 — the money gate claimed a construct it did not match

**Severity:** Medium · **Status:** Fixed · **Area:** `scripts/ci/check-p1-26-frontend.mjs`

The header said the rule catches `parseFloat`, `toFixed` **and `Number()`**. The
pattern matched the first two. A documented rule a gate does not enforce is a
worse defect than a narrow rule, because it is quoted as coverage.

**Fix.** The header now says what the pattern does, and says why `Number()` is
excluded: it is the ordinary way to read a page size or a record version and a
regex cannot tell those from an amount. A test asserts the exclusion is
deliberate.

---

## P1-26-F-029 — the Taxes entry repeated the exact defect `F-011` recorded

**Severity:** Medium · **Status:** Fixed · **Area:** `apps/web/src/config/navigation.ts`

Gated on `org.tax.manage`. The screen's only operations are the company-settings
read and write, which require `org.company.read` and `org.settings.manage`. An
actor holding exactly what the screen needs would not see the entry.

`org.tax.manage` **is** in the catalogue, so the catalogue-membership test passed
— which is the limit of what that test can prove, and worth knowing.

---

## P1-26-F-030 · F-031 · F-032 · F-033 · F-034 · F-036 · F-037 · F-039 · F-040 · F-041

Fixed together; each is small and each was a claim that outran the code.

| ID      | What was wrong                                                                                                                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F-030` | `PERMISSIONS` claimed every code was required by an operation this phase **calls**; `grantManage` and `sensitiveView` are referenced by nothing. The comment now says what the test proves — catalogue membership — and no more.                                        |
| `F-031` | The Users screen declared a `status` filter and rendered **no control that could apply one**. `filterDefinitions` only teaches the table to label and remove a chip. The server-side status path was unreachable. A select now applies it.                              |
| `F-032` | `AccountMenu`'s comment listed "closes when focus leaves" among its properties while registering only `keydown` and `mousedown`. A keyboard user tabbing past the last item left the menu open behind them. The handler now exists.                                     |
| `F-033` | Zod `.max()` bounds carried no message key, so Zod's own English sentence reached an Arabic screen — and bypassed the catalogue-completeness test entirely, because it is not a key.                                                                                    |
| `F-034` | Profile rendered two-factor status with `field.active` / `permissions.effect.unset` — "Active" and "Not mapped" under "Two-factor authentication required". Its own keys now.                                                                                           |
| `F-036` | `security-evidence.md` listed "Branch status" among shipped screen actions. The adapter exists; **no screen calls it.** An audit claim for an unreachable path.                                                                                                         |
| `F-037` | `NETWORK_OWNER` was exported from the gate, documented as an enforced boundary and asserted by a test, while **no rule used it**. The boundary is enforced — by `check-api-boundary.mjs`. A second declaration that enforces nothing reads as a control and is scenery. |
| `F-039` | `RecoveryTokenBridge` called `history.replaceState` inside `useSyncExternalStore`'s snapshot. A snapshot must be pure: React may call it during render, repeatedly, and may discard the render. Reading is now pure; erasing is an effect.                              |
| `F-040` | An over-length display name reported "This field is required" under a field the operator had filled in.                                                                                                                                                                 |
| `F-041` | `SubmitButton`'s comment claimed `aria-disabled` prevented the tab-order loss `disabled` causes. It does not. The comment now says what the attributes actually buy.                                                                                                    |

---

## P1-26-F-013 — a render prop crossed the Server-to-Client boundary and 500'd the reset page

**Severity:** High · **Status:** Fixed · **Area:** `apps/web/src/features/authentication/components/RecoveryTokenBridge.tsx`

`RecoveryTokenBridge` took `children: (token: string) => ReactNode` and was
rendered from `/reset-password/page.tsx` and `/activate-account/page.tsx`, which
are Server Components. **A function prop is not serialisable across that
boundary.** Both pages returned a server error in the production build.

**Why nothing caught it earlier.** Typecheck passes — the types are correct in
TypeScript's model. ESLint passes. The unit suite passes, because it never
renders the page. `next dev` masks the class of failure that only appears in a
production build. The **browser suite** caught it: five projects failed the same
assertion with "This page couldn't load" in the accessibility snapshot.

**Fix.** The bridge now takes only serialisable props — a locale, a message
catalogue, a token or null, and message keys — and renders `SetPasswordForm` or
`MissingToken` itself. The page decides nothing about presentation and passes no
behaviour.

**Regression coverage.** `apps/web/tests/e2e/foundation.spec.ts`

> "the reset link page refuses a request with no token" asserts the page renders
> its no-token state, across all five browser projects. That is the assertion that
> failed; it now guards the fix.

---

## P1-26-F-014 — a `'use server'` module may export only async functions

**Severity:** High · **Status:** Fixed · **Area:** three feature modules

`audit/api.ts` exported a constant, `organization/api.ts` exported a sync path
helper, and `organization/actions.ts` exported a sync `coerce`. Turbopack rejects
the **whole module** for any one of them.

**Why the error is worse than it sounds.** The build reports it at the _importer_
as "Export `listAuditEvents` doesn't exist in target module — the module has no
exports at all", which sends a reader to the wrong file entirely. Eight reported
errors traced to three causes.

**Fix.** Types, constants and pure helpers moved to a `types.ts` beside each
`'use server'` module, which now holds nothing but operations.

**Regression coverage.** `scripts/ci/check-p1-26-frontend.mjs` fails on
`export const`, `export let`, `export var`, `export class` or a non-async
`export function` in any module carrying the directive, and
`tests/ci/p1-26-frontend-gate.test.ts` proves each case — including that
`export type` and `export interface` are permitted, because they are erased.

---

## P1-26-F-011 — the Settings navigation entry was gated on a permission that does not exist

**Severity:** Medium · **Status:** Fixed · **Area:** `apps/web/src/config/navigation.ts`

The P1-25 navigation model gated the Settings module on `org.settings.read`. That
code appears in **no** operation definition and in **no** row of
`supabase/seeds/04_iam_permission_catalog.sql`. Under the client's own
"unknown means denied" rule — which is correct and which this phase keeps — the
entry could never be visible to any actor who has ever existed.

**Why it was invisible.** A permission filter that hides too much looks exactly
like a permission filter working. Nothing errors, nothing logs, and the entry is
simply absent — which is also what a correctly-denied entry looks like.

**Fix.** Every P1-26 navigation entry is gated on the code its screen's operation
actually requires: `iam.user.read`, `iam.role.read`, `iam.approval.manage`,
`iam.audit.view`, `org.tenant.read`, `org.settings.manage`, `org.tax.manage`.

**Regression coverage.** `apps/web/tests/navigation.test.ts` asserts every
administration entry's permission against the catalogue set, so a code that is
not in it fails the build rather than hiding a menu.

---

## P1-26-F-012 — a DB/RLS outbox test failed once, under back-to-back tier load

**Severity:** Low · **Status:** Open — monitored, not reproduced ·
**Area:** `tests/db/shared-event-outbox.test.ts`

Measuring the P1-26 baselines, the DB tier reported **1635 / 1636**:
"a single claim never returns more than its limit (deterministic over-selection
guard)" saw `shared.claim_outbox_events('worker-limit', 4)` return **6** rows over
8 pending. That run executed the DB tier immediately after the 469-second backend
tier in the same shell.

**What was measured afterwards.** The file passes **3 / 3** in isolation. The full
DB tier passes **1636 / 1636** run on its own.

**What is not established.** The mechanism. `shared.claim_outbox_events` applies
`LIMIT p_limit` inside a `FOR UPDATE SKIP LOCKED` subquery and joins it 1:1 by
primary key, so a single statement cannot return more rows than its limit — the
observation is not explained by reading the function, and "it was probably
contamination" is a guess, not a diagnosis. It is recorded as unexplained rather
than closed as flaky.

**Disposition.** P1-26 changed no file the DB tier reads, and the function,
migration and test all belong to P1-5's shared-services surface. It is carried as
an integration observation for the owning phase, re-measured at the P1-26
candidate SHA, and reported with its actual result rather than the convenient
one. Hosted CI runs the tiers as separate jobs, which is the configuration under
which the suite passes.

---

## P1-26-F-010 — `GET /iam/approval-limits` is unpaginated

**Severity:** Low · **Status:** Accepted · **Area:** contract

The approval-limit list takes `companyId` and `userId` filters but no cursor and
no limit, and returns `{items:[...]}` whole.

**Disposition.** The screen renders it through the shared table in a mode with
`total = items.length` and no server paging, and labels the result as a complete
list rather than a page. Client-side paging of a complete set is honest; what
the table must never do is page a _window_ and call it a set.
