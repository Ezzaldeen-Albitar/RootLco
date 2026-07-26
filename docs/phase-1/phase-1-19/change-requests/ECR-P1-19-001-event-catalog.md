# ECR-P1-19-001 — Event catalog additions for `wo`, `tech`, `dia`, `qms`

**Status: Open.** No event named here may be treated as authoritative until this
change request is accepted. P1-19 does not mint events unilaterally.

## Why this exists

The P1-19 execution brief instructs the phase to publish four events under the
identifiers `EVT-WO-001`, `EVT-TECH-001`, `EVT-DIA-001` and `EVT-QMS-001`.

**None of those four identifiers exists anywhere in this repository.** They were
verified absent from `docs/`, `src/`, `scripts/` and `supabase/`. They are not in
`docs/standards/event-catalog-v0.1.md` and not in
`src/server/events/envelope.ts`.

Worse, there are **two conflicting candidate name sets**, and both contradict the
convention actually shipped in production code.

| Source                                                             | Proposed names                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-19 execution brief                                              | `work-order.status.changed.v1`, `work-job.status.changed.v1`, `inspection.completed.v1`, `rework-case.resolved.v1`                                                                                                                                                                   |
| P1-09 handoff (`docs/phase-1/phase-1-9/p1-19-backend-contract.md`) | `work-order.created.v1`, `work-order.state-changed.v1`, `work-order.closed.v1`, `job.assigned.v1`, `labor.session-changed.v1`, `additional-work.requested.v1`, `customer-approval.recorded.v1`, `diagnostic-report.completed.v1`, `quality-control.finalized.v1`, `rework.linked.v1` |
| **Shipped convention** (`src/server/events/envelope.ts`)           | 20 registered types, **none carrying a `.v1` suffix** — e.g. `reception.approved`, `vehicle.checked-in`, `appointment.changed`, `business-partner.created`, `access.grant.changed`                                                                                                   |

The two proposals also disagree with each other on granularity: the brief models
a single `work-order.status.changed` covering every transition, while P1-09 models
`created` / `state-changed` / `closed` as three distinct facts.

## Decision taken for P1-19

**Follow the shipped convention.** Event type strings are unsuffixed and registered
in `src/server/events/envelope.ts` alongside the existing 20, matching every event
already in production. Envelope versioning continues to be carried by the envelope's
own schema-version field rather than by the type string, exactly as the existing 20
types do — adding `.v1` to four new types and not to the other twenty would make
the vocabulary inconsistent and would silently break any consumer matching on type.

Granularity follows the **P1-09 handoff**, because it is a repository artifact
written by the phase that owns the schema, and because collapsing `created`,
`state-changed` and `closed` into one type loses the distinction the append-only
`wo.work_order_status_history` ledger already draws.

## Proposed additions

| Proposed type                 | Emitted when                                            | Wave |
| ----------------------------- | ------------------------------------------------------- | ---- |
| `work-order.created`          | a work order is created from a reception visit          | 4    |
| `work-order.state-changed`    | a work-order transition commits                         | 4    |
| `work-order.closed`           | a work order reaches a terminal, non-cancellation state | 8    |
| `job.assigned`                | a technician assignment commits                         | 5    |
| `job.state-changed`           | a job transition commits                                | 5    |
| `labor.session-changed`       | a labor session starts, pauses, resumes or stops        | 5    |
| `additional-work.requested`   | an additional-work request is raised                    | 6    |
| `customer-approval.recorded`  | a customer approval decision is recorded                | 6    |
| `diagnostic-report.completed` | a diagnostic report reaches `completed`                 | 7    |
| `quality-control.finalized`   | a QC record is finalized                                | 8    |
| `rework.linked`               | a rework link is created or independently signed off    | 8    |

`job.state-changed` is proposed in place of P1-09's absent job-transition event and
the brief's `work-job.status.changed`, for symmetry with `work-order.state-changed`.

Every proposed event would be published through the existing Phase 1-13
transactional outbox, on the request transaction, carrying the standard scope and
correlation metadata, emitted only on commit and never on rollback.

## What P1-19 does in the meantime

Implementation proceeds. State changes, status history and audit records are
written transactionally from Wave 4 onward regardless of this request's outcome,
because those are protected-schema obligations and do not depend on the event
vocabulary.

Event publication is wired behind the registered envelope constructors. If this
request is accepted as proposed, no further code change is required. If it is
amended, only `src/server/events/envelope.ts` and the publishing call sites change;
no service, repository, route or test assertion outside the event layer depends on
the chosen strings.

**Acceptance 6 of the phase brief cannot be closed until this request is
resolved**, because it requires each applicable state change to emit exactly one
required outbox event validated against its catalog schema, and there is presently
no catalog entry to validate against.

## Requested decision

1. Accept, amend, or reject the eleven proposed type names.
2. Confirm that unsuffixed type strings remain the convention, or direct that all
   24 types migrate to a `.v1` suffix as a separate, deliberate change.
3. Confirm the `EVT-WO-001` / `EVT-TECH-001` / `EVT-DIA-001` / `EVT-QMS-001`
   identifiers may be retired, or supply their real definitions if they exist
   outside this repository.
