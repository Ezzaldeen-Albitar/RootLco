# Phase 1-4 — Identity, Authorization, Security & Audit Schema Design

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18 ·
**Author:** Eng. Ezzaldeen Al-Bitar

## 1. Scope

The database foundation for identity, authorization, security, and audit — 19
new tables, 14 functions, 25 triggers, 21 RLS policies across 9 migrations plus
a seed. Credentials remain with the external identity provider; **no password,
hash, MFA secret, or token is stored anywhere.** No backend API, no frontend, no
HR employee master, no Phase-1-5 schema.

## 2. Entity map

```
org.tenants ─┬─ iam.user_accounts ─┬─ iam.user_profiles (1:1)
             │                     ├─ iam.user_employee_links (effective-dated, placeholder)
             │                     └─ iam.user_status_history (append-only)
             ├─ iam.roles ─── iam.role_permissions ── iam.permissions (platform catalog)
             ├─ iam.role_grants ─── iam.grant_scopes (company/branch/department)
             ├─ iam.approval_limits · iam.sensitive_data_permissions
             ├─ iam.login_audit · iam.user_sessions (hashes only)
             ├─ iam.audit_records ─┬─ iam.audit_record_details (masked)
             │                     └─ iam.audit_integrity_links (SHA-256 chain)
             ├─ iam.security_events
             └─ shared.status_history ── shared.status_evidence
```

## 3. Load-bearing decisions

- **Credential-free identity.** `user_accounts` references the provider by
  `(identity_provider, provider_subject)`; `mfa_required` is a flag, not a
  secret. A structural test asserts no credential/token column in any `iam`
  table, and no plaintext IP/user-agent (hashes only).
- **Authorization by permission, never role name.** `role_permissions.effect`
  is `allow|deny`; deny precedence (BR-IAM-001) is persisted state resolved by
  `iam.has_permission`.
- **Scoped grants.** `role_grants.scope_mode` (`unrestricted|scoped`) with a
  `DEFERRABLE INITIALLY DEFERRED` constraint trigger requiring ≥1 `grant_scopes`
  row for a scoped active grant. Composite FKs carry the tenant AND the parent
  chain, so cross-tenant and cross-company scopes are FK violations.
- **Money is NUMERIC(18,4)** — never float — with non-overlapping effective
  intervals and immutable amount/identity (a change is a new row).
- **Tamper-evident audit.** A per-tenant SHA-256 chain, appended under an
  advisory lock; alteration or deletion is detected by re-computation.
- **Server-set context only.** Every policy/helper trusts `iam.current_*`
  (0002); client-supplied identifiers are never authorization tokens.

## 4. Tenancy and RLS

Every tenant-owned table carries `tenant_id` and FORCE-RLS with a default-deny
tenant policy. Documented exceptions: `iam.permissions` (platform catalog, no
tenant), `iam.login_audit` and `iam.security_events` (nullable tenant for
anonymous / platform events). Runtime holds SELECT only; all writes are
platform / Phase-1-14 operations. See
[iam-rls-policy-matrix.md](../../security/iam-rls-policy-matrix.md).

## 5. Explicit non-goals (deferred, not hidden)

Login/logout/session issuance, MFA workflow, IdP integration, audit-read access
logging, and privileged-grant different-actor approval enforcement are Phase-1-14
backend responsibilities. The database stores and access-controls the shapes;
it does not claim those runtime controls exist.
