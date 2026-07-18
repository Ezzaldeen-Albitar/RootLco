# Row-Level Security (RLS) Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — applies to every tenant-owned table in every phase ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, never to be described as independent review) ·
**Task IDs:** P1-02-SEC-001 / P1-02-SEC-002 ·
**Related:** [Database architecture](./database-architecture.md) ·
[Role and grant standard](./role-and-grant-standard.md) ·
[Naming standard](./database-naming-standard.md) ·
[Number-sequence standard](./number-sequence-standard.md) ·
Reference implementation: [`supabase/migrations/0002_base_schemas.sql`](../../supabase/migrations/0002_base_schemas.sql),
[`supabase/migrations/0003_number_sequences.sql`](../../supabase/migrations/0003_number_sequences.sql) ·
Proof suite: [`tests/db/rls.test.ts`](../../tests/db/rls.test.ts)

---

## 1. Purpose and scope

This standard defines how tenant isolation is enforced at the database layer of the
multi-tenant platform. It is binding on every migration that creates a tenant-owned
table, in Phase 1-2 and every later phase.

Phase 1-2 creates **no business-domain tables**. The only tenant-owned table that
exists today is `shared.number_sequences` (migration 0003), and it is the reference
implementation of every rule below. Tables named in examples as `org.companies`,
`crm.customers`, etc. are **Phase 1-3+ illustrations — they do not exist yet** and
nothing in this document creates them.

RLS is one layer of a defence-in-depth stack. It works **together with**, never
instead of:

| Layer                 | Control                                                                                                                | Where defined                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Privileges            | Per-object `GRANT`s to non-owner roles; absence of a grant is a deny                                                   | [Role and grant standard](./role-and-grant-standard.md) |
| RLS                   | `ENABLE` + `FORCE` + per-command policies; absence of a policy is a deny                                               | This document                                           |
| Referential integrity | Composite FKs `(tenant_id, parent_id) REFERENCES (tenant_id, id)` so a row can never reference another tenant's parent | [Database architecture](./database-architecture.md)     |
| Application           | Server-side context resolution; client IDs treated as validation inputs only                                           | Phase 1-4 (future — see §8)                             |

A related binding principle from the architecture document applies throughout:
**UUIDs are not authorization tokens and not public display numbers.** Knowledge of
a row's `id` or a tenant's `tenant_id` never grants access — the proof suite
demonstrates that a session addressing another tenant's rows by their exact UUIDs
still sees and affects zero rows (§7).

## 2. Core rules

1. **Every tenant-owned table must have RLS both ENABLED and FORCED** in the same
   migration that creates it:

   ```sql
   ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <schema>.<table> FORCE ROW LEVEL SECURITY;
   ```

   `ENABLE` alone exempts the table owner; `FORCE` closes that gap for any owner
   that does not itself carry `BYPASSRLS`. Rationale: an accidental owner-context
   query (maintenance script, admin tooling) must not silently read across tenants.
   The honest limits of `FORCE` are stated in §6.

2. **Default deny — no permissive fallback policy, ever.** When RLS is enabled and
   no policy applies to a command for a role, PostgreSQL denies the rows. The
   _absence_ of a policy (together with the absence of a grant) **is** the deny
   mechanism; a table must never carry a catch-all `USING (true)` policy "to make
   things work". Migration 0003 practises this: `shared.number_sequences` has **no**
   INSERT or DELETE policy and **no** INSERT or DELETE grant for runtime roles,
   because provisioning and retirement of sequences are administrative
   configuration actions.

3. **A policy without a grant does nothing, and a grant without a policy does
   nothing.** Both must be stated explicitly, per object, in the creating
   migration. Blanket grants (`GRANT ALL`, `ALTER DEFAULT PRIVILEGES` sweeps) are
   prohibited (see the [role and grant standard](./role-and-grant-standard.md)).

4. **Policies address role archetypes, never login users.** Tenant-session
   policies are written `TO app_runtime` and/or `TO app_readonly`; enumerated
   infrastructure policies are written `TO app_worker`. All three are NOLOGIN,
   constrained, non-bypassing archetypes. Login roles obtain behaviour through
   membership.

5. **Runtime roles must never own tables** (§6 explains why), and every RLS claim
   must be evidenced by tests running as a non-owner runtime role (§7).

