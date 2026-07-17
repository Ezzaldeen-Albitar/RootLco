# Database Naming Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted — binding for all database work from Phase 1-2 onward ·
**Date:** 2026-07-16 ·
**Task:** P1-02-DB-001 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) — this is
not an independent review) ·
**Branch:** `feature/p1-02-database-engineering-foundation`

**Related:**
[Database Architecture](./database-architecture.md) ·
[RLS Standard](./rls-standard.md) ·
[Role and Grant Standard](./role-and-grant-standard.md) ·
[Number Sequence Standard](./number-sequence-standard.md) ·
[Extension Register](./postgresql-extension-register.md)

---

## 1. Purpose, scope, and authority

This document is the single controlled naming standard for every PostgreSQL object the
platform creates: schemas, tables, columns, functions, triggers, RLS policies,
constraints, indexes, and migration files.

- Every rule in this document is **binding** ("must"). A migration that violates a rule
  must not be merged.
- **No unnamed convention may remain for later phases.** If a later phase needs an
  object class this document does not name (for example materialised views or
  publication names), this document must be amended **before** the first such object is
  created. Ad-hoc naming is prohibited.
- Migrations `0001_extensions.sql`, `0002_base_schemas.sql`, and
  `0003_number_sequences.sql` (under `supabase/migrations/`) are the **reference
  implementations** of this standard. Where an example below is taken from them it is
  real; examples that reference future business tables (e.g. `org.companies`) are
  **Phase 1-3+ illustrations** and are clearly marked — those objects do not exist yet.

Phase 1-2 creates no business-domain tables. This standard describes how later phases
must name theirs.

## 2. General identifier rules

| #   | Rule                                                                                                                                                           | Rationale                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| G1  | All identifiers must be `snake_case`: lowercase ASCII letters, digits, underscores.                                                                            | Uniform, case-fold-safe, never needs quoting.                       |
| G2  | Identifiers must never require double quotes (no uppercase, spaces, hyphens, or reserved words as bare names).                                                 | Quoted identifiers create two-name ambiguity and break tooling.     |
| G3  | Names must be descriptive English words, not opaque abbreviations — except the fixed abbreviation table in §13, applied only when the 63-byte limit forces it. | Readability; deterministic shortening only under a documented rule. |
| G4  | Every object whose name was shortened, and every object whose purpose is not obvious from its name, must carry a `COMMENT ON`.                                 | The catalogue is the first documentation a future engineer reads.   |

## 3. Schemas

Schemas are **short module names** under the modular-monolith rule (one module, one
schema — see [Database Architecture](./database-architecture.md)). Established by
migration `0002`:

| Schema       | Module                                                    | Phase 1-2 state                                           |
| ------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `org`        | Organization structure (tenants, companies, branches)     | Empty — tables arrive in Phase 1-3                        |
| `iam`        | Identity and access                                       | Context helper functions only; tables arrive in Phase 1-4 |
| `shared`     | Cross-module shared primitives only                       | `number_sequences` (migration `0003`)                     |
| `crm`        | CRM module                                                | RESERVED, intentionally empty                             |
| `veh`        | Vehicle module                                            | RESERVED, intentionally empty                             |
| `extensions` | Extension objects (Supabase convention, migration `0001`) | pgcrypto, btree_gist, citext, pg_trgm                     |

Rules:

- New module schemas must be short (2–8 characters), lowercase, and named for the
  module, not for a customer or a product feature.
- `public` is **not** an application schema; migration `0002` revokes `CREATE` on it
  from `PUBLIC`, and no application object may be created there.
- A table belongs in `shared` only if no single module owns it.
- Disposable test schemas must be prefixed with the phase task in snake_case (reference
  implementation: the fixture schema `p1_02_test`, created and dropped by the test
  suite, never by migrations).

## 4. Tables

- Table names are **plural** nouns: `number_sequences` (real, migration `0003`);
  `companies`, `vehicles`, `work_orders` (Phase 1-3+ illustrations).
- The name states what one row is a member of; a row of `number_sequences` is one
  sequence.
