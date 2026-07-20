# Phase 1-8 — Appointment and Vehicle Reception Database

**Phase ID:** P1-08 · **Owner module schemas:** `apt` (Appointment), `rec`
(Vehicle Reception) · **Base:** `origin/develop` after Phase 1-7 closure.

Phase 1-8 delivers the database foundation for booking service appointments and
for **receiving a Vehicle into a branch's custody** — the origin of a future work
order, but never the work order itself (that is Phase 1-9). It is a database-only
phase: no backend service (P1-18), no UI (P1-28), and no real or fabricated
business data.

## What this phase contains

- **Appointment (`apt`, 6 tables):** dual-scope configuration catalogs
  (types / source channels / cancellation reasons), the branch-scoped
  `apt.appointments` master with its lifecycle state machine and same-Vehicle
  confirmed-overlap conflict support, the requested-services child, and the
  append-only appointment status history.
- **Reception (`rec`, 23 tables):** dual-scope catalogs (visit reasons / fuel
  levels / warning-light codes / refusal reasons), the walk-in origin, the
  `rec.reception_visits` custody-boundary master (exactly-one-origin, one open
  visit per Vehicle), party roles, visit reasons, complaints (+restricted
  narrative), visual inspections and condition items, version-bound damage maps
  and marks, warning-light and leak observations, vehicle contents (+restricted
  detail), signatures, refusals, authorizations, the append-only custody ledger,
  the append-only reception status history, and the atomic accepted-check-in
  primitive `rec.accept_check_in()`.

## Document index

| Document                                                           | Purpose                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [phase-1-8-owner-gate.md](phase-1-8-owner-gate.md)                 | Owner gate record (**Decision: Pending** until closure)                                                     |
| [phase-1-8-completion-report.md](phase-1-8-completion-report.md)   | Implementation summary + object/test counts                                                                 |
| [phase-1-8-object-inventory.md](phase-1-8-object-inventory.md)     | Tables, functions, triggers, policies, indexes                                                              |
| [phase-1-8-state-machines.md](phase-1-8-state-machines.md)         | Appointment, Reception, and Custody transitions                                                             |
| [phase-1-8-security-matrix.md](phase-1-8-security-matrix.md)       | RLS / branch isolation / grants / classification / append-only                                              |
| [phase-1-8-reception-contract.md](phase-1-8-reception-contract.md) | Origin exclusivity, custody boundary, conflict support, evidence/version, export posture, abuse-case ledger |
| [phase-1-8-test-catalog.md](phase-1-8-test-catalog.md)             | The 118 P1-08 database tests                                                                                |
| [phase-1-8-traceability.md](phase-1-8-traceability.md)             | DB task → migration → object → test mapping                                                                 |
| [phase-1-8-evidence-register.md](phase-1-8-evidence-register.md)   | Commits, counts, gate evidence                                                                              |
| [p1-09-structural-contract.md](p1-09-structural-contract.md)       | What P1-09 (work orders) may build on; no duplication                                                       |
| [p1-18-p1-28-boundaries.md](p1-18-p1-28-boundaries.md)             | Backend (P1-18) + frontend (P1-28) data contracts                                                           |
| [phase-1-8-change-log.md](phase-1-8-change-log.md)                 | Chronological change log                                                                                    |

## Governance

Reviewed under the **Solo Developer Review Policy** and the **Standing Technical
Authorization Policy** — owner-authorized technical, QA, security, and
adversarial self-review; **not** an independent third-party review. The user
performs every merge.
