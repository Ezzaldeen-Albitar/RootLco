# PRE-P1-29 — architecture decisions

**Classification:** Confidential — Commercial Product and Pilot Planning

## What this document is

This is the single canonical record of the architectural decisions the PRE-P1-29 initiative makes,
and of the alternative rejected in each case. It is a decisions document, not a plan and not a task
list. Every claim it makes about the codebase carries a file path, and a line number wherever a line
number is meaningful.

Two boundaries apply throughout, and neither is negotiable inside this initiative:

- **P1-29 must not be started.** Nothing here authorises opening the P1-29 phase, creating a P1-29
  branch, or writing P1-29 deliverables. PRE-P1-29 exists so that P1-29 begins against a coherent
  administration model rather than discovering one mid-phase.
- **The Owner authorised two things on 2026-08-22**: the multi-company identity remediation, and a
  platform Superadmin bootstrap authority. The decisions below implement exactly those two
  authorisations and their consequences — no more.

Measurements in this document were taken on branch the seal-archival branch (since merged to protected `develop` as `b969894c`) at head
`4e5e20d0`, which carries 124 migrations under `supabase/migrations/`. Where a fact lives on a
different branch, the document says which branch and which commit.

## The decisions at a glance

| #           | Decision                                                                                                       | Alternative rejected                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PRE29-AD-01 | Reuse the canonical IAM as the only identity and authorisation system                                          | A second, parallel identity or administration system beside it                                                                       |
| PRE29-AD-02 | Direction of resolution is global identity → membership → tenant/company → branches → roles and grants         | Duplicating an authentication identity per tenant, and asking the operator to name a tenant at sign-in                               |
| PRE29-AD-03 | The platform Superadmin is a control-plane principal, outside every tenant                                     | Four bootstrap shortcuts: disabling delegation checks, implicit first-user superpowers, a hard-coded address, and a client-side flag |
| PRE29-AD-04 | Re-scope the administration operations that already exist                                                      | Grant the Company Owner broad tenant-wide permissions and rely on intent                                                             |
| PRE29-AD-05 | Group permissions by business domain with human wording in the role editor; the canonical code stays canonical | Renaming permission codes to be readable, or shipping a second display catalogue                                                     |
| PRE29-AD-06 | Role templates are data — a starting bundle a tenant may then change                                           | Hard-coded role names that confer authority by name                                                                                  |

---

## PRE29-AD-01 — One identity and authorisation system: the canonical IAM

### Decision

All work in this initiative extends the existing IAM. No parallel identity store, no parallel
permission catalogue, no second authorisation evaluator, and no administration surface that decides
access by any means other than the permission codes the server issues.

### Why

There is exactly one permission catalogue and it is already the single source of truth. It ships as
one statement — `supabase/seeds/04_iam_permission_catalog.sql:15` — carrying 112 permission rows
across 17 business-domain prefixes. It is the only shipping insert into the permission table:
**no migration inserts a permission**, which is verifiable by searching `supabase/` for inserts into
that table and finding the seed and nothing else. The count is pinned in CI at
`.github/ci-baselines/schema-baseline.json:14`, so a permission that silently appears or disappears
fails a gate rather than a review.

The catalogue's authority is not decorative. The permission table records, for every code, the
business domain it belongs to and a plain-English description, and the note attached to the roles
table states the governing rule directly: a role is a named bundle of permissions and confers
nothing by its name (`supabase/migrations/20260718091000_iam_roles_and_permissions.sql:105`).

The evaluation path is equally singular. Server-side authorisation is decided in
`apps/api/src/server/auth/authorization.ts`, which delegates scope resolution entirely to the
database routine rather than re-implementing it: the file header (`:1-23`) argues that
re-implementing the model in TypeScript would create a second source of truth whose drift stays
silent until it is a breach, and the `evaluatePermissions` docblock (`:67-91`) records at length
that a second scope evaluator in TypeScript was added once, was wrong, and was removed.
Client-side, the web tier evaluates for usability only and fails closed:
`apps/web/src/lib/permissions.ts:39` defines an actor with no capabilities as the default for every
unknown state, `:49` matches codes by exact membership, and `:45-47` treats a null requirement as
"this item is not gated" and explicitly not as "this actor holds everything".

