# Subscription enforcement and company lifecycle — current truth and required design

Two subjects, kept in one document because they share a table family and a missing enforcement
point.

## The product rule for subscriptions

**Subscription expiration blocks application access. Data remains preserved.** Blocking is a
backend property; hiding navigation is not blocking.

The design must answer, and this document supplies the evidence for each: what remains readable,
what becomes blocked, whether privileged platform remediation stays possible, how a Company Owner
sees the blocked state, how existing employee sessions behave, and how reactivation restores
access.

## The finding that governs the subscription design

**The entitlement path is complete and dead from the HTTP boundary.** The resolution function, its
precedence rule and its raise-on-unknown-flag behaviour all exist; `requireFeature` exists and
raises `ERR-TEN-001`; and **zero of the 305 operations declare a `featureFlag`**, so that error is
unreachable in production. Enforcement is therefore not "somewhere else" — it is **nowhere**.

Worse for the product rule: **nothing reads `org.tenants.status` during authentication**, so a
suspended or closed tenant signs in and operates exactly like an active one. Recorded as `AMB-46`
and `AMB-58`. And `org.tenant_subscriptions.status` admits `expired`, which **nothing ever writes**
— recorded as `AMB-62`.

## The company lifecycle question

The tenant has status, history and a transition function. The branch has status, history and a
transition function. **The company has a status column and neither of the other two.** Closing that
is slice B2, prepared in [next-slice-b2-preparation.md](next-slice-b2-preparation.md); the evidence
is below.

---

## What exists today

### org.feature_flags — platform feature register

**EXISTS BUT NOT USED.**

Columns: id uuid PK, flag_code text UNIQUE (`ck_feature_flags_code_format CHECK (flag_code ~ '^[a-z][a-z0-9_]{1,62}$')` at :83), name text (not blank, :84), description text NULL, default_enabled boolean NOT NULL DEFAULT false (:73), status text DEFAULT 'active' with `CHECK (status IN ('active','deprecated'))` (:85), record_version, created_at/created_by, updated_at/updated_by. Triggers: tg_feature_flags_touch_metadata (shared.touch_row_metadata), tg_feature_flags_immutable (org.guard_immutable_columns('flag_code')). RLS forced; the only policy is `sel_feature_flags_all ... FOR SELECT TO app_runtime, app_readonly USING (true)` (:293-295). The only grant is SELECT (:312) — no application role can write a flag, deliberately (header :25-28). "Every write against `org.feature_flags` in the repository is in test code; product code never writes one (the only non-test mention is an error string at apps/api/src/server/auth/entitlement.ts:33). Three admin-pool fixtures seed rows — tests/backend/helpers.ts:285, tests/db/org-settings.test.ts:36, tests/db/org-subscriptions.test.ts:41 — and `cleanFixtures` removes them again as admin at tests/db/helpers.ts:746. Two further write statements run on the RUNTIME pool inside `withRolledBackTx` in the test `runtime cannot modify a platform feature definition (42501)`: an UPDATE at tests/db/org-subscriptions.test.ts:94 and an INSERT at :101, both asserting SQLSTATE 42501 — the positive proof that no application role can write a flag.": tests/backend/helpers.ts:285, tests/db/org-settings.test.ts:36, tests/db/org-subscriptions.test.ts:41.

_Evidence:_ supabase/migrations/20260717102000_org_subscriptions.sql:68-86 (CREATE TABLE), :88-91 (COMMENTs), :93-99 (triggers), :286-287 (RLS enable+force), :293-295 (sel_feature_flags_all), :312 (GRANT SELECT). Zero seeded rows: `grep -rn "INSERT INTO org.feature_flags" --include=*.sql --include=*.mjs --include=*.json . | grep -v node_modules` → no output; supabase/seeds/ contains 01_reference_data.sql, 04_iam_permission_catalog.sql, 05_shared_reference.sql, 06_wo_job_state_graph.sql, 07_inv_units_of_measure.sql, 08_sal_payment_methods.sql and none touches it.

### org.resolve_feature_enabled — function body outline and precedence

**EXISTS BUT NOT USED.**

Signature `org.resolve_feature_enabled(p_flag_code text, p_at timestamptz DEFAULT now()) RETURNS boolean`, LANGUAGE plpgsql, STABLE, SECURITY INVOKER, `SET search_path = ''` (:307-316). Body, three steps in order: Step 1 (:321-329) tenant override wins — `SELECT o.enabled INTO v_result FROM org.tenant_feature_overrides o WHERE o.tenant_id = iam.current_tenant_id() AND o.flag_code = p_flag_code AND tstzrange(o.effective_from, o.effective_to, '[)') @> p_at;` then `IF FOUND THEN RETURN v_result; END IF;` Step 2 (:331-341) plan entitlement — `v_plan_id := org.current_subscription_plan_id(p_at);` and if non-NULL, `SELECT (p.entitlement_document ->> p_flag_code)::boolean INTO v_result FROM org.subscription_plans p WHERE p.id = v_plan_id AND p.entitlement_document ? p_flag_code;` then `IF FOUND THEN RETURN v_result; END IF;` Step 3 (:343-351) platform default — `SELECT f.default_enabled INTO v_result FROM org.feature_flags f WHERE f.flag_code = p_flag_code; IF NOT FOUND THEN RAISE EXCEPTION 'feature flag % is not registered', p_flag_code USING ERRCODE = 'no_data_found'; END IF; RETURN v_result;` PRECEDENCE RULE (stated as a code comment at :306 and in the COMMENT at :355-356): tenant override > plan entitlement > platform default, each evaluated at `p_at`, each single-valued because of the overlap EXCLUDE constraints upstream. UNREGISTERED-FLAG BEHAVIOUR: raises, never returns false (:347-350). ERRCODE `no_data_found` = SQLSTATE P0002. A tenant with no override and no subscription therefore still gets a deterministic answer (the platform default) rather than a denial; a _typo_ gets an exception. Both are SECURITY INVOKER, so a tenant can only ever resolve its own overrides and its own subscription (RLS `sel_tenant_feature_overrides_*`, `sel_tenant_subscriptions_tenant`).

