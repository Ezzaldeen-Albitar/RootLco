# Data Dictionary

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Controlled — living document · **Task:** P1-02-DOC-003 ·
**Date:** 2026-07-16 · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Related:** [database-architecture.md](./database-architecture.md) ·
[database-naming-standard.md](./database-naming-standard.md) ·
[retention-and-sensitive-data-standard.md](./retention-and-sensitive-data-standard.md)

---

## 1. Purpose and maintenance rules

The data dictionary is the authoritative register of every schema, table, column,
and database routine the platform owns. It exists so that no column ships without a
recorded type, scope, classification, retention class, and owner.

**Binding rules:**

1. Any pull request containing a migration that creates or alters structure **must
   update this dictionary in the same pull request**. The
   [migration review checklist](./migration-standard.md) includes this check.
2. Every column row carries **all** fields in §2 — "TBD" is not a permitted value for
   Classification or Retention class (they are design-time decisions, per the
   [retention and sensitive-data standard](./retention-and-sensitive-data-standard.md)).
3. Only objects that **actually exist** may appear here. Future tables are not
   pre-registered; they are added by the phase that creates them. This revision
   therefore contains the Phase 1-2 foundation only.

## 2. Dictionary fields

| Field                | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| Schema               | Owning schema (module)                                                                 |
| Table                | Table name (plural, snake_case)                                                        |
| Column               | Column name (singular, snake_case)                                                     |
| Data type            | Exact PostgreSQL type                                                                  |
| Nullable             | YES / NO                                                                               |
| Default              | Column default, if any                                                                 |
| PK                   | Part of the primary key                                                                |
| FK                   | Foreign-key reference, or a recorded deferral                                          |
| Scope level          | platform / tenant / company / branch                                                   |
| Classification       | public / internal / restricted / secret                                                |
| Retention class      | operational / evidence-audit / personal-data / temporary / immutable-financial-history |
| Description          | What the column means                                                                  |
| Business rule        | Constraint or invariant, with the enforcing object where one exists                    |
| Requirement refs     | P1 task / FR / NFR / BR identifiers                                                    |
| RLS policy refs      | Policies governing the row's visibility                                                |
| Index refs           | Indexes covering the column                                                            |
| Migration introduced | Migration file that created it                                                         |
| Owner module         | Module accountable for the object                                                      |

## 3. Schema register (Phase 1-2)

| Schema   | Purpose                                               | State in Phase 1-2                     | Introduced |
| -------- | ----------------------------------------------------- | -------------------------------------- | ---------- |
| `org`    | Organization structure (tenants, companies, branches) | **Empty** — tables arrive in Phase 1-3 | 0002       |
| `iam`    | Identity and access                                   | Context helper functions only          | 0002       |
| `shared` | Cross-module shared primitives                        | `number_sequences` only                | 0002       |
| `crm`    | CRM module namespace                                  | **Reserved, empty**                    | 0002       |
| `veh`    | Vehicle module namespace                              | **Reserved, empty**                    | 0002       |

`public` is hardened (no PUBLIC CREATE) and holds no application objects.
`extensions` holds pgcrypto 1.3, btree_gist 1.7, citext 1.6, pg_trgm 1.6
([extension register](./postgresql-extension-register.md)).

## 4. Table: `shared.number_sequences`

Tenant-scoped display-number sequences. RLS **enabled and forced**; policies
`sel_number_sequences_tenant` (SELECT → `app_runtime`, `app_readonly`) and
`upd_number_sequences_tenant` (UPDATE → `app_runtime`, USING + WITH CHECK on tenant).
Grants: SELECT to both runtime roles; column-restricted UPDATE
(`next_value`, `current_period`) to `app_runtime`; **no INSERT/DELETE path for runtime
roles** (provisioning is administrative). Standard:
[number-sequence-standard.md](./number-sequence-standard.md).
Requirement refs for the whole table: **P1-02-DB-004, P1-02-DB-019**; migration
**0003_number_sequences.sql**; owner module **shared**.

> **FK deferral (recorded):** `tenant_id`, `company_id`, `branch_id` reference
> `org.tenants` / `org.companies` / `org.branches`, which do not exist yet. The
> composite foreign keys are added by the Phase 1-3 migration that creates the `org`
> tables. Until then scope integrity rests on RLS and the session-context contract.

| Column              | Data type     | Nullable | Default             | PK  | FK                                     | Scope    | Class.   | Retention   | Description / business rule                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------- | -------- | ------------------- | --- | -------------------------------------- | -------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid`        | NO       | `gen_random_uuid()` | ✔   | —                                      | platform | internal | operational | Surrogate key (`pk_number_sequences`). Never a display value.                                                                                                                                                                                                                                                     |
| `tenant_id`         | `uuid`        | NO       | —                   |     | deferred → `org.tenants` (Phase 1-3)   | tenant   | internal | operational | Owning tenant. Leads `uq_number_sequences_scope`; RLS pivot (`iam.current_tenant_id()`).                                                                                                                                                                                                                          |
| `company_id`        | `uuid`        | YES      | —                   |     | deferred → `org.companies` (Phase 1-3) | company  | internal | operational | Optional company narrowing. NULL = tenant-wide sequence.                                                                                                                                                                                                                                                          |
| `branch_id`         | `uuid`        | YES      | —                   |     | deferred → `org.branches` (Phase 1-3)  | branch   | internal | operational | Optional branch narrowing. `ck_number_sequences_branch_requires_company`: a branch scope must state its company.                                                                                                                                                                                                  |
| `sequence_code`     | `text`        | NO       | —                   |     | —                                      | tenant   | internal | operational | Machine code of the sequence. `ck_number_sequences_code_format`: `^[a-z][a-z0-9_]{1,62}$`.                                                                                                                                                                                                                        |
| `prefix_template`   | `text`        | NO       | `''`                |     | —                                      | tenant   | internal | operational | Literal prefix; `{period}` token replaced by the current period key.                                                                                                                                                                                                                                              |
| `next_value`        | `bigint`      | NO       | `1`                 |     | —                                      | tenant   | internal | operational | Next value to issue; advanced only under `SELECT … FOR UPDATE` by `shared.next_display_number()`. `ck_number_sequences_next_value_positive`; regression guard blocks rewinds without a legitimate period change (never-resetting sequences reject any period change — `ck_number_sequences_never_has_no_period`). |
| `pad_width`         | `integer`     | NO       | `6`                 |     | —                                      | tenant   | internal | operational | Zero-pad width, 0–18 (`ck_number_sequences_pad_width_range`). Values outgrowing the pad WIDEN, never truncate (regression-tested).                                                                                                                                                                                |
| `period_reset_rule` | `text`        | NO       | `'never'`           |     | —                                      | tenant   | internal | operational | `never` / `yearly` / `monthly` / `daily` (`ck_number_sequences_period_reset_rule`). UTC period keys.                                                                                                                                                                                                              |
| `current_period`    | `text`        | YES      | —                   |     | —                                      | tenant   | internal | operational | Period key of the last allocation for resetting sequences; NULL for `never`.                                                                                                                                                                                                                                      |
| `record_version`    | `integer`     | NO       | `1`                 |     | —                                      | tenant   | internal | operational | Optimistic-concurrency version; advanced exactly 1 per update by `shared.touch_row_metadata()`.                                                                                                                                                                                                                   |
| `created_at`        | `timestamptz` | NO       | `now()`             |     | —                                      | tenant   | internal | operational | Creation instant (UTC).                                                                                                                                                                                                                                                                                           |
| `created_by`        | `uuid`        | NO       | —                   |     | deferred → IAM principal (Phase 1-4)   | tenant   | internal | operational | Provisioning actor.                                                                                                                                                                                                                                                                                               |
| `updated_at`        | `timestamptz` | YES      | —                   |     | —                                      | tenant   | internal | operational | Last update instant; trigger-maintained.                                                                                                                                                                                                                                                                          |
| `updated_by`        | `uuid`        | YES      | —                   |     | deferred → IAM principal (Phase 1-4)   | tenant   | internal | operational | Last update actor, from `iam.current_user_id()`.                                                                                                                                                                                                                                                                  |

**Index refs:** `pk_number_sequences` (id); `uq_number_sequences_scope`
(`UNIQUE NULLS NOT DISTINCT (tenant_id, sequence_code, company_id, branch_id)` —
tenant-leading, doubles as the access path).
**RLS policy refs:** `sel_number_sequences_tenant`, `upd_number_sequences_tenant`.

## 5. Routine register (Phase 1-2)

| Routine                                        | Kind                | Security          | Purpose                                                                                                                                        | Migration | Refs             |
| ---------------------------------------------- | ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------- |
| `iam.current_tenant_id()`                      | function → `uuid`   | INVOKER, STABLE   | Reads `app.tenant_id` (transaction-local). NULL when unset → default deny.                                                                     | 0002      | P1-02-SEC-002    |
| `iam.current_user_id()`                        | function → `uuid`   | INVOKER, STABLE   | Reads `app.user_id` (actor attribution).                                                                                                       | 0002      | P1-02-SEC-002    |
| `iam.allowed_company_ids()`                    | function → `uuid[]` | INVOKER, STABLE   | Reads `app.company_ids`; NULL = no narrowing.                                                                                                  | 0002      | P1-02-SEC-002    |
| `iam.allowed_branch_ids()`                     | function → `uuid[]` | INVOKER, STABLE   | Reads `app.branch_ids`; NULL = no narrowing.                                                                                                   | 0002      | P1-02-SEC-002    |
| `shared.touch_row_metadata()`                  | trigger function    | INVOKER           | BEFORE UPDATE: stamps `updated_at`/`updated_by`, advances `record_version` by exactly 1.                                                       | 0002      | P1-02-DB-006/007 |
| `shared.guard_number_sequence_regression()`    | trigger function    | INVOKER           | BEFORE UPDATE: `next_value` may not decrease without a legitimate period change; never-resetting sequences reject any `current_period` change. | 0003      | P1-02-DB-019     |
| `shared.next_display_number(text, uuid, uuid)` | function → record   | INVOKER, VOLATILE | Allocates the next display number in the caller's transaction; `FOR UPDATE` serialisation; tenant from context only; widening pad.             | 0003      | P1-02-DB-004/019 |

Triggers on `shared.number_sequences`: `tg_number_sequences_touch_metadata`,
`tg_number_sequences_guard_regression`.

## 6. Roles (see [role-and-grant-standard.md](./role-and-grant-standard.md))

| Role           | Kind                | Attributes                                                            | Introduced     |
| -------------- | ------------------- | --------------------------------------------------------------------- | -------------- |
| `app_runtime`  | runtime archetype   | NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION | 0002           |
| `app_readonly` | read-only archetype | NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION | 0002           |
| `app_worker`   | worker archetype    | NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION | 20260718106000 |

`app_worker` is the deliberately all-tenant infrastructure archetype on exactly
enumerated worker tables. Increment G grants it only `shared`/`iam` schema
USAGE, `iam.current_user_id()` EXECUTE, outbox SELECT/INSERT/UPDATE, and the
three outbox lifecycle routines; it has no DELETE, ownership, DDL, or RLS
bypass. An actual worker LOGIN remains Phase 1-13.

## 7. Explicitly not in this dictionary

No business-domain table exists (tenants, companies, branches, users, memberships,
customers, contacts, vehicles, appointments, inspections, quotations, work orders,
inventory, invoices, payments, Benzene provisioning records) — Phase 1-3+ adds them
**with** their dictionary rows. `shared.idempotency_keys` is a documented, test-pinned
pattern ([transaction standard](./transaction-and-concurrency-standard.md)) and is
deliberately not created in Phase 1-2.

---

## Phase 1-3 — organizational schema (generated from the live catalog, 2026-07-17)

Every table below was read from information_schema on the applied database, so
types, nullability, and defaults cannot drift from reality. Scope, retention
class, and per-column classification are the review-owned columns.
Classification vocabulary: public | internal | restricted | secret. NO column
in this phase is classified secret, and none may be: secrets are prohibited in
business tables (retention/sensitive-data standard). Masking and export-audit
enforcement for restricted columns is mapped to Phase 1-14 (backend) and is
NOT claimed implemented here.

### `shared.currencies`

**Scope:** platform-reference · **Retention class:** reference · Platform reference: ISO 4217 currencies. PK exception: natural code.

| Column           | Type                     | Null | Default        | Classification |
| ---------------- | ------------------------ | ---- | -------------- | -------------- |
| `code`           | text                     | NO   | —              | internal       |
| `name`           | text                     | NO   | —              | internal       |
| `minor_unit`     | smallint                 | NO   | —              | internal       |
| `status`         | text                     | NO   | 'active'::text | internal       |
| `record_version` | integer                  | NO   | 1              | internal       |
| `created_at`     | timestamp with time zone | NO   | now()          | internal       |
| `created_by`     | uuid                     | NO   | —              | internal       |
| `updated_at`     | timestamp with time zone | YES  | —              | internal       |
| `updated_by`     | uuid                     | YES  | —              | internal       |

### `shared.timezones`

**Scope:** platform-reference · **Retention class:** reference · Approval list over the IANA database; no offset column by design.

| Column           | Type                     | Null | Default        | Classification |
| ---------------- | ------------------------ | ---- | -------------- | -------------- |
| `zone_name`      | text                     | NO   | —              | internal       |
| `status`         | text                     | NO   | 'active'::text | internal       |
| `record_version` | integer                  | NO   | 1              | internal       |
| `created_at`     | timestamp with time zone | NO   | now()          | internal       |
| `created_by`     | uuid                     | NO   | —              | internal       |
| `updated_at`     | timestamp with time zone | YES  | —              | internal       |
| `updated_by`     | uuid                     | YES  | —              | internal       |

### `shared.languages`

**Scope:** platform-reference · **Retention class:** reference · Approved locales; direction ltr|rtl (Arabic-first product).

| Column           | Type                     | Null | Default        | Classification |
| ---------------- | ------------------------ | ---- | -------------- | -------------- |
| `locale_code`    | text                     | NO   | —              | internal       |
| `name`           | text                     | NO   | —              | internal       |
| `direction`      | text                     | NO   | —              | internal       |
| `status`         | text                     | NO   | 'active'::text | internal       |
| `record_version` | integer                  | NO   | 1              | internal       |
| `created_at`     | timestamp with time zone | NO   | now()          | internal       |
| `created_by`     | uuid                     | NO   | —              | internal       |
| `updated_at`     | timestamp with time zone | YES  | —              | internal       |
| `updated_by`     | uuid                     | YES  | —              | internal       |

### `org.tenants`

**Scope:** root · **Retention class:** operational · ROOT scope object — no tenant_id by design; closed, never deleted.

| Column             | Type                     | Null | Default              | Classification |
| ------------------ | ------------------------ | ---- | -------------------- | -------------- |
| `id`               | uuid                     | NO   | gen_random_uuid()    | internal       |
| `tenant_code`      | text                     | NO   | —                    | internal       |
| `display_name`     | text                     | NO   | —                    | internal       |
| `status`           | text                     | NO   | 'provisioning'::text | internal       |
| `default_locale`   | text                     | NO   | —                    | internal       |
| `default_timezone` | text                     | NO   | —                    | internal       |
| `record_version`   | integer                  | NO   | 1                    | internal       |
| `created_at`       | timestamp with time zone | NO   | now()                | internal       |
| `created_by`       | uuid                     | NO   | —                    | internal       |
| `updated_at`       | timestamp with time zone | YES  | —                    | internal       |
| `updated_by`       | uuid                     | YES  | —                    | internal       |

### `org.tenant_status_history`

**Scope:** tenant · **Retention class:** evidence-audit · Append-only tenant lifecycle evidence; reason mandatory.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `from_state`     | text                     | YES  | —                 | internal       |
| `to_state`       | text                     | NO   | —                 | internal       |
| `reason`         | text                     | NO   | —                 | internal       |
| `actor_id`       | uuid                     | NO   | —                 | internal       |
| `occurred_at`    | timestamp with time zone | NO   | now()             | internal       |
| `correlation_id` | uuid                     | YES  | —                 | internal       |

### `org.feature_flags`

**Scope:** platform · **Retention class:** operational · Platform feature register; tenants never modify.

| Column            | Type                     | Null | Default           | Classification |
| ----------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`              | uuid                     | NO   | gen_random_uuid() | internal       |
| `flag_code`       | text                     | NO   | —                 | internal       |
| `name`            | text                     | NO   | —                 | internal       |
| `description`     | text                     | YES  | —                 | internal       |
| `default_enabled` | boolean                  | NO   | false             | internal       |
| `status`          | text                     | NO   | 'active'::text    | internal       |
| `record_version`  | integer                  | NO   | 1                 | internal       |
| `created_at`      | timestamp with time zone | NO   | now()             | internal       |
| `created_by`      | uuid                     | NO   | —                 | internal       |
| `updated_at`      | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`      | uuid                     | YES  | —                 | internal       |

### `org.subscription_plans`

**Scope:** platform · **Retention class:** operational · Versioned effective-dated plan catalogue; drafts hidden from app roles.

| Column                 | Type                     | Null | Default           | Classification |
| ---------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                   | uuid                     | NO   | gen_random_uuid() | internal       |
| `plan_code`            | text                     | NO   | —                 | internal       |
| `name`                 | text                     | NO   | —                 | internal       |
| `description`          | text                     | YES  | —                 | internal       |
| `entitlement_document` | jsonb                    | NO   | '{}'::jsonb       | internal       |
| `capacity_limits`      | jsonb                    | NO   | '{}'::jsonb       | internal       |
| `status`               | text                     | NO   | 'draft'::text     | internal       |
| `effective_from`       | timestamp with time zone | NO   | —                 | internal       |
| `effective_to`         | timestamp with time zone | YES  | —                 | internal       |
| `record_version`       | integer                  | NO   | 1                 | internal       |
| `created_at`           | timestamp with time zone | NO   | now()             | internal       |
| `created_by`           | uuid                     | NO   | —                 | internal       |
| `updated_at`           | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`           | uuid                     | YES  | —                 | internal       |

