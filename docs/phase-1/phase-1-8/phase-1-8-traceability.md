# Phase 1-8 — Traceability

DB task → migration → primary object(s) → test. Every task is implemented,
migration-applied, registered in the foundation allow-lists, documented in the
central data dictionary, and tested.

| Task                            | Migration            | Object(s)                                                                 | Test file                                          |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Schema reservation              | `…090000`            | schemas `apt`, `rec` + USAGE grants                                       | `foundation`                                       |
| Appointment config              | `…091000`            | `apt.appointment_types`/`source_channels`/`cancellation_reasons`          | `apt-catalogs`                                     |
| DB-001 Appointment master       | `…092000`            | `apt.appointments` + 2 guards                                             | `apt-appointments`                                 |
| DB-005 Conflict support         | `…092000`            | `confirmed_range` + GiST + `EXCLUDE`                                      | `apt-appointments`, `apt-rec-concurrency`          |
| DB-014 Display number           | `…092000`            | `display_number` + active unique                                          | `apt-appointments`                                 |
| DB-002 Requested services       | `…093000`            | `apt.appointment_services`                                                | `apt-appointment-services`                         |
| DB-003 Appointment history      | `…094000`            | `apt.appointment_status_history` + emit/coherence                         | `apt-appointment-status-history`                   |
| Reception config                | `…095000`            | `rec.visit_reasons`/`fuel_levels`/`warning_light_codes`/`refusal_reasons` | `rec-catalogs`                                     |
| DB-004 Walk-in origin           | `…096000`            | `rec.walk_in_references` + refs guard                                     | `rec-reception-visits`                             |
| DB-005 Reception master         | `…097000`            | `rec.reception_visits` + refs/transition guards                           | `rec-reception-visits`                             |
| DB-007 Party roles              | `…098000`            | `rec.reception_party_roles`                                               | `rec-party-roles-reasons`                          |
| DB-008 Visit reasons            | `…098000`            | `rec.visit_reason_links` + reason guard                                   | `rec-party-roles-reasons`                          |
| DB-009 Complaints               | `…099000`            | `rec.complaints` + `rec.complaint_details` (restricted)                   | `rec-complaints-contents`                          |
| DB-010 Visual inspection        | `…100000`            | `rec.visual_inspections` + lifecycle guard                                | `rec-inspection-damage`                            |
| DB-011 Condition items          | `…100000`            | `rec.condition_items` + open guard                                        | `rec-inspection-damage`                            |
| DB-012 Damage map               | `…101000`            | `rec.damage_maps` + version guard                                         | `rec-inspection-damage`                            |
| DB-013 Damage marks             | `…101000`            | `rec.damage_marks` (coords 0–1)                                           | `rec-inspection-damage`                            |
| DB-014 Warning lights           | `…102000`            | `rec.warning_light_observations` + code guard                             | `rec-inspection-damage`                            |
| DB-015 Leaks                    | `…102000`            | `rec.leak_observations`                                                   | `rec-inspection-damage`                            |
| DB-016 Vehicle contents         | `…103000`            | `rec.vehicle_contents` + `rec.vehicle_content_details` (restricted)       | `rec-complaints-contents`                          |
| DB-017 Signatures               | `…104000`            | `rec.signatures` + version guard                                          | `rec-custody-authorization`                        |
| DB-018 Refusals                 | `…104000`            | `rec.refusals` + reason guard                                             | `rec-custody-authorization`                        |
| DB-019 Authorization            | `…105000`            | `rec.authorizations` + authority guard                                    | `rec-custody-authorization`                        |
| DB-020 Custody history          | `…105000`            | `rec.custody_history` + transition guard                                  | `rec-custody-authorization`, `apt-rec-concurrency` |
| DB-021 Reception status history | `…106000`            | `rec.reception_status_history` + emit/coherence                           | `rec-custody-authorization`                        |
| DB-022 Atomic check-in          | `…106000`            | `rec.accept_check_in()` + transition-guard activation contract            | `rec-custody-authorization`                        |
| SEC-003 Classification          | registry + validator | `apt-rec-personal-data-classification.json`                               | `apt-rec-classification-guard`                     |
| QA isolation / concurrency      | —                    | auto-enum + races                                                         | `apt-rec-security`, `apt-rec-concurrency`          |

Open decisions: **P1-OD-018** (reception evidence rules unresolved) — resolved by
storing a structural superset with nullable optional fields (e.g.
`declared_value`), inventing no mandatory capture. **P1-OD-041** (Release 2
grouping) — no scope change; P1-08 is implemented in the planned Core Business DB
sequence.
