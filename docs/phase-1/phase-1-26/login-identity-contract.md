# Email-only sign-in — contract specification and integration finding

**Classification:** Confidential — Commercial Product and Pilot Planning
**Status:** **IMPLEMENTED (Backend and Frontend).** `tenantId` is optional, the
tenant is resolved server-side, and the Login screen asks for an address and a
password. Recorded as `P1-26-F-068`, with `P1-26-F-067` and `P1-26-F-066` found
while proving it.

Sections 1–3 are retained as written, as the specification the change was built
against. Section 7 records what was actually built and how it was verified —
including where the built thing differs from what section 3 proposed.

**Still not delivered:** the multi-company selector of section 4. That remains a
Database change, for the reason given there, and is not made possible by this
one.

---

## 1. The finding

`P1-26-INT-001` — **the sign-in contract requires a tenant UUID from the
client, so the Workspace field cannot be removed in the Frontend.**

Measured against the running API, not inferred:

```
POST /api/v1/auth/login  { email, password }
  -> 422  {"code":"ERR-VAL-001",
           "violations":[{"path":"body.tenantId","rule":"invalid_type"}]}

POST /api/v1/auth/login  { tenantId, email, password }
  -> 200
```

Confirmed in source at `apps/api/src/app/api/v1/auth/login/route.ts` — the body
schema is exactly three fields and `tenantId` is a bare required
`schemas.uuid`, with no `.optional()` and no default.

**Owning layer:** Backend (IAM). A Frontend phase may not change it: the
phase-ownership gate rejects a P1-26 change to `apps/api`, and it is right to.
This needs its own Backend remediation branch and its own protected merge.

## 2. Why this is a small change, not a redesign

The server **already knows the tenant** before it consults the client's value.
The Supabase identity provider returns `app_metadata.tenant_id` from
`signInWithPassword`; the login service then cross-checks it against the
caller-supplied `tenantId` and fails generically when they disagree.

So the mandatory field is redundant to information the server holds a moment
earlier. Removing the requirement removes a step, it does not add one.

And the resolution is unambiguous, because **one identity maps to at most one
tenant**:

```sql
-- supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql
CREATE UNIQUE INDEX uq_user_accounts_provider_identity_active
  ON iam.user_accounts (identity_provider, provider_subject) ...
```

There is no `tenant_id` in that key, so the index is **global**. One external
identity owns at most one live account in the entire database, and
`iam.user_accounts.tenant_id` is a scalar `NOT NULL` that a trigger makes
immutable. "Memberships" is a 0-or-1 relationship today, not a list.

## 3. Required contract change

**Make `tenantId` optional and derive it.**

```
POST /api/v1/auth/login
  body: { email: string, password: string, tenantId?: uuid }
```

- Absent — the server resolves the tenant from the authenticated identity. This
  becomes the normal path and the only one the Login form uses.
- Present — behaviour is unchanged, so existing callers and the browser suite
  keep working. It is a cross-check, never a grant.

**Invariants that must not move.**

- The tenant is a lookup key, never an authorization grant. A supplied tenant
  that disagrees with the resolved one fails with the same generic
  `ERR-IAM-002` as a wrong password — no oracle for "does this tenant exist".
- A wrong email, a wrong password, an unknown tenant and a mismatched tenant
  remain indistinguishable to the caller.
- Account state (`invited | active | locked | archived`) is already enforced at
  login and must stay enforced ahead of any tenant resolution.
- Rate limiting, audit and correlation are unchanged.

**Deliverables on the Backend branch:** OpenAPI entry, request validation,
authorization, RLS-safe resolution, audit event, unit tests for the four states
above, and a contract test proving a body without `tenantId` succeeds and one
with a mismatched `tenantId` fails generically.

## 4. What this does NOT deliver, and why

**A workspace selector for a user with several companies (§5B) is not
implementable today.** It is blocked in the schema, not in the API:

