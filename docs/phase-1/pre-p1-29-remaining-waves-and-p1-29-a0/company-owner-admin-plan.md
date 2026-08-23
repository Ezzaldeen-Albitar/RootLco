# Company Owner administration — capability model and gap

**What a Company Owner must eventually be able to do inside their own tenant, mapped against the
IAM operations that exist today.** No implementation, no route, no screen.

## The capability model

A Company Owner should eventually be able to:

- view the employees of their tenant
- invite or create an employee through a sanctioned flow
- disable and reactivate an employee
- assign a role, and assign **several** roles
- apply a narrow override where the platform supports one
- manage the branch and company scope of a grant
- view an employee's **effective** permissions

**without** platform authority, cross-tenant reach, self-escalation, or the ability to delegate
authority they do not themselves hold.

## The two containment rules that already exist, and the one that does not

Delegation containment is real and is enforced **twice** — in the application and independently in
the database — so a Company Owner cannot grant a permission they do not hold. That is the strongest
existing control and nothing in a future design may weaken it.

**Target containment does not exist as a general rule.** Submitting another company's company,
branch, employee, role or membership identifier must not widen the caller's reach — and the
initiative's own refutation register records that this must be enforced _for the specific
administration operations the initiative uses_, not by flipping scoped evaluation for every
tenant-scope operation at once. That is Wave C's obligation, moved there from the struck-through
slice B8.

**"A narrow override where supported" is not defined anywhere in the canonical set.** Three
different mechanisms could answer to it. Recorded as `AMB-50`.

---

## The operation inventory, and the gap

### iam.user-list

**EXISTS AND LOAD-BEARING.**

GET /iam/users | permissions ['iam.user.read'] | scope tenant | auditClass none | idempotent no (field absent) | versionGuarded no (field absent) | rateLimitPolicy expensive-read. Cursor-paginated tenant-wide user directory with optional status and substring-search filters; omits identity_provider and provider_subject.

_Evidence:_ apps/api/src/app/api/v1/iam/users/route.ts:31-42; web call site apps/web/src/features/administration/users/api.ts:58

### iam.user-detail

**EXISTS AND LOAD-BEARING.**

GET /iam/users/{userId} | ['iam.user.read'] | tenant | auditClass none | idempotent no | versionGuarded no | low-risk-metadata. Returns one user plus their role grants as {id, roleId, scopeMode, status, validFrom, validTo} (user-administration-service.ts:48-56) — role ids only, no role code/name, no permissions, no scope rows.

_Evidence:_ apps/api/src/app/api/v1/iam/users/[userId]/route.ts:32-43; web call site apps/web/src/features/administration/users/api.ts:132

### iam.user-update

**EXISTS AND LOAD-BEARING.**

PATCH /iam/users/{userId} | ['iam.user.manage'] | tenant | auditClass privileged (iam.user.updated) | idempotent no | versionGuarded YES (If-Match) | standard-command. Accepts exactly displayName and mfaRequired; strict schema, no merge path. Note the only web caller is the self-profile edit, which therefore requires iam.user.manage of the editing user.

_Evidence:_ apps/api/src/app/api/v1/iam/users/[userId]/route.ts:45-58; web call site apps/web/src/features/authentication/actions/profile.ts:66

### iam.user-status-change

**EXISTS AND LOAD-BEARING.**

POST /iam/users/{userId}/status | ['iam.user.manage','iam.session.view_all'] (conjunction) | tenant | auditClass security (representative action iam.user.locked; the service writes the precise one) | idempotent YES | versionGuarded no | standard-command. Body {status: active|locked|archived, reason}. Locks, unlocks/reactivates or archives and revokes every live session in the same transaction.

_Evidence:_ apps/api/src/app/api/v1/iam/users/[userId]/status/route.ts:46-59; web call site apps/web/src/features/administration/users/actions.ts:129

### iam.user-session-list

**EXISTS AND LOAD-BEARING.**

GET /iam/users/{userId}/sessions | ['iam.session.view_all'] | tenant | auditClass none | idempotent no | versionGuarded no | low-risk-metadata. Lists another principal's sessions.

_Evidence:_ apps/api/src/app/api/v1/iam/users/[userId]/sessions/route.ts:56-67; web call site apps/web/src/features/administration/users/api.ts:144

### iam.user-session-revoke-all

**EXISTS AND LOAD-BEARING.**

DELETE /iam/users/{userId}/sessions | ['iam.user.manage','iam.session.view_all'] | tenant | auditClass security (iam.session.revoked_all) | idempotent no | versionGuarded no | standard-command. Signs a user out everywhere. The second permission is not redundant: the file header (:17-42) records that without it the UPDATE's WHERE clause matched nothing and the request answered 200 {"revoked": 0} while the session stayed live.

