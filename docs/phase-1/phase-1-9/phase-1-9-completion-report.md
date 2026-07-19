# Phase 1-9 — Completion Report

**Phase ID:** P1-09 · **Scope:** Work Order (`wo`), Technician (`tech`),
Diagnostics (`dia`), and Quality (`qms`) database foundation.

## Summary

Phase 1-9 implements the full database layer for the repair job of record. A work
order originates from a Phase 1-8 reception visit, drives jobs and technician labor,
carries diagnostic and quality-control evidence, and closes only through a
non-configurable closure gate. It follows the modular-monolith rule (one schema per
module) from ADR-001: `wo`, `tech`, `dia`, and `qms` are four new module boundaries
added by this phase's first migration. All business tables ship empty; the only
seed is a tenant-neutral platform state graph used as structural reference. Every
correctness invariant is enforced in the database (constraints, triggers, RLS)
rather than deferred to the backend.

## Object counts (live catalog)

| Object         | Count                                                        |
| -------------- | ------------------------------------------------------------ |
| Tables         | 44 (15 `wo` + 9 `tech` + 13 `dia` + 7 `qms`)                 |
| Functions      | 27                                                           |
| Triggers       | 101                                                          |
| Policies       | 124                                                          |
| Indexes        | 185                                                          |
| Columns        | 657 (3 restricted, 0 restricted-searchable)                  |
| Migrations     | 16 (`20260722090000` … `20260722105000`)                     |
| P1-09 DB tests | 71 across 10 files (within the full `npm run test:db` suite) |

## Key invariants proven

- **Closure gate (B1..B6).** `wo.guard_work_order_closure` blocks a close on any
  independent blocker (`23514`): a non-terminal job (B1), an active labor session
  (B2), a required additional-work request pending or approved-but-unfulfilled (B3),
  a `requires_diagnostic` job without a completed diagnostic report (B4), a missing
  or failed mandatory QC (B5), or a safety-critical rework without independent
  sign-off (B6). Cancellation bypasses B1..B6 but still records history.
- **No reopen of a closed work order (BR-WO-002).** A closed work order never
  reopens; a terminal-freeze trigger hard-blocks any direct UPDATE out of a terminal
  state. Corrective work is a linked `rework` work order; `qms.attempt_reopen`
  records a rejected attempt and never mutates the work order.
- **Independent sign-off (BR-QMS-001).** A safety-critical rework requires an
  independent sign-off; `lead_technician_id` is stored immutably and
  `independent_sign_off_by` must differ from it.
- **Labor exclusion.** `tech.labor_sessions` use a gist `EXCLUDE` for
  non-overlapping ranges plus at most one active session per technician; a
  concurrent overlap loses with `23P01`. Content is immutable; corrections are
  soft-delete-plus-linked-insert via `tech.correct_labor_session`.
- **Diagnostic versioning.** A diagnostic report pins the exact published template
  version; a published version and its items are frozen; completion requires every
  mandatory item answered (or a documented not-applicable).
- **Restricted gating.** Three restricted 1:1 payload tables (certificate number,
  additional-work description, rework cost-of-quality) are whole-table RLS-gated by
  `iam.has_permission('iam.sensitive.view')`.
- **Append-only ledgers.** Eight ledgers grant only SELECT+INSERT to the runtime;
  forged and incoherent rows are rejected by coherence/transition guards.
- **Concurrency.** Single-winner races proven across 5 isolated repetitions each:
  duplicate ordinary work-order origin (`23505`), labor overlap (`23P01`),
  duplicate close (idempotent no-op loser; exactly one close history row), and
  gap-free display-number allocation.
- **No fabricated data.** Every business table is empty after a clean migration; the
  platform state graph is the only seed and is structural reference, tenant-neutral,
  and idempotent.

## Security findings

Adversarial self-review raised 14 design findings (1 Critical, 4 High, 6 Medium, 3
Low), all resolved by binding amendment before the first migration was written (see
[phase-1-9-review-response.md](phase-1-9-review-response.md)). At implementation,
**zero unresolved Critical or High** security/QA findings remain.

## Review model

Owner-authorized technical, QA, security, and adversarial self-review by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — **not** an independent third-party review.

## Out of scope (by design)

No quotation or item catalog (P1-10), no billing (P1-11), no backend/API (P1-19),
no UI (P1-29), no full HR/payroll, no P1-35 migration execution, and no real or
fabricated business data. See [p1-10-structural-contract.md](p1-10-structural-contract.md),
[p1-19-backend-contract.md](p1-19-backend-contract.md), and
[p1-29-frontend-contract.md](p1-29-frontend-contract.md).
