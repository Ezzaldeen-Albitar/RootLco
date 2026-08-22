# PRE-P1-29 — permission reuse register

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 1. The rule this register exists to enforce

**Reuse a canonical permission wherever one already names the authority. Add a code only for a
concept the catalogue genuinely does not carry. Never mint a second name for an authority that
already has one.**

Three things follow from that rule, and each of them is a decision this initiative has to take
before it writes a line of code:

1. **A missing screen is not a missing permission.** Most of what PRE-P1-29 needs is already
   seeded. The gap is usually an operation nobody published, not an authority nobody named.
2. **A duplicate code is worse than a missing one.** A missing code fails closed — a permission
   that does not exist cannot be held, so every actor is denied and someone notices. A duplicate
   splits one authority across two names, and half the grants silently stop meaning what the other
   half means. Nothing fails; the product just becomes wrong in a way no test asks about.
3. **A code that no operation declares is not a control.** Seeding a code and granting it to a
   role produces a tenant that believes an authority is administered when nothing reads it.

---

## 2. The catalogue: what it is and where it is pinned

The canonical permission catalogue is a single file:
`supabase/seeds/04_iam_permission_catalog.sql`. It holds **112 permission rows across 17 domain
prefixes**, and it is the only shipping insert into the permission table anywhere in the
repository.

**No migration inserts a permission.** Searching all 124 migrations under `supabase/migrations/`
for an insert into the permission table returns nothing. Every code the product recognises comes
from that one seed file, which is idempotent and additive.

The row count is pinned by CI at `.github/ci-baselines/schema-baseline.json:14`
(`"permissionCount": 112`). That pin has already caught the exact failure this register is written
to prevent: four codes declared by routes and absent from the catalogue, with every
denial-based authorization test still passing — because a permission that does not exist cannot be
held by anybody, so every denial test denied correctly and proved nothing
(`.github/ci-baselines/schema-baseline.json:15`).

### Domain prefixes, measured

Counted directly from `supabase/seeds/04_iam_permission_catalog.sql`:

| Prefix    |   Codes | Domain                                                |
| --------- | ------: | ----------------------------------------------------- |
| `rec`     |      12 | Vehicle reception                                     |
| `sal`     |      10 | Billing, payment, delivery and custody                |
| `iam`     |      10 | Identity and access administration                    |
| `crm`     |      10 | Customers and business partners                       |
| `wo`      |       9 | Work orders and jobs                                  |
| `org`     |       9 | Tenant, company, branch and structural administration |
| `inv`     |       9 | Inventory, stock and custody of parts                 |
| `veh`     |       7 | Vehicle master                                        |
| `shared`  |       6 | Documents, notifications, reporting evidence          |
| `svc`     |       5 | Service catalogue and pricing                         |
| `qms`     |       5 | Quality control and rework                            |
| `tech`    |       4 | Technician assignment and labour                      |
| `dia`     |       4 | Diagnostics                                           |
| `apt`     |       4 | Appointments                                          |
| `rpt`     |       3 | Reporting configuration and export                    |
| `quo`     |       3 | Quotations                                            |
| `wty`     |       2 | Warranty                                              |
| **Total** | **112** |                                                       |

Two prefixes matter to PRE-P1-29 and are the only ones this register touches: **`iam`** (10 codes)
and **`org`** (9 codes). Nineteen codes in total, of which — as section 4 shows — six are seeded
and reach no operation.

---

## 3. How a code becomes real, and the three classifications

A permission is only load-bearing when three things are true at once:

- it is **seeded** in the catalogue file;
- an **operation declares it**, so a request is refused without it;
- where the data is written directly, a **database policy also requires it**, so a writer that
  bypasses the API is refused too.

The register classifies every code the initiative needs against those three:

| Class     | Meaning                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REUSE** | Seeded and already declared by at least one shipped operation. Use the exact code. Do not restate it under a new name.                                                       |
| **WIRE**  | Seeded, but no operation declares it. The authority is named and reaches nothing. The work is to publish an operation behind the existing code — never to seed a second one. |
| **NEW**   | No existing code carries the authority. Requires a seed row, with the reason recorded next to it in the catalogue file, in the style every prior phase used.                 |

