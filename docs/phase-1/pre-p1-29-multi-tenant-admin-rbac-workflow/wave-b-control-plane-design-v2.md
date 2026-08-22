# PRE-P1-29 — Wave B control-plane design, second pass

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** design only. No product code exists against it. It has not yet been attacked.

---

## 1. What this document is, and the rule it obeys

The first Wave B control-plane design was rejected on twelve confirmed findings. This is the
replacement. It is written **before** implementation so that a fresh adversarial pass can read an
artefact rather than a recollection, which is what the first pass did not have and is the most
likely reason it failed.

Its companion is
[wave-b-control-plane-refutation-register.md](wave-b-control-plane-refutation-register.md), which
freezes all twelve findings with their evidence and their disposition, and adds eight more that this
pass produced. **Read the register first.** Three of its new findings decide this design, and
without them the choices below look arbitrary.

Every claim about current behaviour carries `path:line`, measured against `fe81f3eb` with 124
migrations applied. No figure appears that was not measured; where a figure would have to be
predicted, the document says so instead.

**This document decides nothing about Phase 1-29, and nothing about the web tier.**

---

## 2. The decision everything else follows from

Directive §8 asks whether a fourth database role archetype is right, and forbids assuming it. The
answer is that it is not merely right — it is **forced**, and the reason is the policy layer rather
than a preference about role design.

Every administration write policy in the identity schema is written `TO app_runtime` and predicated
on `iam.has_permission(...)`
([`20260726090000_iam_org_runtime_administration_capabilities.sql:299-316`, `:370-385`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql)).
`iam.has_permission` returns false unless the acting principal holds an **active account in the
current tenant**
([`20260718097000_iam_context_and_permission_functions.sql:86-97`](../../../supabase/migrations/20260718097000_iam_context_and_permission_functions.sql)).

A platform operator creating a tenant's first account cannot, by definition, already hold an account
in it. So:

| If the platform path runs as…                  | …then                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `app_runtime`, acting principal = the operator | the permission resolver returns false; the administration policy refuses the insert |
| `app_runtime`, acting principal absent         | the permission resolver returns false for the same reason, one layer earlier        |
| **a separate role**                            | the administration policies do not apply to it at all, and it needs its own         |

The third is the only live option. `N-1` in the register works this through against the delegation
backstop's three early exits and reaches the same place.

**So: one new database role, `app_platform`, following the existing archetype pattern**
([`0002_base_schemas.sql:62-74`](../../../supabase/migrations/0002_base_schemas.sql),
[`20260718106000_shared_event_outbox.sql:65-76`](../../../supabase/migrations/20260718106000_shared_event_outbox.sql)):
no login, no superuser, no ability to create databases or roles, **no bypass of row-level
security**, no ownership of any object, and every privilege an explicit per-object grant.

And one consequence that must ship in the same change: the repository's row-level-security matrix
iterates a hard-coded list of exactly three roles
([`scripts/ci/rls-matrix.mjs:81-85`](../../../scripts/ci/rls-matrix.mjs)), so a fourth role's grants
would be checked by nothing. See §14.

---

## 3. The platform request context

### 3.1 What a platform request is, and what it is never inferred from

A platform principal is **positively established** or it does not exist. It is never inferred from
an absent tenant, an absent narrowing list, an address, a stored browser value, or anything the
client can set.

That prohibition is not a style preference. The two context readers are **asymmetric**, and the
first-pass design was built on the belief that they were not:

| Reader                      | Absent value means                                                       | Source                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `iam.current_tenant_id()`   | **deny** — a policy comparing a tenant column against it matches nothing | [`0002_base_schemas.sql:108-115`](../../../supabase/migrations/0002_base_schemas.sql), stated in its own comment at `:156` |
| `iam.allowed_company_ids()` | **no narrowing** — the reach is not reduced                              | `:128-141`, stated in the function body at `:135-136`                                                                      |
| `iam.allowed_branch_ids()`  | **no narrowing**                                                         | `:143-153`                                                                                                                 |

Emptying the two narrowing lists therefore widens rather than denies. Nothing in this design uses
the absence of a value to express the absence of authority.

### 3.2 The request path

```
request
  → authenticate the identity through the canonical path (unchanged)
  → resolve platform authority from iam.platform_grants          §5
  → establish the PLATFORM request context                        §3.3
  → authorize exactly one platform operation                      §4
  → validate every target identifier                              §11
  → install the narrow database execution context                 §3.3
  → execute                                                       §6, §9
  → audit                                                         §7
```

Authority resolution happens **before** any tenant context exists, and target validation happens
**before** any context is installed. A missing platform grant fails closed at step two, with the
repository's uniform denial and no disclosure of whether the addressed tenant exists.

### 3.3 Two context shapes, and why there have to be two

The existing machinery cannot express a request without a tenant: `buildRequestContext` requires and
validates both a principal user and a principal tenant
([`apps/api/src/server/context/request-context.ts:88-93`](../../../apps/api/src/server/context/request-context.ts)),
and `applyContext` sets both database settings on every transaction
([`apps/api/src/server/db/transaction.ts:91-105`](../../../apps/api/src/server/db/transaction.ts)).
That is finding `N-3`.

Pulling the other way, an audit event **cannot** be written outside a tenant context: the writer
refuses an absent tenant outright
([`20260725090000_iam_shared_runtime_write_capabilities.sql:181-183`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)),
and all three insert policies check the row's tenant against the current one (`:264-272`). That is
`N-6`.

So there are two shapes, and the second is the normal one:

