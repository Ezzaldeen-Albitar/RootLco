# Phase 1-11 — Data Dictionary (`rpt`)

Column-level dictionary for the 3 `rpt` tables (report configurations, configuration versions, user-owned saved filters). All columns are `internal`; saved filters are owner-only by RLS (BR-RPT-001). Every FK is `ON DELETE RESTRICT`.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo
Developer Review Policy and the Standing Technical Authorization Policy — not an
independent third-party review. Generated from live introspection; classification from
`docs/database/sal-wty-rpt-personal-data-classification.json`. `class` is the column
classification (`internal`/`restricted`); **restricted** columns are physically isolated
in RLS-gated tables and are never searchable.

## `rpt.report_configuration_versions`

Report configuration version (monotonic; published immutable).

| Column                    | Type          | class    | Null? | Purpose                                                                                                 |
| ------------------------- | ------------- | -------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `id`                      | `uuid`        | internal | no    | Primary key (UUID).                                                                                     |
| `tenant_id`               | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                         |
| `report_configuration_id` | `uuid`        | internal | no    | Composite FK -> `rpt.report_configurations(tenant_id, id)` RESTRICT.                                    |
| `version_number`          | `integer`     | internal | no    | Monotonic version (>=1); `UNIQUE(tenant_id, report_configuration_id, version_number)`.                  |
| `parameter_schema`        | `jsonb`       | internal | no    | Report parameter schema (jsonb).                                                                        |
| `status`                  | `text`        | internal | no    | CHECK IN ('draft','published'); one published version per config (partial unique); published is frozen. |
| `published_at`            | `timestamptz` | internal | yes   | Publish timestamp (NULL until published).                                                               |
| `record_version`          | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                  |
| `created_at`              | `timestamptz` | internal | no    | Row creation timestamp.                                                                                 |
| `created_by`              | `uuid`        | internal | no    | Creating actor (user id).                                                                               |
| `updated_at`              | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                        |
| `updated_by`              | `uuid`        | internal | yes   | Last-updating actor.                                                                                    |
| `deleted_at`              | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                                    |
| `deleted_by`              | `uuid`        | internal | yes   | Soft-deleting actor.                                                                                    |

## `rpt.report_configurations`

Report configuration (tenant-scoped, versioned).

| Column                   | Type          | class    | Null? | Purpose                                                                                         |
| ------------------------ | ------------- | -------- | ----- | ----------------------------------------------------------------------------------------------- |
| `id`                     | `uuid`        | internal | no    | Primary key (UUID).                                                                             |
| `tenant_id`              | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                 |
| `report_code`            | `text`        | internal | no    | Stable report code; `^[a-z][a-z0-9_]{1,62}$`; `UNIQUE(tenant_id, report_code)` (live).          |
| `name`                   | `text`        | internal | no    | Human-readable name.                                                                            |
| `scope_level`            | `text`        | internal | no    | Report scope; CHECK IN ('branch','company','tenant').                                           |
| `export_permission_code` | `text`        | internal | no    | Export gate permission; FK -> `iam.permissions(permission_code)` RESTRICT (recorded for P1-23). |
| `owner_user_id`          | `uuid`        | internal | no    | Owning user id.                                                                                 |
| `status`                 | `text`        | internal | no    | CHECK IN ('draft','published','archived').                                                      |
| `record_version`         | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                          |
| `created_at`             | `timestamptz` | internal | no    | Row creation timestamp.                                                                         |
| `created_by`             | `uuid`        | internal | no    | Creating actor (user id).                                                                       |
| `updated_at`             | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                |
| `updated_by`             | `uuid`        | internal | yes   | Last-updating actor.                                                                            |
| `deleted_at`             | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                            |
| `deleted_by`             | `uuid`        | internal | yes   | Soft-deleting actor.                                                                            |

## `rpt.saved_filters`

User-owned saved filter (owner-only RLS).

| Column                    | Type          | class    | Null? | Purpose                                                                                                  |
| ------------------------- | ------------- | -------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `id`                      | `uuid`        | internal | no    | Primary key (UUID).                                                                                      |
| `tenant_id`               | `uuid`        | internal | no    | Tenant scope; FK -> `org.tenants(id)` RESTRICT.                                                          |
| `report_configuration_id` | `uuid`        | internal | no    | Composite FK -> `rpt.report_configurations(tenant_id, id)` RESTRICT.                                     |
| `owner_user_id`           | `uuid`        | internal | no    | Owning user; owner-only RLS pins `owner_user_id = iam.current_user_id()`; not reassignable (BR-RPT-001). |
| `name`                    | `text`        | internal | no    | Human-readable name.                                                                                     |
| `filter_definition`       | `jsonb`       | internal | no    | User filter definition (jsonb).                                                                          |
| `scope_level`             | `text`        | internal | no    | CHECK IN ('branch','company','tenant'); `guard_saved_filter_scope` enforces scope_level <= report scope. |
| `record_version`          | `integer`     | internal | no    | Optimistic-concurrency version, bumped by `shared.touch_row_metadata`.                                   |
| `created_at`              | `timestamptz` | internal | no    | Row creation timestamp.                                                                                  |
| `created_by`              | `uuid`        | internal | no    | Creating actor (user id).                                                                                |
| `updated_at`              | `timestamptz` | internal | yes   | Last-update timestamp (NULL until first update).                                                         |
| `updated_by`              | `uuid`        | internal | yes   | Last-updating actor.                                                                                     |
| `deleted_at`              | `timestamptz` | internal | yes   | Soft-delete timestamp (NULL = live).                                                                     |
| `deleted_by`              | `uuid`        | internal | yes   | Soft-deleting actor.                                                                                     |
