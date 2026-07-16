# Database Architecture

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Active — binding engineering standard (Phase 1-2 Database Standards Gate) ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar, under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md)
(technical self-review; not an independent review) ·
**Related:** Tasks P1-02-DB-002 (consolidating architecture document) and the
P1-02-DB / P1-02-SEC / P1-02-DOC series; branch
`feature/p1-02-database-engineering-foundation`; migrations
[`0001`](../../supabase/migrations/0001_extensions.sql) ·
[`0002`](../../supabase/migrations/0002_base_schemas.sql) ·
[`0003`](../../supabase/migrations/0003_number_sequences.sql)

---

This is the consolidating Database Architecture Document for the platform. It stands
alone: every architectural rule is stated here in full, with its rationale, and the
companion standards in [§11](#11-companion-standards) deepen individual topics without
replacing anything written here. Every rule below is **binding** ("must") for all
database work from Phase 1-3 onward, and is already practised by migrations 0001–0003.

Two scope statements govern the whole document:

- **Phase 1-2 creates no business-domain tables.** No tenants, companies, branches,
  users, customers, vehicles, appointments, inspections, quotations, work orders,
  inventory, invoices, or payments exist yet. This document _describes how later phases
  must build them_. Every SQL block that references such a table is explicitly marked
  **ILLUSTRATION — Phase 1-3+** and describes a future object, not an existing one.
- **Benzene Vehicle Services** is the first customer and pilot tenant. It is onboarded
  purely through configuration (ADR-008, ADR-009) and must never appear hard-coded in
  any schema, policy, function, or seed. **Zoom Vehicle Inspection and Evaluation
  Services is outside Phase 1** (ADR-010): no table, policy, seed, or workflow may be
  defined for it.

## 1. Purpose and governing ADRs

The platform is a multi-tenant automotive CRM/ERP. The database is its primary
correctness boundary: tenant isolation, referential integrity, monetary precision, and
audit evidence are enforced _in PostgreSQL_, not merely promised by application code.
Five accepted ADRs govern this architecture:

| ADR                                                                 | Decision                        | Consequence for the database                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](../adr/ADR-001-modular-monolith-architecture.md)          | Modular monolith                | One database, one schema per module, controlled cross-module interfaces (§3)                                                                      |
| [ADR-003](../adr/ADR-003-supabase-and-postgresql-data-platform.md)  | Supabase / PostgreSQL           | PostgreSQL 17 is the engine of record; Supabase local stack for development (PostgreSQL 17.6 measured locally, CLI 2.109.1 pinned, DB port 54322) |
| [ADR-004](../adr/ADR-004-mandatory-row-level-security-direction.md) | Mandatory Row-Level Security    | Every tenant-owned table carries RLS, enabled **and forced**, default deny (§5)                                                                   |
| [ADR-005](../adr/ADR-005-database-first-delivery-sequence.md)       | Database-first delivery         | Schema, constraints, policies, and their tests are designed and proven before application features consume them                                   |
| [ADR-008](../adr/ADR-008-configuration-driven-tenant-onboarding.md) | Configuration-driven onboarding | Tenants (including Benzene) are rows and configuration packages, never schema branches or hard-coded values                                       |

Related but subordinate: [ADR-012](../adr/ADR-012-local-first-environment-with-controlled-promotion.md)
— there is **no Development/Staging/Production environment today**; only the local
Supabase stack and the CI database exist, as separate instances with separate
non-production credentials. Production data is prohibited in both. No document may
claim otherwise.

## 2. Module schemas and ownership

Migration 0002 creates the five module schemas. A schema is a module boundary, not a
convenience namespace.

| Schema   | Owning module                                         | Phase 1-2 content                                                                                                                     | First tables        |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `org`    | Organization structure (tenants, companies, branches) | Empty — namespace only                                                                                                                | Phase 1-3           |
| `iam`    | Identity and access                                   | Context-reader functions only (§5.2); no tables                                                                                       | Phase 1-4           |
| `shared` | Cross-module shared primitives **only**               | `shared.number_sequences`, `shared.touch_row_metadata()`, `shared.next_display_number()`, `shared.guard_number_sequence_regression()` | Present (0002/0003) |
| `crm`    | CRM module                                            | **RESERVED — intentionally empty**                                                                                                    | Phase 1-5 per plan  |
| `veh`    | Vehicle module                                        | **RESERVED — intentionally empty**                                                                                                    | Its own phase       |

