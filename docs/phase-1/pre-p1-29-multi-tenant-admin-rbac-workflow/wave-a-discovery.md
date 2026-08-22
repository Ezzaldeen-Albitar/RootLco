# PRE-P1-29 — Wave A discovery

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 1. The governing rule

**Do not code around capability that already exists, and never duplicate a canonical permission under a new name.**

This is not a style preference. The platform has exactly one permission catalogue, it is pinned by a CI baseline, and the database refuses to let a tenant administrator invent a code. A second name for an authority that already has one produces two half-enforced rules where there was one enforced rule, and the audit trail can no longer be queried completely.

The rule has three practical consequences for every task in this initiative:

1. **Before proposing a permission code, read `supabase/seeds/04_iam_permission_catalog.sql`.** If the authority is already named there, use that name. If it is genuinely a different authority, say in one sentence why the existing code does not cover it — the catalogue file itself models this discipline in prose beside almost every block it added (for example the Phase 1-21 inventory block at `:48-51`: "inv.stock.operate already covers reserve/release/issue/return/damage by its own description, and inv.adjustment.approve already covers opening-batch approval, so neither is duplicated").
2. **Before proposing an operation, check the registry.** 305 operations are registered and every one is asserted by a test — `scripts/check-operation-test-coverage.mjs` carries exactly 305 manifest entries and fails on a registered operation absent from the manifest (`:2735`) or a manifest entry naming an operation that is not registered (`:2879`). Adding a second operation on an existing path is refused at module load by `defineOperation` (`apps/api/src/server/auth/operation-registry.ts:174-180`, "Route … is already claimed by operation").
3. **Before proposing a table, function or policy, check the migrations.** A surprising amount of the multi-company administration model is already in the database with grants and policies attached, and is simply unreachable because no API operation calls it. Section 3 names each case.

---

## 2. Evidence basis and method

Every claim below was measured against the working tree at `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco`, on branch the seal-archival branch (since merged to protected `develop` as `b969894c`) (`4e5e20d0`). Where a claim is about `develop`, it was measured against `develop` specifically and is labelled as such.

That distinction turns out to cost nothing for every figure except one. `git diff --stat develop the seal-archival branch (since merged to protected `develop`as`b969894c`) -- supabase apps` is **empty**: the branch changes no migration, no seed, no API source and no web source, so every count, line number and file path below reads the same on `develop`. The single exception is §6's tenant-hint finding, which is about a _third_ branch and is labelled there.

That checkout is shared between concurrent sessions and moved branch during this verification pass, which is why the figures are pinned to a named ref rather than to "the working tree".

| Figure                      | Value                                           | Where it is pinned or measured                                                                                    |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Migrations                  | 124 (identical on `develop` and on this branch) | `.github/ci-baselines/schema-baseline.json` (`migrationCount`)                                                    |
| Business schemas            | 17, plus `extensions`                           | `supabase/migrations/0002_base_schemas.sql` and later module migrations                                           |
| Tables created by migration | 248                                             | Counted from `CREATE TABLE` across `supabase/migrations`; equals `schema-baseline.json` `structuralTotals.tables` |
| Permission codes            | 112, across 17 domain prefixes                  | `supabase/seeds/04_iam_permission_catalog.sql`; pinned as `permissionCount`                                       |
| Registered API operations   | 305                                             | `tests/ci/repository-paths.test.ts:221`                                                                           |
| Web page routes             | 35                                              | `apps/web/src/app/[locale]/**/page.tsx`                                                                           |

Ownership profiles for this initiative already exist and already separate the lanes: `pre-p1-29-initiative`, `pre-p1-29-backend` and `pre-p1-29-web` are defined at `scripts/ci/check-phase-ownership.mjs:372`, `:398` and `:429`, and bound to branch prefixes at `.github/ci-baselines/phase-ownership-profiles.json:112-126` (`feature/pre-p1-29-backend-` at `:113`, `feature/pre-p1-29-web-` at `:118`, the integration branch at `:123`). A fourth entry at `:108` maps the `chore/pre-p1-29-` prefix to `repository-tooling`, not to a lane. The mapping file records why the integration branch is matched by its **full** name rather than a prefix: a prefix would swallow both lane branches and hand each lane the other half of the product.

---

## 3. Tenancy and the organization hierarchy

### What exists

The hierarchy is complete in the database and has been since Phase 1-3. Seventeen tables in the `org` schema, created by five migrations:

| Table                                                         | Migration and line                                        | What it holds                                        |
| ------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `org.tenants`                                                 | `20260717101000_org_tenants.sql:87`                       | The tenant record and its lifecycle status           |
| `org.tenant_status_history`                                   | same file, `:135`                                         | Append-only status history                           |
| `org.subscription_plans`                                      | `20260717102000_org_subscriptions.sql:104`                | Plan versions with effective ranges                  |
| `org.tenant_subscriptions`                                    | same file, `:206`                                         | A tenant's subscription assignment                   |
| `org.feature_flags`                                           | same file, `:68`                                          | Named capabilities a tenant may hold                 |
| `org.legal_companies`                                         | `20260717103000_org_companies_branches.sql:53`            | Legal companies inside a tenant                      |
| `org.branches`                                                | same file, `:116`                                         | Branches inside a company                            |
| `org.branch_status_history`                                   | same file, `:219`                                         | Branch status history with a forge-proof actor stamp |
| `org.departments`                                             | `20260717104000_org_operational_structure.sql:109`        | Departments inside a branch                          |
| `org.warehouses`, `org.storage_locations`, `org.cost_centers` | same file, `:157`, `:210`, `:267`                         | Operational structure                                |
| `org.company_settings`, `org.branch_settings`                 | `20260717105000_org_settings_tax_features.sql:91`, `:127` | Versioned settings per scope                         |
| `org.tax_classes`, `org.tax_rates`                            | same file, `:168`, `:207`                                 | Tax configuration                                    |
| `org.tenant_feature_overrides`                                | same file, `:262`                                         | Per-tenant feature overrides                         |