6. **SECURITY INVOKER by default.** Functions that touch tenant-owned tables run
   with the caller's rights so RLS applies in full — `shared.next_display_number()`
   is explicitly `SECURITY INVOKER` and is _not_ an RLS bypass. Any future
   `SECURITY DEFINER` function is an exception that requires a written
   justification, a hardened `search_path`, and its own tenant checks.

## 3. The transaction-scoped context contract

RLS policies decide tenant membership by reading a **transaction-local context**
set by the application layer via `set_config(key, value, true)` — the third
argument `true` makes the value transaction-scoped: it evaporates at `COMMIT` or
`ROLLBACK` (verified by test; §7).

| Key               | Type                      | Meaning                                                     |
| ----------------- | ------------------------- | ----------------------------------------------------------- |
| `app.tenant_id`   | single UUID               | The session's tenant. Required for all tenant-scoped work.  |
| `app.company_ids` | comma-separated UUID list | Optional narrowing to specific companies within the tenant. |
| `app.branch_ids`  | comma-separated UUID list | Optional narrowing to specific branches.                    |
| `app.user_id`     | single UUID               | Acting user, for `created_by`/`updated_by` attribution.     |

Binding rules:

- **Values are resolved SERVER-SIDE from the authenticated session.** The
  application layer determines the tenant/company/branch scope from who the
  authenticated user actually is. Client-supplied tenant, company, or branch
  identifiers are **validation inputs only, never authorization inputs** — they may
  be compared against the server-resolved scope, but they are never written into
  the context. Knowledge of an ID never grants access.
- **The context must be set inside an open transaction**, using
  `set_config(..., true)`. Session-scoped (`false`) context is prohibited: pooled
  connections would leak one tenant's scope into another tenant's statements.
- **Unset context means no access.** This is a feature, not an error state: the
  helper functions return `NULL` when a key is unset, and a policy predicate
  comparing against `NULL` matches no rows (§4).
- The **resolution** of context (which tenant/companies/branches an authenticated
  user is entitled to) requires membership tables and middleware that belong to
  **Phase 1-4 and are not implemented now** (§8). Phase 1-2 defines and tests the
  contract itself.

## 4. The `iam` helper functions (as implemented in migration 0002)

All four helpers are `LANGUAGE sql`, `STABLE`, `SECURITY INVOKER`, hardened with
`SET search_path = ''`, contain **no IAM business logic**, and only _read_ the
context the session itself set. `EXECUTE` is granted explicitly to `app_runtime`
and `app_readonly`.

| Function                    | Returns  | Exact semantics                                                                                                                                                               |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iam.current_tenant_id()`   | `uuid`   | `NULLIF(current_setting('app.tenant_id', true), '')::uuid` — **`NULL` when unset or empty**, so `tenant_id = iam.current_tenant_id()` matches **no rows** (default deny).     |
| `iam.current_user_id()`     | `uuid`   | Same pattern for `app.user_id`; actor attribution for the metadata trigger.                                                                                                   |
| `iam.allowed_company_ids()` | `uuid[]` | `NULL` when `app.company_ids` is unset or empty — **`NULL` means "no company narrowing was set" (tenant scope only)**; otherwise the comma-separated list parsed as `uuid[]`. |
| `iam.allowed_branch_ids()`  | `uuid[]` | Same pattern for `app.branch_ids`.                                                                                                                                            |

The asymmetry is deliberate and must be preserved: an unset **tenant** denies
everything, while an unset **company/branch list** merely means "no narrowing" —
the tenant predicate still applies. Narrowing predicates must therefore always be
written in the `IS NULL OR ... = ANY (...)` form shown in §5.

## 5. Policy templates

### 5.1 Naming

Policies follow the platform [naming standard](./database-naming-standard.md):
`<action>_<table>_<scope>` with the action prefixes `sel_` / `ins_` / `upd_` /
`del_`. The scope suffix states what the policy narrows by (`tenant`,
`tenant_company`, `tenant_branch`). Identifiers are limited to 63 bytes; when a
name must be shortened, apply the deterministic shortening rule from the naming
standard (drop the schema part first, then abbreviate words in the documented
fixed order, keeping the prefix and scope) and record the full name in a
`COMMENT ON POLICY`.

Existing examples (migration 0003): `sel_number_sequences_tenant`,
`upd_number_sequences_tenant`.

The separate `wkr_` prefix identifies an enumerated infrastructure-worker
policy. It is never a synonym for a tenant policy.

### 5.2 The four command templates (tenant scope)

For tenant-session access, each command gets its **own** policy — a single
`FOR ALL` policy is prohibited because it hides which commands are intentionally denied. In the templates,
`<schema>.<table>` is a tenant-owned table with a `tenant_id uuid NOT NULL` column.

```sql
-- SELECT: both archetypes may read within their tenant.
CREATE POLICY sel_<table>_tenant
  ON <schema>.<table>
  FOR SELECT
  TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- INSERT: WITH CHECK forces every new row into the session's tenant.
