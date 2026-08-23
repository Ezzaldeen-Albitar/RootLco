# PRE-P1-29 and P1-29 — ambiguity register

**80 places where the canonical documentation is ambiguous, self-contradictory, or
contradicted by the tree.** Every one was found while reading `develop` at `c081a019`, and
every one is **recorded, not resolved** — resolving a canonical ambiguity silently is how a plan
acquires facts nobody agreed to.

Each entry says what disagrees with what, and what would settle it. Nothing here is a defect
report against product code; these are defects in the _record_.

## How to use this register

- **Before implementing any slice**, read the entries for its topic. An ambiguity in the slice's
  own definition is a stop condition, not a detail.
- **An entry marked STALE is a document that the tree has overtaken.** Those are the cheapest to
  close and the most dangerous to leave, because they read as current.
- **An entry marked CONTRADICTION has two canonical sources disagreeing.** Only an Owner or the
  owning initiative can settle it; this planning slice may not.
- Where a figure is disputed, this planning set **uses the measured value and says so**, rather
  than picking a document to believe.

## The register

### AMB-01 — Canonical plan

§21 of wave-b-control-plane-design-v2.md contradicts §22 of the same file about which revision is un-attacked: :1001 says "Revision 2 has been written; it has not yet been attacked" while :1071 says "Revision 4 has been written; it has not been attacked", and the status line at :5 says the document IS revision 4. Both sentences are on develop. NOT RESOLVED — though the gate conclusion is the same either way.

### AMB-02 — Canonical plan

THE B1/GATE TENSION ITSELF. develop cannot settle whether the Wave B design gate was reported as passed before slice B1 was implemented. §19:950 and §21:999-1001 say implementation is not startable; §22:1071 says revision 4 has not been attacked; the design says of itself "No product code exists against it" (:5) and "Nothing was executed. No role, relation, resolver or migration exists" (:1075-1076). No pass report, and no B1 document of any kind, exists anywhere under docs/ on develop (`find docs -iname "*b1*"` → no output). NOT RESOLVED from develop. The off-develop answer is reported in its own item and is not treated as canonical here.

### AMB-03 — Canonical plan

The identifier `B1`, `B2`, `B3` is overloaded THREE ways in the canonical set: Wave B implementation SLICES (design §19:955-957); the three surviving high-severity BLOCKERS against revision 1 (design §21:989, §22:1011-1015; refutation register:427-431); and, in dependencies.md §4:158-166, the P1-29 DEPENDENCY ids B1..B7 (departments, technician roster, work-order-to-customer, job queue, QC queue, notifications, unified history). Nothing in the documents disambiguates them.

### AMB-04 — Canonical plan

The measured size of the tenant-scope population differs across documents that all live on develop and all claim measurement. scope.md:53 and :370 and gap-register.md:94 say 167 operations across 132 route files; design §14:820 says 170 across 136 (166 declaring plus 4 inheriting the default) and explicitly calls the other figure a raw text scan that was "wrong, in opposite directions" (:823-826); refutation register:461 repeats 170/136. Both figures are cited as authoritative in different places. NOT RESOLVED.

### AMB-05 — Canonical plan

WAVE ORDERING versus FORCED SEQUENCING. scope.md:142 says "Waves are ordered by dependency, not by convenience" and places C before E. gap-register.md:164-168 states as a forced dependency that "GAP-08 before GAP-19, GAP-20 and GAP-22" — i.e. the tenant-scope fix, which scope.md:151 and :201-205 assign to wave E, must precede the company/branch/department management surface, which scope.md:174-179 assigns to wave C. Nothing on develop reconciles the two orderings.

### AMB-06 — Canonical plan

WAVE D's LANE. scope.md:150 assigns wave D the `backend` lane, while :192-196 makes the deletion of the tenant-hint helpers in `apps/web/src/lib/api/session-cookie.ts` one of wave D's named jobs — a file in the `web` bucket, which `pre-p1-29-backend` is forbidden (§7:329). dependencies.md:141 assigns the same removal (D6) to `pre-p1-29-web`. The two documents assign one deliverable to two lanes.

### AMB-07 — Canonical plan

design §22:1015 says blocker B3 is fixed at "§6.3, §6.4, M3 in §15, P-26", but §15:840-841 defines M3 as the company status history and transition function and M4 as the `BEFORE UPDATE` transition backstop on `org.tenants` — and :1036-1038 states that only M4's trigger enforces the graph, "which is why it is now its own migration". The reference at :1015 names the wrong migration.

### AMB-08 — Canonical plan

THE OWNER AUTHORIZATIONS ARE NOT IN THE REPOSITORY. gap-register.md:185-194 states that five rows rest on an Owner decision — GAP-01, GAP-05, GAP-07, GAP-26, GAP-28 — and "none of it is written down anywhere under `docs/`. There is no PRE-P1-29 requirements document ... and no file under `docs/` carries a 2026-08-22 Owner instruction." architecture-decisions.md:17-19 nonetheless asserts as fact that "The Owner authorised two things on 2026-08-22", and dependencies.md:136-137 marks D1 and D2 "Owner-authorized 2026-08-22". The register's own conclusion: "The authorization to change the code does not [stand on its own], and would be settled by the decision being recorded in the repository before the Backend lane opens."

### AMB-09 — Canonical plan

NEITHER G-NUMBERED REGISTER USES "OPEN" OR "CLOSED". scope.md §3 (G-1..G-16) has three columns — #, Finding, Evidence — and no status column at all. gap-register.md (GAP-01..GAP-38) uses a five-value classification key at :44-50. The open/closed mapping given in those two items is derived by me from the classification key and each row's own wording; it is not the registers' language.

### AMB-10 — Canonical plan

