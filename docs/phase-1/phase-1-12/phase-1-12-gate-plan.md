# Phase 1-12 — Release 2 Database Gate Execution Plan

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase ID:** P1-12 · **Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

**Review model:** Solo Developer Review Policy under the Standing Technical Authorization
Policy — owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar; **never** independent third-party audit. The Security review
stream may block the technical gate for an unresolved Critical exposure.

## Purpose

P1-12 is the final phase of the Database Development Group and the formal Release 2
database gate. It **validates** the complete integrated database produced by Phases
P1-2…P1-11 before any backend implementation begins. It introduces **no new business
domain**. The only permitted schema changes are narrowly-scoped **additive** remediation
migrations that fix evidence-backed gate-blocking findings.

## Scope boundary (may / must-not)

**May create:** validation scripts, test suites, generated (non-personal) data builders,
review reports, evidence-pack documents, backup/restore scripts + runbooks, schema
inventory + drift tooling, consolidated gate-pipeline tooling, narrow additive remediation
migrations for proven blockers, baseline manifests + schema hashes, Release 2 baseline
registration, gate decision documents.

**Must not create:** new domain/business tables, backend services, APIs, controllers,
repositories, application business logic, frontend, real Benzene migrations, production
deployment infrastructure, procurement, general ledger / journal / journal-line /
chart-of-accounts / accounting-period / posting-rule, payment-gateway integration,
subscription billing.

Any apparent missing capability is (1) verified against canonical requirements, (2)
classified as gate-blocking integrity defect / non-blocking documentation gap /
future-scope, (3) fixed in P1-12 **only** when a gate blocker, else registered and
scheduled without implementing it.

## Gate map (wave → condition → command/script → stream → artifact → pass/fail → remediation)