Binding rules:

- A table must be created in the schema of the module that owns its lifecycle. A table
  belongs in `shared` **only** if no single module owns it (the number-sequence table
  qualifies; a customers table never would).
- `public` is **not an application schema**. Migration 0002 executes
  `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (explicit even though PostgreSQL 15+
  defaults this way, so the posture survives environment differences and is visible in
  review). No application object may be created in `public`.
- The `crm` and `veh` schemas must remain empty until their phases open. Creating an
  object there in Phase 1-2 is a standards violation.
- Extensions live in the dedicated `extensions` schema (migration 0001): pgcrypto 1.3,
  btree_gist 1.7, citext 1.6, pg_trgm 1.6, as installed and measured on 2026-07-16.
  Migration 0001 also sets the database default
  `search_path TO "$user", public, extensions` so extension operator classes resolve.
  The register of purpose, approval, and removal implications is
  [postgresql-extension-register.md](postgresql-extension-register.md).

### 2.1 The modular-monolith database rule

- **A module owns its schema.** Only the owning module's migrations may create, alter,
  or drop objects in it.
- **No direct cross-module mutation of private tables.** Module A must never
  INSERT/UPDATE/DELETE module B's private tables directly.
- **Cross-module changes go through controlled interfaces**: functions owned by the
  target module, application-layer services, or documented transactional interfaces —
  always documented, always reviewed. `shared.next_display_number()` is the first
  example: any module may _call_ it, but only it touches `shared.number_sequences`
  allocation state.
- **Shared primitives live only in `shared`**, and each one must justify why no module
  owns it.
- Reading another module's tables is permitted where grants and RLS allow it, but a
  reader must treat foreign tables as an interface, never as a place to write.

Rationale: this preserves the option to extract a module later (ADR-001) and keeps every
cross-module side effect reviewable at a named interface rather than scattered DML.

## 3. Identifier standard — UUID primary keys

Every table must declare:

```sql
id uuid NOT NULL DEFAULT gen_random_uuid(),
CONSTRAINT pk_<table> PRIMARY KEY (id)
```

- `gen_random_uuid()` is **native in PostgreSQL 13+**; on our PostgreSQL 17 platform it
  requires **no extension**. pgcrypto is installed for `digest`/`hmac`/
  `gen_random_bytes` (idempotency request fingerprints, token material) — **not** for
  UUID generation, and no migration may claim otherwise.
- Every foreign-key column is `uuid` with the `_id` suffix
  ([naming standard](database-naming-standard.md)).
- **UUIDs are not authorization tokens.** Knowledge of an ID never grants access.
  Authorization is always the combination of server-side authorization logic and
  Row-Level Security evaluated against the server-resolved session context (§5.2). An
  endpoint that returns a row because the caller supplied its UUID, without RLS and
  authorization passing, is a defect.
- **UUIDs are not public display numbers.** Human-facing document numbers (quotation
  No., work-order No., invoice No. — issued by later phases) come exclusively from
  `shared.number_sequences` via `shared.next_display_number()` (migration 0003;
  [number-sequence-standard.md](number-sequence-standard.md)). UUIDs must not be shown
  to customers as reference numbers, and display numbers must not be used as join keys.

## 4. Multi-tenant, multi-company, multi-branch scope columns

The platform is one database serving many tenants; a tenant may operate multiple
companies; a company may operate multiple branches.

Binding rules:

- Every tenant-owned table must carry `tenant_id uuid NOT NULL`. There are no
  exceptions for "small" or "internal" tables; a table without `tenant_id` must be
  provably platform-global and documented as such.
- `company_id` and `branch_id` are added where the business object is genuinely scoped
  to that level. A branch-scoped row must also state its company
  (`shared.number_sequences` enforces exactly this:
  `CHECK (branch_id IS NULL OR company_id IS NOT NULL)`).
- **Client-supplied scope values are never authorization sources.** A tenant, company,
  or branch identifier arriving from a client is a validation input at most. The values
  that govern access are resolved **server-side** from the authenticated session and
  installed into the transaction-local context (§5.2). This is why
  `shared.next_display_number()` deliberately has _no tenant parameter_: the tenant
  comes only from `iam.current_tenant_id()`.
- Cross-tenant references must be structurally impossible, not merely filtered.
  From Phase 1-3 onward, child tables must use composite foreign keys that carry the
  tenant (and where applicable the company) through the reference:

```sql
-- ILLUSTRATION — Phase 1-3+. org.companies and org.branches DO NOT EXIST yet.
CREATE TABLE org.branches (
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  -- ...
  CONSTRAINT pk_branches PRIMARY KEY (id),
  -- Parent must expose UNIQUE (tenant_id, id) for this to attach.
  CONSTRAINT fk_branches_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.companies (tenant_id, id)
    ON DELETE RESTRICT
);
```

The composite-FK mechanism is already proven against disposable fixtures in
[tests/db/constraints.test.ts](../../tests/db/constraints.test.ts): a
`FOREIGN KEY (tenant_id, parent_id) REFERENCES (tenant_id, id)` rejects a cross-tenant
link with SQLSTATE 23503, and `ON DELETE RESTRICT` blocks deleting a referenced parent.
`ON DELETE CASCADE` across tenant-owned business data is prohibited for controlled
records (§7); RESTRICT is the default posture.

## 5. Row-Level Security and the session-context contract

RLS is mandatory (ADR-004) and is summarised here because no architectural section
stands without it; the full standard is [rls-standard.md](rls-standard.md).

### 5.1 Policy posture

Every tenant-owned table must, in the migration that creates it:

1. `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` (the owner is not
   exempt unless the role carries BYPASSRLS);
2. define per-command policies named `<action>_<table>_<scope>` with `sel_`/`ins_`/
   `upd_`/`del_` prefixes, comparing `tenant_id = iam.current_tenant_id()` in `USING`
   and `WITH CHECK`;
3. omit policies for commands runtime roles must not perform (default deny — e.g.
   `shared.number_sequences` has **no** INSERT/DELETE policy or grant for runtime
   roles, because sequence provisioning is administrative configuration).

With no context set, `iam.current_tenant_id()` returns NULL and every comparison
matches no rows: **default deny**.

### 5.2 The transaction-scoped context contract

Migration 0002 defines the contract. The application sets, inside a transaction, using
transaction-local `set_config(..., true)`:

| Setting           | Content                                        | Reader function             |
| ----------------- | ---------------------------------------------- | --------------------------- |
| `app.tenant_id`   | single UUID                                    | `iam.current_tenant_id()`   |
| `app.user_id`     | single UUID (actor attribution)                | `iam.current_user_id()`     |
| `app.company_ids` | comma-separated UUID list (optional narrowing) | `iam.allowed_company_ids()` |
| `app.branch_ids`  | comma-separated UUID list (optional narrowing) | `iam.allowed_branch_ids()`  |

The readers are `STABLE`, `SECURITY INVOKER`, hardened with `search_path = ''`, and
contain no IAM business logic (membership tables and context _resolution_ are
Phase 1-4). The context values are resolved server-side from the authenticated session;
client-supplied identifiers are never written into this context. The context is
transaction-local: it evaporates at ROLLBACK — proven by test.

### 5.3 Roles

Migration 0002 creates the archetypes `app_runtime` and `app_readonly`
(`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`), with
USAGE-only schema grants; every table/function privilege is an explicit per-object
grant in the migration that creates the object. Full detail, including the **measured**
attributes of Supabase-managed roles, is in
[role-and-grant-standard.md](role-and-grant-standard.md). Two honest facts must be
repeated wherever RLS evidence is discussed:

- In the local Supabase stack, the `postgres` role is **not** a superuser but carries
  **BYPASSRLS** (plus CREATEROLE, CREATEDB). Nothing executed as `postgres` proves
  anything about RLS. All isolation evidence in the test suite runs as the login
  `rootlco_test_runtime`, a member of `app_runtime` created by the test harness (never
  by migrations). `service_role` also carries BYPASSRLS — which is exactly why it must
  never reach a browser.
- FORCE RLS locks out even a non-BYPASSRLS table **owner** (proven with a fixture owner
  login), _but an owner can still ALTER its own table_ — recorded honestly as the
  reason runtime roles must never own tables.

## 6. Base row-metadata standard

Every mutable table must carry, exactly as practised by `shared.number_sequences`:

```sql
record_version integer     NOT NULL DEFAULT 1,
created_at     timestamptz NOT NULL DEFAULT now(),
created_by     uuid        NOT NULL,
updated_at     timestamptz NULL,
updated_by     uuid        NULL
```

and attach the shared trigger in the same migration:

```sql
CREATE TRIGGER tg_<table>_touch_metadata
  BEFORE UPDATE ON <schema>.<table>
  FOR EACH ROW
  EXECUTE FUNCTION shared.touch_row_metadata();
