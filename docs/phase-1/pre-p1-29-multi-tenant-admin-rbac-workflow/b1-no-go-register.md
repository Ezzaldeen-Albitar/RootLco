# PRE-P1-29 Wave B, slice B1 — NO-GO register

Frozen at the NO-GO checkpoint.

| | |
| --- | --- |
| Branch | `feature/pre-p1-29-backend-b1-platform-authority-foundation` |
| HEAD at freeze | `3aa2e65555ba82833dd3d5569e9162857fccc8c6` |
| `origin/develop` | `c081a019535a50f3eec1cf3941814ba77c1da2d2` |
| `origin/main` | `25705d84fd81439fe8d6fdbbb863c55b44596619` |
| Migration count | 127 |
| `apps/web` files changed | 0 (committed and working tree) |
| P1-28 | ARCHIVED |
| P1-29 | NOT STARTED |

## Why this file exists

Every finding below was found by **executing** the tree, not by reading it, and
several of them contradict a claim that a comment or a test in this slice was
making at the time. A register that recorded only the repairs would lose the
part worth keeping: what the wrong version looked like, and why it read as
correct.

Status values: `OPEN`, `REMEDIATED` (fix implemented, re-proof pending),
`VERIFIED` (fix implemented and re-proved on a clean replay after the final
delta refuter), `WITHDRAWN` (the finding itself was wrong), `RECORDED` (real,
outside B1 scope, owned elsewhere).

---

## C1 — CRITICAL — readiness was satisfied by an owner who could do nothing

**Defect.** `org.tenant_has_recoverable_owner` required an active account and an
active in-window role grant, and stopped there. It never joined
`iam.role_permissions`. `iam.has_permission`
(`20260718097000_iam_context_and_permission_functions.sql:86-114`) resolves
`bool_or(rp.effect = 'allow') AND NOT bool_or(rp.effect = 'deny')` over exactly
that join, so a grant of an **empty role** satisfied readiness while
`iam.has_permission` answered false for every code.

**The claim it falsified.** The function's own docblock said it used "the same
conditions `iam.has_permission` requires … the same predicate the product itself
uses to decide whether somebody can do anything at all." That was materially
false and was written in this slice.

**Why it is a trap and not an inconvenience.** Once such a tenant is ACTIVE the
bootstrap window is shut, so `ins_role_permissions_platform_bootstrap` (which
requires `t.status = 'provisioning'`) cannot add the mapping; and the tenant-side
repair path `ins_role_permissions_delegable` requires `iam.role.manage`, which by
construction nobody in that tenant holds. The tenant can only be closed.

**How it survived.** The slice's own `establishOwner` fixtures created a role
with no permission mappings and the readiness suite asserted `true` for it — the
fixture encoded the same wrong definition the predicate did, so the two agreed.

**Status: REMEDIATED — and then REOPENED once, which is the part worth reading.**

The first repair required an effective allow on `iam.role.manage` and
`iam.grant.manage`. Those two were chosen by reasoning about what "recoverable"
ought to mean, and reasoning was not good enough: derived from the actual write
points, the minimum set is **three** codes.

| operation on the recovery path | policy | code |
| --- | --- | --- |
| create a role | `iam.roles / ins_roles_admin` | `iam.role.manage` |
| map a permission onto it | `iam.role_permissions / …_delegable` | `iam.role.manage` |
| grant the role to somebody | `iam.role_grants / ins_role_grants_delegable` | `iam.grant.manage` |
| **create that somebody** | `iam.user_accounts / ins_user_accounts_admin` | **`iam.user.manage`** |

The fourth row is not optional, for two independent reasons:

- `ck_role_grants_no_self_grant` is `CHECK (granted_by IS DISTINCT FROM user_id)`,
  so recovery cannot be performed on oneself and structurally needs a second
  account.
- `iam.user_accounts.status` defaults to `'invited'`, and `iam.has_permission`
  returns false for any account that is not `'active'`. An existing second
  account is inert until somebody activates it, and the only transition path,
  `upd_user_accounts_admin`, demands `iam.user.manage` as well.