_Evidence:_ supabase/migrations/20260717105000_org_settings_tax_features.sql:307-353 (definition), :355-356 (COMMENT), :358-360 (REVOKE from PUBLIC; GRANT EXECUTE TO app_runtime, app_readonly).

### org.tenant_feature_overrides — the highest-precedence input

**EXISTS BUT NOT USED.**

Columns: id, tenant_id (FK org.tenants ON DELETE RESTRICT), flag_code (FK to org.feature_flags(flag_code) at :277-278), enabled boolean NOT NULL, reason text NOT NULL and non-blank (:279), effective_from/effective_to, record_version, created_at/created_by. `ex_tenant_feature_overrides_no_overlap` EXCLUDE USING gist over (tenant_id, flag_code, tstzrange(effective_from, effective_to,'[)')) at :284-289 — this is what makes step 1 of the resolver single-valued. Trigger tg_tenant_feature_overrides_immutable guards tenant_id, flag_code, enabled, effective_from. No application write grant or write policy exists; like the plan tables, overrides are platform-assigned. Zero rows are written by anything outside org.provision_organization and tests.

_Evidence:_ supabase/migrations/20260717105000_org_settings_tax_features.sql:262-290 (CREATE TABLE), :292-293 (COMMENT), :295-300 (indexes), :302-304 (immutability trigger), :373-374 (RLS enable+force).

### apps/api/src/server/auth/entitlement.ts — requireFeature and its single call site

**EXISTS BUT NOT USED.**

isFeatureEnabled runs `SELECT org.resolve_feature_enabled($1, $2) AS enabled` with `[flagCode, at ?? db.context.startedAt]` (:49-52) — the `at` default is the request start time, so a command is judged against the entitlement effective when it was issued (BR-TEN-001, documented at :11-14). A SQLSTATE P0002 is translated into `UnregisteredFeatureFlagError` (:55-57, class at :30-35) rather than a quiet false. requireFeature increments `METRICS.errorCount` with `code: 'ERR-TEN-001'` (:71), logs `result: 'denied'` with the flag code operator-facing only (:72-78), then throws `new AppFailure('ERR-TEN-001', { message: 'Tenant is not entitled to feature "<flag>"' })` (:80-82). The file's own docblock states the ordering rule at :16-18: entitlement runs AFTER authorization so an unauthorized caller cannot probe which features a tenant bought — and route-handler.ts:342-343 does exactly that. ERROR SHAPE: apps/api/src/server/errors/catalog.ts:146-155 — code ERR-TEN-001, title 'Feature not enabled', **status 403**, owner 'entitlement', class 'security', retryable false.

_Evidence:_ apps/api/src/server/auth/entitlement.ts:28 (`const NO_DATA_FOUND = 'P0002'`), :43-60 (isFeatureEnabled), :67-83 (requireFeature). Sole call site: apps/api/src/server/http/route-handler.ts:343 — `if (operation.featureFlag) await requireFeature(db, operation.featureFlag);`, immediately after `await requirePermissions(db, operation, options.authorizationTarget ?? {});` at :342, both inside `withTransaction` (:341). `grep -rn "requireFeature\|isFeatureEnabled" --include=*.ts apps/ tests/` returns that one production line plus tests/backend/authorization.test.ts:54-56,166-190.

### Operations declaring featureFlag — MEASURED COUNT = 0 of 305

**MISSING.**

The field is declared at operation-registry.ts:68-69 as `/** Feature flag code checked against `org.resolve_feature_enabled`. */ readonly featureFlag?: string;`. Because the call at route-handler.ts:343 is guarded by `if (operation.featureFlag)`, and no operation sets it, `requireFeature` is executed zero times in production and `ERR-TEN-001` is unreachable from the HTTP boundary. This matches the frozen P1-29 preparation set, which reached the same figure independently: p1-29-prep/docs/phase-1/phase-1-29/permission-matrix.md:274 ("zero of the 305 operations declare a featureFlag … the only three featureFlag mentions in apps/api/src are infrastructure"), blocker-register.md:219 (INS-22), exception-and-concurrency-model.md:336.

_Evidence:_ `grep -rn "featureFlag\s*:" --include=*.ts --include=*.tsx --include=*.mjs . | grep -v node_modules | wc -l` → 0. `grep -rn "featureFlag" --include=*.ts apps/ | wc -l` → 3, all infrastructure: apps/api/src/server/auth/operation-registry.ts:69 (the optional field on OperationDeclaration), apps/api/src/server/http/route-handler.ts:343 (the conditional call), apps/api/src/server/openapi/document.ts:229 (`...(operation.featureFlag ? { 'x-feature-flag': operation.featureFlag } : {})`). `grep -rn "featureFlag" --include=*.ts apps/api/src/modules | wc -l` → 0. Registered operation count: `grep -rn "= defineOperation({" --include=*.ts apps/api/src/app | wc -l` → 305, which equals `grep -c '"operationId"' docs/api/openapi.v1.json` → 305. `grep -c "x-feature-flag" docs/api/openapi.v1.json` → 0 (grep exit 1).