_Evidence:_ apps/api/src/app/api/v1/iam/users/[userId]/sessions/route.ts:69-82; web call site apps/web/src/features/administration/users/actions.ts:141

### iam.invitation-create

**EXISTS AND LOAD-BEARING.**

POST /iam/invitations | ['iam.user.manage'] | tenant | auditClass privileged (iam.user.invited) | idempotent YES | versionGuarded no | standard-command. Body {email, displayName, mfaRequired?, redirectTo?, roleIds?[max 20]}. Tenant is not an input — taken from the resolved context (invitation-service.ts:98). Creates a provider identity plus an 'invited' account and, for each roleId, one grant written with scopeMode 'unrestricted' (invitation-service.ts:163-170).

_Evidence:_ apps/api/src/app/api/v1/iam/invitations/route.ts:34-47; web call site apps/web/src/features/administration/users/actions.ts:65

### iam.invitation-cancel

**EXISTS AND LOAD-BEARING.**

DELETE /iam/invitations/{userId} | ['iam.user.manage'] | tenant | auditClass privileged (iam.user.invitation_cancelled) | idempotent no | versionGuarded no | standard-command. Moves invited → archived and disables the provider identity. archived is terminal, so a cancelled invitation is never revived.

_Evidence:_ apps/api/src/app/api/v1/iam/invitations/[userId]/route.ts:24-36; web call site apps/web/src/features/administration/users/actions.ts:96

### iam.invitation-activate

**EXISTS AND LOAD-BEARING.**

POST /iam/invitations/{userId}/activation | ['iam.user.manage'] | tenant | auditClass security (iam.user.activated) | idempotent YES | versionGuarded no | standard-command. Activates an invited account after asking the provider whether the invitee accepted; an unconfirmed or disabled provider identity is refused.

_Evidence:_ apps/api/src/app/api/v1/iam/invitations/[userId]/activation/route.ts:27-40; web call site apps/web/src/features/administration/users/actions.ts:108

### iam.grant-issue

**EXISTS BUT NOT USED.**

POST /iam/grants | ['iam.grant.manage'] | tenant | auditClass privileged (iam.grant.issued) | idempotent YES | versionGuarded no | standard-command. Body {userId, roleId, validTo?, approvalRef?, scopes?[max 50]}; exactly one roleId per call. Empty/omitted scopes means an unrestricted tenant-wide grant and takes the unrestricted-authority path (access-administration-service.ts:396-406). This is the only way to assign a role to an existing user, and no product code calls it.

_Evidence:_ apps/api/src/app/api/v1/iam/grants/route.ts:49-62; zero web call sites — `grep -rn "iam/grants" apps/web/src` returns only the metadata table apps/web/src/lib/api/idempotent-operations.ts:699-727

### iam.grant-revoke

**EXISTS BUT NOT USED.**

DELETE /iam/grants/{grantId} | ['iam.grant.manage'] | tenant | auditClass security (iam.grant.revoked) | idempotent no | versionGuarded YES | standard-command. Sets status='revoked' and revoked_at; app_runtime holds no DELETE on iam.role_grants. Refused when it would remove the last holder of iam.user.manage / iam.grant.manage / iam.role.manage, counted by `countOtherHoldersOf` (`authorization-repository.ts:576-600`). CORRECTED: the count is a **snapshot** read, **not** a locking one — a bare `SELECT count(DISTINCT g.user_id)`, no `FOR UPDATE`, and a plain aggregate could not carry one anyway. Its docblock records the omission as deliberate (P1-14-R-011): under RLS a locking read must also satisfy the target table’s UPDATE policy, which one of the guard’s two callers need not hold, so `FOR UPDATE` silently dropped every other holder’s row, the guard under-counted to zero, and a legitimate lock was refused.

_Evidence:_ apps/api/src/app/api/v1/iam/grants/[grantId]/route.ts:31-44; no web call site

### iam.grant-scope-list

**EXISTS BUT NOT USED.**

GET /iam/grants/{grantId}/scopes | ['iam.role.read'] | tenant | auditClass none | idempotent no | versionGuarded no | low-risk-metadata. Lists the company/branch/department scope rows attached to one grant.

_Evidence:_ apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:28-39; no web call site

### iam.grant-scope-add

**EXISTS BUT NOT USED.**