### `org.tenant_subscriptions`

**Scope:** tenant · **Retention class:** operational · Assignment history; active intervals non-overlapping per tenant.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `plan_id`        | uuid                     | NO   | —                 | internal       |
| `status`         | text                     | NO   | 'draft'::text     | internal       |
| `effective_from` | timestamp with time zone | NO   | —                 | internal       |
| `effective_to`   | timestamp with time zone | YES  | —                 | internal       |
| `assigned_by`    | uuid                     | NO   | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `org.legal_companies`

**Scope:** tenant · **Retention class:** operational · Companies; composite candidate key (tenant_id, id) for all children.

| Column                    | Type                     | Null | Default           | Classification |
| ------------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                      | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`               | uuid                     | NO   | —                 | internal       |
| `company_code`            | text                     | NO   | —                 | internal       |
| `legal_name`              | text                     | NO   | —                 | internal       |
| `registration_number`     | text                     | YES  | —                 | restricted     |
| `tax_registration_number` | text                     | YES  | —                 | restricted     |
| `base_currency_code`      | text                     | NO   | —                 | internal       |
| `status`                  | text                     | NO   | 'active'::text    | internal       |
| `record_version`          | integer                  | NO   | 1                 | internal       |
| `created_at`              | timestamp with time zone | NO   | now()             | internal       |
| `created_by`              | uuid                     | NO   | —                 | internal       |
| `updated_at`              | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`              | uuid                     | YES  | —                 | internal       |
| `deleted_at`              | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`              | uuid                     | YES  | —                 | internal       |
| `archived_at`             | timestamp with time zone | YES  | —                 | internal       |
| `archived_by`             | uuid                     | YES  | —                 | internal       |

### `org.branches`

**Scope:** tenant/company · **Retention class:** operational · Branches; composite FK carries the tenant; (tenant, company, id) for children.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `company_id`     | uuid                     | NO   | —                 | internal       |
| `branch_code`    | text                     | NO   | —                 | internal       |
| `name`           | text                     | NO   | —                 | internal       |
| `address_line1`  | text                     | YES  | —                 | restricted     |
| `address_line2`  | text                     | YES  | —                 | restricted     |
| `city`           | text                     | YES  | —                 | restricted     |
| `region`         | text                     | YES  | —                 | restricted     |
| `postal_code`    | text                     | YES  | —                 | restricted     |
| `country_code`   | text                     | YES  | —                 | internal       |
| `timezone_name`  | text                     | NO   | —                 | internal       |
| `status`         | text                     | NO   | 'active'::text    | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`     | uuid                     | YES  | —                 | internal       |
| `archived_at`    | timestamp with time zone | YES  | —                 | internal       |
| `archived_by`    | uuid                     | YES  | —                 | internal       |

### `org.branch_status_history`

**Scope:** tenant · **Retention class:** evidence-audit · Append-only branch lifecycle evidence.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `branch_id`      | uuid                     | NO   | —                 | internal       |
| `from_state`     | text                     | YES  | —                 | internal       |
| `to_state`       | text                     | NO   | —                 | internal       |
| `reason`         | text                     | NO   | —                 | internal       |
| `actor_id`       | uuid                     | NO   | —                 | internal       |
| `occurred_at`    | timestamp with time zone | NO   | now()             | internal       |
| `correlation_id` | uuid                     | YES  | —                 | internal       |

### `org.departments`

**Scope:** tenant/company/branch · **Retention class:** operational · Branch child; live-code uniqueness (archive frees the code).

| Column            | Type                     | Null | Default           | Classification |
| ----------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`              | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`       | uuid                     | NO   | —                 | internal       |
| `company_id`      | uuid                     | NO   | —                 | internal       |
| `branch_id`       | uuid                     | NO   | —                 | internal       |
| `department_code` | text                     | NO   | —                 | internal       |
| `name`            | text                     | NO   | —                 | internal       |
| `status`          | text                     | NO   | 'active'::text    | internal       |
| `record_version`  | integer                  | NO   | 1                 | internal       |
| `created_at`      | timestamp with time zone | NO   | now()             | internal       |
| `created_by`      | uuid                     | NO   | —                 | internal       |
| `updated_at`      | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`      | uuid                     | YES  | —                 | internal       |
| `deleted_at`      | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`      | uuid                     | YES  | —                 | internal       |
| `archived_at`     | timestamp with time zone | YES  | —                 | internal       |
| `archived_by`     | uuid                     | YES  | —                 | internal       |

### `org.warehouses`

**Scope:** tenant/company/branch · **Retention class:** operational · Structure only — NO stock columns in this phase.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `company_id`     | uuid                     | NO   | —                 | internal       |
| `branch_id`      | uuid                     | NO   | —                 | internal       |
| `warehouse_code` | text                     | NO   | —                 | internal       |
| `name`           | text                     | NO   | —                 | internal       |
| `warehouse_type` | text                     | NO   | 'general'::text   | internal       |
| `status`         | text                     | NO   | 'active'::text    | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`     | uuid                     | YES  | —                 | internal       |
| `archived_at`    | timestamp with time zone | YES  | —                 | internal       |
| `archived_by`    | uuid                     | YES  | —                 | internal       |

### `org.storage_locations`

**Scope:** tenant/company/branch/warehouse · **Retention class:** operational · Warehouse child; full composite FK; no quantity columns.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `company_id`     | uuid                     | NO   | —                 | internal       |
| `branch_id`      | uuid                     | NO   | —                 | internal       |
| `warehouse_id`   | uuid                     | NO   | —                 | internal       |
| `location_code`  | text                     | NO   | —                 | internal       |
| `name`           | text                     | NO   | —                 | internal       |
| `status`         | text                     | NO   | 'active'::text    | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`     | uuid                     | YES  | —                 | internal       |
| `archived_at`    | timestamp with time zone | YES  | —                 | internal       |
| `archived_by`    | uuid                     | YES  | —                 | internal       |

### `org.cost_centers`

**Scope:** tenant/company · **Retention class:** operational · Effective-dated; overlapping validity per code rejected.

