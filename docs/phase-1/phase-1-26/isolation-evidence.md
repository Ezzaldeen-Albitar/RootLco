# Phase 1-26 — isolation evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-26-QA-003`. What this phase proves about tenant, company and branch
isolation, and — as importantly — what it does **not** claim to have proven.

---

## 1. What the Frontend can and cannot do

Isolation in this platform is enforced by row-level security in PostgreSQL and by
the request context the Backend resolves from a verified token. **The Frontend is
not a participant in that enforcement.** The strongest honest claim it can make
is that it never supplies a value the server would trust.

That claim is structural, not behavioural:

| Dimension     | How the Frontend could break it        | Why it cannot                                                                                                                                                                                                                                                             |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant        | send a tenant with a request           | **No request body in this phase has a tenant field.** The tenant comes from the verified token, on every request. `tenantId` appears in exactly one place — the login body — where the contract defines it as a lookup key, and the account must already exist inside it. |
| Company       | send a company the caller may not use  | It appears only as a **path parameter** on the settings operations, and `assertScopeWithinAuthority` runs **before** `companyExists`.                                                                                                                                     |
| Branch        | as above                               | Same, plus `companyOfBranch` resolves the parent company **from the database**, never from the request.                                                                                                                                                                   |
| Scope caching | show one tenant's data after switching | Nothing protected is cached. Every dashboard route is `force-dynamic` and re-resolves the session server-side per request.                                                                                                                                                |

## 2. No enumeration oracle

Typing a company identifier an actor may not use produces the **same** refusal
whether or not that company exists, because authority is asserted first. The
operator learns nothing about the tenant's shape.

The same property holds on sign-in: a guessed `tenantId` produces the identical
generic failure as a wrong password, so the login form is not a tenant-discovery
tool.

## 3. Session and sign-out

- The session cookie is `httpOnly` and expires with its token.
- A rejected token is **cleared** before the redirect, so a stale cookie cannot
  produce a request against a scope the operator has left.
- Sign-out clears the cookie first, then tells the backend. The next render has
  no session.
- There is no client-side store of scope, permissions, or any record. There is
  nothing to leak between sessions because nothing survives one.

## 4. What is NOT proven here, and why

**Cross-tenant behaviour end to end is not re-proven by this phase.**

Proving it from the Frontend requires two tenants, two live accounts and two
signed-in sessions. The no-fake-data policy forbids seeding business data, and
inventing an account to satisfy a test would produce exactly the kind of evidence
this repository refuses to accept.

The authority for isolation is where it is enforced:

- `tests/db/**` — 1636 assertions across 138 files, including tenant, company and
  branch isolation under the runtime application role.
- `tests/backend/context-spoofing.test.ts` — a request that tries to assert a
  context it was not granted.
- `tests/backend/context-and-rls.test.ts` — the resolved context against the
  policies.

Those ran at this phase's base and are re-measured at the candidate SHA. P1-26
adds no new enforcement and claims none.

## 5. What this phase does add

One thing worth stating plainly: **an empty scope array means unrestricted within
the tenant, not "no access"**. The backend's own delegation policy uses exactly
that test (`actorUnrestricted`), and `isUnrestrictedScope` mirrors it so the two
cannot drift.

Reading it the other way round would have produced a Profile screen that tells a
tenant administrator they have no access anywhere, and an Organization screen
with no addressable scope — both plausible-looking, both wrong.
`apps/web/tests/authentication.test.ts` pins it.