### Alternative rejected

A separate organisation-administration system — its own principals, its own permission names, its
own evaluation — sitting beside IAM and covering companies, branches and departments.

Rejected because it would create a second answer to "may this person do this", and the two answers
would drift. The evidence that drift is the dominant failure mode here is already in the tree:
`apps/web/src/config/navigation.ts:297` gates a menu item on `sal.invoice.read` and `:306` on
`sal.delivery.read`, and **neither code exists in the catalogue**. The seeded codes are
`sal.finance.view` and `sal.delivery.view`. Those two menu entries are currently unreachable for
every operator alive, because a permission that does not exist cannot be held — a failure that is
invisible to any test that only checks denials. A second catalogue would multiply that class of
defect rather than contain it.

### Consequence

Any new administration capability in this initiative is expressed as: a permission code in the
canonical seed, an operation that declares it, and a grant a tenant administrator can issue. Nothing
else counts as a capability.

---

## PRE29-AD-02 — Global identity, then membership, then tenant

### Decision

Identity resolves in one direction: **global identity → membership(s) → tenant/company → branches →
roles and grants.** One active tenant per request is retained unchanged. The single difference is
that one identity may hold more than one authorised membership and may choose among them before the
request's tenant context is finalised. **A tenant identifier is never an input the operator or the
client supplies.**

### Why

The database already makes one external identity resolve to exactly one tenant, platform-wide. The
unique index `uq_user_accounts_provider_identity_active` at
`supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:109-110` is unique on the
identity provider together with the provider subject, filtered to non-deleted rows, and **carries no
tenant column in the key**. Immediately above it, `uq_user_accounts_tenant_email_active` at `:107-108`
scopes email uniqueness per tenant. Read together: the same email address may exist in two tenants,
but the same verified external identity may not.

That index is load-bearing today, not incidental. `resolveTenant` in
`apps/api/src/modules/iam/application/authentication-service.ts:338` decides the tenant without asking
the caller, and its docblock at `:316-337` explains why it must: the row-level policy on user accounts
restricts reads to the current tenant, and the platform holds no privilege-elevating routines by
CI-asserted invariant, so a lookup that does not yet know its tenant has nowhere in the database it is
permitted to run. The provider directory is the only tenant-agnostic directory that exists.

The one-account-per-identity rule is therefore the exact constraint that must change for
multi-company identity, and it is a single index. That is the whole reason this remediation is
tractable.

Login already carries no tenant input on any RootLco client. The sign-in schema parses an email and a
password and nothing else (`apps/web/src/features/authentication/schemas/credentials.ts:53-66`), and
the sign-in form renders a hidden locale field, an email field and a password field — there is no
tenant control on it (`apps/web/src/features/authentication/components/LoginForm.tsx:52`, `:64`, `:90`).
The tenant identifier appears only in the **response**
(`apps/web/src/features/authentication/actions/login.ts:48`).

One seam must be named rather than assumed away. The API request type still accepts an optional
tenant identifier (`authentication-service.ts:112`, documented at `:104-111`). Where the identity
carries a provider binding, a supplied value is cross-checked and a disagreement is refused
(`:348`); where the identity carries no binding, the caller-asserted value is used as a fallback
(`:355`). That fallback is the one place where a client-supplied tenant currently decides anything.
Under this decision it may not become the mechanism by which membership choice is expressed. Membership
choice is a choice among memberships the server has already established for the verified identity — a
selection from a server-issued list, never a value the client names.

