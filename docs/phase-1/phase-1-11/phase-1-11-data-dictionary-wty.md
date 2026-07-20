# Phase 1-11 — Data Dictionary (`wty`)

Column-level dictionary for the 5 `wty` tables (warranty policies, effective-dated coverage, records, record items, status history). All columns are `internal`; eligibility uses coverage effective at the service/delivery date (BR-WTY-001). Every FK is `ON DELETE RESTRICT`.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo
Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review. Generated from live introspection; classification from
`docs/database/sal-wty-rpt-personal-data-classification.json`. `class` is the column
classification (`internal`/`restricted`); **restricted** columns are physically isolated
in RLS-gated tables and are never searchable.

## `wty.warranty_coverage`

Effective-dated warranty coverage (BR-WTY-001).

| Column            | Type          | class    | Null? | Purpose                                                                                |
| ----------------- | ------------- | -------- | ----- | -------------------------------------------------------------------------------------- |
| `id`              | `uuid`        | internal | no    | Primary key (UUID).                                                                    |
| `tenant_id`       | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                        |
| `company_id`      | `uuid`        | internal | no    | Company scope (branch composite scope).                                                |
| `policy_id`       | `uuid`        | internal | no    | Composite FK -> `wty.warranty_policies(tenant_id, company_id, id)` RESTRICT.           |
| `covered_scope`   | `text`        | internal | no    | CHECK IN ('all','service','part').                                                     |
| `duration_months` | `integer`     | internal | no    | Coverage duration (months, >0).                                                        |
| `odometer_limit`  | `integer`     | internal | yes   | Optional odometer ceiling (>0).                                                        |
| `effective_from`  | `date`        | internal | no    | Coverage effective-from date; gist EXCLUDE no-overlap on active coverage (BR-WTY-001). |
| `effective_to`    | `date`        | internal | yes   | Coverage effective-to (NULL = open); CHECK `> effective_from`.                         |
| `status`          | `text`        | internal | no    | CHECK IN ('active','archived').                                                        |
| `record_version`  | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                 |
| `created_at`      | `timestamptz` | internal | no    | Row creation timestamp.                                                                |
| `created_by`      | `uuid`        | internal | no    | Creating actor (user id).                                                              |
| `updated_at`      | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                       |
| `updated_by`      | `uuid`        | internal | yes   | Last-updating actor.                                                                   |
| `deleted_at`      | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                   |
| `deleted_by`      | `uuid`        | internal | yes   | Soft-deleting actor.                                                                   |

## `wty.warranty_policies`

Warranty policy (tenant/company-scoped).

| Column           | Type          | class    | Null? | Purpose                                                                |
| ---------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------- |
| `id`             | `uuid`        | internal | no    | Primary key (UUID).                                                    |
| `tenant_id`      | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                        |
| `company_id`     | `uuid`        | internal | no    | Company scope; composite FK to `org.legal_companies`.                  |
| `policy_code`    | `text`        | internal | no    | Policy code; `UNIQUE(tenant_id, company_id, policy_code)`.             |
| `name`           | `text`        | internal | no    | Human-readable name.                                                   |
| `status`         | `text`        | internal | no    | CHECK IN ('active','archived').                                        |
| `record_version` | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`. |
| `created_at`     | `timestamptz` | internal | no    | Row creation timestamp.                                                |
| `created_by`     | `uuid`        | internal | no    | Creating actor (user id).                                              |
| `updated_at`     | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                       |
| `updated_by`     | `uuid`        | internal | yes   | Last-updating actor.                                                   |
| `deleted_at`     | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                   |
| `deleted_by`     | `uuid`        | internal | yes   | Soft-deleting actor.                                                   |

## `wty.warranty_record_items`

Covered job/part on a warranty record (FR-WTY-002).

| Column               | Type          | class    | Null? | Purpose                                                                |
| -------------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------- |
| `id`                 | `uuid`        | internal | no    | Primary key (UUID).                                                    |
| `tenant_id`          | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                        |
| `company_id`         | `uuid`        | internal | no    | Company scope (branch composite scope).                                |
| `branch_id`          | `uuid`        | internal | no    | Branch scope (branch composite scope).                                 |
| `warranty_record_id` | `uuid`        | internal | no    | Composite FK -> `wty.warranty_records(...)` RESTRICT.                  |
| `item_kind`          | `text`        | internal | no    | CHECK IN ('service','part').                                           |
| `source_job_id`      | `uuid`        | internal | yes   | Opaque source work-job link (FR-WTY-002, nullable).                    |
| `source_part_id`     | `uuid`        | internal | yes   | Opaque source part link (FR-WTY-002, nullable).                        |
| `description`        | `text`        | internal | no    | Covered item description.                                              |
| `record_version`     | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`. |
| `created_at`         | `timestamptz` | internal | no    | Row creation timestamp.                                                |
| `created_by`         | `uuid`        | internal | no    | Creating actor (user id).                                              |
| `updated_at`         | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                       |
| `updated_by`         | `uuid`        | internal | yes   | Last-updating actor.                                                   |
| `deleted_at`         | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                   |
| `deleted_by`         | `uuid`        | internal | yes   | Soft-deleting actor.                                                   |

