# Phase 1-6 — CRM Data Dictionary

<!-- Column tables generated from the live `crm` schema; per-table purpose is authored. -->

**Company:** RootLco — Root Link Company · **Phase:** 1-6 — CRM and Business Partner Database

Authoritative per-column reference for all **21** `crm` tables (**296** columns). "Class" is the personal-data classification from the enforced registry (`public`/`internal`/`restricted`/`secret`); **restricted** columns are sensitive-view gated and never projected into search. RLS is `FORCE`d on every table; grants and policies are in the [grant matrix](./crm-grant-matrix.md) and [RLS matrix](./crm-rls-policy-matrix.md).

## `crm.addresses`

Postal/physical addresses for a partner with type and primary flag; a partial unique index enforces one active primary per (partner, type).

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `partner_id`     | uuid        | NOT NULL | internal |                     |
| `address_type`   | text        | NOT NULL | internal |                     |
| `line1`          | text        | NOT NULL | internal |                     |
| `line2`          | text        | ·        | internal |                     |
| `line3`          | text        | ·        | internal |                     |
| `city`           | text        | ·        | internal |                     |
| `region`         | text        | ·        | internal |                     |
| `postal_code`    | text        | ·        | internal |                     |
| `country_code`   | text        | ·        | internal |                     |
| `is_primary`     | boolean     | NOT NULL | internal | `false`             |
| `status`         | text        | NOT NULL | internal | `'active'::text`    |
| `record_version` | integer     | NOT NULL | internal | `1`                 |
| `created_at`     | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`     | uuid        | NOT NULL | internal |                     |
| `updated_at`     | timestamptz | ·        | internal |                     |
| `updated_by`     | uuid        | ·        | internal |                     |
| `deleted_at`     | timestamptz | ·        | internal |                     |
| `deleted_by`     | uuid        | ·        | internal |                     |

## `crm.business_partners`

Party master — one row per customer/individual/company. Carries the tenant-unique display number, party_type discriminator, lifecycle_status, and the merge redirect (merged_into_id). Root of the whole CRM graph.

| Column              | Type        | Null     | Class    | Default             |
| ------------------- | ----------- | -------- | -------- | ------------------- |
| `id`                | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`         | uuid        | NOT NULL | internal |                     |
| `party_type`        | text        | NOT NULL | internal |                     |
| `display_name`      | text        | NOT NULL | internal |                     |
| `display_number`    | text        | ·        | internal |                     |
| `lifecycle_status`  | text        | NOT NULL | internal | `'prospect'::text`  |
| `commercial_status` | text        | NOT NULL | internal | `'normal'::text`    |
| `merged_into_id`    | uuid        | ·        | internal |                     |
| `record_version`    | integer     | NOT NULL | internal | `1`                 |
| `created_at`        | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`        | uuid        | NOT NULL | internal |                     |
| `updated_at`        | timestamptz | ·        | internal |                     |
| `updated_by`        | uuid        | ·        | internal |                     |
| `deleted_at`        | timestamptz | ·        | internal |                     |
| `deleted_by`        | uuid        | ·        | internal |                     |

## `crm.communication_log`

Record of communications sent/received about a partner (channel, direction, template ref, status). created_by is mandatory; tenant-scoped.

| Column                | Type        | Null     | Class    | Default             |
| --------------------- | ----------- | -------- | -------- | ------------------- |
| `id`                  | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`           | uuid        | NOT NULL | internal |                     |
| `partner_id`          | uuid        | NOT NULL | internal |                     |
| `direction`           | text        | NOT NULL | internal |                     |
| `channel`             | text        | NOT NULL | internal |                     |
| `subject`             | text        | ·        | internal |                     |
| `summary`             | text        | ·        | internal |                     |
| `outbound_message_id` | uuid        | ·        | internal |                     |
| `related_entity_type` | text        | ·        | internal |                     |
| `related_entity_id`   | uuid        | ·        | internal |                     |
| `logged_by`           | uuid        | NOT NULL | internal |                     |
| `occurred_at`         | timestamptz | NOT NULL | internal | `now()`             |
| `record_version`      | integer     | NOT NULL | internal | `1`                 |
| `created_at`          | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`          | uuid        | NOT NULL | internal |                     |
| `updated_at`          | timestamptz | ·        | internal |                     |
| `updated_by`          | uuid        | ·        | internal |                     |

## `crm.communication_preferences`

Per-partner channel/purpose preferences and preferred locale. FK to shared.locales; unique per (partner, channel, purpose).

| Column             | Type        | Null     | Class    | Default             |
| ------------------ | ----------- | -------- | -------- | ------------------- |
| `id`               | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`        | uuid        | NOT NULL | internal |                     |
| `partner_id`       | uuid        | NOT NULL | internal |                     |
| `channel`          | text        | NOT NULL | internal |                     |
| `purpose`          | text        | NOT NULL | internal |                     |
| `preferred`        | boolean     | NOT NULL | internal |                     |
| `preferred_locale` | text        | ·        | internal |                     |
| `quiet_hours_note` | text        | ·        | internal |                     |
| `record_version`   | integer     | NOT NULL | internal | `1`                 |
| `created_at`       | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`       | uuid        | NOT NULL | internal |                     |
| `updated_at`       | timestamptz | ·        | internal |                     |
| `updated_by`       | uuid        | ·        | internal |                     |

## `crm.company_profiles`

Per-partner profile for party_type=company. Holds registration_ref/tax_ref (RESTRICTED); discriminator FK enforces party_type=company.

| Column                  | Type        | Null     | Class          | Default                |
| ----------------------- | ----------- | -------- | -------------- | ---------------------- |
| `id`                    | uuid        | NOT NULL | internal       | `gen_random_uuid()`    |
| `tenant_id`             | uuid        | NOT NULL | internal       |                        |
| `partner_id`            | uuid        | NOT NULL | internal       |                        |
| `party_type`            | text        | NOT NULL | internal       | `'organization'::text` |
| `legal_name`            | text        | NOT NULL | internal       |                        |
| `trade_name`            | text        | ·        | internal       |                        |
| `legal_name_normalized` | text        | ·        | internal       |                        |
| `trade_name_normalized` | text        | ·        | internal       |                        |
| `registration_ref`      | uuid        | ·        | **restricted** |                        |
| `tax_ref`               | uuid        | ·        | **restricted** |                        |
| `record_version`        | integer     | NOT NULL | internal       | `1`                    |
| `created_at`            | timestamptz | NOT NULL | internal       | `now()`                |
| `created_by`            | uuid        | NOT NULL | internal       |                        |
| `updated_at`            | timestamptz | ·        | internal       |                        |
| `updated_by`            | uuid        | ·        | internal       |                        |

## `crm.consent_history`

Append-only consent ledger (granted/withdrawn) per kind/channel/purpose with effective_at and optional evidence document. current_consent() resolves the latest effective row, tie-broken by seq. INSERT+SELECT only.

| Column                 | Type        | Null     | Class    | Default             |
| ---------------------- | ----------- | -------- | -------- | ------------------- |
| `id`                   | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`            | uuid        | NOT NULL | internal |                     |
| `partner_id`           | uuid        | NOT NULL | internal |                     |
| `consent_kind`         | text        | NOT NULL | internal |                     |
| `contact_point_id`     | uuid        | ·        | internal |                     |
| `channel`              | text        | NOT NULL | internal |                     |
| `purpose`              | text        | NOT NULL | internal |                     |
| `status`               | text        | NOT NULL | internal |                     |
| `source`               | text        | ·        | internal |                     |
| `evidence_document_id` | uuid        | ·        | internal |                     |
| `effective_at`         | timestamptz | NOT NULL | internal |                     |
| `recorded_by`          | uuid        | NOT NULL | internal |                     |
| `correlation_id`       | uuid        | ·        | internal |                     |
| `created_at`           | timestamptz | NOT NULL | internal | `now()`             |
| `seq`                  | bigint      | NOT NULL | internal |                     |

