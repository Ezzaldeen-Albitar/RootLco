# PRE-P1-29 — dependencies and deferrals

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 1. Why this document exists, and the one rule it enforces

PRE-P1-29 sits between a closed Frontend phase and a Backend phase that has not started. That is
exactly the position in which a team is tempted to _make a screen work_ by inventing the data behind
it. This document draws the line: it states what PRE-P1-29 delivers, what it genuinely cannot
deliver because the Backend work does not exist yet, and what has been authorized here even though a
casual reader would file it under P1-29.

**The rule.** If a capability belongs to unfinished P1-29 Backend work, PRE-P1-29 **records** it. It
does not simulate it. No placeholder list, no client-computed queue, no invented linkage, no seeded
demonstration row. A missing capability is shown as missing, or the screen that needs it is not
built. This is the same standing constraint as the no-fake-data policy
(`docs/database/no-fake-data-standard.md`, enforced by `scripts/check-no-fake-data.mjs`), applied to
a boundary rather than to a database.

**P1-29 must not be started.** Nothing in this document authorizes opening P1-29 scope. Where the
document says "P1-29 dependency", it means: write it down, cite it, stop.

---

## 2. Where the platform actually stands

These are measurements, not estimates. Every one was taken from the working tree on branch
the seal-archival branch (since merged to protected `develop` as `b969894c`).

| Fact                                                           | Measured value                                                                                               | Evidence                                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published API operations                                       | 305 across 17 domain prefixes                                                                                | operation registrations under `apps/api/src/app/api/v1/**/route.ts`                                                                                                                   |
| Identity/administration operations                             | 38, all under the `iam` prefix                                                                               | e.g. `apps/api/src/app/api/v1/auth/login/route.ts:47`, `apps/api/src/app/api/v1/iam/roles/route.ts`                                                                                   |
| Operation ids under an `org` prefix                            | **Zero.** Every operation id belongs to one of the 17 prefixes above, and `org` is not one of them           | the 305 ids extracted from those registrations                                                                                                                                        |
| Operations that create a tenant, company, branch or department | **Zero.** No API code inserts into `org.tenants`, `org.legal_companies`, `org.branches` or `org.departments` | the only `org.*` writes in `apps/api/src` are `modules/iam/data/organization-repository.ts:88`, `:197`, `:231` and `modules/shared-services/data/transition-repository.ts:95`, `:119` |
| Permission catalogue                                           | 112 codes across 17 domains, one shipping insert                                                             | `supabase/seeds/04_iam_permission_catalog.sql:15`                                                                                                                                     |
| Permissions added by migrations                                | **Zero.** No migration inserts a permission                                                                  | no `INSERT INTO iam.permissions` exists outside the seed                                                                                                                              |
| Catalogue pinned in CI                                         | count asserted at 112                                                                                        | `.github/ci-baselines/schema-baseline.json:14`                                                                                                                                        |
| Migrations on `develop`                                        | 124                                                                                                          | `supabase/migrations/`                                                                                                                                                                |
| Ownership profiles for this initiative                         | `pre-p1-29-initiative`, `pre-p1-29-backend`, `pre-p1-29-web`                                                 | `scripts/ci/check-phase-ownership.mjs:372`, `:398`, `:429`                                                                                                                            |

The gap between identity and organization is the whole shape of this initiative. Identity
administration is built. Organization administration is **settings and status only**: exactly eight
operations touch organization objects, across four route files — `iam.tenant-settings-read` /
`-update` (`apps/api/src/app/api/v1/org/tenant/route.ts:36`, `:49`), `iam.company-settings-read` /
`-write` (`.../org/companies/[companyId]/settings/route.ts:37`, `:50`), `iam.branch-settings-read` /
`-write` (`.../org/branches/[branchId]/settings/route.ts:33`, `:46`) and `shared.branch-status-read`
/ `-change` (`.../organization/branches/[branchId]/status/route.ts:34`, `:47`). Nothing creates,
renames or restructures the organization itself, and five of the nine seeded `org.*` permission codes
guard no operation at all.