- Join/association tables are named after both sides in a stable order, still plural
  (Phase 1-4+ illustration: `user_branch_memberships`).
- Append-only history tables use the `_history` suffix (Phase 1-3+ illustration:
  `inspection_status_history`).

## 5. Columns

Column names are **singular**: one column, one value per row.

| Suffix / prefix                | Meaning                             | Type contract                                                                                         | Real examples (migration `0003`)                                                    |
| ------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `_id` suffix                   | Key or foreign-key reference        | `uuid`                                                                                                | `tenant_id`, `company_id`, `branch_id`                                              |
| `_at` suffix                   | Point in time                       | `timestamptz` (UTC) — **always**, never `timestamp`                                                   | `created_at`, `updated_at`                                                          |
| `_by` suffix                   | Actor attribution                   | `uuid`                                                                                                | `created_by`, `updated_by`                                                          |
| `is_` / `has_` / `can_` prefix | Boolean                             | `boolean NOT NULL` with an explicit default                                                           | Phase 1-3+ illustrations: `is_active`, `has_vat_registration`, `can_issue_invoices` |
| `status`                       | Workflow state                      | `text` + `CHECK` or lookup table — **never** a PostgreSQL enum for volatile business sets             | Phase 1-3+ illustration: `status text CHECK (status IN (…))`                        |
| `code`                         | Stable machine-readable natural key | `text` + format `CHECK` (or `extensions.citext` / normalised shadow column for case-insensitive keys) | `sequence_code` with `ck_number_sequences_code_format` (`^[a-z][a-z0-9_]{1,62}$`)   |

Additional column rules:

- The primary key of every table is `id uuid` (default `gen_random_uuid()`, which is
  **native** in PostgreSQL 13+ — pgcrypto is not registered for UUID generation).
  **Exception — platform reference tables (added 2026-07-17, Phase 1-3, by owner
  instruction).** A platform reference table whose rows are identified by a stable,
  externally-governed natural code uses that code as its primary key instead of a
  surrogate `id uuid`. This exception is **limited to Class 1 platform reference data**
  (see the [Seed Standard](./seed-standard.md) §3.1) and currently covers exactly
  `shared.currencies` (`code`), `shared.timezones` (`zone_name`), and
  `shared.languages` (`locale_code`). It exists because: the Phase 1-3 instruction
  requires an ISO currency-code primary key and names the referencing column
  `base_currency_code` (a `_code` reference, not `_id`); the seed standard already
  requires stable natural keys as idempotent `ON CONFLICT` targets and illustrates
  `shared.currencies` with `ON CONFLICT (code)`. **It does not extend to tenant-owned
  or business tables**, which keep `id uuid` — their natural keys stay `UNIQUE`
  constraints, because business codes are tenant-scoped, editable, and reusable after
  soft delete. Recorded here openly rather than left as a silent contradiction between
  two binding documents.
  UUIDs are internal identifiers only: they are **never** authorization tokens and
  **never** public display numbers; knowledge of an ID never grants access. Human-facing
  numbers come from `shared.next_display_number()` (see the
  [Number Sequence Standard](./number-sequence-standard.md)).
- Boolean names must read as a true/false question about the row. Negated names
  (`is_not_active`) are prohibited.
- Base metadata columns are fixed by the
  [Database Architecture](./database-architecture.md): `created_at`, `created_by`,
  `updated_at`, `updated_by`, `record_version`, plus `deleted_at`/`deleted_by` (soft
  delete) and `archived_at`/`archived_by` (archive) where the record class requires
  them. Their names may not vary between tables.
- FK columns are named `<referenced_singular>_id` (`tenant_id`, not `tenants_id` or
  `fk_tenant`). Where two FKs point at the same table, a role prefix is added
  (Phase 1-3+ illustration: `source_branch_id`, `destination_branch_id`).

## 6. Functions

- Functions that **do** something are named `verb_noun`: real examples
  `shared.touch_row_metadata()`, `shared.next_display_number()`,
  `shared.guard_number_sequence_regression()` (migrations `0002`/`0003`).