## `crm.contact_points`

Communication endpoints (email/phone/…) with normalized_value. A partial unique index enforces one active primary per (partner, channel); another enforces uniqueness of the normalized value.

| Column             | Type        | Null     | Class    | Default             |
| ------------------ | ----------- | -------- | -------- | ------------------- |
| `id`               | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`        | uuid        | NOT NULL | internal |                     |
| `partner_id`       | uuid        | NOT NULL | internal |                     |
| `channel`          | text        | NOT NULL | internal |                     |
| `normalized_value` | text        | NOT NULL | internal |                     |
| `raw_value`        | text        | ·        | internal |                     |
| `label`            | text        | ·        | internal |                     |
| `is_primary`       | boolean     | NOT NULL | internal | `false`             |
| `verified_at`      | timestamptz | ·        | internal |                     |
| `status`           | text        | NOT NULL | internal | `'active'::text`    |
| `record_version`   | integer     | NOT NULL | internal | `1`                 |
| `created_at`       | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`       | uuid        | NOT NULL | internal |                     |
| `updated_at`       | timestamptz | ·        | internal |                     |
| `updated_by`       | uuid        | ·        | internal |                     |
| `deleted_at`       | timestamptz | ·        | internal |                     |
| `deleted_by`       | uuid        | ·        | internal |                     |

