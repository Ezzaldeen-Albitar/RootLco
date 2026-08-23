# PRE-P1-29 Wave B — B1 platform database foundation, evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 1. What this document is

The execution evidence for slice B1. It is the other half of
[wave-b-control-plane-design-v2.md](wave-b-control-plane-design-v2.md): that document is the
architecture and its three rounds of adversarial review; this one is what happened when the design
was executed against real PostgreSQL.

**It does not rewrite the design.** Revisions 1 to 4 and the
[refutation register](wave-b-control-plane-refutation-register.md) stay exactly as they are,
including the parts execution later corrected. A record that edits itself to look prescient is worth
nothing.

### The gate this slice was created to answer

> Can the dedicated platform database authority execute every sanctioned control-plane path it
> needs, while having no broader authority?

Not by inspection, not by grant listing, not by the row-level-security matrix, and not by document
review. By execution.

### Why the gate moved here

Three document passes over the design each found strictly fewer defects — 3 HIGH, then 1, then 1 —
and every single one belonged to one class:

> a privilege the runtime path genuinely needs that the design had not enumerated, because it
> reasoned at the entry point rather than along the whole `SECURITY INVOKER` call chain.

The trend was converging but had not reached zero, and a fourth paper round had a poor expected
return against a class that is, by construction, easier to find by running the code. It found two
more within minutes.

---

## 2. Under-grant findings

Recorded permanently, and recorded **because** they are fixed rather than despite it. Both are
fail-closed: each made a sanctioned operation impossible, neither widened anything.

### B1-UG-001 — `RETURNING` is evaluated against the SELECT policy

|                    |                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation**      | Initial Owner bootstrap, first statement                                                                                                                                                                                                                                                                                                                                                          |
| **RED**            | `INSERT INTO iam.user_accounts (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by) VALUES (…) RETURNING id` → **`42501`** _new row violates row-level security policy for table "user_accounts"_                                                                                                                                                            |
| **Control**        | The identical statement **without** `RETURNING` → **PASS**                                                                                                                                                                                                                                                                                                                                        |
| **Cause**          | The `WITH CHECK` was satisfied. `RETURNING` is evaluated against the **SELECT** policy, and the only platform read on that table was `sel_user_accounts_platform_self`, which admits `id = iam.current_user_id()` — the operator's own row. The freshly created Owner row is not the operator's.                                                                                                  |
| **Why it matters** | Bootstrap creates the Owner account and then needs its id to grant it a role. `RETURNING` is not a convenience here; without it the transaction cannot continue.                                                                                                                                                                                                                                  |
| **Missing**        | A window-scoped `FOR SELECT` policy, and its grant, on the bootstrap identity tables                                                                                                                                                                                                                                                                                                              |
| **Repair**         | `GRANT SELECT` plus `sel_user_accounts_platform_bootstrap`, `sel_roles_platform_bootstrap`, `sel_role_permissions_platform_bootstrap` and `sel_user_status_history_platform_bootstrap`, each `USING (EXISTS (… t.status = 'provisioning'))`. They are **permissive**, so they add the window read rather than widening the operator self-read, and each closes when the tenant leaves the window. |
| **GREEN**          | Both forms now succeed. `tests/db/pre-p1-29-b1-privilege-mutations.test.ts` drops the policy and reproduces the exact `42501` on demand, with the plain-`INSERT` control beside it.                                                                                                                                                                                                               |
| **Severity**       | Fail-closed. Not reachable by a tenant principal, no escalation.                                                                                                                                                                                                                                                                                                                                  |

This is the most misleading shape the class has produced: a plain insert succeeds and the identical
insert with `RETURNING` fails, so a reviewer reading the write policy sees nothing wrong.

### B1-UG-002 — the narrowing readers were never granted

