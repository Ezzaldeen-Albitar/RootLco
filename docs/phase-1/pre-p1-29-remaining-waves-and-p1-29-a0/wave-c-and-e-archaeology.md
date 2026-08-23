# Waves C, E, F, G, H and I — read-only archaeology

**CURRENT STATE / TARGET STATE / GAP / IMPLEMENTATION SURFACE / SECURITY MODEL / TEST PLAN /
DEPENDENCIES / EXIT CRITERIA for the six waves that exist on `develop` as a goal paragraph and
nothing more.**

No implementation. The objective is that each wave becomes execution-ready without a second broad
discovery pass.

## The pattern that repeats in every one of these waves

**The schema is ahead of the contract.** Write grants and row-level-security policies already exist
at the runtime role for the company, branch and department hierarchy, and they have no caller. The
provisioning function is complete and granted to no application role. Permissions are seeded and
declared by nothing. In wave after wave the missing thing is an **operation**, not a table.

The second repeating pattern is narrower and more dangerous: **three of the hierarchy's write
policies gate on tenancy and scope only, never on a permission** — unlike the IAM administration
policies beside them, which additionally call `iam.has_permission(...)`. So the three organisation
management permissions are enforced by no policy and referenced by no code.

---

### WAVE C — CURRENT STATE: the five orphaned administration permissions of G-4, named

**EXISTS BUT NOT USED.**

All five are seeded rows in the single permission catalogue. Risk levels as seeded: company.manage medium, branch.manage medium, department.manage medium, tax.manage high, subscription.manage high. The catalogue is the only statement in the repository that inserts into iam.permissions, and its count is pinned at .github/ci-baselines/schema-baseline.json:14 as permissionCount 112.

_Evidence:_ supabase/seeds/04_iam_permission_catalog.sql:18 ('org.company.manage'), :20 ('org.branch.manage'), :21 ('org.department.manage'), :23 ('org.tax.manage'), :24 ('org.subscription.manage')

### WAVE C — CURRENT STATE: each of the five is declared by zero operations (verified two independent ways)

**EXISTS BUT NOT USED.**

This reproduces gap-register GAP-15 and GAP-16 exactly. The only references to any of the five outside the seed are `org.tax.manage` in the web tree: one unconsumed constant at apps/web/src/features/administration/shared/permissions.ts:46, and two comments recording that the tax screen is gated on org.settings.manage instead (apps/web/src/config/navigation.ts:473, apps/web/src/app/[locale]/(dashboard)/administration/page.tsx:73). Plus one test fixture (tests/db/iam-seeds.test.ts:60,62,63,64,66,75) and one dev script (scripts/dev/owner-acceptance/context.mjs:161). None of these is an authorization gate.

_Evidence:_ (1) `grep -rn "org\." --include=*.ts apps/api/src | grep -oE "'org\.[a-z_.]+'" | sort | uniq -c` → 15 'org.settings.manage', 8 'org.branch', 4 'org.branch.status_changed', 3 'org.tenant.settings_updated', 3 'org.company.settings_updated', 3 'org.branch.settings_updated', 3 'org.branch.read', 2 'org.tenant.read', 2 'org.tenant', 2 'org.company_setting', 2 'org.branch_setting', 1 'org.legal_companies', 1 'org.company.read', 1 'org.branches', 1 'org.branch_status_history' — none of the five appears. (2) AST scan of every `defineOperation` body under apps/api/src/app, diffed against the seed: `seeded rows parsed: 112 … distinct codes declared by an operation: 99 … seeded but declared by ZERO operations: 13` — the list contains org.branch.manage, org.company.manage, org.department.manage, org.subscription.manage, org.tax.manage (plus iam.login.view_all, inv.cost.view, inv.item.manage, rec.reception.receiving_employee.assign_any, rpt.report.configure, sal.reversal.approve, wo.work_order.create, wty.policy.manage). The same run reports `declared by an operation but NOT seeded: 0`.

### WAVE C — CURRENT STATE: zero operation identifiers begin `org.`

**MISSING.**

The nine organisation-shaped operations all live under other prefixes: iam.tenant-settings-read/-update, iam.company-settings-read/-write, iam.branch-settings-read/-write, shared.branch-status-read/-change, svc.branch-availability-set. Seven of the nine require the company or branch to be named by the caller (path parameter for the settings and status pairs, body for svc.branch-availability-set); the remaining two answer only for the caller's own tenant.

_Evidence:_ AST scan over apps/api/src/app: `--- ids starting org. --- 0`, out of 305 total defineOperation calls with 305 distinct ids. Cross-checked against docs/api/openapi.v1.json: 248 paths, 305 operations.

### WAVE C — CURRENT STATE: org.departments — the table, its RLS and its grants all exist

**EXISTS BUT NOT USED.**

Columns: id, tenant_id, company_id, branch_id, department_code (regex '^[a-z][a-z0-9_]{1,62}$'), name (not blank), status ('active'|'inactive'), record_version, and the full audit/soft-delete/archive column set. FK is composite (tenant_id, company_id, branch_id) → org.branches (tenant_id, company_id, id) ON DELETE RESTRICT, so a cross-tenant or cross-company department is a foreign-key violation rather than a filtered row. DELETE is deliberately absent from every grant in this migration.

_Evidence:_ Table: supabase/migrations/20260717104000_org_operational_structure.sql:109-134. Unique live-code index :139-141. Triggers :144-152 (touch_metadata, guard_immutable_columns over tenant_id/company_id/branch_id/department_code/created_at/created_by, guard_parent_branch_live). RLS forced :320-321. Policies: sel_departments_scope :329, ins_departments_scope :336, upd_departments_scope :343. Grants: `GRANT SELECT, INSERT, UPDATE ON org.departments TO app_runtime;` :422 and `GRANT SELECT ON org.departments TO app_readonly;` :423. Composite scope key added later: 20260718092000_iam_role_grants_and_scopes.sql:57-58.

### WAVE C — CURRENT STATE: org.departments has no route, no repository query, and no non-test INSERT

**MISSING.**

This is the sharp version of the schema-versus-operation distinction: the storage, the privileges and the row-level policies are complete, and there is no way into any of them. In a production tenant org.departments is permanently empty. A second-order consequence follows directly — iam.grant-scope-add accepts scopeType 'department' (apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:21) and iam.grant_scopes.department_id carries a composite FK to org.departments (20260718092000_iam_role_grants_and_scopes.sql:140), so a department-scoped grant is an input the API accepts and the database can never satisfy. Wave C's department create operation is what makes that input reachable.

_Evidence:_ `find apps/api/src -ipath "*department*"` returns nothing. `grep -ril department apps/api/src` returns 8 files, none of which is a departments route: iam/grants/route.ts, iam/grants/[grantId]/scopes/route.ts (the z.enum accepting 'department'), modules/iam/application/access-administration-service.ts, modules/iam/data/authorization-repository.ts, modules/iam/domain/delegation-policy.ts, modules/reception/data/reception-read-repository.ts, server/auth/audit-actions.ts, server/auth/authorization.ts. `grep -rn "INSERT INTO org.departments"` repository-wide returns only tests/db/iam-grants.test.ts:69, tests/db/org-structure.test.ts (7 sites) and tests/db/p1-14-grant-scope-containment.test.ts:98. Neither supabase/migrations/20260717107000_org_provisioning.sql nor scripts/db/provision-organization.mjs mentions departments.