So a holder of the first two codes can define authority and confer it, has nobody
to confer it on, and no way to make one. The predicate called that tenant
recoverable.

Three is the right number rather than an arbitrary one because the set is
**closed**: `ins_role_permissions_delegable` refuses to map a code the actor does
not itself hold, so an administrator can only reproduce authority they already
have. `{role.manage, grant.manage, user.manage}` is the smallest self-reproducing
set.

Independent corroboration, found afterwards rather than assumed: the shipped
application's last-holder guard at
`apps/api/src/modules/iam/application/access-administration-service.ts:479`
protects exactly those three codes. The predicate now matches the product's own
definition of the authority a tenant must never lose.

The grants must also be `scope_mode = 'unrestricted'`. `iam.has_permission`
ignores scope entirely, but `iam.grant_delegation_within_authority` refuses a
scoped actor creating an unrestricted successor — so a tenant whose only
administrators are branch-scoped cannot recover tenant-wide administration
however many codes they hold.

---

## H1 — HIGH — the invariant covered UPDATE and not INSERT

**Defect.** `tg_tenants_status_transition` was `BEFORE UPDATE` only. `pg_trigger`
on `org.tenants` carried exactly three triggers, all `BEFORE UPDATE`, and none on
INSERT. A row could therefore be created directly as `status = 'active'` with no
readiness check and no history row.

**The claim it falsified.** The migration header stated the invariant held "for
EVERY writer rather than only for callers of `org.change_tenant_status`". It held
for one verb out of two. On the INSERT door the only defence was the row-level
policy `ins_tenants_platform_provisioning`, which a `BYPASSRLS` connection walks
straight past.

**Reachability, demonstrated in-repo.** Three B1 suites and the shared
`tests/db/helpers.ts` seed all created ACTIVE ownerless tenants by direct INSERT.
When the guard was extended to INSERT, **124 of 147 DB test files failed** — that
count is the measure of how routine the invalid state was.

**Status: REMEDIATED.** Guard is `BEFORE INSERT OR UPDATE`; the graph check
applies to UPDATE only, the readiness check to both, and an identity-changing
UPDATE is refused so the readiness question cannot be asked about a different row.

---

## H2 — HIGH — platform lifecycle could fabricate status history for any tenant

**Defect.** `ins_tenant_status_history_platform_lifecycle` was
`WITH CHECK (has_platform_authority('platform.organization.lifecycle') AND to_state IN ('active','suspended','closed'))`.
No tenant term. No `from_state` term. No relation to the tenant's actual state.

**Consequence.** A lifecycle holder could append a history row describing a
transition that never happened, in **any** tenant, and
`org.stamp_tenant_status_history` would then stamp it with a real actor and a
current timestamp — making the fabrication indistinguishable from a genuine
record. No role holds UPDATE or DELETE on the table, so it is permanent.

**Why it is an asymmetry, not a necessity.** The sibling
`ins_tenant_status_history_platform_provisioning` has carried both the tenant
term and a parent-state `EXISTS` since it was written.

**Status: REMEDIATED.** Tenant term plus a coherence term requiring the tenant to
already carry `to_state`, which the sanctioned path satisfies because
`org.change_tenant_status` writes history *after* the UPDATE
(`20260717101000:219,221`) and a fabricated row in its own transaction does not.

---

## H3 — HIGH — a read-only platform operator could write control-plane audit

**Defect.** The three platform audit INSERT policies gated on
`iam.holds_any_platform_authority()`, which is true for **any** active platform
grant — including `platform.organization.read`, catalogued `risk_level = medium`.

**Why the tenant term did not contain it.** For a platform session
`app.tenant_id` is a **selector, not a narrowing**: the session sets it. So
`tenant_id = iam.current_tenant_id()` contributes no containment on this surface
and the authority conjunct was the entire gate.

**Status: REMEDIATED.** The audit write gate is now
`provision OR lifecycle`. Writing audit is a consequence of provisioning or of a
lifecycle change and of nothing else.