|                    |                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operation**      | Any platform session asking what narrowing it carries — including the C9 proof itself                                                                                                                                                         |
| **RED**            | `SELECT iam.allowed_company_ids()` → **`42501`** _permission denied for function allowed_company_ids_                                                                                                                                         |
| **Cause**          | Design §7.2 enumerated the two **context** readers (`iam.current_tenant_id`, `iam.current_user_id`) and stopped at the two **narrowing** readers.                                                                                             |
| **Why it matters** | C9 — an absent tenant denies, an absent narrowing list widens — is the most dangerous assumption of the whole wave, and it is only checkable at runtime by calling those two functions. Without the grant the proof could not execute at all. |
| **Repair**         | `GRANT EXECUTE ON FUNCTION iam.allowed_company_ids(), iam.allowed_branch_ids() TO app_platform`                                                                                                                                               |
| **Why minimal**    | Both are `STABLE` readers that return only what the session itself set, and `app_platform` holds no grant on any business table for a narrowing value to apply to.                                                                            |
| **GREEN**          | The C9 proof now executes instead of erroring, and a mutation reproduces the `42501`.                                                                                                                                                         |
| **Severity**       | Fail-closed.                                                                                                                                                                                                                                  |

---

## 3. Two things execution taught that review had backwards

Recorded separately from the under-grants because neither is a defect — both are places where the
design's _description_ of the mechanism was wrong while the mechanism itself was fine.

### The trigger answers before the policy, not after

Design §6.4 calls the row-level `WITH CHECK` the first line of defence and the table trigger "the
second line of defence, not the first". A `BEFORE UPDATE` trigger runs **before** the row-level
check is evaluated, so in practice the trigger refuses first (`23514`) and the policy never gets the
chance (`42501`).

Both refuse. The ordering is inverted, and the suite accepts either SQLSTATE rather than pinning an
order PostgreSQL decides.

### Removing an UPDATE policy is a silent no-op, not a refusal

The first version of the mutation test asserted that dropping `upd_tenants_platform_lifecycle` would
make a direct status write fail. It does not fail — it matches **zero rows**. With no `UPDATE`
policy the statement is simply unsatisfiable, so PostgreSQL reports success and changes nothing.

That cuts both ways, which is why it is worth writing down:

- a test demanding a SQLSTATE reports a broken control that is in fact perfectly safe;
- a test accepting "no error" reports a breach that never happened.

The assertion is now on the **state**: the row is unchanged, and if no error was raised the statement
must have affected zero rows.

---

## 4. Runtime privilege closure — what executes, as `app_platform`

Every row below was executed on a real database through a login role whose only privilege is
membership in `app_platform` — never on the admin connection, which carries `BYPASSRLS` locally and
is superuser in CI and therefore proves nothing about a policy.

| Path  | Entry                                     | What the whole chain touches                                                                                                                                                              | Result   |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **0** | `iam.has_platform_authority(text)`        | `iam.platform_grants` (self rows), `iam.user_accounts` (own row, three columns), `iam.current_user_id`                                                                                    | executes |
| **1** | `SELECT … org.tenants`                    | `sel_tenants_platform`, resolver                                                                                                                                                          | executes |
| **2** | `org.provision_organization(jsonb, text)` | ten writes, six reads (four of them `RETURNING`), `org.guard_parent_company_live`, `org.validate_setting_value`, replay table                                                             | commits  |
| **3** | `org.change_tenant_status(…)`             | `SELECT … FOR UPDATE`, `UPDATE org.tenants(status)`, `INSERT org.tenant_status_history`, `shared.touch_row_metadata`, `org.guard_immutable_columns`, `org.guard_tenant_status_transition` | commits  |
| **4** | `iam.audit_append(…)`                     | the writer, `iam.audit_mask`, `iam.audit_canonical`, `iam.audit_hash`, three inserts, two writer-scoped read-backs, the chain read                                                        | commits  |
| **5** | Owner bootstrap                           | `iam.user_accounts` + `RETURNING`, `iam.roles` + `RETURNING`, window policies, `iam.stamp_user_status_history`                                                                            | commits  |

