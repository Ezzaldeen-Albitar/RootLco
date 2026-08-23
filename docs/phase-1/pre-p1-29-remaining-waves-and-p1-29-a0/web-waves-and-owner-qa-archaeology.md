# Waves F, G, H and I — the web waves and Owner QA

Read-only archaeology. No implementation, no screen, no route.

## The contradiction to settle before any of this is scheduled

One canonical document states that Superadmin and Company-Owner surfaces are **Owner-deferred**,
while `scope.md` §5 lists waves F and G as delivering exactly those surfaces. Both are on
`develop`. Recorded as `AMB-34`. **Nothing in waves F or G should be scheduled until that is
settled**, because the disagreement is about whether the work is in scope at all.

## The web lane's structural constraint

The web lane **cannot change API source**. That is enforced by the ownership profile, not by
convention, and it is what makes the rule "no screen may ship against a contract that does not
exist" structural rather than aspirational.

## Wave I's two non-negotiables

**A production build.** Never a development server: `next dev` compiles a route bundle on first
request while the API's authenticator is a module-level singleton installed as a side effect, so
one checkout with one valid token answered 200 on one route and 401 on two others, and a second
process refused a different subset. That is measured, not cautionary.

**An explicit written Pass.** Silence is not a Pass.

---

### Administration route tree — scope.md's count verified, not taken on trust

**EXISTS AND LOAD-BEARING.**

scope.md:224-231 and §8 both claim "eleven screens ... twelve `page.tsx` files". Reproduced exactly. The directory contains no other file type — every subdirectory holds exactly one `page.tsx` and nothing else. There is NO `companies`, `branches`, `departments`, `grants` or `memberships` directory, so wave G's and wave H's named deliverables have no existing route. wave-a-discovery.md:294-296's 35/30/4/1 split also reproduces; note (auth) has FIVE directories but only four `page.tsx` — `session-ended` is a Route Handler, not a page, which is consistent with session.ts:36-39.

_Evidence:_ `find "apps/web/src/app/[locale]/(dashboard)/administration" -maxdepth 1 -type d | sort` → 11 subdirectories: approval-limits, audit-log, currencies, languages, numbering-rules, organization, permissions, roles, system-settings, taxes, users. `find ... -name 'page.tsx' | wc -l` → 12. `find "apps/web/src/app/[locale]" -name page.tsx | wc -l` → 35 (dashboard 30, auth 4, design 1).

### G-14 — the two navigation entries naming codes the catalogue does not contain

**EXISTS AND LOAD-BEARING.**

Confirmed by opening the seed, as instructed. The `sal` prefix seeds ten codes (`:60-70`) and neither `sal.invoice.read` nor `sal.delivery.read` is among them; the read-shaped codes are `sal.finance.view` and `sal.delivery.view`, both `risk_level = 'high'`. Because `hasPermission` matches by exact `includes()` (permissions.ts:49), a code nobody can hold hides the entry from every actor permanently and no denial test can notice — exactly as scope.md G-14 states. Two corroborations the register does not cite: the API says so in its own source at `apps/api/src/app/api/v1/invoices/[invoiceId]/outstanding/route.ts:59` ("no `sal.invoice.read` code exists in `iam.permissions` to use"), and the defect was already recorded in P1-22 archaeology at `docs/phase-1/phase-1-22/evidence/archaeology.json:1765` — so this is a known, documented, un-fixed defect roughly seven phases old, not a new discovery. Wave G's D5 assignment is at dependencies.md §3 D5.

_Evidence:_ Wrong codes: `apps/web/src/config/navigation.ts:297` `permission: 'sal.invoice.read'` (key `billing`, group `commerce` at :272) and `:306` `permission: 'sal.delivery.read'` (key `delivery`). Correct seeded codes: `supabase/seeds/04_iam_permission_catalog.sql:66` `('sal.finance.view', 'sal', 'View financial amounts (invoices/receipts/events)', 'high', …)` and `:70` `('sal.delivery.view', 'sal', 'View delivery signatures/receiver evidence', 'high', …)`. Mechanical proof, comm of the two extracted sets: 23 distinct navigation codes, 112 seeded codes, `comm -23` → exactly `sal.delivery.read` and `sal.invoice.read` and nothing else.

### G-14 — why no gate, test or compiler catches it (the mechanism, established from source)

**MISSING.**

Three independent reasons, all structural. (1) `PermissionCode` is an alias for `string`, so the type system cannot distinguish a real code from a typo — the file's own comment at :44-46 says "A permission this client does not recognise is treated as NOT held", which describes the failure rather than preventing it. (2) The only catalogue-membership check over `NAVIGATION` filters to `group.key === 'administration'` and compares against a SEVEN-code set hard-coded in the test, not against the seed file; `billing` and `delivery` live in the `commerce` group (navigation.ts:272) and are therefore outside the assertion entirely. (3) `check-p1-28-access.mjs` rule 2 `code-published` — which refuses "a typo, an invented code and a plausible-but-wrong constant" — is scoped to route pages whose import closure touches `features/appointments|receptions` plus those two feature trees; `apps/web/src/config/navigation.ts` is under `src/config/` and is read only into the source map for import resolution (`:1257 walk(WEB_SRC)`), never into the checked set. The one check that DOES read the seed file, `apps/web/tests/administration.test.ts:37,47-56`, covers only `ADMINISTRATION_PERMISSIONS` from `features/administration/shared/permissions.ts`, not navigation. Any wave-G fix that changes the two strings without adding a check over the whole of `NAVIGATION` leaves the mechanism intact.

_Evidence:_ `apps/web/src/config/navigation.ts:21` `export type PermissionCode = string;`. `apps/web/tests/navigation.test.ts:113` `it('gates every P1-26 entry on a permission that exists in the platform catalogue')`, `:119` `const CATALOGUE = new Set([…7 codes…])`, `:128` `const administration = NAVIGATION.find((group) => group.key === 'administration')`, `:133` the assertion. `scripts/ci/check-p1-28-access.mjs:147-150` `FEATURE_TREES = [features/appointments, features/receptions]`, `:137` `DASHBOARD`, `:1280-1290` `phaseRoutes()`.

### Capability-driven visibility — what it means here, with the decisive lines quoted

**EXISTS AND LOAD-BEARING.**

Capability here means exactly one thing: membership of a permission-code string in the array the server put in `GET /api/v1/auth/session`. There is no role, no tier, no flag. Three failure directions are fixed in code, not by discipline: unknown means denied (`:48`), a `null` requirement means "not gated" and deliberately NOT "holds everything" (`:45-47`), and matching is exact `includes()` (`:49`). `visibleNavigation` filters children only inside an already-visible parent (`:76-80`), so a hidden parent hides its children — the docblock at `:52` states it: "Children do not widen a hidden parent". The default is `NO_CAPABILITIES` at the component boundary (AppShell.tsx:79), so a shell rendered before permissions arrive shows an empty sidebar. Two gates keep it that way: `apps/web/tests/security.test.ts:326-332` reads the module source with comments stripped and refuses the tokens `isAdmin`, `isOwner`, `role ===`, `superuser`, `bypass`; `:335-339` refuses `tenantId|companyId|branchId` in the same file. The coverage baseline pins the file at 95% lines with `minMatchedFiles: 1` (`.github/ci-baselines/coverage-baseline.web.json`, criticalModules `client-permissions`).

_Evidence:_ `apps/web/src/lib/permissions.ts:39` `export const NO_CAPABILITIES: ActorCapabilities = Object.freeze({ permissions: Object.freeze([]) });` · `:47` `if (code === null) return true;` · `:48` `if (!capabilities) return false;` · `:49` `return capabilities.permissions.includes(code);` · `:57` `return hasPermission(capabilities, item.permission);` · `:71-83` `visibleNavigation`, whose `.filter((group) => group.items.length > 0)` at `:82` removes an empty group. Wiring: `apps/web/src/components/shell/AppShell.tsx:12,79,162` and `apps/web/src/app/[locale]/(dashboard)/layout.tsx:50` `capabilities={{ permissions: session.permissions }}`.

### Superadmin / control-plane route or layout in apps/web — absent, searched ten spellings

**MISSING.**

G-15 reproduces exactly, and the only occurrence in the web tier is a rule forbidding the concept. There is no route, no route group, no layout, no feature directory, no navigation entry and no message key for a control-plane surface. `platform administrat*` appears only in three migration `COMMENT ON` strings (org_tenants.sql:113,254; org_subscriptions.sql:307), each of which asserts the capability is NOT granted to application roles — an absence stated, not a presence. Wave F therefore starts from zero in this tier, and `check-web-topology.mjs:29-68` neither requires nor forbids a fourth route group, so a `(platform)` group under `[locale]` is topologically legal today.

_Evidence:_ `grep -rniE "super[ _-]?admin|superuser|super_user|platform[ _-]?admin|control[ _-]?plane|site[ _-]?admin|root[ _-]?admin|operator[ _-]?console|back[ _-]?office|sysadmin|tenant[ _-]?admin" apps/web/src apps/web/tests` → ONE line, `apps/web/tests/security.test.ts:329`, which is the negative assertion forbidding the token `superuser` in permissions.ts. `grep -rniE "super[ _-]?admin" apps/api/src apps/web/src supabase/migrations supabase/seeds | wc -l` → 0. `find apps/web/src/app -type d` → the only route groups are `[locale]/(auth)`, `[locale]/(dashboard)`, `[locale]/(design)`. `find apps/web/src/app -name 'layout.tsx'` → 5 files: `app/layout.tsx`, `[locale]/layout.tsx`, `(auth)/layout.tsx`, `(dashboard)/layout.tsx`, `(design)/layout.tsx`. `ls apps/web/src/features` → administration, appointments, attachments, authentication, crm, receptions, vehicles.

### §7 web-lane ownership constraint and what it structurally enforces for wave H

**EXISTS AND LOAD-BEARING.**