### 2.1 The five organization-administration permissions that guard nothing

Five codes are seeded and grant access to no operation, because no operation declares them.

| Permission code           | References in `apps/api/src` | References in `apps/web/src`                                         |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `org.company.manage`      | 0                            | 0                                                                    |
| `org.branch.manage`       | 0                            | 0                                                                    |
| `org.department.manage`   | 0                            | 0                                                                    |
| `org.subscription.manage` | 0                            | 0                                                                    |
| `org.tax.manage`          | 0                            | 3 — one unused constant and two comments explaining why it is unused |

The `org.tax.manage` references are worth stating precisely, because "3" could be mistaken for
"wired". The constant is declared at `apps/web/src/features/administration/shared/permissions.ts:46`
and has **no consumer anywhere in `apps/web/src`** — not directly, and not through
`ADMINISTRATION_PERMISSIONS` (`:53`), the `Object.values(PERMISSIONS)` array that would otherwise
enumerate it, which is itself referenced by nothing outside its defining file. The other two
references are prose:
`apps/web/src/config/navigation.ts:473` and
`apps/web/src/app/[locale]/(dashboard)/administration/page.tsx:73` both record that the tax screen's
operations require settings management instead, under finding P1-26-F-029. So all five codes are
inert.

### 2.2 Departments are an authorization dimension, not an operational one

`org.departments` exists as a table (`supabase/migrations/20260717104000_org_operational_structure.sql:109`)
and departments are a legitimate grant-scope dimension: `iam.grant_scopes` carries a department
column with a shape constraint that admits a department row
(`supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:125`, `:143-145`) and the
permission function matches on it (`supabase/migrations/20260718097000_iam_context_and_permission_functions.sql:194`).

No other table in the platform carries a department reference. A repository-wide search of
`supabase/migrations` finds exactly one department column outside `org.departments` itself —
`iam.grant_scopes.department_id` — and exactly two places that read it: the permission function above
and the delegation backstop
(`supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql:182-186`). One further
guard branches on `scope_type = 'department'` without reading the column at all
(`supabase/migrations/20260815093000_rec_receiving_employee_identity.sql:168-170`), which is the
closest an operational table comes to the dimension: it treats a department-scoped grant as covering
its branch. No work order, job, technician profile, reception visit or appointment belongs to a
department.

The API cannot express one either. The operation scope type is
`'tenant' | 'company' | 'branch'` (`apps/api/src/server/auth/operation-registry.ts:36`) — department
is not a member, and no operation declares a department scope.

### 2.3 The one authorization asymmetry that shapes every screen

`requiresScopedEvaluation` returns false unconditionally when the declared scope is `tenant`
(`apps/api/src/server/auth/authorization.ts:62-65`). A tenant-scoped operation is therefore evaluated
scope-blind by design. This is deliberate and documented — the work-order list route explains at
`apps/api/src/app/api/v1/work-orders/route.ts:20-27` that a branch-scoped declaration is _inert
without a target_, so the caller must name the company and branch in the query for
`iam.has_permission_in_scope` to decide against the branch actually read.

Consequence for PRE-P1-29: a company/branch selector is not a convenience feature. It supplies the
authorization target. A screen that omits it degrades a scoped check into a tenant-wide one.

### 2.4 The client fails closed, and must keep doing so

`apps/web/src/lib/permissions.ts` is correct as it stands and is a constraint on new work, not a
thing to revisit: the default capability set is empty (`NO_CAPABILITIES`, line 39), membership is an
exact match rather than a prefix (line 49), and a null requirement means "not permission-gated" and
explicitly **not** "holds everything" (lines 45-47). There is no role shortcut and no tenant,
company or branch identifier read from client state.

Two navigation entries point at permission codes that are not in the catalogue:
`apps/web/src/config/navigation.ts:297` names `sal.invoice.read` and `:306` names
`sal.delivery.read`. Neither is seeded. The real codes are `sal.finance.view` and
`sal.delivery.view`. Because the client fails closed, the effect today is that both entries are
permanently hidden rather than wrongly shown — a latent defect, not a live leak, and one PRE-P1-29
fixes while it is in this file anyway.

