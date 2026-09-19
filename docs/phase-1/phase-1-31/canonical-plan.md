# Phase 1-31 — Vehicle Delivery, Warranty, and Reporting Frontend (P1-31)

The execution plan of P1-31, extracted from the canonical plan document.

- **Source.** `RootLco_Phase_1_Development_Plan_recovered_v01.docx`, paragraphs **19371–19881**.
  The chapter opens at the Heading 1 at 19371 and ends where the next Heading 1 (P1-32) begins at 19882. The identical title also appears in the table of contents at paragraph 1126 and inside the
  body at 19862; neither is the chapter. The anchor is the paragraph index, never the title.
- **Extent.** Thirty-five numbered fields. Every field below is reproduced in the chapter's order
  under the chapter's own heading.
- **Task count.** **29.** Sixteen Frontend, four Security, five QA, two DevOps, two Documentation.
  See [Task count](#task-count-29) for how that number is established.
- **Status.** Every one of the 29 tasks is `Planned`. Nothing in this document marks any task
  complete, and nothing in this document is execution evidence.

This file is an extraction, not an interpretation. Where the chapter's own wording is repetitive,
generated or internally odd, it is reproduced as written and the oddity is recorded rather than
smoothed. Measurement of the repository against this chapter is a separate document,
[`a0-preflight.md`](./a0-preflight.md).

---

## 1. Phase ID

P1-31

## 2. Phase title

Vehicle Delivery, Warranty, and Reporting Frontend

## 3. Purpose

> Deliver the controlled Phase 1 capability for vehicle delivery, warranty, and reporting frontend
> as part of RootLco's commercial multi-tenant automotive SaaS platform. The phase converts approved
> requirements into reviewable work without claiming implementation or test completion before
> evidence exists.

## 4. Business value

> This phase advances the usable Benzene pilot journey while preserving a reusable product boundary:
> Benzene is the first subscribed tenant and pilot, never a hard-coded owner or product-specific
> branch. It reduces delivery risk by making scope, roles, contracts, tests, evidence, and exit
> authority explicit.

## 5. Scope

Sixteen scope items, then a traceability bullet. The casing is the chapter's: item 1 is Title-Case
and items 2–16 are lower-case. That anomaly is reproduced verbatim in the Field 14 task names and is
carried mid-sentence into the task descriptions, which is how the Frontend rows can be seen to have
been expanded mechanically from this list.

1. Ready-for-delivery list.
2. delivery eligibility.
3. authorized receiver.
4. delivery checklist.
5. final odometer.
6. delivery signatures.
7. delivery document.
8. warranty record.
9. warranty history.
10. operational dashboard.
11. work-order reports.
12. technician reports.
13. inventory reports.
14. invoice/payment reports.
15. audit report.
16. branch pilot summary.

- Traceability to: FR-QMS-001; FR-WTY-001; FR-WTY-002; FR-WTY-003; FR-WTY-004; FR-RPT-001;
  FR-RPT-002; FR-RPT-003; FR-RPT-004; FR-AUD-001.

## 6. Out-of-scope

- Any Chapter 3 capability marked Future or Could unless promoted by an approved change request.
- New visual design work: frontend phases implement only owner-approved prototypes (OIR-06).
- Zoom Vehicle Inspection and Evaluation Services; it remains outside Phase 1.
- Country-, tax-, currency-, payment-, retention-, or policy-specific defaults that remain open
  decisions.

## 7. Preconditions

- The dependencies in Field 8 have passed their recorded exit gates: Phases 1-22, 1-23, 1-24, and
  1-25.
- Applicable open decisions are approved or the work is deliberately limited to decision-neutral
  foundations.
- Product name remains [PRODUCT NAME — Pending Final Approval]; RootLco is not used as the product
  name.
- No task may be marked complete without a linked acceptance-evidence record.

## 8. Dependencies

Phases 1-22, 1-23, 1-24, and 1-25

## 9. Inputs

- documentation/04-chapter-03-requirements.md and the approved change log.
- documentation/05-chapter-04-methodology-architecture.md, the database plan, and approved
  dependency contracts.
- documentation/07-chapter-06-testing-plan.md and the test identifiers listed in Field 28.
- Open Decisions Register, risk register, approved UI prototypes where applicable, and verified
  Benzene evidence only where the phase is customer-specific.

## 10. Stakeholders

- RootLco founders as Product Owner; technical, security, QA, DevOps, business-analysis, and
  documentation roles.
- Benzene authorized representatives are consulted for operational meaning and customer-specific
  configuration; they approve only the pilot/operational decisions assigned to them.

## 11. Responsible role

> Primary: Frontend developer. Accountable: RootLco founders (Product Owner). Independent gate
> reviews: QA lead and Security reviewer where applicable.

## 12. Database work

> Not applicable in this phase, because product schema and RLS delivery is gated in Phases 1-2…1-12.
> This phase consumes those approved structures; a discovered schema defect returns through change
> control rather than an untracked edit.

## 13. Backend work

> Not applicable as new feature development in this phase, because backend capability is delivered
> and gated by Phase 1-24. Defects found here return to the owning backend phase under change
> control.

**Read this field precisely.** It does not say that no backend work may happen. It says that new
feature development is not this phase's business, because Phase 1-24 delivered and gated the backend
capability, and that a **defect found here returns to the owning backend phase under change
control**. A missing or defective backend contract discovered by P1-31 is therefore routed, not
built here and not silently absorbed into a Frontend task.

Field 8 and Field 13 both name **Phase 1-24** as the owning backend phase. That naming is recorded
here as the chapter states it; who in fact owns each specific prerequisite is measured and
dispositioned in [`a0-preflight.md`](./a0-preflight.md).

---

## Task count: 29

**The chapter declares 29 tasks**, distributed across the five task fields:

| Field | Work          | Tasks  | Ids                   | Paragraphs  |
| ----- | ------------- | ------ | --------------------- | ----------- |
| 14    | Frontend      | 16     | P1-31-FE-001…FE-016   | 19436–19611 |
| 15    | Security      | 4      | P1-31-SEC-001…SEC-004 | 19624–19667 |
| 16    | QA            | 5      | P1-31-QA-001…QA-005   | 19680–19734 |
| 17    | DevOps        | 2      | P1-31-DO-001…DO-002   | 19747–19768 |
| 18    | Documentation | 2      | P1-31-DOC-001…DOC-002 | 19781–19802 |
| —     | **Total**     | **29** | —                     | —           |

The count is corroborated four independent ways over the chapter: the shared acceptance-condition
string occurs 29 times; the string `Phase 1-31 Field 34 synchronization set` occurs 29 times; the
standalone `Planned` status cells number 29; and the five task tables sum to 29 rows.

Fields 12, 13 and 19 carry no tasks — each is a prose "Not applicable" paragraph.

### The five strings every one of the 29 tasks shares

Recorded here once, because the chapter repeats each of them 29 times and no task varies:

- **Inputs (identical, all 29):**
  > Approved Chapter 3 requirements; approved dependency outputs; applicable open-decision
  > constraints
- **Acceptance condition (identical, all 29):**
  > Output is reviewable, tenant/company/branch scoped where applicable, traceable to requirements,
  > and its negative path is tested; no completion is claimed without evidence
- **Documentation reference (identical, all 29):**
  > Phase 1-31 Field 34 synchronization set
- **Status (identical, all 29):** `Planned`
- **Expected output (per task, one pattern):** `<task name> implementation/evidence artifact`

Because the acceptance condition does not vary, it discriminates nothing between tasks. It is a
phase-wide obligation printed on every row, and the discriminating obligations for a given task are
the phase-level ones layered above it — Field 7's rule that no task is complete without a linked
acceptance-evidence record, Field 27's rule that no result is marked passed without evidence in
`_acceptance/`, and Field 32's rule that a planning document alone is not execution evidence.

### The dependency graph: five independent linear chains, no join

Proved mechanically over the chapter: each of the 29 task ids occurs exactly **twice** in
19371–19881 — once as its own Task ID cell and once as the next task's Dependency cell — except
exactly five ids that occur **once**: FE-016, SEC-004, QA-005, DO-002 and DOC-002, the tail of each
table.

Therefore:

- The first task of each of the five tables depends on **Phases 1-22, 1-23, 1-24, and 1-25**
  (FE-001, SEC-001, QA-001, DO-001, DOC-001).
- Every other task depends **only** on the immediately preceding task of the **same** table.
- **No cross-table dependency exists anywhere in the chapter.** FE-016 does not gate QA-001; DOC-002
  gates nothing. The five chains never join.

The only convergence declared anywhere in the chapter is the exit gate, Field 33, Gate P1-G31.

**This shape governs scheduling and is recorded for that reason.** Four of the five chains — SEC,
QA, DO and DOC — head on the four dependency phases and are independent of the Frontend chain, so
nothing in the chapter serialises them behind Frontend work. Within the Frontend chain, taken
literally, the chapter forbids all parallel Frontend work: FE-001 through FE-016 run one after
another, with warranty (FE-008) attached to `delivery document` (FE-007) rather than to the four
dependency phases, and `operational dashboard` (FE-010) attached to `warranty history` (FE-009).

### The Test reference rotates and carries no meaning

Across all five tables the Test reference cycles TC-WTY-001 / TC-RPT-001 / TC-QMS-001, restarting at
the head of each table. It is mechanical, not semantic: it is why `final odometer` (FE-005) carries a
reporting test case and `audit report` (FE-015) carries a quality-management one. The reference is
reproduced below exactly as the chapter states it, without correction.

Field 28 additionally declares TC-P1-31-001 and TC-P1-31-002. Each occurs exactly once in the
chapter — its own declaration — and **no task row references either**.

---

## 14. Frontend work

**Responsible role for all sixteen:** Frontend developer.

**Description (identical pattern, all sixteen):**

> Implement `<task name>` against the approved UI prototype and approved backend contract, including
> Arabic/English, RTL/LTR, desktop/tablet, accessibility, and loading/empty/error/permission states.

Five implementation obligations therefore bind every Frontend task: the approved UI prototype and
approved backend contract; Arabic/English; RTL/LTR; desktop/tablet; accessibility; and the
loading/empty/error/permission states. **Mobile is never named anywhere in the chapter** — the
breakpoint obligation is desktop/tablet.

| Task ID      | Task name               | Dependencies                    | Expected output                                          | Test reference | Status  |
| ------------ | ----------------------- | ------------------------------- | -------------------------------------------------------- | -------------- | ------- |
| P1-31-FE-001 | Ready-for-delivery list | Phases 1-22, 1-23, 1-24, & 1-25 | Ready-for-delivery list implementation/evidence artifact | TC-WTY-001     | Planned |
| P1-31-FE-002 | delivery eligibility    | P1-31-FE-001                    | delivery eligibility implementation/evidence artifact    | TC-RPT-001     | Planned |
| P1-31-FE-003 | authorized receiver     | P1-31-FE-002                    | authorized receiver implementation/evidence artifact     | TC-QMS-001     | Planned |
| P1-31-FE-004 | delivery checklist      | P1-31-FE-003                    | delivery checklist implementation/evidence artifact      | TC-WTY-001     | Planned |
| P1-31-FE-005 | final odometer          | P1-31-FE-004                    | final odometer implementation/evidence artifact          | TC-RPT-001     | Planned |
| P1-31-FE-006 | delivery signatures     | P1-31-FE-005                    | delivery signatures implementation/evidence artifact     | TC-QMS-001     | Planned |
| P1-31-FE-007 | delivery document       | P1-31-FE-006                    | delivery document implementation/evidence artifact       | TC-WTY-001     | Planned |
| P1-31-FE-008 | warranty record         | P1-31-FE-007                    | warranty record implementation/evidence artifact         | TC-RPT-001     | Planned |
| P1-31-FE-009 | warranty history        | P1-31-FE-008                    | warranty history implementation/evidence artifact        | TC-QMS-001     | Planned |
| P1-31-FE-010 | operational dashboard   | P1-31-FE-009                    | operational dashboard implementation/evidence artifact   | TC-WTY-001     | Planned |
| P1-31-FE-011 | work-order reports      | P1-31-FE-010                    | work-order reports implementation/evidence artifact      | TC-RPT-001     | Planned |
| P1-31-FE-012 | technician reports      | P1-31-FE-011                    | technician reports implementation/evidence artifact      | TC-QMS-001     | Planned |
| P1-31-FE-013 | inventory reports       | P1-31-FE-012                    | inventory reports implementation/evidence artifact       | TC-WTY-001     | Planned |
| P1-31-FE-014 | invoice/payment reports | P1-31-FE-013                    | invoice/payment reports implementation/evidence artifact | TC-RPT-001     | Planned |
| P1-31-FE-015 | audit report            | P1-31-FE-014                    | audit report implementation/evidence artifact            | TC-QMS-001     | Planned |
| P1-31-FE-016 | branch pilot summary    | P1-31-FE-015                    | branch pilot summary implementation/evidence artifact    | TC-WTY-001     | Planned |

Inputs, acceptance condition and documentation reference are the shared strings recorded above, on
every row without variation.

## 15. Security work

**Responsible role for all four:** Security reviewer.

**Description (identical pattern, all four):**

> Complete and evidence `<task name>` under the Phase 1 engineering and governance standards.

| Task ID       | Task name                                        | Dependencies                    | Expected output                                                                   | Test reference | Status  |
| ------------- | ------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- | -------------- | ------- |
| P1-31-SEC-001 | Permission and resolved-scope enforcement        | Phases 1-22, 1-23, 1-24, & 1-25 | Permission and resolved-scope enforcement implementation/evidence artifact        | TC-WTY-001     | Planned |
| P1-31-SEC-002 | Sensitive-data, export, and file-access controls | P1-31-SEC-001                   | Sensitive-data, export, and file-access controls implementation/evidence artifact | TC-RPT-001     | Planned |
| P1-31-SEC-003 | Abuse-case and privilege-escalation controls     | P1-31-SEC-002                   | Abuse-case and privilege-escalation controls implementation/evidence artifact     | TC-QMS-001     | Planned |
| P1-31-SEC-004 | Security audit-event coverage                    | P1-31-SEC-003                   | Security audit-event coverage implementation/evidence artifact                    | TC-WTY-001     | Planned |

## 16. QA work

**Responsible role for all five:** QA lead.

**Description (identical pattern, all five):**

> Design and automate `<task name>` with positive, negative, isolation, failure, and recovery
> coverage appropriate to the affected workflow.

| Task ID      | Task name                                | Dependencies                    | Expected output                                                           | Test reference | Status  |
| ------------ | ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- | -------------- | ------- |
| P1-31-QA-001 | Unit and component test coverage         | Phases 1-22, 1-23, 1-24, & 1-25 | Unit and component test coverage implementation/evidence artifact         | TC-WTY-001     | Planned |
| P1-31-QA-002 | API/contract and error-path coverage     | P1-31-QA-001                    | API/contract and error-path coverage implementation/evidence artifact     | TC-RPT-001     | Planned |
| P1-31-QA-003 | Tenant/company/branch isolation coverage | P1-31-QA-002                    | Tenant/company/branch isolation coverage implementation/evidence artifact | TC-QMS-001     | Planned |
| P1-31-QA-004 | Concurrency and idempotency coverage     | P1-31-QA-003                    | Concurrency and idempotency coverage implementation/evidence artifact     | TC-WTY-001     | Planned |
| P1-31-QA-005 | Regression and evidence packaging        | P1-31-QA-004                    | Regression and evidence packaging implementation/evidence artifact        | TC-RPT-001     | Planned |

## 17. DevOps work

**Responsible role for both:** DevOps engineer.

**Description (identical pattern, both):**

> Prepare and automate `<task name>` with environment segregation, least privilege, observable
> execution, rollback criteria, and a recorded operator runbook.

| Task ID      | Task name                                         | Dependencies                    | Expected output                                                                    | Test reference | Status  |
| ------------ | ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- | -------------- | ------- |
| P1-31-DO-001 | Continuous-integration quality gate               | Phases 1-22, 1-23, 1-24, & 1-25 | Continuous-integration quality gate implementation/evidence artifact               | TC-WTY-001     | Planned |
| P1-31-DO-002 | Structured logging, monitoring, and alert routing | P1-31-DO-001                    | Structured logging, monitoring, and alert routing implementation/evidence artifact | TC-RPT-001     | Planned |

**DO-001 covers the continuous-integration quality gate. DO-002 covers structured logging,
monitoring, and alert routing.** Neither task mentions deployment, provisioning or environment
creation; the shared description's "environment segregation" is an obligation on how the gate and
the logging are prepared, not a licence to create an environment.

## 18. Documentation work

**Responsible role for both:** Business analyst / document controller.

**Description (identical pattern, both):**

> Produce the controlled record for `<task name>`, link all supporting evidence, identify unresolved
> limitations, and route the result to the named approval owner.

| Task ID       | Task name                                           | Dependencies                    | Expected output                                                                      | Test reference | Status  |
| ------------- | --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ | -------------- | ------- |
| P1-31-DOC-001 | Contract, catalog, and traceability synchronization | Phases 1-22, 1-23, 1-24, & 1-25 | Contract, catalog, and traceability synchronization implementation/evidence artifact | TC-WTY-001     | Planned |
| P1-31-DOC-002 | Operator/developer guidance and change-log update   | P1-31-DOC-001                   | Operator/developer guidance and change-log update implementation/evidence artifact   | TC-RPT-001     | Planned |

## 19. Data migration work

> Not applicable in this phase, because Benzene data preparation and migration is owned by Phase
> 1-35. Synthetic fixtures and configuration seeds are test inputs, not legacy-data migration.

## 20. User Stories

- **P1-31-US-001** — As an authorized operational user, I want ready-for-delivery list, so that I
  can complete my assigned work without bypassing policy or losing traceability.
  - Acceptance criteria: the normal flow and each named exception return a clear result;
    unauthorized and out-of-scope attempts fail closed.
- **P1-31-US-002** — As a RootLco security or support reviewer, I want every applicable action
  scoped and correlated, so that I can investigate behavior without exposing another tenant,
  company, or branch.
  - Acceptance criteria: audit/log/evidence links share correlation identifiers and contain no
    prohibited sensitive payload.
- **P1-31-US-003** — As the RootLco Product Owner, I want an evidence-based exit decision for this
  phase, so that later work consumes only an approved baseline.
  - Acceptance criteria: all deliverables and trace links are present; unresolved decisions, risks,
    defects, and limitations are explicitly dispositioned.

## 21. Technical Stories

- **P1-31-TS-001** — As the platform, I need every command to authenticate, resolve scope, validate,
  authorize, transact, audit, publish through the outbox, and return a structured response.
  - Acceptance criteria: pipeline conformance is proven for success, denial, validation failure,
    conflict, and injected rollback.
- **P1-31-TS-002** — As the delivery pipeline, I need automated tests and documentation checks tied
  to stable IDs.
  - Acceptance criteria: missing tests, uncatalogued errors/events, or broken trace links block the
    phase gate.
- **P1-31-TS-003** — As an operator, I need observable, replay-safe behavior with explicit recovery
  steps.
  - Acceptance criteria: correlation, retry, idempotency, concurrency, and rollback behavior are
    documented and tested where applicable.

## 22. Business rules

- **BR-QMS-001** — apply the approved Chapter 3 wording; any refinement requires a change request
  and synchronized rule catalog.
- **BR-WTY-001** — apply the approved Chapter 3 wording; any refinement requires a change request
  and synchronized rule catalog.
- **BR-RPT-001** — apply the approved Chapter 3 wording; any refinement requires a change request
  and synchronized rule catalog.
- **BR-AUD-001** — apply the approved Chapter 3 wording; any refinement requires a change request
  and synchronized rule catalog.
- **Cross-cutting rule:** client-provided tenant/company/branch scope is never authoritative; the
  server resolves scope and PostgreSQL RLS remains default-deny.

## 23. APIs

- GET /api/v1/deliveries.
- GET /api/v1/warranties.
- GET /api/v1/reports/{reportCode}.
- POST /api/v1/reports/{reportCode}:export.
- Every public operation is versioned under /api/v1, represented in OpenAPI, uses Zod validation,
  correlation IDs, RFC 9457-style problem details, and decimal strings plus currency codes for
  money.

## 24. Events

- Consume delivery, warranty, and report-export events for state refresh only.
- Mutating events are written to the transactional outbox with schema version, tenant scope,
  correlation ID, causation ID, occurred-at time, and replay-safe consumer expectations.

## 25. Error cases

- Validation failure: return field-level violations; perform no mutation.
- Authentication, permission, tenant/company/branch scope, approval-limit, export, or file-policy
  failure: fail closed without data leakage and emit the required security/audit record.
- Stale version, duplicate command, or concurrent conflict: preserve the committed winner and return
  a stable conflict/idempotency result.
- Dependency, storage, email, worker, or database failure: roll back the business transaction where
  required, retain safe retry state, and expose the correlation ID without internals.

## 26. Audit requirements

- Record actor/service identity, tenant/company/branch scope, action, target, prior/new lifecycle
  state where applicable, reason, result, time, correlation ID, and evidence reference.
- Audit and status-history records are append-only to application roles; exports and privileged
  reads are themselves audited.
- Logs exclude secrets and unnecessary personal, financial, diagnostic, and employee data.

## 27. Acceptance criteria

- All mandated scope items in Field 5 are represented by executable tasks and trace to FR-QMS-001;
  FR-WTY-001; FR-WTY-002; FR-WTY-003; FR-WTY-004; FR-RPT-001; FR-RPT-002; FR-RPT-003; FR-RPT-004;
  FR-AUD-001.
- Normal, alternative, exception, denial, concurrency/idempotency, and failure-recovery paths are
  defined and tested where applicable.
- Tenant isolation and company/branch isolation are verified through the runtime role; no
  client-supplied scope is trusted.
- Security, QA, DevOps, documentation, risk, and change-control tasks have reviewable outputs and
  named owners.
- API, event, error, audit, test, and documentation catalogs are synchronized and lint clean.
- RootLco spelling and ownership are correct; product name remains pending; Benzene remains the
  configurable first pilot tenant; Zoom remains excluded.
- No result is marked passed, migrated, deployed, trained, piloted, or accepted without evidence in
  \_acceptance/.

## 28. Test cases

- **TC-WTY-001** — execute the approved catalogue case and attach actual result, environment, build,
  evidence, and defect reference.
- **TC-RPT-001** — execute the approved catalogue case and attach actual result, environment, build,
  evidence, and defect reference.
- **TC-QMS-001** — execute the approved catalogue case and attach actual result, environment, build,
  evidence, and defect reference.
- **TC-P1-31-001** — phase-specific normal-flow and acceptance-criteria coverage.
- **TC-P1-31-002** — phase-specific negative scope, permission, concurrency/idempotency, and
  recovery coverage.

## 29. Risks

- **RSK-20** — apply the trigger, mitigation, contingency, and owner recorded in
  12-phase-1-risk-register.md.
- **RSK-31** — apply the trigger, mitigation, contingency, and owner recorded in
  12-phase-1-risk-register.md.
- **RSK-27** — apply the trigger, mitigation, contingency, and owner recorded in
  12-phase-1-risk-register.md.

The chapter lists them in this order — 20, then 31, then 27.

## 30. Deliverables

- Implementable work package and review evidence for Phase 1-31 — Vehicle Delivery, Warranty, and
  Reporting Frontend.
- Updated API/event/error/test documentation or explicit not-applicable decision.
- Security, QA, CI/observability, traceability, risk, and documentation synchronization records.

## 31. Definition of Ready

- Dependencies have recorded gate decisions; required requirements/rules and input contracts are
  approved and versioned.
- Applicable decisions, prototypes, Benzene evidence, environment access, roles, test data, and
  reviewers are available or the phase is restricted to decision-neutral tasks.
- Stories and tasks are estimable, have owners, acceptance conditions, test references,
  documentation references, and no hidden scope.

## 32. Definition of Done

- Every applicable task is implemented, reviewed, tested, documented, and linked to immutable
  evidence; CI and phase-specific gates pass.
- Security and isolation findings are closed or formally accepted by the authorized owner; no
  critical unresolved defect passes.
- Traceability, risks, decisions, changes, contracts, catalogs, runbooks, and Master Documentation
  references are synchronized.
- The Product Owner records the phase decision; a planning document alone is not execution evidence.

## 33. Exit gate

> Gate P1-G31: RootLco may authorize dependent work only when the Definition of Done is evidenced,
> the QA lead certifies the test/evidence index, the Security reviewer clears applicable blockers,
> and the approval owner records Pass / Conditional Pass / Fail / Deferred with conditions. Until
> then, status remains Planned.

Four conjunctive conditions, and one consequence: until all four hold, the phase status **remains
Planned**.

## 34. Documentation files to update

- documentation/04-chapter-03-requirements.md;
  documentation/05-chapter-04-methodology-architecture.md;
  documentation/06-chapter-05-implementation-plan.md; documentation/07-chapter-06-testing-plan.md
  where approved findings change their baselines.
- documentation/\_registry/change-log.md; API/error/event/test catalogs; data dictionary/ERDs where
  affected.
- The owning canonical Phase 1 file, 10-phase-1-traceability-matrix.md,
  11-phase-1-open-decisions.md, 12-phase-1-risk-register.md, 13-phase-1-deliverable-manifest.md, and
  \_acceptance/ evidence index.

This is the set the shared Documentation reference on all 29 rows — "Phase 1-31 Field 34
synchronization set" — points at.

## 35. Approval owner

> RootLco founders (Product Owner), with the technical, Security, QA, data, or release sign-offs
> required by this phase. Benzene input is advisory unless a named pilot/customer decision is
> explicitly assigned to it.

---

## What this document deliberately does not do

- It does not mark any task complete. Every status in the chapter is `Planned`, and Field 33 keeps
  it there until the gate records a decision.
- It does not rewrite a task name. The lower-case names, the `invoice/payment reports` slash and the
  Title-Case first item are the chapter's.
- It does not repair the Test reference rotation, invent a permission code, an operation id, a
  report code or a requirement id, or supply a definition the chapter withholds.
- It does not measure the repository. Which of these tasks is buildable today, what is missing, and
  what the Owner must decide are in [`a0-preflight.md`](./a0-preflight.md).