### WAVE C — CURRENT STATE: what the actor's reach resolves from today

**EXISTS AND LOAD-BEARING.**

Reach is `SELECT bool_or(g.scope_mode = 'unrestricted'), array_remove(array_agg(DISTINCT s.company_id), NULL), array_remove(array_agg(DISTINCT s.branch_id), NULL) FROM iam.role_grants g LEFT JOIN iam.grant_scopes s … WHERE g.user_id = $1 AND g.status = 'active' AND g.valid_from <= now() AND (g.valid_to IS NULL OR g.valid_to > now())`. Three properties matter for Wave C: (a) it returns UUIDs and no names — there is no join to org.legal_companies or org.branches anywhere in the resolver; (b) it is permission-blind, aggregating over every active grant regardless of which permission that grant carries, which is exactly what apps/api/src/server/http/route-handler.ts:96-100 warns about; (c) an unrestricted grant collapses both lists to empty, and empty means tenant-wide, not none (resolve-context.ts:97-102, and narrowScope skips the membership test for such a caller at :133).

_Evidence:_ apps/api/src/server/context/resolve-context.ts:41-50 (ResolvedScope: userId, tenantId, companyIds, branchIds, unrestricted), :57-105 (resolveScopeFor), :80-89 (the aggregate query), :96-104 (the return). Applied to the transaction at apps/api/src/server/db/transaction.ts:99-100 as app.company_ids / app.branch_ids. Read back by iam.allowed_company_ids()/iam.allowed_branch_ids() at supabase/migrations/0002_base_schemas.sql:128-154, where NULL means 'no narrowing set'.

### WAVE C — CURRENT STATE: nothing anywhere reads a company or branch NAME

**MISSING.**

So the P-1 requirement is not merely unexposed at HTTP — the name never leaves the database in any code path. A reach-scoped named list is entirely new read work.

_Evidence:_ `grep -rn "org\.legal_companies|org\.branches|org\.departments" --include=*.ts apps/api/src` returns 12 hits, of which only 5 are SQL. All 5 select identifiers or booleans: organization-repository.ts:108 `SELECT true AS ok FROM org.legal_companies WHERE tenant_id = $1 AND id = $2`; organization-repository.ts:124 `SELECT company_id FROM org.branches WHERE tenant_id = $1 AND id = $2`; pricing-repository.ts:157 and service-catalog-repository.ts:443 (`SELECT 1 FROM org.branches b …` scope checks); transition-repository.ts:72 `SELECT id, status, record_version, company_id FROM org.branches` and :95 the status UPDATE. The name columns exist and are never read: org.legal_companies.legal_name (20260717103000_org_companies_branches.sql:57) and org.branches.name (:same file, branches table).

### WAVE C — CURRENT STATE: admin.contractGap.noDirectory is the product's own shipped admission of the P-1 gap

**EXISTS AND LOAD-BEARING.**

It is a translated, tested, seven-site notice telling the operator that the screen is showing UUIDs because the Backend publishes no directory. Wave C's named lists are what let it be deleted; until then it is the honest rendering. It is also the concrete acceptance signal for Wave C: the notice disappearing from a screen without a real list behind it would be a regression, not a fix.

_Evidence:_ apps/web/src/i18n/messages/en.json:11 — "The service publishes no company or branch directory, so references are shown rather than names." Arabic at apps/web/src/i18n/messages/ar.json:11. Consumed at apps/web/src/app/[locale]/(dashboard)/administration/organization/page.tsx:57, .../administration/system-settings/page.tsx:77, .../profile/page.tsx:127, features/administration/access/components/ApprovalLimitsScreen.tsx:326, features/administration/organization/components/SettingsEditor.tsx:110, features/appointments/components/BranchTargetFields.tsx:69 (with the reasoning at :20), features/receptions/components/ReceptionQueueScreen.tsx:230. Asserted by apps/web/tests/p1-28-shared-components.dom.test.tsx:528 (`toHaveLength(2)`).

### WAVE C — CURRENT STATE: the privilege layer for a directory read is already in place

**AVAILABLE.**

A Wave C list operation needs no new grant and no new policy for the read: running `SELECT id, legal_name … FROM org.legal_companies` under app_runtime already returns exactly the companies the caller's active grants reach, and empty-means-unrestricted is handled by the `IS NULL` arm. That is also the answer to the leakage half of P-1: the RLS predicate, not application filtering, is what stops a caller learning that a company they cannot reach exists.

_Evidence:_ supabase/migrations/20260717103000_org_companies_branches.sql:362-367 (sel_legal_companies_tenant: `tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR id = ANY (iam.allowed_company_ids()))`), :381-387 (sel_branches_scope, narrowing on both company and branch), :422-425 (`GRANT SELECT, INSERT, UPDATE ON org.legal_companies TO app_runtime;` and the same for org.branches).

### WAVE C — TARGET STATE: an operation returning the companies and branches an actor may reach, BY NAME

**MISSING CONTRACT.**

The register is explicit that both descriptions are PLURAL and that the authority was named at the start of Phase 1 while the list operation was never published — so this is a publication, not a permission decision. Shape implied by the sources: two reads (companies, branches) or one nested read, returning id plus name (legal_name / name) plus enough to render a selector, scoped by RLS reach. Neither exists today in any form.

_Evidence:_ Requirement at docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:177-179. Authority already seeded: supabase/seeds/04_iam_permission_catalog.sql:17 ('org.company.read', 'Read legal companies') and :19 ('org.branch.read', 'Read branches'). Register verdict at permission-reuse-register.md:126-127 — REUSE, 'but the list operation does not exist'; the argument against minting a new code is at :183-192.

### WAVE C — TARGET STATE: department administration — create, name, list, retire

**MISSING CONTRACT.**

The boundary is stated in the same paragraph as the permission: department as organisational structure and grant-scope dimension is Wave C; department as a filter, an assignment target or a routing rule is P1-29 (dependencies.md §4 B1, and the disposition 'Record. Do not add a department picker to any operational screen').

_Evidence:_ scope.md:176-177 (wave C gives the department table 'a way in'); the adjacency licence at scope.md:285-291 — PRE-P1-29 may build 'creating, naming and listing departments, and scoping a grant to one' but 'may not build department routing of work'. gap-register GAP-22: 'The table exists … and nothing else does.'

### WAVE C — TARGET STATE: company and branch create/update behind the seeded manage codes

**MISSING CONTRACT.**

Note the existing asymmetry Wave C inherits and must decide about: branch activate/deactivate already ships (shared.branch-status-change) and is gated on org.settings.manage, not org.branch.manage (gap-register GAP-21, route at apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:46). Publishing org.branch.manage without reconciling that leaves two different authorities over one branch's lifecycle.

_Evidence:_ gap-register GAP-19 (no create and no update operation exists for a company; only settings on an existing one) and GAP-20 (no create and no update for a branch; only /org/branches/{branchId}/settings and /organization/branches/{branchId}/status). permission-reuse-register.md:128-129 classifies both codes WIRE.

### WAVE C — TARGET STATE: a department READ authority, proposed and not canonical