## `crm.customer_alerts`

Operational alerts/flags on a partner (kind, severity, status) with lifecycle. Tenant-scoped; no customer-facing wording seeded.

| Column            | Type        | Null     | Class    | Default             |
| ----------------- | ----------- | -------- | -------- | ------------------- |
| `id`              | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`       | uuid        | NOT NULL | internal |                     |
| `partner_id`      | uuid        | NOT NULL | internal |                     |
| `alert_type`      | text        | NOT NULL | internal |                     |
| `severity`        | text        | NOT NULL | internal |                     |
| `message`         | text        | NOT NULL | internal |                     |
| `active`          | boolean     | NOT NULL | internal | `true`              |
| `effective_from`  | date        | NOT NULL | internal |                     |
| `effective_to`    | date        | ·        | internal |                     |
| `acknowledged_by` | uuid        | ·        | internal |                     |
| `acknowledged_at` | timestamptz | ·        | internal |                     |
| `record_version`  | integer     | NOT NULL | internal | `1`                 |
| `created_at`      | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`      | uuid        | NOT NULL | internal |                     |
| `updated_at`      | timestamptz | ·        | internal |                     |
| `updated_by`      | uuid        | ·        | internal |                     |

## `crm.customer_block_history`

Append-only block/unblock ledger backing lifecycle coherence. The block-coherence guard requires a matching block/unblock row; a monotonic seq totally orders same-transaction rows. INSERT+SELECT only.

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `partner_id`     | uuid        | NOT NULL | internal |                     |
| `action`         | text        | NOT NULL | internal |                     |
| `reason`         | text        | NOT NULL | internal |                     |
| `restriction_id` | uuid        | ·        | internal |                     |
| `approval_ref`   | text        | ·        | internal |                     |
| `actor_id`       | uuid        | NOT NULL | internal |                     |
| `occurred_at`    | timestamptz | NOT NULL | internal | `now()`             |
| `correlation_id` | uuid        | ·        | internal |                     |
| `seq`            | bigint      | NOT NULL | internal |                     |

## `crm.customer_credit_profiles`

Per-partner credit terms (limit, currency, terms). FK to shared currency reference; one profile per partner.

| Column               | Type        | Null     | Class    | Default             |
| -------------------- | ----------- | -------- | -------- | ------------------- |
| `id`                 | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`          | uuid        | NOT NULL | internal |                     |
| `partner_id`         | uuid        | NOT NULL | internal |                     |
| `credit_limit`       | numeric     | ·        | internal |                     |
| `currency_code`      | text        | ·        | internal |                     |
| `risk_note`          | text        | ·        | internal |                     |
| `payment_terms_code` | text        | ·        | internal |                     |
| `status`             | text        | NOT NULL | internal | `'none'::text`      |
| `approved_by`        | uuid        | ·        | internal |                     |
| `approval_ref`       | text        | ·        | internal |                     |
| `record_version`     | integer     | NOT NULL | internal | `1`                 |
| `created_at`         | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`         | uuid        | NOT NULL | internal |                     |
| `updated_at`         | timestamptz | ·        | internal |                     |
| `updated_by`         | uuid        | ·        | internal |                     |

