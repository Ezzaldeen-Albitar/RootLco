# PRE-P1-29 — Wave B control-plane design, second pass

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** design only, **revision 4**. No product code exists against it.

Revision 1 was attacked by a bounded adversarial pass: 39 concerns across six lanes, 19 raised at
critical or high, every one independently refuted, **16 fell and 3 survived** — all three high, no
critical. This revision repairs those three and the substantive medium findings beside them, and
records each repair where it lands rather than in a changelog nobody reads. Section 22 lists what
changed, including two sentences revision 1 asserted as fact that the repository disproves.

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

**Revision 1 gave the wrong reason here, and the reason matters.** It argued that the existing
administration policies would _refuse_ a platform insert. They would not. Every policy in this
repository is permissive — `AS RESTRICTIVE` appears **zero** times across all 650 `CREATE POLICY`
statements — and permissive policies combine with OR. An existing policy cannot refuse anything; it
can only decline to admit. A new permissive policy `TO app_runtime` carrying a platform predicate
would therefore have been admitted, and revision 1's first argument collapses.

The conclusion survives on two different and better grounds.

**First: because policies OR, containment must be written rather than inherited.** Attaching a
platform predicate to `app_runtime` does not create a second, separate path — it _widens
`app_runtime` itself_. Every ordinary tenant session runs as `app_runtime`, so the platform write
path would become reachable from the ordinary request surface, guarded only by application code.
That is the shape the delegation backstop exists to defend against
([`20260727090000_iam_grant_delegation_scope_backstop.sql:28-31`](../../../supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql)).

**Second: the platform path would inherit `app_runtime`'s entire grant set** — every table privilege
the whole product holds — when what it needs is a handful of writes into identity and organisation
tables and nothing else. The role is the unit of least privilege, and reusing `app_runtime` abandons
it.

Reusing one of the **other** existing archetypes is disposed of on the same least-privilege ground
rather than left unaddressed. `app_readonly` holds no write privilege at all and exists to be
read-only. `app_worker` is the outbox drain identity, deliberately carrying an all-tenant policy on
one queue table
([`20260718106000:369-374`](../../../supabase/migrations/20260718106000_shared_event_outbox.sql)).
Attaching a control plane to either widens an identity whose whole value is its narrowness, and
merges two subjects that ought to be separately revocable.

What remains true, and is why the platform path cannot reuse the existing administration policies as
they stand: each is predicated on `iam.has_permission(...)`
([`20260726090000_iam_org_runtime_administration_capabilities.sql:299-316`, `:370-385`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql)).
`iam.has_permission` returns false unless the acting principal holds an **active account in the
current tenant**
([`20260718097000_iam_context_and_permission_functions.sql:86-97`](../../../supabase/migrations/20260718097000_iam_context_and_permission_functions.sql)).

and a platform operator creating that tenant's first account cannot have one. So the platform path
needs policies of its own whatever role it runs as; the two grounds above decide that the role
should be its own too.

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

**A tenant role can never hold one**, for two independent reasons. A tenant administrator cannot map
a `platform.` code into a tenant role, because `ins_role_permissions_delegable` re-evaluates the
writer's own authority against the code being written
([`20260726090000:299-316`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql))
and no tenant actor holds one. And even if such a mapping existed it would confer nothing: §4.3
routes a `platform.` code to the platform resolver, which reads `iam.platform_grants` and never
consults `iam.role_permissions`. §5.3 governs the relation itself — a third barrier, not this one.

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

Both reads must be granted, and **revision 1 granted neither** — that was blocker B2. `iam.user_accounts`
forces row-level security
([`20260718090000_iam_user_accounts_and_profiles.sql:326-327`](../../../supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql));
its only select privilege and only select policy are for `app_runtime`/`app_readonly` (`:335-337`,
`:354`). A `SECURITY INVOKER` resolver called from inside a policy expression is evaluated as
`app_platform`, so without its own privilege it raises `insufficient_privilege` at executor start
rather than answering false — and every policy in §6.3 and §6.4 becomes unreachable. So:

| Read                  | Privilege                                           | Policy                                                                                                                                                 |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `iam.platform_grants` | `SELECT` to `app_platform`                          | the acting principal's own active rows                                                                                                                 |
| `iam.user_accounts`   | `SELECT (id, status, deleted_at)` to `app_platform` | `FOR SELECT TO app_platform USING (id = iam.current_user_id())` — one row, the operator's own, carrying no tenant term so it works in both §3.3 shapes |

The column-scoped read is deliberate: the resolver needs an existence-and-active test, not a person's
name or address. §6.1's prohibition is on tenant **business** tables, and this identity read is the
one named exception to it.

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

**And the rule is enforced rather than promised.** A prose prohibition that nothing checks is how the
"declared but never wired" defect class in this repository begins. Slice B1 ships a gate asserting
that no file under `apps/api/src` and no migration above 124 issues an insert, update or delete
against `iam.platform_grants`, and a test that fails when the gate is removed.

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
§6.6 states the test that would have to be met before one could be, and it is not met.

One named exception, and only one: the column-scoped read of `iam.user_accounts` that §5.2's
resolver requires — the operator's own row, three columns. It is an identity read, not a business
read.

And, specifically: **no privilege on any tenant business table.** Not on customers, vehicles,
appointments, receptions, work orders, invoices, payments, or any other domain table. The control
plane creates tenants and their first administrator; it does not read their business.

### 6.2 Provisioning — `platform.organization.provision`, first half

