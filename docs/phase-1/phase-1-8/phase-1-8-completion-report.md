# Phase 1-8 — Completion Report

**Phase ID:** P1-08 · **Scope:** Appointment (`apt`) and Vehicle Reception (`rec`)
database foundation.

## Summary

Phase 1-8 implements the full database layer for booking appointments and
receiving Vehicles into branch custody. It follows the modular-monolith rule
(one schema per module) established in the database architecture: `apt` and `rec`
are two new module boundaries added by this phase's first migration. All business
tables ship empty (no-fake-data), and all correctness invariants are enforced in
the database (constraints, triggers, RLS) rather than deferred to the backend.

## Object counts (live catalog)

| Object         | Count                                    |
| -------------- | ---------------------------------------- |
| Tables         | 29 (6 `apt` + 23 `rec`)                  |
| Functions      | 19                                       |
| Triggers       | 67                                       |
| Policies       | 81                                       |
| Indexes        | 133                                      |
| Columns        | 454 (4 restricted)                       |
| Migrations     | 17 (`20260721090000` … `20260721106000`) |
| P1-08 DB tests | 118 (within the 958-test full DB suite)  |

## Delivered capabilities

- **Branch-scoped model.** Every business table carries `(tenant_id, company_id,
branch_id)` with a composite FK to `org.branches`, so branch ⊆ company ⊆ tenant
  is FK-enforced, not RLS-only. Children carry the full scope and composite-FK the
  parent's `(tenant_id, company_id, branch_id, id)` candidate key.
- **Appointment lifecycle + conflict support.** A guarded state machine
  (requested → pending_confirmation → confirmed → checked_in; cancel/no-show), an
  integrated cancellation/no-show model, and a same-Vehicle confirmed-overlap
  `EXCLUDE` constraint. Only confirmed/checked-in appointments reserve capacity.
- **Reception custody boundary.** Exactly-one-origin (appointment XOR walk-in),
  one open visit per Vehicle, odometer/fuel/EV-SOC capture with same-Vehicle
  odometer binding, and an atomic accepted-check-in primitive that creates the
  visit, the service-requester role, the initial custody acceptance, and the
  initial status row in one transaction.
- **Evidence integrity.** Damage maps and signatures bind an **exact immutable
  document version**; a template revision is a new map, so historical marks never
  move. All evidence references `shared.documents` — possession of a document id
  grants no access.
- **Sensitive-data separation.** Complaint narrative and vehicle-content detail
  live in restricted 1:1 payload tables, row-gated by `iam.sensitive.view`.
- **Append-only ledgers.** Appointment/reception status history, custody history,
  signatures, refusals, and authorizations are INSERT+SELECT only; forged and
  incoherent rows are rejected by coherence/transition guards.

## Verification

- `npm run test:db` — 85 files / 958 tests green (112 s), including the 118
  P1-08 tests and all prior-phase regressions.
- `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run validate:seed-state`, `npm run validate:no-fake-data`,
  `npm run validate:aptrec-classification` — all exit 0.
- Zero FK-index coverage gaps; zero duplicate indexes on `apt`/`rec`.

## Out of scope (by design)

No work-order tables (P1-09), no backend/API (P1-18), no UI (P1-28), no P1-35
migration execution, no real or fabricated business data. See
[p1-09-structural-contract.md](p1-09-structural-contract.md) and
[p1-18-p1-28-boundaries.md](p1-18-p1-28-boundaries.md).
