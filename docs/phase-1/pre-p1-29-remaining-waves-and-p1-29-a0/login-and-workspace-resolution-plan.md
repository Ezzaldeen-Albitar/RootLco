# Multi-tenant login and workspace resolution — current truth and required contracts

**The permanent product rules this design may never breach** (`scope.md` §4):

- **P-2** — login is **email and password only**. No workspace UUID, no company UUID, no tenant
  selector, no subdomain.
- **P-1** — no normal employee ever types an organisational identifier.
- **P-3** — the Backend resolves memberships. The browser asserts nothing.

**This document specifies no frontend.** It records what the login path does today, and names the
backend contracts a future multi-membership resolution would need.

## The four resolution outcomes to design for

| situation                     | required outcome                                                         |
| ----------------------------- | ------------------------------------------------------------------------ |
| exactly one active membership | enter directly, no prompt                                                |
| several memberships           | a human-friendly **workspace chooser** — names, never identifiers        |
| arriving by invitation        | the invitation resolves the intended tenant and membership               |
| subscription blocked          | data preserved, application usage blocked, and the blocked state visible |

## Two shipped facts that contradict the product rules today

**A suspended or closed tenant signs in exactly like an active one.** Nothing anywhere reads
`org.tenants.status` during authentication, although the column's own `COMMENT` says it is
"queryable by the future session layer … to refuse suspended/closed tenants". Recorded as
`AMB-46` / `AMB-58`.

**`BranchTargetFields` already asks a human for a raw identifier.** Its select labels _are_ the
UUIDs, and for an unrestricted operator it degrades to a free-text UUID field, with shipped copy in
both locales telling the operator to type one. That is a direct, shipped breach of P-1, and no
document assigns anyone to fix it. Recorded as `AMB-48` / `AMB-39`.

---

### Login request shape (HTTP contract)

**EXISTS AND LOAD-BEARING.**

POST /api/v1/auth/login. Three fields, one of them optional. `tenantId` is documented at :31-40 as "a lookup key, never a grant", kept only so pre-existing callers keep working. The route is `public: true` with a mandatory `publicReason` (:52-55) and `rateLimitPolicy: 'auth-adjacent'` (:57), keyed by operation and client IP resolved under the trusted-proxy policy (:64). This is the ONLY route file under `apps/api/src/app` that accepts a `tenantId` in a request body — a repo-wide grep of `apps/api/src/app` for `tenantId` returns this line plus eight docblock mentions and no other field.

_Evidence:_ apps/api/src/app/api/v1/auth/login/route.ts:30-44 — `const LoginBody = z.object({ tenantId: schemas.uuid.optional(), email: z.string().min(3).max(320), password: z.string().min(1).max(200) })`; POST at :61-73 passes `body` straight into `iamModule().authentication.login(...)`

### Login response shape — what a successful login returns

**EXISTS AND LOAD-BEARING.**

HTTP 200 with the object verbatim — there is no envelope: `{ accessToken: string, refreshToken: string | null, expiresAt: string (ISO), user: { id, email, displayName, tenantId } }`. Response headers are set by `successHeaders` (route-handler.ts:126-135): `Content-Type: application/json`, `x-correlation-id`, `Cache-Control: no-store, private`. The route docblock (:15-18) states the thinness is deliberate: no permissions, no scope, no tenant metadata — a client that wants those calls `GET /api/v1/auth/session`. Note `user.tenantId` IS returned, so the tenant is disclosed post-authentication even though it is never asked for.

_Evidence:_ apps/api/src/modules/iam/application/authentication-service.ts:123-133 (`LoginResult`) and :302-313 (the return); apps/api/src/server/http/route-handler.ts:395-399 serialises it as `JSON.stringify(result.body)` with `status: result.status ?? 200`

### The single authority for the session cookie

**EXISTS AND LOAD-BEARING.**