POST /iam/grants/{grantId}/scopes | ['iam.grant.manage'] | tenant | auditClass privileged (iam.grant.scope_added) | idempotent YES | versionGuarded no | standard-command. Body {scopeType: company|branch|department, companyId, branchId?, departmentId?} — all raw UUIDs. Refuses a revoked grant, a self-target, a scope outside the actor's authority, and resolves the branch's company from the database rather than the request.

_Evidence:_ apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:41-54; no web call site

### iam.grant-scope-remove

**EXISTS BUT NOT USED.**

DELETE /iam/grants/{grantId}/scopes/{scopeId} | ['iam.grant.manage'] | tenant | auditClass privileged (iam.grant.scope_removed) | idempotent no | versionGuarded no | standard-command. Removing the last scope of a scoped grant is refused at COMMIT by the DEFERRABLE tg_grant_scopes_require_scope, not at the row.

_Evidence:_ apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/[scopeId]/route.ts:26-38; no web call site

### iam.role-list

**EXISTS AND LOAD-BEARING.**

GET /iam/roles | ['iam.role.read'] | tenant | auditClass none | idempotent no | versionGuarded no | low-risk-metadata. Cursor-paginated tenant roles returning id, roleCode, name, description, isSystem, deletedAt, recordVersion (authorization-repository.ts:205-213). There is no GET /iam/roles/{roleId}, so a single role is resolvable only by listing.

_Evidence:_ apps/api/src/app/api/v1/iam/roles/route.ts:38-49; web call sites apps/web/src/features/administration/access/api.ts:55 and :73, apps/web/src/features/administration/users/api.ts:175

### iam.role-create

**EXISTS AND LOAD-BEARING.**

POST /iam/roles | ['iam.role.manage'] | tenant | auditClass privileged (iam.role.created) | idempotent YES | versionGuarded no | standard-command. Creates an empty container; is_system is written false and is not an input.

_Evidence:_ apps/api/src/app/api/v1/iam/roles/route.ts:51-64; web call site apps/web/src/features/administration/access/actions.ts:59

### iam.role-update

**EXISTS AND LOAD-BEARING.**

PATCH /iam/roles/{roleId} | ['iam.role.manage'] | tenant | auditClass privileged (iam.role.updated) | idempotent no | versionGuarded YES | standard-command. Renames, re-describes, or archives (soft delete). roleCode and is_system are not accepted.

_Evidence:_ apps/api/src/app/api/v1/iam/roles/[roleId]/route.ts:32-45; web call site apps/web/src/features/administration/access/actions.ts:72-74

### iam.role-permission-list

**EXISTS AND LOAD-BEARING.**

GET /iam/roles/{roleId}/permissions | ['iam.role.read'] | tenant | auditClass none | idempotent no | versionGuarded no | low-risk-metadata. Lists the allow/deny permission mappings of one role.

_Evidence:_ apps/api/src/app/api/v1/iam/roles/[roleId]/permissions/route.ts:31-42; web call site apps/web/src/features/administration/access/api.ts:119

### iam.role-permission-add

**EXISTS AND LOAD-BEARING.**

POST /iam/roles/{roleId}/permissions | ['iam.role.manage'] | tenant | auditClass privileged (iam.role.permission_added) | idempotent YES | versionGuarded no | standard-command. Body {permissionCode, effect: allow|deny}. An allow mapping is delegation-checked twice (DelegationPolicy.assertDelegable at access-administration-service.ts:230, and ins_role_permissions_delegable at supabase/migrations/20260726090000:299-316); deny is exempt in both.

_Evidence:_ apps/api/src/app/api/v1/iam/roles/[roleId]/permissions/route.ts:44-57; web call site apps/web/src/features/administration/access/actions.ts:95-97

### iam.role-permission-update

**EXISTS BUT NOT USED.**

PATCH /iam/roles/{roleId}/permissions/{mappingId} | ['iam.role.manage'] | tenant | auditClass privileged (iam.role.permission_changed) | idempotent no | versionGuarded YES | standard-command. Flips a mapping between allow and deny; flipping to allow is delegation-checked (access-administration-service.ts:277).

_Evidence:_ apps/api/src/app/api/v1/iam/roles/[roleId]/permissions/[mappingId]/route.ts:27-40; no web call site (apps/web/src/features/administration/access/actions.ts calls only POST :97 and DELETE :113)

### iam.role-permission-remove

**EXISTS AND LOAD-BEARING.**

DELETE /iam/roles/{roleId}/permissions/{mappingId} | ['iam.role.manage'] | tenant | auditClass privileged (iam.role.permission_removed) | idempotent no | versionGuarded no | standard-command. Deletes the mapping row outright — one of exactly two tables where app_runtime holds DELETE. The service performs no delegability check and no last-holder check (see the CONTAINMENT items below).

