# Phase 1-4 Traceability Matrix

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18

A task is **Complete** only when it has executable evidence (a migration/function
AND a passing test, or a real document), never because a file exists.

## Database (P1-04-DB)

| Task   | Object                                                 | Test evidence                                               | Status                       |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------- |
| DB-001 | `iam.user_accounts`                                    | iam-accounts                                                | Complete                     |
| DB-002 | `iam.user_profiles`                                    | iam-accounts                                                | Complete                     |
| DB-003 | `iam.user_employee_links`                              | iam-accounts                                                | Complete                     |
| DB-004 | `iam.user_status_history` + `change_user_status`/stamp | iam-accounts                                                | Complete                     |
| DB-005 | `iam.roles`                                            | iam-roles                                                   | Complete                     |
| DB-006 | `iam.permissions`                                      | iam-roles                                                   | Complete                     |
| DB-007 | `iam.role_permissions` (allow/deny)                    | iam-roles                                                   | Complete                     |
| DB-008 | `iam.role_grants`                                      | iam-grants                                                  | Complete                     |
| DB-009 | `iam.grant_scopes` + deferred trigger                  | iam-grants                                                  | Complete                     |
| DB-010 | `iam.approval_limits`                                  | iam-approvals                                               | Complete                     |
| DB-011 | `iam.sensitive_data_permissions`                       | iam-approvals                                               | Complete                     |
| DB-012 | `iam.login_audit` + stamp                              | iam-sessions                                                | Complete                     |
| DB-013 | `iam.user_sessions`                                    | iam-sessions                                                | Complete                     |
| DB-014 | `iam.audit_records`                                    | iam-audit                                                   | Complete                     |
| DB-015 | `iam.audit_record_details` (masked)                    | iam-audit                                                   | Complete                     |
| DB-016 | `iam.audit_integrity_links` (SHA-256)                  | iam-audit                                                   | Complete                     |
| DB-017 | `iam.security_events`                                  | iam-audit, iam-hardening                                    | Complete                     |
| DB-018 | `shared.status_history`/`status_evidence`              | shared-status                                               | Complete                     |
| DB-019 | reuse `shared.idempotency_keys`                        | shared-status                                               | Complete (already satisfied) |
| DB-020 | `iam.has_permission` (+ context wrappers)              | iam-permissions                                             | Complete                     |
| DB-021 | `iam.has_permission_in_scope`                          | iam-permissions                                             | Complete                     |
| DB-022 | `iam.audit_append`/canonical/hash/verify               | iam-audit                                                   | Complete                     |
| DB-023 | indexes (FK/tenant/active/grant/audit)                 | org-security FK-coverage                                    | Complete                     |
| DB-024 | RLS + grants (gated audit/session reads)               | iam-hardening                                               | Complete                     |
| DB-025 | permission catalog + baseline-role seed                | iam-seeds                                                   | Complete                     |
| DB-026 | migration classification                               | [doc](../../database/phase-1-4-migration-classification.md) | Complete                     |

## Security (P1-04-SEC)

| Task                                                           | Evidence                                                    | Status   |
| -------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| SEC-001 FORCE RLS / default deny                               | org-security global + iam-hardening                         | Complete |
| SEC-002 privilege-escalation / context-spoof denial            | iam-permissions, iam-grants                                 | Complete |
| SEC-003 protected audit/history (no runtime write; gated read) | iam-hardening                                               | Complete |
| SEC-004 data classification of identity/session/hash fields    | data dictionary + capture map                               | Complete |
| SEC-005 security-event capture ownership vs Phase-1-14         | [capture map](../../security/security-event-capture-map.md) | Complete |

## QA (P1-04-QA-001..008)

Cross-tenant/company/branch, self-grant, scope widening, role-permission
injection, missing scope, expired/revoked grant, archived user, unauthorized
audit view, audit chain/tamper/gap/orphan, audit-write rollback, idempotency
replay/conflict/concurrency, approval overlap, view≠export — all covered across
the ten Phase-1-4 suites (311 tests). **Complete.**

## DevOps (P1-04-DO-001..002)

CI `Database migrations and RLS tests` applies all migrations from empty + runs
the full suite (incl. deny precedence, escalation, audit chain, runtime-role
posture); the secrets job runs scope-exclusion + credential + browser-secret
scans. **Complete** (existing generic jobs now exercise Phase-1-4).

## Documentation (P1-04-DOC-001..003)

initial-audit, schema-design, RLS matrix, permission-catalog reference, helper
guide, audit-integrity design, security-event capture map, migration
classification, evidence register, this matrix, readiness checklist, completion
report, owner gate, data-dictionary extension. **Complete.**