```

`shared.touch_row_metadata()` (migration 0002) stamps `updated_at := now()`,
`updated_by := iam.current_user_id()`, and advances
`record_version := OLD.record_version + 1` — always exactly +1, so a caller can neither
skip nor replay versions.

**Optimistic concurrency** is the standard update discipline for user-editable records:

```sql
-- ILLUSTRATION — the pattern; the table is a Phase 1-3+ example.
UPDATE org.companies
SET    display_name = $2
WHERE  id = $1
  AND  record_version = $3;  -- expected version read by the client
-- 0 rows updated ⇒ concurrent modification ⇒ the application returns a conflict,
-- never silently overwrites.
```

Metadata columns are written by the trigger, not by callers; column-restricted grants
(as on `shared.number_sequences`, where `app_runtime` may UPDATE only `next_value` and
`current_period`) keep it that way.

## 7. Record lifecycle classes — soft delete, archive, immutable

Every table must declare which lifecycle class it belongs to, in the migration comment
and the data dictionary.

| Class                       | Columns / posture                                       | Rules                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Soft-deletable**          | `deleted_at timestamptz NULL`, `deleted_by uuid NULL`   | Controlled business records are **never hard-deleted** by the application. Uniqueness of natural keys applies to _active_ rows only, via a partial unique index (below).                                                                                                   |
| **Archivable**              | `archived_at timestamptz NULL`, `archived_by uuid NULL` | Archive removes a record from operational views without deleting it; distinct from soft delete (archive is routine housekeeping, soft delete is removal-with-evidence).                                                                                                    |
| **Immutable / append-only** | No update/delete path at all                            | Status history, audit evidence, immutable financial history. Runtime roles receive **INSERT + SELECT grants only**, and no UPDATE/DELETE policy exists — two independent layers both deny (proven: 42501 in [tests/db/patterns.test.ts](../../tests/db/patterns.test.ts)). |

The active-only uniqueness template (proven in
[tests/db/constraints.test.ts](../../tests/db/constraints.test.ts): the partial unique
index enforces uniqueness among live rows and frees the code after soft delete):

```sql
-- ILLUSTRATION — the template; attach to real tables from Phase 1-3 onward.
CREATE UNIQUE INDEX uq_customers_tenant_code_active
  ON crm.customers (tenant_id, code)
  WHERE deleted_at IS NULL;