The name "gap register" is itself ambiguous across the canonical set: scope.md §3 is titled "Why now — the measured gap" and numbers its rows G-n, while gap-register.md numbers its rows GAP-nn. They overlap in subject (e.g. G-4 ≈ GAP-16, G-8 ≈ GAP-08, G-14 ≈ GAP-12, G-16 ≈ GAP-06) but are separately numbered and neither cross-references the other's ids.

### AMB-11 — Dependency graph

BE-7's administration half is assigned to two different waves. backend-prerequisite-gate.md:188 says "depends on: PRE-P1-29 Wave B for the administration half". Three PRE-P1-29 documents say Wave C: scope.md:174-183 ("the department table of G-6 acquires a way in"), wave-b-control-plane-design-v2.md:714 (Department | Creating, naming, listing | wave C) and :696-698 (`org.department.read` "is a genuine candidate but belongs to wave C, which is where the operation that would need it lives; seeding it here would be a code with no operation"). NOT RESOLVED — the difference decides whether BE-7's management half is behind the frozen B1 blocker or not.

### AMB-12 — Dependency graph

There are TWO incompatible P1-29 slice letterings in the frozen preparation set, and the same letter means different things in each. execution-decision.md §4: A0 Backend prerequisites · A contract/data layer · B queue and history · C detail/lifecycle/assignment · D Technician workspace · E Diagnostics · F inventory/quotation/approval · G history/concurrency/polish · H Owner acceptance. implementation-slices.md §1-§9: A foundation and board · B detail read-only · C lifecycle · D jobs · E assignments/technicians/labour · F additional work · G quality/rework · H diagnostics (BLOCKED) · A0. So "P1-29-E" is Diagnostics in one and technician assignment in the other, and "P1-29-H" is acceptance in one and Diagnostics in the other. execution-decision.md §4 says the slice document "is the finer instrument and this table is the commitment", which does not settle which lettering to cite. Every edge above names the capability as well as the letter for this reason.

### AMB-13 — Dependency graph

"B1" is overloaded across the two canonical registers. dependencies.md §4/§6 (lines 160-166, 435-445) uses B1..B7 for the seven DEFERRED P1-29 Backend capabilities, where B1 = "departments as an operational dimension". wave-b-control-plane-design-v2.md:948-967 uses B1..B9 for the wave B IMPLEMENTATION SLICES, where B1 = the role, the relation, the resolver and the coverage-matrix change. canonical-plan.md:40 cites "dependencies.md:433-444 assigns seven named capabilities (B1-B7)" in the first sense while permission-matrix.md:257-263 discusses "slice B1" in the second. The two namespaces are never reconciled in either document set.

### AMB-14 — Dependency graph

wave-b-control-plane-design-v2.md:480 grants EXECUTE on `org.change_company_status(...)` to `app_platform`, justified as "§12.3, for the wave C operation that calls it". But §12.3 (:741-742) states that no wave B route calls it and that the calling operation is wave C's — and a wave C tenant-side operation runs as `app_runtime`, not `app_platform`. Either the grant names the wrong role, or a wave B platform operation calls the function and §12.3 is wrong to say none does. NOT RESOLVED.

### AMB-15 — Dependency graph

Deliverable D7 — removing the optional `tenantId` from the login body (verified still present at apps/api/src/app/api/v1/auth/login/route.ts:41) — is assigned to the `pre-p1-29-backend` LANE by dependencies.md:142 but to no WAVE by scope.md. Waves B, C, D and E are all backend; scope.md:184-197 describes Wave D as owning tenant resolution and the tenant-hint deletion but never names the login contract. So D7 has an owner and no schedule.

### AMB-16 — Dependency graph

The tenant-scope population is stated three different ways across the canonical set and one of them is arithmetically wrong. scope.md:198-209 and permission-matrix.md dimension 6 say 167 declaring across 132 files (correct, measured). wave-b-control-plane-design-v2.md:820 says 170 across 136, decomposed as "166 declaring it, 4 inheriting the default" — the declaring half is 167, so the total should read 171. The figure recurs unchanged at :912-913, :971 and :1025. Separately, all four inheriting operations are `public: true`, so whether they belong in a short-circuit population at all is itself undecided by any document.

### AMB-17 — Slice B2

§12.3 requires "transition-graph validation", but `ck_legal_companies_status` admits exactly two states (20260717103000:82), so both directions are legal and the graph degenerates to the enum check plus the no-op check that `org.change_branch_status` already performs (:313, :332). Proof-plan row P-22 ("A legal company transition, then an illegal one — accepted, then refused") therefore has no illegal transition to exercise except an unknown state name or a no-op. The design does not say which it means, and widening the state set would require editing an applied migration, which §15 forbids. RECORDED, not resolved.

### AMB-18 — Slice B2

Whom to grant EXECUTE on `org.change_company_status`. The two shipped precedents point opposite ways: `org.change_branch_status` is granted to app_runtime (20260717103000:350); `org.change_tenant_status` is granted to nobody with a comment saying lifecycle is a platform operation (20260717101000:231-233). Granting app_runtime makes the function reachable by any tenant session under `upd_legal_companies_tenant`, which checks no permission; granting nobody makes B2's own tests require the admin connection and leaves the function inert until wave C. §12.3 and §19 are silent.

### AMB-19 — Slice B2

Whether the history INSERT policy should require a permission. `ins_branch_status_history_tenant` requires none (20260717103000:414-416); `ins_user_status_history_admin` requires `iam.has_permission('iam.user.manage')` (20260726090000:193-195). If B2 requires `org.company.manage` it wires an orphaned code, which §12.1 arguably encourages and arguably forbids ("Wave B adds none of them and duplicates none of them" is about ADDING codes, not about wiring one); if it does not, the code stays orphaned and the status write stays permission-free. The design does not address the company history policy's predicate at all.

