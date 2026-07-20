# Phase 1-9 — Object Inventory

Introspected from the live catalog. Counts: **44 tables, 27 functions, 101
triggers, 124 policies, 185 indexes, 657 columns.**

## Tables

### `wo` — Work Order (15)

| Table                                | Kind                       | Purpose                                                                               |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------- |
| `wo.work_order_states`               | dual-scope catalog         | Configurable WO state definitions; platform-governed terminal/closed/cancel flags     |
| `wo.work_order_transitions`          | dual-scope catalog         | Valid WO transition edges the guard validates against                                 |
| `wo.job_states`                      | dual-scope catalog         | Configurable job state definitions                                                    |
| `wo.job_transitions`                 | dual-scope catalog         | Valid job transition edges                                                            |
| `wo.work_orders`                     | branch-scoped master       | Repair job of record; reception-origin, coherence-locked Vehicle, `ordinary`/`rework` |
| `wo.work_order_status_history`       | append-only ledger         | Emitted WO status transitions                                                         |
| `wo.jobs`                            | child of WO                | Unit of work; `requires_diagnostic` flag                                              |
| `wo.job_status_history`              | append-only ledger         | Emitted job status transitions                                                        |
| `wo.job_assignments`                 | mutable-temporal child     | Technician-to-job assignment; reassignment reason enforced                            |
| `wo.work_order_service_lines`        | child                      | Service lines (positive qty); opaque `service_ref` forward ref                        |
| `wo.required_parts`                  | child                      | Required-part lines (positive qty); opaque `item_ref` forward ref                     |
| `wo.additional_work_requests`        | child                      | Request state + `fulfillment_state`; drives closure blocker B3                        |
| `wo.additional_work_request_details` | restricted 1:1             | Customer-facing description (gated by `iam.sensitive.view`)                           |
| `wo.customer_approvals`              | child (immutable decision) | Binds deciding `rec` party role; opaque `quotation_revision_ref` forward ref          |
| `wo.customer_approval_evidence`      | append-only ledger         | Binds an exact `shared.document_versions` row                                         |

### `tech` — Technician (9)

| Table                                   | Kind                     | Purpose                                                                          |
| --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `tech.skills`                           | dual-scope catalog       | Skill taxonomy                                                                   |
| `tech.skill_levels`                     | dual-scope catalog       | Skill-level taxonomy                                                             |
| `tech.certifications`                   | dual-scope catalog       | Certification taxonomy                                                           |
| `tech.technician_profiles`              | branch-scoped master     | Operational identity anchored to `iam.user_accounts`; home branch, trade, active |
| `tech.technician_skills`                | child                    | Technician-held skills at level                                                  |
| `tech.technician_certifications`        | child (operational)      | Held certifications: issue/expiry/status (kept `internal`)                       |
| `tech.technician_certification_details` | restricted 1:1           | Certificate number (gated by `iam.sensitive.view`)                               |
| `tech.technician_availability`          | mutable-temporal         | Availability windows; gist `EXCLUDE` non-overlap                                 |
| `tech.labor_sessions`                   | correction-linked ledger | Labor time; gist `EXCLUDE` non-overlap + ≤1 active; write-once `ended_at`        |

### `dia` — Diagnostics (13)

| Table                                  | Kind                     | Purpose                                                                    |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `dia.diagnostic_types`                 | dual-scope catalog       | Diagnostic-type taxonomy                                                   |
| `dia.inspection_templates`             | tenant-scoped            | Inspection/diagnostic template header                                      |
| `dia.template_versions`                | versioned (frozen)       | `draft→published→retired`; a published version is frozen                   |
| `dia.template_items`                   | child (frozen once pub.) | Per-version items; frozen once the version is published                    |
| `dia.diagnostic_reports`               | mutable master           | Pins an exact published version; `draft→in_progress→completed`/`cancelled` |
| `dia.diagnostic_report_status_history` | append-only ledger       | Emitted report status transitions                                          |
| `dia.report_item_results`              | child                    | A value or a documented not-applicable per item                            |
| `dia.findings`                         | child                    | Constrained severity/disposition                                           |
| `dia.measurements`                     | child                    | Measured value; unit required                                              |
| `dia.dtc_records`                      | child                    | OBD-II diagnostic trouble codes (code format checked)                      |
| `dia.diagnostic_evidence`              | append-only ledger       | Binds an exact `shared.document_versions` row                              |
| `dia.recommendations`                  | child                    | Recommended follow-up actions                                              |
| `dia.diagnostic_reviews`               | append-only ledger       | Server-stamped reviewer attribution                                        |

