# PRE-P1-29 slice B2 — implementation-ready preparation

**B2 is the canonical slice immediately after B1: company status history and its transition
function** (`wave-b-control-plane-design-v2.md:956`, design §12.3 at `:722-742`, migration M3 at
`:840`).

**This document prepares it. It does not implement it.** Nothing here is a migration, a function
body or a route. The intent is that an implementation agent can begin without a second broad
discovery pass once B1's blocker clears.

## Why this slice is small, and why it is still not trivial

The gap is a genuine asymmetry, verified by enumerating every `org.` table and every `org.`
function in the migration series: **the tenant has a transition function and an append-only
history; the branch has both; the company has a status column and neither.** Today a company's
status can only change through a direct `UPDATE` under `upd_legal_companies_tenant`, unrecorded.

Two shipped templates exist — `org.change_tenant_status` and `org.change_branch_status` — and they
**disagree with each other** on three of the decisions B2 must make: who may execute the function,
whether the history INSERT policy requires a permission, and whether a soft-deleted row may
transition. Those disagreements are recorded as ambiguities rather than resolved here, because
choosing between two shipped precedents is a design decision this planning slice may not take.

One further caution the design does not state: `org.companies` **does not exist**. The relation is
`org.legal_companies`. Every document in the initiative says "company"; the schema says
`legal_companies`. Recorded as `AMB-61`.

---

## The preparation, field by field

### scope

**MISSING.**

