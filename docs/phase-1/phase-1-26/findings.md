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

## P1-26-F-044 — a test bound that measured the machine, not the code

**Severity:** Low · **Status:** Fixed · **Area:** `tests/foundation/module-boundaries.test.ts`,
`tests/ci/canonical-documents.test.ts`

The clean-room re-run at `72e3ca2` reported **1 failed / 1473 passed**. The
failure was `module-boundary checker against the real source tree > exits zero
with no violations`, and it was not an assertion — it was
`Test timed out in 5000ms`.

Every case in that file spawns a Node subprocess, and this one points it at the
entire real source tree. Run alone in the same clean room, immediately
afterwards, three times in a row, it took **1219 ms, 1598 ms and 1311 ms**. It
exceeded five seconds only inside the full sixty-eight-file parallel run, where
what is being measured is the machine's process scheduling.

A timeout a correct implementation can miss is a test that reports on load
average. The bound is now 30 s in both files — far above the observed worst case,
far below "hung", which is the only thing this bound should ever catch.

**How close it was.** In the clean-room run that verified the fix, the same case
took **4808 ms** — 192 ms under the old five-second bound. It passed there only
by the width of that margin, which is the clearest possible statement that the
bound was measuring the wrong thing: two consecutive runs of identical, correct
code landed on either side of it.

**Why the second file.** `tests/ci/canonical-documents.test.ts` spawns a
subprocess in every case too, declares no bound either, and its slowest case
takes **1079 ms** — against the 1219 ms that actually blew up. Same defect,
fuse unlit. Two other subprocess-spawning suites,
`tests/security-browser-secrets.test.ts` and `tests/ci/repository-paths.test.ts`,
already carried exactly this 30 s bound, so this is a gap in an existing
convention rather than a new one. `tests/ci/codeql-policy.test.ts` was left
alone: 63 cases in 1761 ms is roughly 28 ms each, two orders of magnitude of
headroom.

**What this is not.** It is not a P1-26 defect — the file predates the phase and
the checker it exercises is correct, which is what the three standalone runs
show. It is recorded here because it failed a **required proof of this phase**
and the alternative was to re-run until it went green and call the clean room
clean. A flake that is known and unrecorded is worse than one that is neither.

---

## P1-26-F-045 — the local stack could not authenticate anyone, and no test could have known

**Severity:** High · **Status:** Fixed (local tooling) · **Routed** (durable fix)
· **Area:** local identity provider

Found by trying to sign in. `POST /auth/login` returned **200** with a token, and
the very next request returned **401 `ERR-IAM-002`**.

`apps/api/src/modules/iam/provider/token-verifier.ts` implements **HMAC only** and
refuses asymmetric algorithms explicitly, as a stated design decision: _"the
provider of record issues HS256, and an unexercised RSA path with an unfetched
JWKS would be untested code on the authentication boundary."_

Supabase CLI 2.110 issues **ES256**. When `GOTRUE_JWT_KEYS` is present GoTrue
signs with that elliptic key and ignores `GOTRUE_JWT_SECRET`, so every access
token the local provider minted was unverifiable by the API.

**Nothing in this repository could have caught it.** Every authentication test
runs against `FakeIdentityProvider` by design — _"a suite that needs a live
provider is a suite that cannot run on a clean checkout"_ — so no suite has ever
verified a token this provider actually signed. The local stack had been unable
to authenticate anyone for as long as the CLI has defaulted to asymmetric keys,
and it went unnoticed because nobody had signed in.

**Fix, local.** `scripts/dev/owner-acceptance/align-local-jwt.mjs` recreates the
GoTrue container without the asymmetric key so it falls back to the shared
secret, and the bootstrap **fails** if the resulting token is not HS256 — a
bootstrap that succeeds while every screen 403s is the failure being prevented.

**Routed.** The durable fix is `supabase/config.toml` (`signing_keys_path`, or a
pinned CLI). That file belongs to the Database phase, and a Frontend phase's
ownership gate requires `SUPABASE_CHANGED_FILES=0`, so it is assigned to its
owner rather than smuggled in here.

---

## P1-26-F-046 — no page had a title. Any page. Either language.

**Severity:** High · **Status:** Fixed · **Area:** every route

axe reported `document-title` — **serious** — on all fourteen authenticated
routes. WCAG 2.4.2 (Page Titled, Level A).

The application shipped with **no `<title>` element at all**.

It survived the entire phase because nothing had ever scanned a rendered
document. The jsdom tier renders components, not documents; the browser suite
asserted on landmarks and console cleanliness. A missing title is invisible in
both — and unmissable to anyone using a screen reader, or holding two tabs open,
or looking at their browser history.

**Fix.** The locale layout supplies a localised default and a `%s — CRM`
template; nineteen routes each contribute their own name through
`pageMetadata(key)`, using the **same message key their visible header already
uses**, so the tab and the heading cannot disagree. The product name comes from
the brand layer, so routing still never learns the identity.

**Regression coverage.** The authenticated accessibility suite scans all fourteen
routes in both locales and fails on any critical or serious violation.

---

## P1-26-F-047 — malformed definition lists on two screens

**Severity:** Medium · **Status:** Fixed · **Area:** profile, languages

axe reported `definition-list` — **serious**. The `Fact` and `Definition` helpers
placed the hint `<p>` as a **sibling** of the `<dt>`/`<dd>` pair inside the
`<dl>`'s wrapper `<div>`. A `<dl>` may contain only `<dt>`/`<dd>` groups and
`<div>` wrappers, and a wrapper may hold only the group.

**Fix.** The hint moved inside the `<dd>` — which is also where it belongs: it
describes the value, so it should be read with the value rather than after it.

---

## P1-26-F-048 — no client component ever ran locally

**Severity:** Critical (local runtime) · **Status:** Fixed · **Area:**
`scripts/dev/`

The most consequential finding of this remediation, and it was found by signing
in and looking at a table.

**Every server-driven list on every screen sat at `aria-busy="true"` with no rows,
for ever.** The application rendered its navigation, headings, breadcrumbs and
empty tables and looked entirely loaded. It was inert.

Next 16 refuses cross-origin requests for its own development resources, and
decides "cross-origin" by comparing the request `Host` with its own. `next dev`
reports itself as `localhost`; the launcher advertised `127.0.0.1`. Different
origins by that test — so the hot-reload WebSocket handshake was refused with
`ERR_INVALID_HTTP_RESPONSE`, Next's development client retried it for ever, and
while it retried the App Router client never became interactive. **No `useEffect`
in any client component ran at all.**

The address a developer or the Product Owner was told to open was precisely the
address that does not work.

**Why nothing caught it.** The browser suite runs `next start` against a
production build, which has no development socket and works correctly. The jsdom
tier has no server to be cross-origin from. The single configuration a person
actually uses was the one configuration no tier exercised.

**Fix.** The launcher advertises `localhost` and keeps the loopback literal for
server-to-server probes, where origin is irrelevant. Pinned by
`tests/ci/local-launcher-host.test.ts` — five cases, one of which fails if either
script prints a browser URL on the loopback literal again, and one of which
proves that pattern is genuinely matchable so the rule is not vacuous.

**What was tried first, and why it is recorded.** `next.config.ts`'s
`allowedDevOrigins` is the documented remedy and Next's own warning names it. On
this version it made **every route answer 500** with a JSON parse failure inside
the framework — reproduced twice, reverted both times. Serving the origin Next
already trusts is the smaller and safer correction. The failed attempt is written
down because the next person will read the same warning and try the same thing.

**A consequence worth stating.** A React `unique key` warning in `AppHeader` is
now visible in development. It is not new — no client component had ever
executed, so no client-side warning could ever have surfaced. React strips it
from production builds, which is why the browser suite's clean-console assertion
passes. It is recorded rather than quietly absorbed.

---

## P1-26-F-049 — the approved symbol was invisible where the product identifies itself

**Severity:** Medium · **Status:** Fixed · **Area:** `BrandMark`

The Owner's symbol is near-black artwork on transparency: legible on white, all
but absent on the navy `#0F2742` used by the sidebar and the authentication
panel — the two surfaces where the product names itself.

**Fix.** `BrandMark` gains `onDark`, applied by those two surfaces.
`brightness-0` flattens the artwork to pure black so `invert` reaches pure white
whatever the source colour was; inverting alone yields a washed-out negative.
Only the image is treated — the adjacent product name already takes its colour
from the surface's own token.

---

## P1-26-F-050 — the acceptance fixtures and the Database tier cannot both be true at once

