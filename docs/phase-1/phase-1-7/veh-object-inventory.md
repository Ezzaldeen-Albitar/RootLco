# Phase 1-7 — Vehicle Object Inventory

<!-- GENERATED from live veh introspection; do not hand-edit count tables. -->

Generated from the live `veh` schema. Totals: **23 tables, 320 columns, 29 functions, 57 triggers, 62 policies, 91 indexes, 54 foreign keys, 104 check constraints, 7 EXCLUDE constraints.**

## Tables (23)

| Table                       | Columns | RLS forced |
| --------------------------- | ------- | ---------- |
| `battery_masters`           | 17      | ✅         |
| `battery_readings`          | 13      | ✅         |
| `body_types`                | 13      | ✅         |
| `duplicate_candidates`      | 15      | ✅         |
| `engine_history`            | 14      | ✅         |
| `makes`                     | 13      | ✅         |
| `models`                    | 16      | ✅         |
| `odometer_readings`         | 14      | ✅         |
| `ownership_history`         | 13      | ✅         |
| `plate_history`             | 14      | ✅         |
| `powertrain_types`          | 14      | ✅         |
| `relationship_evidence`     | 10      | ✅         |
| `transmission_history`      | 13      | ✅         |
| `trims`                     | 14      | ✅         |
| `vehicle_alerts`            | 18      | ✅         |
| `vehicle_attribute_history` | 10      | ✅         |
| `vehicle_ev_profiles`       | 14      | ✅         |
| `vehicle_identifiers`       | 17      | ✅         |
| `vehicle_merges`            | 10      | ✅         |
| `vehicle_relationships`     | 14      | ✅         |
| `vehicle_status_history`    | 10      | ✅         |
| `vehicles`                  | 23      | ✅         |
| `vin_verifications`         | 11      | ✅         |

## Functions (29)

All `SECURITY INVOKER`, `search_path=''`. No `SECURITY DEFINER` exists in `veh`.

| Function                         | Arguments                                          |
| -------------------------------- | -------------------------------------------------- |
| `apply_vehicle_merge`            | `—`                                                |
| `emit_vehicle_attribute_history` | `—`                                                |
| `emit_vehicle_status_history`    | `—`                                                |
| `engine_at`                      | `p_vehicle_id uuid, p_at date`                     |
| `guard_ev_profile_powertrain`    | `—`                                                |
| `guard_model_make_scope`         | `—`                                                |
| `guard_odometer_reading`         | `—`                                                |
| `guard_status_history_coherence` | `—`                                                |
| `guard_temporal_close`           | `—`                                                |
| `guard_trim_model_scope`         | `—`                                                |
| `guard_vehicle_activation`       | `—`                                                |
| `guard_vehicle_catalog_refs`     | `—`                                                |
| `guard_vehicle_ev_powertrain`    | `—`                                                |
| `guard_vehicle_identity_removal` | `—`                                                |
| `guard_vehicle_merge`            | `—`                                                |
| `jsonb_no_raw_values`            | `p jsonb`                                          |
| `latest_odometer`                | `p_vehicle_id uuid`                                |
| `normalize_plate`                | `p_value text`                                     |
| `normalize_vin`                  | `p_value text`                                     |
| `odometer_at`                    | `p_vehicle_id uuid, p_at timestamp with time zone` |
| `owner_at`                       | `p_vehicle_id uuid, p_at date`                     |
| `plate_at`                       | `p_vehicle_id uuid, p_at date`                     |
| `relationships_at`               | `p_vehicle_id uuid, p_at date`                     |
| `resolve_vehicle_survivor`       | `p_vehicle_id uuid`                                |
| `stamp_odometer_reading`         | `—`                                                |
| `stamp_vehicle_merge`            | `—`                                                |
| `transmission_at`                | `p_vehicle_id uuid, p_at date`                     |
| `valid_authorization_scope`      | `p jsonb`                                          |
| `valid_match_basis`              | `p jsonb`                                          |

## Triggers (57)