| Column             | Type                     | Null | Default           | Classification |
| ------------------ | ------------------------ | ---- | ----------------- | -------------- |
| `id`               | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`        | uuid                     | NO   | —                 | internal       |
| `company_id`       | uuid                     | NO   | —                 | internal       |
| `cost_center_code` | text                     | NO   | —                 | internal       |
| `name`             | text                     | NO   | —                 | internal       |
| `status`           | text                     | NO   | 'active'::text    | internal       |
| `effective_from`   | date                     | NO   | —                 | internal       |
| `effective_to`     | date                     | YES  | —                 | internal       |
| `record_version`   | integer                  | NO   | 1                 | internal       |
| `created_at`       | timestamp with time zone | NO   | now()             | internal       |
| `created_by`       | uuid                     | NO   | —                 | internal       |
| `updated_at`       | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`       | uuid                     | YES  | —                 | internal       |
| `deleted_at`       | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`       | uuid                     | YES  | —                 | internal       |

### `org.company_settings`

**Scope:** tenant/company · **Retention class:** operational · Versioned append-only configuration; NO secrets permitted.

| Column           | Type                     | Null | Default           | Classification                          |
| ---------------- | ------------------------ | ---- | ----------------- | --------------------------------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal                                |
| `tenant_id`      | uuid                     | NO   | —                 | internal                                |
| `company_id`     | uuid                     | NO   | —                 | internal                                |
| `setting_key`    | text                     | NO   | —                 | internal                                |
| `setting_value`  | jsonb                    | NO   | —                 | internal (restricted when is_sensitive) |
| `value_type`     | text                     | NO   | —                 | internal                                |
| `is_sensitive`   | boolean                  | NO   | false             | internal (restricted when is_sensitive) |
| `version`        | integer                  | NO   | —                 | internal                                |
| `effective_from` | timestamp with time zone | NO   | now()             | internal                                |
| `record_version` | integer                  | NO   | 1                 | internal                                |
| `created_at`     | timestamp with time zone | NO   | now()             | internal                                |
| `created_by`     | uuid                     | NO   | —                 | internal                                |

### `org.branch_settings`

**Scope:** tenant/company/branch · **Retention class:** operational · Versioned append-only configuration; NO secrets permitted.

| Column           | Type                     | Null | Default           | Classification                          |
| ---------------- | ------------------------ | ---- | ----------------- | --------------------------------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal                                |
| `tenant_id`      | uuid                     | NO   | —                 | internal                                |
| `company_id`     | uuid                     | NO   | —                 | internal                                |
| `branch_id`      | uuid                     | NO   | —                 | internal                                |
| `setting_key`    | text                     | NO   | —                 | internal                                |
| `setting_value`  | jsonb                    | NO   | —                 | internal (restricted when is_sensitive) |
| `value_type`     | text                     | NO   | —                 | internal                                |
| `is_sensitive`   | boolean                  | NO   | false             | internal (restricted when is_sensitive) |
| `version`        | integer                  | NO   | —                 | internal                                |
| `effective_from` | timestamp with time zone | NO   | now()             | internal                                |
| `record_version` | integer                  | NO   | 1                 | internal                                |
| `created_at`     | timestamp with time zone | NO   | now()             | internal                                |
| `created_by`     | uuid                     | NO   | —                 | internal                                |

### `org.tax_classes`

**Scope:** tenant/company · **Retention class:** operational · Company-scoped tax classes; nothing seeded (OIR-04 open).

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `company_id`     | uuid                     | NO   | —                 | internal       |
| `tax_class_code` | text                     | NO   | —                 | restricted     |
| `name`           | text                     | NO   | —                 | restricted     |
| `status`         | text                     | NO   | 'active'::text    | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`     | uuid                     | YES  | —                 | internal       |

### `org.tax_rates`

**Scope:** tenant/company · **Retention class:** operational · NUMERIC(9,6) fraction in [0,1]; active rates non-overlapping.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `company_id`     | uuid                     | NO   | —                 | internal       |
| `tax_class_id`   | uuid                     | NO   | —                 | internal       |
| `rate`           | numeric                  | NO   | —                 | restricted     |
| `status`         | text                     | NO   | 'active'::text    | internal       |
| `effective_from` | date                     | NO   | —                 | internal       |
| `effective_to`   | date                     | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `deleted_by`     | uuid                     | YES  | —                 | internal       |

### `org.tenant_feature_overrides`

**Scope:** tenant · **Retention class:** operational · Platform-assigned interval overrides; history preserved.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `flag_code`      | text                     | NO   | —                 | internal       |
| `enabled`        | boolean                  | NO   | —                 | internal       |
| `reason`         | text                     | NO   | —                 | internal       |
| `effective_from` | timestamp with time zone | NO   | —                 | internal       |
| `effective_to`   | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |

### `shared.idempotency_keys`

**Scope:** platform (nullable tenant) · **Retention class:** temporary · Idempotency records; same-transaction write; app roles: none.

| Column                | Type                     | Null | Default           | Classification |
| --------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                  | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`           | uuid                     | YES  | —                 | internal       |
| `operation`           | text                     | NO   | —                 | internal       |
| `idempotency_key`     | text                     | NO   | —                 | internal       |
| `request_fingerprint` | text                     | NO   | —                 | internal       |
| `response_document`   | jsonb                    | NO   | —                 | internal       |
| `created_at`          | timestamp with time zone | NO   | now()             | internal       |
| `created_by`          | uuid                     | NO   | —                 | internal       |
| `expires_at`          | timestamp with time zone | YES  | —                 | internal       |

## Phase 1-4 — identity, authorization, security, and audit (generated from the live catalog, 2026-07-18)

Credentials are never stored in these tables; the identity provider is the
credential authority. Contact fields are classified `restricted`.

### `iam.user_accounts`

**Scope:** tenant · **Retention class:** operational · One account per principal; external identity by reference only; lifecycle via `iam.change_user_status()`.

| Column              | Type                     | Null | Default           | Classification |
| ------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`         | uuid                     | NO   | —                 | internal       |
| `identity_provider` | text                     | NO   | —                 | internal       |
| `provider_subject`  | text                     | NO   | —                 | restricted     |
| `email`             | citext                   | NO   | —                 | restricted     |
| `display_name`      | text                     | NO   | —                 | internal       |
| `status`            | text                     | NO   | 'invited'::text   | internal       |
| `mfa_required`      | boolean                  | NO   | false             | internal       |
| `deleted_at`        | timestamp with time zone | YES  | —                 | internal       |
| `record_version`    | integer                  | NO   | 1                 | internal       |
| `created_at`        | timestamp with time zone | NO   | now()             | internal       |
| `created_by`        | uuid                     | NO   | —                 | internal       |
| `updated_at`        | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`        | uuid                     | YES  | —                 | internal       |

### `iam.user_profiles`

**Scope:** tenant · **Retention class:** personal-data · One profile per account (PK = `user_id`); contact fields restricted.

| Column           | Type                     | Null | Default | Classification |
| ---------------- | ------------------------ | ---- | ------- | -------------- |
| `user_id`        | uuid                     | NO   | —       | internal       |
| `tenant_id`      | uuid                     | NO   | —       | internal       |
| `full_name`      | text                     | YES  | —       | restricted     |
| `phone_contact`  | text                     | YES  | —       | restricted     |
| `locale_code`    | text                     | YES  | —       | internal       |
| `timezone_name`  | text                     | YES  | —       | internal       |
| `avatar_ref`     | text                     | YES  | —       | internal       |
| `record_version` | integer                  | NO   | 1       | internal       |
| `created_at`     | timestamp with time zone | NO   | now()   | internal       |
| `created_by`     | uuid                     | NO   | —       | internal       |
| `updated_at`     | timestamp with time zone | YES  | —       | internal       |
| `updated_by`     | uuid                     | YES  | —       | internal       |

### `iam.user_employee_links`

**Scope:** tenant · **Retention class:** operational · Effective-dated employee-reference placeholder (no Phase 1-9 FK); intervals per user cannot overlap.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `user_id`        | uuid                     | NO   | —                 | internal       |
| `employee_ref`   | text                     | NO   | —                 | internal       |
| `valid_from`     | date                     | NO   | —                 | internal       |
| `valid_to`       | date                     | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `iam.user_status_history`

**Scope:** tenant · **Retention class:** evidence-audit · Append-only lifecycle evidence; `actor_id`/`occurred_at` server-stamped; reason mandatory.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `user_id`        | uuid                     | NO   | —                 | internal       |
| `from_state`     | text                     | YES  | —                 | internal       |
| `to_state`       | text                     | NO   | —                 | internal       |
| `reason`         | text                     | NO   | —                 | internal       |
| `actor_id`       | uuid                     | NO   | —                 | internal       |
| `occurred_at`    | timestamp with time zone | NO   | now()             | internal       |
| `correlation_id` | uuid                     | YES  | —                 | internal       |

### `iam.permissions`

**Scope:** platform · **Retention class:** operational · Platform-owned permission catalog; read-only to app roles; code immutable.

| Column            | Type                     | Null | Default           | Classification |
| ----------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`              | uuid                     | NO   | gen_random_uuid() | internal       |
| `permission_code` | text                     | NO   | —                 | internal       |
| `domain`          | text                     | NO   | —                 | internal       |
| `description`     | text                     | NO   | —                 | internal       |
| `risk_level`      | text                     | NO   | 'low'::text       | internal       |
| `record_version`  | integer                  | NO   | 1                 | internal       |
| `created_at`      | timestamp with time zone | NO   | now()             | internal       |
| `created_by`      | uuid                     | NO   | —                 | internal       |
| `updated_at`      | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`      | uuid                     | YES  | —                 | internal       |

### `iam.roles`

**Scope:** tenant · **Retention class:** operational · Tenant-scoped named permission bundles; `role_code`/`is_system` immutable; soft-delete.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `role_code`      | text                     | NO   | —                 | internal       |
| `name`           | text                     | NO   | —                 | internal       |
| `description`    | text                     | YES  | —                 | internal       |
| `is_system`      | boolean                  | NO   | false             | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `iam.role_permissions`

**Scope:** tenant · **Retention class:** operational · Role→permission map with explicit `effect` (allow/deny); deny precedence persisted; mapped permission cannot be deleted.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `role_id`        | uuid                     | NO   | —                 | internal       |
| `permission_id`  | uuid                     | NO   | —                 | internal       |
| `effect`         | text                     | NO   | 'allow'::text     | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `iam.role_grants`

**Scope:** tenant · **Retention class:** evidence-audit · Role→user assignment with validity, revocation, approval ref; scope_mode/identity immutable; self-grant denied.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `user_id`        | uuid                     | NO   | —                 | internal       |
| `role_id`        | uuid                     | NO   | —                 | internal       |
| `scope_mode`     | text                     | NO   | 'unrestricted'    | internal       |
| `status`         | text                     | NO   | 'active'::text    | internal       |
| `valid_from`     | timestamp with time zone | NO   | now()             | internal       |
| `valid_to`       | timestamp with time zone | YES  | —                 | internal       |
| `granted_by`     | uuid                     | NO   | —                 | internal       |
| `approval_ref`   | text                     | YES  | —                 | internal       |
| `revoked_at`     | timestamp with time zone | YES  | —                 | internal       |
| `revoke_reason`  | text                     | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `iam.grant_scopes`

**Scope:** tenant · **Retention class:** evidence-audit · Company/branch/department scope rows for a scoped grant; parent chain carried via composite FKs; append-only.

| Column          | Type                     | Null | Default           | Classification |
| --------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`            | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`     | uuid                     | NO   | —                 | internal       |
| `grant_id`      | uuid                     | NO   | —                 | internal       |
| `scope_type`    | text                     | NO   | —                 | internal       |
| `company_id`    | uuid                     | YES  | —                 | internal       |
| `branch_id`     | uuid                     | YES  | —                 | internal       |
| `department_id` | uuid                     | YES  | —                 | internal       |
| `created_at`    | timestamp with time zone | NO   | now()             | internal       |
| `created_by`    | uuid                     | NO   | —                 | internal       |

### `iam.approval_limits`

**Scope:** tenant (company) · **Retention class:** evidence-audit · Effective-dated monetary ceiling per role XOR user; NUMERIC(18,4); non-overlapping; identity/amount immutable.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `company_id`     | uuid                     | NO   | —                 | internal       |
| `role_id`        | uuid                     | YES  | —                 | internal       |
| `user_id`        | uuid                     | YES  | —                 | internal       |
| `limit_type`     | text                     | NO   | —                 | internal       |
| `amount`         | numeric(18,4)            | NO   | —                 | internal       |
| `currency_code`  | text                     | NO   | —                 | internal       |
| `effective_from` | date                     | NO   | —                 | internal       |
| `effective_to`   | date                     | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `iam.sensitive_data_permissions`

**Scope:** tenant · **Retention class:** evidence-audit · Role permission to view/export/mask_override a classification; effective-dated, non-overlapping; identity immutable.

| Column            | Type                     | Null | Default           | Classification |
| ----------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`              | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`       | uuid                     | NO   | —                 | internal       |
| `role_id`         | uuid                     | NO   | —                 | internal       |
| `classification`  | text                     | NO   | —                 | internal       |
| `permission_kind` | text                     | NO   | —                 | internal       |
| `effective_from`  | date                     | NO   | —                 | internal       |
| `effective_to`    | date                     | YES  | —                 | internal       |
| `record_version`  | integer                  | NO   | 1                 | internal       |
| `created_at`      | timestamp with time zone | NO   | now()             | internal       |
| `created_by`      | uuid                     | NO   | —                 | internal       |
| `updated_at`      | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`      | uuid                     | YES  | —                 | internal       |

### `iam.login_audit`

**Scope:** tenant (nullable) · **Retention class:** evidence-audit · Append-only auth events; occurred_at server-stamped; hashes only, no credentials; own-history read.

| Column            | Type                     | Null | Default           | Classification |
| ----------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`              | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`       | uuid                     | YES  | —                 | internal       |
| `user_id`         | uuid                     | YES  | —                 | internal       |
| `event_type`      | text                     | NO   | —                 | internal       |
| `ip_hash`         | text                     | YES  | —                 | restricted     |
| `user_agent_hash` | text                     | YES  | —                 | restricted     |
| `detail`          | text                     | YES  | —                 | internal       |
| `correlation_id`  | uuid                     | YES  | —                 | internal       |
| `occurred_at`     | timestamp with time zone | NO   | now()             | internal       |

### `iam.user_sessions`