A fourth outcome appears in section 6 and is deliberately not a class: some capabilities this
initiative needs **must not be permissions at all**, because they act before a tenant context
exists and a tenant permission cannot gate them.

---

## 4. The register

### 4.1 Identity and access administration (`iam`)

| Capability PRE-P1-29 needs                                                             | Code                   | Class    | Evidence                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read the user directory; describe the caller's own session                             | `iam.user.read`        | REUSE    | Seed line 25. Declared by `iam.user-list` (`apps/api/src/app/api/v1/iam/users/route.ts:37`), `iam.user-detail` (`apps/api/src/app/api/v1/iam/users/[userId]/route.ts:38`) and `iam.auth-session` (`apps/api/src/app/api/v1/auth/session/route.ts:31`)                                                                               |
| Invite, provision and change the status of a user                                      | `iam.user.manage`      | REUSE    | Seed line 26. Declared by `iam.invitation-create` (`apps/api/src/app/api/v1/iam/invitations/route.ts:40`); enforced in the database by policy `ins_user_accounts_admin` (`supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:186`)                                                                  |
| Read roles, their mappings, grant scopes, and the catalogue the role editor lists from | `iam.role.read`        | REUSE    | Seed line 27. Declared by `iam.role-list` (`apps/api/src/app/api/v1/iam/roles/route.ts:44`), `iam.permission-list` (`apps/api/src/app/api/v1/iam/permissions/route.ts:26`) and `iam.grant-scope-list` (`apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:34`)                                                           |
| Create and update roles; add, change and withdraw role-to-permission mappings          | `iam.role.manage`      | REUSE    | Seed line 28. Declared by `iam.role-create` (`apps/api/src/app/api/v1/iam/roles/route.ts:57`) and `iam.role-permission-add` (`apps/api/src/app/api/v1/iam/roles/[roleId]/permissions/route.ts:50`); enforced by policy `ins_roles_admin` (`supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:273`) |
| Issue and revoke grants; add and remove the scopes on a grant                          | `iam.grant.manage`     | REUSE    | Seed line 29. Declared by `iam.grant-issue` (`apps/api/src/app/api/v1/iam/grants/route.ts:55`), `iam.grant-revoke` (`apps/api/src/app/api/v1/iam/grants/[grantId]/route.ts:37`) and `iam.grant-scope-add` (`apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:47`)                                                       |
| Manage approval limits                                                                 | `iam.approval.manage`  | REUSE    | Seed line 30. Declared by `iam.approval-limit-list` and `iam.approval-limit-create` (`apps/api/src/app/api/v1/iam/approval-limits/route.ts:60` and `:73`)                                                                                                                                                                           |
| Reveal restricted values on an administration screen                                   | `iam.sensitive.view`   | REUSE    | Seed line 31. Declared alongside a domain code rather than alone — for example `apps/api/src/app/api/v1/rework-links/[reworkLinkId]/cost/route.ts:57`                                                                                                                                                                               |
| Read the audit trail behind an administration action                                   | `iam.audit.view`       | REUSE    | Seed line 32. Declared by `iam.audit-event-list` (`apps/api/src/app/api/v1/audit-events/route.ts:50`)                                                                                                                                                                                                                               |
| List and revoke another user's sessions                                                | `iam.session.view_all` | REUSE    | Seed line 33. Declared by `iam.user-session-list` and `iam.user-session-revoke-all` (`apps/api/src/app/api/v1/iam/users/[userId]/sessions/route.ts:62` and `:76`)                                                                                                                                                                   |
| Read another user's login history                                                      | `iam.login.view_all`   | **WIRE** | Seed line 34. The database already enforces it — policy at `supabase/migrations/20260718098000_iam_rls_grants_hardening.sql:73` — but **no operation declares it**: zero references in `apps/api/src` and zero in `apps/web/src`. The authority is gated at the row and unreachable through the product.                            |