| Shape                  | Used by                                           | Tenant setting                                                           | Acting-principal setting   | Narrowing lists |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- | --------------- |
| **Platform-origin**    | provisioning only — the tenant does not exist yet | absent                                                                   | the authenticated operator | absent          |
| **Platform-on-target** | every other platform operation                    | **the target tenant, positively, after §4 authorized that exact target** | the authenticated operator | absent          |

Both run as `app_platform`. Neither is `app_runtime`, so no tenant policy admits either by accident.
The narrowing lists stay absent in both, and — because absent means _no narrowing_, not _no reach_ —
that is safe **only** because `app_platform` holds no grant on any tenant business table. §6 is
where that is enforced, and §13 attacks it.

The platform-origin shape needs one addition to the request-context type: a context whose tenant is
legitimately absent. It is a distinct type, not an optional field on the existing one, so no
tenant-path caller can be handed one by mistake.

---

## 4. Authorization vocabulary, and the registry rule that stays

### 4.1 The registry guard is untouched

Registration refuses a non-public operation that declares no permission codes
([`apps/api/src/server/auth/operation-registry.ts:135-141`](../../../apps/api/src/server/auth/operation-registry.ts)).
That guard is the **only** thing making the state unreachable: `evaluatePermissions` returns allowed
for an empty code list, because an empty conjunction is true
([`apps/api/src/server/auth/authorization.ts:92-124`](../../../apps/api/src/server/auth/authorization.ts)).

So the guard is not relaxed, and an empty list never means platform authority. Platform operations
declare real codes and satisfy the existing rule.

### 4.2 Three permission codes, and why not more

The catalogue carries no tenant column
([`20260718091000_iam_roles_and_permissions.sql:48-66`](../../../supabase/migrations/20260718091000_iam_roles_and_permissions.sql)),
and its code-format rule already admits a `platform.` prefix (`:62-63`). The vocabulary is therefore
reused; only the **assignment** of platform authority needs something new (§5).