**MISSING.**

The register's own argument: gating a grant-scope picker on org.department.manage would force every scope picker to hold restructuring authority, which the catalogue file itself argues against at supabase/seeds/04_iam_permission_catalog.sql:266-273 ('over-granting by omission rather than by decision'). Sixteen of seventeen prefixes separate read from manage; org already does so at company and branch and stops at department. This is the one new code the register recommends, and it is Wave C's to seed under the dbSeeds bucket — scope.md:181-182 requires the baseline count to move in the same change.

_Evidence:_ permission-reuse-register.md:133 (the row: 'Read the department list, so a grant can be scoped to a department' — '(none exists)' — 'NEW — proposed, not yet seeded'), the three rejected reuse candidates at :135-142, and the naming note at :150-154: `org.department.read` 'is written here as a proposal, not as a canonical name … must not be cited anywhere as if it did until the Backend lane seeds it and the pinned count moves from 112 to 113.'

### WAVE C — TARGET STATE: Company-Owner target containment (P-21), moved here from wave B slice B8

**MISSING.**

What §17 requires, summarised. (1) The premise is imported unchanged from the refutation register §4 and is bounded in reach by §17 rather than restated. (2) Scoped evaluation is explicitly NOT switched on globally — §17 names authorization.ts:62-65 and says the 170/136 population is wave E's job, and that 'Wave B changes none of them'. (3) The reason the slice moved: 'wave B introduces no operation a Company Owner can reach. All three are platform. operations, outside every tenant' — so the containment rule 'stands as the surviving lane's premise, but this wave has nothing to prove it against'. Revision 1 had assigned P-21 and B8 to wave B 'where they would have passed vacuously'. Wave C is named as the receiving wave because it 'introduces the first Company-Owner-reachable administration operation'. (4) One trap is recorded for whichever wave runs it: the fixture Owner must hold a COMPANY-SCOPED grant, because narrowScope skips the membership test for an unrestricted caller (resolve-context.ts:133 — `if (!resolved.unrestricted && !held.includes(value))`), so an unrestricted fixture would prove nothing. So Wave C owes, per new Company-Owner-reachable operation: an accepted call against the Owner's own company, and a refused call against another company in the same tenant, with a non-unrestricted fixture.

_Evidence:_ docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-design-v2.md:906-924 (§17) and the struck-through slice row at :965. The proof row itself is P-21 at :888: 'Company Owner acts on their own company, then on another' → 'Accepted, then refused'.

### WAVE C — GAP: subscription administration is undecided, and tax is contradicted between documents

**AMBIGUOUS IN DOCS.**

Recorded, not resolved. scope.md says wave C wires all five; the reuse register says two of the five (tax, subscription) should be left alone or are undecided. For subscription there is a second, harder obstacle than scope: there is no write grant and no write policy on either subscription table, so wiring it is a migration as well as an operation, which is a different size of change from company/branch/department.

_Evidence:_ permission-reuse-register.md:130 ('org.subscription.manage — WIRE — scope undecided') and the §7 row at :269 ('An explicit scope statement. If in scope it is WIRE …; if out of scope it stays untouched, exactly like org.tax.manage'); :131 for org.tax.manage ('WIRE — deliberately out of scope … Leave it alone'). Against scope.md:176 ('The five orphaned administration permissions of G-4 acquire the operations they were written for'). gap-register GAP-24 records org.tenant_subscriptions / org.subscription_plans as SELECT-only (wave-a-discovery.md:151 names the grants at 20260717102000_org_subscriptions.sql:312-314 and three SELECT-only policies at :293, :298, :302).

### WAVE C — IMPLEMENTATION SURFACE: what one new operation costs, measured from the gates

**AVAILABLE.**

A Wave C write operation therefore drags in, in the same change: a permission the seed already carries (or one new seeded row plus a permissionCount move 112→113 at .github/ci-baselines/schema-baseline.json:14); a NEW audit action code in audit-actions.ts for anything not already in the four org.* entries — company created, branch created, department created/renamed/retired all need one; a regenerated docs/api/openapi.v1.json (tests/foundation/openapi.test.ts regenerates from the registry and compares); a regenerated apps/web/src/lib/api/idempotent-operations.ts if idempotent:true (validate:idempotent-operations runs the generator with --check, and webGenerated is a bucket the Backend lane may carry); a coverage-manifest entry in scripts/check-operation-test-coverage.mjs; and p1-24 register regeneration. Lane: the branch must be `feature/pre-p1-29-backend-…` (.github/ci-baselines/phase-ownership-profiles.json:112-115), which allows apiSource, migrations, dbSeeds, webGenerated, webContract, docs, tooling, tests, rootConfig and forbids web, apiConfig and supabase (scripts/ci/check-phase-ownership.mjs:398-428).

_Evidence:_ apps/api/src/server/auth/operation-registry.ts:117-186 (defineOperation rejects a non-public declaration with no permissions at :131-137, an audited class with no auditAction at :150-155, an uncatalogued audit action at :160-163, a duplicate route at :166-172). scripts/check-authorization-coverage.mjs and scripts/check-operation-test-coverage.mjs (the derived-obligation table is quoted in its header at lines 20-28). package.json: `verify:contracts` = validate:module-boundaries + validate:authorization-coverage + validate:operation-coverage + validate:openapi + validate:exact-money + validate:p1-24-register + validate:idempotent-operations. Audit catalogue at apps/api/src/server/auth/audit-actions.ts, whose only org.* codes today are org.tenant.settings_updated (:209), org.company.settings_updated (:215), org.branch.settings_updated (:221), org.branch.status_changed (:229).

### WAVE C — IMPLEMENTATION SURFACE: the published contract will carry no payload schema for the new operations

**MISSING CONTRACT.**

The generator emits security, parameters, x-required-permissions, x-scope, x-audit-class, x-rate-limit-policy and x-cache-category, and no request or response shape. So a Wave C company/branch/department contract published through the existing generator gives Wave G and Wave H nothing typed to render against — the payload shape will live only in the Zod schema inside the route file. Worth deciding deliberately rather than discovering in Wave G, since the web lane cannot change API source (scope.md §7).

_Evidence:_ `node -e` over docs/api/openapi.v1.json: `paths: 248, operations: 305, with requestBody: 0, requestBody containing properties: 0`. Every response schema is `{"type": "object"}` — see /api/v1/org/companies/{companyId}/settings, whose 200 content schema is exactly that.

### WAVE C — SECURITY MODEL: org RLS checks reach, never a permission — unlike iam RLS

**EXISTS AND LOAD-BEARING.**

This is the single most load-bearing security fact for Wave C. For iam.roles, iam.role_grants, iam.grant_scopes and iam.approval_limits the database independently re-asks the permission question, so an application-layer mistake is caught by a second gate. For org.legal_companies, org.branches and org.departments it does not: the policies check tenant and reach only. A Wave C write operation's permission check therefore has EXACTLY ONE enforcement point — requirePermissions at apps/api/src/server/http/route-handler.ts:342. Note also that ins_legal_companies_tenant checks tenant alone, with no company narrowing at all, which is correct (the company does not exist yet) and means RLS contributes nothing to containing company creation.

