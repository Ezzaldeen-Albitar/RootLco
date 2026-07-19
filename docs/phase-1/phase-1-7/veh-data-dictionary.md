# Phase 1-7 — Vehicle Data Dictionary (phase annex)

<!-- GENERATED from live veh introspection; do not hand-edit count tables. -->

Generated from the live `veh` schema. Totals: **23 tables, 320 columns, 29 functions, 57 triggers, 62 policies, 91 indexes, 54 foreign keys, 104 check constraints, 7 EXCLUDE constraints.**

Column business meanings live in the central
[data dictionary](../../database/data-dictionary.md) (repo-wide guard-enforced
coverage); classification/search flags live in the
[classification registry](../../database/veh-personal-data-classification.json)
(validator-enforced). This annex adds, per table: the live column set with
classification, the behavioral model, and every constraint definition.

## `veh.battery_masters`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column                 | Type                     | Null | Default             | Class    | Searchable |
| ---------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                   | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`            | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`           | uuid                     | NO   | `—`                 | internal | —          |
| `battery_ref`          | text                     | YES  | `—`                 | internal | —          |
| `battery_role`         | text                     | NO   | `'traction'::text`  | internal | —          |
| `chemistry`            | text                     | YES  | `—`                 | internal | —          |
| `nominal_capacity_kwh` | numeric                  | YES  | `—`                 | internal | —          |
| `installed_on`         | date                     | YES  | `—`                 | internal | —          |
| `removed_on`           | date                     | YES  | `—`                 | internal | —          |
| `status`               | text                     | NO   | `'active'::text`    | internal | —          |
| `record_version`       | integer                  | NO   | `1`                 | internal | —          |
| `created_at`           | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`           | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`           | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`           | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`           | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`           | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (11)</summary>

- `ck_battery_masters_capacity`: `CHECK (((nominal_capacity_kwh IS NULL) OR (nominal_capacity_kwh >= (0)::numeric)))`
- `ck_battery_masters_chemistry`: `CHECK (((chemistry IS NULL) OR (chemistry = ANY (ARRAY['li_ion'::text, 'lfp'::text, 'nimh'::text, 'lead_acid'::text, 'other'::text]))))`
- `ck_battery_masters_ref_not_blank`: `CHECK (((battery_ref IS NULL) OR (btrim(battery_ref) <> ''::text)))`
- `ck_battery_masters_removed_after_installed`: `CHECK (((removed_on IS NULL) OR (installed_on IS NULL) OR (removed_on >= installed_on)))`
- `ck_battery_masters_removed_coherent`: `CHECK (((status = 'removed'::text) = (removed_on IS NOT NULL)))`
- `ck_battery_masters_role`: `CHECK ((battery_role = ANY (ARRAY['traction'::text, 'auxiliary'::text, 'other'::text])))`
- `ck_battery_masters_status`: `CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text])))`
- `fk_battery_masters_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_battery_masters_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_battery_masters`: `PRIMARY KEY (id)`
- `uq_battery_masters_tenant_id`: `UNIQUE (tenant_id, id)`

</details>

## `veh.battery_readings`

**Behavior:** Append-only (SELECT+INSERT only; UPDATE/DELETE → 42501; server-stamped attribution; monotonic `seq`).

| Column              | Type                     | Null | Default             | Class    | Searchable |
| ------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`         | uuid                     | NO   | `—`                 | internal | —          |
| `battery_master_id` | uuid                     | NO   | `—`                 | internal | —          |
| `reading_kind`      | text                     | NO   | `—`                 | internal | —          |
| `value`             | numeric                  | NO   | `—`                 | internal | —          |
| `unit`              | text                     | NO   | `—`                 | internal | —          |
| `measured_at`       | timestamp with time zone | NO   | `—`                 | internal | —          |
| `measured_by`       | uuid                     | YES  | `—`                 | internal | —          |
| `source`            | text                     | YES  | `—`                 | internal | —          |
| `correlation_id`    | uuid                     | YES  | `—`                 | internal | —          |
| `actor_id`          | uuid                     | NO   | `—`                 | internal | —          |
| `occurred_at`       | timestamp with time zone | NO   | `now()`             | internal | —          |
| `seq`               | bigint                   | NO   | `—`                 | internal | —          |

<details><summary>Constraints (6)</summary>

- `ck_battery_readings_kind`: `CHECK ((reading_kind = ANY (ARRAY['soh'::text, 'soc'::text, 'voltage'::text, 'other'::text])))`
- `ck_battery_readings_source_not_blank`: `CHECK (((source IS NULL) OR (btrim(source) <> ''::text)))`
- `ck_battery_readings_unit_not_blank`: `CHECK ((btrim(unit) <> ''::text))`
- `fk_battery_readings_battery`: `FOREIGN KEY (tenant_id, battery_master_id) REFERENCES veh.battery_masters(tenant_id, id) ON DELETE RESTRICT`
- `fk_battery_readings_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_battery_readings`: `PRIMARY KEY (id)`

</details>

