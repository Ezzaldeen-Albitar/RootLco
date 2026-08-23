# PRE-P1-29 to P1-29 — dependency graph

**43 candidate edges examined. 35 substantiated, 8 rejected.**

Every edge names the **exact capability that flows along it** — a table, a function, an operation
or a contract. An edge whose capability could not be named was rejected rather than softened.
_"Depends on PRE-P1-29"_ appears nowhere in this document, and must appear nowhere in any plan
built on it.

Edges are **HARD** (the downstream work cannot be built) or **SOFT** (it can be built but is
incomplete or unprovable). The distinction matters for scheduling: a soft edge permits parallel
work, a hard edge does not.

---

## 1. The critical path, in one picture

```
  Wave A (done)
      │
      ▼
  B1 ──┬──► B3 ──┬──► B6 ──┐
       │         │         ▼
       ├──► B4 ──┴──► B5 ─►B7 ──┬──► Wave C ──┬──► Wave G ──┐
       │                        │             ├──► Wave H ──┤
       ├──► B2 ────────────────►┤             │             │
       │   (soft)               │             │             ▼
       └──► Wave D ─────────────┴──► Wave F ──┴──────────► Wave I
                                                    (Owner QA)

  B1..B7 ──► B9  (published contract and security proofs — last)

  P1-29 is a SEPARATE graph. It has NO edge from PRE-P1-29 except at acceptance:

  P1-29-A0 ─┬─ BE-5 ──► BE-4 ──► Diagnostics slice
            ├─ BE-1 ──────────► detail / lifecycle / jobs slices
            ├─ BE-2 ──────────► technician workspace slice
            ├─ BE-3 ──────────► queue and detail slices
            └─ BE-6, BE-7, BE-8 (no downstream frontend slice depends on them)
                    │
                    ▼
              P1-29 Slice A (contract mirror) ──► every other P1-29 slice
                    │
                    ▼
              P1-29-H acceptance ◄── needs a provisioned tenant, roles and a user
                                     (Wave B7, or a developer loopback path)
```

**The one edge that matters most for scheduling:** PRE-P1-29 does not block P1-29 _construction_.
It blocks P1-29 _acceptance_, because nothing else can provision a tenant, a user and the roles
carrying the 22 domain permission codes.

---

## 2. Substantiated edges

### PRE-P1-29 Wave A (Discovery) -> Waves B..I

**Status: AVAILABLE.**

CAPABILITY: the measured baseline and finding register G-1..G-16 (scope.md:44-64) plus the wave-B refutation register that §17 imports as its premise. WHY: every later wave's design cites a G-number as its justification (Wave B cites G-7 and G-15, Wave C cites G-4 and G-6, Wave D cites G-10 and G-16, Wave E cites G-8, Wave G cites G-14). Building a wave before its finding is measured means designing against a guess. HARD for the design of each wave, and already SATISFIED — Wave A is landed on develop.

_Evidence:_ scope.md:141-143 "Waves are ordered by dependency, not by convenience. A wave may not begin while an input it needs is still a question."; scope.md:157-162 (Wave A writes documentation, tooling and tests only); wave-b-control-plane-design-v2.md:908 "The surviving lane is imported unchanged in premise (register §4)"; permission-matrix.md:257 "Wave A landed (#255-#258)"

### Wave B slice B1 -> Wave B slice B3 (platform request context)

**Status: MISSING.**

CAPABILITY: the `app_platform` database role itself, created by B1 under the archetype pattern of `0002_base_schemas.sql:62-74`. WHY: B3's whole deliverable is a request context that installs a narrow database execution context (:124), and §3.3 fixes that both context shapes run as `app_platform`. A role that does not exist cannot be connected as, so B3's second half has nothing to install. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:955 (B1 = the role, the relation, the resolver, the coverage-matrix change), :957 (B3 = the platform request context and its two shapes), :155 "Both run as `app_platform`"; verified absent on develop: `grep -rn "platform_grants|app_platform|has_platform_authority" supabase/ apps/api/src scripts/` -> no output

### Wave B slice B1 -> Wave B slice B4 (organisation read contract)

**Status: MISSING.**

CAPABILITY: `iam.has_platform_authority(p_code text) returns boolean` (§5.2) and the `app_platform` role. WHY: B4's only row-level policy names both — the role as the policy's `TO` target and the function as its `USING` predicate. `CREATE POLICY ... TO app_platform` fails outright if the role is absent, and the predicate cannot compile without the function. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:408 "`FOR SELECT TO app_platform USING (iam.has_platform_authority('platform.organization.read'))`"; :955, :958; :477 grants EXECUTE on `iam.has_platform_authority(text)` to `app_platform`

### Wave B slice B1 -> Wave B slice B5 (lifecycle contract)

**Status: MISSING.**

CAPABILITY: the `app_platform` role plus `iam.has_platform_authority(text)`. WHY: B5 writes two policies on two tables and every clause of both is the resolver; and the `GRANT UPDATE (status)` / `GRANT INSERT` statements name the role. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:386 (`GRANT SELECT ON org.tenants TO app_platform` under a policy naming three `iam.has_platform_authority(...)` disjuncts), :390 (`USING (iam.has_platform_authority('platform.organization.lifecycle'))`), :392 (the `org.tenant_status_history` insert policy, same predicate)

### Wave B slice B1 -> Wave B slice B6 (sanctioned path to org.provision_organization)

**Status: MISSING.**

CAPABILITY: the `app_platform` role, as the grantee of EXECUTE on `org.provision_organization` and as the `TO` target of ten new insert policies. WHY: `org.provision_organization` is `SECURITY INVOKER` (`:278-280`), so it writes with the caller's privileges; with no `app_platform` role there is nobody the ten policies can admit and no lawful grantee for the EXECUTE. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:337 (Role = `app_platform`), :342 ("New, for `app_platform`, on each of the ten" tables, insert check `status = 'provisioning'`), :478 (EXECUTE on `org.provision_organization(jsonb, text)` granted to `app_platform`); today the function is granted to no application role — supabase/migrations/20260717107000_org_provisioning.sql:281-282

### Wave B slice B1 -> Wave B slice B7 (first-Owner bootstrap)

**Status: MISSING.**

CAPABILITY: `app_platform` + `iam.has_platform_authority('platform.organization.provision')` + the `iam.platform_grants` row the resolver reads. WHY: B7 is the highest-risk slice and every one of its six write policies is a conjunction of the bootstrap window and the resolver. §9.2 lists four containment conditions and two of them (conditions 1 and 2) are B1 artefacts. Build B7 without B1 and its containment argument is not merely unproven, it is unwritable. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:363 "New, for `app_platform`, each predicated on **both** the bootstrap window ... **and** `iam.has_platform_authority('platform.organization.provision')`"; :361-362 (writes to iam.user_accounts, iam.user_status_history, iam.roles, iam.role_permissions, iam.role_grants, iam.grant_scopes)

### Wave B slice B4 -> Wave B slice B5

**Status: MISSING.**

