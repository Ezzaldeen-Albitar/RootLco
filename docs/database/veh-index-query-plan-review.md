# Vehicle Index and Query-Plan Review (P1-07-DB-020)

Generated from LIVE introspection and `EXPLAIN (COSTS OFF)` against the local
canonical PostgreSQL (all P1-07 migrations applied). Business tables are empty
by policy in this environment, so plans were captured with
`SET LOCAL enable_seqscan = off` to force the planner to reveal the index path
that serves each access pattern (on empty/small tables the planner would
otherwise prefer a trivial sequential scan). This proves index APPLICABILITY —
production plan selection will depend on data volume and statistics.

## Audit results (live)

| Check                                                   | Result                            |
| ------------------------------------------------------- | --------------------------------- |
| veh foreign keys                                        | 54                                |
| veh indexes (total)                                     | 91                                |
| veh unique indexes                                      | 45                                |
| veh partial indexes                                     | 19                                |
| veh EXCLUDE constraints (gist)                          | 7                                 |
| FKs without a non-partial leading-column covering index | **0 — PASS** (P1-03-DB-017 guard) |
| Exact-duplicate non-partial indexes                     | **0 — PASS**                      |

Redundancy note: no two non-partial veh indexes share an identical column list
(guard above). Partial-unique indexes intentionally overlap non-partial FK
indexes on leading columns — the partial index enforces a business rule
(active-VIN, active-plate, one-open-candidate, one-active-traction-battery)
while the non-partial index satisfies the FK-coverage standard; both are
required and neither is redundant.

## Query-plan evidence (24 access patterns)

### Vehicle by tenant + display number

Expected index: `uq_vehicles_active_display_number`

```sql
SELECT * FROM veh.vehicles WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND display_number='VEH-000001' AND deleted_at IS NULL
```

```text
Index Scan using ix_vehicles_workshop on vehicles
  Index Cond: (tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid)
  Filter: ((deleted_at IS NULL) AND (display_number = 'VEH-000001'::text))
```

### Vehicle by tenant + normalized VIN (active)

Expected index: `uq_vehicles_active_vin`

```sql
SELECT * FROM veh.vehicles WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vin_normalized='1HGCM82633A004352' AND deleted_at IS NULL AND lifecycle_status <> 'merged'
```

```text
Index Scan using uq_vehicles_active_vin on vehicles
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vin_normalized = '1HGCM82633A004352'::text))
```

### Alternate identifier lookup (active)

Expected index: `uq_vehicle_identifiers_active`

```sql
SELECT * FROM veh.vehicle_identifiers WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND identifier_type='chassis' AND normalized_value='CH123' AND status='active' AND deleted_at IS NULL
```

```text
Index Scan using uq_vehicle_identifiers_active on vehicle_identifiers
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (identifier_type = 'chassis'::text) AND (normalized_value = 'CH123'::text))
```

### Vehicles by lifecycle status

Expected index: `ix_vehicles_lifecycle`

```sql
SELECT id FROM veh.vehicles WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND lifecycle_status='active'
```

```text
Index Scan using ix_vehicles_workshop on vehicles
  Index Cond: (tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid)
  Filter: (lifecycle_status = 'active'::text)
```

### Vehicles by workshop status

Expected index: `ix_vehicles_workshop`

```sql
SELECT id FROM veh.vehicles WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND workshop_status='in_workshop'
```

```text
Index Scan using ix_vehicles_workshop on vehicles
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (workshop_status = 'in_workshop'::text))
```

### Current plate

Expected index: `ix_plate_history_vehicle`

```sql
SELECT * FROM veh.plate_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND valid_to IS NULL
```

```text
Index Scan using ex_plate_history_no_overlap on plate_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
  Filter: (valid_to IS NULL)
```

### Plate at time (range containment)

Expected index: `ex_plate_history_no_overlap (gist)`

```sql
SELECT * FROM veh.plate_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND daterange(valid_from, valid_to, '[)') @> DATE '2024-06-01'
```

```text
Index Scan using ex_plate_history_active_plate on plate_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (daterange(valid_from, valid_to, '[)'::text) @> '2024-06-01'::date))
  Filter: (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid)
```

### Current registered owner

Expected index: `ix_ownership_history_vehicle`