| Trigger                                   | Table                       |
| ----------------------------------------- | --------------------------- |
| `tg_battery_masters_immutable`            | `battery_masters`           |
| `tg_battery_masters_touch_metadata`       | `battery_masters`           |
| `tg_battery_readings_stamp`               | `battery_readings`          |
| `tg_body_types_immutable`                 | `body_types`                |
| `tg_body_types_touch_metadata`            | `body_types`                |
| `tg_duplicate_candidates_immutable`       | `duplicate_candidates`      |
| `tg_duplicate_candidates_touch_metadata`  | `duplicate_candidates`      |
| `tg_engine_history_close`                 | `engine_history`            |
| `tg_engine_history_immutable`             | `engine_history`            |
| `tg_engine_history_touch_metadata`        | `engine_history`            |
| `tg_makes_immutable`                      | `makes`                     |
| `tg_makes_touch_metadata`                 | `makes`                     |
| `tg_models_immutable`                     | `models`                    |
| `tg_models_make_scope`                    | `models`                    |
| `tg_models_touch_metadata`                | `models`                    |
| `tg_odometer_readings_guard`              | `odometer_readings`         |
| `tg_odometer_readings_stamp`              | `odometer_readings`         |
| `tg_ownership_history_close`              | `ownership_history`         |
| `tg_ownership_history_immutable`          | `ownership_history`         |
| `tg_ownership_history_touch_metadata`     | `ownership_history`         |
| `tg_plate_history_close`                  | `plate_history`             |
| `tg_plate_history_immutable`              | `plate_history`             |
| `tg_plate_history_touch_metadata`         | `plate_history`             |
| `tg_powertrain_types_immutable`           | `powertrain_types`          |
| `tg_powertrain_types_touch_metadata`      | `powertrain_types`          |
| `tg_relationship_evidence_stamp`          | `relationship_evidence`     |
| `tg_transmission_history_close`           | `transmission_history`      |
| `tg_transmission_history_immutable`       | `transmission_history`      |
| `tg_transmission_history_touch_metadata`  | `transmission_history`      |
| `tg_trims_immutable`                      | `trims`                     |
| `tg_trims_model_scope`                    | `trims`                     |
| `tg_trims_touch_metadata`                 | `trims`                     |
| `tg_vehicle_alerts_immutable`             | `vehicle_alerts`            |
| `tg_vehicle_alerts_touch_metadata`        | `vehicle_alerts`            |
| `tg_vehicle_attribute_history_stamp`      | `vehicle_attribute_history` |
| `tg_vehicle_ev_profiles_immutable`        | `vehicle_ev_profiles`       |
| `tg_vehicle_ev_profiles_powertrain`       | `vehicle_ev_profiles`       |
| `tg_vehicle_ev_profiles_touch_metadata`   | `vehicle_ev_profiles`       |
| `tg_vehicle_identifiers_identity_removal` | `vehicle_identifiers`       |
| `tg_vehicle_identifiers_immutable`        | `vehicle_identifiers`       |
| `tg_vehicle_identifiers_touch_metadata`   | `vehicle_identifiers`       |
| `tg_vehicle_merges_apply`                 | `vehicle_merges`            |
| `tg_vehicle_merges_stamp`                 | `vehicle_merges`            |
| `tg_vehicle_relationships_close`          | `vehicle_relationships`     |
| `tg_vehicle_relationships_immutable`      | `vehicle_relationships`     |
| `tg_vehicle_relationships_touch_metadata` | `vehicle_relationships`     |
| `tg_vehicle_status_history_coherence`     | `vehicle_status_history`    |
| `tg_vehicle_status_history_stamp`         | `vehicle_status_history`    |
| `tg_vehicles_activation_guard`            | `vehicles`                  |
| `tg_vehicles_attribute_history`           | `vehicles`                  |
| `tg_vehicles_catalog_refs`                | `vehicles`                  |
| `tg_vehicles_ev_powertrain`               | `vehicles`                  |
| `tg_vehicles_immutable`                   | `vehicles`                  |
| `tg_vehicles_merge_guard`                 | `vehicles`                  |
| `tg_vehicles_status_history`              | `vehicles`                  |
| `tg_vehicles_touch_metadata`              | `vehicles`                  |
| `tg_vin_verifications_stamp`              | `vin_verifications`         |

Indexes (91) are inventoried with definitions in the
[index and query-plan review](../../database/veh-index-query-plan-review.md).