The dead tenant-hint helpers that would have made a client-side tenant hint easy have been removed:
`readTenantHint`, `writeTenantHint` and the tenant-hint cookie constant were deleted from
`apps/web/src/lib/api/session-cookie.ts` on branch `feature/pre-p1-29-web-coverage-and-tenant-hint`
at commit `d502e07f`, completing a follow-up carried since P1-26. They are still present on
the seal-archival branch (since merged to protected `develop` as `b969894c`) (at `:43`, `:87`, `:123`); the removal has not yet reached
this branch. That removal is deliberate and must not be reverted to serve membership selection.

### Alternative rejected

**Duplicating the authentication identity per tenant** — one credential set per company, so a person
working for two companies signs in twice with two accounts.

Rejected on four grounds, each measurable rather than aesthetic:

1. It multiplies the credential surface by the number of memberships. Every password reset, every
   lockout, every session revocation becomes an N-times problem for the same human being.
2. It makes session revocation unsound as a security control. Revoking all sessions for a
   compromised person would have to be executed once per duplicated account, and the operator has no
   way to know how many there are — the accounts are unlinked by construction.
3. It defeats the audit trail. Two accounts for one person means two actor identities in the audit
   record for one set of hands, and no join exists that would reunite them.
4. It requires the operator to know which duplicate to use before signing in, which reintroduces a
   tenant-selection step at the credential prompt — the exact thing the login-identity contract was
   changed to remove.

The rejected alternative also has a quieter cost: it would leave
`uq_user_accounts_provider_identity_active` intact and therefore look like less work, while
converting a single-index change into a permanent product constraint.

### Consequence

Membership becomes a first-class concept between identity and tenant. The active tenant for a request
is still exactly one, resolved server-side, and every downstream contract — scope, grant, row-level
policy — is unchanged. What changes is that the resolution may have more than one legitimate answer
and must therefore be a choice, made server-side against memberships the server itself established.

---

## PRE29-AD-03 — The platform Superadmin is a control-plane principal

### Decision

The platform Superadmin is a **control-plane principal**: it exists outside every tenant and is not a
tenant Company Owner with extra permissions. Its authority is bounded to bootstrap: create the first
tenant and its company, create that company's initial branch, create the initial Company Owner, and
create the initial role and grant set. After bootstrap, the tenant administers itself.

### Why

The concept does not exist yet, and that is worth stating without hedging: **searching
`apps/api/src`, `apps/web/src`, `supabase/migrations` and `supabase/seeds` for a superadmin or
platform-administrator principal returns nothing.** There is no such role, no such permission, no
such flag.

What does exist is the provisioning primitive it needs. `org.provision_organization` at
`supabase/migrations/20260717107000_org_provisioning.sql:84` provisions a complete organisation in one
transaction — tenant, status history, subscription, legal company, branch, company and branch
settings, feature overrides and number-sequence configuration (the inserts run from `:132` to `:270`).
It is idempotent by request key, it refuses a repeated key carrying a different request, and it is
declared as a platform operation: it is `SECURITY INVOKER` (`:90`), so it runs with the caller's own
privileges, and its execute privilege is revoked from `PUBLIC` at `:281` and granted to no
application role. The migration header at `:22-26` states the intent plainly — a runtime session
lacks the underlying insert privileges, so both layers deny, and the abuse case named is tenant
self-provisioning.

Two gaps follow directly from that, and they are the shape of the work:

- **It creates no identity.** Its inserts touch the `org` schema (eight inserts, `:132` through
  `:226`) and two shared tables — `shared.number_sequences` (`:242`) and `shared.idempotency_keys`
  (`:270`) — and nothing else; there is no insert into any IAM table. So a freshly provisioned
  tenant has a company and a branch and nobody who can sign in to it.
- **No API operation can invoke it.** It is granted to no application role and no registered
  operation calls it; its only caller in the tree is the operator-directed runner
  `scripts/db/provision-organization.mjs:139`, which runs on a platform connection and refuses every
  environment except `local-pilot` and `production-pilot` (`:13`). That is correct as a default and
  is precisely the hole the Superadmin fills.

