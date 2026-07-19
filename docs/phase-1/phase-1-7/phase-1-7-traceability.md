# Phase 1-7 Traceability Matrix

Requirements → tasks → migrations → objects → tests → documentation. No orphan
requirement, no orphan migration (all 15 appear below), no untested acceptance
claim. Test files live in `tests/db/`; migration numbers abbreviate
`20260720NNNNNN`.

## Functional / business requirements

| Requirement                                                                  | Meaning                                                     | Tasks            | Migrations             | Key objects                                                         | Tests                                                   | Documentation                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------- | ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| FR-VEH-001 — independent Vehicle master (zero owner/customer FK)             | Vehicle identity survives owner/plate/engine changes        | DB-001           | 092000                 | `veh.vehicles` (no partner column)                                  | veh-vehicles; crown-jewel column sweep in veh-ownership | README §1; [p1-08 contract](./p1-08-structural-contract.md)            |
| FR-VEH-002 — VIN identity + uniqueness                                       | Normalized VIN, tenant-scoped active uniqueness             | DB-002           | 090000, 092000         | `normalize_vin`, `vin_normalized`, `uq_vehicles_active_vin`         | veh-vehicles; QA-008 §2                                 | [VIN contract](./veh-vin-normalization-contract.md)                    |
| FR-VEH-003 — temporal mechanical/plate/ownership history                     | Point-in-time truth for engine/transmission/plate/ownership | DB-007, 010, 011 | 096000, 098000, 099000 | 5 interval tables + `*_at` resolvers                                | veh-mechanical; veh-ownership; QA-008 §4–6, 9–10        | [interval matrix](./veh-interval-semantics-matrix.md)                  |
| FR-VEH-004 — ownership-transfer privacy                                      | New owner never gains prior-owner CRM-private data          | DB-011, SEC-001  | 099000                 | opaque `partner_id` only; `owner_at` → survivor uuid                | crown-jewel suite (veh-ownership); veh-isolation        | [visibility matrix](../../database/veh-ownership-visibility-matrix.md) |
| BR-VEH-001 — no silent identifier correction                                 | Raw preserved; normalization never repairs                  | DB-002, 010      | 090000                 | `normalize_vin`/`normalize_plate` (I/O/Q + Unicode preserved)       | veh-search normalization tests; veh-vehicles            | VIN + plate contracts                                                  |
| BR-VEH-002 — service history follows the Vehicle; party data stays CRM       | The privacy governing rule                                  | SEC-001          | 099000, 100000         | composite FKs to `crm.business_partners`; no PII columns            | crown-jewel suite                                       | visibility matrix                                                      |
| BR-CRM-001 (consumed) — merge is record + redirect, never row rewrite        | Vehicle merges mirror the CRM merge doctrine                | DB-018           | 104000                 | `vehicle_merges`, `apply_vehicle_merge`, `resolve_vehicle_survivor` | veh-duplicates-merges; QA-008 §15–16                    | [audit matrix](./veh-audit-and-history-matrix.md)                      |
| CR-VEH-01 — merged Vehicle read-only                                         | New business rule                                           | DB-001, 018      | 092000, 104000         | `guard_vehicle_merge` freeze                                        | veh-vehicles; veh-duplicates-merges                     | README §4                                                              |
| CR-VEH-02 — lower odometer only as linked reasoned correction                | New business rule                                           | DB-014           | 101000                 | `guard_odometer_reading` + correction CHECKs                        | veh-odometer; QA-008 §11–12                             | README §4                                                              |
| CR-VEH-03 — active Vehicle without VIN needs controlled alternate identifier | New business rule                                           | DB-003           | 093000                 | activation/identity-removal guards                                  | veh-identifiers                                         | README §4; VIN contract                                                |

## Database tasks (DB-001..023)