**Scope:** tenant · **Retention class:** operational · Session METADATA (never tokens); session_ref opaque unique; hashes only; own-session read; identity immutable.

| Column            | Type                     | Null | Default           | Classification |
| ----------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`              | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`       | uuid                     | NO   | —                 | internal       |
| `user_id`         | uuid                     | NO   | —                 | internal       |
| `session_ref`     | text                     | NO   | —                 | restricted     |
| `ip_hash`         | text                     | YES  | —                 | restricted     |
| `user_agent_hash` | text                     | YES  | —                 | restricted     |
| `issued_at`       | timestamp with time zone | NO   | now()             | internal       |
| `last_seen_at`    | timestamp with time zone | YES  | —                 | internal       |
| `expires_at`      | timestamp with time zone | YES  | —                 | internal       |
| `revoked_at`      | timestamp with time zone | YES  | —                 | internal       |
| `revoke_reason`   | text                     | YES  | —                 | internal       |
| `correlation_id`  | uuid                     | YES  | —                 | internal       |
| `record_version`  | integer                  | NO   | 1                 | internal       |
| `created_at`      | timestamp with time zone | NO   | now()             | internal       |
| `created_by`      | uuid                     | NO   | —                 | internal       |
| `updated_at`      | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`      | uuid                     | YES  | —                 | internal       |

### `iam.audit_records`

**Scope:** tenant · **Retention class:** evidence-audit · Append-only audit event header; per-tenant `seq`; platform-only (no app grant).

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `seq`            | bigint                   | NO   | —                 | internal       |
| `actor_id`       | uuid                     | YES  | —                 | internal       |
| `actor_kind`     | text                     | NO   | —                 | internal       |
| `action`         | text                     | NO   | —                 | internal       |
| `entity_type`    | text                     | NO   | —                 | internal       |
| `entity_id`      | uuid                     | YES  | —                 | internal       |
| `company_id`     | uuid                     | YES  | —                 | internal       |
| `branch_id`      | uuid                     | YES  | —                 | internal       |
| `correlation_id` | uuid                     | YES  | —                 | internal       |
| `request_ref`    | text                     | YES  | —                 | internal       |
| `occurred_at`    | timestamp with time zone | NO   | now()             | internal       |

### `iam.audit_record_details`

**Scope:** tenant · **Retention class:** evidence-audit · Field-level changes; restricted/secret values stored MASKED; no raw restricted value.

| Column                 | Type | Null | Default           | Classification |
| ---------------------- | ---- | ---- | ----------------- | -------------- |
| `id`                   | uuid | NO   | gen_random_uuid() | internal       |
| `tenant_id`            | uuid | NO   | —                 | internal       |
| `audit_record_id`      | uuid | NO   | —                 | internal       |
| `field_name`           | text | NO   | —                 | internal       |
| `old_value_masked`     | text | YES  | —                 | restricted     |
| `new_value_masked`     | text | YES  | —                 | restricted     |
| `value_classification` | text | NO   | —                 | internal       |

### `iam.audit_integrity_links`

**Scope:** tenant · **Retention class:** immutable-financial-history · Per-tenant SHA-256 chain; 32-byte prev/record hashes; gap or alteration is detectable.

| Column            | Type   | Null | Default           | Classification |
| ----------------- | ------ | ---- | ----------------- | -------------- |
| `id`              | uuid   | NO   | gen_random_uuid() | internal       |
| `tenant_id`       | uuid   | NO   | —                 | internal       |
| `audit_record_id` | uuid   | NO   | —                 | internal       |
| `seq`             | bigint | NO   | —                 | internal       |
| `prev_hash`       | bytea  | NO   | —                 | internal       |
| `record_hash`     | bytea  | NO   | —                 | internal       |

### `iam.security_events`

**Scope:** tenant (nullable) · **Retention class:** evidence-audit · Payload-free security log; no sensitive payload; append-only, platform-only.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | YES  | —                 | internal       |
| `event_type`     | text                     | NO   | —                 | internal       |
| `severity`       | text                     | NO   | 'info'::text      | internal       |
| `actor_id`       | uuid                     | YES  | —                 | internal       |
| `detail`         | text                     | YES  | —                 | internal       |
| `correlation_id` | uuid                     | YES  | —                 | internal       |
| `occurred_at`    | timestamp with time zone | NO   | now()             | internal       |

### `shared.status_history`

**Scope:** tenant · **Retention class:** evidence-audit · Generic append-only status transitions; actor/occurred server-stamped; SELECT-only for app roles.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `entity_type`    | text                     | NO   | —                 | internal       |
| `entity_id`      | uuid                     | NO   | —                 | internal       |
| `from_state`     | text                     | YES  | —                 | internal       |
| `to_state`       | text                     | NO   | —                 | internal       |
| `reason`         | text                     | NO   | —                 | internal       |
| `actor_id`       | uuid                     | NO   | —                 | internal       |
| `occurred_at`    | timestamp with time zone | NO   | now()             | internal       |
| `correlation_id` | uuid                     | YES  | —                 | internal       |

### `shared.status_evidence`

**Scope:** tenant · **Retention class:** evidence-audit · Evidence-reference placeholder (no Phase-1-5 FK); `evidence_ref` is a placeholder string.

| Column              | Type                     | Null | Default           | Classification |
| ------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`         | uuid                     | NO   | —                 | internal       |
| `status_history_id` | uuid                     | NO   | —                 | internal       |
| `evidence_type`     | text                     | NO   | —                 | internal       |
| `evidence_ref`      | text                     | NO   | —                 | internal       |
| `note`              | text                     | YES  | —                 | internal       |
| `created_at`        | timestamp with time zone | NO   | now()             | internal       |
| `created_by`        | uuid                     | NO   | —                 | internal       |

## Phase 1-5 — shared services (documents; generated from the live catalog, 2026-07-18)

### `shared.document_categories`

**Scope:** platform + tenant · **Retention class:** operational · Dual-scope document policy envelope. A platform row (`tenant_id` NULL) is a shared default readable by every tenant; a tenant row is a tenant override. Category constraints are data, not upload implementation. Runtime SELECT-only.

| Column                    | Type                     | Null | Default           | Classification |
| ------------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                      | uuid                     | NO   | gen_random_uuid() | internal       |
| `scope`                   | text                     | NO   | —                 | internal       |
| `tenant_id`               | uuid                     | YES  | —                 | internal       |
| `category_code`           | text                     | NO   | —                 | internal       |
| `name`                    | text                     | NO   | —                 | internal       |
| `description`             | text                     | YES  | —                 | internal       |
| `allowed_content_types`   | text[]                   | NO   | —                 | internal       |
| `max_size_bytes`          | bigint                   | NO   | —                 | internal       |
| `default_classification`  | text                     | NO   | —                 | internal       |
| `default_retention_class` | text                     | NO   | —                 | internal       |
| `status`                  | text                     | NO   | 'active'          | internal       |
| `deleted_at`              | timestamp with time zone | YES  | —                 | internal       |
| `record_version`          | integer                  | NO   | 1                 | internal       |
| `created_at`              | timestamp with time zone | NO   | now()             | internal       |
| `created_by`              | uuid                     | NO   | —                 | internal       |
| `updated_at`              | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`              | uuid                     | YES  | —                 | internal       |

### `shared.documents`

**Scope:** tenant · **Retention class:** operational (per-row `retention_class`) · Governed per-file metadata; no file bytes (object storage is later backend scope). Category must be platform-scoped or owned by the same tenant. `legal_hold` recorded here; enforcement in Increment D. Runtime SELECT-only.

| Column            | Type                     | Null | Default           | Classification |
| ----------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`              | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`       | uuid                     | NO   | —                 | internal       |
| `company_id`      | uuid                     | YES  | —                 | internal       |
| `branch_id`       | uuid                     | YES  | —                 | internal       |
| `category_id`     | uuid                     | NO   | —                 | internal       |
| `title`           | text                     | NO   | —                 | restricted     |
| `classification`  | text                     | NO   | —                 | internal       |
| `retention_class` | text                     | NO   | —                 | internal       |
| `legal_hold`      | boolean                  | NO   | false             | internal       |
| `status`          | text                     | NO   | 'pending'         | internal       |
| `archived_at`     | timestamp with time zone | YES  | —                 | internal       |
| `deleted_at`      | timestamp with time zone | YES  | —                 | internal       |
| `record_version`  | integer                  | NO   | 1                 | internal       |
| `created_at`      | timestamp with time zone | NO   | now()             | internal       |
| `created_by`      | uuid                     | NO   | —                 | internal       |
| `updated_at`      | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`      | uuid                     | YES  | —                 | internal       |

### `shared.document_versions`

**Scope:** tenant · **Retention class:** evidence-audit · Append-only per-version file metadata (no bytes). `version_number` unique per document; one-way lifecycle (pending → accepted/quarantined/rejected) via `shared.guard_document_version_transition`; terminal rows immutable. Runtime SELECT-only.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `document_id`    | uuid                     | NO   | —                 | internal       |
| `version_number` | integer                  | NO   | —                 | internal       |
| `storage_key`    | text                     | NO   | —                 | restricted     |
| `content_type`   | text                     | NO   | —                 | internal       |
| `size_bytes`     | bigint                   | NO   | —                 | internal       |
| `sha256`         | bytea                    | NO   | —                 | internal       |
| `uploaded_by`    | uuid                     | NO   | —                 | internal       |
| `uploaded_at`    | timestamp with time zone | NO   | now()             | internal       |
| `status`         | text                     | NO   | 'pending'         | internal       |
| `accepted_at`    | timestamp with time zone | YES  | —                 | internal       |
| `quarantined_at` | timestamp with time zone | YES  | —                 | internal       |
| `rejected_at`    | timestamp with time zone | YES  | —                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |

### `shared.file_scan_results`

**Scope:** tenant · **Retention class:** evidence-audit · Append-only scan verdict history per version (pending|clean|infected|error). An infected verdict blocks acceptance and supports quarantine. `details` is sanitized JSON. Runtime SELECT-only.

| Column         | Type                     | Null | Default           | Classification |
| -------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`           | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`    | uuid                     | NO   | —                 | internal       |
| `version_id`   | uuid                     | NO   | —                 | internal       |
| `scan_status`  | text                     | NO   | —                 | internal       |
| `scanner_code` | text                     | NO   | —                 | internal       |
| `threat_name`  | text                     | YES  | —                 | internal       |
| `details`      | jsonb                    | NO   | '{}'::jsonb       | internal       |
| `scanned_at`   | timestamp with time zone | NO   | now()             | internal       |
| `created_at`   | timestamp with time zone | NO   | now()             | internal       |
| `created_by`   | uuid                     | NO   | —                 | internal       |

### `shared.document_links`

**Scope:** tenant · **Retention class:** operational · Generic tenant-scoped links from a document to a business entity (`entity_type` schema.table token, `entity_id`). Establishes the link-derived access contract; one active link per (document, entity, purpose). Runtime SELECT + `shared.document_ids_for_entity` EXECUTE only.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `document_id`    | uuid                     | NO   | —                 | internal       |
| `entity_type`    | text                     | NO   | —                 | internal       |
| `entity_id`      | uuid                     | NO   | —                 | internal       |
| `link_purpose`   | text                     | NO   | —                 | internal       |
| `linked_by`      | uuid                     | NO   | —                 | internal       |
| `linked_at`      | timestamp with time zone | NO   | now()             | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `shared.retention_classes`

**Scope:** platform · **Retention class:** operational · Deterministic platform definition of each retention class: minimum retention period (NULL = indefinite) and whether physical deletion is ever permitted. Populated by structural seeds. Runtime SELECT-only.

| Column               | Type                     | Null | Default | Classification |
| -------------------- | ------------------------ | ---- | ------- | -------------- |
| `class_code`         | text                     | NO   | —       | internal       |
| `description`        | text                     | NO   | —       | internal       |
| `min_retention_days` | integer                  | YES  | —       | internal       |
| `allows_deletion`    | boolean                  | NO   | —       | internal       |
| `record_version`     | integer                  | NO   | 1       | internal       |
| `created_at`         | timestamp with time zone | NO   | now()   | internal       |
| `created_by`         | uuid                     | NO   | —       | internal       |
| `updated_at`         | timestamp with time zone | YES  | —       | internal       |
| `updated_by`         | uuid                     | YES  | —       | internal       |

### `shared.legal_holds`

**Scope:** tenant · **Retention class:** evidence-audit · Auditable per-document legal hold; an active hold (`released_at` NULL) blocks archival/deletion absolutely. Placing/releasing is a backend operation. Runtime SELECT-only.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `document_id`    | uuid                     | NO   | —                 | internal       |
| `reason`         | text                     | NO   | —                 | internal       |
| `placed_by`      | uuid                     | NO   | —                 | internal       |
| `placed_at`      | timestamp with time zone | NO   | now()             | internal       |
| `released_by`    | uuid                     | YES  | —                 | internal       |
| `released_at`    | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `shared.message_templates`