`apps/web/src/lib/api/session-cookie.ts` is the single authority — it is the only file in the web source that touches the cookie store for the session, and the only place the name and attributes are written down. Attributes: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, and `secure: appEnv !== 'local'` — fail-closed, only the exact string `local` disables `secure` (:60-71, finding P1-26-F-023). Value = the access token; `expires` = the backend's own `expiresAt` (:97-101). Three consumers only: `writeSession` from the login Server Action (features/authentication/actions/login.ts:94), `clearSession` from the sign-out action (actions/logout.ts:34) and from the session-ended Route Handler (app/[locale]/(auth)/session-ended/route.ts:31), and `readSessionToken` from `server-client.ts:38`. The docblock at :26-36 states what is deliberately NOT in it: no refresh token (there is no `/auth/refresh` in the route tree) and no tenant, company, branch, permission set or display name.

_Evidence:_ apps/web/src/lib/api/session-cookie.ts:40 `export const SESSION_COOKIE = 'rootlco.session'`; :56-74 `sessionCookieAttributes`; :91-102 `writeSession`; :117-120 `clearSession`. A grep of `apps/web/src` for `cookies()` returns only lines 78, 96 and 118 of this same file

### The API sets no cookie — the whole backend is bearer-only

**EXISTS AND LOAD-BEARING.**

The cookie is purely a web-tier construct. The bearer-authenticator's docblock (:7-17) records the reason: no ambient credential means CSRF is out of the threat model by construction, and it explicitly defers the browser-cookie design to "the phase that introduces a browser client". The web tier then reintroduced a cookie — as a transport for the bearer token only, never presented to the API as a cookie.

_Evidence:_ grep -rni 'set-cookie|cookies()' apps/api/src returns exactly one hit, apps/api/src/lib/supabase/server.ts:18, and nothing in the request pipeline; apps/api/src/modules/iam/auth/bearer-authenticator.ts:43,49-52 reads `authorization` and matches `/^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/`

### A second, dormant cookie mechanism in the API

**EXISTS BUT NOT USED.**

A Phase 1-1 scaffold leftover. It can read and write arbitrary cookies on an API response and is called by nobody. It is not part of the login path today, but it is a live second mechanism sitting in the same tree as the one that is.

_Evidence:_ apps/api/src/lib/supabase/server.ts:16-36 — `createClient()` builds a `createServerClient` with `getAll`/`setAll` over `next/headers` `cookies()`; `grep -rn 'lib/supabase/server' apps/api/src` returns zero importers

### Tenant resolution at login — the exact step order

**EXISTS AND LOAD-BEARING.**

Step by step. (1) :188-193 if `tenantId` was supplied and is not a UUID, fail with the uniform `ERR-IAM-002`. (2) :198 the provider is ALWAYS asked first — `provider.authenticate(email, password)` — before any local lookup, so a failure's latency cannot reveal whether the address is known. (3) :210 `resolveTenant`: :342 `bound = session ? session.tenantId : await this.directoryTenant(email)` — i.e. on success the tenant comes from the verified session's `app_metadata.tenant_id`; on a credential refusal it comes from a directory lookup by address, purely so the failure can still be audited against an account. (4) :344-349 if `bound` is a UUID and the caller also named a tenant, they must agree or the attempt resolves to null; otherwise return `bound`. (5) :355 if the identity carries NO binding, fall back to `input.tenantId ?? null`. (6) :220-224 the transaction runs against `resolved ?? UNRESOLVED_TENANT` (`00000000-0000-4000-8000-000000000000`, a UUID no tenant holds) — deliberately not an early return, so an unresolvable attempt does the same work. (7) :227 `set_config('app.user_id','')`, then :228 `identities.findByEmail(db, provider.name, email)` scoped to the resolved tenant. (8) :242-251 the account's `provider_subject` must equal the subject the provider just verified, and `session.tenantId` (if present) must equal `account.tenantId`. (9) :252 `account.status` must be `active`. (10) :260-273 insert `iam.user_sessions` row + success `iam.login_audit` row. Every denial answers the identical `ERR-IAM-002` 'Authentication failed' (:85-87); the distinguishing reason goes to the log only (:428-442).

_Evidence:_ apps/api/src/modules/iam/application/authentication-service.ts:185-314 (`login`), :338-356 (`resolveTenant`), :375-382 (`directoryTenant`), :82 (`UNRESOLVED_TENANT`), :226-236 and :242-258 (the transaction)