## `veh.body_types`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column           | Type                     | Null | Default             | Class    | Searchable |
| ---------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `scope`          | text                     | NO   | `—`                 | internal | —          |
| `tenant_id`      | uuid                     | YES  | `—`                 | internal | —          |
| `code`           | text                     | NO   | `—`                 | internal | —          |
| `name`           | text                     | NO   | `—`                 | internal | —          |
| `status`         | text                     | NO   | `'active'::text`    | internal | —          |
| `record_version` | integer                  | NO   | `1`                 | internal | —          |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`     | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`     | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`     | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (7)</summary>

- `ck_body_types_code_format`: `CHECK ((code ~ '^[a-z][a-z0-9_]{1,62}$'::text))`
- `ck_body_types_name_not_blank`: `CHECK ((btrim(name) <> ''::text))`
- `ck_body_types_scope`: `CHECK ((scope = ANY (ARRAY['platform'::text, 'tenant'::text])))`
- `ck_body_types_scope_tenant`: `CHECK ((((scope = 'platform'::text) AND (tenant_id IS NULL)) OR ((scope = 'tenant'::text) AND (tenant_id IS NOT NULL))))`
- `ck_body_types_status`: `CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`
- `fk_body_types_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_body_types`: `PRIMARY KEY (id)`

</details>

## `veh.duplicate_candidates`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column           | Type                     | Null | Default             | Class    | Searchable |
| ---------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id_a`   | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id_b`   | uuid                     | NO   | `—`                 | internal | —          |
| `match_score`    | numeric                  | NO   | `—`                 | internal | —          |
| `match_basis`    | jsonb                    | NO   | `—`                 | internal | —          |
| `status`         | text                     | NO   | `'open'::text`      | internal | —          |
| `detected_at`    | timestamp with time zone | NO   | `now()`             | internal | —          |
| `reviewed_by`    | uuid                     | YES  | `—`                 | internal | —          |
| `reviewed_at`    | timestamp with time zone | YES  | `—`                 | internal | —          |
| `record_version` | integer                  | NO   | `1`                 | internal | —          |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`     | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`     | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (9)</summary>

- `ck_duplicate_candidates_basis`: `CHECK (veh.valid_match_basis(match_basis))`
- `ck_duplicate_candidates_order`: `CHECK ((vehicle_id_a < vehicle_id_b))`
- `ck_duplicate_candidates_review`: `CHECK (((reviewed_by IS NULL) = (reviewed_at IS NULL)))`
- `ck_duplicate_candidates_score`: `CHECK (((match_score >= (0)::numeric) AND (match_score <= (1)::numeric)))`
- `ck_duplicate_candidates_status`: `CHECK ((status = ANY (ARRAY['open'::text, 'dismissed'::text, 'merged'::text])))`
- `fk_duplicate_candidates_a`: `FOREIGN KEY (tenant_id, vehicle_id_a) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `fk_duplicate_candidates_b`: `FOREIGN KEY (tenant_id, vehicle_id_b) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `fk_duplicate_candidates_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_duplicate_candidates`: `PRIMARY KEY (id)`

</details>

## `veh.engine_history`

**Behavior:** Mutable-temporal interval (close-only `valid_to`; immutable identity; EXCLUDE non-overlap; no DELETE).

| Column            | Type                     | Null | Default             | Class    | Searchable |
| ----------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`              | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `displacement_cc` | integer                  | YES  | `—`                 | internal | —          |
| `power_kw`        | numeric                  | YES  | `—`                 | internal | —          |
| `fuel_note`       | text                     | YES  | `—`                 | internal | —          |
| `valid_from`      | date                     | NO   | `—`                 | internal | —          |
| `valid_to`        | date                     | YES  | `—`                 | internal | —          |
| `reason`          | text                     | YES  | `—`                 | internal | —          |
| `record_version`  | integer                  | NO   | `1`                 | internal | —          |
| `created_at`      | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`      | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`      | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`      | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (8)</summary>

- `ck_engine_history_displacement`: `CHECK (((displacement_cc IS NULL) OR (displacement_cc > 0)))`
- `ck_engine_history_fuel_not_blank`: `CHECK (((fuel_note IS NULL) OR (btrim(fuel_note) <> ''::text)))`
- `ck_engine_history_power`: `CHECK (((power_kw IS NULL) OR (power_kw >= (0)::numeric)))`
- `ck_engine_history_valid_range`: `CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))`
- `fk_engine_history_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_engine_history_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_engine_history`: `PRIMARY KEY (id)`
- `ex_engine_history_no_overlap`: `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&)`

</details>

## `veh.makes`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column           | Type                     | Null | Default             | Class    | Searchable |
| ---------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `scope`          | text                     | NO   | `—`                 | internal | —          |
| `tenant_id`      | uuid                     | YES  | `—`                 | internal | —          |
| `code`           | text                     | NO   | `—`                 | internal | —          |
| `name`           | text                     | NO   | `—`                 | internal | ✅         |
| `status`         | text                     | NO   | `'active'::text`    | internal | —          |
| `record_version` | integer                  | NO   | `1`                 | internal | —          |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`     | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`     | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`     | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (7)</summary>

- `ck_makes_code_format`: `CHECK ((code ~ '^[a-z][a-z0-9_]{1,62}$'::text))`
- `ck_makes_name_not_blank`: `CHECK ((btrim(name) <> ''::text))`
- `ck_makes_scope`: `CHECK ((scope = ANY (ARRAY['platform'::text, 'tenant'::text])))`
- `ck_makes_scope_tenant`: `CHECK ((((scope = 'platform'::text) AND (tenant_id IS NULL)) OR ((scope = 'tenant'::text) AND (tenant_id IS NOT NULL))))`
- `ck_makes_status`: `CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`
- `fk_makes_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_makes`: `PRIMARY KEY (id)`

</details>

