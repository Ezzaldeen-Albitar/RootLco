# Phase 1-4 — Security Event Capture Map

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18 ·
**Task:** P1-04-DB-017

Where security-relevant events are captured in the Phase-1-4 database, and where
capture is a Phase-1-14 (backend/observability) responsibility.

| Event                                                           | Captured by                           | Table / mechanism                                      | Phase                       |
| --------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ | --------------------------- |
| Successful / failed / lockout / logout authentication           | backend session service → DB          | `iam.login_audit` (append-only, hashed context)        | DB shape now; writer 1-14   |
| Session issued / last-seen / expired / revoked                  | backend session service → DB          | `iam.user_sessions` (metadata, no token)               | DB shape now; writer 1-14   |
| Account lifecycle transition (invite/active/lock/archive)       | `iam.change_user_status`              | `iam.user_status_history` (server-stamped)             | now                         |
| Role granted / revoked / expired                                | `iam.role_grants` (+ status/valid_to) | grant rows + optional `shared.status_history`          | now                         |
| Any audited business mutation                                   | `iam.audit_append`                    | `iam.audit_records`/`details`/`links` (hash chain)     | writer 1-14                 |
| Detected anomaly (brute force, escalation attempt, chain break) | backend / operator                    | `iam.security_events` (payload-free)                   | DB shape now; producer 1-14 |
| Audit-read access (who viewed the trail)                        | backend/API layer                     | **NOT** in the DB (RLS cannot safely log every SELECT) | 1-14                        |

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
mutations). Producing login/session/anomaly events and logging audit _reads_ are
backend/observability responsibilities (Phase 1-14) — not claimed as implemented
here.