### Tenant resolution on every AUTHENTICATED request

**EXISTS AND LOAD-BEARING.**

The token's `app_metadata.tenant_id` claim becomes `PrincipalClaims.tenantId` (bearer-authenticator.ts:95); a token with NO tenant binding is refused outright (:82-90, fail closed rather than guess). `resolveRequestContext` then: validates the claim is a UUID or throws ERR-IAM-002 (:250-254); builds a bootstrap context carrying the tenant in BOTH slots purely to satisfy the builder's UUID contract (:259-264); opens a READ ONLY transaction, blanks `app.user_id` (:273) and runs `resolveScopeFor`, whose account query (:61-70) filters ONLY on `identity_provider`, `provider_subject`, `status='active'`, `deleted_at IS NULL` — the tenant containment is RLS `sel_user_accounts_tenant` (`USING (tenant_id = iam.current_tenant_id())`, supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:335-337). A session claiming a tenant its account does not live in therefore sees zero rows and gets ERR-IAM-002 (:292-296). Scope comes from `iam.role_grants`/`iam.grant_scopes` (:74-91); `unrestricted` collapses both lists to empty (:99-103). Session liveness (revoked / hard-expired / idle-expired) is then read in the same transaction using the DATABASE clock (:169-203) and denied uniformly (:302-304).

_Evidence:_ apps/api/src/modules/iam/auth/bearer-authenticator.ts:78-101; apps/api/src/server/context/resolve-context.ts:249-322, with the account read at :57-105

### Exact session payload returned by GET /auth/session

**EXISTS AND LOAD-BEARING.**

`{ userId: string, tenantId: string, email: string, displayName: string, companyIds: string[], branchIds: string[], permissions: string[] }` — seven fields, no envelope, HTTP 200. `userId/tenantId/email/displayName` come from `identities.findById` under the resolved context (:525); `companyIds`/`branchIds` come from the RESOLVED context, not from the account row (:539-540); `permissions` is `effectivePermissionsOfCaller` sorted for determinism (:533,:543) — implemented as `SELECT p.permission_code FROM iam.permissions p WHERE iam.has_permission(p.permission_code)` (authorization-repository.ts:140-148). The operation requires `iam.user.read` (route.ts:31) — an authenticated account lacking it gets 403, which the web tier maps to a distinct `forbidden` state that KEEPS the cookie (features/authentication/api/session.ts:57-75, finding P1-26-F-022). If the context resolves but the row is invisible under RLS, it throws `ERR-CTX-001` rather than describing an unconfirmable session (:527-532). Empty `companyIds`/`branchIds` means UNRESTRICTED within the tenant, not "no access" (types/session.ts:11-18, `isUnrestrictedScope` at :62-64). The web tier structurally re-validates all seven fields before trusting the response (api/session.ts:119-131). This shape matches the frozen P1-29 set verbatim (p1-29-prep .../blocker-register.md:96-97, contract-archaeology.md:214-215, information-architecture.md:189).

_Evidence:_ apps/api/src/modules/iam/application/authentication-service.ts:135-143 (`SessionSummary`) and :523-545 (`describeSession`); route apps/api/src/app/api/v1/auth/session/route.ts:25-41; web mirror apps/web/src/features/authentication/types/session.ts:20-28

### OpenAPI payload contract for login and session

**MISSING CONTRACT.**

The published contract describes neither the login request body nor either response body. `x-required-permissions`, `x-scope`, `x-audit-class`, `x-rate-limit-policy` and `x-cache-category` are all present, so the operation METADATA is contracted and the PAYLOADS are not. This is the same class the P1-29 preparation recorded (OpenAPI carries zero payload contracts). Any workspace-resolution design that adds fields to the session payload has no contract artefact to change — the only machine-readable definitions are the TypeScript interfaces and the web tier's hand-written `isSessionShape` guard.

_Evidence:_ docs/api/openapi.v1.json — `/api/v1/auth/login` POST has NO `requestBody` key at all, and its 200 content schema is `{"type": "object"}`; `/api/v1/auth/session` GET 200 content schema is likewise `{"type": "object"}`

