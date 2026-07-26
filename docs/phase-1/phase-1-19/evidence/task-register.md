# P1-19 — Authoritative task register

**33 tasks**: 20 backend, 4 security, 5 QA, 2 DevOps, 2 documentation. Every one is
mapped below to the artefact that delivers it and the evidence that proves it.

## Why this file exists

Until it was written, **13 of the 33 task identifiers appeared nowhere in the
repository**. `P1-19-BE-001`…`020` were annotated in route and module headers, but
`P1-19-SEC-001`…`004`, `P1-19-QA-002`…`005`, `P1-19-DO-001`…`002` and `P1-19-DOC-002`
had no anchor at all — the _work_ existed in `security-review.md`, `qa-evidence.md`,
`devops-observability.md`, `errors-and-events.md` and `change-log.md`, but nothing
connected a task identifier to it.

That is the same gap P1-18 hit at its gate: a phase can be substantively complete and
still be unable to demonstrate it, because "the security review exists" and "SEC-003 is
delivered" are different claims. The pre-merge completeness audit found it here, and the
identifiers are now anchored in the delivering documents rather than asserted only in
this table — so the mapping is checkable in both directions.

**The canonical Phase 1 Development Plan lives outside this repository by owner
decision**, so the task _titles_ below are the ones named in the phase's execution
brief, not quotations from the plan. What is verifiable in-repo — and what this table
therefore carries — is the artefact, the evidence and the status.

## Backend — 20 tasks

`P1-19-BE-nnn` identifiers are annotated in the implementing route and module headers.
The operation-level map is generated in
[`task-traceability.md`](task-traceability.md); the surface itself is generated in
[`endpoint-inventory.md`](endpoint-inventory.md).

| Task       | Delivers                                         | Anchored in                                                                             | Status    |
| ---------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | --------- |
| **BE-001** | Four module boundaries and their public surfaces | `src/modules/*/{domain,data,application}` headers                                       | Delivered |
| **BE-002** | Work-order repository, locked reads, versioning  | `work-order/data/work-order-repository.ts`                                              | Delivered |
| **BE-003** | Work-order state transition                      | `work-orders/[workOrderId]/transition/route.ts`                                         | Delivered |
| **BE-004** | Closure eligibility, all six blockers            | `work-orders/[workOrderId]/closure-eligibility/route.ts`                                | Delivered |
| **BE-005** | Closure behind its own permission                | `work-orders/[workOrderId]/closure/route.ts`                                            | Delivered |
| **BE-006** | Work-order list and additional-work requests     | `work-orders/route.ts`, `.../additional-work/route.ts`                                  | Delivered |
| **BE-007** | Work-order detail and customer approval          | `work-orders/[workOrderId]/route.ts`, `.../approval/`                                   | Delivered |
| **BE-008** | Work-order history and approval fulfilment       | `.../history/route.ts`, `.../fulfillment/route.ts`                                      | Delivered |
| **BE-009** | Job creation and the diagnostic report surface   | `work-orders/[workOrderId]/jobs/`, `jobs/[jobId]/inspections/`                          | Delivered |
| **BE-010** | Job update and diagnostic entry recording        | `jobs/[jobId]/route.ts`, `inspections/[id]/{measurements,dtcs,findings,evidence,items}` | Delivered |
| **BE-011** | Job and diagnostic transitions, completion       | `jobs/[jobId]/transition/`, `inspections/[id]/{transition,completion}`                  | Delivered |
| **BE-012** | Job history, recommendations, diagnostic review  | `jobs/[jobId]/history/`, `inspections/[id]/{recommendations,reviews}`                   | Delivered |
| **BE-013** | Technician assignment                            | `jobs/[jobId]/assignments/route.ts`                                                     | Delivered |
| **BE-014** | Assignment ending                                | `assignments/[assignmentId]/end/route.ts`                                               | Delivered |
| **BE-015** | Atomic reassignment                              | `jobs/[jobId]/reassignments/route.ts`                                                   | Delivered |
| **BE-016** | Technician queue and ranked availability         | `technicians/[id]/queue/`, `technicians/available/`                                     | Delivered |
| **BE-017** | Labour sessions and quality-control execution    | `jobs/[jobId]/labor-sessions/`, `quality-controls/**`                                   | Delivered |
| **BE-018** | Labour stop and the reopen refusal ledger        | `labor-sessions/[id]/stop/`, `.../reopen-attempts/`                                     | Delivered |
| **BE-019** | Labour correction, rework and restricted cost    | `labor-sessions/[id]/corrections/`, `rework-links/**`                                   | Delivered |
| **BE-020** | Service lines and required-part demand           | `.../service-lines/`, `.../required-parts/`                                             | Delivered |

