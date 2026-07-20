# Phase 1-10 — Pricing Data Dictionary (`svc` pricing)

Column-level dictionary for the six pricing tables in
`supabase/migrations/20260723092000_svc_pricing.sql`. Money is `NUMERIC(18,4)`; tax
rates reuse `NUMERIC(9,6)` fractions via `org.tax_classes`/`org.tax_rates`; currency
is `currency_code text` → `shared.currencies(code)`. Every table carries the standard
audit tail and is `ENABLE`+`FORCE` RLS.

## `svc.price_lists` — named tenant price book

| Column            | Type | Null | Notes                                                                              |
| ----------------- | ---- | ---- | ---------------------------------------------------------------------------------- |
| `id`              | uuid | no   | PK; `UNIQUE(tenant_id, id)`                                                        |
| `tenant_id`       | uuid | no   | FK → `org.tenants(id)` RESTRICT                                                    |
| `price_list_code` | text | no   | **Immutable**; `^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$`; unique per tenant (partial)     |
| `name`            | text | no   | not blank                                                                          |
| `currency_code`   | text | no   | **Immutable**; FK → `shared.currencies(code)` RESTRICT; the book's single currency |
| `description`     | text | yes  | not blank if present                                                               |
| `status`          | text | no   | `active`\|`inactive`, default `active`                                             |

## `svc.price_list_versions` — immutable published versions (BR-SVC-001)

| Column           | Type    | Null | Notes                                                    |
| ---------------- | ------- | ---- | -------------------------------------------------------- |
| `id`             | uuid    | no   | PK; `UNIQUE(tenant_id, id)`                              |
| `tenant_id`      | uuid    | no   | FK → `org.tenants(id)` RESTRICT                          |
| `price_list_id`  | uuid    | no   | Composite FK → `svc.price_lists(tenant_id, id)` RESTRICT |
| `version_no`     | integer | no   | `> 0`; `UNIQUE(tenant_id, price_list_id, version_no)`    |
| `effective_from` | date    | no   | set on publish                                           |
| `effective_to`   | date    | yes  | CHECK `> effective_from`; forward-only close             |
| `status`         | text    | no   | `draft`\|`published`\|`archived`, default `draft`        |
| `notes`          | text    | yes  | not blank if present                                     |

Gist `EXCLUDE` no-overlap on published versions per list. Freeze guard identical to
`service_versions`. Succession by `svc.publish_price_list_version(price_list_id,
version_id, effective_from)` under a per-list `FOR UPDATE` lock.

## `svc.price_rules` — deterministic-precedence rule

| Column                  | Type          | Null | Notes                                                                                                                        |
| ----------------------- | ------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | uuid          | no   | PK                                                                                                                           |
| `tenant_id`             | uuid          | no   | FK → `org.tenants(id)` RESTRICT                                                                                              |
| `price_list_version_id` | uuid          | no   | Composite FK → `svc.price_list_versions(tenant_id, id)` RESTRICT                                                             |
| `service_id`            | uuid          | no   | Composite FK → `svc.services(tenant_id, id)` RESTRICT                                                                        |
| `company_id`            | uuid          | yes  | optional narrowing (specificity weight 2)                                                                                    |
| `branch_id`             | uuid          | yes  | optional narrowing (specificity weight 4)                                                                                    |
| `customer_class`        | text          | yes  | `^[a-z][a-z0-9_]{1,62}$`; optional narrowing (weight 1)                                                                      |
| `amount`                | numeric(18,4) | no   | CHECK `>= 0`; currency **inherited** from the price list (H12)                                                               |
| `tax_class_id`          | uuid          | yes  | Composite FK → `org.tax_classes(tenant_id, company_id, id)` RESTRICT; CHECK `company_id IS NOT NULL OR tax_class_id IS NULL` |
| `priority`              | integer       | no   | `>= 0`, default 0; tie-break after specificity                                                                               |
| `status`                | text          | no   | `active`\|`inactive`, default `active`                                                                                       |

Anti-ambiguity: `UNIQUE(price_list_version_id, service_id, company_id, branch_id,
customer_class, priority) NULLS NOT DISTINCT` (partial) — one rule per full signature.
Frozen against INSERT/UPDATE/DELETE once the parent version is published
(`guard_price_rule_parent_frozen`).

## `svc.price_list_assignments` — one applicable book per context