_Evidence:_ Permission-free org policies: 20260717103000_org_companies_branches.sql:362-367 (sel_legal_companies_tenant), :369-371 (ins_legal_companies_tenant — `WITH CHECK (tenant_id = iam.current_tenant_id())` and nothing else), :373-379 (upd_legal_companies_tenant), :381-397 (branches sel/ins/upd); 20260717104000_org_operational_structure.sql:329-350 (departments sel/ins/upd). Contrast, in the SAME family of tables: 20260726090000_iam_org_runtime_administration_capabilities.sql:186 (`iam.has_permission('iam.user.manage')`), :273/:279/:281 ('iam.role.manage'), :374/:388/:389/:399/:403 ('iam.grant.manage'), :411/:415 ('iam.approval.manage'), :425-426 (upd_tenants_settings requires 'org.settings.manage').

### WAVE C — SECURITY MODEL: a tenant-scoped Wave C operation would be evaluated scope-blind

**EXISTS AND LOAD-BEARING.**

So Wave C's declared scope per operation is a security decision, not bookkeeping. A branch-create operation declared `scope: 'branch'` with no target is evaluated by iam.has_permission and is contained only by ins_branches_scope's company narrowing; declared `scope: 'company'` or 'branch' WITH the target supplied via scopeTargetOption(body) (apps/api/src/server/http/validation.ts:227-253) it is evaluated by iam.has_permission_in_scope. The existing precedent to copy is the branch/company settings pairs, the only operations that already pass an explicit authorizationTarget. This is also exactly what P-21 tests.

_Evidence:_ apps/api/src/server/auth/authorization.ts:62-65 and the pre-handler call at apps/api/src/server/http/route-handler.ts:342 (`await requirePermissions(db, operation, options.authorizationTarget ?? {});`). Recorded as the wave-C-relevant consequence at permission-reuse-register.md:272 ('A company-creating operation declared at tenant scope would be evaluated tenant-wide') and at dependencies.md §2.3 ('a company/branch selector is not a convenience feature. It supplies the authorization target').

### WAVE C — TEST PLAN: the derived-obligation gate already dictates most of it

**AVAILABLE.**

Declaring an operation `scope: 'company'` or `'branch'` therefore CREATES the isolation-test obligation automatically, which is the cheapest way to make P-21 non-optional. Additional obligations from the sources: RLS/database tier tests alongside tests/db/org-structure.test.ts (which already exercises org.departments inserts, code uniqueness among live rows and the archived-code-freed rule); the P-21 pair (own company accepted, other company refused) with a company-scoped, non-unrestricted fixture per wave-b-control-plane-design-v2.md:922-925; and a negative test that the new department read authority denies a caller holding only org.department.manage, if the register's proposed split is taken.

_Evidence:_ scripts/check-operation-test-coverage.mjs header, lines 20-28: every operation → route · service · success; not public → authorization; a {param} in the path → cross-tenant; idempotent:true → idempotency; versionGuarded:true → stale-version; auditClass other than none → audit; scope of company or branch → isolation. Failure conditions at :40-45. The derived floor applies to the `shared.` surface; manifest entries are additive and can only make it stricter.

### WAVE C — DEPENDENCIES

**AVAILABLE.**

Upstream: Wave C does not depend on Wave B completing — B's three operations are all `platform.` and outside every tenant — but it does inherit B's P-21 obligation, so the wave-B design must be readable when C is written. Wave C does not depend on Wave D: the reach it lists comes from the existing grant/scope resolver, not from membership. Downstream: Wave G's company/branch/department screens and Wave H's grant-scope picker are both blocked on C's reads, and the web lane is structurally forbidden from inventing them (it may not change apiSource). Cross-wave: the department read authority C seeds, and the department rows C's create operation makes possible, are what turn iam.grant-scope-add's 'department' branch from an unsatisfiable input into a real one — which is GAP-09 territory and is assigned to 'Backend' rather than to a numbered wave.

_Evidence:_ scope.md:145-155 (wave order); wave-b-control-plane-design-v2.md:948-967 (B1..B9, B8 struck through and moved here); scope.md:231-235 (wave H may not ship against a contract that does not exist); scope.md:225-227 (wave G builds the named selectors on top of the wave C reads).

### WAVE C — EXIT CRITERIA

**AVAILABLE.**

Derivable from the sources, in the order the gates force: (1) the five G-4 codes are each either declared by at least one published operation or explicitly retired with a recorded reason — measurable by re-running the seed-versus-declared diff and watching the 13-orphan list shrink; (2) org.departments has create/list/update operations and the count of non-test INSERT paths is no longer zero; (3) a reach-scoped named companies read and a reach-scoped named branches read exist and return legal_name / name; (4) P-21 passes with a company-scoped fixture on every new Company-Owner-reachable operation; (5) permissionCount moves 112→113 in the same commit if and only if a department read code is seeded; (6) verify:contracts and verify:policies both green, with openapi.v1.json and idempotent-operations.ts regenerated rather than hand-edited. One thing NOT an exit criterion: removing admin.contractGap.noDirectory from the seven web sites is Wave G's, since the Backend lane may not touch handwritten web.

_Evidence:_ package.json `verify:workspaces` = verify:policies && verify:repository && verify:api && verify:web && verify:contracts && verify:inventories && format:check:all. Baseline pins at .github/ci-baselines/schema-baseline.json:14 (permissionCount 112) and :6 (migrationCount 124). scope.md:181-182 ('Any permission a wave C operation needs is seeded by wave C, in the seeds bucket, and moves the baseline count of G-2 in the same change').

### WAVE E — CURRENT STATE: G-8 measured with a real parser, and the canonical figures corrected

**EXISTS AND LOAD-BEARING.**

The measured answer: 167 operations declare `scope: 'tenant'` explicitly (165 non-public + 2 public: shared.health-live at apps/api/src/app/api/v1/health/live/route.ts:23 and shared.health-ready at .../health/ready/route.ts:36), 132 declare 'branch', 2 declare 'company' (iam.company-settings-read and -write), and 4 declare no scope at all (iam.auth-login, iam.auth-logout, iam.auth-password-reset, iam.auth-password-reset-completion — all public, all inheriting 'tenant' from operation-registry.ts:185 `scope: declaration.scope ?? 'tenant'`). 167 + 132 + 2 + 4 = 305, which is the agreed published-operation total, so the partition is complete. Effective tenant scope is therefore 171 across 136 files, which the OpenAPI cross-check reproduces exactly and independently. Tenant-scoped operations by id prefix: iam 30, crm 29, rec 27, veh 27, shared 26, apt 15, svc 8, rpt 2, inv 1, meta 1, sal 1. Branch-scoped: wo 26, rec 23, sal 17, inv 13, dia 13, qms 13, apt 6, quo 6, tech 6, svc 3, iam 2, shared 2, wty 2.