---

## H4 — HIGH — audit detail rows bound to no parent the session authored

**Defect.** `ins_audit_record_details_platform` was bound only by tenant and
authority. A foreign-key check bypasses row-level security, so fabricated
field-change rows could be attached to a **committed** audit record authored by a
tenant employee, and would render under that employee's name.

**Status: REMEDIATED.** The child policy now requires an `EXISTS` on a parent
record in the same tenant, authored by `iam.current_user_id()`, and not yet
chained — the actor binding reaching the table the actor column is not on.

---

## H5 — HIGH — caller-controlled chain sequence could permanently DOS a tenant's audit

**Defect.** `iam.audit_integrity_links.seq` is `bigint` with no default, no
identity and no trigger; the only CHECK is that it is positive, and no policy
constrained it. `iam.audit_append` computes the next link as
`COALESCE(max(seq), 0) + 1`, so a single planted row carrying `max(bigint)` makes
every future append for that tenant fail `22003` — permanently, for `app_runtime`
as well, with no DELETE privilege anywhere to undo it. Inflictable cross-tenant.

**Status: REMEDIATED.** The platform link policy now requires `seq` to equal the
value the canonical writer would itself compute, so the planted row is
unrepresentable rather than merely discouraged.

---

## M1 — lifecycle role-grant read had no tenant term

**Defect.** `sel_role_grants_platform_lifecycle`, introduced in this slice to
repair `B1-UG-005`, was `USING (has_platform_authority('platform.organization.lifecycle'))`
— a bare boolean. A lifecycle holder had a standing read of **every role grant in
every tenant**, and `sel_user_accounts_platform_lifecycle` likewise spanned the
estate. The policy comment claimed narrowness it did not have.

**Status: REMEDIATED.** Both carry `tenant_id = iam.current_tenant_id()`.
Minimum-column narrowing is still to be assessed.

---

## M2 — the over-grant gate was blind, twice

**Defect A — role applicability.** `scripts/ci/rls-matrix.mjs` matched covering
policies on table and command only, never on the role. A cell counted as covered
by any policy for that action on that table, whoever it belonged to. Proved by
mutation: `GRANT SELECT ON crm.business_partners TO app_platform` — a table it
has no policy on, in a schema it has no `USAGE` on — and the gate exited 0.

**Defect B — column-level grants.** `has_table_privilege` returns false for a
column-level grant, so the gate was blind to that entire class. Thirty
column-only grants exist in the database today, including `app_platform`'s own
`UPDATE (status) ON org.tenants` and its four-column read of
`iam.user_accounts`, every one recorded as `denied-by-grant`.

**Status: REMEDIATED.** Policy applicability resolved with `pg_has_role`;
`granted` is now table-level OR any-column, with `DELETE` excluded from the
column probe because PostgreSQL has no column form for it.

---

## M3 — trigger-function EXECUTE grants that were never required

**Defect.** Eight EXECUTE grants were justified by "a role cannot fire a trigger
it may not execute". PostgreSQL checks that at `CREATE TRIGGER`, not at fire
time. Demonstrated in this database: `org.stamp_tenant_status_history` and
`shared.guard_number_sequence_regression` fire on `app_platform`'s own writes
with **no EXECUTE held** — so the rule was false and, by its own logic, the grant
set was incomplete as well.

**Not affected: `B1-UG-003`.** `org.tenant_has_recoverable_owner` is called from
inside a trigger **body**, which is an ordinary runtime call and is checked. Its
mutation reproduces `42501`.

**Status: REMEDIATED.** Eight grants withdrawn.

---

## B1-UG-002 — WITHDRAWN — a repair that repaired nothing

Recorded rather than deleted, because the mistake is the useful part.

`iam.allowed_company_ids()` and `iam.allowed_branch_ids()` were granted to
`app_platform` as "B1-UG-002, found by execution". They were not required by any
sanctioned path: zero policies granted to `app_platform` reference either helper,
and no function `app_platform` may execute mentions them. The `42501` that
prompted the grant came from a **probe that called them directly**.