## `veh.models`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column             | Type                     | Null | Default             | Class    | Searchable |
| ------------------ | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `scope`            | text                     | NO   | `—`                 | internal | —          |
| `tenant_id`        | uuid                     | YES  | `—`                 | internal | —          |
| `make_id`          | uuid                     | NO   | `—`                 | internal | —          |
| `code`             | text                     | NO   | `—`                 | internal | —          |
| `name`             | text                     | NO   | `—`                 | internal | ✅         |
| `first_model_year` | integer                  | YES  | `—`                 | internal | —          |
| `last_model_year`  | integer                  | YES  | `—`                 | internal | —          |
| `status`           | text                     | NO   | `'active'::text`    | internal | —          |
| `record_version`   | integer                  | NO   | `1`                 | internal | —          |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`       | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`       | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`       | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`       | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`       | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (9)</summary>

- `ck_models_code_format`: `CHECK ((code ~ '^[a-z][a-z0-9_]{1,62}$'::text))`
- `ck_models_name_not_blank`: `CHECK ((btrim(name) <> ''::text))`
- `ck_models_scope`: `CHECK ((scope = ANY (ARRAY['platform'::text, 'tenant'::text])))`
- `ck_models_scope_tenant`: `CHECK ((((scope = 'platform'::text) AND (tenant_id IS NULL)) OR ((scope = 'tenant'::text) AND (tenant_id IS NOT NULL))))`
- `ck_models_status`: `CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`
- `ck_models_year_range`: `CHECK ((((first_model_year IS NULL) OR ((first_model_year >= 1900) AND (first_model_year <= 2100))) AND ((last_model_year IS NULL) OR ((last_model_year >= 1900) AND (last_model_year <= 2100))) AND ((first_model_year IS NULL) OR (last_model_year IS NULL) OR (last_model_year >= first_model_year))))`
- `fk_models_make`: `FOREIGN KEY (make_id) REFERENCES veh.makes(id) ON DELETE RESTRICT`
- `fk_models_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_models`: `PRIMARY KEY (id)`

</details>

## `veh.odometer_readings`

**Behavior:** Append-only (SELECT+INSERT only; UPDATE/DELETE → 42501; server-stamped attribution; monotonic `seq`).

| Column              | Type                     | Null | Default             | Class    | Searchable |
| ------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`         | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`        | uuid                     | NO   | `—`                 | internal | —          |
| `value`             | numeric                  | NO   | `—`                 | internal | —          |
| `unit`              | text                     | NO   | `—`                 | internal | —          |
| `value_km`          | numeric                  | YES  | `generated`         | internal | —          |
| `observed_at`       | timestamp with time zone | NO   | `now()`             | internal | —          |
| `capture_method`    | text                     | NO   | `—`                 | internal | —          |
| `correction_of`     | uuid                     | YES  | `—`                 | internal | —          |
| `correction_reason` | text                     | YES  | `—`                 | internal | —          |
| `anomaly_flag`      | boolean                  | NO   | `false`             | internal | —          |
| `correlation_id`    | uuid                     | YES  | `—`                 | internal | —          |
| `recorded_by`       | uuid                     | NO   | `—`                 | internal | —          |
| `seq`               | bigint                   | NO   | `—`                 | internal | —          |

<details><summary>Constraints (11)</summary>

- `ck_odometer_readings_capture`: `CHECK ((capture_method = ANY (ARRAY['reception'::text, 'delivery'::text, 'manual'::text, 'correction'::text])))`
- `ck_odometer_readings_correction_meta`: `CHECK (
CASE
WHEN (capture_method = 'correction'::text) THEN ((correction_reason IS NOT NULL) AND (btrim(correction_reason) <> ''::text) AND (anomaly_flag = true))
ELSE ((correction_reason IS NULL) AND (anomaly_flag = false))
END)`
- `ck_odometer_readings_correction_ref`: `CHECK (((capture_method = 'correction'::text) = (correction_of IS NOT NULL)))`
- `ck_odometer_readings_not_self`: `CHECK (((correction_of IS NULL) OR (correction_of <> id)))`
- `ck_odometer_readings_unit`: `CHECK ((unit = ANY (ARRAY['km'::text, 'mi'::text])))`
- `ck_odometer_readings_value_nonneg`: `CHECK ((value >= (0)::numeric))`
- `fk_odometer_readings_correction`: `FOREIGN KEY (tenant_id, vehicle_id, correction_of) REFERENCES veh.odometer_readings(tenant_id, vehicle_id, id) ON DELETE RESTRICT`
- `fk_odometer_readings_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_odometer_readings_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_odometer_readings`: `PRIMARY KEY (id)`
- `uq_odometer_readings_vehicle_row`: `UNIQUE (tenant_id, vehicle_id, id)`

</details>

## `veh.ownership_history`

**Behavior:** Mutable-temporal interval (close-only `valid_to`; immutable identity; EXCLUDE non-overlap; no DELETE).

| Column            | Type                     | Null | Default             | Class    | Searchable |
| ----------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`              | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `partner_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `ownership_kind`  | text                     | NO   | `—`                 | internal | —          |
| `valid_from`      | date                     | NO   | `—`                 | internal | —          |
| `valid_to`        | date                     | YES  | `—`                 | internal | —          |
| `transfer_reason` | text                     | YES  | `—`                 | internal | —          |
| `record_version`  | integer                  | NO   | `1`                 | internal | —          |
| `created_at`      | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`      | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`      | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`      | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (9)</summary>

- `ck_ownership_history_kind`: `CHECK ((ownership_kind = ANY (ARRAY['registered_owner'::text, 'beneficial'::text, 'fleet'::text])))`
- `ck_ownership_history_reason_not_blank`: `CHECK (((transfer_reason IS NULL) OR (btrim(transfer_reason) <> ''::text)))`
- `ck_ownership_history_valid_range`: `CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))`
- `fk_ownership_history_partner`: `FOREIGN KEY (tenant_id, partner_id) REFERENCES crm.business_partners(tenant_id, id) ON DELETE RESTRICT`
- `fk_ownership_history_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_ownership_history_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_ownership_history`: `PRIMARY KEY (id)`
- `ex_ownership_history_registered`: `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&) WHERE ((ownership_kind = 'registered_owner'::text))`
- `ex_ownership_history_same_role`: `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, partner_id WITH =, ownership_kind WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&)`