| Layer                | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                 | `app_platform`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Context              | Platform-origin (§3.3): tenant absent, acting principal set                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Function execute     | `org.provision_organization(jsonb, text)` — currently revoked from public and granted to no application role ([`20260717107000_org_provisioning.sql:281-282`](../../../supabase/migrations/20260717107000_org_provisioning.sql))                                                                                                                                                                                                                                                                                                                                                                                                                |
| Table writes         | The ten the function performs: `org.tenants` (`:132`), `org.tenant_status_history` (`:142`), `org.tenant_subscriptions` (`:158`), `org.legal_companies` (`:172`), `org.branches` (`:187`), `org.company_settings` (`:204`), `org.branch_settings` (`:214`), `org.tenant_feature_overrides` (`:226`), `shared.number_sequences` (`:242`), `shared.idempotency_keys` (`:270`)                                                                                                                                                                                                                                                                     |
| Table reads          | `shared.idempotency_keys` for the replay check (`:105-111`); `org.subscription_plans` for the plan lookup (`:147-152`); and every `RETURNING` target, because `RETURNING` is evaluated against the SELECT policy — `org.tenants` (`:132`), `org.legal_companies` (`:172`), `org.branches` (`:187`) and `org.tenant_subscriptions` (`:158`). Revision 1 named two of the six.                                                                                                                                                                                                                                                                    |
| Row-level policies   | New, for `app_platform`, on each of the ten. On `org.tenants` the insert check is `status = 'provisioning'` — the platform role may only ever create a tenant in the provisioning state, never a live one. On every child table the check is that the parent tenant is in that state. This is the **bootstrap window** and it recurs throughout §9.                                                                                                                                                                                                                                                                                             |
| Replay table         | Two new policies scoped to platform rows only: the tenant column absent **and** the operation name fixed to the provisioning one. Without them the platform role cannot use the replay protection at all, because the existing policies read `tenant_id = iam.current_tenant_id()` and the provisioning record is written with the tenant absent — the migration says so itself ([`20260725090000:355`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)). The narrowness matters: `app_platform` must not be able to read any tenant's replay records.                                                   |
| Activation           | The adapter **never** sets `tenant.activate`. That branch (`:254-261`) calls `org.change_tenant_status(..., 'active', ...)` inside the provisioning transaction, which would close the bootstrap window before §6.3 has run and leave a live tenant with no Owner. Activation is a separate, later act — §9.1. Revision 1 missed this entirely.                                                                                                                                                                                                                                                                                                 |
| Read predicates      | Stated, not left to “policies on each of the ten”. `shared.idempotency_keys`: the platform-row policy of the Replay table row below. `org.subscription_plans`: a plain read — the catalogue is platform reference data with no tenant column. The four `RETURNING` targets (`org.tenants`, `org.legal_companies`, `org.branches`, `org.tenant_subscriptions`): a `FOR SELECT` policy mirroring each table's insert predicate, so the role can read back exactly the rows it may create and nothing else                                                                                                                                         |
| Sequence access      | None required — identifiers are generated, not drawn from a sequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Trigger dependencies | The row-metadata trigger and the immutable-column guards on those tables. `shared.touch_row_metadata` calls `iam.current_user_id()` ([`0002_base_schemas.sql:195`](../../../supabase/migrations/0002_base_schemas.sql)), so the role needs EXECUTE on the context readers — §7.2, which revision 1 omitted.                                                                                                                                                                                                                                                                                                                                     |
| Audit                | §7 — and the moment matters. The platform-origin shape has no tenant setting (§3.3), while every audit policy compares the row's tenant against the current one (§7.1) and `fk_audit_records_tenant` references `org.tenants` ([`20260718095000:68-69`](../../../supabase/migrations/20260718095000_iam_audit_subsystem.sql)), so no audit row can exist before the tenant does. The provisioning audit event is therefore written **after** `org.provision_organization` returns, inside the same transaction, with the new tenant installed as context — the platform-on-target shape, entered mid-transaction. Revision 3 left this unstated |
| Rate limit           | §10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

`org.provision_organization` is **not rebuilt, not copied, and not modified.** It already provides
tenant, history, subscription, company, branch, settings, overrides, number sequences and replay
protection in one transaction, rolling all of it back on any failure, and it is `SECURITY INVOKER`
(`:278-280`). Wave B builds the legitimate path to it and nothing more.

### 6.3 First Owner bootstrap — `platform.organization.provision`, second half

| Layer                | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                 | `app_platform`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Context              | Platform-on-target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Table writes         | `iam.user_accounts`, `iam.user_status_history`, `iam.roles`, `iam.role_permissions`, `iam.role_grants`, `iam.grant_scopes`. Revision 3 argued in prose that the status-history table is a write of this slice and then left it out of this list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Row-level policies   | New, for `app_platform`, each predicated on **both** the bootstrap window (target tenant in the provisioning state) **and** `iam.has_platform_authority('platform.organization.provision')`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Table reads          | `iam.role_grants` and `iam.grant_scopes` — not optional: `tg_role_grants_require_scope` ([`20260718092000:205-208`](../../../supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql)) reads `iam.role_grants` unconditionally as the writing role (`:183-184`), so a write-only grant aborts the bootstrap at commit. **And `iam.permissions`**, because `iam.role_permissions.permission_id` is a surrogate key with a foreign key into it ([`20260718091000:125`, `:138`](../../../supabase/migrations/20260718091000_iam_roles_and_permissions.sql)) — mapping the Owner role to permission _codes_ means resolving each code to its row first. The catalogue carries no tenant column, so the policy is a plain read with no tenant term |
| Trigger dependencies | **Two** deferred constraint triggers fire on the grant write, not one: `tg_role_grants_require_scope` and the delegation backstop of §9.3. Revision 1 named only the second.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| First Owner state    | The account is inserted `active` rather than taking the `invited` default ([`20260718090000:73`](../../../supabase/migrations/20260718090000_iam_user_accounts_and_profiles.sql)), because an invited account resolves zero permissions ([`20260718097000:91-97`](../../../supabase/migrations/20260718097000_iam_context_and_permission_functions.sql)) and would hand the Owner a tenant they cannot enter. That makes `iam.user_status_history` a write of this slice too, and its privilege is listed with the others. The Owner's provider identity is established out of band before the transaction opens, the pattern `scripts/dev/owner-acceptance/create-owner-account.mjs` already uses.                                                     |
| Audit                | §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

The window is what makes this safe: it **closes on the tenant's first legal transition**
([`20260717101000_org_tenants.sql:211-216`](../../../supabase/migrations/20260717101000_org_tenants.sql)
gives two exits, to `active` and to `closed`), and the moment it does, every one of these policies
stops admitting a row.

Revision 1 called that "self-closing, with no second mechanism to remember", and blocker **B3** showed
the phrase was doing work the design had not earned: §6.4 handed the same role an unpredicated
`UPDATE (status)`, so it could put a live tenant _back_ to `provisioning` and reopen the window. The
window only closes if nothing can reopen it. §6.4 and §15's M3 now make that true.

### 6.4 Lifecycle — `platform.organization.lifecycle`