_Evidence:_ Method: TypeScript 5.9.3 compiler API (createSourceFile + forEachChild), matching CallExpressions whose callee identifier is `defineOperation`, reading the `scope` property off the first argument's object literal. Command: `node scan-ops.mjs <repo> apps/api/src/app`. Output: `scannedFiles: 249, totalDefineOperation: 305, byScope: { branch: 132, tenant: 165, "<absent> (public)": 4, "tenant (public)": 2, company: 2 }, distinctFilesExplicitTenant: 132, distinctFilesAbsentScope: 4, distinctFilesEffectiveTenant: 136, distinctFilesTotal: 248`. Ids are unique: `total 305 distinct 305`. Independent cross-check against the published contract: `node -e` over docs/api/openapi.v1.json summing x-scope → `{"branch":132,"tenant":171,"company":2}`. Naive-grep controls, confirming why a naive count is wrong: `grep -ro "scope: 'tenant'" apps/api/src | wc -l` → 180; `grep -ro "scope: 'branch'"` → 183; `grep -ro "defineOperation({"` → 307 (the two extras are prose at apps/api/src/server/cache/eligibility.ts:6 and apps/api/src/server/http/rate-limit.ts:194).

### WAVE E — CURRENT STATE: the short-circuit is not only about tenant scope — an empty target short-circuits any scope

**EXISTS AND LOAD-BEARING.**

So the pre-handler check reaches iam.has_permission (scope-blind) for 165 non-public tenant-scoped operations PLUS 117 branch-scoped ones = 282 of the 303 non-public operations. Only 17 supply a pre-handler target, and every one of the 17 is branch- or company-scoped: apt.appointment-create, apt.appointment-list, inv.inventory-reconciliation-read, inv.opening-batch-create, inv.stock-availability-read, inv.stock-movement-list, rec.receiving-employee-list, rec.reception-create, rec.reception-list, tech.technician-available, wo.work-order-list (via scopeTargetOption), and iam.branch-settings-read/-write, iam.company-settings-read/-write, shared.branch-status-read/-change (via explicit authorizationTarget). scope.md's G-8 row frames the problem as tenant-scope-specific; the code makes it target-specific, and the branch half is 117 operations that the headline figure does not count. Several route files say so in prose — apps/api/src/app/api/v1/work-orders/route.ts:20-27 is the clearest ('scope: branch is inert without a target … the check degrades to scope-blind iam.has_permission — and RLS cannot compensate, because app.branch_ids is the permission-blind union of every active grant').

_Evidence:_ apps/api/src/server/auth/authorization.ts:62-65 — `function requiresScopedEvaluation(scope: ScopeRequirement, target: AuthorizationTarget): boolean { if (scope === 'tenant') return false; return target.companyId !== undefined || target.branchId !== undefined; }`. The HTTP boundary at apps/api/src/server/http/route-handler.ts:342 — `await requirePermissions(db, operation, options.authorizationTarget ?? {});`. Measured: authorizationTarget property assignments under apps/api/src/app = 6, in 3 files; scopeTargetOption(...) call sites = 11, in 10 files (grep, excluding validation.ts itself). Cross-referencing those 13 files against the operation table: `tenant ops in a target-supplying FILE: 0` and `branch ops in NO target-supplying file: 117`.

### WAVE E — CURRENT STATE: what requiresScopedEvaluation actually does

**EXISTS AND LOAD-BEARING.**

Module-private (no `export`), 4 lines, two exits. Exit one: declared scope is 'tenant' → false, unconditionally, whatever the target says. Exit two: any other declared scope → true only if the target names a company or a branch. A departmentId alone never triggers scoped evaluation — that is GAP-09, and it is structural rather than incidental, because ScopeRequirement itself excludes department (operation-registry.ts:36 — `export type ScopeRequirement = 'tenant' | 'company' | 'branch';`). The SQL side: iam.has_permission (20260718097000_iam_context_and_permission_functions.sql:71) aggregates allow/deny over every active grant with no reference to grant_scopes at all; iam.has_permission_in_scope (:127) applies deny globally first, then requires `g.scope_mode = 'unrestricted' OR EXISTS (… (s.scope_type='company' AND s.company_id = p_company) OR (s.scope_type='branch' AND s.branch_id = p_branch) OR (s.scope_type='department' AND s.department_id = p_department))`.

_Evidence:_ apps/api/src/server/auth/authorization.ts:62-65 (quoted in full above). Consumed at :105-107 — `const scoped = options.forceScoped ? target.companyId !== undefined || target.branchId !== undefined : requiresScopedEvaluation(operation.scope, target);`. The two questions at :108-116 — scoped → `SELECT iam.has_permission_in_scope($1, $2, $3, $4)` with [code, companyId ?? null, branchId ?? null, departmentId ?? null]; otherwise → `SELECT iam.has_permission($1)` with [code].

### WAVE E — CURRENT STATE: what requireScopedPermissions actually does, with the decisive lines

**EXISTS AND LOAD-BEARING.**

Two properties, both stated in the source as deliberate. First, the guard is keyed on the TARGET and explicitly NOT on the declared scope: ':348 — Keying the guard on the declared scope would exempt any operation that omitted `scope` — defineOperation defaults it to 'tenant' — so a future id-addressed command that forgot one line would call this with a real target, fall through requiresScopedEvaluation's tenant short-circuit, and be decided by scope-blind iam.has_permission. That is P1-18-A-01 restored by an omission, and it would look completely correct at the call site.' Second, it always passes forceScoped:true, ':371 — a target was supplied, so the decision must consult grant scope even if the declaration says tenant.' So requireScopedPermissions is the ONE path in the codebase that can override a `tenant` declaration, and it is reachable only from inside a handler via HandlerInput.authorizeScope (route-handler.ts:357-358), never from the HTTP boundary.

_Evidence:_ apps/api/src/server/auth/authorization.ts:337-377. Decisive line 1, the fail-closed guard at :359 — `if (!operation.public && target.companyId === undefined && target.branchId === undefined) {` … throwing AppFailure('ERR-IAM-001') with `context: { reason: 'deferred-scope-target-missing', declaredScope: operation.scope }` at :366. Decisive line 2, the tail at :376 — `return requirePermissions(db, operation, target, { forceScoped: true });`. The reasoning is in the code at :340-352 and :371-375.

### WAVE E — CURRENT STATE: what forceScoped actually does

**EXISTS AND LOAD-BEARING.**

forceScoped replaces requiresScopedEvaluation with the bare target test, dropping the `scope === 'tenant'` exit. Its one-way property is real: with an empty target both branches of the ternary evaluate false, so it cannot loosen a decision. scope.md:53 says the escape 'is set only by the in-application re-authorization at :376 and never by the HTTP boundary' — I confirmed that: :376 is the sole assignment, and route-handler.ts:342 passes no options object at all.

_Evidence:_ Declared at apps/api/src/server/auth/authorization.ts:54-60 — `readonly forceScoped?: boolean;` with the docblock 'Evaluate against grant scope whenever the target names one, regardless of the operation's declared scope. Set by the deferred path only.' Applied at :100-107 — `// forceScoped says "a caller discovered this scope and named it", which is a stronger statement than the declaration makes. It only ever ADDS scope to the decision: with no company and no branch there is still nothing to narrow by, so the expression below cannot turn a scoped evaluation into a scope-blind one.` Set at exactly one site: :376.

### WAVE E — CURRENT STATE: which operations supply an authorizationTarget, and which call authorizeScope

**EXISTS AND LOAD-BEARING.**