| Code                              | Covers                                                                                    | Why it is not merged into another                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.organization.provision` | Creating a tenant with its first company and branch, **and** establishing its first Owner | These are one act. Splitting the authority would allow creating tenants nobody can use, or placing an Owner into a tenant the actor did not create. §9 keeps them in one transaction, so one authority is the honest description. |
| `platform.organization.read`      | Listing and reading tenants from the control plane                                        | A read-only operator is a real need. Folding it into provisioning would force full creation authority on anyone who may look.                                                                                                     |
| `platform.organization.lifecycle` | Suspending, reactivating and closing a tenant                                             | Destructive to a **live** tenant. Provisioning authority must not imply the power to suspend an existing customer.                                                                                                                |

Three codes, seeded in the seeds bucket, in the `platform` domain — which satisfies the domain
format rule (`:64`). The catalogue holds **112** codes across **17** domain prefixes today
(`supabase/seeds/04_iam_permission_catalog.sql`, counted directly); this change moves both, and the
baseline pin at `.github/ci-baselines/schema-baseline.json:14` moves in the same commit. The
post-change figures are deliberately not stated here — per C11, a number appears when it is
measured.

**A tenant role can never hold one.** §5.3 is the mechanism.

### 4.3 How a platform operation declares its authority

Unchanged shape: `defineOperation({ permissions: ['platform.organization.provision'], … })`. What
changes is the **resolver**, because `iam.has_permission` structurally cannot answer a platform
question (finding `N-4`). The authorization middleware routes a `platform.`-prefixed code to
`iam.has_platform_authority(text)` (§5.2) and everything else to the existing functions, unchanged.

Two rules keep that fail-closed:

- An operation may not mix `platform.` codes with tenant codes. Mixed authority is two operations.
- An unrecognised authority kind is refused at registration, not at request time.

---

## 5. The platform authority relation

### 5.1 The smallest thing that works

The canonical model can express the _vocabulary_ but not the _assignment_: `iam.roles`,
`iam.role_grants` and `iam.user_accounts` all carry a mandatory tenant
([`20260718091000:85`](../../../supabase/migrations/20260718091000_iam_roles_and_permissions.sql),
[`20260718090000_iam_user_accounts_and_profiles.sql:68`](../../../supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql)).
So one narrow relation is added and nothing else. **No parallel identity system, no second
authentication path, no `platform_users`, no versioned copies of anything.**

**`iam.platform_grants`**

|                     |                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Records that one canonical account holds one platform permission                                                                                                                                                                                                                                              |
| Key                 | Surrogate identifier; unique on (account, permission) among rows not revoked                                                                                                                                                                                                                                  |
| Account reference   | Foreign key to `iam.user_accounts` — the operator authenticates through the ordinary path, with no change to authentication                                                                                                                                                                                   |
| Authority reference | Foreign key to `iam.permissions`, restricted by a check to codes beginning `platform.`                                                                                                                                                                                                                        |
| Status              | Active or revoked, with the revoking actor and the moment recorded                                                                                                                                                                                                                                            |
| Provenance          | Granting actor and moment, both mandatory, both server-derived                                                                                                                                                                                                                                                |
| Immutability        | The account, the permission and the creation columns are guarded by the existing immutable-column trigger (`org.guard_immutable_columns`, used the same way at [`20260718090000:116-118`](../../../supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql)). A grant is revoked, never edited. |
| Row-level security  | Enabled **and forced**, per the repository invariant ([`rls-matrix.mjs:208-217`](../../../scripts/ci/rls-matrix.mjs), exemption map empty at `:104`)                                                                                                                                                          |
| Who may read        | `app_platform` only, and only its own acting principal's rows                                                                                                                                                                                                                                                 |
| Who may write       | **Nobody through the product.** See §5.3.                                                                                                                                                                                                                                                                     |
| Audit               | Every read of it is incidental; every change to it is an out-of-band operator act with its own record                                                                                                                                                                                                         |
| Retention           | Permanent. A revoked grant is history.                                                                                                                                                                                                                                                                        |

It carries no tenant column, because platform authority is not a tenant's to hold.

### 5.2 The resolver

`iam.has_platform_authority(p_code text) returns boolean`, `SECURITY INVOKER`, empty search path,
mirroring `iam.has_permission`'s structure and its failure behaviour: false when the acting
principal is absent, false when the account is not active, false when the code is unknown, false
when no active grant matches. It reads two tables and no more — `iam.platform_grants` and
`iam.user_accounts` — and it never consults a tenant.

`iam.has_permission` is **not modified**. A platform question and a tenant question are answered by
different functions, and neither can be made to answer the other's.

### 5.3 Nobody can grant themselves platform authority

There is no product write path to `iam.platform_grants` at all. No operation writes it, no policy
permits an insert or an update by any application role, and `app_runtime` receives no privilege on
it. Establishing the first platform operator is an out-of-band operator act on a privileged
connection, exactly as tenant provisioning is today
([`scripts/db/provision-organization.mjs`](../../../scripts/db/provision-organization.mjs), which
refuses every environment except two named pilot gates).

That is deliberate and it is the answer to the escalation question: a Company Owner cannot delegate
`platform.*` because no delegation mechanism reaches the relation, not merely because a rule says
they should not.

### 5.4 The residual risk, named rather than designed away

The operator's account is an ordinary account in some tenant, and that tenant's administrator can
disable it. **That is a denial of service against the operator, not an escalation** — disabling an
account cannot grant platform authority, and the resolver requires the account to be active, so the
failure direction is closed.

It is still unpleasant, and this design does not remove it. What removes it is Wave D's global
identity, at which point the account becomes an identity with a platform membership and no tenant
administrator is in the path. Until then the operational recommendation — a runbook item, not a
schema rule — is that operator accounts live in a tenant reserved for them that holds no business
data.

**This is the design choice most worth attacking.** It is listed first in §13.

---

## 6. The database role, and the complete privilege graph

Directive §9 is the whole point of this section: a function is not reachable because `EXECUTE` was
granted. Each operation below is written as the full path.

### 6.1 What `app_platform` never receives

No superuser. No bypass of row-level security. No ownership of any object. No blanket privileges. No
generic always-true policy. No `SECURITY DEFINER` function is introduced anywhere in this design —
§6.5 states the test that would have to be met before one could be, and it is not met.

And, specifically: **no privilege on any tenant business table.** Not on customers, vehicles,
appointments, receptions, work orders, invoices, payments, or any other domain table. The control
plane creates tenants and their first administrator; it does not read their business.

### 6.2 Provisioning — `platform.organization.provision`, first half

| Layer                | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                 | `app_platform`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Context              | Platform-origin (§3.3): tenant absent, acting principal set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Function execute     | `org.provision_organization(jsonb, text)` — currently revoked from public and granted to no application role ([`20260717107000_org_provisioning.sql:281-282`](../../../supabase/migrations/20260717107000_org_provisioning.sql))                                                                                                                                                                                                                                                                                                                                                              |
| Table writes         | The ten the function performs: `org.tenants` (`:132`), `org.tenant_status_history` (`:142`), `org.tenant_subscriptions` (`:158`), `org.legal_companies` (`:172`), `org.branches` (`:187`), `org.company_settings` (`:204`), `org.branch_settings` (`:214`), `org.tenant_feature_overrides` (`:226`), `shared.number_sequences` (`:242`), `shared.idempotency_keys` (`:270`)                                                                                                                                                                                                                   |
| Table reads          | `shared.idempotency_keys` for the replay check (`:105-111`); `org.tenants` returned by the insert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Row-level policies   | New, for `app_platform`, on each of the ten. On `org.tenants` the insert check is `status = 'provisioning'` — the platform role may only ever create a tenant in the provisioning state, never a live one. On every child table the check is that the parent tenant is in that state. This is the **bootstrap window** and it recurs throughout §9.                                                                                                                                                                                                                                           |
| Replay table         | Two new policies scoped to platform rows only: the tenant column absent **and** the operation name fixed to the provisioning one. Without them the platform role cannot use the replay protection at all, because the existing policies read `tenant_id = iam.current_tenant_id()` and the provisioning record is written with the tenant absent — the migration says so itself ([`20260725090000:355`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)). The narrowness matters: `app_platform` must not be able to read any tenant's replay records. |
| Sequence access      | None required — identifiers are generated, not drawn from a sequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Trigger dependencies | The row-metadata trigger and the immutable-column guards already on those tables; none of them calls anything `app_platform` lacks                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Audit                | §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Rate limit           | §10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

`org.provision_organization` is **not rebuilt, not copied, and not modified.** It already provides
tenant, history, subscription, company, branch, settings, overrides, number sequences and replay
protection in one transaction, rolling all of it back on any failure, and it is `SECURITY INVOKER`
(`:278-280`). Wave B builds the legitimate path to it and nothing more.

### 6.3 First Owner bootstrap — `platform.organization.provision`, second half

| Layer                | Requirement                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                 | `app_platform`                                                                                                                                                                              |
| Context              | Platform-on-target: the tenant just created, set positively                                                                                                                                 |
| Table writes         | `iam.user_accounts`, `iam.roles`, `iam.role_permissions`, `iam.role_grants`, `iam.grant_scopes`                                                                                             |
| Row-level policies   | New, for `app_platform`, each predicated on **both** the bootstrap window (target tenant in the provisioning state) **and** `iam.has_platform_authority('platform.organization.provision')` |
| Trigger dependencies | The deferred delegation backstop fires on the grant write — §9.3                                                                                                                            |
| Audit                | §7                                                                                                                                                                                          |

The window is what makes this safe, and it is **self-closing**: the tenant's status leaves
`provisioning` by exactly one legal transition
([`20260717101000_org_tenants.sql:211-216`](../../../supabase/migrations/20260717101000_org_tenants.sql)),
and the moment it does, every one of these policies stops admitting a row. The platform role's write
path into a tenant's identity tables closes by itself, with no second mechanism to remember.

### 6.4 Lifecycle — `platform.organization.lifecycle`

| Layer              | Requirement                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | `app_platform`                                                                                                                                                                                                                                                                                            |
| Context            | Platform-on-target                                                                                                                                                                                                                                                                                        |
| Function execute   | `org.change_tenant_status(...)`, currently granted to no application role ([`20260717101000:232-235`](../../../supabase/migrations/20260717101000_org_tenants.sql))                                                                                                                                       |
| Table writes       | `org.tenants` status **column only**, and `org.tenant_status_history`                                                                                                                                                                                                                                     |
| Column-level grant | `GRANT UPDATE (status)` — the repository already does exactly this for the runtime's three settings columns ([`20260726090000:174`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql)), so the platform role can change a status and demonstrably nothing else |
| Row-level policies | New, predicated on `iam.has_platform_authority('platform.organization.lifecycle')`                                                                                                                                                                                                                        |
| Actor              | Server-derived; the function's actor parameter is **not** bound from the request — §8                                                                                                                                                                                                                     |
| Audit              | §7                                                                                                                                                                                                                                                                                                        |

### 6.5 On `SECURITY INVOKER`

Every function in this design is `SECURITY INVOKER`, and the design introduces none of its own
beyond `iam.has_platform_authority` and `org.change_company_status` (§12.3), both invoker.

The test a definer-rights function would have to pass, and does not: it would have to be impossible
to express the operation with explicit privileges. It is possible — §6.2 to §6.4 express it. Writing
the grants is more work than switching the security mode, which is exactly why the directive forbids
using the mode as a shortcut.

---

## 7. The audit privilege graph

Finding C1: `EXECUTE` on the writer is not enough, and the writer says so in its own error text.

`iam.audit_append` is `SECURITY INVOKER`
([`20260725090000:156-171`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)),
so the caller's privileges apply to the whole body:

| Step                                    | What it needs                                                                                   | Currently granted to                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| Insert the record header (`:199`)       | `INSERT` on `iam.audit_records` + an insert policy                                              | `app_runtime` only (`:260`, `:264-266`) |
| Insert masked detail rows (`:206`)      | `INSERT` on `iam.audit_record_details` + policy                                                 | `app_runtime` only (`:261`, `:267-269`) |
| Read the chain's last link (`:193-197`) | `SELECT` on `iam.audit_integrity_links` + the chain policy                                      | `app_runtime` only (`:293-295`)         |
| Read back the row just written (`:222`) | `SELECT` on `iam.audit_records` and `iam.audit_record_details` under the writer-scoped policies | `app_runtime` only (`:274-291`)         |
| Insert the chain link (`:232`)          | `INSERT` on `iam.audit_integrity_links` + policy                                                | `app_runtime` only (`:262`, `:270-272`) |

If the read-back fails the function raises `insufficient_privilege` and names the missing path
(`:224-227`). That is the failure C1 predicted, spelled out by the code itself.

**Design:** `app_platform` receives the three insert privileges, the two writer-scoped read
policies, the chain read policy, and `EXECUTE` on the writer — each written for the new role and
each predicated on the row's tenant matching the current one, exactly as the runtime's are. This is
also why a platform action is performed inside the target tenant's context (§3.3): without it there
is no lawful audit row to write.

**Deliberately absent, and asserted rather than assumed:** no `UPDATE` and no `DELETE` on any of the
three tables — none exists for any role today, verified two ways (register §2) — and no access to
the committed-history read path, which stays behind `iam.audit.view` through
`sel_audit_records_permitted`. The platform role may append its own event and read back the row it
is mid-way through writing. It may not browse, amend, or remove history, its own included.

---

## 8. Actor derivation

The authenticated platform principal is the actor. Always, and from the server.

The failure C5 names is real and is in shipped code: `org.provision_organization` derives its actor
as the session principal **or else** a value from the request document
([`20260717107000:121`](../../../supabase/migrations/20260717107000_org_provisioning.sql)), and
`org.change_tenant_status` does the same through its actor parameter
([`20260717101000:193-197`](../../../supabase/migrations/20260717101000_org_tenants.sql)). Leave the
session principal empty and the request document becomes the authority on who acted.

**Rules:**

1. The platform request context always sets the acting principal to the authenticated operator
   (§3.3). The fallback is therefore never reached.
2. No control-plane route binds an actor from the request. A request document carries **targets** —
   which tenant, which company, which branch, which Owner identity — and never authority.
3. The new company transition function takes **no actor parameter at all**, following
   `org.change_branch_status`
   ([`20260717103000:293-298`](../../../supabase/migrations/20260717103000_org_companies_branches.sql))
   rather than the tenant function. Finding `N-8`: of the two existing shapes, only the branch one
   cannot be handed a forged actor.
4. Neither existing function is modified. Their parameters remain for the out-of-band operator path
   that legitimately has no session. The rule binds the product path.

---

## 9. Provisioning, bootstrap, and the backstop

### 9.1 One transaction

Directive §17 prefers all-or-nothing, and here it is achievable: every side effect is a database
write. There is no message to send, so there is nothing that forces a second transaction.

Provisioning and first-Owner bootstrap therefore commit together or not at all. Nothing else
preserves the property that matters — **a tenant is never left live with no recoverable Owner** —
and the provisioning function already rolls its replay record back with its own failure
(`:278-280`), so a corrected retry starts clean rather than colliding.

The replay contract is unchanged and now covers the whole act: the same key with the same request
replays the stored result and creates nothing; the same key with a different request is refused.

### 9.2 Why the bootstrap path is not a general way around delegation

Normal tenant delegation is **untouched**. `ins_role_permissions_delegable` and
`ins_role_grants_delegable` keep their current text
([`20260726090000:299-316`, `:370-385`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql)),
and after bootstrap a tenant administrator delegates under exactly the rules they do today.

The bootstrap path cannot become a general alternative because of four independent things, each
enforced rather than promised:

1. It is reachable only by `app_platform`, which the request path never uses for a tenant session.
2. Its policies require `iam.has_platform_authority('platform.organization.provision')`.
3. Its policies require the target tenant to be in the provisioning state — a window that closes
   itself on the tenant's first legal transition.
4. A tenant actor, a Company Owner, and `app_runtime` are all outside it: none is `app_platform`,
   and none can obtain a platform grant (§5.3).

### 9.3 The delegation backstop, honestly

C3 said the platform role would be refused by the backstop and that the prescribed red test was
vacuous. Both halves are true, and the mechanism is not the one the finding described.

`iam.grant_delegation_within_authority` takes three early exits before evaluating anything
([`20260727090000:100-122`](../../../supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql)):
a bypassing role; a caller that is **not a member of `app_runtime`**; an absent acting principal.
`EXECUTE` is granted only to `app_runtime` (`:197-200`), so `app_platform` fails at the call with
`insufficient_privilege` before the body runs.

**Resolution (option A of directive §19):** grant `EXECUTE` to `app_platform`, and state the
consequence plainly rather than banking it as a guard. Because `app_platform` is not an
`app_runtime` member, the second early exit fires and the backstop **returns true unconditionally
for it**. That is the function's own design — it exists to constrain the request-path archetype —
and granting execute does not weaken it for the role it was written for.

But it means the backstop is **not** the platform path's containment. The containment is §9.2's four
conditions. Saying so is the difference between this pass and the last one.

**Two proofs are therefore required, and one alone is the vacuous proof again:**

- Remove the execute grant → bootstrap fails at commit with `insufficient_privilege` naming the
  function.
- Remove the bootstrap-window predicate → bootstrap succeeds against a tenant that is already live.
  This is the escalation the backstop does not catch for this role, and it is the one the window
  exists to prevent.

---

## 10. Rate limiting — reuse, not addition

`policyFor` returns a non-public operation's declared policy verbatim
([`apps/api/src/server/http/route-handler.ts:151-159`](../../../apps/api/src/server/http/route-handler.ts)),
and the declaration is optional
([`operation-registry.ts:81`](../../../apps/api/src/server/auth/operation-registry.ts)), so declaring
nothing means no limit at all.

Of the five catalogued policies
([`apps/api/src/server/http/rate-limit.ts:129-188`](../../../apps/api/src/server/http/rate-limit.ts)),
`expensive-read`, `standard-command` and `low-risk-metadata` key on tenant or user, which a
control-plane operation does not have when it runs. `public-probe` is not marked security-relevant.
`auth-adjacent` is 10 per minute, keyed by operation and client address, and **is** marked
security-relevant (`:130-139`).

**Every platform operation declares `auth-adjacent`. No new policy is added.** Its key material
exists before a tenant does, its security-relevant flag is what makes a breach a signal rather than
a counter, and the catalogue is pinned by four test files — a fifth name with identical semantics
would be cost with no benefit.

The one honest caveat: `auth-adjacent`'s stated rationale is about unauthenticated traffic, and a
platform request is authenticated. Keying an authenticated operator by address is conservative
rather than wrong — it bounds an operator who shares an address with others more tightly than
necessary, and 10 per minute is generous for an operation performed a handful of times a day. If
that ever bites, the answer is a documented rationale amendment, not a quieter policy.

---

## 11. Identifier validation

C8 is closed by the convention the repository already has, applied at the control plane.

Request context validates the **principal's** identifiers
([`request-context.ts:88-93`](../../../apps/api/src/server/context/request-context.ts)) — not a
target named in the address, which is what a control-plane route carries. The context readers cast
without a handler ([`0002_base_schemas.sql:108-152`](../../../supabase/migrations/0002_base_schemas.sql)),
so a malformed value reaching one surfaces a database error.

Every control-plane address parameter and every target identifier in a request document is validated
with the shared identifier rule
([`apps/api/src/server/http/validation.ts:194`](../../../apps/api/src/server/http/validation.ts)),
exactly as existing routes do
([`app/api/v1/vehicles/[vehicleId]/route.ts:44`](../../../apps/api/src/app/api/v1/vehicles/[vehicleId]/route.ts)),
**before** any context is installed and before any statement is issued. A failure becomes the
repository's standard validation refusal (`validation.ts:61-66`).

A well-formed identifier naming something the operator may not reach produces a non-disclosing
refusal — the same answer as a target that does not exist, so the control plane does not become an
oracle for which tenants exist.

---

## 12. Operations, naming, and permission reuse

### 12.1 Reuse before addition

Nine organisation permissions already exist
([`supabase/seeds/04_iam_permission_catalog.sql:16-24`](../../../supabase/seeds/04_iam_permission_catalog.sql)):
`org.tenant.read`, `org.company.read`, `org.company.manage`, `org.branch.read`, `org.branch.manage`,
`org.department.manage`, `org.settings.manage`, `org.tax.manage`, `org.subscription.manage`. **Wave
B adds none of them and duplicates none of them.** `org.department.read` is a genuine candidate but
belongs to wave C, which is where the operation that would need it lives; seeding it here would be a
code with no operation.

### 12.2 The naming matrix

There is no organisation module in the API — nineteen modules exist and none is named `org` — and
the existing organisation reads are declared under the identity module while the one status change
is declared under the shared module (finding `N-7`). Introducing an `org.` operation prefix would
mean a twentieth module, which directive §22 forbids doing for consistency's sake alone.

| Resource        | Existing operation                                                                                                                                                                                     | Existing permission       | Missing capability                          | Proposed operation                            | Module                                                                                                         | Why the existing one cannot be reused                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tenant          | `iam.tenant-settings-read` ([`org/tenant/route.ts:36`](../../../apps/api/src/app/api/v1/org/tenant/route.ts))                                                                                          | `org.tenant.read`         | Reading **another** tenant, from outside it | `platform.organization-read`                  | new `platform`                                                                                                 | The existing read returns the caller's own tenant. A control-plane read crosses the boundary the existing one is defined by. |
| Tenant          | —                                                                                                                                                                                                      | —                         | Creating one                                | `platform.organization-provision`             | new `platform`                                                                                                 | Nothing creates a tenant through the product today.                                                                          |
| Tenant          | —                                                                                                                                                                                                      | —                         | Suspending, reactivating, closing           | `platform.organization-lifecycle`             | new `platform`                                                                                                 | The transition function exists but is granted to no application role.                                                        |
| Company         | `iam.company-settings-read` ([`companies/[companyId]/settings/route.ts:37`](../../../apps/api/src/app/api/v1/org/companies/[companyId]/settings/route.ts))                                             | —                         | Company **status** change and its history   | wave C, identity module                       | Settings and lifecycle are different acts with different risk. Deferred — §12.3 builds the database half only. |
| Branch          | `shared.branch-status-change` ([`organization/branches/[branchId]/status/route.ts:47`](../../../apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts)), `iam.branch-settings-read` | `org.branch.manage`       | Nothing for wave B                          | —                                             | —                                                                                                              | Already complete for this wave's purposes.                                                                                   |
| Department      | —                                                                                                                                                                                                      | `org.department.manage`   | Creating, naming, listing                   | wave C                                        | —                                                                                                              | Out of wave B. The permission exists and its operation does not; that is wave C's stated job.                                |
| Subscription    | —                                                                                                                                                                                                      | `org.subscription.manage` | —                                           | —                                             | —                                                                                                              | Not required by wave B.                                                                                                      |
| Settings        | three reads above                                                                                                                                                                                      | `org.settings.manage`     | —                                           | —                                             | —                                                                                                              | Not required by wave B.                                                                                                      |
| Owner bootstrap | —                                                                                                                                                                                                      | —                         | Establishing a tenant's first Owner         | folded into `platform.organization-provision` | new `platform`                                                                                                 | One act with provisioning — §4.2.                                                                                            |

Three new operations, one new module prefix, and the prefix carries meaning: these are the only
operations in the product that are not inside a tenant.

### 12.3 Company status history

A real gap, and symmetrical with what already exists. Tenant has a transition function and an
append-only history
([`20260717101000:172`](../../../supabase/migrations/20260717101000_org_tenants.sql), table
`org.tenant_status_history`). Branch has both
([`20260717103000:293`](../../../supabase/migrations/20260717103000_org_companies_branches.sql),
table `org.branch_status_history`). Company has a status column
(`20260717103000:61`, constrained to active or inactive at `:82`) and **neither** — verified by
enumerating every `org.` table and every `org.` function in the migration series.

Wave B adds, by additive migration only:

- `org.company_status_history` — append-only, recording the previous state, the new state, the
  actor, the reason, the moment, and the tenant and company, modelled column-for-column on the
  branch history table.
- `org.change_company_status(...)` — row lock, transition-graph validation, status update and
  history append in one transaction, `SECURITY INVOKER`, **no actor parameter** (§8, finding `N-8`).

No route in wave B updates a company's status directly, and no operation exposes an arbitrary status
write. The tenant-side operation that calls this function is wave C's.

---

## 13. Threat model

Each row is an attack this design must survive. Every one is restated as an attack the refuter
should run; none is claimed to be closed by this document alone.

| #    | Attack                                                                          | Where the design answers it                                                                                                                                  | Residual                                                                    |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| T-1  | **A tenant administrator controls the account an operator authenticates with**  | §5.4 — disabling the account denies service; it cannot grant authority, because the resolver requires an active grant in a relation no tenant role can write | **Accepted, named.** Removed by wave D. The design's weakest point.         |
| T-2  | Company Owner grants themselves platform authority                              | §5.3 — no product write path to the relation exists                                                                                                          | —                                                                           |
| T-3  | Forged platform claim in a request                                              | §3.2 — authority is resolved from the relation, never from anything the client sends                                                                         | —                                                                           |
| T-4  | Absent narrowing lists silently widen a platform request                        | §3.1, §6.1 — absence means no narrowing, so the design relies on `app_platform` holding **no grant** on any tenant business table rather than on the lists   | Attack this: enumerate what the role can actually reach                     |
| T-5  | Tenant A's operator targets tenant B                                            | §11 non-disclosing refusal; §5.2 the resolver consults no tenant, so there is nothing to confuse                                                             | —                                                                           |
| T-6  | Over-granted database role                                                      | §6.1 explicit prohibitions; §14 the matrix must be taught the role or none of it is checked                                                                  | Attack this: the matrix change is the only thing making §6 verifiable       |
| T-7  | A table grant present without its policy, or a policy without its grant         | §6.2–§6.4 and §7 write both halves for every table                                                                                                           | —                                                                           |
| T-8  | A called function's execute privilege missing                                   | §7 enumerates the writer's whole body; §9.3 the backstop                                                                                                     | —                                                                           |
| T-9  | A dead row-level path — a policy that can never be true                         | §6.3's window is deliberately closable; §6.2's replay policies must be checked against the tenant-absent row shape                                           | Attack this: `N-5` was exactly this defect in the existing tree             |
| T-10 | A broad bypass policy                                                           | §6.1 forbids; every policy above carries a real predicate                                                                                                    | —                                                                           |
| T-11 | Definer-rights shortcut                                                         | §6.5                                                                                                                                                         | —                                                                           |
| T-12 | Client-supplied actor                                                           | §8 four rules                                                                                                                                                | —                                                                           |
| T-13 | Unthrottled high-authority operation                                            | §10 reuse of a policy with pre-tenant key material                                                                                                           | —                                                                           |
| T-14 | Rate-limit key absent when the limiter runs                                     | §10 — operation and address both exist before authentication completes                                                                                       | —                                                                           |
| T-15 | Malformed identifier reaching a statement                                       | §11                                                                                                                                                          | —                                                                           |
| T-16 | Bootstrap deadlock — the first Owner needs an Owner                             | §6.3 the window; §9.2                                                                                                                                        | —                                                                           |
| T-17 | Delegation bypass through the bootstrap path                                    | §9.2's four conditions; §9.3 states the backstop is **not** one of them                                                                                      | Attack this: the honest statement is also the exposed one                   |
| T-18 | Replay abuse — two tenants from one key, or a key that reveals another tenant's | §6.2's narrow platform policies; §9.1                                                                                                                        | —                                                                           |
| T-19 | Half-provisioned tenant with no recoverable Owner                               | §9.1 one transaction                                                                                                                                         | —                                                                           |
| T-20 | Audit write denied at run time                                                  | §7 full path                                                                                                                                                 | —                                                                           |
| T-21 | Audit rewritten or deleted                                                      | §7 — no such privilege exists for any role, verified two ways                                                                                                | —                                                                           |
| T-22 | Duplicate operation or duplicate permission code                                | §12.1, §12.2                                                                                                                                                 | —                                                                           |
| T-23 | A red test that passes with the feature removed                                 | §9.3 requires two proofs; §16 requires every mutation to change something                                                                                    | Attack this: it is the failure mode this repository has recorded most often |

---

## 14. Coverage, and the gate that cannot see the change

Finding `N-2`, and it is the reason §6 is worth writing at all.

`RUNTIME_ROLES` in [`scripts/ci/rls-matrix.mjs:81-85`](../../../scripts/ci/rls-matrix.mjs) is a
hard-coded list of three entries — the runtime, the read-only and the worker archetypes — and the
matrix iterates it at `:219`. A fourth role is invisible to it. Every grant in §6 would be
unverified by the gate whose job is to prove no role holds a privilege it should not.

**The migration that creates `app_platform` and the change that teaches the matrix about it are the
same change**, and the matrix change ships with a test that fails when the entry is removed.

Per C11, this document quotes no coverage figure. The figures that exist today and were measured
directly are: 124 migrations, 112 seeded permission codes across 17 domain prefixes, 305 published
operations, 180 declarations carrying tenant scope across 132 route files, and 0 operation
identifiers beginning `org.`. Everything the change moves is stated as "moves", not as a number.

---

## 15. Migrations

Additive only. The live count is 124
([`.github/ci-baselines/schema-baseline.json:6`](../../../.github/ci-baselines/schema-baseline.json));
every file below is numbered above it, and no applied file is edited.

| Migration | Contents                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**    | The `app_platform` role; `iam.platform_grants` with its constraints, triggers, forced row-level security and its read policy; `iam.has_platform_authority`; the schema-usage grants |
| **M2**    | The privilege graph of §6 and §7 — execute grants, table grants (column-scoped where §6.4 says so), and every new policy, each with its predicate                                   |
| **M3**    | `org.company_status_history` and `org.change_company_status`                                                                                                                        |

Seeds change once, in the seeds bucket: the three `platform.` codes of §4.2, moving the catalogue
count and the domain count together with the baseline pin.

---

## 16. Proof plan

Every rule above owes a proof, and **no mutation is accepted if removing it changes nothing.** Each
row states its own precondition so a passing test cannot be vacuous.

| #    | Mutation or case                                                                 | Must produce                                                                                               |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P-1  | Revoke the operator's platform grant                                             | The platform operation is refused                                                                          |
| P-2  | Run the platform operation as `app_runtime`                                      | Refused                                                                                                    |
| P-3  | An ordinary authenticated tenant user calls it                                   | Refused                                                                                                    |
| P-4  | A Company Owner calls it                                                         | Refused                                                                                                    |
| P-5  | Forge a platform claim in the request                                            | Refused; the relation is what decides                                                                      |
| P-6  | Remove one table grant from §6                                                   | The operation fails naming that exact privilege — not a generic error                                      |
| P-7  | Remove one policy from §6                                                        | Refused, and the test names which                                                                          |
| P-8  | Set both narrowing lists empty on a platform request                             | No widened row set; nothing in a tenant's business tables becomes readable                                 |
| P-9  | Remove the rate-limit declaration from a platform operation                      | A test turns red, not quiet                                                                                |
| P-10 | Call a platform operation repeatedly                                             | The refusal is reached                                                                                     |
| P-11 | Send a malformed target identifier                                               | The standard validation refusal; no database error                                                         |
| P-12 | Send a forged actor in the request document                                      | The recorded actor is the authenticated operator; the forged value appears nowhere                         |
| P-13 | Same replay key, same request                                                    | Replayed; nothing created                                                                                  |
| P-14 | Same replay key, different request                                               | Refused                                                                                                    |
| P-15 | Fail midway through provisioning                                                 | No tenant, no Owner, no replay record — nothing partial                                                    |
| P-16 | Bootstrap a second Owner into the same tenant                                    | Refused or replayed as designed; never a second conflicting Owner                                          |
| P-17 | **Remove the bootstrap-window predicate**                                        | Bootstrap succeeds against a live tenant — proving the window, not the backstop, is the containment (§9.3) |
| P-18 | **Remove the backstop execute grant**                                            | Bootstrap fails with `insufficient_privilege` naming the function (§9.3)                                   |
| P-19 | After bootstrap, delegate as a tenant administrator                              | Unchanged behaviour; the existing delegation tests still pass untouched                                    |
| P-20 | Append an audit event as `app_platform`, then attempt to amend and to delete one | Append succeeds and reads back; both amendments refused                                                    |
| P-21 | Company Owner acts on their own company, then on another                         | Accepted, then refused                                                                                     |
| P-22 | A legal company transition, then an illegal one                                  | Accepted, then refused; history appended in the first case only                                            |
| P-23 | Remove the fourth role from the coverage matrix                                  | The matrix test turns red (§14)                                                                            |

---

## 17. Company-Owner containment, integrated

The surviving lane is imported unchanged in premise (register §4) and bounded in reach here.

Scoped evaluation is **not** switched on globally. `requiresScopedEvaluation` returns false for a
tenant-scope operation whatever target is named
([`authorization.ts:62-65`](../../../apps/api/src/server/auth/authorization.ts)); 180 declarations
across 132 route files are in that position, and adjudicating them is wave E's job. Wave B changes
none of them.

For the administration operations this initiative introduces, containment is proven per operation:
the acting tenant, the target tenant, the target company and the target branch where applicable, with
target containment authoritative — a forged target identifier must not widen reach. The proof is
P-21, run for each.

---

## 18. Multi-company identity — the dependency, stated

The authorized direction is global identity → memberships → tenant → branches → roles and grants,
and wave D performs the migration. Wave B must not make that harder.

The mechanism that confines an identity to one tenant today is a unique index that carries no
tenant: `uq_user_accounts_provider_identity_active` on the provider and subject columns
([`20260718090000_iam_user_accounts_and_profiles.sql:109-110`](../../../supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql)).
Changing it is a data-integrity decision with a migration attached, and it is **not** wave B's.

Wave B's compatibility obligation, and how it is met: `iam.platform_grants` references an **account**
and carries no tenant of its own. When wave D introduces identity and membership, the relation is
repointed from account to identity by one additive migration, and nothing in §4 to §11 changes —
the resolver reads two tables, one of which is the relation itself.

No typed tenant identifier appears anywhere in this design, at sign-in or afterwards.

---

## 19. Implementation slices, once the gate passes

Not started, and not startable until the refuter reports zero confirmed critical and zero confirmed
high findings.

| Slice | Contents                                                                       | Reviewable alone                                     |
| ----- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| B1    | The role, the relation, the resolver, and the coverage-matrix change (§5, §14) | Yes                                                  |
| B2    | Company status history and its transition function (§12.3)                     | Yes                                                  |
| B3    | The platform request context and its two shapes (§3)                           | Yes                                                  |
| B4    | Organisation read contract (§12.2)                                             | Yes                                                  |
| B5    | Lifecycle contract (§6.4)                                                      | Yes                                                  |
| B6    | The sanctioned path to the provisioning function (§6.2)                        | Yes                                                  |
| B7    | First-Owner bootstrap (§6.3, §9)                                               | Yes — and it should be, it is the highest-risk slice |
| B8    | Company-Owner target containment (§17)                                         | Yes                                                  |
| B9    | Published contract and security proofs (§16)                                   | Last                                                 |

Separate pull requests where the review boundary justifies it. No web tier. No work-order domain.

---

## 20. What this design does not decide

**Whether the tenant-scope short-circuit is a defect.** 180 declarations, 132 route files, wave E.
Nothing here asserts an answer.

**Whether the identity uniqueness index should change, and how.** Wave D. §18 records the
constraint, not the remedy.

**Where operator accounts should live.** §5.4 recommends a reserved tenant as an operational
practice and deliberately does not encode it as a rule, because encoding it would create a tenant
row whose only purpose is to satisfy a schema constraint. If the refuter finds that the recommendation
is load-bearing rather than advisory, this becomes a design change and not a runbook line.

**Any coverage figure after the change.** It cannot be measured until the change exists (C11).

---

## 21. Gate

This design is not approved. It has been written, not attacked.

The next step is one bounded adversarial pass reading **this document and its register**, returning
`CONFIRMED` or `REFUTED` with evidence for every disposition C1 to C12, for the eight new findings,
and for the twenty-three attacks in §13. Implementation may begin only on:

```
CONFIRMED CRITICAL = 0
CONFIRMED HIGH     = 0
```

with every other confirmed item either fixed in the design or recorded as a non-blocking dependency
that wave B does not rely on.