```

Hard deletion is not the application's job: retention-driven deletion runs as a
controlled, audited job with referential checks — never ad-hoc SQL — and legal hold
blocks it. Retention classes (operational / evidence-audit / personal-data / temporary
/ immutable-financial-history), sensitivity classes (public / internal / restricted /
secret), and the rule that retention periods are **jurisdiction-configured, never
hard-coded** (no Jordan-specific or any other jurisdictional assumption in schema) are
specified in
[data-retention-and-classification-standard.md](data-retention-and-classification-standard.md).
No plaintext secrets may be stored in business tables.

## 8. The status-history pattern

State machines on business documents (appointments, work orders, invoices — all
Phase 1-3+) must record every transition in an append-only history table with this
exact column set, proven against a disposable fixture in
[tests/db/patterns.test.ts](../../tests/db/patterns.test.ts):

```sql
-- ILLUSTRATION — the template as pinned by the test fixture.
CREATE TABLE <module>.<entity>_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  <entity>_id    uuid        NOT NULL,
  from_state     text        NULL,      -- NULL for the initial transition
  to_state       text        NOT NULL,
  reason         text        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,
  CONSTRAINT pk_<entity>_status_history PRIMARY KEY (id),
  CONSTRAINT ck_<entity>_status_history_state_change
    CHECK (from_state IS DISTINCT FROM to_state)
);
```

Binding rules, each one covered by a passing test:

- The history row is written **in the same transaction** as the entity's state change —
  the transition and its evidence commit or roll back together.
- RLS enabled and forced; `sel_` and `ins_` tenant policies only. `WITH CHECK` blocks
  writing history into another tenant.
- Runtime grants are **SELECT + INSERT only**. UPDATE and DELETE are denied both by the
  absence of grants and by the absence of policies (42501 — history is evidence).
- No-op transitions (`from_state = to_state`) are rejected by the CHECK constraint
  (23514).
- `correlation_id` ties the transition to the request/operation that caused it, for
  audit reconstruction.

The companion idempotency-key pattern (per-tenant `UNIQUE (tenant_id,
idempotency_key)`, request-fingerprint comparison, response-snapshot replay,
`expires_at` as data with cleanup as a controlled deletion) is pinned by the same test
file; the permanent `shared.idempotency_keys` table is deliberately **not** created in
Phase 1-2 because no business operation exists to be idempotent yet.

## 9. Data-type standard (summary)

Full standard: [data-type-standard.md](data-type-standard.md). The binding summary:

| Concern                       | Rule                                                                                                    | Rationale                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Money, quantities             | `numeric` with documented precision. **Never `real`/`double precision`/any float.**                     | Floats cannot represent decimal amounts exactly; financial records must be exact.       |
| Currency                      | ISO 4217 code in a separate `text` column                                                               | No jurisdiction or tax assumption hard-coded (Jordan included) — configuration decides. |
| Time                          | `timestamptz` always (UTC); `date` only for true calendar concepts                                      | Unambiguous instants across time zones.                                                 |
| Strings                       | `text`, not `varchar(n)`, unless a business rule fixes a length                                         | Arbitrary limits create migration churn without integrity value.                        |
| Case-insensitive natural keys | `extensions.citext` (always schema-qualified) **or** a normalized shadow column                         | Email/code lookups must not depend on caller casing.                                    |
| Semi-structured data          | `jsonb` only where structure genuinely cannot be relational; its schema and indexing must be documented | Prevents relational data hiding in blobs.                                               |
| State/status sets             | `text` + CHECK constraint, or a lookup table. **Never PostgreSQL enums for volatile business sets.**    | Enum alteration is DDL; business sets change by configuration.                          |
| Identifiers                   | `uuid` (§3)                                                                                             | —                                                                                       |

Naming (snake_case; plural tables; singular columns; `_id`/`_at`/`_by` suffixes;
`is_`/`has_`/`can_` boolean prefixes; `tg_`/`pk_`/`fk_`/`uq_`/`ck_`/`ex_`/`ix_`
object prefixes; verb_noun functions; the 63-**byte** identifier limit with its
deterministic shortening rule and `COMMENT ON` recording of the full name) is specified
in [database-naming-standard.md](database-naming-standard.md) and is already practised
by every object in migrations 0001–0003.

Index rules (tenant-owned indexes normally **lead with `tenant_id`**; deviations
require a written justification in the migration; no duplicate indexes; search indexes
must not enable cross-tenant search) are specified in
[index-standard.md](index-standard.md). The
`UNIQUE NULLS NOT DISTINCT (tenant_id, sequence_code, company_id, branch_id)`
constraint on `shared.number_sequences` doubles as its tenant-leading access index.

For non-overlapping intervals (future bookings/reservations), the approved template is
an EXCLUDE constraint using btree_gist, proven in
[tests/db/constraints.test.ts](../../tests/db/constraints.test.ts) to reject overlap
within a tenant (23P01) and permit identical intervals across tenants:

```sql
-- ILLUSTRATION — the template; real booking tables are later-phase work.
CONSTRAINT ex_bookings_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, during WITH &&)
```

## 10. Display numbers (architectural position)

Migration 0003 establishes the platform position that human-facing document numbering
is tenant-scoped configuration, not identity:

- Every sequence row is owned by a tenant (`tenant_id NOT NULL`), optionally narrowed
  to company/branch. **There is no global cross-tenant sequence.**
- Allocation (`shared.next_display_number()`) is `SECURITY INVOKER` (RLS applies in
  full — it is not a bypass), runs **in the caller's transaction**, and serialises per
  sequence row via `SELECT ... FOR UPDATE`. Verified rollback semantics: a rolled-back
  allocation rolls back the increment, so the number is re-issued to the next caller —
  no duplicate and no gap from rollbacks; committed allocations form a gapless run.
  Concurrency proof: 50 parallel workers on one sequence row produced 50 unique
  consecutive values with the counter advanced exactly 50; a mixed run with a third of
  30 concurrent allocations rolling back left the committed values gaplessly
  consecutive. The trade-off — allocation serialises on the sequence row — is accepted
  and documented.
- Gaps arising from business events (voided documents, period resets) are **tolerated
  and never renumbered**.
- Provisioning sequences is an administrative configuration action at tenant
  onboarding (ADR-008): runtime roles have no INSERT/DELETE path. A Benzene sequence
  configuration is future onboarding content, not schema.

Full standard: [number-sequence-standard.md](number-sequence-standard.md).

## 11. Companion standards

This document consolidates; the companions bind at full depth. All are authored in
Phase 1-2 under the same header block and review policy.

| Standard                          | Scope                                                                             | Link                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Naming standard                   | Identifiers, prefixes, 63-byte limit and shortening rule                          | [database-naming-standard.md](database-naming-standard.md)                                     |
| Data-type standard                | Types, money, time, citext, jsonb, state sets                                     | [data-type-standard.md](data-type-standard.md)                                                 |
| RLS standard                      | Policy templates, context contract, evidence rules                                | [rls-standard.md](rls-standard.md)                                                             |
| Role and grant standard           | Role archetypes, measured Supabase role attributes, least-privilege grants        | [role-and-grant-standard.md](role-and-grant-standard.md)                                       |
| Migration standard                | Naming rule `^(\d{4}                                                              | \d{14})_[a-z0-9_]+\.sql$`, forward-only discipline, immutability, CI enforcement               | [migration-standard.md](migration-standard.md) |
| Number-sequence standard          | Display numbers, rollback/gap semantics, provisioning                             | [number-sequence-standard.md](number-sequence-standard.md)                                     |
| Index standard                    | Tenant-leading indexes, justification rule, search limits                         | [index-standard.md](index-standard.md)                                                         |
| Data retention and classification | Retention classes, sensitivity classes, legal hold, controlled deletion           | [data-retention-and-classification-standard.md](data-retention-and-classification-standard.md) |
| Seed-data standard                | The four seed classes, idempotency, environment awareness                         | [seed-data-standard.md](seed-data-standard.md)                                                 |
| Database testing standard         | Harness, fixture schema `p1_02_test`, deterministic fixture UUIDs, evidence rules | [database-testing-standard.md](database-testing-standard.md)                                   |
| PostgreSQL extension register     | Installed extensions, purpose, approval, removal implications                     | [postgresql-extension-register.md](postgresql-extension-register.md)                           |

Seed classes, summarised for architectural completeness: (1) platform reference data;
(2) tenant-provisioning templates; (3) tenant-specific controlled provisioning — the
**only** place a Benzene example may ever appear, as a future configuration package,
not in Phase 1-2; (4) test fixtures. Seeds must be idempotent (`ON CONFLICT DO
NOTHING` or equivalent), deterministic, environment-aware, version-controlled, safe to
rerun, and must never contain real or production data. `supabase/seed.sql` is currently
intentionally empty of rows (governance comments only) and stays that way in Phase 1-2.

## 12. Current state versus future state (honest register)

### 12.1 What exists after migrations 0001–0003 (verified 2026-07-16)

- PostgreSQL 17.6 (Supabase local stack; CLI 2.109.1 pinned; DB port 54322).
- Extensions pgcrypto 1.3, btree_gist 1.7, citext 1.6, pg_trgm 1.6 in schema
  `extensions`; database `search_path` set to `"$user", public, extensions`.
- Schemas `org`, `iam`, `shared`, `crm`, `veh` (the last two reserved and empty);
  `public` hardened.
- Roles `app_runtime` / `app_readonly` with USAGE-only schema grants; the four
  `iam.*` context readers; `shared.touch_row_metadata()`.
- `shared.number_sequences` with named constraints, forced RLS, `sel_`/`upd_` tenant
  policies, column-restricted grants, the regression-guard trigger, and
  `shared.next_display_number()`.
- 61 database tests passing on 2026-07-16 via `npm run test:db` (vitest + pg), with
  every isolation assertion executed as `rootlco_test_runtime` (member of
  `app_runtime`) — never as a BYPASSRLS role. The disposable fixture schema
  `p1_02_test` is created and dropped by the suite; deterministic fixture tenants are
  `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` and `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`.
- CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)): lint/types/tests/
  build, Docker build validation, the database job (postgres:17-alpine service
  container; migration-immutability assertion on PRs; clean-database application via
  [scripts/db/apply-migrations.mjs](../../scripts/db/apply-migrations.mjs), which
  refuses non-empty databases; the 62-test suite), and the secret scan (per-line
  `pragma: allowlist secret` markers with justification, no directory exclusions). A
  defective-migration rehearsal was executed and recorded in
  [rehearsal-defective-migration.md](../phase-1/phase-1-2/rehearsal-defective-migration.md);
  the defective file was never committed.
- Local workflow: `npm run supabase:start`, then `npm run supabase:reset` (applies
  migrations in filename order plus `seed.sql`).

### 12.2 Known gaps and deferred work (accepted, not hidden)

| Gap                                                          | Detail                                                                                                                                                                           | Resolution                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **No FKs on `shared.number_sequences` scope columns**        | `tenant_id`, `company_id`, `branch_id` reference nothing today because `org.tenants` / `org.companies` / `org.branches` do not exist. Recorded in the table's `COMMENT ON`.      | Phase 1-3 adds the foreign keys when the `org` tables are created. Until then, scope integrity rests on RLS plus the context contract. |
| **CI runs plain PostgreSQL 17, not the full Supabase stack** | Supabase-managed roles differ there (`postgres` **is** a superuser in the plain `postgres:17` container, unlike the local stack where it is non-superuser with BYPASSRLS).       | Documented and accepted; role-attribute evidence is always labelled with the environment it was measured in.                           |
| **No IAM resolution logic**                                  | The `iam.*` functions only _read_ the transaction context; membership tables and server-side context resolution are Phase 1-4.                                                   | Phase 1-4.                                                                                                                             |
| **`crm` / `veh` empty**                                      | Reserved namespaces only.                                                                                                                                                        | Their respective phases, after the Database Standards Gate.                                                                            |
| **No environments beyond local + CI**                        | ADR-012: no Development/Staging/Production exists; promotion is a controlled future step.                                                                                        | Later phase, per ADR-012.                                                                                                              |
| **`shared.idempotency_keys` not created**                    | Semantics pinned by test fixture only (§8).                                                                                                                                      | The phase that ships the first idempotent business operation.                                                                          |
| **Review model**                                             | All of the above was produced and verified under the Solo Developer Review Policy — technical self-review by the owner. No independent review has occurred, and none is claimed. | Owner-approved policy; revisit when team size changes.                                                                                 |

Migration numbering from here: files `0001`–`0999` are reserved for the Phase 1-2
platform foundation; from Phase 1-3 onward, migrations use 14-digit
`supabase migration new` timestamps. Both forms sort correctly and are enforced by the
migration-name rule in the tests and the CI runner.