CREATE POLICY ins_<table>_tenant
  ON <schema>.<table>
  FOR INSERT
  TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- UPDATE: USING selects only own-tenant rows; WITH CHECK blocks re-pointing
-- a row at another tenant.
CREATE POLICY upd_<table>_tenant
  ON <schema>.<table>
  FOR UPDATE
  TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- DELETE: only where hard delete is permitted at all (see below).
CREATE POLICY del_<table>_tenant
  ON <schema>.<table>
  FOR DELETE
  TO app_runtime
  USING (tenant_id = iam.current_tenant_id());
```

Not every table receives all four:

- **Controlled business records are never hard-deleted** (base metadata standard:
  soft delete via `deleted_at`/`deleted_by`). For such tables the `del_` policy and
  the DELETE grant are **deliberately absent** — the absence is the control.
- **Append-only classes** (status history, audit evidence) receive `ins_` + `sel_`
  only; UPDATE and DELETE are denied by having neither policy nor grant (verified
  against an append-only fixture in the proof suite: UPDATE/DELETE fail with
  SQLSTATE 42501).
- **Administratively provisioned tables** (e.g. `shared.number_sequences`) may
  deny INSERT and DELETE to runtime roles entirely, as migration 0003 does.

### 5.3 Worker policy class

Worker policies use `wkr_<table>_<scope>`. `wkr_event_outbox_all` is the
reviewed exception to the ordinary one-policy-per-command rule:

```sql
CREATE POLICY wkr_event_outbox_all ON shared.event_outbox
  FOR ALL TO app_worker
  USING (true)
  WITH CHECK (true);
```

`USING (true)` / `WITH CHECK (true)` is deliberate because an outbox dispatcher
must claim delivery obligations across every tenant without adopting a user's
tenant context. This is an infrastructure capability on an exactly enumerated
worker table, not `BYPASSRLS`: `app_worker` remains non-owning and
`NOBYPASSRLS`, receives only SELECT/INSERT/UPDATE, and cannot DELETE. Runtime
and readonly roles receive neither policy nor grant. Any new `wkr_` policy must
document its all-tenant exposure and exact verbs in the creating migration.

Each deliberate absence must be recorded in a comment in the creating migration,
as migration 0003 does.

### 5.4 Company/branch narrowing variants

Where a table carries `company_id` (and optionally `branch_id`), the policy may
narrow within the tenant using the allowed lists. The `IS NULL OR` form is
mandatory — `NULL` means "no narrowing", not "deny" (§4).

```sql
-- Phase 1-3+ ILLUSTRATION ONLY: org.branches does not exist yet.
CREATE POLICY sel_branches_tenant_company
  ON org.branches
  FOR SELECT
  TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL
         OR company_id = ANY (iam.allowed_company_ids()))
  );

-- Branch-level narrowing adds the branch predicate on top:
CREATE POLICY upd_work_orders_tenant_branch   -- Phase 1-3+ ILLUSTRATION ONLY
  ON veh.work_orders
  FOR UPDATE
  TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL
         OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL
         OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL
         OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL
         OR branch_id = ANY (iam.allowed_branch_ids()))
  );