**Severity:** Medium · **Status:** Accepted (documented ordering) · **Area:**
local database state

Two Database tests assert that the database contains **no business rows at all**:

- `tests/db/iam-seeds.test.ts` — _"creates no user accounts and no role grants
  (configuration only)"_
- `tests/db/no-fake-data.test.ts` — _"all business tables start empty"_

They are the **runtime** enforcement of the permanent no-fake-data policy, and
they are correct. The acceptance fixtures are business rows. Both cannot hold at
the same time.

Measured, in three states:

| Local database                         | Database tier                       |
| -------------------------------------- | ----------------------------------- |
| Clean (`supabase db reset`)            | **1636 / 1636**                     |
| With the acceptance fixtures present   | **1634 / 1636** — exactly those two |
| After `npm run acceptance:reset-owner` | **1636 / 1636**                     |

**Disposition: an ordering, not a weakened assertion.** Neither test is changed,
skipped or made conditional. Loosening them would delete the only runtime proof
that the policy holds, in exchange for convenience. Instead the two states are
declared mutually exclusive and the transition between them is a supported,
reversible command:

```
npm run test:db                  # requires a clean database
npm run acceptance:create-owner  # for the Owner session
npm run acceptance:reset-owner   # before running the Database tier again
```

The reset is what makes this a disposition rather than an excuse: it removed
every row it created — 2 tenants, 2 companies, 2 branches, 3 roles, 33 role
permissions, 5 accounts, 3 grants, 1 grant scope, 10 settings, 5 identities and
the handoff file — and the tier returned to 1636/1636.

**Two defects found while proving it.**

1. The reset ran every delete in one transaction with a `continue` on a missing
   table. After a failed statement PostgreSQL rejects the rest with `25P02`, so
   one absent table silently prevented the whole cleanup while the script
   reported a list of zeroes as success. Each delete now runs inside its own
   `SAVEPOINT`.
2. It named `iam.audit_events`. The table is **`iam.audit_records`**, with
   `audit_record_details` and `audit_integrity_links` referencing it. The step
   was therefore skipped, and a reset that reported success would have left the
   Owner's own audit trail behind. All three are now removed, innermost first.

**A separate observation, not P1-26's to fix.** Running `npm run test:backend`
and then `npm run test:db` in the same session, without a reset between them,
produced **122** Database failures — foreign-key violations on the Database
tier's _own_ fixtures. A clean reset returns it to 1636/1636. The two tiers share
one local database and one fixture namespace; the ordering dependency is real
and predates this phase. Recorded here because it was measured here, and routed
to the tier that owns it.

---

## P1-26-F-068 — login asked for a tenant only the server could know

**Severity:** High · **Status:** Fixed · **Area:**
`apps/api/src/app/api/v1/auth/login`, `apps/api/src/modules/iam`

The Owner's acceptance checklist requires signing in with an address and a
password. The endpoint would not allow it:

```
POST /api/v1/auth/login  { email, password }
  → 422  violations: [{ path: "body.tenantId", rule: "invalid_type" }]
```

`tenantId` was a mandatory UUID. So the Login screen carried a **Workspace UUID**
field, and a human being was expected to type
`c0000000-0000-4000-8000-00000000000a` from memory. No product ships that.

**Why the Frontend could not fix it.** Faking it in the client means hard-coding
a tenant, or shipping a directory of tenants to an unauthenticated page — the
second is an enumeration oracle handed out at the door. The field existed because
the _contract_ demanded it, so the contract is what had to change.

**Why the database could not answer it either.** The obvious fix — look the
address up and read its tenant — cannot run:

```
sel_user_accounts_tenant  SELECT  {app_readonly,app_runtime}
  USING (tenant_id = iam.current_tenant_id())
```

A lookup that does not yet know its tenant is refused by the policy, and the
platform holds **zero** `SECURITY DEFINER` routines by CI-asserted invariant, so
there is nothing to sidestep it with. The database structurally cannot resolve a
tenant before a tenant is known.

**What can.** The identity provider, and only it. Two properties make the
resolution sound rather than convenient:

- `app_metadata.tenant_id` is written by the service role at invitation and is
  **not editable by the end user** (ADR-019 §3).
- `uq_user_accounts_provider_identity_active` is unique on
  `(identity_provider, provider_subject)` with **no tenant in the key**, so a
  verified subject resolves to exactly one account, and therefore one tenant.

Measured against the live database before the design was chosen, not after:

```
accounts 5 · auth_users 5 · with_tenant 5 · mismatched 0
duplicate provider subjects 0 · duplicate addresses (global) 0
```

`tenantId` is now **optional**. Supplying it asserts an expectation that is
cross-checked against the binding and refused on disagreement, so a caller can
never steer a verified identity at another tenant; omitting it is the normal
case. Existing callers keep working unchanged.

Verified against the real provider through the running API, not only the double:

```
email + password ONLY          200  tenant=c0000000-0000-4000-8000-00000000000a
correct tenantId supplied      200  tenant=c0000000-0000-4000-8000-00000000000a
WRONG tenantId supplied        401  Authentication required
wrong password, no tenantId    401  Authentication required
unknown address, no tenantId   401  Authentication required
```

**The failure-audit chain, proved by delta rather than by reading the code.** A
single wrong-password request carrying **no tenant at all**, against the live
stack:

```
iam.login_audit failure rows for the account   BEFORE  5
POST /api/v1/auth/login {email, password}      ->  401
iam.login_audit failure rows for the account   AFTER   6      delta 1
```

That one row can only exist if the GoTrue directory lookup returned the identity,
`app_metadata.tenant_id` resolved the tenant, the RLS context was built from it,
and the account was found — the whole chain, end to end, with nothing in the
request naming a tenant.

**The Frontend half**, merged separately under `p1-26-frontend`: the Workspace
field, its hint, its UUID validation and the `rootlco.tenantHint` cookie are
gone, and `auth-setup` now signs in the way an operator does — real Chrome, real
Server Action, no tenant — asserting the field is absent so the suite fails if it
ever returns. **97 passed** across `authenticated-en`, `authenticated-ar` and
`authenticated-tablet`.

---

**A verification trap this change walked straight into.** Three suites render the
sign-in screen: the component tier (`test:web`), the **anonymous** browser smoke
(`test:web-e2e`), and the **authenticated** browser tier
(`test:web-e2e-authenticated`). Removing the field, I ran the first and the
third, both green, and pushed. Hosted `web-quality` failed on the second:
`foundation.spec.ts` asserted `getByLabel('Workspace identifier')` was **visible**,
so deleting the field turned a passing assertion into a failing one.

Nothing about running two of three suites feels like partial coverage while you
are doing it — each one is a full green run, and the authenticated tier is the
more impressive of the two. The rule that would have caught it is mechanical
rather than intuitive: **when a screen changes, find every suite that renders
that screen**, not every suite that sounds relevant. Both assertions are now
inverted to `toHaveCount(0)`, so the field's return fails two suites instead of
silently satisfying one.

---

## P1-26-F-067 — resolving the tenant quietly reintroduced the oracle the file forbids

**Severity:** Medium · **Status:** Fixed · **Area:**
`apps/api/src/modules/iam/application/authentication-service.ts`

Found by reading the test logs of the fix for `F-068`, not by a failing
assertion — every test was green.

The first implementation answered early when no tenant could be resolved:

```
unknown address, no tenantId   → unresolved-tenant   (before any transaction)
wrong password, no tenantId    → provider:invalid-credentials
                                 (directory + transaction + audit write)
```

Both answer the caller identically. They do **not** cost the same. An unknown
address skipped the transaction entirely, which is precisely the short-circuit
rule 2 in that file's own header exists to forbid — "short-circuiting on a
missing account would make _this address is unknown here_ measurably faster than
_this password is wrong_" — reintroduced one layer above where the rule was
written, by the change that was supposed to respect it.

Fixed by removing the early return. An unresolvable attempt now runs the same
transaction against a sentinel tenant that no row holds, is denied as
`no-account`, and reaches the same code path as every other failure. The
operator-facing distinction survives in the log as `no-account:unresolved-tenant`;
the caller sees one answer.

The sentinel's absence from `org.tenants` is asserted by a test rather than
assumed, because "obviously nobody uses that UUID" is exactly the kind of
assumption that stops being true without anyone noticing.

---

## P1-26-F-066 — the login endpoint's enumeration defence is the throttle, not the clock