B2 = exactly two new database objects plus their guard, policies and grants, delivered by additive migration only: (a) `org.company_status_history`, append-only, recording tenant, company, from_state, to_state, reason, actor, occurred_at and correlation id, modelled column-for-column on `org.branch_status_history` (20260717103000:219-242); (b) `org.change_company_status(...)`, SECURITY INVOKER, empty search_path, row lock + validation + status UPDATE + history INSERT in one transaction, with NO actor parameter (§8 rule 3, finding N-8 at wave-b-control-plane-refutation-register.md:345-357). Add: a BEFORE INSERT stamp trigger on the history table (the branch precedent's `org.stamp_branch_history()` at 20260717103000:262-286 is what makes actor and timestamp unforgeable on a DIRECT insert; without it the INSERT grant the function needs is also a forgery grant), the RLS enable+force pair, the SELECT/INSERT policies, the grants, and the FK-supporting index. Also in scope, because gates force it: the four exact-match inventories in tests/db/foundation.test.ts, the `deleteTenantCascade` entry in tests/db/helpers.ts, the data-dictionary row, and the baseline re-record.

_Evidence:_ docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-design-v2.md:722-745 (§12.3) and :948-967 (§19, slice B2 = "Company status history and its transition function (§12.3)", Reviewable alone: Yes)

### non-scope

**MISSING CONTRACT.**

OUT of B2: any HTTP operation, any route file, any change to apps/api/src, any permission seed, any OpenAPI path, any web screen, any audit-action catalogue entry, any event-catalogue entry, any registration in the TypeScript transition engine (`AGGREGATES`/`TRANSITIONS` at apps/api/src/modules/shared-services/domain/transitions.ts:56-97), any `app_platform` grant on `org.legal_companies` UPDATE, and any change to `org.change_tenant_status` or `org.change_branch_status` (§8 rule 4). Also out: widening `ck_legal_companies_status` beyond active/inactive — that would require editing an applied migration, which §15 forbids. Consequence to state plainly: at the end of B2 the function is callable by nothing in the product, exactly as `org.change_branch_status` is today.

_Evidence:_ wave-b-control-plane-design-v2.md:741-745 — "No route in wave B updates a company's status directly, and no operation exposes an arbitrary status write. The tenant-side operation that calls this function is wave C's."; §12.2 matrix row Company: "wave C, identity module … Deferred — §12.3 builds the database half only"; §17 (:906-928) moves P-21 and slice B8 to wave C

### schema inventory

**MISSING.**

The table is `org.legal_companies` (20260717103000:53-83), NOT `org.companies`; there is no `org.companies` anywhere. Its status column is line 61 (`status text NOT NULL DEFAULT 'active'`) and its constraint line 82 (both citations in §12.3 are exact). The 17 org tables are: branch_settings, branch_status_history, branches, company_settings, cost_centers, departments, feature_flags, legal_companies, storage_locations, subscription_plans, tax_classes, tax_rates, tenant_feature_overrides, tenant_status_history, tenant_subscriptions, tenants, warehouses. "The company table also carries `record_version`/`deleted_at`/`archived_at` (:62,:67,:69)"\n\nThis is the minimal edit: reorder the three names to match the line numbers already given, leaving the rest of the sentence ("that the branch history template's parent does too but that neither transition function consults — see the ambiguities") untouched, and bringing :52 into agreement with the same document's correct citation at :235.\n\nIf the author prefers to remove the positional ambiguity that produced the slip in the first place, the equivalent explicit form is: "The company table also carries `record_version` (:62), `deleted_at` (:67) and `archived_at` (:69)". Either is factually correct; the reorder is the smaller change and is what I recommend. Do NOT change the line numbers — :62/:67/:69 are all exact. that the branch history template's parent does too but that neither transition function consults — see the ambiguities. Design §12.3's citation "20260717103000:293, table org.branch_status_history" is a slip: :293 is the function, the table is :219.

_Evidence:_ `grep -rniE "company_status|companies_status|status_history_company|change_company|company_lifecycle" supabase/migrations/` → 1 line, and it is `supabase/migrations/20260717103000_org_companies_branches.sql:82: CONSTRAINT ck_legal_companies_status CHECK (status IN ('active', 'inactive'))`. `grep -rniE "company_status|change_company_status" apps/ tests/ scripts/` → 0. `grep -rhoE "CREATE TABLE org\.[a-z_]+" supabase/migrations/ | sort` → 17 tables, none named company_status_history.

### existing functions

**EXISTS AND LOAD-BEARING.**

THREE templates, and they differ on three axes B2 must resolve. ACTOR — branch takes none and reads `iam.current_user_id()` at :317-321; user takes none and reads it at :287-290 and :314; tenant takes `p_actor_id uuid DEFAULT NULL` and does `COALESCE(iam.current_user_id(), p_actor_id)` at :193 (this is the C5 forged-actor shape §8 names). GRAPH — branch validates only the enum and `v_from <> p_to_state` (:313, :332); tenant validates a real 4-state graph at :210-217; user validates a real 4-state graph at :302-309. EXECUTE — branch is granted to app_runtime (:350); tenant is granted to nobody with a comment saying so (:231-233); user is granted to app_runtime by a LATER migration (20260726090000:128). All three are SECURITY INVOKER with `SET search_path = ''` and all three are REVOKEd from PUBLIC. B2 follows the branch signature shape per §8 rule 3, so: `org.change_company_status(p_company_id uuid, p_to_state text, p_reason text, p_correlation_id uuid DEFAULT NULL) RETURNS void`.

_Evidence:_ org.change_branch_status: supabase/migrations/20260717103000_org_companies_branches.sql:293-350. org.change_tenant_status: supabase/migrations/20260717101000_org_tenants.sql:172-233. iam.change_user_status: supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:269-321. org.stamp_branch_history: 20260717103000:262-286. shared.stamp_status_history: 20260718096000:69-93.

### missing functions

**MISSING.**

B2 adds `org.change_company_status(uuid, text, text, uuid)` and `org.stamp_company_history()` (the trigger function). Both must be SECURITY INVOKER with `SET search_path = ''` and `REVOKE EXECUTE … FROM PUBLIC`, because scripts/ci/migration-replay-checks.mjs:221-224 hard-fails on `security_definer !== 0` and that rule lives in the script, not the baseline, so it cannot be raised by editing a file. Both names must be added to `ALLOWED_ROUTINES` (tests/db/foundation.test.ts:289) or the exact-equality assertion at :641-649 goes red. Trigger names must be added to the exact list at :659ff.

_Evidence:_ `grep -rhoE "CREATE OR REPLACE FUNCTION org\.[a-z_]+" supabase/migrations/ | sort -u` → 12 functions: change_branch_status, change_tenant_status, current_subscription_plan_id, guard_immutable_columns, guard_parent_branch_live, guard_parent_company_live, guard_parent_warehouse_live, provision_organization, resolve_feature_enabled, stamp_branch_history, validate_plan_documents, validate_setting_value. Confirmed against the exact-match inventory in tests/db/foundation.test.ts:356-367.

### existing API

**EXISTS BUT NOT USED.**

This is the nearest precedent, and the important discovery is that it does NOT call the database function. The POST handler calls `sharedServicesModule().transitions.apply(db, { aggregate: 'org.branch', … })` (:94-100), which routes to `BranchTransitionAdapter` in apps/api/src/modules/shared-services/data/transition-repository.ts:58-132 — raw `UPDATE org.branches` (:95-99) and raw `INSERT INTO org.branch_status_history` (:117-131). `grep -rn "change_branch_status" apps/` returns nothing; the only references are tests/db/foundation.test.ts:356 and tests/db/org-hierarchy.test.ts:270-311. So `org.change_branch_status` holds an EXECUTE grant and has zero product callers. The opposite precedent exists too: `iam.change_user_status` IS called from product code at apps/api/src/modules/iam/data/identity-repository.ts:309. Which of the two wave C follows is undecided — see ambiguities.

_Evidence:_ apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:46-59 — `defineOperation({ id: 'shared.branch-status-change', module: 'shared-services', method: 'POST', path: '/organization/branches/{branchId}/status', permissions: ['org.settings.manage'], scope: 'branch', auditClass: 'privileged', auditAction: 'org.branch.status_changed', versionGuarded: true, rateLimitPolicy: 'standard-command', cacheCategory: 'never' })`; read operation at :33-44 with `permissions: ['org.branch.read']`

### missing API

**MISSING CONTRACT.**

No operation creates, updates, lists or transitions a company. The only company operations are `iam.company-settings-read` (`org/companies/[companyId]/settings/route.ts:37,42`, permission `org.company.read`) and `iam.company-settings-write` (:50,:55, permission `org.settings.manage`). B2 publishes none, so this row stays MISSING at the end of the slice by design. The shape wave C would need, derived from the branch precedent: `POST /api/v1/org/companies/{companyId}/status`, module `iam` (§12.2's naming matrix places it in the identity module, because there is no `org` module and nineteen exist), scope `company`, `versionGuarded: true`, `auditClass: 'privileged'`, plus a new audit action code and a new event type — the last two are separate exact-match catalogues (apps/api/src/server/auth/audit-actions.ts:229 and apps/api/src/server/events/envelope.ts:266, both mirrored by exact lists in tests/foundation/p1-15-catalogs.test.ts:281,412,675,719).

_Evidence:_ `node -e "const d=require('./docs/api/openapi.v1.json');console.log(Object.keys(d.paths).filter(p=>/org|company|branch|status/i.test(p)).join('\n'))"` → 16 paths, of which the only org ones are /api/v1/org/branches/{branchId}/settings, /api/v1/org/companies/{companyId}/settings, /api/v1/org/tenant, /api/v1/organization/branches/{branchId}/status. No company status path. Corroborated by gap-register.md:110 (GAP-19) and permission-reuse-register.md:129.

### permission catalogue impact

**EXISTS BUT NOT USED.**

B2 seeds NOTHING. §12.1 (:690-699) says wave B adds no organisation permission and duplicates none, and the baseline `permissionCount` (112 on develop, 115 after B1) therefore does not move. But B2 still has to answer the permission question, because a policy is where a permission becomes real: `org.company.manage` is a confirmed orphan, and the precedent for gating a history INSERT on a permission already exists — `ins_user_status_history_admin` requires `iam.has_permission('iam.user.manage')` (20260726090000:193-195), while `ins_branch_status_history_tenant` requires no permission at all (20260717103000:414-416). Whichever B2 picks, it must ALSO be true of the parent UPDATE, and today `upd_legal_companies_tenant` (:373-379) checks no permission — so wiring `org.company.manage` only into the history policy would be theatre: the status column would still be writable without it.

_Evidence:_ supabase/seeds/04_iam_permission_catalog.sql:18 — `('org.company.manage','org','Create and update companies','medium', …)`. Repository-wide search for `org.company.manage` outside docs returns exactly two hits: that seed line and tests/db/iam-seeds.test.ts:62 (a role-mapping fixture). Zero in apps/api/src, zero in apps/web/src, zero in supabase/migrations. Corroborated: gap-register.md:107 (GAP-16), permission-reuse-register.md:129, wave-a-discovery.md:148.

### RLS implications

**AVAILABLE.**

B2 must ship: `ALTER TABLE org.company_status_history ENABLE ROW LEVEL SECURITY` AND `FORCE` (tests/db/foundation.test.ts:617-628 asserts both for every module-schema table, and scripts/ci/rls-matrix.mjs:213-217 fails on a missing FORCE with `FORCE_RLS_EXEMPT` deliberately empty at :104); a SELECT policy naming `app_runtime, app_readonly`; an INSERT policy naming `app_runtime`; and NO update/delete policy. Grant/policy coherence is checked per action (rls-matrix.mjs:243-249): granting `app_readonly` SELECT without naming it in a policy is the exact failure the branch template avoids. Two traps. (1) The UPDATE half of the transition runs under `upd_legal_companies_tenant`, which narrows on `iam.allowed_company_ids()` — so a company-narrowed operator can transition only companies in their list, and an UNRESTRICTED operator (NULL list) can transition every company in the tenant, gated by nothing. (2) On develop the matrix's policy query at :178-191 selects `polname` and command only and never reads `p.polroles`, so it cannot tell whether the covering policy applies to the role in the cell — a false pass B2 must not rely on. B1's revision fixes this (git show origin/feature/pre-p1-29-backend-b1-platform-authority-foundation:scripts/ci/rls-matrix.mjs, :250-264).

_Evidence:_ Existing company policies: sel_legal_companies_tenant (20260717103000:362-367), ins_legal_companies_tenant (:369-371), upd_legal_companies_tenant (:373-379) — all `TO app_runtime`/`app_readonly`, all tenancy + `iam.allowed_company_ids()` narrowing, none checking a permission. Branch history policies: sel_branch_status_history_tenant (:408-410, `TO app_runtime, app_readonly`), ins_branch_status_history_tenant (:414-416, `TO app_runtime`). No UPDATE or DELETE policy exists on either history table.

### audit implications

**MISSING.**

B2 produces evidence in `org.company_status_history` and NOTHING in `iam.audit_records`, because in this repository the audit record is written by the API layer and B2 has no API layer. That is the branch precedent exactly, so it is defensible — but it must be stated, not assumed, because a reviewer reading "append-only lifecycle evidence" may expect an audit row. The history table IS the audit surface for B2, and its integrity rests on three things B2 must all ship: the mandatory non-blank `reason` CHECK, the `from_state IS DISTINCT FROM to_state` CHECK, and the BEFORE INSERT stamp trigger overwriting `actor_id` from `iam.current_user_id()` and `occurred_at` from `now()`. The residual the branch template records honestly at :256-261 — a self-attributed, now()-stamped direct INSERT can still record a transition the parent table does not reflect, because history and the UPDATE are separate statements — carries over verbatim to B2 and should be copied into the new table's COMMENT rather than quietly dropped.

_Evidence:_ apps/api/src/server/auth/audit-actions.ts:229 (`org.branch.status_changed`) is reached only from the route/engine layer: apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:55 and apps/api/src/modules/shared-services/domain/transitions.ts:83,93. `org.change_branch_status` (20260717103000:293-344) writes NO audit record; nor does `org.change_tenant_status` (20260717101000:172-226) or `iam.change_user_status`. scope.md:169-171 — "Wave B must also decide, and record, how a control-plane action is audited."

### migration plan

**AVAILABLE.**

ONE migration file, additive only, no applied file edited. Filename `202608220930 00_org_company_status_history.sql` or later — it must sort strictly after `20260822092000` if B2 stacks on B1 (tests/db/foundation.test.ts:1894-1898 asserts filenames are ordered AND unique by prefix), must match `/^(\d{4}|\d{14})_[a-z0-9_]+\.sql$/`, and must carry a `Rollback classification` line in its first 2000 bytes (:1900-1907). It must not match the reserved prefix `120` (scripts/ci/migration-replay-checks.mjs:382-394 against `forbiddenMigrationPrefix`). Contents, in order: CREATE TABLE with pk/composite FK `(tenant_id, company_id) → org.legal_companies (tenant_id, id) ON DELETE RESTRICT`/three CHECKs; COMMENT ON TABLE; `CREATE INDEX ix_company_status_history_tenant_company_occurred ON (tenant_id, company_id, occurred_at)` — leading columns must equal the FK column set as a SET, per tests/db/org-security.test.ts:117-148 and scripts/db/structural-review.mjs:96-111; the stamp function + REVOKE + trigger; the transition function + COMMENT + REVOKE + (grant decision); ENABLE/FORCE RLS; the two policies; the grants; and a commented ROLLBACK block giving the exact inverse, following 20260726090000's convention (its block begins at the `-- ROLLBACK (exact inverse …)` comment after :430).

_Evidence:_ §15 (:830-854) names M3 as "org.company_status_history and org.change_company_status". Highest applied filename on develop: `20260819090000_rec_damage_map_revision_required.sql` (124 files, `ls supabase/migrations | wc -l` → 124). Highest on the unmerged B1 branch: `20260822092000_iam_platform_privilege_graph.sql` (migrationCount 127 in that branch's .github/ci-baselines/schema-baseline.json). Naming/ordering/rollback-header rules: tests/db/foundation.test.ts:1885-1907.

### rollback plan

**AVAILABLE.**

Classification for B2: ROLLBACK-SAFE while `org.company_status_history` holds zero rows; ROLL-FORWARD-ONLY the moment one transition has been recorded, because the table is evidence — the same wording `org.branch_status_history` and `shared.status_history` (20260718096000:17-19) both use. The inverse, in reverse creation order: DROP POLICY ins_company_status_history_tenant; DROP POLICY sel_company_status_history_tenant; REVOKE the grants; DROP FUNCTION org.change_company_status(uuid, text, text, uuid); DROP TRIGGER tg_company_status_history_stamp; DROP FUNCTION org.stamp_company_history(); DROP INDEX ix_company_status_history_tenant_company_occurred; DROP TABLE org.company_status_history. Note what a rollback does NOT restore: nothing, because B2 alters no existing object — `ck_legal_companies_status`, `upd_legal_companies_tenant` and the touch/immutable triggers are untouched, which is what makes the inverse exact. The migration is also NOT idempotent-by-CREATE-IF-NOT-EXISTS and should not be made so: the replay job runs from empty (scripts/ci/migration-replay-checks.mjs --phase pre/post) and a silently-skipped CREATE would hide a divergence.

_Evidence:_ Convention: supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql — a commented `ROLLBACK (exact inverse …)` block listing every DROP POLICY in reverse creation order. Classification precedent: 20260717103000:17-19 ("ROLLBACK-SAFE while empty; roll-forward-only once organizational rows exist") and 20260717101000:19-22, which also names docs/database/phase-1-3-migration-classification.md.

### test plan

**AVAILABLE.**

New file `tests/db/org-company-status.test.ts` (or an added describe in org-hierarchy.test.ts), mirroring the seven branch cases one-for-one against COMPANY_A1: (1) a runtime session transitions its own company and the history row lands atomically — assert status changed, exactly one history row with from_state/to_state/reason/actor_id, then assert the rolled-back transaction reverted BOTH (the branch test does this at :290-296 and it is what proves atomicity rather than mere co-occurrence); (2) blank reason → SQLSTATE 23514; (3) another tenant's session → P0002 (`no_data_found`, because RLS makes the row not-found, not forbidden — the refusal must be non-disclosing); (4) runtime UPDATE and DELETE on the history table → 42501 twice; (5) forging a history row for TENANT_B → 42501 via WITH CHECK; (6) a direct INSERT spoofing `actor_id` and back-dating `occurred_at` → both overwritten by the trigger; (7) a direct INSERT with no session user → 23514. Add three the branch template does not have and B2 needs: (8) `app_readonly` can SELECT the history and cannot INSERT; (9) a no-op transition (`active → active`) is refused; (10) a company narrowed OUT of `iam.allowed_company_ids()` cannot be transitioned — which is the only test that exercises the narrowing arm of `upd_legal_companies_tenant`. Also required, or the tier breaks: add `await deleteFrom('org.company_status_history')` to `deleteTenantCascade` in tests/db/helpers.ts BEFORE the `org.legal_companies` line (currently :623) — tests/db/fixture-cleanup-coverage.test.ts:1-22 checks the cascade against the DATABASE, so every table with a `tenant_id` column must be named, and the file's own header records that six missing tables is how the P1-18 tier silently poisoned itself.

_Evidence:_ Template: tests/db/org-hierarchy.test.ts:270-368, the `org.change_branch_status` describe block — seven cases. Harness: tests/db/helpers.ts (`withRolledBackTx` :195, `setContext` :176, `expectSqlState` :1022 in the B1 revision), `runtimePool`, `readonlyPool`, TENANT_A/TENANT_B/USER_A/USER_B, COMPANY_A1 (:84).

### mutation tests

**AVAILABLE BUT NEEDS ADAPTER.**

Every mutation B2 owes is a SQL-object mutation, and no committed harness can perform one. The pattern to adopt is B1's, and its header states the three rules that make it non-vacuous: (1) PROVE THE TARGET EXISTS before removing it — a mutation that removes something already absent measures the wrong cause; (2) remove it and require the EXACT failure; (3) restore in `finally` and re-prove the path is green, or a failure here leaves the developer database permanently under-granted and every later suite fails for an unrelated reason. It also records why the mutation must COMMIT: the mutation is made on the admin connection and the path executes on the runtime connection, and an uncommitted DDL change on one is invisible to the other. The B2 mutation set, each with the positive control §16 requires (`:170-177`): M-1 drop `ins_company_status_history_tenant` → the transition fails AND the status change rolls back with it (this is design P-32 applied to company, and it is the one that proves the history write is load-bearing rather than incidental); M-2 revoke INSERT on the history table → same, asserted on message text naming the privilege, never on SQLSTATE, because 42501 is raised by a trigger, a row-level denial and a missing grant alike (§16 P-24); M-3 drop the stamp trigger → the spoof/back-date test goes red rather than quiet; M-4 drop the `from_state IS DISTINCT FROM to_state` CHECK → the no-op test goes red; M-5 revoke EXECUTE on the transition function → the caller fails naming the function; M-6 drop `sel_company_status_history_tenant` → the read-back returns zero rows while the write still succeeds (this distinguishes a silent policy failure from a loud privilege failure, the P-25/P-25b distinction).

_Evidence:_ `grep -n "supabase/migrations\|migrations/" scripts/ci/hostile-mutations.mjs scripts/p1-24-mutation-matrix.mjs scripts/p1-23-mutation-matrix.mjs scripts/ci/mutation-assurance.mjs` → no matches. All three harnesses mutate `apps/api/src` / `apps/web` files and re-run vitest (scripts/ci/hostile-mutations.mjs:24-26 imports API_SRC_PATH; scripts/p1-24-mutation-matrix.mjs:50 imports API_SRC_PATH). Counter-evidence on the unmerged B1 branch: tests/db/pre-p1-29-b1-privilege-mutations.test.ts:1-34 performs COMMITTED DDL mutations from inside the suite and restores them in `finally`.

### under-grant matrix

**MISSING.**

Nothing in the repository will notice a privilege B2 forgets, so B2 must assert PRESENCE for each. The required set, each asserted with `has_table_privilege` / `has_function_privilege` from the admin connection AND exercised end-to-end from the role's own connection: app_runtime SELECT on org.company_status_history; app_runtime INSERT on org.company_status_history; app_readonly SELECT on org.company_status_history; app_runtime EXECUTE on org.change_company_status (IF the grant decision is to give it); and the privileges the function's body depends on that are NOT new and must be re-asserted because the chain fails at the weakest link — app_runtime UPDATE on org.legal_companies (20260717103000:422), app_runtime SELECT on org.legal_companies (same line), EXECUTE on iam.current_user_id() and iam.current_tenant_id(), and EXECUTE on iam.allowed_company_ids() which `upd_legal_companies_tenant` calls. Five of the six defects the wave-B design review found were privileges omitted from the MIDDLE of a SECURITY INVOKER call chain (§22, and the B1 privilege-graph migration is organised by execution path for exactly that reason), so the assertion must walk the chain, not the object list.

_Evidence:_ scripts/ci/rls-matrix.mjs:236-237 — `if (!granted) { verdict = 'denied-by-grant' }` returns before any policy check. Design §14 states the consequence at :116-123: "the gate detects over-granting and is structurally blind to under-granting. Every one of the five instances in §22 was an under-grant." B1 keeps the short-circuit (its :367-368) and answers it with a separate file, tests/db/pre-p1-29-b1-privilege-matrix.test.ts.

### over-grant matrix

**AVAILABLE.**

What must be ABSENT, and what will catch it. app_readonly must hold no INSERT/UPDATE/DELETE — caught unconditionally at :254-256. app_worker must hold nothing on the new table — caught as `granted-no-policy` if granted without a policy, and B2 should assert its absence directly because a grant WITH a policy would pass. app_platform must hold nothing on the new table: B1 grants app_platform SELECT and INSERT on `org.legal_companies` (its 20260822092000:180,:247) but NOT UPDATE, so the company status column is deliberately out of the control plane's reach and B2 must not open it. No role may hold UPDATE or DELETE on the history table for any reason — that is what "append-only" means here and it is enforced by absent grant AND absent policy, denied twice (the 20260717101000:262-264 formulation). TRUNCATE deserves its own line, and B1's ACTIONS comment says why: row-level security does not apply to TRUNCATE at all, so a TRUNCATE grant is an unconditional "delete every row of every tenant" that no policy can qualify — and on develop the gate never asks for it. Cell arithmetic: 3×4 = 12 new matrix cells on develop, 4×8 = 32 on top of B1.

_Evidence:_ scripts/ci/rls-matrix.mjs:34 (`org` is in CRITICAL_SCHEMAS, so a new org table is picked up on every PR without any registration), :81-85 (RUNTIME_ROLES, three entries on develop), :87 (ACTIONS, four on develop), :219-256 (the cell loop), :254-256 (a read-only role holding a write privilege is an unconditional failure), :291-295 (any SECURITY DEFINER in the schema is a failure). On the B1 branch RUNTIME_ROLES has four entries (`app_platform`, its :97-111) and ACTIONS has eight (:127-136: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN).

### clean replay expectations

**AVAILABLE.**

Six figures move, and one deliberately does not. FROM the B1 baseline (the correct base if B2 stacks): migrationCount 127 → 128; tables 249 → 250; functions 527 → 529 (change_company_status + stamp_company_history); triggers 554 → 555 (tg_company_status_history_stamp); policies 688 → 690 (sel + ins); security_definer stays 0; permissionCount stays 115 — and that last one must be stated as a deliberate non-move, because §12.1 forbids seeding a code with no operation. schemaHash is re-measured, not derived: it covers the 17 RootLco business schemas and IS locally reproducible (`npm run validate:schema-inventory -- --hash-only`), and it moves for the new INDEX as well as the table — B1's own note records that `ix_platform_grants_permission_code` alone moved it, so the FK-support index is part of the delta. `structuralTotals` cannot be reproduced on a developer stack (local Supabase carries auth/storage/realtime objects the CI plain-postgres container does not; the baseline records local readings of tables 292 / functions 591 / triggers 548 / security_definer 6 as non-comparable), so those four are derived by addition from the migration and confirmed by the hosted clean room. Re-record order is fixed and non-negotiable: regenerate, then record, then commit — recording before the documents are green bakes a failure count into the ledger and the sequence never converges (§15:160-164).

_Evidence:_ .github/ci-baselines/schema-baseline.json on develop: migrationCount 124, permissionCount 112, structuralTotals {tables 248, functions 525, policies 649, triggers 551, security_definer 0}, schemaHash 9f536a46…. Same file on origin/feature/pre-p1-29-backend-b1-platform-authority-foundation: migrationCount 127, permissionCount 115, {tables 249, functions 527, policies 688, triggers 554, security_definer 0}, schemaHash 11ab5565…. Enforced by scripts/ci/migration-replay-checks.mjs:200-241; run by .github/workflows/_reusable-database-assurance.yml:141,184,248 and _reusable-clean-room.yml:134.

### OpenAPI impact

**MISSING CONTRACT.**

ZERO change, and the zero is an assertion rather than an omission: B2 calls no `defineOperation`, so the registry is unchanged, so the regenerated document is byte-identical and the divergence test stays green without an edit. The same holds for every registry-derived artefact — apps/web/src/lib/api/idempotent-operations.ts (validate:idempotent-operations), docs/phase-1/phase-1-24/evidence/operation-register.json (validate:p1-24-register), scripts/check-authorization-coverage.mjs and scripts/check-operation-test-coverage.mjs. If any of them moves on a B2 branch, that is evidence B2 has exceeded its scope. Worth writing into the PR description as a falsifiable claim, because the whole slice is defined by what it does not publish.

_Evidence:_ scripts/check-openapi.mjs:8-17 — the committed docs/api/openapi.v1.json is regenerated from the operation registry and compared by tests/foundation/openapi.test.ts; check-openapi.mjs is the structural sanity gate only. `node -e` over the document shows no `/org/companies/{companyId}/status` path.

### documentation impact

**AVAILABLE.**

MANDATORY, gated: a `### org.company_status_history` section in docs/database/data-dictionary.md following the :351-355 shape — "**Scope:** tenant · **Retention class:** evidence-audit" plus the column table with Type / Null / Default / Classification. MANDATORY, not gated but conventionally owed: a row in docs/security/phase-1-3-org-rls-policy-matrix.md beside the `org.branch_status_history` row at :40 ("tenant-owned, append-only | R + I (tenant) | R | no UPDATE/DELETE"), and a rollback classification entry alongside docs/database/phase-1-3-migration-classification.md's siblings. OPTIONAL but recommended: docs/database/erd/phase-1-3-organization.mmd, which currently does not carry `branch_status_history` either — adding company history without branch history there would be inconsistent, so either both or neither. Also owed by the initiative's own bookkeeping: the wave-b design's §12.3 and §15 M3 rows should be marked implemented, and wave-a-discovery.md:330 — the finding that first recorded this gap — should be dispositioned. Note there is no GAP-nn for it: the gap-register has no row for company status history (GAP-19 covers create/update, GAP-16 covers permission wiring), so the finding lives only in wave-a-discovery §10 and design §12.3.

_Evidence:_ scripts/db/structural-review.mjs:131-142 — gate (c) reads docs/database/data-dictionary.md and fails on any live module table whose fully-qualified name the file does not contain (`zero_dictionary_drift`, :152); run in CI at .github/workflows/_reusable-database-assurance.yml:242 and _reusable-clean-room.yml:152. Existing rows: data-dictionary.md:225 (`org.tenant_status_history`), :298 (`org.legal_companies`), :351 (`org.branch_status_history`). Precedent for the size of the edit: the B1 branch adds 27 lines to that file for one new table.

### Owner acceptance impact

**MISSING.**

Nothing about B2 is testable by hand, and that must be said out loud rather than discovered at the acceptance gate: there is no request that reaches `org.change_company_status` and no screen that shows `org.company_status_history`. The Owner cannot Pass or Fail this slice; wave C's operation is the first thing that can be accepted. Two operational consequences. (1) `supabase db reset` — required to measure the new schemaHash — DESTROYS the Owner acceptance environment, so B2's local verification must not be run against the acceptance database, and the acceptance fixtures must be re-provisioned afterwards. (2) The acceptance reset survives a new table by construction because it reads the catalogue, and its `MINIMUM_PLAUSIBLE_SCOPED_TABLES` guard (:79-86) is a floor, so adding a table only raises the scanned count — but `verify-reset.mjs`'s named-counter list is hand-written, and adding `ACCEPTANCE_COMPANY_STATUS_HISTORY_COUNT` there is a judgement call rather than a requirement, since the existing branch history table is absent from it too.

_Evidence:_ scope.md:157 — wave I is "Owner acceptance by hand, against a production build, with an explicit written Pass." B2 publishes no operation (see OpenAPI impact) and no screen. Acceptance tooling: scripts/dev/owner-acceptance/reset-owner-account.mjs:76-112 discovers tenant-scoped tables from the catalogue and topologically sorts them, so a new table is covered automatically; scripts/dev/owner-acceptance/verify-reset.mjs:65-81 is a HAND-MAINTAINED list of 15 named counters that does not include org.branch_status_history either.

### canonical-structure corrections

**AMBIGUOUS IN DOCS.**

Recorded, not resolved. (1) and (3) are citation slips with no consequence beyond a reader following the wrong line. (2) matters: the design's naming matrix asserts `org.branch.manage` is the existing branch-status permission and it is not — `org.branch.manage` is an orphan with zero references in apps/api/src, apps/web/src and supabase/migrations (permission-reuse-register.md:130 says so correctly, so the two initiative documents disagree with each other). If B2 or wave C reasons "the branch analogue uses the `.manage` code, so company should too", it will be reasoning from a fact the repository does not support; the branch analogue uses `org.settings.manage`. (4) and (5) matter operationally: every figure in §14 and §15 was measured on develop at `fe81f3eb`, and B1 has moved five of them. B2 must state which base it is stacked on.

_Evidence:_ (1) `grep -rhoE "CREATE TABLE org\.[a-z_]+" supabase/migrations/` lists `org.legal_companies` and no `org.companies`. (2) apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:52 `permissions: ['org.settings.manage']` vs design-v2 §12.2's Branch row, which names `org.branch.manage`. (3) design-v2 §12.3 cites "20260717103000:293, table org.branch_status_history" — :293 is `CREATE OR REPLACE FUNCTION org.change_branch_status`, the table is :219. (4) design-v2 §15:145 "The live count is 124" vs migrationCount 127 on the unmerged B1 branch. (5) design-v2 §14:101-104 "RUNTIME_ROLES … is a hard-coded list of three entries" vs four on B1, and ACTIONS four vs eight.

### B1 stacking dependency

**EXISTS AND LOAD-BEARING.**

B2 collides with B1 in six files whether or not it intends to: schema-baseline.json (every figure), rls-matrix.mjs (role and action lists), tests/db/helpers.ts (cleanFixtures/deleteTenantCascade), tests/db/foundation.test.ts (all four exact-match inventories), docs/database/data-dictionary.md (adjacent org sections), and the migration filename ordering. Three things B1 provides that B2 should consume rather than reinvent: the `polroles`-aware policy coverage check (rls-matrix.mjs:250-264), which removes the false-pass described in the RLS item; the eight-action privilege probe including TRUNCATE; and the committed-DDL mutation pattern in tests/db/pre-p1-29-b1-privilege-mutations.test.ts. B1 also already grants `app_platform` SELECT+INSERT on `org.legal_companies` with policies bounded to `status='provisioning'` tenants (20260822092000:180,:193-198,:247,:258-263) and deliberately no UPDATE — so the control plane already has an opinion about the company table that B2 must not contradict. Because B1 is frozen behind an external provider blocker, the honest options are: land B2 on top of B1 and inherit the block, or land B2 on develop and accept that B1's rebase will carry all six collisions.

_Evidence:_ `git diff --stat develop...origin/feature/pre-p1-29-backend-b1-platform-authority-foundation` → 32 files, 9456 insertions, including supabase/migrations/20260822090000, 20260822091000, 20260822092000; scripts/ci/rls-matrix.mjs (+242 lines); tests/db/helpers.ts (+217); tests/db/foundation.test.ts (+86); docs/database/data-dictionary.md (+27); .github/ci-baselines/schema-baseline.json (+22/-22). Four commits, head 3d3e5a4e. Not an ancestor of develop (c081a019).

### ownership gate and branch profile

**AVAILABLE.**

Every file B2 touches is inside `pre-p1-29-backend`: the migration (migrations), the DB tests and helpers (tests), the data dictionary and initiative docs (docs), and .github/ci-baselines/schema-baseline.json (tooling — .github/ is `tooling`, not a bucket of its own). Nothing B2 needs falls in a forbidden bucket, so the profile requires no widening. Two warnings from prior phases that apply here: `validate:phase-ownership` defaults to the WRONG profile when none is declared (:160-162 — the gate defaults to `p1-26-frontend`, which forbids `migrations`), so the branch must declare `pre-p1-29-backend` explicitly; and `verify:policies` reads COMMITTED state, so running it before committing proves nothing about what the gate will see.

_Evidence:_ scripts/ci/check-phase-ownership.mjs:398-428 defines profile `pre-p1-29-backend` with allowed buckets apiSource, migrations, dbSeeds, webGenerated, webContract, docs, tooling, tests, rootConfig; forbidden web, apiConfig, supabase. Bucket rules at :103-126: `migrations` = supabase/migrations/**, `tooling` = scripts/** or .github/**, `tests` = tests/**, `docs` = docs/**.

---

## Unknowns — what could not be settled, and what would settle it

- Whether B2 is intended to land on `develop` or on top of B1. This changes six baseline figures, the required migration filename floor (above 20260819090000 vs above 20260822092000), the number of rls-matrix cells the new table produces (12 vs 32), and whether the `polroles` blind spot is already closed. WOULD SETTLE IT: the initiative's own branch plan, or a decision from whoever owns the B1 provider blocker.
- The exact post-B2 values of tables/functions/policies/triggers and schemaHash. The four structural totals cannot be reproduced on a developer stack (the baseline's own structuralTotalsDeltaNote records local readings of tables 292 / functions 591 / triggers 548 / security_definer 6 as non-comparable), and schemaHash requires a `supabase db reset` that destroys the Owner acceptance environment. WOULD SETTLE IT: one hosted clean-room run (.github/workflows/_reusable-clean-room.yml) against the B2 branch, plus a local `npm run validate:schema-inventory -- --hash-only` against a database rebuilt from empty — the two are expected to agree on schemaHash and to disagree on the totals, and both readings should be recorded.
- Whether a company transition should emit anything beyond the history row — an `iam.audit_records` entry, a `shared.event_outbox` event, or a `record_version` bump the eventual operation can use for If-Match. B2 has no application layer to write the first two, and `shared.touch_row_metadata()` (0002_base_schemas.sql:187-199) bumps `record_version` on the parent automatically, but nothing states whether wave C's operation will be `versionGuarded` and, if so, whether the guard reads the company row or the history. WOULD SETTLE IT: wave C's operation declaration, or an explicit statement in §12.3 that B2 owes none of them.
- Whether the initiative intends `org.company.manage` to survive at all. Wave A recorded the open question in these words: `org.company.manage` reads as "create and update companies" while the initiative may need to separate creating a company from changing its status (wave-a-discovery.md:344). If wave C splits it, B2's policy predicate — if B2 writes one — would name a code that is about to be superseded. WOULD SETTLE IT: wave C's operation list, which wave A itself names as the thing that turns this from a judgement into a mechanical check.
- Whether the branch `org.branch_status_history` and the new company table should both be added to `docs/database/erd/phase-1-3-organization.mmd` and to `scripts/dev/owner-acceptance/verify-reset.mjs`'s named counters. Neither is gated, the branch table is absent from both, and adding only the company one would leave the pair inconsistent. WOULD SETTLE IT: a maintainer decision on whether those two files are meant to be exhaustive; nothing in the repository states it either way.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- §12.3 requires "transition-graph validation", but `ck_legal_companies_status` admits exactly two states (20260717103000:82), so both directions are legal and the graph degenerates to the enum check plus the no-op check that `org.change_branch_status` already performs (:313, :332). Proof-plan row P-22 ("A legal company transition, then an illegal one — accepted, then refused") therefore has no illegal transition to exercise except an unknown state name or a no-op. The design does not say which it means, and widening the state set would require editing an applied migration, which §15 forbids. RE
- Whom to grant EXECUTE on `org.change_company_status`. The two shipped precedents point opposite ways: `org.change_branch_status` is granted to app_runtime (20260717103000:350); `org.change_tenant_status` is granted to nobody with a comment saying lifecycle is a platform operation (20260717101000:231-233). Granting app_runtime makes the function reachable by any tenant session under `upd_legal_companies_tenant`, which checks no permission; granting nobody makes B2's own tests require the admin connection and leaves the function inert until wave C. §12.3 and §19 are silent.
- Whether the history INSERT policy should require a permission. `ins_branch_status_history_tenant` requires none (20260717103000:414-416); `ins_user_status_history_admin` requires `iam.has_permission('iam.user.manage')` (20260726090000:193-195). If B2 requires `org.company.manage` it wires an orphaned code, which §12.1 arguably encourages and arguably forbids ("Wave B adds none of them and duplicates none of them" is about ADDING codes, not about wiring one); if it does not, the code stays orphaned and the status write stays permission-free. The design does not address the company history polic
- Whether the transition function should refuse a soft-deleted or archived company. `org.legal_companies` carries `deleted_at` and `archived_at` (20260717103000:67,:69) and the repository already guards on them elsewhere (`org.guard_parent_company_live`, :181-204). `org.change_branch_status` does NOT filter `deleted_at`, but the shipped TypeScript branch adapter DOES (`AND deleted_at IS NULL`, transition-repository.ts:73,:97). So the two halves of the branch precedent disagree, and §12.3 says only "modelled column-for-column on the branch history table", which covers the table and not the predic
- Which consumer wave C will build on. `iam.change_user_status` is called from product code (identity-repository.ts:309); `org.change_branch_status` has an EXECUTE grant and zero product callers, because the branch status route drives the TypeScript transition engine instead (route.ts:94-100 → transition-repository.ts:86-131). If wave C registers `org.legal_company` as an engine aggregate (transitions.ts:56-64) rather than calling the function, B2's function joins `org.change_branch_status` as a second granted-but-uncalled object — which is a legitimate outcome, but it should be a decision rathe
- Design §12.2's Branch row names `org.branch.manage` as the existing permission for `shared.branch-status-change`; the source requires `org.settings.manage` (route.ts:52) and `org.branch.manage` is required by nothing. permission-reuse-register.md:130 states the correct fact. Two initiative documents disagree; the design was not corrected in revisions 2-4.