**A known imprecision, recorded rather than tidied.** Seven of these identifiers annotate
operations in **two different schemas**, because the work-order/technician waves and the
diagnostics/QMS waves were numbered independently against a plan that is not in this
repository. That is open finding `P1-19-A-03`. The table above assigns each identifier
the surfaces its annotations actually reach; it does not invent a cleaner assignment,
because the only authority that could confirm one is outside the repository. What is
established independently of the identifiers is that **all 58 operations are guarded,
audited where they change state, implemented in a module and covered at operation
depth** — see [`task-traceability.md`](task-traceability.md).

## Security — 4 tasks

| Task        | Requirement                                     | Delivered by                                                                                                               | Status    |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| **SEC-001** | Permission and resolved-scope enforcement       | [`security-review.md`](security-review.md) §1 + the structural scope guard in `scripts/p1-19-endpoint-inventory.mjs`       | Delivered |
| **SEC-002** | Sensitive-data, export and file-access controls | [`security-review.md`](security-review.md) §2                                                                              | Delivered |
| **SEC-003** | Abuse-case and privilege-escalation controls    | [`security-review.md`](security-review.md) §3 and §5                                                                       | Delivered |
| **SEC-004** | Security audit-event coverage                   | [`security-review.md`](security-review.md) §4 + the audit-action section of [`errors-and-events.md`](errors-and-events.md) | Delivered |

SEC-001 is the task the final adversarial review reopened: `tech.labor-session-list`
left P1-18-A-01 open on timesheet data. It is closed in the service, in the suite, and
by a build-failing structural guard that is mutation-tested against the defect.

## QA — 5 tasks

| Task       | Requirement                              | Delivered by                                                                                                                   | Status    |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **QA-001** | Unit and component test coverage         | [`qa-evidence.md`](qa-evidence.md) — test-file table                                                                           | Delivered |
| **QA-002** | API/contract and error-path coverage     | [`qa-evidence.md`](qa-evidence.md) — operation depth 58/58                                                                     | Delivered |
| **QA-003** | Tenant/company/branch isolation coverage | [`qa-evidence.md`](qa-evidence.md) — closure matrix + the four-way read probe in [`security-review.md`](security-review.md) §1 | Delivered |
| **QA-004** | Concurrency and idempotency coverage     | [`qa-evidence.md`](qa-evidence.md) — forced-race section                                                                       | Delivered |
| **QA-005** | Regression and evidence packaging        | [`qa-evidence.md`](qa-evidence.md) — the three suite deltas each equal to the phase's own tests                                | Delivered |

## DevOps — 2 tasks

| Task       | Requirement                                      | Delivered by                                                                                          | Status    |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------- |
| **DO-001** | Continuous-integration quality gate              | [`devops-observability.md`](devops-observability.md) — the new CI step and what it fails on           | Delivered |
| **DO-002** | Structured logging, monitoring and alert routing | [`devops-observability.md`](devops-observability.md) — logging, error monitoring and metrics sections | Delivered |

DO-002 is delivered **with a stated limit rather than an overstatement**: the monitoring
port is a capture boundary, not a provisioned platform — no DSN and no environment beyond
Local exists (ADR-012) — and this phase installs no adapter. Alert _routing_ is therefore
documented as the contract an adapter must satisfy, not claimed as configured.

## Documentation — 2 tasks

| Task        | Requirement                                        | Delivered by                                                                                                                                                   | Status    |
| ----------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **DOC-001** | Contract, catalog and traceability synchronization | [`errors-and-events.md`](errors-and-events.md) + generated [`endpoint-inventory.md`](endpoint-inventory.md) and [`task-traceability.md`](task-traceability.md) | Delivered |
| **DOC-002** | Operator/developer guidance and change-log update  | [`change-log.md`](change-log.md) + [`state-machines-and-closure-gate.md`](state-machines-and-closure-gate.md)                                                  | Delivered |

## Reconciliation

|               |             |
| ------------- | ----------- |
| Backend       | 20 / 20     |
| Security      | 4 / 4       |
| QA            | 5 / 5       |
| DevOps        | 2 / 2       |
| Documentation | 2 / 2       |
| **Total**     | **33 / 33** |

Every identifier in this register is greppable in the repository:
`grep -rhoE "P1-19-(BE|SEC|QA|DO|DOC)-[0-9]+" src tests docs scripts | sort -u`
returns all 33.