</details>

## `veh.plate_history`

**Behavior:** Mutable-temporal interval (close-only `valid_to`; immutable identity; EXCLUDE non-overlap; no DELETE).

| Column             | Type                     | Null | Default             | Class    | Searchable |
| ------------------ | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`        | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `country_code`     | text                     | NO   | `—`                 | internal | —          |
| `plate_raw`        | text                     | NO   | `—`                 | internal | —          |
| `plate_normalized` | text                     | YES  | `generated`         | internal | ✅         |
| `valid_from`       | date                     | NO   | `—`                 | internal | —          |
| `valid_to`         | date                     | YES  | `—`                 | internal | —          |
| `source`           | text                     | YES  | `—`                 | internal | —          |
| `record_version`   | integer                  | NO   | `1`                 | internal | —          |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`       | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`       | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`       | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (9)</summary>

- `ck_plate_history_country`: `CHECK ((country_code ~ '^[A-Z]{2,3}$'::text))`
- `ck_plate_history_normalized_present`: `CHECK ((veh.normalize_plate(plate_raw) IS NOT NULL))`
- `ck_plate_history_raw_not_blank`: `CHECK ((btrim(plate_raw) <> ''::text))`
- `ck_plate_history_valid_range`: `CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))`
- `fk_plate_history_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_plate_history_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_plate_history`: `PRIMARY KEY (id)`
- `ex_plate_history_active_plate`: `EXCLUDE USING gist (tenant_id WITH =, country_code WITH =, plate_normalized WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&)`
- `ex_plate_history_no_overlap`: `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&)`

</details>

## `veh.powertrain_types`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column           | Type                     | Null | Default             | Class    | Searchable |
| ---------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `scope`          | text                     | NO   | `—`                 | internal | —          |
| `tenant_id`      | uuid                     | YES  | `—`                 | internal | —          |
| `code`           | text                     | NO   | `—`                 | internal | —          |
| `name`           | text                     | NO   | `—`                 | internal | —          |
| `category`       | text                     | NO   | `—`                 | internal | —          |
| `status`         | text                     | NO   | `'active'::text`    | internal | —          |
| `record_version` | integer                  | NO   | `1`                 | internal | —          |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`     | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`     | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`     | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (8)</summary>

- `ck_powertrain_types_category`: `CHECK ((category = ANY (ARRAY['ice'::text, 'ev'::text, 'hybrid'::text, 'phev'::text, 'other'::text])))`
- `ck_powertrain_types_code_format`: `CHECK ((code ~ '^[a-z][a-z0-9_]{1,62}$'::text))`
- `ck_powertrain_types_name_not_blank`: `CHECK ((btrim(name) <> ''::text))`
- `ck_powertrain_types_scope`: `CHECK ((scope = ANY (ARRAY['platform'::text, 'tenant'::text])))`
- `ck_powertrain_types_scope_tenant`: `CHECK ((((scope = 'platform'::text) AND (tenant_id IS NULL)) OR ((scope = 'tenant'::text) AND (tenant_id IS NOT NULL))))`
- `ck_powertrain_types_status`: `CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`
- `fk_powertrain_types_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_powertrain_types`: `PRIMARY KEY (id)`

</details>

## `veh.relationship_evidence`

**Behavior:** Append-only (SELECT+INSERT only; UPDATE/DELETE → 42501; server-stamped attribution; monotonic `seq`).

| Column            | Type                     | Null | Default             | Class    | Searchable |
| ----------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`              | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `relationship_id` | uuid                     | NO   | `—`                 | internal | —          |
| `document_id`     | uuid                     | YES  | `—`                 | internal | —          |
| `evidence_kind`   | text                     | NO   | `—`                 | internal | —          |
| `note`            | text                     | YES  | `—`                 | internal | —          |
| `correlation_id`  | uuid                     | YES  | `—`                 | internal | —          |
| `actor_id`        | uuid                     | NO   | `—`                 | internal | —          |
| `occurred_at`     | timestamp with time zone | NO   | `now()`             | internal | —          |
| `seq`             | bigint                   | NO   | `—`                 | internal | —          |

<details><summary>Constraints (6)</summary>

- `ck_relationship_evidence_kind_not_blank`: `CHECK ((btrim(evidence_kind) <> ''::text))`
- `ck_relationship_evidence_note_not_blank`: `CHECK (((note IS NULL) OR (btrim(note) <> ''::text)))`
- `fk_relationship_evidence_document`: `FOREIGN KEY (tenant_id, document_id) REFERENCES shared.documents(tenant_id, id) ON DELETE RESTRICT`
- `fk_relationship_evidence_relationship`: `FOREIGN KEY (tenant_id, relationship_id) REFERENCES veh.vehicle_relationships(tenant_id, id) ON DELETE RESTRICT`
- `fk_relationship_evidence_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_relationship_evidence`: `PRIMARY KEY (id)`

</details>

## `veh.transmission_history`

**Behavior:** Mutable-temporal interval (close-only `valid_to`; immutable identity; EXCLUDE non-overlap; no DELETE).