- `iam.user_accounts.tenant_id` is a single scalar column, `NOT NULL`.
- It is trigger-immutable, so an account cannot even be moved between tenants.
- The identity uniqueness index is global, so a second account for the same
  human in a second tenant cannot be inserted.
- The runtime session context carries a single `app.tenant_id` UUID — company
  and branch narrowing are arrays, tenant is not.

Multi-tenant membership therefore requires a **Database phase**: a membership
relation, a revised uniqueness rule, a tenant-selection step in the session
contract, and an RLS review of every policy that reads `app.tenant_id`. That is
a cross-layer change and must not be smuggled into a Frontend remediation.

Until it exists, §5's branches resolve as:

| Case                      | Today                                                       |
| ------------------------- | ----------------------------------------------------------- |
| A — one membership        | the only case. Enter the company directly.                  |
| B — several memberships   | **not representable.** Needs the Database phase.            |
| C — no membership         | generic failure; no tenant existence is disclosed.          |
| D — subscription expired  | **not enforced** — see below.                               |
| E — suspended / locked    | account state IS enforced; `org.tenants.status` is **not**. |
| F — invitation incomplete | `invited` state exists and is enforced at login.            |

## 5. Adjacent gaps found while measuring

Recorded here because they were established by evidence during this
archaeology, and each is a Backend or Database concern, not a Frontend one.

- **Subscription state is unreachable from the API.** `org.subscription_plans`,
  `org.tenant_subscriptions`, `org.feature_flags`,
  `org.tenant_feature_overrides` and a working resolver
  `org.resolve_feature_enabled` all exist in the database. No file under
  `apps/` references any of them. A feature-flag entitlement middleware is
  wired into the route pipeline but **zero operations declare a flag**, so it
  never executes. Subscription enforcement is therefore not merely absent from
  the Frontend — it is absent everywhere.
- **`org.tenants.status`** (`provisioning | active | suspended | closed`) is
  enforced nowhere; the column's own comment defers it to a future session
  layer. A suspended tenant can still sign in.
- **The session response carries no human-readable organisation name** — only
  `tenantId`. Any company selector or "you are signed in to X" needs one.
- **`companyIds: []` is ambiguous**: it means both "tenant-wide, unrestricted"
  and "scoped to no companies at all".
- **No money anywhere.** No price, currency, seat count, billing period or
  payment instrument on any plan or subscription table. The `sal` schema's
  invoices are the garage's customer billing, not the tenant's SaaS bill.

## 6. Frontend work — **applied**

Written against the contract above and applied once the Backend change was
merged. Status against the original list:

1. **Done.** The `tenantId` field, its label, its hint and its UUID validation
   are gone from `LoginForm` and `credentials.ts`. `loginSchema.shape` is now
   exactly `['email', 'password']`, asserted on the shape rather than on one
   rejected value — a field returning under a different name would still be a
   UUID on the sign-in form.
2. **Done.** The Server Action sends `{ email, password }`.
3. **Done in effect.** Nothing writes or reads `rootlco.tenantHint`. The
   `readTenantHint` / `writeTenantHint` helpers remain in
   `lib/api/session-cookie.ts` with no caller — see the carried item below.
4. **Done.** `auth.login.tenantId`, `auth.login.tenantIdHint` and
   `auth.login.error.tenantId` are retired; `auth.login.description` no longer
   says "workspace details". Both catalogues 544 → 543 keys.
5. **Partly done.** The password visibility toggle is in, defaulting to hidden,
   carrying `aria-pressed`, and keeping `autoComplete="current-password"` in both
   modes so a password manager still fills the form. Distinct locked /
   invitation-pending states are **not** in, and cannot be: the Backend answers
   every one of those with the same `ERR-IAM-002`, deliberately, and publishing
   the difference to an unauthenticated screen would undo the non-enumeration
   property the whole endpoint is built around. That item was wrong as written
   and is withdrawn rather than carried.