Two distinct mechanisms with different contracts, both documented at route-handler.ts:88-108 and authorization.ts:314-336. The pre-handler target is correct only where the scope is knowable before any read; the deferred authorizeScope is correct once the row is locked, and fails closed on an empty target. scopeTargetOption (validation.ts:227-253) is the platform helper for creation commands: it reads companyId+branchId out of a not-yet-validated body, requires both together, and yields no target on anything malformed — 'The target can make authorization STRICTER … and can never make it looser.' Note the asymmetry Wave E must adjudicate: the 83 authorizeScope call sites are concentrated in the operational modules, so the operations most likely to be genuinely contained are the branch-scoped ones, while the 165 non-public tenant-scoped ones have neither mechanism.

_Evidence:_ AST scan, apps/api/src (501 files): `authorizationTargetSites: 7, authorizationTargetFiles: 4, authorizeScopeCallSites: 83, authorizeScopeFiles: 30`. The 7 target sites: apps/api/src/app/api/v1/org/branches/[branchId]/settings/route.ts:71 and :95 (`{ branchId: params.branchId }`); .../org/companies/[companyId]/settings/route.ts:77 and :101 (`{ companyId: params.companyId }`); .../organization/branches/[branchId]/status/route.ts:77 and :103 (`{ branchId: params.branchId }`); plus the helper's own return at apps/api/src/server/http/validation.ts:252 (`{ companyId, branchId }`). scopeTargetOption callers: appointments/route.ts:97,179; inventory-reconciliations/route.ts:82; opening-inventory-batches/route.ts:91; reception-catalogue/receiving-employees/route.ts:80; receptions/route.ts:116,170; stock-availability/route.ts:101; stock-movements/route.ts:103; technicians/available/route.ts:118; work-orders/route.ts:110. authorizeScope by file: 3 in route files (price-lists/[priceListId]/versions/[versionId]/rules, prices, services/[serviceId]/branch-availability) and 80 across 27 module application services — work-order-service 7, invoice-service 7, diagnostic-report-service 6, billing-read-service 5, inventory-intake-service 5, inventory-stock-service 5, reception-capture-service 5, additional-work-service 4, job-assignment-service 4, labor-session-service 4, and the rest 1-3 each.

### WAVE E — TARGET STATE: a per-operation determination, recorded

**MISSING.**