```sql
SELECT partner_id FROM veh.ownership_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND ownership_kind='registered_owner' AND valid_to IS NULL
```

```text
Index Scan using ex_ownership_history_registered on ownership_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
  Filter: (valid_to IS NULL)
```

### Owner at time

Expected index: `ex_ownership_history_registered (gist)`

```sql
SELECT partner_id FROM veh.ownership_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND ownership_kind='registered_owner' AND daterange(valid_from, valid_to, '[)') @> DATE '2024-06-01'
```

```text
Index Scan using ex_ownership_history_registered on ownership_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid) AND (daterange(valid_from, valid_to, '[)'::text) @> '2024-06-01'::date))
```

### Active Vehicle relationships

Expected index: `ix_vehicle_relationships_vehicle`

```sql
SELECT * FROM veh.vehicle_relationships WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND valid_to IS NULL
```

```text
Index Scan using ex_vehicle_relationships_no_overlap on vehicle_relationships
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
  Filter: (valid_to IS NULL)
```

### Relationships at time

Expected index: `ex_vehicle_relationships_no_overlap (gist)`

```sql
SELECT * FROM veh.vehicle_relationships WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND daterange(valid_from, valid_to, '[)') @> DATE '2024-06-01'
```

```text
Index Scan using ex_vehicle_relationships_no_overlap on vehicle_relationships
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid) AND (daterange(valid_from, valid_to, '[)'::text) @> '2024-06-01'::date))
```

### Current engine

Expected index: `ix_engine_history_vehicle`

```sql
SELECT * FROM veh.engine_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND valid_to IS NULL
```

```text
Index Scan using ex_engine_history_no_overlap on engine_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
  Filter: (valid_to IS NULL)
```

### Engine at time

Expected index: `ex_engine_history_no_overlap (gist)`

```sql
SELECT * FROM veh.engine_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND daterange(valid_from, valid_to, '[)') @> DATE '2024-06-01'
```

```text
Index Scan using ex_engine_history_no_overlap on engine_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid) AND (daterange(valid_from, valid_to, '[)'::text) @> '2024-06-01'::date))
```

### Current transmission

Expected index: `ix_transmission_history_vehicle`

```sql
SELECT * FROM veh.transmission_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND valid_to IS NULL
```

```text
Index Scan using ex_transmission_history_no_overlap on transmission_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
  Filter: (valid_to IS NULL)
```

### Transmission at time

Expected index: `ex_transmission_history_no_overlap (gist)`

```sql
SELECT * FROM veh.transmission_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND daterange(valid_from, valid_to, '[)') @> DATE '2024-06-01'
```

```text
Index Scan using ex_transmission_history_no_overlap on transmission_history
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid) AND (daterange(valid_from, valid_to, '[)'::text) @> '2024-06-01'::date))
```

### EV profile

Expected index: `uq_vehicle_ev_profiles_vehicle`

```sql
SELECT * FROM veh.vehicle_ev_profiles WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND deleted_at IS NULL
```

```text
Index Scan using uq_vehicle_ev_profiles_vehicle on vehicle_ev_profiles
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
```

### Battery reading series by time

Expected index: `ix_battery_readings_master`

```sql
SELECT * FROM veh.battery_readings WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND battery_master_id='a0000000-0000-4000-8000-000000000002' ORDER BY measured_at DESC, seq DESC LIMIT 50
```

```text
Limit
  ->  Index Scan using ix_battery_readings_battery on battery_readings
        Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (battery_master_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
```

### Latest odometer reading

Expected index: `ix_odometer_readings_vehicle`

```sql
SELECT * FROM veh.odometer_readings WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' ORDER BY observed_at DESC, seq DESC LIMIT 1
```

```text
Limit
  ->  Index Scan using ix_odometer_readings_vehicle on odometer_readings
        Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
```

### Odometer at/before time

Expected index: `ix_odometer_readings_vehicle`

```sql
SELECT * FROM veh.odometer_readings WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND observed_at <= now() ORDER BY observed_at DESC, seq DESC LIMIT 1
```

```text
Limit
  ->  Index Scan using ix_odometer_readings_vehicle on odometer_readings
        Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid) AND (observed_at <= now()))
```

### Active Vehicle alerts

Expected index: `ix_vehicle_alerts_active`