Paths 3 and 4 are the ones the design review reached last and got wrong twice; both now commit as a
single transaction rather than as a sequence of individually-plausible statements.

---

## 5. Negative proofs

| Property                                      | Proven by                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Audit history cannot be amended or deleted    | `UPDATE`/`DELETE` on `iam.audit_records` → `42501`, at the privilege layer, before any policy                        |
| A committed audit event cannot be read back   | writer-scoped read admits only a record with no chain link; after commit that is never any row                       |
| The audit actor was whatever the CALLER passed — found, then CLOSED, see §11 | `iam.audit_append` writes its `p_actor` argument (`20260725090000:199-204`) and `iam.current_user_id()` appears nowhere in its body, so the writer cannot bind the actor. The row-level policy now does, on the parent and transitively on both child tables |
| Platform authority cannot be self-granted     | `INSERT`/`UPDATE`/`DELETE` on `iam.platform_grants` as `app_platform` → `42501`; no write policy exists for any role |
| `app_runtime` cannot see the relation at all  | `SELECT` → `42501`                                                                                                   |
| A non-platform code cannot be assigned        | `ck_platform_grants_platform_code` → `23514`                                                                         |
| A duplicate live assignment is refused        | `uq_platform_grants_active` → `23505`                                                                                |
| An operator reads only its own authority rows | every row returned carries the acting principal's id                                                                 |
| Revocation and account lock both deny         | resolver returns false in each case                                                                                  |
| The bootstrap window closes                   | after the first legal transition, the same insert → `42501`                                                          |
| The window cannot be reopened                 | direct write to `provisioning` refused by the trigger (`23514`) even on a `BYPASSRLS` connection                     |
| No business-schema reach                      | `SELECT` on `crm/veh/apt/wo/inv/sal` → `42501`; zero privileges across all fourteen business schemas                 |
| No effective `DELETE`, `UPDATE` or `TRUNCATE` in any RootLco schema; one column-scoped `UPDATE` | `has_table_privilege` and `has_column_privilege` over every relation in the 17 product schemas return exactly `org.tenants.status`. Measured EFFECTIVELY: `information_schema` lists privileges granted to a NAMED grantee and cannot see one held through PUBLIC or membership, and this row previously read "No `DELETE` anywhere" on that basis while `app_platform` held DELETE on two `net` tables via PUBLIC. The population is stated because it must be — this is a claim about RootLco schemas, not about the database |
| Not an `app_runtime` member                   | `pg_has_role(...) = false` — the delegation backstop's early exit depends on this                                    |

---

## 6. Mutation proofs

Twelve cases. Each **proves its target exists** before removing it, requires the exact failure, and
restores it in `finally` — the third step matters as much as the second, because a mutation left
applied would make every later suite fail for a reason unrelated to itself.

| Mutation                                            | Reproduces                                            |
| --------------------------------------------------- | ----------------------------------------------------- |
| Revoke `iam.has_platform_authority` EXECUTE         | design blocker B2                                     |
| Revoke `iam.audit_canonical` EXECUTE                | design blocker B1                                     |
| Revoke `org.provision_organization` EXECUTE         | entry-point closure                                   |
| Revoke `iam.allowed_company_ids` EXECUTE            | B1-UG-002                                             |
| Revoke `INSERT` on `org.tenants`                    | provisioning closure                                  |
| Revoke `UPDATE (status)` on `org.tenants`           | lifecycle closure                                     |
| Revoke `INSERT` on `org.tenant_status_history`      | design finding 5                                      |
| Drop `sel_user_accounts_platform_bootstrap`         | **B1-UG-001**, with the plain-`INSERT` control        |
| Drop `ins_user_accounts_platform_bootstrap`         | bootstrap `WITH CHECK`                                |
| Drop `ins_tenant_status_history_platform_lifecycle` | why the two paths need two policies                   |
| Drop `upd_tenants_platform_lifecycle`               | the silent-no-op finding of §3                        |
| Trigger asserted on a `BYPASSRLS` connection        | the backstop, where nothing else could be the refuser |