### org.subscription_plans — the plan catalogue and its validity window

**EXISTS BUT NOT USED.**

Columns recording a plan: plan_code text (`^[a-z][a-z0-9_]{1,62}$`, :121), name, description, entitlement_document jsonb DEFAULT '{}' (:109), capacity_limits jsonb DEFAULT '{}' (:110). VALIDITY WINDOW: status text DEFAULT 'draft' with `CHECK (status IN ('draft','active','retired'))` (:123), effective_from timestamptz NOT NULL (:112), effective_to timestamptz NULL (:113), plus `ck_subscription_plans_effective_interval CHECK (effective_to IS NULL OR effective_to > effective_from)` (:124-125) and `ex_subscription_plans_no_active_overlap EXCLUDE USING gist (plan_code WITH =, tstzrange(effective_from, effective_to,'[)') WITH &&) WHERE (status='active')` (:129-133). NO expiry column and no expiry job: a NULL effective_to is an open-ended plan version. entitlement_document is validated by trigger tg_subscription_plans_validate_documents (:199-201) → org.validate_plan_documents (:148-192): every entitlement key must exist in org.feature_flags (:170-173) and every value must be boolean (:174-177); every capacity value must be a non-negative number (:180-188). Because org.feature_flags is unseeded, any non-empty entitlement_document currently fails that check. SELECT policy hides drafts (:298-300). No write grant, no write policy for any application role.

_Evidence:_ supabase/migrations/20260717102000_org_subscriptions.sql:104-134 (CREATE TABLE), :136-137 (COMMENT), :139-145 (triggers), :148-201 (org.validate_plan_documents + trigger), :288-289 (RLS), :298-300 (sel_subscription_plans_published), :313 (GRANT SELECT).

### org.tenant_subscriptions — the assignment table

**EXISTS BUT NOT USED.**

Columns: id, tenant_id (FK ON DELETE RESTRICT), plan_id (FK ON DELETE RESTRICT), assigned_by uuid NOT NULL. VALIDITY WINDOW: status text DEFAULT 'draft' with `CHECK (status IN ('draft','active','cancelled','expired'))` (:225-226), effective_from timestamptz NOT NULL, effective_to timestamptz NULL, `ck_tenant_subscriptions_effective_interval` (:227-228), and `ex_tenant_subscriptions_no_active_overlap EXCLUDE USING gist (tenant_id WITH =, tstzrange(effective_from, effective_to,'[)') WITH &&) WHERE (status='active')` (:230-234) — at most one active assignment covers any instant, which is what makes `org.current_subscription_plan_id` deterministic (`SELECT s.plan_id ... WHERE s.tenant_id = iam.current_tenant_id() AND s.status='active' AND tstzrange(...) @> p_at`, :269-273). IS THERE AN EXPIRY? No mechanism. `'expired'` occurs exactly once in the whole migration series — in the CHECK at :226 (`grep -rn "'expired'" --include=*.sql supabase/ | grep -i subscri` returns only that line). No trigger, no function, no scheduled job, no application code transitions a subscription to 'expired' or 'cancelled'. Immutability trigger guards tenant_id and plan_id (:249-251), so a plan change is a new row. Grants: SELECT only; assignment is a platform operation in this phase (header :32-34).

_Evidence:_ supabase/migrations/20260717102000_org_subscriptions.sql:206-235 (CREATE TABLE), :237-238 (COMMENT), :240-243 (indexes), :245-251 (triggers), :290-291 (RLS), :302-304 (sel_tenant_subscriptions_tenant), :314 (GRANT SELECT). Resolver: :260-274 `org.current_subscription_plan_id(p_at timestamptz DEFAULT now())`, :279-281 grants.

### Subscription tables read by application code

**MISSING.**

The only writers in the repository are out-of-band: org.provision_organization inserts one org.tenant_subscriptions row when the spec carries a `subscription` document (supabase/migrations/20260717107000_org_provisioning.sql:146-169, selecting an active plan version whose tstzrange covers the requested start, :147-157, and raising `no_data_found` when none does), and the operator script scripts/db/provision-organization.mjs:119-137 inserts the org.subscription_plans row itself, guarded by `WHERE NOT EXISTS (SELECT 1 FROM org.subscription_plans WHERE plan_code = $1 AND status = 'active')`. Neither table has any HTTP surface: no operation reads a plan, lists subscriptions, or reports what a tenant is entitled to.

_Evidence:_ `grep -rn "tenant_subscriptions\|subscription_plans" --include=*.ts apps/` → no output. `grep -rn "current_subscription_plan_id" --include=*.ts --include=*.mjs . | grep -v node_modules` → only tests/db/foundation.test.ts:358 and tests/db/org-subscriptions.test.ts:254-287.

### org.subscription.manage — seeded, declared by nothing

**EXISTS BUT NOT USED.**

IS IT SEEDED? Yes, in the shipped permission catalogue, risk_level 'high'. IS IT DECLARED BY ANY OPERATION? No. It is one of four `org.*` codes with zero references in both trees — the sibling counts measured in this session: org.company.manage api=0 web=0, org.branch.manage api=0 web=0, org.department.manage api=0 web=0, org.subscription.manage api=0 web=0, against org.settings.manage api=15 web=5. It is further from reachable than the other three: the subscription tables carry SELECT-only grants and SELECT-only policies, so even a permission check would have nothing to authorize. NOTE ON THE ROLE MAPPING: docs/database/permission-catalog-reference.md:76 maps this code to a `platform_operator` role — that role is not seeded anywhere. `grep -rn "platform_operator" --include=*.sql --include=*.ts . | grep -v node_modules` returns only tests/db/iam-seeds.test.ts:15,37,59-61,171. The role and its permission mapping are an ephemeral test fixture (`insertBaselineRoles()`, tests/db/iam-seeds.test.ts:32-51), created per test tenant, not shipped state.