The mutation that defended the grant revoked it and then called the helper
directly again — so the only thing it turned red was its own probe. A test can
manufacture the dependency it then verifies.

**Status: WITHDRAWN.** Grants removed. The property that replaces it is stronger:
the control plane cannot ask what narrowing it carries, and no policy of its own
would consult the answer.

---

## B1-VAC-001 — vacuous proofs found in this slice's own tests

1. **Non-existent relations.** `crm.customers` and `inv.stock_items` do not
   exist. `app_platform` holds no `USAGE` on those schemas, so PostgreSQL refuses
   at the schema before resolving the relation and a misspelt table answers
   `42501` exactly like a real one. Two of six business-table denial assertions
   were therefore vacuous. Found when an unrelated over-grant mutation tried to
   `GRANT` on one of them.
2. **A mutation that never reached the control under test.** The lifecycle
   `WITH CHECK` case dropped the whole UPDATE policy, leaving `app_platform` with
   no UPDATE policy at all — so the statement matched zero rows, silently, and
   the trigger never fired. The final assertion was trivially true and the test
   would have passed with `org.guard_tenant_status_transition` deleted.
3. **Restores that only matched by name.** Policy restores are hand-copied
   literals and both the precondition and the restore assertion keyed on the
   policy NAME, so a restore reinstating a different predicate would satisfy
   both. Same class as an already-found bug where a column-list GRANT was used to
   restore a table-level one.

**Status: REMEDIATED.** Real relations with `to_regclass` preconditions; the
mutation now replaces the policy with a permissive `WITH CHECK` so the trigger is
reached; policy definition round-trip is derived automatically from the DROP
statement so future cases inherit it.

---

## RECORDED — pre-existing `app_runtime` analogues, outside B1 scope

The same H4 and H5 shapes exist on the tenant-runtime half and were **not**
introduced by this slice. B1 fixes the control-plane half only; changing tenant
audit semantics inside this slice would expand it past its boundary.

Exact locations are enumerated in the accompanying investigation and carried as a
separate remediation dependency.


---

## M1 (continued) — the lifecycle read narrowed twice

After the tenant term was added, the read was still **table-level** on
`iam.role_grants`: all seventeen columns. Four readers touch that table as
`app_platform` — the readiness predicate, `tg_role_grants_require_scope`, the
delegation backstop and the bootstrap read-back — and between them they use
eight. The nine withheld are grant administration metadata (`granted_by`,
`approval_ref`, `revoke_reason`, `revoked_at`, `revoked_by` and the record
columns), which is precisely the part that records who did what inside a tenant.

**Status: REMEDIATED.** `GRANT SELECT (id, tenant_id, user_id, role_id,
scope_mode, status, valid_from, valid_to)`. `iam.user_accounts` was already
column-scoped to the four columns its readers use, so nothing was left to narrow
there.

---

## M4 — three org read policies contained only by another table's policy

`sel_legal_companies_platform`, `sel_branches_platform` and
`sel_tenant_subscriptions_platform` carried **no authority term at all**. Their
only gate was the row property "the tenant is still provisioning", and whether
that row could be seen at all depended on `sel_tenants_platform`, whose floor is
`platform.organization.read`. A read-only operator could therefore read every
provisioning tenant's legal name, registration number and tax registration
number.

A containment that lives in another table's policy is a containment nobody
reviewing the file can see.

**Status: REMEDIATED.** All three now state
`iam.has_platform_authority('platform.organization.provision')` in their own
predicate, matching the six bootstrap reads.

Two policies remain deliberately authority-free and are recorded as a structural
residual rather than a gap: `sel_platform_grants_self` and
`sel_user_accounts_platform_self`, both `= iam.current_user_id()`. The resolver
reads them **to determine authority**, so gating them on authority would be
circular. Their reach is one row — the row whose id the session already claims as
its own.

---

## H2 (continued) — the coherence term was not enough on its own