---

## 7. Deferred, and to where

| Item                                   | State                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C8** — malformed identifier handling | **Database foundation safe; live HTTP validation proof deferred to B3.** B1 introduces no adapter and fakes no `400`. Every B1 helper takes typed parameters (`uuid`, `text`, `jsonb`), so no dynamic-SQL path exists for a future adapter to inherit.                                                                                                |
| **Rate limiting**                      | **B1 contract verified; B3 owes the live proof.** `auth-adjacent` is unchanged at 10/min, keyed `operation` + `ip`, `securityRelevant: true` (`apps/api/src/server/http/rate-limit.ts:130-139`). It remains the only catalogued policy whose key material exists before a tenant does. No new policy was added and none is needed. B1 fakes no `429`. |
| **Activation invariant**               | See §8.                                                                                                                                                                                                                                                                                                                                               |

---

## 8. The activation branch, and the hazard B1 closed

`org.provision_organization` carries an optional activation branch: with `tenant.activate` set it
calls `org.change_tenant_status(…, 'active', …)` **inside the provisioning transaction**
(`20260717107000:254-261`). The design review found it; B1 executed it.

### What this section used to say, and why it was wrong

An earlier revision recorded this as a **residual** and deferred it to the B6 provisioning adapter:

> Residual: an operator holding both `provision` and `lifecycle` can create an ACTIVE tenant with no
> initial Owner by passing `tenant.activate`. … The compensating control is the B6 provisioning
> adapter, which must never forward `tenant.activate`. **B6 owes the proof.**

The reasoning was that separating the permission codes was itself the control, which is true for an
operator holding only `provision` and false for one holding both — and that closing it properly
"would mean a Wave-B design change rather than a B1 under-grant".

That was the wrong call, for a reason the directive states plainly: **no application-layer rule can
make an invalid STATE unrepresentable.** An adapter that declines to forward a flag is a promise, not
a constraint, and the state it is promising to avoid is a live tenant nobody can administer with its
bootstrap window already shut behind it. It is also not reachable only through that flag — a direct
UPDATE, or a direct INSERT, reaches it too.

### What the database does now

Every arrival at `active` — by INSERT or by UPDATE, from any writer including a `BYPASSRLS`
connection — requires the tenant to have a recoverable administrator.
`org.guard_tenant_status_transition` is `BEFORE INSERT OR UPDATE` on `org.tenants` and calls
`org.tenant_has_recoverable_owner`, which asks two separate questions of one account:

1. does it hold at least one **active, in-window, unrestricted** grant, so it can act tenant-wide;
2. does it **effectively hold** `iam.role.manage`, `iam.grant.manage` and `iam.user.manage`,
   resolved as a faithful transcription of `iam.has_permission` — every active in-window grant, no
   scope filter, no `iam.roles` join, deny wins.

Those two questions are separate conjuncts on purpose. An earlier repair folded the unrestricted
requirement **into** the permission arithmetic and reintroduced the original defect in a new form: a
deny carried by a scoped grant became invisible to the predicate while remaining decisive for the
authority engine, so the predicate reported an owner the engine refuses.

The three codes are derived from the write points rather than chosen. Recovery means bringing a new
administrator into being, and `ck_role_grants_no_self_grant` forbids doing it to yourself — so it
needs a second account, which `ins_user_accounts_admin` gates on `iam.user.manage`, and which is
inert at its `'invited'` default until `upd_user_accounts_admin` activates it, on the same code. The
set is closed: `ins_role_permissions_delegable` refuses to map a code the actor does not hold, so
those three are the smallest set that can reproduce itself. The shipped last-holder guard at
`apps/api/src/modules/iam/application/access-administration-service.ts:479` independently protects
exactly the same three.