The tenant hierarchy the Superadmin bootstraps already exists as tables: tenants at
`supabase/migrations/20260717101000_org_tenants.sql:87`, legal companies at
`supabase/migrations/20260717103000_org_companies_branches.sql:53`, branches at `:116`, and
departments at `supabase/migrations/20260717104000_org_operational_structure.sql:109`.

### The four shortcuts, and why each is rejected

| Shortcut                                       | Why it is rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disable delegation checks during bootstrap** | Delegation containment is enforced in the database, not merely in the application: `supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql` adds a deferred constraint-trigger backstop specifically so that an application-layer defect cannot produce an escalation. Its header records the original defect exactly — the application checked containment only inside its per-scope loop, so an empty scope list, the broadest possible delegation, was the one delegation nobody checked. A bootstrap path that switches containment off would re-open the confirmed-High escalation that migration was written to close, and would do it on the single code path least likely to be re-tested. |
| **Give the first user implicit superpowers**   | Authority by ordinal position is authority by name in disguise. The platform's stated rule is that a role confers nothing by its name (`supabase/migrations/20260718091000_iam_roles_and_permissions.sql:105`) and that authorisation is by permission, never by role name (`supabase/seeds/04_iam_permission_catalog.sql:11-12`). "First user" is not a permission, cannot be revoked, cannot be audited as a grant, and cannot be scoped. It also fails the moment a tenant is provisioned twice or a first user is deleted.                                                                                                                                                                                         |
| **Hard-code an email address**                 | It puts an environment-specific secret-shaped value in source, it cannot be rotated without a deployment, it cannot be scoped to one tenant, and it silently becomes production authority in every environment built from the same tree. It is also untestable in the only sense that matters: a test that proves the address works proves nothing about the address that will actually be deployed.                                                                                                                                                                                                                                                                                                                   |
| **A client-side flag**                         | The web tier is explicit that client-side evaluation is for usability only and that the server's denial is the only denial that means anything (`apps/web/src/lib/permissions.ts:3-24`). A client-side administrator flag would be an authority claim made by the least trustworthy participant in the exchange.                                                                                                                                                                                                                                                                                                                                                                                                       |

A fifth is rejected on the same footing: **bypassing row-level security** to make bootstrap easier.
The provisioning routine already runs with the caller's own privileges by design, and the platform
holds no privilege-elevating routines by CI-asserted invariant — a fact the authentication service
relies on when it explains why the tenant cannot be resolved from the database
(`apps/api/src/modules/iam/application/authentication-service.ts:319-322`). A bootstrap path that
bypassed row-level security would break an invariant other code has already been written to depend on.

### Consequence

The Superadmin needs a principal type that is not a tenant member, an authenticated path to the
provisioning routine, and an extension of that routine (or a companion to it) that also creates the
initial Company Owner, role and grant inside the transaction it already runs. Every step remains
subject to delegation containment and row-level security; none of them is exempted.

---

## PRE29-AD-04 — Re-scope the administration operations that already exist

### Decision

Company Owner authority is delivered by **re-scoping administration operations** — declaring the
correct scope on each operation and letting grant scope decide — and not by issuing the Company Owner
a broad set of tenant-wide permissions.

### Why

Thirty-eight published operations carry an `iam.` identifier in `apps/api/src`. **No operation carries
an `org.` identifier — the count is zero.** The organisation URL space does exist, across four route
files, and every operation behind them carries an `iam.` or `shared.` identifier instead:

