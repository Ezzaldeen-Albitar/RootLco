# P1-18 (Backend) and P1-28 (Frontend) Data Contracts

Phase 1-8 is database-only. This document records the database primitives P1-18
will orchestrate and the read-model expectations P1-28 will render. **Neither is
implemented in this phase.**

## P1-18 — backend database contract (no backend built here)

The backend will orchestrate these existing DB primitives and invariants:

| Operation                             | DB primitive / invariant                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create / reschedule appointment       | `apt.appointments` INSERT/UPDATE; window CHECKs; transition guard                                                                                  |
| Confirm appointment / detect conflict | set `confirmed_*`; the same-Vehicle confirmed-overlap `EXCLUDE` (loser `23P01`)                                                                    |
| Cancel / no-show                      | integrated set-once columns + coherence CHECKs; emitted history                                                                                    |
| Log a walk-in                         | `rec.walk_in_references` INSERT                                                                                                                    |
| **Atomic accepted check-in**          | `rec.accept_check_in(...)` — visit + service-requester role + custody acceptance + opened status, one transaction                                  |
| Advance reception status              | `rec.reception_visits.reception_status` UPDATE; transition + activation guards                                                                     |
| Record authorization                  | `rec.authorizations` INSERT (authority guard)                                                                                                      |
| Record custody events                 | `rec.custody_history` INSERT (transition guard, append-only)                                                                                       |
| Attach evidence                       | `rec.signatures` / `rec.damage_maps` (+marks) bound to exact document versions                                                                     |
| Optimistic concurrency                | `record_version` on every mutable master (bumped by `shared.touch_row_metadata`)                                                                   |
| Future outbox events                  | P1-18 will publish `appointment.changed.v1` and `vehicle.checked-in.v1` via `shared.event_outbox` (the outbox table already exists from Phase 1-5) |

The database rejects impossible states directly (XOR origin, one-open-visit,
custody chain, authorized activation contract), so the backend cannot create them
even under concurrency. Correctness invariants are **not** deferred to P1-18.

## P1-28 — frontend data contract (no frontend built here)

Read-model expectations only:

- **Appointment calendar** per branch from `apt.appointments` (confirmed window,
  status, Vehicle, requester) — GiST-indexed for range queries.
- **Reception intake** view: origin, Vehicle, receiving employee, odometer/fuel/
  SOC, party roles, visit reasons, current status.
- **Evidence surfaces:** signatures, damage maps/marks, complaints, inspection
  findings, contents — each resolved through the reception visit and the linked
  document, **never** by raw object id, and restricted narratives only with
  `iam.sensitive.view`.
- **Timelines:** appointment status history, reception status history, and the
  custody chain, each append-only and ordered by `seq`.

## P1-35 target data model

The `apt`/`rec` schemas are additive, forward-only migrations that a P1-35
migration-execution effort applies from zero in order; the classification
registry and the foundation allow-lists are the machine-checkable target-state
contract. No P1-35 execution is performed in this phase.