```

Functions apply the same narrowing imperatively where a policy cannot:
`shared.next_display_number(p_sequence_code, p_company_id, p_branch_id)` takes its
tenant **exclusively** from `iam.current_tenant_id()` (no tenant parameter, by
design) and validates its company/branch parameters against
`iam.allowed_company_ids()` / `iam.allowed_branch_ids()` when those are set,
raising `insufficient_privilege` on a mismatch.

### 5.5 Grants that accompany the policies

The creating migration must state the matching grants, at the narrowest workable
width — column-restricted where possible. Migration 0003 is the model:

```sql
GRANT SELECT ON shared.number_sequences TO app_runtime, app_readonly;
GRANT UPDATE (next_value, current_period) ON shared.number_sequences TO app_runtime;
```

The column-restricted UPDATE means `tenant_id` is not even grantable as an update
target for the runtime role: re-pointing a row at another tenant is refused by
**both** the column grant and the `WITH CHECK` clause (verified: SQLSTATE 42501).

## 6. Roles, BYPASSRLS, and what is honestly _not_ protected

The following role attributes were **measured on the real local stack on
2026-07-16** (inspection recorded in the
[role and grant standard](./role-and-grant-standard.md)):

| Role                                                 | Measured attributes                                                     | Consequence for RLS                                                                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` (Supabase local)                          | **Not** superuser, but `BYPASSRLS` + `CREATEROLE` + `CREATEDB`          | **Nothing run as `postgres` proves RLS works.** It is the provisioning/cleanup path in tests, never the evidence path.                                                                                      |
| `supabase_admin`                                     | Superuser                                                               | Bypasses everything; never used as evidence.                                                                                                                                                                |
| `service_role`                                       | `BYPASSRLS`                                                             | **Must never reach a browser or any client-side code.** A leaked `service_role` key nullifies every policy in this document. The CI secret-scan job exists in part to keep such keys out of client bundles. |
| `anon`, `authenticated`                              | No bypass attributes                                                    | Subject to RLS.                                                                                                                                                                                             |
| `app_runtime`, `app_readonly` (ours, migration 0002) | `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` | Tenant-session archetypes.                                                                                                                                                                                  |
| `app_worker` (ours, Phase 1-5 Increment G)           | `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` | All-tenant access only through reviewed `wkr_` policies on enumerated infrastructure tables.                                                                                                                |

In the plain `postgres:17` CI container, `postgres` **is** a superuser. This is an
accepted, documented gap: CI runs plain PostgreSQL 17, not the full Supabase
stack, so Supabase-managed role attributes differ there. The proof suite is
unaffected because no isolation assertion ever runs on the admin connection.
Supabase-managed roles are never modified by our migrations.

**What FORCE RLS does and does not protect against** (both halves verified by
test):

- It **does** lock out a non-`BYPASSRLS` table owner: the owner-fixture test shows
  the owner's SELECT returning zero rows and its INSERT failing with 42501 under
  `FORCE ROW LEVEL SECURITY` with no policies.
- It **does not** protect against a hostile owner: the same test then shows the
  owner successfully running `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` and
  reading the rows. `FORCE` guards against _accidental_ owner-context queries, not
  against the owner itself. **This is precisely why runtime roles must never own
  tables**: an `ALTER TABLE` attempt by `app_runtime` membership fails with 42501
  because it is not the owner.

## 7. Testing requirements (what "proven" means)

Every RLS claim in this platform must be backed by a test that satisfies all of
the following. The current suite (68 tests, all passing on 2026-07-16 via
`npm run test:db`, vitest + `pg`) satisfies them for `shared.number_sequences`
and the pattern fixtures.

1. **Non-owner execution.** Every tenant-session isolation assertion runs as
   `rootlco_test_runtime` — a login role created **by the test harness, never by a
   migration**, holding nothing beyond `LOGIN` and membership in `app_runtime`.
   Results obtained as `postgres` are never presented as RLS evidence (it carries
   `BYPASSRLS` in the Supabase local stack — measured, §6). The read-only archetype
   is exercised via `rootlco_test_readonly`, and the FORCE-RLS owner demonstration
   via `rootlco_test_owner` (a non-`BYPASSRLS` owner fixture). Worker capability
   and concurrency evidence runs as `rootlco_test_worker`, a constrained member
   of `app_worker`, never as admin.
2. **Default deny is asserted, not assumed:** with no context set, SELECT returns
   zero rows and UPDATE affects zero rows.
3. **Transaction-locality is asserted:** context set with `set_config(..., true)`
   inside a transaction is gone after `ROLLBACK` — the same connection then sees
   zero rows.
4. **Cross-tenant isolation both ways:** tenant A (fixture UUID
   `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`) cannot read or update tenant B's rows
   (`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`) even when addressing them directly by
   ID, and `WITH CHECK` (plus the column grant) blocks re-pointing `tenant_id`
   (42501).
5. **Escape attempts fail loudly** (all verified):
   - `SET row_security = off` makes subsequent queries **ERROR with SQLSTATE
     42501** for a non-`BYPASSRLS` role — it is not a silent bypass;
   - `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` by the runtime role → 42501
     (not the owner);
   - INSERT and DELETE by the runtime role → 42501 (no grant, no policy);
   - `CREATE TABLE` in module schemas by the runtime role → 42501 (USAGE-only
     schema grants).