_Evidence:_ Seeded: supabase/seeds/04_iam_permission_catalog.sql:24 — `('org.subscription.manage', 'org', 'Manage tenant subscriptions', 'high', '00000000-0000-4000-8000-000000000001'),`. Declared by zero operations: `grep -rn "'org.subscription.manage'" --include=*.ts apps/api/src` → 0; `apps/web/src` → 0. Named by zero RLS policies: `grep -rn "subscription" --include=*.sql supabase/ | grep -i "permission\|manage"` returns only the seed line. Other appearances: docs/database/permission-catalog-reference.md:43 and :76, tests/db/iam-seeds.test.ts:60.

### org.tenants.status — the column, its CHECK, and the transition graph

**EXISTS AND LOAD-BEARING.**

Load-bearing as a _record_, not as a control. The graph enforced at :210-217 is: provisioning → {active, closed}; active → {suspended, closed}; suspended → {active, closed}; `closed` is terminal (no outbound arm). A no-op transition is refused at :204-207. The column COMMENT at :117 says the value is "Queryable by the future session layer (Phase 1-4) to refuse suspended/closed tenants" — Phase 1-4 shipped and no such query exists (see the enforcement items below).

_Evidence:_ supabase/migrations/20260717101000_org_tenants.sql:91 (`status text NOT NULL DEFAULT 'provisioning'`), :104-105 (`ck_tenants_status CHECK (status IN ('provisioning','active','suspended','closed'))`), :116-117 (COMMENT), :210-217 (transition graph inside org.change_tenant_status).

### Every code path reading org.tenants.status outside org.change_tenant_status

**EXISTS BUT NOT USED.**

There is exactly ONE non-transition read path, and it is a projection: 1. apps/api/src/modules/iam/data/organization-repository.ts:56-59 — `SELECT id, tenant_code, display_name, status, default_locale, default_timezone, record_version FROM org.tenants WHERE id = $1`, mapped to TenantRow.status at :67. 2. apps/api/src/modules/iam/application/organization-settings-service.ts:98-107 readTenant → toTenantView at :75-84, which copies `status: row.status` at :80. Also reached at :125 and :197 (the before/after reads of updateTenant). 3. apps/api/src/app/api/v1/org/tenant/route.ts:63-68 — `GET /api/v1/org/tenant`, operation `iam.tenant-settings-read`, permission `org.tenant.read`, returns the view including status. 4. apps/web/src/features/administration/organization/types.ts:27 (`readonly status: string`) and components/TenantForm.tsx:58 and :81 — rendered as a read-only `<Fact label={t('organization.status')} value={tenant.status} />`. No branch, guard, filter, or predicate anywhere consumes the value. The tenant UPDATE path cannot change it: the column grant at 20260726090000:174 is `GRANT UPDATE (display_name, default_locale, default_timezone)` only, the repository UPDATE names exactly those three (:88-92), and the service documents the exclusion at :112-114. `org.change_tenant_status` itself has one shipped caller: 20260717107000_org_provisioning.sql:254-261, executed only when the spec sets `tenant.activate`. meta-repository.ts:43-48 reads org.tenants but selects only `t.id`.

_Evidence:_ SQL, exhaustively: `grep -rn "org\.tenants" --include=*.sql supabase/ | grep -v "REFERENCES org.tenants"` yields only 20260717101000:87,112,114,116,121,122,125,129,199,219,229,238,239,245,253,259; 20260717106000:69 (a COMMENT); 20260717107000:132 (the provisioning INSERT); 20260726090000:174 (GRANT UPDATE (display_name, default_locale, default_timezone)) and :423 (upd_tenants_settings). Of those only :199 (`SELECT status INTO v_from ... FOR UPDATE`) and :219 (`UPDATE org.tenants SET status = ...`) touch status, and both are inside the transition function. TypeScript: `grep -rn "org\.tenants" --include=*.ts apps/` → apps/api/src/modules/iam/data/organization-repository.ts:58 and :88, apps/api/src/modules/meta/data/meta-repository.ts:46, plus three comment lines.

### Tenant-status enforcement at authentication

**MISSING.**

Login resolves the tenant as a lookup key from the verified identity (authentication-service.ts:317-355) and cross-checks a caller-supplied tenantId against the binding (:248-250), but never asks what state that tenant is in. A user belonging to a `suspended` or `closed` tenant authenticates exactly as before, receives a session, and gets a request context whose principal.tenantId is that tenant.

_Evidence:_ apps/api/src/server/context/resolve-context.ts:61-70 — the account lookup filters `AND status = 'active' AND deleted_at IS NULL` on **iam.user_accounts**, not on the tenant; :74-91 aggregates role grants by `g.status='active'` and validity dates. Neither statement mentions org.tenants. apps/api/src/modules/iam/application/authentication-service.ts contains no read of org.tenants (`grep -rn "org\.tenants" apps/api/src/modules/iam/application/authentication-service.ts` → only the comment at :80). `grep -rn "suspended\|'closed'" --include=*.ts apps/api/src apps/web/src` → provider-errors.ts:11 and supabase-provider.ts:172 (both about the _account_ being suspended at the identity provider) and apps/web/src/components/gallery/fixtures.ts (unrelated demo fixture).