- Pure context readers — functions that only return a value from session context and
  perform no action — are named as the value they return, using the fixed prefixes
  `current_` and `allowed_`: real examples `iam.current_tenant_id()`,
  `iam.current_user_id()`, `iam.allowed_company_ids()`, `iam.allowed_branch_ids()`
  (migration `0002`). These two prefixes are the **only** approved exception to
  `verb_noun`.
- Trigger functions are named for what they do to the row, not for the trigger that
  calls them (`touch_row_metadata`, `guard_number_sequence_regression`), because one
  function may serve many tables.
- Every function must declare volatility, `SECURITY INVOKER`/`DEFINER` explicitly, and
  set `search_path` (the reference implementations use `SET search_path = ''`).

## 7. Triggers

Pattern: **`tg_<table>_<purpose>`**.

Real examples (migration `0003`):

```sql
CREATE TRIGGER tg_number_sequences_touch_metadata
  BEFORE UPDATE ON shared.number_sequences
  FOR EACH ROW
  EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_number_sequences_guard_regression
  BEFORE UPDATE ON shared.number_sequences
  FOR EACH ROW
  EXECUTE FUNCTION shared.guard_number_sequence_regression();
```

The `<purpose>` part describes the effect (`touch_metadata`, `guard_regression`), not
the timing — timing is visible in the definition.

## 8. RLS policies

Pattern: **`<action>_<table>_<scope>`**, where `<action>` is one of exactly four
prefixes distinguishing the four policy actions:

| Prefix | Policy action |
| ------ | ------------- |
| `sel_` | `FOR SELECT`  |
| `ins_` | `FOR INSERT`  |
| `upd_` | `FOR UPDATE`  |
| `del_` | `FOR DELETE`  |

`FOR ALL` policies are prohibited: each action gets its own policy so that grants,
`USING`, and `WITH CHECK` clauses stay reviewable per action.

Real examples (migration `0003`, on `shared.number_sequences` with RLS **enabled and
forced**):

```sql
CREATE POLICY sel_number_sequences_tenant
  ON shared.number_sequences
  FOR SELECT
  TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY upd_number_sequences_tenant
  ON shared.number_sequences
  FOR UPDATE
  TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
```

The **absence** of `ins_`/`del_` policies is itself meaningful and must be deliberate:
on `number_sequences`, runtime roles have no INSERT/DELETE policy and no INSERT/DELETE
grant because provisioning is administrative. A migration that omits a policy for an
action must say why in a comment. The `<scope>` part names the isolation boundary the
policy enforces (`tenant`, and in later phases `company` or `branch` where applicable).

## 9. Constraints

Every constraint must be **named** — anonymous constraints are prohibited, because
error messages, drops, and audits all reference constraints by name.

Pattern: **`<prefix>_<table>_<columns-or-purpose>`**.

| Prefix | Constraint kind   | Real example (migration `0003`)                                                                                                                                                                             |
| ------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pk_`  | PRIMARY KEY       | `pk_number_sequences`                                                                                                                                                                                       |
| `fk_`  | FOREIGN KEY       | Phase 1-3+ illustration: `fk_number_sequences_tenant_id` (no FK exists yet — see the honest note below)                                                                                                     |
| `uq_`  | UNIQUE constraint | `uq_number_sequences_scope`                                                                                                                                                                                 |
| `ck_`  | CHECK             | `ck_number_sequences_code_format`, `ck_number_sequences_next_value_positive`, `ck_number_sequences_pad_width_range`, `ck_number_sequences_period_reset_rule`, `ck_number_sequences_branch_requires_company` |
| `ex_`  | EXCLUDE           | Phase 1-3+ illustration below                                                                                                                                                                               |

When the constrained columns are few, name them (`fk_number_sequences_tenant_id`); when
the constraint expresses a business rule, name the rule
(`ck_number_sequences_branch_requires_company`).

EXCLUDE illustration (Phase 1-3+; the pattern itself is proven by the Phase 1-2 test
suite against a disposable fixture, using `btree_gist` from migration `0001`):

```sql
-- ILLUSTRATION ONLY — veh.* tables do not exist in Phase 1-2.
ALTER TABLE veh.resource_bookings
  ADD CONSTRAINT ex_resource_bookings_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, during WITH &&);