### AMB-20 — Slice B2

Whether the transition function should refuse a soft-deleted or archived company. `org.legal_companies` carries `deleted_at` and `archived_at` (20260717103000:67,:69) and the repository already guards on them elsewhere (`org.guard_parent_company_live`, :181-204). `org.change_branch_status` does NOT filter `deleted_at`, but the shipped TypeScript branch adapter DOES (`AND deleted_at IS NULL`, transition-repository.ts:73,:97). So the two halves of the branch precedent disagree, and §12.3 says only "modelled column-for-column on the branch history table", which covers the table and not the predicate.

### AMB-21 — Slice B2

Which consumer wave C will build on. `iam.change_user_status` is called from product code (identity-repository.ts:309); `org.change_branch_status` has an EXECUTE grant and zero product callers, because the branch status route drives the TypeScript transition engine instead (route.ts:94-100 → transition-repository.ts:86-131). If wave C registers `org.legal_company` as an engine aggregate (transitions.ts:56-64) rather than calling the function, B2's function joins `org.change_branch_status` as a second granted-but-uncalled object — which is a legitimate outcome, but it should be a decision rather than a discovery. §12.3 says only "The tenant-side operation that calls this function is wave C's", which presupposes the call.

### AMB-22 — Slice B2

Design §12.2's Branch row names `org.branch.manage` as the existing permission for `shared.branch-status-change`; the source requires `org.settings.manage` (route.ts:52) and `org.branch.manage` is required by nothing. permission-reuse-register.md:130 states the correct fact. Two initiative documents disagree; the design was not corrected in revisions 2-4.

### AMB-23 — Waves C and E

THE TENANT-SCOPE POPULATION IS GIVEN THREE DIFFERENT VALUES, AND MY MEASUREMENT MATCHES NEITHER DOCUMENT EXACTLY. scope.md:53 and :201 say '167 published operations declare tenant scope, spread across 132 route files'. wave-b-control-plane-design-v2.md:817 says '170 across 136 files — 166 declaring it, 4 inheriting the default', and :911-912 repeats '170 operations across 136 files'. My AST parse gives 167 explicit + 4 inherited = 171, across 136 files, and the published contract's x-scope tally reproduces 171 independently ({"branch":132,"tenant":171,"company":2}), with the four buckets summing to the agreed 305. So scope.md's 167 is right for 'explicitly declared' and wrong as a statement of the population that resolves to tenant scope; the wave-B design's 136 files is right and its 170 is off by one against two independent measurements. Not resolved here — the documents disagree with each other and the correction belongs to whoever owns them.

### AMB-24 — Waves C and E

G-8'S HEADLINE FRAMES A TENANT-SCOPE PROBLEM; THE CODE HAS A TARGET PROBLEM. gap-register GAP-08 and scope.md:53 both describe the defect as the tenant short-circuit. But authorization.ts:62-65 returns false for ANY empty target whatever the declared scope, and route-handler.ts:342 passes an empty target for all but 17 operations — so 117 branch-scoped operations are in the same position and are counted by neither figure. Several source docblocks state the wider reading plainly (route-handler.ts:88-108, work-orders/route.ts:20-27, validation.ts:227-241, authorization.ts:198-206), and dependencies.md §2.3 half-states it. Whether Wave E's mandate is the 167/171 the register names or the 282 the code implies is not settled by any document I read.

### AMB-25 — Waves C and E

WHETHER WAVE C WIRES ALL FIVE G-4 CODES OR THREE. scope.md:176 says wave C gives 'the five orphaned administration permissions of G-4 … the operations they were written for'. permission-reuse-register.md:131 says org.tax.manage is 'WIRE — deliberately out of scope … Leave it alone', and :130 marks org.subscription.manage 'WIRE — scope undecided', with §7 at :269 requiring 'An explicit scope statement' before it can be classified. Three documents, two answers.

### AMB-26 — Waves C and E

WHERE GAP-09 (DEPARTMENT-SCOPED EVALUATION) BELONGS. gap-register.md assigns gaps to LANES — its wave column reads 'Backend', 'Web', 'Backend, then Web' — not to the nine waves A..I, so it cannot say whether closing GAP-09 is Wave C's (departments must exist before a department scope can be named) or Wave E's (it is an evaluation defect in the same function as G-8, and would require widening ScopeRequirement at operation-registry.ts:36). Both readings are supported. Relatedly, gap-register.md §3 is headed 'The four waves' while describing four ownership LANES including repository-tooling — a heading that reads as a fifth wave taxonomy alongside scope.md's nine.

### AMB-27 — Waves C and E

WHETHER THE PROPOSED DEPARTMENT READ CODE IS WAVE C'S TO SEED AT ALL. permission-reuse-register.md:150-154 is emphatic that `org.department.read` 'is written here as a proposal, not as a canonical name' and 'must not be cited anywhere as if it did until the Backend lane seeds it'. scope.md:181-182 says wave C seeds any permission a wave C operation needs. Whether the grant-scope picker (a Wave H screen over an iam contract) makes the department read a Wave C need or a Wave H-driven late addition is not stated.

### AMB-28 — Waves C and E

WHAT 'RECORD THE ANSWER' MEANS FOR WAVE E'S OUTPUT ARTEFACT. scope.md:204 requires a per-operation determination to be recorded, and :407-409 defines the question. Nothing says whether the record is a document, a derived test in the tests/foundation/p1-18-scoped-authorization.test.ts shape, or a machine-checked register in the scripts/p1-24-operation-register.mjs shape — and the three have very different exit properties, since only the latter two fail when someone adds operation 306.

### AMB-29 — Wave D / identity