The enforcement is mechanical: a file is classified into exactly one bucket by first match, and a bucket absent from `allowed` is forbidden by default. The consequence scope.md:245-247 names is real — "No screen in wave H may ship against a contract that does not exist — the web lane cannot change API source (§7), which is the structural enforcement of that rule." Concretely: a wave-H branch (`feature/pre-p1-29-web-…`) physically cannot add a route handler, cannot seed the permission its new control would offer, and cannot hand-edit the generated idempotency manifest. So every wave-H screen must render an operation that already exists on `develop` at the time the branch is cut, or wait for the wave C/D/E Backend branch to merge first. The six `webContract` files ARE open to the web lane (it is the one bucket all three profiles may change), which is the only crack — and it contains no component, screen, route, adapter or translation (`:99-104`). One trap worth stating: the initiative profile is bound to the FULL branch name `feature/pre-p1-29-multi-tenant-administration-rbac-workflow` rather than a prefix, deliberately, so it cannot swallow a lane branch (`phase-ownership-profiles.json:125`); a branch named `planning/…` matches no rule at all.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:429-450` — profile `pre-p1-29-web`, `allowed: ['web', 'webContract', 'docs', 'tooling', 'tests', 'rootConfig']`; `forbidden.apiSource` = "the PRE-P1-29 Web lane must not change API source — route it through the Backend lane, so no screen ships against a contract nobody reviewed"; also forbidden: `apiConfig`, `webGenerated`, `migrations`, `dbSeeds`, `supabase`. Buckets at `:37-127` (`webGenerated` `:44-46` = the single file `apps/web/src/lib/api/idempotent-operations.ts`; `webContract` `:105-112` = six literal files; `web` `:103` = everything else under `apps/web/`). Branch mapping at `.github/ci-baselines/phase-ownership-profiles.json:118-119` `"branchPrefix": "feature/pre-p1-29-web-"`. scope.md:302-323 restates the table; scope.md:243-247 states the wave-H consequence.

### Wave I — the production-build requirement and its measured justification

**EXISTS AND LOAD-BEARING.**

This is measured, not cautionary, and the measurement is asymmetric across processes — a second `next dev` refused "a completely different subset", which is what makes the failure impossible to characterise and therefore impossible to work around. The consequence stated at `:531-532`: "An Owner acceptance session on a development stack would therefore have reported product defects that do not exist." The launcher is one implementation serving both modes so the mode cannot be misreported (`:532-536`), and a mode disagreement is terminal rather than adopted. `scripts/dev/start-local.mjs:11` carries the same reasoning in its own header ("Why there is a production mode — the false 401"). For wave I this fixes the environment: `npm run acceptance:serve`, API on 3000 and Web on 3100, never `next dev`.

_Evidence:_ `docs/phase-1/phase-1-28/evidence/change-log.md:517-536`. Verbatim, `:519-523`: "`npm run acceptance:serve` was added, and it is not a convenience. `next dev` compiles a route bundle the first time that route is requested, and the API's authenticator is a module-level singleton installed as a SIDE EFFECT of composing the IAM module inside the login handler — so a bundle compiled without that composition holds the unconfigured authenticator, which fails closed." And `:525-529`: "Measured twice on this checkout, one valid owner token, one process: `GET /api/v1/receptions` answered 200 while `GET /api/v1/vehicles` and `GET /api/v1/work-orders` answered 401 `ERR-IAM-002`, and a second `next dev` process refused a completely different subset. On a production `next build` plus `next start` of the same tree, every one answered 200." Terminal verdict at `:534` `REFUSE_MODE_MISMATCH`. Command wiring: `package.json:17` `"acceptance:serve": "node scripts/dev/start-local.mjs --production"`. scope.md:249-259 restates it and cites `change-log.md:517-536`.

### Wave I — the explicit-written-Pass rule

**EXISTS AND LOAD-BEARING.**

The rule has two halves and both are load-bearing. First, the closing verdict is a literal string the Owner returns — `OWNER ACCEPTANCE: PASS` — and nothing computed in the repository can produce it. Second, silence is not that string; the P1-26 precedent recorded in memory is that the Owner was asked four times and answered once. There is a documented negative precedent for treating derived evidence as acceptance: P1-26 was closed once on five unproven claims and reopened, and P1-27 recorded three `OWNER ACCEPTANCE: FAIL` cycles. Wave I therefore has exactly one exit event, and it is external to CI.

_Evidence:_ `docs/phase-1/phase-1-28/closure-record.md:44-45`, verbatim: "**Silence was never treated as Pass.** The verdict is the Owner's act; no count in this repository derived it and none could have." Context at `:40-42`: "On 2026-08-20 the Product Owner returned, verbatim:" followed by the fenced `OWNER ACCEPTANCE: PASS`. Environment recorded at `:34-40` — a production build of protected `develop` itself, `next build` then `next start`, API on `localhost:3000`, Web on `localhost:3100`, real S3-compatible store, rate limiter active and observed refusing (ten 401s then 429). scope.md:257-259 restates it and cites `closure-record.md:44`.

### P-1 is already violated by two SHIPPED screens, and the copy admits it

**EXISTS AND LOAD-BEARING.**

wave-a-discovery.md:302-316 names this "the finding that matters most in this tier" and it reproduces exactly. The inversion is the sharp part: an EMPTY `companyIds`/`branchIds` array means unrestricted within the tenant (session.ts:11-18, `isUnrestrictedScope` at `:62-63`), so the operator with the MOST organisational authority — the Company Owner — is the one the product asks to type an identifier by hand. That is a direct P-1 breach on a screen that ships today, in four page mount points. P-1 (scope.md:190-197) assigns the remedy's contract half to wave C ("Making one buildable is wave C's obligation, not the web lane's"), and D4 (dependencies.md §3) assigns the selector itself to `pre-p1-29-web`. Which wave replaces these two existing controls is not stated — see ambiguities.

_Evidence:_ `apps/web/src/features/administration/organization/components/SettingsEditor.tsx:107` `{scopeIds.length > 0 ? (` · `:108-113` a `SelectField` whose `options={scopeIds.map((id) => ({ value: id, label: id }))}` and whose description is `t('admin.contractGap.noDirectory')` · `:116-121` the ELSE branch, a free-text `TextField` described by `t('admin.scope.noneResolved')`. Copy at `apps/web/src/i18n/messages/en.json:11` "The service publishes no company or branch directory, so references are shown rather than names." and `:32` "Your session resolves to no specific company or branch, so enter the reference you want to work on." Second instance: `apps/web/src/features/administration/access/components/ApprovalLimitsScreen.tsx:329` `options={companyIds.map((id) => ({ value: id, label: id }))}`. Consumers: `administration/organization/page.tsx:69,81`, `administration/system-settings/page.tsx:82,94`.

### `org.tax.manage` — zero screen consumers, and two of G-4's three citations are comments

**EXISTS BUT NOT USED.**

scope.md G-4 records `org.tax.manage` as having "three [references] in the web tree" citing permissions.ts:46, navigation.ts:473 and administration/page.tsx:73. Two of those three are prose inside `//` comments explaining why the code is NOT used (P1-26-F-029 moved the taxes screen to `org.settings.manage`, navigation.ts:475 and administration/page.tsx:75). The only live reference is the constant at permissions.ts:46, and it has zero consumers — `PERMISSIONS.taxManage` is never read. This is the repository's recurring "a scanner read prose as code" class, applied to its own gap register. It also has a wave-I consequence the register does not carry: `scripts/dev/owner-acceptance/context.mjs:161` GRANTS `org.tax.manage` to the Owner-acceptance role, so the acceptance account holds a permission no screen consults and no operation requires.

_Evidence:_ `grep -rn "org\.tax\.manage" apps/web/src apps/api/src scripts supabase` → exactly five hits: `apps/web/src/app/[locale]/(dashboard)/administration/page.tsx:73` (a `//` comment), `apps/web/src/config/navigation.ts:473` (a `//` comment), `apps/web/src/features/administration/shared/permissions.ts:46` `taxManage: 'org.tax.manage',`, `scripts/dev/owner-acceptance/context.mjs:161`, `supabase/seeds/04_iam_permission_catalog.sql:23`. `grep -rn "PERMISSIONS.taxManage\|taxManage" apps/web/src apps/web/tests` → ONE hit, the declaration itself.

### The plain-language gate bans the word "tenant" from every user-visible string

**EXISTS AND LOAD-BEARING.**

This is the single hardest non-obvious constraint on wave F, whose entire subject matter is tenants. The gate reads values only (`inspect()` at `:121-133` iterates `Object.entries(catalogue)` and tests `String(raw)`), so keys are safe, and the product has already settled on "Workspace" as the user-facing word. Every wave F and wave G label, description, empty state and error must therefore be written in workshop vocabulary before it can pass CI: no "tenant", no permission code, no snake_case or camelCase identifier, no UUID, no "API". The `permission-code` rule is the one that interacts with PRE29-AD-05 (architecture-decisions.md:336-390): the role editor may keep the canonical code visible because the code arrives as API DATA at runtime, but a help message in the catalogue naming a code is a build failure.

_Evidence:_ `scripts/ci/check-plain-language.mjs:80` `{ id: 'tenant', pattern: /\btenants?\b/i, what: 'a platform-internal word' }`. Subject at `:43-46` — every VALUE in `apps/web/src/i18n/messages/{en,ar}.json`. No exemptions, stated at `:24-28`. Adjacent bans that also bite: `:81-86` `permission-code` (`/\b(crm|veh|iam|org|apt|rec|wo|dia|tech|qms|svc|quo|inv|sal|wty|rpt|shared)\.[a-z_]+\.[a-z_]+\b/`), `:87-92` `operation-id`, `:93-99` `internal-identifier` (snake_case), `:100-110` `camel-identifier`, `:66` `uuid`, `:60` `null`. Current state: `grep -i "tenant" apps/web/src/i18n/messages/en.json` matches five lines and every one is a KEY whose VALUE is "Workspace" (`:35`, `:722`, `:723`, `:789`, `:860`); `grep -ic "workspace"` → 24.

### `features/administration` is outside every Frontend quality-gate scan root

**MISSING.**

The rule's line, quoted from `:585-586`: "**never place a scope into a request**" — a scope name is legal ONLY as a property read off an object outside any string (`session.tenantId` passes because `before.endsWith('.')` at `:626`), and every other position is an assertion. Note `session.companyIds` is safe by accident: `\bcompanyId\b` does not match inside `companyIds` because `s` is a word character. The administration tree is scanned by none of this gate's eighteen rules, which is why the two P-1 violations above and the `companyFilterQuery` assertion have never been reported. Wave G has a real fork: put the named selector inside `(dashboard)` (a `PLAN_ROOT`) and it is judged by rule 3; leave it in `features/administration` and it inherits the hole. Adopting a new root has a documented cascade — `ADOPTED_ROOTS` entries carry an `authority`, and `tests/ci/p1-28-devops-gate.test.ts:343-353` filters the equality by `entry.authority === P1_28_PLAN`, so a PRE-P1-29 entry with its own authority does NOT break that test; but `scripts/ci/check-p1-27-doc-counts.mjs:449` derives `p1-27-frontend-gate:trees = SCAN_ROOTS.length`, and FOUR P1-27 documents carry the marker `= 5` (`deliverable-manifest.md:986`, `open-decisions.md:1205`, `owner-acceptance-fail-remediation.md:198`, `risk-register.md:581`). Adding one root forces four documentation edits in the same commit, plus a `MODULE_DISPOSITION` decision for every directory the new tree imports.

_Evidence:_ `scripts/ci/check-p1-27-frontend.mjs` `PLAN_ROOTS` = `features/crm`, `features/vehicles`, `app/[locale]/(dashboard)`; `ADOPTED_ROOTS` (`:178`, `:183`) = `features/appointments`, `features/receptions`; `SCAN_ROOTS = [...PLAN_ROOTS, ...ADOPTED_ROOTS.map(e => e.root)]` at `:190`. Rule 3 `no-client-asserted-scope` (`:971` `detect: (source) => assertedScopes(source).length > 0`), with `assertedScopes` at `:609-630` and `SCOPE_NAMES` at `:482-489` = `tenantId, companyId, branchId, tenant_id, company_id, branch_id`. Unscanned violations today: `apps/web/src/features/administration/access/api.ts:154` `const companyId = request.filters.find(...)` and `:161` `'/api/v1/iam/approval-limits' + companyFilterQuery({ companyId })`; `apps/web/src/features/administration/access/actions.ts:123,146,163`.

### The grant surface is unreachable from the web; role attachment happens only at invitation

**MISSING CONTRACT.**

Five grant operations ship — `iam.grant-issue`, `iam.grant-revoke`, `iam.grant-scope-list`, `iam.grant-scope-add`, `iam.grant-scope-remove` — and the web tier calls none of them. There is also no `GET /iam/grants` listing operation anywhere (the ids under `apps/api/src/app/api/v1/iam/grants/**` are exactly issue, revoke, scope-list, scope-add, scope-remove), so grant identifiers reach a client only through `iam.user-detail`, which returns them at `apps/api/src/modules/iam/application/user-administration-service.ts:109-122` as `{id, roleId, scopeMode, status, validFrom, validTo}` — a `roleId` with no name. Consequence for wave H: role EDITING already exists end to end (six actions, two screens), but granting a role to an EXISTING user, revoking one, and scoping one to a company/branch/department have no web surface at all, and the only shipped path attaches roles unscoped at invitation time under `iam.user.manage` rather than `iam.grant.manage`.

_Evidence:_ `grep -rn "iam/grants|grant-issue|grantManage" apps/web/src` → hits only in `features/administration/shared/permissions.ts:15,17,37` (a comment and the unused constant `grantManage: 'iam.grant.manage'`) and in the GENERATED manifest `apps/web/src/lib/api/idempotent-operations.ts:699,706,713,720,727`. Zero server actions call any grant operation: `apps/web/src/features/administration/access/actions.ts` exports `createRoleAction`, `updateRoleAction`, `addRolePermissionAction`, `removeRolePermissionAction`, `createApprovalLimitAction`, `endApprovalLimitAction` (lines 44, 64, 84, 104, 140, 177) and nothing else. The only role-attachment path: `apps/api/src/app/api/v1/iam/invitations/route.ts:26-32` `InviteBody` accepts `roleIds`, the operation at `:34-47` requires `permissions: ['iam.user.manage']`, and `apps/api/src/modules/iam/application/invitation-service.ts:165-168` calls `this.authorization.insertGrant(...)` for each. Web caller: `features/administration/users/actions.ts:48 inviteUserAction`, role picker from `features/administration/users/api.ts:172 listGrantableRoles`.

### The session contract structurally refuses a tenant-less principal

**MISSING CONTRACT.**

Three separate mechanisms each independently block a control-plane operator from rendering any page in this application today. The session operation is declared `scope: 'tenant'` and requires `iam.user.read`, a tenant permission; the web's shape check demands a string `tenantId`; and the dashboard layout redirects on anything else. So wave F cannot merely add a route group — either wave B/D publishes a session (or a second describe-self operation) that a tenant-less principal can call, or wave F needs its own layout with its own session reader that does not go through `requireSession`. Nothing in the four PRE-P1-29 documents on `develop` states which. Note the recorded lockout precedent: treating the 403 as an expired session produced an unbreakable sign-in loop, P1-26-F-022 (`session.ts:57-75`), so the 'forbidden' path must not be reused casually.

_Evidence:_ `apps/api/src/app/api/v1/auth/session/route.ts:25-35` — `id: 'iam.auth-session'`, `permissions: ['iam.user.read']`, `scope: 'tenant'`. `apps/web/src/features/authentication/types/session.ts:20-28` — `SessionSummary` declares `readonly tenantId: string` (non-optional). `apps/web/src/features/authentication/api/session.ts:119-131` `isSessionShape` requires `typeof candidate.tenantId === 'string'`; a response failing it returns `problem: 'unavailable'` (`:44-46`). `:73-75` a 403 returns `problem: 'forbidden'`; `requireSession` at `:101-108` redirects every non-ok state to `/login`. `apps/web/src/app/[locale]/(dashboard)/layout.tsx:43,50` calls `requireSession` before any child renders.

### Departments — zero occurrences in the entire web tree

**MISSING.**

Sharper than G-6, which says only that no operation creates, lists or updates a department. The web tier has never heard the word — not a route, not a component, not a message key, not a test. Wave G's department administration and wave H's grant scoping to a department are both greenfield in this tier. One asymmetry worth recording for wave H: the grant-scope-add contract ALREADY accepts `scopeType: 'department'` and a `departmentId`, so a scoping UI could technically post one today, while no operation exists that would return the list of departments to choose from — the exact "schema supports it / no HTTP operation exposes it" split. scope.md:295-299 authorises department administration as "organisational structure and authority" but forbids department ROUTING of work.

_Evidence:_ `grep -rniI "department" apps/web/src apps/web/tests | wc -l` → 0. Schema side: table created at `supabase/migrations/20260717104000_org_operational_structure.sql:109`; grant scope may name one at `supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:125`; the grant scope input already accepts it — `apps/api/src/app/api/v1/iam/grants/route.ts:31` `scopeType: z.enum(['company', 'branch', 'department'])` with `departmentId` at `:34`.

### Web-tier test and coverage baselines that bound every wave F/G/H change

**EXISTS AND LOAD-BEARING.**

Four consequences for the web waves. (1) Any wave that adds tests must RAISE `minTests` in the same commit, inside the window WTF-08/WTF-09 bound. (2) `touchedFileMinimum: 60` applies to every touched file except those under `apps/web/src/app/`, so a new component or adapter under `features/` or `lib/` must arrive with ≥60% line coverage or the PR is refused. (3) The route-tier exemption exists because `(dashboard)` sits at 7.62% line coverage (162/2125 across 26 files, `knownGaps.dashboard-routes-unrendered`) — so a new wave-F/G page under `src/app/` is exempt from the touched-file floor but drags its zeros into the global denominator, and `coverage.all` is true so the file joins the denominator whether a test imports it or not. (4) `coverage-gate.mjs` refuses any criticalModules rule whose prefix matches nothing, and `minMatchedFiles` pins the file count, so moving or renaming `lib/permissions.ts` turns the gate red rather than turning the rule off.

_Evidence:_ `.github/ci-baselines/test-count-baseline.json`, tier `web`: `"minTests": 2500`, `"measured": 2581`, `"measuredFiles": 98`, provenance LOCAL not hosted. Constraints named in the same field: `WTF-08` refuses a floor beneath cases that physically exist (the tier declares 2087 across 98 files); `WTF-09` refuses headroom wider than the largest file (`api-client.test.ts` declares 84). `.github/ci-baselines/coverage-baseline.web.json`: global floors lines/statements 78.45, functions 85.42, branches 85.50, `tolerancePercentagePoints: 0.5`; `touchedFileMinimum: 60` with `touchedFileExemptPrefixes: ["apps/web/src/app/"]`; criticalModules include `client-permissions` (`apps/web/src/lib/permissions.ts`, lines ≥ 95, `minMatchedFiles: 1`) and `api-client` (`apps/web/src/lib/api`, ≥ 92, 6 files). Current tree: `ls apps/web/tests | wc -l` → 106 entries.

### The authenticated browser tier hard-codes the eleven administration screens

**EXISTS AND LOAD-BEARING.**

This is the tier that proves a screen actually reaches the API rather than rendering from a fixture — the gap P1-26 named and P1-26-F-015 cost. Every screen wave G adds must be appended here, and the literal word "eleven" in two places becomes wrong the moment one is. `isolation.spec.ts:20-25` also hard-codes Tenant B's identifiers from `scripts/dev/owner-acceptance/context.mjs`, which is the existing cross-tenant proof wave F's separation claim would extend. `verify:web` (package.json:145) chains typecheck, lint, stylelint, format, unit, token/theme/brand validators, `validate:web-boundary`, `validate:p1-27-frontend`, `build:web` and `test:web-e2e` — that is the local command a web-lane wave must pass before pushing.

_Evidence:_ `apps/web/tests/e2e/authenticated/administration.spec.ts:4` "The eleven Administration screens, signed in, against the real API."; `:14-26` the `SCREENS` array of exactly eleven `{slug, heading, api}` entries; `:49` `test.describe('the eleven administration screens', …)`; each case asserts `response.status() < 400`, a clean console, and at least one request to the API origin (`:29-45`). Sibling specs: `accessibility.spec.ts`, `appointments-and-receptions.spec.ts`, `auth.setup.ts`, `crm-and-vehicles.spec.ts`, `drawer-and-restore.spec.ts`, `isolation.spec.ts`, `shared-ux.spec.ts`, plus anonymous `shared-ux-anonymous.spec.ts` and `foundation.spec.ts`.

### F / CURRENT STATE

**MISSING.**

Nothing exists. No route, layout, feature directory, navigation entry, message key, permission constant or test names a control-plane surface in the web tier, and the three shipped session mechanisms each refuse a tenant-less principal. The Backend half is not on `develop` either: B1 is implemented on the unmerged `feature/pre-p1-29-backend-b1-platform-authority-foundation` and frozen behind an external provider blocker, so this worktree cannot read what capability B1 publishes. Wave F is 100% greenfield in this lane and is the wave with the deepest upstream dependency.

_Evidence:_ Ten-spelling grep over `apps/web/src` + `apps/web/tests` → 1 hit, a negative assertion (security.test.ts:329). Route groups: `(auth)`, `(dashboard)`, `(design)` only. `apps/api/src/app/api/v1/auth/session/route.ts:31` `scope: 'tenant'`. `apps/web/src/features/authentication/api/session.ts:119-131`. scope.md:233-237.

### F / TARGET STATE

**UNKNOWN.**

The document states four properties and no shape. Properties: (a) visibly and structurally separate from tenant administration; (b) a Company Owner cannot reach it; (c) a control-plane operator does not silently hold a tenant role; (d) visibility is capability-driven and the capability is Backend-resolved. What is NOT stated anywhere I could read: whether it is a route group in this Next application or a separate deployment; how the capability reaches the browser given that `session.permissions` is a tenant-permission array and P-5 forbids a wildcard permission; whether the operator signs in through the same login form; which screens it holds. scope.md §5 wave B says wave B produces "the operations by which it creates a first tenant, its first legal company, its first branch, its first Company Owner and that owner's initial role and grant set" — those are the operations wave F must render, and their contracts are not on `develop`.

_Evidence:_ scope.md:233-237 verbatim: "The control-plane surface. It must be visibly and structurally separate from tenant administration: a Company Owner must not be able to reach it, and a control-plane operator must not silently be holding a tenant role. Visibility is driven by capability, per P-4, and the capability comes from the Backend." Supporting: architecture-decisions.md PRE29-AD-03 (`:179-247`), scope.md P-6 (`:124-134`).

### F / GAP

**MISSING CONTRACT.**

Five distinct gaps, in dependency order. (1) No control-plane principal exists in any tier. (2) No cross-tenant read exists — `iam.tenant-settings-read` returns the CALLER'S tenant, so there is no operation that could populate a tenant list for an operator to act on. (3) The session contract cannot describe a tenant-less actor. (4) There is no capability channel: `ActorCapabilities` is a permission-code array and P-5 forbids the wildcard that a "holds everything" operator would need, so what a control-plane capability looks like on the wire is undecided. (5) The vocabulary the surface needs is banned from the message catalogue. Every one of these except (5) is upstream of the web lane and unfixable inside it (§7).

_Evidence:_ Session: `auth/session/route.ts:25-35` (`scope: 'tenant'`, `permissions: ['iam.user.read']`); `session.ts:119-131` requires string `tenantId`; `(dashboard)/layout.tsx:43` `requireSession`. Copy: `check-plain-language.mjs:80` bans `/\btenants?\b/i` in every message value. Principal: `grep -rniE "super[ _-]?admin" apps/api/src apps/web/src supabase/migrations supabase/seeds | wc -l` → 0. Organisation reads: `grep -rn "id: '(iam|org)" apps/api/src` → 38 iam operations, zero `org.*` operation ids; the only tenant read is `iam.tenant-settings-read` at `org/tenant/route.ts:36`, which resolves its tenant from the session and returns one row.

### F / IMPLEMENTATION SURFACE

**AVAILABLE BUT NEEDS ADAPTER.**

If wave F is a route group in this application, the smallest honest shape is: a new `[locale]/(platform)/` group with its own `layout.tsx` and its own session reader (NOT `requireSession`, which redirects a tenant-less actor), a new `apps/web/src/features/platform/` feature tree, and either a second navigation model or a `NAVIGATION`-shaped constant the platform shell filters with the same `visibleNavigation`. The topology gate permits this; the ownership profile permits it (`web` bucket); the plain-language gate constrains the copy. What is NOT available: any adapter, because there is no operation to adapt. A second, structurally separate application is also permitted by the topology gate's silence, but `FORBIDDEN_PREFIXES` includes `apps/web/app/`, `apps/web/src/pages/` and `web/`, so a second router root inside `apps/web` is refused — a separate workspace would be `rootConfig`/new-directory territory and is not covered by any PRE-P1-29 profile.

_Evidence:_ `scripts/ci/check-web-topology.mjs:29-40` `REQUIRED_PREFIXES` and `:53-68` `FORBIDDEN_PREFIXES` — neither requires nor forbids a fourth route group under `apps/web/src/app/[locale]/`. Existing group precedent: `apps/web/src/app/[locale]/(auth)/layout.tsx`, `(design)/layout.tsx`. Shell: `apps/web/src/components/shell/AppShell.tsx:58-72` `AppShellProps` takes `capabilities`, `account`, `secondaryPanel`. Navigation model: `apps/web/src/config/navigation.ts:105` `export const NAVIGATION` — one frozen array, no second model.

### F / SECURITY MODEL

**AMBIGUOUS IN DOCS.**

The invariants are unambiguous; the mechanism is not. Whatever wave F renders, the browser may not assert control-plane status — it may only display a capability the server resolved. Two concrete refusals follow from the SHIPPED gate rather than from prose: `permissions.ts` may not gain the token `superuser`, and it may not read a tenant, company or branch identifier. So a control-plane capability cannot be expressed as a flag in that module; it must be either a permission code in the existing array (which P-5's no-wildcard rule constrains but does not forbid — a narrow code like a hypothetical platform-scoped code is not a wildcard) or a separate server-resolved value carried outside `ActorCapabilities`. Which of the two is intended is not decided in any document on `develop`.

_Evidence:_ scope.md P-4 (`:198-204`): "Hiding a menu item is a usability act. The server's denial is the only denial that means anything… no screen added by this initiative may introduce a client-side administrator flag, a role-name test, or a tenant identifier read from client state." Enforcement: `apps/web/tests/security.test.ts:326-332` refuses the tokens `isAdmin`, `isOwner`, `role ===`, `superuser`, `bypass` inside `apps/web/src/lib/permissions.ts`; `:335-339` refuses `tenantId|companyId|branchId` in the same file. scope.md P-5 (`:117-123`): no wildcard permission and none may be introduced. scope.md P-6 (`:124-134`): the bootstrap principal is not a Company Owner with extra permissions, not the first user, not a hard-coded email or domain, not a client-side flag, not a code path that disables containment.

### F / TEST PLAN

**AVAILABLE.**

Five tiers, all with existing precedent. (1) A permission-route-binding suite over every wave-F page, invoked with a synthesised control-plane session and with an ordinary Company-Owner session, asserting the pairing in both directions — the Owner case must render nothing. (2) A negative reachability case: a Company-Owner session hitting a wave-F route must not render it, asserted at the ROUTE, not at a component prop. (3) `i18n.test.ts` parity is automatic once keys are added to both catalogues; the plain-language gate must be run locally because the vocabulary is the hard part. (4) An authenticated browser spec in the `isolation.spec.ts` shape, proving separation against the running API rather than against a fixture. (5) `minTests` must be raised in the same commit. One caution recorded in the coverage baseline: `runtimeNote` says v8 instrumentation makes `record-form-consumers.dom.test.tsx:425` flake under `--coverage`.

_Evidence:_ Precedents to clone: `apps/web/tests/p1-28-permission-route-binding.test.ts:32-42` — the route module is INVOKED with a synthesised session and the returned element tree is walked for capability props, asserted as a PAIRING in both directions ("A one-directional test passes against `canEdit={true}`, which is the defect that shipped ten open write forms"). `apps/web/tests/e2e/authenticated/isolation.spec.ts:6-18` — cross-tenant isolation against a real signed-in session. `apps/web/tests/security.test.ts:317-340`. `apps/web/tests/i18n.test.ts:72` key parity, `:79` no empty message, `:91-110` no untranslated Arabic. Gate: `scripts/ci/check-plain-language.mjs`.

### F / DEPENDENCIES

**MISSING.**

Wave F is downstream of essentially all of wave B, plus wave D. Specifically it needs: B3 (the platform request context) to know what a control-plane request is; B4 (organisation read contract) to have anything to list; B5 (lifecycle) and B6/B7 (provisioning and first-Owner bootstrap) to have anything to do; B9 (published contract) to have adapters; and wave D to resolve a session for a principal that is not in a tenant. B1 is implemented but unmerged and frozen behind an external provider blocker; B2..B9 I cannot confirm from this worktree. Wave B's design explicitly decides nothing about the web tier, so wave F's contract inputs do not exist even in design form on `develop`. Practical consequence: wave F is the LAST of the three web waves that can start, and it cannot start on the strength of scope.md alone.

_Evidence:_ scope.md:118-119 "A wave may not begin while an input it needs is still a question." Wave B slices at wave-b-control-plane-design-v2.md:948-967 (B1 role/relation/resolver, B3 platform request context, B4 organisation read contract, B5 lifecycle, B6 provisioning path, B7 first-Owner bootstrap, B9 published contract and security proofs). Gate at `:998-1004`: `CONFIRMED CRITICAL = 0`, `CONFIRMED HIGH = 0` over revision 4. `:965` "Separate pull requests where the review boundary justifies it. **No web tier.** No work-order domain." `:32` "This document decides nothing about Phase 1-29, and nothing about the web tier."

### F / EXIT CRITERIA

**UNKNOWN.**

Mechanically: green `verify:web`; `minTests` raised in the same commit; touched-file coverage ≥60% on every non-`src/app/` file added; global coverage not below the floors; plain-language clean; en/ar key parity; the authenticated browser spec extended and passing against a production build. Substantively, and this is the part I cannot pin down: wave F's exit must include a demonstrated negative — a Company-Owner session cannot reach the surface — and a demonstrated positive, which requires a control-plane operator to exist in the acceptance environment. Creating one is wave B's B7 slice, which is frozen. Whether wave F may close on the negative alone is not decided anywhere.

_Evidence:_ Ownership: branch must match `feature/pre-p1-29-web-` (`phase-ownership-profiles.json:118-119`) and touch only `web`, `webContract`, `docs`, `tooling`, `tests`, `rootConfig` (`check-phase-ownership.mjs:429-450`). Local chain: `package.json:145` `verify:web`. Floors: `test-count-baseline.json` tier `web` `minTests`, `coverage-baseline.web.json` global + `touchedFileMinimum: 60`. Copy gate: `check-plain-language.mjs`. Acceptance: `closure-record.md:44`.

### G / CURRENT STATE

**EXISTS AND LOAD-BEARING.**

The tenant administration surface is mature and real: users (invite, cancel, activate, status, revoke sessions), roles (create, update), role-permissions (add, remove), approval limits (create, end), tenant settings, branch status, and an audit log. It has an index page with three sections (`administration/page.tsx:36-95`). What it does NOT have: any company, branch, department, grant or membership screen, and any human-readable organisational selector — the two scope selectors it does have render raw identifiers as their own labels (`SettingsEditor.tsx:113`, `ApprovalLimitsScreen.tsx:329`) or fall back to a free-text field (`SettingsEditor.tsx:116-121`).

_Evidence:_ 11 subdirectories + index = 12 `page.tsx` (measured). Feature tree: `find apps/web/src/features/administration -type f` → 23 files across `access/`, `audit/`, `organization/`, `shared/`, `users/`. Permission map: `features/administration/shared/permissions.ts:32-47`, 14 codes, all seeded, asserted by `apps/web/tests/administration.test.ts:47-56`. Server actions: `access/actions.ts` 6 exports, `users/actions.ts` 5, `organization/actions.ts` 3. Page-level gates: `holds(session.permissions, PERMISSIONS.x)` in users/roles/permissions/approval-limits/audit-log/organization/system-settings/languages; currencies, numbering-rules and taxes gate only inside `SettingsBackedScreen`.

### G / TARGET STATE

**AVAILABLE.**

Three deliverables, precisely stated. (1) Company, branch and department administration screens inside a tenant — creating, naming, listing, and scoping a grant to a department (scope.md:295-299 authorises this as "organisational structure and authority" but forbids department ROUTING of work). (2) The named selectors P-1 requires, built on wave C's reach-scoped by-name reads: a human chooses from a named list of what they may reach, never what exists, and never types an identifier. (3) G-14: `sal.invoice.read` → `sal.finance.view` and `sal.delivery.read` → `sal.delivery.view`. Note (3) is a two-character-per-line change whose correctness is trivial and whose value is zero unless a check is added that would have caught it.

_Evidence:_ scope.md:239-243 verbatim: "The tenant administration tree already exists — eleven screens… Wave G extends it with company, branch and department administration, and builds the named selectors P-1 requires on top of the wave C reads. Wave G also fixes G-14. The two navigation entries name codes the catalogue does not contain, which makes them invisible to everyone, permanently and silently. The correct codes are seeded and spelled differently." dependencies.md §3 D4 and D5. P-1 at scope.md:184-197.

### G / GAP

**MISSING CONTRACT.**

The gap is a contract gap, not a screen gap, and the product already says so in shipped copy: `apps/web/src/i18n/messages/en.json:11` "The service publishes no company or branch directory, so references are shown rather than names." A named selector is not buildable today because no operation returns a name — that is P-1's own statement (scope.md:194-197) and it assigns the remedy to wave C. The distinction that matters here and has produced defects in this repository: `org.company.manage`, `org.branch.manage`, `org.department.manage` and `org.subscription.manage` EXIST in the schema's permission catalogue; no HTTP operation declares any of them. Wave G may not seed a permission or carry a migration (`check-phase-ownership.mjs:441-447`), so it cannot close this gap from its own lane.

_Evidence:_ Zero `org.*` operation ids exist: `grep -rn "id: '(iam|org)" apps/api/src` returns 38 `iam.*` ids and none beginning `org.`. The complete organisational read/write set is the six settings operations (`org/tenant/route.ts:36,49`; `org/companies/[companyId]/settings/route.ts:37,50`; `org/branches/[branchId]/settings/route.ts:33,46`) plus `shared.branch-status-read`/`shared.branch-status-change` (`organization/branches/[branchId]/status/route.ts:34,47`), and every one is addressed by an identifier the caller must already hold. No operation contains `department` in its path. Five seeded permissions guard nothing: `supabase/seeds/04_iam_permission_catalog.sql:18,20,21,23,24`.

### G / IMPLEMENTATION SURFACE

**AVAILABLE.**

Every new wave-G screen has an exact template to follow, and five registration points that must all be updated together or the screen is unreachable/invisible: (1) the `page.tsx`; (2) a `SECTIONS` entry in `administration/page.tsx`; (3) a `NAVIGATION` child entry under the `administration` group; (4) en.json + ar.json keys; (5) the eleven-screen array in `e2e/authenticated/administration.spec.ts:14-26`. The two selectors to replace are `SettingsEditor.tsx:107-123` and `ApprovalLimitsScreen.tsx:321-331`. One decision wave G must take deliberately: whether the new code lives in `features/administration` (outside every Frontend gate scan root) or is placed so the `no-client-asserted-scope` rule judges it.

_Evidence:_ Route pattern: one `page.tsx` per subdirectory under `apps/web/src/app/[locale]/(dashboard)/administration/`, each calling `requireSession(locale)` then `holds(session.permissions, PERMISSIONS.x)` and returning a denial before its first read (e.g. `users/page.tsx:30,35`; `roles/page.tsx:25,34`). Feature pattern: `features/administration/<area>/{api.ts, actions.ts, types.ts, components/*.tsx}`. Shared: `shared/permissions.ts`, `shared/api.ts`, `shared/use-server-table.ts`, `shared/components/ScreenStates.tsx`. Index registration: `administration/page.tsx:32-95` `SECTIONS`. Navigation registration: `navigation.ts:346-511`, group `administration`.

### G / SECURITY MODEL

**EXISTS AND LOAD-BEARING.**

Four rules bind wave G. (1) Every route denies and returns on its permission BEFORE its first awaited read — the pattern every existing administration page follows. (2) The code a screen consults must be a subset of what its operations require; the taxes screen is the recorded counter-example, gated on `org.tax.manage` which no operation it calls requires, corrected to `org.settings.manage` as P1-26-F-029 (`navigation.ts:470-475`, `administration/page.tsx:71-75`). (3) The selector must offer only what the actor may REACH, not what exists — leaking the existence of an unreachable company is the failure P-1 names. (4) Visibility is not authorization: the server denies, and the selector's contents come from the server, so a tampered selection is refused server-side. Wave G's fix to G-14 is a visibility fix with zero authorization effect — worth stating so it is not mis-sold as a security fix.

_Evidence:_ P-4 at scope.md:198-204. Gate-before-read shape, enforced for P1-28 routes at `scripts/ci/check-p1-28-access.mjs:26-46` rule 1 `gate-before-read`, found "by SHAPE (a negated `holds` whose branch returns)" rather than by `indexOf('holds(')` after both halves of the earlier measurement were shown wrong. Rule 4 `least-privilege` at `:57-60`: "per route, the codes it consults are a SUBSET of the codes required by the operations reachable from it." Rule 3 `contract-covers-domain` at `:53-56`. P-1 at scope.md:184-197. `check-p1-27-frontend.mjs:585-586` "never place a scope into a request."

### G / TEST PLAN

**AVAILABLE.**

Five obligations. (1) The G-14 fix must ship with a check whose subject is the WHOLE of `NAVIGATION` against the seed FILE, not against a hard-coded set and not scoped to one group — the existing check at `navigation.test.ts:113-134` is the reason the defect survived, and correcting two strings without correcting the check leaves the next drift equally invisible. The cheapest honest form is the `administration.test.ts:47-56` shape applied to every code returned by flattening `NAVIGATION`, with a negative control. (2) A route-binding suite over each new screen, asserted as a pairing in both directions. (3) A selector test proving the list is server-supplied and contains no identifier the actor cannot reach. (4) The browser spec extended past eleven. (5) en/ar keys plus plain-language clean — note "tenant" is banned, and the product word is "Workspace".

_Evidence:_ Catalogue-drift precedent: `apps/web/tests/administration.test.ts:37,47-56` reads the seed file and asserts every `ADMINISTRATION_PERMISSIONS` code appears in it, plus `:58` a negative control ("fails for a code that is not in the catalogue"). Route-binding precedent: `apps/web/tests/route-permission-binding.test.ts:37-40` and `p1-28-permission-route-binding.test.ts:32-42`. Browser precedent: `e2e/authenticated/administration.spec.ts:49-60`. Gate precedent: `check-p1-28-access.mjs` rule 2 `code-published`, scoped at `:147-150`.

### G / DEPENDENCIES

**MISSING CONTRACT.**

Split cleanly in two. The G-14 fix (D5) depends on NOTHING — both correct codes are already seeded at seed lines 66 and 70, so it is shippable from a `feature/pre-p1-29-web-` branch today and is the one wave-G deliverable that is not blocked. Everything else depends on wave C: the by-name reach read, the company/branch/department create-and-list operations, and any new permission code, all of which the web lane is forbidden from authoring. Wave C in turn is the wave that decides whether the five dead `org.*` codes are re-scoped or joined by new ones (architecture-decisions.md PRE29-AD-04 at `:248-335`), which determines what wave G's screens gate on. Sequencing follows directly: wave C's operation list must exist before wave G's screen list can be written.

_Evidence:_ scope.md:216-222 wave C: "Wave C also owes P-1 its input: an operation that returns the companies and branches an actor may reach, **by name**… Any permission a wave C operation needs is seeded by wave C, in the seeds bucket, and moves the baseline count of G-2 in the same change." Baseline: `.github/ci-baselines/schema-baseline.json:14` `"permissionCount": 112`, enforced at `scripts/ci/migration-replay-checks.mjs:238-240`. Web-lane prohibition: `check-phase-ownership.mjs:441-447`.

### G / EXIT CRITERIA

**AVAILABLE.**

For G-14 specifically, an honest exit is: the two codes corrected; a check over the whole navigation model against the seed file, with a negative control proving it can fail; and evidence that the two entries now resolve — noting both are `status: 'planned'` (`navigation.ts:298,307`), so a holder of `sal.finance.view` will see a visibly-unavailable entry rather than a working screen, which is the correct outcome and should be stated rather than presented as a restored feature. For the new screens: green `verify:web`; `minTests` raised in the same commit; every new non-route file ≥60% lines; en/ar parity and plain-language clean; the browser spec extended and passing against a production build; and — the substantive one — no screen shipping a control that puts an identifier in front of a human, which is the P-1 test the current tree fails in four mount points.

_Evidence:_ `verify:web` (package.json:145). Floors: `test-count-baseline.json` web `minTests`, `coverage-baseline.web.json` (`touchedFileMinimum: 60`, exempt prefix `apps/web/src/app/`). Ownership: `feature/pre-p1-29-web-` + the six allowed buckets. i18n: `apps/web/tests/i18n.test.ts:72,79,91`. Copy: `check-plain-language.mjs`. Browser: `apps/web/tests/e2e/authenticated/administration.spec.ts`.

### H / CURRENT STATE

**EXISTS BUT NOT USED.**

Wave H's four named surfaces split three ways. Role editing is built and working. Grant scoping has five published Backend operations and no web surface at all — this is the clean "the contract exists, the screen does not" case, and it is the only part of wave H that could start today. Membership switching has no concept anywhere: no table (`iam.user_accounts.tenant_id` is NOT NULL and immutable per wave-a-discovery.md:325), no operation, no type, no screen. "Seeing which branches an actor reaches" is half-present — the session carries the identifiers and nothing carries the names. The permission map's own docblock already admits the gap at `shared/permissions.ts:15-21`: `grantManage` is "named because P1-26's operations declare them… and because the phase that builds those screens will need them under the same name." That phase is wave H.

_Evidence:_ Role editing EXISTS: `features/administration/access/actions.ts:44 createRoleAction`, `:64 updateRoleAction`, `:84 addRolePermissionAction`, `:104 removeRolePermissionAction`; screens `RolesScreen.tsx`, `PermissionsScreen.tsx`; pages `administration/roles/page.tsx:34,57` and `administration/permissions/page.tsx:34,65`. Grant scoping ABSENT from the web: zero callers of `iam.grant-issue`, `iam.grant-revoke`, `iam.grant-scope-list`, `iam.grant-scope-add`, `iam.grant-scope-remove`; `PERMISSIONS.grantManage` (`shared/permissions.ts:37`) has exactly one reference, its own declaration. Membership switching ABSENT: `grep -rni "membership" apps/web/src` returns only an unrelated `MembershipVerdict` type in `components/data-table/read-completeness.ts:99`. Branch reach: `session.branchIds` is identifiers with no names (`types/session.ts:25-26`).

### H / TARGET STATE

**AVAILABLE BUT NEEDS ADAPTER.**

Four surfaces over wave C, D and E contracts. The boundary test scope.md:283-286 states is the operative one: "does the change let someone do something that could not be done before, or does it decide who may do something that already could be? The first is P1-29. The second is PRE-P1-29." Grant scoping passes that test cleanly — it decides who may act where over actions that already exist. Membership switching also passes, since it chooses among authorised memberships rather than creating capability. Role editing is already built, which raises the boundary question against wave G (see ambiguities).

_Evidence:_ scope.md:245-247 verbatim: "The administration-side workflow surfaces: editing a role, scoping a grant, switching membership, seeing which branches an actor reaches. These are screens over wave C, D and E contracts. No screen in wave H may ship against a contract that does not exist — the web lane cannot change API source (§7), which is the structural enforcement of that rule." Boundary test at scope.md:283-286.

### H / GAP

**MISSING CONTRACT.**

Three sub-gaps of different kinds. (1) Grant scoping: the WRITE contracts all exist, but the reads a UI needs do not — no `GET /iam/grants`, no department directory, no branch directory by name. A grant-scoping screen built today could add a scope but could not show the operator a named list of what to scope it TO, which is a P-1 breach by omission. (2) Membership switching: nothing exists at any layer; this is wave D's schema decision (G-10, the tenant-less uniqueness index at `20260718090000_iam_user_accounts_and_profiles.sql:109-110`) and is downstream of a migration. (3) Branch reach by name: needs wave C's by-name read, the same input wave G needs. Also worth recording as an authority asymmetry for wave E rather than H: `iam.invitation-create` inserts grants (`invitation-service.ts:165-168`) under `iam.user.manage`, while `iam.grant-issue` requires `iam.grant.manage`.

_Evidence:_ No grant LIST operation exists: the ids under `apps/api/src/app/api/v1/iam/grants/**` are exactly `iam.grant-issue` (`route.ts:50`), `iam.grant-revoke` (`[grantId]/route.ts:32`), `iam.grant-scope-list` (`[grantId]/scopes/route.ts:29`), `iam.grant-scope-add` (`:42`), `iam.grant-scope-remove` (`[grantId]/scopes/[scopeId]/route.ts:27`). Grant ids reach a client only via `iam.user-detail` — `apps/api/src/modules/iam/application/user-administration-service.ts:109-122` returns `{id, roleId, scopeMode, status, validFrom, validTo}`, a `roleId` with no name. Scope input already accepts departments: `iam/grants/route.ts:31` `scopeType: z.enum(['company','branch','department'])`, `:34` `departmentId`. No department list operation exists (`grep` for `department` in `apps/api/src/app/api/v1` route paths → none). No membership table (wave-a-discovery.md:325).

### H / IMPLEMENTATION SURFACE

**AVAILABLE.**

Grant scoping has an obvious home: the existing user detail path, which already carries the grants. The five operations are already in the generated idempotency manifest, which is the `webGenerated` bucket the web lane may NOT hand-edit (`check-phase-ownership.mjs:439-441`) — but it does not need to, because the entries are already there. The recorded trap is worth restating: P1-26-F-015 found ten operations declared `idempotent: true` where no call site sent the header, a 100% failure rate while every tier was green. Any new grant caller must send it. Membership switching has no surface to extend and would need a new one, probably in the account menu (`features/authentication/components/AccountMenu.tsx`), which is outside `features/administration`.

_Evidence:_ Existing joins to extend: `administration/users/page.tsx:59` already loads `listGrantableRoles()` and `:78` passes `canRevokeSessions`; `UsersScreen.tsx` renders the user table; `iam.user-detail` already returns each user's grants. Adapters: `features/administration/users/api.ts`, `features/administration/access/api.ts`. Actions: `features/administration/*/actions.ts` with `'use server'`, checked by `scripts/ci/check-use-server-exports.mjs` (every `'use server'` module exports only async functions — `check-p1-26-frontend.mjs:29-32`). Idempotency: `apps/web/src/lib/api/idempotent-operations.ts:699-730` already publishes all five grant operations as idempotent, so a caller must send the header.

### H / SECURITY MODEL

**EXISTS AND LOAD-BEARING.**

Wave H is the wave where a screen can hand an administrator an authority they should not be able to delegate, and the containment for that already exists in SQL — which is the right place, because the application half was once wrong (an unrestricted grant skipped containment entirely, G-9). So a grant-scoping screen must be built expecting a server refusal and must render it, not pre-empt it: the client may narrow what it OFFERS as a courtesy, and must not treat its own narrowing as the boundary. Two specifics: an empty `companyIds`/`branchIds` means unrestricted, not none, and inverting that is the documented expensive mistake (`session.ts:11-18`); and P-4 forbids any client-side administrator flag or role-name test, so a scoping UI may not branch on "is this user an owner".

_Evidence:_ Delegation containment exists in the DATABASE independently of the application, because the application once got it wrong: `supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql` and `20260727090000_iam_grant_delegation_scope_backstop.sql`; the application half is `apps/api/src/modules/iam/domain/delegation-policy.ts` (scope.md G-9). The invitation path calls it before touching the provider: `invitation-service.ts:108-122` — `assertNotSystemRole`, `allowCodesOfRole`, `assertDelegable`. Unrestricted test shared with the client: `apps/web/src/features/authentication/types/session.ts:55-63` `isUnrestrictedScope`, whose docblock states the backend's `actorUnrestricted` uses exactly this test "so the interface's idea of 'unrestricted' and the server's cannot drift apart". Scope short-circuit: `apps/api/src/server/auth/authorization.ts:62-65`.

### H / TEST PLAN

**AVAILABLE.**

Wave H's dominant risk is the one this repository has shipped twice: two proven halves and an unproven wire — a component tested given a `canX` prop, a constant tested for its string value, and nothing testing the line that binds them. So the non-negotiable test is a route-invocation pairing suite over every wave-H screen, asserting each capability true with exactly its own permission and false with every other. Second, a write-reachability check: a grant-scoping action that no rendered control can invoke is the `WRITE_PERMISSIONS` defect again. Third, an idempotency-header assertion on every new caller of the five grant operations, since all five are declared idempotent. Fourth, the DOM tests must not be trusted alone — the P1-28 record is explicit that DOM tests mock the adapter, so step-payload versus strict-schema drift stayed invisible until a browser refused it.

_Evidence:_ Pairing precedent: `apps/web/tests/p1-28-permission-route-binding.test.ts:38-42` — "each capability is asserted true when the session holds exactly that permission and false when the session holds every OTHER permission this phase knows about. A one-directional test passes against `canEdit={true}`, which is the defect that shipped ten open write forms." Adapter reachability precedent: `scripts/ci/check-p1-28-adapter-reachability.mjs`, `scripts/ci/check-p1-28-write-reachability.mjs`. Component-half precedent: `apps/web/tests/write-permission-gating.dom.test.tsx`. Contract-mirror precedent: `apps/web/tests/appointments-contract.test.ts`, `receptions-contract.test.ts`.

### H / DEPENDENCIES

**MISSING CONTRACT.**

Split by surface. Grant scoping depends on wave C for the by-name company/branch/department reads and, if a grant list is wanted, on a new read the web lane cannot author. Membership switching depends entirely on wave D, which carries a migration and an unsettled data-integrity decision (G-10) — it cannot start. Branch-reach display depends on the same wave C read as wave G. Role editing depends on nothing and already exists. One wave-D item is in the web lane and is a merge rather than authorship: D6, the tenant-hint helper deletion, is written as commit `d502e07f` on a local-only branch and removes `TENANT_HINT_COOKIE` (`apps/web/src/lib/api/session-cookie.ts:43`), `readTenantHint` (`:87`) and `writeTenantHint` (`:123`), all three of which are dead on `develop`. dependencies.md §3 assigns D6 to `pre-p1-29-web`; scope.md:229-233 assigns the landing to wave D. That is a lane/wave split worth noticing before both waves assume the other has it.

_Evidence:_ scope.md:245-247 (wave H is screens over wave C, D and E contracts, structurally enforced by §7). Wave D at scope.md:225-233 (membership as a first-class concept, the tenant-hint deletion, commit `d502e07f` on `feature/pre-p1-29-web-coverage-and-tenant-hint`, not an ancestor of `develop`). Wave E at scope.md:235-241 and the unsettled G-8 adjudication at scope.md:405-411. Web-lane prohibition: `check-phase-ownership.mjs:435-437`.

### H / EXIT CRITERIA

**AVAILABLE.**

Beyond the mechanical gates shared with F and G, wave H carries one exit obligation the others do not: a written per-screen application of the scope.md:283-286 boundary test, because wave H is the wave most likely to cross into P1-29. The rule to satisfy for each screen is that it decides WHO may do something that already could be done, and adds no new thing that can be done. A second exit obligation follows from §7: for every wave-H screen, the operation it renders must already exist on `develop` — a screen whose contract is on an unmerged Backend branch cannot be reviewed against anything, and the ownership gate is what makes that unavoidable rather than a matter of discipline.

_Evidence:_ scope.md:283-286 (the boundary test). scope.md §6 exclusion table (`:271-281`) — work-order boards, job and assignment authoring, technician screens, diagnostics, progressive logging, QC screens, media capture, and "New operational actions in the work-order domain" all belong to P1-29. `verify:web` (package.json:145). `check-phase-ownership.mjs:429-450`.

### I / CURRENT STATE

**EXISTS AND LOAD-BEARING.**

The machinery is mature and its failure modes are documented in its own source. Two of the three permission lists are hand-written mirrors and each was wrong on its first attempt — `context.mjs:236-240` records that the CRM list invented a `veh.vehicle.create` that does not exist and only the catalogue check caught it. The recurring defect is stated twice at `:225-233`: the acceptance account held the wrong codes and the Owner would have reached every screen of the phase under acceptance and been told they do not have permission — "the exact failure P1-27 met before `CRM_VEHICLE_PERMISSIONS` was added, one phase later and with the lesson already written down." The fix for P1-28 was to DERIVE the set from the screens rather than mirror it. There is no equivalent derivation for PRE-P1-29.

_Evidence:_ Environment: `package.json:13-19` — `acceptance:create-owner`, `acceptance:full-cycle`, `acceptance:provision-fixtures`, `acceptance:reset-owner`, `acceptance:serve` (`node scripts/dev/start-local.mjs --production`), `acceptance:status-owner`, `acceptance:verify-reset`. Scripts: `ls scripts/dev/owner-acceptance/` → 10 files. Account: `create-owner-account.mjs:1-32` creates "the local Owner-acceptance account and its three synthetic tenants"; `:15-23` — "Every row goes through the platform's own tables, constraints and triggers… it is not a database superuser, it does not carry BYPASSRLS, it never sees a service-role key." Permissions: `context.mjs:353-360` `OWNER_PERMISSIONS` = dedup union of `ADMIN_PERMISSIONS` (`:147-163`, 14 hand-written codes), `CRM_VEHICLE_PERMISSIONS` (`:179-…`, hand-written), `P1_28_SCREEN_PERMISSIONS` (derived by `derivePhaseScreenPermissions()` at `:363+` from the route pages via `check-p1-28-access.mjs`), and `CATALOGUE_ADMIN_PERMISSIONS` (`:339-342`). Handoff: `.local/owner-acceptance-account.json`.

### I / TARGET STATE

**EXISTS AND LOAD-BEARING.**

Wave I's target is a single event with a fixed shape: the Product Owner, signed in to a production build with a real account holding the permissions the delivered screens gate on, clicking through every delivered surface by hand, and returning the literal string `OWNER ACCEPTANCE: PASS`. Everything else — matrices, counts, seals, green CI — is input to that event and is explicitly incapable of producing it.

_Evidence:_ scope.md:249-259, quoted in full in the two dedicated items above: acceptance by hand, against a production build, closing on an explicit written Pass and on nothing else, silence never a Pass (`closure-record.md:44`). Precedent environment recorded at `closure-record.md:34-40`: production build of protected `develop` itself, API 3000, Web 3100, real S3-compatible store attached to the API process only, rate limiter active and observed refusing (ten 401s then 429).

### I / GAP

**MISSING.**

Four gaps. (1) The acceptance account will not hold the codes the new screens gate on unless someone extends `context.mjs`, and the repository's own record says a hand-written extension has been wrong on first attempt every time it was tried. (2) A wave-F acceptance requires a control-plane operator in the environment, and creating one is precisely wave B's B7 bootstrap slice, which is frozen — `create-owner-account.mjs` writes rows directly through the database, which is the operator-run path outside the product that wave B exists to replace, so using it to manufacture an operator would test the script rather than the product. (3) The authenticated browser spec's eleven-screen array will be stale. (4) There is no PRE-P1-29 evidence manifest or closure record convention, so what wave I hands the Owner and what it seals afterwards is undefined.

_Evidence:_ `OWNER_PERMISSIONS` (`context.mjs:353-360`) contains no code that any wave F/G/H screen would gate on, because those codes do not exist yet; and `derivePhaseScreenPermissions()` reads P1-28 route pages via `check-p1-28-access.mjs`, of which there is no PRE-P1-29 analogue (`ls scripts/ci/ | grep pre-p1-29` → nothing). No control-plane principal exists to sign in as: `grep -rniE "super[ _-]?admin" apps/api/src apps/web/src supabase/migrations supabase/seeds | wc -l` → 0. Evidence manifest builders are per-phase: `scripts/ci/build-p1-27-evidence-manifest.mjs`, `build-p1-28-evidence-manifest.mjs` — none for pre-p1-29. Browser spec still says eleven: `e2e/authenticated/administration.spec.ts:4,49`.

### I / IMPLEMENTATION SURFACE

**AVAILABLE BUT NEEDS ADAPTER.**

The surface is entirely under `scripts/dev/owner-acceptance/`, which every PRE-P1-29 lane may change — so wave I is not blocked by ownership. The honest implementation follows the P1-28 precedent rather than the P1-26/P1-27 one: build a PRE-P1-29 access gate analogous to `check-p1-28-access.mjs` that resolves, per new route page, the permission codes that page consults, and DERIVE the acceptance grant from it, so a route added tomorrow is granted tomorrow with no edit. The no-fake-data boundary is already drawn and must be respected: business rows are created at run time through the product's own published contracts, never seeded (`context.mjs:330-337`).

_Evidence:_ `scripts/dev/owner-acceptance/context.mjs:147-163` `ADMIN_PERMISSIONS` ("The complete permission set the eleven Administration screens gate on. Mirrors `apps/web/src/features/administration/shared/permissions.ts`"); `:339-342` `CATALOGUE_ADMIN_PERMISSIONS`; `:353-360` `OWNER_PERMISSIONS`. `:246-252` records why the P1-28 set is derived and the other two are not. `scripts/dev/owner-acceptance/acceptance-fixtures.mjs` — fixture rows made at RUN TIME through published contracts, never seeded (`context.mjs:330-337`). Bucket: `scripts/` is `tooling`, which all three PRE-P1-29 profiles may change (`check-phase-ownership.mjs:117`, and the initiative docblock at `:360-366` explicitly notes "the Owner acceptance fixtures live under `scripts/dev/owner-acceptance/`, which is tooling").

### I / SECURITY MODEL

**EXISTS AND LOAD-BEARING.**

The acceptance principal is deliberately an ordinary application actor, which is what makes the session evidence about authorization rather than about a bypass. That property must survive wave I: a control-plane operator manufactured by granting the acceptance account extra database privilege would destroy it, and P-6 (scope.md:124-134) forbids the four shortcuts that would be the tempting way to produce one. The isolation spec is the existing structural proof that a real session cannot cross a tenant boundary; wave F's separation claim ("a Company Owner must not be able to reach it") is the same shape and should be proved the same way — a real Company-Owner session asking for a control-plane thing and not getting it.

_Evidence:_ `create-owner-account.mjs:15-23` — "The account holds ordinary application permissions granted through `iam.role_grants`; it is not a database superuser, it does not carry BYPASSRLS, it never sees a service-role key, and the browser receives nothing but a session cookie. If authorization is wrong, this account discovers it the same way a customer would." `:30-32` — "Local only. Refuses to run against anything but a loopback development database. See `context.mjs` for the three guards." Cross-tenant proof: `e2e/authenticated/isolation.spec.ts:6-18` — Tenant A session asks for a Tenant B thing and does not get it; identifiers at `:20-25`. Rate limiter observed refusing during P1-28 acceptance (`closure-record.md:37-38`).

### I / TEST PLAN

**AVAILABLE.**

Wave I is not an automated tier and its plan is a procedure, not a suite. The order that the record supports: (1) production build, never `next dev`, mode verified rather than assumed; (2) acceptance account provisioned holding exactly the codes the delivered screens gate on, derived rather than mirrored; (3) every delivered screen exercised by hand in both locales, since RTL is not the exception here (`i18n.test.ts:26`); (4) real API integration observed, not fixtures — the P1-26-F-015 lesson; (5) findings recorded as they are found, and each fix RED-proven the way migration 124 was (201 without the revision id versus 422 with it, `closure-record.md:57-60`); (6) the Owner's verbatim string. The standing caution from the P1-27 and P1-28 records: every automated tier being green has repeatedly coexisted with defects a human found in minutes — eleven in P1-27, four in P1-28.

_Evidence:_ Environment: `npm run acceptance:serve` (`package.json:17`), then `acceptance:create-owner`, `acceptance:provision-fixtures`, `acceptance:verify-reset`. Mode enforcement: `REFUSE_MODE_MISMATCH` (`change-log.md:534`; `scripts/dev/start-local.mjs:3-33`). Tiers that must be green first: `verify:web` (package.json:145) and the hosted `Web quality / web-quality` job whose `test-totals-web.json` is the figure QA-005 binds (`test-count-baseline.json`, web `measurementProvenance`). Browser: `apps/web/tests/e2e/authenticated/*.spec.ts` (8 specs) and `shared-ux-anonymous.spec.ts`, `foundation.spec.ts`.

### I / DEPENDENCIES

**MISSING.**

Wave I depends on every web wave delivering, and on wave B delivering enough of a control-plane principal that a wave-F acceptance is possible at all. Three concrete blockers stand between here and a wave-I run, none of them in the web lane: B7 is frozen; wave C owes the by-name reads without which wave G's selectors cannot exist; wave D owes membership without which wave H's switcher cannot exist. A partial wave I over waves G and H only, deferring F, is arithmetically possible and is not something any document on `develop` authorises or forbids.

_Evidence:_ scope.md:118-119 "A wave may not begin while an input it needs is still a question." Waves F, G, H are its inputs (scope.md §5 table). Wave B slice B7 (first-Owner bootstrap) at wave-b-control-plane-design-v2.md:958, gated at `:998-1004`. B1 unmerged and frozen behind an external provider blocker. No PRE-P1-29 access gate or evidence manifest builder exists (`ls scripts/ci/`).

### I / EXIT CRITERIA

**EXISTS AND LOAD-BEARING.**

Exactly one exit: the Owner's explicit written Pass, obtained against a production build, with every delivered screen inspected by hand and real API integration exercised. Everything else is a precondition. Two negative rules travel with it and both have precedent: silence is not a Pass (P1-26 was asked four times and answered once), and a green tier is not a Pass (P1-27 was closed once on unproven claims and reopened, and returned three FAIL verdicts before its PASS). If PRE-P1-29 follows the phase convention it will also owe a closure record and an evidence seal, but no PRE-P1-29 analogue of `build-p1-28-evidence-manifest.mjs` exists on `develop`, so that obligation is inferred from the pattern rather than documented — see unknowns.

_Evidence:_ `docs/phase-1/phase-1-28/closure-record.md:40-45`. The verdict string is the Owner's verbatim `OWNER ACCEPTANCE: PASS`; `:44-45` "**Silence was never treated as Pass.** The verdict is the Owner's act; no count in this repository derived it and none could have." scope.md:257-259 restates it as the initiative's own rule. Environment condition: `change-log.md:517-536` and `closure-record.md:34-40`.

---

## Unknowns — what could not be settled, and what would settle it

- What capability, if any, Wave B's B1 actually publishes to the web tier. B1 is implemented on the unmerged `feature/pre-p1-29-backend-b1-platform-authority-foundation` and its documents are not on `develop`, so this worktree cannot read them (correctly — their absence here is not evidence of non-existence). WOULD SETTLE IT: reading that branch, plus §3 ("the platform request context and its two shapes") and §16 ("published contract and security proofs") of wave-b-control-plane-design-v2.md, and the current status of slices B2..B9.
- Whether Wave F is a route group inside this Next application or a separate surface. `check-web-topology.mjs:29-68` neither requires nor forbids a fourth route group under `apps/web/src/app/[locale]/` (it forbids a second ROUTER ROOT — `apps/web/app/`, `apps/web/src/pages/`, `web/`), so `(platform)` beside `(auth)`/`(dashboard)`/`(design)` is legal today, but no document chooses. WOULD SETTLE IT: a wave F design document or an ADR naming the surface's location.
- Whether a control-plane operator authenticates through the same login and receives a session the web can read. Today `GET /api/v1/auth/session` is `scope: 'tenant'` requiring `iam.user.read` (auth/session/route.ts:31-32), the web's `isSessionShape` requires a string `tenantId` (session.ts:123), and `requireSession` redirects everything else to `/login` (session.ts:101-108). WOULD SETTLE IT: wave B's or wave D's session/identity contract — specifically whether a second describe-self operation is published, or the existing one is re-scoped.
- Whether the `no-client-asserted-scope` rule would refuse Wave G's named selector. The rule fires on any `companyId`/`branchId`/`tenantId` (and snake variants) that is not a bare property read (`check-p1-27-frontend.mjs:482-489`, `:609-630`), `app/[locale]/(dashboard)` is a PLAN_ROOT, and `features/administration` is in no scan root — so the same code passes or fails purely on where it lives. WOULD SETTLE IT: a wave G decision on file placement plus an explicit `MODULE_DISPOSITION`/scan-root disposition if the administration tree is adopted; note adopting a root moves `p1-27-frontend-gate:trees` from 5 to 6 and forces edits to four P1-27 documents (`check-p1-27-doc-counts.mjs:449`; markers at `deliverable-manifest.md:986`, `open-decisions.md:1205`, `owner-acceptance-fail-remediation.md:198`, `risk-register.md:581`).
- Whether PRE-P1-29 owes its own QA-005 evidence seal, task matrix and closure record. Each of P1-27 and P1-28 has `scripts/ci/build-p1-2X-evidence-manifest.mjs` and `build-p1-2X-task-matrix.mjs`; `ls scripts/ci/` shows no `pre-p1-29` equivalent, and PRE-P1-29 is an initiative rather than a numbered phase. WOULD SETTLE IT: an explicit closure convention for the initiative, or a decision that it closes under the P1-29 phase record.
- How the Owner-acceptance account acquires the permissions Waves F/G/H screens gate on. `OWNER_PERMISSIONS` (context.mjs:353-360) unions three HAND-WRITTEN lists and one DERIVED set, where the derivation reads P1-28 route pages through `check-p1-28-access.mjs`; there is no PRE-P1-29 analogue. The repository's own record (context.mjs:225-252) says the hand-written route has been wrong on first attempt every time. WOULD SETTLE IT: building a PRE-P1-29 access gate that resolves per-route permission consultation, and deriving the grant from it.
- Whether a control-plane operator can exist in the Owner-acceptance environment at all before B7 lands. `create-owner-account.mjs` writes rows directly against a loopback database — the operator-run path outside the product that wave B exists to replace — so using it to manufacture a control-plane principal would exercise the script rather than the product, and P-6 (scope.md:124-134) forbids the four shortcuts. WOULD SETTLE IT: wave B slice B7 (first-Owner bootstrap), currently frozen behind the external provider blocker.
- Whether any provisioned environment holds grants against the five dead `org.*` permissions. Recorded as unsettled at architecture-decisions.md:457-462 and still unsettled from source alone: the reference counts are static over `apps/api/src` and `apps/web/src` and say the codes are required by no operation and no screen, not that no grant row names them. It matters because re-scoping is cheaper if nothing has been granted. WOULD SETTLE IT: a query against a provisioned environment's `iam.role_permissions` and `iam.role_grants`.
- The post-change web test-count and coverage figures. `minTests` is 2500 against a LOCAL measurement of 2581 across 98 files, bounded by WTF-08 and WTF-09, and the tier has no current hosted measurement (`test-count-baseline.json`, web `measurementProvenance`). None of this can be computed for waves F/G/H before their tests exist. WOULD SETTLE IT: a hosted `Web quality / web-quality` run of the wave branch producing `test-totals-web.json`.
- Whether the P1-28 evidence seal's ARCHIVED/ACTIVE computation imposes any residual constraint on new product work. `develop` has moved past the seal (now `c081a019`, PR #259), and `docs/phase-1/phase-1-28/closure-record.md` shows no ongoing freeze clause I could find, but the seal machinery lives in the QA-005 scripts rather than in that document. WOULD SETTLE IT: reading the QA-005 seal implementation and its current verdict against `c081a019` — I did not run it, and I am not asserting either way.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- DIRECT CONTRADICTION on whether waves F and G are in scope at all. `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/architecture-decisions.md:445-447` states: "It does not decide the tenancy surfaces deferred by the Owner — typed company and branch identifiers, **Superadmin and Company-Owner admin screens**, and Backend-authoritative page visibility remain out of scope, consistent with the standing deferral." But `scope.md:150-151` makes "Superadmin web" wave F and "Company administration web" wave G, and `dependencies.md` §3 D4 delivers "Superadmin and company administration screens,
- Tenant-scoped operation counts disagree between two canonical documents, and my measurement matches neither total. `scope.md` G-8 says "167 published operations declare tenant scope, spread across 132 route files" and notes a plain-text grep returns 171 with four prose hits. `wave-b-control-plane-design-v2.md:820` says "**170** across **136** files — 166 declaring it, 4 inheriting the default at operation-registry.ts:185", repeated at `:912-913`, `:971` and `:1025`. I parsed every `defineOperation({…})` body under `apps/api/src/app/api/v1/**/route.ts` with comments stripped: 305 blocks total;
- Role administration is assigned to BOTH wave G and wave H with no boundary. `scope.md:150-151` gives wave G "Company, branch, department and role administration inside a tenant" and wave H "the administration-side workflow surfaces — role editing, grant scoping, membership switching". `scope.md:239-247` repeats it: wave G "extends it with company, branch and department administration" while wave H is "editing a role, scoping a grant, switching membership". Role editing already exists on `develop` (six server actions, two screens), which makes the overlap consequential: it is not clear which wa
- How a control-plane capability reaches the browser is unstated and the stated constraints pull against each other. `scope.md:233-237` (wave F) says "Visibility is driven by capability, per P-4, and the capability comes from the Backend." P-4 (`:198-204`) and the shipped helper define capability as exact membership of a permission-code string in `session.permissions` (`permissions.ts:49`). P-5 (`:117-123`) forbids any wildcard permission. `wave-b-control-plane-design-v2.md` designs the principal as a fourth database role plus an `iam.platform_grants` relation, not as a tenant permission code, a
- The word "wave" carries two different meanings in adjacent canonical documents. `scope.md:140-250` §5 "The nine waves" enumerates A..I as work phases. `gap-register.md:52` §3 "The four waves" enumerates the four OWNERSHIP LANES (initiative, backend, web, repository-tooling) with their branch prefixes. A reader who takes "wave" to mean one thing throughout will mis-read one of the two documents. NOT RESOLVED — recorded rather than silently normalised.
- Who fixes the two SHIPPED P-1 violations is not assigned. `SettingsEditor.tsx:107-123` and `ApprovalLimitsScreen.tsx:321-331` already ask a human for a raw organisational identifier — the select's labels ARE the identifiers, and the empty-scope branch is a free-text field. `scope.md:194-197` says only "A human-readable selector therefore cannot be built today. Making one buildable is wave C's obligation, not the web lane's," which assigns the CONTRACT but not the replacement of the two existing controls. Wave G's description (`:239-243`) speaks of extending the tree with new administration and