**Carried.** `readTenantHint` / `writeTenantHint` are now unused exports. They
were left in place because that file was being edited concurrently by separate
in-flight work, and editing another change's working tree is how two correct
changes become one broken one. Removing them is a follow-up.

### Verified in the real browser

`auth-setup` signs in the way an operator does — no tenant, real Chrome, real
Server Action, real API, real Supabase — and asserts the Workspace field is
absent so the suite fails if it ever returns:

```
97 passed (2.2m)   authenticated-en · authenticated-ar · authenticated-tablet
```

That run also re-proved the eleven administration screens, cross-tenant
isolation, and that no token reaches browser storage.

## 7. What was actually built, and where it differs from section 3

Merged on the Backend remediation branch, under the `backend-login-contract`
ownership profile. `apps/web`, `supabase/` and every migration are forbidden by
that profile and unchanged by the branch.

### The resolution, and why it is sound

The tenant comes from the identity provider, because nothing else can supply it:

```
sel_user_accounts_tenant  SELECT  {app_readonly,app_runtime}
  USING (tenant_id = iam.current_tenant_id())
```

A lookup that does not yet know its tenant is refused by that policy, and there
are zero `SECURITY DEFINER` routines to sidestep it. The provider is therefore
RootLco's only tenant-agnostic directory — not a preference, the only option.

Two properties make it trustworthy rather than merely convenient:
`app_metadata.tenant_id` is service-role-only and not editable by the end user
(ADR-019 §3), and `uq_user_accounts_provider_identity_active` is unique on
`(identity_provider, provider_subject)` with **no tenant in the key**, so a
verified subject resolves to exactly one account and therefore one tenant.

### Three things section 3 did not anticipate

**1. Dropping `tenantId` would have silently disabled failure auditing.** When
the provider refuses a password there is no session, so there is no binding, so
there is no tenant, so there is no context — and `iam.login_audit` cannot be
written. Wrong-password attempts would have stopped being recorded, taking the
security-event threshold with them, with every test still green.

Fixed by adding a **twelfth provider capability**, `findByEmail`, reached only on
the failure path. It is used solely to attribute an attempt for audit; its result
never reaches the caller, and a directory outage is swallowed because the verdict
is already failure. Section 3 listed "audit event" as a deliverable without
noticing it was the hard part.

**2. Section 3's ordering requirement was not satisfiable as written.** It says
account state "must stay enforced ahead of any tenant resolution". It cannot be:
the account cannot be read until a tenant scopes the read. The invariant that
actually matters — that `invited | locked | archived` are enforced and are
indistinguishable from a wrong password — holds, and is covered by test. The
sequencing clause was wrong and is corrected here rather than quietly ignored.

**3. There was no OpenAPI change to make.** `docs/api/openapi.v1.json` records
operations from the operation registry — id, summary, security, responses,
`x-*` extensions — and carries no request-body schema for `iam.auth-login`. The
"OpenAPI entry" deliverable had nothing to write, which is a fact about the
artifact, not an omission.

### Verified

Against the real Supabase provider through the running API:

```
email + password ONLY          200  tenant=c0000000-0000-4000-8000-00000000000a
correct tenantId supplied      200  tenant=c0000000-0000-4000-8000-00000000000a
WRONG tenantId supplied        401  Authentication required
wrong password, no tenantId    401  Authentication required
unknown address, no tenantId   401  Authentication required
malformed tenantId             422  body.tenantId:invalid_format
```

Against the deterministic double, covering what the live probe cannot reach
safely: cross-tenant resolution, the tenantless failure-audit row, an identity
with no binding, and message uniformity across tenant-bearing and tenantless
failures.

Two findings came out of proving it: `P1-26-F-067` (the first implementation
reintroduced the short-circuit oracle its own file header forbids) and
`P1-26-F-066` (the endpoint's enumeration defence is the rate limit, not latency
uniformity — the provider's own sign-in is 7.8× faster for an unknown address).