Requiring `to_state` to equal the tenant's current status stopped the
cross-tenant and wrong-destination fabrications, and left one: a lifecycle
operator could still append a transition that never happened, so long as it ended
where the tenant already was — claiming a suspension and a recovery nobody
performed.

**Status: REMEDIATED.** A third term requires `from_state` to equal the
destination of the tenant's most recent history row, so the row must CONTINUE the
tenant's own chain. The sanctioned path satisfies it for free, because
`org.change_tenant_status` sets `from_state` to the status it just moved away
from — which is exactly what the previous row recorded as its destination.

The three terms together close the surface completely, and the argument is worth
stating because it is why no "accepted direct insert" case exists in the proof
set any more. For a tenant whose chain is intact, `to_state` must equal the
current status and `from_state` must equal the most recent destination — and
those two are the same value. The table's own
`CHECK (from_state IS DISTINCT FROM to_state)` then refuses the only row that
could satisfy both. A lifecycle operator cannot append history except by
performing a real transition, which writes the row for them.

The term also needed a privilege nobody had noticed: a policy expression is
evaluated with the **invoking role's** privileges, so a `WITH CHECK` that reads a
table the writer cannot `SELECT` raises `42501` on every write rather than
refusing the bad ones. The entire lifecycle went down the moment the term landed.

---

## B1-VAC-002 — the test suite silently reverted two security fixes

The most instructive failure in the slice, and it was found by accident.

`sel_role_grants_platform_lifecycle` and
`ins_tenant_status_history_platform_lifecycle` were tightened in migration
source. Two mutations in
`tests/db/pre-p1-29-b1-privilege-mutations.test.ts` dropped those policies and
restored them from **hand-copied literals written before the tightening**. So
running the suite left the live database carrying the pre-remediation
predicates — the tenant term and the coherence terms gone — while the migrations
on disk were correct.

Nothing caught it. Every assertion keyed on the policy **name**. The definition
round-trip added later agreed too, because by then the live policy already
matched the stale literal it was being compared against. The suite was green and
the database was weaker than its own migrations.

It surfaced only because an unrelated query dumped the live policy text and it
disagreed with the file.

**Status: REMEDIATED.** Restores are no longer written by hand. The harness
captures a `CREATE POLICY` statement from the live catalogue **before** the drop,
derives the target from the DROP statement so every case inherits it, and asserts
the rendered predicate round-trips byte-identically. A mutation can now only put
back what it took away, and passing a hand-written `CREATE POLICY` is a hard
error.

Two related fixture defects were found in the same pass and fixed: the cleanup
routines deleted `iam.grant_scopes` and `iam.role_grants` in separate
autocommits, which the DEFERRED `tg_role_grants_require_scope` refuses; and one
suite's `LIKE 'b1_%'` treated `_` as a wildcard and was deleting the other two
suites' fixtures out from under them.

---

## RECORDED — pre-existing `app_runtime` analogues, with locations

Both H4 and H5 have exact analogues on the tenant-runtime half, created in
`supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql`
around lines 267-272:

| policy | WITH CHECK | analogous to |
| --- | --- | --- |
| `ins_audit_record_details_writer` | `tenant_id = iam.current_tenant_id()` and nothing else | H4 |
| `ins_audit_integrity_links_writer` | `tenant_id = iam.current_tenant_id()` and nothing else | H5 |

`app_runtime` holds column-level INSERT on every column of
`iam.audit_integrity_links`, including the caller-supplied, default-less,
trigger-less `seq`.

**Reachability, which is what decides whether B1 can coexist with it.** Not
immediately exploitable by an ordinary tenant user: no API surface inserts into
these tables directly — every write goes through `iam.audit_append`, which
derives tenant, parent and `seq` itself under an advisory lock — `app_runtime` is
`NOLOGIN` with only `postgres` and the test login as members, and tenant
identities are not database roles. It is a latent containment gap reachable only
from arbitrary SQL in an `app_runtime` session.

**Status: RECORDED, not fixed here.** B1 fixes the control-plane half. Changing
tenant-runtime audit semantics inside this slice would expand it past its
boundary, and the gap is not immediately exploitable. It is carried as a separate
remediation dependency. B1's stricter `app_platform` predicates must not be
relaxed to match the runtime's.