| Column           | Type    | Null | Notes                                                    |
| ---------------- | ------- | ---- | -------------------------------------------------------- |
| `id`             | uuid    | no   | PK                                                       |
| `tenant_id`      | uuid    | no   | FK → `org.tenants(id)` RESTRICT                          |
| `price_list_id`  | uuid    | no   | Composite FK → `svc.price_lists(tenant_id, id)` RESTRICT |
| `company_id`     | uuid    | yes  | optional scope narrowing                                 |
| `branch_id`      | uuid    | yes  | optional scope narrowing                                 |
| `customer_class` | text    | yes  | optional scope narrowing                                 |
| `priority`       | integer | no   | `>= 0`, default 0                                        |
| `effective_from` | date    | no   | assignment window start                                  |
| `effective_to`   | date    | yes  | CHECK `> effective_from`                                 |
| `status`         | text    | no   | `active`\|`inactive`, default `active`                   |

`UNIQUE(tenant_id, company_id, branch_id, customer_class, priority) NULLS NOT
DISTINCT WHERE status='active' AND deleted_at IS NULL` — resolution maps a context to
exactly one book so `resolve_price` never arbitrates across lists.

## `svc.discount_rules` — bounded discounts

| Column                                                       | Type           | Null | Notes                                                                    |
| ------------------------------------------------------------ | -------------- | ---- | ------------------------------------------------------------------------ |
| `id`                                                         | uuid           | no   | PK                                                                       |
| `tenant_id`                                                  | uuid           | no   | FK → `org.tenants(id)` RESTRICT                                          |
| `discount_code`                                              | text           | no   | **Immutable**; unique per tenant (partial)                               |
| `name`                                                       | text           | no   | not blank                                                                |
| `discount_type`                                              | text           | no   | `percentage`\|`amount`                                                   |
| `value`                                                      | numeric(18,4)  | no   | percentage `0..100` (currency NULL) or amount `>= 0` (currency required) |
| `currency_code`                                              | text           | yes  | FK → `shared.currencies(code)` RESTRICT                                  |
| `company_id` / `branch_id` / `customer_class` / `service_id` | uuid/text/uuid | yes  | optional narrowing (`service_id` composite FK → `svc.services`)          |
| `effective_from`                                             | date           | no   | window start                                                             |
| `effective_to`                                               | date           | yes  | CHECK `> effective_from`                                                 |
| `status`                                                     | text           | no   | `active`\|`inactive`, default `active`                                   |

CHECK `ck_discount_rules_type_value` couples type/value/currency.

## `svc.pricing_approval_policies` — when approval is required

| Column                     | Type          | Null | Notes                                                                                                                    |
| -------------------------- | ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                       | uuid          | no   | PK                                                                                                                       |
| `tenant_id`                | uuid          | no   | FK → `org.tenants(id)` RESTRICT                                                                                          |
| `company_id`               | uuid          | yes  | optional scope                                                                                                           |
| `policy_type`              | text          | no   | `discount`\|`quotation_total`\|`price_override`                                                                          |
| `threshold_kind`           | text          | no   | `percentage` (currency NULL) or `amount` (currency required)                                                             |
| `threshold_value`          | numeric(18,4) | no   | CHECK `>= 0` — **no seeded value** (P1-OD-020/021/022 config)                                                            |
| `currency_code`            | text          | yes  | FK → `shared.currencies(code)` RESTRICT                                                                                  |
| `required_permission_code` | text          | no   | FK → `iam.permissions(permission_code)` RESTRICT                                                                         |
| `maker_approver_distinct`  | boolean       | no   | default `true`; enforced at decision time by P1-20                                                                       |
| `effective_from`           | date          | no   | window start                                                                                                             |
| `effective_to`             | date          | yes  | CHECK `> effective_from`                                                                                                 |
| `status`                   | text          | no   | `active`\|`inactive`, default `active`; `UNIQUE(tenant_id, company_id, policy_type) NULLS NOT DISTINCT` (partial active) |

The monetary **ceiling** ("who may approve up to what amount") is not duplicated here
— it stays in `iam.approval_limits`. This table stores **when** approval is required
and **which permission** authorizes it; the workflow is P1-20.

## Deterministic resolver `svc.resolve_price`

`svc.resolve_price(p_service_id, p_company_id, p_branch_id, p_customer_class,
p_as_of)` (`STABLE SECURITY INVOKER`, granted to `app_runtime, app_readonly`) returns
`(price_rule_id, amount, currency_code, tax_class_id)` — assignment (one book) →
effective published version → one rule. Specificity is a strict bit-weighted total
order (branch 4 > company 2 > customer-class 1), ties broken by `priority DESC` then
`id`; **at most one rule resolves**. See
[phase-1-10-price-precedence-contract.md](phase-1-10-price-precedence-contract.md).
