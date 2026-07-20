# Phase 1-8 — Reception, Conflict, Evidence, and Abuse-Case Contract

## Origin exclusivity

A reception visit has **exactly one origin**: an appointment XOR a walk-in,
enforced at DDL by `CHECK ((appointment_id IS NULL) <> (walk_in_id IS NULL))`.
Never both, never neither. One visit per origin is enforced by non-partial unique
indexes on `(tenant, company, branch, appointment_id)` and `(…, walk_in_id)`
(these also cover the origin FKs). A walk-in is thus consumed by at most one
visit (origin-consumption contract). The appointment's Vehicle (and an identified
walk-in's Vehicle) must equal the visit's Vehicle (`rec.guard_reception_visit_
refs`).

## Custody boundary

Custody begins at accepted check-in and is a distinct concern from the visit
lifecycle. **One open visit per Vehicle** (`uq_reception_visits_open_vehicle`
partial unique over the open statuses) — custody cannot be in two places. The
custody ledger (`rec.custody_history`) is append-only with a transition guard:
accepted-first, `from = last`, `accepted → in_workshop → released`; no
release-before-accept, no duplicate acceptance. Actor/time are server-stamped.

## Conflict support (not resource scheduling)

Only **confirmed / checked-in** appointments reserve constrained capacity. A
single Vehicle may not hold two overlapping confirmed appointments —
`EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, confirmed_range WITH &&)`
over the confirmed/checked-in, not-deleted rows. Requested/pending windows and
different Vehicles never conflict. **P1-08 owns indexed conflict support + the
same-Vehicle confirmed-overlap invariant; P1-18 owns bay/technician resource
selection and scheduling orchestration.**

## Evidence and immutable document versions

All evidence (signatures, damage photos, maps, complaint/inspection attachments)
references `shared.documents` — **no binary payload is stored in `rec`**. Damage
maps and signatures additionally bind the **exact immutable `document_version`**;
a guard verifies the version belongs to the named document. A template revision
produces a **new** map bound to a new version, so historical damage marks never
move. Reception odometer readings bind `(tenant, vehicle, odometer_reading_id)`
so the reading is the same tenant **and** same Vehicle.

## Export / access posture (future permission contract)

**Object-id possession grants no access.** Access to an evidence object derives
from the linked business record, its tenant/company/branch scope, and an explicit
permission — never from holding a document/version id. The following read/export
surfaces will require dedicated permissions when the backend (P1-18) exposes
them: signature images, damage media, complaint evidence, inspection evidence,
custody evidence, authorization evidence. Restricted narratives
(`complaint_details`, `vehicle_content_details`) already require
`iam.sensitive.view` at the database layer.

## Abuse-case ledger

Every threat from the P1-08 plan, its control, and its test. **Zero unresolved
Critical/High.**

| #   | Abuse case                                        | Control                                                       | Test                                                          | Residual |
| --- | ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| 1   | Cross-tenant / cross-branch read or write         | Branch RLS + composite FK to `org.branches`                   | isolation tests in every suite; `apt-rec-security` auto-enum  | none     |
| 2   | Enumeration via object ids                        | RLS default-deny; object-id grants nothing                    | isolation suites                                              | none     |
| 3   | Dual-origin / originless visit                    | XOR `CHECK`                                                   | `rec-reception-visits`                                        | none     |
| 4   | Duplicate open check-in (race)                    | one-open partial unique                                       | `apt-rec-concurrency` ×5                                      | none     |
| 5   | Origin reuse (two visits, one origin)             | non-partial origin uniques                                    | `rec-reception-visits`                                        | none     |
| 6   | Odometer / Vehicle mismatch                       | composite odometer FK `(tenant,vehicle,id)`                   | `rec-reception-visits`                                        | none     |
| 7   | Out-of-range SOC / bad fuel code                  | SOC `CHECK 0–100`; fuel visibility guard                      | `rec-reception-visits`                                        | none     |
| 8   | Back-dated / release-before-accept custody        | append-only + transition guard                                | `rec-custody-authorization`                                   | none     |
| 9   | Duplicate custody acceptance (race)               | transition guard + one-accepted unique                        | `apt-rec-concurrency` ×5                                      | none     |
| 10  | Forged status/custody history                     | emit trigger + coherence guard; no UPDATE grant               | `apt-appointment-status-history`, `rec-custody-authorization` | none     |
| 11  | Complaint / contents narrative leak               | restricted 1:1 payload gated by `iam.sensitive.view`          | `rec-complaints-contents`                                     | none     |
| 12  | Complaint deletion                                | no DELETE grant; correction-linked                            | `apt-rec-security`                                            | none     |
| 13  | Signature replacement / probing                   | append-only; exact-version binding; object-id grants nothing  | `rec-custody-authorization`                                   | none     |
| 14  | Forged authorization / expired authority          | authority guard (active authorizing role) + append-only       | `rec-custody-authorization`                                   | none     |
| 15  | Authorize without approval / requester            | authorized-transition activation contract                     | `rec-custody-authorization`                                   | none     |
| 16  | Document-version substitution / damage-map attack | version-belongs-to-document guard; new map on revision        | `rec-inspection-damage`                                       | none     |
| 17  | Coordinate out of bounds                          | `coord_x/y CHECK 0–1`                                         | `rec-inspection-damage`                                       | none     |
| 18  | Archived configuration reuse                      | active-status guards (visit reason / warning light / refusal) | `rec-*` suites                                                | none     |
| 19  | Raw-table privilege / FORCE RLS bypass            | ENABLE+FORCE RLS; `NOBYPASSRLS` app roles                     | `foundation`, `apt-rec-security`                              | none     |
| 20  | Function RLS bypass                               | all `SECURITY INVOKER`, `search_path=''`; no DEFINER          | `shared-hardening`, object inventory                          | none     |
| 21  | Fake seed data                                    | no-fake-data guard; empty business tables                     | `no-fake-data`, seed-state                                    | none     |
| 22  | Scope leakage into P1-09/18/28                    | no work-order table; DB-only phase                            | `foundation` allow-list                                       | none     |

## Index / query-plan review

Representative access paths and their supporting indexes:

| Query                                                                          | Index                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Branch appointment calendar / confirmed conflicts                              | `ix_appointments_confirmed` (GiST) + the `EXCLUDE`                  |
| Appointment by Vehicle / requester / status                                    | `ix_appointments_vehicle` / `_requester` / `_status`                |
| Open reception visit for a Vehicle                                             | `uq_reception_visits_open_vehicle`                                  |
| Appointment/walk-in origin of a visit                                          | `uq_reception_visits_appointment` / `_walk_in`                      |
| Current custody / custody chain                                                | `ix_custody_history_visit` (visit, seq DESC)                        |
| Appointment/reception status history                                           | `ix_appointment_status_history_*` / `ix_reception_status_history_*` |
| Complaints / inspections / conditions / marks / contents / signatures by visit | per-child `ix_*_visit` / `ix_*_inspection` / `ix_*_map`             |

The FK-index guard proves every FK is covered; the duplicate-index guard proves
no exact redundancy.
