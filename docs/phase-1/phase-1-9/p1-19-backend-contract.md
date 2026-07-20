# P1-19 (Backend) Data Contract

Phase 1-9 is database-only. This document records the database primitives P1-19 will
orchestrate and the outbox event contracts it will publish. **No backend or API is
implemented in this phase.**

## Backend database contract (no backend built here)

The backend will orchestrate these existing DB primitives and invariants:

| Operation                         | DB primitive / invariant                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Create a work order               | `wo.work_orders` INSERT; `wo.guard_work_order_refs` (reception origin, custody, authorization); one-ordinary-per-origin |
| Transition a work order           | `wo.work_orders.state` UPDATE; transition guard against the active graph; terminal-freeze                               |
| Create / assign a job             | `wo.jobs` INSERT; `wo.job_assignments` INSERT (assignment-required gate, reassignment reason)                           |
| Start / stop labor                | `tech.labor_sessions` INSERT / set `ended_at`; overlap `EXCLUDE`; no-labor-on-terminal-WO                               |
| Request / approve additional work | `wo.additional_work_requests` INSERT/UPDATE (`state` + `fulfillment_state`); `wo.customer_approvals`                    |
| Complete an inspection            | `dia.diagnostic_reports` → `completed` (mandatory-item completion gate); exact published version pinned                 |
| Quality control                   | `qms.quality_control_records` (finalized result frozen); `qms.qc_check_results`                                         |
| Close a work order                | `wo.guard_work_order_closure` — blockers B1..B6 (`23514`); duplicate-close idempotent                                   |
| Rework                            | linked `rework` work order + `qms.rework_links` (BR-QMS-001 independent sign-off)                                       |
| Reopen attempt                    | `qms.attempt_reopen(uuid, text)` — records a rejected attempt, never mutates the WO (BR-WO-002)                         |
| Labor correction                  | `tech.correct_labor_session(uuid, timestamptz, timestamptz, text)` — soft-delete + linked insert                        |
| Optimistic concurrency            | `record_version` on every mutable master (bumped by `shared.touch_row_metadata`)                                        |

The database rejects impossible states directly (reception-origin preconditions,
one-ordinary-per-origin, labor overlap, closure blockers, no-reopen), so the backend
cannot create them even under concurrency. Correctness invariants are **not**
deferred to P1-19.

## Outbox event contracts (documented, not implemented)

P1-19 will publish domain events via the existing `shared.event_outbox` (from Phase
1-5). The anticipated event contracts include:

- `work-order.created.v1`, `work-order.state-changed.v1`, `work-order.closed.v1`
- `job.assigned.v1`, `labor.session-changed.v1`
- `additional-work.requested.v1`, `customer-approval.recorded.v1`
- `diagnostic-report.completed.v1`, `quality-control.finalized.v1`
- `rework.linked.v1`

No outbox producer is implemented in this phase; the tables and the append-only
ledgers are the source of truth these events will project from.