## `crm.customer_restrictions`

Restriction/hold records (credit hold, legal block, …) with reason and scope. Referenced by block history and the block-coherence guard.

| Column             | Type        | Null     | Class    | Default             |
| ------------------ | ----------- | -------- | -------- | ------------------- |
| `id`               | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`        | uuid        | NOT NULL | internal |                     |
| `partner_id`       | uuid        | NOT NULL | internal |                     |
| `restriction_type` | text        | NOT NULL | internal |                     |
| `reason`           | text        | NOT NULL | internal |                     |
| `imposed_by`       | uuid        | NOT NULL | internal |                     |
| `effective_from`   | date        | NOT NULL | internal |                     |
| `effective_to`     | date        | ·        | internal |                     |
| `approval_ref`     | text        | ·        | internal |                     |
| `record_version`   | integer     | NOT NULL | internal | `1`                 |
| `created_at`       | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`       | uuid        | NOT NULL | internal |                     |
| `updated_at`       | timestamptz | ·        | internal |                     |
| `updated_by`       | uuid        | ·        | internal |                     |

## `crm.customer_segments`

Tenant-defined segment catalog (code/name/status). Structural per-tenant configuration, not business data — remains empty until a tenant defines segments.

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `segment_code`   | text        | NOT NULL | internal |                     |
| `name`           | text        | NOT NULL | internal |                     |
| `criteria_note`  | text        | ·        | internal |                     |
| `status`         | text        | NOT NULL | internal | `'active'::text`    |
| `record_version` | integer     | NOT NULL | internal | `1`                 |
| `created_at`     | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`     | uuid        | NOT NULL | internal |                     |
| `updated_at`     | timestamptz | ·        | internal |                     |
| `updated_by`     | uuid        | ·        | internal |                     |
| `deleted_at`     | timestamptz | ·        | internal |                     |
| `deleted_by`     | uuid        | ·        | internal |                     |

## `crm.duplicate_candidates`

Suspected duplicate partner pairs with match_score and match_basis (jsonb, raw-value keys rejected). A partial unique index enforces one open candidate per unordered pair.

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `partner_id_a`   | uuid        | NOT NULL | internal |                     |
| `partner_id_b`   | uuid        | NOT NULL | internal |                     |
| `match_score`    | numeric     | NOT NULL | internal |                     |
| `match_basis`    | jsonb       | NOT NULL | internal | `'[]'::jsonb`       |
| `status`         | text        | NOT NULL | internal | `'open'::text`      |
| `detected_at`    | timestamptz | NOT NULL | internal | `now()`             |
| `reviewed_by`    | uuid        | ·        | internal |                     |
| `reviewed_at`    | timestamptz | ·        | internal |                     |
| `record_version` | integer     | NOT NULL | internal | `1`                 |
| `created_at`     | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`     | uuid        | NOT NULL | internal |                     |
| `updated_at`     | timestamptz | ·        | internal |                     |
| `updated_by`     | uuid        | ·        | internal |                     |

## `crm.individual_profiles`

Per-partner profile for party_type=individual. Holds national_id_ref (RESTRICTED) and a sensitive-gated date of birth; a discriminator FK ties it to a business_partner whose party_type is individual.