| Route file (under `apps/api/src/app/api/v1/`)      | Operations                                                                 | Declared scope | Permission required                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- | -------------- | ----------------------------------------- |
| `org/tenant/route.ts`                              | `iam.tenant-settings-read` (`:36`), `iam.tenant-settings-update` (`:49`)   | tenant         | `org.tenant.read`; `org.settings.manage`  |
| `org/companies/[companyId]/settings/route.ts`      | `iam.company-settings-read` (`:37`), `iam.company-settings-write` (`:50`)  | company        | `org.company.read`; `org.settings.manage` |
| `org/branches/[branchId]/settings/route.ts`        | `iam.branch-settings-read` (`:33`), `iam.branch-settings-write` (`:46`)    | branch         | `org.branch.read`; `org.settings.manage`  |
| `organization/branches/[branchId]/status/route.ts` | `shared.branch-status-read` (`:34`), `shared.branch-status-change` (`:47`) | branch         | `org.branch.read`; `org.settings.manage`  |

The two URL segments — `org` and `organization` — are a naming inconsistency in the route tree worth
recording, not a second module.

Two things follow. First, the pattern this decision endorses **already works**: one permission,
`org.settings.manage`, is the sole requirement of all four write operations above, across three
declared scopes — tenant, company and branch — and the scope declaration is the only thing that
separates a branch administrator from a tenant administrator on them. Second, the
administration surface is thinner than the catalogue suggests. Five organisation-administration
permissions are seeded and effectively unused:

| Permission                | References in `apps/api/src` | References in `apps/web/src` | Status                     |
| ------------------------- | ---------------------------- | ---------------------------- | -------------------------- |
| `org.company.manage`      | 0                            | 0                            | Seeded, referenced nowhere |
| `org.branch.manage`       | 0                            | 0                            | Seeded, referenced nowhere |
| `org.department.manage`   | 0                            | 0                            | Seeded, referenced nowhere |
| `org.subscription.manage` | 0                            | 0                            | Seeded, referenced nowhere |
| `org.tax.manage`          | 0                            | 3                            | Seeded; no gate uses it    |

The three web references to `org.tax.manage` do not gate anything. One is a constant-map entry
(`apps/web/src/features/administration/shared/permissions.ts:46`); the other two are comments
recording that gating a screen on it was a defect, because the screen calls the company-settings
operations and those require `org.company.read` and `org.settings.manage` instead
(`apps/web/src/config/navigation.ts:471-473`,
`apps/web/src/app/[locale]/(dashboard)/administration/page.tsx:73`).

Stated plainly: **there is no operation that creates a company, creates a branch, lists companies,
lists branches, or manages departments.** Company and branch settings can be read and written, and a
branch's status can be read and changed; the companies, branches and departments themselves cannot be
created through the API at all. (The
similarly named `crm.company-create` in `apps/api/src/app/api/v1/customers/companies/route.ts:29`
creates a _customer_ company — a business partner — and is unrelated to the tenant's own legal
companies.)

There is also a specific authorisation hazard that this decision exists to avoid.
`requiresScopedEvaluation` in `apps/api/src/server/auth/authorization.ts:62-65` returns false
**unconditionally** when the declared scope is tenant — `:63` is a bare short-circuit before the
target is consulted at `:64`. That is correct for an operation that genuinely is tenant-wide. It also
means that if a Company Owner is handed a tenant-scoped permission on a tenant-scoped operation, the
company and branch on the request are never examined by the authorisation middleware, and the grant's
scope cannot narrow the outcome. There is exactly one path that escapes this, and it is opt-in rather
than automatic: the deferred re-authorisation `authorizeScope` passes `forceScoped: true` (`:376`,
with the reason recorded at `:371-375`), which makes `evaluatePermissions` consult grant scope from
the supplied target even when the declaration says tenant (`:105-107`). Outside that deferred path the
declared scope on the operation is the control, and it is the only control at that layer.

### Alternative rejected

Grant the Company Owner a broad set of tenant-wide permissions and rely on the surrounding screens,
or on the operator's intent, to keep them inside their own company.