---

## B1-PGNET-BLOCKER — EXTERNAL — the one finding B1 cannot close

**Status: OPEN.** This is the sole blocker on B1's final GO. The full operational
detail, including the precheck, the exact remediation, the postcheck and the
provider escalation package, is in
[b1-pgnet-owner-hardening-runbook.md](b1-pgnet-owner-hardening-runbook.md).

**The exposure.** `pg_net` grants PUBLIC every table privilege on
`net.http_request_queue` and `net._http_response` — both unlogged, both with
row-level security disabled and no policies — plus USAGE/SELECT/UPDATE on their
sequence, USAGE on the schema, and EXECUTE on ten of its twelve functions. A row
inserted into the queue is dispatched by a running superuser-owned in-server
client from the database container's network position, and the status, headers
and full body are readable from `_http_response`. `net.http_delete` is a second
path needing no queue row: `SECURITY INVOKER`, `proacl IS NULL`, so EXECUTE to
PUBLIC by default — the one function Supabase's own `grant_pg_net_access`
hardening does not name.

**Why the repository cannot fix it.** Recorded as the directive requires:

**A.** Every `net` object is owned by `supabase_admin`, which is also the
recorded grantor of every PUBLIC ACL entry.

**B.** The repository migration role is `postgres`. It is not a superuser, not
the owner, not a member of `supabase_admin`, and holds no privilege
`WITH GRANT OPTION` on any `net` object.

**C.** A `REVOKE` from that role therefore matches nothing it may remove.
PostgreSQL emits `WARNING: no privileges could be revoked` and the transaction
**COMMITS SUCCESSFULLY**. Migration success does not prove remediation — and a
migration whose only effect is to make the tree look remediated is worse than
none, because it manufactures assurance across every gate downstream. No such
migration exists in this branch and none will be added.

**D.** The repository CI database is a bare `postgres:17-alpine` container with
no `net` schema. CI can neither execute nor verify the real hosted remediation,
so no repository gate could ever demonstrate that it landed.

**E.** PostgreSQL permits no per-role revoke of a PUBLIC grant. The `aclitem`
model is additive with no deny representation, so the authority cannot be removed
from `app_platform` alone. Narrowing is all-or-nothing, at PUBLIC.

**F.** `app_platform` consequently inherits the whole surface for as long as the
PUBLIC grants stand.

**The distinction that decides the verdict.**

> PRE-EXISTING EXPOSURE ≠ ACCEPTABLE B1 AUTHORITY.

`app_runtime`, `app_worker` and `app_readonly` have carried identical authority
since `pg_net` first appeared in the image. B1 did not create it and did not
widen it — B1 introduced a role that inherits it, and made it visible. That is
the correct triage note and it changes nothing: the B1 authority model asserts
that `app_platform` is a control plane with no reach outside its sanctioned
surface, and while these grants stand that assertion is false. The model cannot
be declared closed around it.

**What B1 shipped instead of a fix.** Monitoring, and one real repository defect
the investigation exposed:

- The exposure is pinned as an executable fact in
  `tests/db/pre-p1-29-b1-platform-privilege-closure.test.ts`. It asserts the
  measured surface rather than containment, so an image bump that changes the
  ACL in either direction fails the suite. The two hardened wrappers are pinned
  separately: `http_get` and `http_post` must stay `SECURITY DEFINER`, must keep
  no PUBLIC entry, and must stay unreachable by `app_platform`.
- **A false claim in B1's own evidence, now corrected.** The closure suite
  certified "app_platform holds no DELETE anywhere" from
  `information_schema.table_privileges`, which lists privileges granted to a
  NAMED grantee and structurally cannot see a PUBLIC grant. `app_platform` does
  hold DELETE — on both `net` tables. The assertion now uses
  `has_table_privilege`, which resolves PUBLIC, membership and column grants,
  and states the population it measures: no effective UPDATE, DELETE or TRUNCATE
  in any RootLco schema. Every future claim about effective authority must name
  its population; "no DELETE anywhere" and "no DELETE in RootLco-owned schemas"
  are different statements and only one of them was true.