_Evidence:_ apps/api/src/app/api/v1/iam/roles/[roleId]/permissions/[mappingId]/route.ts:42-54; web call site apps/web/src/features/administration/access/actions.ts:111-113

### iam.permission-list

**EXISTS AND LOAD-BEARING.**

GET /iam/permissions | ['iam.role.read'] | tenant | auditClass none | idempotent no | versionGuarded no | low-risk-metadata. The global platform permission catalogue; unconditional SELECT policy, no tenant predicate (sel_permissions_all, supabase/migrations/20260718091000:168).

_Evidence:_ apps/api/src/app/api/v1/iam/permissions/route.ts:20-31; web call site apps/web/src/features/administration/access/api.ts:98

### iam.approval-limit-list

**EXISTS AND LOAD-BEARING.**

GET /iam/approval-limits | ['iam.approval.manage'] | tenant | auditClass none | idempotent no | versionGuarded no | low-risk-metadata. Optional companyId / userId filters. Note reading is gated on the manage permission, not a read permission.

_Evidence:_ apps/api/src/app/api/v1/iam/approval-limits/route.ts:54-65; web call site apps/web/src/features/administration/access/api.ts:161

### iam.approval-limit-create

**EXISTS AND LOAD-BEARING.**

POST /iam/approval-limits | ['iam.approval.manage'] | tenant | auditClass approval (iam.approval_limit.created) | idempotent YES | versionGuarded no | standard-command. Body carries companyId plus exactly one of roleId or userId, limitType, amount as a decimal STRING, currency, effectiveFrom/To. Escalation controls: no limit for yourself (access-administration-service.ts:660), the company must be inside the actor's scope (:665), and two EXCLUDE constraints refuse an overlapping window.

_Evidence:_ apps/api/src/app/api/v1/iam/approval-limits/route.ts:67-80; web call site apps/web/src/features/administration/access/actions.ts:162

### iam.approval-limit-end

**EXISTS AND LOAD-BEARING.**

PATCH /iam/approval-limits/{limitId} | ['iam.approval.manage'] | tenant | auditClass approval (iam.approval_limit.ended) | idempotent no | versionGuarded YES | standard-command. effective_to is the only mutable column; a ceiling can be ended but never rewritten.

_Evidence:_ apps/api/src/app/api/v1/iam/approval-limits/[limitId]/route.ts:24-37; web call site apps/web/src/features/administration/access/actions.ts:187-189

### CAPABILITY: view employees in their tenant

**EXISTS AND LOAD-BEARING.**

The operation exists and answers for the whole TENANT. What is missing is the word 'their': iam.user_accounts carries no company_id or branch_id (table definition supabase/migrations/20260718090000:80-96) and the list applies no scope filter, so a company-scoped administrator sees every account in the tenant. Because the operation declares scope 'tenant', requiresScopedEvaluation returns false (authorization.ts:62-65) and iam.user.read is evaluated tenant-wide. A user's company association exists only indirectly, through iam.grant_scopes rows hanging off their grants.

_Evidence:_ iam.user-list at apps/api/src/app/api/v1/iam/users/route.ts:31-42; iam.user-detail at .../[userId]/route.ts:32-43; RLS sel_user_accounts_tenant at supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:335-337

### CAPABILITY: invite or create an employee through a sanctioned flow

**EXISTS AND LOAD-BEARING.**

A complete three-operation flow exists (invite → activate on provider confirmation → or cancel) and it satisfies P-1 and P-2: the tenant is never an input, and the invitee signs in by email and password at the provider. Two gaps. First, roles attached at invitation are always tenant-wide: invitation-service.ts:167 hard-codes scopeMode 'unrestricted' and the request body has no scopes field, while scope_mode is frozen by tg_role_grants_immutable (supabase/migrations/20260718092000:110-112) — so an invitation-time grant can never afterwards be narrowed, only revoked and re-issued. Second, invite does NOT call assertUnrestrictedDelegationAllowed (contrast access-administration-service.ts:399); a scoped inviter is caught only by the deferred database backstop at COMMIT (supabase/migrations/20260727090000:152-155), i.e. as a 42501, not as the cataloged ERR-IAM-001 the grant route produces.

_Evidence:_ iam.invitation-create at apps/api/src/app/api/v1/iam/invitations/route.ts:34-47, with cancel and activation completing the flow; web flow at apps/web/src/features/administration/users/actions.ts:65,96,108

### CAPABILITY: disable / reactivate an employee

**EXISTS AND LOAD-BEARING.**

