# Phase 1-4 — IAM RLS Policy Matrix

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18

Every table below has RLS **enabled AND forced**. Runtime roles (`app_runtime`,
`app_readonly`) hold **SELECT only**; no INSERT/UPDATE/DELETE grant exists on any
Phase-1-4 table (writes are platform / Phase-1-14 operations). Default deny: with
no context, `iam.current_*` is NULL and every policy matches zero rows.

| Table                            | Read policy (app roles)                                                               | Write | Notes                              |
| -------------------------------- | ------------------------------------------------------------------------------------- | ----- | ---------------------------------- |
| `iam.user_accounts`              | `sel_user_accounts_tenant`: same tenant                                               | none  | within-tenant directory            |
| `iam.user_profiles`              | `sel_user_profiles_tenant`: same tenant                                               | none  | contact fields Restricted          |
| `iam.user_employee_links`        | `sel_user_employee_links_tenant`: same tenant                                         | none  | placeholder ref                    |
| `iam.user_status_history`        | `sel_user_status_history_tenant`: same tenant                                         | none  | append-only, server-stamped        |
| `iam.permissions`                | `sel_permissions_all`: all (`true`)                                                   | none  | platform catalog, read-only        |
| `iam.roles`                      | `sel_roles_tenant`: same tenant                                                       | none  | is_system protected                |
| `iam.role_permissions`           | `sel_role_permissions_tenant`: same tenant                                            | none  | allow/deny                         |
| `iam.role_grants`                | `sel_role_grants_tenant`: same tenant                                                 | none  | deferred-scope constraint          |
| `iam.grant_scopes`               | `sel_grant_scopes_tenant`: same tenant                                                | none  | composite-FK safe                  |
| `iam.approval_limits`            | `sel_approval_limits_tenant`: same tenant                                             | none  | NUMERIC only                       |
| `iam.sensitive_data_permissions` | `sel_sensitive_data_permissions_tenant`: same tenant                                  | none  | view/export/mask distinct          |
| `iam.login_audit`                | `sel_login_audit_own`: own rows · `sel_login_audit_admin`: `iam.login.view_all`       | none  | anonymous failures visible to none |
| `iam.user_sessions`              | `sel_user_sessions_own`: own rows · `sel_user_sessions_admin`: `iam.session.view_all` | none  | no tokens                          |
| `iam.audit_records`              | `sel_audit_records_permitted`: tenant + `iam.audit.view`                              | none  | gated read                         |
| `iam.audit_record_details`       | `sel_audit_record_details_permitted`: tenant + `iam.audit.view`                       | none  | masked values                      |
| `iam.audit_integrity_links`      | `sel_audit_integrity_links_permitted`: tenant + `iam.audit.view`                      | none  | SHA-256 chain                      |
| `iam.security_events`            | `sel_security_events_permitted`: tenant + `iam.audit.view`                            | none  | nullable tenant                    |
| `shared.status_history`          | `sel_status_history_tenant`: same tenant                                              | none  | append-only, server-stamped        |
| `shared.status_evidence`         | `sel_status_evidence_tenant`: same tenant                                             | none  | placeholder ref                    |

## Abuse cases (all tested, all denied)

1. Cross-tenant read of any table → zero rows (tenant policy).
2. Unauthorized audit read (no `iam.audit.view`) → zero rows.
3. Ordinary user reading another user's sessions/login → zero rows (own-row policy).
4. Runtime INSERT/UPDATE/DELETE on any Phase-1-4 table → `42501` (no grant).
5. Forged actor / backdated history → overwritten by server-stamp trigger.
6. Privileged DB user tampering with an audit record → detected by
   `iam.audit_verify_chain`.
7. Context spoofing (invalid/other-tenant context) → `has_permission` denies.

## Honest limits

Database RLS does **not** log every SELECT; audit-read access logging is a
Phase-1-14 backend responsibility. A residual is documented: a privileged DB
role (superuser/BYPASSRLS) can read/alter rows — the chain detects alteration,
and no application role holds such privilege.