CAPABILITY: `GRANT SELECT ON org.tenants TO app_platform` plus the `FOR SELECT TO app_platform` policy whose `USING` admits any of the three platform authorities. WHY: B5's operation is a call to `org.change_tenant_status`, whose very first statement is a locking SELECT on `org.tenants`. Because the function is `SECURITY INVOKER`, that read is performed as `app_platform`. Without B4's grant AND its policy — a grant without a policy admits nothing under forced RLS — the lifecycle call aborts at its first statement with `insufficient_privilege`, before any status is read. This is the design's own stated ordering constraint and the only one it states. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:958 "**Creates the `app_platform` SELECT privilege and policy on `org.tenants`** that §6.4 depends on too, so it must land before B5"; :385 "`org.change_tenant_status` is `SECURITY INVOKER` (20260717101000:181) and its first statement is `SELECT status INTO v_from FROM org.tenants WHERE id = p_tenant_id FOR UPDATE` (:199), so the row lock runs with this role's privileges"; :386 the exact grant and policy text

### Wave B slice B3 -> Wave B slice B6

**Status: MISSING.**

CAPABILITY: the platform-origin request-context type — "a context whose tenant is legitimately absent ... a distinct type, not an optional field on the existing one" (:160-162). WHY: provisioning creates the tenant, so no tenant setting can exist while it runs; the shipped machinery structurally refuses such a request. B6 has no way to reach the database until B3 introduces the second shape. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:338 "Context | Platform-origin (§3.3): tenant absent, acting principal set"; :152 (the platform-origin row: "provisioning only — the tenant does not exist yet"); :135-140 finding N-3: `buildRequestContext` requires and validates both a principal user and a principal tenant (apps/api/src/server/context/request-context.ts:88-93) and `applyContext` sets both settings on every transaction (apps/api/src/server/db/transaction.ts:91-105)

### Wave B slice B3 -> Wave B slice B7

**Status: MISSING.**

CAPABILITY: the platform-on-target context shape — the target tenant set positively, after §4 authorised that exact target, with the acting principal set to the authenticated operator and both narrowing lists absent. WHY: this is the AUDIT-CONTEXT -> PRIVILEGED-ACTION-ATTRIBUTION edge, substantiated. Bootstrap is the most privileged act in the product and the one no tenant administrator can review (scope.md:171-173). The audit writer will not accept a row whose tenant is absent, and `fk_audit_records_tenant` references `org.tenants`, so attribution is only possible inside the target tenant's context. Build B7 on the platform-origin shape and every write succeeds while every audit record fails. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:361 "Context | Platform-on-target"; :142-146 finding N-6: the audit writer refuses an absent tenant outright (supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql:181-183) and all three insert policies check the row's tenant against the current one (:264-272); :452-453 "This is also why a platform action is performed inside the target tenant's context (§3.3): without it there is no lawful audit row to write."

### Wave B slice B6 -> Wave B slice B7

**Status: MISSING.**

CAPABILITY: a tenant row in `status = 'provisioning'` — the self-closing bootstrap window, produced only by B6's constrained insert. WHY: every B7 policy is a conjunction whose first term is the window. With no B6 there is no provisioning-state tenant, so no B7 policy ever admits a row and the slice is unreachable — and unprovable, since §9.3's required negative test is "remove the bootstrap-window predicate -> bootstrap succeeds against a tenant that is already live", which needs a live/window pair to distinguish. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:342 "On `org.tenants` the insert check is `status = 'provisioning'` ... This is the **bootstrap window**"; :363 (B7's six policies each predicated on the target tenant being in the provisioning state); :547-550 "Provisioning and first-Owner bootstrap therefore commit together or not at all"; :555-563 (the adapter must never set `tenant.activate`, because supabase/migrations/20260717107000_org_provisioning.sql:254-261 would close the window inside the transaction)

### Wave B slice B5 -> Wave B slice B7 (containment, not construction)

**Status: MISSING.**

CAPABILITY: B5's `WITH CHECK (... to_state IN ('active','suspended','closed'))` on `org.tenants` and the mirrored check on the `org.tenant_status_history` insert policy (:392). WHY: B7's entire safety argument is that its window is self-closing. That is only true if no privilege can reopen it, and the only privilege that could is B5's `GRANT UPDATE (status)`. B7 CAN be built first — this is not a compile-order edge — but shipped without B5's check it is the escalation blocker B3 named. SOFT (TO can be built but is incomplete: its containment claim is false until B5 lands correctly).

_Evidence:_ wave-b-control-plane-design-v2.md:374-377 "blocker **B3** showed the phrase was doing work the design had not earned: §6.4 handed the same role an unpredicated `UPDATE (status)`, so it could put a live tenant _back_ to `provisioning` and reopen the window. The window only closes if nothing can reopen it. §6.4 and §15's M3 now make that true."; :390 (the `WITH CHECK` restricting the destination to `('active','suspended','closed')` — `provisioning` refused outright)

### Wave B slices B1..B7 -> Wave B slice B9 (published contract and security proofs)

**Status: MISSING.**

CAPABILITY: the artefacts the proofs measure — the role's privilege graph, the resolver, the ten provisioning policies, the six bootstrap policies, the two lifecycle policies. WHY: every §16 proof is a mutation of a shipped artefact, and §9.3 insists on a positive control first ("an unmutated bootstrap succeeds. Without it a red result proves only that something is broken"). A proof suite written before the thing it proves is the vacuous-proof defect this repository has hit repeatedly. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:963 "| B9 | Published contract and security proofs (§16) | Last |"; :605-618 (§9.3's four required proofs, each of which mutates a specific B1/B5/B6/B7 artefact and asserts the failure); :982 "**Any coverage figure after the change.** It cannot be measured until the change exists (C11)."

### Wave B slice B1 -> Wave D (identity, membership and tenant resolution)

**Status: MISSING.**

CAPABILITY FLOWING: an obligation, not a capability — `iam.platform_grants.account_id` (FK to `iam.user_accounts`, itself tenant-scoped and immutable) becomes Wave D's to repoint. WHY THE EDGE EXISTS: B1's relation hangs off a tenant-scoped account. Wave D's whole subject is that an identity must stop being tenant-scoped, so once B1 has landed, Wave D inherits one additive migration it would not otherwise owe, and inherits T-1 — the residual risk that a tenant administrator can disable the operator's account (§5.4, `20260718090000_iam_user_accounts_and_profiles.sql:109-110`). SOFT: Wave D can be built either way; if B1 landed first, Wave D is incomplete until it repoints the relation.

_Evidence:_ wave-b-control-plane-design-v2.md:939-942 "`iam.platform_grants` references an **account** and carries no tenant of its own. When wave D introduces identity and membership, the relation is repointed from account to identity by one additive migration, and nothing in §4 to §11 changes"; :304-308 "What removes it is Wave D's global identity, at which point the account becomes an identity with a platform membership and no tenant administrator is in the path."

### Wave B slice B2 -> Wave C (company status administration operation)

**Status: MISSING CONTRACT.**