**Severity:** Low · **Status:** Accepted (recorded; not RootLco's to fix) ·
**Area:** identity provider (GoTrue), `iam.auth-login`

While verifying `F-067` I measured whether the remaining latency gap was mine.
It is not — it is the provider's, and it is much larger than anything RootLco
adds. Eight samples per cell, every attempt with a wrong password:

```
GoTrue direct  — known address     min 126  median 148  max 222  ms
GoTrue direct  — unknown address   min  19  median  19  max  22  ms
```

A **7.8×** difference, before RootLco executes a single line. GoTrue verifies a
bcrypt hash when the address exists and returns immediately when it does not.

This qualifies a claim the codebase makes about itself. Rule 2 in
`authentication-service.ts` says the provider is always asked so that failure
latency does not depend on whether the address is known. RootLco does always ask
— but the provider short-circuits _internally_, so the property the rule is
reaching for was never actually delivered, before this phase or after it.

Stated plainly: the endpoint's resistance to address enumeration rests on the
`auth-adjacent` rate limit, not on uniform latency. That defence is real and was
observed working during this measurement — the probe was cut off with `429`
after a handful of attempts, which is why the RootLco-side cells are absent
above. A timing attack that is throttled after a few tries is not a practical
oracle.

Not fixed here: closing it means dummy-hashing unknown addresses inside GoTrue,
which is upstream of this codebase. Recorded so the next person reading rule 2
does not mistake an aspiration for a guarantee.

---

## P1-26-F-065 — the running application's brand colour came from a test, not from the source

**Severity:** High · **Status:** Fixed (artifact); **guard Open** · **Area:**
`apps/web/tests/brand-replacement.test.ts`, local development builds

The Owner's sign-in screen rendered its primary action button **purple**. The
approved action colour is green `#1F6B52`.

Measured, in this order, because the obvious conclusion was wrong twice:

```
browser  --color-primary            #7a1fa2   (purple)
source   $primary 500               #1f6b52   (green)
grep     "7a1fa2" across apps/web/src         0 hits
sass     compiled from source, just now       --color-primary: #1f6b52
built    .next-dev/.../globals.css            --color-primary: #7a1fa2
                                              occurrences of #1f6b52: 0
```

So a **freshly built** stylesheet disagreed with the source it was built from.

**Cause.** `brand-replacement.test.ts` proves the brand can be replaced by
configuration alone. To do that it **writes to the real tracked source file**:

```js
writeFileSync(coloursPath, colours.replace('500: #1f6b52', '500: #7a1fa2'));
```

and restores it afterwards. Its own comment says the hue is deliberately unlike
the brand "so a stale build would be obvious rather than plausible" — which is
exactly what happened, only the stale build outlived the test that caused it.

Running the web suite while `dev:all` is up gives Turbopack a window in which
the file on disk is purple. It recompiles, caches the result by content hash,
and the corrupted chunk survives the restore: the source goes back to green and
nothing invalidates the artifact. A later `.next-dev` delete does not help
either if the suite runs again afterwards.

The give-away was that `--color-primary-active` (`$primary: 700`) stayed green
while `--color-primary` and `--color-focus-ring` (`$primary: 500`) were purple —
only the one entry the test rewrites.

**Fix applied.** Stop the stack, delete `.next-dev`, restart with no suite
running. Verified: `--color-primary: #1f6b52`, submit button
`rgb(31, 107, 82)`.

**Not yet fixed, and it should be.** Nothing prevents the recurrence. A test
that mutates tracked source races every watching process, and the failure is
silent, persistent, and looks like a design decision rather than a fault. The
durable options are to copy the tree into a temporary directory and mutate the
copy, or to refuse to run the mutating case while a launcher lock is held. Left
open deliberately rather than fixed in passing, because it changes how a brand
gate proves itself and deserves its own review.

The lesson is one this phase keeps paying for from new directions: **a build
artifact is evidence about the moment it was built, not about the source.** Two
earlier findings — `P1-26-F-055`'s invented 404 and the corrupt
`prerender-manifest.json` — are the same sentence with different nouns.

---

## P1-26-F-064 — the page scrolled, so the sidebar scrolled away with it

**Severity:** Medium · **Status:** Fixed · **Area:**
`apps/web/src/components/shell/**`, `apps/web/src/components/data-table/**`

The shell root was `min-h-dvh` — a floor, not a cap — so the document grew with
the content. The desktop sidebar is a statically positioned `h-dvh` box, not a
sticky one, so once the document was taller than the viewport the whole sidebar
travelled up and off the screen. Its `overflow-y-auto` never engaged, because
the nav was not what was overflowing; the document was.

Measured on `/en/administration/users` at a 900px viewport:

|                               | before      | after |
| ----------------------------- | ----------- | ----- |
| `document.scrollHeight`       | **991**     | 900   |
| page scrolls                  | **true**    | false |
| `main` computed `overflow-y`  | **visible** | auto  |
| scrollable ancestor of `main` | **none**    | —     |

**Fix.** The shell root is `h-dvh overflow-hidden`, so it is exactly the
viewport and nothing outside it scrolls. `main` and the secondary panel each
own `overflow-y-auto`, and both carry `min-h-0` — without it a flex child's
default `min-height: auto` refuses to shrink below its content, so
`overflow-y-auto` has nothing to overflow and the box grows instead, which
reproduces the original defect one level down. The sidebar is `h-full min-h-0`
rather than declaring its own `h-dvh`.

The shared table body is additionally capped at `max-h-[70dvh]`. At the maximum
page size of 100 rows the pager was several screens below the filters; a sticky
header inside a container that never scrolls has nothing to stick to.

**Verified in a real browser at three viewport heights.** At 560px and 420px the
nav scrolls **internally** (`scrollHeight` 700 vs `clientHeight` 496/356), the
page does not scroll, the brand block stays fixed, and the last navigation item
is reachable.

That last assertion was wrong the first time and said "unreachable". The probe
used `querySelector('li:last-child a')`, which returns the FIRST match — in a
nested navigation that is an early child item, not the bottom of the list. A
false negative in a measurement is as damaging as a false positive: it very
nearly bought a fix for a defect that did not exist.

---

## P1-26-F-063 — a bind probe cannot see a listener on another address, so `dev:all` started a second stack

**Severity:** High · **Status:** Fixed · **Area:** `scripts/dev/**`, root and
workspace `dev` commands

The Owner ran `npm run dev:all` and got `EADDRINUSE :::3000` and
`:::3100`. A later run printed **`RootLco local stack is up.`** and then killed
both of its own children with the same error. `npm run dev` then reported
`Port 3000 is in use by process 8296, using available port 3001 instead`.

**The root cause is one line, and it is not a missing branch.** The launcher
decided a port was free by binding it:

```js
createServer().listen(port, HOST); // error => in use
```

A bind probe only conflicts with a listener holding the **same address**.
Measured against the live stack, which was bound to `::1`:

```
bind 127.0.0.1 -> SUCCEEDED   (judged "free")
bind 0.0.0.0   -> SUCCEEDED   (judged "free")
bind ::        -> SUCCEEDED   (judged "free")
bind localhost -> EADDRINUSE  (the only one that saw it)
```

So the check passed. Next then bound with exclusive semantics and died. And the
readiness probe — which fetches a URL — was answered **200 by the incumbent
server**, so the launcher printed success over two corpses. Three steps, each
locally reasonable, composing into a confident lie.

`npm run dev` was a separate defect with the same consequence: it ran
`npm run dev --workspace @rootlco/api`, and that workspace's script was a bare
`next dev` with no port. Next found 3000 busy and moved the API to **3001**,
where it looked like a working stack and was not.

**Fix.**

1. **Ports are identified, not probed.** `process-discovery.mjs` asks the
   operating system which process holds each port. Ownership is proved by
   walking the **parent chain** — necessary, because the listener's own command
   line names neither the repository nor the workspace:
   `start-server.js` ← `next dev apps/api …` ← `start-local.mjs`.
2. **One enumerated decision before anything is spawned** —
   `START_NEW` · `ADOPT_EXISTING` · `REPAIR_PARTIAL` · `REFUSE_UNRELATED` — in a
   pure function, so all seven contract states are testable as data.
3. **Readiness is bound to the child that should be serving it.** `waitFor`
   fails if the child exited, so a dead child can no longer borrow the
   incumbent's 200.
4. **An atomic lock** (`openSync(file, 'wx')`, never test-then-write) stops two
   launchers racing; a second run still reports the stack as already running
   rather than reporting lock contention, because that is the question asked.
5. **Ports are pinned everywhere**: root `dev` now runs the full launcher, and
   both workspace `dev` scripts carry `--hostname localhost --port <port>`.
   Production `start` was deliberately left alone — pinning `localhost` there
   would make the Docker container unreachable through its published port.

**Two things this cost, both worth recording.**

`Get-CimInstance Win32_Process | ConvertTo-Json` produces **invalid JSON** on a
real machine: an unescaped control character inside some unrelated process's
command line, measured at position 110350. `JSON.parse` threw, discovery failed,
and `dev:stop` and `dev:status` both exited 2. The process table is now a
delimited format using ASCII US, which removes the escaping problem instead of
trying to survive it.

And `dev:stop` re-read the entire process table once per listener per 250 ms
poll — a PowerShell process per iteration. The listeners are now re-read in the
loop and the table only when something is still holding a port.

**Regression coverage.** `tests/ci/local-stack-single-instance.test.ts`, 68
cases, none of which needs a port or a process. Mutation-tested: eight real
defects reintroduced, eight caught. One mutation was **MISSED** first time —
deleting the adopt path's early return — because the assertion only proved _a_
`return` existed somewhere between the branch and the spawn, and other returns
satisfied it. It now extracts the balanced block and asserts its **last
statement** is `return;`.

**Proven on the machine**, not inferred: `npm run dev:verify-single-instance`
runs the reported sequence end to end and reports **22/22** — stop, start,
second `dev:all` adopts with identical listener pids and no `EADDRINUSE`, no
3001, no 3101, truthful status, safe stop that frees both ports, and a clean
restart with new pids.

The lesson is about the shape of the question. **"Is this port free?" has no
true answer** — a port is held by a process, on an address, and the useful
question is "who holds it, and is it mine". A boolean was the wrong return type,
and every downstream mistake followed from it.

---

## P1-26-F-062 — the launcher advertised `localhost` and configured `127.0.0.1`

**Severity:** High · **Status:** Fixed · **Area:** `scripts/dev/**`,
`apps/web/src/lib/env.ts`, `apps/web/playwright.config.ts`

`P1-26-F-048` fixed the address the launcher **prints**. It did not fix the
address the launcher **configures**, and the two disagreed for two more rounds.

`start-local.mjs` set `NEXT_PUBLIC_API_BASE_URL` to `http://127.0.0.1:3000`.
That value is inlined into the client bundle, so the browser — served from
`http://localhost:3100`, exactly as instructed — was told to call a different
origin. `src/proxy.ts` derives the CSP from it too, so the page served itself a
`connect-src http://127.0.0.1:3000` naming an origin it is not served from. The
same literal was written into `.local/owner-acceptance-account.json`, the file
the Owner opens to find the address; printed back by
`acceptance:status-owner`; defaulted in `apps/web/src/lib/env.ts`; shipped in
`apps/web/.env.example`; and used as the base URL for **the entire browser
suite**, which therefore spent every run testing an origin the Owner is told
never to open.

**Why the existing gate missed all of it.** `tests/ci/local-launcher-host.test.ts`
forbade one pattern — a printed `` `http://127.0.0.1:${WEB_PORT}` `` — in two
files. The launcher's defect used `API_PORT`, so the regex could not match it;
and nothing under `scripts/dev/owner-acceptance/`, `apps/web/src/lib/` or the
browser configuration was scanned at all. The gate was written to the shape of
the one instance that had been found rather than to the rule it claimed.

**The measurement that shaped the fix.** `§7` requires
`next dev --hostname localhost`. Passing it naively would have broken the
launcher outright, because **a hostname binds one address family**:

```
dns.lookup('localhost', {all:true}) -> [::1, 127.0.0.1]   (verbatim order)
server.listen(port, 'localhost')    -> bound ::1
fetch('http://127.0.0.1:port')      -> ECONNREFUSED
fetch('http://localhost:port')      -> 200
```

Next 16 defaults to `0.0.0.0`, which answers on every loopback address at once —
which is precisely why a launcher that configured one host and advertised
another had worked well enough to ship. Pin the name and the readiness probes on
the literal stop connecting, so `dev:all` would have waited its full 180-second
timeout and then declared a perfectly healthy stack dead.

So `PROBE_HOST` was deleted rather than corrected. Two constants that must
always agree are one constant. Using one NAME everywhere is also what makes this
portable: a name resolves the same way for the bind and for the probe on any
machine, whereas a name for one and a literal for the other is a coin toss that
lands differently on Windows and on a Linux runner.

**The override no gate can see.** `apps/web/.env.local` is git-ignored, is read
by Next in preference to every default, and on the Owner's machine still carried
the stale literal. Correcting every tracked file would have looked like a
complete fix and changed nothing that actually runs. The launcher now reports a
contradiction between that file and the canonical origin — it warns rather than
refuses, because pointing the web tier at a different API is a legitimate thing
to want; doing it silently is not.

**Fix.** `dev-config.mjs` publishes `DEV_HOST`, `API_HOST`, `WEB_HOST`,
`API_ORIGIN` and `WEB_ORIGIN`; `BROWSER_HOST` is retained as another view of the
same string and a test asserts they are all identical. Both tiers start with
`--hostname localhost`. Probing, binding, printing, the handoff file, the
acceptance status command, the schema default, the example env and the browser
suite all derive from those two origins. `dev:all` and `dev:status` print the
API, the readiness URL, the web origin and both login routes.

**Regression coverage.** `tests/ci/local-launcher-host.test.ts` grew from 11
cases to 24, and the decisive one now scans **eleven** authoritative files for
`http://127.0.0.1:(3000|3100|3210)` with comments stripped, so the prose
explaining the hazard is not mistaken for the hazard. Mutation-tested: putting
either literal back — the launcher's `NEXT_PUBLIC_API_BASE_URL` or the schema
default — fails it, and restoring them passes.

**Also fixed, found by the sweep rather than by the symptom.** The captured
browser session is now named after the origin it belongs to. Cookies are scoped
by host string, so a jar captured against `127.0.0.1` presents nothing to
`localhost`: the authenticated projects would have started "signed in", landed
on `/en/login`, and failed as though authentication had regressed. Naming the
file after the origin makes a stale jar impossible to reuse instead of merely
unlikely.

The lesson is narrower than "use localhost" and worth stating exactly: **fixing
what a system says is not the same as fixing what it does.** `F-048` corrected
the sentence and left the configuration, and every tier stayed green for two
more rounds because no tier ever compared the two.

---

## P1-26-F-061 — a shell that starts and cannot run anything passed the "is bash available" probe

**Severity:** Medium · **Status:** Fixed · **Area:**
`scripts/ci/check-run-block-syntax.mjs`

Surfaced while re-running the suite for the Owner handoff: three tests in
`tests/ci/run-block-syntax.test.ts` failed — precisely the three asserting that
**valid** shell is accepted. The one asserting invalid shell is rejected still
passed, because everything was being rejected.

**Cause, and it is not in the repository.** On Windows `bash` resolves to
`C:\Windows\System32\bash.exe`, the WSL launcher. With no installed
distribution it starts, fails to `execvpe(/bin/bash)`, prints that to stderr and
exits 1. `spawnSync` therefore reports **no `error`** — the process started
fine — and a status of 1, which `checkBlock` reads as "this block is not valid
shell". Every one of the 139 blocks.

**Why the guard did not catch it.** `main()` probed with
`spawnSync('bash', ['-c', 'exit 0'])` and tested only `probe.error`. That
distinguishes _cannot be started_ from _started_; it does not distinguish
_started_ from _usable_. The comment above it states the right rule — "a check
that cannot run must not report success" — and the code implemented a narrower
one.

It is worth being precise about the failure mode, because it is not the usual
one. This did not go quiet; it went uniformly red. A gate that fails on
everything communicates as little as one that passes on everything, and it is
likelier to be worked around than investigated.

**Fix.** `shellWorks(bash)` requires a trivial script to exit 0, not merely to
launch. `resolveShell()` returns the first candidate that satisfies it — `bash`
first, so a Linux runner is unaffected, then the Git Bash locations — resolved
once per process. `checkBlock` returns `unavailable` with a named message when
there is none, and `main()` exits 2 explaining that `bash` on Windows is the WSL
launcher.

**Regression coverage.** `tests/ci/run-block-syntax.test.ts` asserts a working
shell is found, and — the assertion that encodes the actual lesson — that
`shellWorks` rejects a binary that starts and exits non-zero, using the Node
executable itself as the specimen.

**Measured after:** the gate reports `139 multi-line run block(s) checked, 0
invalid` on this machine, where it had been reporting all 139 invalid.

---

## P1-26-F-059 — the English interface announced its loading state in Arabic

**Severity:** Medium · **Status:** Fixed · **Area:**
`apps/web/src/app/[locale]/(dashboard)/loading.tsx`

Found by the Owner-acceptance handoff itself, on the last pass before the
environment was handed over — by opening a screen and reading what was on it.

Every navigation inside the dashboard renders the route group's `loading.tsx`
while the next screen resolves. It contains an `aria-live` status region whose
`sr-only` text is the only thing a screen reader is given during that window. On
`/en/administration/users`, with `<html lang="en">`, that text was
**`جارٍ التحميل`**.

**Why it was there.** Next passes a `loading.tsx` no props — not params, not
anything; this was measured rather than assumed, by rendering one with
`Object.keys(props)` and getting `[]`. With no route params, the file read
`DEFAULT_LOCALE`, and `DEFAULT_LOCALE` is `'ar'` — deliberately, because Arabic
is the pilot tenant's language and a locale list that puts English first tends to
produce code treating RTL as the exception. The comment in the file was honest
about the trade-off. It was wrong about the conclusion: the URL is also locale
evidence, and it is available.

**Why nothing caught it.** The `en` catalogue is complete — `state.loading` is
`"Loading"` and the missing-key gate is green, because the key is not missing,
it is unused. axe reports no violation: the markup is valid, the region is
labelled, and `sr-only` text declares no language of its own for `lang` to
disagree with. The 97 authenticated browser assertions wait for content, which
means they wait for exactly this element to disappear. It is a sub-second
fallback holding a screen-reader-only string — below the resolution of every
tier this phase built.

**Fix.** `localeFromPathname` in `apps/web/src/i18n/config.ts` resolves the
locale from the first path segment, falling back to `DEFAULT_LOCALE` only when
the path carries no locale. `loading.tsx` becomes a client component solely to
call `usePathname`; it ships no context and no data, and the fallback still
renders immediately.

**Regression coverage.** `apps/web/tests/i18n.test.ts` covers the resolver
directly, including the fallback cases. That alone would not have caught this —
the bug was never in the resolver, it was in which locale the boundary passed —
so `apps/web/tests/e2e/authenticated/accessibility.spec.ts` asserts in a real
browser that the `/en` loading state announces `Loading` and the `/ar` one
announces `جارٍ التحميل`. It holds the API response open for four seconds,
because without that delay the skeleton resolves before it can be read and the
test passes by observing nothing.

**Measured before and after** in headless Chromium: before, both routes
announced `جارٍ التحميل`; after, `/en` announces `Loading` and `/ar` is
unchanged.

The new assertion then proved itself by accident, which is better evidence than
proving itself on purpose. Its first run in the authenticated tier **failed** —
the English case in both projects, with the Arabic case passing — because the
browser tier serves a production build and that build predated the fix. Against
code containing the bug the test fails; against code without it, it passes. The
Arabic case passing throughout is the control: on the old build every route
announced Arabic, so only the English assertion could distinguish them.

> **Corrected during `P1-26-F-062`.** That browser assertion was a flake, and
> the accident above is exactly why it looked convincing. It held `**/api/**`
> open to keep the skeleton on screen — but this application fetches on the
> SERVER, so the browser issues no API request and the delay matched nothing.
> The fallback appeared only when the server happened to be cold. It passed
> alone and failed inside the full suite. The assertion now lives in
> `apps/web/tests/loading-boundary.dom.test.tsx`, which renders the boundary
> directly for each locale with no timing involved, and is mutation-tested:
> restoring `DEFAULT_LOCALE` fails it. The authenticated tier is 96 as a result,
> not 101 — a smaller number, and every one of them deterministic.

The lesson is the one the Owner-acceptance rule exists to record. This phase's
assurance can prove a string is present, that it is translated, and that the
markup around it is correct. **It cannot notice that the wrong one of two valid
translations was chosen** — that took someone opening the page.

---

## P1-26-F-060 — directories declared to Git and to nothing else

**Severity:** Medium · **Status:** Fixed · **Area:** `apps/web/eslint.config.mjs`,
`eslint.config.mjs`, `apps/web/.prettierignore`, `.prettierignore`

`P1-26-F-055` split the development build into `.next-dev` so that `next dev` and
`next start` could not overwrite each other. `.gitignore` was updated. Nothing
else was.

ESLint ignored `.next/**` and Prettier ignored `.next`; neither pattern matches
`.next-dev`. After any `npm run dev:all`, `npm run lint` walked into the
Turbopack output and reported **10,780 problems across generated chunks**, and
`format:check` refused the same files.

**Why CI stayed green through all of it.** CI never runs `next dev`, so the
directory does not exist there, so the ignore list is never consulted and cannot
be wrong. The gate could only fail on a developer's machine — and only after
they had run the stack, which is precisely the moment they are least likely to
suspect their linter.

**The same omission one directory over.** Fixing that exposed a second: the root
ESLint run then walked **`.local`**, the repository's own local-only directory,
and reported **25,508 problems** — almost all of them inside the bundled scripts
of the dedicated Chrome profile that the Owner-acceptance handoff creates there.
`.local` has been in `.gitignore` since it was introduced. Neither ESLint nor
Prettier reads `.gitignore`, and nobody had ever put a file they would parse into
it before this remediation did.

**Fix.** `.next-dev` added to both ESLint configurations and both
`.prettierignore` files; `.local` added to the root ESLint configuration and the
root `.prettierignore`. Stylelint needed no change: it globs `src/**/*.scss` and
never leaves the source tree.

**Regression coverage.** `tests/ci/local-launcher-host.test.ts` asserts each
directory is named in each ignore list by file, plus a check that `DEV_DIST_DIR`
is still `.next-dev` so the hard-coded patterns cannot outlive a rename.

This is the same shape as `P1-26-F-050` and `P1-26-F-057` from a third
direction: **a check that cannot fail in CI is a check that only ever fails on
someone's machine**, and one that fails there noisily enough will simply stop
being run.

---

## P1-26-F-058 — a piped child process and a blocking `spawnSync` froze the API mid-suite

**Severity:** High · **Status:** Fixed · **Area:**
`scripts/dev/owner-acceptance/full-cycle.mjs`

The lifecycle starts the API as a long-lived child and then runs each step with
`spawnSync`. The API was spawned with `stdio: 'pipe'` and its output collected by
`data` listeners.

**`spawnSync` blocks the event loop for its entire duration.** So while
`build-web` ran for 28 seconds and the browser tier for minutes, nothing in this
process was awake to drain the API's pipe. The OS buffer filled, the child
blocked on `write`, and the API stopped answering **mid-suite**.

**Twenty-one authenticated tests failed**, and this is the part worth keeping:
they failed as `Test timeout of 30000ms exceeded` and as redirects to
`/ar/login?reason=unavailable`. Every one of them looked exactly like a slow
machine under load — which the machine genuinely was, running hosted CI, a
production server and Chromium at the same time. The convenient reading was
right there and it was wrong.

What settled it was `api.log`: it contained the startup banner and the single
readiness probe, and then nothing. A server that is merely slow keeps logging. A
server whose stdout is blocked stops — and stops at exactly the moment the log
ends.

**Fix.** The child writes straight to a file descriptor, `stdio: ['ignore', fd,
fd]`. Nothing in this process needs to be awake for the child to keep writing,
so a blocking step cannot starve it.

### The middle option was the trap

Both obvious choices are wrong in opposite directions, and this function has now
been bitten by each:

|                   |                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `stdio: 'ignore'` | the API failed to start and the reason was discarded — a three-minute wait with no explanation |
| `stdio: 'pipe'`   | the API started, then froze once the buffer filled, and blamed the tests                       |

Only handing the descriptor to the operating system avoids both, because it
removes this process from the path entirely.

**The general form.** _A long-lived child and a blocking parent are incompatible
unless the child's output bypasses the parent._ And more sharply: **a failure
that resembles the environment you are already blaming deserves more scepticism,
not less.** Contention was real, so contention was believable, and it would have
been recorded as the cause of a defect I had written.

**Confirmed by re-measurement.** With the descriptor handed to the operating
system, the same suite on the same machine reports **97 / 97 passed in 97
seconds** — inside a lifecycle run whose Database tiers took nearly four minutes
each on either side of it. Nothing about the load changed. The frozen server did.

---

## P1-26-F-057 — the acceptance fixtures and the clean-database invariant, resolved by ordering rather than by weakening either

**Severity:** High · **Status:** Fixed · **Area:**
`scripts/dev/owner-acceptance/full-cycle.mjs`, `tests/db/no-fake-data.test.ts`
(unchanged), `tests/db/iam-seeds.test.ts` (unchanged)

The Owner-acceptance fixtures are business rows: two tenants, five operators,
three roles, ten settings. `tests/db/no-fake-data.test.ts` asserts that **every
base table across seventeen platform schemas is empty**, minus an eleven-entry
structural-reference allow-list. It is the runtime enforcement of the permanent
no-fake-data policy, and it is the only check that would notice fabricated data
reaching a shipped database.

Both cannot be true at once. With fixtures present the Database tier reports
**1634 / 1636**; the two failures are that test and its sibling, and they are
**correct**.

### The four wrong answers, named because each one was available

Weaken the test to ignore the acceptance tenants. Mark the two failures flaky.
Skip them when fixtures exist. Add the acceptance tables to the allow-list. Every
one buys a green by making the invariant smaller, and the invariant is worth more
than the green — a no-fake-data test that exempts the rows someone actually
created is a test that would exempt the next ones too.

### The resolution is ordering, and it is now executable

Neither test is touched. The fixtures may exist and the tier may run, but never
at the same time:

```
clean → prove clean → create fixtures → use them →
reset → prove removed → prove clean again
```

`npm run acceptance:full-cycle` performs exactly that, in that order, and nothing
else may reorder it. Twelve steps, each logged to `.local/acceptance-cycle/`,
each checked. It starts the API if nothing is answering and stops it again if it
did. On failure it preserves the step's log, attempts a reset, reports whether
that reset succeeded, names the failing step and exits non-zero — because
fixtures left half-created are worse than either extreme: the next run starts
from a state nobody described.

**Measured on this tree, end to end, in one command:**

| #   | Step                    | Result                                  |
| --- | ----------------------- | --------------------------------------- |
| 1   | `reset-before`          | ok · 4.0s                               |
| 2   | `verify-clean-before`   | ok · 4.9s                               |
| 3   | `db-rls-pre-acceptance` | **1636 / 1636** · 236.6s                |
| 4   | `create-fixtures`       | ok · 5.2s                               |
| 5   | `start-api`             | ready                                   |
| 6   | `status-fixtures`       | ok — live sign-in, 14 of 14 permissions |
| 7   | `build-web`             | ok · 20.4s                              |
| 8   | `authenticated-browser` | **97 / 97** · 97.0s                     |
| 9   | `reset-after`           | ok · 4.8s                               |
| 10  | `verify-clean-after`    | every counter zero · 4.3s               |
| 11  | `db-rls-post-reset`     | **1636 / 1636** · 236.9s                |
| 12  | `git-clean`             | no untracked file appeared              |

119 migrations, no Migration 120, before and after. The fixtures existed, the
Database tier ran, and neither test was weakened to let them coexist.

### What "clean" had to be made to mean

The first verifier counted rows belonging to the two acceptance tenants. The
Database tier does not: it counts **every row in every business table**,
tenant-scoped or not. So a database could be free of acceptance fixtures, pass
verification, and still fail the tier because some other run left something
behind — and the tier would have taken the blame.

`verify-reset` now runs the tier's own sweep, with the tier's own allow-list and
the tier's own seventeen schemas, and
`tests/ci/acceptance-discovery.test.ts` asserts the two copies of that list are
identical. Two lists that must agree, with nothing checking that they do, is how
they stop agreeing.

---

## P1-26-F-056 — a hand-written table list cannot be trusted against 232 tenant-scoped tables

**Severity:** High · **Status:** Fixed · **Area:**
`scripts/dev/owner-acceptance/discovery.mjs`, `reset-owner-account.mjs`

The reset carried a hand-written list of seventeen tables. It had already been
wrong once, in the way hand-written lists are wrong: it named `iam.audit_events`,
a table that does not exist, so the step was skipped and a reset that reported
success left the entire audit trail behind.

The scale is the point. This database has **294 base tables, 232 of them
tenant-scoped**, and thirty carry a foreign key to `org.tenants`. Seventeen names
maintained by hand against that is not verification, it is sampling — and the
sample was already stale.

**Worse, the miss was structurally fatal rather than merely incomplete.** Every
one of those 232 tables has a `tenant_id` foreign key to `org.tenants` with
`ON DELETE RESTRICT`. A single surviving row in any table the list did not name
makes the final `DELETE FROM org.tenants` raise `23503`, the outer handler rolls
back, and the reset removes **nothing at all** — after printing a tidy column of
"removed N" lines. It failed safe and it failed silently, and it only worked at
all because no Owner action had yet written to `shared.idempotency_keys`,
`shared.event_outbox`, `iam.security_events` or `iam.user_status_history`, every
one of which the API demonstrably writes.

**Fix — nothing is hand-written.** `discovery.mjs` asks the catalogue which
tables are tenant-scoped, which of those actually hold acceptance rows, and how
they depend on each other, then topologically sorts children before parents. The
reset is generated from that answer. It cannot go stale, and a table added by a
future migration is covered the day it is added.

### Why discovery moved outside the transaction

The old design wrapped each delete in a `SAVEPOINT` so a statement against a
missing table could be rolled back without poisoning the transaction. That works
— and it treats "this table might not exist" as a runtime surprise to absorb,
which is precisely how the `audit_events` mistake stayed invisible for as long
as it did.

Now every statement targets a table that was read seconds earlier, so nothing is
expected to fail. No savepoints, no catch-and-continue, and any error genuinely
is one: it rolls the whole thing back. PostgreSQL's `25P02` stops being a hazard
to design around once nothing is expected to fail.

**Measured:** 232 tables scanned, 13 populated, **112 rows removed in one
transaction**, in the order the foreign keys demand — audit links before audit
details before audit records, `iam.user_accounts` after everything that
references it, `org.tenants` last. Idempotent: a second run finds nothing and
succeeds.

**A cycle is refused, not guessed.** `shared.message_templates` and
`shared.template_versions` reference each other. If both ever hold acceptance
rows the sort reports the cycle and the reset stops, because deleting round a
cycle needs a deferred constraint or a deliberate strategy and picking an order
silently would be the same class of mistake as the list this replaced.

---

## P1-26-F-055 — `next dev` and `next start` share one build directory, and it invented a defect

**Severity:** High · **Status:** Fixed · **Area:**
`apps/web/next.config.ts`, `scripts/dev/dev-config.mjs`, `start-local.mjs`

`next dev`, `next build` and `next start` all default to `<app>/.next` and write
incompatible manifests there. Running one after the other in the same checkout
leaves the second reading the first one's output.

It did real damage twice in one evening.

**It took the local stack down mid-suite.** The browser tier's `next start` and
the launcher's `next dev` were competing for one directory; the servers died and
the sign-in page reported "The service is not responding".

**Then it manufactured a defect that does not exist.** With a production build
left in `.next`, `next dev` answered **404** on the nested administration routes
while `/administration` answered 307 — so the sign-in redirect appeared broken in
development and correct in production. It reproduced. It differed cleanly between
modes. It was reported to the Owner as a product defect with a comparison table.

**The routes were correct the whole time.** The tell came from trying to fix it:
removing a locale guard made `/en/login` — a page that had been working — start
404ing too. A change that breaks an unrelated working route is not a fix for a
real bug, it is evidence the measurement was contaminated. Re-measured from an
empty `.next`, every route redirects correctly in both modes.

**Fix.** `apps/web/next.config.ts` reads `ROOTLCO_DIST_DIR`, defaulting to
`.next` so `next build`, `next start`, Docker, the browser suite and CI are
untouched. The launcher sets `.next-dev`, so development and production can never
corrupt each other. `apps/api`'s configuration is Backend-owned and a Frontend
phase may not change it, so the launcher instead detects a production `BUILD_ID`
in `apps/api/.next` and clears it — but only after `assertPortFree` has proven
nothing is listening, because deleting a directory a running server is reading
would be a worse bug than the one being fixed.

**Six regression cases** in `tests/ci/local-launcher-host.test.ts`, including one
asserting the clear happens _after_ the port assertions and one asserting the
discriminator is `BUILD_ID` — a marker `next dev` never writes — rather than the
directory merely existing.

**The general form, and it is the phase's recurring one.** Every automated tier
builds once and runs one server, so no suite ever switches modes in one
directory. **Only a person developing locally does.** The configuration nobody
exercises is the configuration that breaks, and this is the third time in P1-26
that the answer was found by running the product rather than by reading a report
about it.

**And a second lesson, about me rather than the code.** I measured a real
difference, reproduced it, and reported it as a product defect without asking
what else could produce that difference. A contaminated instrument produces
consistent readings. Reproducibility is not validity.

---

## P1-26-F-054 — an override written to fix an advisory pinned the tree to the next one

**Severity:** High · **Status:** Fixed · **Area:** `package.json` `overrides`

`dependency-security` failed on a tree whose only difference from a green one was
documentation. The advisory was **GHSA-7p8r-x3mc-p8w7**, `fast-uri` host
confusion via a backslash authority introducer, HIGH, affecting
`>=4.0.0 <4.1.2`. Newly published; nothing in this phase caused it.

What makes it worth recording is where it was found:

```json
"overrides": {
  "fast-uri": "^4.1.1"
}
```

`ajv` asks for `^3.0.1`. Somebody had already overridden `fast-uri` to v4 —
almost certainly to clear an earlier advisory against v3. **The override written
to fix one advisory is what held the tree on the version of the next one.** A
caret range would have allowed 4.1.2 on its own, but `npm ci` installs the
lockfile exactly, and the lockfile said 4.1.1.

**Fix.** The override moves to `^4.1.2` and the lockfile is refreshed —
`package.json` and `package-lock.json`, six lines between them. Resolved:
`ajv@8.20.0 → fast-uri@4.1.2`. Root audit and web audit both **0
vulnerabilities**; typecheck, 1491 root tests, the production build and
`verify:api` all still pass.

**Why the override is bumped rather than removed.** Removing it would let `ajv`
resolve `fast-uri@3.x`, which is a different tree and a different advisory
history. The narrow change is the one whose blast radius can be reasoned about —
the same reasoning that produced the range-scoped `brace-expansion` override in
`F-051`'s round, after a blanket one broke three `minimatch` majors.

**The general form.** _A pin is a standing decision that ages._ An override is
written at a moment when it is the fix, and then silently becomes the thing
holding a dependency still while the world moves. Every entry in an `overrides`
block is a small piece of permanent maintenance, and the only reason this one was
caught is that the audit gate has no waiver list.

---

## P1-26-F-053 — `mode: 0o600` is not a protection on the platform the Owner uses

**Severity:** Medium · **Status:** Fixed (record corrected; behaviour unchanged) ·
**Area:** `scripts/dev/owner-acceptance/create-owner-account.mjs`,
`local-acceptance-account-runbook.md`, `findings.md`

`P1-26-F-051` moved the generated password out of stdout and into a git-ignored
file, and recorded the fix as:

> it is written to one git-ignored file at mode `0600` — a directory being
> ignored does not stop a credential sitting world-readable on disk

The code does pass `{ mode: 0o600 }`, and POSIX honours it. **Windows does not.**
Node ignores the POSIX mode on Windows entirely; the file inherits the
directory's ACL. Measured on the Owner's own machine at the merged tree:

```
.local\owner-acceptance-account.json  <owner SID>:(I)(M)
                                      NT AUTHORITY\SYSTEM:(I)(F)
                                      BUILTIN\Administrators:(I)(F)
                                      3EZZ\Ezzaldeen:(I)(F)
```

No `Everyone` entry, so it is **not** world-readable — but it is readable by
SYSTEM and by any local administrator, which is wider than `0600` and wider than
the record implied. A reader of `F-051` would have concluded the credential was
owner-only on this machine. It is not.

**Why this is a finding rather than a footnote.** The sentence was written _about
credential protection_, in the finding whose subject is credential protection, on
the platform where the credential actually lives. Being accidentally right on
Linux is not the same as being right. This phase was reopened for claims that
were true in the abstract and untrue where it mattered.

**Disposition.** The behaviour is unchanged — `0o600` is still correct and still
enforced on POSIX, and there is no portable Node API that sets an equivalent
Windows ACL. What changes is that the code comment and the runbook now state the
platform difference, and the runbook tells the Owner how to restrict the file
themselves with `icacls` if they want to, and that deleting it after acceptance
is the simpler answer.

**The general form.** A flag that is accepted, ignored and never verified reads
exactly like a flag that works. `mode` on Windows, `allowedDevOrigins` in
`F-048`, and the `@ts-expect-error` that suppressed nothing are the same shape:
**a setting is not a control until something observes its effect.**

---

## P1-26-F-052 — the assertion written to prove rows load could be satisfied by the signed-in user's own name

**Severity:** High · **Status:** Fixed · **Area:**
`apps/web/tests/e2e/authenticated/administration.spec.ts`,
`authenticated-browser-evidence.md`

`P1-26-F-048` — every table on every screen loading for ever — was caught by
adding a test that the users table renders **rows**, not merely a shell. That
test read:

```ts
await expect(page.getByText('owner.acceptance@crm.local')).toBeVisible();
```

**The sidebar account menu renders the signed-in user's own address.** So on the
Users screen that string is on the page twice: once as the identity of the person
looking, and once as a table cell. A page-wide match is satisfied by the first
one, which is present whether or not a single row ever arrives — the assertion
written to catch an empty table would have gone green against an empty table.

It surfaced as a Playwright strict-mode violation rather than as a silent pass,
which is luck, not design: strict mode fails on ambiguity, and had the sidebar
rendered the display name instead of the address, this would have passed for ever
while proving nothing.

**Fix.** Both row assertions are scoped to `table tbody`. The scoping _is_ the
assertion: a check that exists to prove rows load must not be satisfiable by the
identity of the person reading them. The roles assertion is scoped the same way.

### And the figure in the evidence document was measured on a different suite

`authenticated-browser-evidence.md` reported **197 passed · 0 failed · 4
skipped** and, in the same document, described the rows-actually-load assertions
as part of what was measured. Re-reading the run log settles it: in that run
`administration.spec.ts:84` was the browser-storage test. **The rows assertions
did not exist yet.** The figure was true of the suite that ran and untrue of the
suite the document describes, and the two were a commit apart.

Both are now re-measured on the tree that ships, and the document carries the
number from that run.

The general form is worth keeping: **a test count is evidence about the suite
that produced it, not about the file it is written next to.** A suite that grows
after its figure is recorded leaves a number that reads as current and is not.

---

## P1-26-F-051 — the acceptance tooling shipped seven CodeQL findings of its own, and the first fix round only cleared five

**Severity:** High · **Status:** Fixed · **Area:**
`scripts/dev/owner-acceptance/`, `tests/ci/local-launcher-host.test.ts`

CodeQL raised this branch from the recorded ceiling of **0** open findings to
**7**. Every one was in code this remediation itself added. Every one was
correct. None was waived, and the ceiling stayed at 0 — a finding this tooling
introduced is this tooling's to fix, not the baseline's to absorb.

| Query                                  | Where                         | What it was                                                             |
| -------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `js/biased-cryptographic-random`       | `context.mjs`                 | `byte % 57` over `randomBytes`                                          |
| `js/clear-text-logging`                | `create-owner-account.mjs`    | the generated password printed to stdout                                |
| `js/insecure-temporary-file`           | `align-local-jwt.mjs`         | the JWT secret written to a fixed path in the shared temp directory     |
| `js/file-system-race` ×2               | `create-owner-account.mjs`    | `existsSync` then read                                                  |
| `js/file-access-to-http`               | `status-owner-account.mjs`    | the stored credential read from disk and forwarded to a sign-in request |
| `js/template-syntax-in-string-literal` | `local-launcher-host.test.ts` | a quoted string containing `${WEB_PORT}`                                |

### The part worth recording is that the first fix round cleared only five

I enumerated the findings by **security severity**, fixed the five that came back
HIGH, verified them, committed, and the gate failed again — `open findings rose
to 2`. The two survivors carry no high security severity: one is medium, one has
none at all.

The baseline file warns about exactly this, in writing, in the field I had
already read:

> The count deliberately includes medium and low, which is how the one dismissal
> was caught at all — GitHub's own CodeQL check reported that run as SUCCESS,
> because it blocks only on high and critical.

So the mistake was not missing a finding. It was **filtering by a severity the
gate does not filter by**, having been told in the gate's own configuration that
it does not. A partial fix that reports as a fix is worse than no fix, because
the next run's failure reads as a regression rather than as the remainder.

**And the branch's own CI proved the baseline's point in the same two runs.**

| Head                              | `CodeQL` (GitHub's check) | `code-security` (this repository's policy gate) |
| --------------------------------- | ------------------------- | ----------------------------------------------- |
| `66237c1` — 7 findings, some HIGH | **failure**               | **failure**                                     |
| `ecb8244` — 2 findings, none HIGH | **success**               | **failure**                                     |

At `ecb8244` GitHub's own CodeQL check went **green with two open findings in the
tree**, because it blocks on high and critical only. The one check most people
would read as "CodeQL is happy" said exactly that, and was of no use at all. The
repository's own gate — which counts every severity — is the only reason the two
survivors were not merged.

### `js/file-access-to-http` — and why it was fixed rather than dismissed

`status-owner-account.mjs` exists to answer "is the Owner account usable _right
now_", which it can only do by signing in for real, which means reading the
stored password. That is a file read reaching an outbound request, and the
tempting refutation is "the file is local".

That refutation was refused. It is the same assumption the query exists to
question, and the honest position is that anything able to write
`.local/owner-acceptance-account.json` would otherwise be choosing what this
process transmits and what lands in the Backend's request logs.

Dismissing it was also not available on the merits. The baseline's schema
requires a named human reviewer, a review date, an expiry, and a reproducible
refutation of both source and sink. There is no reviewer to name — this
remediation may not invent an Owner decision — and the sink is not safe in the
general case. The one dismissal this repository ever carried was
[withdrawn by removing the flow](../../engineering/security/codeql-remediation/sec-codeql-033-http-to-file-access.md),
not renewed. So: removed the same way.

**The fix is an allow-list, not a reformat.** The tenant id and the address now
come from the fixture constants, and the file's copies are only _compared_
against them and never forwarded. The password is rebuilt character by character
out of `PASSWORD_ALPHABET`, emitting the constant's character rather than the
file's, with the separator positions and the total length pinned. The output is
provably a string over the acceptance alphabet in the documented shape whatever
the input was — a value that is not a password this tooling could have generated
throws instead of becoming a shorter or stranger one.

`tests/ci/owner-acceptance-password.test.ts` pins it: 12 cases including a
round trip against 50 generated passwords, rejection of ten smuggled characters
(`/`, `:`, `"`, `\`, space, newline, `$`, `<`, and the ambiguous `O`), and a
check that 400 draws cover all 57 alphabet characters — which is what would
notice a rejection-sampling loop that dropped the alphabet's tail instead of
redrawing.

### `js/template-syntax-in-string-literal` — the query aimed at the one place the shape was the point

`local-launcher-host.test.ts` proves its own regex is not vacuous by matching it
against a sample containing the literal text `${WEB_PORT}`. In a quoted string
that is precisely the defect the query names. The sample is now a template
literal with the `$` escaped: identical text, correct construct, assertion
unchanged.

### The two that were the most instructive

**The biased random.** 256 is not a multiple of the 57-character alphabet, so
`byte % 57` made its first 28 characters appear more often than the remaining 29.
The skew is small, entirely real, and free to remove: bytes at or above the
largest whole multiple of the alphabet size are discarded and redrawn. This
generates the Owner's password, which is exactly where "small and real" is not
good enough.

**The clear-text logging**, a genuine tension resolved in the safer direction.
The Owner needs to read the password, so the first version printed it. But stdout
reaches terminal scrollback, whatever log the operator happens to be capturing,
and a CI transcript if the script is ever run somewhere it should not be. It is
no longer printed at all: it is written to one git-ignored file requested at mode
`0600` — a directory being ignored does not stop a credential sitting readable on
disk — and read from there. One place to find it, one place to delete it.
`P1-26-F-053` records that the mode is honoured on POSIX and **ignored on
Windows**, and measures what the Owner's machine actually grants.

The temporary file mattered for its contents: the GoTrue environment export
carries the local JWT signing secret, and it was written to a predictable path
another user on the machine could pre-create or replace with a symlink. It now
lives in a fresh `mkdtemp` directory at mode `0600`, removed afterwards. The two
races are the ordinary kind with the ordinary fix — attempt the read and handle
`ENOENT`, one syscall with no window.

**Re-verified after both rounds:** reset → create both exit 0 with all fixtures
reconciled; `status` reports READY with 14 of 14 permissions through a live
sign-in; 17 tests across the two pinning files; lint, typecheck and Prettier
clean; `security:all` 4 of 4 across 1822 tracked files.

**The lesson, arriving from a new direction.** Tooling written to verify the
product **is** product code. This tooling was reviewed by nothing until CodeQL
read it, because it is imported by no application module, had no tests pointed at
it, and runs only when a human runs it. Seven real weaknesses lived there for
exactly as long as it took the first tier capable of seeing them to look — and
then two of them survived a fix round because I read the results through a filter
the gate does not use.

**The biased random is the one worth understanding.** 256 is not a multiple of
the 57-character alphabet, so `byte % 57` made its first 28 characters appear
more often than the remaining 29. The skew is small, entirely real, and free to
remove: bytes at or above the largest whole multiple of the alphabet size are now
discarded and redrawn, so every character is exactly equally likely. This
generates the Owner's password, which is precisely where "small and real" is not
good enough.

**The clear-text logging was a genuine tension, resolved in the safer
direction.** The Owner needs to read the password, so the first version printed
it. But stdout reaches terminal scrollback, whatever log the operator happens to
be capturing, and a CI transcript if the script is ever run somewhere it should
not be. It is no longer printed at all: it is written to one git-ignored file
requested at mode `0600` — a directory being ignored does not stop a credential
sitting readable on disk — and read from there. One place to find it, one place
to delete it.

> That mode is honoured on POSIX and **ignored on Windows**, where the file
> inherits the directory ACL instead. `P1-26-F-053` measures what the Owner's
> machine actually grants and corrects this sentence rather than leaving it to
> imply a guarantee the platform does not make.

**The temporary file mattered because of its contents.** The GoTrue environment
export carries the local JWT signing secret, and it was written to a predictable
path another user on the machine could pre-create or replace with a symlink. It
now lives in a fresh `mkdtemp` directory at mode `0600`, removed afterwards.

**The two races are the ordinary kind with the ordinary fix.** `existsSync`
followed by `readFileSync` can be interrupted between the calls; attempting the
read and handling `ENOENT` is one syscall with no window. The same pattern in
`status-owner-account.mjs` was corrected as well — there, the file being raced is
the one holding the credential.

**Re-verified after the fixes:** reset → create both exit 0 with all fixtures
reconciled; 14 of 14 permissions resolved through a live sign-in; 20 password
draws all distinct, correctly shaped, and free of the ambiguous `0/O/1/l/I`
characters the alphabet deliberately omits; lint, typecheck and Prettier clean;
`security:all` 4 of 4 across 1822 tracked files; test-honesty scan clean.

The lesson is the same one this phase keeps producing from a new direction:
**tooling written to verify the product is product code.** It was reviewed by
nothing until CodeQL read it, because it is not imported by any application
module, has no unit tests pointed at it, and runs only when a human runs it. Five
real weaknesses lived there for exactly as long as it took the first tier capable
of seeing them to look.

---

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

**Second observation — the sibling tier, during the login-contract remediation.**
The **backend** tier reported **1761 / 1763**, failing two cases in
`tests/backend/outbox-worker.test.ts`:

```
never hands the same row to two concurrently claiming workers
becomes claimable again once the lease expires
```

A different file, in a different tier, from the one above — but the same subject
(outbox claim exclusivity under concurrency) and the same behaviour. Measured
afterwards: the file passes **8 / 8** in isolation, and an immediate re-run of the
whole tier passed **1763 / 1763** with no change to any file in between.

That non-determinism is what rules the login-contract change out as the cause: a
defect introduced by a code change does not disappear when the same code is run
again. What it rules _in_ is that this is not one test's bug — two independent
outbox tests, in two tiers, now show load-dependent claim behaviour that nobody
has explained. The disposition is unchanged and the observation is recorded
rather than smoothed over, because a second sighting is evidence and dropping it
would leave the next person to find it for the third time.

---

## P1-26-F-010 — `GET /iam/approval-limits` is unpaginated

**Severity:** Low · **Status:** Accepted · **Area:** contract

The approval-limit list takes `companyId` and `userId` filters but no cursor and
no limit, and returns `{items:[...]}` whole.

**Disposition.** The screen renders it through the shared table in a mode with
`total = items.length` and no server paging, and labels the result as a complete
list rather than a page. Client-side paging of a complete set is honest; what
the table must never do is page a _window_ and call it a set.