**Scope:** platform + tenant · **Retention class:** operational · Dual-scope governed message-template identity. Platform rows are shared defaults; tenant rows are overrides. Phase 1 channels are restricted to `email` and `in_app`. An active version must belong to the template and be approved. Runtime SELECT-only; no customer-facing wording is seeded.

| Column              | Type                     | Null | Default           | Classification |
| ------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                | uuid                     | NO   | gen_random_uuid() | internal       |
| `scope`             | text                     | NO   | —                 | internal       |
| `tenant_id`         | uuid                     | YES  | —                 | internal       |
| `template_code`     | text                     | NO   | —                 | internal       |
| `name`              | text                     | NO   | —                 | internal       |
| `channel`           | text                     | NO   | —                 | internal       |
| `purpose`           | text                     | NO   | —                 | internal       |
| `locale_code`       | text                     | NO   | —                 | internal       |
| `description`       | text                     | YES  | —                 | internal       |
| `active_version_id` | uuid                     | YES  | —                 | internal       |
| `status`            | text                     | NO   | 'active'          | internal       |
| `deleted_at`        | timestamp with time zone | YES  | —                 | internal       |
| `record_version`    | integer                  | NO   | 1                 | internal       |
| `created_at`        | timestamp with time zone | NO   | now()             | internal       |
| `created_by`        | uuid                     | NO   | —                 | internal       |
| `updated_at`        | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`        | uuid                     | YES  | —                 | internal       |

### `shared.template_versions`

**Scope:** platform + tenant (mirrors template) · **Retention class:** evidence-audit · Governed template content with one-way draft → approved → retired lifecycle. Approved content is immutable, and an active version cannot be retired. Runtime SELECT-only.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | YES  | —                 | internal       |
| `template_id`    | uuid                     | NO   | —                 | internal       |
| `version_number` | integer                  | NO   | —                 | internal       |
| `subject`        | text                     | YES  | —                 | restricted     |
| `body`           | text                     | NO   | —                 | restricted     |
| `content_hash`   | bytea                    | NO   | —                 | internal       |
| `status`         | text                     | NO   | 'draft'           | internal       |
| `approved_at`    | timestamp with time zone | YES  | —                 | internal       |
| `approved_by`    | uuid                     | YES  | —                 | internal       |
| `retired_at`     | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

### `shared.outbound_messages`

**Scope:** tenant · **Retention class:** operational · Tenant-scoped outbound-message envelope. Phase 1 channels are exactly `email` and `in_app`; purposes are exactly `transactional`, `marketing`, and `system`. A recipient is represented by a tenant-bound user and/or a 32-byte destination digest—never a plaintext external address. Only the rendered-content integrity digest is stored; rendering and transient content belong to the backend dispatch phase and are not persisted here. Optional template versions are approved and platform-or-same-tenant. Rows start `pending` and follow the guarded delivery lifecycle. Runtime SELECT-only.

| Column                | Type                     | Null | Default           | Classification |
| --------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                  | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`           | uuid                     | NO   | —                 | internal       |
| `company_id`          | uuid                     | YES  | —                 | internal       |
| `branch_id`           | uuid                     | YES  | —                 | internal       |
| `template_version_id` | uuid                     | YES  | —                 | internal       |
| `channel`             | text                     | NO   | —                 | internal       |
| `purpose`             | text                     | NO   | —                 | internal       |
| `recipient_digest`    | bytea                    | YES  | —                 | restricted     |
| `recipient_user_id`   | uuid                     | YES  | —                 | restricted     |
| `body_sha256`         | bytea                    | NO   | —                 | internal       |
| `dedupe_key`          | text                     | NO   | —                 | internal       |
| `consent_ref`         | text                     | YES  | —                 | restricted     |
| `status`              | text                     | NO   | 'pending'         | internal       |
| `retry_count`         | integer                  | NO   | 0                 | internal       |
| `failure_class`       | text                     | YES  | —                 | internal       |
| `queued_at`           | timestamp with time zone | YES  | —                 | internal       |
| `sending_at`          | timestamp with time zone | YES  | —                 | internal       |
| `sent_at`             | timestamp with time zone | YES  | —                 | internal       |
| `delivered_at`        | timestamp with time zone | YES  | —                 | internal       |
| `failed_at`           | timestamp with time zone | YES  | —                 | internal       |
| `cancelled_at`        | timestamp with time zone | YES  | —                 | internal       |
| `record_version`      | integer                  | NO   | 1                 | internal       |
| `created_at`          | timestamp with time zone | NO   | now()             | internal       |
| `created_by`          | uuid                     | NO   | —                 | internal       |
| `updated_at`          | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`          | uuid                     | YES  | —                 | internal       |

### `shared.delivery_attempts`

**Scope:** tenant · **Retention class:** evidence-audit · Append-only provider-neutral delivery-attempt evidence. Attempt numbers are unique per message, message ownership is tenant-bound structurally, and an `errored` attempt requires a sanitized non-blank summary. Provider payloads, secrets, stack traces, and plaintext recipient addresses are not stored. Runtime/readonly SELECT-only; no application UPDATE or DELETE grant/policy exists.

| Column                 | Type                                                       | Null | Default           | Classification |
| ---------------------- | ---------------------------------------------------------- | ---- | ----------------- | -------------- |
| `id`                   | uuid                                                       | NO   | gen_random_uuid() | internal       |
| `tenant_id`            | uuid                                                       | NO   | —                 | internal       |
| `message_id`           | uuid                                                       | NO   | —                 | internal       |
| `attempt_number`       | integer                                                    | NO   | —                 | internal       |
| `provider_code`        | text                                                       | NO   | —                 | internal       |
| `provider_message_ref` | text                                                       | YES  | —                 | internal       |
| `status`               | text (`started` \| `accepted` \| `delivered` \| `errored`) | NO   | —                 | internal       |
| `response_code`        | text                                                       | YES  | —                 | internal       |
| `error_summary`        | text                                                       | YES  | —                 | internal       |
| `details`              | jsonb                                                      | NO   | '{}'::jsonb       | restricted     |
| `attempted_at`         | timestamp with time zone                                   | NO   | now()             | internal       |
| `completed_at`         | timestamp with time zone                                   | YES  | —                 | internal       |
| `created_at`           | timestamp with time zone                                   | NO   | now()             | internal       |
| `created_by`           | uuid                                                       | NO   | —                 | internal       |

### `shared.event_outbox`

**Scope:** tenant · **Retention class:** operational · Transactional integration-event envelope. Event identity is unique per tenant; company/branch scope is structurally tenant-bound. `app_worker` has deliberate all-tenant SELECT/INSERT/UPDATE through `wkr_event_outbox_all`, while runtime/readonly have zero access. Rows begin pending; atomic invoker routines claim due/stale work and complete, retry, or dead-letter it. Worker DELETE is absent.

| Column              | Type                                                          | Null | Default           | Classification |
| ------------------- | ------------------------------------------------------------- | ---- | ----------------- | -------------- |
| `id`                | uuid                                                          | NO   | gen_random_uuid() | internal       |
| `tenant_id`         | uuid                                                          | NO   | —                 | internal       |
| `company_id`        | uuid                                                          | YES  | —                 | internal       |
| `branch_id`         | uuid                                                          | YES  | —                 | internal       |
| `event_key`         | text                                                          | NO   | —                 | internal       |
| `event_type`        | text                                                          | NO   | —                 | internal       |
| `aggregate_type`    | text                                                          | NO   | —                 | internal       |
| `aggregate_id`      | uuid                                                          | NO   | —                 | internal       |
| `schema_version`    | integer                                                       | NO   | —                 | internal       |
| `aggregate_version` | bigint                                                        | NO   | —                 | internal       |
| `producer`          | text                                                          | NO   | —                 | internal       |
| `occurred_at`       | timestamp with time zone                                      | NO   | now()             | internal       |
| `correlation_id`    | uuid                                                          | YES  | —                 | internal       |
| `causation_id`      | uuid                                                          | YES  | —                 | internal       |
| `payload`           | jsonb                                                         | NO   | '{}'::jsonb       | restricted     |
| `headers`           | jsonb                                                         | NO   | '{}'::jsonb       | restricted     |
| `status`            | text (`pending` \| `claimed` \| `published` \| `dead_letter`) | NO   | 'pending'         | internal       |
| `available_at`      | timestamp with time zone                                      | NO   | now()             | internal       |
| `attempt_count`     | integer                                                       | NO   | 0                 | internal       |
| `claimed_at`        | timestamp with time zone                                      | YES  | —                 | internal       |
| `claimed_by`        | text                                                          | YES  | —                 | internal       |
| `published_at`      | timestamp with time zone                                      | YES  | —                 | internal       |
| `last_error`        | text                                                          | YES  | —                 | internal       |
| `created_at`        | timestamp with time zone                                      | NO   | now()             | internal       |
| `created_by`        | uuid                                                          | NO   | —                 | internal       |

Outbox routines (migration `20260718106000`, all `SECURITY INVOKER`, empty
`search_path`, PUBLIC revoked, EXECUTE only to `app_worker`):

- `shared.claim_outbox_events(text, integer, interval)` returns an unordered
  set claimed with `FOR UPDATE SKIP LOCKED`; pending rows must be due and stale
  claims must exceed the lease.
- `shared.complete_outbox_event(uuid, text)` conditionally publishes only the
  caller's claim, stamps `published_at`, and clears claim fields.
- `shared.fail_outbox_event(uuid, text, text, interval, integer)` conditionally
  schedules a retry or dead-letters at the maximum attempt count, always
  clearing claim fields and retaining `last_error`.
- `shared.guard_event_outbox_initial_state()` is trigger-only (no role EXECUTE)
  and rejects any INSERT not pending, unstamped, error-free, and at attempt 0.

### `shared.processed_events`

**Scope:** platform + tenant · **Retention class:** evidence-audit · Append-only consumer atomic-claim registry. Consumers claim with `INSERT ... ON CONFLICT DO NOTHING RETURNING` and perform the side effect only when a row is returned. This is distinct from request-response replay in `shared.idempotency_keys`. `failed` is terminal and blocks reprocessing pending later-phase operator intervention. `app_worker` has SELECT/INSERT only; runtime/readonly have no access.

| Column          | Type                     | Null | Default     | Classification |
| --------------- | ------------------------ | ---- | ----------- | -------------- |
| `consumer_code` | text                     | NO   | —           | internal       |
| `event_id`      | uuid                     | NO   | —           | internal       |
| `tenant_id`     | uuid                     | YES  | —           | internal       |
| `processed_at`  | timestamp with time zone | NO   | now()       | internal       |
| `outcome`       | text                     | NO   | —           | internal       |
| `metadata`      | jsonb                    | NO   | '{}'::jsonb | internal       |
| `created_at`    | timestamp with time zone | NO   | now()       | internal       |
| `created_by`    | uuid                     | NO   | —           | internal       |

### `shared.error_records`

**Scope:** platform + tenant · **Retention class:** evidence-audit · Durable sanitized operational failures, including errors raised before tenant context exists. Company/branch scope is prohibited when `tenant_id` is NULL. Context is recursively screened for sensitive keys and JWT/AWS-access-key-shaped strings. Rows start open and may move open → acknowledged → resolved or open → resolved; resolved is terminal. Recorded facts are immutable, while guarded status/resolution fields are mutable. `app_worker` has SELECT/INSERT/UPDATE only; runtime/readonly have no access.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | YES  | —                 | internal       |
| `company_id`     | uuid                     | YES  | —                 | internal       |
| `branch_id`      | uuid                     | YES  | —                 | internal       |
| `error_code`     | text                     | NO   | —                 | internal       |
| `source`         | text                     | NO   | —                 | internal       |
| `operation`      | text                     | NO   | —                 | internal       |
| `severity`       | text                     | NO   | —                 | internal       |
| `retryable`      | boolean                  | NO   | —                 | internal       |
| `correlation_id` | uuid                     | YES  | —                 | internal       |
| `context`        | jsonb                    | NO   | '{}'::jsonb       | restricted     |
| `status`         | text                     | NO   | 'open'            | internal       |
| `resolved_at`    | timestamp with time zone | YES  | —                 | internal       |
| `resolved_by`    | uuid                     | YES  | —                 | internal       |
| `occurred_at`    | timestamp with time zone | NO   | now()             | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

Increment H trigger routines (migration `20260718107000`, `SECURITY INVOKER`,
empty `search_path`, PUBLIC execute revoked):

- `shared.guard_error_context_sanitized()` recursively walks every JSON object
  and array node, rejecting sensitive key names and credential-shaped strings.
- `shared.guard_error_record_lifecycle()` enforces the initial open state,
  transition graph, required resolver attribution, server resolution timestamp,
  and terminal resolved state.

### `shared.system_settings`

**Scope:** platform + tenant · **Retention class:** operational · Immutable,
versioned configuration rows. Platform defaults use `scope='platform'` with NULL
`tenant_id`; tenant overrides use `scope='tenant'` with non-NULL `tenant_id`.
Current resolution is highest tenant version, then highest platform version.
Runtime/readonly SELECT and `shared.resolve_setting(text)` only. No secrets may be
stored: `is_sensitive` classifies restricted content and does not encrypt it.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `scope`          | text                     | NO   | —                 | internal       |
| `tenant_id`      | uuid                     | YES  | —                 | internal       |
| `setting_key`    | text                     | NO   | —                 | internal       |
| `setting_value`  | jsonb                    | NO   | —                 | restricted     |
| `value_type`     | text                     | NO   | —                 | internal       |
| `is_sensitive`   | boolean                  | NO   | false             | internal       |
| `version`        | integer                  | NO   | —                 | internal       |
| `effective_from` | timestamp with time zone | NO   | now()             | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |

`uq_system_settings_scope_key_version` is the non-partial `UNIQUE NULLS NOT
DISTINCT (tenant_id, setting_key, version)` allocation referee and also covers
the nullable tenant FK. `tg_system_settings_validate_value` reuses
`org.validate_setting_value()`; `tg_system_settings_immutable` guards every
column. There is deliberately no metadata-touch trigger and no update path.
RLS policy: `sel_system_settings_visible`. Migration:
`20260718108000_shared_settings_and_localization.sql`; refs P1-05-DB-014,
P1-05-QA-006; owner `shared`.

### `shared.localization_keys`

**Scope:** platform · **Retention class:** operational · Empty platform catalogue
of stable localization keys. No `tenant_id` by design
(`TENANT_COLUMN_EXCEPTIONS`). Runtime/readonly SELECT-only; no customer-facing
wording is seeded.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `key_code`       | text                     | NO   | —                 | internal       |
| `context`        | text                     | YES  | —                 | internal       |
| `description`    | text                     | NO   | —                 | internal       |
| `status`         | text                     | NO   | 'active'          | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

`key_code` is unique and constrained to
`^[a-z][a-z0-9_.]{1,126}$`; description is non-blank and status is
active|deprecated. RLS policy: `sel_localization_keys_all`. Migration:
`20260718108000_shared_settings_and_localization.sql`; refs P1-05-DB-015,
P1-05-QA-006; owner `shared`.

### `shared.localized_texts`

**Scope:** platform · **Retention class:** evidence-audit · Governed localization
content with draft → approved → retired lifecycle. No `tenant_id` by design
(`TENANT_COLUMN_EXCEPTIONS`). Approved identity/content is immutable. The partial
unique `uq_localized_texts_one_approved` permits exactly one approved row per
key/locale, so replacement requires retirement first. No text rows are seeded.
Runtime/readonly SELECT-only.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `key_id`         | uuid                     | NO   | —                 | internal       |
| `locale_code`    | text                     | NO   | —                 | internal       |
| `version`        | integer                  | NO   | —                 | internal       |
| `text_value`     | text                     | NO   | —                 | internal       |
| `status`         | text                     | NO   | 'draft'           | internal       |
| `approved_at`    | timestamp with time zone | YES  | —                 | internal       |
| `approved_by`    | uuid                     | YES  | —                 | internal       |
| `retired_at`     | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

`uq_localized_texts_key_locale_version` covers the key FK by leading column;
`ix_localized_texts_locale` covers the language FK. Pairing CHECKs require both
approval stamps for approved/retired rows and `retired_at` exactly for retired
rows. `shared.guard_localized_text_lifecycle()` enforces unstamped draft INSERT,
draft→approved stamping, approved→retired stamping, and content immutability.
RLS policy: `sel_localized_texts_all`. Migration:
`20260718108000_shared_settings_and_localization.sql`; refs P1-05-DB-015,
P1-05-QA-006; owner `shared`.

Increment I routines (migration `20260718108000`, all `SECURITY INVOKER`, empty
`search_path`, PUBLIC execute revoked):

- `shared.resolve_setting(text) → jsonb` derives tenant scope exclusively from
  `iam.current_tenant_id()`, chooses the highest tenant version before the
  highest platform version, and returns NULL when absent. EXECUTE is granted to
  `app_runtime` and `app_readonly`.
- `shared.guard_localized_text_lifecycle() → trigger` is trigger-only and
  enforces localization initial state, transitions, stamps, and immutability.
- `shared.missing_translations(text) → SETOF text` validates the locale against
  `shared.languages` and returns active keys with no approved text for that
  locale. EXECUTE is granted to `app_runtime` and `app_readonly`.

### `shared.search_metadata`

**Scope:** tenant · **Retention class:** operational · Rebuildable generic
search projections. Source entities remain authoritative and later domains own
normalization. Identity includes nullable locale through `UNIQUE NULLS NOT
DISTINCT`; public/internal rows are tenant-readable, while restricted/secret
rows additionally require `iam.sensitive.view`.

| Column              | Type                     | Null | Default           | Classification |
| ------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`         | uuid                     | NO   | —                 | internal       |
| `company_id`        | uuid                     | YES  | —                 | internal       |
| `branch_id`         | uuid                     | YES  | —                 | internal       |
| `entity_type`       | text                     | NO   | —                 | internal       |
| `entity_id`         | uuid                     | NO   | —                 | internal       |
| `field_code`        | text                     | NO   | —                 | internal       |
| `locale_code`       | text                     | YES  | —                 | internal       |
| `normalized_value`  | text                     | NO   | —                 | restricted     |
| `classification`    | text                     | NO   | 'internal'        | internal       |
| `source_updated_at` | timestamp with time zone | NO   | —                 | internal       |
| `record_version`    | integer                  | NO   | 1                 | internal       |
| `created_at`        | timestamp with time zone | NO   | now()             | internal       |
| `created_by`        | uuid                     | NO   | —                 | internal       |
| `updated_at`        | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`        | uuid                     | YES  | —                 | internal       |

`uq_search_metadata_identity` is the locale-inclusive upsert arbiter and covers
the tenant FK. Non-partial company, three-column branch, and locale indexes cover
the other FKs. `ix_search_metadata_normalized_value_trgm` uses
`extensions.gin_trgm_ops`. Identity and creation metadata are immutable. RLS:
`sel_search_metadata_tenant`. Migration `20260718109000`; refs P1-05-DB-016,
P1-05-QA-006.

### `shared.tags`

**Scope:** tenant · **Retention class:** operational · Tenant-only vocabulary;
there is no approved platform tag catalogue, so no nullable-tenant exception is
widened. Live tag codes are unique per tenant and reusable after soft deletion.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `tag_code`       | text                     | NO   | —                 | internal       |
| `name`           | text                     | NO   | —                 | internal       |
| `color`          | text                     | YES  | —                 | internal       |
| `status`         | text                     | NO   | 'active'          | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

`uq_tags_tenant_id` covers the tenant FK and supplies the assignment parent
key; `uq_tags_tenant_code_active` enforces live-code uniqueness. RLS:
`sel_tags_tenant`. Migration `20260718110000`; ref P1-05-DB-017.

### `shared.entity_tags`

**Scope:** tenant · **Retention class:** operational · Soft-deletable generic
tag assignments with tenant-bound tag and assigner FKs. Later domains validate
the format-constrained generic entity identity.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `tag_id`         | uuid                     | NO   | —                 | internal       |
| `entity_type`    | text                     | NO   | —                 | internal       |
| `entity_id`      | uuid                     | NO   | —                 | internal       |
| `assigned_by`    | uuid                     | NO   | —                 | internal       |
| `assigned_at`    | timestamp with time zone | NO   | now()             | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

Non-partial indexes cover tag, assigner, tenant, and entity lookup.
`uq_entity_tags_active` permits one live assignment and re-tagging after soft
deletion. Everything except deletion/update metadata is immutable. RLS:
`sel_entity_tags_tenant`. Migration `20260718110000`; ref P1-05-DB-017.

### `shared.notes`

**Scope:** tenant · **Retention class:** personal-data · Editable generic notes
with optional company/branch scope and tenant-bound authors. Sensitive reads are
classification-gated; runtime/readonly are SELECT-only.

| Column           | Type                     | Null | Default           | Classification |
| ---------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`             | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`      | uuid                     | NO   | —                 | internal       |
| `company_id`     | uuid                     | YES  | —                 | internal       |
| `branch_id`      | uuid                     | YES  | —                 | internal       |
| `entity_type`    | text                     | NO   | —                 | internal       |
| `entity_id`      | uuid                     | NO   | —                 | internal       |
| `author_id`      | uuid                     | NO   | —                 | restricted     |
| `body`           | text                     | NO   | —                 | restricted     |
| `classification` | text                     | NO   | 'internal'        | internal       |
| `visibility`     | text                     | NO   | 'internal'        | internal       |
| `edited_at`      | timestamp with time zone | YES  | —                 | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                 | internal       |
| `record_version` | integer                  | NO   | 1                 | internal       |
| `created_at`     | timestamp with time zone | NO   | now()             | internal       |
| `created_by`     | uuid                     | NO   | —                 | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`     | uuid                     | YES  | —                 | internal       |