| Layer                  | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                   | `app_platform`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Context                | Platform-on-target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Table reads            | `org.tenants`. **Mandatory, and the third instance of the same class:** `org.change_tenant_status` is `SECURITY INVOKER` ([`20260717101000:181`](../../../supabase/migrations/20260717101000_org_tenants.sql)) and its first statement is `SELECT status INTO v_from FROM org.tenants WHERE id = p_tenant_id FOR UPDATE` (`:199`), so the row lock runs with this role’s privileges. The table forces row-level security (`:239`) and its only select path is `sel_tenants_self ... TO app_runtime, app_readonly` (`:245-247`) with `GRANT SELECT` to those two roles (`:259`) — neither covers `app_platform`. Revision 2 added a reads row to §6.2 and §6.3 and left this one out                                                                                                                                                                                                                           |
| Read privilege         | `GRANT SELECT ON org.tenants TO app_platform` under `FOR SELECT TO app_platform USING (iam.has_platform_authority('platform.organization.read') OR iam.has_platform_authority('platform.organization.lifecycle') OR iam.has_platform_authority('platform.organization.provision'))` — written out rather than described, because “satisfiable by any platform authority” is not a predicate an implementer can copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Function execute       | `org.change_tenant_status(...)`, currently granted to no application role ([`20260717101000:232-235`](../../../supabase/migrations/20260717101000_org_tenants.sql))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Table writes           | `org.tenants` status **column only**, and `org.tenant_status_history`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Column-level grant     | `GRANT UPDATE (status)`, column-scoped in the shape the repository already uses ([`20260726090000:174`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql)) — but note that grant deliberately withholds `status`, so this is a new privilege and not a precedent for itself                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Row-level policies     | **Two policies, on two tables.** On `org.tenants`: `USING (iam.has_platform_authority('platform.organization.lifecycle'))` **and a `WITH CHECK` restricting the destination to `('active','suspended','closed')`** — `provisioning` is refused outright. A `FOR UPDATE` policy with only a `USING` clause reuses it as the check, which is how revision 1 admitted `status = 'provisioning'`. On `org.tenant_status_history`: a `FOR INSERT` policy of its own — see the row below                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Second write           | **`org.tenant_status_history`, and §6.2's policy cannot serve it.** `org.change_tenant_status` updates the parent at [`20260717101000:219`](../../../supabase/migrations/20260717101000_org_tenants.sql) and inserts the history row two statements later at `:221-224`; plpgsql advances the command counter between them, so the child policy's subquery reads the **already-updated** parent. §6.2's child rule is “the parent tenant is in the provisioning state”, and the graph (`:210-217`) never has `provisioning` as a destination — so that predicate is false for **every** lifecycle transition. The table forces row-level security (`:241`) with one `SELECT` policy (`:249-251`) and one `SELECT` grant (`:260`), and `:262-264` records insert, update and delete as deliberately absent. Left as revision 3 had it, every transition fails `42501` and rolls the status change back with it |
| Second write privilege | `GRANT INSERT ON org.tenant_status_history TO app_platform`, under its own `FOR INSERT` policy predicated on the authority and the destination — `WITH CHECK (iam.has_platform_authority('platform.organization.lifecycle') AND to_state IN ('active','suspended','closed'))` — so a history row can never record a transition the parent's own check would have refused. It is a second permissive policy alongside §6.2's, not a replacement: §6.2's remains correct for the provisioning path, where the tenant row is inserted first and takes the `provisioning` default ([`20260717107000:132-143`](../../../supabase/migrations/20260717107000_org_provisioning.sql))                                                                                                                                                                                                                                  |
| Table backstop         | The policy is the second line of defence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Trigger dependencies   | `tg_tenants_touch_metadata` (`:124-126`) calls `shared.touch_row_metadata`, which calls `iam.current_user_id()` — EXECUTE required, §7.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Actor                  | Server-derived; the function's actor parameter is **not** bound from the request — §8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Refusal shape          | Two steps, and §11 is only the first. §11 validates the identifier’s **form**; the route must then **resolve** the target — confirm the tenant exists and the operator may reach it — and answer §11’s non-disclosing refusal when it does not, so the function’s `no_data_found` is never the response a caller sees. Revision 3 attributed both steps to §11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Audit                  | §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 6.5 Organisation read — `platform.organization.read`

Revision 1 declared this operation in §4.2 and §12.2 and then gave it no privilege graph. It has one.

| Layer              | Requirement                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Role               | `app_platform`                                                                                |
| Context            | Platform-origin for a list, platform-on-target for one tenant                                 |
| Table reads        | `org.tenants` only                                                                            |
| Row-level policies | `FOR SELECT TO app_platform USING (iam.has_platform_authority('platform.organization.read'))` |
| Writes             | None                                                                                          |
| Audit              | A read is not audited; the rate limit and the denial path are its controls                    |
| Rate limit         | §10                                                                                           |

It reads the tenant root and nothing beneath it. A control-plane operator can see that a tenant
exists and what state it is in; they cannot see its customers, its vehicles or its work.

### 6.6 On `SECURITY INVOKER`

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

| Step                                                                                       | What it needs                                                                                   | Currently granted to                    |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| Insert the record header (`:199`)                                                          | `INSERT` on `iam.audit_records` + an insert policy                                              | `app_runtime` only (`:260`, `:264-266`) |
| Insert masked detail rows (`:207-213`), masking each value through the helper (`:211-212`) |
| Read the chain's last link (`:193-197`)                                                    | `SELECT` on `iam.audit_integrity_links` + the chain policy                                      | `app_runtime` only (`:293-295`)         |
| Read back the row just written (`:222`)                                                    | `SELECT` on `iam.audit_records` and `iam.audit_record_details` under the writer-scoped policies | `app_runtime` only (`:274-291`)         |
| Insert the chain link (`:232`)                                                             | `INSERT` on `iam.audit_integrity_links` + policy                                                | `app_runtime` only (`:262`, `:270-272`) |

If the read-back fails the function raises `insufficient_privilege` and names the missing path
(`:224-227`). That is the failure C1 predicted, spelled out by the code itself.

### 7.1 The tables

`app_platform` receives the three insert privileges, **the matching `SELECT` privileges on all three
tables** — a policy grants nothing without one, and the step table above shows two of the writer's
five steps are reads — the two writer-scoped read policies, and the chain read policy — each written for the new role and each predicated on the row's tenant matching
the current one, exactly as the runtime's are. This is also why a platform action is performed inside
the target tenant's context (§3.3): without it there is no lawful audit row to write.

### 7.2 The called functions — blocker B1

Revision 1 granted `EXECUTE` on the writer and stopped. That was **blocker B1**, and the repository
had already written down the rule it broke, three lines above the grants it should have copied:

> `iam.audit_append` is SECURITY INVOKER, so its three helpers execute with the caller's privileges
> too. All four were REVOKEd from PUBLIC when they were created; these are the only grants they
> carry. — [`20260725090000:112-115`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)

So the grant list is four functions, not one, plus the context readers. And because §14's gate and
P-24 both size themselves from this table, it lists **every** `EXECUTE` that `app_platform` receives
anywhere in this design, including the ones other sections introduce. One table, or the gate is built
from a partial list:

