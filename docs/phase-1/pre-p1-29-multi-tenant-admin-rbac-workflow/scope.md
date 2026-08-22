# PRE-P1-29 — scope

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 1. What this initiative is

PRE-P1-29 closes the gap between the administration the product _declares_ and the administration
the product can actually _perform_. It has three authorised objectives, in this order:

1. **Multi-company identity remediation.** One person, one login, possibly several authorised
   memberships. The resolution direction is fixed: global identity → membership(s) →
   tenant/company → branches → roles and grants.
2. **Platform Superadmin bootstrap authority.** A control-plane principal that can bring a new
   tenant into existence — its first company, its first branch, its first Company Owner, its first
   roles and grants — without any of the shortcuts that would hollow out the authorization model.
3. **Company administration and workflow authority.** The tenant-side ability to define companies,
   branches, departments, roles and grants, and to say who may act where.

It is a _remediation and enabling_ initiative. Its success condition is that the authorization
story is true end to end: every administration permission the platform ships is reachable through a
published operation, every operation is guarded by a permission that exists, and every actor's
reach is resolved by the Backend rather than asserted by a browser.

## 2. What this initiative is not

| Not in scope                                                             | Why                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1-29 (Work Order, Diagnostics, Technicians Frontend)               | Explicitly excluded by Owner decision. See §6.                                                                                                                                           |
| New operational capability in the work-order domain                      | PRE-P1-29 may change _who_ may do a thing; it may not add a _new thing that can be done_.                                                                                                |
| Redesign of the permission model                                         | Authorization stays permission-based, never role-name-based (`supabase/seeds/04_iam_permission_catalog.sql:11-12`). PRE-P1-29 adds operations and grants; it does not replace the model. |
| A tenant or workspace picker that accepts a typed identifier             | Forbidden permanently. See §4.                                                                                                                                                           |
| Changes to the local database harness or the API workspace configuration | Forbidden by every PRE-P1-29 ownership profile. See §7.                                                                                                                                  |
| Promotion of `develop` to `main`                                         | Out of band. This initiative does not carry a promotion.                                                                                                                                 |

---

## 3. Why now — the measured gap

Everything in this table was measured directly against the working tree at
`C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco` on 2026-08-22.

