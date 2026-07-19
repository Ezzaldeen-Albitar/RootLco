# Phase 1-7 — Vehicle Grant Matrix

<!-- GENERATED from live veh introspection; do not hand-edit count tables. -->

Generated from the live `veh` schema. Totals: **23 tables, 320 columns, 29 functions, 57 triggers, 62 policies, 91 indexes, 54 foreign keys, 104 check constraints, 7 EXCLUDE constraints.**

The owner/migration role (`postgres` locally, the migration role in CI) owns
every object; application roles own nothing (verified). PUBLIC holds no table
privilege and no function EXECUTE. No app role holds DELETE anywhere in veh.

## Table grants

| Table                       | app_runtime            | app_readonly | app_worker | PUBLIC |
| --------------------------- | ---------------------- | ------------ | ---------- | ------ |
| `battery_masters`           | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `battery_readings`          | INSERT, SELECT         | SELECT       | —          | —      |
| `body_types`                | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `duplicate_candidates`      | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `engine_history`            | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `makes`                     | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `models`                    | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `odometer_readings`         | INSERT, SELECT         | SELECT       | —          | —      |
| `ownership_history`         | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `plate_history`             | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `powertrain_types`          | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `relationship_evidence`     | INSERT, SELECT         | SELECT       | —          | —      |
| `transmission_history`      | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `trims`                     | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `vehicle_alerts`            | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `vehicle_attribute_history` | INSERT, SELECT         | SELECT       | —          | —      |
| `vehicle_ev_profiles`       | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `vehicle_identifiers`       | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `vehicle_merges`            | INSERT, SELECT         | SELECT       | —          | —      |
| `vehicle_relationships`     | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `vehicle_status_history`    | INSERT, SELECT         | SELECT       | —          | —      |
| `vehicles`                  | INSERT, SELECT, UPDATE | SELECT       | —          | —      |
| `vin_verifications`         | INSERT, SELECT         | SELECT       | —          | —      |

## Function EXECUTE grants

Trigger-only guard functions are intentionally NOT executable by app roles
(REVOKE FROM PUBLIC, no grant); consumer-callable resolvers/validators are
granted to app_runtime + app_readonly.

| Function                         | app_runtime | app_readonly | app_worker |
| -------------------------------- | ----------- | ------------ | ---------- |
| `apply_vehicle_merge`            | —           | —            | —          |
| `emit_vehicle_attribute_history` | —           | —            | —          |
| `emit_vehicle_status_history`    | —           | —            | —          |
| `engine_at`                      | ✅          | ✅           | —          |
| `guard_ev_profile_powertrain`    | —           | —            | —          |
| `guard_model_make_scope`         | —           | —            | —          |
| `guard_odometer_reading`         | —           | —            | —          |
| `guard_status_history_coherence` | —           | —            | —          |
| `guard_temporal_close`           | —           | —            | —          |
| `guard_trim_model_scope`         | —           | —            | —          |
| `guard_vehicle_activation`       | —           | —            | —          |
| `guard_vehicle_catalog_refs`     | —           | —            | —          |
| `guard_vehicle_ev_powertrain`    | —           | —            | —          |
| `guard_vehicle_identity_removal` | —           | —            | —          |
| `guard_vehicle_merge`            | —           | —            | —          |
| `jsonb_no_raw_values`            | ✅          | ✅           | —          |
| `latest_odometer`                | ✅          | ✅           | —          |
| `normalize_plate`                | ✅          | ✅           | —          |
| `normalize_vin`                  | ✅          | ✅           | —          |
| `odometer_at`                    | ✅          | ✅           | —          |
| `owner_at`                       | ✅          | ✅           | —          |
| `plate_at`                       | ✅          | ✅           | —          |
| `relationships_at`               | ✅          | ✅           | —          |
| `resolve_vehicle_survivor`       | ✅          | ✅           | —          |
| `stamp_odometer_reading`         | —           | —            | —          |
| `stamp_vehicle_merge`            | —           | —            | —          |
| `transmission_at`                | ✅          | ✅           | —          |
| `valid_authorization_scope`      | ✅          | ✅           | —          |
| `valid_match_basis`              | ✅          | ✅           | —          |
