# Phase 1-9 — Work Order, Diagnostics, and Technician Database

**Phase ID:** P1-09 · **Owner module schemas:** `wo` (Work Order), `tech`
(Technician), `dia` (Diagnostics), `qms` (Quality) · **Base:** `origin/develop` =
`8881834` (after Phase 1-8 closure). · **Branch:**
`feature/p1-09-work-order-diagnostics-technician-database`.

Phase 1-9 delivers the database foundation for the **repair job of record** — the
work order that originates from a Phase 1-8 reception visit — together with the
technician, diagnostic, and quality-control records that surround it. It is a
database-only phase: no backend service (P1-19), no UI (P1-29), no quotation or
item catalog (P1-10), no billing (P1-11), no full HR/payroll, and no real or
fabricated business data.

## What this phase contains

- **Work Order (`wo`, 15 tables):** dual-scope configurable state graphs for work
  orders and jobs, the `wo.work_orders` master (reception-origin, coherence-locked
  Vehicle, `ordinary`/`rework` kind), the append-only status ledgers, jobs and
  temporal assignments, service and required-part lines with opaque forward refs,
  additional-work requests (+restricted detail), and immutable customer approvals
  with append-only evidence.
- **Technician (`tech`, 9 tables):** dual-scope skill/level/certification catalogs,
  `tech.technician_profiles` anchored to the `iam` identity (operational data only,
  never duplicating salary/gov-id/contact/medical/payroll), skills and operational
  certifications (+restricted certificate number), non-overlapping availability,
  and labor sessions with overlap exclusion and linked-correction semantics.
- **Diagnostics (`dia`, 13 tables):** dual-scope diagnostic-type catalog, inspection
  templates with frozen published versions and items, diagnostic reports that pin an
  exact published version, item results, findings, measurements, DTC records,
  append-only evidence and reviews, and recommendations.
- **Quality (`qms`, 7 tables):** dual-scope QC-check catalog, quality-control records
  with frozen finalized results, per-check results, the append-only QC status and
  rejected-reopen ledgers, and rework links carrying the BR-QMS-001 independent
  sign-off (+restricted cost-of-quality detail). The work-order closure gate lives
  here (blockers B1..B6).

## Document index

| Document                                                                                 | Purpose                                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [phase-1-9-design.md](phase-1-9-design.md)                                               | Architecture and design gate (fixed before any migration)                  |
| [phase-1-9-review-response.md](phase-1-9-review-response.md)                             | Adversarial self-review ledger — 14 findings resolved by binding amendment |
| [phase-1-9-owner-gate.md](phase-1-9-owner-gate.md)                                       | Owner gate record (**Go — Technical Gate Passed**)                         |
| [phase-1-9-completion-report.md](phase-1-9-completion-report.md)                         | Implementation summary + object/test counts                                |
| [phase-1-9-object-inventory.md](phase-1-9-object-inventory.md)                           | Tables, functions, triggers, policies, indexes, migrations                 |
| [phase-1-9-state-machines.md](phase-1-9-state-machines.md)                               | Work-order and job state matrices + configurable-graph principle           |
| [phase-1-9-closure-gate-matrix.md](phase-1-9-closure-gate-matrix.md)                     | The B1..B6 closure blockers, errors, and proving tests                     |
| [phase-1-9-security-matrix.md](phase-1-9-security-matrix.md)                             | RLS / branch isolation / grants / restricted gating / classification       |
| [phase-1-9-append-only-correction-matrix.md](phase-1-9-append-only-correction-matrix.md) | Per-table mutability classification                                        |
| [phase-1-9-contracts.md](phase-1-9-contracts.md)                                         | Reception-origin, privacy, labor, approvals, diagnostics, QC/rework        |
| [phase-1-9-abuse-case-ledger.md](phase-1-9-abuse-case-ledger.md)                         | Threat → control → test → residual ledger                                  |
| [phase-1-9-test-catalog.md](phase-1-9-test-catalog.md)                                   | The 71 P1-09 database tests                                                |
| [phase-1-9-traceability.md](phase-1-9-traceability.md)                                   | DB task → migration → object → test mapping                                |
| [phase-1-9-evidence-register.md](phase-1-9-evidence-register.md)                         | Base SHA, commit intent, counts, gate evidence                             |
| [p1-10-structural-contract.md](p1-10-structural-contract.md)                             | What P1-10 (quotation/items) may reference; no duplication                 |
| [p1-19-backend-contract.md](p1-19-backend-contract.md)                                   | Backend (P1-19) DB primitives + outbox event contracts                     |
| [p1-29-frontend-contract.md](p1-29-frontend-contract.md)                                 | Frontend (P1-29) read-model expectations                                   |
| [p1-35-migration-target-model.md](p1-35-migration-target-model.md)                       | Additive, forward-only target model for P1-35                              |
| [phase-1-9-change-log.md](phase-1-9-change-log.md)                                       | Chronological change log (waves + migrations)                              |

## Governance

Reviewed under the **Solo Developer Review Policy** and the **Standing Technical
Authorization Policy** — owner-authorized technical, QA, security, and adversarial
self-review by Eng. Ezzaldeen Al-Bitar; **not** an independent third-party review.
The user performs every merge. The owner gate for this phase is **Go — Technical
Gate Passed**: the feature pull request (#39, final SHA `b9550bb`) merged into
`develop` (merge commit `4fff327`), and the merge evidence is recorded in the
[owner gate](phase-1-9-owner-gate.md) via this gate-record pull request. Phase 1-9
is formally closed once this gate-record pull request is also merged and both SHAs
are verified contained in protected `origin/develop`.
