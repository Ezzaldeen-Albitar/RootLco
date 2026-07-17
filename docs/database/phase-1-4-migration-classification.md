# Phase 1-4 Migration Classification

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-4 · **Date:** 2026-07-18 · **Task:** P1-04-DB-026 · **Owner:** iam module
(Eng. Ezzaldeen Al-Bitar)

Naming: 14-digit `supabase migration new` timestamps (migration standard §3),
continuing after the latest Phase 1-3 timestamp `20260717107000`. Application
order = filename order. Migrations `0001–0003` and `20260717…` are merged and
immutable; the one additive change to a Phase-1-3 table (`org.departments`) is a
NEW forward migration, not an edit of a merged file.

| Migration                                                 | Tasks           | Forward behaviour                                                                | Rollback class                                                       | Data-loss risk      | Depends on              |
| --------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- | ----------------------- |
| `20260718090000_iam_user_accounts_and_profiles.sql`       | DB-001..004     | accounts/profiles/employee-links/status-history + lifecycle fn + stamp trigger   | rollback-safe while unused → roll-forward-only once identities exist | identity anchor     | 0002,101000             |
| `20260718091000_iam_roles_and_permissions.sql`            | DB-005..007     | permission catalog + tenant roles + allow/deny mappings                          | roll-forward-only once populated                                     | authorization state | 090000                  |
| `20260718092000_iam_role_grants_and_scopes.sql`           | DB-008..009     | role grants + scopes; additive `org.departments` composite key; deferred trigger | roll-forward-only once granted                                       | grant evidence      | 090000,091000,1030/1040 |
| `20260718093000_iam_approval_and_sensitive_data.sql`      | DB-010..011     | approval limits (NUMERIC) + sensitive-data permissions                           | roll-forward-only once populated                                     | approval config     | 090000,091000           |
| `20260718094000_iam_login_and_sessions.sql`               | DB-012..013     | append-only login audit + session metadata (hashes only)                         | roll-forward-only once populated                                     | login evidence      | 090000                  |
| `20260718095000_iam_audit_subsystem.sql`                  | DB-014..017,022 | audit records/details/links/security-events + hash-chain functions               | roll-forward-only once audited                                       | audit evidence      | 101000                  |
| `20260718096000_shared_status_history.sql`                | DB-018..019     | generic status history/evidence; reuses `shared.idempotency_keys`                | roll-forward-only once populated                                     | status evidence     | 101000                  |
| `20260718097000_iam_context_and_permission_functions.sql` | DB-020..021     | context wrappers + has_permission / has_permission_in_scope                      | **ROLLBACK-SAFE** (functions only)                                   | none                | 090000..092000          |
| `20260718098000_iam_rls_grants_hardening.sql`             | DB-023..024,SEC | permission-gated audit read + admin session/login policies                       | **ROLLBACK-SAFE** (policies/grants only)                             | none                | 094000,095000,097000    |
| `supabase/seeds/04_iam_permission_catalog.sql` (seed)     | DB-025          | idempotent permission catalog + fictional-tenant baseline roles                  | **ROLLBACK-SAFE / idempotent** (re-runnable)                         | none                | seeds 01,03             |

**Additive change to a merged table (documented):** `20260718092000` adds
`org.departments` `UNIQUE (tenant_id, company_id, id)` so departments can be a
grant-scope FK target (mirrors `org.warehouses.uq_warehouses_scope_id`). Purely
additive (`id` is already the PK); zero data change; forward-only migration —
the merged `20260717104000` file is untouched.

## Rehearsals (executed 2026-07-18)

| Rehearsal                                           | Result                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean apply, empty DB (`supabase db reset`)         | `0001→0003→090000..098000` + all four seed files, exit 0, ≥1 clean apply verified                                                                      |
| Full DB suite on the fresh stack                    | 311/311 (all isolation as the non-owner runtime login)                                                                                                 |
| Rollback-safe classes (`097000`, `098000`, seed 04) | functions/policies/grants and the idempotent seed re-applied with no data effect                                                                       |
| Roll-forward recovery statement                     | roll-forward-only migrations recover via a corrective forward migration + restore-from-backup where data was lost; destructive rollback is NOT claimed |