### Tenant-status enforcement at authorization / RLS

**MISSING.**

Authorization is permission-based end to end; the tenant's lifecycle state is not an input to any policy, any `iam.has_permission*` function, or any operation guard.

_Evidence:_ No RLS policy in the 124-migration series predicates on tenant status: the tenant policies are `sel_tenants_self ... USING (id = iam.current_tenant_id())` (20260717101000:245-247), `sel_tenant_status_history_tenant ... USING (tenant_id = iam.current_tenant_id())` (:249-251) and `upd_tenants_settings ... USING (id = iam.current_tenant_id() AND iam.has_permission('org.settings.manage'))` (20260726090000:423-426). `iam.current_tenant_id()` is a bare `current_setting('app.tenant_id', true)::uuid` read (supabase/migrations/0002_base_schemas.sql:108-116) with no status lookup. apps/api/src/server/auth/authorization.ts contains no reference to org.tenants.

### Does ANY read path still work for a blocked tenant?

**MISSING.**

ENFORCEMENT IS NOWHERE — not at authentication, not at authorization, not at entitlement, and not in the database. Every one of the 305 operations, read and write alike, continues to function for a tenant whose status is 'suspended' or 'closed'. The single observable consequence of a suspension today is that `GET /api/v1/org/tenant` returns a different `status` string, which the web UI prints as a read-only fact (TenantForm.tsx:58,81). A `closed` tenant is likewise fully operational; `closed` being terminal in the transition graph (20260717101000:210-217) means only that the state cannot be left, not that anything is denied while in it.

_Evidence:_ Composite of the three preceding items: authentication reads iam.user_accounts.status (resolve-context.ts:61-70); authorization reads permissions only (authorization.ts); entitlement fires only for operations declaring featureFlag, of which there are 0 (route-handler.ts:343 guarded); no RLS policy reads org.tenants.status.

### org.companies

**MISSING.**

No relation of that name exists. The company table is `org.legal_companies`. The naming matters for the P1-29 work: the design documents and this lane brief both say "company", the schema says "legal company".

_Evidence:_ `grep -rn "org\.companies" --include=*.sql --include=*.ts --include=*.mjs . | grep -v node_modules` → no output. `grep -rn "CREATE TABLE" --include=*.sql supabase/ | grep -i compan` → org.legal_companies (20260717103000:53), org.company_settings (20260717105000:91), crm.company_profiles (20260719092000:126).

### org.legal_companies.status — the column that exists today

**EXISTS AND LOAD-BEARING.**

The CREATE TABLE in full (lines 53-83): CREATE TABLE org.legal_companies ( id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_code text NOT NULL, legal_name text NOT NULL, registration_number text NULL, tax_registration_number text NULL, base_currency_code text NOT NULL, status text NOT NULL DEFAULT 'active', record_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, updated_at timestamptz NULL, updated_by uuid NULL, deleted_at timestamptz NULL, deleted_by uuid NULL, archived_at timestamptz NULL, archived_by uuid NULL, CONSTRAINT pk_legal_companies PRIMARY KEY (id), -- Composite candidate key: children reference (tenant_id, id) so the tenant -- travels through every FK — cross-tenant links are structurally impossible. CONSTRAINT uq_legal_companies_tenant_id_id UNIQUE (tenant_id, id), CONSTRAINT fk_legal_companies_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT, CONSTRAINT fk_legal_companies_base_currency FOREIGN KEY (base_currency_code) REFERENCES shared.currencies (code), CONSTRAINT ck_legal_companies_code_format CHECK (company_code ~ '^[a-z][a-z0-9_]{1,62}$'), CONSTRAINT ck_legal_companies_legal_name_not_blank CHECK (btrim(legal_name) <> ''), CONSTRAINT ck_legal_companies_status CHECK (status IN ('active', 'inactive')) ); So: YES, a status column exists, defaulting to 'active' and constrained to exactly two states. Supporting objects: uq_legal_companies_tenant_code_active (partial unique, :93-95), ix_legal_companies_tenant_id_status (:97-98), tg_legal_companies_touch_metadata (:105-107), tg_legal_companies_immutable guarding tenant_id/company_code/created_at/created_by (:109-111) — status is NOT immutable. Policies: sel_legal_companies_tenant (:362-367), ins_legal_companies_tenant (:369-371), upd_legal_companies_tenant (:373-379) — none of the three names a permission. Grants: `GRANT SELECT, INSERT, UPDATE ON org.legal_companies TO app_runtime` (:422).

_Evidence:_ supabase/migrations/20260717103000_org_companies_branches.sql:53-83.

### A company status history table, under any spelling

**MISSING.**

Absent as a table, as a function, as a trigger, and as an operation. There is also no write path at all: `grep -rn "INSERT INTO org.legal_companies\|UPDATE org.legal_companies" --include=*.ts apps/` → no output, and the only two mentions of the table in apps/api/src are a read (organization-repository.ts:108, `SELECT true AS ok ...`) and a string in an allow-list (shared-services/domain/attachment-policy.ts:45). So today a company's status can be changed only by a direct UPDATE under `upd_legal_companies_tenant` (20260717103000:373-379) issued by something other than the shipped API, and nothing records that it happened. `shared.status_history` cannot serve as the host either: it is SELECT-only for both application roles (20260718096000_shared_status_history.sql:136-138, with INSERT/UPDATE/DELETE "deliberately ABSENT" at :138) and has no policy granting INSERT (:128-131).