**A complete provisioning transaction already exists.** `org.provision_organization(spec, idempotency_key)` at `supabase/migrations/20260717107000_org_provisioning.sql:84` creates, in one transaction: tenant, initial status-history row, subscription, legal company, pilot branch, company settings, branch settings, feature overrides, number-sequence configuration, an optional activation, and its own idempotency record. A failure at any step rolls back everything including the idempotency row, so a partially provisioned tenant cannot exist. A replay of the same key with the same request returns the stored result and creates nothing; the same key with a different request is refused.

It is `SECURITY INVOKER` (`:90`), `REVOKE EXECUTE … FROM PUBLIC` at `:281`, and the file's closing line reads "Deliberately granted to no application role." The function comment names the intended callers: "controlled seed packages and, later, the Phase 1-14 backend". **The bootstrap mechanism is already written.** What it does not do is create the first user, the first role, or the first grant — see §4 and §10.

**Write capability on the hierarchy already exists at the runtime role.** `GRANT SELECT, INSERT, UPDATE` on `org.legal_companies` at `20260717103000_org_companies_branches.sql:422` and on `org.branches` at `:424` (the `:423`/`:425` grants beside them are the `app_readonly` SELECTs), and on `org.departments` at `20260717104000_org_operational_structure.sql:422`. Matching RLS insert and update policies exist at `20260717103000…:369`, `:373`, `:389`, `:396` and `20260717104000…:336`, `:343`.

**Branch activation and deactivation is a shipped workflow.** `shared.branch-status-read` and `shared.branch-status-change` (`apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:34`, `:47`) drive the shared transition engine, whose only registered aggregate is `org.branch` (`apps/api/src/modules/shared-services/domain/transitions.ts:56-64`, with its two transitions at `:76-97`). Both directions require `org.settings.manage`, both are branch-scoped, both demand a reason, and the write is version-guarded. (The read is gated on `org.branch.read`, not on `org.settings.manage`.)

### What does not exist

- **No operation lists companies. No operation lists branches.** Every `org` read operation below the tenant takes an identifier the caller must already possess: `iam.company-settings-read` at `/org/companies/{companyId}/settings`, `iam.branch-settings-read` at `/org/branches/{branchId}/settings`. (`iam.tenant-settings-read` at `/org/tenant` takes no identifier at all — the tenant comes from the session.) The only other consumers of `org.branch.read` are the branch-status read and an export policy rule (`apps/api/src/modules/shared-services/domain/export-policy.ts:177`). That export rule is the nearest miss and it does not close the gap: `shared.export-authorize` produces no file and returns no rows — its own header says "**No file is produced**" and the response carries `generated: false` — and `shared.export-catalogue` returns field metadata only. There is no directory.
- **No operation creates a company, a branch or a department through the request path.** The grants and policies in the paragraph above have no caller.
- **The three write policies on the hierarchy gate on tenancy and scope only — not on a permission.** `ins_legal_companies_tenant` checks `tenant_id = iam.current_tenant_id()` and nothing else; `ins_branches_scope` adds the company narrowing array; `ins_departments_scope` adds the company **and** branch narrowing arrays. Contrast this with the IAM administration policies added later, which additionally call `iam.has_permission(...)` (§4). So `org.company.manage`, `org.branch.manage` and `org.department.manage` are enforced by **no** policy and referenced by **no** code.

---

## 4. IAM — users, roles, permissions, grants, invitations

### What exists

Seventeen tables in the `iam` schema:

| Group                  | Tables                                                                              | Migration                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Identity               | `user_accounts`, `user_profiles`, `user_employee_links`, `user_status_history`      | `20260718090000_iam_user_accounts_and_profiles.sql:66`, `:123`, `:166`, `:209` |
| Authorization model    | `permissions`, `roles`, `role_permissions`                                          | `20260718091000_iam_roles_and_permissions.sql:48`, `:83`, `:121`               |
| Delegation             | `role_grants`, `grant_scopes`                                                       | `20260718092000_iam_role_grants_and_scopes.sql:63`, `:118`                     |
| Limits and sensitivity | `approval_limits`, `sensitive_data_permissions`                                     | `20260718093000_iam_approval_and_sensitive_data.sql:46`, `:109`                |
| Sessions               | `login_audit`, `user_sessions`                                                      | `20260718094000_iam_login_and_sessions.sql:44`, `:97`                          |
| Audit                  | `audit_records`, `audit_record_details`, `audit_integrity_links`, `security_events` | `20260718095000_iam_audit_subsystem.sql:50`, `:84`, `:109`, `:134`             |

`iam.user_accounts` stores **no credential of any kind**. It references the external identity by provider name and provider subject only; the identity provider is the credential authority (table comment, `20260718090000…:98`).