Rejected because the tenant short-circuit above makes it unsound rather than merely untidy: a
tenant-scoped grant on a tenant-scoped operation is not narrowed by anything. It also inverts the
delegation model — a Company Owner holding tenant-wide grant management could mint grants outside their
company, which is the exact escalation the delegation backstop was written to refuse
(`supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql`), leaving the database
trigger as the only thing standing between the design and the escalation. A design whose safety
depends entirely on a backstop firing is a design that has already failed.

### Consequence

Each administration capability the initiative adds must declare the narrowest scope at which it is
meaningful, and the Company Owner's authority is then the intersection of the permissions granted and
the scopes those grants name. Where an existing operation declares a scope wider than the capability
requires, re-scoping it is in scope for this initiative; widening a permission is not.

---

## PRE29-AD-05 — Domain grouping and human wording in the role editor; the code stays canonical

### Decision

The role editor presents permissions **grouped by business domain, with human wording**, in the
operator's language. The canonical permission code is unchanged, remains the value sent to and
evaluated by the server, and remains visible in the editor as the precise identifier.

### Why

The grouping key already exists as data. Every catalogue row records its business domain alongside
the code, description and risk level (`supabase/seeds/04_iam_permission_catalog.sql:15`), and the 112
codes distribute across 17 domains — reception 12, sales 10, identity and access 10, customer 10, work
order 9, organisation 9, inventory 9, vehicle 7, shared 6, service catalogue 5, quality 5, technician
4, diagnostics 4, appointments 4, reporting 3, quotation 3, warranty 2. The catalogue read operation
already returns those fields: `iam.permission-list` at
`apps/api/src/app/api/v1/iam/permissions/route.ts:20-30`, gated on `iam.role.read` because, as its
docblock says, the catalogue is only useful to someone administering roles.

The screen already groups. `apps/web/src/features/administration/access/components/PermissionsScreen.tsx:90-97`
builds the groups from the domain field and sorts them. What is missing is the human half: the group
heading renders the raw domain key directly (`:144`) — the seeded abbreviations `wo`, `rec`, `qms`,
`shared` and the rest, two to six characters each — and the row description is the English sentence
from the seed passed straight through (`:166`), neither of which goes through the message catalogue.
An Arabic-language operator therefore sees an English description under a heading that is an
untranslated abbreviation.

So the decision is not "add grouping". It is: keep the grouping, translate the group headings and the
permission descriptions through the message catalogue, and leave the code column exactly as it is.

### Alternative rejected

Rename the permission codes so they read as English, or ship a second, display-oriented catalogue
alongside the canonical one.

Renaming is rejected because the codes are pinned, distributed and load-bearing: the count is asserted
in CI at `.github/ci-baselines/schema-baseline.json:14`, operations declare codes literally in their
definitions, and the web tier matches them by exact string membership
(`apps/web/src/lib/permissions.ts:49`). A rename is a simultaneous edit to the seed, every operation
that declares the code, every navigation entry, and every grant already issued in a running
environment — with no mechanism to migrate the last of those. The failure mode is silent: a code that
no longer exists is simply held by nobody, which is what `sal.invoice.read` and `sal.delivery.read`
demonstrate at `apps/web/src/config/navigation.ts:297` and `:306`.

A second display catalogue is rejected for the reason given in PRE29-AD-01: it is a second source of
truth that will drift, and the drift will be invisible because nothing evaluates the display
catalogue.

### Consequence

Human wording is a presentation concern served by the message catalogue and keyed by the canonical
code and domain. Adding a permission means adding a seed row and its message entries; it never means
changing what the server evaluates.

---

## PRE29-AD-06 — Role templates are data, not hard-coded authority

### Decision

Role templates are **data**: a named starting bundle of permissions that a tenant may apply and then
change. A template confers nothing by existing, and applying one produces ordinary role and grant
rows that the tenant's administrators can subsequently edit, extend or revoke.

### Why