### Workspace / company / tenant selector anywhere in apps/web

**MISSING.**

ZERO. There is no tenant, workspace, company or organisation selector, switcher or picker in the web application. The only switcher in the shell is the language switcher. The tenant appears in exactly one place in the UI — the profile page prints the raw UUID under the label "Workspace" (`apps/web/src/app/[locale]/(dashboard)/profile/page.tsx:88-89`, `value={session.tenantId}`).

_Evidence:_ Eighteen spellings searched over `apps/web/src` (`.ts`, `.tsx`, `.json`): `TenantSelector` 0, `CompanySelector` 0, `CompanyPicker` 0, `CompanySwitcher` 0, `OrgSwitcher` 0, `OrganizationSwitcher` 0, `OrganisationSwitcher` 0, `tenant-selector` 0, `company-selector` 0, `workspace-selector` 0, `switchTenant` 0, `tenantSwitch` 0, `activeTenant` 0, `selectedTenant` 0, `activeCompany` 0, `currentCompany` 0, `selectedCompany` 0. `workspace` returns 30 hits, all prose or i18n labels (it is the customer-facing WORD for tenant, e.g. `apps/web/src/i18n/messages/en.json:35 "admin.scope.tenant": "Workspace"`). `grep -rni switcher src` returns one component, `apps/web/src/components/shell/LocaleSwitcher.tsx`, plus one comment. `apps/web/src/components/shell/` contains only AppShell, LocaleSwitcher, PageHeader, Sidebar, use-scroll-restoration

### BranchTargetFields — the only company/branch chooser that exists, and it violates P-1

**EXISTS AND LOAD-BEARING.**

Not a workspace selector — it names WHICH branch's calendar an appointment read or booking targets, because `GET /appointments` and `POST /appointments` both require `companyId` and `branchId` as an authorization target. Two facts matter for the future design. First, the option LABEL is the UUID itself, because the platform publishes no company or branch directory (the docblock at :18-24 cites the same contract gap the approval-limits screen records, `admin.contractGap.noDirectory`). Second, for an UNRESTRICTED operator — whose resolved lists are empty — it degrades to a free-text field in which a human types a company or branch UUID. That is the P-1 prohibition happening in shipped code today, and it is the direct consequence of G-5/G-12: identifiers with no names.

_Evidence:_ apps/web/src/features/appointments/components/BranchTargetFields.tsx:64-78 — `options={ids.map((id) => ({ value: id, label: id }))}`; :79-91 — when `ids.length === 0` it renders a `TextField` described by `admin.scope.noneResolved`, which reads "Your session resolves to no specific company or branch, so enter the reference you want to work on." (apps/web/src/i18n/messages/en.json:32)

### Orphan translation keys for a company/branch chooser

**EXISTS BUT NOT USED.**

Both locales carry chooser copy that no component renders. Evidence that a named chooser was anticipated and never built — useful as a starting point, but today it is unreferenced string data, not a control.

_Evidence:_ apps/web/src/i18n/messages/en.json:33-34 `"admin.scope.pickBranch": "Choose a branch"`, `"admin.scope.pickCompany": "Choose a company"`; same pair in ar.json:33-34. `grep -rn 'scope.pick|pickCompany|pickBranch' apps/web/src apps/web/tests` returns only those four catalogue lines

### Does the login path accept a tenant hint / workspace id / company id?

**EXISTS AND LOAD-BEARING.**

The BACKEND still accepts an optional `tenantId`; the WEB TIER never sends one and has no field for it. `credentials.ts:34-51` records why: reintroducing the field would mean either hard-coding a tenant or shipping a tenant directory to an unauthenticated page, which is an enumeration oracle at the door. When supplied, `tenantId` is not steering — `resolveTenant` (authentication-service.ts:348) refuses the attempt if it disagrees with the binding the provider reports, so it can only confirm, never redirect. Its one live effect is the fallback at :355: an identity with NO `app_metadata.tenant_id` can only log in if the caller names the tenant explicitly.

