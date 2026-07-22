# Phase 1-14 — Migration Classification

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).

---

## 1. Migrations added by Phase 1-14

| Migration                                                        | Class                                          | Rollback          | Change request                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `20260726090000_iam_org_runtime_administration_capabilities.sql` | **Security** (grants and policies)             | **ROLLBACK-SAFE** | [DBCR-P1-14-001](../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md) |
| `20260727090000_iam_grant_delegation_scope_backstop.sql`         | **Security** (functions + constraint triggers) | **ROLLBACK-SAFE** | P1-14 gate remediation — [remediation record](phase-1-14-grant-scope-remediation.md)                         |

Migration count moves **114 → 115 → 116**. The 116th is the grant-delegation scope-containment
backstop added by the post-gate remediation (see §8). No earlier migration is modified, renamed or
deleted; CI's
"Assert applied migrations are immutable" step
(`git diff --diff-filter=MDR origin/<base>...HEAD -- supabase/migrations/`) reports nothing.

## 2. Classification rationale

**Security, not schema.** The migration executes only `GRANT`, `GRANT ... (column list)`,
`GRANT EXECUTE` and `CREATE POLICY`. It creates no table, column, constraint, index, sequence,
trigger or function, and it modifies no existing function body. The Release 2 structural
baseline — 242 tables, 210 functions, 3562 columns, 537 foreign keys — is bit-for-bit
unchanged by it. Only the grant and policy catalogues move.

**Contrast with DBCR-P1-13-001.** That remediation was also security-class but did redefine two
function bodies (`iam.audit_hash`, `iam.audit_append`) because the audit-read gate could not
otherwise be preserved. This one needs no such change: `iam.change_user_status` is already
SECURITY INVOKER with a validated transition graph, so granting EXECUTE plus the two underlying
table privileges is sufficient and the body stays untouched.

## 3. Rollback posture

**ROLLBACK-SAFE.** No data is written, moved or destroyed by applying it, and none by reversing
it. The exact inverse — 19 `DROP POLICY` statements and 17 `REVOKE` statements, in reverse
dependency order — is recorded verbatim in a comment block at the end of the migration file.

Reversing it restores the pre-migration posture exactly: `app_runtime` returns to SELECT-only
across the thirteen administration tables, the write policies cease to exist, and P1-14's
administration surface fails closed again. No row, no column value and no committed history is
affected either way.

## 4. Object inventory

**Privileges granted to `app_runtime`** (17 statements):

| Object                      | Privilege                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `iam.user_accounts`         | `INSERT`; `UPDATE (email, display_name, status, mfa_required, deleted_at)`                         |
| `iam.user_status_history`   | `INSERT`                                                                                           |
| `iam.change_user_status(…)` | `EXECUTE`                                                                                          |
| `iam.user_sessions`         | `INSERT`; `UPDATE (last_seen_at, expires_at, revoked_at, revoke_reason, ip_hash, user_agent_hash)` |
| `iam.login_audit`           | `INSERT`                                                                                           |
| `iam.roles`                 | `INSERT`; `UPDATE (name, description, deleted_at)`                                                 |
| `iam.role_permissions`      | `INSERT`, `DELETE`; `UPDATE (effect)`                                                              |
| `iam.role_grants`           | `INSERT`; `UPDATE (status, valid_to, revoked_at, revoke_reason)`                                   |
| `iam.grant_scopes`          | `INSERT`, `DELETE`                                                                                 |
| `iam.approval_limits`       | `INSERT`; `UPDATE (effective_to)`                                                                  |
| `org.tenants`               | `UPDATE (display_name, default_locale, default_timezone)`                                          |

**Policies created** (19), all `TO app_runtime`, all anchored on
`iam.current_tenant_id()`:

`ins_user_accounts_admin` · `upd_user_accounts_admin` · `ins_user_status_history_admin` ·
`ins_user_sessions_self` · `upd_user_sessions_self` · `upd_user_sessions_admin` ·
`ins_login_audit_self` · `ins_roles_admin` · `upd_roles_admin` ·
`ins_role_permissions_delegable` · `upd_role_permissions_delegable` ·
`del_role_permissions_admin` · `ins_role_grants_delegable` · `upd_role_grants_admin` ·
`ins_grant_scopes_admin` · `del_grant_scopes_admin` · `ins_approval_limits_admin` ·
`upd_approval_limits_admin` · `upd_tenants_settings`

## 5. Catalogue effect

| Metric                                | Before | After | Change                                                              |
| ------------------------------------- | ------ | ----- | ------------------------------------------------------------------- |
| Migrations                            | 114    | 115   | +1                                                                  |
| Tables                                | 242    | 242   | none                                                                |
| Functions                             | 210    | 210   | none                                                                |
| `SECURITY DEFINER` functions          | 0      | 0     | none                                                                |
| `iam` tables with RLS enabled + FORCE | 17/17  | 17/17 | none                                                                |
| RLS policies                          | 596    | 615   | +19                                                                 |
| Schema USAGE granted to `app_runtime` | 17     | 17    | none — and still none on `extensions`, `auth`, `storage` or `vault` |
| Roles created / attributes changed    | —      | —     | none                                                                |
| Relations owned by `app_*` roles      | 0      | 0     | none                                                                |

## 6. Verification

`tests/db/p1-14-runtime-administration-capabilities.test.ts` — 60 tests, all passing, run
against a clean rebuild. Section 6 of
[DBCR-P1-14-001](../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md)
records what each group proves.

## 8. Migration 116 — grant-delegation scope-containment backstop

Added by the post-gate remediation (branch `fix/p1-14-grant-scope-and-operation-evidence`) to close
the confirmed-High unrestricted-grant scope-containment bypass at the database layer.

**Security, not schema.** The migration creates two functions and two constraint triggers and grants
one `EXECUTE`; it creates no table, column, constraint, index or sequence and modifies no existing
object. `iam.grant_delegation_within_authority(uuid)` is `STABLE SECURITY INVOKER` with an empty
`search_path`; **`SECURITY DEFINER` count stays 0**. The two DEFERRABLE INITIALLY DEFERRED constraint
triggers (`tg_role_grants_delegation_authority`, `tg_grant_scopes_delegation_authority`) validate that
a grant does not delegate authority beyond the acting `app_runtime` administrator's own scope, and
raise SQLSTATE `42501` otherwise. A superuser or BYPASSRLS role bypasses RLS and this backstop alike,
preserving the bootstrap boundary.

**ROLLBACK-SAFE.** No data is written or destroyed. The exact inverse — 2 `DROP TRIGGER` and 2
`DROP FUNCTION` statements — is recorded verbatim at the foot of the migration file.

| Metric                           | Before (115) | After (116) | Change |
| -------------------------------- | ------------ | ----------- | ------ |
| Migrations                       | 115          | 116         | +1     |
| Tables                           | 242          | 242         | none   |
| Functions                        | 210          | 212         | +2     |
| `SECURITY DEFINER` functions     | 0            | 0           | none   |
| Non-internal triggers            | 539          | 541         | +2     |
| RLS policies                     | 615          | 615         | none   |
| Relations owned by `app_*` roles | 0            | 0           | none   |

## 9. Governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The
work was reviewed under the Standing Technical Authorization and Solo Developer Review
policies.