Non-partial indexes cover company, three-column branch, author, tenant, and
entity lookup. `shared.stamp_content_edit()` stamps `edited_at` when the editable
restricted `body` changes. RLS: `sel_notes_tenant`. Migration `20260718110000`;
refs P1-05-DB-018, P1-05-QA-007.

### `shared.comments`

**Scope:** tenant · **Retention class:** personal-data · Editable threaded
comments. Parents must be live and share tenant/entity identity. Comments start
active and unstamped, then may transition to hidden. Sensitive reads are
classification-gated; runtime/readonly are SELECT-only.

| Column              | Type                     | Null | Default           | Classification |
| ------------------- | ------------------------ | ---- | ----------------- | -------------- |
| `id`                | uuid                     | NO   | gen_random_uuid() | internal       |
| `tenant_id`         | uuid                     | NO   | —                 | internal       |
| `company_id`        | uuid                     | YES  | —                 | internal       |
| `branch_id`         | uuid                     | YES  | —                 | internal       |
| `entity_type`       | text                     | NO   | —                 | internal       |
| `entity_id`         | uuid                     | NO   | —                 | internal       |
| `parent_comment_id` | uuid                     | YES  | —                 | internal       |
| `author_id`         | uuid                     | NO   | —                 | restricted     |
| `body`              | text                     | NO   | —                 | restricted     |
| `classification`    | text                     | NO   | 'internal'        | internal       |
| `status`            | text                     | NO   | 'active'          | internal       |
| `edited_at`         | timestamp with time zone | YES  | —                 | internal       |
| `deleted_at`        | timestamp with time zone | YES  | —                 | internal       |
| `record_version`    | integer                  | NO   | 1                 | internal       |
| `created_at`        | timestamp with time zone | NO   | now()             | internal       |
| `created_by`        | uuid                     | NO   | —                 | internal       |
| `updated_at`        | timestamp with time zone | YES  | —                 | internal       |
| `updated_by`        | uuid                     | YES  | —                 | internal       |

`uq_comments_tenant_id` covers tenant and supplies the self-FK parent key.
Non-partial indexes cover company, three-column branch, parent, author, and
entity lookup. `shared.guard_comment_parent()` enforces initial state and live
same-entity threading; `shared.stamp_content_edit()` stamps edits to restricted
`body`. RLS: `sel_comments_tenant`. Migration `20260718110000`; refs
P1-05-DB-018, P1-05-QA-007.

Increment K routines are `SECURITY INVOKER`, use empty `search_path`, and revoke
PUBLIC execute: `shared.stamp_content_edit()` is shared by notes/comments;
`shared.guard_comment_parent()` enforces comment initial state and parent scope.

## Phase 1-6 — CRM and Business Partner schema (generated from the live catalog, 2026-07-19)

All 21 `crm` tables and their 298 columns. "Class" is the personal-data classification from the enforced registry ([`crm-personal-data-classification.json`](./crm-personal-data-classification.json), CI-checked by `npm run validate:crm-classification`); **restricted** columns are sensitive-view gated and never searchable. RLS is `FORCE`d on every table. Migrations `20260719090000`–`20260719106000`.

### `crm.addresses`