_Evidence:_ API side: apps/api/src/app/api/v1/auth/login/route.ts:41 `tenantId: schemas.uuid.optional()`. Web side: apps/web/src/features/authentication/schemas/credentials.ts:53-66 (two fields, email + password) and apps/web/src/features/authentication/actions/login.ts:64 `anonymousClient().send('POST', LOGIN_PATH, parsed.data)` where `parsed.data` is `{email, password}`. Form: apps/web/src/features/authentication/components/LoginForm.tsx:52 (hidden `locale`), :64-65 (`email`), :90 (`password`)

### No tenant hint by subdomain, host, or header

**MISSING.**

There is no subdomain-based, Host-header-based or custom-header tenant hint anywhere in either tier. The only inputs that can influence tenant selection are the verified provider identity and the optional body field.

_Evidence:_ `grep -rni 'subdomain|x-tenant|host header' apps/api/src apps/web/src` returns one hit, a prose comment at apps/web/src/features/authentication/api/session-ended.ts:40. `grep -rni "headers.get(" apps/api/src` filtered of authorization/correlation/user-agent/content-type/idempotency/forwarded/if-match/accept/origin returns only concurrency.ts:29 (If-Match) and route-handler.ts:199 (causation id)

### G-16 tenant-hint helpers — all three, and their current state

**MISSING.**

Named as asked, and CONFIRMED to have no callers — but the stronger fact is that they no longer exist to call. scope.md G-16 (docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:61) says they are "still declared" at `apps/web/src/lib/api/session-cookie.ts:43,:87,:123`, and §9 / :192-196 says the removal sits on the unmerged local branch `feature/pre-p1-29-web-coverage-and-tenant-hint`. Both statements were true when scope.md was written (`5a8df206`, 2026-08-22) and are FALSE at `c081a019`: the branch merged the same day as PR #257. `session-cookie.ts` is now 120 lines and its docblock claim "No tenant, company, branch, permission set or display name" (:34) is true. Wave D's stated job of landing the deletion is already done.

_Evidence:_ The three are `TENANT_HINT_COOKIE`, `readTenantHint`, `writeTenantHint`. At `c081a019`: `TENANT_HINT_COOKIE` 0 hits in apps/api/src, apps/web/src, apps/web/tests; `readTenantHint` 0/0/1; `writeTenantHint` 0/0/2 — and all three surviving test hits are inside COMMENTS (apps/web/tests/lib-coverage.dom.test.tsx:14-15, apps/web/tests/p1-27-security.test.ts:438). `git show d502e07f -- apps/web/src/lib/api/session-cookie.ts` shows the deletion of `TENANT_HINT_COOKIE` (was :43, value `'rootlco.tenantHint'`), `readTenantHint` (was :87) and `writeTenantHint` (was :123, `httpOnly: false`, `maxAge: 60*60*24*180`). `git merge-base --is-ancestor d502e07f HEAD` → YES; the merge that carried it is PR #257 (`741388c5`)

### An identity matching more than one tenant

**MISSING.**

IMPOSSIBLE BY CONSTRAINT, not undefined and not handled. One live external identity resolves to exactly one non-deleted account platform-wide, therefore to exactly one tenant. The asymmetry is deliberate: EMAIL uniqueness is per-tenant (so the same address may exist in two tenants) while IDENTITY uniqueness is global. The code assumes this rather than defending it — `resolveScopeFor` (resolve-context.ts:61-70) uses `LIMIT 1` with no `ORDER BY` and no tenant predicate, which is safe only because the index guarantees at most one row. The moment a membership model relaxes that index, `LIMIT 1` becomes a silent arbitrary pick. There is no ambiguity path, no error branch and no test hook for "two tenants matched" anywhere in the login or context code.

_Evidence:_ supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:107-108 `CREATE UNIQUE INDEX uq_user_accounts_tenant_email_active ON iam.user_accounts (tenant_id, email) WHERE deleted_at IS NULL;` vs :109-110 `CREATE UNIQUE INDEX uq_user_accounts_provider_identity_active ON iam.user_accounts (identity_provider, provider_subject) WHERE deleted_at IS NULL;` — the second carries NO tenant. Cited as the mechanism at authentication-service.ts:330-332 and as G-10 in scope.md:55