The consequence for the branch this section began with: **`tenant.activate` is now inert.**
Provisioning creates no accounts, so inside its own transaction no grant exists and none can; the
activation branch always raises and rolls the whole call back. That is recorded in the migration
source and pinned by `tests/db/org-provisioning.test.ts`, in the canonical function's own suite,
where a caller reading it will find it.

Nothing was deferred to B6 here.

---

## 9. Measurements

Every figure below was taken after a clean replay from an empty database, not from the incremental
application used during development.

<!-- B1-MEASUREMENTS-START -->

Taken after `npm run supabase:reset` — a full replay of all 127 migrations from an EMPTY database,
then the seeds — and not from the incremental application used while developing. The replay
finished with exit 0 and no error on any migration.

### Migrations and catalogue

|                    | Before | After   | How measured                                                                                |
| ------------------ | ------ | ------- | ------------------------------------------------------------------------------------------- |
| Migrations         | 124    | **127** | file count on the branch, cross-checked against the baseline pin                            |
| Permission codes   | 112    | **115** | `SELECT count(*) FROM iam.permissions` after replay; the seed`s own NOTICE reports the same |
| Permission domains | 17     | **18**  | `count(DISTINCT domain)`; the new one is `platform`                                         |
| `platform.` codes  | 0      | **3**   | each referenced by a real B1 policy predicate — 10, 1 and 4 times                           |

### Structural totals

The four totals the replay gate pins count EVERY non-system schema, so a developer stack — which
carries auth, storage, realtime and vault objects the CI plain-postgres container does not — cannot
reproduce them directly. Each is therefore stated with the population it was measured in, and the
pinned figure is derived from the RootLco-scoped measurement plus the difference this repository has
already documented.

|                    | RootLco schemas | Pinned (replay-gate population) | Reconciliation                                                                                             |
| ------------------ | --------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tables             | **249**         | **249**                         | identical under both scripts, as the baseline records                                                      |
| Policies           | **688**         | **688**                         | identical under both scripts                                                                               |
| Triggers           | **554**         | **554**                         | identical; the raw local count of 559 exceeds it by exactly realtime (1) + storage (4)                     |
| Functions          | **225**         | **527**                         | 225 + the documented constant 302-function extension difference                                            |
| `SECURITY DEFINER` | **0**           | **0**                           | 0 in RootLco schemas; the 6 the raw query returns are `net`, `pgbouncer`, `supabase_functions` and `vault` |

All four deltas were predicted by reading the migrations before the replay ran, and all four matched.

### Schema hash

```
9f536a46...  ->  11ab5565cc6fd71a106366925a7a6363b9c5f1752bfd94876cc5fdad7e81643a
```

`npm run validate:schema-inventory -- --hash-only`, over the 17 RootLco business schemas only, which
is why it is locally reproducible where the structural totals are not. The delta is
`iam.platform_grants`, `iam.has_platform_authority`, `org.guard_tenant_status_transition` and
`ix_platform_grants_permission_code` — the inventory covers indexes too, which is how the missing
foreign-key index showed up in the hash as well as in the tier.

### B1 objects present after the clean replay

| Object                             | Present                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `app_platform` role                | yes — `rolcanlogin` false, `rolsuper` false, `rolbypassrls` false |
| `iam.platform_grants`              | yes, RLS enabled and forced                                       |
| `iam.has_platform_authority(text)` | yes, `SECURITY INVOKER`                                           |
| `tg_tenants_status_transition`     | yes                                                               |
| B1 policies                        | **39** — 1 in the foundation migration, 38 in the privilege graph |

### Tests

| Suite                                             | Tests                                                     |
| ------------------------------------------------- | --------------------------------------------------------- |
| `pre-p1-29-b1-platform-privilege-closure.test.ts` | 35                                                        |
| `pre-p1-29-b1-privilege-mutations.test.ts`        | 12                                                        |
| `pre-p1-29-b1-tenancy-and-invariants.test.ts`     | 11                                                        |
| **B1 total**                                      | **58**, all passing against the cleanly replayed database |

<!-- B1-MEASUREMENTS-END -->

---

## 11. A claim this document made that was false

Recorded rather than quietly edited, because the failure mode is the one this repository names as
its dominant defect class: **a stated rule the code does not implement, with a test that asserts the
code rather than the rule.**

An earlier revision of §5 said:

> The audit actor is the authenticated operator — `actor_id` on the written record equals the
> context principal, not any argument a caller could forge.

**That is not true.** `iam.audit_append` writes its `p_actor` argument directly
([`20260725090000:199-204`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)),
and `iam.current_user_id()` appears nowhere in its body. The database binds the **tenant** — every
insert policy checks it — and it does not bind the **actor**.

The test cited for the claim could not have caught it: it passed the operator id as the `p_actor`
argument **and** as the session principal, then asserted the recorded actor was that id. Both worlds
satisfy that assertion. The test now passes a different actor and asserts what the database really
does, so the record states the true thing.

### What was then done about it, and what remains true

The finding above stood for one revision. It has since been **closed in the database**, and the
correction is worth as much detail as the error.

`iam.audit_append` still writes its `p_actor` argument verbatim and still never consults the
session — the WRITER does not bind the actor and was not changed. The **row-level policy** binds it:

```sql
CREATE POLICY ins_audit_records_platform ON iam.audit_records
  FOR INSERT TO app_platform
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.has_platform_authority('platform.organization.provision')
      OR iam.has_platform_authority('platform.organization.lifecycle'))
    AND actor_id = iam.current_user_id()
  );
