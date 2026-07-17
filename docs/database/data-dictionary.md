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

| Role           | Kind                | Attributes (verified 2026-07-16)                        | Introduced |
| -------------- | ------------------- | ------------------------------------------------------- | ---------- |
| `app_runtime`  | runtime archetype   | NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB | 0002       |
| `app_readonly` | read-only archetype | NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB | 0002       |

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