Postal/physical addresses; one active primary per type.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `partner_id`     | uuid                     | NO   | —                   | internal |
| `address_type`   | text                     | NO   | —                   | internal |
| `line1`          | text                     | NO   | —                   | internal |
| `line2`          | text                     | YES  | —                   | internal |
| `line3`          | text                     | YES  | —                   | internal |
| `city`           | text                     | YES  | —                   | internal |
| `region`         | text                     | YES  | —                   | internal |
| `postal_code`    | text                     | YES  | —                   | internal |
| `country_code`   | text                     | YES  | —                   | internal |
| `is_primary`     | boolean                  | NO   | `false`             | internal |
| `status`         | text                     | NO   | `'active'::text`    | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |
| `deleted_at`     | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`     | uuid                     | YES  | —                   | internal |

### `crm.business_partners`

Party master — one row per customer/individual/company; carries the display number, party_type discriminator, lifecycle_status, and merge redirect.

| Column              | Type                     | Null | Default             | Class    |
| ------------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`                | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`         | uuid                     | NO   | —                   | internal |
| `party_type`        | text                     | NO   | —                   | internal |
| `display_name`      | text                     | NO   | —                   | internal |
| `display_number`    | text                     | YES  | —                   | internal |
| `lifecycle_status`  | text                     | NO   | `'prospect'::text`  | internal |
| `commercial_status` | text                     | NO   | `'normal'::text`    | internal |
| `merged_into_id`    | uuid                     | YES  | —                   | internal |
| `record_version`    | integer                  | NO   | `1`                 | internal |
| `created_at`        | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`        | uuid                     | NO   | —                   | internal |
| `updated_at`        | timestamp with time zone | YES  | —                   | internal |
| `updated_by`        | uuid                     | YES  | —                   | internal |
| `deleted_at`        | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`        | uuid                     | YES  | —                   | internal |

### `crm.communication_log`

Record of communications sent/received about a partner.

| Column                | Type                     | Null | Default             | Class    |
| --------------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`                  | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`           | uuid                     | NO   | —                   | internal |
| `partner_id`          | uuid                     | NO   | —                   | internal |
| `direction`           | text                     | NO   | —                   | internal |
| `channel`             | text                     | NO   | —                   | internal |
| `subject`             | text                     | YES  | —                   | internal |
| `summary`             | text                     | YES  | —                   | internal |
| `outbound_message_id` | uuid                     | YES  | —                   | internal |
| `related_entity_type` | text                     | YES  | —                   | internal |
| `related_entity_id`   | uuid                     | YES  | —                   | internal |
| `logged_by`           | uuid                     | NO   | —                   | internal |
| `occurred_at`         | timestamp with time zone | NO   | `now()`             | internal |
| `record_version`      | integer                  | NO   | `1`                 | internal |
| `created_at`          | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`          | uuid                     | NO   | —                   | internal |
| `updated_at`          | timestamp with time zone | YES  | —                   | internal |
| `updated_by`          | uuid                     | YES  | —                   | internal |

### `crm.communication_preferences`

Per-partner channel/purpose preferences and preferred locale.

| Column             | Type                     | Null | Default             | Class    |
| ------------------ | ------------------------ | ---- | ------------------- | -------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`        | uuid                     | NO   | —                   | internal |
| `partner_id`       | uuid                     | NO   | —                   | internal |
| `channel`          | text                     | NO   | —                   | internal |
| `purpose`          | text                     | NO   | —                   | internal |
| `preferred`        | boolean                  | NO   | —                   | internal |
| `preferred_locale` | text                     | YES  | —                   | internal |
| `quiet_hours_note` | text                     | YES  | —                   | internal |
| `record_version`   | integer                  | NO   | `1`                 | internal |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`       | uuid                     | NO   | —                   | internal |
| `updated_at`       | timestamp with time zone | YES  | —                   | internal |
| `updated_by`       | uuid                     | YES  | —                   | internal |

### `crm.company_profiles`

Per-partner profile for party_type=company; registration_ref/tax_ref restricted.

| Column                  | Type                     | Null | Default                | Class          |
| ----------------------- | ------------------------ | ---- | ---------------------- | -------------- |
| `id`                    | uuid                     | NO   | `gen_random_uuid()`    | internal       |
| `tenant_id`             | uuid                     | NO   | —                      | internal       |
| `partner_id`            | uuid                     | NO   | —                      | internal       |
| `party_type`            | text                     | NO   | `'organization'::text` | internal       |
| `legal_name`            | text                     | NO   | —                      | internal       |
| `trade_name`            | text                     | YES  | —                      | internal       |
| `legal_name_normalized` | text                     | YES  | —                      | internal       |
| `trade_name_normalized` | text                     | YES  | —                      | internal       |
| `registration_ref`      | uuid                     | YES  | —                      | **restricted** |
| `tax_ref`               | uuid                     | YES  | —                      | **restricted** |
| `record_version`        | integer                  | NO   | `1`                    | internal       |
| `created_at`            | timestamp with time zone | NO   | `now()`                | internal       |
| `created_by`            | uuid                     | NO   | —                      | internal       |
| `updated_at`            | timestamp with time zone | YES  | —                      | internal       |
| `updated_by`            | uuid                     | YES  | —                      | internal       |

### `crm.consent_history`

Append-only consent ledger; current_consent() resolves the latest effective row by seq.

| Column                 | Type                     | Null | Default             | Class    |
| ---------------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`                   | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`            | uuid                     | NO   | —                   | internal |
| `partner_id`           | uuid                     | NO   | —                   | internal |
| `consent_kind`         | text                     | NO   | —                   | internal |
| `contact_point_id`     | uuid                     | YES  | —                   | internal |
| `channel`              | text                     | NO   | —                   | internal |
| `purpose`              | text                     | NO   | —                   | internal |
| `status`               | text                     | NO   | —                   | internal |
| `source`               | text                     | YES  | —                   | internal |
| `evidence_document_id` | uuid                     | YES  | —                   | internal |
| `effective_at`         | timestamp with time zone | NO   | —                   | internal |
| `recorded_by`          | uuid                     | NO   | —                   | internal |
| `correlation_id`       | uuid                     | YES  | —                   | internal |
| `created_at`           | timestamp with time zone | NO   | `now()`             | internal |
| `seq`                  | bigint                   | NO   | —                   | internal |

### `crm.contact_points`

Communication endpoints with normalized value; one active primary per channel.

| Column             | Type                     | Null | Default             | Class    |
| ------------------ | ------------------------ | ---- | ------------------- | -------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`        | uuid                     | NO   | —                   | internal |
| `partner_id`       | uuid                     | NO   | —                   | internal |
| `channel`          | text                     | NO   | —                   | internal |
| `normalized_value` | text                     | NO   | —                   | internal |
| `raw_value`        | text                     | YES  | —                   | internal |
| `label`            | text                     | YES  | —                   | internal |
| `is_primary`       | boolean                  | NO   | `false`             | internal |
| `verified_at`      | timestamp with time zone | YES  | —                   | internal |
| `status`           | text                     | NO   | `'active'::text`    | internal |
| `record_version`   | integer                  | NO   | `1`                 | internal |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`       | uuid                     | NO   | —                   | internal |
| `updated_at`       | timestamp with time zone | YES  | —                   | internal |
| `updated_by`       | uuid                     | YES  | —                   | internal |
| `deleted_at`       | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`       | uuid                     | YES  | —                   | internal |

### `crm.customer_alerts`

Operational alerts/flags on a partner (kind, severity, status).

| Column            | Type                     | Null | Default             | Class    |
| ----------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`              | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`       | uuid                     | NO   | —                   | internal |
| `partner_id`      | uuid                     | NO   | —                   | internal |
| `alert_type`      | text                     | NO   | —                   | internal |
| `severity`        | text                     | NO   | —                   | internal |
| `message`         | text                     | NO   | —                   | internal |
| `active`          | boolean                  | NO   | `true`              | internal |
| `effective_from`  | date                     | NO   | —                   | internal |
| `effective_to`    | date                     | YES  | —                   | internal |
| `acknowledged_by` | uuid                     | YES  | —                   | internal |
| `acknowledged_at` | timestamp with time zone | YES  | —                   | internal |
| `record_version`  | integer                  | NO   | `1`                 | internal |
| `created_at`      | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`      | uuid                     | NO   | —                   | internal |
| `updated_at`      | timestamp with time zone | YES  | —                   | internal |
| `updated_by`      | uuid                     | YES  | —                   | internal |

### `crm.customer_block_history`

Append-only block/unblock ledger backing lifecycle coherence; monotonic seq order.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `partner_id`     | uuid                     | NO   | —                   | internal |
| `action`         | text                     | NO   | —                   | internal |
| `reason`         | text                     | NO   | —                   | internal |
| `restriction_id` | uuid                     | YES  | —                   | internal |
| `approval_ref`   | text                     | YES  | —                   | internal |
| `actor_id`       | uuid                     | NO   | —                   | internal |
| `occurred_at`    | timestamp with time zone | NO   | `now()`             | internal |
| `correlation_id` | uuid                     | YES  | —                   | internal |
| `seq`            | bigint                   | NO   | —                   | internal |

### `crm.customer_credit_profiles`

Per-partner credit terms (limit, currency, terms); one profile per partner.

| Column               | Type                     | Null | Default             | Class    |
| -------------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`                 | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`          | uuid                     | NO   | —                   | internal |
| `partner_id`         | uuid                     | NO   | —                   | internal |
| `credit_limit`       | numeric                  | YES  | —                   | internal |
| `currency_code`      | text                     | YES  | —                   | internal |
| `risk_note`          | text                     | YES  | —                   | internal |
| `payment_terms_code` | text                     | YES  | —                   | internal |
| `status`             | text                     | NO   | `'none'::text`      | internal |
| `approved_by`        | uuid                     | YES  | —                   | internal |
| `approval_ref`       | text                     | YES  | —                   | internal |
| `record_version`     | integer                  | NO   | `1`                 | internal |
| `created_at`         | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`         | uuid                     | NO   | —                   | internal |
| `updated_at`         | timestamp with time zone | YES  | —                   | internal |
| `updated_by`         | uuid                     | YES  | —                   | internal |

### `crm.customer_restrictions`

Restriction/hold records with reason and scope; referenced by block history.

| Column             | Type                     | Null | Default             | Class    |
| ------------------ | ------------------------ | ---- | ------------------- | -------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`        | uuid                     | NO   | —                   | internal |
| `partner_id`       | uuid                     | NO   | —                   | internal |
| `restriction_type` | text                     | NO   | —                   | internal |
| `reason`           | text                     | NO   | —                   | internal |
| `imposed_by`       | uuid                     | NO   | —                   | internal |
| `effective_from`   | date                     | NO   | —                   | internal |
| `effective_to`     | date                     | YES  | —                   | internal |
| `approval_ref`     | text                     | YES  | —                   | internal |
| `record_version`   | integer                  | NO   | `1`                 | internal |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`       | uuid                     | NO   | —                   | internal |
| `updated_at`       | timestamp with time zone | YES  | —                   | internal |
| `updated_by`       | uuid                     | YES  | —                   | internal |

### `crm.customer_segments`

Tenant-defined segment catalog (structural configuration, not business data).

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `segment_code`   | text                     | NO   | —                   | internal |
| `name`           | text                     | NO   | —                   | internal |
| `criteria_note`  | text                     | YES  | —                   | internal |
| `status`         | text                     | NO   | `'active'::text`    | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |
| `deleted_at`     | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`     | uuid                     | YES  | —                   | internal |

### `crm.duplicate_candidates`

Suspected duplicate partner pairs with match_score and raw-value-free match_basis.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `partner_id_a`   | uuid                     | NO   | —                   | internal |
| `partner_id_b`   | uuid                     | NO   | —                   | internal |
| `match_score`    | numeric                  | NO   | —                   | internal |
| `match_basis`    | jsonb                    | NO   | `'[]'::jsonb`       | internal |
| `status`         | text                     | NO   | `'open'::text`      | internal |
| `detected_at`    | timestamp with time zone | NO   | `now()`             | internal |
| `reviewed_by`    | uuid                     | YES  | —                   | internal |
| `reviewed_at`    | timestamp with time zone | YES  | —                   | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |

### `crm.individual_profiles`

Per-partner profile for party_type=individual; national_id_ref restricted, DOB via sensitive attributes.

| Column                   | Type                     | Null | Default              | Class          |
| ------------------------ | ------------------------ | ---- | -------------------- | -------------- |
| `id`                     | uuid                     | NO   | `gen_random_uuid()`  | internal       |
| `tenant_id`              | uuid                     | NO   | —                    | internal       |
| `partner_id`             | uuid                     | NO   | —                    | internal       |
| `party_type`             | text                     | NO   | `'individual'::text` | internal       |
| `given_name`             | text                     | NO   | —                    | internal       |
| `family_name`            | text                     | NO   | —                    | internal       |
| `given_name_normalized`  | text                     | YES  | —                    | internal       |
| `family_name_normalized` | text                     | YES  | —                    | internal       |
| `national_id_ref`        | uuid                     | YES  | —                    | **restricted** |
| `preferred_locale`       | text                     | YES  | —                    | internal       |
| `record_version`         | integer                  | NO   | `1`                  | internal       |
| `created_at`             | timestamp with time zone | NO   | `now()`              | internal       |
| `created_by`             | uuid                     | NO   | —                    | internal       |
| `updated_at`             | timestamp with time zone | YES  | —                    | internal       |
| `updated_by`             | uuid                     | YES  | —                    | internal       |

### `crm.partner_identifiers`