| Column                | Type                     | Null | Default             | Class    | Searchable |
| --------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                  | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`           | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`          | uuid                     | NO   | `—`                 | internal | —          |
| `transmission_type`   | text                     | NO   | `—`                 | internal | —          |
| `transmission_number` | text                     | YES  | `—`                 | internal | —          |
| `valid_from`          | date                     | NO   | `—`                 | internal | —          |
| `valid_to`            | date                     | YES  | `—`                 | internal | —          |
| `reason`              | text                     | YES  | `—`                 | internal | —          |
| `record_version`      | integer                  | NO   | `1`                 | internal | —          |
| `created_at`          | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`          | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`          | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`          | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (7)</summary>

- `ck_transmission_history_number_not_blank`: `CHECK (((transmission_number IS NULL) OR (btrim(transmission_number) <> ''::text)))`
- `ck_transmission_history_type`: `CHECK ((transmission_type = ANY (ARRAY['manual'::text, 'automatic'::text, 'cvt'::text, 'dct'::text, 'automated_manual'::text, 'direct_drive'::text, 'other'::text])))`
- `ck_transmission_history_valid_range`: `CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))`
- `fk_transmission_history_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_transmission_history_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_transmission_history`: `PRIMARY KEY (id)`
- `ex_transmission_history_no_overlap`: `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&)`

</details>

## `veh.trims`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column           | Type                     | Null | Default             | Class    | Searchable |
| ---------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `scope`          | text                     | NO   | `—`                 | internal | —          |
| `tenant_id`      | uuid                     | YES  | `—`                 | internal | —          |
| `model_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `code`           | text                     | NO   | `—`                 | internal | —          |
| `name`           | text                     | NO   | `—`                 | internal | ✅         |
| `status`         | text                     | NO   | `'active'::text`    | internal | —          |
| `record_version` | integer                  | NO   | `1`                 | internal | —          |
| `created_at`     | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`     | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`     | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`     | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`     | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (8)</summary>

- `ck_trims_code_format`: `CHECK ((code ~ '^[a-z][a-z0-9_]{1,62}$'::text))`
- `ck_trims_name_not_blank`: `CHECK ((btrim(name) <> ''::text))`
- `ck_trims_scope`: `CHECK ((scope = ANY (ARRAY['platform'::text, 'tenant'::text])))`
- `ck_trims_scope_tenant`: `CHECK ((((scope = 'platform'::text) AND (tenant_id IS NULL)) OR ((scope = 'tenant'::text) AND (tenant_id IS NOT NULL))))`
- `ck_trims_status`: `CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`
- `fk_trims_model`: `FOREIGN KEY (model_id) REFERENCES veh.models(id) ON DELETE RESTRICT`
- `fk_trims_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_trims`: `PRIMARY KEY (id)`

</details>

## `veh.vehicle_alerts`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column            | Type                     | Null | Default             | Class    | Searchable |
| ----------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`              | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `alert_type`      | text                     | NO   | `—`                 | internal | —          |
| `severity`        | text                     | NO   | `—`                 | internal | —          |
| `message`         | text                     | NO   | `—`                 | internal | —          |
| `effective_from`  | timestamp with time zone | NO   | `now()`             | internal | —          |
| `effective_to`    | timestamp with time zone | YES  | `—`                 | internal | —          |
| `is_active`       | boolean                  | NO   | `true`              | internal | —          |
| `acknowledged_by` | uuid                     | YES  | `—`                 | internal | —          |
| `acknowledged_at` | timestamp with time zone | YES  | `—`                 | internal | —          |
| `record_version`  | integer                  | NO   | `1`                 | internal | —          |
| `created_at`      | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`      | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`      | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`      | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`      | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`      | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (8)</summary>

- `ck_vehicle_alerts_ack_coherent`: `CHECK (((acknowledged_by IS NULL) = (acknowledged_at IS NULL)))`
- `ck_vehicle_alerts_interval`: `CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))`
- `ck_vehicle_alerts_message_not_blank`: `CHECK ((btrim(message) <> ''::text))`
- `ck_vehicle_alerts_severity`: `CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))`
- `ck_vehicle_alerts_type`: `CHECK ((alert_type = ANY (ARRAY['safety'::text, 'technical'::text, 'commercial'::text, 'other'::text])))`
- `fk_vehicle_alerts_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vehicle_alerts_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_vehicle_alerts`: `PRIMARY KEY (id)`

</details>

## `veh.vehicle_attribute_history`

**Behavior:** Append-only (SELECT+INSERT only; UPDATE/DELETE → 42501; server-stamped attribution; monotonic `seq`).

| Column           | Type                     | Null | Default             | Class    | Searchable |
| ---------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`     | uuid                     | NO   | `—`                 | internal | —          |
| `field_code`     | text                     | NO   | `—`                 | internal | —          |
| `old_value`      | text                     | YES  | `—`                 | internal | —          |
| `new_value`      | text                     | YES  | `—`                 | internal | —          |
| `correlation_id` | uuid                     | YES  | `—`                 | internal | —          |
| `actor_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `occurred_at`    | timestamp with time zone | NO   | `now()`             | internal | —          |
| `seq`            | bigint                   | NO   | `—`                 | internal | —          |

<details><summary>Constraints (4)</summary>

- `ck_vehicle_attribute_history_field_not_blank`: `CHECK ((btrim(field_code) <> ''::text))`
- `fk_vehicle_attribute_history_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vehicle_attribute_history_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_vehicle_attribute_history`: `PRIMARY KEY (id)`

</details>

