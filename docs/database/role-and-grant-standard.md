# Database Role and Grant Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding engineering standard (Phase 1-2) ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, not independent review) ·
**Task IDs:** P1-02-DB-018 / P1-02-SEC-003 ·
**Related:** [RLS Standard](./rls-standard.md) ·
[Database Architecture](./database-architecture.md) ·
[Naming Standard](./database-naming-standard.md) ·
[Number Sequence Standard](./number-sequence-standard.md) ·
[Extension Register](./postgresql-extension-register.md) ·
[Phase 1-2 Initial Audit](../phase-1/phase-1-2/initial-audit.md)

This standard defines who may hold which database privilege, how privileges are
granted, and what evidence exists that the rules hold. It is implemented by
migration `supabase/migrations/0002_base_schemas.sql` (role archetypes, schema
grants) and practised by `supabase/migrations/0003_number_sequences.sql`
(per-object and column-level grants). Every behavioural claim in this document
was verified on 2026-07-16 by the database test suite (68 tests passing via
`npm run test:db`) or by direct inspection of `pg_roles` on the local Supabase
stack (PostgreSQL 17.6, DB port 54322).

The one later amendment is §5.7, the runtime foundation write surface added by
[DBCR-P1-13-001](./change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)
in migration `20260725090000_iam_shared_runtime_write_capabilities.sql`
(2026-07-21). Its evidence is that change request, not the 2026-07-16 run; §2.2,
§5.1, §5.4, §5.5 and §7 carry the cross-references.

---

## 1. Principles

1. **Deny by default.** No role receives a privilege it was not explicitly
   granted for a named object. There is no `GRANT ALL`, no blanket
   `ALTER DEFAULT PRIVILEGES`, and no reliance on `PUBLIC` defaults anywhere in
   the migration set.
2. **Separation of duty by archetype.** The role that applies migrations and
   owns objects is never the role the application runs as. Ownership implies
   powers (ALTER, policy changes, `NO FORCE ROW LEVEL SECURITY`) that a runtime
   path must never hold.
3. **Grants are part of the object's migration.** The migration that creates a
   table or function states its grants in the same file, so review sees the
   object and its privilege surface together.
4. **Nothing executed as `postgres` is isolation evidence.** In the Supabase
   local stack `postgres` carries `BYPASSRLS` (measured — see §4); results
   obtained on that connection prove nothing about Row-Level Security. All
   isolation evidence must come from a non-bypassing role.
5. **UUIDs are not authorisation tokens.** Knowledge of a tenant, company,
   branch, or row identifier never grants access. Access is granted only by
   role membership plus the server-resolved session context evaluated by RLS
   policies (see the [RLS Standard](./rls-standard.md)).

---

## 2. The role model — three application archetypes plus the owner

| Archetype           | Role name                                                        | LOGIN | Owns objects                         | BYPASSRLS                             | Purpose                                                                        |
| ------------------- | ---------------------------------------------------------------- | ----- | ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| Migration / owner   | `postgres` (Supabase local); `postgres` superuser (CI container) | yes   | yes — all schemas, tables, functions | yes (local: attribute; CI: superuser) | Applies migrations, owns everything, provisions and retires configuration rows |
| Runtime application | `app_runtime`                                                    | no    | **never**                            | no                                    | The privilege envelope of the future application connection                    |
| Read-only support   | `app_readonly`                                                   | no    | **never**                            | no                                    | Diagnostics and support reads; SELECT-only                                     |
| Async worker        | `app_worker`                                                     | no    | **never**                            | no                                    | Cross-tenant infrastructure dispatch on explicitly enumerated worker tables    |

### 2.1 Migration / owner role

Migrations are applied by the environment's administrative login: `postgres`
in the Supabase local stack, and `postgres` (a true superuser there) in the
plain `postgres:17-alpine` CI service container. This role owns every schema,
table, and function the migrations create.

Rules:

- The owner role **must never** be used by application code, the test suite's
  isolation assertions, or any runtime path. In the test harness it is used
  for fixture provisioning and cleanup only, and the harness records that
  distinction explicitly (`tests/db/helpers.ts`).