Ten `iam` codes, nine of them REUSE. **The initiative needs no new `iam` code.** Thirty-eight
`iam.*` operations are already published in `apps/api/src`, covering roles, role-permission
mappings, grants, grant scopes, the permission list, the user directory, sessions, invitations,
authentication, audit events, approval limits and tenant/company/branch settings.

### 4.2 Organizational structure (`org`)

| Capability PRE-P1-29 needs                                         | Code                      | Class                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read the tenant profile                                            | `org.tenant.read`         | REUSE                                             | Seed line 16. Declared by `iam.tenant-settings-read` (`apps/api/src/app/api/v1/org/tenant/route.ts:41`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Read a legal company                                               | `org.company.read`        | REUSE — **but the list operation does not exist** | Seed line 17. Declared by `iam.company-settings-read` (`apps/api/src/app/api/v1/org/companies/[companyId]/settings/route.ts:42`), which takes a company the caller must already know. No operation returns the tenant's companies. See section 5.                                                                                                                                                                                                                                                                                                                                    |
| Read a branch                                                      | `org.branch.read`         | REUSE — **same shape**                            | Seed line 19. Declared by `iam.branch-settings-read` (`apps/api/src/app/api/v1/org/branches/[branchId]/settings/route.ts:38`) and by `shared.branch-status-read` (`apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:39`). No operation returns the tenant's branches.                                                                                                                                                                                                                                                                                        |
| Write tenant, company and branch settings                          | `org.settings.manage`     | REUSE                                             | Seed line 22. The most heavily wired code in the domain: 20 references in `apps/api/src`, 12 of them operation declarations (for example `apps/api/src/app/api/v1/org/tenant/route.ts:54`), and **5** database policies — `upd_tenants_settings` (`supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:423-426`) plus `ins_message_templates_tenant`, `upd_message_templates_tenant`, `ins_template_versions_tenant` and `upd_template_versions_tenant` (`supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql:325-367`) |
| Create and update legal companies                                  | `org.company.manage`      | **WIRE**                                          | Seed line 18. Zero references in `apps/api/src`, zero in `apps/web/src`, and no database policy requires it                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Create and update branches                                         | `org.branch.manage`       | **WIRE**                                          | Seed line 20. Zero references in `apps/api/src`, zero in `apps/web/src`, no database policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Manage departments and operational structure                       | `org.department.manage`   | **WIRE**                                          | Seed line 21. **No operation, no screen, no policy**: zero references in `apps/api/src`, zero in `apps/web/src`, and no migration mentions it. Outside its seed row it appears only in prose (`docs/database/permission-catalog-reference.md:41`, plus four `docs/product/` documents that each record it as required by no route) and in one role-mapping test fixture (`tests/db/iam-seeds.test.ts:64` and `:75`). The table it would govern does exist (`org.departments`, created at `supabase/migrations/20260717104000_org_operational_structure.sql:109`)                     |
| Manage tenant subscriptions                                        | `org.subscription.manage` | **WIRE — scope undecided**                        | Seed line 24. Zero references in `apps/api/src`, zero in `apps/web/src`, and no database policy; outside its seed row it appears only in `docs/database/permission-catalog-reference.md:43` and in the role-mapping test fixture at `tests/db/iam-seeds.test.ts:60`. Whether the initiative exposes subscription administration at all is not settled by the Owner decisions; see section 7                                                                                                                                                                                          |
| Manage tax classes and rates                                       | `org.tax.manage`          | **WIRE — deliberately out of scope**              | Seed line 23. Its only three appearances in `apps/web/src` are one unconsumed constant (`apps/web/src/features/administration/shared/permissions.ts:46`) and two comments recording that gating the tax screen on it was wrong (`apps/web/src/config/navigation.ts:473`, `apps/web/src/app/[locale]/(dashboard)/administration/page.tsx:73`). Leave it alone.                                                                                                                                                                                                                        |
| Read the department list, so a grant can be scoped to a department | _(none exists)_           | **NEW — proposed, not yet seeded**                | The database supports department-scoped grants: the scope shape constraint at `supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:145` admits a department target, and the delegation backstop reasons about department coverage. Nothing in the catalogue lets an administrator _read_ the department list to pick one. See the reasoning below.                                                                                                                                                                                                                     |

**Why the department read is genuinely NEW.** Three existing codes were considered and each fails:

- `org.department.manage` (seed line 21) would work only by forcing every scope picker to hold the
  authority to _restructure_ the organization. That is the over-grant-by-omission the catalogue
  file itself argues against in its `shared` read-code commentary
  (`supabase/seeds/04_iam_permission_catalog.sql:266-273` — "over-granting by omission rather than
  by decision").
- `org.branch.read` (seed line 19) does not fit: a department is not a branch, and the scope shape
  constraint treats them as distinct targets.
- `org.company.read` (seed line 17) is a company authority; departments sit below branches.

Sixteen of the catalogue's seventeen prefixes separate a read from its manage — `inv.item.read`
from `inv.item.manage`, `apt.appointment.read` from `apt.appointment.manage`, `svc.service.read`
from `svc.service.manage`, `wo.work_order.read` from every work-order write. The seventeenth,
`wty`, carries no read code at all (`wty.policy.manage` and `wty.warranty.issue`, seed lines 72-73,
are its only two). The organizational domain already separates read from manage twice, at company
and at branch, and stops at department. Closing that gap is the
only new code this register recommends, and it is a single low-risk read.

**Naming note.** `org.department.read` is the name the existing pattern produces. It is written
here as a **proposal**, not as a canonical name: it does not exist in
`supabase/seeds/04_iam_permission_catalog.sql` today and must not be cited anywhere as if it did
until the Backend lane seeds it and the pinned count moves from 112 to 113.

---

## 5. What is missing is operations, not permissions

The Web lane of this initiative is defined in CI as _"the Superadmin and company administration
screens, the role editor, the capability-driven navigation and the human company/branch
selectors"_ (`scripts/ci/check-phase-ownership.mjs:429-450`). The **human company/branch
selectors** are the phrase that matters here.

No operation lists companies, branches or departments. Enumerating every operation identifier in
`apps/api/src` returns 305 operations — the same 305 the published contract carries, counted
independently from `docs/api/openapi.v1.json` — of which the only organization-shaped ones are:
`iam.tenant-settings-read`, `iam.tenant-settings-update`, `iam.company-settings-read`,
`iam.company-settings-write`, `iam.branch-settings-read`, `iam.branch-settings-write`,
`shared.branch-status-read`, `shared.branch-status-change` and `svc.branch-availability-set`.
**Seven of the nine require the company or branch to be named in the request** — in the path for
the settings and status pairs, in the body for `svc.branch-availability-set`
(`apps/api/src/app/api/v1/services/[serviceId]/branch-availability/route.ts:54-55`). The remaining
two, the tenant-settings pair on `/api/v1/org/tenant`, name nothing and answer only for the
caller's own tenant. Either way, a screen that must let a human choose a company or a branch has
nothing to populate the chooser from.

**No `org.*` operation exists at all.** The 305 operations use 17 identifier prefixes — `apt`,
`crm`, `dia`, `iam`, `inv`, `meta`, `qms`, `quo`, `rec`, `rpt`, `sal`, `shared`, `svc`, `tech`,
`veh`, `wo`, `wty` — and `org` is not among them.

This is the single most important line in the register: **the companies and branches the
initiative must display are already authorized by `org.company.read` and `org.branch.read`, whose
seeded descriptions are "Read legal companies" and "Read branches" — both plural. The authority
was named at the start of Phase 1 and the list operation behind it was never published.** Adding a
new code here would be duplication, not remediation.

---

## 6. Capabilities that must NOT become permissions

Two of the three Owner decisions describe authorities that a tenant permission structurally cannot
express. Recording them here stops a later reader from "fixing" the gap by seeding a code.

### 6.1 Choosing among memberships at sign-in

The authorized direction is _global identity → membership(s) → tenant/company → branches →
roles/grants_, with one active tenant per request retained and one identity permitted to choose
among authorized memberships **before** the request tenant context is finalized.

A permission cannot gate that choice. Permission evaluation runs inside a tenant: the tenant-wide
resolver and the scoped resolver both read from the current tenant context
(`supabase/migrations/20260718097000_iam_context_and_permission_functions.sql:71` and `:127`), and
every seeded code is held through a tenant role grant. At the moment the chooser runs, there is no
tenant yet, so there is nothing for a permission to be held _in_.

**Classification: not a permission.** The membership list is an authenticated, pre-tenant response
scoped to the identity that just authenticated, and its correctness argument is that it can return
nothing except that identity's own memberships. It is not gated by a catalogue code and no code
should be minted for it.

The obstacle to the remediation is a database uniqueness rule, not a permission gap: the active
provider-identity index at
`supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:109-110` carries **no tenant
column**, so one live external identity resolves to exactly one tenant, platform-wide. A second
membership is currently unrepresentable. That is schema work for the Backend lane.

### 6.2 Platform Superadmin bootstrap authority

The authorized control-plane principal may create the first tenant and company, its initial
branch, the initial Company Owner and the initial role and grant set — and may do so _without_
disabling delegation checks, granting the first user implicit superpowers, hard-coding an address,
using client-side flags, or bypassing row-level security.

The platform already has the shape for this, and it is not a catalogue permission:

- `org.provision_organization` creates a tenant, its history, subscription, company, branch,
  settings, overrides, sequences and idempotency record **in one transaction**
  (`supabase/migrations/20260717107000_org_provisioning.sql:84`).
- It is **security-invoker** (`:90`) and is **granted to no application role** (`:281`) — execution
  is revoked from the public role and never handed to the runtime principal. Its own documentation
  calls provisioning a platform operation, not a tenant one (`:279`).
- The delegation backstop was written knowing this. Its first rule is that a statement with **no
  acting runtime principal** is not a delegated request, and it names the provisioning path
  explicitly as the boundary it preserves untouched
  (`supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql:41-45`).

So the bootstrap already runs as a distinct principal outside tenant permission evaluation, and it
does that without weakening a single delegation rule. **Classification: not a tenant permission.**
Nothing in the `org` or `iam` prefix should be seeded to represent Superadmin authority, and no
seeded code should be granted to a control-plane principal to simulate it.

**What is not yet decided** is how the control-plane surface authorizes _itself_ — a dedicated
database principal, a separate credential path, or a distinct control-plane authority namespace
that is not the tenant catalogue. This register cannot settle that; see section 7.

### 6.3 Cross-tenant reads

A Superadmin screen that lists tenants is a cross-tenant read. `org.tenant.read` (seed line 16)
does not fit and must not be reused for it: it is described as "Read tenant profile" — singular,
the caller's own — and it is resolved inside the caller's tenant context. Reusing it for a
platform-wide listing would make one code mean two different-sized things depending on who holds
it, which is exactly the failure the reuse rule forbids. Cross-tenant reads belong to whatever
control-plane mechanism section 6.2 leaves open.

---

## 7. Where this register cannot decide, and what would settle it

Written plainly, because guessing here is worse than admitting it.

| Question                                                                                                         | Why it is undecidable now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | What would settle it                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How does the control-plane principal authorize itself?                                                           | The Owner decision says what it may do and five ways it may **not** be built. It does not say what replaces them, and nothing in the repository implements a control plane today — no reference to a platform superadmin exists in `apps/api/src` or `apps/web/src`, and no such concept appears in the catalogue seed.                                                                                                                                                                                                                                                                                                                                              | An Owner or architecture decision naming the mechanism (dedicated database principal, separate credential path, or a control-plane authority namespace), recorded before the Backend lane writes a route.                              |
| Is subscription administration in scope?                                                                         | `org.subscription.manage` is seeded (line 24) and reaches nothing. The Owner decisions do not mention subscriptions, and the Superadmin's authority is described in terms of tenant, company, branch, Company Owner and roles/grants.                                                                                                                                                                                                                                                                                                                                                                                                                                | An explicit scope statement. If in scope it is WIRE (publish an operation under the existing code); if out of scope it stays untouched, exactly like `org.tax.manage`.                                                                 |
| Does attaching an existing global identity to a second tenant need an authority distinct from `iam.user.manage`? | It depends on a design decision not yet taken. If the schema keeps one account row per tenant, creating the second row is a user provisioning act and `iam.user.manage` (seed line 26) already covers it — REUSE. If the design introduces a membership record joining a global identity to a tenant, then admitting an _existing outside identity_ into a tenant is arguably a different and higher authority than creating a fresh local user, and that would be a NEW code.                                                                                                                                                                                       | The Backend lane's chosen data model for membership. Until it exists, this row cannot be classified.                                                                                                                                   |
| Do the company and branch **manage** codes need scope-aware evaluation to be safe?                               | `requiresScopedEvaluation` in `apps/api/src/server/auth/authorization.ts:62-65` returns false unconditionally when an operation declares tenant scope. Of the 38 published `iam.*` operations, **34 are not scope-evaluated at the API layer** — 30 declare tenant scope and 4 are unauthenticated (login, logout, and the two password-reset operations). Only 4 are scope-evaluated: the company settings pair (`.../org/companies/[companyId]/settings/route.ts:43` and `:56`) and the branch settings pair (`.../org/branches/[branchId]/settings/route.ts:39` and `:52`). A company-creating operation declared at tenant scope would be evaluated tenant-wide. | A Backend-lane decision on the declared scope of each new organizational operation, taken with the scope-evaluation behaviour above in view. It is a wiring decision, not a permission decision — it changes no code in this register. |

---

## 8. Two codes the product already names that do not exist

Found while cross-checking the navigation model against the catalogue, and recorded here because
the capability-driven navigation is inside this initiative's Web lane.

`apps/web/src/config/navigation.ts` carries 34 `permission:` fields: 2 are `null` (ungated) and 32
gate an entry on a code. Those 32 entries reference **23 distinct codes**. Twenty-one of the 23 are
in the catalogue. Two are not:

| Location                                | Code referenced     | Status                               | The real seeded code                                                                    |
| --------------------------------------- | ------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| `apps/web/src/config/navigation.ts:297` | `sal.invoice.read`  | **In no catalogue and no operation** | `sal.finance.view` — "View financial amounts (invoices/receipts/events)" (seed line 66) |
| `apps/web/src/config/navigation.ts:306` | `sal.delivery.read` | **In no catalogue and no operation** | `sal.delivery.view` — "View delivery signatures/receiver evidence" (seed line 70)       |

That `sal.invoice.read` does not exist is already recorded on the Backend side, in prose: the
outstanding-receivable route explains its permission choice by noting that "no `sal.invoice.read`
code exists in `iam.permissions` to use instead"
(`apps/api/src/app/api/v1/invoices/[invoiceId]/outstanding/route.ts:59`). The Web model references
it anyway.

Both entries are therefore invisible to every actor who has ever existed, and always will be,
because the client-side helper fails closed by design: an unknown code is denied, `NO_CAPABILITIES`
is the default for any unresolved state, membership is exact rather than prefix-matched, and a null
requirement means "not gated" and specifically **not** "holds everything"
(`apps/web/src/lib/permissions.ts`). Failing closed is correct; it is also why nothing reported
this.

**Why no test caught it.** `apps/web/tests/navigation.test.ts:119-127` does assert catalogue
membership — against a hand-written set of seven codes, and only for entries inside the
administration group. Both defective entries sit in a different group, so the assertion never
looks at them. `apps/web/src/features/administration/shared/permissions.ts` is honest about the
same limit in its own header: the test it describes asserts catalogue membership, not that every
code is referenced.

**Disposition.** This is a two-line correction in the Web lane, and it is a genuine reuse case —
the authorities exist under their seeded names. Do **not** seed `sal.invoice.read` or
`sal.delivery.read` to make the references valid. That would mint duplicates of
`sal.finance.view` and `sal.delivery.view` and split two authorities across four names.

**Recommended hardening, same lane:** widen the navigation catalogue assertion from the
hand-written seven-code administration subset to every entry in the model, checked against codes
parsed from `supabase/seeds/04_iam_permission_catalog.sql`. A hand-maintained subset is why a
drift check that exists did not fire.

---

## 9. Who may seed a code

Ownership is enforced by CI and constrains where each change in this register may land:

| Lane                   | Profile                | May seed a permission?                                                                                                                                                                                  | Evidence                                       |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Initiative integration | `pre-p1-29-initiative` | Yes — holds the database seeds bucket, migrations and API source                                                                                                                                        | `scripts/ci/check-phase-ownership.mjs:372-397` |
| Backend                | `pre-p1-29-backend`    | Yes — holds the database seeds bucket and migrations; **must not** touch the hand-written Web tier                                                                                                      | `scripts/ci/check-phase-ownership.mjs:398-428` |
| Web                    | `pre-p1-29-web`        | **No.** Seeds and migrations are both forbidden, stated as _"a screen must not seed a permission — the code a role editor offers is seeded by the Backend lane that publishes the operation it guards"_ | `scripts/ci/check-phase-ownership.mjs:429-450` |

The practical consequence for this register: the one NEW code in section 4.2, and every WIRE row,
is Backend-lane work. The Web lane's share is the two-code correction in section 8 and consuming
the operations the Backend lane publishes — nothing else in this document.

Any change to `supabase/seeds/04_iam_permission_catalog.sql` also moves the pinned count at
`.github/ci-baselines/schema-baseline.json:14`, and the pin carries a written note explaining every
prior movement. A new code must extend that note in the same commit, in the same voice: what was
added, and why nothing existing fitted.

---

## 10. Summary of decisions

| Decision                                                                  | Count | Codes                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REUSE — seeded and wired; use exactly as-is                               |    13 | `iam.user.read`, `iam.user.manage`, `iam.role.read`, `iam.role.manage`, `iam.grant.manage`, `iam.approval.manage`, `iam.sensitive.view`, `iam.audit.view`, `iam.session.view_all`, `org.tenant.read`, `org.company.read`, `org.branch.read`, `org.settings.manage` |
| WIRE — seeded, no operation; publish an operation under the existing code |     6 | `iam.login.view_all`, `org.company.manage`, `org.branch.manage`, `org.department.manage`, `org.subscription.manage` (scope undecided), `org.tax.manage` (out of scope — leave alone)                                                                               |
| NEW — proposed, not yet seeded                                            |     1 | a department read authority, for the grant-scope picker                                                                                                                                                                                                            |
| Not a permission — must not be seeded                                     |     3 | membership choice at sign-in; Superadmin bootstrap authority; cross-tenant listing                                                                                                                                                                                 |
| Corrections to existing references                                        |     2 | `sal.invoice.read` → `sal.finance.view`; `sal.delivery.read` → `sal.delivery.view`                                                                                                                                                                                 |

**P1-29 must not be started.** This register is a PRE-P1-29 planning artefact and authorizes no
implementation on its own.

---

## Appendix A — reference points used

| Claim                                                                                  | Where to verify it                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 112 permissions, 17 prefixes, one seed file                                            | `supabase/seeds/04_iam_permission_catalog.sql`                                                                                                                                                                                                                                                                                                           |
| No migration inserts a permission                                                      | 124 files under `supabase/migrations/`; no insert into the permission table in any of them                                                                                                                                                                                                                                                               |
| Row count pinned by CI                                                                 | `.github/ci-baselines/schema-baseline.json:14`                                                                                                                                                                                                                                                                                                           |
| 305 operations across 17 identifier prefixes; 38 of them `iam.*`; no `org.*` operation | operation identifiers declared across `apps/api/src`, cross-checked against `docs/api/openapi.v1.json`                                                                                                                                                                                                                                                   |
| No operation lists companies, branches or departments                                  | the five organization-shaped paths in `docs/api/openapi.v1.json` — `/api/v1/org/tenant`, `/api/v1/org/companies/{companyId}/settings`, `/api/v1/org/branches/{branchId}/settings`, `/api/v1/organization/branches/{branchId}/status`, `/api/v1/services/{serviceId}/branch-availability` — carrying nine operations between them and no collection route |
| Tenant scope skips scoped evaluation                                                   | `apps/api/src/server/auth/authorization.ts:62-65`                                                                                                                                                                                                                                                                                                        |
| Tenant-wide and scoped permission resolvers                                            | `supabase/migrations/20260718097000_iam_context_and_permission_functions.sql:71`, `:127`                                                                                                                                                                                                                                                                 |
| One external identity resolves to one tenant                                           | `supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:109-110`                                                                                                                                                                                                                                                                          |
| Department-scoped grants are representable                                             | `supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:142-146`                                                                                                                                                                                                                                                                              |
| Delegation containment in the database                                                 | `supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql`, `supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql`                                                                                                                                                                                       |
| Provisioning is a platform operation granted to no application role                    | `supabase/migrations/20260717107000_org_provisioning.sql:84`, `:90`, `:281`                                                                                                                                                                                                                                                                              |
| Client-side permission checks fail closed                                              | `apps/web/src/lib/permissions.ts`                                                                                                                                                                                                                                                                                                                        |
| Sign-in is address and password only                                                   | `apps/web/src/features/authentication/schemas/credentials.ts:53-66`                                                                                                                                                                                                                                                                                      |
| Ownership profiles for the three lanes                                                 | `scripts/ci/check-phase-ownership.mjs:372-450`, `.github/ci-baselines/phase-ownership-profiles.json:108-125`                                                                                                                                                                                                                                             |

## Appendix B — two observations bearing on the brief this register was written from

Recorded rather than quietly reconciled, because both bear on the "no tenant identifier input,
ever" direction. Observation 2 holds on every branch checked. Observation 1 was true when this
register was drafted and has since been overtaken; it is restated here as measured rather than
deleted, because the branch that fixes it is not merged.

1. **The tenant-hint cookie helpers: removed on one unmerged branch, still present on `develop`.**
   On `develop`, on `chore/pre-p1-29-seal-archival-lifecycle` and on both PRE-P1-29 branches
   (`chore/pre-p1-29-admin-rbac-ownership`,
   `feature/pre-p1-29-multi-tenant-administration-rbac-workflow`) all three exports are present in
   `apps/web/src/lib/api/session-cookie.ts` at identical lines: `:43` (`TENANT_HINT_COOKIE`), `:87`
   (`readTenantHint`) and `:123-133` (`writeTenantHint`, docblock `:116-122`). They are **dead** on
   every one of those branches: `git grep` over `apps/web/src` and `apps/web/tests` finds no
   consumer outside the file that defines them.

   They have since been deleted on `feature/pre-p1-29-web-coverage-and-tenant-hint` — commit
   `d502e07f`, "land the deferred coverage debt, and finish P1-26's carried removal", which strikes
   31 lines from that file and adds the coverage cases behind it. At that head the file is 120
   lines and the word "tenant" survives in it only inside the docblock at `:34` ("No tenant,
   company, branch, permission set or display name"). Two tests record the removal:
   `apps/web/tests/lib-coverage.dom.test.tsx:14-20` and `apps/web/tests/p1-27-security.test.ts:436-443`.
   That branch is two commits ahead of `origin/develop` and unmerged, so on the protected line the
   removal is still outstanding.

2. **The login operation still accepts an optional tenant identifier in its request body.**
   `apps/api/src/app/api/v1/auth/login/route.ts:41` declares it as an optional identifier, and the
   service documents it as an assertion the caller may make, cross-checked against the binding the
   provider reports, with every RootLco client omitting it
   (`apps/api/src/modules/iam/application/authentication-service.ts:104-113`). The web sign-in form
   does not send it — the sign-in schema parses an address and a password and nothing else
   (`apps/web/src/features/authentication/schemas/credentials.ts:53-66`) — so no human is ever
   asked to type one. Whether the Owner direction requires that optional field to be withdrawn from
   the contract as well is a decision this register cannot take; it is flagged for the Backend lane.