### Login resolves the account by EMAIL; every other path resolves it by SUBJECT

**EXISTS AND LOAD-BEARING.**

An asymmetry worth naming before a membership design touches it. Login is the ONE path keyed by address-within-a-resolved-tenant; it is made safe only by the explicit subject-equality check at authentication-service.ts:242-247, which denies `subject-mismatch` when the tenant's account for that address holds a different provider identity. If a future design lets one identity reach several tenants, this email-keyed lookup becomes ambiguous in exactly the way the subject-keyed lookups do not.

_Evidence:_ Login: authentication-service.ts:228 → identity-repository.ts:187-208 `findByEmail(...)` `WHERE tenant_id = $1 AND identity_provider = $2 AND email = $3`. Logout: authentication-service.ts:477-481 → identity-repository.ts:165-180 `findByProviderSubject(...)`. Request context: resolve-context.ts:61-70, by `(identity_provider, provider_subject)`. Session read: identity-repository.ts:210-220, by id

### An identity with no app_metadata.tenant_id cannot sign in

**EXISTS AND LOAD-BEARING.**

The binding is written in a SECOND admin call after `inviteUserByEmail`, deliberately into `app_metadata` (service-role only) rather than `data`, which GoTrue routes to the user-editable `user_metadata` (:355-357). An identity created outside the invite flow therefore has no binding, resolves to `UNRESOLVED_TENANT` and is denied with the generic failure — unless the caller supplies `tenantId` in the body. The same rule is enforced independently on the bearer path: a token with no tenant claim is refused (bearer-authenticator.ts:82-90).

_Evidence:_ authentication-service.ts:342,:355 (`bound` null → `return input.tenantId ?? null`), :220-224 (null → `UNRESOLVED_TENANT`), :233 (`no-account`); apps/api/src/modules/iam/provider/supabase-provider.ts:143 `tenantId: typeof metadata.tenant_id === 'string' ? metadata.tenant_id : null`; the binding is written service-role-only at :356-370

### Invitation path (administrator side)

**EXISTS AND LOAD-BEARING.**

Three operations, no invitation table — `invitation-service.ts:3-33` records that the token belongs to the provider and the state is `iam.user_accounts.status` (`invited → active | archived`). `invite` takes the tenant from the resolved context and never from the request (:96-98,:138), checks delegation before touching the provider (:108-122), refuses a duplicate address in the tenant (:124-132), and writes an `invited` account plus optional grants. `POST /iam/invitations/{userId}/activation` requires `iam.user.manage`, `auditClass: 'security'`, `idempotent: true` (activation route :33-39).

_Evidence:_ apps/api/src/app/api/v1/iam/invitations/route.ts and .../invitations/[userId]/route.ts and .../invitations/[userId]/activation/route.ts; service at apps/api/src/modules/iam/application/invitation-service.ts:100-198 (`invite`) and :281-338 (`activate`); web callers at apps/web/src/features/administration/users/actions.ts:65, :96, :108

### What the activate-account page actually resolves

**EXISTS AND LOAD-BEARING.**

It resolves a PASSWORD, and nothing else. The page does not activate the account and says so (:12-28): it calls the same public operation the reset flow calls, sends `{token, password}` (no email, no tenant, no user id, and `confirmPassword` is client-only, credentials.ts:98-110), and shows a confirmation that an administrator completes activation. Activation itself is `invitation-service.activate` (:281-338), which re-asks the provider and refuses on `!identity.confirmed` (:297-302) or `identity.disabled` (:303-308) before `changeStatus(...,'active',...)`. Nothing in this flow selects, confirms or even mentions a tenant — the tenant was fixed at invite time by the inviter's own session.

_Evidence:_ apps/web/src/app/[locale]/(auth)/activate-account/page.tsx:30-58 renders `RecoveryTokenBridge` → `SetPasswordForm` (imports at RecoveryTokenBridge.tsx:8, SetPasswordForm.tsx:10) → `completePasswordResetAction`, which posts to `/api/v1/auth/password-reset/completion` (actions/password-reset.ts:38,:93-96). Token source: api/recovery-token.ts:30 `TOKEN_PARAMS = ['token','access_token','code']`, shape-checked only at :43-45