**Authorization resolution lives in the database, in two functions.** `iam.has_permission(code)` (`20260718097000_iam_context_and_permission_functions.sql:71`) is deliberately tenant-wide and scope-blind: true only when the current session's active, in-tenant user holds the code through an active grant with an allow mapping and no deny mapping. `iam.has_permission_in_scope(code, company, branch, department)` (`:127`) adds scope: deny precedence stays global, and an allow counts only when the granting grant is unrestricted or carries a matching company, branch or department scope row. Session context comes from four readers defined at `supabase/migrations/0002_base_schemas.sql:108`, `:118`, `:128`, `:143`; an unset tenant is NULL, and RLS comparisons against NULL match no rows, so default-deny is structural.

**Delegation containment exists at both layers.** The runtime administration migration `20260726090000_iam_org_runtime_administration_capabilities.sql` grants the request role exactly the writes IAM administration needs (`:116`-`:174`) and attaches nineteen policies. Seventeen are anchored on tenant **and** an existing permission code; the two exceptions are `ins_user_sessions_self` (`:218`) and `upd_user_sessions_self` (`:222`), which anchor on tenant plus `user_id = iam.current_user_id()` — a principal writing its own session row, which is not an administrative act. (`ins_login_audit_self` at `:254` admits either: the acting principal's own row, or `iam.user.manage` for a lockout row written about somebody else.) Two of the nineteen carry the escalation rule directly:

- `ins_role_permissions_delegable` (`:299`) refuses an `allow` mapping unless the acting administrator currently holds the permission being mapped. An administrator with `iam.role.manage` cannot mint themselves an authority by adding it to a role. `deny` mappings are unconditional, because removing authority is never an escalation.
- `ins_role_grants_delegable` (`:370`) applies the same test to grants.

`20260727090000_iam_grant_delegation_scope_backstop.sql` closes the gap the first pair could not see. `iam.has_permission` is scope-blind by design, so it proves an administrator holds a permission _somewhere_ in the tenant, never that they may delegate it tenant-wide. A deferred constraint trigger (`tg_role_grants_delegation_authority` and `tg_grant_scopes_delegation_authority`, both `DEFERRABLE INITIALLY DEFERRED`, at `:248` and `:253`) now refuses an unrestricted grant issued by a scoped administrator, and requires every scope row of a delegated grant to be covered by a scope the actor holds — company covers its branches and departments, a branch covers its departments but **not** its company, a department covers only itself (`:49-55`). The application mirror is `DelegationPolicy.assertScopeWithinAuthority` at `apps/api/src/modules/iam/domain/delegation-policy.ts:189-200`, with a uniform denial that never reveals whether the target scope exists.

**The bootstrap boundary is already named, in that migration's own words.** The backstop's first rule is: no acting runtime principal (`iam.current_user_id() IS NULL`) means this is not a delegated request, and the provisioning path — ADR-008, `org.provision_organization` — sets no `app.user_id`, "so the bootstrap boundary is preserved untouched" (`20260727090000…:41-45`). A platform superadmin bootstrap has a defined seam to occupy. It does not need a new exemption, a disabled check, or an RLS bypass.

**User provisioning is invitation-shaped.** There is no "create user" operation. `iam.invitation-create` (`apps/api/src/app/api/v1/iam/invitations/route.ts:35-46`, permission `iam.user.manage`, tenant scope, idempotent, audited as `iam.user.invited`) invites an identity into the caller's tenant and creates the invited account. `iam.invitation-cancel` and `iam.invitation-activate` complete the lifecycle.

### What does not exist

- **No membership table.** There is no table anywhere in the 248 that associates one human identity with more than one tenant. `iam.user_accounts.tenant_id` is `NOT NULL` and immutable (`tg_user_accounts_immutable`, `20260718090000…:115-118`), so an account belongs to exactly one tenant for its whole life.
- **No platform-level principal table.** There is no control-plane identity distinct from a tenant account.

---

## 5. The permission catalogue

### What exists

`supabase/seeds/04_iam_permission_catalog.sql` holds **112 rows across 17 domain prefixes** and contains the **only** `INSERT INTO iam.permissions` in the shipping tree (line 15). **Zero migrations insert a permission row** — measured, not assumed.

| Prefix   | Codes | Prefix | Codes | Prefix | Codes |
| -------- | ----- | ------ | ----- | ------ | ----- |
| `rec`    | 12    | `wo`   | 9     | `dia`  | 4     |
| `sal`    | 10    | `org`  | 9     | `tech` | 4     |
| `iam`    | 10    | `inv`  | 9     | `rpt`  | 3     |
| `crm`    | 10    | `veh`  | 7     | `quo`  | 3     |
| `shared` | 6     | `svc`  | 5     | `wty`  | 2     |
| `qms`    | 5     | `apt`  | 4     |        |       |

The single-source rule is enforced, and it has already caught a violation. `20260815090000_shared_reception_evidence_foundation.sql:19-30` records that a first draft of that migration shipped a permission row and seven catalogue rows, and the migration-replay gate refused it: "a migration that ships rows is a migration that ships someone's data." Both moved to the seed files. The note also records why a local `supabase db reset` could never have caught it — it applies migrations and seeds together — and that only the static gate could tell the two apart.

The count is pinned twice. `permissionCount: 112` in `.github/ci-baselines/schema-baseline.json`, re-proved on every replay run by `scripts/ci/migration-replay-checks.mjs:238-240`.

The catalogue is read-only to the request path by design. `20260726090000…` states it plainly: permission codes are platform reference data, and "a tenant administrator may map them, never invent them."

The catalogue is readable through the API: `iam.permission-list` at `GET /iam/permissions` (`apps/api/src/app/api/v1/iam/permissions/route.ts:21-29`), gated on `iam.role.read`.

### Register — seeded codes that no operation declares

Ninety-nine of the 112 codes appear in at least one operation's `permissions` list. Thirteen do not. This is the register Wave B should work from, because each row is either a missing surface or a code that should never have been minted.

Two columns need a definition, because the distinction is the whole point of the table. **"Referenced"** counts every occurrence of the literal code string in that tree, _including_ docblocks and comments — a code named only in prose is named by nothing that runs. **"Named by an RLS policy"** counts `CREATE POLICY` statements whose predicate calls `iam.has_permission…` with that code; a code consulted by a trigger function is enforcement too, but it is not a policy, and the rows below say which is which.

| Code                                          | Referenced in `apps/api/src`                                                                           | Referenced in `apps/web/src`   | Named by an RLS policy                                                                                                 | Reading                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org.company.manage`                          | 0                                                                                                      | 0                              | 0                                                                                                                      | Dead. Company creation has grants and policies but no caller and no permission gate.                                                                                                                                                                                                                                                                                                                                                            |
| `org.branch.manage`                           | 0                                                                                                      | 0                              | 0                                                                                                                      | Dead. Same shape as above.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `org.department.manage`                       | 0                                                                                                      | 0                              | 0                                                                                                                      | Dead. Same shape as above.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `org.subscription.manage`                     | 0                                                                                                      | 0                              | 0                                                                                                                      | Dead, and further from reachable than the three above: `org.subscription_plans`, `org.tenant_subscriptions` and `org.feature_flags` carry **SELECT-only** grants (`20260717102000_org_subscriptions.sql:312-314`) and three SELECT-only policies (`:293`, `:298`, `:302`). No write grant, no write policy, no operation.                                                                                                                       |
| `org.tax.manage`                              | 0                                                                                                      | 3, all prose or a constant map | 0                                                                                                                      | Named in the web permission map (`apps/web/src/features/administration/shared/permissions.ts:46`) and twice in comments explaining that the tax screen deliberately does **not** require it (`administration/page.tsx:73`, `config/navigation.ts:473`). Nothing enforces it.                                                                                                                                                                    |
| `inv.item.manage`                             | 0                                                                                                      | 0                              | 0                                                                                                                      | Dead.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `rpt.report.configure`                        | 1, prose only (`modules/reporting/data/report-catalogue-repository.ts:95`)                             | 0                              | 0                                                                                                                      | Dead. The one reference is a docblock describing writes that no operation performs.                                                                                                                                                                                                                                                                                                                                                             |
| `sal.reversal.approve`                        | 1, prose only (`modules/iam/application/access-administration-service.ts:212`)                         | 0                              | 0                                                                                                                      | Dead. The one reference uses the code as a worked _example_ of an escalation the delegation policy refuses.                                                                                                                                                                                                                                                                                                                                     |
| `wo.work_order.create`                        | 0                                                                                                      | 0                              | 0                                                                                                                      | Not a defect: a work order is only ever created by converting a reception visit (`rec.reception-convert-to-work-order`, permission `rec.reception.convert`) — there is no `POST /work-orders` among the 26 `wo.*` operations. The code names an authority the product does not offer.                                                                                                                                                           |
| `wty.policy.manage`                           | 3, prose only (`app/api/v1/warranties/[warrantyId]/route.ts:6`, `modules/warranty/index.ts:28`, `:94`) | 0                              | 0                                                                                                                      | Dead. All three references argue _against_ borrowing it for warranty issuance.                                                                                                                                                                                                                                                                                                                                                                  |
| `iam.login.view_all`                          | 0                                                                                                      | 0                              | 1 (`sel_login_audit_admin`, `20260718098000_iam_rls_grants_hardening.sql:71-73`)                                       | Enforced in the database, unreachable through the API.                                                                                                                                                                                                                                                                                                                                                                                          |
| `inv.cost.view`                               | 7, all prose                                                                                           | 0                              | 9 (`sel`/`ins`/`upd` on `inv.item_cost_details`, `inv.stock_adjustment_details`, `inv.external_purchase_part_details`) | Enforced, but **entirely by RLS**, not by any application-layer check: all seven `apps/api/src` occurrences are docblocks that describe the RLS gate. Not an operation-level requirement.                                                                                                                                                                                                                                                       |
| `rec.reception.receiving_employee.assign_any` | 1, prose only (`app/api/v1/reception-catalogue/receiving-employees/route.ts:29`)                       | 3                              | 0                                                                                                                      | Enforced in the database, but by a **trigger function, not a policy**: `rec.stamp_receiving_employee_identity` calls `iam.has_permission_in_scope(...)` at `20260815093000_rec_receiving_employee_identity.sql:184`. The web constant `RECEIVING_EMPLOYEE_CROSS_BRANCH_PERMISSION` (`features/receptions/people/receiving-employee-directory.ts:94`) exists, in its own words, "only to be asserted against the seed catalogue and never sent". |

**Three** of the `org.*` rows are the heart of this initiative — `org.company.manage`, `org.branch.manage`, `org.department.manage`: **the authority is named, the storage is built, the write grants are issued, the RLS policies are in place — and nothing calls any of it.** `org.subscription.manage` is a fourth `org.*` dead code but a different shape: for it, the write grants and write policies do not exist either.

### One catalogue drift, and it is in the web tier

`apps/web/src/config/navigation.ts` declares 32 permission requirements carrying a code — 23 distinct codes — plus two items with `permission: null` (`:117`, `:513`). Thirty of the 32 resolve against the catalogue; 21 of the 23 distinct codes do. Two do not:

| Location                                           | Code declared       | Real seeded code                                         |
| -------------------------------------------------- | ------------------- | -------------------------------------------------------- |
| `apps/web/src/config/navigation.ts:297` (Billing)  | `sal.invoice.read`  | `sal.finance.view` (`04_iam_permission_catalog.sql:66`)  |
| `apps/web/src/config/navigation.ts:306` (Delivery) | `sal.delivery.read` | `sal.delivery.view` (`04_iam_permission_catalog.sql:70`) |

Because `hasPermission` matches by exact membership, a code that exists nowhere is held by nobody, and both navigation items are permanently invisible to every operator. Both are marked `status: 'planned'`, so today the effect is cosmetic — but the correct repair is to point at the seeded code, **not** to seed the code the navigation invented.

---

## 6. Authentication and session

### What exists

Sign-in is **email and password only**. `loginSchema` (`apps/web/src/features/authentication/schemas/credentials.ts:53-66`) parses exactly two fields. The schema's own header states why there is no tenant field: asking a person to type a tenant identifier "was never a product; it was a contract leaking through the interface", and the alternatives are hard-coding a tenant or handing an unauthenticated page a tenant directory, which is an enumeration oracle at the door.

Tenant is resolved **server-side, from the verified identity**. `AuthenticationService.resolveTenant` (`apps/api/src/modules/iam/application/authentication-service.ts:338-356`) takes the binding the provider reports (`app_metadata.tenant_id`, written by the service role at invitation and not editable by the end user, ADR-019). The method's docblock names the structural reason the database cannot answer the question instead: `sel_user_accounts_tenant` (`supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:335`) restricts `SELECT` on `iam.user_accounts` to the current tenant, and the platform holds **zero** `SECURITY DEFINER` routines by CI-asserted invariant, so a lookup that does not yet know its tenant has nowhere it is permitted to run. The invariant is not aspirational: across all 124 migrations the phrase `SECURITY DEFINER` occurs eight times and every one of the eight is inside a comment; no routine declares it.

**One live external identity resolves to exactly one tenant, platform-wide.** `uq_user_accounts_provider_identity_active` is `UNIQUE (identity_provider, provider_subject) WHERE deleted_at IS NULL` — no tenant in the key (`supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:109-110`). The service's own comment calls this "unambiguous by construction, not by convention".

The backend contract still _accepts_ an optional tenant identifier (`LoginRequest.tenantId`, `authentication-service.ts:103-115`), but it is a cross-check, never a steer: a caller that names a tenant other than the one the identity is bound to is refused rather than silently redirected (`:348`), and the docblock states "Either way it is a lookup key, never a grant." No RootLco client sends it.

The session the web tier receives is entirely server-resolved: `SessionSummary` (`apps/web/src/features/authentication/types/session.ts`) carries user, tenant, email, display name, resolved company identifiers, resolved branch identifiers and the permission set. An **empty** company or branch array means unrestricted within the tenant, not no access — `isUnrestrictedScope` in the same file, matching `actorUnrestricted` in the backend delegation policy so the two cannot drift.

The identity-provider port (`apps/api/src/modules/iam/provider/identity-provider.ts`) declares twelve capabilities in RootLco vocabulary and returns no provider SDK type. Three of its rules matter here: nothing it returns is authorization; credential material never crosses back; every failure is a catalogued RootLco error with no provider message, so the login endpoint is not an account-enumeration oracle.

Session cookie handling fails closed. `sessionCookieAttributes` (`apps/web/src/lib/api/session-cookie.ts:59`) marks the cookie secure unless the environment is _exactly_ the string `local`; an unset or misspelled value produces a secure cookie.

### What does not exist

- **No tenant chooser, anywhere.** There is no screen, operation or field through which an authenticated identity selects among tenants.
- **No multi-tenant binding in the provider port.** `ProviderIdentity.tenantId`, `ProviderSession.tenantId` and `VerifiedToken.tenantId` are each `string | null` — one tenant, or none. There is no membership list on the port.

### A correction to the briefing

The briefing states that the dead tenant-hint helpers were removed from `apps/web/src/lib/api/session-cookie.ts`. **On `develop` they are still present**: `TENANT_HINT_COOKIE` at `:43`, `readTenantHint` at `:87`, `writeTenantHint` at `:123`. The same is true of both `chore/pre-p1-29-*` branches — checked against `chore/pre-p1-29-admin-rbac-ownership` and the seal-archival branch (since merged to protected `develop` as `b969894c`) directly, where the three sit at the same three line numbers. The removal is real but lives on `feature/pre-p1-29-web-coverage-and-tenant-hint`, which is **not** an ancestor of `develop` (`git merge-base --is-ancestor` returns non-zero). On that branch the three helpers are gone — 31 lines deleted from this file — and `sessionCookieAttributes` moves from `:59` to `:56`.

The honest current statement is: the three helpers exist on `develop` with **zero callers** in source — `git grep` over `apps`, `scripts` and `tests` at `develop` returns nothing outside their own file, and the only other matches in the checkout are stale Next.js dev-build chunks under the untracked `apps/web/.next-dev/`. The follow-up is written and not yet landed. This matters because `writeTenantHint` stores a tenant identifier in a cookie explicitly set `httpOnly: false` (`develop`, `:126-128`) for the express purpose of pre-filling a login field that no longer has one, which is precisely the contract leak the login schema's comment says was removed.

---

## 7. The API operation surface

### What exists

**305 registered operations**, asserted at `tests/ci/repository-paths.test.ts:221`, published by 248 `route.ts` modules under 54 top-level directories of `apps/api/src/app/api/v1/`.

The registry is the security metadata, not documentation. `defineOperation` (`apps/api/src/server/auth/operation-registry.ts`) rejects at module load a declaration with no permission codes (`:135-141`), an audited class with no audit action (`:154-159`), an audit action outside the controlled catalogue (`:170-172`), or a second claim on a route already taken (`:176-180`). The no-permissions rule has exactly one escape and it is loud: `public: true` plus a `publicReason` (`:142-146`), which is separately refused if it also declares permissions (`:147-151`). Six operations take it — `iam.auth-login`, `iam.auth-logout`, `iam.auth-password-reset`, `iam.auth-password-reset-completion`, `shared.health-live`, `shared.health-ready` — and no other operation in the 305 declares an empty permission list. `scripts/check-authorization-coverage.mjs` walks the registry and the route tree together and fails CI on either half without the other. The OpenAPI document is generated from the same registry (`apps/api/src/server/openapi/document.ts:26`, `:211`), so code and spec cannot silently diverge. Permission codes on an operation are a **conjunction** — an operation needing "any of" is two operations (`operation-registry.ts:57`).

Distribution by module prefix:

| Prefix   | Ops | Prefix | Ops | Prefix | Ops |
| -------- | --- | ------ | --- | ------ | --- |
| `rec`    | 50  | `apt`  | 21  | `svc`  | 11  |
| `iam`    | 38  | `sal`  | 18  | `tech` | 6   |
| `crm`    | 29  | `inv`  | 14  | `quo`  | 6   |
| `shared` | 28  | `qms`  | 13  | `wty`  | 2   |
| `veh`    | 27  | `dia`  | 13  | `rpt`  | 2   |
| `wo`     | 26  |        |     | `meta` | 1   |

Declared scope across the 305: **167 tenant, 132 branch, 2 company, and 4 that declare no scope
at all** — the public authentication operations `iam.auth-login`, `iam.auth-logout`,
`iam.auth-password-reset` and `iam.auth-password-reset-completion`. The two company-scoped
operations are `iam.company-settings-read` and `iam.company-settings-write`.

The published manifest reports **171** tenant-scoped operations, not 167, because it normalises
those four public operations to `tenant` (`docs/api/openapi.v1.json`, measured: 171 / 132 / 2,
totalling 305). Both figures are true of different things, and the distinction matters wherever the
number is used to describe an authorization weakness: the four are PUBLIC, require no permission,
and are therefore not decided by `iam.has_permission` at all. **167** is the figure for how many
operations the scope-blind evaluation actually governs.

The 38 `iam.*` operations cover: role create/list/update; role-permission add/list/remove/update; grant issue/revoke; grant-scope add/list/remove; permission list; user list/detail/update/status-change; user-session list and revoke-all; invitation create/cancel/activate; auth login/logout/session/password-reset/password-reset-completion; audit-event list/detail; approval-limit list/create/end; tenant-settings read/update; company-settings read/write; branch-settings read/write.

### What does not exist

**No `org.*` operation exists.** Zero. The three route modules under `/org/...` (`tenant`, `companies/[companyId]/settings`, `branches/[branchId]/settings`) and the one under `/organization/...` (`branches/[branchId]/status`) publish their eight operations under the `iam.*` and `shared.*` identifiers listed above; the operation-id namespace `org.` is empty. `org.*` codes appear only as _permissions_ those operations require — `org.tenant.read`, `org.company.read`, `org.branch.read`, `org.settings.manage` — never as an operation id.

This is the single most load-bearing gap in the discovery. The organization administration surface has: 17 tables, write grants and write RLS policies for companies, branches and departments, a provisioning function, five seeded `org.*` permission codes that no operation declares, and **no operations at all** under the `org.` identifier namespace.

---

## 8. Workflow

### What exists

The **generic status-transition engine** (`apps/api/src/modules/shared-services/domain/transitions.ts`) registers aggregates with their history table and legal states, and transitions with their required permission, scope, audit action, event type and reason requirement. Exactly **one** aggregate is registered: `org.branch` (the `AGGREGATES` array at `:56-64`), with two transitions (`TRANSITIONS`, `:76-97`). The header states the rule for extension plainly: aggregates owned by other phases are registered by those phases, with their own rules.

Domain workflow is rich and already shipped. The reception module publishes 50 operations, appointments 21, work orders 26. The pipeline is: appointment → reception visit → authorization → **conversion** → work order → jobs → closure. The single seam between reception and work order is `rec.reception-convert-to-work-order` (`apps/api/src/app/api/v1/receptions/[receptionId]/convert-to-work-order/route.ts:41-51`): permission `rec.reception.convert`, branch-scoped, idempotent, version-guarded, audited as `rec.reception.converted_to_work_order`.

Work-order state machines are seeded reference data, not code: `wo.work_order_states`, `wo.work_order_transitions`, `wo.job_states`, `wo.job_transitions` are among the seven tables the migration-replay gate accepts as legitimately populated on a fresh database (`schema-baseline.json`, `seededStructuralTables`).

### What does not exist

- **No work-order creation operation.** Conversion from a reception visit is the only path, which is why `wo.work_order.create` sits unreferenced in §5.
- **No approval or request workflow for organization administration.** Nothing routes a company or branch creation through an approval.

---

## 9. CRM, Vehicle and the domain modules

### What exists

| Schema                                                         | Tables      | Operations  | Notable surface                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm`                                                          | 21          | 29          | Individual and company customer creation, search, read, timeline, history; contacts, addresses, preferences, consent; alerts, tags, restrictions; duplicate scan/review and merge; vehicle linking                                                                                                                                                |
| `veh`                                                          | 23          | 27          | Vehicle create/read/search/update; plate assignment and history; EV profile; ownership transfer and history; authorized parties; odometer record and history; duplicate scan/review and merge; status change; make/model/trim/body-type/powertrain catalogues                                                                                     |
| `rec`                                                          | 29          | 50          | Reception visits, authorization, party roles, condition evidence, signatures, damage-map evidence bindings, refusal, capture override, close-without-work, conversion, six configuration catalogues (capture policies, damage-map templates, fuel levels, refusal reasons, visit reasons, warning-light codes) and a receiving-employee directory |
| `apt`                                                          | 6           | 21          | Appointments plus three configuration catalogues                                                                                                                                                                                                                                                                                                  |
| `wo`                                                           | 15          | 26          | Work orders, jobs, service lines, required parts, additional-work approval chain, closure                                                                                                                                                                                                                                                         |
| `shared`                                                       | 29          | 28          | Documents and versions with scanning, attachments, notifications and deliveries, message templates with approval and activation, exports, number sequences, status transitions, health                                                                                                                                                            |
| `inv`, `sal`, `svc`, `quo`, `dia`, `qms`, `tech`, `wty`, `rpt` | 91 combined | 85 combined | Inventory and stock, billing/payment/delivery, service catalogue and pricing, quotations, diagnostics, quality control, technicians, warranty, reporting                                                                                                                                                                                          |

The table reconciles against the two totals in §2, which is the only reason it can be trusted as a partition rather than a sample. Tables: 21 + 23 + 29 + 6 + 15 + 29 + 91 = 214, plus `org` 17 and `iam` 17 = **248**. Operations: 29 + 27 + 50 + 21 + 26 + 28 + 85 = 266, plus `iam` 38 and `meta` 1 = **305**.

The CRM and Vehicle permission blocks in the catalogue are the best worked examples of the governing rule in practice. The CRM block separates `crm.customer.profile.write` from `crm.customer.consent.write` on the stated ground that editing a phone number is routine maintenance while a consent decision changes what the platform may do to a person; it separates `crm.customer.governance.manage` from `crm.customer.restriction.manage` because raising an alert and refusing to serve somebody are not the same authority; and it gives `crm.customer.merge` its own high-risk code because a merge is irreversible in practice. The Vehicle block explicitly declines to mint a second read code for restricted identifiers, reusing `iam.sensitive.view` instead.

### What does not exist

Nothing in the domain modules is missing that this initiative needs. They are named here so that Wave B does not go looking for a permission it can reuse and fail to find the existing one.

---

## 10. The web surface

### What exists

Thirty-five page routes under `apps/web/src/app/[locale]/`, in three groups: four auth pages (login, activate account, forgot password, reset password), thirty dashboard pages, and one design gallery.

The administration section has twelve pages: `administration` (index), `users`, `roles`, `permissions`, `approval-limits`, `audit-log`, `organization`, `system-settings`, `taxes`, `currencies`, `languages`, `numbering-rules`.

**Client-side permission evaluation fails closed and is documented as usability-only.** `apps/web/src/lib/permissions.ts` supplies `NO_CAPABILITIES` (`:39`) as the default for every unknown state, matches by exact membership via `includes()` (`:41-49`), and treats a `null` requirement as "not gated" rather than "holds everything" — a distinction the file calls out in a comment because inverting it is cheap and expensive. `visibleNavigation` (`:67`) removes a group whose every item is hidden, on the ground that an empty group heading is both useless and a small information leak. The file's header states the rule: hiding a menu item is not access control; there is no `isAdmin`, no role shortcut, and no tenant, company or branch identifier read from client state.

The administration permission map (`apps/web/src/features/administration/shared/permissions.ts:32-47`) names fourteen codes, all of which exist in the catalogue.

### The finding that matters most in this tier

The organization administration screen already tells the operator, in shipped copy, that the platform has no directory:

> `"admin.contractGap.noDirectory"`: _"The service publishes no company or branch directory, so references are shown rather than names."_ (`apps/web/src/i18n/messages/en.json:11`, with an Arabic counterpart)

`apps/web/src/app/[locale]/(dashboard)/administration/organization/page.tsx` passes `session.companyIds` and `session.branchIds` straight into `SettingsEditor` as the only available identifiers. And `SettingsEditor` (`apps/web/src/features/administration/organization/components/SettingsEditor.tsx:107-123`) branches on whether that array is empty:

- **Non-empty** — a select list whose every option's label is the raw identifier, because there are no names to show.
- **Empty** — a **free-text field**, with the description _"Your session resolves to no specific company or branch, so enter the reference you want to work on."_

An empty scope array means the actor is _unrestricted within the tenant_ (§6). So the operator with the **most** organizational authority — the Company Owner — is the one the product asks to **type a company or branch identifier by hand**. That is the same "no identifier input, ever" principle the login form was cleaned of, still standing one screen deeper, and it is a direct consequence of §7: there is no operation that could populate the list.

---

## 11. Consolidated statement of what does not exist

Stated plainly, because a hedge here would cost Wave B a week.

1. **No `org.*` operation exists.** The operation-id namespace is empty; 305 operations, none of them.
2. **No company directory operation and no branch directory operation exist.** Every organization read _below the tenant_ requires an identifier the caller already holds; the one read that needs none, `iam.tenant-settings-read` at `/org/tenant`, resolves its tenant from the session and returns one row.
3. **No company, branch or department creation operation exists**, despite the grants, policies and permission codes being in place.
4. **No membership table exists.** `iam.user_accounts.tenant_id` is `NOT NULL` and immutable; one account, one tenant, for life.
5. **No platform superadmin principal exists** — no table, no role, no operation, no permission code.
6. **No tenant chooser exists** in any tier.
7. **`org.provision_organization` creates no user, no role and no grant.** It stops at tenant, subscription, company, branch, settings, overrides and sequences.
8. **`org.company.manage`, `org.branch.manage`, `org.department.manage` and `org.subscription.manage` are enforced by nothing** — no operation declares them and no RLS policy names them.
9. **No approval workflow covers organization administration.**
10. **Only one aggregate is registered in the transition engine** (`org.branch`). Tenant lifecycle is driven by a dedicated function, `org.change_tenant_status` (`20260717101000_org_tenants.sql:172`), with its own history table. **Company lifecycle has neither.** `org.legal_companies.status` is a bare column under `ck_legal_companies_status` (`20260717103000…:82`, allowing only `active`/`inactive`); there is no `org.change_company_status` function anywhere in the 124 migrations, no `org.company_status_history` table among the 17 `org` tables, and no engine aggregate. A company can only change status through a direct `UPDATE` under `upd_legal_companies_tenant`, unrecorded.

---

## 12. What I could not settle, and what would settle it

**(a) How a second membership would be resolved at sign-in.** The Owner's direction is global identity → membership(s) → tenant/company → branches → roles/grants, with one active tenant per request. Today the resolution chain has exactly one link with no tenant in it: the provider's `app_metadata.tenant_id`, and behind it the unique index on `(identity_provider, provider_subject)`. `resolveTenant`'s own docblock states that the database offers **no** tenant-agnostic lookup, because `iam.user_accounts` is RLS-restricted to the current tenant and the platform holds zero `SECURITY DEFINER` routines by CI-asserted invariant. I could not determine which of these is intended, and the choice is architectural rather than discoverable:

- the provider carries a **membership list** rather than a single tenant, or
- a **control-plane read path** is introduced that can see accounts before a tenant is known, or
- membership is resolved **after** a first successful authentication against one home tenant.

**What would settle it:** an Owner or architecture decision recorded as an ADR. Option two is the expensive one: the invariant is real and currently holds — across all 124 migrations there is not one `SECURITY DEFINER` routine, and all eight occurrences of the phrase are inside comments. Seven of the eight are design notes asserting that none is introduced; the eighth, `20260815090000_shared_reception_evidence_foundation.sql:110`, explains why a draft that _did_ use it was withdrawn rather than weaken the four gates that assert the invariant. `scripts/ci/migration-replay-checks.mjs` treats any non-zero count as a failure (`:221-223`, "the approved count is 0"), and that threshold is a rule inside the script rather than a value in the baseline, so it cannot be raised by editing `schema-baseline.json`.

**(b) Whether the five dead `org.*` codes — `org.company.manage`, `org.branch.manage`, `org.department.manage`, `org.subscription.manage`, `org.tax.manage` — are the right names for the authorities this initiative will need.** They are seeded, so they are canonical and must not be duplicated. But `org.company.manage` reads as "create and update companies" while the initiative may need to separate creating a company from renaming one, exactly as CRM separated profile edits from consent. **What would settle it:** the Wave B operation list. Once the operations are named, whether each existing code covers exactly one of them is a mechanical check rather than a judgement.

**(c) Whether `org.settings.manage` should keep carrying branch activation.** It is currently the permission for both settings writes and branch status changes (`transitions.ts:81`, `:91`). Deactivating a branch stops work; changing a setting does not. **What would settle it:** an Owner decision on whether branch lifecycle is a distinct authority from branch configuration. If it is, `org.branch.manage` is already seeded and already dead, and is the obvious home — which would be reuse rather than duplication.

**(d) I did not run the test suites, the database, or CI.** Every figure above is read from source, migrations, seeds, baselines and test assertions. Structural totals such as table counts were cross-checked against `schema-baseline.json` and agreed (248 tables, both ways), but no claim here is backed by an executed run.

---

## 13. Standing constraint

**P1-29 must not be started.** This document is discovery for the PRE-P1-29 initiative only. Nothing in it authorizes a schema change, an operation, or a permission code.