---

## 3. What PRE-P1-29 delivers now

Scope is fixed by the three ownership profiles, which are themselves the authoritative statement of
what each lane may touch (`scripts/ci/check-phase-ownership.mjs:372-450`).

| #   | Deliverable                                                                                                                                             | Lane                | Why it belongs here                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Multi-company identity schema remediation: global identity → membership(s) → tenant/company                                                             | `pre-p1-29-backend` | Owner-authorized 2026-08-22. Corrects an identity model defect, not a P1-29 feature. See §5.1                                                                                                                |
| D2  | Platform Superadmin bootstrap authority — a control-plane principal that can create the first tenant, company, branch, Company Owner and role/grant set | `pre-p1-29-backend` | Owner-authorized 2026-08-22. Tenant, company and branch creation exists today only as an operator-run database path outside the product; the tenant's first administrator cannot be created at all. See §5.2 |
| D3  | Organization administration contracts behind the five inert permissions of §2.1                                                                         | `pre-p1-29-backend` | The codes ship today and guard nothing. Publishing the operations is what makes them mean something                                                                                                          |
| D4  | Superadmin and company administration screens, the role editor, capability-driven navigation, and human company/branch selectors                        | `pre-p1-29-web`     | Named verbatim in the lane's own profile at `scripts/ci/check-phase-ownership.mjs:429-432`                                                                                                                   |
| D5  | Correct the two uncatalogued navigation permission codes (`sal.invoice.read` → `sal.finance.view`, `sal.delivery.read` → `sal.delivery.view`)           | `pre-p1-29-web`     | `apps/web/src/config/navigation.ts:297`, `:306`                                                                                                                                                              |
| D6  | Remove the dead tenant-hint helpers from the web session-cookie module                                                                                  | `pre-p1-29-web`     | Closes a P1-26 carried follow-up. Zero callers outside their own file; the deleting commit already exists on `feature/pre-p1-29-web-coverage-and-tenant-hint` but is not reachable from `develop` — see §7   |
| D7  | Remove the optional tenant identifier from the login contract                                                                                           | `pre-p1-29-backend` | `apps/api/src/app/api/v1/auth/login/route.ts:41` still accepts one. The Owner decision is _no tenant identifier input, ever_. See §5.1                                                                       |

Lane discipline is enforced, not advisory. The Backend lane is forbidden from touching handwritten
Frontend; the Web lane is forbidden from carrying a migration or seeding a permission; neither may
change the database harness or API workspace configuration. The stated reason for the Backend/Web
split is that otherwise "both halves of an administration contract land in one unreviewed commit"
(`scripts/ci/check-phase-ownership.mjs:414-419`).

---

## 4. Genuine P1-29 dependencies — record, do not simulate

Each item below is a capability the operational screens will eventually need, which **does not exist
today**. For each, this document states what exists, what does not, and what PRE-P1-29 is permitted
to do about it — which is: document it, and build nothing that pretends otherwise.

| #   | Capability                              | Status today                                                                                   | PRE-P1-29 disposition                                            |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| B1  | Departments as an operational dimension | Grant scope only. No operational table references a department; the API scope type excludes it | Record. Do not add a department picker to any operational screen |
| B2  | Technician roster writes                | No operation creates or edits a technician profile                                             | Record. Do not seed a roster                                     |
| B3  | Work-order-to-customer linkage          | No work order carries a customer reference                                                     | Record. Do not resolve a customer client-side                    |
| B4  | Branch-wide job queue read              | No operation lists jobs, at any scope                                                          | Record. Do not assemble a board from per-work-order calls        |
| B5  | Branch-wide QC queue read               | QC records are readable per work order only                                                    | Record                                                           |
| B6  | Assignment notifications                | Notifications are enqueue-on-request only; no domain event raises one                          | Record. Do not poll and synthesize                               |
| B7  | Unified work-order history              | Three separate append-only histories exist; nothing unifies them                               | Record                                                           |