Typed government/registration/tax identifiers; raw/normalized restricted values are sensitive-view gated.

| Column             | Type                     | Null | Default             | Class          |
| ------------------ | ------------------------ | ---- | ------------------- | -------------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal       |
| `tenant_id`        | uuid                     | NO   | —                   | internal       |
| `partner_id`       | uuid                     | NO   | —                   | internal       |
| `identifier_type`  | text                     | NO   | —                   | internal       |
| `normalized_value` | text                     | NO   | —                   | **restricted** |
| `raw_value`        | text                     | YES  | —                   | **restricted** |
| `classification`   | text                     | NO   | `'internal'::text`  | internal       |
| `is_primary`       | boolean                  | NO   | `false`             | internal       |
| `verified_at`      | timestamp with time zone | YES  | —                   | internal       |
| `record_version`   | integer                  | NO   | `1`                 | internal       |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal       |
| `created_by`       | uuid                     | NO   | —                   | internal       |
| `updated_at`       | timestamp with time zone | YES  | —                   | internal       |
| `updated_by`       | uuid                     | YES  | —                   | internal       |
| `deleted_at`       | timestamp with time zone | YES  | —                   | internal       |
| `deleted_by`       | uuid                     | YES  | —                   | internal       |

### `crm.partner_merges`

Immutable merge records (source → survivor) with counts-only merge_summary.

| Column                | Type                     | Null | Default             | Class    |
| --------------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`                  | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`           | uuid                     | NO   | —                   | internal |
| `source_partner_id`   | uuid                     | NO   | —                   | internal |
| `survivor_partner_id` | uuid                     | NO   | —                   | internal |
| `merge_summary`       | jsonb                    | NO   | `'{}'::jsonb`       | internal |
| `preview_ref`         | text                     | YES  | —                   | internal |
| `approval_ref`        | text                     | NO   | —                   | internal |
| `merged_by`           | uuid                     | NO   | —                   | internal |
| `merged_at`           | timestamp with time zone | NO   | `now()`             | internal |
| `correlation_id`      | uuid                     | YES  | —                   | internal |

### `crm.partner_roles`

Dated business roles a partner plays; a btree_gist EXCLUDE forbids overlapping same-role intervals.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `partner_id`     | uuid                     | NO   | —                   | internal |
| `role_type`      | text                     | NO   | —                   | internal |
| `valid_from`     | date                     | NO   | —                   | internal |
| `valid_to`       | date                     | YES  | —                   | internal |
| `source`         | text                     | YES  | —                   | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |

### `crm.partner_segment_assignments`

Dated membership of a partner in a segment.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `partner_id`     | uuid                     | NO   | —                   | internal |
| `segment_id`     | uuid                     | NO   | —                   | internal |
| `assigned_by`    | uuid                     | NO   | —                   | internal |
| `assigned_at`    | timestamp with time zone | NO   | `now()`             | internal |
| `valid_from`     | date                     | NO   | —                   | internal |
| `valid_to`       | date                     | YES  | —                   | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |

### `crm.partner_sensitive_attributes`

Declarative sensitive key/value attributes (value_text/value_date restricted); every read sensitive-view gated.

| Column           | Type                     | Null | Default              | Class          |
| ---------------- | ------------------------ | ---- | -------------------- | -------------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()`  | internal       |
| `tenant_id`      | uuid                     | NO   | —                    | internal       |
| `partner_id`     | uuid                     | NO   | —                    | internal       |
| `attribute_type` | text                     | NO   | —                    | internal       |
| `value_date`     | date                     | YES  | —                    | **restricted** |
| `value_text`     | text                     | YES  | —                    | **restricted** |
| `classification` | text                     | NO   | `'restricted'::text` | internal       |
| `record_version` | integer                  | NO   | `1`                  | internal       |
| `created_at`     | timestamp with time zone | NO   | `now()`              | internal       |
| `created_by`     | uuid                     | NO   | —                    | internal       |
| `updated_at`     | timestamp with time zone | YES  | —                    | internal       |
| `updated_by`     | uuid                     | YES  | —                    | internal       |
| `deleted_at`     | timestamp with time zone | YES  | —                    | internal       |
| `deleted_by`     | uuid                     | YES  | —                    | internal       |

### `crm.partner_status_history`

Append-only lifecycle/commercial status history; server-stamped; monotonic seq for same-tx order.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `partner_id`     | uuid                     | NO   | —                   | internal |
| `status_kind`    | text                     | NO   | —                   | internal |
| `from_state`     | text                     | YES  | —                   | internal |
| `to_state`       | text                     | NO   | —                   | internal |
| `reason`         | text                     | NO   | —                   | internal |
| `actor_id`       | uuid                     | NO   | —                   | internal |
| `occurred_at`    | timestamp with time zone | NO   | `now()`             | internal |
| `correlation_id` | uuid                     | YES  | —                   | internal |
| `seq`            | bigint                   | NO   | —                   | internal |

### `crm.timeline_events`

Append-only partner activity timeline; written only through emit_timeline_event; attribution server-stamped.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`      | uuid                     | NO   | —                   | internal |
| `partner_id`     | uuid                     | NO   | —                   | internal |
| `event_type`     | text                     | NO   | —                   | internal |
| `event_ref_type` | text                     | YES  | —                   | internal |
| `event_ref_id`   | uuid                     | YES  | —                   | internal |
| `title`          | text                     | NO   | —                   | internal |
| `occurred_at`    | timestamp with time zone | NO   | `now()`             | internal |
| `actor_id`       | uuid                     | YES  | —                   | internal |
| `correlation_id` | uuid                     | YES  | —                   | internal |
| `seq`            | bigint                   | NO   | —                   | internal |

## Phase 1-7 — Vehicle schema (generated from the live catalog, 2026-07-20)

The `veh` schema is the independent Vehicle master and its identity, mechanical,
ownership, relationship, and lifecycle history. This section grows one increment
at a time; classification follows the Phase 1-7 registry
(`docs/database/veh-personal-data-classification.json`).

### `veh.makes`

Dual-scope vehicle make catalog (P1-07-DB-006): platform default (`scope`=platform, `tenant_id` NULL) or tenant extension.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `scope`          | text                     | NO   | —                   | internal |
| `tenant_id`      | uuid                     | YES  | —                   | internal |
| `code`           | text                     | NO   | —                   | internal |
| `name`           | text                     | NO   | —                   | internal |
| `status`         | text                     | NO   | `'active'::text`    | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |
| `deleted_at`     | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`     | uuid                     | YES  | —                   | internal |

### `veh.models`

Dual-scope vehicle model catalog (P1-07-DB-006), child of `veh.makes`. `model_year` is a vehicle attribute, not a catalog.

| Column             | Type                     | Null | Default             | Class    |
| ------------------ | ------------------------ | ---- | ------------------- | -------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal |
| `scope`            | text                     | NO   | —                   | internal |
| `tenant_id`        | uuid                     | YES  | —                   | internal |
| `make_id`          | uuid                     | NO   | —                   | internal |
| `code`             | text                     | NO   | —                   | internal |
| `name`             | text                     | NO   | —                   | internal |
| `first_model_year` | integer                  | YES  | —                   | internal |
| `last_model_year`  | integer                  | YES  | —                   | internal |
| `status`           | text                     | NO   | `'active'::text`    | internal |
| `record_version`   | integer                  | NO   | `1`                 | internal |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`       | uuid                     | NO   | —                   | internal |
| `updated_at`       | timestamp with time zone | YES  | —                   | internal |
| `updated_by`       | uuid                     | YES  | —                   | internal |
| `deleted_at`       | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`       | uuid                     | YES  | —                   | internal |

### `veh.trims`

Dual-scope vehicle trim catalog (P1-07-DB-006), child of `veh.models`.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `scope`          | text                     | NO   | —                   | internal |
| `tenant_id`      | uuid                     | YES  | —                   | internal |
| `model_id`       | uuid                     | NO   | —                   | internal |
| `code`           | text                     | NO   | —                   | internal |
| `name`           | text                     | NO   | —                   | internal |
| `status`         | text                     | NO   | `'active'::text`    | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |
| `deleted_at`     | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`     | uuid                     | YES  | —                   | internal |

### `veh.body_types`

Dual-scope vehicle body-type catalog (P1-07-DB-006).

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `scope`          | text                     | NO   | —                   | internal |
| `tenant_id`      | uuid                     | YES  | —                   | internal |
| `code`           | text                     | NO   | —                   | internal |
| `name`           | text                     | NO   | —                   | internal |
| `status`         | text                     | NO   | `'active'::text`    | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |
| `deleted_at`     | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`     | uuid                     | YES  | —                   | internal |

### `veh.powertrain_types`

Dual-scope powertrain-type catalog (P1-07-DB-006); `category` (ice/ev/hybrid/phev/other) is descriptive — the authoritative EV driver is `veh.vehicles.powertrain_category`.

| Column           | Type                     | Null | Default             | Class    |
| ---------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal |
| `scope`          | text                     | NO   | —                   | internal |
| `tenant_id`      | uuid                     | YES  | —                   | internal |
| `code`           | text                     | NO   | —                   | internal |
| `name`           | text                     | NO   | —                   | internal |
| `category`       | text                     | NO   | —                   | internal |
| `status`         | text                     | NO   | `'active'::text`    | internal |
| `record_version` | integer                  | NO   | `1`                 | internal |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`     | uuid                     | NO   | —                   | internal |
| `updated_at`     | timestamp with time zone | YES  | —                   | internal |
| `updated_by`     | uuid                     | YES  | —                   | internal |
| `deleted_at`     | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`     | uuid                     | YES  | —                   | internal |

### `veh.vehicles`

The independent Vehicle master (P1-07-DB-001). No partner/owner column; ownership is temporal. `vin_normalized` is generated from `veh.normalize_vin(vin_raw)`.

| Column                | Type                     | Null | Default             | Class    |
| --------------------- | ------------------------ | ---- | ------------------- | -------- |
| `id`                  | uuid                     | NO   | `gen_random_uuid()` | internal |
| `tenant_id`           | uuid                     | NO   | —                   | internal |
| `display_number`      | text                     | YES  | —                   | internal |
| `vin_raw`             | text                     | YES  | —                   | internal |
| `vin_normalized`      | text                     | YES  | generated           | internal |
| `make_id`             | uuid                     | YES  | —                   | internal |
| `model_id`            | uuid                     | YES  | —                   | internal |
| `trim_id`             | uuid                     | YES  | —                   | internal |
| `model_year`          | integer                  | YES  | —                   | internal |
| `body_type_id`        | uuid                     | YES  | —                   | internal |
| `powertrain_type_id`  | uuid                     | YES  | —                   | internal |
| `powertrain_category` | text                     | NO   | `'ice'::text`       | internal |
| `color`               | text                     | YES  | —                   | internal |
| `lifecycle_status`    | text                     | NO   | `'draft'::text`     | internal |
| `workshop_status`     | text                     | NO   | `'none'::text`      | internal |
| `merged_into_id`      | uuid                     | YES  | —                   | internal |
| `record_version`      | integer                  | NO   | `1`                 | internal |
| `created_at`          | timestamp with time zone | NO   | `now()`             | internal |
| `created_by`          | uuid                     | NO   | —                   | internal |
| `updated_at`          | timestamp with time zone | YES  | —                   | internal |
| `updated_by`          | uuid                     | YES  | —                   | internal |
| `deleted_at`          | timestamp with time zone | YES  | —                   | internal |
| `deleted_by`          | uuid                     | YES  | —                   | internal |

### `veh.vehicle_identifiers`

Typed identifier ledger (P1-07-DB-003); chassis/engine_no are `restricted` and row-gated. Alternate identifiers satisfy the missing-VIN activation contract.

| Column             | Type                     | Null | Default             | Class               |
| ------------------ | ------------------------ | ---- | ------------------- | ------------------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal            |
| `tenant_id`        | uuid                     | NO   | —                   | internal            |
| `vehicle_id`       | uuid                     | NO   | —                   | internal            |
| `identifier_type`  | text                     | NO   | —                   | internal            |
| `raw_value`        | text                     | NO   | —                   | internal            |
| `normalized_value` | text                     | NO   | —                   | internal            |
| `is_primary`       | boolean                  | NO   | `false`             | internal            |
| `status`           | text                     | NO   | `'active'::text`    | internal            |
| `classification`   | text                     | NO   | —                   | internal/restricted |
| `verified_at`      | timestamp with time zone | YES  | —                   | internal            |
| `record_version`   | integer                  | NO   | `1`                 | internal            |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal            |
| `created_by`       | uuid                     | NO   | —                   | internal            |
| `updated_at`       | timestamp with time zone | YES  | —                   | internal            |
| `updated_by`       | uuid                     | YES  | —                   | internal            |
| `deleted_at`       | timestamp with time zone | YES  | —                   | internal            |
| `deleted_by`       | uuid                     | YES  | —                   | internal            |