| Function                                                                              | Why the platform role needs it                                                                                                                                                                                                                                                                                                   | Revoked at                                                                                      | Granted today to                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb)` | the writer                                                                                                                                                                                                                                                                                                                       | [`20260718095000:306-307`](../../../supabase/migrations/20260718095000_iam_audit_subsystem.sql) | `app_runtime` (`20260725090000:121-123`)                                                               |
| `iam.audit_mask(text, text)`                                                          | called per detail row (`:211-212`)                                                                                                                                                                                                                                                                                               | [`20260718095000:226`](../../../supabase/migrations/20260718095000_iam_audit_subsystem.sql)     | `app_runtime` (`20260725090000:124`)                                                                   |
| `iam.audit_canonical(uuid)`                                                           | called for the read-back (`:222`)                                                                                                                                                                                                                                                                                                | `20260718095000:227`                                                                            | `app_runtime` (`:125`)                                                                                 |
| `iam.audit_hash(bytea, text)`                                                         | called to extend the chain (`:230`)                                                                                                                                                                                                                                                                                              | `20260718095000:228`                                                                            | `app_runtime` (`:126`)                                                                                 |
| `iam.current_user_id()`                                                               | the §5.2 resolver's policy predicate; `org.provision_organization` (`20260717107000:121`); `org.change_tenant_status` (`20260717101000:193`); `shared.touch_row_metadata` (`0002_base_schemas.sql:195`), fired by every row-metadata trigger; and `iam.stamp_user_status_history` (`20260718090000:238`) on the §6.3 Owner write | [`0002_base_schemas.sql:164-169`](../../../supabase/migrations/0002_base_schemas.sql)           | `app_runtime`, `app_readonly` (`:171-178`); `app_worker` holds this one function (`20260718106000:76`) |
| `iam.current_tenant_id()`                                                             | **none of those four paths calls it** — it is required because every audit insert and select policy of §7.1 compares against it (`20260725090000:264-272`, `:274-295`). Revision 2 bundled it with the reader above and justified it with call sites that do not exist                                                           | `0002_base_schemas.sql:164-169`                                                                 | `app_runtime`, `app_readonly` (`:171-178`)                                                             |
| `iam.has_platform_authority(text)`                                                    | **this design's own resolver**, evaluated as `app_platform` inside every policy of §6.3, §6.4 and §6.5. Revision 2 specified it and granted it nowhere                                                                                                                                                                           | created and revoked from public by M1                                                           | — (new)                                                                                                |
| `org.provision_organization(jsonb, text)`                                             | §6.2                                                                                                                                                                                                                                                                                                                             | `20260717107000:281`                                                                            | no application role                                                                                    |
| `org.change_tenant_status(...)`                                                       | §6.4                                                                                                                                                                                                                                                                                                                             | `20260717101000:232-235`                                                                        | no application role                                                                                    |
| `org.change_company_status(...)`                                                      | §12.3, for the wave C operation that calls it                                                                                                                                                                                                                                                                                    | created and revoked from public by M3                                                           | — (new)                                                                                                |
| `iam.grant_delegation_within_authority(uuid)`                                         | §9.3 — reached through the deferred constraint trigger on the §6.3 grant write                                                                                                                                                                                                                                                   | `20260727090000:197`                                                                            | `app_runtime` (`:200`)                                                                                 |

**Deliberately withheld, named rather than merely omitted** — the convention of the migration this
rule is quoted from ([`20260725090000:378-400`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)):
`iam.audit_verify_chain` (a forensic routine, not a request-path capability), the three outbox
claim/complete/fail routines, `iam.change_user_status`, and every function in the business domains.
A list of withholdings is what makes a later over-grant visible; §14's presence check cannot see one.

Inlining is not an escape: every one of these carries `SET search_path = ''`, so PostgreSQL will not
inline them and the privilege is checked. Nothing is inherited either — no blanket grant and no
default-privilege statement exists anywhere in the series, and §9.3 positively requires
`app_platform` **not** be an `app_runtime` member.

The precedent for granting a context reader to a fourth archetype is the last line of the very block
§2 cites as the archetype pattern:
`GRANT EXECUTE ON FUNCTION iam.current_user_id() TO app_worker`
([`20260718106000_shared_event_outbox.sql:76`](../../../supabase/migrations/20260718106000_shared_event_outbox.sql)).

No existing gate would have caught the omission: the boot preflight probes only the writer
([`apps/api/src/server/db/capabilities.ts:59-65`](../../../apps/api/src/server/db/capabilities.ts)),
and the coverage matrix tests table privileges only
([`scripts/ci/rls-matrix.mjs:87`, `:221-224`](../../../scripts/ci/rls-matrix.mjs)). §14 owes a
function-privilege check as well as a role entry.

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

**Activation is not part of it, and must not be.** `org.provision_organization` carries an optional
activation branch: with `tenant.activate` set it calls `org.change_tenant_status(..., 'active', ...)`
inside the same transaction
([`20260717107000:254-261`](../../../supabase/migrations/20260717107000_org_provisioning.sql)).
Used here that would move the tenant out of `provisioning` **before** the Owner bootstrap of §6.3
runs — closing the bootstrap window inside the transaction that depends on it, and, if the bootstrap
were then skipped, producing exactly the live-tenant-with-no-Owner state §9.1 exists to prevent. The
adapter therefore never sets it, and activation is a separate later act under
`platform.organization.lifecycle`. Revision 1 did not notice this branch at all.

### 9.2 Why the bootstrap path is not a general way around delegation

Normal tenant delegation is **untouched**. `ins_role_permissions_delegable` and
`ins_role_grants_delegable` keep their current text
([`20260726090000:299-316`, `:370-385`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql)),
and after bootstrap a tenant administrator delegates under exactly the rules they do today.

The bootstrap path cannot become a general alternative because of four independent things, each
enforced rather than promised:

1. It is reachable only by `app_platform`, which the request path never uses for a tenant session.
   Note the correction in §2: this holds because the bootstrap policies are written `TO app_platform`
   and no ordinary session runs as that role — **not** because any policy refuses `app_runtime`.
   Policies are permissive and refuse nothing.
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

- **Positive control first**, in the same test: an unmutated bootstrap succeeds. Without it a red
  result proves only that something is broken.
- Remove the execute grant → bootstrap fails at commit, asserted on the **error message naming the
  function**, not on the error class: `42501` is raised by this trigger, by every row-level denial
  and by every missing grant alike, so a class assertion cannot tell them apart.
- Remove the bootstrap-window predicate → bootstrap succeeds against a tenant that is already live.
  This is the escalation the backstop does not catch for this role, and it is the one the window
  exists to prevent.
- Condition 2 of §9.2 needs its own database-level proof, because §4.3 refuses a missing platform
  authority in middleware before any statement runs — so a request-level test can never exercise it.
  Call the bootstrap writes directly as `app_platform` with no `iam.platform_grants` row and be
  refused.

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

Two caveats, both of which revision 1 got wrong by overstating the benefit.

**The security-relevant flag does not do what revision 1 said it does.** It is consulted on the
public-operation path; for a non-public operation the flag buys no additional signal by itself. The
reason to prefer `auth-adjacent` is its **key material**, not its flag. If a control-plane breach
should raise a security event, that has to be arranged explicitly and is an implementation
obligation of slice B9, not something reuse confers for free.

**Its rationale text describes unauthenticated traffic**, and a platform request is authenticated.
Keying an authenticated operator by address is conservative rather than wrong — it bounds an operator
who shares an address with others more tightly than necessary, and 10 per minute is generous for an
operation performed a handful of times a day. The honest response is to amend the rationale text in
the same change, so the catalogue does not describe a policy differently from how it is used.

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

One mismatch to close rather than inherit: the address validator and the context validator do not
accept the same strings. `request-context.ts:63` pins the variant and variant-version digits, while
the installed `zod`'s `.uuid()` is broader — so a value can pass address validation and then be
rejected when the context is built, producing an internal error where a validation refusal belongs.
Control-plane routes use a validator that matches `request-context.ts:63` exactly.

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

| #    | Attack                                                                                       | Where the design answers it                                                                                                                                  | Residual                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| T-1  | **A tenant administrator controls the account an operator authenticates with**               | §5.4 — disabling the account denies service; it cannot grant authority, because the resolver requires an active grant in a relation no tenant role can write | **Accepted, named.** Removed by wave D. The design's weakest point.                                                                 |
| T-2  | Company Owner grants themselves platform authority                                           | §5.3 — no product write path to the relation exists                                                                                                          | —                                                                                                                                   |
| T-3  | Forged platform claim in a request                                                           | §3.2 — authority is resolved from the relation, never from anything the client sends                                                                         | —                                                                                                                                   |
| T-4  | Absent narrowing lists silently widen a platform request                                     | §3.1, §6.1 — absence means no narrowing, so the design relies on `app_platform` holding **no grant** on any tenant business table rather than on the lists   | Attack this: enumerate what the role can actually reach                                                                             |
| T-5  | Tenant A's operator targets tenant B                                                         | §11 non-disclosing refusal; §5.2 the resolver consults no tenant, so there is nothing to confuse                                                             | —                                                                                                                                   |
| T-6  | Over-granted database role                                                                   | §6.1 explicit prohibitions; §14 the matrix must be taught the role or none of it is checked                                                                  | Attack this: the matrix change is the only thing making §6 verifiable                                                               |
| T-7  | A table grant present without its policy, or a policy without its grant                      | §6.2–§6.4 and §7 write both halves for every table                                                                                                           | —                                                                                                                                   |
| T-8  | A called function's execute privilege missing                                                | §7.2 names every called function by signature — the writer, its three helpers, and the two context readers that four separate paths depend on                | Revision 1 named only the writer. That was blocker B1                                                                               |
| T-8b | A resolver that cannot read its own inputs                                                   | §5.2 grants the column-scoped `iam.user_accounts` read and its policy                                                                                        | Revision 1 granted neither. That was blocker B2                                                                                     |
| T-24 | Provisioning activates the tenant and closes the bootstrap window inside its own transaction | §9.1 — the adapter never sets `tenant.activate`; activation is a separate later act                                                                          | Attack this: the branch at `20260717107000:254-261` is reachable from the request document if the adapter ever forwards it verbatim |
| T-26 | A policy written for one path is reused on another where its predicate is always false       | §6.4's second-write row gives `org.tenant_status_history` its own insert policy; §6.2's remains correct for the provisioning path only                       | This was instance 5. T-9 is the row that should have caught it, and did not                                                         |
| T-27 | The privilege gate cannot see a missing grant                                                | §14 — `rls-matrix.mjs:236-237` short-circuits on `!granted`, so slice B1 must assert presence as well as absence                                             | Attack this: it is why five under-grants survived review                                                                            |
| T-25 | The lifecycle privilege reopens the bootstrap window                                         |
| T-9  | A dead row-level path — a policy that can never be true                                      | §6.3's window is deliberately closable; §6.2's replay policies must be checked against the tenant-absent row shape                                           | Attack this: `N-5` was exactly this defect in the existing tree                                                                     |
| T-10 | A broad bypass policy                                                                        | §6.1 forbids; every policy above carries a real predicate                                                                                                    | —                                                                                                                                   |
| T-11 | Definer-rights shortcut                                                                      | §6.6                                                                                                                                                         |
| T-12 | Client-supplied actor                                                                        | §8 four rules                                                                                                                                                | —                                                                                                                                   |
| T-13 | Unthrottled high-authority operation                                                         | §10 reuse of a policy with pre-tenant key material                                                                                                           | —                                                                                                                                   |
| T-14 | Rate-limit key absent when the limiter runs                                                  | §10 — operation and address both exist before authentication completes                                                                                       | —                                                                                                                                   |
| T-15 | Malformed identifier reaching a statement                                                    | §11                                                                                                                                                          | —                                                                                                                                   |
| T-16 | Bootstrap deadlock — the first Owner needs an Owner                                          | §6.3 the window; §9.2                                                                                                                                        | —                                                                                                                                   |
| T-17 | Delegation bypass through the bootstrap path                                                 | §9.2's four conditions; §9.3 states the backstop is **not** one of them                                                                                      | Attack this: the honest statement is also the exposed one                                                                           |
| T-18 | Replay abuse — two tenants from one key, or a key that reveals another tenant's              | §6.2's narrow platform policies; §9.1                                                                                                                        | —                                                                                                                                   |
| T-19 | Half-provisioned tenant with no recoverable Owner                                            | §9.1 one transaction                                                                                                                                         | —                                                                                                                                   |
| T-20 | Audit write denied at run time                                                               | §7 full path                                                                                                                                                 | —                                                                                                                                   |
| T-21 | Audit rewritten or deleted                                                                   | §7 — no such privilege exists for any role, verified two ways                                                                                                | —                                                                                                                                   |
| T-22 | Duplicate operation or duplicate permission code                                             | §12.1, §12.2                                                                                                                                                 | —                                                                                                                                   |
| T-23 | A red test that passes with the feature removed                                              | §9.3 requires two proofs; §16 requires every mutation to change something                                                                                    | Attack this: it is the failure mode this repository has recorded most often                                                         |

---

## 14. Coverage, and the gate that cannot see the change

Finding `N-2`, and it is the reason §6 is worth writing at all.

`RUNTIME_ROLES` in [`scripts/ci/rls-matrix.mjs:81-85`](../../../scripts/ci/rls-matrix.mjs) is a
hard-coded list of three entries — the runtime, the read-only and the worker archetypes — and the
matrix iterates it at `:219`. A fourth role is invisible to it. Every grant in §6 would be
unverified by the gate whose job is to prove no role holds a privilege it should not.

**The migration that creates `app_platform` and the change that teaches the matrix about it are the
same change**, and the matrix change ships with a test that fails when the entry is removed.

Entering the role in that list buys less than revision 1 implied, and the difference matters. The
matrix has no allowlist, so adding the role buys the superuser and bypass checks, the forced-RLS
invariant, and grant-to-policy coherence. It does **not** enforce §6.1's prohibition on business
tables — that needs its own assertion — and it tests **table** privileges only
([`rls-matrix.mjs:87`, `:221-224`](../../../scripts/ci/rls-matrix.mjs)), so the function grants of
§7.2 fall outside it entirely.

And a third gap, which is the one that matters most here: the matrix **short-circuits on a missing
grant**. `if (!granted) { verdict = 'denied-by-grant' }` at [`rls-matrix.mjs:236-237`](../../../scripts/ci/rls-matrix.mjs)
returns before any policy check, so the gate detects **over**-granting and is structurally blind to
**under**-granting. Every one of the five instances in §22 was an under-grant. Slice B1's assertion
therefore has to run the other direction too — for each privilege §6 and §7 require, assert it is
present — or the gate will keep passing over exactly the defect this design kept making. Slice B1 therefore ships three things, not one: the role entry, a
business-table prohibition assertion, and a function-privilege check covering **all eleven** functions
§7.2 names.

Per C11, this document quotes no coverage figure. The figures below were each measured directly on
2026-08-22 at `fe81f3eb`, and the tenant-scope figure is the one revision 1 got wrong:

| Figure                                 | Value                                                                                                                                                               | How it was measured                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Migrations                             | 124                                                                                                                                                                 | file count under `supabase/migrations`                                                            |
| Seeded permission codes                | 112, across 17 domain prefixes                                                                                                                                      | `supabase/seeds/04_iam_permission_catalog.sql`                                                    |
| Published operations                   | 305                                                                                                                                                                 | `= defineOperation({` assignments under `apps/api/src`                                            |
| Operations resolving to tenant scope   | **170** across **136** files — 166 declaring it, 4 inheriting the default at [`operation-registry.ts:185`](../../../apps/api/src/server/auth/operation-registry.ts) | parse each `defineOperation` body and read its `scope`, counting an absent `scope` as the default |
| Operation identifiers beginning `org.` | 0                                                                                                                                                                   | two independent searches (register §2)                                                            |

Revision 1 said "180 declarations across 132 route files". That was a raw text scan: it counted the
literal `scope: 'tenant'` wherever it appeared, prose comments included, and it missed the four
operations that declare no scope and inherit the default. Both halves were wrong, in opposite
directions. Everything the change itself moves is stated as "moves", never as a predicted number.

---

## 15. Migrations

Additive only. The live count is 124
([`.github/ci-baselines/schema-baseline.json:6`](../../../.github/ci-baselines/schema-baseline.json));
every file below is numbered above it, and no applied file is edited.

| Migration | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**    | The `app_platform` role; `iam.platform_grants` with its constraints, triggers, forced row-level security and its read policy; `iam.has_platform_authority`; the schema-usage grants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **M2**    | The privilege graph of §6 and §7 — execute grants, table grants (column-scoped where §6.4 says so), and every new policy, each with its predicate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **M3**    | `org.company_status_history` and `org.change_company_status`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **M4**    | The `BEFORE UPDATE` transition backstop on `org.tenants`. **Its own migration, ordered before M2**, because M2 grants the privilege this trigger exists to bound and shipping the grant first leaves a window where the graph is unenforced. It fires only when the status is actually changing (`OLD.status IS DISTINCT FROM NEW.status`), so the runtime's existing three-column settings update ([`20260726090000:174`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql), policy `:423`) is untouched. It validates against the same graph as `org.change_tenant_status` (`20260717101000:210-217`), not against a destination list |

Seeds change once, in the seeds bucket: the three `platform.` codes of §4.2.

**Four baseline values move, not two.** The permission count and the domain count are the obvious
pair; `structuralTotals` and `schemaHash` in the same baseline file also move, because M1 to M3 add
a role, a relation, functions, policies and a trigger. `structuralTotals` cannot be reproduced on a
developer machine — local Supabase schemas inflate it — so it is re-recorded from the hosted clean
room, never from a local measurement. The re-record order is the one the repository already enforces:
regenerate, then record, then commit. Recording before the documents are green bakes a failure count
into the ledger, and the sequence never converges.

---

## 16. Proof plan

Every rule above owes a proof, and **no mutation is accepted if removing it changes nothing.**

Revision 1 claimed here that "each row states its own precondition so a passing test cannot be
vacuous". That was untrue of five of its rows, and the claim is withdrawn rather than repaired by
restating it. The rule is now narrower and checkable: **every row that mutates something also states
a positive control**, and a proof whose only assertion is a refusal must first name what it expected
to succeed. P-2 to P-5 and P-15 carry that control explicitly, because they are the rows the old
claim did not cover.

| #     | Mutation or case                                                                                                                          | Must produce                                                                                                                                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1   | Revoke the operator's platform grant                                                                                                      | The platform operation is refused                                                                                                                                                                                          |
| P-2   | Run the platform operation as `app_runtime` — control: the same call as `app_platform` succeeds                                           | Refused                                                                                                                                                                                                                    |
| P-3   | An ordinary authenticated tenant user calls it — control: a platform operator succeeds                                                    | Refused                                                                                                                                                                                                                    |
| P-4   | A Company Owner calls it — control: a platform operator succeeds                                                                          | Refused                                                                                                                                                                                                                    |
| P-5   | Forge a platform claim in the request — control: the same request from a real grant holder succeeds                                       | Refused; the relation is what decides                                                                                                                                                                                      |
| P-6   | Remove one table grant from §6                                                                                                            | The operation fails naming that exact privilege — not a generic error                                                                                                                                                      |
| P-7   | Remove one policy from §6                                                                                                                 | Refused, and the test names which                                                                                                                                                                                          |
| P-8   | Set both narrowing lists empty on a platform request, **then remove the positive tenant assignment**                                      | First: no widened row set, and nothing in a tenant's business tables becomes readable. Second: the request **fails** rather than succeeding broadly — revision 1 dropped this half, and it is the only half that can fail  |
| P-9   | Remove the rate-limit declaration from a platform operation                                                                               | A test turns red, not quiet                                                                                                                                                                                                |
| P-10  | Call a platform operation repeatedly                                                                                                      | The refusal is reached                                                                                                                                                                                                     |
| P-11  | Send a malformed target identifier                                                                                                        | The standard validation refusal; no database error                                                                                                                                                                         |
| P-12  | Send a forged actor in the request document                                                                                               | The recorded actor is the authenticated operator; the forged value appears nowhere                                                                                                                                         |
| P-13  | Same replay key, same request                                                                                                             | Replayed; nothing created                                                                                                                                                                                                  |
| P-14  | Same replay key, different request                                                                                                        | Refused                                                                                                                                                                                                                    |
| P-15  | Fail midway through provisioning — control: the unmutated run commits all of it                                                           | No tenant, no Owner, no replay record — nothing partial                                                                                                                                                                    |
| P-16  | Bootstrap a second Owner into the same tenant                                                                                             | Refused or replayed as designed; never a second conflicting Owner                                                                                                                                                          |
| P-17  | **Remove the bootstrap-window predicate**                                                                                                 | Bootstrap succeeds against a live tenant — proving the window, not the backstop, is the containment (§9.3)                                                                                                                 |
| P-18  | **Remove the backstop execute grant**                                                                                                     | Bootstrap fails with `insufficient_privilege` naming the function (§9.3)                                                                                                                                                   |
| P-19  | After bootstrap, delegate as a tenant administrator                                                                                       | Unchanged behaviour; the existing delegation tests still pass untouched                                                                                                                                                    |
| P-20  | Append an audit event as `app_platform`, then attempt to amend and to delete one                                                          | Append succeeds and reads back; both amendments refused                                                                                                                                                                    |
| P-21  | Company Owner acts on their own company, then on another                                                                                  | Accepted, then refused                                                                                                                                                                                                     |
| P-22  | A legal company transition, then an illegal one                                                                                           | Accepted, then refused; history appended in the first case only                                                                                                                                                            |
| P-23  | Remove the fourth role from the coverage matrix                                                                                           | The matrix test turns red (§14)                                                                                                                                                                                            |
| P-24  | Remove any one function grant of §7.2                                                                                                     | The operation fails naming **that function**, asserted on message text and never on error class — `42501` is raised by a trigger, by a row-level denial and by a missing grant alike                                       |
| P-25  | Remove the **column-scoped privilege** of §5.2, keeping the policy                                                                        | The authority check fails loudly. Revision 2 mutated the policy instead, which yields a zero-row read and a silent false — the opposite of what it asserted, and §5.2 attributes the loud failure to the missing privilege |
| P-25b | Remove the **policy**, keeping the privilege                                                                                              | The check answers false and the operation is refused. A silent failure by design, asserted as such so the two halves are distinguishable                                                                                   |
| P-26  | Control first: a legal transition succeeds. Then, as `app_platform` holding lifecycle authority, set a live tenant back to `provisioning` | Refused by the `WITH CHECK`; refused again by M4’s trigger with the policy removed and the grant present; and a bootstrap write against that tenant is still refused                                                       |
| P-26b | A transition the destination list admits but the graph forbids — `closed → active`, or `provisioning → suspended`                         | Refused **by M4’s trigger**, which is the only thing that catches it: the `WITH CHECK` is a destination whitelist, not the graph                                                                                           |
| P-26c | A settings-only update to `org.tenants` as `app_runtime`                                                                                  | Succeeds — M4’s trigger must not fire when the status is unchanged                                                                                                                                                         |
| P-27  | Pass `tenant.activate` through the provisioning adapter                                                                                   | The adapter refuses to forward it, and the tenant stays in `provisioning` until an explicit lifecycle call                                                                                                                 |
| P-28  | Insert into `iam.platform_grants` from API source or from a migration above 124                                                           | The §5.3 gate fails; removing the gate turns its own test red                                                                                                                                                              |
| P-29  | Revoke `EXECUTE` on `iam.has_platform_authority` from `app_platform`                                                                      | Every platform policy fails loudly rather than answering false                                                                                                                                                             |
| P-30  | Call the lifecycle operation holding **only** `platform.organization.lifecycle`                                                           |
| P-31  | Perform a full lifecycle transition end to end as `app_platform`                                                                          | Both writes commit: the status changes **and** a history row exists. Revision 3 would have failed this on the second write with `42501`                                                                                    |
| P-32  | Remove the `org.tenant_status_history` insert policy of §6.4                                                                              | The transition fails and the status change rolls back with it — proving the history write is load-bearing, not incidental                                                                                                  |

---

## 17. Company-Owner containment, integrated

The surviving lane is imported unchanged in premise (register §4) and bounded in reach here.

Scoped evaluation is **not** switched on globally. `requiresScopedEvaluation` returns false for a
tenant-scope operation whatever target is named
([`authorization.ts:62-65`](../../../apps/api/src/server/auth/authorization.ts)); **170 operations
across 136 files** are in that position (§14), and adjudicating them is wave E's job. Wave B changes
none of them.

**And wave B introduces no operation a Company Owner can reach.** All three are `platform.`
operations, outside every tenant. So the containment rule stands as the surviving lane's premise, but
this wave has nothing to prove it against: **P-21 and slice B8 move to wave C**, which introduces the
first Company-Owner-reachable administration operation. Revision 1 assigned them here, where they
would have passed vacuously.

One trap recorded for whichever wave runs P-21: its fixture Owner must hold a **company-scoped**
grant, because `narrowScope` skips the membership test for an unrestricted caller
([`resolve-context.ts:133`](../../../apps/api/src/server/context/resolve-context.ts)) — an
unrestricted fixture would prove nothing.

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

| Slice  | Contents                                                                                                                                                                     | Reviewable alone                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| B1     | The role, the relation, the resolver, and the coverage-matrix change (§5, §14)                                                                                               | Yes                                                  |
| B2     | Company status history and its transition function (§12.3)                                                                                                                   | Yes                                                  |
| B3     | The platform request context and its two shapes (§3)                                                                                                                         | Yes                                                  |
| B4     | Organisation read contract (§12.2). **Creates the `app_platform` SELECT privilege and policy on `org.tenants`** that §6.4 depends on too, so it must land before B5          | Yes                                                  |
| B5     | Lifecycle contract (§6.4)                                                                                                                                                    | Yes                                                  |
| B6     | The sanctioned path to the provisioning function (§6.2)                                                                                                                      | Yes                                                  |
| B7     | First-Owner bootstrap (§6.3, §9)                                                                                                                                             | Yes — and it should be, it is the highest-risk slice |
| ~~B8~~ | Company-Owner target containment — **moved to wave C** (§17): wave B introduces no operation a Company Owner can reach, so the slice and its proof would pass vacuously here | n/a                                                  |
| B9     | Published contract and security proofs (§16)                                                                                                                                 | Last                                                 |

Separate pull requests where the review boundary justifies it. No web tier. No work-order domain.

---

## 20. What this design does not decide

**Whether the tenant-scope short-circuit is a defect.** 170 operations across 136 files (§14), wave E.
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

Three bounded passes have run, and none has passed. Round 1 over revision 1: 39 concerns, 19 raised
at critical or high, 16 refuted, **3 survived** (B1, B2, B3 — all high). Round 2 over revision 2:
all three confirmed **closed**, and a **fourth** instance of the same class found. Round 3 over
revision 3: a **fifth**, inside the repair for the fourth. Each round has found strictly fewer, and
every finding has been the same defect class. The gate is unchanged:

```
CONFIRMED CRITICAL = 0
CONFIRMED HIGH     = 0
```

Implementation may begin only when a pass over **revision 4** returns that result, with every
other confirmed item either fixed here or recorded as a non-blocking dependency wave B does not rely
on. Revision 2 has been written; it has not yet been attacked.

---

## 22. What revision 1 got wrong

Kept rather than folded away, because the pattern in the errors is more useful than the corrections.

### The three blockers

| #      | What revision 1 said                                                                                                                        | Why it was wrong                                                                                                                                                                                                                                                                                         | Where it is fixed                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **B1** | §7 called itself "the writer's whole body" and granted `EXECUTE` on `iam.audit_append` alone                                                | The writer is `SECURITY INVOKER` and calls three helpers, each revoked from public and granted only to `app_runtime`. Four separate paths also reach the context readers. The repository states this rule in prose three lines above the grants revision 1 should have copied (`20260725090000:112-115`) | §7.2, and a function-privilege check in §14 |
| **B2** | §5.2 said the resolver "reads two tables and no more", and §5.1 specified the read for one of them                                          | `iam.user_accounts` forces row-level security with a select path for `app_runtime`/`app_readonly` only. A `SECURITY INVOKER` resolver called from inside a policy is evaluated as `app_platform`, so it raises rather than answering false — making every policy in §6.3 and §6.4 unreachable            | §5.2, §6.1                                  |
| **B3** | §6.3 called the bootstrap window "self-closing, with no second mechanism to remember", while §6.4 granted an unpredicated `UPDATE (status)` | A `FOR UPDATE` policy with only a `USING` clause reuses it as the check, so `status = 'provisioning'` passed. The role could reopen the window on a live tenant, and the transition graph lives only inside a function a raw update never enters                                                         | §6.3, §6.4, M3 in §15, P-26                 |

### Two sentences asserted as fact that the repository disproves

**"The administration policies would refuse the insert."** They would not. All 650 policies in the
tree are permissive — `AS RESTRICTIVE` appears zero times — and permissive policies OR. An existing
policy declines to admit; it cannot refuse. §2 now gives the two real reasons for a separate role,
and §9.2 condition 1 is restated on the same footing.

**"180 declarations across 132 route files."** A raw text scan, counting prose comments and missing
the four operations that inherit the default scope. The measured figure is 170 across 136, and §14
now names the method beside every number it quotes.

### The pattern

Every one of the three blockers is the same defect seen from a different angle: **the design
enumerated privileges one level shallower than the `SECURITY INVOKER` call chains it was granting.**
That is the same class as C1 — the finding revision 1 was written to close — reappearing inside the
fix for it. All three fail closed, and each contradicted a sentence the document stated as fact, which is why
they were blocking rather than cosmetic. B1 and B2 are repaired by additive grant and policy lines.
B3 needed more than the `WITH CHECK` an earlier draft of this paragraph claimed: that clause is a
**destination whitelist**, and `closed → active` or `provisioning → suspended` both pass it. Only
M4's trigger enforces the graph — which is why it is now its own migration, ordered ahead of the
grant it bounds.

### The class recurred a third time

A bounded re-attack on revision 2 confirmed **B1, B2 and B3 all closed** — and then found the same
defect once more, in the one place revision 2 had not touched: §6.4 gave the lifecycle operation its
writes and never enumerated the **read** that `org.change_tenant_status` performs under the caller's
own privileges. Three rounds, three instances, one lesson:

> In this repository, granting a role access to an invoker-rights function means walking its whole
> body in both directions — every write, every read, every called function, every trigger it fires —
> and not stopping at the entry point.

§7.2 is now a single consolidated execute surface for exactly that reason, and §6.2, §6.3 and §6.4
each carry a reads row.

### And a fifth time — inside the repair for the fourth

The class sweep over revision 3 built the privilege closure of all four operations from source and
diffed it against the document. It found instance 5 in §6.4, the section revision 3 had just written
to close instance 4: the section walks `org.change_tenant_status` far enough to **name** both of its
writes, and supplies grant-and-policy for only the first. The second was left to §6.2's
bootstrap-window rule, which the status update two statements earlier makes false for every
transition the graph permits.

That is a variant worth naming separately, because it is not "an element nobody listed" — it is **an
element listed and then covered by a policy written for a different path**. The design's own T-9
("a dead row-level path — a policy that can never be true") is the row that should have caught it.

Revision 4 repairs it, and §14 now records why no gate would have: `rls-matrix.mjs:236-237`
short-circuits on a missing grant, so the repository's privilege gate detects over-granting and is
structurally blind to under-granting — which is what all five instances were.

Revision 4 has been written; it has not been attacked.

### What the pass could not check

Nothing was executed. No role, relation, resolver or migration exists, so every privilege conclusion
here is reasoning over documented database semantics rather than measured behaviour. Several
findings turn on predicates this document states in prose whose exact form an implementer has not
yet written — where one plausible implementation would be safe and another would not, the trap is
recorded rather than the verdict. And revision 1's own proof plan was defective in five rows, so
"the proofs will catch it" is a weaker argument here than it reads.