Tenant-scoped operation count: scope.md:47 (G-8) and :265 say 167 operations across 132 route files; wave-b-control-plane-design-v2.md:920 and :969 say 170 operations across 136 files. My measurement reproduces scope.md exactly and neither figure in the wave B design: `grep -rn "scope: 'tenant'" apps/api/src/app/api/v1 --include=route.ts` → 171 hits in 132 files, of which exactly 4 are prose inside comments (items/route.ts:7, price-lists/.../publication/route.ts:101, reception-catalogue/damage-map-templates/route.ts:109, services/.../publication/route.ts:97), leaving 167 declarations in 132 files. Across the whole of apps/api/src the same pattern gives 180 hits in 136 files, which is where '136 files' appears to come from — a file count taken over the whole tree paired with an operation count that matches neither method. Not resolved here: the two documents count different populations and neither states its method.

### AMB-30 — Wave D / identity

Whether the external-identity uniqueness index should change at all, and how. scope.md:410-416 records it as explicitly unsettled and names three candidate remedies (change the key; introduce a separate identity record above the tenant-scoped account; a membership table that spans them). architecture-decisions.md:118-122 then asserts the remediation is tractable BECAUSE 'it is a single index', which reads as having chosen the first. wave-b-control-plane-design-v2.md:929-943 assumes the second (platform_grants references an ACCOUNT, repointed to an identity by one additive migration). The three documents are not consistent about which shape wave D is expected to take, and the choice determines whether 14 composite foreign keys survive untouched or must be rewritten. Recorded, not resolved.

### AMB-31 — Wave D / identity

Where the CHOSEN membership is carried between requests. P-3 (scope.md:104-118) requires the browser to assert nothing, and P-1 forbids a typed identifier. Today the active tenant arrives only as the provider JWT's app_metadata.tenant_id, and bearer-authenticator.ts:82-90 refuses a token without it. No canonical document states whether the chosen membership becomes a new provider claim (which makes the provider the authority for a RootLco decision), a RootLco-issued token, a column on iam.user_sessions (whose tenant_id is frozen by tg_user_sessions_immutable, 20260718094000:137-140), or a new session row per membership (forbidden by uq_user_sessions_session_ref). The documents assert the requirement and are silent on the mechanism.

### AMB-32 — Wave D / identity

Whether the audit actor becomes the global identity or stays the per-tenant account. architecture-decisions.md:161-163 rejects duplicated accounts partly BECAUSE 'two accounts for one person means two actor identities in the audit record for one set of hands, and no join exists that would reunite them' — an argument for stamping the identity. But app.user_id is what 31 stamping assignments across 22 migrations write into 28 actor columns, and it is currently the account id (resolve-context.ts:312). No document decides which one wave D stamps, and the two answers give the audit trail different meanings.

### AMB-33 — Wave D / identity

Whether a 'list my memberships' operation is public or authenticated. Every one of the 305 registered operations is either public (6 of them) or resolved through resolveRequestContext, which requires an active account in the claimed tenant. A membership list is neither: the caller is authenticated but not yet tenant-scoped. The documents name the capability (GAP-07, scope.md:184-197) and do not say where in the pipeline it lives, nor which permission — if any — guards it. iam.has_permission cannot guard it, because it begins by requiring an active account in the current tenant (20260718097000:92-96).

### AMB-34 — Waves F-I

DIRECT CONTRADICTION on whether waves F and G are in scope at all. `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/architecture-decisions.md:445-447` states: "It does not decide the tenancy surfaces deferred by the Owner — typed company and branch identifiers, **Superadmin and Company-Owner admin screens**, and Backend-authoritative page visibility remain out of scope, consistent with the standing deferral." But `scope.md:150-151` makes "Superadmin web" wave F and "Company administration web" wave G, and `dependencies.md` §3 D4 delivers "Superadmin and company administration screens, the role editor, capability-driven navigation, and human company/branch selectors" under `pre-p1-29-web`. `dependencies.md` §6 narrows the deferral to "The typed company/branch identifier surfaces of the deferred tenancy requirement" only. Two canonical documents on `develop` therefore disagree about whether the Superadmin and Company-Owner admin SCREENS are deferred or scheduled. NOT RESOLVED — an Owner or architecture ruling is needed, because if architecture-decisions.md is authoritative, waves F and G do not exist.

### AMB-35 — Waves F-I

Tenant-scoped operation counts disagree between two canonical documents, and my measurement matches neither total. `scope.md` G-8 says "167 published operations declare tenant scope, spread across 132 route files" and notes a plain-text grep returns 171 with four prose hits. `wave-b-control-plane-design-v2.md:820` says "**170** across **136** files — 166 declaring it, 4 inheriting the default at operation-registry.ts:185", repeated at `:912-913`, `:971` and `:1025`. I parsed every `defineOperation({…})` body under `apps/api/src/app/api/v1/**/route.ts` with comments stripped: 305 blocks total; 167 declare `scope: 'tenant'` in 132 files; 4 declare no `scope` key at all and inherit the default (`operation-registry.ts:185` `scope: declaration.scope ?? 'tenant'`) — `auth/login`, `auth/logout`, `auth/password-reset`, `auth/password-reset/completion` — giving 171 resolving to tenant across 136 files. So scope.md's declaring figure is right, the file counts reconcile, and the design document's 166/170 is one low. NOT RESOLVED — this is wave E's input and I am not adjudicating which figure is canonical.

### AMB-36 — Waves F-I