```sql
SELECT * FROM veh.vehicle_alerts WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' AND is_active AND deleted_at IS NULL
```

```text
Index Scan using ix_vehicle_alerts_active on vehicle_alerts
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
```

### Open duplicate candidate for a pair

Expected index: `uq_duplicate_candidates_open`

```sql
SELECT * FROM veh.duplicate_candidates WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id_a='a0000000-0000-4000-8000-000000000002' AND vehicle_id_b='b0000000-0000-4000-8000-000000000003' AND status='open'
```

```text
Index Scan using uq_duplicate_candidates_open on duplicate_candidates
  Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id_a = 'a0000000-0000-4000-8000-000000000002'::uuid) AND (vehicle_id_b = 'b0000000-0000-4000-8000-000000000003'::uuid))
```

### Vehicle survivor resolution step

Expected index: `pk_vehicles`

```sql
SELECT merged_into_id FROM veh.vehicles WHERE id='a0000000-0000-4000-8000-000000000002'
```

```text
Index Scan using uq_vehicles_tenant_id on vehicles
  Index Cond: (id = 'a0000000-0000-4000-8000-000000000002'::uuid)
```

### Vehicle status history (latest first)

Expected index: `ix_vehicle_status_history_vehicle`

```sql
SELECT * FROM veh.vehicle_status_history WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND vehicle_id='a0000000-0000-4000-8000-000000000002' ORDER BY occurred_at DESC, seq DESC LIMIT 50
```

```text
Limit
  ->  Index Scan using ix_vehicle_status_history_vehicle on vehicle_status_history
        Index Cond: ((tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid) AND (vehicle_id = 'a0000000-0000-4000-8000-000000000002'::uuid))
```

### Shared search metadata lookup (veh)

Expected index: `uq_search_metadata_identity / ix_search_metadata_normalized_value_trgm`

```sql
SELECT entity_id FROM shared.search_metadata WHERE tenant_id='a0000000-0000-4000-8000-000000000001' AND entity_type='veh.vehicle' AND normalized_value LIKE '1HGCM%'
```

```text
Index Scan using ix_search_metadata_branch on search_metadata
  Index Cond: (tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid)
  Filter: ((normalized_value ~~ '1HGCM%'::text) AND (entity_type = 'veh.vehicle'::text))
```

## Full veh index inventory (91 indexes, live)

