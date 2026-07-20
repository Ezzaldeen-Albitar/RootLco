# Phase 1-8 — Change Log

Chronological, additive, forward-only. No merged migration was edited.

| Migration                                       | Change                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260721090000_apt_rec_schemas`                | Reserve `apt` + `rec` module schemas; USAGE grants to app roles.                                                                                        |
| `20260721091000_apt_configuration_catalogs`     | 3 appointment dual-scope catalogs.                                                                                                                      |
| `20260721092000_apt_appointments`               | Appointment master: branch scope, composite FKs, lifecycle guard, catalog-visibility guard, confirmed-overlap EXCLUDE, display number.                  |
| `20260721093000_apt_appointment_services`       | Requested-services child; P1-10 forward reference (no FK).                                                                                              |
| `20260721094000_apt_appointment_status_history` | Append-only appointment lifecycle ledger (emit + coherence guards).                                                                                     |
| `20260721095000_rec_configuration_catalogs`     | 4 reception dual-scope catalogs.                                                                                                                        |
| `20260721096000_rec_walk_in_references`         | Walk-in origin; source-channel visibility guard.                                                                                                        |
| `20260721097000_rec_reception_visits`           | Reception master: XOR origin, one-open-visit, odometer/fuel/SOC, refs + transition guards.                                                              |
| `20260721098000_rec_party_roles_visit_reasons`  | Dated party roles; governed visit-reason links (archived-reason guard).                                                                                 |
| `20260721099000_rec_complaints`                 | Complaint metadata + restricted narrative (sensitive-gated).                                                                                            |
| `20260721100000_rec_inspections_conditions`     | Visual inspections (finalize/lock) + condition items (open-gate + correction).                                                                          |
| `20260721101000_rec_damage_maps_marks`          | Version-bound damage maps + normalized-coordinate marks.                                                                                                |
| `20260721102000_rec_warning_lights_leaks`       | Warning-light observations (archived-code guard) + leak observations.                                                                                   |
| `20260721103000_rec_vehicle_contents`           | Vehicle-contents metadata + restricted detail (sensitive-gated).                                                                                        |
| `20260721104000_rec_signatures_refusals`        | Append-only signatures (version-bound) + refusals (governed reason).                                                                                    |
| `20260721105000_rec_authorization_custody`      | Append-only authorizations (authority guard) + custody ledger (transition guard).                                                                       |
| `20260721106000_rec_status_history_checkin`     | Append-only reception status history (emit/coherence); replace reception transition guard with the activation contract; atomic `rec.accept_check_in()`. |

## Non-migration changes

- `docs/database/data-dictionary.md` — appended every apt/rec table (restricted
  columns labelled).
- `docs/database/apt-rec-personal-data-classification.json` +
  `scripts/check-aptrec-classification.mjs` + `npm run
validate:aptrec-classification` + a CI step.
- `tests/db/helpers.ts` — cascade cleanup + platform fixture cleanup for all
  apt/rec tables.
- `tests/db/foundation.test.ts`, `tests/db/org-security.test.ts` — allow-list and
  exception registrations.
- 13 new P1-08 test files (118 tests).
- This `docs/phase-1/phase-1-8/` package.