CAPABILITY: `org.change_company_status(...)` — row lock, transition-graph validation, status update and history append in one transaction, `SECURITY INVOKER`, no actor parameter (finding N-8) — plus the `org.company_status_history` table. WHY: Wave C's company administration surface has to change a company's status. §12.3 forbids exposing an arbitrary status write, so the only sanctioned path is this function. Built before B2, Wave C's operation either has nothing to call or writes the status column directly and loses the history the branch and tenant equivalents both keep. HARD.

_Evidence:_ wave-b-control-plane-design-v2.md:729-731 "Company has a status column (20260717103000:61, constrained to active or inactive at :82) and **neither** [a transition function nor an append-only history] — verified by enumerating every `org.` table and every `org.` function in the migration series"; :733-739 (B2 adds `org.company_status_history` and `org.change_company_status(...)`); :742 "The tenant-side operation that calls this function is wave C's."; :712 naming-matrix row: Company | Missing capability = "Company **status** change and its history" | Proposed = "wave C, identity module"

### Wave B slice B7 -> Wave C (Company-Owner-reachable administration, and the thirteen shipped role/grant operations)

**Status: MISSING CONTRACT.**

CAPABILITY: the first `iam.user_accounts` row inserted `active` (not the `invited` default, per :366), plus its `iam.roles` / `iam.role_permissions` / `iam.role_grants` / `iam.grant_scopes` set — the tenant's first administrator. WHY: this is the TENANT-ADMINISTRATION -> COMPANY-OWNER-MANAGEMENT edge, and it is real but narrower than the candidate phrasing. Thirteen role/grant operations already ship; day-to-day Company Owner management is those operations plus Wave C's new ones. What does not exist is anyone who can invoke them, because each demands the authority it would establish. Wave C can be BUILT without B7 (its tests provision their own roles, and §17:922-925 tells whichever wave runs P-21 to give its fixture Owner a company-scoped grant, because `narrowScope` skips the membership test for an unrestricted caller — apps/api/src/server/context/resolve-context.ts:133). It cannot be USED in a real tenant. SOFT for construction, HARD for any live tenant.

_Evidence:_ dependencies.md:402-406 "The `iam` operations that would do the work each demand the authority they are supposed to establish: `iam.invitation-create` requires `iam.user.manage`, `iam.role-create` requires `iam.role.manage`, `iam.grant-issue` requires `iam.grant.manage` — all evaluated against an authenticated actor inside that tenant, of which a new tenant has none."; supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql:80-85 "No policy here can create the FIRST administrator of a tenant"; measured: `grep -rn "id: 'iam\.(role|grant|permission)" apps/api/src/app/api/v1` -> 13 operations; `grep -rln "INSERT INTO iam.roles|INSERT INTO iam.role_permissions" supabase/seeds/ supabase/migrations/` -> no output; wave-b design:916-920 "**P-21 and slice B8 move to wave C**, which introduces the first Company-Owner-reachable administration operation."

### Wave B (three platform.* codes and three operations) -> Wave F (Superadmin web)

**Status: MISSING CONTRACT.**

CAPABILITY: the three `platform.*` permission codes in `iam.permissions`, surfaced in the session's capability array, and the three operations behind them. WHY: the client fails closed by construction — an unknown capability yields an empty menu. Wave F's separation requirement ("a Company Owner must not be able to reach it") is expressed only as a capability check, so with no `platform.*` code seeded, every Wave F screen renders as unauthorised for everyone including the operator, and the only alternative is the client-side administrator flag §5.2 of dependencies.md names as forbidden. HARD.

_Evidence:_ scope.md:210-216 "The control-plane surface ... Visibility is driven by capability, per P-4, and the capability comes from the Backend."; scope.md:108-115 P-4; wave-b design:186-190 the three codes `platform.organization.provision` / `.read` / `.lifecycle`; :709-711 the three operations `platform.organization-read` / `-provision` / `-lifecycle`; apps/web/src/lib/permissions.ts (default capability set empty, membership exact, null requirement means "not gated"); scope.md:60 G-15 "a case-insensitive search for `super[ _-]?admin` across the API source, the web source, the migrations and the seeds returns **zero** hits"

### Wave B slice B7 -> Wave I (Owner QA of the PRE-P1-29 initiative)

**Status: MISSING CONTRACT.**

CAPABILITY: a signed-in Superadmin holding a `platform.*` grant and a signed-in Company Owner holding the tenant administration codes. WHY: the Owner cannot accept a Superadmin surface or a company administration surface without signing in to each. For the Superadmin half the edge is HARD and has no alternative — there is no product or script path that writes `iam.platform_grants`, by design (§5.3: "There is no product write path ... at all"). For the Company Owner half it is SOFT: `create-owner-account.mjs` already builds an equivalent account, and its `OWNER_PERMISSIONS` set (context.mjs:353-360) already carries all fourteen `iam.*`/`org.*` administration codes.

_Evidence:_ scope.md:237-251 (Wave I: Owner acceptance by hand against a production build, explicit written Pass); permission-matrix.md:229-231 "**0 rows in both, in the live database.** No actor holds _any_ ... code today"; measured: `grep -rln "INSERT INTO iam.roles|INSERT INTO iam.role_permissions" supabase/seeds/ supabase/migrations/` -> no output; scripts/dev/owner-acceptance/create-owner-account.mjs:222, :231, :257, :296, :307 (the loopback path that does create roles, mappings, an account, a grant and a scope), guarded at scripts/dev/owner-acceptance/context.mjs:458-469

### Wave C (reach-scoped named company/branch list) -> Wave G (the human selectors, P-1)

**Status: MISSING CONTRACT.**

CAPABILITY: a new reach-scoped read returning `(companyId, name)` and `(branchId, name)` pairs limited to the caller's grant reach. WHY: this is the WAVE C -> P-1 NAMED SELECTORS edge, fully substantiated. The session already carries the reach as identifiers and nothing publishes the names, so a Wave G selector built first can only render raw UUIDs — which is exactly what P-1 forbids — or fetch names one identifier at a time through the eight settings operations, "which would leak nothing but which does not exist: none of the eight publishes a company or branch name — the two settings reads return setting key/value tuples (`settingKey`/`valueType`/`isSensitive`/`version`, organization-settings-service.ts:54-61), the branch-status read returns `{state, nextStates, recordVersion}`, and the tenant read returns only the caller's own tenant `displayName`, from a path carrying no identifier at all — and none of the eight is registered `expensive-read`: the four reads carry `rateLimitPolicy: 'low-risk-metadata'` (600/min, keyed by tenant, and by its own rationale 'not a security control') and the four writes `'standard-command'`". It also matters for correctness, not only ergonomics: dependencies.md:100-110 shows the selector supplies the authorization TARGET, and `requiresScopedEvaluation` (apps/api/src/server/auth/authorization.ts:62-65) degrades a scoped check into a tenant-wide one without it. HARD.