_Evidence:_ Five independent searches, all run this session: (a) `grep -rn "^CREATE TABLE org\." --include=*.sql supabase/migrations/` → 17 org tables: branch_settings, branch_status_history, branches, company_settings, cost_centers, departments, feature_flags, legal_companies, storage_locations, subscription_plans, tax_classes, tax_rates, tenant_feature_overrides, tenant_status_history, tenant_subscriptions, tenants, warehouses — no company history. (b) `grep -rn "CREATE TABLE.*status_history" --include=*.sql supabase/migrations/` → 16 history tables (org.tenant_status_history, org.branch_status_history, iam.user_status_history, shared.status_history, crm.partner_status_history, veh.vehicle_status_history, apt.appointment_status_history, rec.reception_status_history, wo.work_order_status_history, wo.job_status_history, dia.diagnostic_report_status_history, qms.qc_status_history, quo.quotation_status_history, sal.invoice_status_history, sal.delivery_status_history, wty.warranty_status_history) — no company one. (c) `grep -rni "company_status_history" .` (excl. node_modules/.git) → three hits, all prose: docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-a-discovery.md:330 and wave-b-control-plane-design-v2.md:735, :840. (d) `grep -rni "change_company_status" .` → prose only: wave-a-discovery.md:330, wave-b-control-plane-design-v2.md:419, :480, :738, :840. (e) `grep -rni "legal_company_status\|company_status" --include=*.sql --include=*.ts .` → no output.

### ANALOGUE 1 — tenant status + history + org.change_tenant_status

**EXISTS AND LOAD-BEARING.**

TABLE org.tenants (:87-110): status text NOT NULL DEFAULT 'provisioning'; `ck_tenants_status CHECK (status IN ('provisioning','active','suspended','closed'))` (:104-105). Triggers: tg_tenants_touch_metadata (:124-126), tg_tenants_immutable_columns guarding tenant_code/created_at/created_by (:128-130) — status is mutable by design. HISTORY TABLE org.tenant_status_history (:135-157): id uuid PK; tenant_id uuid NOT NULL FK → org.tenants(id) ON DELETE RESTRICT (:146-147); from_state text NULL; to_state text NOT NULL; reason text NOT NULL; actor_id uuid NOT NULL; occurred_at timestamptz NOT NULL DEFAULT now(); correlation_id uuid NULL. CHECKs: `ck_tenant_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state)` (:148-149); `ck_tenant_status_history_states` restricting both columns to the four tenant states (:150-155); `ck_tenant_status_history_reason_not_blank CHECK (btrim(reason) <> '')` (:156). Index ix_tenant_status_history_tenant_id_occurred_at (:162-163). NO stamp trigger — unlike the branch table, actor_id and occurred_at are NOT server-overwritten here. FUNCTION `org.change_tenant_status(p_tenant_id uuid, p_to_state text, p_reason text, p_actor_id uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL) RETURNS void`, LANGUAGE plpgsql, SECURITY INVOKER, `SET search_path=''` (:172-226). Steps: reason non-blank or check_violation (:188-191); `v_actor := COALESCE(iam.current_user_id(), p_actor_id)` and NULL → check_violation (:193-197) — note it ACCEPTS an actor parameter as a fallback; `SELECT status INTO v_from FROM org.tenants WHERE id = p_tenant_id FOR UPDATE` with no_data_found if absent (:199-202); no-op refused (:204-207); graph validated (:210-217); `UPDATE org.tenants SET status = p_to_state` (:219); `INSERT INTO org.tenant_status_history (...)` (:221-224) — one transaction. POLICIES: sel_tenants_self (:245-247), sel_tenant_status_history_tenant (:249-251). No INSERT/UPDATE/DELETE policy on either table for application roles. GRANTS: `GRANT SELECT ON org.tenants TO app_runtime, app_readonly` (:259); `GRANT SELECT ON org.tenant_status_history TO app_runtime, app_readonly` (:260); write grants "deliberately ABSENT" (:262-263). The function is REVOKEd from PUBLIC (:231) and granted to NO application role (:232-233) — so it runs only under the admin/migration connection. Later, 20260726090000:174 adds `GRANT UPDATE (display_name, default_locale, default_timezone) ON org.tenants TO app_runtime` and :423-426 the upd_tenants_settings policy — status is excluded from both. HTTP OPERATION: none. `grep -rn "id: '.*tenant" --include=*.ts apps/api/src/app` → only iam.tenant-settings-read and iam.tenant-settings-update.

_Evidence:_ supabase/migrations/20260717101000_org_tenants.sql — table :87-110, history :135-157, function :172-226, RLS :238-254, grants :259-263.

### ANALOGUE 2 — branch status + history + transition path

**EXISTS AND LOAD-BEARING.**

