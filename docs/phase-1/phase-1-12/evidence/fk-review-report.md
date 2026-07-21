# P1-12 Evidence — Foreign-Key Integrity Review (Wave 2)

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Review stream:** Structural ·
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

## Governance / self-review note

Owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy — a solo-developer self-review, **not** an independent third-party
audit. The user performs all merges. Every figure below traces to actual execution; no
numbers are fabricated or extrapolated. Machine-readable source:
`evidence/structural-review.json`.

## Purpose

Verify referential integrity across the complete integrated schema: that every foreign key
is validated (no possibility of orphan rows), that every foreign key is covered by a
supporting index, and that no runtime-reachable `ON DELETE` cascade can destroy financial or
audit history.

## Evidence — gate outcomes

| Gate                                   | Result                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Total foreign keys                     | **537**                                                                                                |
| All foreign keys `VALIDATED`           | **true** (`all_fks_validated`)                                                                         |
| Unvalidated foreign keys               | **0** (`unvalidated_fks: []`)                                                                          |
| Foreign-key index coverage complete    | **true** (`fk_index_coverage_complete`)                                                                |
| Uncovered foreign keys                 | **0** (`uncovered_fks: []`)                                                                            |
| Runtime-reachable destructive cascades | **0** (`no_runtime_reachable_destructive_cascade: true`; `runtime_reachable_destructive_cascades: []`) |

### Orphans impossible

All 537 foreign keys are in the `VALIDATED` state (none `NOT VALID`), so PostgreSQL enforces
every reference at write time and no existing row violates its constraint. Combined with the
default-deny RLS posture and validated constraints, orphan child rows cannot be created or
left behind — **orphans are impossible by construction**.

### Index coverage complete

Every foreign key has a covering index on its referencing column(s)
(`fk_index_coverage_complete: true`, `uncovered_fks: []`). This removes unindexed-FK lock
and scan hazards on parent updates/deletes and supports join and point-lookup performance
(see `index-review-report.md`).

## Finding — administrative-only `ON DELETE CASCADE` (reviewed, non-blocking, recorded)

Five `ON DELETE CASCADE` foreign keys exist in the schema. Each was reviewed and confirmed
**not runtime-reachable**: no application role (`app_runtime`, `app_readonly`, worker) holds
a `DELETE` grant on any cascade parent, so no financial or audit history can be destroyed at
runtime. They are classified **administrative-only**.

| #   | Child → Parent                                     | Cascade | Why not runtime-reachable                                                                            |
| --- | -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `iam.audit_integrity_links` → `iam.audit_records`  | CASCADE | Parent not runtime-deletable — `iam.audit_records` is `SELECT`-only for `app_runtime`/`app_readonly` |
| 2   | `iam.audit_record_details` → `iam.audit_records`   | CASCADE | Parent not runtime-deletable — no `DELETE` grant on `iam.audit_records`                              |
| 3   | `iam.grant_scopes` → `iam.role_grants`             | CASCADE | Parent not runtime-deletable — no runtime `DELETE` grant on `iam.role_grants`                        |
| 4   | `iam.role_permissions` → `iam.roles`               | CASCADE | Parent not runtime-deletable — no runtime `DELETE` grant on `iam.roles`                              |
| 5   | `shared.status_evidence` → `shared.status_history` | CASCADE | Parent not runtime-deletable — no runtime `DELETE` grant on `shared.status_history`                  |

These cascades exist only to keep dependent rows consistent during authorized administrative
teardown (e.g., role or provisioning maintenance performed by a privileged operator), not
during any application-role operation. `iam.audit_records` in particular is `SELECT`-only for
the app roles, so the audit chain and its integrity links cannot be deleted at runtime.
**Classification:** administrative-only; **disposition:** reviewed, non-blocking, recorded.

## Status

**PASS.** 537/537 foreign keys validated (orphans impossible) and fully index-covered; 0
runtime-reachable destructive cascades. The 5 `ON DELETE CASCADE` foreign keys are
administrative-only and cannot destroy financial or audit history at runtime. Zero
unresolved Critical or High findings for this review.
