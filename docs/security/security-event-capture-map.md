# Phase 1-4 — Security Event Capture Map

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18 ·
**Task:** P1-04-DB-017 · **Amended:** 2026-07-21 by
[DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)
(audit and security-event writer capabilities)

Where security-relevant events are captured in the Phase-1-4 database, and where
capture is a Phase-1-14 (backend/observability) responsibility.

Two rows below changed with DBCR-P1-13-001 (migration `20260725090000`): the
audit and security-event **writer** capabilities now exist at the database layer.
`app_runtime` holds `EXECUTE` on `iam.audit_append` and tenant-scoped `INSERT`
on `iam.audit_records`, `iam.audit_record_details`, `iam.audit_integrity_links`
and `iam.security_events`, so a request records its own evidence in the
transaction it is auditing. Nothing about **reading** changed: browsing the audit
trail or the security log still requires the `iam.audit.view` permission, and
`iam.security_events` gained no new SELECT policy.

| Event                                                           | Captured by                                    | Table / mechanism                                      | Phase                                                   |
| --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Successful / failed / lockout / logout authentication           | backend session service → DB                   | `iam.login_audit` (append-only, hashed context)        | DB shape now; writer 1-14                               |
| Session issued / last-seen / expired / revoked                  | backend session service → DB                   | `iam.user_sessions` (metadata, no token)               | DB shape now; writer 1-14                               |
| Account lifecycle transition (invite/active/lock/archive)       | `iam.change_user_status`                       | `iam.user_status_history` (server-stamped)             | now                                                     |
| Role granted / revoked / expired                                | `iam.role_grants` (+ status/valid_to)          | grant rows + optional `shared.status_history`          | now                                                     |
| Any audited business mutation                                   | `iam.audit_append`, called by the request path | `iam.audit_records`/`details`/`links` (hash chain)     | DB writer capability granted in 1-13 (DBCR-P1-13-001)   |
| Detected anomaly (brute force, escalation attempt, chain break) | backend / operator                             | `iam.security_events` (payload-free)                   | DB producer capability granted in 1-13 (DBCR-P1-13-001) |
| Audit-read access (who viewed the trail)                        | backend/API layer                              | **NOT** in the DB (RLS cannot safely log every SELECT) | 1-14                                                    |

## Data-classification of captured fields

| Field                                        | Classification        | Handling                                |
| -------------------------------------------- | --------------------- | --------------------------------------- |
| `identity_provider`, `provider_subject`      | internal / restricted | reference only, never a credential      |
| `email`, profile `phone_contact`             | restricted            | masked in audit details                 |
| `ip_hash`, `user_agent_hash`                 | restricted            | hash only — never plaintext             |
| `session_ref`                                | restricted            | opaque handle — never a token           |
| audit `old/new` for restricted/secret fields | restricted/secret     | stored MASKED (`***`)                   |
| `security_events.detail`                     | internal              | short descriptor — no sensitive payload |

## Boundary statement

The database **stores and access-controls** these shapes and captures the events
it can attribute deterministically (lifecycle transitions, grants, audited
mutations). It now also **permits** the request path to write audit records and
security events, tenant-scoped and append-only; deciding _which_ operations are
audited and _which_ conditions count as anomalies remains application logic, and
detecting login/session anomalies in the first place is still a
backend/observability responsibility. Logging audit _reads_ remains a Phase-1-14
responsibility and is not implemented here. A granted capability is not a
captured event: this document records where the write is possible, not a claim
that every listed event is being produced today.