Disable = POST status 'locked'; reactivate = POST status 'active' (locked → active is in the graph). archived is terminal, so archive is not reversible and re-inviting the same address creates a new account. Losing 'active' revokes every live session in the same transaction (user-administration-service.ts:215-227). Two guards: an administrator may not change their own status (:204) and the last holder of iam.user.manage cannot be locked or archived (:209-212). Missing for a Company Owner model: no company containment — a company-scoped holder of iam.user.manage can lock any account in the tenant, because the operation is tenant-scope and the row is fetched only by tenant.

_Evidence:_ iam.user-status-change at apps/api/src/app/api/v1/iam/users/[userId]/status/route.ts:46-59; transition graph at apps/api/src/modules/iam/domain/identity-policy.ts:24-29

### CAPABILITY: assign a role

**EXISTS BUT NOT USED.**

The Backend operation exists and is fully guarded (no self-grant, delegability, unrestricted-authority, scope containment, scope shape). What is missing is any sanctioned path to it: no Frontend calls it, so today the only way a role reaches a user in the shipped product is the roleIds array at invitation time — which means a role cannot be added to, or removed from, an EXISTING employee through any user interface. Note also there is no GET /iam/grants collection; grants are discoverable only through iam.user-detail.

_Evidence:_ iam.grant-issue at apps/api/src/app/api/v1/iam/grants/route.ts:49-62; zero web call sites (`grep -rn "iam/grants" apps/web/src` → only apps/web/src/lib/api/idempotent-operations.ts:699-727)

### CAPABILITY: assign MULTIPLE roles

**EXISTS AND LOAD-BEARING.**

Multiple roles per user are supported by the model and compose correctly with deny precedence. The API shape is one grant per POST /iam/grants call, so N roles is N calls, each with its own Idempotency-Key; only the invitation route takes a batch. Missing: no bulk grant operation, no transactional 'set the user's roles to exactly this list' operation, so a multi-role change is not atomic.

_Evidence:_ iam.role_grants has no uniqueness constraint on (tenant_id, user_id, role_id) — supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:82-96 and the two plain indexes at :103-104; iam.has_permission aggregates with bool_or across all active grants at supabase/migrations/20260718097000:105-112; invitations accept roleIds max 20 at apps/api/src/app/api/v1/iam/invitations/route.ts:31

### CAPABILITY: apply a narrow override where supported

**AVAILABLE BUT NEEDS ADAPTER.**

Exactly one narrow override is exposed: a per-USER approval limit (an amount ceiling, not a permission). Everything else is role-wide. A deny mapping is per-role, so denying one employee a permission requires giving them a private role — there is no per-user permission override table at all. iam.sensitive_data_permissions is role-scoped (role_id at :112, no user_id) and the schema supports view/export/mask_override per classification, but no operation exposes it: schema support without an operation.

_Evidence:_ Per-user approval limit: apps/api/src/app/api/v1/iam/approval-limits/route.ts:67-80 with userId at :38. Per-role deny mapping: apps/api/src/app/api/v1/iam/roles/[roleId]/permissions/route.ts:44-57. iam.sensitive_data_permissions defined at supabase/migrations/20260718093000_iam_approval_and_sensitive_data.sql:109-140 with ZERO API consumers (`grep -rn "sensitive_data_permissions" apps/api/src --include=*.ts` returns nothing)

### CAPABILITY: manage branch / company scope on a grant

**MISSING CONTRACT.**

The scope operations require raw companyId / branchId / departmentId UUIDs in the request body, and NO operation in apps/api/src/app/api/v1 lists the companies or branches of a tenant — every org route is addressed by an id the caller must already possess. Under P-1 (no normal employee ever types an organisational identifier) the scope operations are therefore not usable by a Company Owner as shipped: the enumeration contract they depend on does not exist. Two further constraints: scope_mode is immutable (tg_role_grants_immutable, supabase/migrations/20260718092000:110-112) so an unrestricted grant can never be narrowed by adding a scope; and a department scope is issuable but inert on evaluation (ScopeRequirement has no 'department', operation-registry.ts:36; AuthorizationTarget.departmentId is written by no call site) — recorded independently as GAP-09 in docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/gap-register.md:95.

_Evidence:_ Operations exist: iam.grant-scope-add / -list / -remove at apps/api/src/app/api/v1/iam/grants/[grantId]/scopes/route.ts:28-54 and .../[scopeId]/route.ts:26-38. But `grep -rn "org.company.read\|org.branch.read" apps/api/src --include=*.ts` returns only per-id settings routes — apps/api/src/app/api/v1/org/companies/[companyId]/settings/route.ts:42, apps/api/src/app/api/v1/org/branches/[branchId]/settings/route.ts:38, apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:39

