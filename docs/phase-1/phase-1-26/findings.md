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

**Regression coverage.** `apps/web/tests/table-state.test.ts` and
`apps/web/tests/data-table.dom.test.tsx` assert that a null total renders no
count and no Last button, that Next is disabled when `hasMore` is false, and
that the offset mode is unchanged.

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
