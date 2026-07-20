# Phase 1-9 — Append-Only / Correction Matrix

Every one of the 44 tables is classified by its mutability contract. Deletion is
always a soft-delete UPDATE (no application role holds DELETE); "immutable" means
content-immutable (business columns never change once set).

## Mutable master (7)

Lifecycle records updated in place, subject to immutable-column guards.

`wo.work_orders` · `wo.jobs` · `tech.technician_profiles` · `dia.inspection_templates`
· `dia.diagnostic_reports` · `qms.quality_control_records` · `qms.rework_links`

- `wo.work_orders`: `vehicle_id`, kind, and reception origin are immutable
  (coherence-locked, design finding F13); a terminal state is frozen (BR-WO-002).
- `qms.quality_control_records`: once `overall_result` is finalized
  (`passed`/`failed`), `overall_result`, `checker_id`, and `finalized_at` are frozen
  (design finding F10). Re-QC creates a new record.
- `qms.rework_links`: `lead_technician_id` is immutable from creation and NOT NULL
  when `is_safety_critical=true` (design finding F4).

## Mutable working child (14)

Line items and operational children, editable while their parent is open.

`wo.work_order_service_lines` · `wo.required_parts` · `wo.additional_work_requests`
· `wo.additional_work_request_details` (restricted 1:1) · `tech.technician_skills`
· `tech.technician_certifications` · `tech.technician_certification_details`
(restricted 1:1) · `dia.report_item_results` · `dia.findings` · `dia.measurements`
· `dia.dtc_records` · `dia.recommendations` · `qms.qc_check_results`
· `qms.rework_link_details` (restricted 1:1)

## Mutable-temporal (2)

Time-bounded records; non-overlap enforced.

`wo.job_assignments` (reassignment reason enforced) ·
`tech.technician_availability` (gist `EXCLUDE` non-overlap).

## Append-only ledger — SELECT + INSERT only (8)

No UPDATE/DELETE grant; UPDATE/DELETE raise `42501`. Status ledgers are
trigger-emitted and coherence-guarded; evidence ledgers bind an exact
`shared.document_versions` row.

`wo.work_order_status_history` · `wo.job_status_history`
· `wo.customer_approval_evidence` · `dia.diagnostic_report_status_history`
· `dia.diagnostic_evidence` · `dia.diagnostic_reviews` · `qms.qc_status_history`
· `qms.reopen_attempts`

## Correction-linked (1)

`tech.labor_sessions`: content-immutable (scope, technician, `started_at` never
change); `ended_at` is write-once; a correction is a soft-delete of the original plus
a linked insert (`correction_of_id`) in one transaction via
`tech.correct_labor_session` (design finding F9). Enforced with a gist `EXCLUDE`
non-overlap and ≤1 active session per technician.

## Immutable after publication / decision (2 + evidence)

`dia.template_versions`: frozen once `published` — the version row and its
`dia.template_items` become immutable (design finding F3); a report may pin only a
published version. `wo.customer_approvals`: the decision is immutable once recorded.
The three evidence ledgers above are additionally immutable-after-insert.

## Soft-deletable configuration (10)

Dual-scope catalogs; a soft-delete UPDATE retires a row (platform rows admin-only).

`wo.work_order_states` · `wo.work_order_transitions` · `wo.job_states`
· `wo.job_transitions` · `tech.skills` · `tech.skill_levels` · `tech.certifications`
· `dia.diagnostic_types` · `dia.template_items` (**only while the version is
`draft`**; frozen once published) · `qms.qc_checks`