| #    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1  | The permission catalogue holds **112 permissions across 17 domain prefixes**, and it is the **only shipping insert into the permissions table**. No migration writes permissions.                                                                                                                                                                                                                                                                              | `supabase/seeds/04_iam_permission_catalog.sql:15` (the single insert); the same conclusion is stated as the reason the seed bucket exists at `scripts/ci/check-phase-ownership.mjs:109`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| G-2  | The catalogue count is pinned by the schema baseline, so adding a permission is a deliberate, reviewed act.                                                                                                                                                                                                                                                                                                                                                    | `.github/ci-baselines/schema-baseline.json:14` (`"permissionCount": 112`), enforced against the replayed database at `scripts/ci/migration-replay-checks.mjs:238-240`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G-3  | **38 published operations** carry an identity-and-access identifier. **No operation carries an organisation identifier at all** — zero, platform-wide.                                                                                                                                                                                                                                                                                                         | Measured across `apps/api/src`; the organisation URL namespace at `apps/api/src/app/api/v1/org/` holds three route files, and all six of their operations are identity-and-access operations (`.../org/tenant/route.ts:36,49`, `.../org/companies/[companyId]/settings/route.ts:37,50`, `.../org/branches/[branchId]/settings/route.ts:33,46`)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G-4  | Five organisation administration permissions are seeded and guard nothing. `org.company.manage`, `org.branch.manage`, `org.department.manage` and `org.subscription.manage` have **zero references** in both `apps/api/src` and `apps/web/src`. `org.tax.manage` has zero Backend references and three in the web tree.                                                                                                                                        | Catalogue rows at `supabase/seeds/04_iam_permission_catalog.sql:18,20,21,23,24`; web references at `apps/web/src/features/administration/shared/permissions.ts:46`, `apps/web/src/config/navigation.ts:473`, `apps/web/src/app/[locale]/(dashboard)/administration/page.tsx:73`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G-5  | **No operation enumerates the companies or branches an actor may act in.** The only company- and branch-addressed operations read or write settings and change branch status, and every one of them is addressed by an identifier the caller must already possess.                                                                                                                                                                                             | The complete set of _organisational_ company/branch/department/tenant-named operations in `apps/api/src` is the six settings operations of G-3 plus `shared.branch-status-read` / `shared.branch-status-change` (`apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts:34,47`) and `svc.branch-availability-set` (`apps/api/src/app/api/v1/services/[serviceId]/branch-availability/route.ts:62`). One further operation matches on the word alone — `crm.company-create` (`apps/api/src/app/api/v1/customers/companies/route.ts:29`) — and it creates a CUSTOMER company, not an organisational one                                                                                                                                                                      |
| G-6  | Departments have a table and can scope a grant, but **no operation creates, lists or updates one**.                                                                                                                                                                                                                                                                                                                                                            | Table created at `supabase/migrations/20260717104000_org_operational_structure.sql:109`; a grant scope may name a department at `supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:125` (`department_id` on `iam.grant_scopes`); no operation path in `apps/api/src` contains `department`; the requirement is recorded as blocked at `docs/product/owner-workflow-requirements.md:226-227` ("departments exist nowhere (`INT-042`)")                                                                                                                                                                                                                                                                                                                                         |
| G-7  | **No seed creates a role or maps a permission to a role.** On a freshly replayed database the 112 permissions exist and are held by nobody. The catalogue says so in its own words.                                                                                                                                                                                                                                                                            | `supabase/seeds/` contains six files, none of which touches roles or role-permission mappings; the intent is stated at `supabase/seeds/04_iam_permission_catalog.sql:4-12` and repeated at `:327-330`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G-8  | Scope containment is **short-circuited for tenant-scoped operations at the HTTP boundary**. The helper returns false unconditionally when the declared scope is tenant, and the evaluator then asks the scope-blind, tenant-wide question instead of the scoped one. **167 published operations declare tenant scope, spread across 132 route files.**                                                                                                         | `apps/api/src/server/auth/authorization.ts:62-65` (the short-circuit — `if (scope === 'tenant') return false;`), `:105-107` (where the decision is taken), `:111-118` (the two different questions: `iam.has_permission_in_scope` versus `iam.has_permission`). The one path that escapes the short-circuit is `forceScoped`, set only by the in-application re-authorization at `:376` and never by the HTTP boundary. The 167/132 figures are `scope: 'tenant'` declarations inside `defineOperation({…})` blocks, parsed rather than grepped: a plain text search returns 171, and the four extra hits are prose in comments (`items/route.ts:7`, `price-lists/…/publication/route.ts:101`, `reception-catalogue/damage-map-templates/route.ts:109`, `services/…/publication/route.ts:97`) |
| G-9  | Delegation containment already exists **in the database**, independently of the application, because the application once got it wrong: an unrestricted grant skipped containment entirely.                                                                                                                                                                                                                                                                    | `supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql` and `supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql`; the application half is `apps/api/src/modules/iam/domain/delegation-policy.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G-10 | One live external identity resolves to **exactly one tenant, platform-wide**. The uniqueness index on the external identity carries no tenant.                                                                                                                                                                                                                                                                                                                 | `supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql:109-110`. The sibling index at `:107-108` _is_ tenant-scoped, which is what makes the asymmetry deliberate rather than accidental                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G-11 | Sign-in is **email and password only**. The login form has an email field, a password field and a hidden locale field; the validator parses an email and a password and nothing else.                                                                                                                                                                                                                                                                          | `apps/web/src/features/authentication/components/LoginForm.tsx:52,64,90`; `apps/web/src/features/authentication/schemas/credentials.ts:53-66`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G-12 | The session already carries the resolved company and branch reach, **as identifiers with no names**. An empty list means unrestricted within the tenant, not "no access".                                                                                                                                                                                                                                                                                      | `apps/web/src/features/authentication/types/session.ts:20-28`, with the empty-means-unrestricted rule documented at `:11-18`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G-13 | The client-side permission helper **fails closed**: an unknown capability set yields an empty menu, membership is exact, and a null requirement means "not gated" rather than "holds everything".                                                                                                                                                                                                                                                              | `apps/web/src/lib/permissions.ts:39,47,49`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G-14 | Two navigation entries are guarded by permission codes **that do not exist in the catalogue**. The navigation names `sal.invoice.read` and `sal.delivery.read`; the seeded codes are `sal.finance.view` and `sal.delivery.view`. Because a permission that does not exist can be held by nobody, both entries are permanently invisible to every actor, and no denial test can notice.                                                                         | `apps/web/src/config/navigation.ts:297,306` against `supabase/seeds/04_iam_permission_catalog.sql:66,70`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G-15 | **No Superadmin or platform-administrator principal exists anywhere.** A case-insensitive search for `super[ _-]?admin` across the API source, the web source, the migrations and the seeds returns **zero** hits. The term _platform administration_ does appear — three times, in migration COMMENTS, and every one of them says it is **not** an application-role capability, which is a statement that the principal is absent rather than that it exists. | `super[ _-]?admin`: 0 hits across `apps/api/src`, `apps/web/src`, `supabase/migrations`, `supabase/seeds`. `platform administrat*`: `supabase/migrations/20260717101000_org_tenants.sql:113,254` and `supabase/migrations/20260717102000_org_subscriptions.sql:307`, all three in `COMMENT ON` text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| G-16 | On `develop` and on the current branch the dead tenant-hint cookie helpers are **still declared and still have no caller**. They are declared in one file and referenced from nowhere in `apps/api/src`, `apps/web/src` or `apps/web/tests`.                                                                                                                                                                                                                   | `apps/web/src/lib/api/session-cookie.ts:43` (`TENANT_HINT_COOKIE`), `:87` (`readTenantHint`), `:123` (`writeTenantHint`); a repository-wide search for those three identifiers returns only that file. See §9 — the removal exists, but on an unmerged local branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The shape of the gap is consistent: the _database_ is further ahead than the _contract_, and the
contract is further ahead than the _screens_. Permissions exist that no operation names; a table
exists that no operation reaches; containment exists in SQL that the HTTP layer does not ask for.

---

## 4. Permanent product principles

These are not phase decisions. They bind PRE-P1-29 and every phase after it, and a change to any of
them is an Owner decision, not an engineering one.

### P-1 — No normal employee ever types an organisational identifier

No company, tenant, branch, department or workspace identifier is ever entered by hand by an
ordinary user. Not in a login form, not in a URL a human is asked to construct, not in a "workspace
code" field. Where a human must choose among several authorised places, they choose from a named
list the Backend gave them — and the list is _what they may reach_, not _what exists_.

The existing surface already fails half of this: the session publishes company and branch
identifiers with no names (`apps/web/src/features/authentication/types/session.ts:25-26`), and no
operation exists that would return the names (G-5). A human-readable selector therefore cannot be
built today. Making one buildable is wave C's obligation, not the web lane's.

### P-2 — Login is email and password

Sign-in takes an email address and a password. It does not take a tenant, a company, an
organisation slug, or a remembered hint. This is already true (G-11) and must remain true after the
multi-company work: choosing among memberships happens **after** authentication, never as a
credential.

The dead tenant-hint cookie helpers (G-16) are the last artefact of the opposite design and are
scheduled for deletion in wave D.

### P-3 — The Backend resolves memberships

Which tenant, which companies, which branches, which permissions — all resolved server-side from
the authenticated identity, on every request. The browser never asserts any of them. The session
type already states this rule in its own header, and PRE-P1-29 extends the rule rather than
loosening it: adding a _choice_ among authorised memberships must not add a _claim_ the browser
makes.

**One active tenant per request is retained.** The multi-company change is that one identity may
choose among authorised memberships before the request's tenant context is finalised — not that a
request may straddle two tenants.

### P-4 — Frontend visibility is not authorization

Hiding a menu item is a usability act. The server's denial is the only denial that means anything.
The web helper already enforces the failure direction that makes this safe — unknown means denied,
no role shortcuts, exact membership (`apps/web/src/lib/permissions.ts:39,47,49`) — and no screen
added by this initiative may introduce a client-side administrator flag, a role-name test, or a
tenant identifier read from client state.

### P-5 — Authorization is by permission, never by role name

Stated in the catalogue itself (`supabase/seeds/04_iam_permission_catalog.sql:10-12`). There is no
wildcard permission and none may be introduced. This constrains the Superadmin work directly: a
control-plane principal cannot be implemented as "an actor that holds everything", because no such
permission exists to hold.

### P-6 — Bootstrap may not be implemented by weakening a check

The Superadmin bootstrap authority is a distinct control-plane principal. It is explicitly **not**:

- a tenant Company Owner with extra permissions;
- the first user in the database granted implicit powers;
- a hard-coded email address or domain;
- a client-side flag;
- a code path that disables delegation containment (G-9) or bypasses row-level security.

### P-7 — No fake, demo or mock business data ships

Unchanged and permanent. It is the reason G-7 is a real problem rather than a theoretical one: a
new environment genuinely has no roles, so bootstrap must create them rather than assume them.

---

## 5. The nine waves

Waves are ordered by dependency, not by convenience. A wave may not begin while an input it needs
is still a question.

| Wave | Name                                       | Produces                                                                                                                                | Lane       |
| ---- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A    | Discovery                                  | The finding register, the decision register, and the measured baseline of §3. Changes no product code.                                  | initiative |
| B    | Platform administration Backend            | The control-plane principal and the bootstrap operations that bring a tenant into existence.                                            | backend    |
| C    | Company RBAC Backend                       | Tenant-side company, branch and department administration; the named, reach-scoped lists that P-1 requires.                             | backend    |
| D    | Identity, membership and tenant resolution | Global identity → membership → tenant resolution, membership choice after authentication, and the deletion of the tenant-hint remnants. | backend    |
| E    | Workflow authority                         | Who may act where across the operational workflow, including the tenant-scope short-circuit of G-8.                                     | backend    |
| F    | Superadmin web                             | The control-plane surface, separated from every tenant screen.                                                                          | web        |
| G    | Company administration web                 | Company, branch, department and role administration inside a tenant; the human selectors; the two broken navigation guards of G-14.     | web        |
| H    | Workflow UI                                | The administration-side workflow surfaces — role editing, grant scoping, membership switching. Not work-order execution.                | web        |
| I    | Owner QA                                   | Owner acceptance by hand, against a production build, with an explicit written Pass.                                                    | initiative |

### Wave A — Discovery

Establishes what exists before anything is built. Its output is the register in §3 plus the open
decisions it surfaces. It writes documentation, tooling and tests only. A wave A finding is not a
licence to fix: a fix belongs to the lane that owns the file.

### Wave B — Platform administration Backend

The bootstrap problem in one sentence: a freshly replayed database holds 112 permissions, zero
roles, zero grants and no user account (G-7), so there is no actor who could create the first one.
Wave B introduces the control-plane principal that can, under the constraints of P-5 and P-6, and
the operations by which it creates a first tenant, its first legal company, its first branch, its
first Company Owner and that owner's initial role and grant set.

Wave B must also decide, and record, how a control-plane action is audited. It is the most
privileged path in the product and it is the one path no tenant administrator can review.

### Wave C — Company RBAC Backend

The five orphaned administration permissions of G-4 acquire the operations they were written for,
and the department table of G-6 acquires a way in. Wave C also owes P-1 its input: an operation that
returns the companies and branches an actor may reach, **by name**, so that a selector can be built
without a typed identifier and without leaking the existence of places the actor cannot reach.

Any permission a wave C operation needs is seeded by wave C, in the seeds bucket, and moves the
baseline count of G-2 in the same change.

### Wave D — Identity, membership and tenant resolution

Today one external identity is confined to one tenant by an index that carries no tenant (G-10).
That index is the mechanism, and any change to it is a data-integrity decision with a migration
attached — it is not a refactor. Wave D establishes membership as a first-class concept, resolves
the active tenant from the authenticated identity and the chosen membership, and keeps the
one-active-tenant-per-request rule of P-3.

Wave D also deletes the tenant-hint helpers of G-16. They are dead — no caller exists in the API
source, the web source or the web tests — and while they exist they describe a design the product
has rejected. The deletion is already written: commit `d502e07f` on the local-only branch
`feature/pre-p1-29-web-coverage-and-tenant-hint` removes all three helpers, and it is not an
ancestor of `develop`, so wave D's job is to land it rather than to author it (§9).

### Wave E — Workflow authority

Wave E is about _authority over_ the workflow, not the workflow itself. Its central technical
question is G-8: 167 published operations declare tenant scope across 132 route files, and for every
one of them the HTTP layer asks the scope-blind question rather than the scoped one, leaving
containment entirely to the SQL function and row-level security. That may be correct, it may be a
defect, or it may be correct for some of the 167 and wrong for others. Wave E must settle it per
operation and record the answer.

The boundary test for wave E is the one in §6: it may change who may perform an existing action; it
may not create a new action in the work-order domain.

### Wave F — Superadmin web

The control-plane surface. It must be visibly and structurally separate from tenant administration:
a Company Owner must not be able to reach it, and a control-plane operator must not silently be
holding a tenant role. Visibility is driven by capability, per P-4, and the capability comes from
the Backend.

### Wave G — Company administration web

The tenant administration tree already exists — eleven screens under
`apps/web/src/app/[locale]/(dashboard)/administration/`, one per subdirectory: `approval-limits`,
`audit-log`, `currencies`, `languages`, `numbering-rules`, `organization`, `permissions`, `roles`,
`system-settings`, `taxes` and `users`. With the administration index page beside them the directory
holds twelve `page.tsx` files. Wave G extends it with company, branch and department administration,
and builds the named selectors P-1 requires on top of the wave C reads.

Wave G also fixes G-14. The two navigation entries name codes the catalogue does not contain, which
makes them invisible to everyone, permanently and silently. The correct codes are seeded and
spelled differently.

### Wave H — Workflow UI

The administration-side workflow surfaces: editing a role, scoping a grant, switching membership,
seeing which branches an actor reaches. These are screens over wave C, D and E contracts. No screen
in wave H may ship against a contract that does not exist — the web lane cannot change API source
(§7), which is the structural enforcement of that rule.

### Wave I — Owner QA

Owner acceptance by hand, against a **production build** — never a development server, which
manufactures spurious authentication failures through a side-effect singleton and would make an
acceptance run untrustworthy. That is measured, not cautionary: `next dev` compiles a route bundle
on first request while the API's authenticator is a module-level singleton installed as a side
effect of composing the IAM module inside the login handler, so on one checkout with one valid token
`GET /api/v1/receptions` answered 200 while `GET /api/v1/vehicles` and `GET /api/v1/work-orders`
answered 401 `ERR-IAM-002`, and a second `next dev` process refused a different subset entirely
(`docs/phase-1/phase-1-28/evidence/change-log.md:517-536`). The initiative closes on an explicit
written Pass and on nothing else. Silence is not a Pass
(`docs/phase-1/phase-1-28/closure-record.md:44`).

---

## 6. Hard boundary — P1-29 is not started

**Phase 1-29 must not be started by this initiative.** P1-29 is the Work Order, Diagnostics and
Technicians phase. Its boundary was already fixed when P1-28 was planned:

> P1-28 ends where the work order begins. — `docs/phase-1/phase-1-28/canonical-plan.md:220-231`

That paragraph reserves to P1-29 all work-order execution, technician boards and diagnostics
authoring: work-order editing, assignment, department routing, progress recording, and diagnostic
findings of any kind. The requirement table for P1-29 lives at
`docs/product/owner-workflow-requirements.md:220-239` and the read-model expectations at
`docs/phase-1/phase-1-9/p1-29-frontend-contract.md`, whose opening paragraph (`:3-4`) records that
Phase 1-9 is database-only and states in bold that **no frontend is implemented in that phase** —
that is, the contract is a read-model specification P1-29 will render, not a P1-29 deliverable
already begun.

Concretely excluded from PRE-P1-29:

| Excluded                                                 | Belongs to |
| -------------------------------------------------------- | ---------- |
| Work-order boards, lists and detail screens              | P1-29      |
| Job and assignment authoring                             | P1-29      |
| Technician profile and availability screens              | P1-29      |
| Diagnostic authoring, computer-scan capture, findings    | P1-29      |
| Progressive work logging and start/pause/resume/complete | P1-29      |
| Quality-control and closure-gate screens                 | P1-29      |
| Work-evidence media capture                              | P1-29      |
| New operational actions in the work-order domain         | P1-29      |

**The test to apply, when a wave E or wave H task looks like it might be over the line:** does the
change let someone do something that could not be done before, or does it decide who may do
something that already could be? The first is P1-29. The second is PRE-P1-29.

There is one deliberate adjacency. Departments (G-6) are named by P1-29's requirements _and_ are a
grant-scoping dimension the authorization model already carries. PRE-P1-29 may build the department
administration — creating, naming and listing departments, and scoping a grant to one — because
that is organisational structure and authority. It may not build department **routing** of work,
which is a work-order behaviour.

---

## 7. Ownership lanes

Three ownership profiles govern this initiative, and they are enforced, not advisory. They live in
`scripts/ci/check-phase-ownership.mjs` at lines 372, 398 and 429. A file is classified into exactly
one bucket by first match, so the ordering of the classifier list matters as much as its contents.

### Buckets — which paths each name covers

| Bucket         | Paths                                                                                                                                                             | Defined at |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `webGenerated` | The single generated operations manifest, `apps/web/src/lib/api/idempotent-operations.ts`                                                                         | `:44-46`   |
| `webContract`  | Six literal files: the reception and appointment contract mirrors and their tests, plus the two P1-28 QA and security suites                                      | `:94-101`  |
| `web`          | Everything else under `apps/web/`                                                                                                                                 | `:103`     |
| `apiSource`    | `apps/api/src/`                                                                                                                                                   | `:104`     |
| `apiConfig`    | Everything else under `apps/api/` — package manifest, compiler settings                                                                                           | `:105`     |
| `migrations`   | `supabase/migrations/`                                                                                                                                            | `:106`     |
| `dbSeeds`      | `supabase/seeds/` — including the permission catalogue                                                                                                            | `:114`     |
| `supabase`     | Everything else under `supabase/` — the local database harness                                                                                                    | `:115`     |
| `docs`         | `docs/` and top-level all-caps markdown (`/^[A-Z]+\.md$/` — `README.md`, `SECURITY.md`, `CONTRIBUTING.md`; a mixed-case root `.md` falls through to `rootConfig`) | `:116`     |
| `tooling`      | `scripts/` and `.github/`                                                                                                                                         | `:117`     |
| `tests`        | `tests/`                                                                                                                                                          | `:118`     |
| `rootConfig`   | Repository-root files, the editor directory, the container files                                                                                                  | `:119-126` |

The three narrow buckets exist so a Backend lane can carry the files a _publication_ forces it to
touch — a regenerated manifest, a contract mirror row asserted by an exhaustiveness test — without
opening the handwritten web tree.

### Lane permissions

| Bucket         | `pre-p1-29-initiative` | `pre-p1-29-backend` | `pre-p1-29-web` |
| -------------- | ---------------------- | ------------------- | --------------- |
| `apiSource`    | may change             | may change          | **forbidden**   |
| `apiConfig`    | **forbidden**          | **forbidden**       | **forbidden**   |
| `migrations`   | may change             | may change          | **forbidden**   |
| `dbSeeds`      | may change             | may change          | **forbidden**   |
| `supabase`     | **forbidden**          | **forbidden**       | **forbidden**   |
| `web`          | may change             | **forbidden**       | may change      |
| `webGenerated` | may change             | may change          | **forbidden**   |
| `webContract`  | may change             | may change          | may change      |
| `docs`         | may change             | may change          | may change      |
| `tooling`      | may change             | may change          | may change      |
| `tests`        | may change             | may change          | may change      |
| `rootConfig`   | may change             | may change          | may change      |

The reasons, recorded in the profiles themselves:

- **The Backend lane may not carry screens.** A lane that could change both halves of an
  administration contract would let a screen and the contract it renders land in one unreviewed
  commit. The screens are a separate change under the web lane
  (`scripts/ci/check-phase-ownership.mjs:420-422`).
- **The web lane may not carry a migration or a seed.** A permission that a role editor offers is
  seeded by the Backend lane that publishes the operation guarding it — not by the screen that
  displays it (`:442-447`).
- **The web lane may not hand-edit the generated manifest.** It is generated from the Backend
  register; a hand edit desynchronises the two (`:439-441`).
- **No lane may change the API workspace configuration.** A dependency or compiler change is its own
  review, not a rider on an administration feature (`:389-391`).
- **No lane may change the database harness.** The permission catalogue the initiative genuinely
  needs travels under its own seeds bucket, which is a different question with a different answer
  (`:392-395`, and the reasoning at `:107-113`).

The initiative profile is broader than either lane because it is the **integration** branch. It is
not a licence to bypass a lane: work is done in the lane that owns it and integrated afterwards.
The integration profile exists so that an integration merge does not fail ownership by carrying
both halves of work each of which was reviewed in its own lane.

---

## 8. Baseline at the time of writing

| Fact                                           | Value                                  | Evidence                                                                                                        |
| ---------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Migrations on `develop`                        | 124                                    | `supabase/migrations/`; pinned at `.github/ci-baselines/schema-baseline.json:6`                                 |
| Seeded permissions                             | 112, across 17 domain prefixes         | `supabase/seeds/04_iam_permission_catalog.sql:15-331`; pinned at `.github/ci-baselines/schema-baseline.json:14` |
| Published operations, all modules              | 305                                    | `defineOperation({…})` blocks in `apps/api/src`                                                                 |
| Published identity-and-access operations       | 38                                     | `apps/api/src`                                                                                                  |
| Published organisation operations              | 0                                      | `apps/api/src` — no operation id begins `org.`                                                                  |
| Operations declaring tenant scope              | 167, in 132 route files                | `apps/api/src/app/api/v1/**/route.ts`                                                                           |
| Tenant administration screens                  | 11, plus the administration index page | `apps/web/src/app/[locale]/(dashboard)/administration/` — 12 `page.tsx` files                                   |
| Superadmin or platform-administrator principal | none, anywhere                         | 0 hits for `super[ _-]?admin` in `apps/api/src`, `apps/web/src`, `supabase/migrations`, `supabase/seeds`        |

`develop` and the branch this was measured on (`chore/pre-p1-29-seal-archival-lifecycle`) carry an
identical `apps/api/src`, `apps/web/src` and `supabase/` tree — `git diff develop HEAD` over those
three paths is empty — so every figure above holds for both.

---

## 9. Claims that could not be settled, and one that was reconciled

Recorded here rather than smoothed over, because a scope document that quietly repairs its own
inputs is worse than one that names the disagreement.

**Reconciled — the tenant-hint removal exists, on a branch that has not landed.** The briefing for
this document stated that the dead tenant-hint helpers had been removed from
`apps/web/src/lib/api/session-cookie.ts`, completing a carried P1-26 follow-up. Both halves of the
disagreement are now measured, and neither party was simply wrong.

On the branch this document was written from (`chore/pre-p1-29-seal-archival-lifecycle`) and on
`develop`, the helpers are present: the cookie name at `:43`, the reader at `:87`, the writer at
`:123`. They are equally present on `chore/pre-p1-29-admin-rbac-ownership` and on
`feature/pre-p1-29-multi-tenant-administration-rbac-workflow`. They are also dead on all four: no
caller exists in `apps/api/src`, `apps/web/src` or `apps/web/tests`.

The removal the briefing described is real and is in this checkout. Commit `d502e07f`
("test(pre-p1-29): land the deferred coverage debt, and finish P1-26's carried removal", 2026-08-22)
deletes all three helpers: `git show --numstat` reports `0 31` on that file, taking it from 151
lines to 120. (The commit message says "151 lines to 121"; the tree says 120, and the tree is the
measurement.) The commit sits on `feature/pre-p1-29-web-coverage-and-tenant-hint`, which is the
**only** branch containing it, is **not** an ancestor of `develop`, and exists **only locally** —
`git branch -a` lists no `origin` ref for it. So the briefing described work that was done and not
landed, and G-16 describes the state of every branch that has landed. Wave D lands it.

**Not settled — whether the tenant-scope short-circuit (G-8) is a defect.** The code is
unambiguous and measured; its _correctness_ is not, because it depends on whether row-level security
and the scope-resolving SQL function independently contain every one of the 167 tenant-scoped
operations. That is wave A discovery work and wave E adjudication work. Nothing in this document
asserts either answer. What would settle it: a per-operation determination of whether the scoped
question and the scope-blind question can ever differ for that operation's target.

**Not settled — whether the external-identity uniqueness index (G-10) should change.** The index
is the mechanism that confines an identity to one tenant. Whether multi-company identity is
delivered by changing that key, by introducing a separate identity record above the tenant-scoped
account, or by a membership table that spans them, is a wave D design decision with a migration
attached. This document records the constraint, not the remedy.
