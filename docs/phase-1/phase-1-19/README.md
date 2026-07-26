# Phase 1-19 — Work Order, Diagnostics, and Technician Backend

**Status: in execution. No owner gate exists yet and none may be written until the
implementation waves are delivered, reviewed, and merged.** Nothing in this
directory may be read as a gate decision.

Product name: `[PRODUCT NAME — Pending Final Approval]`. Benzene remains the
configurable first tenant and pilot and appears nowhere in product code, database
behaviour, permissions, workflows, routes or shared defaults.

| Item           | Value                                                         |
| -------------- | ------------------------------------------------------------- |
| Phase          | P1-19 — Work Order, Diagnostics, and Technician Backend       |
| Exit gate      | P1-G19                                                        |
| Protected base | `origin/develop` = `f326e24c0340e2ce97a94a768868a26d0cfbb04f` |
| Predecessor    | P1-18 Appointment and Reception Backend — **Go**, gate PR #81 |
| Schema         | Phase 1-9 (`wo`, `tech`, `dia`, `qms`), frozen at Phase 1-12  |
| Database work  | **Not applicable** — P1-19 adds no migration                  |
| Delivery       | wave-per-PR (see §4)                                          |

## 0. Protected ground truth (Wave 0)

Verified before any file was created.

| Check                             | Result                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `origin/develop`                  | `f326e24…` — matches the expected P1-18 closure SHA exactly                  |
| P1-18 reviewed gate SHA `315f9d3` | contained in `develop`                                                       |
| P1-18 gate merge                  | `f326e24`, parents `a13ff8b` + `315f9d3`, tree identical to `315f9d3^{tree}` |
| `origin/main`                     | **moved** `3e2c44d` → `491c4e0`                                              |
| Existing P1-19 work               | none — no branch, no module, no docs directory                               |
| Working tree                      | clean                                                                        |

**PR #78 was merged by the owner during the interval between P1-18 closure and
this phase's start.** `491c4e0` has parents `3e2c44d` + `f326e24`, was committed
by GitHub at 2026-07-26 11:43:07 +0300, and its tree `96a01e73…` is byte-identical
to `develop`'s. `main..develop` is empty, so P1-18 is fully promoted. This was an
authorized maintainer action; P1-19 did not initiate, modify, or depend on it, and
`develop` is unchanged by it. `develop` therefore remains the correct P1-19 base.

```
P1_19_BASE_SHA=f326e24c0340e2ce97a94a768868a26d0cfbb04f
```

## 1. Protected baseline

Executed on the untouched base before any change. Full evidence in
[`evidence/protected-baseline.md`](evidence/protected-baseline.md).

| Suite / gate                              | Result                                              |
| ----------------------------------------- | --------------------------------------------------- |
| `format:check`, `lint`, `typecheck`       | green                                               |
| `test` (unit)                             | **39 files / 829 tests** passed                     |
| `test:db`                                 | **132 files / 1547 tests** passed                   |
| `test:backend`                            | **38 files / 771 tests** passed                     |
| `validate:module-boundaries`              | OK                                                  |
| `validate:authorization-coverage`         | OK                                                  |
| `validate:openapi`                        | 94 paths, **110 operations**, all guarded           |
| `validate:wo-tech-dia-qms-classification` | 657 columns classified (3 restricted, 0 searchable) |
| `security:all`                            | OK across 1104 tracked files                        |

The baseline is **green**, so any failure appearing later in this phase is a
P1-19 regression and may not be attributed to inherited debt.

## 2. Schema archaeology (Wave 1) — the brief's table names are wrong

The execution brief for this phase names tables that do not exist. The
authoritative handoff is
[`../phase-1-9/p1-19-backend-contract.md`](../phase-1-9/p1-19-backend-contract.md),
written by P1-09 for precisely this purpose, and it was reconciled against the
live catalog: **44 tables and 27 functions** across `wo`, `tech`, `dia`, `qms`.

