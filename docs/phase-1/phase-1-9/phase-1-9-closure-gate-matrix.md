# Phase 1-9 — Closure-Gate Matrix

Closing a work order (a transition **into** an `is_closed=true` state that is **not**
`cancelled`) is blocked independently whenever **any** blocker below is present. The
gate is the `wo.guard_work_order_closure()` trigger, firing `BEFORE UPDATE OF state`
when the target state's `is_closed` flag is true and the change is a _close_ (not a
_cancel_). Each blocker is independent, deterministic, and raises **SQLSTATE
`23514`**.

**Cancellation.** A transition into the `cancelled` (`is_cancellation=true`) state
**bypasses B1..B6** but still records status history and still enforces the
reception-origin / no-forward-mutation rules. Cancellation is a governed close, not
a completion.

**Race safety.** Every gate-relevant child insert (`wo.jobs`, `tech.labor_sessions`,
`wo.additional_work_requests`) takes `FOR UPDATE` on the parent work order and
rejects if the parent is terminal (design finding F2). This serializes child inserts
against the closing UPDATE's row lock, so a blocker cannot be inserted _during_ a
close.

| #   | Blocker                                                                                                              | Trigger / mechanism                          | Error   | Cancellation bypass | Proving test                                            |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------- | :-----------------: | ------------------------------------------------------- |
| B1  | A non-terminal job exists                                                                                            | `wo.guard_work_order_closure` (job scan)     | `23514` |         yes         | `qms-closure-rework` (setup in `wo-jobs-labor`)         |
| B2  | An active (open-ended) labor session exists                                                                          | `wo.guard_work_order_closure` (labor scan)   | `23514` |         yes         | `qms-closure-rework` (setup in `wo-jobs-labor`)         |
| B3  | A **required** additional-work request is `pending`, or `approved` and `unfulfilled`                                 | `wo.guard_work_order_closure` (request scan) | `23514` |         yes         | `qms-closure-rework` (setup in `wo-services-approvals`) |
| B4  | A `requires_diagnostic` job has no `completed` diagnostic report                                                     | `wo.guard_work_order_closure` (report scan)  | `23514` |         yes         | `qms-closure-rework` (setup in `dia-diagnostics`)       |
| B5  | Mandatory QC missing or failed (a failed QC with no passing record, or any mandatory `qc_check` without a passed QC) | `wo.guard_work_order_closure` (QC scan)      | `23514` |         yes         | `qms-closure-rework`                                    |
| B6  | A safety-critical rework lacks independent sign-off                                                                  | `wo.guard_work_order_closure` (rework scan)  | `23514` |         yes         | `qms-closure-rework`                                    |

## Notes on the blockers

- **B3** uses the self-contained `fulfillment_state`
  (`unfulfilled`/`fulfilled`/`waived`, design finding F7) — no P1-10 dependency. The
  work order also carries a `parts_forward_state` text contract (default `none`,
  CHECK-constrained), never a dangling foreign key; stock reservation belongs to
  P1-10/P1-11.
- **B4** asserts _existence of a completed required report_ for every job flagged
  `requires_diagnostic=true` (design finding F8), not merely "no incomplete report".
- **B5** reads the finalized, frozen `overall_result` (design finding F10); a
  finalized QC result cannot be edited, so the gating fact is stable. Re-QC creates a
  new record.
- **B6** compares `independent_sign_off_by <> lead_technician_id` on
  `qms.rework_links`; `lead_technician_id` is stored immutably and is NOT NULL when
  `is_safety_critical=true` (design finding F4, BR-QMS-001).

## Concurrency behaviour

Two concurrent closes of the same work order resolve to exactly one winner; the
loser is an **idempotent no-op** and **exactly one** close row appears in
`wo.work_order_status_history`. Proven across 5 isolated repetitions in
`p1-09-concurrency` (accepted loser SQLSTATEs `23505`, `23P01`, `23514`).