TABLE org.branches (:116-156): status text NOT NULL DEFAULT 'active'; `ck_branches_status CHECK (status IN ('active','inactive'))` (:155). Composite FK `fk_branches_company FOREIGN KEY (tenant_id, company_id) REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT` (:146-148). Triggers: tg_branches_touch_metadata (:170-172), tg_branches_immutable on tenant_id/company_id/branch_code/created_at/created_by (:174-176), tg_branches_parent_company_live BEFORE INSERT → org.guard_parent_company_live() (:181-213) which refuses attaching a branch to a soft-deleted or archived company. HISTORY TABLE org.branch_status_history (:219-242): id, tenant_id, branch_id, from_state NULL, to_state NOT NULL, reason NOT NULL, actor_id NOT NULL, occurred_at DEFAULT now(), correlation_id NULL. Composite FK `(tenant_id, branch_id) → org.branches (tenant_id, id) ON DELETE RESTRICT` (:231-233). CHECKs: from≠to (:234-235), both states in ('active','inactive') (:236-240), reason non-blank (:241). Index :247-248. STAMP TRIGGER: `org.stamp_branch_history()` (:262-277), SECURITY INVOKER, sets `NEW.actor_id := iam.current_user_id()` (raising check_violation if NULL) and `NEW.occurred_at := now()`, attached as tg_branch_status_history_stamp BEFORE INSERT (:284-286). The rationale, and the residual honestly recorded, are at :250-261: a direct INSERT can still record a transition the branches table does not reflect, because history and the branch UPDATE are separate statements. FUNCTION `org.change_branch_status(p_branch_id uuid, p_to_state text, p_reason text, p_correlation_id uuid DEFAULT NULL) RETURNS void`, plpgsql, SECURITY INVOKER, `SET search_path=''` (:293-344). NO actor parameter — the actor comes only from `iam.current_user_id()` (:317-321). Steps: reason non-blank (:309-312), target state validated (:313-315), `SELECT b.status, b.tenant_id ... FOR UPDATE` under the caller's RLS (:324-330), no-op refused (:332-335), UPDATE (:337), history INSERT (:339-342). REVOKEd from PUBLIC and `GRANT EXECUTE ... TO app_runtime` (:349-350) — unlike the tenant function, this one IS runtime-executable. POLICIES: sel_branches_scope (:381-387), ins_branches_scope (:389-394), upd_branches_scope (:396-406) — tenant pivot plus company/branch narrowing, no permission named; sel_branch_status_history_tenant (:408-410), ins_branch_status_history_tenant (:414-416). GRANTS: `GRANT SELECT, INSERT, UPDATE ON org.branches TO app_runtime` (:424), `GRANT SELECT ON org.branches TO app_readonly` (:425), `GRANT SELECT, INSERT ON org.branch_status_history TO app_runtime` (:426), `GRANT SELECT ... TO app_readonly` (:427). DELETE absent everywhere. HTTP OPERATIONS (both exist): `shared.branch-status-read`, GET `/organization/branches/{branchId}/status`, permissions ['org.branch.read'], scope 'branch', auditClass 'none', rateLimitPolicy 'low-risk-metadata', cacheCategory 'never' (route.ts:33-44); and `shared.branch-status-change`, POST same path, permissions **['org.settings.manage']** (not org.branch.manage), scope 'branch', auditClass 'privileged', auditAction 'org.branch.status_changed', versionGuarded true, rateLimitPolicy 'standard-command' (route.ts:46-59). Body is `{ to: 'active'|'inactive', reason: string }` strict (route.ts:26-31); If-Match required (route.ts:91-93). ENGINE: transitions.ts:56-64 registers `org.branch` as the ONLY aggregate, with historyTable 'org.branch_status_history' and states ['active','inactive']; :76-97 registers the two transitions, both permission 'org.settings.manage', scope 'branch', auditAction 'org.branch.status_changed', eventType 'organization.branch.status.changed', requiresReason true.

_Evidence:_ supabase/migrations/20260717103000_org_companies_branches.sql — table :116-156, history :219-242, stamp trigger :262-286, function :293-350, policies :381-416, grants :424-427. HTTP: apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts. Engine: apps/api/src/modules/shared-services/domain/transitions.ts:56-97 and data/transition-repository.ts:58-152.

### org.change_branch_status is not what the shipped API calls

**EXISTS BUT NOT USED.**