The roles table is already built for exactly this. `iam.roles`
(`supabase/migrations/20260718091000_iam_roles_and_permissions.sql:83-102`) is tenant-scoped, carries
a role code that is unique per tenant among non-deleted rows (`:107-108`), soft-deletes, and carries a
flag marking protected platform-seeded roles. Its own comment states the rule this decision follows:
a role is a named bundle of permissions and confers nothing by its name (`:105`). The permission
catalogue seed says the same thing from the other side — authorisation is by permission, never by role
name (`supabase/seeds/04_iam_permission_catalog.sql:11-12`) — and adds that the six-role baseline
shape is proven with ephemeral fixtures rather than shipped as rows (`:5-7`), which is what the
no-fake-data policy requires.

The operations to apply a template already exist as primitives: `iam.role-create`, `iam.role-update`,
`iam.role-permission-add`, `iam.role-permission-remove`, `iam.role-permission-update`,
`iam.role-permission-list`, `iam.grant-issue`, `iam.grant-revoke`, and the three grant-scope
operations. A template is therefore a named list consumed by operations that already ship, not a new
authority mechanism.

### Alternative rejected

Hard-code a fixed set of role names in the application — a Company Owner role, a Manager role, a
Receptionist role — and let code branch on the name.

Rejected because it re-introduces authority by name, which the schema comment and the seed header both
forbid, and because every workshop's real organisation differs: a fixed set is either too small to be
usable or too large to be safe. It is also the exact failure class this codebase has recorded
repeatedly — a declaration that reads as authority while nothing wires it — and a role name that
grants nothing but appears to grant something is worse than no role at all, because an administrator
will believe the assignment took effect.

### Consequence

Templates ship as seed-shaped data or as a catalogue the Superadmin bootstrap can apply. No code
branches on a role name. The tenant that applies a template owns the result immediately and completely.

---

## What this document does not decide

- **It does not open P1-29.** No phase branch, no phase deliverable, no phase gate.
- **It does not decide the membership data model** — whether membership is a new table, a relaxation
  of the account-per-identity index, or both. It decides the direction and the constraints; the shape
  is the Backend lane's to propose against them.
- **It does not decide the Superadmin's authentication mechanism.** It decides that the principal is
  control-plane and that four named shortcuts are unavailable.
- **It does not decide the tenancy surfaces deferred by the Owner** — typed company and branch
  identifiers, Superadmin and Company-Owner admin screens, and Backend-authoritative page visibility
  remain out of scope, consistent with the standing deferral.

Ownership for the work is already registered: `.github/ci-baselines/phase-ownership-profiles.json`
defines `pre-p1-29-backend` for `feature/pre-p1-29-backend-` (`:113-114`), `pre-p1-29-web` for
`feature/pre-p1-29-web-` (`:118-119`), `pre-p1-29-initiative` for the full integration branch name
(`:123-124`), and `repository-tooling` for `chore/pre-p1-29-` governance branches (`:108-109`). The
initiative profile is bound to the full branch name rather than a prefix, deliberately, so that it
cannot swallow either lane (`:125`).

## What I could not settle

- **Whether any environment currently holds grants against the five unused organisation permissions.**
  The reference counts above are static counts over `apps/api/src` and `apps/web/src`; they say the
  codes are never required by an operation or a screen, not that no grant row names them. A query
  against a provisioned environment's grant and role-permission tables would settle it, and it matters
  because re-scoping is cheaper if nothing has been granted yet.
- **Whether the caller-asserted tenant fallback at
  `apps/api/src/modules/iam/application/authentication-service.ts:355` is reachable in any shipped
  configuration.** It applies only to an identity carrying no provider binding — an identity created
  outside the invitation path. Whether such an identity can exist in a deployed environment depends on
  provider configuration this document did not inspect. A test that creates an identity outside
  invitation and attempts sign-in would settle it, and it matters because that line is the one place a
  client-supplied tenant still decides an outcome.