| Column                   | Type        | Null     | Class          | Default              |
| ------------------------ | ----------- | -------- | -------------- | -------------------- |
| `id`                     | uuid        | NOT NULL | internal       | `gen_random_uuid()`  |
| `tenant_id`              | uuid        | NOT NULL | internal       |                      |
| `partner_id`             | uuid        | NOT NULL | internal       |                      |
| `party_type`             | text        | NOT NULL | internal       | `'individual'::text` |
| `given_name`             | text        | NOT NULL | internal       |                      |
| `family_name`            | text        | NOT NULL | internal       |                      |
| `given_name_normalized`  | text        | ·        | internal       |                      |
| `family_name_normalized` | text        | ·        | internal       |                      |
| `national_id_ref`        | uuid        | ·        | **restricted** |                      |
| `preferred_locale`       | text        | ·        | internal       |                      |
| `record_version`         | integer     | NOT NULL | internal       | `1`                  |
| `created_at`             | timestamptz | NOT NULL | internal       | `now()`              |
| `created_by`             | uuid        | NOT NULL | internal       |                      |
| `updated_at`             | timestamptz | ·        | internal       |                      |
| `updated_by`             | uuid        | ·        | internal       |                      |

## `crm.partner_identifiers`

Government/registration/tax identifiers for a partner. normalized_value + raw_value are RESTRICTED (sensitive-view gated); a partial unique index enforces one live value per (tenant, type, normalized_value).

| Column             | Type        | Null     | Class          | Default             |
| ------------------ | ----------- | -------- | -------------- | ------------------- |
| `id`               | uuid        | NOT NULL | internal       | `gen_random_uuid()` |
| `tenant_id`        | uuid        | NOT NULL | internal       |                     |
| `partner_id`       | uuid        | NOT NULL | internal       |                     |
| `identifier_type`  | text        | NOT NULL | internal       |                     |
| `normalized_value` | text        | NOT NULL | **restricted** |                     |
| `raw_value`        | text        | ·        | **restricted** |                     |
| `classification`   | text        | NOT NULL | internal       | `'internal'::text`  |
| `is_primary`       | boolean     | NOT NULL | internal       | `false`             |
| `verified_at`      | timestamptz | ·        | internal       |                     |
| `record_version`   | integer     | NOT NULL | internal       | `1`                 |
| `created_at`       | timestamptz | NOT NULL | internal       | `now()`             |
| `created_by`       | uuid        | NOT NULL | internal       |                     |
| `updated_at`       | timestamptz | ·        | internal       |                     |
| `updated_by`       | uuid        | ·        | internal       |                     |
| `deleted_at`       | timestamptz | ·        | internal       |                     |
| `deleted_by`       | uuid        | ·        | internal       |                     |

## `crm.partner_merges`

Immutable merge records (source → survivor) with counts-only merge_summary (raw-value keys rejected). Backs redirect resolution; merged partners are frozen.

| Column                | Type        | Null     | Class    | Default             |
| --------------------- | ----------- | -------- | -------- | ------------------- |
| `id`                  | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`           | uuid        | NOT NULL | internal |                     |
| `source_partner_id`   | uuid        | NOT NULL | internal |                     |
| `survivor_partner_id` | uuid        | NOT NULL | internal |                     |
| `merge_summary`       | jsonb       | NOT NULL | internal | `'{}'::jsonb`       |
| `preview_ref`         | text        | ·        | internal |                     |
| `approval_ref`        | text        | NOT NULL | internal |                     |
| `merged_by`           | uuid        | NOT NULL | internal |                     |
| `merged_at`           | timestamptz | NOT NULL | internal | `now()`             |
| `correlation_id`      | uuid        | ·        | internal |                     |

## `crm.partner_roles`

Dated business roles a partner plays (customer, supplier, …). A btree_gist EXCLUDE forbids overlapping intervals of the same role for the same partner; valid_from is NOT NULL.

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `partner_id`     | uuid        | NOT NULL | internal |                     |
| `role_type`      | text        | NOT NULL | internal |                     |
| `valid_from`     | date        | NOT NULL | internal |                     |
| `valid_to`       | date        | ·        | internal |                     |
| `source`         | text        | ·        | internal |                     |
| `record_version` | integer     | NOT NULL | internal | `1`                 |
| `created_at`     | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`     | uuid        | NOT NULL | internal |                     |
| `updated_at`     | timestamptz | ·        | internal |                     |
| `updated_by`     | uuid        | ·        | internal |                     |