### Where the invitation and activation links point

**UNKNOWN.**

The destination of an invitation mail is entirely deployment configuration that is not present in the repository. With the shipped default (empty string) `invite` and `requestPasswordReset` both fail with ERR-SYS-001 before the provider is called. So the repository cannot show that an invitee ever lands on `/{locale}/activate-account`; that is an operator setting nothing in the tree records. What IS in the tree: exact-match only, no prefix matching, empty list permits nothing.

_Evidence:_ apps/api/src/server/config/backend-config.ts:135 `AUTH_REDIRECT_ALLOWLIST: z.string().default('')`; apps/api/src/modules/iam/domain/credential-policy.ts:36-44 throws `ERR-SYS-001` when the list is empty and returns `allowList[0]` when the caller supplies nothing; the web invite action sends no `redirectTo` (features/administration/users/actions.ts:65) and neither does the reset action (actions/password-reset.ts:30-34). `AUTH_REDIRECT_ALLOWLIST` appears in NO `.env.example` (searched `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`)

### org.tenants.status during authentication

**MISSING.**

NOTHING reads tenant status during authentication. A `provisioning`, `suspended` or `closed` tenant behaves exactly like an `active` one: the provider verifies the credential, `resolveTenant` returns the binding, the account row is found, `status='active'` on the ACCOUNT is checked, a session row is inserted and a token is returned. The same holds per-request — `resolveRequestContext` never reads the tenant row. The only lifecycle gate that exists is per-ACCOUNT (`invited|locked|archived` denied at authentication-service.ts:252-258). The column and its transition function exist and are enforced (`ck_tenants_status` at migration :104-105, `org.change_tenant_status` at :172-229, append-only history), and no application role holds UPDATE — so status can be set, and then read by nothing that would act on it.

_Evidence:_ `grep -rn 'org\.tenants' apps/api/src` returns four hits: authentication-service.ts:80 (a comment about the unresolved-tenant UUID), organization-repository.ts:7,58,88 (the admin settings read/update), meta-repository.ts:46 (a scope self-check selecting only `t.id`), request-context.ts:27 (a comment). None of them is on the login, bearer, or context-resolution path. `sel_tenants_self` (supabase/migrations/20260717101000_org_tenants.sql:245-247) is `USING (id = iam.current_tenant_id())` — no status predicate. `iam.has_permission` (supabase/migrations/20260718097000_iam_context_and_permission_functions.sql:85-97) checks `iam.user_accounts.status = 'active'` and never touches `org.tenants`

### Tenant status is readable, but only after authentication and authorization

**EXISTS AND LOAD-BEARING.**

The status value is reachable — as an administration read, gated on a permission a caller can only hold once already signed in to that very tenant. It is structurally unavailable at the point a login decision is made, and any future 'refuse a suspended tenant' check cannot reuse this path: at login there is no context, no permission and no session under which `sel_tenants_self` would return a row.

_Evidence:_ apps/api/src/modules/iam/data/organization-repository.ts:45-73 selects `status` from `org.tenants`; surfaced by `GET /org/tenant` which requires `org.tenant.read` (apps/api/src/app/api/v1/org/tenant/route.ts:35-46); `status` is deliberately excluded from the update surface (organization-settings-service.ts:110-114)

### Web-tier consumption of the session (who depends on the shape)

**EXISTS AND LOAD-BEARING.**

Every protected page resolves the session SERVER-SIDE before rendering, so there is no protected-content flash and no client-held session object. Four outcomes drive four different behaviours: `signed-out` (no cookie), `expired` (401 → routed through the session-ended Route Handler, the only path that clears the cookie), `forbidden` (403 → cookie KEPT), `unavailable` (:104-107). A multi-membership design that adds a chosen workspace to the session payload has 30 render-time consumers and one shape-guard (`isSessionShape`, :119-131) that will reject an unrecognised response as `unavailable`.