## `wty.warranty_records`

Warranty record (branch-scoped); immutable after issue.

| Column               | Type          | class    | Null? | Purpose                                                                                                                                               |
| -------------------- | ------------- | -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`        | internal | no    | Primary key (UUID).                                                                                                                                   |
| `tenant_id`          | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                                                                       |
| `company_id`         | `uuid`        | internal | no    | Company scope (branch composite scope).                                                                                                               |
| `branch_id`          | `uuid`        | internal | no    | Branch scope (branch composite scope).                                                                                                                |
| `vehicle_id`         | `uuid`        | internal | no    | Composite FK -> `veh.vehicles(tenant_id, id)` RESTRICT.                                                                                               |
| `work_order_id`      | `uuid`        | internal | no    | Composite FK -> `wo.work_orders(...)` RESTRICT.                                                                                                       |
| `delivery_record_id` | `uuid`        | internal | no    | Composite FK -> `sal.delivery_records(...)` RESTRICT (binds odometer/start_date, M-wty-2).                                                            |
| `policy_id`          | `uuid`        | internal | no    | Composite FK -> `wty.warranty_policies(...)` RESTRICT.                                                                                                |
| `coverage_id`        | `uuid`        | internal | no    | Composite FK -> `wty.warranty_coverage(tenant_id, company_id, id)` RESTRICT; no overlapping live record per vehicle+coverage (gist EXCLUDE, M-wty-1). |
| `start_date`         | `date`        | internal | no    | Coverage start; bound to `delivery.delivered_at` (M-wty-2).                                                                                           |
| `expiry_date`        | `date`        | internal | no    | Coverage expiry; CHECK `> start_date`.                                                                                                                |
| `odometer_at_issue`  | `integer`     | internal | no    | Odometer at issue (>=0); bound to `delivery.final_odometer_reading_id`.                                                                               |
| `odometer_limit`     | `integer`     | internal | yes   | Optional odometer ceiling (>= odometer_at_issue).                                                                                                     |
| `status`             | `text`        | internal | no    | Lifecycle (issued/active/expired/voided/claimed_against); immutable after issue (freeze guard).                                                       |
| `idempotency_key`    | `text`        | internal | yes   | Business idempotency key; partial `UNIQUE(tenant_id, idempotency_key)` (BR-SAL-001).                                                                  |
| `record_version`     | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                                                                |
| `created_at`         | `timestamptz` | internal | no    | Row creation timestamp.                                                                                                                               |
| `created_by`         | `uuid`        | internal | no    | Creating actor (user id).                                                                                                                             |
| `updated_at`         | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                                                                      |
| `updated_by`         | `uuid`        | internal | yes   | Last-updating actor.                                                                                                                                  |
| `deleted_at`         | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                                                                                  |
| `deleted_by`         | `uuid`        | internal | yes   | Soft-deleting actor.                                                                                                                                  |

## `wty.warranty_status_history`

Append-only warranty status ledger (SELECT+INSERT).

| Column               | Type          | class    | Null? | Purpose                                                                            |
| -------------------- | ------------- | -------- | ----- | ---------------------------------------------------------------------------------- |
| `id`                 | `uuid`        | internal | no    | Primary key (UUID).                                                                |
| `tenant_id`          | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                    |
| `company_id`         | `uuid`        | internal | no    | Company scope (branch composite scope).                                            |
| `branch_id`          | `uuid`        | internal | no    | Branch scope (branch composite scope).                                             |
| `warranty_record_id` | `uuid`        | internal | no    | Composite FK -> `wty.warranty_records(...)` RESTRICT.                              |
| `from_status`        | `text`        | internal | yes   | Prior status (NULL on first row).                                                  |
| `to_status`          | `text`        | internal | no    | New status recorded by this ledger row.                                            |
| `reason`             | `text`        | internal | yes   | Free-text reason.                                                                  |
| `correlation_id`     | `uuid`        | internal | yes   | Optional correlation id linking the row to its originating command.                |
| `actor_id`           | `uuid`        | internal | no    | Server-stamped acting user (`stamp_status_history`).                               |
| `occurred_at`        | `timestamptz` | internal | no    | Server-stamped event time (`stamp_status_history`).                                |
| `seq`                | `bigint`      | internal | no    | Monotonic `bigint GENERATED ALWAYS AS IDENTITY` ordering key (append-only ledger). |