### CAPABILITY: view effective permissions of an employee

**MISSING.**

There is no operation, anywhere, that answers 'what can THIS other user do'. iam.user-detail returns grant rows carrying roleId UUIDs only — no role code, no permission codes, no scope rows (user-administration-service.ts:48-56). A client could approximate it by joining iam.user-detail → iam.role-list (for roleId → roleCode) → iam.role-permission-list per role and re-implementing deny precedence and validity windows in TypeScript — which is precisely the second source of truth authorization-repository.ts:134-139 says must not be created. Missing contract: a scope-aware, deny-correct effective-permission read for a named user.

_Evidence:_ effectivePermissionsOfCaller at apps/api/src/modules/iam/data/authorization-repository.ts:140-148 asks `WHERE iam.has_permission(p.permission_code)`, which resolves against iam.current_user_id() only (supabase/migrations/20260718097000:85). Its five consumers are all self-referential. The only surface returning permissions is GET /auth/session at apps/api/src/app/api/v1/auth/session/route.ts:25-36, described at :4 as 'the caller's own resolved identity, scope, and effective permissions'

### CONTAINMENT: no platform authority

**EXISTS AND LOAD-BEARING.**

Enforced, and enforced by absence as much as by code: there is no permission a tenant administrator could hold that reaches beyond their tenant, no operation that creates a tenant, and no operation identifier beginning 'platform.'. Also confirmed: provisioning creates tenant + history + subscription + company + branch + settings + sequences and NO user account, role or grant, so no 'first Owner' exists in the shipped system at all.

_Evidence:_ The seeded catalogue defines no platform-level code — supabase/seeds/04_iam_permission_catalog.sql:16-34 is the complete org.* and iam.* set (broadest are org.subscription.manage and iam.user.manage), and `grep -n "^ ('iam\.\|^ ('org\."` returns those 19 lines only. is_system roles are excluded from every write policy (ins_roles_admin / upd_roles_admin / all three role_permissions policies, supabase/migrations/20260726090000:269-352) and by DelegationPolicy.assertNotSystemRole (delegation-policy.ts:234-240). org.tenants carries a single UPDATE policy keyed to the caller's own tenant (upd_tenants_settings, :423-426). org.provision_organization is granted to no application role (supabase/migrations/20260717107000_org_provisioning.sql:24-28, :279-282)

### CONTAINMENT: no cross-tenant reach

**EXISTS AND LOAD-BEARING.**

Enforced at three layers and, decisively, by shape: no IAM request body has a tenant field. Grant scope rows additionally cannot name another tenant's company because fk_grant_scopes_branch is composite on (tenant_id, company_id, branch_id) — noted at supabase/migrations/20260726090000:392-395. The one caveat worth recording is that today's confinement of one human to one tenant rests on a unique index carrying no tenant (uq_user_accounts_provider_identity_active, supabase/migrations/20260718090000:109-110), which §18 of the wave B design names as wave D's problem, not wave B's.

_Evidence:_ Tenant comes from the verified token and nowhere else — apps/api/src/modules/iam/auth/bearer-authenticator.ts:79-95 returns null when the token carries no tenant binding. It is bound as a transaction-local GUC at apps/api/src/server/db/transaction.ts:91-104 ('app.tenant_id'). Every iam SELECT policy is `tenant_id = iam.current_tenant_id()` (e.g. supabase/migrations/20260718090000:335-346; sel_roles_tenant / sel_role_permissions_tenant at 20260718091000:170-173; sel_role_grants_tenant / sel_grant_scopes_tenant at 20260718092000:223-226), every write policy repeats it (20260726090000:184-426), and every table is ENABLE + FORCE ROW LEVEL SECURITY (20260718090000:330-333). iam.has_permission returns false on an unset tenant (20260718097000:87-89)

### CONTAINMENT: no self-escalation

**MISSING.**

The guarded paths are guarded. The unguarded one is deletion of a DENY mapping. iam.has_permission computes bool_or(allow) AND NOT bool_or(deny) across all of a user's active grants (supabase/migrations/20260718097000:105-114), so deleting a deny row can ADD a permission to whoever holds a role with a matching allow — including the actor. The same net change made as PATCH deny→allow IS refused, because assertDelegable is evaluated against the actor's current effective permissions and the deny makes that false (access-administration-service.ts:277). So the two routes to one outcome are guarded asymmetrically, and the unguarded route is a DELETE the file's own header calls harmless ('removing access is a reduction', :302-303). Removing a deny is not a reduction. Not executed against a database — see unknowns.