```

**Honest note:** `shared.number_sequences.tenant_id`/`company_id`/`branch_id` currently
have **no** foreign keys — `org.*` tables do not exist until Phase 1-3, and the FKs are
added then. The `fk_` examples here are naming templates, not existing objects.

## 10. Indexes

- Non-unique indexes: **`ix_<table>_<columns>`**.
- Unique **indexes** (as opposed to unique constraints): **`uq_<table>_<columns-or-purpose>`** —
  the same `uq_` prefix as unique constraints, since both express uniqueness; the
  catalogue distinguishes the mechanism.
- Column order in the name must match column order in the index; on tenant-owned tables
  indexes normally **lead with `tenant_id`**, and any index that does not must carry a
  written justification in its migration (index rules are owned by the architecture
  standard; the naming consequence is that `tenant_id` normally appears first in the
  name too).

Phase 1-3+ illustrations:

```sql
-- ILLUSTRATION ONLY — org.* tables do not exist in Phase 1-2.
CREATE INDEX ix_companies_tenant_id_status ON org.companies (tenant_id, status);
CREATE UNIQUE INDEX uq_companies_tenant_id_code_active
  ON org.companies (tenant_id, code) WHERE deleted_at IS NULL;
```

(The partial-unique-`WHERE deleted_at IS NULL` pattern — active-only uniqueness that
frees a code after soft delete — is proven by the Phase 1-2 test suite on a disposable
fixture.) In Phase 1-2 itself no standalone index exists: `uq_number_sequences_scope`
is a UNIQUE constraint whose backing index doubles as the tenant-leading access path.

## 11. Migration files

File-name rule, enforced both by the test suite (`tests/db/foundation.test.ts`) and by
the CI migration runner (`scripts/db/apply-migrations.mjs`):

```
^(\d{4}|\d{14})_[a-z0-9_]+\.sql$
```

- **`0001`–`0999`** (4 digits): reserved for the Phase 1-2 platform foundation.
  Currently used: `0001_extensions.sql`, `0002_base_schemas.sql`,
  `0003_number_sequences.sql`.
- **14-digit timestamps** (`supabase migration new` format, e.g.
  `20260901120000_create_org_tables.sql`): mandatory from Phase 1-3 onward.
- Both forms sort correctly in plain filename order, which is the application order
  (`supabase db reset` and the CI runner both apply in filename order).
- The descriptive part is lowercase snake_case and states what the migration does.
- Migrations are **immutable once on the target branch**: the CI workflow asserts on
  pull requests that existing migration files are not modified, renamed, or deleted —
  only new files may be added.

## 12. Database roles

Named by function, prefixed with `app_` for application archetypes: `app_runtime`,
`app_readonly` (migration `0002`; `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS`). Test-harness login roles are prefixed with the product
namespace and purpose (reference: `rootlco_test_runtime`, created by the test harness,
never by migrations). Supabase-managed roles (`postgres`, `anon`, `authenticated`,
`service_role`, `supabase_admin`) are not ours to rename or modify — see the
[Role and Grant Standard](./role-and-grant-standard.md).

## 13. The 63-byte limit and deterministic shortening

PostgreSQL truncates identifiers at **63 bytes** (not characters — another reason
identifiers must be ASCII, rule G1). Silent truncation produces two objects whose
declared names differ but whose effective names collide, so:

**Rule:** no identifier may be written that exceeds 63 bytes. When a name built from
this standard's patterns would exceed the limit, it must be shortened
**deterministically**, in this exact order, stopping as soon as the name fits:

1. **Drop the schema part** first, where a schema name was embedded in the identifier
   (schema qualification outside the identifier is unaffected).
2. **Abbreviate words using the fixed abbreviation table below**, applied in the
   table's listed order, one substitution at a time, re-checking length after each.
3. The **prefix** (`ix_`, `ck_`, `tg_`, `sel_`, …) and the **scope column names**
   (`tenant_id`, `company_id`, `branch_id`) must be kept intact — they are never
   abbreviated or dropped.
4. When any shortening was applied, the **full unshortened name must be recorded in a
   `COMMENT ON`** the object.

Fixed abbreviation table (normative; extending it requires an amendment to this
document — never invent an abbreviation inline):

| Order | Full word       | Abbreviation |
| ----- | --------------- | ------------ |
| 1     | `number`        | `num`        |
| 2     | `sequence`      | `seq`        |
| 3     | `reference`     | `ref`        |
| 4     | `transaction`   | `txn`        |
| 5     | `history`       | `hist`       |
| 6     | `document`      | `doc`        |
| 7     | `configuration` | `config`     |

Worked example (Phase 1-3+ illustration):

```sql
-- Desired: ix_inspection_status_history_tenant_id_inspection_id_occurred_at  (64 bytes)
-- Step 2, rule 5 (history → hist):
CREATE INDEX ix_inspection_status_hist_tenant_id_inspection_id_occurred_at   -- 61 bytes
  ON veh.inspection_status_history (tenant_id, inspection_id, occurred_at);