_Evidence:_ scope.md:74-84 P-1: "they choose from a named list the Backend gave them — and the list is _what they may reach_, not _what exists_ ... A human-readable selector therefore cannot be built today. Making one buildable is wave C's obligation, not the web lane's."; scope.md:174-183 Wave C "an operation that returns the companies and branches an actor may reach, **by name**"; scope.md:50 G-5; apps/web/src/features/authentication/types/session.ts:25-26 (`companyIds`/`branchIds`, bare id arrays, no names); measured: `grep -rn "id: '" apps/api/src/app/api/v1/org apps/api/src/app/api/v1/organization` -> "exactly 8 operations: six addressed by a company or branch identifier in the path (`/org/companies/{companyId}/settings`, `/org/branches/{branchId}/settings` and `/organization/branches/{branchId}/status`, a read and a write each), and two — `iam.tenant-settings-read` and `iam.tenant-settings-update`, both at `/org/tenant` — carrying no path identifier at all, since they are `scope: 'tenant'` reads resolved from the caller's own session; none enumerating"

### Wave C (reach-scoped named list) -> Wave H ("seeing which branches an actor reaches")

**Status: MISSING CONTRACT.**

CAPABILITY: the same Wave C named-reach read, applied to a grant's scope rows rather than to the caller's own reach. WHY: `iam.grant-scope-list` returns scope rows keyed by `company_id`/`branch_id` (apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:29) and nothing resolves those to names. A grant-scoping screen that shows UUIDs is a screen an administrator cannot safely operate. HARD.

_Evidence:_ scope.md:230-236 "The administration-side workflow surfaces: editing a role, scoping a grant, switching membership, seeing which branches an actor reaches. These are screens over wave C, D and E contracts. No screen in wave H may ship against a contract that does not exist — the web lane cannot change API source (§7), which is the structural enforcement of that rule."; scope.md:50 G-5

### Wave C (department create / list / update) -> Wave G (department administration screen)

**Status: MISSING CONTRACT.**

CAPABILITY: HTTP operations that create, list, rename and retire an `org.departments` row, declaring the already-seeded `org.department.manage`, plus the `org.department.read` that §12.1 of the wave-B design explicitly defers to Wave C ("a genuine candidate but belongs to wave C, which is where the operation that would need it lives; seeding it here would be a code with no operation"). WHY: Wave G's department screen has no read to render and no write to submit. HARD.

_Evidence:_ scope.md:174-183 "the department table of G-6 acquires a way in"; scope.md:51 G-6; gap-register.md:113 GAP-22 "The table exists — supabase/migrations/20260717104000_org_operational_structure.sql:109 — and **nothing else does**. Zero references to it in apps/api/src. Zero in apps/web/src. No operation, no screen, no navigation entry."; measured: `grep -rc org.department.manage apps/api/src` -> 0 files match; scope.md:217-229 (Wave G extends the administration tree with company, branch and department administration)

### Wave C (five inert organisation permissions, deliverable D3) -> Wave G (company and branch administration screens)

**Status: EXISTS BUT NOT USED.**

CAPABILITY: operations declaring `org.company.manage` and `org.branch.manage` — company create/rename/restructure and branch create/rename/retire. WHY: today five seeded codes guard nothing, so a Wave G company-administration screen has no operation to call and, because the client fails closed on an exact capability match (apps/web/src/lib/permissions.ts:39, :45-49), no code that would make its nav entry appear either. Publishing the operations "is what makes them mean something" (dependencies.md:138). HARD.