### B1 — Departments as an operational dimension

**Exists:** the department table, the department grant scope, and the permission function's
department branch (§2.2).

**Does not exist:** any operational entity that belongs to a department, and any way for an
operation to declare a department scope.

**Why this cannot be faked:** a department filter over data that carries no department is a filter
that returns everything or nothing. Either answer is a lie told confidently.

**What PRE-P1-29 may do:** it may continue to offer department as a _grant scope_ in the role
editor, because that dimension is real and enforced in the database. It may not offer department as
a filter, an assignment target, or a routing rule anywhere in operations.

### B2 — Technician roster writes

**Exists:** `tech.technician_profiles`
(`supabase/migrations/20260722094000_tech_profiles_skills_certs.sql:37`), with the row-level
security policy and the privileges the request role would need to insert one (`:83`, `:92`).

**Does not exist:** any operation that writes one. Six operations exist under the `tech` prefix —
four labor-session operations plus `tech.technician-available` and `tech.technician-queue` — and all
six are reads or labor-session state changes. There is no POST or PATCH route anywhere under
`apps/api/src/app/api/v1/technicians/`. Repository-wide, the only code that inserts a technician
profile is test scaffolding (`tests/backend/p1-19-helpers.ts:842`, `tests/db/p1-09-helpers.ts:58`).

**The precise statement:** the database is ready for a technician roster and the platform has no way
to create one. A production tenant has zero technicians and no supported means of acquiring any.

**What PRE-P1-29 may do:** record it. Any screen that assigns work must show an empty roster
honestly rather than a placeholder list.

### B3 — Work-order-to-customer linkage

**Exists:** the work order references a reception visit and a vehicle
(`supabase/migrations/20260722095000_wo_work_orders.sql:37` and following). The vehicle deliberately
carries no owner column — ownership is temporal and lives in `veh.ownership_history`
(`supabase/migrations/20260720092000_veh_vehicles.sql:10-11`,
`supabase/migrations/20260720099000_veh_ownership_history.sql:47`). Three read operations bridge the
domains: `crm.customer-vehicle-list`, `veh.vehicle-relationship-list`
(`apps/api/src/app/api/v1/vehicles/[vehicleId]/relationships/route.ts:26`) and
`veh.vehicle-ownership-history`.

**Does not exist:** a customer reference on a work order. The identifier `customer_id` appears in
**zero** of the 124 migrations, and no `wo.*` table carries a foreign key into `crm` — every
`REFERENCES crm.business_partners` in the tree is in a `crm`, `veh`, `apt`, `rec` or `sal`
migration. The `work-order` module mentions "customer" on 95 lines
(`apps/api/src/modules/work-order`, 97 occurrences), and not one of them is a customer reference on
a work order: they are the `wo.customer_approvals` vocabulary and the additional-work decisions that
hang off it, plus one audit-classification comment
(`application/job-assignment-service.ts:417`). Columns _named_ for a customer do exist elsewhere —
`customer_approval_id`, `customer_class`, `customer_owned`, `customer_pay_amount` — and none of them
is a partner reference either.

**Why this cannot be faked:** the honest answer to "who is this work order for?" is a point-in-time
question against ownership history, resolved server-side against the correct date. A client that
chains a vehicle read to an ownership read and picks the first row will be wrong for every transfer,
every fleet vehicle and every beneficial owner — the ownership model explicitly allows several
concurrent roles: `ownership_kind` is `registered_owner | beneficial | fleet`
(`supabase/migrations/20260720099000_veh_ownership_history.sql:72`) and only `registered_owner` is
made non-overlapping (`:82-84`), so beneficial and fleet holders coexist with it by design.

