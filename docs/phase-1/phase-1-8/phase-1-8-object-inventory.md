# Phase 1-8 — Object Inventory

Introspected from the live catalog. Counts: **29 tables, 19 functions, 67
triggers, 81 policies, 133 indexes, 454 columns.**

## Tables

### `apt` (6)

| Table                            | Kind                       | Task                                            |
| -------------------------------- | -------------------------- | ----------------------------------------------- |
| `apt.appointment_types`          | dual-scope catalog         | config                                          |
| `apt.source_channels`            | dual-scope catalog         | config                                          |
| `apt.cancellation_reasons`       | dual-scope catalog         | config                                          |
| `apt.appointments`               | branch-scoped master       | DB-001 / DB-005 (conflict) / DB-014 (display #) |
| `apt.appointment_services`       | child (requested services) | DB-002                                          |
| `apt.appointment_status_history` | append-only ledger         | DB-003                                          |

### `rec` (23)

| Table                                                                                       | Kind                                    | Task            |
| ------------------------------------------------------------------------------------------- | --------------------------------------- | --------------- |
| `rec.visit_reasons` / `rec.fuel_levels` / `rec.warning_light_codes` / `rec.refusal_reasons` | dual-scope catalogs                     | config          |
| `rec.walk_in_references`                                                                    | branch-scoped origin                    | DB-004          |
| `rec.reception_visits`                                                                      | branch-scoped master (custody boundary) | DB-005          |
| `rec.reception_party_roles`                                                                 | dated child                             | DB-007          |
| `rec.visit_reason_links`                                                                    | child                                   | DB-008          |
| `rec.complaints` / `rec.complaint_details`                                                  | metadata + restricted 1:1               | DB-009          |
| `rec.visual_inspections` / `rec.condition_items`                                            | header + findings                       | DB-010 / DB-011 |
| `rec.damage_maps` / `rec.damage_marks`                                                      | version-bound map + marks               | DB-012 / DB-013 |
| `rec.warning_light_observations` / `rec.leak_observations`                                  | observations                            | DB-014 / DB-015 |
| `rec.vehicle_contents` / `rec.vehicle_content_details`                                      | metadata + restricted 1:1               | DB-016          |
| `rec.signatures`                                                                            | append-only                             | DB-017          |
| `rec.refusals`                                                                              | append-only                             | DB-018          |
| `rec.authorizations`                                                                        | append-only                             | DB-019          |
| `rec.custody_history`                                                                       | append-only ledger                      | DB-020          |
| `rec.reception_status_history`                                                              | append-only ledger                      | DB-021          |

## Functions (19)

`apt.guard_appointment_catalog_refs`, `apt.guard_appointment_transition`,
`apt.guard_appointment_status_coherence`, `apt.emit_appointment_status_history`;
`rec.guard_walk_in_refs`, `rec.guard_reception_visit_refs`,
`rec.guard_reception_transition`, `rec.guard_visit_reason_link`,
`rec.guard_inspection_lifecycle`, `rec.guard_condition_item_open`,
`rec.guard_damage_map_version`, `rec.guard_warning_light_observation`,
`rec.guard_signature_version`, `rec.guard_refusal_reason`,
`rec.guard_authorization_authority`, `rec.guard_custody_transition`,
`rec.guard_reception_status_coherence`, `rec.emit_reception_status_history`,
`rec.accept_check_in` (the atomic accepted-check-in primitive).

All functions are `SECURITY INVOKER` with `SET search_path = ''` and
`REVOKE EXECUTE FROM PUBLIC`; none is `SECURITY DEFINER`. Only
`rec.accept_check_in` carries an explicit `GRANT EXECUTE TO app_runtime`.

## Indexes

Every foreign key is covered by a non-partial index whose leading columns (as a
set) equal the FK columns (P1-03-DB-017); the FK-index guard reports zero gaps
and the duplicate-index guard reports zero exact duplicates on `apt`/`rec`.
Notable specialised indexes: the `apt.appointments` confirmed-overlap `EXCLUDE
USING gist`, the branch-calendar GiST index on `confirmed_range`, the
`rec.reception_visits` one-open-visit partial unique, per-catalog per-scope
partial-unique code indexes, and the `rec.custody_history` one-accepted partial
unique.