_Evidence:_ Positive controls exist: ck_role_grants_no_self_grant CHECK (granted_by IS DISTINCT FROM user_id) at supabase/migrations/20260718092000:95; granted_by is server-set from the context principal at apps/api/src/modules/iam/data/authorization-repository.ts:475-488; DelegationPolicy.assertNotSelf is called for grant, revoke, scope-add, scope-remove and approval-limit (access-administration-service.ts:369,474,537,596,660) and for status change (user-administration-service.ts:204). But removeRolePermission (access-administration-service.ts:306-332) calls neither assertNotSelf nor assertDelegable, and its DELETE policy del_role_permissions_admin (supabase/migrations/20260726090000:341-352) checks only tenant + iam.role.manage + not-a-system-role

### CONTAINMENT: cannot delegate authority they do not themselves possess

**EXISTS AND LOAD-BEARING.**

This is the best-defended property in the module, and the backstop's own header (:15-31) records why the application layer alone was not enough: an empty scope list — the broadest possible delegation — was the one case nobody checked. Three residual holes. (1) The invitation path issues grants without the unrestricted-authority pre-check (invitation-service.ts:118-120 checks assertNotSystemRole and assertDelegable but not assertUnrestrictedDelegationAllowed), leaving the deferred trigger as the sole control. (2) ins_role_grants_delegable calls the scope-BLIND iam.has_permission, stated explicitly at supabase/migrations/20260727090000:21-26 — it proves the actor holds the permissions somewhere in the tenant, not that they may delegate them where they are delegating. (3) removeRolePermission's docblock (access-administration-service.ts:301-305) states 'Last-holder protection still applies when the mapping is an allow on iam.user.manage-class permissions' and the method body contains no such call: `grep -rn assertNotLastHolder apps/api/src` matches exactly two call sites, access-administration-service.ts:482 (grant revoke) and user-administration-service.ts:211 (status change). Deleting the allow mapping that is a tenant's last source of iam.user.manage is therefore refused by nothing, while revoking the equivalent grant is refused.

_Evidence:_ Application: DelegationPolicy.assertDelegable (apps/api/src/modules/iam/domain/delegation-policy.ts:126-141), assertUnrestrictedDelegationAllowed (:159-167), assertScopeWithinAuthority with true hierarchical containment over actorScopes (:189-200, helper scopeCovers at :78-98). Facts are measured server-side, never client-supplied (delegationFacts at access-administration-service.ts:788-796, reading effectivePermissionsOfCaller and heldScopesOfCaller). Database: ins_role_permissions_delegable and upd_role_permissions_delegable (supabase/migrations/20260726090000:299-338), ins_role_grants_delegable (:370-383), and the deferred constraint-trigger backstop iam.grant_delegation_within_authority (supabase/migrations/20260727090000:86-192, attached at :248-256)

### wave-b-control-plane-design-v2.md §17 — Company-Owner containment, integrated

**EXISTS AND LOAD-BEARING.**

§17 requires four things and defers the rest. (1) The premise is imported unchanged from register §4: 'Company Owner authority is bounded by tenant and company, and the target resource is validated independently. Submitting another company's company, branch, employee, role or membership identifier must not widen the caller's reach' (refutation-register.md:207-211). (2) Scoped evaluation is explicitly NOT switched on globally — requiresScopedEvaluation returns false for a tenant-scope operation whatever target is named, cited as authorization.ts:62-65, and 170 operations across 136 files are in that position per §14; adjudicating them is wave E's job and 'Wave B changes none of them' (:910-914). §14's figures were measured on 2026-08-22 at fe81f3eb: 124 migrations, 112 seeded permission codes, 305 published operations, 170 tenant-scope across 136 files (166 declaring, 4 inheriting the default at operation-registry.ts:185), 0 operation ids beginning 'org.' (:813-818). (3) Because wave B introduces only platform.* operations, it 'introduces no operation a Company Owner can reach', so proof P-21 ('Company Owner acts on their own company, then on another' → 'Accepted, then refused') and slice B8 ('Company-Owner target containment') both MOVE TO WAVE C, which introduces the first Company-Owner-reachable administration operation; revision 1 had assigned them to wave B 'where they would have passed vacuously' (:916-920, and the struck-through B8 row at :962). (4) One trap is recorded for whichever wave runs P-21: the fixture Owner must hold a COMPANY-SCOPED grant, because narrowScope skips the membership test for an unrestricted caller (cited as resolve-context.ts:133 — verified: `if (!resolved.unrestricted && !held.includes(value))` at apps/api/src/server/context/resolve-context.ts:133) — 'an unrestricted fixture would prove nothing' (:922-923).

