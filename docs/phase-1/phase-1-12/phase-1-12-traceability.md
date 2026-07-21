# Phase 1-12 — Release 2 Database Traceability Matrix

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-12 · **Release:** Release 2 — Core Business Database · **Wave:** 8.3 (Docs) ·
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45) ·
**Branch:** `feature/p1-12-database-integration-validation-release-gate` ·
**Schema hash (canonical):** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`

**Review model:** Solo Developer Review Policy under the Standing Technical Authorization
Policy — owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar; **not** an independent third-party audit. The user performs every
pull-request merge.

---

## 1. Purpose and reading rules

This matrix maps the Database-Development-Group requirement classes exercised by the Release 2
gate — functional/structural (FR), business rules (BR), non-functional (NFR), use cases (UC),
risks (RISK), and carried open decisions (OD) — onto the **schema object(s)** that realize them,
the **test/validator** that proves them, the committed **evidence artifact**, and a **status**.

Reading rules:

- P1-12 is a **validation-only** gate. It introduces **no new business domain**, so it defines
  no new requirements. The FR/BR/NFR/UC rows are the Release 2 database validation-requirement
  classes evidenced by this gate; the only externally-registered identifiers carried **verbatim**
  are the open decisions (`P1-OD-*`) and the scalability NFR (`NFR-SCL`).
- Every figure below traces to actual execution recorded in the P1-12 evidence pack. Nothing is
  extrapolated. Evidence artifacts live under `docs/phase-1/phase-1-12/evidence/`.
- Status vocabulary: **PASS** (validated with negative/positive evidence) · **VALIDATED**
  (measured/inventoried) · **REVIEWED — NON-BLOCKING** (finding recorded, not gate-blocking) ·
  **UNRESOLVED** (open decision carried, not decided by P1-12).

---

## 2. Functional / structural requirements (FR)

| ID        | Requirement (evidenced)                                                                     | Schema object(s)                                                                        | Test / validator                                                                  | Evidence artifact                                                   | Status    |
| --------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- |
| FR-REB-01 | Empty rebuild reproducible from empty (`supabase db reset`); full suite green               | all 17 module schemas / 242 tables                                                      | `test:db` on empty rebuild — 118 files / 1141 tests all green (201s)              | `frozen-baseline-manifest.json`                                     | PASS      |
| FR-UPG-01 | Phase-boundary upgrade matrix P1-2…P1-11 upgrades to the canonical schema hash              | cumulative schema (0/22/41/63/84/107/136/180/215/242 tables)                            | `scripts/db/phase-upgrade-matrix.mjs` — 10/10 boundaries `matches_canonical=true` | `upgrade-matrix.json`                                               | PASS      |
| FR-MIG-01 | Every migration rollback-classified; all additive/forward-only; no merged migration edited  | 113 migrations                                                                          | header grep + git hash; `no-fake-data`                                            | `environment-manifest.md`, gate report                              | PASS      |
| FR-INV-01 | Authoritative integrated inventory (byte-identical structural equivalence, hash `d3b1e7e4`) | 242 tables · 3562 cols · 210 fns · 539 trig · 585 pol · 999 idx · 1843 constr · 0 views | `scripts/db/structural-review.mjs` (`live_tables=242`)                            | `structural-review.json`                                            | VALIDATED |
| FR-FK-01  | Referential integrity: all FKs validated (orphans impossible) and all FK-index-covered      | 537 FKs                                                                                 | `structural-review.mjs` — `all_fks_validated`, `fk_index_coverage_complete`       | `structural-review.json` (`unvalidated_fks=[]`, `uncovered_fks=[]`) | PASS      |
| FR-IDX-01 | No TRUE duplicate indexes                                                                   | 999 indexes                                                                             | `structural-review.mjs` — `no_duplicate_indexes`                                  | `structural-review.json` (`duplicate_indexes=[]`)                   | PASS      |
| FR-E2E-01 | Integrated cross-domain lifecycle commits in one transaction and reconciles                 | svc → inv → veh → rec → wo → quo → sal → delivery → wty                                 | `tests/db/p1-12-integrated-scenario.test.ts` — 8/8 PASS                           | integrated-scenario suite (in 1141)                                 | PASS      |

Cross-domain chain (FR-E2E-01), single committed transaction: service + published price → inventory
item + warehouse + 50 on hand → vehicle → authorized visit + custody accept → work order → quotation
revision + service item → invoice bound to the quotation revision (`quo`→`sal` forward FK) + issue →
receipt → allocation → delivery (same WO/vehicle/visit, custody released) → warranty bound to the
delivered vehicle/WO.

---

## 3. Business rules (BR)

Only rules with **direct positive/negative evidence** from the integrated scenario are listed.

| ID        | Business rule (evidenced)                                                                                       | Schema object(s)                                                  | Test / validator                    | Evidence artifact                  | Status |
| --------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- | ---------------------------------- | ------ |
| BR-FIN-01 | Financial-event provenance complete: exactly one each `invoice_issued`, `receipt_recorded`, `payment_allocated` | `sal` financial-event source-fact                                 | `p1-12-integrated-scenario.test.ts` | integrated-scenario reconciliation | PASS   |
| BR-FIN-02 | Invoice open receivable = 0 after full payment (balances reconcile)                                             | `sal.invoice`, receipt, allocation                                | `p1-12-integrated-scenario.test.ts` | integrated-scenario reconciliation | PASS   |
| BR-CUS-01 | Custody released **exactly once** across the delivery close                                                     | `rec.custody_history`, delivery                                   | `p1-12-integrated-scenario.test.ts` | integrated-scenario reconciliation | PASS   |
| BR-INV-01 | Inventory on-hand preserved (=50) through the allocated/delivered chain                                         | `inv` item + warehouse ledger                                     | `p1-12-integrated-scenario.test.ts` | integrated-scenario reconciliation | PASS   |
| BR-WTY-01 | Warranty bound to the delivered vehicle / work order / delivery (all match)                                     | `wty` record ← delivery/vehicle/WO                                | `p1-12-integrated-scenario.test.ts` | integrated-scenario reconciliation | PASS   |
| BR-AUD-01 | Append-only audit: per-tenant SHA-256 hash chain; tamper, gap, and concurrent fork detected                     | `iam.audit_records`, `iam.audit_append`, `iam.audit_verify_chain` | `iam-audit.test.ts`                 | audit-integrity suite (in 1141)    | PASS   |

---

## 4. Non-functional requirements (NFR)

| ID          | Non-functional requirement (evidenced)                                                               | Schema object(s)                                        | Test / validator                                                                                  | Evidence artifact                      | Status                             |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| NFR-SEC-01  | Every tenant table RLS ENABLE + FORCE; runtime role owns nothing                                     | 242/242 tables                                          | `structural-review.mjs` + isolation suites — 0 RLS-not-forced                                     | `structural-review.json`, inventory    | PASS                               |
| NFR-SEC-02  | 0 `SECURITY DEFINER`; all module functions INVOKER + `search_path=''` + REVOKE PUBLIC                | 210 functions                                           | inventory + `test:db` security suites                                                             | `environment-manifest.md`              | PASS                               |
| NFR-SEC-03  | No runtime-reachable destructive cascade can destroy financial/audit history                         | 5 admin-only CASCADE FKs                                | `structural-review.mjs` — `no_runtime_reachable_destructive_cascade`                              | `structural-review.json`               | PASS                               |
| NFR-ISO-01  | Tenant/branch isolation: tenant B + no-context see ZERO across 10 domains; cross-tenant write DENIED | 10 domain tables (2 tenants/2 branches)                 | `p1-12-integrated-scenario.test.ts` isolation matrix + crm/veh/p1-09/p1-10/p1-11 isolation suites | isolation suites (in 1141)             | PASS                               |
| NFR-CLS-01  | Classification registers reconcile registry vs live (restricted gated, not searchable)               | crm/veh/apt-rec/wo-tech-dia-qms/svc-quo-inv/sal-wty-rpt | 6 classification validators all reconcile                                                         | `environment-manifest.md`, gate report | PASS                               |
| NFR-CON-01  | Concurrency single-winner invariants hold with no flakiness (×3 consecutive rounds)                  | apt-rec/crm/p1-09/p1-10/p1-11/veh                       | concurrency campaign ×3 — each round 6 files / 36 tests all PASS                                  | concurrency campaign log               | PASS                               |
| NFR-PERF-01 | Tenant-leading indexed POINT lookups use index (no seq scan), ~1 ms median (**validation baseline**) | crm/veh tenant-scoped indexes                           | `scripts/db/perf-baseline.mjs` (30 000 partners + 30 000 vehicles, ephemeral, deleted)            | `performance-baseline.json`            | VALIDATED                          |
| NFR-SCL     | Production scalability / capacity target                                                             | —                                                       | not in P1-12 scope (validation baselines are **not** capacity claims)                             | `performance-baseline.json` note       | **UNRESOLVED** (see §7, P1-OD-027) |

Measured baselines (NFR-PERF-01, proposed validation baselines only): `partner_point_lookup`
median 1.07 ms / p95 1.50 / p99 1.75; `vehicle_point_lookup` median 1.02 ms;
`index_used=true`, `seq_scan=false`; tenant-scoped partner count ~3.7 ms (bounded scan);
`partner_outstanding_balance` fn ~1.6 ms.

---

## 5. Use cases (UC)

| ID        | Use case (evidenced)                                                                | Schema object(s)               | Test / validator                           | Evidence artifact                                   | Status |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------ | --------------------------------------------------- | ------ |
| UC-LC-01  | End-to-end service-to-warranty lifecycle for a vehicle in one committed transaction | svc/inv/veh/rec/wo/quo/sal/wty | `p1-12-integrated-scenario.test.ts` — 8/8  | integrated-scenario suite                           | PASS   |
| UC-ISO-01 | Multi-tenant / multi-branch isolation under the 2×2 role matrix                     | 10 domain tables               | isolation matrix + module isolation suites | isolation suites (in 1141)                          | PASS   |
| UC-BR-01  | Backup → encrypt → restore into a fresh DB with schema-hash + control-total match   | full catalog (validation DB)   | `scripts/db/backup-restore-drill.sh`       | backup/restore drill (uncommitted, validation-only) | PASS   |

UC-BR-01 evidence (validation environment only, artifacts removed, nothing committed): custom-format
`pg_dump` 2,941,202 bytes / 1123 ms / sha256 `9cd5ee42…c48b1b9f`; AES-256-CBC/pbkdf2 (ephemeral
passphrase, not stored); restore into fresh DB 8204 ms with schema hash MATCH (`d3b1e7e4`) + control
totals (currencies 3, permissions 43, payment_methods 3); corruption detection all three negatives
(tampered archive, wrong passphrase, incomplete restore) detected. **Does not** establish a production
backup scheduler; no RPO/RTO compliance asserted beyond the measured 8204 ms restore.

---

## 6. Risk register (RISK)

| ID          | Risk (evidenced)                                                                   | Schema object(s)                                                                                                                                                                                            | Disposition                                                                                                                                                                           | Evidence artifact        | Status                  |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------- |
| RISK-CAS-01 | 5 `ON DELETE CASCADE` FKs could, in principle, destroy audit/authorization history | iam.audit_integrity_links→iam.audit_records · iam.audit_record_details→iam.audit_records · iam.grant_scopes→iam.role_grants · iam.role_permissions→iam.roles · shared.status_evidence→shared.status_history | **NONE runtime-reachable** — no app role holds a DELETE grant on any cascade parent (`iam.audit_records` is SELECT-only for app_runtime/app_readonly); classified administrative-only | `structural-review.json` | REVIEWED — NON-BLOCKING |

No unresolved Critical or High finding exists in this gate.

---

## 7. Open decisions carried (OD)

Open decisions are **carried forward, not invented, and not decided by P1-12** — a validation-only
phase introduces no new domain decision. The five decisions the gate explicitly tracks as unresolved
are shown first; the remaining carried decisions follow.

| Open decision         | Linkage                                                              | Resolved in P1-12? | Status               |
| --------------------- | -------------------------------------------------------------------- | ------------------ | -------------------- |
| **P1-OD-007**         | Carried DB-group open decision                                       | No                 | **UNRESOLVED**       |
| **P1-OD-027**         | Scalability / production capacity (`NFR-SCL`) — see NFR-PERF-01 note | No                 | **UNRESOLVED**       |
| **P1-OD-035**         | Carried DB-group open decision                                       | No                 | **UNRESOLVED**       |
| **P1-OD-036**         | Carried DB-group open decision                                       | No                 | **UNRESOLVED**       |
| **P1-OD-042**         | Carried DB-group open decision                                       | No                 | **UNRESOLVED**       |
| P1-OD-018 … P1-OD-024 | Carried DB-group open decisions                                      | No                 | UNRESOLVED (carried) |
| P1-OD-041             | Carried DB-group open decision                                       | No                 | UNRESOLVED (carried) |

None of these open decisions is a gate blocker for the Release 2 **database** gate; each is
registered and scheduled without being implemented in P1-12.

---

## 8. Coverage and status

- **FR:** 7/7 mapped and evidenced (6 PASS + 1 VALIDATED).
- **BR:** 6/6 mapped, all PASS (positive reconciliation evidence).
- **NFR:** 6/6 substantive NFRs PASS/VALIDATED; `NFR-SCL` (P1-OD-027) explicitly UNRESOLVED.
- **UC:** 3/3 mapped, all PASS.
- **RISK:** 1 recorded, REVIEWED — NON-BLOCKING (administrative-only cascade).
- **OD:** 13 open decisions carried (P1-OD-007, 018–024, 027, 035, 036, 041, 042); P1-OD-007/027/035/036/042 tracked explicitly as UNRESOLVED.

**Traceability status: COMPLETE — every mapped requirement traces to a schema object, a test/validator,
and a committed evidence artifact; all carried open decisions are explicitly recorded as UNRESOLVED.**
Zero unresolved Critical or High. This matrix is a self-review artifact under the Standing Technical
Authorization Policy; the user performs every merge.