_Evidence:_ dependencies.md:138 deliverable D3; dependencies.md:56-75 §2.1 (the five codes and their zero references — `org.tax.manage`'s three web references are one unused constant at apps/web/src/features/administration/shared/permissions.ts:46 and two comments); measured: for each of org.company.manage, org.branch.manage, org.department.manage, org.subscription.manage, org.tax.manage — `grep -rc <code> apps/api/src` -> 0 matching files

### Wave C (department administration) -> P1-29 BE-7 (administration half)

**Status: AMBIGUOUS IN DOCS.**

CAPABILITY: department CRUD operations declaring `org.department.manage`, and seeded `org.departments` rows. WHY: BE-7 has three parts (data, contract, relationship) and only the third — a `department_id` column on a `wo`/`dia`/`tech`/`qms` table — is P1-29's. Owner requirements 3 and 4 are unmet until the management half lands. THIS IS THE ONLY BE-n WITH A PRE-P1-29 PREDECESSOR. HARD for the administration half. RECORDED, NOT RESOLVED: the gate document names Wave B; three PRE-P1-29 documents name Wave C, and wave B's own §12.1 refuses to seed the code precisely because the operation is Wave C's.

_Evidence:_ backend-prerequisite-gate.md:187 "**Split, and the split matters.** The management surface belongs to **PRE-P1-29's organisation-administration dimension** ... Only the `department_id` relationship on work-domain records is a P1-29 Backend prerequisite."; :188 "**depends on** | PRE-P1-29 Wave B for the administration half."; contradicted by scope.md:174-183 (Wave C: "the department table of G-6 acquires a way in") and by wave-b-control-plane-design-v2.md:696-698 and :714 (Department | Creating, naming, listing | **wave C**); implementation-slices.md:363-364 "Owner requirements 3 and 4 | **3 Company Owner administration** | `BE-7`'s management half is PRE-P1-29's organisation-administration gap"

### Wave D (membership relation and post-authentication membership choice) -> Wave H (membership switching UI)

**Status: MISSING CONTRACT.**

CAPABILITY: a membership relation spanning tenants, a post-authentication operation listing the memberships an identity holds BY NAME, and a server-side selection that finalises the request's active tenant. WHY: today one live external identity resolves to exactly one tenant platform-wide, so there is literally nothing to switch between; and P-2/P-3 forbid the client naming a tenant, so the switcher cannot be a client-side control over an existing session. Wave H's switching screen has no list to render and no selection endpoint to post to. HARD.

_Evidence:_ scope.md:184-197 Wave D; scope.md:230-236 Wave H ("switching membership" listed, "No screen in wave H may ship against a contract that does not exist"); dependencies.md:362-365 "The choice is among memberships the identity is _already_ authorized for, presented by name, resolved server-side. It is not a tenant identifier entered by a human and it is not a client-side switch."; supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:109-110 (`uq_user_accounts_provider_identity_active`, no tenant in the key); apps/api/src/server/context/resolve-context.ts:63-68 (the request-time lookup reads that same key); apps/api/src/modules/iam/application/authentication-service.ts:318-338 (the provider directory is the only tenant-agnostic lookup that exists)

### Wave E -> the 167 tenant-scope adjudication (the 167/170 question)

**Status: UNKNOWN.**

CAPABILITY: a per-operation determination of whether the scoped question and the scope-blind question can ever differ for that operation's target (scope.md:409-412 states exactly that as the settling test). THE ARITHMETIC IS NOW SETTLED, THE ADJUDICATION IS NOT. scope.md:198-209's "167 published operations declare tenant scope across 132 route files" is CORRECT. wave-b-control-plane-design-v2.md:820 says "**170** across **136** files — 166 declaring it, 4 inheriting the default"; the declaring figure is 167, not 166, so the resolving total is 171 across 136, not 170. Both figures recur at :912-913, :971 and :1025. Separately, counting the 4 inheriting operations into the short-circuit population is questionable on its own terms: all four are `public: true`, and a public operation is not permission-evaluated at all. WHAT REMAINS UNKNOWN is the adjudication itself; no wave B or A document asserts an answer (:971 "Nothing here asserts an answer").

_Evidence:_ Measured on develop c081a019 by balanced-delimiter extraction of every `defineOperation(` body under `apps/api/src/app/api/v1` (248 `route.ts` files, 305 calls): `{ tenant: 167, company: 2, branch: 132, none: 4 }`, tenant declared across 132 files; the 4 with no scope are apps/api/src/app/api/v1/auth/{login,logout,password-reset,password-reset/completion}/route.ts. Raw `grep -c "scope: 'tenant'"` gives 171 because four occurrences are inside comments (items/route.ts:7, price-lists/.../publication/route.ts:101, reception-catalogue/damage-map-templates/route.ts:109, services/.../publication/route.ts:97). Default at apps/api/src/server/auth/operation-registry.ts:185 `scope: declaration.scope ?? 'tenant'`. Short-circuit at apps/api/src/server/auth/authorization.ts:62-65 `if (scope === 'tenant') return false;`

### Wave E -> Waves G and H (screens over adjudicated operations)

**Status: UNKNOWN.**

CAPABILITY: whatever Wave E's adjudication changes — an operation moved from scope-blind evaluation to `requireScopedPermissions`, or a target made mandatory where it was optional. WHY: a screen calling an operation that Wave E later makes scope-demanding starts failing closed with `ERR-IAM-001` the day the adjudication lands. SOFT: Waves G and H can be built against today's contracts and will work; they are incomplete in the sense that they may not send the target Wave E decides is required. This is the only substantiated form of the candidate edge "workflow authority -> operational transitions".

_Evidence:_ scope.md:230-236 "These are screens over wave C, D and E contracts."; apps/api/src/app/api/v1/work-orders/route.ts:20-27 (a branch-scoped declaration is inert without a target, so the caller must name the company and branch in the query for `iam.has_permission_in_scope` to decide against the branch actually read); apps/api/src/server/auth/authorization.ts:337 `requireScopedPermissions`, and :59/:100-105 `forceScoped`

### Waves F, G and H -> Wave I (Owner QA)

**Status: MISSING CONTRACT.**

CAPABILITY: the three web surfaces themselves — the Superadmin control plane (F), company/branch/department administration and the named selectors (G), and role editing, grant scoping and membership switching (H) — served from `npm run build:web` + `next start`, never `next dev`. WHY: Wave I is a hand journey through those screens; there is nothing to accept before they exist, and accepting them on a development server would produce failures that are not defects. HARD.

_Evidence:_ scope.md:237-251 Wave I ("Owner acceptance by hand, against a **production build** ... The initiative closes on an explicit written Pass and on nothing else. Silence is not a Pass (docs/phase-1/phase-1-28/closure-record.md:44)"); scope.md:243-247 (the `next dev` side-effect singleton measurement, docs/phase-1/phase-1-28/evidence/change-log.md:517-536)

### PRE-P1-29 Wave B slice B7 (or the loopback developer path) -> P1-29-H (Owner acceptance)

**Status: MISSING CONTRACT.**

CAPABILITY: rows in `iam.roles` + `iam.role_permissions` + `iam.role_grants` + `iam.grant_scopes` mapping the 22 P1-29 domain codes onto an advisor, a supervisor and a technician role, held by an account the Owner can sign in as. THIS IS THE ONLY PRE-P1-29 -> P1-29 EDGE THAT TOUCHES THE WHOLE PHASE, AND IT LANDS ON ACCEPTANCE, NOT CONSTRUCTION. Wave B slice B7 is the product path that creates a tenant's first role and grant set; without it a production or pilot tenant has no administrator and every P1-29 operation refuses. SOFT for a local acceptance run: `create-owner-account.mjs` already provisions roles, mappings, an account, a grant and a scope through the platform's own tables and triggers against a loopback database, and extending its permission list with the 22 domain codes is P1-29's own work under `scripts/`. HARD for any non-loopback tenant.

_Evidence:_ implementation-slices.md:357 "| **P1-29-H (acceptance)** | **5 role / grant authority** | **the one hard dependency.** `iam.roles`, `iam.role_permissions`, `iam.role_grants`, `iam.grant_scopes`, `iam.user_accounts` and `org.tenants` all hold **0 rows**."; permission-matrix.md:229-231 and :279 "Roles carrying the 22 domain codes | dimension 5 — tenant provisioning | **absent** | **Owner acceptance cannot run.** Automated tests provision their own."; test-and-acceptance-plan.md:189-195 (precondition 1: an advisor role, a supervisor role with `wo.work_order.close` and `tech.assignment.manage`, a technician role with `tech.labor.record` and `wo.job.transition`); ALTERNATIVE PATH VERIFIED: scripts/dev/owner-acceptance/create-owner-account.mjs:222 (INSERT INTO iam.roles), :231 (iam.role_permissions), :257 (iam.user_accounts), :296 (iam.role_grants), :307 (iam.grant_scopes), guarded to loopback at scripts/dev/owner-acceptance/context.mjs:458-469; its permission set (context.mjs:147-160, :179-208, :339-342, :353-360) contains no `wo.*`, `dia.*`, `tech.*` or `qms.*` code

### P1-29-A0 BE-5 (permission parity gate) -> P1-29-A0 BE-4 (diagnostic template lifecycle)

**Status: MISSING CONTRACT.**

CAPABILITY: a CI gate asserting that every permission code a `defineOperation` declares exists in `supabase/seeds/04_iam_permission_catalog.sql` (112 codes today, verified by `grep -c "^ ('"`). WHY: BE-4 is the only prerequisite that mints new codes, and the repository's own history is that a misspelt or uncatalogued code fails silently and permanently — `navigation.ts:297`/`:306` are two live instances. Building the gate afterwards audits the codes once; building it first polices them as they are written. SOFT: BE-4 can be built first; the gate is a policing mechanism, not an input. The gate document phrases it as "should", not "must".

_Evidence:_ backend-prerequisite-gate.md:132 "**depends on** | `BE-5` should land first, so the parity gate polices the new codes as they are written rather than after."; :152 "nothing. **It should be built first**, so it polices `BE-4`'s new codes as they are written."; :131 "It is the largest item in the gate and the only one that mints permission codes."; implementation-slices.md:285-289 (A0 build order: 1 BE-5, 2 BE-2, 3 BE-1, 4 BE-3, 5 BE-4); :296 exit criterion 4 "No new permission code exists that `BE-5` does not police."; measured: `grep -n "'dia\." supabase/seeds/04_iam_permission_catalog.sql` -> 4 codes, all about diagnostic REPORTS (`dia.diagnostic.record|complete|review|read`); `grep -n template supabase/seeds/04_iam_permission_catalog.sql` -> one comment line about message templates, no template permission of any kind

### P1-29-A0 BE-1 (publish the state catalogues) -> P1-29-C / Slices C and D

**Status: MISSING CONTRACT.**

CAPABILITY: an HTTP operation returning `workOrderStates()` and `jobTransitions()` — the tenant-overridable work-order and job state graphs. WHY: without it a lifecycle screen must hard-code the graph, which binding 4 of the execution decision names as a defect because the data is tenant-overridable; and for the JOB graph there is no fallback at all, since `jobTransitions()` is called by nothing anywhere. HARD for the job half, SOFT-but-forbidden for the work-order half.

_Evidence:_ backend-prerequisite-gate.md:74 "**Contract only.** The service is not dead — `workOrderStates()` has 14 internal call sites, three of them in other modules ... What is absent is an HTTP route. Only `jobTransitions()` is genuinely uncalled anywhere."; measured: `grep -rn "WorkOrderCatalogService|workOrderStates()" apps/api/src/app/api/v1` -> no output, while the service exists at apps/api/src/modules/work-order/application/work-order-catalog-service.ts; execution-decision.md §4 "P1-29-C | Work-order detail, lifecycle and assignment | `BE-1` for the job graph"; implementation-slices.md:331 "**C** and **D** consume `BE-1` (the state catalogues); D is the acute case, because the **job** graph is published nowhere at all."; execution-decision.md §5 binding 4 "**No hard-coded work-order or job state graph.** Those catalogues are tenant-overridable data."

### P1-29-A0 BE-2 (caller -> technician profile) -> P1-29-D (Technician workspace) / Slice E

**Status: MISSING CONTRACT.**

CAPABILITY: an operation resolving the signed-in caller's `tech.technician_profiles.id` server-side from `iam.current_user_id()`, with tenant and branch containment. WHY: the only technician queue read takes the profile id as a path parameter, so a "my jobs" screen would have to discover its own profile id — and binding 3 forbids matching by name, email or display text and forbids iterating profile ids, on the grounds that iteration is an enumeration oracle. HARD for the technician persona; SOFT for the slice, which can ship the supervisor-navigates form.

_Evidence:_ backend-prerequisite-gate.md:92 "**Contract only, and a very thin one.** ... The mapping exists, is unique per tenant, is index-backed, and is already selected. What is absent is any operation that resolves it from `iam.current_user_id()` instead of accepting it from the client."; measured: supabase/migrations/20260722094000_tech_profiles_skills_certs.sql:42 (`user_id uuid NOT NULL`), :68 (unique on `(tenant_id, user_id)` where not deleted); `grep -rn "id: 'tech\." apps/api/src/app/api/v1` -> 6 operations, the queue read keyed by `[technicianProfileId]` in the path (technicians/[technicianProfileId]/queue/route.ts:31); `grep -rn current_user_id apps/api/src/modules/technician` -> no output; execution-decision.md §4 "P1-29-D | Technician workspace | `BE-2` for caller→technician identity"; §5 binding 3 forbids client-side resolution; permission-matrix.md:283 "\"My jobs\" cannot exist. Supervisor-navigates does."

### P1-29-A0 BE-3 (customer projection on the work-order read) -> P1-29-B / P1-29-C

**Status: MISSING CONTRACT.**

CAPABILITY: a customer projection on the work-order read, resolved server-side through a sanctioned port across the `rec`/`crm` boundary, naming the relationship role it reports. WHY: the honest answer to "who is this work order for?" is a point-in-time question, and dependencies.md:223-229 states precisely why a client cannot chain vehicle -> ownership and take the first row: beneficial and fleet holders coexist with the registered owner by design. HARD for the customer column on the board and the detail header; SOFT for the slices, which can render without it.

_Evidence:_ backend-prerequisite-gate.md:110 "**Contract only.** The data is reachable; no read exposes it from the work-order side, and `GET /work-orders` accepts no `customerId` filter."; :115 (two shape constraints: `rec.reception_party_roles.relationship_role` distinguishes `service_requester` from `vehicle_owner`, so the projection must name the role; and the customer is the customer OF THAT VISIT, not the vehicle's current owner); dependencies.md:212-229 B3 (`customer_id` appears in **zero** of the 124 migrations; `ownership_kind` is `registered_owner | beneficial | fleet` at supabase/migrations/20260720099000_veh_ownership_history.sql:72 and only `registered_owner` is made non-overlapping at :82-84); execution-decision.md §4 "P1-29-C ... `BE-3` for the customer"; implementation-slices.md:330 "**B** consumes `BE-3` (the customer) for Owner requirement 2."; measured: `ls supabase/migrations/*.sql | wc -l` -> 124

### P1-29-A0 BE-4 (diagnostic template lifecycle) -> P1-29-E (Diagnostics) / Slice H

**Status: MISSING CONTRACT.**

CAPABILITY: an HTTP authoring surface for the `draft -> published -> retired` template lifecycle, plus the permission vocabulary it needs — which does not exist in any form (zero template codes in a 112-code catalogue). WHY: this is the phase's declared HARD BLOCK. The database is more complete than the HTTP layer here, which is exactly the schema-versus-contract distinction that has produced repeated defects; a diagnostics UI has nothing to author against and no code to gate on. HARD, and it blocks P1-29 CLOSURE, not merely the slice: execution-decision.md §3 makes closure without it "not a reduced pass; it is not a pass".

_Evidence:_ backend-prerequisite-gate.md:128 "**Contract only. The database layer is complete and guarded.** `supabase/migrations/20260722101000_dia_templates_versions_items.sql` ships all three tables with `ck_template_versions_status CHECK (status IN ('draft','published','retired'))` (:93), `dia.guard_template_version_publish()` (:104-132) ... `dia.guard_template_item_frozen()` (:188-207, trigger :212-213)"; measured: the three tables at :28 `dia.inspection_templates`, :73 `dia.template_versions`, :152 `dia.template_items`; `grep -rn "id: 'dia\." apps/api/src/app/api/v1` -> 13 operations, every one under `/inspections/...` or `/jobs/{jobId}/inspections`, none touching a template; catalogue holds 4 `dia.*` codes, none about templates; execution-decision.md §4 "P1-29-E | **Diagnostics experience** | `BE-4` — **hard block**"; :1.1 "P1-29 MUST NOT BE DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE"

### P1-29-A0 -> every P1-29 frontend slice (the sequencing invariant)

**Status: MISSING CONTRACT.**

CAPABILITY: the five funded prerequisite contracts, each with its own acceptance proof, in the operation register, the OpenAPI document and the P1-29 contract mirror in the same change (A0 exit criterion 3). WHY: this is the phase's governing invariant, written to prevent the failure mode where a screen is built against a contract that does not exist and then the phase quietly narrows itself. HARD, but per-capability rather than blanket: implementation-slices.md:334 records that Slices A, F and G are blocked by nothing, so A0's gate binds only the slices that consume a specific prerequisite.

_Evidence:_ execution-decision.md §4 "> **A Backend prerequisite precedes every frontend feature that consumes it.** ... **A0 is not optional and is not a parallel track.** A frontend slice that consumes a prerequisite may not begin before that prerequisite closes"; §2 "**P1-29 CANNOT BE EXECUTED AS A FRONTEND-ONLY PHASE.**"; implementation-slices.md:277-279 "**The first slice of P1-29 is Backend.**"; :299 "**A0 does not touch `apps/web`.** It is a Backend branch, with a Backend ownership profile"

### P1-29 Slice A (contract mirror and data layer) -> Slices B..H

**Status: MISSING CONTRACT.**

CAPABILITY: the P1-29 feature module, its permission constants, the hand-maintained contract mirror and the parity gate that keeps the mirror honest, plus the read adapters. WHY: there is no generated client, so every later slice's typing and every later slice's parity proof comes from Slice A's mirror. A screen built before the mirror either duplicates the declarations or reaches into `apps/api`, which the ownership profile forbids. HARD.

_Evidence:_ implementation-slices.md:312-334 (the dependency graph: `A ──► B ... ──► C ... ──► D ──► E`, with F, G and H hanging off C); execution-decision.md §4 "P1-29-A | Frontend contract / data layer: feature module, permission constants, contract mirror, read adapters, and the phase's own CI gates"; §5 binding 2 "**No generated OpenAPI client.** ... API TypeScript contract source → frontend contract mirror → parity/contract gate. `apps/web` must not import `apps/api` runtime source."; backend-prerequisite-gate.md:211-246 (§11, the contract mirror inventory, INS-01)

### P1-28 rec.reception-convert-to-work-order -> the P1-29 board and the acceptance journey

**Status: AVAILABLE.**

CAPABILITY: `rec.reception-convert-to-work-order`, shipped in P1-28. WHY THE EDGE IS WORTH STATING: it is the only inbound edge into the whole P1-29 graph from a closed phase, and it constrains both the design (P1-29 must not build a create form) and the acceptance script (step 1 of the twenty-step journey is a P1-28 surface). AVAILABLE — the capability exists; the edge is satisfied. Recorded because a reader tracing "where do the board's rows come from?" would otherwise look for a P1-29 create operation and find none.

_Evidence:_ execution-decision.md §5 binding 1 "**Work-order creation is reception conversion only.** There is no generic `POST /work-orders`; its absence is deliberate and documented in the route file (a second insert would not hold the reception-visit lock, so two concurrent callers would race `uq_work_orders_ordinary_origin` and one would receive a raw `23505`). ... The P1-29 queue begins from work orders that conversion produced."; README.md:122-127 (the only other statement inserting a `wo.work_orders` row is `qms.rework-create`); test-and-acceptance-plan.md:207-209 precondition 4 "Work orders **come from reception** ... There is no shortcut, by design."

---

## 3. Rejected edges — and why rejecting them matters

An invented dependency is as damaging as a missed one: it serialises work that could run in
parallel, and it lends false authority to a schedule. Each of the following was proposed, examined
and **could not be substantiated from the repository**.

### Wave B slice B1 -> Wave B slice B2 (company status history) — UNSUBSTANTIATED as a hard edge

**Status: AMBIGUOUS IN DOCS.**

CAPABILITY: none flows from B1 to B2. B2 is a table and a plpgsql function; neither mentions `app_platform` and neither is reachable from a wave-B route. WHY THE EDGE IS REJECTED: B2 can be built, reviewed and migrated with B1 absent. REPORTED AS UNSUBSTANTIATED. Note the contradiction I could not resolve: §7.2 grants EXECUTE on `org.change_company_status` to `app_platform`, justified by "the wave C operation that calls it" — but a wave C tenant-side operation runs as `app_runtime`, not `app_platform`, so that grant serves no caller the design names.

_Evidence:_ wave-b-control-plane-design-v2.md:956 (B2 = company status history and its transition function, "Reviewable alone: Yes"); :733-739 (B2 adds `org.company_status_history` and `org.change_company_status(...)`, `SECURITY INVOKER`, no actor parameter); :741-742 "No route in wave B updates a company's status directly ... The tenant-side operation that calls this function is wave C's."; contradicted by :480 which grants EXECUTE on `org.change_company_status(...)` to `app_platform` "for the wave C operation that calls it"

### Wave D -> "company switching" — REJECTED AS STATED

**Status: AVAILABLE.**

THE CANDIDATE EDGE "global identity / multi-membership -> company switching" DOES NOT SURVIVE IN THAT FORM. Multi-COMPANY reach within a tenant is shipped and already consumed by P1-28 screens; a caller can name any company in `companyIds` today and `narrowScope` will admit it. What blocks a usable company SWITCHER is the absence of NAMES — G-5 / Wave C — not Wave D. Wave D's real deliverable is TENANT/MEMBERSHIP switching. Substantiated form: Wave C -> company selector (recorded above), Wave D -> membership switcher (recorded above). NO EDGE from Wave D to company switching.

_Evidence:_ apps/api/src/server/context/resolve-context.ts:79-103 (`bool_or(g.scope_mode = 'unrestricted')`, `array_agg(DISTINCT s.company_id)`, `array_agg(DISTINCT s.branch_id)` across every active grant); dependencies.md:340-344 "Inside a single tenant the platform is already multi-company ... so one person may hold authority in several companies of the same tenant. What no schema permits is the same person existing in two tenants at once."; permission-matrix.md dimension 2 "**Absent across tenants; shipped within one.**"

### Wave D -> the tenant-hint deletion on the local-only branch — EDGE DISSOLVED

**Status: AVAILABLE.**

CAPABILITY: the removal of `TENANT_HINT_COOKIE`, `readTenantHint` and `writeTenantHint` from `apps/web/src/lib/api/session-cookie.ts`. THE EDGE NO LONGER EXISTS. scope.md:194-196 states d502e07f "is **not** an ancestor of `develop`, and exists **only locally** — `git branch -a` lists no `origin` ref for it. So the briefing described work that was done and not landed ... Wave D lands it." dependencies.md:461-466 says the same, and both were measured at `b969894c`. At develop `c081a019` the commit is an ancestor via PR #257 and the three symbols are gone. Wave D's deliverable G-16 / D6 is DISCHARGED; do not schedule it. NOTE: the sibling item is NOT discharged — `apps/web/src/config/navigation.ts:297` still names `sal.invoice.read` and `:306` still names `sal.delivery.read`, so G-14 / D5 remains Wave G's.

_Evidence:_ `git merge-base --is-ancestor d502e07f c081a019` -> exit 0 ("d502e07f IS an ancestor of develop c081a019"); same against origin/develop -> ancestor; `git log --oneline --merges --ancestry-path d502e07f..c081a019 | tail` -> `741388c5 Merge pull request #257 from Ezzaldeen-Albitar/feature/pre-p1-29-web-coverage-and-tenant-hint`; `grep -rn "TENANT_HINT|tenantHint|TenantHint" apps/web/src apps/api/src` -> no output; `wc -l apps/web/src/lib/api/session-cookie.ts` -> 120, exports are SESSION_COOKIE, SessionCookieAttributes, sessionCookieAttributes, readSessionToken, writeSession, clearSession and nothing else

### Wave E -> any P1-29 slice — REJECTED

**Status: AVAILABLE.**

NO EDGE. The candidate "workflow authority -> operational transitions" is not a PRE-P1-29 -> P1-29 edge. Work-order and job transitions do not run through the shared transition engine at all; they are their own domain services, and P1-29's slices consume dimensions 1, 6 and 9, all shipped. Wave E's subject is authority OVER the workflow — it may change who may perform an existing action and may not create a new action in the work-order domain (scope.md:206-209). REJECTED.

_Evidence:_ implementation-slices.md:359-362 "Dimensions **2** (cross-tenant multi-membership), **7** (workflow authority) and **8** (subscription enforcement) are depended on by **no P1-29 slice**. Recording that is the point of the exercise"; implementation-slices.md:344-356 (per-slice PRE-P1-29 dimensions: A/B/C/D/H = 1, 6, 9; E = 4 technician half via BE-2, and 6; F/G = 6, 9); permission-matrix.md dimension 7 ("There is no generic workflow engine: the shared transition engine registers exactly one aggregate (`org.branch`)"), corroborated at apps/api/src/modules/shared-services/domain/transitions.ts:58, :78, :88 — all three definitions `aggregate: 'org.branch'`

### Subscription enforcement -> frontend blocked state — REJECTED, BOTH ENDS UNSUBSTANTIATED

**Status: EXISTS BUT NOT USED.**

NO EDGE, IN EITHER DIRECTION. There is no PRE-P1-29 wave that owns subscription enforcement — GAP-24 is an open Owner scoping question, not a wave deliverable, and the wave-B naming matrix (wave-b-control-plane-design-v2.md:715) leaves the Subscription row's missing capability and proposed operation both empty. And there is no frontend blocked state to build, because no operation is entitlement-gated. REJECTED.

_Evidence:_ Measured: `grep -rn featureFlag apps/api/src` -> exactly 3 hits, all infrastructure (server/auth/operation-registry.ts:69 the optional field, server/http/route-handler.ts:343 `if (operation.featureFlag) await requireFeature(...)`, server/openapi/document.ts:229 the `x-feature-flag` extension). Zero of the 305 operations declare one, so `ERR-TEN-001` (apps/api/src/server/auth/entitlement.ts:63-80) is unreachable. Upstream: gap-register.md:115 GAP-24 "**New capability required** ... Whether the pilot needs this surface at all is an Owner decision, not a technical one — see §6"; gap-register.md:196-199 lists it among the claims that could not be settled. `org.subscription.manage` has zero references in apps/api/src. implementation-slices.md:359-362 puts dimension 8 among the three no P1-29 slice depends on.

### PRE-P1-29 -> P1-29-A0 (Backend prerequisite remediation) — NO EDGE

**Status: AVAILABLE.**

NO EDGE. A0's five funded items are BE-5, BE-2, BE-1, BE-3, BE-4 in that build order (implementation-slices.md:284-290), and not one of them needs anything PRE-P1-29 produces. Both the frozen B1 slice and the Wave B control plane are explicitly recorded as unused by P1-29 (permission-matrix.md:288-289: "Platform authority / tenant lifecycle | PRE-P1-29 slice B1 | frozen | **P1-29 does not use it.**" and "The Wave B control plane | PRE-P1-29 Wave B | design only, behind its own gate | **P1-29 does not use it.**"). Recorded as an explicit non-edge because "depends on PRE-P1-29" would otherwise be assumed here.

_Evidence:_ implementation-slices.md:346 "| **A0** | none | its work is P1-29's own Backend |"; backend-prerequisite-gate.md:77, :95, :113, :152, :205 ("depends on: nothing" for BE-1, BE-2, BE-3, BE-5, BE-8); permission-matrix.md:296-299 "**Conclusion: PRE-P1-29 blocks P1-29 acceptance, not P1-29 construction.** ... The frozen B1 slice and the Wave B control plane are on a different path and no P1-29 behaviour touches either."

### P1-29-A0 BE-6 (consume job.assigned) -> PRE-P1-29 — NO EDGE

**Status: EXISTS BUT NOT USED.**

NO PRE-P1-29 PREDECESSOR. The outbox event exists and the notification surface exists; what is missing is the consumer that joins them, plus an Owner decision on the channel. Note a correction to dependencies.md B6's phrasing: `job-assignment-service.ts` DOES publish a domain event — it simply enqueues no notification from it. Ownership is P1-15 shared services or a P1-29 prerequisite; neither is PRE-P1-29.

_Evidence:_ backend-prerequisite-gate.md:168 "A consumer, and a notification channel decision."; :171 "**depends on** | a decision about the channel (in-app, email, both), which is an Owner question, and on `shared.notification.send` authority already in the catalogue."; measured: the event IS published — apps/api/src/modules/work-order/application/job-assignment-service.ts:453 `eventType: 'job.assigned'`, :470 `eventKey: \`job.assigned:${opened.id}\``, envelope at apps/api/src/server/events/envelope.ts:330 — while `grep -rn "notification-enqueue|messageDispatcher|message-dispatcher" apps/api/src -l` returns only the enqueue route and the shared-services index; dependencies.md:280-286 B6

### P1-29-A0 BE-8 (job-level work log and evidence) -> PRE-P1-29 — NO EDGE, AND NO DOWNSTREAM

**Status: MISSING.**

NO PRE-P1-29 PREDECESSOR AND NO P1-29 SLICE DOWNSTREAM. BE-8 is the only gate item whose absence blocks nothing already designed. Recorded so it is not carried as a hidden dependency.

_Evidence:_ backend-prerequisite-gate.md:202 "Schema **and** contract. This is the one prerequisite that is genuinely new modelling."; :204 "A Backend phase. Whether it is a P1-29 prerequisite or a later phase is an Owner scoping decision — unlike `BE-1`…`BE-4`, no already-designed capability is blocked by it."; :205 "**depends on** | nothing"; implementation-slices.md:290 (BE-6/7/8 are Owner-scoped, outside A0's funded five)

---

## 4. Ambiguous orderings this graph does not resolve

- **Wave C before Wave E, or after?** `scope.md:142` says waves are ordered by dependency and
  places C before E. `gap-register.md:164-168` states as a _forced_ dependency that GAP-08 — the
  tenant-scope question, which `scope.md` assigns to Wave E — must precede GAP-19, GAP-20 and
  GAP-22, which `scope.md` assigns to Wave C: _"The scope fix is a prerequisite for the structure
  surface, not a companion to it."_ Both statements are canonical and on `develop`. Recorded as
  `AMB-05`.
- **Wave D's lane.** `scope.md:150` assigns Wave D the backend lane while giving it a deliverable
  in a `web`-bucket file that the backend profile forbids. Recorded as `AMB-06`.
- **BE-7's administration half** is assigned to Wave B by the frozen P1-29 gate and to Wave C by
  three PRE-P1-29 documents. Recorded as `AMB-11`. **This planning set follows the three
  PRE-P1-29 documents** — Wave C — and flags the P1-29 gate line as the one to correct.
- **Two incompatible P1-29 slice letterings** exist inside the frozen preparation set itself, and
  the same letter means different things in each. Recorded as `AMB-12`. This document uses the
  `execution-decision.md` §4 lettering (A0, A..H) and the gate's `BE-1..BE-8` for prerequisites.