| Task                                           | Delivered by                                                                | Migration              | Tests                             |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ---------------------- | --------------------------------- |
| DB-001 Vehicle master                          | `veh.vehicles` + guards                                                     | 092000                 | veh-vehicles (19)                 |
| DB-002 VIN normalization/uniqueness            | functions + generated column                                                | 090000/092000          | veh-vehicles                      |
| DB-003 identifier ledger + activation contract | `vehicle_identifiers` + 2 guards                                            | 093000                 | veh-identifiers (12)              |
| DB-004 VIN verifications                       | append-only ledger                                                          | 094000                 | veh-history                       |
| DB-005 attribute history                       | emit trigger + ledger                                                       | 095000                 | veh-history (7)                   |
| DB-006 reference catalogs                      | 5 dual-scope catalogs                                                       | 091000                 | veh-catalogs (11)                 |
| DB-007 engine/transmission history             | temporal pair + resolvers                                                   | 096000                 | veh-mechanical                    |
| DB-008 EV profiles                             | dual powertrain guard                                                       | 097000                 | veh-mechanical                    |
| DB-009 battery master/readings                 | masters + append-only readings                                              | 097000                 | veh-mechanical (15)               |
| DB-010 plate history                           | temporal + cross-Vehicle EXCLUDE                                            | 098000                 | veh-ownership                     |
| DB-011 ownership history                       | kinds + registered exclusivity + `owner_at`                                 | 099000                 | veh-ownership                     |
| DB-012 relationships                           | 7 roles + scope validator                                                   | 100000                 | veh-ownership (15)                |
| DB-013 relationship evidence                   | append-only document link                                                   | 100000                 | veh-ownership                     |
| DB-014 odometer                                | forward-only + corrections                                                  | 101000                 | veh-odometer (16)                 |
| DB-015 status history                          | emit + coherence guard                                                      | 102000                 | veh-status-alerts                 |
| DB-016 alerts                                  | typed advisories                                                            | 103000                 | veh-status-alerts (16)            |
| DB-017 duplicate candidates                    | positive-schema basis                                                       | 104000                 | veh-duplicates-merges             |
| DB-018 vehicle merges                          | atomic primitive + resolver                                                 | 104000                 | veh-duplicates-merges (25)        |
| DB-019 display # + search contract             | allocator wiring + [search contract](../../database/veh-search-contract.md) | (runtime; no DDL)      | veh-search (5); QA-008 §1         |
| DB-020 index/query-plan review                 | [review doc](../../database/veh-index-query-plan-review.md)                 | (audit; no DDL needed) | org-security FK/dup guards        |
| DB-021 RLS/grant review                        | inventory suite                                                             | (audit)                | veh-security (7)                  |
| DB-022 seeds                                   | ZERO veh rows; validator sweeps veh                                         | (none — by policy)     | validate:seed-state; no-fake-data |
| DB-023 migration rehearsal                     | clean-room full apply                                                       | all 15                 | evidence register                 |

## Security / QA / DevOps tasks

| Task                            | Artifact                                                                               | Executable evidence               |
| ------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------- |
| SEC-001 ownership visibility    | [matrix](../../database/veh-ownership-visibility-matrix.md)                            | crown-jewel suite                 |
| SEC-002 authorized-person scope | [contract](../../database/veh-authorized-person-scope-contract.md)                     | scope tests in veh-ownership      |
| SEC-003 classification          | [registry](../../database/veh-personal-data-classification.json) + validator + CI step | veh-classification-guard (6)      |
| SEC-004 abuse cases             | [53-case record](../../database/veh-abuse-case-record.md)                              | per-case test column              |
| QA-007 isolation                | veh-isolation.test.ts                                                                  | 5 auto-enumerating tests          |
| QA-008 concurrency              | veh-concurrency.test.ts                                                                | 18 races × 5 controlled runs      |
| QA-009 pipeline rehearsal       | clean-room sequence                                                                    | evidence register                 |
| DO-001 CI integration           | veh classification step in the DB job; negative fixtures                               | ci.yml + veh-classification-guard |

## Risks

Accepted residuals (4 Medium + 2 Low) are centralized in the
[abuse-case record](../../database/veh-abuse-case-record.md) accepted-findings
register with rationale, present control, and owner phase — none is repeated
here to avoid divergence.
