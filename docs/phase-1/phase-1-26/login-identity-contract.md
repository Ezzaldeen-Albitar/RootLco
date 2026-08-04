# Email-only sign-in — contract specification and integration finding

**Classification:** Confidential — Commercial Product and Pilot Planning
**Status:** SPECIFIED, NOT IMPLEMENTED. Blocks the Owner-acceptance checklist
item "the Login screen does not ask for a Workspace UUID".

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

## 6. Frontend work that is ready and waiting

Written against the contract above, to be applied on the P1-26 branch once the
Backend change is merged:

1. Remove the `tenantId` field, its label, its hint and its UUID validation from
   `LoginForm` and `credentials.ts`.
2. Stop sending `tenantId` from the login Server Action.
3. Retire the `rootlco.tenantHint` cookie — it exists only to prefill the field.
4. Keep the catalogue keys but retire `auth.login.tenantId*` and
   `auth.login.error.tenantId`; replace the description with one that no longer
   says "workspace details".
5. Add the deferred usability controls the same pass: password visibility
   toggle, and distinct states for locked / invitation-pending once the Backend
   publishes them.

None of this is speculative UI: each line has a Backend fact behind it.