COMMENT ON INDEX veh.ix_inspection_status_hist_tenant_id_inspection_id_occurred_at IS
  'Full name: ix_inspection_status_history_tenant_id_inspection_id_occurred_at (shortened per docs/database/database-naming-standard.md §13).';
```

## 14. Wrong vs right

| Object          | Wrong                                                                             | Right                                                     | Rule                               |
| --------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| Table           | `Customer`, `tbl_customer`, `customer`                                            | `customers`                                               | §4 plural snake_case, no prefixes  |
| Column (FK)     | `customerId`, `fk_customer`, `customers_id`                                       | `customer_id`                                             | §5 `_id`, singular referenced noun |
| Timestamp       | `created`, `create_date`, `created_on`                                            | `created_at` (`timestamptz`)                              | §5 `_at`                           |
| Actor           | `creator`, `created_user`                                                         | `created_by` (`uuid`)                                     | §5 `_by`                           |
| Boolean         | `active`, `deleted_flag`                                                          | `is_active`; soft delete uses `deleted_at`, not a boolean | §5 prefixes; architecture standard |
| State set       | `CREATE TYPE order_status AS ENUM (…)`                                            | `status text` + `CHECK` or lookup table                   | §5 no volatile enums               |
| Schema          | `application_data`, `benzene`                                                     | `crm`, `veh` (module names, never a customer)             | §3                                 |
| Function        | `metadata_toucher()`, `get_next_number()`                                         | `touch_row_metadata()`, `next_display_number()`           | §6 verb_noun                       |
| Trigger         | `number_sequences_trigger1`                                                       | `tg_number_sequences_touch_metadata`                      | §7                                 |
| Policy          | `tenant_isolation`, `number_sequences_policy`                                     | `sel_number_sequences_tenant`                             | §8 action prefix + table + scope   |
| Constraint      | `number_sequences_tenant_id_sequence_code_company_id_branch_key` (auto-generated) | `uq_number_sequences_scope`                               | §9 named, prefixed                 |
| Index           | `idx1`, `number_sequences_index`                                                  | `ix_companies_tenant_id_status`                           | §10                                |
| Migration file  | `add-tables.sql`, `0003-numberSequences.sql`                                      | `0003_number_sequences.sql`                               | §11 regex                          |
| Long identifier | Let PostgreSQL truncate silently                                                  | Shorten per §13 + `COMMENT ON` with full name             | §13                                |

## 15. Enforcement

- The migration file-name regex is enforced mechanically (§11).
- Object-level naming is enforced in review of every migration under the
  [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)
  (technical self-review; not an independent review), with migrations `0001`–`0003` as
  the reference implementations any new migration is compared against.
- A naming rule that proves wrong in practice is changed by amending **this document
  first**, then following it — never by silently diverging. Existing committed
  migrations are immutable (§11); a rename of a live object is itself a new migration
  and must state the naming-standard amendment that motivated it.