| Wave | Gate condition                                                        | Command / script                                        | Review stream    | Evidence artifact                                          | Pass/fail                                          | Remediation path            |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | -------------------------------------------------- | --------------------------- |
| 0    | Protected baseline + DoR captured; P1-2…P1-11 gates closed            | git read-only; `schema-inventory.mjs`; grep OD statuses | Governance       | `environment-manifest.md`, this plan                       | All predecessors closed; DoR carried               | n/a (blocks start)          |
| 1.1  | Empty rebuild reproducible; seeds idempotent×2; full tests green      | `supabase db reset`; `validate:seed-state`; `test:db`   | Migration        | `migration-rebuild-report.md`                              | reset exit 0; tests all green                      | additive migration / fix    |
| 1.2  | Phase-boundary upgrade matrix P1-2…P1-11 all pass                     | `phase-upgrade-matrix.mjs` (disposable schemas/DBs)     | Migration        | `upgrade-matrix-report.md`                                 | every boundary applies + upgrades clean            | additive forward correction |
| 1.3  | Every migration classified; no drift; no silent data loss             | header grep; git hash; `no-fake-data`                   | Migration        | `migration-classification-report.md`                       | 113/113 classified; hashes stable                  | n/a                         |
| 2    | Authoritative inventory; zero unexplained dictionary drift            | `schema-inventory.mjs`; `dictionary-drift.mjs`          | Structural       | `schema-inventory.json`, `dictionary-drift-report.md`      | zero unexplained drift                             | doc change or additive fix  |
| 2.2  | FK integrity: scope, ON DELETE, validated, index cover, no orphans    | `fk-review.mjs` + existing FK-cover guard               | Structural       | `fk-review-report.md`                                      | 0 invalid/orphan; financial no destructive cascade | additive index / migration  |
| 2.3  | Every documented uniqueness rule has negative evidence                | test:db uniqueness suites + `unique-review.md`          | Structural       | `unique-review-report.md`                                  | each rule proven                                   | add regression test         |
| 2.4  | Check/exclusion/state families have negative evidence                 | test:db constraint suites                               | Structural       | `check-exclusion-review-report.md`                         | each family proven                                 | add regression test         |
| 2.5  | Duplicate/FK-index guards; query-family plans                         | `index-review.mjs` (EXPLAIN on perf dataset)            | Structural/Perf  | `index-review-report.md`                                   | 0 dup; intended plans confirmed                    | additive index              |
| 3    | Integrated cross-domain E2E (≥2 tenant/company/branch) reconciles     | `tests/db/p1-12-integrated-scenario.test.ts`            | Integration      | `integrated-scenario-report.md`                            | full chain valid; balances reconcile; no leakage   | fix + regression            |
| 4.1  | Every tenant table RLS+FORCE; runtime not owner; default deny         | `schema-inventory.mjs` + test:db isolation              | Security         | `rls-review-report.md`                                     | 242/242 enabled+forced; 0 owner=app                | n/a                         |
| 4.2  | Full role matrix (2×2×2) zero unauthorized cross-scope                | `tests/db/p1-12-isolation-matrix.test.ts`               | Security         | `isolation-report.md`                                      | zero unauthorized rows                             | fix + regression            |
| 4.3  | 0 unsafe SECURITY DEFINER; INVOKER+search_path; no PUBLIC EXEC        | inventory + test:db security                            | Security         | `function-security-report.md`                              | 0 definer; safe                                    | n/a                         |
| 4.4  | Classification registers reconcile; restricted gated + not searchable | 7 classification validators                             | Security/Privacy | `classification-report.md`                                 | all reconcile                                      | fix register/migration      |
| 4.5  | Append-only/audit integrity: intact passes, altered/gap detected      | `tests/db/p1-12-audit-integrity.test.ts`                | Security         | `audit-integrity-report.md`                                | intact pass; tamper detected                       | add guard                   |
| 4.6  | Export-permission backend contract (documented, not implemented)      | doc                                                     | Security         | `export-permission-contract.md`                            | complete                                           | n/a                         |
| 5.1  | Transaction rollback matrix: zero orphan/partial                      | `tests/db/p1-12-txn-rollback.test.ts`                   | QA               | `transaction-rollback-report.md`                           | clean rollback everywhere                          | fix                         |
| 5.2  | Concurrency campaign ×3 (×5 where required): single-winner            | existing concurrency suites ×N + `p1-12-concurrency`    | QA               | `concurrency-report.md`                                    | one correct state each                             | fix lock order              |
| 5.3  | Idempotency matrix: replay adds zero rows/events                      | `tests/db/p1-12-idempotency-matrix.test.ts`             | QA               | `idempotency-report.md`                                    | zero duplicates                                    | fix                         |
| 5.4  | Migration recovery rehearsal per class                                | `recovery-rehearsal.mjs`                                | QA               | `recovery-rehearsal-report.md`                             | each class rehearsed                               | n/a                         |
| 6.1  | Seed campaign (fresh/2nd/after-fixtures/reset) idempotent + no fake   | `validate:seed-state`, `no-fake-data`                   | QA               | `seed-report.md`                                           | idempotent; empty business                         | fix seed                    |
| 6.2  | Generated (non-personal) performance dataset                          | `perf-dataset.mjs`                                      | Performance      | `performance-dataset-manifest.md`                          | volumes recorded (not prod capacity)               | n/a                         |
| 6.3  | Query-family baseline (median/p95/p99, plan, index)                   | `perf-baseline.mjs`                                     | Performance      | `performance-baseline-report.md`                           | measured; misses classified                        | index/decision              |
| 7.1  | Real pg_dump (custom) + encrypt; hash/size recorded                   | `backup-drill.mjs`                                      | Recovery         | `backup-evidence.md`                                       | backup+hash captured                               | n/a                         |
| 7.2  | Restore into fresh DB; schema hash + control totals match             | `restore-drill.mjs`                                     | Recovery         | `restore-evidence.md`                                      | restore matches; tests pass                        | fix                         |
| 7.3  | Corruption/mismatch detection (hash/schema/control/missing/drift)     | `restore-drill.mjs --negative`                          | Recovery         | `restore-evidence.md`                                      | each detected                                      | n/a                         |
| 7.4  | Recovery runbook complete                                             | doc                                                     | Recovery         | `recovery-runbook.md`                                      | complete                                           | n/a                         |
| 8.1  | Data dictionary 100% coverage; automated compare                      | `dictionary-drift.mjs`                                  | Docs             | `data-dictionary.md`, drift report                         | zero unexplained                                   | doc change                  |
| 8.2  | ERD synchronized to live physical schema                              | ERD compare                                             | Docs             | ERD sources                                                | no silent drift                                    | controlled doc change       |
| 8.3  | Traceability FR/BR/NFR/UC/risk/OD → object/test/evidence              | doc                                                     | Docs             | `traceability.md`                                          | mapped; OD carried                                 | n/a                         |
| 8.4  | Reproducible Release 2 baseline manifest + tag plan                   | `baseline-manifest.mjs`                                 | Governance       | `frozen-baseline-manifest.md`                              | reproducible                                       | n/a                         |
| 8.5  | Evidence pack (35 artifacts) complete, all real                       | authoring                                               | Governance       | `evidence-pack-index.md`                                   | all present, real numbers                          | n/a                         |
| 9    | Final adversarial review (20 streams); 0 unresolved Critical/High     | subagents/workflow                                      | All              | `defect-register.md`, `security-signoff-recommendation.md` | 0 Critical/High                                    | fix + regression            |
| 10   | Feature PR; every required hosted CI check green on exact SHA         | GitHub                                                  | Governance       | PR                                                         | all green, ready-to-merge                          | fix root cause              |

## Consolidated gate pipeline

`npm run gate:p1-12` (script `scripts/db/gate-p1-12.mjs`) runs the required set in a
controlled order, preserves exit codes, stops on the first failed required gate, and
prints an evidence summary. Mutable DB campaigns never run concurrently against the same
database.

## Owner gate

**Decision: Pending.** Do not pre-claim results. All numbers/outcomes come from actual
execution; no fabricated evidence. The gate cannot be submitted with an unresolved
Critical or High. Any remaining Medium is fixed or explicitly accepted with rationale,
control, residual risk, owner, and schedule. The user performs every PR merge.