_Evidence:_ apps/web/src/features/authentication/api/session.ts:35-78 (`readSession`), :101-108 (`requireSession`); 30 call sites of `requireSession(locale)` across `apps/web/src`, including the dashboard layout at apps/web/src/app/[locale]/(dashboard)/layout.tsx:43, which passes `capabilities={{ permissions: session.permissions }}` at :50

---

## Unknowns — what could not be settled, and what would settle it

- Whether the identity provider can hold two identities with the SAME email address. The database permits two accounts with one address in two tenants (`uq_user_accounts_tenant_email_active` is `(tenant_id, email)`), and each would need its own provider subject. If GoTrue enforces one identity per email per project, that state is unreachable; if not, `provider.authenticate(email, password)` becomes non-deterministic about which tenant answers. Settled by: reading the deployed GoTrue configuration, or an integration test that attempts a second `inviteUserByEmail` for an address already invited into another tenant and records the outcome.
- What `AUTH_REDIRECT_ALLOWLIST` is set to in any deployed environment, and therefore whether an invitation link actually lands on `/{locale}/activate-account`. It defaults to the empty string (backend-config.ts:135), which makes `invite` throw ERR-SYS-001, and it appears in none of the three `.env.example` files. Settled by: the deployment's environment configuration, or adding the variable to `apps/api/.env.example` with the intended value.
- Whether any test asserts the CURRENT behaviour for a suspended or closed tenant at login — i.e. whether 'a suspended tenant still signs in' is a known accepted state or simply untested. Settled by: running the DB/RLS and API suites with a tenant moved to `suspended` via `org.change_tenant_status` and observing whether any case fails, or grepping the P1-14 evidence documents for a tenant-status authentication case.
- Whether `iam.user_sessions` rows survive a tenant status change or an account status change — i.e. whether an already-issued session keeps working after the tenant is suspended. `resolveRequestContext` reads only revocation and expiry (resolve-context.ts:302-304); `iam.has_permission` re-checks the ACCOUNT status on every permission test but nothing re-checks the tenant. Settled by: a live test that suspends a tenant mid-session and replays a request with the existing bearer token.
- Whether the two orphan navigation permission codes recorded as G-14 (`sal.invoice.read`, `sal.delivery.read`) have any analogue in the session/login path — i.e. whether any permission the session publishes is likewise absent from the catalogue and therefore permanently unholdable. Settled by: diffing every code in `apps/web/src/config/navigation.ts` and every code referenced by an operation against `supabase/seeds/04_iam_permission_catalog.sql`.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- scope.md G-16 (docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:61) and §9 (:192-196) both assert that the three tenant-hint helpers are still declared in `apps/web/src/lib/api/session-cookie.ts:43,:87,:123` and that the removal sits on an unmerged local branch. At `c081a019` the file is 120 lines and declares none of them: `d502e07f` IS an ancestor, merged as PR #257 on the same day scope.md was written (`5a8df206`). Both documents are internally consistent and one of them is out of date; I am reporting the tree, not resolving which document should be amended.
- supabase/migrations/20260717101000_org_tenants.sql:117 states in a COMMENT ON COLUMN that `org.tenants.status` is 'Queryable by the future session layer (Phase 1-4) to refuse suspended/closed tenants.' Phase 1-4 and Phase 1-14 both shipped and no such query exists. The comment reads as a live plan; nothing in the docs records the intent as dropped, deferred or reassigned to a later phase. It is genuinely unclear whether the absence is an accepted decision or an unclosed obligation.
- The login operation is published with `x-scope: tenant` in docs/api/openapi.v1.json while also carrying `security: []` and `public: true`. This comes from the registry default (`scope: declaration.scope ?? 'tenant'`, apps/api/src/server/auth/operation-registry.ts:185) rather than from a declaration in the route, so the published contract asserts a scope requirement for an operation that by definition has no scope to resolve. Harmless today; misleading to a reader building a scope-driven design from the contract.
- `admin.scope.noneResolved` ('…so enter the reference you want to work on.') is shipped copy in both locales that instructs an operator to type a company or branch UUID, while P-1 forbids exactly that. The docs treat P-1 as binding and treat the missing-directory gap (G-5) as wave C's obligation, but no document states whether the existing free-text fallback is an accepted temporary breach or a defect.