## `veh.vehicle_ev_profiles`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column                 | Type                     | Null | Default             | Class    | Searchable |
| ---------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                   | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`            | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`           | uuid                     | NO   | `—`                 | internal | —          |
| `ev_kind`              | text                     | NO   | `—`                 | internal | —          |
| `usable_capacity_kwh`  | numeric                  | YES  | `—`                 | internal | —          |
| `charge_port_type`     | text                     | YES  | `—`                 | internal | —          |
| `high_voltage_warning` | boolean                  | NO   | `true`              | internal | —          |
| `record_version`       | integer                  | NO   | `1`                 | internal | —          |
| `created_at`           | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`           | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`           | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`           | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`           | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`           | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (6)</summary>

- `ck_vehicle_ev_profiles_capacity`: `CHECK (((usable_capacity_kwh IS NULL) OR (usable_capacity_kwh >= (0)::numeric)))`
- `ck_vehicle_ev_profiles_kind`: `CHECK ((ev_kind = ANY (ARRAY['bev'::text, 'hybrid'::text, 'phev'::text])))`
- `ck_vehicle_ev_profiles_port_not_blank`: `CHECK (((charge_port_type IS NULL) OR (btrim(charge_port_type) <> ''::text)))`
- `fk_vehicle_ev_profiles_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vehicle_ev_profiles_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_vehicle_ev_profiles`: `PRIMARY KEY (id)`

</details>

## `veh.vehicle_identifiers`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column             | Type                     | Null | Default             | Class      | Searchable |
| ------------------ | ------------------------ | ---- | ------------------- | ---------- | ---------- |
| `id`               | uuid                     | NO   | `gen_random_uuid()` | internal   | —          |
| `tenant_id`        | uuid                     | NO   | `—`                 | internal   | —          |
| `vehicle_id`       | uuid                     | NO   | `—`                 | internal   | —          |
| `identifier_type`  | text                     | NO   | `—`                 | internal   | —          |
| `raw_value`        | text                     | NO   | `—`                 | restricted | —          |
| `normalized_value` | text                     | NO   | `—`                 | restricted | —          |
| `is_primary`       | boolean                  | NO   | `false`             | internal   | —          |
| `status`           | text                     | NO   | `'active'::text`    | internal   | —          |
| `classification`   | text                     | NO   | `—`                 | internal   | —          |
| `verified_at`      | timestamp with time zone | YES  | `—`                 | internal   | —          |
| `record_version`   | integer                  | NO   | `1`                 | internal   | —          |
| `created_at`       | timestamp with time zone | NO   | `now()`             | internal   | —          |
| `created_by`       | uuid                     | NO   | `—`                 | internal   | —          |
| `updated_at`       | timestamp with time zone | YES  | `—`                 | internal   | —          |
| `updated_by`       | uuid                     | YES  | `—`                 | internal   | —          |
| `deleted_at`       | timestamp with time zone | YES  | `—`                 | internal   | —          |
| `deleted_by`       | uuid                     | YES  | `—`                 | internal   | —          |

<details><summary>Constraints (9)</summary>

- `ck_vehicle_identifiers_classification`: `CHECK ((classification = ANY (ARRAY['internal'::text, 'restricted'::text])))`
- `ck_vehicle_identifiers_normalized_not_blank`: `CHECK (((btrim(normalized_value) <> ''::text) AND (char_length(normalized_value) <= 512)))`
- `ck_vehicle_identifiers_raw_not_blank`: `CHECK (((btrim(raw_value) <> ''::text) AND (char_length(raw_value) <= 512)))`
- `ck_vehicle_identifiers_status`: `CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`
- `ck_vehicle_identifiers_type`: `CHECK ((identifier_type = ANY (ARRAY['vin'::text, 'chassis'::text, 'engine_no'::text, 'fleet_no'::text, 'other'::text])))`
- `ck_vehicle_identifiers_type_classification`: `CHECK ((((identifier_type = ANY (ARRAY['chassis'::text, 'engine_no'::text])) AND (classification = 'restricted'::text)) OR ((identifier_type = ANY (ARRAY['vin'::text, 'fleet_no'::text])) AND (classification = 'internal'::text)) OR (identifier_type = 'other'::text)))`
- `fk_vehicle_identifiers_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vehicle_identifiers_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_vehicle_identifiers`: `PRIMARY KEY (id)`

</details>

## `veh.vehicle_merges`

**Behavior:** Append-only (SELECT+INSERT only; UPDATE/DELETE → 42501; server-stamped attribution; monotonic `seq`).

| Column                | Type                     | Null | Default             | Class    | Searchable |
| --------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                  | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`           | uuid                     | NO   | `—`                 | internal | —          |
| `source_vehicle_id`   | uuid                     | NO   | `—`                 | internal | —          |
| `survivor_vehicle_id` | uuid                     | NO   | `—`                 | internal | —          |
| `merge_summary`       | jsonb                    | NO   | `'{}'::jsonb`       | internal | —          |
| `approval_ref`        | text                     | NO   | `—`                 | internal | —          |
| `merged_by`           | uuid                     | NO   | `—`                 | internal | —          |
| `merged_at`           | timestamp with time zone | NO   | `now()`             | internal | —          |
| `correlation_id`      | uuid                     | YES  | `—`                 | internal | —          |
| `seq`                 | bigint                   | NO   | `—`                 | internal | —          |

<details><summary>Constraints (8)</summary>

