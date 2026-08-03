# Phase 1-26 — permission and scope standard

**Classification:** Confidential — Commercial Product and Pilot Planning

How every screen in this phase decides what to show, and why none of those
decisions is access control.

---

## 1. The rule, stated once

**The server decides. Every request. Every time. Its denial is the only denial
that means anything.**

Everything in the Frontend that looks like a permission check is doing one job:
not showing an operator a door they cannot open. If the interface and the server
ever disagree, the server is right and the screen shows the denial.

## 2. Unknown means denied

A permission code the actor's set does not contain is **not held**. Not "shown
because we are not sure" — a permission set that failed to load produces an empty
sidebar, not a complete one.

There is no `isAdmin`, no `role === 'owner'`, and no tenant, company or branch
identifier read from client state anywhere in this phase.

`apps/web/src/lib/permissions.ts` is where this lives, unchanged from P1-25.

## 3. Codes are constants, and they are checked against the catalogue

`features/administration/shared/permissions.ts` names every code this phase
uses. Two properties follow:

1. A typo is a **compile error**, not a control that silently never appears.
2. `apps/web/tests/administration.test.ts` asserts every code against
   `supabase/seeds/04_iam_permission_catalog.sql`, so a code that drifts out of
   the platform catalogue fails the build.

That test exists because of `P1-26-F-011`: the P1-25 Settings entry was gated on
`org.settings.read`, a code in no catalogue and no operation. Under this very
rule it was hidden from every actor who has ever existed — and **a filter that
hides too much looks exactly like a filter working.** Nothing errors, nothing
logs, and the entry is simply absent, which is also what a correctly-denied entry
looks like.

## 4. Where a check happens, and what it renders

| Layer   | What it does                                                            | What it renders on denial                                               |
| ------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Sidebar | `visibleNavigation(NAVIGATION, capabilities)`                           | the entry is absent; an empty group is removed entirely                 |
| Route   | the page checks the code its operation requires                         | `PermissionDeniedState` **instead of** the content                      |
| Control | a row action appears only if its permission could satisfy the operation | the control is absent, not disabled                                     |
| Request | the operation is called regardless                                      | the backend's `403` → `status: 'denied'` → the denial replaces the view |

**Instead of, never over.** A table that paints its rows and covers them with an
overlay has already sent the data to the browser; the overlay is decoration.

**Absent, not disabled**, for an action that is illegal from the row's current
state. A disabled Archive on an already-archived account invites the operator to
wonder what is wrong with the button.

## 5. Operations that require two permissions

`iam.user-session-revoke-all` and `iam.user-status-change` each declare
`iam.user.manage` **and** `iam.session.view_all`. `holdsAll` requires both, and
`administration.test.ts` proves that either one alone does not enable the
control. Treating a two-permission operation as a one-permission one is an easy
mistake to make and an invisible one to have made.

## 6. Scope

`GET /api/v1/auth/session` returns `companyIds`, `branchIds` and `permissions` as
the server resolved them **for that request**.

- An **empty** scope array means unrestricted within the tenant. Not "no
  access". The backend's own delegation policy uses exactly this test
  (`actorUnrestricted`), and `isUnrestrictedScope` mirrors it so the two cannot
  drift. `authentication.test.ts` pins it.
- Nothing in this phase writes a scope. No request body carries one.
- Company and branch identifiers appear only as **path parameters** on the
  settings operations, and the server validates authority **before** existence
  (`assertScopeWithinAuthority` precedes `companyExists`), so an identifier
  outside the caller's authority is refused identically whether or not it names a
  real company.

That last point is why the Organization screen may accept a typed identifier for
an unrestricted actor without becoming client-authoritative: typing one buys no
information and no access.

## 7. Session

Resolved in the `(dashboard)` layout, before any child page's markup exists.

- No session → redirect to sign-in with `reason=signed-out`.
- A cookie the backend rejects → **cleared**, then redirect with
  `reason=expired`. Clearing is what makes the redirect terminal rather than a
  loop.
- The sign-in page performs no session check, which is the other half of that
  guarantee.
- `reason` is a fixed enum matched exactly. An unrecognised value renders no
  notice at all, so the query string cannot become a way to put arbitrary text on
  the page.

## 8. What this phase deliberately does not do

- It does not re-implement `assertDelegable`. A second implementation of an
  authorization rule is a second place for it to be wrong, and the copy with no
  database behind it is the one that would be wrong.
- It does not pre-check a permission and return early instead of calling the
  operation. That would produce a _different_ answer from the server's in exactly
  the cases where the difference matters.
- It does not use a permission to decide whether data is safe to render. It uses
  one to decide whether to offer a control.
