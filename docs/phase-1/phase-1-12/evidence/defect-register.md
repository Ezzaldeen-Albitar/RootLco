# P1-12 Defect Register — Release 2 Database Gate

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Base:** protected `origin/develop` = `5cd16da`.

**Governance / self-review note.** Findings recorded here arise from an owner-authorized
technical, QA, security, and adversarial **self-review** by Eng. Ezzaldeen Al-Bitar under the
Solo Developer Review Policy and Standing Technical Authorization Policy — **not** an
independent third-party audit. Every finding traces to actual execution; none is hypothetical.

## Summary

| Measure                   | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Total findings this phase | 3                                                           |
| Gate-blocking defects     | **0**                                                       |
| Unresolved Critical       | **0**                                                       |
| Unresolved High           | **0**                                                       |
| Unresolved Medium         | **0** (1 residual carried from P1-11 — see waiver register) |
| Unresolved Low            | **0**                                                       |

P1-12 introduces **no new business domain and no schema change beyond additive remediation**;
no gate-blocking integrity defect was found in the integrated P1-2…P1-11 database.

## Findings

### DEF-P1-12-001 — Administrative-only ON DELETE CASCADE reach to audit/authorization history

- **Severity:** Informational (reviewed, non-blocking, administrative-only)
- **Stream:** Structural / Security
- **Status:** **Reviewed and cleared — no remediation required**
- **Detected by:** `scripts/db/structural-review.mjs` (Wave 2)
- **Description:** Five `ON DELETE CASCADE` foreign keys reach audit / authorization / status
  history parents:
  - `iam.audit_integrity_links` → `iam.audit_records`
  - `iam.audit_record_details` → `iam.audit_records`
  - `iam.grant_scopes` → `iam.role_grants`
  - `iam.role_permissions` → `iam.roles`
  - `shared.status_evidence` → `shared.status_history`
- **Analysis:** **None is runtime-reachable.** No application role holds a `DELETE` grant on any
  cascade parent; `iam.audit_records` is `SELECT`-only for `app_runtime` and `app_readonly`. No
  financial or audit history can be destroyed at runtime. Classified **administrative-only**.
- **Evidence:** `evidence/structural-review.json`
  (`no_runtime_reachable_destructive_cascade: true`; the five keys listed under
  `administrative_only_destructive_cascades`), `security-signoff-recommendation.md`.
- **Disposition:** Non-blocking. No remediation migration. Reviewed and accepted as
  administrative-only; carried informationally.

### DEF-P1-12-002 — Structural-review false-positive: destructive-cascade over-count

- **Severity:** N/A (tooling false-positive — corrected)
- **Stream:** Structural
- **Status:** **Corrected — criterion tightened to runtime-reachability**
- **Description:** An initial structural-review pass flagged `ON DELETE CASCADE` foreign keys as
  destructive without testing whether any application role can actually trigger them. Applying a
  **runtime-reachability** criterion showed the five cascades (DEF-P1-12-001) are not reachable
  by any granted app role.
- **Outcome:** After correction, **0 runtime-reachable destructive cascades**.
- **Evidence:** `evidence/structural-review.json`
  (`runtime_reachable_destructive_cascades: []`), `remediation-register.md` (REM-P1-12-001).
- **Disposition:** Not a database defect. Review-criteria correction only; no schema change.

### DEF-P1-12-003 — Structural-review false-positive: duplicate-index over-count

- **Severity:** N/A (tooling false-positive — corrected)
- **Stream:** Structural
- **Status:** **Corrected — criterion tightened to full-definition equivalence**
- **Description:** An initial pass flagged candidate duplicate indexes on column overlap alone.
  Applying a **full-definition** equivalence criterion (predicate, opclass, order, uniqueness)
  showed no true duplicates.
- **Outcome:** After correction, **0 TRUE duplicate indexes** (across 999 indexes).
- **Evidence:** `evidence/structural-review.json` (`no_duplicate_indexes: true`;
  `duplicate_indexes: []`), `remediation-register.md` (REM-P1-12-002).
- **Disposition:** Not a database defect. Review-criteria correction only; no schema change.

## Status

**PASS — no gate-blocking defect; zero unresolved Critical or High.** The single substantive
finding (DEF-P1-12-001) is administrative-only and cleared; the two remaining items are corrected
tooling false-positives, not database defects. One P1-11 residual (M-wty-2b) is carried and
recorded in `waiver-risk-acceptance-register.md`.
