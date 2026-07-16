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
