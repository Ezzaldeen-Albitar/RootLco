# Phase 1-10 — Service Catalog Data Dictionary (`svc` catalog)

Column-level dictionary for the five service-catalog tables in
`supabase/migrations/20260723091000_svc_catalog.sql`. Money is `NUMERIC(18,4)`;
labor time is `NUMERIC(10,2)`. Every table carries the standard audit tail
(`record_version`, `created_at`, `created_by`, `updated_at`, `updated_by`,
`deleted_at`, `deleted_by`) and is `ENABLE`+`FORCE` RLS. Pricing tables are in
[phase-1-10-pricing-data-dictionary.md](phase-1-10-pricing-data-dictionary.md).

## `svc.service_categories` — tenant service taxonomy

| Column               | Type    | Null | Notes                                                                                     |
| -------------------- | ------- | ---- | ----------------------------------------------------------------------------------------- |
| `id`                 | uuid    | no   | PK, `gen_random_uuid()`; `UNIQUE(tenant_id, id)`                                          |
| `tenant_id`          | uuid    | no   | FK → `org.tenants(id)` RESTRICT                                                           |
| `parent_category_id` | uuid    | yes  | Composite self-FK `(tenant_id, parent_category_id)` RESTRICT; advisory-locked cycle guard |
| `code`               | text    | no   | `^[a-z][a-z0-9_]{1,62}$`; unique per tenant (partial `WHERE deleted_at IS NULL`)          |
| `name`               | text    | no   | not blank                                                                                 |
| `description`        | text    | yes  | not blank if present                                                                      |
| `sort_order`         | integer | yes  | display ordering                                                                          |
| `status`             | text    | no   | `active`\|`inactive`, default `active`                                                    |

## `svc.services` — stable service identity (FR-SVC-001)

| Column                | Type        | Null | Notes                                                                                                   |
| --------------------- | ----------- | ---- | ------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid        | no   | PK; `UNIQUE(tenant_id, id)`                                                                             |
| `tenant_id`           | uuid        | no   | FK → `org.tenants(id)` RESTRICT                                                                         |
| `service_category_id` | uuid        | no   | Composite FK → `svc.service_categories(tenant_id, id)` RESTRICT                                         |
| `service_code`        | text        | no   | **Immutable**; `^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$`; unique per tenant (partial)                          |
| `name`                | text        | no   | not blank                                                                                               |
| `description`         | text        | yes  | not blank if present                                                                                    |
| `lifecycle_status`    | text        | no   | `active`\|`archived` (archived terminal), default `active`                                              |
| `archived_at`         | timestamptz | yes  | CHECK `(lifecycle_status='archived') = (archived_at IS NOT NULL)`; stamped by `guard_service_lifecycle` |

Immutable columns: `tenant_id`, `service_code`, `created_at`, `created_by`.

## `svc.service_versions` — effective-dated versions (FR-SVC-002, BR-SVC-001)

| Column           | Type    | Null | Notes                                                    |
| ---------------- | ------- | ---- | -------------------------------------------------------- |
| `id`             | uuid    | no   | PK; `UNIQUE(tenant_id, id)`                              |
| `tenant_id`      | uuid    | no   | FK → `org.tenants(id)` RESTRICT                          |
| `service_id`     | uuid    | no   | Composite FK → `svc.services(tenant_id, id)` RESTRICT    |
| `version_no`     | integer | no   | `> 0`; `UNIQUE(tenant_id, service_id, version_no)`       |
| `effective_from` | date    | no   | succession sets this on publish                          |
| `effective_to`   | date    | yes  | CHECK `> effective_from`; forward-only close (NULL→date) |
| `status`         | text    | no   | `draft`\|`published`\|`archived`, default `draft`        |
| `notes`          | text    | yes  | not blank if present                                     |

`EXCLUDE USING gist (tenant_id =, service_id =, daterange(effective_from,
effective_to, '[)') &&) WHERE (status='published' AND deleted_at IS NULL)` — no two
published versions of a service overlap. Freeze guard: a published/archived version's
identity, `effective_from`, `notes`, and a closed `effective_to` are frozen; a
published version may only advance to `archived`. Succession is
`svc.publish_service_version(service_id, version_id, effective_from)` (under a
per-service `FOR UPDATE` lock).

## `svc.standard_labor_times` — positive minutes per version

| Column               | Type          | Null | Notes                                                                                                      |
| -------------------- | ------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `id`                 | uuid          | no   | PK                                                                                                         |
| `tenant_id`          | uuid          | no   | FK → `org.tenants(id)` RESTRICT                                                                            |
| `service_version_id` | uuid          | no   | Composite FK → `svc.service_versions(tenant_id, id)` RESTRICT                                              |
| `labor_code`         | text          | yes  | `^[a-z][a-z0-9_]{1,62}$`; `UNIQUE(tenant_id, service_version_id, labor_code) NULLS NOT DISTINCT` (partial) |
| `standard_minutes`   | numeric(10,2) | no   | CHECK `> 0`                                                                                                |
| `skill_ref`          | uuid          | yes  | opaque skill reference                                                                                     |
| `status`             | text          | no   | `active`\|`inactive`, default `active`                                                                     |

Frozen against INSERT/UPDATE/DELETE once the parent version is published/archived
(`guard_labor_time_parent_frozen`).

## `svc.branch_service_availability` — branch offering (branch-scoped)

| Column         | Type    | Null | Notes                                                                                      |
| -------------- | ------- | ---- | ------------------------------------------------------------------------------------------ |
| `id`           | uuid    | no   | PK; `UNIQUE(tenant_id, company_id, branch_id, id)`                                         |
| `tenant_id`    | uuid    | no   | FK → `org.tenants(id)` RESTRICT                                                            |
| `company_id`   | uuid    | no   | part of composite branch FK                                                                |
| `branch_id`    | uuid    | no   | Composite FK → `org.branches(tenant_id, company_id, id)` RESTRICT (branch∈company)         |
| `service_id`   | uuid    | no   | Composite FK → `svc.services(tenant_id, id)` RESTRICT; unique per (scope, service) partial |
| `is_available` | boolean | no   | default `true`; an archived service cannot be newly made available                         |
| `status`       | text    | no   | `active`\|`inactive`, default `active`                                                     |