## `crm.partner_segment_assignments`

Dated membership of a partner in a segment. Composite FKs keep tenant/partner/segment consistent; a partial unique index enforces one open assignment.

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `partner_id`     | uuid        | NOT NULL | internal |                     |
| `segment_id`     | uuid        | NOT NULL | internal |                     |
| `assigned_by`    | uuid        | NOT NULL | internal |                     |
| `assigned_at`    | timestamptz | NOT NULL | internal | `now()`             |
| `valid_from`     | date        | NOT NULL | internal |                     |
| `valid_to`       | date        | ·        | internal |                     |
| `record_version` | integer     | NOT NULL | internal | `1`                 |
| `created_at`     | timestamptz | NOT NULL | internal | `now()`             |
| `created_by`     | uuid        | NOT NULL | internal |                     |
| `updated_at`     | timestamptz | ·        | internal |                     |
| `updated_by`     | uuid        | ·        | internal |                     |

## `crm.partner_sensitive_attributes`

Declarative key/value store for additional sensitive attributes (value_text/value_date RESTRICTED). Every read is sensitive-view gated by classification.

| Column           | Type        | Null     | Class          | Default              |
| ---------------- | ----------- | -------- | -------------- | -------------------- |
| `id`             | uuid        | NOT NULL | internal       | `gen_random_uuid()`  |
| `tenant_id`      | uuid        | NOT NULL | internal       |                      |
| `partner_id`     | uuid        | NOT NULL | internal       |                      |
| `attribute_type` | text        | NOT NULL | internal       |                      |
| `value_date`     | date        | ·        | **restricted** |                      |
| `value_text`     | text        | ·        | **restricted** |                      |
| `classification` | text        | NOT NULL | internal       | `'restricted'::text` |
| `record_version` | integer     | NOT NULL | internal       | `1`                  |
| `created_at`     | timestamptz | NOT NULL | internal       | `now()`              |
| `created_by`     | uuid        | NOT NULL | internal       |                      |
| `updated_at`     | timestamptz | ·        | internal       |                      |
| `updated_by`     | uuid        | ·        | internal       |                      |
| `deleted_at`     | timestamptz | ·        | internal       |                      |
| `deleted_by`     | uuid        | ·        | internal       |                      |

## `crm.partner_status_history`

Append-only lifecycle-status history. Grant is INSERT+SELECT only; a shared trigger server-stamps actor and time; a monotonic seq totally orders same-transaction rows.

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `partner_id`     | uuid        | NOT NULL | internal |                     |
| `status_kind`    | text        | NOT NULL | internal |                     |
| `from_state`     | text        | ·        | internal |                     |
| `to_state`       | text        | NOT NULL | internal |                     |
| `reason`         | text        | NOT NULL | internal |                     |
| `actor_id`       | uuid        | NOT NULL | internal |                     |
| `occurred_at`    | timestamptz | NOT NULL | internal | `now()`             |
| `correlation_id` | uuid        | ·        | internal |                     |

## `crm.timeline_events`

Append-only partner activity timeline. Rows are emitted through emit_timeline_event(); INSERT+SELECT only, providing an attributable per-partner event stream.

| Column           | Type        | Null     | Class    | Default             |
| ---------------- | ----------- | -------- | -------- | ------------------- |
| `id`             | uuid        | NOT NULL | internal | `gen_random_uuid()` |
| `tenant_id`      | uuid        | NOT NULL | internal |                     |
| `partner_id`     | uuid        | NOT NULL | internal |                     |
| `event_type`     | text        | NOT NULL | internal |                     |
| `event_ref_type` | text        | ·        | internal |                     |
| `event_ref_id`   | uuid        | ·        | internal |                     |
| `title`          | text        | NOT NULL | internal |                     |
| `occurred_at`    | timestamptz | NOT NULL | internal | `now()`             |
| `actor_id`       | uuid        | ·        | internal |                     |
| `correlation_id` | uuid        | ·        | internal |                     |