Role administration is assigned to BOTH wave G and wave H with no boundary. `scope.md:150-151` gives wave G "Company, branch, department and role administration inside a tenant" and wave H "the administration-side workflow surfaces — role editing, grant scoping, membership switching". `scope.md:239-247` repeats it: wave G "extends it with company, branch and department administration" while wave H is "editing a role, scoping a grant, switching membership". Role editing already exists on `develop` (six server actions, two screens), which makes the overlap consequential: it is not clear which wave owns REMEDIATING the existing role and permission screens (for example the raw domain heading at `PermissionsScreen.tsx:144` and the untranslated seed description at `:166` that PRE29-AD-05 requires be routed through the message catalogue). NOT RESOLVED.

### AMB-37 — Waves F-I

How a control-plane capability reaches the browser is unstated and the stated constraints pull against each other. `scope.md:233-237` (wave F) says "Visibility is driven by capability, per P-4, and the capability comes from the Backend." P-4 (`:198-204`) and the shipped helper define capability as exact membership of a permission-code string in `session.permissions` (`permissions.ts:49`). P-5 (`:117-123`) forbids any wildcard permission. `wave-b-control-plane-design-v2.md` designs the principal as a fourth database role plus an `iam.platform_grants` relation, not as a tenant permission code, and states at `:32` that it "decides nothing about… the web tier". Meanwhile `GET /api/v1/auth/session` is `scope: 'tenant'` and requires `iam.user.read`. No document on `develop` says whether the control-plane capability appears in `session.permissions`, in a new field, or through a different operation entirely. NOT RESOLVED.

### AMB-38 — Waves F-I

The word "wave" carries two different meanings in adjacent canonical documents. `scope.md:140-250` §5 "The nine waves" enumerates A..I as work phases. `gap-register.md:52` §3 "The four waves" enumerates the four OWNERSHIP LANES (initiative, backend, web, repository-tooling) with their branch prefixes. A reader who takes "wave" to mean one thing throughout will mis-read one of the two documents. NOT RESOLVED — recorded rather than silently normalised.

### AMB-39 — Waves F-I

Who fixes the two SHIPPED P-1 violations is not assigned. `SettingsEditor.tsx:107-123` and `ApprovalLimitsScreen.tsx:321-331` already ask a human for a raw organisational identifier — the select's labels ARE the identifiers, and the empty-scope branch is a free-text field. `scope.md:194-197` says only "A human-readable selector therefore cannot be built today. Making one buildable is wave C's obligation, not the web lane's," which assigns the CONTRACT but not the replacement of the two existing controls. Wave G's description (`:239-243`) speaks of extending the tree with new administration and building new selectors, not of remediating the existing ones. NOT RESOLVED.

### AMB-40 — RBAC semantics

Scope semantics of `iam.has_permission_in_scope` are documented two ways in the same file. apps/api/src/server/auth/authorization.ts:76-90 argues that naming the `authorizationTarget` is SUFFICIENT and that a second TypeScript scope check is wrong, while :250-261 in the same file states that the approval-ceiling predicate is 'deliberately WIDER than `iam.has_permission_in_scope`, which matches a `branch`-type scope row on `branch_id` only and never on `company_id`. So the two are not equivalent' and names a residual over-grant case. Both are accurate about different questions, but the file gives no single statement of what a scope row means, and the SQL's three arms are disjunctive single-column comparisons (20260718097000:186-197). An effective-permission document must state the rule once; this lane does not resolve which phrasing is canonical.

### AMB-41 — RBAC semantics

Deny is tenant-global in the scoped function (20260718097000:164-174 has no scope predicate) while allow is scope-matched. No document on develop says whether that asymmetry is the intended contract or an artefact — the COMMENT at :207-208 asserts 'deny precedence is global' as a statement of behaviour, and the table comment at 20260718091000:143-144 says only that 'a single deny beats every allow at resolution time'. Whether a tenant administrator may scope a deny is therefore undecided in the documentation, and it materially changes what a Company Owner can express.

### AMB-42 — RBAC semantics

Whether archiving a role is meant to withdraw it from existing holders. `iam.roles.deleted_at` exists and blocks new grants (access-administration-service.ts:176-181), the table comment says 'roles soft-delete' (20260718091000:105), and yet `iam.has_permission` never reads it. Neither reading is written down anywhere on develop.

### AMB-43 — RBAC semantics