| Brief assumed                                    | Actual protected object                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `work_order`, `work_job`                         | `wo.work_orders`, `wo.jobs`                                        |
| `job_assignment`, `labor_session`                | `wo.job_assignments`, `tech.labor_sessions`                        |
| `work_order_service`, `required_part`            | `wo.work_order_service_lines`, `wo.required_parts`                 |
| `inspection`, `inspection_finding`               | `dia.diagnostic_reports`, `dia.findings`                           |
| `inspection_template_version`                    | `dia.template_versions` (+ `dia.template_items`)                   |
| `diagnostic_measurement`                         | `dia.measurements`                                                 |
| `finding_evidence`                               | `dia.diagnostic_evidence`                                          |
| `diagnostic_recommendation`, `diagnostic_review` | `dia.recommendations`, `dia.diagnostic_reviews`                    |
| `employee_skill`, `employee_certification`       | `tech.technician_skills`, `tech.technician_certifications`         |
| `quality_control_record`                         | `qms.quality_control_records` (+ `qms.qc_check_results`)           |
| `reopen_record`                                  | `qms.reopen_attempts` (+ function `qms.attempt_reopen(uuid,text)`) |
| `rework_link`                                    | `qms.rework_links` (+ `qms.rework_link_details`)                   |

Implementation must be written against the verified names only. No code in this
phase may be authored from the brief's vocabulary.

## 3. The closure-blocker registry is already defined

`wo.guard_work_order_closure()` is the protected authority and implements exactly
**B1–B6**:

| Code | Blocker                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| B1   | A non-terminal job remains on the work order                                       |
| B2   | An open-ended (`ended_at IS NULL`) labor session remains                           |
| B3   | A **required** additional-work request is `pending`, or `approved` + `unfulfilled` |
| B4   | A `requires_diagnostic` job has no `completed` diagnostic report                   |
| B5   | QC failed with no passing record, **or** a mandatory QC check exists with no pass  |
| B6   | Safety-critical rework on this work order lacks `independent_sign_off_by`          |

Two consequences that shape the design:

1. **The trigger raises on the first blocker only.** It `RAISE`s `check_violation`
   and aborts. The brief requires the eligibility endpoint to return _every_ unmet
   blocker, so `GET /closure-eligibility` must re-evaluate all six independently in
   a read-only path. The closure _transition_ still relies on the trigger as the
   authority — the service never becomes the enforcement point, only the reporter.
2. **There is no reservation or part-issue blocker.** The brief lists "no active
   reservation" and "no open part issue" as closure conditions. The protected guard
   contains neither, because stock reservation and issue execution are Phase 1-21.
   No fabricated always-passing blocker will be added. The registry will expose a
   documented extension point and the two conditions are recorded as out of scope.

Cancellation is deliberately exempt: `is_cancellation` states bypass B1–B6 while
still writing history.

## 4. Delivery shape

This phase is roughly 2.5× P1-18 in endpoints and 4× in modules. P1-18 delivered
12 operations in one module and required five merged pull requests and four
adversarial review rounds, each of which found real defects. P1-19 is therefore
delivered **wave-per-PR**: each wave carries its own local battery, exact-SHA
clean room, independent review, and green hosted CI before the next begins.

| Wave | Content                                                                    | Branch                            |
| ---- | -------------------------------------------------------------------------- | --------------------------------- |
| 3    | Module skeleton, permission catalog, event change request                  | `feature/p1-19-module-foundation` |
| 4    | Work-order core — create, transition, closure eligibility, jobs, queries   | tbd                               |
| 5    | Technician execution — job transitions, assignment, labor, queries, demand | tbd                               |
| 6    | Additional work and customer approval                                      | tbd                               |
| 7    | Diagnostics — versioned reports, entries, completion, review               | tbd                               |
| 8    | QMS — quality control, closure, reopen prohibition, rework                 | tbd                               |
| 9    | Security, QA, DevOps and documentation hardening                           | tbd                               |

## 5. Open change requests

| ID              | Subject                                             | Status                                                                                                            |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ECR-P1-19-001` | Event catalog additions for `wo`/`tech`/`dia`/`qms` | **Open** — see [`change-requests/ECR-P1-19-001-event-catalog.md`](change-requests/ECR-P1-19-001-event-catalog.md) |

## 6. Scope

**In scope.** Application services, domain services, repositories, Zod validation,
Route Handlers, authorization, audit, structured logging, transaction wrappers,
outbox publication, OpenAPI, tests, documentation, for the `wo`, `tech`, `dia` and
Phase 1 `qms` slices.

**Out of scope.** Any schema change or migration. Quotation pricing (P1-20). Stock
reservation or issue execution (P1-21). Billing or invoicing. Any frontend.
Multi-workshop routing. Predictive diagnostics. Full HR. Zoom workflows. Phases
1-20, 1-21, 1-22 and 1-29.

No sample, demonstration, placeholder or production business data is introduced;
test fixtures remain confined to the test environment.