_Evidence:_ docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-design-v2.md:906-923; premise imported from wave-b-control-plane-refutation-register.md:199-220 §4; proof row P-21 at wave-b-control-plane-design-v2.md:888; slice B8 at :962

---

## Unknowns — what could not be settled, and what would settle it

- Whether the deny-mapping DELETE self-escalation is reachable end-to-end. I read the code and the policy; I did not run anything against a database. It would be settled by a DB/RLS test: as an actor holding iam.role.manage, with role A allowing permission X and role B denying X, both granted to the actor, assert iam.has_permission('X') is false, DELETE the deny mapping via the shipped operation, and assert it becomes true.
- How a refusal from the deferred constraint trigger iam.enforce_grant_delegation_within_authority surfaces to an HTTP client. It raises SQLSTATE 42501 at COMMIT (supabase/migrations/20260727090000:224-227), after the handler has returned its result object; I did not trace whether the error mapper turns that into a cataloged ERR-IAM-001 or an unhandled 500. This matters because it is the ONLY control on the invitation path for a scoped inviter. Settled by an integration test invoking POST /iam/invitations with roleIds as a company-scoped administrator and asserting the status code and error code.
- Whether iam.user_employee_links is ever populated. The table exists (supabase/migrations/20260718090000, policy sel_user_employee_links_tenant at :341) but `grep -rn user_employee_links apps/api/src --include=*.ts` finds only two prose comments (identity-repository.ts:116, vehicle/application/actor-identity.ts:49) and no read or write. If it is the intended employee↔user bridge, nothing uses it. Settled by grepping the migrations and seeds for INSERT statements against it.
- Whether any tenant in any environment holds a role that plays the Company Owner part. The Backend has no such concept (`grep -rniE "company.owner|'owner'|role_code" apps/api/src` finds only CRM/vehicle relation vocabulary and generic role_code plumbing) and org.provision_organization creates no roles or grants. The seed comment at supabase/seeds/04_iam_permission_catalog.sql:6-8 mentions a 'six-role baseline shape' proven 'with ephemeral fixtures in iam-seeds.test.ts'. Settled by reading that test to see what the six roles are and whether any is ownership-shaped.
- Whether the six unused operations (iam.grant-issue, iam.grant-revoke, iam.grant-scope-list, iam.grant-scope-add, iam.grant-scope-remove, iam.role-permission-update) have ever been exercised outside unit tests. I established zero Frontend call sites; I did not check the API test suites. Settled by grepping apps/api/tests for each operation id.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- Two documents in the same folder give different counts for the tenant-scope surface, and neither retracts the other. gap-register.md:94 (GAP-08) says '167 of the 305 published operations declare tenant scope' and :95 (GAP-09) repeats '167 tenant-scoped operations ... 134 company- and branch-scoped ones'; wave-b-control-plane-design-v2.md:817 says 170 across 136 files, measured 2026-08-22 at fe81f3eb, and :824-826 explains that revision 1's earlier figure (180 across 132) was a bad text scan. Which of 167 and 170 is current is not resolved in the documents.
- 'A narrow override where supported' is not defined in the pre-P1-29 document set — the phrase appears in the task, not in scope.md, gap-register.md or the wave B design. Three different mechanisms could answer to it (a per-user approval limit, a role-level deny mapping, a per-role sensitive-data classification override), and they differ in subject and in whether any operation exposes them. I report all three rather than choosing.
- The boundary 'IAM administration routes' is ambiguous in the repository. Thirteen further operations carry `iam.` identifiers while living outside apps/api/src/app/api/v1/iam/**: iam.audit-event-list, iam.audit-event-detail (audit-events/), iam.auth-login, iam.auth-logout, iam.auth-session, iam.auth-password-reset, iam.auth-password-reset-completion (auth/), iam.tenant-settings-read, iam.tenant-settings-update (org/tenant/route.ts:36,49), iam.company-settings-read, iam.company-settings-write (org/companies/[companyId]/settings/route.ts:37,50), iam.branch-settings-read, iam.branch-settings-writ
- access-administration-service.ts:301-305 (docblock for removeRolePermission) and access-administration-service.ts:306-332 (its body) disagree about whether last-holder protection applies to permission-mapping removal. The docblock asserts it does; no call exists. I have reported the code behaviour, but the intended contract is genuinely unclear from the source.
- §17 and §19 both send P-21 and slice B8 to 'wave C', but no wave C document exists in docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow (the folder holds architecture-decisions, dependencies, gap-register, permission-reuse-register, scope, wave-a-discovery, and the two wave-b files). What wave C's scope is, and therefore which operation is 'the first Company-Owner-reachable administration operation', is not settled by any document I read.
