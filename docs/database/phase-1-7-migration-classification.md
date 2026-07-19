# Phase 1-7 Migration Classification

16 forward-only veh migrations, `20260720090000`–`20260720105000`, applied
strictly after the last P1-06 migration (`20260719106000`). No merged migration
(P1-02..P1-06) was modified — enforced by the CI migration-immutability diff.

**Roll-forward classification:** every migration is additive (new objects only;
no ALTER of a previously-merged object, no data migration). Full apply from an
empty database is rehearsed in the clean-room run (evidence register).

**Rollback classification:** every migration header carries the standard
statement — _ROLLBACK-SAFE while unused (structure only, no data);
roll-forward-only once rows exist. Forward-only — no down script._ No unsafe
fake down-scripts exist anywhere in the repository, by standard.

| #   | Migration                                            | Type(s)                      | Creates                                                                                                                                                |
| --- | ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `20260720090000_veh_normalization.sql`               | function                     | `normalize_vin`, `normalize_plate`                                                                                                                     |
| 2   | `20260720091000_veh_reference_catalogs.sql`          | schema + function + security | 5 dual-scope catalogs, hierarchy scope guards, per-scope uniqueness, RLS/grants                                                                        |
| 3   | `20260720092000_veh_vehicles.sql`                    | schema + function + security | Vehicle master, catalog-ref + merge guards, active-VIN/display uniqueness, RLS/grants                                                                  |
| 4   | `20260720093000_veh_vehicle_identifiers.sql`         | schema + function + security | identifier ledger, sensitive row gate, activation/identity-removal guards                                                                              |
| 5   | `20260720094000_veh_vin_verifications.sql`           | schema + security            | append-only VIN verification ledger                                                                                                                    |
| 6   | `20260720095000_veh_vehicle_attribute_history.sql`   | schema + function + security | append-only attribute history + emit trigger                                                                                                           |
| 7   | `20260720096000_veh_engine_transmission_history.sql` | schema + function + security | mutable-temporal engine/transmission + `guard_temporal_close` + resolvers                                                                              |
| 8   | `20260720097000_veh_ev_and_battery.sql`              | schema + function + security | EV profiles (dual powertrain guard), battery masters + readings                                                                                        |
| 9   | `20260720098000_veh_plate_history.sql`               | schema + function + security | plate history (per-Vehicle + cross-Vehicle EXCLUDE) + `plate_at`                                                                                       |
| 10  | `20260720099000_veh_ownership_history.sql`           | schema + function + security | ownership intervals (registered exclusivity) + `owner_at`                                                                                              |
| 11  | `20260720100000_veh_relationships_and_evidence.sql`  | schema + function + security | 7-role relationships + scope validator + append-only evidence                                                                                          |
| 12  | `20260720101000_veh_odometer_readings.sql`           | schema + function + security | append-only odometer + correction model + resolvers                                                                                                    |
| 13  | `20260720102000_veh_vehicle_status_history.sql`      | schema + function + security | append-only status ledger + coherence guard + emit trigger                                                                                             |
| 14  | `20260720103000_veh_vehicle_alerts.sql`              | schema + security            | Vehicle alerts                                                                                                                                         |
| 15  | `20260720104000_veh_duplicates_merges.sql`           | schema + function + security | duplicate candidates (positive-schema basis), merge record + atomic primitive + survivor resolver                                                      |
| 16  | `20260720105000_veh_review_hardening.sql`            | function + security          | red-team forward correction: RT-1 activation guard fires on VIN change; RT-2 EV-profile guard fires on un-soft-delete; RT-3 honest match-basis comment |

No `index`-only and no `reference configuration` migration exists in this
phase: every index ships in the migration that creates its table (FK-index
standard), and veh ships **zero** seed/reference rows (no-fake-data policy).

Extension dependency: `btree_gist` (EXCLUDE constraints) — already installed by
`0001_extensions.sql` and asserted by the foundation extension register test.