| Table                     | Index                                 | Definition                                                                                                                                                    |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| battery_masters           | ix_battery_masters_vehicle            | `veh.battery_masters USING btree (tenant_id, vehicle_id)`                                                                                                     |
| battery_masters           | pk_battery_masters                    | `veh.battery_masters USING btree (id)`                                                                                                                        |
| battery_masters           | uq_battery_masters_active_traction    | `veh.battery_masters USING btree (tenant_id, vehicle_id) WHERE ((status = 'active'::text) AND (battery_role = 'traction'::text) AND (deleted_at IS NULL))`    |
| battery_masters           | uq_battery_masters_tenant_id          | `veh.battery_masters USING btree (tenant_id, id)`                                                                                                             |
| battery_readings          | ix_battery_readings_battery           | `veh.battery_readings USING btree (tenant_id, battery_master_id, measured_at DESC, seq DESC)`                                                                 |
| battery_readings          | pk_battery_readings                   | `veh.battery_readings USING btree (id)`                                                                                                                       |
| body_types                | ix_body_types_tenant                  | `veh.body_types USING btree (tenant_id)`                                                                                                                      |
| body_types                | pk_body_types                         | `veh.body_types USING btree (id)`                                                                                                                             |
| body_types                | uq_body_types_platform_code           | `veh.body_types USING btree (code) WHERE ((scope = 'platform'::text) AND (deleted_at IS NULL))`                                                               |
| body_types                | uq_body_types_tenant_code             | `veh.body_types USING btree (tenant_id, code) WHERE ((scope = 'tenant'::text) AND (deleted_at IS NULL))`                                                      |
| duplicate_candidates      | ix_duplicate_candidates_a             | `veh.duplicate_candidates USING btree (tenant_id, vehicle_id_a)`                                                                                              |
| duplicate_candidates      | ix_duplicate_candidates_b             | `veh.duplicate_candidates USING btree (tenant_id, vehicle_id_b)`                                                                                              |
| duplicate_candidates      | ix_duplicate_candidates_status        | `veh.duplicate_candidates USING btree (tenant_id, status)`                                                                                                    |
| duplicate_candidates      | pk_duplicate_candidates               | `veh.duplicate_candidates USING btree (id)`                                                                                                                   |
| duplicate_candidates      | uq_duplicate_candidates_open          | `veh.duplicate_candidates USING btree (tenant_id, vehicle_id_a, vehicle_id_b) WHERE (status = 'open'::text)`                                                  |
| engine_history            | ex_engine_history_no_overlap          | `veh.engine_history USING gist (tenant_id, vehicle_id, daterange(valid_from, valid_to, '[)'::text))`                                                          |
| engine_history            | ix_engine_history_vehicle             | `veh.engine_history USING btree (tenant_id, vehicle_id, valid_from)`                                                                                          |
| engine_history            | pk_engine_history                     | `veh.engine_history USING btree (id)`                                                                                                                         |
| makes                     | ix_makes_tenant                       | `veh.makes USING btree (tenant_id)`                                                                                                                           |
| makes                     | pk_makes                              | `veh.makes USING btree (id)`                                                                                                                                  |
| makes                     | uq_makes_platform_code                | `veh.makes USING btree (code) WHERE ((scope = 'platform'::text) AND (deleted_at IS NULL))`                                                                    |
| makes                     | uq_makes_tenant_code                  | `veh.makes USING btree (tenant_id, code) WHERE ((scope = 'tenant'::text) AND (deleted_at IS NULL))`                                                           |
| models                    | ix_models_make                        | `veh.models USING btree (make_id)`                                                                                                                            |
| models                    | ix_models_tenant                      | `veh.models USING btree (tenant_id)`                                                                                                                          |
| models                    | pk_models                             | `veh.models USING btree (id)`                                                                                                                                 |
| models                    | uq_models_platform_code               | `veh.models USING btree (make_id, code) WHERE ((scope = 'platform'::text) AND (deleted_at IS NULL))`                                                          |
| models                    | uq_models_tenant_code                 | `veh.models USING btree (tenant_id, make_id, code) WHERE ((scope = 'tenant'::text) AND (deleted_at IS NULL))`                                                 |
| odometer_readings         | ix_odometer_readings_correction       | `veh.odometer_readings USING btree (tenant_id, vehicle_id, correction_of)`                                                                                    |
| odometer_readings         | ix_odometer_readings_vehicle          | `veh.odometer_readings USING btree (tenant_id, vehicle_id, observed_at DESC, seq DESC)`                                                                       |
| odometer_readings         | pk_odometer_readings                  | `veh.odometer_readings USING btree (id)`                                                                                                                      |
| odometer_readings         | uq_odometer_readings_vehicle_row      | `veh.odometer_readings USING btree (tenant_id, vehicle_id, id)`                                                                                               |
| ownership_history         | ex_ownership_history_registered       | `veh.ownership_history USING gist (tenant_id, vehicle_id, daterange(valid_from, valid_to, '[)'::text)) WHERE (ownership_kind = 'registered_owner'::text)`     |
| ownership_history         | ex_ownership_history_same_role        | `veh.ownership_history USING gist (tenant_id, vehicle_id, partner_id, ownership_kind, daterange(valid_from, valid_to, '[)'::text))`                           |
| ownership_history         | ix_ownership_history_partner          | `veh.ownership_history USING btree (tenant_id, partner_id)`                                                                                                   |
| ownership_history         | ix_ownership_history_vehicle          | `veh.ownership_history USING btree (tenant_id, vehicle_id, valid_from)`                                                                                       |
| ownership_history         | pk_ownership_history                  | `veh.ownership_history USING btree (id)`                                                                                                                      |
| plate_history             | ex_plate_history_active_plate         | `veh.plate_history USING gist (tenant_id, country_code, plate_normalized, daterange(valid_from, valid_to, '[)'::text))`                                       |
| plate_history             | ex_plate_history_no_overlap           | `veh.plate_history USING gist (tenant_id, vehicle_id, daterange(valid_from, valid_to, '[)'::text))`                                                           |
| plate_history             | ix_plate_history_vehicle              | `veh.plate_history USING btree (tenant_id, vehicle_id, valid_from)`                                                                                           |
| plate_history             | pk_plate_history                      | `veh.plate_history USING btree (id)`                                                                                                                          |
| powertrain_types          | ix_powertrain_types_tenant            | `veh.powertrain_types USING btree (tenant_id)`                                                                                                                |
| powertrain_types          | pk_powertrain_types                   | `veh.powertrain_types USING btree (id)`                                                                                                                       |
| powertrain_types          | uq_powertrain_types_platform_code     | `veh.powertrain_types USING btree (code) WHERE ((scope = 'platform'::text) AND (deleted_at IS NULL))`                                                         |
| powertrain_types          | uq_powertrain_types_tenant_code       | `veh.powertrain_types USING btree (tenant_id, code) WHERE ((scope = 'tenant'::text) AND (deleted_at IS NULL))`                                                |
| relationship_evidence     | ix_relationship_evidence_document     | `veh.relationship_evidence USING btree (tenant_id, document_id)`                                                                                              |
| relationship_evidence     | ix_relationship_evidence_relationship | `veh.relationship_evidence USING btree (tenant_id, relationship_id, occurred_at DESC, seq DESC)`                                                              |
| relationship_evidence     | pk_relationship_evidence              | `veh.relationship_evidence USING btree (id)`                                                                                                                  |
| transmission_history      | ex_transmission_history_no_overlap    | `veh.transmission_history USING gist (tenant_id, vehicle_id, daterange(valid_from, valid_to, '[)'::text))`                                                    |
| transmission_history      | ix_transmission_history_vehicle       | `veh.transmission_history USING btree (tenant_id, vehicle_id, valid_from)`                                                                                    |
| transmission_history      | pk_transmission_history               | `veh.transmission_history USING btree (id)`                                                                                                                   |
| trims                     | ix_trims_model                        | `veh.trims USING btree (model_id)`                                                                                                                            |
| trims                     | ix_trims_tenant                       | `veh.trims USING btree (tenant_id)`                                                                                                                           |
| trims                     | pk_trims                              | `veh.trims USING btree (id)`                                                                                                                                  |
| trims                     | uq_trims_platform_code                | `veh.trims USING btree (model_id, code) WHERE ((scope = 'platform'::text) AND (deleted_at IS NULL))`                                                          |
| trims                     | uq_trims_tenant_code                  | `veh.trims USING btree (tenant_id, model_id, code) WHERE ((scope = 'tenant'::text) AND (deleted_at IS NULL))`                                                 |
| vehicle_alerts            | ix_vehicle_alerts_active              | `veh.vehicle_alerts USING btree (tenant_id, vehicle_id) WHERE (is_active AND (deleted_at IS NULL))`                                                           |
| vehicle_alerts            | ix_vehicle_alerts_vehicle             | `veh.vehicle_alerts USING btree (tenant_id, vehicle_id, alert_type)`                                                                                          |
| vehicle_alerts            | pk_vehicle_alerts                     | `veh.vehicle_alerts USING btree (id)`                                                                                                                         |
| vehicle_attribute_history | ix_vehicle_attribute_history_vehicle  | `veh.vehicle_attribute_history USING btree (tenant_id, vehicle_id, occurred_at DESC, seq DESC)`                                                               |
| vehicle_attribute_history | pk_vehicle_attribute_history          | `veh.vehicle_attribute_history USING btree (id)`                                                                                                              |
| vehicle_ev_profiles       | ix_vehicle_ev_profiles_vehicle_fk     | `veh.vehicle_ev_profiles USING btree (tenant_id, vehicle_id)`                                                                                                 |
| vehicle_ev_profiles       | pk_vehicle_ev_profiles                | `veh.vehicle_ev_profiles USING btree (id)`                                                                                                                    |
| vehicle_ev_profiles       | uq_vehicle_ev_profiles_vehicle        | `veh.vehicle_ev_profiles USING btree (tenant_id, vehicle_id) WHERE (deleted_at IS NULL)`                                                                      |
| vehicle_identifiers       | ix_vehicle_identifiers_vehicle        | `veh.vehicle_identifiers USING btree (tenant_id, vehicle_id)`                                                                                                 |
| vehicle_identifiers       | pk_vehicle_identifiers                | `veh.vehicle_identifiers USING btree (id)`                                                                                                                    |
| vehicle_identifiers       | uq_vehicle_identifiers_active         | `veh.vehicle_identifiers USING btree (tenant_id, identifier_type, normalized_value) WHERE ((deleted_at IS NULL) AND (status = 'active'::text))`               |
| vehicle_identifiers       | uq_vehicle_identifiers_primary        | `veh.vehicle_identifiers USING btree (tenant_id, vehicle_id, identifier_type) WHERE (is_primary AND (deleted_at IS NULL))`                                    |
| vehicle_merges            | ix_vehicle_merges_survivor            | `veh.vehicle_merges USING btree (tenant_id, survivor_vehicle_id)`                                                                                             |
| vehicle_merges            | pk_vehicle_merges                     | `veh.vehicle_merges USING btree (id)`                                                                                                                         |
| vehicle_merges            | uq_vehicle_merges_source              | `veh.vehicle_merges USING btree (tenant_id, source_vehicle_id)`                                                                                               |
| vehicle_relationships     | ex_vehicle_relationships_no_overlap   | `veh.vehicle_relationships USING gist (tenant_id, vehicle_id, partner_id, relationship_role, daterange(valid_from, valid_to, '[)'::text))`                    |
| vehicle_relationships     | ix_vehicle_relationships_partner      | `veh.vehicle_relationships USING btree (tenant_id, partner_id)`                                                                                               |
| vehicle_relationships     | ix_vehicle_relationships_vehicle      | `veh.vehicle_relationships USING btree (tenant_id, vehicle_id, valid_from)`                                                                                   |
| vehicle_relationships     | pk_vehicle_relationships              | `veh.vehicle_relationships USING btree (id)`                                                                                                                  |
| vehicle_relationships     | uq_vehicle_relationships_tenant_id    | `veh.vehicle_relationships USING btree (tenant_id, id)`                                                                                                       |
| vehicle_status_history    | ix_vehicle_status_history_vehicle     | `veh.vehicle_status_history USING btree (tenant_id, vehicle_id, occurred_at DESC, seq DESC)`                                                                  |
| vehicle_status_history    | pk_vehicle_status_history             | `veh.vehicle_status_history USING btree (id)`                                                                                                                 |
| vehicles                  | ix_vehicles_body_type                 | `veh.vehicles USING btree (body_type_id)`                                                                                                                     |
| vehicles                  | ix_vehicles_lifecycle                 | `veh.vehicles USING btree (tenant_id, lifecycle_status)`                                                                                                      |
| vehicles                  | ix_vehicles_make                      | `veh.vehicles USING btree (make_id)`                                                                                                                          |
| vehicles                  | ix_vehicles_merged_into               | `veh.vehicles USING btree (tenant_id, merged_into_id)`                                                                                                        |
| vehicles                  | ix_vehicles_model                     | `veh.vehicles USING btree (model_id)`                                                                                                                         |
| vehicles                  | ix_vehicles_powertrain_type           | `veh.vehicles USING btree (powertrain_type_id)`                                                                                                               |
| vehicles                  | ix_vehicles_trim                      | `veh.vehicles USING btree (trim_id)`                                                                                                                          |
| vehicles                  | ix_vehicles_workshop                  | `veh.vehicles USING btree (tenant_id, workshop_status)`                                                                                                       |
| vehicles                  | pk_vehicles                           | `veh.vehicles USING btree (id)`                                                                                                                               |
| vehicles                  | uq_vehicles_active_display_number     | `veh.vehicles USING btree (tenant_id, display_number) WHERE ((display_number IS NOT NULL) AND (deleted_at IS NULL))`                                          |
| vehicles                  | uq_vehicles_active_vin                | `veh.vehicles USING btree (tenant_id, vin_normalized) WHERE ((vin_normalized IS NOT NULL) AND (deleted_at IS NULL) AND (lifecycle_status <> 'merged'::text))` |
| vehicles                  | uq_vehicles_tenant_id                 | `veh.vehicles USING btree (tenant_id, id)`                                                                                                                    |
| vin_verifications         | ix_vin_verifications_vehicle          | `veh.vin_verifications USING btree (tenant_id, vehicle_id, occurred_at DESC, seq DESC)`                                                                       |
| vin_verifications         | pk_vin_verifications                  | `veh.vin_verifications USING btree (id)`                                                                                                                      |