**What PRE-P1-29 may do:** record it, and state the intended resolution path (work order → vehicle →
ownership at the work order's opening date) as a P1-29 Backend obligation rather than performing it
in a screen.

### B4 — Branch-wide job queue read

**Exists:** `wo.work-order-list` reads the work orders of one branch
(`apps/api/src/app/api/v1/work-orders/route.ts:67-73`). Per-technician assignments are readable at
`apps/api/src/app/api/v1/technicians/[technicianProfileId]/queue/route.ts:31-37`, scoped to one
technician profile. A job's assignment history is readable at
`apps/api/src/app/api/v1/jobs/[jobId]/assignments/route.ts:131-141`, and requires
`tech.technician.read` rather than a work-order permission — the route's own comment explains that
who worked a vehicle is employee-derived data, so a caller who may read the board is not thereby
entitled to the roster.

**Does not exist:** any operation that lists jobs. `/work-orders/{workOrderId}/jobs` is
POST-only — the file registers `wo.job-create` and exports only a POST handler
(`apps/api/src/app/api/v1/work-orders/[workOrderId]/jobs/route.ts:49`, `:63`). `/jobs/{jobId}` is
PATCH-only — it registers `wo.job-update` and exports only a PATCH handler
(`apps/api/src/app/api/v1/jobs/[jobId]/route.ts:52`, `:66`). There is no job list at branch scope,
no job list at work-order scope, and no single-job read at all.

**The precise statement:** a job can be created, updated, transitioned, assigned and historically
audited. It cannot be read.

**Why this cannot be faked:** there is no sequence of existing calls that produces a branch job
board. Even fanning out over every work order in a branch would not work, because the per-work-order
job list does not exist either.

### B5 — Branch-wide QC queue read

**Exists:** `qms.qc-record-list` at
`apps/api/src/app/api/v1/work-orders/[workOrderId]/quality-controls/route.ts:76-82` — scoped to one
work order and gated on `qms.quality_control.read`.

**Does not exist:** any QC read that spans a branch. Thirteen `qms` operations ship; none lists
across work orders.

**What PRE-P1-29 may do:** record it. A QC supervisor's queue is a P1-29 read contract. Building it
by iterating the work-order list would be both wrong under paging and a genuine performance defect,
and every one of those calls is registered with an `expensive-read` rate-limit policy.

### B6 — Assignment notifications

**Exists:** a complete notification surface — `shared.notification-enqueue`,
`shared.notification-list`, `shared.notification-read` and `shared.notification-delivery-list`
(`apps/api/src/app/api/v1/notifications/route.ts:49`, `:115`, and the two routes beneath it), with a
dispatcher at `apps/api/src/modules/shared-services/application/message-dispatcher.ts`.

**Does not exist:** any domain event that raises a notification. `job-assignment-service.ts` contains
zero mentions of notification, and only three files in the whole API reference the dispatcher or the
enqueue operation — the enqueue route itself, the dispatcher, and the shared-services module index.
Nothing in work orders, jobs, quality control or reception enqueues anything.

**The precise statement:** notifications must be asked for explicitly by a caller. Assigning a job
notifies nobody.

**Why this cannot be faked:** a client that polls its own assignment queue and renders a badge is not
a notification — it is a poll that stops when the tab closes, and it will be described to the Owner
as a notification. Do not build it.

### B7 — Unified work-order history

**Exists:** three separate append-only histories —
`wo.work-order-history` (`apps/api/src/app/api/v1/work-orders/[workOrderId]/history/route.ts:35-41`,
the status history of one work order), `wo.job-history`, and the assignment history of B4. The
vehicle side has its own: `veh.vehicle-history`, `veh.vehicle-ownership-history`,
`veh.vehicle-odometer-history`, `veh.vehicle-plate-history`. The customer side has
`crm.customer-history` and `crm.customer-timeline`.

**Does not exist:** an operation that merges them into one chronology.

**Why this cannot be faked:** interleaving several paged, independently ordered feeds in a browser
produces a list that is correct only on the first page. This platform has already shipped that
defect once — a paged read that answered for the whole set from page two
(`docs/phase-1/phase-1-28/evidence/closure-evidence.md:68-69`) — and it was found by hand after
every automated tier was green.

**What PRE-P1-29 may do:** record it. Individual histories may be shown as what they are, separately
labelled. They may not be presented as one timeline.

---

## 5. Authorized here, though it may look like P1-29 work

Two items in §3 will look, to a reader who knows the phase map, like they belong in P1-29. They do
not. Both were authorized by the Owner on 2026-08-22, and both are corrections to the platform's
foundation rather than features of the operational phase.

### 5.1 Multi-company identity schema remediation

**The authorized direction:** global identity → membership(s) → tenant/company → branches →
roles/grants. One **active** tenant per request is retained. The difference is that one identity may
**choose** among the memberships it is authorized for, before the request's tenant context is
finalized. No tenant identifier is ever an input from the client.

**Why this is remediation and not a feature.** `iam.user_accounts` carries a unique index on the
external identity — provider plus subject — with **no tenant in the key**, over non-deleted rows
(`supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:109-110`). One live external
identity therefore resolves to exactly one tenant, platform-wide. That is not an accident of
implementation; it is load-bearing. The authentication service relies on it explicitly: a lookup that
does not yet know its tenant has nowhere in the database it is permitted to run, because row-level
security restricts account reads to the current tenant and the platform holds zero
`SECURITY DEFINER` routines by CI-asserted invariant — so the provider directory is the only
tenant-agnostic lookup that exists
(`apps/api/src/modules/iam/application/authentication-service.ts:318-338`). Request-time scope
resolution reads the same key (`apps/api/src/server/context/resolve-context.ts:63-68`).

The consequence is a hard product limit, and it is worth naming at the right level: **one external
identity cannot belong to two tenants.** Inside a single tenant the platform is already
multi-company — `resolveScopeFor` aggregates `company_ids` and `branch_ids` across every active
grant (`apps/api/src/server/context/resolve-context.ts:79-91`, `:101`), so one person may hold
authority in several companies of the same tenant. What no schema permits is the same person
existing in two tenants at once. For a commercial product sold to many tenants that is a defect in
the identity model, and it is the reason this work is authorized before P1-29 rather than during
it — every operational screen P1-29 builds would otherwise inherit it.

**What must not change.** The retained guarantees are: one active tenant per request; no tenant
identifier accepted as input; and the _server_ deciding which tenant a request runs in. Login is
email and password only — the form has no tenant field and the schema parses exactly two fields
(`apps/web/src/features/authentication/schemas/credentials.ts:53-66`,
`apps/web/src/features/authentication/components/LoginForm.tsx`); the tenant appears only in the
response.

**The one contract that contradicts this today.** The API login body still accepts an optional tenant
identifier (`apps/api/src/app/api/v1/auth/login/route.ts:41`). Its docblock is careful — it is a
lookup key, never a grant, cross-checked against the binding the provider reports, and a
disagreement is denied with the same generic failure as a wrong password — and it is kept optional
only so existing callers can migrate. The web client never sends it. Under the Owner decision the
field is now removable, which is deliverable D7.

**How membership choice must work.** The choice is among memberships the identity is _already_
authorized for, presented by name, resolved server-side. It is not a tenant identifier entered by a
human and it is not a client-side switch. Anything that lets a client name a tenant it is not
already bound to is out of scope by construction.

### 5.2 Platform Superadmin bootstrap authority

**The authorized direction:** a control-plane principal — explicitly **not** a tenant Company Owner —
that may create the first tenant/company, its initial branch, the initial Company Owner, and the
initial role and grant set.

**Why this is needed at all.** No _operation_ creates a tenant, a company or a branch. The API's
only writes into the `org` schema are an in-place update of three `org.tenants` profile columns
(`apps/api/src/modules/iam/data/organization-repository.ts:88`), append-only settings rows (`:197`,
`:231`), and a branch **status** transition with its history row
(`apps/api/src/modules/shared-services/data/transition-repository.ts:95`, `:119`). Not one of them
inserts an organization.

Creation exists, but only outside the request path, and this must be stated exactly rather than
overstated. `org.provision_organization()` — a `SECURITY INVOKER` function granted to no application
role (`supabase/migrations/20260717107000_org_provisioning.sql:84`, `:281`) — creates the tenant
(`:132`), its status history (`:142`), the subscription (`:158`), the legal company (`:172`), the
branch (`:187`), settings, feature overrides and number sequences in one idempotent transaction. It
is driven by an operator runner, `scripts/db/provision-organization.mjs`, which connects as the
database owner and **explicitly permits `ROOTLCO_ENV=production-pilot`** as well as `local-pilot`,
and it is documented as a runbook (`docs/database/pilot-provisioning-runbook.md`,
`docs/phase-1/phase-1-3/tenant-provisioning-runbook.md`) under ADR-008, which decides that onboarding
a tenant is a data operation rather than a code operation. Separately, a _developer_ script creates
the same three objects by direct insert for the Owner acceptance environment
(`scripts/dev/owner-acceptance/create-owner-account.mjs:192`, `:202`, `:212`) and refuses to run
against anything but a loopback development database (`:31`).

**The precise statement:** a production tenant, company and branch **can** be created — by an
operator with database-owner credentials, never by the product. What cannot be created by any path
is the tenant's **first administrator**, and the codebase says so in its own words: "No policy here
can create the FIRST administrator of a tenant: with no user accounts, nobody holds
`iam.user.manage`, so `ins_user_accounts_admin` matches nothing"
(`supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:80-85`, headed
_Bootstrap boundary (deliberate, documented, not a defect)_). `org.provision_organization()` inserts
no `iam` row of any kind — no account, no role, no grant — so a freshly provisioned tenant has an
organization and no one who can administer it. The `iam` operations that would do the work each
demand the authority they are supposed to establish: `iam.invitation-create` requires
`iam.user.manage`, `iam.role-create` requires `iam.role.manage`, `iam.grant-issue` requires
`iam.grant.manage` — all evaluated against an authenticated actor inside that tenant, of which a new
tenant has none.

**What "Superadmin" does not mean.** The Owner decision names five forbidden mechanisms explicitly,
and each maps to a real hazard this codebase has already reasoned about:

| Forbidden mechanism                          | Why it is forbidden here                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disabling delegation checks                  | Delegation containment is enforced twice — in the application policy and by a deferred constraint trigger added precisely because the application check had a hole. The pre-remediation gap let an empty scope list skip containment entirely, so the broadest possible delegation was the one nobody checked (`supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql:14-31`) |
| Granting the first user implicit superpowers | An implicit power is one no permission check can see, and therefore one no audit trail explains                                                                                                                                                                                                                                                                                                    |
| Hard-coding an email                         | A principal identified by a literal cannot be revoked, rotated or scoped                                                                                                                                                                                                                                                                                                                           |
| Client-side flags                            | `apps/web/src/lib/permissions.ts` states the rule in its own header: hiding a menu item is not access control. A client-side administrator flag is the exact anti-pattern that file was written to prevent                                                                                                                                                                                         |
| Bypassing row-level security                 | The runtime role is non-owner and does not bypass row-level security. Every administration policy added for the request path is anchored on the current tenant and additionally gated on a catalogue permission — there is no permissive policy (`supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql`, security-implications header)                               |

**What that leaves.** A control-plane principal must be a real, named, revocable principal whose
authority is expressed as permissions and evaluated by the same checks as everyone else's — a
different _scope of authority_, never a different _mechanism of authorization_. The two existing
delegation-containment migrations
(`supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql` and
`supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql`) are the model to
extend, not to work around.

**Boundary with P1-29.** Bootstrap creates the _first_ of each thing so that a tenant can exist.
Day-to-day company and branch administration is deliverable D3 and belongs to the Backend lane of
this initiative. Neither touches operational workflow.

---

## 6. What PRE-P1-29 explicitly does not deliver

| Not delivered                                                                    | Where it belongs                       |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| Departments as an operational dimension (B1)                                     | P1-29 Backend                          |
| Technician roster writes (B2)                                                    | P1-29 Backend                          |
| Work-order-to-customer resolution (B3)                                           | P1-29 Backend                          |
| Job list reads at any scope (B4)                                                 | P1-29 Backend                          |
| Branch-wide QC queue reads (B5)                                                  | P1-29 Backend                          |
| Event-raised notifications (B6)                                                  | P1-29 Backend                          |
| Unified cross-domain history (B7)                                                | P1-29 Backend                          |
| Any operational screen that depends on B1–B7                                     | P1-29 Web                              |
| The typed company/branch identifier surfaces of the deferred tenancy requirement | Deferred; explicitly outside PRE-P1-29 |

Deferring a screen is a legitimate outcome of this document. Building a screen that appears to work
because the data behind it was invented is not.

---

## 7. Two loose ends, and where they now stand

**The tenant-hint helper removal (D6).** The helpers `readTenantHint`, `writeTenantHint` and the
`TENANT_HINT_COOKIE` constant are still present in this checkout at
`apps/web/src/lib/api/session-cookie.ts:43`, `:87` and `:123`, and are equally present on `develop`,
on `chore/pre-p1-29-admin-rbac-ownership` and on
`feature/pre-p1-29-multi-tenant-administration-rbac-workflow`. They are dead on all four: a search of
`apps/web/src` finds no reference to any of the three outside the defining file.

The removal itself exists and is in this checkout, on a fourth branch:
`feature/pre-p1-29-web-coverage-and-tenant-hint`, commit **`d502e07f`** ("test(pre-p1-29): land the
deferred coverage debt, and finish P1-26's carried removal"), whose diff deletes all three symbols
from `session-cookie.ts`. What is **not** true yet is reachability: `d502e07f` is an ancestor of
neither `develop` nor this branch. So D6 is written, not landed, and the open item is a merge rather
than a missing commit.

**Whether B4's missing job read is an omission or a decision — settled: an omission.** Jobs can be
created, updated, transitioned, assigned and audited, but not read. Nothing in the routes or their
docblocks explains the absence, and the phase's own record does not either: the P1-19 task
traceability matrix (`docs/phase-1/phase-1-19/evidence/task-traceability.md`) and endpoint inventory
(`docs/phase-1/phase-1-19/evidence/endpoint-inventory.md`) between them enumerate every P1-19
operation, and neither contains a job list or a single-job read. Ten operations live under
`/jobs/{jobId}` and exactly four of them are GETs — `wo.job-history`, `wo.job-assignment-list`,
`dia.diagnostic-list`, `tech.labor-session-list` — every one a history or a child collection, never
the job itself. No task id was ever raised for a job read, and no P1-19 document records
the gap as deliberate. It is therefore an unrecorded omission and a genuine P1-29 Backend obligation,
not a design decision PRE-P1-29 would be overriding.

---

_Every claim in this document about the codebase was measured against the working tree on branch
the seal-archival branch (since merged to protected `develop` as `b969894c`), 124 migrations (the same count on `develop`), 2026-08-22,
and then re-verified claim by claim against that same tree. Where a claim is a negative — "no
operation exists", "no column exists" — it was established by an exhaustive search of the named
directory, not by sampling._

_The re-verification did not leave the document unchanged, and the changes were corrections rather
than hedges. The ones that reversed a stated fact: organization administration is not empty (eight
settings-and-status operations exist, §2); three reads bridge customer and vehicle, not two (B3);
columns named for a customer do exist, while `customer_id` does not (B3); the identity limit is one
**tenant** per identity, not one company (§5.1); a production tenant, company and branch **can** be
created, by `org.provision_organization()` through `scripts/db/provision-organization.mjs` under
`ROOTLCO_ENV=production-pilot` — the thing that cannot be created is the tenant's first
administrator (§5.2); the D6 removal commit exists in this checkout on
`feature/pre-p1-29-web-coverage-and-tenant-hint` and is merely unmerged (§7); and B4's open question
is answered by the P1-19 evidence already in the repository (§7). Line ranges, reference counts and
the department search were tightened in the same pass._