The database function exists, is granted to app_runtime, and is exercised by DB tests — but the HTTP path bypasses it and reimplements the same two statements in TypeScript, adding an optimistic-concurrency predicate (`record_version = $3`) the SQL function does not have. Anything modelled on "the branch analogue" must decide which of the two is the template: the SQL function (§12.3's shape) or the adapter (what actually runs). The safety properties still hold for the adapter path because org.stamp_branch_history() overwrites actor_id and occurred_at regardless of who inserts (20260717103000:262-286), which the adapter documents at :113-116.

_Evidence:_ `grep -rn "change_branch_status" --include=*.ts apps/` → no output (the only TS hits for the branch history are the adapter's own SQL). apps/api/src/modules/shared-services/data/transition-repository.ts:86-101 issues `UPDATE org.branches SET status = $4 WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL`, and :103-132 issues its own `INSERT INTO org.branch_status_history (...)`. `grep -rn "change_branch_status" .` outside docs → supabase/migrations/20260717103000:293,346,349,350 and tests/db/foundation.test.ts:356, tests/db/org-hierarchy.test.ts:270-279.

### wave-b-control-plane-design-v2.md §12.3 — what company status history must be

**EXISTS AND LOAD-BEARING.**

§12.3 states the gap first: tenant has a transition function and an append-only history (citing 20260717101000:172 and org.tenant_status_history), branch has both (citing 20260717103000:293 and org.branch_status_history), and "Company has a status column (20260717103000:61, constrained to active or inactive at :82) and **neither** — verified by enumerating every org. table and every org. function in the migration series" (:729-731). It then specifies, by additive migration only (:733-739): • `org.company_status_history` — "append-only, recording the previous state, the new state, the actor, the reason, the moment, and the tenant and company, modelled column-for-column on the branch history table." • `org.change_company_status(...)` — "row lock, transition-graph validation, status update and history append in one transaction, `SECURITY INVOKER`, **no actor parameter** (§8, finding `N-8`)." And it bounds the scope (:741-742): "No route in wave B updates a company's status directly, and no operation exposes an arbitrary status write. The tenant-side operation that calls this function is wave C's." The migration table at :840 assigns both objects to slice M3. Everything §12.3 asserts about current state is confirmed by this survey; none of the objects it specifies exists yet.

_Evidence:_ docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-design-v2.md:722-742; migration slice named at :840 ("M3 | org.company_status_history and org.change_company_status"); the function also listed in the privilege table at :480 ("created and revoked from public by M3") and in the SECURITY INVOKER statement at :419.

---

## Unknowns — what could not be settled, and what would settle it

- Which layer is intended to refuse a suspended or closed tenant — authentication, context resolution, authorization, or RLS. Today it is none of the four. WHAT WOULD SETTLE IT: an explicit statement in the PRE-P1-29 scope or an Owner decision; the choice is consequential because refusing at authentication produces a login failure indistinguishable from the generic ERR-IAM-002 (authentication-service.ts:84-87 makes every failure answer identically), while refusing at context resolution or in RLS produces a different error surface for an already-authenticated session.
- Whether subscription administration is in scope at all. permission-reuse-register.md:269 and gap-register.md GAP-24 (:115) both record this as an Owner decision, not a technical one, and wave-b-control-plane-design-v2.md:715 marks the Subscription row 'Not required by wave B.' WHAT WOULD SETTLE IT: an explicit Owner scope statement. If in scope, org.subscription.manage is a WIRE (publish an operation under the existing code); if not, it stays inert like org.tax.manage.
- Whether any operation is supposed to declare a featureFlag in the pilot, and if so which. The mechanism, the error code, the OpenAPI extension and the metric are all in place and cost nothing until a flag is declared, but org.feature_flags is unseeded, so the first declaration would raise ERR-SYS-001 (via UnregisteredFeatureFlagError) rather than deny, until a flag row is seeded. WHAT WOULD SETTLE IT: a decision naming the gated operations plus a seed migration for the corresponding flag_codes — both halves are required together or the first request to a newly gated operation fails as a configuration defect.
- Whether the company transition should be built on org.change_company_status (as §12.3 specifies) or on the TypeScript adapter pattern that the branch aggregate actually runs (transition-repository.ts:58-152, which bypasses org.change_branch_status and adds a record_version predicate the SQL function lacks). WHAT WOULD SETTLE IT: reading transitions.ts:56-64 as normative — registering 'org.legal_company' as a second aggregate would mean the SQL function is never called, exactly as happens for branch — or an explicit decision that the function is the writer.
- Whether org.legal_companies needs a write surface before a status surface can exist. There is currently no create-company and no update-company operation at all (`grep -rn "INSERT INTO org.legal_companies|UPDATE org.legal_companies" --include=*.ts apps/` → nothing; org.company.manage has 0 references in both trees), so a status-change operation would be the first HTTP write path the table has ever had. WHAT WOULD SETTLE IT: the Wave C operation list.
- Who executes org.change_tenant_status in production. It is granted to no application role (20260717101000:231-233) and its only shipped caller is org.provision_organization:256, itself granted to no application role (20260717107000:281-282). Suspending a tenant today therefore requires a direct admin database connection. WHAT WOULD SETTLE IT: the Wave B/C design's decision on whether app_platform receives EXECUTE on it — wave-b-control-plane-design-v2.md §6.4 covers 'platform.organization.lifecycle' but this survey did not read that section closely enough to report its privilege list.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- The column COMMENT on org.tenants.status (20260717101000_org_tenants.sql:117) says the value is 'Queryable by the future session layer (Phase 1-4) to refuse suspended/closed tenants.' Phase 1-4 shipped (migrations 20260718*) and no such query exists anywhere. The comment reads as a delivered property but describes an intention. Comparable wording at :36-40 ('through the Phase 1-4/1-14 platform surfaces later') and in the function COMMENT at :229.
- Two code comments cite ADR-008 as the authority for 'tenant status is an owner/operator capability': apps/api/src/app/api/v1/org/tenant/route.ts:9-11 and apps/api/src/modules/iam/application/organization-settings-service.ts:112-114. docs/adr/ADR-008-configuration-driven-tenant-onboarding.md is 115 lines about not letting the pilot tenant's requirements leak into the product; `grep -ni 'status|suspend|lifecycle'` over it returns nothing. The cited authority does not contain the proposition.
- docs/database/permission-catalog-reference.md:76 documents a baseline role `platform_operator` holding tenant.read, subscription.manage and audit.view. No seed creates that role — it exists only inside the per-test fixture tests/db/iam-seeds.test.ts:32-51. A reader of the reference document would reasonably believe the role ships.
- Naming: the lane brief, wave-b-control-plane-design-v2.md §12.3 and the gap register all say 'company', while the relation is org.legal_companies and the migration file is 20260717103000_org_companies_branches.sql. There is no org.companies. §12.3's own citations use the correct table, but the object names it specifies (org.company_status_history, org.change_company_status) drop 'legal', which is inconsistent with org.legal_companies but consistent with org.company_settings — the schema is itself inconsistent on this point.
- org.tenant_subscriptions.status admits 'expired' (20260717102000:226) and the table COMMENT at :238 says 'an ending is effective_to/status', but nothing in the repository ever writes that value. Whether 'expired' is meant to be computed from effective_to or set by an absent platform operation is not stated anywhere.
- wave-b-control-plane-design-v2.md:738 requires 'transition-graph validation' for org.change_company_status but never states the graph, and the branch template it points at has only two states with a symmetric two-arc graph while the tenant template has four states with a terminal one. Which shape company lifecycle takes is not settled by the text.