---

## VERDICT — repository implementation verified, one external blocker open

Taken on the final clean replay from empty, with no manual database repair at any
point. Every figure re-measured on that replay rather than carried forward.

| measurement | value |
| --- | --- |
| DB tier | 147 files / **1860** tests, 0 failures |
| Backend tier | 88 files / **2056** tests, 0 failures |
| B1 durable proof set | **141** tests across 4 files |
| Positive privilege matrix | 104 required = 104 attributable, MISSING 0, ORPHAN 0 |
| Standing over-grant gate | 143 tables, **4576** cells (all 8 table privileges), pass |
| Live policy set vs migration source | **42 = 42, identical** |
| `app_platform` effective business-table privileges | **0** |
| SECURITY DEFINER in RootLco schemas | 0 |
| `app_platform` role attributes | NOLOGIN, NOSUPERUSER, NOBYPASSRLS, owns nothing, member of nothing |

Three rounds of bounded delta refutation. The final round returned
**repo-controlled CRITICAL = 0, HIGH = 0**, with all three round-3 policy changes
attacked and refuted as defects.

### The finding classes this slice actually produced

Worth recording, because the same shapes recurred and each was found by running
rather than by reading:

1. **A repair that reintroduced the defect it fixed.** The first C1 repair folded
   an unrestricted-grant requirement into the permission arithmetic, so a deny
   carried by a scoped grant became invisible while remaining decisive for
   `iam.has_permission`. The predicate reported an owner the engine refuses —
   the original trap, in a new form. The rule that came out of it: the permission
   arithmetic must be a faithful transcription of the engine, and every extra
   requirement belongs outside it.
2. **A fix applied to one of N call sites and declared done.** Twice. The
   `LIKE 'b1_%'` escape was fixed on the child scope and not on the tenant
   delete; the ACTIVE-tenant INSERT was fixed in the shared test seed and not in
   the four other places, including the Owner-acceptance environment builder.
3. **A claim measured against the wrong population.** `information_schema` lists
   privileges granted to a NAMED grantee and cannot see PUBLIC or membership.
   Two assertions and two evidence rows claimed "no DELETE anywhere" on that
   basis while `app_platform` held DELETE on two `net` tables.
4. **Guards that could not see what they guarded.** The mutation harness restored
   policies from hand-copied literals and silently reverted two security fixes;
   the fingerprint built to catch that was itself blind to policy predicates
   (duplicate `coalesce` column names collapsing in the driver's row object);
   the over-grant gate matched policies without a role term, missed column-level
   grants, ignored role membership, and asked 4 of 8 table privileges.
5. **A test that passed for a different reason than it stated.** The H5 DOS test
   rolled its attempt back twice, so it would have passed with the sequence pin
   removed entirely.

Every one of those is now closed and has a standing control: catalogue-derived
policy restores with a fail-closed guard, a surface fingerprint compared before
and after in all three mutating suites, real-relation preconditions, and an
anti-vacuity test on the fingerprint itself — which caught its own blindness on
its first run.

### Result

**PRE-P1-29 WAVE B B1 — REPOSITORY IMPLEMENTATION SECURITY VERIFIED**

**B1 FINAL GO — BLOCKED**

**SOLE BLOCKER: B1-PGNET-BLOCKER**

The two reserved strings — *PLATFORM DATABASE FOUNDATION VERIFIED* and
*CONTROL-PLANE DESIGN — EXECUTION VALIDATED GO* — are deliberately NOT emitted.
They stay reserved until the pg_net authority is removed and verified in the
target Supabase environment, per the hardening runbook's postcheck.

No PR is open. Nothing is merged. The evidence fixed point has not been entered:
unit/web run records, ledger pins, manifest regeneration and the structural
baseline re-measure all wait for the blocker to close, because closing it changes
the security baseline they would record.