6. **FORCE RLS is demonstrated against a real non-`BYPASSRLS` owner**, including
   the honest limitation of §6 (owner can still `ALTER` its own table), recorded
   as a test rather than hidden.
7. Fixtures live in the disposable schema `p1_02_test`, created and dropped by the
   suite; fixture UUIDs are deterministic.

The same suite runs in CI (job "Database migrations and RLS tests",
`postgres:17-alpine` service container) after all migrations are applied to a
clean database — see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

Every future migration that creates a tenant-owned table must extend the suite
with the equivalent assertions for that table **in the same pull request**.

## 8. Future work (Phase 1-4 — stated as future, not implemented)

The following are **not implemented in Phase 1-2** and nothing in this document
may be read as claiming otherwise:

- **Membership tables** (`iam.*`): which users belong to which tenant, and which
  companies/branches they may act for.
- **Context-resolution middleware**: the application component that authenticates
  the session, resolves the entitled scope from the membership tables, and issues
  the `set_config(..., true)` calls at the start of each transaction.
- FKs from `tenant_id`/`company_id`/`branch_id` columns to `org.*` tables: the
  `org` schema is empty in Phase 1-2, so `shared.number_sequences` currently has
  **no foreign keys on those columns** — they are added in Phase 1-3 when the
  org tables exist (recorded honestly in the table comment and the data
  dictionary).

Until then, the context contract is exercised only by the test harness. The first
customer/pilot tenant (Benzene Vehicle Services) will be provisioned through
configuration when those phases arrive — never hard-coded, and never in
Phase 1-2.

## 9. RLS checklist for every new tenant-owned table

The creating migration must satisfy every row; the reviewer (under the Solo
Developer Review Policy) checks the migration and the accompanying tests against
this list.

| #   | Check                                                                                                                                                                     | Reference            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | `tenant_id uuid NOT NULL` present; composite FK `(tenant_id, parent_id) REFERENCES parent (tenant_id, id)` for every tenant-owned parent (Phase 1-3+, once parents exist) | §1, architecture doc |
| 2   | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` in the creating migration                                                                  | §2.1                 |
| 3   | Table owned by the migration/admin role — **never** by `app_runtime`/`app_readonly`/`app_worker` or a reachable login                                                     | §6                   |
| 4   | Tenant policies are per-command `sel_/ins_/upd_/del_`; enumerated infrastructure policies use reviewed `wkr_` names                                                       | §5.1–5.3             |
| 5   | Tenant policy predicates anchor on `tenant_id = iam.current_tenant_id()`; only the documented worker class may use all-tenant predicates                                  | §5.2–5.3             |
| 6   | Company/branch narrowing (where applicable) uses the `IS NULL OR ... = ANY (...)` form with `iam.allowed_company_ids()` / `iam.allowed_branch_ids()`                      | §5.4                 |
| 7   | No policy addressed to `PUBLIC`; `FOR ALL` / `USING (true)` exists only for a documented `wkr_` infrastructure policy                                                     | §2.2, §5.3           |
| 8   | Grants are explicit, per-object, narrowest-width (column-restricted where possible); every deliberately absent policy/grant is recorded in a migration comment            | §5.5, §2.2           |
| 9   | Soft-delete tables: no `del_` policy, no DELETE grant. Append-only tables: `ins_` + `sel_` only                                                                           | §5.2                 |
| 10  | Functions touching the table are `SECURITY INVOKER` with `SET search_path = ''`, or carry a written `SECURITY DEFINER` justification                                      | §2.6                 |
| 11  | Tests use the matching constrained login: `rootlco_test_runtime` for tenant isolation and `rootlco_test_worker` for worker boundaries/concurrency — never `postgres`      | §7                   |
| 12  | Nothing executed as a `BYPASSRLS` role (`postgres`, `service_role`, `supabase_admin`) is presented as isolation evidence                                                  | §6–7                 |
| 13  | `service_role` (BYPASSRLS) is never exposed to browsers or client bundles; the CI secret-scan job guards this                                                             | §6                   |
| 14  | Tenant-leading indexes per the index rules; any non-tenant-leading index carries a written justification in the migration                                                 | Architecture doc     |

---

_End of standard. Changes to this document follow the controlled-document process;
the reference implementation and proof suite must be updated in the same change
set whenever a rule here changes._