### `qms` — Quality (7)

| Table                         | Kind               | Purpose                                                                       |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `qms.qc_checks`               | dual-scope catalog | QC-check taxonomy; `is_mandatory`, `is_safety_critical`                       |
| `qms.quality_control_records` | mutable master     | `overall_result` pending/passed/failed; finalized result frozen               |
| `qms.qc_check_results`        | child              | Per-configured-check result                                                   |
| `qms.qc_status_history`       | append-only ledger | Emitted QC status transitions                                                 |
| `qms.reopen_attempts`         | append-only ledger | Rejected reopen attempts (never mutates the WO)                               |
| `qms.rework_links`            | mutable master     | Links a rework WO to the original; immutable `lead_technician_id`; BR-QMS-001 |
| `qms.rework_link_details`     | restricted 1:1     | `rework_cost` cost-of-quality KPI (gated by `iam.sensitive.view`)             |

## Functions (27)

All 27 functions are `SECURITY INVOKER` with `SET search_path = ''` and
`REVOKE EXECUTE FROM PUBLIC`; none is `SECURITY DEFINER`. They fall into three
groups:

- **Guards** — reference guards, transition guards, coherence guards, the closure
  gate `wo.guard_work_order_closure` (blockers B1..B6), the reception-origin insert
  guard `wo.guard_work_order_refs`, the finalize-freeze / sign-off guards, and the
  frozen-config guard `dia.guard_template_item_frozen`.
- **Append-only emitters and server stamps** — status-history emit functions and the
  reviewer/actor/time stamps for the ledgers.
- **App-runtime primitives (2)** — the only functions carrying an explicit
  `GRANT EXECUTE TO app_runtime`: `tech.correct_labor_session(uuid, timestamptz,
timestamptz, text)` (soft-delete-plus-linked-insert correction) and
  `qms.attempt_reopen(uuid, text)` (records a rejected reopen attempt without
  mutating the work order).

## Indexes

Every foreign key is covered by a non-partial index whose leading columns (as a
set) equal the FK columns (P1-03-DB-017); the FK-index guard reports zero gaps and
the duplicate-index guard reports zero exact duplicates on `wo`/`tech`/`dia`/`qms`.
Notable specialised indexes: the `tech.labor_sessions` and
`tech.technician_availability` gist `EXCLUDE` non-overlap indexes, the active
labor-session partial index per technician, the one-ordinary-WO-per-reception-origin
partial unique, the active display-number unique per tenant, and every append-only
ledger ordered by `(scope, entity, occurred_at DESC, seq DESC)`.

## Migrations (16, forward-only)

| Migration | Summary                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `…090000` | Reserve `wo`, `tech`, `dia`, `qms` module schemas; USAGE grants            |
| `…091000` | `wo` state/transition catalogs (work-order + job state graphs)             |
| `…092000` | `tech` catalogs (skills, skill levels, certifications)                     |
| `…093000` | `dia` + `qms` catalogs (diagnostic types, QC checks)                       |
| `…094000` | `tech` profiles, skills, certifications (+restricted detail), availability |
| `…095000` | `wo.work_orders` master (reception origin, Vehicle coherence lock, kind)   |
| `…096000` | `wo.work_order_status_history` append-only ledger                          |
| `…097000` | `wo.jobs` + `wo.job_status_history` append-only ledger                     |
| `…098000` | `wo.job_assignments` (temporal, reassignment reason)                       |
| `…099000` | `tech.labor_sessions` (overlap EXCLUDE, correction-linked)                 |
| `…100000` | `wo` service lines, required parts, additional-work, customer approvals    |
| `…101000` | `dia` inspection templates, versions, items (published-frozen)             |
| `…102000` | `dia.diagnostic_reports` (+status history, item results, version pin)      |
| `…103000` | `dia` findings, measurements, DTCs, evidence, recommendations, reviews     |
| `…104000` | `qms` quality-control records + per-check results + status history         |
| `…105000` | `qms` reopen attempts + rework links (+restricted cost) + the closure gate |

The migration order deliberately interleaves `tech` and `wo` tables (F14) so tables
are not grouped strictly by schema; profiles and labor precede the work-order lines
they support.