`actorUnrestricted` has two non-identical definitions that today coincide only by accident. The application layer computes it as 'the request context carries no company/branch narrowing' (access-administration-service.ts:789), the database backstop as 'an active grant with scope_mode = unrestricted exists' (20260727090000:139-150). They agree only because no route supplies `requestedScope` and because `resolveScopeFor` empties the arrays for an unrestricted holder. The delegation-policy docblock at :152-157 asserts the DB definition ('derived server-side from the caller's own resolved grants') for a value that is not computed that way.

### AMB-44 — RBAC semantics

docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:53 (G-8) and wave-b-control-plane-design-v2.md:948-967 (slices B1..B9, B8 struck through and moved to wave C) were both verified as written and are NOT ambiguous — recorded here only so the RBAC document does not re-derive them. B1's documents are not on develop and nothing in this lane contradicts B1's finding that deny wins.

### AMB-45 — Login / workspace

scope.md G-16 (docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/scope.md:61) and §9 (:192-196) both assert that the three tenant-hint helpers are still declared in `apps/web/src/lib/api/session-cookie.ts:43,:87,:123` and that the removal sits on an unmerged local branch. At `c081a019` the file is 120 lines and declares none of them: `d502e07f` IS an ancestor, merged as PR #257 on the same day scope.md was written (`5a8df206`). Both documents are internally consistent and one of them is out of date; I am reporting the tree, not resolving which document should be amended.

### AMB-46 — Login / workspace

supabase/migrations/20260717101000_org_tenants.sql:117 states in a COMMENT ON COLUMN that `org.tenants.status` is 'Queryable by the future session layer (Phase 1-4) to refuse suspended/closed tenants.' Phase 1-4 and Phase 1-14 both shipped and no such query exists. The comment reads as a live plan; nothing in the docs records the intent as dropped, deferred or reassigned to a later phase. It is genuinely unclear whether the absence is an accepted decision or an unclosed obligation.

### AMB-47 — Login / workspace

The login operation is published with `x-scope: tenant` in docs/api/openapi.v1.json while also carrying `security: []` and `public: true`. This comes from the registry default (`scope: declaration.scope ?? 'tenant'`, apps/api/src/server/auth/operation-registry.ts:185) rather than from a declaration in the route, so the published contract asserts a scope requirement for an operation that by definition has no scope to resolve. Harmless today; misleading to a reader building a scope-driven design from the contract.

### AMB-48 — Login / workspace

`admin.scope.noneResolved` ('…so enter the reference you want to work on.') is shipped copy in both locales that instructs an operator to type a company or branch UUID, while P-1 forbids exactly that. The docs treat P-1 as binding and treat the missing-directory gap (G-5) as wave C's obligation, but no document states whether the existing free-text fallback is an accepted temporary breach or a defect.

### AMB-49 — Company Owner

Two documents in the same folder give different counts for the tenant-scope surface, and neither retracts the other. gap-register.md:94 (GAP-08) says '167 of the 305 published operations declare tenant scope' and :95 (GAP-09) repeats '167 tenant-scoped operations ... 134 company- and branch-scoped ones'; wave-b-control-plane-design-v2.md:817 says 170 across 136 files, measured 2026-08-22 at fe81f3eb, and :824-826 explains that revision 1's earlier figure (180 across 132) was a bad text scan. Which of 167 and 170 is current is not resolved in the documents.

### AMB-50 — Company Owner

'A narrow override where supported' is not defined in the pre-P1-29 document set — the phrase appears in the task, not in scope.md, gap-register.md or the wave B design. Three different mechanisms could answer to it (a per-user approval limit, a role-level deny mapping, a per-role sensitive-data classification override), and they differ in subject and in whether any operation exposes them. I report all three rather than choosing.

### AMB-51 — Company Owner

The boundary 'IAM administration routes' is ambiguous in the repository. Thirteen further operations carry `iam.` identifiers while living outside apps/api/src/app/api/v1/iam/**: iam.audit-event-list, iam.audit-event-detail (audit-events/), iam.auth-login, iam.auth-logout, iam.auth-session, iam.auth-password-reset, iam.auth-password-reset-completion (auth/), iam.tenant-settings-read, iam.tenant-settings-update (org/tenant/route.ts:36,49), iam.company-settings-read, iam.company-settings-write (org/companies/[companyId]/settings/route.ts:37,50), iam.branch-settings-read, iam.branch-settings-write (org/branches/[branchId]/settings/route.ts:33,46). The 25-operation enumeration above is the path-based reading the lane asked for; the identifier-based reading would give 38.

### AMB-52 — Company Owner

access-administration-service.ts:301-305 (docblock for removeRolePermission) and access-administration-service.ts:306-332 (its body) disagree about whether last-holder protection applies to permission-mapping removal. The docblock asserts it does; no call exists. I have reported the code behaviour, but the intended contract is genuinely unclear from the source.

### AMB-53 — Company Owner

§17 and §19 both send P-21 and slice B8 to 'wave C', but no wave C document exists in docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow (the folder holds architecture-decisions, dependencies, gap-register, permission-reuse-register, scope, wave-a-discovery, and the two wave-b files). What wave C's scope is, and therefore which operation is 'the first Company-Owner-reachable administration operation', is not settled by any document I read.

### AMB-54 — Control plane

The 20260717107000 migration header and the wave-b design describe the SAME line with opposite risk postures. The header's 'Security implications' block (:22-34) argues provisioning is safe because the function is SECURITY INVOKER and granted to no application role, and names 'tenant self-provisioning' as the abuse case — it says nothing about the `(p_spec ->> 'actor_id')` fallback at :121. wave-b-control-plane-design-v2.md:517-522 treats that same line as a named defect (C5): 'Leave the session principal empty and the request document becomes the authority on who acted.' Both are in this tree; neither cites the other. The code is unambiguous, the risk framing is not.

### AMB-55 — Control plane

rate-limit.ts:159 states `public-probe` is 'The only policy an unauthenticated (public: true) operation may use', but neither health probe declares it — both declare `low-risk-metadata` (health/live:35, health/ready:49) and rely on `policyFor` to substitute. Read literally the comment is contradicted by every public operation in the repository; read as a statement about the ENFORCED policy it is true for the probes and false for the four `iam.auth-*` routes, which keep `auth-adjacent`. The doc sentence does not distinguish declared from enforced.

### AMB-56 — Control plane

docs/database/role-and-grant-standard.md:63-68 presents `postgres` as a role 'archetype' in the same table as the three migration-created roles, and :167 separately says the migrations create `app_runtime`, `app_readonly` (0002) and `app_worker` (Increment G). A reader asking 'how many roles do the migrations create' gets three from :167 and could read four from the table. The migrations themselves are unambiguous: three CREATE ROLE sites.

### AMB-57 — Control plane

The migration comment at 20260721094000:170 states that reason and correlation are 'captured from app.status_reason / app.correlation_id GUCs'. The first half is implemented; the second GUC is set by nothing in `apps/`. The comment describes an intended contract, not the shipped behaviour, and does not say which.

### AMB-58 — Subscription / company status

The column COMMENT on org.tenants.status (20260717101000_org_tenants.sql:117) says the value is 'Queryable by the future session layer (Phase 1-4) to refuse suspended/closed tenants.' Phase 1-4 shipped (migrations 20260718*) and no such query exists anywhere. The comment reads as a delivered property but describes an intention. Comparable wording at :36-40 ('through the Phase 1-4/1-14 platform surfaces later') and in the function COMMENT at :229.

### AMB-59 — Subscription / company status

Two code comments cite ADR-008 as the authority for 'tenant status is an owner/operator capability': apps/api/src/app/api/v1/org/tenant/route.ts:9-11 and apps/api/src/modules/iam/application/organization-settings-service.ts:112-114. docs/adr/ADR-008-configuration-driven-tenant-onboarding.md is 115 lines about not letting the pilot tenant's requirements leak into the product; `grep -ni 'status|suspend|lifecycle'` over it returns nothing. The cited authority does not contain the proposition.

### AMB-60 — Subscription / company status

docs/database/permission-catalog-reference.md:76 documents a baseline role `platform_operator` holding tenant.read, subscription.manage and audit.view. No seed creates that role — it exists only inside the per-test fixture tests/db/iam-seeds.test.ts:32-51. A reader of the reference document would reasonably believe the role ships.

### AMB-61 — Subscription / company status

Naming: the lane brief, wave-b-control-plane-design-v2.md §12.3 and the gap register all say 'company', while the relation is org.legal_companies and the migration file is 20260717103000_org_companies_branches.sql. There is no org.companies. §12.3's own citations use the correct table, but the object names it specifies (org.company_status_history, org.change_company_status) drop 'legal', which is inconsistent with org.legal_companies but consistent with org.company_settings — the schema is itself inconsistent on this point.

### AMB-62 — Subscription / company status

org.tenant_subscriptions.status admits 'expired' (20260717102000:226) and the table COMMENT at :238 says 'an ending is effective_to/status', but nothing in the repository ever writes that value. Whether 'expired' is meant to be computed from effective_to or set by an absent platform operation is not stated anywhere.

### AMB-63 — Subscription / company status

wave-b-control-plane-design-v2.md:738 requires 'transition-graph validation' for org.change_company_status but never states the graph, and the branch template it points at has only two states with a symmetric two-arc graph while the tenant template has four states with a terminal one. Which shape company lifecycle takes is not settled by the text.

### AMB-64 — Contract mirror

The frozen §11.2 table row reads 'top-level request bodies with a faithful exported API type | 4 — RaiseRequestInput, ApprovalEvidenceInput, CreateReworkInput, and AssignInput'. ApprovalEvidenceInput (additional-work-service.ts:135) mirrors the NESTED Evidence element at approval/route.ts:85-91, not a top-level body. The count of 4 is right under the reading 'request shapes with a faithful exported type'; the row LABEL 'top-level request bodies' is not. Documentation ambiguity, not a measurement error.

### AMB-65 — Contract mirror

'32 distinct request shapes' counts request BODIES only. Query-string contracts are not counted and are non-trivial: tech.technician-available encodes skills as a comma-joined 'code:rank' string (technicians/available/route.ts:92-98), wo.work-order-list takes eight query fields, and three paged reads take cursor/limit. Whether a P1-29 mirror owes query shapes is unresolved by the frozen set.

### AMB-66 — Contract mirror

The count of 6 anonymous envelopes is consistent only under the unstated reading that an inline `{items: T[]}` is the shared ItemsOnly<T> of §11.3 rather than a new anonymous shape. Eight further operations build such an envelope inline in the route (dia.diagnostic-list, qms.qc-record-list, qms.reopen-attempt-list, qms.rework-list, wo.additional-work-list, wo.job-assignment-list, wo.required-part-list, wo.service-line-list). Under a literal reading of 'responses with no named type on either side' the number would be 14, not 6. The doc does not state which reading it used.

### AMB-67 — Contract mirror

The frozen list names 'TransitionResult' without qualification, but two declarations exist: work-order/application/work-order-service.ts:143 and shared-services/application/status-transition-service.ts:52. Which one the mirror transcribes is not stated, and nothing in the code disambiguates by name alone.

### AMB-68 — Contract mirror

§11.2 states 'zero have a mirror row anywhere in apps/web/src today'. Literally true for `operationId:` ROWS, but apps/web/src/features/receptions/work-order-contract.ts already carries a hand-transcribed payload DTO (ConvertedWorkOrder:58, ConvertedWorkOrderJob:46) for wo.work-order-detail plus WORK_ORDER_READ_PERMISSION:43. Whether 'mirror' means the row layer or the payload layer changes whether the P1-29 mirror starts at zero.

### AMB-69 — Contract mirror

Whether the three {reason} bodies (differing only in max-length constant) and the three {toState, reason?} bodies count as one shape or three depends on whether the comparison key includes validation facets. The frozen count of 30 implies field-name+optionality keying. A JSON-Schema-based gate would naturally include maxLength and see 32 top-level shapes, not 30. The doc does not fix the keying rule.

### AMB-70 — Environment parity

`.github/ci-baselines/schema-baseline.json:39` (`securityDefinerPolicyNote`) states as an OPEN DECISION that migration `20260815090000` "adds TWO" SECURITY DEFINER functions (`shared.begin_document_scan`, `shared.complete_document_scan`) and that somebody must choose whether to raise the approved count to 2. The shipped migration contradicts it: `supabase/migrations/20260815090000_shared_reception_evidence_foundation.sql:198` and `:225` both declare `SECURITY INVOKER`, and `:108-115` explains that a first draft made them DEFINER and was changed. `schema-baseline.json:23` (`structuralTotalsDeltaNote2`) agrees with the migration — "All three functions are SECURITY INVOKER, so security_definer stays 0." Two notes in the same baseline file describe two different worlds; not resolved here.

### AMB-71 — Environment parity

`docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-refutation-register.md:179` says "A pull-request run does not see the business schemas at all." As written that is broader than the code: `scripts/ci/rls-matrix.mjs:34` puts `crm`, `inv`, `wo`, `sal` and `quo` in `CRITICAL_SCHEMAS`, which IS the PR level. The defensible reading is the ten `ADDITIONAL_SCHEMAS` (RISK-6). Recorded rather than reconciled, because the sentence is load-bearing in a refutation entry marked CONFIRMED.

### AMB-72 — Environment parity

`tests/db/shared-hardening.test.ts:246-248` reads "USAGE on `extensions` would also expose extensions.pg_stat_statements, which pgcrypto grants to PUBLIC." The attribution is odd — `pg_stat_statements` is its own extension and its PUBLIC grants are not made by `pgcrypto`. The rule the test enforces (no application role holds USAGE on `extensions`) is unaffected; the stated reason may be wrong. Unverifiable in CI, where `pg_stat_statements` does not exist.

### AMB-73 — Environment parity

"Hosted" is overloaded across this repository and must be disambiguated in anything built on this register. `hosted-clean-room` (`pr-ci.yml:225`), "hosted CI" and "GitHub-hosted ubuntu-latest" (`schema-baseline.json:5`) all mean a GitHub-hosted RUNNER — which runs bare Postgres. "Hosted Supabase" would mean the provider, which does not exist here. A gate labelled "hosted" proves nothing about a provider environment.

### AMB-74 — Environment parity

`docs/database/migration-standard.md:255-259` and `docs/database/role-and-grant-standard.md:520-524` and `docs/database/postgresql-extension-register.md:224` all describe the database tier as "the 68-test database suite". `ls tests/db | wc -l` returns 147 files today. The parity statements those paragraphs make are still accurate; the figure beside them is stale.

### AMB-75 — Ownership / PR

REQUIRED-CHECK COUNT ON `develop` — the repository says two different things and neither is dated as superseding the other. `docs/engineering/ci-automation/gate-record.md:151` records the post-migration state as **5** required contexts (the four legacy `ci.yml` job names PLUS `ci-gate`) and `:157` says "The four legacy checks were **kept, not replaced**. Removing them is rollout step 10 and belongs in its own reviewable pull request." `docs/phase-1/phase-1-28/evidence/closure-evidence.md:666` (later, 2026-08) labels `ci-gate` "**the single required check**", and `docs/phase-1/phase-1-28/evidence/change-log.md:399-400` repeats "`ci-gate` is the single required check". `docs/engineering/ci-automation/rollout-plan.md:99` lists step 10 — "Remove the four `ci.yml` job names; delete `ci.yml`" — as an OWNER action in a separate PR, and `.github/workflows/ci.yml` still exists on this head, so at least the deletion half never happened. I cannot resolve which statement describes the ruleset today from files alone: required contexts are a GitHub setting, not a committed artefact.

### AMB-76 — Ownership / PR

`main`'s STRICT (up-to-date) SETTING is stated nowhere in the repository. `gate-record.md:152` records `develop` as `strict: false` — "`false` — retained". No document on this head states `main`'s value. `branch-ruleset.md:36` states the TARGET-state intent "Require branches up to date | yes for `develop`", which contradicts the applied `false` recorded in the gate record. Both cannot describe the same moment; the gate record is the applied state and `branch-ruleset.md` is the design page.

### AMB-77 — Ownership / PR

THE MODULE DOCBLOCK COUNTS ELEVEN BUCKETS AND THE CODE HAS TWELVE. `scripts/ci/check-phase-ownership.mjs:136-138` reasons about "adding a TWELFTH bucket [that] would have widened every profile in the file at once" — a sentence written when eleven existed. `dbSeeds` was added afterwards (`:107-114`), making twelve, and the very hole the sentence describes is now live for `dbSeeds`: six of the twelve profiles name it in neither list and refuse it only through the generated fallback message at `:817-819`. Behaviourally sound (allowed decides), but the prose no longer counts the buckets it is reasoning about.

### AMB-78 — Ownership / PR

THE FROZEN P1-29 PREP SET CONTRADICTS THE TREE ON ONE POINT. `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco-worktrees/p1-29-prep/docs/phase-1/phase-1-29/test-and-acceptance-plan.md:274` lists as a trap: "`validate:phase-ownership` defaults to the **wrong** profile, and is invoked by no CI job". The first half is true (`check-phase-ownership.mjs:926`). The second half is FALSE at develop `c081a019`: `_reusable-node-quality.yml:338-359` invokes it, and `check-command-coverage.mjs` registers it `ci-only`, a tier that FAILS if no hosted workflow invokes it. The same prep set's own `blocker-register.md:220` (`INS-49`) does not repeat the claim and describes the gate as live. Reported as documentation drift, not resolved.

### AMB-79 — Ownership / PR

BRANCH-NAME SPELLING FOR THE PRE-P1-29 INTEGRATION BRANCH. Rule 24 pins the full literal `feature/pre-p1-29-multi-tenant-administration-rbac-workflow` (with `administration`), while the documentation directory on this head is `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow` (with `admin`). Since the rule is a full-name pin rather than a prefix, a branch spelled `…-admin-…` would match NO rule and be refused. Which spelling the branch actually carries is not determinable from this checkout — no such remote branch exists here (`git branch -a`).

### AMB-80 — Ownership / PR

"21 required checks" vs "the single required check". `docs/phase-1/phase-1-27/adversarial-round-five.md:377` and `evidence/change-log.md:882` say "21 required checks completed, 0 failed"; `phase-1-28/evidence/closure-evidence.md:664-686` enumerates 21 check-RUNS on a head while calling one of them the single required check. These are two different senses of "required" — check-runs observed on the commit versus contexts the ruleset requires — and the documents do not distinguish them consistently.