- `ck_vehicle_merges_approval_not_blank`: `CHECK ((btrim(approval_ref) <> ''::text))`
- `ck_vehicle_merges_distinct`: `CHECK ((source_vehicle_id <> survivor_vehicle_id))`
- `ck_vehicle_merges_summary`: `CHECK (((jsonb_typeof(merge_summary) = 'object'::text) AND veh.jsonb_no_raw_values(merge_summary)))`
- `fk_vehicle_merges_source`: `FOREIGN KEY (tenant_id, source_vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `fk_vehicle_merges_survivor`: `FOREIGN KEY (tenant_id, survivor_vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `fk_vehicle_merges_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `pk_vehicle_merges`: `PRIMARY KEY (id)`
- `uq_vehicle_merges_source`: `UNIQUE (tenant_id, source_vehicle_id)`

</details>

## `veh.vehicle_relationships`

**Behavior:** Mutable-temporal interval (close-only `valid_to`; immutable identity; EXCLUDE non-overlap; no DELETE).

| Column                | Type                     | Null | Default             | Class    | Searchable |
| --------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                  | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`           | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`          | uuid                     | NO   | `—`                 | internal | —          |
| `partner_id`          | uuid                     | NO   | `—`                 | internal | —          |
| `relationship_role`   | text                     | NO   | `—`                 | internal | —          |
| `valid_from`          | date                     | NO   | `—`                 | internal | —          |
| `valid_to`            | date                     | YES  | `—`                 | internal | —          |
| `authorization_scope` | jsonb                    | YES  | `—`                 | internal | —          |
| `granted_by`          | uuid                     | YES  | `—`                 | internal | —          |
| `record_version`      | integer                  | NO   | `1`                 | internal | —          |
| `created_at`          | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`          | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`          | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`          | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (11)</summary>

- `ck_vehicle_relationships_role`: `CHECK ((relationship_role = ANY (ARRAY['owner'::text, 'user'::text, 'driver'::text, 'fleet_operator'::text, 'payer'::text, 'authorized_person'::text, 'service_requester'::text])))`
- `ck_vehicle_relationships_scope_granted`: `CHECK (((authorization_scope IS NULL) OR (granted_by IS NOT NULL)))`
- `ck_vehicle_relationships_scope_role`: `CHECK (((authorization_scope IS NULL) OR (relationship_role = 'authorized_person'::text)))`
- `ck_vehicle_relationships_scope_valid`: `CHECK (veh.valid_authorization_scope(authorization_scope))`
- `ck_vehicle_relationships_valid_range`: `CHECK (((valid_to IS NULL) OR (valid_to > valid_from)))`
- `fk_vehicle_relationships_partner`: `FOREIGN KEY (tenant_id, partner_id) REFERENCES crm.business_partners(tenant_id, id) ON DELETE RESTRICT`
- `fk_vehicle_relationships_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vehicle_relationships_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_vehicle_relationships`: `PRIMARY KEY (id)`
- `uq_vehicle_relationships_tenant_id`: `UNIQUE (tenant_id, id)`
- `ex_vehicle_relationships_no_overlap`: `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, partner_id WITH =, relationship_role WITH =, daterange(valid_from, valid_to, '[)'::text) WITH &&)`

</details>

## `veh.vehicle_status_history`

**Behavior:** Append-only (SELECT+INSERT only; UPDATE/DELETE → 42501; server-stamped attribution; monotonic `seq`).

| Column           | Type                     | Null | Default             | Class    | Searchable |
| ---------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`             | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`     | uuid                     | NO   | `—`                 | internal | —          |
| `status_kind`    | text                     | NO   | `—`                 | internal | —          |
| `from_state`     | text                     | YES  | `—`                 | internal | —          |
| `to_state`       | text                     | NO   | `—`                 | internal | —          |
| `correlation_id` | uuid                     | YES  | `—`                 | internal | —          |
| `actor_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `occurred_at`    | timestamp with time zone | NO   | `now()`             | internal | —          |
| `seq`            | bigint                   | NO   | `—`                 | internal | —          |

<details><summary>Constraints (6)</summary>

- `ck_vehicle_status_history_kind`: `CHECK ((status_kind = ANY (ARRAY['lifecycle'::text, 'workshop'::text])))`
- `ck_vehicle_status_history_state_change`: `CHECK ((from_state IS DISTINCT FROM to_state))`
- `ck_vehicle_status_history_states`: `CHECK ((((status_kind = 'lifecycle'::text) AND (to_state = ANY (ARRAY['draft'::text, 'active'::text, 'inactive'::text, 'merged'::text, 'scrapped'::text])) AND ((from_state IS NULL) OR (from_state = ANY (ARRAY['draft'::text, 'active'::text, 'inactive'::text, 'merged'::text, 'scrapped'::text])))) OR ((status_kind = 'workshop'::text) AND (to_state = ANY (ARRAY['none'::text, 'in_workshop'::text, 'awaiting_parts'::text, 'ready_for_delivery'::text])) AND ((from_state IS NULL) OR (from_state = ANY (ARRAY['none'::text, 'in_workshop'::text, 'awaiting_parts'::text, 'ready_for_delivery'::text]))))))`
- `fk_vehicle_status_history_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vehicle_status_history_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_vehicle_status_history`: `PRIMARY KEY (id)`

</details>

## `veh.vehicles`

**Behavior:** Mutable master/config (touch metadata + immutable identity columns; soft delete where applicable; no DELETE).

| Column                | Type                     | Null | Default             | Class    | Searchable |
| --------------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`                  | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`           | uuid                     | NO   | `—`                 | internal | —          |
| `display_number`      | text                     | YES  | `—`                 | internal | ✅         |
| `vin_raw`             | text                     | YES  | `—`                 | internal | —          |
| `vin_normalized`      | text                     | YES  | `generated`         | internal | ✅         |
| `make_id`             | uuid                     | YES  | `—`                 | internal | —          |
| `model_id`            | uuid                     | YES  | `—`                 | internal | —          |
| `trim_id`             | uuid                     | YES  | `—`                 | internal | —          |
| `model_year`          | integer                  | YES  | `—`                 | internal | —          |
| `body_type_id`        | uuid                     | YES  | `—`                 | internal | —          |
| `powertrain_type_id`  | uuid                     | YES  | `—`                 | internal | —          |
| `powertrain_category` | text                     | NO   | `'ice'::text`       | internal | —          |
| `color`               | text                     | YES  | `—`                 | internal | —          |
| `lifecycle_status`    | text                     | NO   | `'draft'::text`     | internal | —          |
| `workshop_status`     | text                     | NO   | `'none'::text`      | internal | —          |
| `merged_into_id`      | uuid                     | YES  | `—`                 | internal | —          |
| `record_version`      | integer                  | NO   | `1`                 | internal | —          |
| `created_at`          | timestamp with time zone | NO   | `now()`             | internal | —          |
| `created_by`          | uuid                     | NO   | `—`                 | internal | —          |
| `updated_at`          | timestamp with time zone | YES  | `—`                 | internal | —          |
| `updated_by`          | uuid                     | YES  | `—`                 | internal | —          |
| `deleted_at`          | timestamp with time zone | YES  | `—`                 | internal | —          |
| `deleted_by`          | uuid                     | YES  | `—`                 | internal | —          |

<details><summary>Constraints (19)</summary>

- `ck_vehicles_color_not_blank`: `CHECK (((color IS NULL) OR (btrim(color) <> ''::text)))`
- `ck_vehicles_display_number_not_blank`: `CHECK (((display_number IS NULL) OR (btrim(display_number) <> ''::text)))`
- `ck_vehicles_lifecycle`: `CHECK ((lifecycle_status = ANY (ARRAY['draft'::text, 'active'::text, 'inactive'::text, 'merged'::text, 'scrapped'::text])))`
- `ck_vehicles_merged_coherent`: `CHECK (((lifecycle_status = 'merged'::text) = (merged_into_id IS NOT NULL)))`
- `ck_vehicles_merged_not_self`: `CHECK (((merged_into_id IS NULL) OR (merged_into_id <> id)))`
- `ck_vehicles_model_year`: `CHECK (((model_year IS NULL) OR ((model_year >= 1900) AND (model_year <= 2100))))`
- `ck_vehicles_powertrain_category`: `CHECK ((powertrain_category = ANY (ARRAY['ice'::text, 'ev'::text, 'hybrid'::text, 'phev'::text, 'other'::text])))`
- `ck_vehicles_terminal_workshop`: `CHECK (((lifecycle_status <> ALL (ARRAY['merged'::text, 'scrapped'::text])) OR (workshop_status = 'none'::text)))`
- `ck_vehicles_vin_raw_not_blank`: `CHECK (((vin_raw IS NULL) OR (btrim(vin_raw) <> ''::text)))`
- `ck_vehicles_workshop`: `CHECK ((workshop_status = ANY (ARRAY['none'::text, 'in_workshop'::text, 'awaiting_parts'::text, 'ready_for_delivery'::text])))`
- `fk_vehicles_body_type`: `FOREIGN KEY (body_type_id) REFERENCES veh.body_types(id) ON DELETE RESTRICT`
- `fk_vehicles_make`: `FOREIGN KEY (make_id) REFERENCES veh.makes(id) ON DELETE RESTRICT`
- `fk_vehicles_merged_into`: `FOREIGN KEY (tenant_id, merged_into_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `fk_vehicles_model`: `FOREIGN KEY (model_id) REFERENCES veh.models(id) ON DELETE RESTRICT`
- `fk_vehicles_powertrain_type`: `FOREIGN KEY (powertrain_type_id) REFERENCES veh.powertrain_types(id) ON DELETE RESTRICT`
- `fk_vehicles_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vehicles_trim`: `FOREIGN KEY (trim_id) REFERENCES veh.trims(id) ON DELETE RESTRICT`
- `pk_vehicles`: `PRIMARY KEY (id)`
- `uq_vehicles_tenant_id`: `UNIQUE (tenant_id, id)`

</details>

## `veh.vin_verifications`

**Behavior:** Append-only (SELECT+INSERT only; UPDATE/DELETE → 42501; server-stamped attribution; monotonic `seq`).

| Column            | Type                     | Null | Default             | Class    | Searchable |
| ----------------- | ------------------------ | ---- | ------------------- | -------- | ---------- |
| `id`              | uuid                     | NO   | `gen_random_uuid()` | internal | —          |
| `tenant_id`       | uuid                     | NO   | `—`                 | internal | —          |
| `vehicle_id`      | uuid                     | NO   | `—`                 | internal | —          |
| `vin_checked`     | text                     | NO   | `—`                 | internal | —          |
| `check_kind`      | text                     | NO   | `—`                 | internal | —          |
| `result`          | text                     | NO   | `—`                 | internal | —          |
| `override_reason` | text                     | YES  | `—`                 | internal | —          |
| `correlation_id`  | uuid                     | YES  | `—`                 | internal | —          |
| `actor_id`        | uuid                     | NO   | `—`                 | internal | —          |
| `occurred_at`     | timestamp with time zone | NO   | `now()`             | internal | —          |
| `seq`             | bigint                   | NO   | `—`                 | internal | —          |

<details><summary>Constraints (7)</summary>

- `ck_vin_verifications_check_kind`: `CHECK ((check_kind = ANY (ARRAY['checksum'::text, 'format'::text, 'manual'::text, 'external'::text])))`
- `ck_vin_verifications_override_reason`: `CHECK (((result = 'overridden'::text) = ((override_reason IS NOT NULL) AND (btrim(override_reason) <> ''::text))))`
- `ck_vin_verifications_result`: `CHECK ((result = ANY (ARRAY['passed'::text, 'failed'::text, 'overridden'::text])))`
- `ck_vin_verifications_vin_not_blank`: `CHECK ((btrim(vin_checked) <> ''::text))`
- `fk_vin_verifications_tenant`: `FOREIGN KEY (tenant_id) REFERENCES org.tenants(id) ON DELETE RESTRICT`
- `fk_vin_verifications_vehicle`: `FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles(tenant_id, id) ON DELETE RESTRICT`
- `pk_vin_verifications`: `PRIMARY KEY (id)`

</details>