The deliverable is an adjudication with a per-operation verdict, not a global switch. The three possible verdicts implied by scope.md:203-204 ('That may be correct, it may be a defect, or it may be correct for some of the 167 and wrong for others'): correct as-is (the two questions cannot differ for this operation's target, e.g. a genuinely tenant-wide catalogue read), defective and fixable by declaring a narrower scope plus supplying a target, or defective and fixable only by the deferred authorizeScope once a row is read. Note the population to adjudicate is larger than the document's 167: on my measurement it is 165 non-public tenant-scoped plus 117 targetless branch-scoped.

_Evidence:_ scope.md:198-208 — 'Wave E must settle it per operation and record the answer.' scope.md:405-409 (the not-settled entry): 'What would settle it: a per-operation determination of whether the scoped question and the scope-blind question can ever differ for that operation's target.' wave-b-control-plane-design-v2.md:971-972 restates that wave B decides nothing here.

### WAVE E — TARGET STATE: what the boundary rule of scope.md §6 forbids, concretely

**EXISTS AND LOAD-BEARING.**

Concretely forbidden to Wave E, derived from the table plus the measured absences: it may not add POST /api/v1/work-orders (the route file has exactly one operation, wo.work-order-list at apps/api/src/app/api/v1/work-orders/route.ts:66, and the docblock at :5-16 records the absence as the phase boundary); it may not publish a job list or single-job read (dependencies.md §4 B4 — 'No operation lists jobs, at any scope', settled as an omission at dependencies.md §7); it may not add technician-profile writes (§4 B2 — no POST or PATCH anywhere under apps/api/src/app/api/v1/technicians/); it may not add diagnostic authoring, computer-scan capture or findings; it may not add progressive work logging or start/pause/resume/complete; it may not add QC or closure-gate operations; it may not add work-evidence media capture; and it may not add department ROUTING of work (:288-291). What it MAY do to any existing work-order-domain operation: change its declared `scope`, add an authorizationTarget or a scopeTargetOption call, add an authorizeScope call inside the handler or service, change its declared permission codes, and add tests — all of which decide who may perform an action that already exists. The uncomfortable consequence, worth stating: `wo.work_order.create` is a seeded permission that no operation declares (one of the 13 orphans), and Wave E may not fix that, because publishing a create operation is precisely the forbidden move.

_Evidence:_ scope.md:252-291. The reserved-to-P1-29 paragraph cites docs/phase-1/phase-1-28/canonical-plan.md:220-231 ('P1-28 ends where the work order begins'). The exclusion table at :270-280. The test at :282-284: 'does the change let someone do something that could not be done before, or does it decide who may do something that already could be? The first is P1-29. The second is PRE-P1-29.' The departments adjacency carve-out at :285-291.

### WAVE E — GAP: the schema-versus-HTTP distinction for department scope

**MISSING CONTRACT.**

The database can express, store and evaluate a department-scoped grant; the HTTP layer can neither declare a department scope nor be narrowed by one. dependencies.md §2.2 measures the full extent: exactly one department column exists outside org.departments itself (iam.grant_scopes.department_id), read in exactly two places (the permission function and the delegation backstop at 20260727090000_iam_grant_delegation_scope_backstop.sql:182-186), plus one guard that branches on scope_type='department' without reading the column (20260815093000_rec_receiving_employee_identity.sql:168-170, treating a department-scoped grant as covering its branch). Whether closing this is Wave C's or Wave E's is not stated anywhere I could find.

_Evidence:_ Schema side: iam.grant_scopes.department_id with ck_grant_scopes_shape admitting a department row at supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:142-146, and iam.has_permission_in_scope matching on it at 20260718097000_iam_context_and_permission_functions.sql:194. HTTP side: ScopeRequirement is `'tenant' | 'company' | 'branch'` at apps/api/src/server/auth/operation-registry.ts:36 — department is not a member, and no operation declares it. Evaluation side: requiresScopedEvaluation at authorization.ts:64 keys only on companyId/branchId, so a departmentId alone never triggers scoped evaluation.

### WAVE E — IMPLEMENTATION SURFACE: what a per-operation change actually touches

**AVAILABLE.**

Three levers, each with a different blast radius. Changing a declared `scope` alone changes nothing at runtime unless a target is also supplied — that is the whole content of G-8 — but it DOES change the test obligations (scope of company or branch derives an isolation test, scripts/check-operation-test-coverage.mjs header :27) and it changes x-scope in the published contract, so docs/api/openapi.v1.json must be regenerated. Adding a required companyId/branchId to a query or body is a BREAKING contract change for any existing caller, including apps/web — and the Backend lane may not change apps/web, so any such change has a paired web change in a separate PR under pre-p1-29-web. Adding an authorizeScope call inside a module application service touches no contract at all and is the lowest-risk lever. There is no central switch: nothing in authorization.ts can be flipped to fix the population, and doing so would be the wrong shape anyway, since scope.md:203-204 anticipates a split verdict.

_Evidence:_ Declaration: the `scope` property inside each defineOperation body across 248 route files. Pre-handler target: apps/api/src/server/http/route-handler.ts:340-343 (RouteOptions.authorizationTarget at :117) and the helper at apps/api/src/server/http/validation.ts:227-253. Deferred: HandlerInput.authorizeScope at route-handler.ts:108 and :357-358, backed by authorization.ts:337-377. Query/body schema changes where a target must be supplied (the work-orders precedent adds `companyId: schemas.uuid, branchId: schemas.uuid` as REQUIRED to the query, apps/api/src/app/api/v1/work-orders/route.ts:51-52).

### WAVE E — SECURITY MODEL: why RLS does not compensate, stated by the code itself

**EXISTS AND LOAD-BEARING.**

This is the reason the G-8 question cannot be answered 'RLS contains it'. RLS is permission-blind reach filtering; iam.has_permission_in_scope is the only thing that asks whether THIS permission reaches THIS place. For an operation whose target row carries a company/branch, RLS narrows the row set but does not verify the permission was granted for that branch. The two questions can only coincide where the caller holds the permission in exactly the places their grants reach — which is why the adjudication has to be per operation and cannot be argued generically.

_Evidence:_ apps/api/src/server/http/route-handler.ts:96-100 — 'RLS cannot make up the difference: app.branch_ids is the union of every active grant regardless of which permission it carries, so a principal holding this permission in branch B1 and any grant at all in B2 both passes the check and sees the B2 row.' The mechanism: apps/api/src/server/context/resolve-context.ts:80-89 aggregates over role_grants with no permission predicate; transaction.ts:99-100 writes it to app.company_ids/app.branch_ids; iam.allowed_branch_ids() (0002_base_schemas.sql:143-154) reads it back; every org and business policy narrows on it. Also authorization.ts:198-206, explaining that requiresScopedEvaluation returning false on an empty target means 'an actor granted the permission in ONE branch can write a row that prices every branch'.

### WAVE E — SECURITY MODEL: the two documented failure shapes the adjudication must not reintroduce

**EXISTS AND LOAD-BEARING.**

Both are traps for exactly the work Wave E does. Shape one: adding an authorizeScope call at a choke point that cannot supply the row's own company/branch — that path now throws rather than silently answering yes, but only because of the :359 guard. Shape two: implementing containment in TypeScript beside the SQL function instead of inside it; the file's header argues at length that scope semantics live in one place. A third, subtler one is recorded at :202-206: for a genuinely tenant-wide write, leaving it to the pre-handler check is WORSE than it looks, and the correct instrument is callerHoldsPermissionTenantWide, not a scope declaration.

_Evidence:_ P1-18-A-01, recorded at authorization.ts:325-332 ('a deferred authorizer handed {} would silently evaluate scope-blind iam.has_permission and answer yes — which is P1-18-A-01 exactly, reached a second time through the very API added to close it'). The withdrawn TypeScript re-derivation of scope semantics, recorded at authorization.ts:68-90 ('a previous revision of this file was wrong to add a second one beside it … The removed check therefore closed nothing and cost something'). The tenant-wide-write case at authorization.ts:194-213 (callerHoldsPermissionTenantWide, and 'Use this ONLY where the written row genuinely has tenant-wide effect').

### WAVE E — TEST PLAN: the P1-18 discovery pattern is the model, and it covers only apt/rec today

**AVAILABLE.**

The header states the design rule Wave E should generalise: 'A hand-maintained list would pass forever after someone added a thirteenth unprotected operation, so the set is derived from source … A new operation of that shape fails this file until it is either wired or consciously excluded.' Today that discipline exists for apt./rec. id-addressed operations only — 32 commands plus the id-addressed reads. Wave E's per-operation record is exactly the same artefact widened to the whole surface: a derived discovery over all 305, an explicit verdict list, and a failure when an operation matches no verdict. The file also records honestly what its sibling does NOT prove (:16-27): it discriminates 403/ERR-IAM-001 from 404/ERR-RES-001, but not the deferred authorizer's 403 from a row-policy refusal that maps to the same pair — attribution is settled behaviourally for five operations by mutation and inferred for the other five. Wave E inherits that limitation as a design constraint on its own proofs.

_Evidence:_ tests/foundation/p1-18-scoped-authorization.test.ts. Discovery at :888-903 — every operation whose id starts apt. or rec. and whose path contains '{', split by method. Expected lists: EXPECTED_LOCKED_ROW_OPERATIONS at :724-741 (16 ids) and EXPECTED_TENANT_CONFIGURATION_COMMANDS (16 ids, rationale at :743-758). Completeness assertion at :911-916 — 'discovers exactly the thirty-two id-addressed P1-18 commands, in two classes'. Per-id assertions at :961 ('declares branch scope explicitly'), :968 ('names the deferred authorizer'), :982 ('runs under its OWN declaration'). Behavioural counterpart named at :8-13 (tests/backend/p1-18-scope-containment.test.ts). Unit-tier assertion that the guard is not scope-keyed at :269-275 — 'does not exempt an operation merely because its declared scope is tenant'.

### WAVE E — DEPENDENCIES

**AVAILABLE.**

Upstream: Wave D changes how the principal and its memberships resolve, and resolve-context.ts is the file that produces the reach every scoped decision narrows against — so an adjudication written before D lands is adjudicating against a resolver D will modify. Wave E is also downstream of Wave C in one narrow respect: if Wave C publishes company/branch/department operations, those become new members of the population Wave E must adjudicate, and a Wave C operation declared `tenant` is a new instance of the very defect Wave E is settling. Downstream: Wave H's grant-scoping and 'which branches an actor reaches' screens render Wave E's answers. Not a dependency: Wave B — its three operations are platform-scoped and outside the tenant surface entirely.

_Evidence:_ scope.md:145-155 (wave order: E follows D). scope.md:231-235 (wave H ships over wave C, D and E contracts, and the web lane cannot change API source). scope.md:405-409 (the G-8 question is 'wave A discovery work and wave E adjudication work'). wave-b-control-plane-design-v2.md:911-914 ('adjudicating them is wave E's job. Wave B changes none of them').

### WAVE E — EXIT CRITERIA

**AVAILABLE.**

Derivable from the sources: (1) every one of the 305 operations carries a recorded verdict — correct-as-is, re-scoped, or deferred-authorized — with no operation unadjudicated, enforced by a derived-discovery test in the p1-18-scoped-authorization.test.ts shape rather than by a hand-written list; (2) every operation whose verdict is 're-scoped' actually supplies a target, so the count of tenant-scoped operations with no target falls from 167 by exactly the number re-scoped, and the count of branch-scoped operations with no target falls from 117 correspondingly — both re-measurable by re-running the AST scan and the openapi x-scope tally; (3) each re-scoped operation carries the isolation test its new declaration derives; (4) docs/api/openapi.v1.json regenerated so x-scope matches the registry (tests/foundation/openapi.test.ts is the divergence gate); (5) no new route, method or defineOperation exists in the work-order domain — checkable as a diff property, since totalDefineOperation must stay 305 unless Wave C added to it; (6) verify:contracts and verify:workspaces green. One criterion the sources do NOT supply: whether a verdict of 'correct as-is' needs a proof or only a recorded argument.

_Evidence:_ scope.md:203-204 ('Wave E must settle it per operation and record the answer'), :405-409 (what would settle it). package.json `verify:contracts` and `verify:workspaces`. scripts/check-operation-test-coverage.mjs header :20-28 (scope of company or branch derives an isolation obligation).

---

## Unknowns — what could not be settled, and what would settle it

- HOW MANY OF THE 117 TARGETLESS BRANCH-SCOPED OPERATIONS ARE ACTUALLY CONTAINED BY A DEFERRED authorizeScope. I measured 83 authorizeScope call sites across 30 files, 80 of them inside module application services rather than route files, so the mapping from operation to call site runs through service-method dispatch and cannot be settled by static shape alone. WHAT WOULD SETTLE IT: a call-graph walk from each route handler through its module surface to the service methods it invokes — or, more cheaply and more honestly, the P1-18 mutation technique applied per operation (remove the authorizeScope call, assert the cross-branch call now succeeds). The P1-18 suite itself records that mutation proofs exist for only five of its ten operations and the rest are inferred (tests/foundation/p1-18-scoped-authorization.test.ts:16-27), so inference is the established fallback and its limits are already documented.
- WHETHER THE B1 BRANCH `feature/pre-p1-29-backend-b1-platform-authority-foundation` ALREADY CHANGES ANYTHING WAVE C OR WAVE E DEPENDS ON. That branch is unmerged and its documents are not on develop, so this worktree cannot see them; I have treated develop `c081a019` as the whole world and every figure above is measured against it. WHAT WOULD SETTLE IT: `git log --oneline develop..feature/pre-p1-29-backend-b1-platform-authority-foundation` and `git diff develop...<that branch> -- apps/api/src/server/auth supabase/migrations supabase/seeds` from a checkout that has the branch. Specifically at risk: the permissionCount pin (112), the migration count (124), operation-registry.ts's ScopeRequirement, and scripts/ci/rls-matrix.mjs's three-role list, all of which B1 is designed to move.
- WHETHER WAVE C'S NAMED LISTS SHOULD BE `org.`-PREFIXED OPERATION IDS. Every existing organisation operation lives under iam. or shared. (iam.company-settings-read, shared.branch-status-change), and the AST scan confirms zero ids begin `org.`. scope.md:365 records 'Published organisation operations: 0 — no operation id begins org.' as a baseline FACT rather than as a target, and the wave-B design reserves a `platform.` namespace for the control plane. WHAT WOULD SETTLE IT: an explicit naming decision, of the kind wave-b-control-plane-design-v2.md §12.2 records for the platform operations. Getting it wrong is cheap to write and expensive to change, since the id appears in logs, OpenAPI operationIds, the coverage manifest and the p1-24 register.
- WHETHER A REACH-SCOPED NAMED LIST SHOULD BE DECLARED tenant, company OR branch SCOPE. It is precisely the operation whose containment is RLS reach narrowing rather than a scoped permission check, so `scope: 'tenant'` is arguably correct for it — and it would then be a new member of the exact population Wave E is adjudicating, published by Wave C while Wave E is deciding. WHAT WOULD SETTLE IT: applying scope.md:407-409's own test to the operation — can the scoped question and the scope-blind question ever differ for its target? Since its target is the reach itself, they arguably cannot; but that argument needs to be written down and proved rather than assumed, and it is the same argument Wave E will have to make 165 more times.
- WHETHER ANY EXISTING WEB CALLER WOULD BREAK IF WAVE E ADDS A REQUIRED companyId/branchId TO AN EXISTING QUERY OR BODY. The work-orders precedent made both REQUIRED (apps/api/src/app/api/v1/work-orders/route.ts:51-52), so the pattern exists — but doing it to a shipped operation is a breaking contract change, and the Backend lane may not touch apps/web to fix the caller. WHAT WOULD SETTLE IT: for each candidate operation, grep apps/web/src/features/**/api.ts for the path and check whether the adapter already sends the pair. Worth doing before the adjudication commits to re-scoping, because it converts a one-PR Backend change into a paired Backend+Web change under two different ownership profiles.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- THE TENANT-SCOPE POPULATION IS GIVEN THREE DIFFERENT VALUES, AND MY MEASUREMENT MATCHES NEITHER DOCUMENT EXACTLY. scope.md:53 and :201 say '167 published operations declare tenant scope, spread across 132 route files'. wave-b-control-plane-design-v2.md:817 says '170 across 136 files — 166 declaring it, 4 inheriting the default', and :911-912 repeats '170 operations across 136 files'. My AST parse gives 167 explicit + 4 inherited = 171, across 136 files, and the published contract's x-scope tally reproduces 171 independently ({"branch":132,"tenant":171,"company":2}), with the four buckets summi
- G-8'S HEADLINE FRAMES A TENANT-SCOPE PROBLEM; THE CODE HAS A TARGET PROBLEM. gap-register GAP-08 and scope.md:53 both describe the defect as the tenant short-circuit. But authorization.ts:62-65 returns false for ANY empty target whatever the declared scope, and route-handler.ts:342 passes an empty target for all but 17 operations — so 117 branch-scoped operations are in the same position and are counted by neither figure. Several source docblocks state the wider reading plainly (route-handler.ts:88-108, work-orders/route.ts:20-27, validation.ts:227-241, authorization.ts:198-206), and dependenc
- WHETHER WAVE C WIRES ALL FIVE G-4 CODES OR THREE. scope.md:176 says wave C gives 'the five orphaned administration permissions of G-4 … the operations they were written for'. permission-reuse-register.md:131 says org.tax.manage is 'WIRE — deliberately out of scope … Leave it alone', and :130 marks org.subscription.manage 'WIRE — scope undecided', with §7 at :269 requiring 'An explicit scope statement' before it can be classified. Three documents, two answers.
- WHERE GAP-09 (DEPARTMENT-SCOPED EVALUATION) BELONGS. gap-register.md assigns gaps to LANES — its wave column reads 'Backend', 'Web', 'Backend, then Web' — not to the nine waves A..I, so it cannot say whether closing GAP-09 is Wave C's (departments must exist before a department scope can be named) or Wave E's (it is an evaluation defect in the same function as G-8, and would require widening ScopeRequirement at operation-registry.ts:36). Both readings are supported. Relatedly, gap-register.md §3 is headed 'The four waves' while describing four ownership LANES including repository-tooling — a h
- WHETHER THE PROPOSED DEPARTMENT READ CODE IS WAVE C'S TO SEED AT ALL. permission-reuse-register.md:150-154 is emphatic that `org.department.read` 'is written here as a proposal, not as a canonical name' and 'must not be cited anywhere as if it did until the Backend lane seeds it'. scope.md:181-182 says wave C seeds any permission a wave C operation needs. Whether the grant-scope picker (a Wave H screen over an iam contract) makes the department read a Wave C need or a Wave H-driven late addition is not stated.
- WHAT 'RECORD THE ANSWER' MEANS FOR WAVE E'S OUTPUT ARTEFACT. scope.md:204 requires a per-operation determination to be recorded, and :407-409 defines the question. Nothing says whether the record is a document, a derived test in the tests/foundation/p1-18-scoped-authorization.test.ts shape, or a machine-checked register in the scripts/p1-24-operation-register.mjs shape — and the three have very different exit properties, since only the latter two fail when someone adds operation 306.