- Administrative-only operations — sequence provisioning and retirement in
  `shared.number_sequences`, future tenant onboarding configuration — run on
  the owner/admin path precisely so they are absent from the runtime grant
  surface and auditable as configuration changes.

### 2.2 `app_runtime` — the runtime application role

Created by migration 0002 exactly as:

```sql
CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
```

Binding rules, each verified by a passing test:

- **Must never own** a schema, table, or any other object. Verified:
  `tests/db/foundation.test.ts` asserts all three application archetypes own zero
  schemas and zero tables. Rationale: the FORCE RLS suite demonstrates that a
  table owner — even without `BYPASSRLS` — can still `ALTER` its own table and
  switch `FORCE ROW LEVEL SECURITY` off (`tests/db/rls.test.ts`, "honest
  limit" test). FORCE RLS guards against accidental owner queries, not a
  hostile owner; therefore the runtime role must simply never be an owner.
- **Receives only per-object grants** stated by the creating migration (§5).
  It holds `USAGE` on the module schemas and nothing else by default.
- **Cannot create objects**: schema grants are `USAGE`-only; `CREATE TABLE`
  in a module schema fails with SQLSTATE `42501` (verified).
- **Cannot disable or escape RLS**: `ALTER TABLE ... DISABLE ROW LEVEL
SECURITY` fails with `42501` (not the owner), and `SET row_security = off`
  makes subsequent queries **error** with `42501` rather than bypass
  (both verified).
- **Cannot touch protected append-only history**: immutable record classes
  (status history, audit evidence) receive `INSERT` + `SELECT` grants only;
  `UPDATE`/`DELETE` by the runtime role fail with `42501` (verified against
  the append-only fixture in `tests/db/patterns.test.ts`). The audit tables are
  the strictest instance of this class: DBCR-P1-13-001 gives the runtime role
  `INSERT` on `iam.audit_records`, `iam.audit_record_details`,
  `iam.audit_integrity_links` and `iam.security_events` and **no** `UPDATE`,
  `DELETE` or `TRUNCATE` anywhere, and it deliberately does not widen the read
  side — reading committed audit history and the security log still requires
  the `iam.audit.view` permission (§5.7).
- **Cannot perform administrative writes**: on `shared.number_sequences` there
  is deliberately no `INSERT` or `DELETE` policy **and** no grant — both
  attempts fail with `42501` (verified).

### 2.3 `app_readonly` — the read-only support role

Created by migration 0002 with the identical restriction set
(`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`).

- Receives **SELECT-only** grants, always under the same RLS policies as the
  runtime role (policy `sel_number_sequences_tenant` is addressed
  `TO app_runtime, app_readonly`).
- Verified: an `app_readonly` member reads its own tenant's rows and its
  `UPDATE` attempt fails with `42501` (`tests/db/rls.test.ts`).
- Intended use: support diagnostics and future reporting reads. It is not a
  reporting bypass — RLS applies in full, so a support session still requires
  a legitimate tenant context to see tenant rows.

### 2.4 `app_worker` — the asynchronous infrastructure role

Created by migration `20260718106000_shared_event_outbox.sql` with the same
restriction set as the other application archetypes: `NOLOGIN NOSUPERUSER
NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.

- Receives `USAGE` on only `shared` and `iam`, plus `EXECUTE` on
  `iam.current_user_id()` for worker-table metadata triggers.
- On `shared.event_outbox`, receives exactly `SELECT`, `INSERT`, and `UPDATE`;
  it receives no `DELETE`. It alone receives `EXECUTE` on
  `shared.claim_outbox_events`, `shared.complete_outbox_event`, and
  `shared.fail_outbox_event`.
- Its `wkr_event_outbox_all` policy deliberately uses `USING (true)` and
  `WITH CHECK (true)`. Dispatch is infrastructure work spanning all tenants,
  not a user session scoped to one tenant. This broad row surface is confined
  to explicitly enumerated worker tables and does not grant `BYPASSRLS`.
- A compromised future worker login can see or mutate every tenant's outbox
  through those three table verbs. Its credential is therefore backend-only;
  actual LOGIN provisioning remains Phase 1-13.

---

## 3. What our migrations do and do not manage

Our migrations create and manage exactly the three application archetypes:
`app_runtime`, `app_readonly` (migration 0002), and `app_worker` (Increment G).
Each creation is guarded by a catalog check because roles are cluster-wide and
migration replay must remain safe.

Supabase-managed roles (`postgres`, `supabase_admin`, `service_role`, `anon`,
`authenticated`, `authenticator`, and the rest of the managed set) are **not
modified** by any RootLco migration. Supabase owns their definitions and may
change them in a CLI or platform update; we document their measured state
(§4) but never depend on altering it.

---

## 4. Measured Supabase-managed role attributes

Inspected in `pg_roles` on the local Supabase stack (CLI 2.109.1, PostgreSQL
17.6) on 2026-07-16:

| Role             | Superuser | BYPASSRLS                         | CREATEROLE | CREATEDB | LOGIN | Consequence                                                                                                                                                              |
| ---------------- | --------- | --------------------------------- | ---------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres`       | **no**    | **yes**                           | yes        | yes      | yes   | Not a superuser in Supabase local — but `BYPASSRLS` means **no query run as `postgres` is ever RLS evidence**                                                            |
| `supabase_admin` | **yes**   | (superuser — bypasses everything) | yes        | yes      | yes   | Platform-internal; never used by us                                                                                                                                      |
| `service_role`   | no        | **yes**                           | no         | no       | no    | Bypasses RLS entirely — its key **must never reach a browser or any client-side context** (enforced in the application repo by `tests/security-browser-secrets.test.ts`) |
| `anon`           | no        | no                                | no         | no       | no    | No bypass; subject to RLS                                                                                                                                                |
| `authenticated`  | no        | no                                | no         | no       | no    | No bypass; subject to RLS                                                                                                                                                |
| `authenticator`  | no        | no                                | no         | no       | yes   | Connection role that switches into `anon`/`authenticated`/`service_role`                                                                                                 |

Honest consequences, stated as binding rules:

1. **RLS evidence must come from a non-bypassing role.** Tenant-session
   isolation assertions run as `rootlco_test_runtime`; worker-boundary and
   all-tenant dispatch assertions run as `rootlco_test_worker`. Both are
   constrained archetype members. Presenting `postgres`-connection results as
   RLS evidence is prohibited (see the
   [RLS Standard](./rls-standard.md)).
2. **Environment difference is real and documented.** In the plain
   `postgres:17` CI container, `postgres` **is** a superuser. CI therefore
   validates migrations and RLS behaviour on plain PostgreSQL 17, not the full
   Supabase stack; Supabase-managed roles differ or do not exist there. This
   gap is accepted and recorded — CI results about Supabase-specific role
   behaviour must not be claimed.
3. **Supabase may change its managed roles.** Any future reliance on a
   specific attribute of a Supabase-managed role must be re-verified against
   the pinned CLI version at that time, not assumed from this table.

---

## 5. Grant rules

### 5.1 Schema level: `USAGE` only

Migration 0002 grants exactly:

```sql
GRANT USAGE ON SCHEMA org, iam, shared, crm, veh TO app_runtime, app_readonly;
```

Neither tenant-session role holds `CREATE` on any schema, and
`REVOKE CREATE ON SCHEMA public FROM PUBLIC` keeps `public` from becoming an
uncontrolled dumping ground. A runtime `CREATE TABLE` attempt fails with
`42501` (verified).

Increment G additionally grants `app_worker` `USAGE` on only `shared` and
`iam`. It receives no schema `CREATE` and no blanket/default privilege.

**No role holds `USAGE` on schema `extensions`, and none may be given it
casually.** DBCR-P1-13-001 rehearsed the obvious grant and then measured what it
opens: pgcrypto installs `extensions.pg_stat_statements` and
`extensions.pg_stat_statements_info` with `SELECT` to `PUBLIC`, and a `PUBLIC`
grant cannot be revoked for a single role — so schema USAGE would have handed the
request role a cluster-wide statement view. The dependency was removed instead of
paid for: `iam.audit_hash` now calls `pg_catalog.sha256`, which every role may
execute with no grant at all. Any future proposal to grant `USAGE ON SCHEMA
extensions` must first enumerate every `PUBLIC`-granted object the target
extension set installs there.

### 5.2 Table level: per-object grants in the creating migration

The migration that creates a table must state that table's grants in the same
file, scoped to the minimum verbs each archetype needs. The practised example
(migration 0003):

```sql
GRANT SELECT ON shared.number_sequences TO app_runtime, app_readonly;
GRANT UPDATE (next_value, current_period) ON shared.number_sequences TO app_runtime;
```

Rules:

- **No `GRANT ALL`** — ever. Each verb (`SELECT`, `INSERT`, `UPDATE`,
  `DELETE`) is granted individually and only where a policy exists to govern
  it. A grant without a matching RLS policy on a tenant-owned table is a
  defect (the verb would be structurally allowed but always denied — or worse,
  allowed without tenant scoping on a non-RLS table).
- **No blanket `ALTER DEFAULT PRIVILEGES`.** Default-privilege rules grant
  invisibly to future objects and defeat per-object review. Prohibited.
- **Absent grants are deliberate and documented.** `shared.number_sequences`
  has no runtime `INSERT`/`DELETE` grant because provisioning and retirement
  are administrative configuration actions. A migration must comment such
  deliberate absences so review can distinguish them from omissions.
- **Immutable/append-only classes** (status history, audit evidence) receive
  `INSERT` + `SELECT` only for the runtime role. Verified by the append-only
  fixture: runtime `UPDATE` and `DELETE` fail with `42501`.

### 5.3 Column-level grants where they narrow risk

Where the runtime role legitimately writes only a subset of columns, the
grant must name those columns. The practised example: the allocator in
`shared.next_display_number()` writes only `next_value` and `current_period`;
metadata columns (`updated_at`, `updated_by`, `record_version`) are written by
the `shared.touch_row_metadata()` trigger, and `tenant_id` is not writable at
all. The column list gives two independent refusals for a tenant re-pointing
attempt: the missing column grant **and** the policy `WITH CHECK` — verified
as SQLSTATE `42501` in `tests/db/rls.test.ts`.

### 5.4 Function level: explicit `EXECUTE` (with the PUBLIC default revoked)

PostgreSQL grants `EXECUTE` on every newly created function to `PUBLIC` by
default — an explicit grant on top of that default changes nothing. **Binding
rule: the migration that creates a function must `REVOKE EXECUTE ... FROM
PUBLIC` and then grant explicitly.** (This gap was found by the Phase 1-2
adversarial review — the original drafts granted without revoking, so any role
could execute the allocator — and was fixed in migrations 0002/0003 before
merge; the denial is now verified by tests: an unprivileged login and
`app_readonly` both receive SQLSTATE `42501` calling the allocator.)
Practised examples:

```sql
REVOKE EXECUTE ON FUNCTION
  iam.current_tenant_id(),
  iam.current_user_id(),
  iam.allowed_company_ids(),
  iam.allowed_branch_ids()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  iam.current_tenant_id(),
  iam.current_user_id(),
  iam.allowed_company_ids(),
  iam.allowed_branch_ids()
TO app_runtime, app_readonly;                                   -- migration 0002

REVOKE EXECUTE ON FUNCTION shared.next_display_number(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.next_display_number(text, uuid, uuid)
TO app_runtime;                                                  -- migration 0003
```

Trigger functions (`shared.touch_row_metadata()`,
`shared.guard_number_sequence_regression()`) are invoked by triggers, not by
callers: their `PUBLIC` default is revoked and **no** role receives `EXECUTE`.

Note the asymmetry is intentional: `app_readonly` may read context but is not
granted the allocator — allocation is a write.

**A `SECURITY INVOKER` entry point is not one grant, it is a call chain.**
Because the body runs with the caller's privileges, every helper it calls, every
table it reads, and every schema it resolves through must be reachable by the
caller too. Granting `EXECUTE` on the entry point alone produces a runtime
`permission denied` on the first helper, not a clean refusal at the boundary.
DBCR-P1-13-001 is the practised example: making `iam.audit_append` callable
required `EXECUTE` on all four functions in the chain —

```sql
GRANT EXECUTE ON FUNCTION
  iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb)
  TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_mask(text, text)  TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid)   TO app_runtime;
GRANT EXECUTE ON FUNCTION iam.audit_hash(bytea, text) TO app_runtime;
--                                        migration 20260725090000
```

— plus RLS policies for the rows the body reads and writes. The rule that
follows: a migration granting `EXECUTE` on an invoker function must state the
whole reachable surface that grant implies, and must not assume any of it. The
same review found that `iam.audit_hash` reached `extensions.digest`, and removed
that reach rather than granting schema USAGE for it (§5.1).

Deliberately still ungranted after DBCR-P1-13-001: `iam.audit_verify_chain` (an
operator/forensic routine, not a request-path capability),
`org.provision_organization`, and `shared.claim_outbox_events` /
`complete_outbox_event` / `fail_outbox_event` — a producer must not be able to
claim, complete, or fail queue work.

### 5.5 Worker grant surface added by Phase 1-5 Increment G

| Object                                                          | `app_worker`           |
| --------------------------------------------------------------- | ---------------------- |
| Schemas `shared`, `iam`                                         | USAGE                  |
| `iam.current_user_id()`                                         | EXECUTE                |
| `shared.event_outbox`                                           | SELECT, INSERT, UPDATE |
| `shared.claim_outbox_events(text, integer, interval)`           | EXECUTE                |
| `shared.complete_outbox_event(uuid, text)`                      | EXECUTE                |
| `shared.fail_outbox_event(uuid, text, text, interval, integer)` | EXECUTE                |
| DELETE, DDL, ownership, other tables/functions                  | —                      |

This exact surface is paired with the deliberately all-tenant
`wkr_event_outbox_all` policy. `app_readonly` receives zero grant and zero policy
on the outbox and its routines, and `app_runtime` receives zero on the three
routines. Since DBCR-P1-13-001 the runtime role does hold tenant-scoped
`SELECT` + `INSERT` on the `shared.event_outbox` **table** (§5.7), because an
event must be written in the producer's own transaction; the archetypes stay
separated where it matters, since publishing an event and draining the queue
remain different capabilities held by different roles.

### 5.6 Foundation grant surface (Phase 1-2, verified)

| Object                                                                       | `app_runtime`                                                                | `app_readonly` |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------- |
| Schemas `org`, `iam`, `shared`, `crm`, `veh`                                 | USAGE                                                                        | USAGE          |
| `shared.number_sequences`                                                    | SELECT; UPDATE (`next_value`, `current_period`)                              | SELECT         |
| `iam.current_tenant_id()` etc. (4 context readers)                           | EXECUTE                                                                      | EXECUTE        |
| `shared.next_display_number(text, uuid, uuid)`                               | EXECUTE                                                                      | —              |
| Trigger functions (`touch_row_metadata`, `guard_number_sequence_regression`) | — (PUBLIC revoked; trigger-invoked only)                                     | —              |
| Everything else                                                              | — (later phases add per-object grants; the foundation write surface is §5.7) | —              |

### 5.7 Runtime foundation write surface (DBCR-P1-13-001, migration `20260725090000`)

The Release 2 baseline gave `app_runtime` `SELECT` only across `shared` and
`iam`, which left the backend foundation unable to append an audit record,
publish a domain event, store an idempotency key, or record a security event.
Those four capabilities were granted, and nothing else was. This is the whole of
the added surface:

| Object                                                                                    | `app_runtime`              | `app_readonly` |
| ----------------------------------------------------------------------------------------- | -------------------------- | -------------- |
| `iam.audit_append(...)`, `iam.audit_mask`, `iam.audit_canonical`, `iam.audit_hash`        | EXECUTE                    | —              |
| `iam.audit_records`, `iam.audit_record_details`, `iam.audit_integrity_links`              | INSERT                     | —              |
| `iam.security_events`                                                                     | INSERT                     | —              |
| `shared.event_outbox`                                                                     | SELECT, INSERT             | —              |
| `shared.idempotency_keys`                                                                 | SELECT, INSERT             | —              |
| UPDATE / DELETE / TRUNCATE on any of the above                                            | —                          | —              |
| `iam.audit_verify_chain`, `org.provision_organization`, the three outbox worker routines  | —                          | —              |
| `shared.processed_events`, `shared.error_records`                                         | — (worker-only, unchanged) | —              |
| Schema `extensions`, `BYPASSRLS`, ownership, any new role, any `SECURITY DEFINER` routine | —                          | —              |

Eleven RLS policies accompany the grants, every one of them
`tenant_id = iam.current_tenant_id()` — there is no `USING (true)` and no
`WITH CHECK (true)` in the set, so a session with no resolved tenant matches
nothing. Two properties of the read side deserve stating plainly, because a
casual reading of "the runtime may now write audit records" would get them wrong:

- `sel_audit_records_unlinked` and `sel_audit_record_details_unlinked` expose
  only rows that have **no chain link yet**. `iam.audit_append` writes the link
  last, so this is the row under construction inside the current call and never a
  committed record. **Reading audit history still requires the `iam.audit.view`
  permission** through the pre-existing `sel_audit_*_permitted` policies, and the
  same is true of `iam.security_events`, which gained `INSERT` and no new
  `SELECT` policy at all.
- `sel_audit_integrity_links_chain` is a real widening and is recorded as such:
  any session of a tenant may now read that tenant's chain links, where before it
  could read none. Extending a hash chain requires the previous link, and the
  policy cannot be narrowed to "the newest link" because that needs `max(seq)`
  over the table inside its own policy, which PostgreSQL rejects as infinite
  recursion. The exposed columns are a per-tenant counter, an opaque record id,
  two SHA-256 digests, and `tenant_id` — no action, actor, entity, or field
  value. Accepted as a Low residual in DBCR-P1-13-001 §7.

`shared.idempotency_keys` and `iam.security_events` have nullable `tenant_id`
by design, for platform-scope rows. The tenant-scoped predicate evaluates to
NULL for those rows, so a tenant session can neither read nor write them;
platform provisioning keeps using a platform connection.

---

## 6. How later phases attach real logins

`app_runtime`, `app_readonly`, and `app_worker` are `NOLOGIN` archetypes: they define
privilege envelopes, not connections. A phase that needs a real connection
creates a `LOGIN` role and grants it the archetype — membership inherits, so
every grant and every RLS policy addressed `TO app_runtime` applies to the
login automatically.

The mechanics are already documented by the test harness
(`tests/db/helpers.ts`), which creates its logins this way — **the harness
creates them, never a migration**, because test logins are environment
concerns, not schema:

```sql
-- Test harness pattern (local/CI only; password is deliberately fake):
CREATE ROLE rootlco_test_runtime LOGIN PASSWORD '...'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT app_runtime TO rootlco_test_runtime;
```

Binding rules for future application logins (Phase 1-3 and later):

- The application connects as a `LOGIN` role that is a **member of
  `app_runtime`** and carries no attribute beyond `LOGIN`
  (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, and it must not own
  anything).
- Support/diagnostic connections use a login granted `app_readonly`.
- Infrastructure dispatch connections use a backend-only login granted
  `app_worker`; credential handoff remains Phase 1-13.
- Login roles and their credentials are provisioned per environment by
  operational tooling, never created by migrations and never committed.
  Local dev and CI use separate non-production credentials
  (see [ADR-012](../adr/ADR-012-local-first-environment-with-controlled-promotion.md) —
  no Development/Staging/Production environment exists yet, and this document
  makes no claim about one).
- Every connection must establish the transaction-scoped session context
  (`app.tenant_id` etc.) before touching tenant-owned data; the context
  contract and its server-side resolution rules are defined in the
  [RLS Standard](./rls-standard.md).

Illustration only — a Phase 1-3+ migration creating a business table would
follow the same shape (this object does **not** exist today):

```sql
-- ILLUSTRATION (Phase 1-3+): org.companies does not exist in Phase 1-2.
GRANT SELECT, INSERT, UPDATE ON org.companies TO app_runtime;
GRANT SELECT ON org.companies TO app_readonly;
-- No DELETE: companies are controlled business records — soft delete only
-- (deleted_at), per the base metadata standard.
```

---

## 7. SECURITY DEFINER policy

`SECURITY DEFINER` functions run with the **owner's** rights. Because every
object owner in this platform is the migration role — which carries
`BYPASSRLS` in the Supabase stack — a `SECURITY DEFINER` function is a
potential RLS bypass wrapped in a function signature.

Binding rules:

1. **Prohibited by default.** Every function must be declared
   `SECURITY INVOKER` (explicitly, not by omission) unless an exception is
   approved.
2. **Each exception requires**, before merge:
   - a recorded justification in the migration header and in the relevant
     standard, explaining why invoker rights cannot work;
   - a hardened, pinned `search_path` (`SET search_path = ''` with fully
     qualified references, or an explicit minimal path) — an unpinned
     `search_path` in a definer function is an escalation vector;
   - the narrowest possible `EXECUTE` grant; and
   - review at the phase gate under the Solo Developer Review Policy, recorded
     as such (technical self-review — never described as independent review).
3. **The practised counter-example:** `shared.next_display_number()` is
   deliberately `SECURITY INVOKER` with `SET search_path = ''`, so RLS applies
   in full to the caller — the function is not an RLS bypass, the tenant comes
   exclusively from `iam.current_tenant_id()` (no tenant parameter, by
   design), and company/branch arguments are validated against the session's
   allowed lists. All four context readers and both trigger functions in
   migrations 0002–0003 are likewise `SECURITY INVOKER` with empty
   `search_path`. As of Phase 1-2 there are **zero** `SECURITY DEFINER`
   functions in the codebase, and the count is still zero across the 17 module
   schemas after migration `20260725090000` — DBCR-P1-13-001 chose grants plus
   tenant-scoped policies precisely so that no definer wrapper had to be
   introduced to let the request path write.

---

## 8. Verification evidence and honest gaps

### 8.1 Evidence (all measured 2026-07-16)

- 68/68 database tests passing via `npm run test:db` (vitest + `pg` driver)
  against the local stack; the same suite runs in CI against a clean
  `postgres:17-alpine` container after all migrations are applied by
  `scripts/db/apply-migrations.mjs`.
- Role-attribute assertions: `tests/db/foundation.test.ts` verifies both
  archetypes are `NOSUPERUSER NOBYPASSRLS NOLOGIN NOCREATEROLE NOCREATEDB`
  and own no schema or table.
- Escape-attempt assertions (all as `rootlco_test_runtime`):
  `tests/db/rls.test.ts` verifies the runtime role cannot INSERT, DELETE,
  ALTER, disable RLS, or use `SET row_security = off`; and that column grants
  plus `WITH CHECK` block tenant re-pointing.
- Owner-behaviour demonstration: FORCE RLS locks out a non-`BYPASSRLS` table
  owner (fixture login `rootlco_test_owner`), **but** that owner can still
  `ALTER` its own table — recorded honestly as the reason runtime roles must
  never own tables, not as a claim that FORCE RLS restrains owners.

### 8.2 Honest gaps

- **CI is not the Supabase stack.** CI proves the migrations and the
  role/grant/RLS behaviour on plain PostgreSQL 17. Supabase-managed roles
  (`service_role`, `authenticator`, …) are absent or different there; §4's
  table is a local-stack measurement only. Accepted and documented.
- **No production environment exists** (ADR-012). Rules in §6 about
  operational login provisioning describe the required future shape; they are
  not yet exercised anywhere beyond the test harness.
- **`tenant_id`/`company_id`/`branch_id` in `shared.number_sequences` have no
  foreign keys yet** — `org.*` tables do not exist until Phase 1-3, when the
  FKs are added. Until then, referential integrity for those columns rests on
  RLS scoping and the administrative provisioning path alone.
- **All reviews under this standard are solo-developer self-reviews** per the
  [Solo Developer Review Policy](../governance/solo-developer-review-policy.md).
  No claim of independent review is made anywhere in this document.
