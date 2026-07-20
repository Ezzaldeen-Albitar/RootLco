# Phase 1-9 — Traceability

DB task → migration → primary object(s) → test → status. Every task is implemented,
migration-applied, registered in the foundation allow-lists, documented in the
central data dictionary, and tested. **Status `✓` = implemented + tested on the
feature branch;** the owner gate is Pending until merge (see
[phase-1-9-owner-gate.md](phase-1-9-owner-gate.md)).

| Task (DB-001…050 scope)                       | Migration                   | Object(s)                                                                                                               | Test file(s)                            | Status |
| --------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | :----: |
| Schema reservation                            | `…090000`                   | schemas `wo`/`tech`/`dia`/`qms` + USAGE grants                                                                          | `foundation`                            |   ✓    |
| WO + job state graph                          | `…091000`                   | `wo.work_order_states`/`_transitions`, `wo.job_states`/`_transitions` + flag CHECKs                                     | `wo-work-orders`                        |   ✓    |
| Technician catalogs                           | `…092000`                   | `tech.skills`/`skill_levels`/`certifications`                                                                           | `wo-jobs-labor`                         |   ✓    |
| Diagnostic + QC catalogs                      | `…093000`                   | `dia.diagnostic_types`, `qms.qc_checks`                                                                                 | `dia-diagnostics`, `qms-closure-rework` |   ✓    |
| Technician profiles/skills/certs/availability | `…094000`                   | `tech.technician_profiles`/`_skills`/`_certifications`/`_certification_details` (restricted)/`_availability`            | `wo-jobs-labor`, `p1-09-security`       |   ✓    |
| Work-order master                             | `…095000`                   | `wo.work_orders` + refs/coherence/transition guards                                                                     | `wo-work-orders`                        |   ✓    |
| WO status history                             | `…096000`                   | `wo.work_order_status_history` + emit/coherence                                                                         | `wo-work-orders`                        |   ✓    |
| Jobs + job status history                     | `…097000`                   | `wo.jobs` (`requires_diagnostic`), `wo.job_status_history`                                                              | `wo-jobs-labor`                         |   ✓    |
| Job assignments                               | `…098000`                   | `wo.job_assignments` (temporal, reassignment reason)                                                                    | `wo-jobs-labor`                         |   ✓    |
| Labor sessions                                | `…099000`                   | `tech.labor_sessions` + gist `EXCLUDE` + `tech.correct_labor_session`                                                   | `wo-jobs-labor`, `p1-09-concurrency`    |   ✓    |
| Service/parts/additional-work/approvals       | `…100000`                   | `wo.work_order_service_lines`/`required_parts`/`additional_work_requests`(+`_details`)/`customer_approvals`/`_evidence` | `wo-services-approvals`                 |   ✓    |
| Diagnostic templates/versions/items           | `…101000`                   | `dia.inspection_templates`/`template_versions`/`template_items` + frozen guard                                          | `dia-diagnostics`                       |   ✓    |
| Diagnostic reports                            | `…102000`                   | `dia.diagnostic_reports`/`_report_status_history`/`report_item_results`                                                 | `dia-diagnostics`                       |   ✓    |
| Findings/measurements/evidence                | `…103000`                   | `dia.findings`/`measurements`/`dtc_records`/`diagnostic_evidence`/`recommendations`/`diagnostic_reviews`                | `dia-diagnostics`                       |   ✓    |
| Quality control                               | `…104000`                   | `qms.quality_control_records`/`qc_check_results`/`qc_status_history`                                                    | `qms-closure-rework`                    |   ✓    |
| Rework + closure gate                         | `…105000`                   | `qms.reopen_attempts`/`rework_links`(+`_details`), `wo.guard_work_order_closure` (B1..B6)                               | `qms-closure-rework`                    |   ✓    |
| Classification                                | registry + validator        | `wo-tech-dia-qms-personal-data-classification.json`                                                                     | `wo-classification-guard`               |   ✓    |
| Isolation / security                          | —                           | auto-enumerated RLS/grants/append-only over 44 tables                                                                   | `p1-09-isolation`, `p1-09-security`     |   ✓    |
| Concurrency                                   | —                           | single-winner races ×5 reps                                                                                             | `p1-09-concurrency`                     |   ✓    |
| Rollback / clean-room                         | —                           | from-zero apply of all 16 migrations                                                                                    | `p1-09-rollback`                        |   ✓    |
| Structural seeds                              | `06_wo_job_state_graph.sql` | platform WO/job state graph (9/15 + 6/10), tenant-neutral, idempotent                                                   | `p1-09-rollback` + seed-state           |   ✓    |
| CI wiring                                     | `package.json` + `ci.yml`   | `validate:wo-tech-dia-qms-classification` after the apt/rec step                                                        | hosted CI                               |   ✓    |

Every FK is covered by a non-partial index; the FK-index guard reports zero gaps and
the duplicate-index guard reports zero exact duplicates across `wo`/`tech`/`dia`/`qms`.