```

A wrapper function was the obvious alternative and does not work in this repository: it would have
to be `SECURITY INVOKER` like everything else, so revoking `EXECUTE` on the generic writer to force
callers through it would revoke it from the wrapper's own body too. Constraining the finished ROW
needs no new abstraction and cannot be bypassed by calling the writer directly — which is why
`app_platform` **keeps** its `EXECUTE` on `iam.audit_append` and still cannot record an actor other
than itself.

The child tables carry the same binding transitively: a detail row or a chain link must name a
parent record in the same tenant, authored by `iam.current_user_id()`. Without that a foreign-key
check — which bypasses row-level security — let fabricated field changes be attached to a committed
record belonging to a tenant employee.

|                              |                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enforced by the database     | The audit row's **tenant**, the **write-level authority** (a read-only platform code cannot append at all), and the **actor**, which must equal the session principal on the parent and on both child tables |
| NOT enforced by the database | The **authenticity of the session principal**. `iam.current_user_id()` reads `app.user_id`, which the connection sets — so the policy proves the recorded actor is COHERENT with the principal the session claimed for authorization, not that the claim itself is genuine |
| Where the remainder lives    | The API layer, which must derive `app.user_id` from the authenticated platform session and never from a request document — design §8                                                        |
| Who owes that proof          | **B3.** A request carrying a forged actor must produce an audit row naming the authenticated operator. B1 cannot prove it, because B1 has no request.                                        |

That distinction is deliberate and is not a hedge: an attacker who can set `app.user_id` to another
operator's id already holds that operator's platform authority, because the resolver reads the same
value. Binding the actor removes a strictly separate power — writing audit **as somebody else while
acting as yourself** — and that is the power the policy takes away.

The pre-existing `app_runtime` half is untouched and is recorded as a separate remediation
dependency rather than expanded into this slice.

---

## 10. What B1 does not claim

**No HTTP surface exists.** There is no route, no operation declaration, no adapter. Every proof
here is a database proof, and the API-layer obligations — identifier validation, the rate-limit
key, the server-derived actor at the request boundary — belong to B3 and are listed in §7.

**No Company-Owner containment work.** Wave B introduces no operation a Company Owner can reach, so
the containment proof would pass vacuously here. Design §17 moves it to wave C.

**Normal tenant delegation is untouched.** No existing delegation policy, function or test was
modified. The bootstrap path does not weaken `ins_role_permissions_delegable` or
`ins_role_grants_delegable`; it is a separate role with separate policies, and the window closes.
